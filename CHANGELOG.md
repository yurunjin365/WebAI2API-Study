# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
## [1.1.1] - 2024-11-24

### Fixed
- **指定模型**
  - 修复因错误的UUID映射导致的 gemini-3-pro-image-preview 模型触发HTTP500的 BUG


## [1.1.0] - 2024-11-24

### Added
- **模型选择功能**：新增 `model` 参数支持，允许用户指定使用的图像生成模型
  - 支持 23+ 种模型，包括 Seedream、Gemini、Imagen、DALL-E 等
  - 新增 `/v1/models` API 端点，用于查询可用模型列表
  - 模型映射配置文件 `lib/models.js`，便于维护和扩展
  - 在浏览器页面注入拦截脚本，动态修改请求体中的 `modelAId`

- **CLI 测试工具增强**：`lib/test.js` 新增交互式模型选择
  - 支持在命令行中输入模型名称
  - 回车跳过则使用默认模型

- **API 接口更新**：
  - OpenAI 兼容模式 (`/v1/chat/completions`) 现在支持 `model` 参数
  - Queue 队列模式 (`/v1/queue/join`) 现在支持 `model` 参数
  - 未指定 `model` 时，使用 LMArena 网页默认模型

---

## [1.0.1] - 2024-11-23

### Fixed
- **浏览器代理**
  - 修复需要鉴权的Socks5代理无法连接

---

## [1.0.0] - 2024-11-23

### Added
- **初始版本发布**
  - 基于 Puppeteer 的自动化图像生成功能
  - 支持两种运行模式：
    - OpenAI 兼容模式
    - Queue 队列模式（SSE）
  - 拟人化操作特性：
    - 贝塞尔曲线鼠标移动
    - 智能键盘输入模拟
    - 随机延迟和抖动
  - 多图上传支持（最多 5 张）
  - Bearer Token 认证
  - 代理支持（HTTP 和 SOCKS5）
  - CLI 测试工具
  - 完整的配置文件系统