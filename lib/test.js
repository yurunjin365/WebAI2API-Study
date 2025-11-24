import readline from 'readline';
import config from './config.js';
import { initBrowser, generateImage } from './lmarena.js';
import { MODEL_MAPPING } from './models.js';

/**
 * 创建命令行交互接口
 */
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

/**
 * 封装 readline 为 Promise
 * @param {string} query 提示问题
 * @returns {Promise<string>} 用户输入
 */
const ask = (query) => new Promise((resolve) => rl.question(query, resolve));

async function main() {
    console.log('>>> [CLI] LMArena CLI 测试工具');
    console.log('>>> [CLI] 正在启动浏览器...');

    let browserContext;
    try {
        // 传入配置对象
        browserContext = await initBrowser(config);
        console.log('>>> [CLI] 浏览器已就绪。');
    } catch (err) {
        console.error('>>> [Error] 浏览器启动失败:', err);
        process.exit(1);
    }

    while (true) {
        console.log('-----------------------------');

        // 1. 获取图片路径
        const imgInput = await ask('>>> [CLI] 请输入图片路径 (多张用逗号隔开，回车跳过): ');
        const imagePaths = imgInput.trim()
            ? imgInput.split(',').map(p => p.trim()).filter(p => p)
            : [];

        // 2. 获取提示词
        const prompt = await ask('>>> [CLI] 请输入提示词: ');
        if (!prompt.trim()) {
            console.log('>>> [Error] 提示词不能为空，请重试。');
            continue;
        }

        // 3. 获取模型 ID
        const modelInput = await ask('>>> [CLI] 请输入模型 ID (回车跳过使用默认): ');
        const modelName = modelInput.trim();
        let modelId = null;

        if (modelName) {
            if (MODEL_MAPPING[modelName]) {
                modelId = MODEL_MAPPING[modelName];
                console.log(`>>> [CLI] 使用模型: ${modelName} (${modelId})`);
            } else {
                console.log(`>>> [Warn] 未找到模型 "${modelName}"，将尝试直接使用默认模型。`);
            }
        } else {
            console.log('>>> [CLI] 未指定模型，使用默认值。');
        }

        console.log(`>>> [CLI] 开始任务: Prompt="${prompt}", Images=${imagePaths.length}`);

        // 4. 调用生图逻辑
        const result = await generateImage(browserContext, prompt, imagePaths, modelId);

        // 5. 显示结果
        if (result.error) {
            console.error('>>> [Error]', result.error);
        } else if (result.image) {
            console.log('>>> [Success] 图片 URL:', result.image);
        } else {
            console.log('>>> [CLI] AI 使用文本回复:', result.text);
        }
    }
}

main();