# Kakera Editor for VS Code

面向 Kakera AVG 的可视创作插件：以“一格一幕”的分镜工作台编辑剧情，保留普通 XML/JS 源码，使用真实播放器验证和试玩。

**当前版本：0.1.0，Windows x64 本地桌面开发预览版。** 已实现分镜编辑与真实引擎校验/试玩/构建闭环，并生成离线 VSIX。核心回归、VS Code 宿主集成和 v0.8.3 播放器检查已运行；完整路线仍按阶段推进，见[实现与验证记录](doc/12-implementation-status.zh-cn.md)。

## 项目目标

- 用中文首页、工程树、分镜带、静态舞台和属性面板完成手工创作，AI 未配置也能使用。
- 将每个分镜格对应到一个完整 XML `frame`，明确背景、人物、台词、音频和路由。
- 在可视编辑与源码编辑之间往返，保留手写 JS、注释与排版；复杂逻辑作为 Opaque 代码块展示。
- 接入用户配置的 Chat Completions 兼容服务，生成经过审阅、验证、可撤销的编辑提案。
- 通过匹配版本的外部播放器试玩，以 DAP 适配帧级断点和只读状态，最终构建独立游戏发行目录。

首版面向 **Windows 本地桌面 VS Code**，播放器独立开窗。浏览器版、SSH/容器远程环境、Code-OSS 分叉、原生舞台内嵌和 JS 行级调试不在首版范围。

## 能力与状态

| 范围 | 基线或计划 | 本仓库状态 |
| --- | --- | --- |
| 游戏格式 | story 8 / UI 3，播放器保持 save 8 | 模板与候选通过真实引擎检查 |
| 手动创作 | 新建/打开、分镜、台词/人物/音频、独立三槽画面、选择/条件/有序更新、稳定 ID | 已实现；路由可写限于完整受管脚本 |
| 源码与资源 | 多章节、局部 XML 补丁、Opaque JS 保留、资源导入/已知引用、恢复记录 | 已实现基础能力；图集/点九/模型专用表单与复杂合并待补 |
| AI 辅助 | 用户配置、SecretStorage、纯文本拆幕、JSON/SSE、原文保真与审阅 | 已实现受限提案；真实服务与图片/资源关联尚未验收 |
| IDE 调试 | DAP、XML frame 断点、当前/候选只读变量、推进、选项选择 | 已接入真实 v0.8.3 播放器；不提供 JS 行级调试 |
| 游戏发行 | 依赖选择、实际包内文件审阅、KPAK 2、独立目录和报告 | 已实现；底层工具 KPAK 1/2 均已测试 |
| 插件发行 | 构建与离线 VSIX，匹配工具、模板和字体许可 | 已生成内部预览包；尚未公开发布 |

## 安装与开始使用

在 VS Code 命令面板执行 **Extensions: Install from VSIX...**，选择生成的 `artifacts/kakera-editor-vscode-0.1.0.vsix`。当前预览包包含经过 SHA-256 核验的 v0.8.3 播放器、打包器和 Noto CJK 字体，不需要 Rust 或 AI 服务。

1. 执行 **Kakera：打开创作首页**，新建工程或打开已有内容根。
2. 在分镜中选择一幕，编辑台词、说话人、画面、音频与路由。
3. 点击“预览差异并应用”，审阅差异后运行引擎校验；通过后更新源码缓冲。使用 VS Code 保存、撤销和重做。
4. 点击“试玩”从入口启动独立播放器；“停止”仅关闭本插件启动的试玩。
5. 点击“调试”，使用 XML frame 断点和变量视图；在命令面板执行 **Kakera：调试时选择选项**。
6. 点击“构建”，选择内容根之外的发行父目录，审阅实际包内文件后生成独立游戏目录。

AI 是可选功能：执行 **Kakera：配置 AI 服务**，在普通原稿编辑器中选中纯文本，再执行 **Kakera：AI 拆幕提案**。请求前显示服务、模型和范围；当前仅发送选中文本，新增幕经差异审阅和引擎校验后应用，不自动连接到旧剧情入口。

未信任工作区只能只读查看。现有复杂 JS 保持原文；修改了受管文件的生成格式后会降级为高级逻辑，不自动覆盖。恢复入口为 **Kakera：检查编辑恢复记录**，检测到后续修改时拒绝覆盖，需手工合并。

## 文档入口

- [VS Code 插件落地方案](doc/11-vscode-extension-implementation-plan.zh-cn.md)：模块拆分、宿主接入、数据与事务、调试、任务拆解和验收。
- [规划与开发手册](doc/README.zh-cn.md)：现有十篇设计文档的索引。
- [产品与创作流程](doc/01-product-workflows.zh-cn.md)、[架构、工程与编译](doc/02-architecture-project-compiler.zh-cn.md)：产品与源码约束。
- [通用 AI API](doc/03-ai-api.zh-cn.md)、[编辑器 API 草案](doc/05-editor-api-proposal.zh-cn.md)：拟议客户端和领域命令。
- [当前引擎 API](doc/04-current-engine-api.zh-cn.md)、[播放器调试 API](doc/10-player-debug-api.zh-cn.md)：接入时必须遵守的引擎边界。
- [路线与验收](doc/07-roadmap-validation.zh-cn.md)、[平台方案比较](doc/09-editor-platform-comparison.zh-cn.md)：阶段出口与平台决策。
- [AGENTS.md](AGENTS.md)：本仓库的开发协作规范。
- [实现与验证记录](doc/12-implementation-status.zh-cn.md)：当前可用范围、实测环境与尚未验证的功能。

原始资料中的部分相对链接指向上游引擎源码、版本验收或归档，这些文件未复制进本仓库。本轮根据开发机上的实际 v0.8.3 源码核对模板与 CLI，并通过准备脚本复制工具；没有运行上游全部测试。

## 后续目标

完整产品继续按以下工作流完善，图片 AI、精细资源编辑与完整故障恢复尚未全部交付：

1. 安装 VSIX，在 Kakera 首页新建或导入工程；已有工程先只读扫描。
2. 导入素材并确认标签、引用和授权，手动添加幕、台词与分支。
3. 可选配置 AI 服务，确认发送范围，审阅拆幕和资源关联提案。
4. 预览 XML/JS 差异，通过引擎校验后应用；修改源码后分镜同步更新。
5. 从故事入口启动独立播放器，检查分支、变量和测试路线。
6. 查看发行文件与许可证清单，生成 KPAK 和独立游戏目录。

XML/JS 始终是游戏内容的事实来源；打开文档时以当前 `TextDocument` 缓冲为准。分镜排序不会自动改变剧情路由，新建幕的 ID 只生成一次。

## 开发起点

主要目录：

```text
kakera-editor-vscode/
  doc/          产品、引擎契约与插件落地方案
  packages/     extension、webview、domain、source、protocol、AI、DAP
  templates/    已经引擎校验的最小 story/UI 与授权字体
  schemas/      工程清单与受限提案 schema
  scripts/      构建、工具准备与集成测试
  tests/        源码、文件、协议和宿主测试
  resources/    图标、依赖许可；本地准备的工具不提交 Git
  AGENTS.md     开发协作规范
  LICENSE       MIT 许可证
  README.md     项目说明
```

开发需要 Node.js 22 或更高版本、npm，以及 Windows 本地 VS Code。依赖版本由 `package-lock.json` 锁定。实际命令：

```powershell
npm ci
npm run check                 # 类型、单元/协议测试与构建
# 准备匹配工具，参数为实际 v0.8.3 release 二进制目录
node scripts/prepare-tools.mjs D:\path\to\kakera\target\release
npm run test:integration      # 真实模板、快照、KPAK 1/2 与独立宿主检查
npm run test:host             # 本机 VS Code：未保存缓冲、undo/redo、多视图、DAP
npm run package              # 生成 artifacts/ 下的离线 VSIX
```

`test:host` 默认使用 `%LOCALAPPDATA%/Programs/Microsoft VS Code/Code.exe`；其他安装路径通过 `VSCODE_EXECUTABLE` 指定。所有集成测试使用 `.test-work/` 下的隔离工程与宿主数据。开发调试可直接在本仓库按 F5。

源码仓库不提交工具二进制，干净克隆需要执行准备脚本；现成 VSIX 已附工具。自定义工具目录必须含 `tools.json` 哈希清单，通过 **Kakera：配置播放器工具目录** 设置。当前不包含 Live2D Core。

已采用 TypeScript Extension Host、React Webview 与独立领域/源码模块；当前通过匹配 CLI 复用 Rust 引擎，未另造运行时。独立结构化 Rust wrapper 尚未交付，诊断保留真实 CLI 文本。具体依赖边界见[落地方案](doc/11-vscode-extension-implementation-plan.zh-cn.md#3-代码组织与依赖方向)。

| 阶段 | 目标 | 粗估人周 |
| --- | --- | --- |
| E0 | 宿主、源码往返、工具和协议原型 | 1–2 |
| E1 | 手动创作 MVP 与外部试玩 | 2–3 |
| E2 | 多文件往返、恢复和资源管理 | 2–3 |
| E3 | AI 服务与提案工作流 | 2–3 |
| E4 | DAP 帧级调试与路线记录 | 1–2 |
| E5 | 离线插件和独立游戏发行 | 1–2 |

合计暂估 9–15 人周，沿用设计手册的估算口径，需 E0 验证后修订，不是交付日期承诺。E1 先提供受管工程的创作闭环，复杂现有工程的可写接管在 E2 验证后开放。

提交实现时应附对应阶段、行为变化、实际执行的检查及限制。文档修改检查链接、术语和能力状态；代码测试应覆盖相关往返、并发、取消和协议风险，不用 mock 结果替代真实播放器或真实服务验收。

## 许可证

本仓库代码采用 [MIT 许可证](LICENSE)。React、Acorn、Saxes 等运行依赖的声明由构建脚本汇总至 `THIRD_PARTY_NOTICES.txt`；saxes npm 包遗漏的许可来自[官方 v6.0.0 LICENSE](https://raw.githubusercontent.com/lddubeau/saxes/v6.0.0/LICENSE)。模板字体遵循 [SIL OFL 1.1](templates/minimal/content/assets/licenses/OFL.txt)。播放器及其他素材保留各自授权，当前内部预览包不包含 Live2D Core 或模型。
