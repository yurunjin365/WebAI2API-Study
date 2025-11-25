import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { anonymizeProxy, closeAnonymizedProxy } from 'proxy-chain';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- 配置常量 ---
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const USER_DATA_DIR = path.join(process.cwd(), 'data', 'chromeUserData');
const TARGET_URL = 'https://lmarena.ai/c/new?mode=direct&chat-modality=image';
const TEMP_DIR = path.join(process.cwd(), 'data', 'temp');

// 确保临时目录存在
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// --- 辅助工具 ---

/**
 * 生成指定范围内的随机数
 * @param {number} min 最小值
 * @param {number} max 最大值
 * @returns {number} 随机数
 */
const random = (min, max) => Math.random() * (max - min) + min;

/**
 * 随机休眠一段时间
 * @param {number} min 最小毫秒数
 * @param {number} max 最大毫秒数
 */
const sleep = (min, max) => new Promise(r => setTimeout(r, Math.floor(random(min, max))));

/**
 * 根据文件扩展名获取 MIME 类型
 * @param {string} filePath 文件路径
 * @returns {string} MIME 类型
 */
function getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const map = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
    return map[ext] || 'application/octet-stream';
}

// --- 核心拟人化算法 (贝塞尔曲线 + 物理模拟) ---

/**
 * 三次贝塞尔曲线计算
 */
function cubicBezier(t, p0, p1, p2, p3) {
    const k = 1 - t;
    return k * k * k * p0 + 3 * k * k * t * p1 + 3 * k * t * t * p2 + t * t * t * p3;
}

/**
 * 模拟人类鼠标移动轨迹
 * @param {object} page Puppeteer 页面对象
 * @param {number} startX 起始 X 坐标
 * @param {number} startY 起始 Y 坐标
 * @param {number} targetX 目标 X 坐标
 * @param {number} targetY 目标 Y 坐标
 */
async function humanMove(page, startX, startY, targetX, targetY) {
    const distance = Math.sqrt(Math.pow(targetX - startX, 2) + Math.pow(targetY - startY, 2));
    const steps = Math.floor(Math.max(distance / 8, 15));

    const offset = distance * 0.4;
    // 生成两个随机控制点，使轨迹弯曲
    const cp1X = startX + (targetX - startX) / 3 + random(-offset, offset);
    const cp1Y = startY + (targetY - startY) / 3 + random(-offset, offset);
    const cp2X = startX + 2 * (targetX - startX) / 3 + random(-offset, offset);
    const cp2Y = startY + 2 * (targetY - startY) / 3 + random(-offset, offset);

    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        // 缓动函数：起步快，结尾慢，模拟人类肌肉运动
        const easeT = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

        let x = cubicBezier(easeT, startX, cp1X, cp2X, targetX);
        let y = cubicBezier(easeT, startY, cp1Y, cp2Y, targetY);

        // 添加微小的随机抖动
        if (i % 3 === 0) { x += random(-1, 1); y += random(-1, 1); }
        await page.mouse.move(x, y);
    }
}

/**
 * 安全点击元素（包含拟人化移动和点击）
 * @param {object} page Puppeteer 页面对象
 * @param {string} selector CSS 选择器
 */
async function safeClick(page, selector) {
    try {
        const el = await page.$(selector);
        if (!el) throw new Error(`未找到: ${selector}`);
        const box = await el.boundingBox();
        if (!box) throw new Error(`不可见: ${selector}`);

        // 先稍微移动一下当前位置 (增加真实感)
        await page.mouse.move(box.x - random(50, 100), box.y - random(50, 100), { steps: 2 });

        // 目标点击位置在元素内部随机区域
        const targetX = box.x + box.width * random(0.3, 0.7);
        const targetY = box.y + box.height * random(0.3, 0.7);

        // 移动鼠标到目标位置
        await humanMove(page, box.x - 50, box.y - 50, targetX, targetY);

        // 模拟点击过程：按下 -> 停顿 -> 抬起
        await sleep(100, 300);
        await page.mouse.down();
        await sleep(60, 120);
        await page.mouse.up();
    } catch (err) {
        throw err;
    }
}

/**
 * 模拟人类键盘输入
 * @param {object} page Puppeteer 页面对象
 * @param {string} selector 输入框选择器
 * @param {string} text 要输入的文本
 */
async function humanType(page, selector, text) {
    const el = await page.$(selector);
    if (!el) throw new Error(`Element not found: ${selector}`);

    // 智能输入策略
    if (text.length < 50) {
        // 短文本：保持拟人化逐字输入
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            // 模拟错字 (5% 概率)
            if (Math.random() < 0.05) {
                await el.type('x', { delay: random(50, 150) });
                await sleep(100, 300);
                await page.keyboard.press('Backspace', { delay: random(50, 100) });
            }
            await el.type(char);
            // 随机击键间隔
            await sleep(30, 100);
        }
    } else {
        // 长文本：假装打字 -> 停顿 -> 粘贴
        const fakeCount = Math.floor(random(3, 8));
        const fakeText = text.substring(0, fakeCount);

        // 1. 假装打字几个字符
        for (let i = 0; i < fakeText.length; i++) {
            await el.type(fakeText[i], { delay: random(30, 100) });
        }

        // 2. 停顿思考 (0.5 - 1秒)
        await sleep(500, 1000);

        // 3. 全选删除 (模拟 Ctrl+A -> Backspace)
        await page.keyboard.down('Control');
        await page.keyboard.press('A');
        await page.keyboard.up('Control');
        await sleep(100, 300);
        await page.keyboard.press('Backspace');
        await sleep(100, 300);

        // 4. 瞬间粘贴全部文本 (模拟 Ctrl+V)
        await page.evaluate((sel, content) => {
            const input = document.querySelector(sel);
            input.focus();
            document.execCommand('insertText', false, content);
        }, selector, text);
    }
}

/**
 * 粘贴图片到输入框
 * @param {object} page Puppeteer 页面对象
 * @param {string} selector 输入框选择器
 * @param {string[]} filePaths 图片文件路径数组
 */
async function pasteImages(page, selector, filePaths) {
    if (!filePaths || filePaths.length === 0) return;
    console.log(`>>> [粘贴] 上传 ${filePaths.length} 张图片...`);

    // 读取图片文件并转换为 Base64
    const filesData = filePaths.map(p => {
        const clean = p.replace(/['"]/g, '').trim();
        if (!fs.existsSync(clean)) return null;
        return {
            base64: fs.readFileSync(clean).toString('base64'),
            mime: getMimeType(clean),
            filename: path.basename(clean)
        };
    }).filter(f => f);

    if (filesData.length === 0) return;

    // 点击输入框以获取焦点
    await safeClick(page, selector);
    await sleep(500, 800);

    // 使用 Clipboard API 模拟粘贴事件
    await page.evaluate(async (sel, files) => {
        const target = document.querySelector(sel);
        const dt = new DataTransfer();
        for (const f of files) {
            const bin = atob(f.base64);
            const arr = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
            dt.items.add(new File([arr], f.filename, { type: f.mime }));
        }
        target.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: dt }));
    }, selector, filesData);

    console.log('>>> [粘贴] 完成，等待缩略图...');
    // 等待图片上传和缩略图生成
    await sleep(2500, 4000);
}

/**
 * 从响应文本中提取图片 URL
 * @param {string} text 响应文本
 * @returns {string|null} 图片 URL 或 null
 */
function extractImage(text) {
    if (!text) return null;
    const lines = text.split('\n');
    for (const line of lines) {
        if (line.startsWith('a2:')) {
            try {
                const data = JSON.parse(line.substring(3));
                if (data?.[0]?.image) return data[0].image;
            } catch (e) { }
        }
    }
    return null;
}
/**
 * 初始化浏览器
 * @param {object} config 配置对象 (包含 chrome 配置)
 * @returns {Promise<{browser: object, page: object, client: object, width: number, height: number}>}
 */
async function initBrowser(config) {
    console.log('>>> [Browser] 开始初始化浏览器');

    const chromeConfig = config?.chrome || {};
    const width = Math.floor(random(900, 1100));
    const height = Math.floor(random(500, 700));

    // 1. 基础参数
    const args = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        `--window-size=${width},${height}`,
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--test-type',
        '--no-zygote',
        '--disable-dev-shm-usage'
    ];

    // 2. Headless 模式配置
    let headlessMode = false;
    if (chromeConfig.headless) {
        headlessMode = 'new';
        args.push('--disable-gl-drawing-for-tests');
        console.log('>>> [Browser] Headless 模式: 启用');
    } else {
        console.log('>>> [Browser] Headless 模式: 禁用');
    }

    // 3. GPU 配置
    if (chromeConfig.gpu === false) {
        args.push(
            '--disable-gpu',
            '--use-gl=swiftshader',
            '--disable-accelerated-2d-canvas'
        );
        console.log('>>> [Browser] GPU 加速: 禁用 (优化兼容性)');
    } else {
        console.log('>>> [Browser] GPU 加速: 启用');
    }

    // 4. 代理配置
    let proxyUrlForChrome = null;
    if (chromeConfig.proxy && chromeConfig.proxy.enable) {
        const { type, host, port, user, passwd } = chromeConfig.proxy;

        // 特殊处理 SOCKS5 + Auth (Chrome 原生不支持)
        if (type === 'socks5' && user && passwd) {
            try {
                const upstreamUrl = `socks5://${user}:${passwd}@${host}:${port}`;
                console.log(`>>> [Browser] 检测到 SOCKS5 认证代理，正在创建本地桥接...`);
                // 创建本地中间代理 (无认证 -> 有认证)
                proxyUrlForChrome = await anonymizeProxy(upstreamUrl);
                console.log(`>>> [Browser] 本地桥接已建立: ${proxyUrlForChrome} -> ${host}:${port}`);

                args.push(`--proxy-server=${proxyUrlForChrome}`);
                args.push('--disable-quic');
            } catch (e) {
                console.error('>>> [Error] 代理桥接创建失败:', e);
                throw e;
            }
        } else {
            // 常规 HTTP 代理或无认证 SOCKS5
            const proxyUrl = type === 'socks5' ? `socks5://${host}:${port}` : `${host}:${port}`;
            args.push(`--proxy-server=${proxyUrl}`);
            args.push('--disable-quic');
            console.log(`>>> [Browser] 代理配置: ${type}://${host}:${port}`);
        }
    }

    const browser = await puppeteer.launch({
        headless: headlessMode,
        executablePath: chromeConfig.path || undefined,
        userDataDir: USER_DATA_DIR,
        defaultViewport: null,
        ignoreDefaultArgs: ['--enable-automation'],
        args: args
    });

    // 重用第一个标签页
    const pages = await browser.pages();
    const page = pages[0];

    // 5. 代理认证 (仅当未使用 proxy-chain 桥接时)
    if (chromeConfig.proxy && chromeConfig.proxy.enable && chromeConfig.proxy.user && !proxyUrlForChrome) {
        await page.authenticate({
            username: chromeConfig.proxy.user,
            password: chromeConfig.proxy.passwd
        });
        console.log('>>> [Browser] 代理认证: 已设置 (HTTP Basic Auth)');
    }

    // 隐藏 WebDriver 特征
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    // 创建 CDP 会话以监听网络请求
    const client = await page.target().createCDPSession();
    await client.send('Network.enable');

    // --- [行为预热] 建立人机检测信任 ---
    console.log('>>> [Browser] 正在连接 LMArena...');
    await page.goto(TARGET_URL, { waitUntil: 'networkidle2' });

    console.log('>>> [Warmup] 正在随机浏览页面以建立信任...');

    // 计算屏幕中心点
    const centerX = width / 2;
    const centerY = height / 2;

    // 第一次移动：从左上角移动到中心附近
    await humanMove(page, 0, 0, centerX + random(-200, 200), centerY + random(-200, 200));
    await sleep(500, 1000);

    // 模拟滚动行为
    try {
        await page.mouse.wheel({ deltaY: random(100, 300) });
        await sleep(800, 1500);
        await page.mouse.wheel({ deltaY: -random(50, 100) });
    } catch (e) { }

    // 等待输入框出现
    const textareaSelector = 'textarea';
    await page.waitForSelector(textareaSelector, { timeout: 60000 });

    // 移动鼠标到输入框
    const box = await (await page.$(textareaSelector)).boundingBox();
    if (box) {
        await humanMove(page, centerX, centerY, box.x + box.width / 2, box.y + box.height / 2);
        await sleep(500, 1000);
    }

    console.log('>>> [Browser] 浏览器初始化完成，系统就绪');

    // 注册清理钩子：浏览器关闭时关闭代理服务器
    if (proxyUrlForChrome) {
        browser.on('disconnected', async () => {
            console.log('>>> [Browser] 浏览器断开，正在清理代理桥接...');
            try {
                await closeAnonymizedProxy(proxyUrlForChrome, true);
            } catch (e) {
                console.error('>>> [Warn] 代理清理失败:', e.message);
            }
        });
    }

    return { browser, page, client, width, height };
}

/**
 * 执行生图任务
 * @param {object} context 浏览器上下文 {page, client, width, height}
 * @param {string} prompt 提示词
 * @param {string[]} imgPaths 图片路径数组
 * @param {string|null} modelId 模型 UUID (可选)
 * @returns {Promise<{image?: string, text?: string, error?: string}>}
 */
async function generateImage(context, prompt, imgPaths, modelId) {
    const { page, client, width, height } = context;
    const textareaSelector = 'textarea';
    let requestHandler = null;

    try {
        // 1. 强制开启新会话 (通过URL跳转)
        console.log('>>> [Task] 开启新会话...');
        await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded' });

        // 等待输入框出现
        await page.waitForSelector(textareaSelector, { timeout: 30000 });
        await sleep(1500, 2500); // 等页面稳一点

        // 2. 粘贴图片
        if (imgPaths && imgPaths.length > 0) {
            await pasteImages(page, textareaSelector, imgPaths);
            // 如果没有图片，也点击一下输入框获取焦点
            await safeClick(page, textareaSelector);
        }

        // 3. 输入 Prompt
        console.log('>>> [Input] 正在输入提示词...');
        await humanType(page, textareaSelector, prompt);
        await sleep(800, 1500);

        // --- 注入 Fetch 拦截器 (Puppeteer Request Interception) ---
        if (modelId) {
            await page.setRequestInterception(true);
            requestHandler = async (request) => {
                const url = request.url();
                if (url.includes('/nextjs-api/stream/') && request.method() === 'POST') {
                    try {
                        const postData = request.postData();
                        if (postData) {
                            const data = JSON.parse(postData);
                            console.log(`[Browser] 正在拦截请求。原始 modelAId: ${data.modelAId}`);

                            // 修改 modelAId
                            data.modelAId = modelId;
                            const newPostData = JSON.stringify(data);

                            console.log(`[Browser] 请求已修改。新 modelAId: ${data.modelAId}`);
                            await request.continue({ postData: newPostData });
                            return;
                        }
                    } catch (e) {
                        console.error('[Browser] 拦截修改失败:', e);
                    }
                }
                await request.continue();
            };
            page.on('request', requestHandler);
            console.log(`>>> [Test] 已启用请求拦截，目标模型: ${modelId}`);
        }

        // 4. 发送
        const btnSelector = 'button[type="submit"]';
        await safeClick(page, btnSelector);

        console.log('>>> [Wait] 等待生成中...');

        // 5. 监听网络响应
        let targetRequestId = null;
        const result = await new Promise((resolve) => {
            const cleanup = () => {
                client.off('Network.responseReceived', onRes);
                client.off('Network.loadingFinished', onLoad);
            };
            const onRes = (e) => {
                // 监听流式响应接口
                if (e.response.url.includes('/nextjs-api/stream/')) targetRequestId = e.requestId;
            };
            const onLoad = async (e) => {
                if (e.requestId === targetRequestId) {
                    try {
                        const { body, base64Encoded } = await client.send('Network.getResponseBody', { requestId: targetRequestId });
                        const content = base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body;

                        // 检查是否包含 reCAPTCHA 错误
                        if (content.includes('recaptcha validation failed')) {
                            cleanup();
                            resolve({ error: 'recaptcha validation failed' });
                            return;
                        }

                        const img = extractImage(content);
                        if (img) {
                            console.log('>>> [Success] 生图成功');
                            cleanup();
                            resolve({ image: img });
                        } else {
                            console.log('>>> [Task] AI 返回文本回复:', content.substring(0, 150) + '...');
                            cleanup();
                            resolve({ text: content });
                        }
                    } catch (err) {
                        cleanup();
                        resolve({ error: err.message });
                    }
                }
            };
            client.on('Network.responseReceived', onRes);
            client.on('Network.loadingFinished', onLoad);

            // 超时保护 (120秒)
            setTimeout(() => {
                cleanup();
                resolve({ error: 'Timeout' });
            }, 120000);
        });

        // 任务结束，像人一样把鼠标移开，防止遮挡或误触
        await humanMove(page, width / 2, height / 2, width - 100, height / 2);

        return result;

    } catch (err) {
        console.error('>>> [Error] 生成任务失败:', err.message);
        return { error: err.message };
    } finally {
        if (requestHandler) {
            page.off('request', requestHandler);
            try {
                await page.setRequestInterception(false);
            } catch (e) { }
        }
    }
}

export { initBrowser, generateImage, TEMP_DIR };
