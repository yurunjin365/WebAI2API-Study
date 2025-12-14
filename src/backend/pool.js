/**
 * @fileoverview Worker Pool 管理模块
 * @description 实现 Worker 类和 PoolManager 类，负责多浏览器实例的生命周期管理和任务分发。
 *              使用 AdapterRegistry 动态加载适配器，无需硬编码适配器列表。
 *
 * 对外接口：
 * - PoolManager.initAll() - 初始化所有 Worker
 * - PoolManager.selectWorker(modelId) - 智能选择 Worker
 * - PoolManager.generateImage(ctx, prompt, paths, modelId, meta) - 分发生图任务
 * - PoolManager.getModels() / resolveModelId() / getImagePolicy() - 模型相关
 * - PoolManager.getCookies(instanceName, domain) - 获取指定实例的 Cookies
 */

import fs from 'fs';
import { logger } from '../utils/logger.js';
import { initBrowserBase, createCursor, getRealViewport, clamp, random, sleep } from '../browser/launcher.js';
import { registry } from './registry.js';

/**
 * Worker 类 - 封装单个浏览器实例
 */
class Worker {
    /**
     * @param {object} globalConfig - 全局配置
     * @param {object} workerConfig - Worker 配置
     */
    constructor(globalConfig, workerConfig) {
        this.name = workerConfig.name;
        this.type = workerConfig.type;
        this.instanceName = workerConfig.instanceName || null;
        this.userDataDir = workerConfig.userDataDir;
        this.proxyConfig = workerConfig.resolvedProxy;
        this.globalConfig = globalConfig;
        this.workerConfig = workerConfig;

        // Merge 模式专属
        this.mergeTypes = workerConfig.mergeTypes || [];
        this.mergeMonitor = workerConfig.mergeMonitor || null;

        // 运行时状态
        this.browser = null;
        this.page = null;
        this.busyCount = 0;
        this.initialized = false;
    }

    /**
     * 初始化浏览器实例
     * @param {object} [sharedBrowser] - 可选，共享的浏览器实例
     */
    async init(sharedBrowser = null) {
        if (this.initialized) return;

        // 确保用户数据目录存在
        if (!fs.existsSync(this.userDataDir)) {
            fs.mkdirSync(this.userDataDir, { recursive: true });
        }

        const productName = this.type === 'merge'
            ? `聚合模式 [${this.name}]`
            : `${this.type} [${this.name}]`;

        // 获取目标 URL (从 AdapterRegistry 动态获取)
        let targetUrl = 'about:blank';
        if (this.type === 'merge') {
            // Merge 模式：使用第一个 mergeType 的 URL
            const firstType = this.mergeTypes[0];
            targetUrl = registry.getTargetUrl(firstType, this.globalConfig, this.workerConfig) || 'about:blank';
        } else {
            targetUrl = registry.getTargetUrl(this.type, this.globalConfig, this.workerConfig) || 'about:blank';
        }

        // 收集导航处理器 (从 AdapterRegistry 动态获取)
        const handlers = [];
        const typesToHandle = this.type === 'merge' ? this.mergeTypes : [this.type];
        for (const type of typesToHandle) {
            const typeHandlers = registry.getNavigationHandlers(type);
            handlers.push(...typeHandlers);
        }

        // 聚合导航处理器
        const navigationHandler = handlers.length > 0
            ? async (page) => {
                for (const handler of handlers) {
                    try { await handler(page); } catch (e) { /* ignore */ }
                }
            }
            : null;

        // 获取 waitInputValidator (从 AdapterRegistry 动态获取)
        let waitInputValidator = null;
        if (this.type !== 'merge') {
            waitInputValidator = registry.getWaitInput(this.type);
        }

        logger.info('工作池', `[${this.name}] 正在初始化浏览器...`);
        if (this.proxyConfig) {
            logger.debug('工作池', `[${this.name}] 使用代理: ${this.proxyConfig.type}://${this.proxyConfig.host}:${this.proxyConfig.port}`);
        } else {
            logger.debug('工作池', `[${this.name}] 直连模式（无代理）`);
        }

        // 如果有共享浏览器，创建新标签页；否则启动新浏览器
        if (sharedBrowser) {
            logger.info('工作池', `[${this.name}] 复用已有浏览器，创建新标签页...`);
            this.browser = sharedBrowser;
            // sharedBrowser 实际是 BrowserContext（Camoufox 使用 launchPersistentContext）
            this.page = await sharedBrowser.newPage();

            // 初始化 ghost-cursor
            this.page.cursor = createCursor(this.page);

            // 导航到目标 URL
            await this.page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

            // 注册导航处理器
            if (navigationHandler) {
                this.page.on('framenavigated', async () => {
                    try { await navigationHandler(this.page); } catch (e) { /* ignore */ }
                });
            }

            // 随机浏览以建立信任
            logger.info('工作池', `[${this.name}] 正在随机浏览页面以建立信任...`);
            const vp = await getRealViewport(this.page);
            const centerX = vp.width / 2;
            const centerY = vp.height / 2;
            if (this.page.cursor) {
                const targetX = clamp(centerX + random(-200, 200), 10, vp.safeWidth);
                const targetY = clamp(centerY + random(-200, 200), 10, vp.safeHeight);
                await this.page.cursor.moveTo({ x: targetX, y: targetY });
            }
            await sleep(500, 1000);
            try {
                await this.page.mouse.wheel({ deltaY: random(100, 300) });
                await sleep(800, 1500);
                await this.page.mouse.wheel({ deltaY: -random(50, 100) });
            } catch (e) { }

            // 等待输入框就绪
            if (waitInputValidator) {
                await waitInputValidator(this.page);
            }

            logger.info('工作池', `[${this.name}] 初始化完成`);
        } else {
            // 启动新浏览器实例
            const base = await initBrowserBase(this.globalConfig, {
                userDataDir: this.userDataDir,
                instanceName: this.instanceName,
                proxyConfig: this.proxyConfig
            });

            this.browser = base.context;
            this.page = base.page;

            // 初始化 ghost-cursor
            this.page.cursor = createCursor(this.page);

            // 注册导航处理器
            if (navigationHandler) {
                this.page.on('framenavigated', async () => {
                    try { await navigationHandler(this.page); } catch (e) { /* ignore */ }
                });
            }

            // 导航到目标 URL
            logger.info('工作池', `[${this.name}] 正在连接目标页面...`);
            await this.page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

            // 登录模式：挂起等待用户手动登录
            const isLoginMode = process.argv.some(arg => arg.startsWith('-login'));
            if (isLoginMode) {
                logger.info('工作池', `[${this.name}] 登录模式已就绪，请在浏览器中完成登录`);
                logger.info('工作池', `[${this.name}] 完成后可直接关闭浏览器窗口或按 Ctrl+C 退出`);
                await new Promise(resolve => this.browser.on('close', resolve));
                process.exit(0);
            }

            // 预热行为
            logger.info('工作池', `[${this.name}] 正在执行预热操作...`);
            const vp = await getRealViewport(this.page);
            const centerX = vp.width / 2;
            const centerY = vp.height / 2;
            if (this.page.cursor) {
                const targetX = clamp(centerX + random(-200, 200), 10, vp.safeWidth);
                const targetY = clamp(centerY + random(-200, 200), 10, vp.safeHeight);
                await this.page.cursor.moveTo({ x: targetX, y: targetY });
            }
            await sleep(500, 1000);
            try {
                await this.page.mouse.wheel({ deltaY: random(100, 300) });
                await sleep(800, 1500);
                await this.page.mouse.wheel({ deltaY: -random(50, 100) });
            } catch (e) { }

            // 等待输入框就绪
            if (waitInputValidator) {
                await waitInputValidator(this.page);
            }

            logger.info('工作池', `[${this.name}] 初始化完成`);
        }

        this.initialized = true;
    }

    /**
     * 检查是否支持指定模型
     * @param {string} modelId - 模型 ID 或 key
     * @returns {boolean}
     */
    supports(modelId) {
        if (this.type === 'merge') {
            // Merge 模式：检查所有 mergeTypes
            for (const type of this.mergeTypes) {
                const resolved = registry.resolveModelId(type, modelId);
                if (resolved) return true;
            }
            // 检查 backend/model 格式
            if (modelId.includes('/')) {
                const [specifiedType] = modelId.split('/', 2);
                return this.mergeTypes.includes(specifiedType);
            }
            return false;
        } else {
            // 单一类型：支持 type/model 格式
            if (modelId.includes('/')) {
                const [specifiedType, actualModel] = modelId.split('/', 2);
                if (specifiedType === this.type) {
                    const resolved = registry.resolveModelId(this.type, actualModel);
                    return !!resolved;
                }
                return false;
            }
            const resolved = registry.resolveModelId(this.type, modelId);
            return !!resolved;
        }
    }

    /**
     * 解析模型 ID
     * @param {string} modelKey - 模型 key
     * @returns {{type: string, realId: string}|null}
     */
    resolveModelId(modelKey) {
        if (this.type === 'merge') {
            // 支持 backend/model 格式
            if (modelKey.includes('/')) {
                const [specifiedType, actualModel] = modelKey.split('/', 2);
                if (this.mergeTypes.includes(specifiedType)) {
                    const realId = registry.resolveModelId(specifiedType, actualModel);
                    if (realId) return { type: specifiedType, realId };
                }
                return null;
            }
            // 按优先级匹配
            for (const type of this.mergeTypes) {
                const realId = registry.resolveModelId(type, modelKey);
                if (realId) return { type, realId };
            }
            return null;
        } else {
            // 单一类型：支持 type/model 格式
            if (modelKey.includes('/')) {
                const [specifiedType, actualModel] = modelKey.split('/', 2);
                if (specifiedType === this.type) {
                    const realId = registry.resolveModelId(this.type, actualModel);
                    return realId ? { type: this.type, realId } : null;
                }
                return null;
            }
            const realId = registry.resolveModelId(this.type, modelKey);
            return realId ? { type: this.type, realId } : null;
        }
    }

    /**
     * 生成图片
     * @param {object} ctx - 浏览器上下文
     * @param {string} prompt - 提示词
     * @param {string[]} paths - 图片路径
     * @param {string} modelId - 模型 ID
     * @param {object} meta - 元信息
     */
    async generateImage(ctx, prompt, paths, modelId, meta) {
        const resolved = this.resolveModelId(modelId);
        if (!resolved) {
            return { error: `Worker [${this.name}] 不支持模型: ${modelId}` };
        }

        const { type, realId } = resolved;
        const adapter = registry.getAdapter(type);
        if (!adapter) {
            return { error: `适配器不存在: ${type}` };
        }

        logger.info('工作池', `[${this.name}] 执行任务 -> ${type}/${realId}`, meta);

        // 构造子上下文
        const subContext = {
            ...ctx,
            page: this.page,
            config: this.globalConfig,
            proxyConfig: this.proxyConfig,
            userDataDir: this.userDataDir
        };

        this.busyCount++;
        try {
            return await adapter.generateImage(subContext, prompt, paths, realId, meta);
        } finally {
            this.busyCount--;
        }
    }

    /**
     * 获取支持的模型列表
     * @returns {object[]}
     */
    getModels() {
        if (this.type === 'merge') {
            const allModels = [];
            const seenIds = new Set();

            // 添加不带前缀的模型 (由系统自动分配适配器)
            for (const type of this.mergeTypes) {
                const result = registry.getModelsForAdapter(type);
                if (result?.data) {
                    for (const m of result.data) {
                        if (!seenIds.has(m.id)) {
                            seenIds.add(m.id);
                            allModels.push({ ...m, owned_by: 'internal_server' });
                        }
                    }
                }
            }

            // 添加带前缀的模型 (指定使用特定适配器)
            for (const type of this.mergeTypes) {
                const result = registry.getModelsForAdapter(type);
                if (result?.data) {
                    for (const m of result.data) {
                        allModels.push({
                            ...m,
                            id: `${type}/${m.id}`,
                            owned_by: type
                        });
                    }
                }
            }

            return allModels;
        } else {
            // 单一类型：返回不带前缀和带前缀的模型
            const result = registry.getModelsForAdapter(this.type);
            const models = result?.data || [];
            const allModels = [];

            // 不带前缀的模型 (系统自动分配)
            for (const m of models) {
                allModels.push({ ...m, owned_by: 'internal_server' });
            }

            // 带前缀的模型 (指定适配器)
            for (const m of models) {
                allModels.push({
                    ...m,
                    id: `${this.type}/${m.id}`,
                    owned_by: this.type
                });
            }

            return allModels;
        }
    }

    /**
     * 获取图片策略
     * @param {string} modelKey - 模型 key
     * @returns {string}
     */
    getImagePolicy(modelKey) {
        if (this.type === 'merge') {
            if (modelKey.includes('/')) {
                const [specifiedType, actualModel] = modelKey.split('/', 2);
                if (this.mergeTypes.includes(specifiedType)) {
                    return registry.getImagePolicy(specifiedType, actualModel);
                }
            }
            for (const type of this.mergeTypes) {
                const realId = registry.resolveModelId(type, modelKey);
                if (realId) return registry.getImagePolicy(type, modelKey);
            }
            return 'optional';
        } else {
            return registry.getImagePolicy(this.type, modelKey);
        }
    }

    /**
     * 导航到监控页面（空闲时）
     */
    async navigateToMonitor() {
        if (this.type !== 'merge' || !this.mergeMonitor) return;
        if (!this.page || this.page.isClosed()) return;

        const targetUrl = registry.getTargetUrl(this.mergeMonitor, this.globalConfig, this.workerConfig);
        if (!targetUrl) return;

        // 检查是否已在目标网站
        const currentUrl = this.page.url();
        try {
            if (currentUrl.includes(new URL(targetUrl).hostname)) return;
        } catch (e) { return; }

        logger.info('工作池', `[${this.name}] 空闲，跳转监控: ${this.mergeMonitor}`);
        try {
            await this.page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        } catch (e) {
            logger.warn('工作池', `[${this.name}] 监控跳转失败: ${e.message}`);
        }
    }

    /**
     * 获取 Cookies
     * @param {string} [domain] - 指定域名
     * @returns {Promise<object[]>}
     */
    async getCookies(domain) {
        if (!this.page) throw new Error(`Worker [${this.name}] 未初始化`);
        const context = this.page.context();
        if (domain) {
            return await context.cookies(domain.startsWith('http') ? domain : `https://${domain}`);
        }
        return await context.cookies();
    }
}

/**
 * PoolManager 类 - 管理 Worker 池
 */
class PoolManager {
    /**
     * @param {object} config - 全局配置
     */
    constructor(config) {
        this.config = config;
        this.workers = [];
        this.strategy = config.backend.pool.strategy || 'least_busy';
        this.roundRobinIndex = 0;
        this.initialized = false;
    }

    /**
     * 初始化所有 Worker
     */
    async initAll() {
        if (this.initialized) return;

        // 先加载所有适配器
        await registry.loadAll();

        // 解析登录模式参数：-login 或 -login=workerName
        let loginWorkerName = null;
        const loginArg = process.argv.find(arg => arg.startsWith('-login'));
        const isLoginMode = !!loginArg;
        if (loginArg && loginArg.includes('=')) {
            loginWorkerName = loginArg.split('=')[1];
            logger.info('工作池', `登录模式: 仅初始化 Worker "${loginWorkerName}"`);
        } else if (isLoginMode) {
            // -login 不带参数：使用第一个 Worker
            loginWorkerName = this.config.backend.pool.workers[0]?.name || null;
            logger.info('工作池', `登录模式: 仅初始化第一个 Worker "${loginWorkerName}"`);
        }

        const workerConfigs = this.config.backend.pool.workers;

        // 登录模式下只显示初始化 1 个
        if (isLoginMode) {
            logger.info('工作池', `登录模式: 从 ${workerConfigs.length} 个 Worker 中筛选...`);
        } else {
            logger.info('工作池', `正在初始化 ${workerConfigs.length} 个 Worker...`);
        }

        // 过滤并创建 Worker 实例
        const validWorkers = [];
        for (const workerConfig of workerConfigs) {
            // 登录模式过滤：只初始化指定名称的 Worker
            if (isLoginMode && workerConfig.name !== loginWorkerName) {
                logger.debug('工作池', `[${workerConfig.name}] 跳过 (不匹配登录目标)`);
                continue;
            }

            // 校验 Worker 类型是否有对应的适配器
            if (workerConfig.type !== 'merge' && !registry.hasAdapter(workerConfig.type)) {
                logger.error('工作池', `Worker [${workerConfig.name}] 的类型 "${workerConfig.type}" 无对应适配器，跳过`);
                continue;
            }

            // Merge 模式：校验所有 mergeTypes
            if (workerConfig.type === 'merge') {
                const invalidTypes = (workerConfig.mergeTypes || []).filter(t => !registry.hasAdapter(t));
                if (invalidTypes.length > 0) {
                    logger.error('工作池', `Worker [${workerConfig.name}] 的 mergeTypes 包含无效类型: ${invalidTypes.join(', ')}`);
                    continue;
                }
            }

            validWorkers.push(new Worker(this.config, workerConfig));
        }

        // 登录模式下如果没有匹配的 Worker
        if (isLoginMode && validWorkers.length === 0) {
            // 列出可用的 Worker 名称
            const availableNames = workerConfigs.map(w => w.name).join(', ');
            throw new Error(`登录模式未找到 Worker "${loginWorkerName}"。可用的 Worker: ${availableNames}`);
        }

        // 按 userDataDir 分组
        const browserMap = new Map();  // userDataDir -> { browser, proxyConfig, firstWorkerName }

        for (const worker of validWorkers) {
            const existing = browserMap.get(worker.userDataDir);

            if (existing) {
                // 复用已有浏览器 - 检测代理配置冲突
                const workerProxy = JSON.stringify(worker.proxyConfig || null);
                const existingProxy = JSON.stringify(existing.proxyConfig || null);
                if (workerProxy !== existingProxy) {
                    logger.warn('工作池', `[${worker.name}] 代理配置与 [${existing.firstWorkerName}] 不一致，将使用后者的配置`);
                }

                logger.debug('工作池', `[${worker.name}] 将与其他 Worker 共享浏览器 (${worker.userDataDir})`);
                await worker.init(existing.browser);
            } else {
                // 启动新浏览器
                await worker.init();
                browserMap.set(worker.userDataDir, {
                    browser: worker.browser,
                    proxyConfig: worker.proxyConfig,
                    firstWorkerName: worker.name
                });
            }

            this.workers.push(worker);
        }

        this.initialized = true;
        logger.info('工作池', `工作池初始化完成，共 ${this.workers.length} 个 Worker 就绪 (${browserMap.size} 个浏览器实例)`);
    }

    /**
     * 根据模型选择 Worker
     * @param {string} modelId - 模型 ID
     * @returns {Worker}
     */
    selectWorker(modelId) {
        // 1. 筛选：找出所有支持该模型的 Worker
        const candidates = this.workers.filter(w => w.supports(modelId));

        if (candidates.length === 0) {
            throw new Error(`没有 Worker 支持模型: ${modelId}`);
        }

        if (candidates.length === 1) {
            return candidates[0];
        }

        // 2. 决策：根据策略选择
        switch (this.strategy) {
            case 'round_robin': {
                const idx = this.roundRobinIndex % candidates.length;
                this.roundRobinIndex++;
                return candidates[idx];
            }
            case 'random': {
                const idx = Math.floor(Math.random() * candidates.length);
                return candidates[idx];
            }
            case 'least_busy':
            default: {
                return candidates.reduce((min, w) => w.busyCount < min.busyCount ? w : min, candidates[0]);
            }
        }
    }

    /**
     * 分发生图任务
     */
    async generateImage(ctx, prompt, paths, modelId, meta) {
        const worker = this.selectWorker(modelId);
        logger.debug('工作池', `任务分发至: ${worker.name} (busy: ${worker.busyCount})`);
        return await worker.generateImage(ctx, prompt, paths, modelId, meta);
    }

    /**
     * 解析模型 ID（用于请求前校验）
     * @param {string} modelKey - 模型 key
     * @returns {string|null} 返回 workerName|type|realId 格式，或 null
     */
    resolveModelId(modelKey) {
        for (const worker of this.workers) {
            const resolved = worker.resolveModelId(modelKey);
            if (resolved) {
                return `${worker.name}|${resolved.type}|${resolved.realId}`;
            }
        }
        return null;
    }

    /**
     * 获取所有模型列表（聚合去重）
     * @returns {object}
     */
    getModels() {
        const allModels = [];
        const seenIds = new Set();

        for (const worker of this.workers) {
            const models = worker.getModels();
            for (const m of models) {
                if (!seenIds.has(m.id)) {
                    seenIds.add(m.id);
                    allModels.push(m);
                }
            }
        }

        return { object: 'list', data: allModels };
    }

    /**
     * 获取图片策略
     * @param {string} modelKey - 模型 key
     * @returns {string}
     */
    getImagePolicy(modelKey) {
        for (const worker of this.workers) {
            if (worker.supports(modelKey)) {
                return worker.getImagePolicy(modelKey);
            }
        }
        return 'optional';
    }

    /**
     * 获取指定实例的 Cookies
     * @param {string} [instanceName] - 实例名称，不提供则返回第一个
     * @param {string} [domain] - 指定域名
     * @returns {Promise<{instance: string, cookies: object[]}>}
     */
    async getCookies(instanceName, domain) {
        let worker;
        if (instanceName) {
            worker = this.workers.find(w => w.instanceName === instanceName);
            if (!worker) {
                throw new Error(`浏览器实例不存在: ${instanceName}`);
            }
        } else {
            worker = this.workers[0];
            if (!worker) {
                throw new Error('工作池中没有可用的 Worker');
            }
        }

        const cookies = await worker.getCookies(domain);
        return { instance: worker.instanceName, cookies };
    }

    /**
     * 触发所有 merge Worker 的监控导航
     */
    async navigateToMonitor() {
        for (const worker of this.workers) {
            if (worker.type === 'merge' && worker.busyCount === 0) {
                await worker.navigateToMonitor();
            }
        }
    }

    /**
     * 获取第一个 Worker 的 page（兼容旧接口）
     * @returns {object|null}
     */
    getFirstPage() {
        return this.workers[0]?.page || null;
    }
}

export { Worker, PoolManager };
