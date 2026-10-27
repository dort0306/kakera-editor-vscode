# Kakera 编辑器规划与开发手册

更新：2026-10-27，基线为播放器 **v0.8.3**。编辑器仍是设计交付；本版已实际增加播放器远程帧级断点/状态 API，并将真实打包 CLI 改为依赖文件集。旧规划保存在 doc/archive/editor-v0.8.2。

AI 接口改为用户可配置的通用 Chat Completions 兼容 HTTP API，可连接自部署或远程服务，不再强制内置 Qwen3.8-27B。推荐先开发 **VS Code 插件 + 可视分镜工作台 + 可复用 Rust 工具**，不先分叉 Code-OSS；比较依据和后续独立壳条件见第 09 篇。

## 阅读顺序

| 文档 | 内容 |
| --- | --- |
| [01 产品与创作流程](01-product-workflows.zh-cn.md) | 一格一幕、舞台、分支、资源库和代码模式 |
| [02 架构、工程与编译](02-architecture-project-compiler.zh-cn.md) | 源码事实来源、往返、稳定 ID、事务和宿主边界 |
| [03 通用 AI API](03-ai-api.zh-cn.md) | 配置、凭据、能力探测、图像/流/结构输出和本地/远程服务 |
| [04 现有引擎 API](04-current-engine-api.zh-cn.md) | 当前 XML/JS、Rust、CLI、调试及预算 |
| [05 编辑器 API 设计](05-editor-api-proposal.zh-cn.md) | 仍待实现的编辑命令/提案/编译接口 |
| [06 调试与构建发布](06-debug-build-release.zh-cn.md) | 现有调试/发布如何接入及后续能力 |
| [07 路线与验收](07-roadmap-validation.zh-cn.md) | 实施阶段、验收标准和待测范围 |
| [08 依据与外部 API](08-references.zh-cn.md) | 仓库与官方接口资料、版本锁定 |
| [09 平台方案比较](09-editor-platform-comparison.zh-cn.md) | VS Code 插件、Code-OSS 分叉、独立编辑器优劣和结论 |
| [10 播放器调试 API](10-player-debug-api.zh-cn.md) | v0.8.3 已实现的认证、请求、命令、状态和限制 |
| [11 VS Code 插件落地方案](11-vscode-extension-implementation-plan.zh-cn.md) | 本仓库的模块、宿主接入、事务、调试、阶段任务与验收门禁 |

本仓库当前为编辑器设计资料仓库，尚无插件实现。项目状态与开发入口见 [根 README](../README.md)，协作约束见 [AGENTS](../AGENTS.md)。下文及原始手册中的部分源码、demo、版本验收与归档链接来自上游引擎工程，未随本仓库提供；不能视作已在本仓库验证的证据。

## 能力状态

- 已有：story 8/UI 3/save 8、KPAK 1/2、点九/图集/别名/标题，以及本版 loopback 调试 API、发布依赖选择和显式附加清单。
- 编辑器待实现：VSIX、可视分镜、资源管理、源码往返、AI API 客户端、提案/编译服务和 DAP 适配器。配置 API 的文档不是已实现的联网客户端。
- 播放器后续能力：条件断点、JS 行级调试、推送事件、通用 JSON 诊断、源码指纹及受控跨代次替换；当前 API 不开放任意状态注入。

## 核心原则

一格对应一个完整 XML frame，不是视频帧或隐式顺序剧情。XML/JS 是源文件事实来源，任意手写 JS 保留 Opaque 代码块；AI 输出结构化提案，由确定性编译器生成并验证代码。新幕创建一次稳定显式 ID，避免重打包随机 ID 改变存档契约。

编辑器、用户服务配置/密钥和原稿仍与 content 分离。v0.8.3 打包 CLI 自动收集实际运行依赖与约定许可证，额外普通文件只通过 kakera.package.json 的显式 include 加入；低层原始容器 API 仍可编码任意授权数据，不等于 CLI 发布策略。

调试 API 只在显式工程模式开启，发布模式拒绝；AI HTTP 服务与调试 JSON Lines 是不同边界。实际运行证据见 [v0.8.3 验收](../v0.8.3-validation.zh-cn.md)，设计依据见 [策略](../v0.8.3-implementation-plan.zh-cn.md)。
