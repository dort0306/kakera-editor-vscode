# 20 项目目标与能力状态

本文件承接根 README 迁出的“项目目标”和“能力与状态”。根 README 只保留项目简介、构建与测试方法及许可证；日常操作见 [21 使用说明](21-usage-guide.zh-cn.md)，与上游引擎同步的细节见 [22 引擎同步与版本增量](22-engine-sync-notes.zh-cn.md)，实际验证证据见 [12 实现与验证记录](12-implementation-status.zh-cn.md)，未实现的下版本规划见 [PLAN.md](../PLAN.md)。

更新：2026-11-01。基线为 Kakera 播放器 v0.11.3（story 8 / UI 3 / save 9）。

## 1. 项目目标

- 用中文首页、工程树、分镜带、静态舞台和属性面板完成手工创作，AI 未配置也能使用。
- 将每个分镜格对应到一个完整 XML `frame`，明确背景、人物、台词、音频和路由。
- 在可视编辑与源码编辑之间往返，保留手写 JS、注释与排版；复杂逻辑作为 Opaque 代码块展示。
- 接入用户配置的 Chat Completions 兼容服务，生成经过审阅、验证、可撤销的编辑提案。
- 通过匹配版本的外部播放器试玩，以 DAP 适配帧级断点和只读状态，最终构建独立游戏发行目录。

首版面向 **Windows 本地桌面 VS Code**，播放器独立开窗。浏览器版、SSH/容器远程环境、Code-OSS 分叉、原生舞台内嵌和 JS 行级调试不在首版范围。

## 2. 能力与状态

最近已交付的增量已把选色器同步为 HSL 色相环与正方形：横向饱和度、纵向亮度，黑白边缘保留标记；属性色盘和只读画布均已更新。XML/JS、`#RRGGBBAA` 和偏好格式不变，随附工具由包含该改动的 v0.11.1 源码重新构建；旧三角 HSV 说明仅为历史。0.10.2 起 Activity Bar“界面”分类按 include 列出全部 UI XML，左键打开对应可视化编辑器，右键打开源码。0.10.3 起按上游职责拆分：控件只绘制环/正方形/可选 alpha，无内置预览或 HEX；`alpha=false` 至少 128×128，默认/`true` 至少 128×154，色盘组按 `D=min(W,H−R)` 居中，画布预览同步。

2026-11-01 同步检查：相邻 `kakera-avg-rust` 工作区版本 0.11.3（`<particles>` 2D 图片粒子与总音量设置），此前 0.11.2 的 `component.register` 组合标签与 repeat 通用分页、0.11.1 的独立事件模型保持：普通 UI 回调改为 `event.register(id, callback)` 独立定义，XML `event`/页面背景属性与单参数 `ui(id).bind(eventId)` 只做引用；控件事件可省略或为空、未引用定义允许存在，两参数普通 bind 与 `$host` 绑定被删除。`frame()` 剧情/生命周期、story 8 / UI 3 / save 9 / KPAK 1/2、profile/read 1 与 demo content-version=11 不变。编辑器只写新语法，模板、工具哈希与版本检查同步，具体检查见[实现记录](12-implementation-status.zh-cn.md)。

| 范围 | 基线或计划 | 本仓库状态 |
| --- | --- | --- |
| 游戏格式 | v0.11.3 story 8 / UI 3 / save 9 | 模板与候选通过真实 v0.11.3 引擎检查；新增 `<particles>` 2D 图片粒子节点（严格属性范围、每页 4 个/UI 32 个预算、`ctx.particles(id).start/stop/clear/burst`）与 `ctx.setting("master_volume", …)`；`component.register` 组合标签（`x-tabs`/`x-pagination` 内置）与 repeat 分页 `page-size`/`page-bind`/`repeat.<ID>.*` 元数据；JS 注册为 `frame()`、`event.register()` 与 `ui().bind(eventId)`，支持 game localization、FTL、text-key/text-arg、locale 绑定与独立 language.json；保留专用 CG、palette/color-bind/color-picker；旧 `on.*` 与两参数普通 `ui().bind()` 显示迁移诊断 |
| 标题与人物 | 游戏标题、人物创建/改名、批量立绘、Live2D 模型/依赖与回退图、外观编辑和放入当前幕 | 已实现；标题/人物名称均写入实际 XML，保持稳定引用 |
| 分支分镜 | 选项分叉、目标汇合、循环和未知目标 | 分支分色、普通续接同行；拖动布局保存，拖线/点击连接；新建/删除明确调整连接 |
| 手动创作 | 新建/打开、分镜、台词/人物/音频、独立三槽画面、选择/条件分流/有序更新、稳定 ID | 已实现；生成脚本和可逆固定注册均可编辑，按幕确定可写范围 |
| 源码与资源 | 多章节、局部 XML 补丁、Opaque JS 保留、资源导入/已知引用、恢复记录 | 已实现基础能力、人物模型关联、点九/图集工具；复杂模型参数和合并待补 |
| UI 编辑器 | UI 3 多文件页面、控件树/画布、属性与交互，组合标签实例占位与内置 tabs/分页器插入，粒子发射器、快捷弹窗、玩家快捷键事件、HSL 选色器与配色槽位 | 已实现基础可视编辑、父级/绘制顺序、变量创建/编辑/删除、palette/color-bind/color-picker、粒子发射器属性/预算/预设/静态示意与 `ctx.particles` 事件、Delete/Ctrl+C/V/D/S 快捷键、快捷键捕获/绑定/重置事件、颜色覆盖读取 UI string 和快捷确认弹窗；侧栏按 include 列出 UI XML 并支持可视化/源码打开；静态示例预览，精确效果需试玩 |
| AI 辅助 | 用户配置、SecretStorage、纯文本拆幕、JSON/SSE、原文保真与审阅 | 已实现受限提案；真实服务与图片/资源关联尚未验收 |
| IDE 调试 | DAP、XML frame 断点、当前/候选只读变量、推进、选项选择 | 已接入真实 v0.11.3 播放器；不提供 JS 行级调试 |
| 游戏发行 | 依赖选择、实际包内文件审阅、KPAK 2、独立目录和报告 | 已实现；底层工具 KPAK 1/2 均已测试 |
| 插件发行 | 构建与离线 VSIX，匹配工具、模板和字体许可 | 已生成内部预览包；尚未公开发布 |

## 3. 未完项与相关入口

- 未完成、未验收的具体范围以 [12 实现与验证记录](12-implementation-status.zh-cn.md) 的“尚未完成或未验收”为准；下版本候选与优先级见 [PLAN.md](../PLAN.md)。
- 技术栈为 TypeScript Extension Host、React Webview 与独立领域/源码模块；当前通过匹配 CLI 复用 Rust 引擎，未另造运行时，独立结构化 Rust wrapper 尚未交付，诊断保留真实 CLI 文本，依赖边界见[落地方案第 3 节](11-vscode-extension-implementation-plan.zh-cn.md#3-代码组织与依赖方向)。
