/**
 * @fileoverview 全局常量管理
 * @description 集中管理超时时间、选择器等常量，便于统一配置和维护
 */

// ==========================================
// 超时时间常量 (毫秒)
// ==========================================

/**
 * 超时时间配置
 * @readonly
 */
export const TIMEOUTS = {
    /** 导航超时（页面跳转） */
    NAVIGATION: 30000,

    /** 导航超时（扩展，带重试场景） */
    NAVIGATION_EXTENDED: 60000,

    /** 输入框等待超时 */
    INPUT_WAIT: 10000,

    /** API 响应超时（图片生成） */
    API_RESPONSE: 120000,

    /** 上传确认超时 */
    UPLOAD_CONFIRM: 60000,

    /** OAuth 登录流程超时 */
    OAUTH_FLOW: 60000,

    /** 心跳间隔 */
    HEARTBEAT_INTERVAL: 3000,

    /** 轮询间隔（waitForInput 等） */
    POLL_INTERVAL: 500,
};

// ==========================================
// 重试配置
// ==========================================

/**
 * 重试配置
 * @readonly
 */
export const RETRY = {
    /** 适配器默认最大重试次数 */
    MAX_ATTEMPTS: 2,

    /** 重试间隔基数（毫秒） */
    BASE_DELAY: 1000,

    /** 可重试的错误类型 */
    RETRYABLE_ERRORS: [
        'NETWORK_ERROR',
        'TIMEOUT_ERROR',
        'PAGE_CRASHED',
    ],
};

// ==========================================
// 错误码（适配器层，与 server/errors.js 互补）
// ==========================================

/**
 * 适配器错误码
 * @readonly
 */
export const ADAPTER_ERRORS = {
    /** 页面已关闭 */
    PAGE_CLOSED: 'PAGE_CLOSED',

    /** 页面崩溃 */
    PAGE_CRASHED: 'PAGE_CRASHED',

    /** 页面状态无效 */
    PAGE_INVALID: 'PAGE_INVALID',

    /** 网络错误 */
    NETWORK_ERROR: 'NETWORK_ERROR',

    /** 超时错误 */
    TIMEOUT_ERROR: 'TIMEOUT_ERROR',

    /** HTTP 错误 */
    HTTP_ERROR: 'HTTP_ERROR',

    /** 限流 */
    RATE_LIMITED: 'RATE_LIMITED',

    /** 需要验证码 */
    CAPTCHA_REQUIRED: 'CAPTCHA_REQUIRED',

    /** 需要登录 */
    AUTH_REQUIRED: 'AUTH_REQUIRED',

    /** 内容被阻止 (API/页面检测到错误关键词) */
    CONTENT_BLOCKED: 'CONTENT_BLOCKED',
};

// ==========================================
// 人机模拟配置
// ==========================================

/**
 * 人机模拟延迟配置（毫秒）
 * @readonly
 */
export const HUMAN_DELAYS = {
    /** 短延迟范围 */
    SHORT: { min: 500, max: 1000 },

    /** 中延迟范围 */
    MEDIUM: { min: 1000, max: 2000 },

    /** 长延迟范围（页面加载后） */
    LONG: { min: 1500, max: 2500 },

    /** 打字间隔 */
    TYPING: { min: 30, max: 100 },
};
