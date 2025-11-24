import http from 'http';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { gotScraping } from 'got-scraping';
import config from './lib/config.js';
import { initBrowser, generateImage, TEMP_DIR } from './lib/lmarena.js';
import { MODEL_MAPPING, getModels } from './lib/models.js';

const PORT = config.server.port || 3000;
const AUTH_TOKEN = config.server.auth;
const SERVER_MODE = config.server.type || 'openai'; // 'openai' 或 'queue'

// --- 全局状态 ---
let browserContext = null; // 浏览器上下文 {browser, page, client, width, height}
const queue = []; // 请求队列
let processingCount = 0; // 当前正在处理的任务数
const MAX_CONCURRENT = 1; // 同时处理的任务数 (Puppeteer 只能单线程操作)
const MAX_QUEUE_SIZE = 2; // 最大排队数 (总容量 = MAX_CONCURRENT + MAX_QUEUE_SIZE = 3)

/**
 * 处理队列中的任务
 */
async function processQueue() {
    // 如果正在处理的任务已满，或队列为空，则停止
    if (processingCount >= MAX_CONCURRENT || queue.length === 0) return;

    // 取出下一个任务
    const task = queue.shift();
    processingCount++;

    // 如果是 Queue 模式，通知客户端状态变更
    if (SERVER_MODE === 'queue' && task.sse) {
        task.sse.send('status', { status: 'processing' });
    }

    try {
        console.log(`>>> [Queue] 开始处理任务。剩余排队: ${queue.length}`);

        // 确保浏览器已初始化
        if (!browserContext) {
            browserContext = await initBrowser(config);
        }

        const { req, res, prompt, imagePaths, modelId } = task;

        // 调用核心生图逻辑
        const result = await generateImage(browserContext, prompt, imagePaths, modelId);

        // 清理临时图片
        for (const p of imagePaths) {
            try { fs.unlinkSync(p); } catch (e) { }
        }

        // 处理结果
        let finalContent = '';
        let queueResult = {};

        if (result.error) {
            // 特殊错误处理：reCAPTCHA
            if (result.error === 'recaptcha validation failed') {
                if (SERVER_MODE === 'openai') {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'recaptcha validation failed' }));
                } else {
                    task.sse.send('result', { status: 'error', image: null, msg: 'recaptcha validation failed' });
                    task.sse.send('done', '[DONE]');
                    task.sse.end();
                }
                return;
            }
            finalContent = `[生成错误] ${result.error}`;
            queueResult = { status: 'error', image: null, msg: result.error };
        } else if (result.image) {
            try {
                console.log('>>> [Download] 正在下载生成结果...');
                const response = await gotScraping({
                    url: result.image,
                    responseType: 'buffer',
                    http2: true,
                    headerGeneratorOptions: {
                        browsers: [{ name: 'chrome', minVersion: 110 }],
                        devices: ['desktop'],
                        locales: ['en-US'],
                        operatingSystems: ['windows'],
                    }
                });
                const imgBuffer = response.body;

                // 检测图片格式并转 Base64
                const metadata = await sharp(imgBuffer).metadata();
                const mimeType = metadata.format === 'png' ? 'image/png' : 'image/jpeg';
                const base64 = imgBuffer.toString('base64');

                finalContent = `![generated](data:${mimeType};base64,${base64})`;
                queueResult = { status: 'completed', image: base64, msg: '' };
                console.log('>>> [Response] 图片已转换为 Base64');
            } catch (e) {
                console.error('>>> [Error] 图片下载失败:', e.message);
                finalContent = `[图片下载失败] ${result.image}`;
                queueResult = { status: 'error', image: null, msg: `Download failed: ${e.message}` };
            }
        } else {
            finalContent = result.text || '生成失败';
            queueResult = { status: 'completed', image: null, msg: result.text };
        }

        // 发送响应
        if (SERVER_MODE === 'openai') {
            const response = {
                id: 'chatcmpl-' + Date.now(),
                object: 'chat.completion',
                created: Math.floor(Date.now() / 1000),
                model: 'lmarena-image',
                choices: [{
                    index: 0,
                    message: {
                        role: 'assistant',
                        content: finalContent
                    },
                    finish_reason: 'stop'
                }]
            };
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(response));
        } else {
            // Queue Mode
            task.sse.send('result', queueResult);
            task.sse.send('done', '[DONE]');
            task.sse.end();
        }

    } catch (err) {
        console.error('>>> [Error] 任务处理失败:', err);
        if (SERVER_MODE === 'openai') {
            if (!task.res.writableEnded) {
                task.res.writeHead(500, { 'Content-Type': 'application/json' });
                task.res.end(JSON.stringify({ error: err.message }));
            }
        } else {
            task.sse.send('result', { status: 'error', image: null, msg: err.message });
            task.sse.send('done', '[DONE]');
            task.sse.end();
        }
    } finally {
        processingCount--;
        // 递归处理下一个任务
        processQueue();
    }
}

/**
 * 启动 HTTP 服务器
 */
async function startServer() {
    // 预先启动浏览器
    try {
        browserContext = await initBrowser(config);
    } catch (err) {
        console.error('>>> [Error] 浏览器初始化失败:', err);
        process.exit(1);
    }

    const server = http.createServer(async (req, res) => {
        // --- 鉴权中间件 ---
        const authHeader = req.headers['authorization'];
        if (!authHeader || authHeader !== `Bearer ${AUTH_TOKEN}`) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unauthorized' }));
            return;
        }

        // --- 路由分发 ---
        const isQueueMode = SERVER_MODE === 'queue';
        const targetPath = isQueueMode ? '/v1/queue/join' : '/v1/chat/completions';

        // 1. 模型列表接口 (OpenAI & Queue 模式通用)
        if (req.method === 'GET' && req.url === '/v1/models') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(getModels()));
            return;
        }

        if (req.method === 'POST' && req.url.startsWith(targetPath)) {
            // --- SSE 设置 (仅 Queue 模式) ---
            let sseHelper = null;
            if (isQueueMode) {
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive'
                });

                sseHelper = {
                    send: (event, data) => {
                        res.write(`event: ${event}\n`);
                        res.write(`data: ${typeof data === 'object' ? JSON.stringify(data) : data}\n\n`);
                    },
                    end: () => res.end()
                };

                // 启动心跳
                const heartbeat = setInterval(() => {
                    if (res.writableEnded) {
                        clearInterval(heartbeat);
                        return;
                    }
                    sseHelper.send('heartbeat', Date.now());
                }, 3000);
            }

            const chunks = [];
            req.on('data', chunk => chunks.push(chunk));
            req.on('end', async () => {
                try {
                    // --- 限流检查 (仅 OpenAI 模式) ---
                    if (!isQueueMode && processingCount + queue.length >= MAX_CONCURRENT + MAX_QUEUE_SIZE) {
                        console.warn('>>> [Server] 请求过多，已拒绝（限流）');
                        if (isQueueMode) {
                            sseHelper.send('error', { msg: 'Too Many Requests' });
                            sseHelper.end();
                        } else {
                            res.writeHead(429, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: 'Too Many Requests. Server is busy.' }));
                        }
                        return;
                    }

                    const body = Buffer.concat(chunks).toString();
                    const data = JSON.parse(body);
                    const messages = data.messages;

                    if (!messages || messages.length === 0) {
                        if (isQueueMode) { sseHelper.send('error', { msg: 'No messages' }); sseHelper.end(); }
                        else { res.writeHead(400); res.end(JSON.stringify({ error: 'No messages' })); }
                        return;
                    }

                    // 筛选用户消息
                    const userMessages = messages.filter(m => m.role === 'user');
                    if (userMessages.length === 0) {
                        if (isQueueMode) { sseHelper.send('error', { msg: 'No user messages' }); sseHelper.end(); }
                        else { res.writeHead(400); res.end(JSON.stringify({ error: 'No user messages' })); }
                        return;
                    }
                    const lastMessage = userMessages[userMessages.length - 1];

                    let prompt = '';
                    const imagePaths = [];
                    let imageCount = 0;

                    // 解析内容 (拼接文本 + 处理图片)
                    if (Array.isArray(lastMessage.content)) {
                        for (const item of lastMessage.content) {
                            if (item.type === 'text') {
                                prompt += item.text + ' ';
                            } else if (item.type === 'image_url' && item.image_url && item.image_url.url) {
                                imageCount++;
                                if (imageCount > 5) {
                                    return;
                                }

                                const url = item.image_url.url;
                                if (url.startsWith('data:image')) {
                                    const matches = url.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
                                    if (matches && matches.length === 3) {
                                        const buffer = Buffer.from(matches[2], 'base64');
                                        // 压缩图片
                                        const processedBuffer = await sharp(buffer)
                                            .jpeg({ quality: 90 })
                                            .toBuffer();

                                        const filename = `img_${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;
                                        const filePath = path.join(TEMP_DIR, filename);
                                        fs.writeFileSync(filePath, processedBuffer);
                                        imagePaths.push(filePath);
                                    }
                                }
                            }
                        }
                    } else {
                        prompt = lastMessage.content; // 回落保留
                    }

                    prompt = prompt.trim();

                    // 解析模型参数
                    let modelId = null;
                    if (data.model) {
                        if (MODEL_MAPPING[data.model]) {
                            modelId = MODEL_MAPPING[data.model];
                            console.log(`>>> [Server] 触发模型: ${data.model}, UUID: ${modelId}`);
                        } else {
                            const errorMsg = `Invalid model: ${data.model}`;
                            console.warn(`>>> [Server] ${errorMsg}`);
                            if (isQueueMode) { sseHelper.send('error', { msg: errorMsg }); sseHelper.end(); }
                            else { res.writeHead(400); res.end(JSON.stringify({ error: errorMsg })); }
                            return;
                        }
                    } else {
                        console.log('>>> [Server] 未指定模型，使用网页默认值');
                    }

                    console.log(`>>> [Queue] 请求入队 - Prompt: ${prompt}, Images: ${imagePaths.length}`);

                    if (isQueueMode) {
                        sseHelper.send('status', { status: 'queued', position: queue.length + 1 });
                    }

                    // 将任务加入队列
                    queue.push({ req, res, prompt, imagePaths, sse: sseHelper, modelId });

                    // 触发队列处理
                    processQueue();

                } catch (err) {
                    console.error('>>> [Error] 服务器处理失败:', err);
                    if (isQueueMode && sseHelper) {
                        sseHelper.send('error', { msg: err.message });
                        sseHelper.end();
                    } else if (!res.writableEnded) {
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: err.message }));
                    }
                }
            });
        } else {
            res.writeHead(404);
            res.end();
        }
    });

    server.listen(PORT, () => {
        console.log(`>>> [Server] HTTP 服务器启动成功，监听端口 ${PORT}`);
        console.log(`>>> [Server] 运行模式: ${SERVER_MODE === 'openai' ? 'OpenAI 兼容模式' : 'Queue 队列模式'}`);
        if (SERVER_MODE === 'openai') {
            console.log(`>>> [Server] 最大并发: ${MAX_CONCURRENT}, 最大排队: ${MAX_QUEUE_SIZE}`);
        }
    });
}

startServer();
