# Kakera 编辑器规划与开发手册

更新：2026-11-01，基线为播放器 **v0.11.3**（story 8 / UI 3 / save 9）。插件 0.11.3 已交付现代 IDE 风格工作区、可视分镜、UI 编辑器、快捷确认弹窗、玩家快捷键事件、HSL 选色器/配色槽位/color-bind、游戏文本/语音国际化、生命周期映射、UI 显式起始幕、事件编辑/删除、幕 ID 重命名、CG 专用资源/画廊/共享解锁、多起始幕与 UI 首次进入、故事与 UI 变量编辑/删除、颜色覆盖读取 UI string、侧栏 UI XML 文件导航、VS Code 原生分类侧栏与右键菜单、侧栏幕定位/XML 分组/自动短 ID、流程图多选与常用快捷键、流程图背景平移、UI 粒子发射器可视化与编辑器快捷键、试玩/调试与构建适配，并同步 `frame()`、独立 `event.register` 与 XML/`ui().bind(eventId)` 新版 JS 注册 API；实际能力见 [12 实现与验证](12-implementation-status.zh-cn.md)，日常操作见 [18 可视化编辑器使用说明](18-visual-editor-guide.zh-cn.md)。旧规划保存在 doc/archive/editor-v0.8.2。

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
| [10 播放器调试 API](10-player-debug-api.zh-cn.md) | 已实现的认证、请求、命令、状态和限制（协议 v1） |
| [11 VS Code 插件落地方案](11-vscode-extension-implementation-plan.zh-cn.md) | 本仓库的模块、宿主接入、事务、调试、阶段任务与验收门禁 |
| [12 实现与验证记录](12-implementation-status.zh-cn.md) | 插件 0.11.3 的实际能力、真实工具/宿主检查与未完成项 |
| [18 可视化编辑器使用说明](18-visual-editor-guide.zh-cn.md) | 工作台、UI、事件、幕 ID、设置、试玩与常见问题 |
| [19 游戏本地化](19-localization.zh-cn.md) | v0.10.1 清单/FTL、文本来源、参数、语言/语音编辑、预览与限制 |
| [13 JS/XML 实时同步映射](13-live-logic-mapping.zh-cn.md) | 语法树关联、逐幕能力、源码局部补丁和自定义逻辑边界 |
| [14 拖动连线与图片工具](14-graph-and-texture-tools.zh-cn.md) | 幕布局/重新连线、点九生成编辑、图集生成/裁切与 UI 应用 |
| [20 项目目标与能力状态](20-capabilities-status.zh-cn.md) | 项目目标、能力状态表与未完项入口（由根 README 迁入） |
| [21 使用说明](21-usage-guide.zh-cn.md) | 安装、分镜工作台、UI 编辑器、图片工具、试玩/调试/构建与限制（由根 README 迁入） |
| [22 引擎同步与版本增量](22-engine-sync-notes.zh-cn.md) | 各引擎版本的契约变化、编辑器行为与工具/模板对齐（由根 README 迁入） |

[15 变量条件分流](15-variable-conditional-routes.zh-cn.md)：布尔/整数范围、优先级、默认线路与源码映射。

[16 UI 编辑器](16-ui-editor.zh-cn.md)：上游 UI 拆分扫描、可视布局、属性/绑定/事件和实际验收。

根目录文档分工：[README](../README.md) 只保留项目简介、构建与测试方法和许可证；未实现的下版本规划在 [PLAN.md](../PLAN.md)；协作规范在 [AGENTS](../AGENTS.md)；逐版本变更在 [CHANGELOG](../CHANGELOG.md)。

本仓库已实现插件 0.11.3 开发预览版，当前能力见 [20 项目目标与能力状态](20-capabilities-status.zh-cn.md)，检查与未完项见 [12 实现与验证](12-implementation-status.zh-cn.md)，日常操作见 [21 使用说明](21-usage-guide.zh-cn.md) 与 [18 可视化编辑器使用说明](18-visual-editor-guide.zh-cn.md)。下文及原始 01–10 手册保留原始设计状态，部分源码、demo、版本验收与归档链接来自上游引擎工程，未随本仓库提供；不能视作已在本仓库验证的证据。

## 能力状态

- 已有：v0.11.3 story 8/UI 3/save 9、`frame()`、独立 `event.register` 与 `component.register` 组合标签/repeat 分页、KPAK 1/2、点九/图集/别名/标题、CG 专用资源/画廊/共享解锁、快捷确认弹窗、玩家快捷键 UI 事件、HSL 紧凑布局/color-bind/palette（无内置预览或 HEX）、UI 变量删除与颜色覆盖读取 UI string、2D 粒子发射器（属性/预算/预设/静态示意与 `ctx.particles` 事件）、UI 编辑器 Delete/Ctrl+C/V/D/S 快捷键、UI 演出与生命周期映射、显式起始幕/交接编辑、事件编辑/删除、幕 ID 重命名、loopback 调试、发布依赖选择和显式附加清单。
- 插件已有 VSIX、可视分镜、资源管理、源码往返、AI 客户端、提案/编译服务和 DAP 适配；AI 真实服务与部分高级资源工具仍未验收。
- 播放器后续能力：条件断点、JS 行级调试、推送事件、通用 JSON 诊断、源码指纹及受控跨代次替换；当前 API 不开放任意状态注入。

## 核心原则

一格对应一个完整 XML frame，不是视频帧或隐式顺序剧情。XML/JS 是源文件事实来源，任意手写 JS 保留 Opaque 代码块；AI 输出结构化提案，由确定性编译器生成并验证代码。新幕创建一次稳定显式 ID，避免重打包随机 ID 改变存档契约。

编辑器、用户服务配置/密钥和原稿仍与 content 分离。打包 CLI 自动收集实际运行依赖与约定许可证，额外普通文件只通过 kakera.package.json 的显式 include 加入；低层原始容器 API 仍可编码任意授权数据，不等于 CLI 发布策略。

调试 API 只在显式工程模式开启，发布模式拒绝；AI HTTP 服务与调试 JSON Lines 是不同边界。本仓库实际运行证据见 [12 实现与验证](12-implementation-status.zh-cn.md)；上游 v0.11.1 计划/验收不在本仓库，不虚构其内容。
