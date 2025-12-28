/**
 * @fileoverview DeepSeek 文本生成适配器
 */

import {
    sleep,
    safeClick
} from '../engine/utils.js';
import {
    fillPrompt,
    normalizePageError,
    moveMouseAway,
    waitForInput,
    gotoWithCheck
} from '../utils/index.js';
import { logger } from '../../utils/logger.js';

// --- 配置常量 ---
const TARGET_URL = 'https://chat.deepseek.com/';
const INPUT_SELECTOR = 'textarea';

/**
 * 切换功能按钮状态
 * @param {import('playwright-core').Page} page - 页面对象
 * @param {string} buttonName - 按钮名称 (DeepThink / Search)
 * @param {boolean} targetState - 目标状态 (true=开启, false=关闭)
 * @param {object} meta - 日志元数据
 * @returns {Promise<boolean>} 是否成功切换
 */
async function toggleButton(page, buttonName, targetState, meta = {}) {
    try {
        const btn = page.getByRole('button', { name: buttonName });
        const btnCount = await btn.count();
        if (btnCount === 0) {
            logger.debug('适配器', `未找到 ${buttonName} 按钮`, meta);
            return false;
        }

        // 获取当前状态 (检查 class 是否包含 ds-toggle-button--selected)
        const isSelected = await btn.evaluate(el => el.classList.contains('ds-toggle-button--selected'));

        if (isSelected !== targetState) {
            logger.info('适配器', `切换 ${buttonName}: ${isSelected} -> ${targetState}`, meta);
            await safeClick(page, btn, { bias: 'button' });
            await sleep(300, 500);
            return true;
        } else {
            logger.debug('适配器', `${buttonName} 已是目标状态: ${targetState}`, meta);
            return true;
        }
    } catch (e) {
        logger.warn('适配器', `切换 ${buttonName} 失败: ${e.message}`, meta);
        return false;
    }
}

/**
 * 配置模型功能 (thinking / search)
 * @param {import('playwright-core').Page} page - 页面对象
 * @param {object} modelConfig - 模型配置
 * @param {object} meta - 日志元数据
 */
async function configureModel(page, modelConfig, meta = {}) {
    const thinking = modelConfig?.thinking || false;
    const search = modelConfig?.search || false;

    // 切换 DeepThink 状态
    await toggleButton(page, 'DeepThink', thinking, meta);
    await sleep(200, 400);

    // 切换 Search 状态
    await toggleButton(page, 'Search', search, meta);
    await sleep(200, 400);
}

/**
 * 执行文本生成任务
 * @param {object} context - 浏览器上下文 { page, config }
 * @param {string} prompt - 提示词
 * @param {string[]} imgPaths - 图片路径数组 (此适配器不支持)
 * @param {string} [modelId] - 模型 ID
 * @param {object} [meta={}] - 日志元数据
 * @returns {Promise<{text?: string, error?: string}>}
 */
async function generate(context, prompt, imgPaths, modelId, meta = {}) {
    const { page } = context;

    try {
        logger.info('适配器', '开启新会话...', meta);
        await gotoWithCheck(page, TARGET_URL);

        // 1. 等待输入框加载
        await waitForInput(page, INPUT_SELECTOR, { click: false });
        await sleep(1500, 2500);

        // 2. 配置模型功能 (thinking / search)
        const modelConfig = manifest.models.find(m => m.id === modelId);
        if (modelConfig) {
            await configureModel(page, modelConfig, meta);
        }

        // 3. 填写提示词
        await safeClick(page, INPUT_SELECTOR, { bias: 'input' });
        await fillPrompt(page, INPUT_SELECTOR, prompt, meta);
        await sleep(500, 1000);

        // 4. 按回车发送
        logger.debug('适配器', '按回车发送...', meta);
        await page.keyboard.press('Enter');

        logger.info('适配器', '等待生成结果...', meta);

        // 5. 监听 chat/completion SSE 流，解析文本内容
        logger.info('适配器', '监听 SSE 流获取文本...', meta);

        let textContent = '';
        let isComplete = false;
        let responseFragmentIndex = -1;  // RESPONSE 类型 fragment 的数组索引
        let currentFragmentIndex = -1;   // 当前正在追加内容的 fragment 数组索引
        let fragmentCount = 0;           // fragments 数组的当前长度

        try {
            await page.waitForResponse(async (response) => {
                const url = response.url();
                if (!url.includes('chat/completion')) return false;
                if (response.request().method() !== 'POST') return false;
                if (response.status() !== 200) return false;

                try {
                    const body = await response.text();
                    const lines = body.split('\n');

                    for (const line of lines) {
                        // 跳过事件行和空行
                        if (line.startsWith('event:') || !line.startsWith('data:')) continue;

                        const dataStr = line.slice(5).trim();
                        if (!dataStr || dataStr === '{}') continue;

                        try {
                            const data = JSON.parse(dataStr);

                            // 初始响应中可能已有 fragments (如 SEARCH)
                            if (data.v?.response?.fragments && Array.isArray(data.v.response.fragments)) {
                                for (const fragment of data.v.response.fragments) {
                                    const idx = fragmentCount++;
                                    if (fragment.type === 'RESPONSE') {
                                        responseFragmentIndex = idx;
                                        currentFragmentIndex = idx;
                                        if (fragment.content) {
                                            textContent += fragment.content;
                                        }
                                    } else {
                                        currentFragmentIndex = idx;
                                    }
                                }
                            }

                            // 简单的文本追加 (只有 v 字符串，没有 p 和 o)
                            // 只有当前活跃的 fragment 是 RESPONSE 类型时才收集
                            if (data.v && typeof data.v === 'string' && !data.p && !data.o) {
                                if (currentFragmentIndex === responseFragmentIndex && responseFragmentIndex >= 0) {
                                    textContent += data.v;
                                }
                            }

                            // 带路径的 APPEND 操作 (如 response/fragments/1/content)
                            if (data.o === 'APPEND' && data.p && typeof data.v === 'string') {
                                const match = data.p.match(/response\/fragments\/(\d+)\/content/);
                                if (match) {
                                    const fragIdx = parseInt(match[1], 10);
                                    currentFragmentIndex = fragIdx;
                                    if (fragIdx === responseFragmentIndex) {
                                        textContent += data.v;
                                    }
                                }
                            }

                            // 不带操作符的路径设置 (如 {"v": "xxx", "p": "response/fragments/1/content"})
                            if (data.p && typeof data.v === 'string' && !data.o) {
                                const match = data.p.match(/response\/fragments\/(\d+)\/content/);
                                if (match) {
                                    const fragIdx = parseInt(match[1], 10);
                                    currentFragmentIndex = fragIdx;
                                    if (fragIdx === responseFragmentIndex) {
                                        textContent += data.v;
                                    }
                                }
                            }

                            // fragments APPEND - 新增 fragment (非 BATCH)
                            if (data.p === 'response/fragments' && data.o === 'APPEND' && Array.isArray(data.v)) {
                                for (const fragment of data.v) {
                                    const idx = fragmentCount++;
                                    if (fragment.type === 'RESPONSE') {
                                        responseFragmentIndex = idx;
                                        currentFragmentIndex = idx;
                                        if (fragment.content) {
                                            textContent += fragment.content;
                                        }
                                    } else {
                                        // THINK 或 SEARCH
                                        currentFragmentIndex = idx;
                                    }
                                }
                            }

                            // BATCH 操作中的 fragments
                            if (data.o === 'BATCH' && data.p === 'response' && Array.isArray(data.v)) {
                                for (const item of data.v) {
                                    // fragments 追加
                                    if (item.p === 'fragments' && item.o === 'APPEND' && Array.isArray(item.v)) {
                                        for (const fragment of item.v) {
                                            const idx = fragmentCount++;
                                            if (fragment.type === 'RESPONSE') {
                                                responseFragmentIndex = idx;
                                                currentFragmentIndex = idx;
                                                if (fragment.content) {
                                                    textContent += fragment.content;
                                                }
                                            } else {
                                                // THINK 或 SEARCH
                                                currentFragmentIndex = idx;
                                            }
                                        }
                                    }
                                    // 检查是否完成
                                    if (item.p === 'status' && item.v === 'FINISHED') {
                                        isComplete = true;
                                    }
                                }
                            }
                        } catch {
                            // 忽略解析错误
                        }
                    }

                    return isComplete;
                } catch {
                    return false;
                }
            }, { timeout: 180000 });
        } catch (e) {
            const pageError = normalizePageError(e, meta);
            if (pageError) return pageError;
            throw e;
        }

        if (!textContent || textContent.trim() === '') {
            logger.warn('适配器', '回复内容为空', meta);
            return { error: '回复内容为空' };
        }

        logger.info('适配器', `已获取文本内容 (${textContent.length} 字符)`, meta);
        logger.info('适配器', '文本生成完成，任务完成', meta);
        return { text: textContent.trim() };

    } catch (err) {
        // 顶层错误处理
        const pageError = normalizePageError(err, meta);
        if (pageError) return pageError;

        logger.error('适配器', '生成任务失败', { ...meta, error: err.message });
        return { error: `生成任务失败: ${err.message}` };
    } finally {
        // 任务结束，将鼠标移至安全区域
        await moveMouseAway(page);
    }
}

/**
 * 适配器 manifest
 */
export const manifest = {
    id: 'deepseek_text',
    displayName: 'DeepSeek (文本生成)',
    description: '使用 DeepSeek 官网生成文本，支持 DeepThink 深度思考和 Search 搜索模式。需要已登录的 DeepSeek 账户。',

    // 入口 URL
    getTargetUrl(config, workerConfig) {
        return TARGET_URL;
    },

    // 模型列表
    models: [
        { id: 'deepseek-v3.2', imagePolicy: 'forbidden' },
        { id: 'deepseek-v3.2-thinking', imagePolicy: 'forbidden', thinking: true },
        { id: 'deepseek-v3.2-search', imagePolicy: 'forbidden', search: true },
        { id: 'deepseek-v3.2-thinking-search', imagePolicy: 'forbidden', thinking: true, search: true },
    ],

    // 无需导航处理器
    navigationHandlers: [],

    // 核心文本生成方法
    generate
};
