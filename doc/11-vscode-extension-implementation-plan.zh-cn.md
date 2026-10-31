# 11 VS Code 插件落地方案

日期：2026-10-31。基线：Kakera 播放器 v0.11.1，story 8 / UI 3 / save 9，播放器调试协议 v1。

本文把 [01–10 设计手册](README.zh-cn.md)细化为本仓库的实施任务与边界；实际交付范围、已实现命令和未完成项以 [12 实现记录](12-implementation-status.zh-cn.md)为准。下文仍保留拟议内部契约，不把未实现规划当作已有能力。

## 1. 当前条件与交付边界

### 1.1 仓库事实与前置依赖

当前仓库只有 `doc/` 和 `LICENSE`，本次补充根 README、AGENTS 与本文。没有 `package.json`、Rust crate、播放器二进制、模板、测试或 VSIX。原始文档中的 `../../src/`、`../../tests/`、版本验收及 demo 链接来自上游工程，不能在此直接调用。

E0 建立依赖登记表，至少取得以下输入：

| 输入 | 需要确认的内容 | 缺失时的处理 |
| --- | --- | --- |
| v0.10.0 播放器与打包器 | 来源、版本、平台、哈希、CLI 与调试契约 | 可做协议 mock，不标记真实试玩/构建验收通过 |
| v0.10.1 播放器与打包器 | 游戏本地化清单/FTL、独立语言偏好、宿主中文诊断与 KPAK 全语言依赖 | 需重新准备哈希并运行真实 `--check`；静态检查不替代系统语言/音频/偏好运行态验收 |
| v0.11.1 播放器与打包器 | `frame()` 注册、独立 `event.register` 定义、XML/`ui().bind(eventId)` 引用、旧 `on.*` 与两参数 bind 拒绝与迁移诊断 | 需重新准备哈希、模板与真实 `--check`/KPAK；静态检查不替代真实注册装配与生命周期验收 |
| 对应引擎源码与主 XML/JS 手册 | loader、Bundle、ScriptLogic、Controller、资源及发布选择 | 不照文档猜完整 XML/UI 模板或 Rust 公共 API |
| 合法最小工程与 UI 模板 | story 8、UI 3、字体/素材授权、合法路由 | E1 无代码新建工程的出口依赖此项 |
| Rust 内容工具接入方式 | 上游 crate 是否可作为库、哪些模块公开、依赖/许可 | 必要时上游增加工具入口；不复制一套剧情运行时 |
| Live2D Core 和样例许可 | 是否需要、可否随产品分发、fallback 与完整校验区别 | 先验静态链路，完整模型支持独立验收 |

“播放器已实现”仅指设计资料记载的上游能力，本项目仍须对取得的实际版本做契约验收。

### 1.2 首版交付

交付 Windows 本地桌面 VS Code 插件，面向无需手写代码的作者，同时保留普通 XML/JS 编辑。先完成手工创作闭环，再增加资源接管、AI、DAP 与发行。目标工作流为：

```text
新建/导入 → 分镜与资源编辑 → 源码差异 → 引擎验证
          → 应用与保存 → 冻结代次 → 外部试玩 → 独立游戏构建
                      ↑
          可选 AI 提案经作者审阅进入同一流程
```

E1 MVP 必须能在未配置 AI 的情况下创建一个带条件分支、变量更新和结束幕的合法 demo，从入口真实试玩。E1 可写范围限于编辑器新建的 Managed 工程，已有复杂工程先只读展示，待 E2 验证后开放有限接管。

首版不交付 Code-OSS 分叉、独立壳、浏览器版、SSH/容器远程运行、原生 GPU 内嵌、任意 JS 可视化或行级调试。舞台提供静态构图，精确媒体与效果以外部播放器为准。

### 1.3 不变量

- 一格对应一个完整 `frame`，不是视频时间帧；章节文件链和分镜顺序不产生隐式剧情边。
- XML/JS 为事实来源；打开的文件以 `TextDocument` 当前缓冲为准，sidecar 不保存第二套优先剧情。
- 新建一次稳定显式 frame ID；复制分配新 ID，重排与改名不改 ID。导入缺省 ID 只提示风险，不静默固化。
- 未管理源码保真，复杂 JS 标记 Opaque；动态目标只能显示未知或运行时观察结果。
- AI 输出提案，确定性编译器输出代码，真实引擎决定运行语义。
- 校验、试玩、构建读取完整冻结代次；私有元数据、秘密、存档和原画母版不进入内容根。

这些约束分别来自 [01 产品](01-product-workflows.zh-cn.md)、[02 架构](02-architecture-project-compiler.zh-cn.md)、[04 引擎](04-current-engine-api.zh-cn.md)和 [05 编辑器 API](05-editor-api-proposal.zh-cn.md)。

## 2. 技术架构与宿主接入

### 2.1 组件与职责

| 组件 | 负责 | 边界 |
| --- | --- | --- |
| Extension Host / TypeScript | 工程会话、TextDocument、命令、诊断、任务、网络、秘密和进程 | 不同步解码大图或执行游戏 JS |
| Webview / TypeScript UI | 分镜带、静态舞台、属性、资源选择与提案审阅 | 不接触密钥、任意文件写入或子进程 |
| domain | AuthoringDocument、命令、ChangeSet、受限表达式与兼容性规则 | 不依赖 VS Code、DOM，不另建运行时 |
| source | XML 范围/CST、JS 识别、最小补丁、源码映射与确定性生成 | 未识别区域保留原文 |
| content-tool / Rust | 复用引擎的内容/资源验证、依赖发现和路线检查 | 独立工作进程，遵守原有 QuickJS 和资源预算 |
| ai-client | 兼容 HTTP、能力探测、SSE、预算、取消与提案解析 | 仅产生候选，不直接 Apply |
| debug-adapter | DAP 与播放器 JSON Lines 转换、状态轮询、断点/变量映射 | 不暴露引擎没有的能力 |
| 外部播放器/打包器 | 原生呈现、真实会话、存档和 KPAK | 版本锁定；仅启动并管理本任务自己的进程 |

UI 建议使用 React + TypeScript，以组件组织分镜/表单；构建建议 esbuild。此为实现选择，E0 锁定依赖与版本后落地。JS 解析库选型必须先证明 BigInt、范围定位、未知语句保留；XML 库必须支持范围补丁或具体语法表示，单纯读树/重序列化不合格。

首版采用 npm workspaces 管理 TypeScript 包，锁文件与工具版本一并提交；Rust wrapper 单独锁定引擎 revision。开发用 Node、VS Code、Rust 版本由 E0 最低宿主实测确定，不把此刻的最新版本写成未经验证的最低要求。

### 2.2 VS Code 扩展点

XML 采用 `CustomTextEditorProvider`，用 `WorkspaceEdit` 更新文档，再由 `onDidChangeTextDocument` 广播至全部视图；未形成合法 XML 的中间输入显示诊断，不写回旧模型。[官方 Custom Editor 说明](https://code.visualstudio.com/api/extension-guides/custom-editors)

| 扩展点 | 拟定标识/用途 | 接入规则 |
| --- | --- | --- |
| Activity Bar / Tree View | `kakera.project`，章节/角色/变量/资源/问题 | 优先复用原生树与导航 |
| 首页 / Walkthrough | 新建、导入、打开分镜、试玩、构建 | 作者不用终端；不可用功能显示原因 |
| Custom Text Editor | `kakera.storyboard` | XML selector 使用 optional 优先级；按工程归属与根元素识别，避免接管所有 XML |
| Webview | 分镜/舞台/属性、素材、AI 差异 | 用 `asWebviewUri`，资源只暴露扩展静态包与所需缩略图目录 |
| DiagnosticCollection | `kakera` | 映射到对象及真实源码范围；无位置时显示工程级问题 |
| Task / Progress / Output | 验证、索引、试玩与构建 | 取消令牌贯穿任务，日志有界净化 |
| Debugger | `kakera` | E4 注册 DAP adapter，先验证自有启动会话 |
| SecretStorage | AI 密钥及秘密头引用 | 仅宿主持有；换机器重新绑定 |

Webview 使用严格 CSP、带 nonce 的本地脚本、输入转义与消息白名单，关闭直接联网；`localResourceRoots` 仅是资源边界之一。[官方 Webview 说明](https://code.visualstudio.com/api/extension-guides/webview) 密钥通过宿主 [SecretStorage](https://code.visualstudio.com/api/references/vscode-api#SecretStorage) 保存。

清单声明 `untrustedWorkspaces.supported = "limited"`，受限工作区仅静态只读查看，写入、校验执行、AI 外发、试玩/构建均禁用；宿主命令入口再次校验信任。[Workspace Trust 指南](https://code.visualstudio.com/api/extension-guides/workspace-trust)

拟采用 `extensionKind: ["workspace"]`，同时检测 OS、URI scheme 与远程环境。首版拒绝远程工具任务，虚拟工作区不提供完整支持；不能只靠 extensionKind 假定执行位置。[扩展清单](https://code.visualstudio.com/api/references/extension-manifest)、[远程扩展宿主](https://code.visualstudio.com/api/advanced-topics/remote-extensions)

### 2.3 命令和配置

| 阶段 | 拟定命令 ID | 作者行为 |
| --- | --- | --- |
| E1 | `kakera.project.create` / `kakera.project.open` | 新建工程 / 扫描导入 |
| E1 | `kakera.storyboard.open` / `kakera.source.open` | 切换分镜与源码 |
| E1 | `kakera.frame.insert` / `kakera.frame.duplicate` / `kakera.frame.reorder` | 新增/复制/排序，重连路由为独立操作 |
| E1 | `kakera.validate` / `kakera.playtest.start` / `kakera.playtest.stop` | 校验与隔离试玩 |
| E2 | `kakera.asset.import` / `kakera.asset.references` | 导入素材 / 展示反向引用 |
| E3 | `kakera.ai.configure` / `kakera.ai.propose` | 配置服务 / 请求并审阅提案 |
| E4 | `kakera.debug.start` / `kakera.debug.choose` | 帧级调试 / 显式选择选项 |
| E5 | `kakera.build.plan` / `kakera.build.run` | 审核文件清单 / 生成发行目录 |

配置建议：`kakera.tools.directory`（仅用户级显式工具覆盖，检查版本/哈希）、`kakera.ai.defaultProfileId`（非秘密引用）、`kakera.preview.thumbnailConcurrency`（有界并发）、`kakera.debug.pollIntervalMs`（有最小间隔）。服务 profile 的非秘密字段保存在用户范围，密码与秘密头值放 SecretStorage；工程只记录 profile ID。工具路径/参数与发送目的地不能由工程内容静默接管。

`engines.vscode`、publisher、包版本、激活事件及 VSIX 目标平台在 E0 建清单时确定。只使用公开稳定 API，不依赖 proposed API。

## 3. 代码组织与依赖方向

以下目录均为规划，按阶段创建：

```text
kakera-editor-vscode/
  packages/
    extension/src/        activate、providers、commands、session、tasks、storage
    webview/src/          分镜、舞台、属性、素材、提案、宿主消息桥
    domain/src/           对象、受限表达式、命令/变更、兼容性规则
    source/src/           XML/JS 读取、范围补丁、编译、EditorSourceMap
    protocol/src/         内部消息 schema、错误、预算、版本
    ai-client/src/        profiles、HTTP/SSE、探测、Proposal 校验
    debug-adapter/src/    DAP、JSON Lines、会话和断点映射
  native/content-tool/    Rust wrapper 与引擎依赖锁定
  schemas/                编辑器清单、sidecar、消息和提案 schema
  templates/              经引擎验证且授权清晰的最小游戏/UI
  resources/tools/win32-x64/  发行时准备的匹配工具与哈希清单
  tests/                  往返 fixtures、宿主集成、协议、发行验收
  scripts/                开发构建、VSIX 组装与检查
  doc/                    设计与验收记录
```

domain 不依赖宿主；source 依赖 domain/protocol；extension 协调 source、AI 和工具；webview 只依赖展示类型/消息。debug-adapter 的传输与状态机独立于 UI，并由单一会话控制器管理连接。

Rust 工具通过受限 stdio 请求/响应工作；拟议协议含版本握手、requestId、jobId、generation、输入快照引用和 diagnostics，stdout 只输出协议，stderr 记录净化日志。初期可每任务单进程，优先保证可取消和清晰生命周期，不先建设 HTTP/MCP 服务。这个协议与播放器 JSON Lines v1 分开版本化。

E0 可用现有 `--check` 完成真实资源检查原型；它只输出文本，不能宣称有结构化诊断。后续 wrapper 若不能直接复用引擎模块，先明确上游工具入口的最小改动。不要仅为拥有一个 Rust 目录而重写引擎规则。

## 4. 工程、源码与变更模型

### 4.1 作者工程布局

```text
MyGame/
  project.kakera-editor.json  editorSchema、内容根引用、引擎契约
  content/                   唯一游戏内容根
    story.xml
    chapters/
    scripts/
    ui.xml
    assets/                  运行资源及随附许可证
    kakera.package.json      可选显式附加文件清单
  authoring/                 原稿、PSD、注释
  .editor/                   sidecar、管理范围、事务日志与恢复
  .cache/                    可删除的缩略图和索引
  .work/                     不可变验证/试玩/构建代次
  builds/                    已完成发行物及报告
```

测试存档和调试令牌置于工程内容根以外的用户存储，秘密不放工程。导入旧平铺游戏根时不移动文件，元数据/缓存/快照放根外宿主存储；迁移是独立有差异的操作。

源代码仓库与作者游戏工程的目录不可混淆。模板包含相应忽略规则，缓存、工作代次、测试存档和本地事务备份不作为发布内容；标签/授权等需要协作的 sidecar 可以显式纳入版本管理。

### 4.2 最小内部契约

沿用 [05 API 草案](05-editor-api-proposal.zh-cn.md)，优先实现进程内类型和边界 schema，暂不把每个领域方法变成 RPC：

| 类型 | 必要信息 | 核心检查 |
| --- | --- | --- |
| ProjectSession | projectId、revision、源文件集合/缓冲版本、资源修订 | 多根工作区逐工程隔离，旧项目消息不得串入新项目 |
| FrameDraft | editorObjectId、frameId/name、完整画面/音频、文本、路由、来源 | 导入 frameId 可为空；新建必须显式稳定 ID |
| RouteDraft | advance/choice/end、guard、orderedUpdates、branches、管理级别 | 每个选项注册一致，分支有明确最终目标 |
| SourceSpan | URI、范围、文件哈希、行列 | 哈希过期即停止自动范围补丁 |
| ChangeSet | baseRevision、inputHashes、预期文档版本、操作、兼容性影响 | 只涉及授权管理范围，带逆操作与新建文件 |
| FrozenGeneration | generationId、全量输入指纹、缓冲版本、工具/模板版本 | 创建后不可修改，结果绑定同一代次 |
| Proposal | schema、任务/服务版本、baseRevision、操作和资源候选 | 白名单操作、路径/资源/变量/类型及预算校验 |

Webview 消息信封拟含 `protocolVersion`、`requestId`、`projectId`、`expectedRevision`、`type`、`payload`；宿主绑定 panel/session，不信任页面自己声称的工程归属。资源用稳定引用，不能传任意写入路径。普通内部请求初始上限 1MiB，AI 最终提案 2MiB，每批最多 1000 幕变更；这是编辑器预算，不替代播放器 64KiB 请求限制。

### 4.3 可视操作到源码

1. 捕获所有涉及源文件当前内容与版本；领域命令产生 ChangeSet，不直接写文件。
2. 在候选中检查类型、完整画面、重复 ID、路由所有权、引用及未解决占位。
3. 对 Managed 范围确定性生成，对 Recognized 范围做语法节点补丁，Opaque 范围保持原字节；XML 注释、空白和未触及范围不重排。
4. 生成对象/原稿到 XML/JS 的 EditorSourceMap，进行轻量解析和引擎候选校验。
5. 显示差异与旧档兼容性影响；复查 revision、文档版本、源/资源哈希后才用 WorkspaceEdit 应用。
6. 文档变更事件成为视图更新入口，抑制消息回环。显式保存后形成新的已保存基线，供后续恢复比较。

guard 读取更新前变量，主回调按序 `ctx.set/add`，需要新草稿值时重新读取 `ctx.vars`；branches 在更新后依次判断。int 使用 i64 十进制字符串与 JS BigInt；不以 Number 中转。Choice 结束必须指向显式 End 幕；所有受管 `game.enter` 行为合并为一个回调。

源编辑改变了 Managed 文件指纹，重新解析并降级管理能力，不以旧生成模型覆盖作者修改。首次接管显示范围和备份；共享 visual 修改显示所有引用，复制为当前幕独用是另一操作。

### 4.4 多文件、撤销与恢复

宿主文档 undo/redo 是文本变化入口，不另建一套与源码脱节的内容撤销栈。一个作者操作尽量作为一次 WorkspaceEdit，记录对应 sidecar 逆变更；E0 实测跨文件撤销、自动保存和多视图行为，不能先承诺任何保存顺序下都“一键原子撤销”。

显式多文件保存使用 journal：`prepared → validated → committing → completed`。写日志时持久化涉及文件的旧/新内容哈希和恢复位置；文件逐个替换只能保证单文件边界。普通 Save/Save All/自动保存仍可能分步落盘，不能假设插件能拦截宿主所有写盘操作。检测中间态后，相关试玩/构建只允许已验证完整代次。

恢复时对比磁盘、打开缓冲和 journal：仍匹配事务前后哈希的文件才可恢复；出现更新内容则进入三方合并，先处理一致性再编辑/试玩。崩溃、锁文件、磁盘满、取消及撤销中途失败都要故障注入验证。恢复备份留在作者域，不进 content 或包。

## 5. 快照、任务、资源与性能

### 5.1 冻结验证与进程生命周期

冻结相关 XML/JS 的未保存缓冲，其他输入按内容哈希捕获到私有纯内容根，包含加载依赖与显式发行文件。读取前后复查源文件并绑定 revision，拒绝捕获过程混入不同版本。实现不得通过可写硬链接让代次随源文件变化；试玩期间不清理仍被进程引用的代次。

验证分三层：键入时轻量解析/引用反馈；提交候选时内容/注册校验；显式验证、试玩或构建前完整 Bundle/资源检查。没有 Rust wrapper 时，仅能把现有 CLI `--check` 当完整检查使用，不伪造快速 loader 接口。

后台初始限制为每工程单验证、单 AI 任务和少量缩略图任务；所有重任务带 jobId/generation 和取消状态。普通取消先协作停止，超时才结束任务私有进程；不提交部分源码/发行物，不杀无关播放器。Windows GUI 子系统检查必须等待真实退出码并捕获输出，启动调用返回不代表检查完成。

### 5.2 资源库

确定性导入资源类型、哈希、尺寸/时长、依赖、人工标签与授权；图像/媒体解码移出 Extension Host。大文件用流式哈希；缩略图缓存键含内容哈希、参数与解码版本，AI 描述另加 profile/model 与标签修订。虚拟分镜带只加载可见项及邻近项，不滚动一次就全量 Bundle 重建。

图集仍引用同一 image 加 region，不生成独立发行贴图；点九使用专用资源/节点和现有标记规则；Live2D 动作/纹理与许可证成组管理，静态 fallback 不冒充完整模型校验。

资源替换、重命名和删除先展示反向引用、图集越界/动作丢失及动态 JS 不确定项；删除默认可恢复。路径处理须拒绝越界、符号链接/reparse point 和碰撞，Windows 路径比较不只检查字符串前缀。

规模验收在引擎预算内覆盖 100/1000 幕、多章节和大资源，记录打开、滚动、编辑、峰值内存、任务取消与快照耗时。E0 先固定测量硬件和样本，再定可接受阈值，不将未测的 FPS/耗时写成保证。

## 6. AI 接入

AI 按 [03 通用 API](03-ai-api.zh-cn.md) 实现单一 Chat Completions 兼容适配器。作者可选本机、内网或远程服务；插件不管理模型/GPU，也不强制向量库。

完整链路为：选择原文与素材 → 显示服务/模型和发送范围 → 本地检索候选 → 请求 → 解析最终 content → schema/业务校验 → 作者审阅 → 相同编译/验证/Apply 流程。AI 文本、图片中的指令和资源名都只按输入数据处理。

| 事项 | 实施规则 |
| --- | --- |
| 配置 | baseUrl 明确是否含 `/v1`，只追加一次 `chat/completions`；model 为精确 ID，模型列表可缺失 |
| 凭据/传输 | SecretStorage；loopback 可 HTTP，远端默认 HTTPS；不忽略 TLS 错误、不跨主机转发凭据 |
| 能力 | text/image/stream/jsonObject/jsonSchema 分别记录未知、宣称、已探测，不以文本连通证明能看图 |
| 图片 | 只发送授权的受限缩略图，不让模型提供任意 URL/本地路径供宿主读取 |
| 流 | 按 SSE 事件处理分片 UTF-8、delta、结束标记/原因；reasoning 不混入最终 JSON，未完成流不得提交 |
| 输出 | 白名单 createFrame、patchDraftField、assignAsset、setManagedRoute、addDeclaredVariable；不允许任意文件/执行/发布指令 |
| 重试 | 401/403 不盲重试；429/可恢复错误有界退避，遵守 Retry-After；结构修复至多两次，绝不重复 Apply |
| 失效 | 取消、profile 变化、源/资源修订变化后拒绝直接应用；提案可重新验证或重建 |
| 追溯 | 记录配置修订、model ID、可选服务报告版本、模板和输入摘要，不伪造不可变模型哈希 |

初始预算沿用设计：20 幕/任务、8 张最长边不超过 1024 像素的缩略图/批、提案 2MiB、连接 15 秒、总任务 5 分钟；具体图片总字节与输出 token 上限在适配器中显式限制，可经测量调整。

E3 至少实测一个本地自部署和一个远程兼容服务，记录配置与实际能力；mock 覆盖文本/图片、流/非流、格式拒绝、缺模型列表、截断、坏 JSON、401/403/429/5xx、TLS、超时/取消和过期响应。冻结 100 个中文幕、200 个标注素材和 20 个无匹配样本，开发/留出集分开。Top-3 和无匹配识别各 ≥90% 是规划目标，原文保真、无效 ID/非法路径为 0 是验收要求，均不得写成当前实测结果。

## 7. 真实试玩与 DAP

### 7.1 启动与隔离

普通试玩从入口启动，`--project` 指向冻结代次的纯内容根，`--save-dir` 指向独立测试数据目录。需要调试时再增加 `--debug-listen 127.0.0.1:0` 和 `--debug-token-file`；令牌随机生成、32–128 个允许 ASCII 字符，限制文件访问，生命周期结束清理。端口从工程日志取得，E0 验证实际输出形式，不假定存在机器可读启动事件。

播放器调试启动初始暂停；不与 `--package` 或 `--check` 混用。工具路径使用参数数组启动，记录自己拥有的 PID/会话；停止优先正常关闭，无远程 quit 命令。初期只支持自有进程 launch，外部 attach 另做会话/凭据设计。

单幕静态构图不产生真实 Session，不靠写假档或改 frame_id 跳到目标。从入口记录合法动作到达场景；不能到达时明确为构图预览。源改变后可以启动新代次，现有会话不悄悄热替换。

### 7.2 调试客户端状态机

所有协议以 [10 播放器调试 API](10-player-debug-api.zh-cn.md)为准。连接后先 `status`，核对 protocol/version、engine_version、capabilities 和进程身份，再允许控制。

- TCP UTF-8 JSON Lines，每请求携带 token；请求 64KiB、响应 2MiB，队列最多 8，空闲连接约 30 秒关闭。
- 一个会话一个串行控制队列，轮询和控制共用全局递增 request ID；ID 限 JS 安全整数并禁止耗尽后回绕，跨进程的新会话才重建身份。
- 控制前带最近状态 `expected_revision`；失败后查询新状态。处理协议 u64/i64 时做精度检查，超安全范围使用无损解析，不能经过 Number 截断。
- 同 ID 只允许逐字节重发原请求；服务仅缓存最近 8 个响应。断线/超时可能已经执行，以新 ID 查询状态，不盲目换 ID 再推进。
- `pending_frame` 为提交前候选，包括与当前 frame 相同的自循环。advance/resume 仅提交一次；旧状态与候选在 UI 上分别展示。
- 错误字符串不作为稳定机器错误码。鉴权、修订、网络与引擎失败记录上下文；不靠匹配中文错误文案决定重试。

轮询拟以 250–1000ms 为起始可调范围，控制请求优先，后台面板降低频率；这是调度选择，E4 测量后修订。状态变化才发送 DAP 事件，不为每次轮询重复制造 stopped。连接重建后复核身份、断点和最新状态；控制台不暴露令牌或完整请求。

### 7.3 DAP 映射

| DAP/作者动作 | 引擎/适配器行为 | 必须显示的限制 |
| --- | --- | --- |
| launch | 验证代次、启动进程、握手、取得初始暂停状态 | MVP 从入口，不支持任意幕启动 |
| setBreakpoints | XML 行映射 frame ID/name，汇总替换整批 frames | 非 frame 行与条件断点明确未验证；映射绑定冻结源码 |
| pause / continue | pause / resume | pending 候选可能在继续时才提交 |
| next | advance，一次普通推进仲裁 | 可能只跳转场或补全文字，不保证跨一幕 |
| scopes / variables | 只读当前/候选剧情变量、UI 与阻挡信息 | int 按十进制字符串显示，不提供写变量 |
| stackTrace | 一个作者语义位置，使用冻结 EditorSourceMap | 无 JS 调用栈；候选位置明确标为“提交前” |
| 选择 / 补全文字 / 跳转场 | choose / reveal / skip_transition，专用命令 | 只用可用选项，遵守菜单/视频/提示阻挡 |
| disconnect / terminate | 关闭连接，按会话策略关闭自有播放器 | 断连本身不会恢复或退出引擎 |

有 pending 时可把候选 XML 行作为断点展示位置，同时明确当前已提交幕仍是旧幕；不把候选当作已执行的运行状态。只声明已实现 DAP capabilities，拒绝 evaluate、setVariable、条件断点、stepIn/stepOut 等超出语义的请求；必要表达式展示只读值也不能把输入交给游戏 eval。

冻结源码通过只读虚拟文档展示或定位，避免用户改过的 canonical 行号被当作调试位置。发布协议没有 sourceFingerprint，只能对本插件启动的代次维持本地来源关联；不能宣称任意 attach 可验证源码一致。

E4 验收认证/去重/修订冲突、断点候选、自循环、隐藏选项与坏目标回滚、暂停输入/时钟、断线/超时查询、渲染重建丢弃候选及停止清理。JS 行级调试、事件订阅、任意 jump/setVariables/eval 不在 v1 能力中。

## 8. 游戏构建与插件交付

### 8.1 游戏发行流水线

1. 固定完整已验证代次，构建计划记录 revision、源/资源指纹、引擎/模板/编译器版本、ID 策略与 content-version。含未保存缓冲时明确标记其来源版本。
2. 校验源/资源/Core、测试路线、未解决占位、许可证及旧档风险；动态分支未覆盖范围单列。
3. 使用 v0.8.3 的依赖选择取得实际内容与许可证；额外文件仅来自 `kakera.package.json` 的显式相对文件列表，保留排除规则，不恢复整根递归打包。
4. 调用匹配 `kakera-pack.exe <候选内容根> <候选包>`；默认 format 2、level 19，format 1 为显式兼容选项。输出位于内容根外，私有新候选不需要静默覆盖旧包。
5. 等待打包退出并对新包运行播放器 `--package <候选包> --check`，取得实际退出码与净化日志。失败不组装成正式发行物。
6. 组装匹配播放器、`game.kpak`、按授权选定的包外 Core、许可证与启动说明；报告保存于发行物外或明确的报告目录，避免混入本地路径/凭据。
7. 从源码、SDK、缓存、AI 服务之外运行检查；正式游戏不能依赖开发机字体或服务。生成文件/包哈希与验收报告。
8. 候选成功后完成到新的版本目录；失败保留旧发行目录。不要把 Windows 多文件复制/覆盖描述为目录级原子发布。

发布清单必须覆盖所有声明资源的加载依赖，不按剧情静态可达图裁剪；没有引用的原稿不自动入包。额外 include 不能含目录/通配/越界/重复/缺失项、符号链接或引擎保留用户文件。低层原始容器 API 不替代 CLI 发行策略。[06 调试与构建发布](06-debug-build-release.zh-cn.md)

### 8.2 VSIX 与工具供应

E0 建立并记录 typecheck、lint、领域/源码测试、宿主集成测试、构建和 VSIX 组装脚本；实际命令实现后再写进根 README。每个阶段都能打包一个内部 VSIX，E5 才达到离线工具/模板完整交付门禁。

VSIX 使用显式文件白名单，包含编译后的扩展/Webview、schema、模板、匹配平台工具、工具哈希/版本清单与许可；排除源码开发依赖、测试原稿、缓存、AI profile/密钥和调试令牌。工具更新必须经固定版本来源及哈希核验，不运行工程提供的任意可执行文件。

开发者源码构建 content-tool 可以需要 Rust；正式作者安装 VSIX 后不得要求 cargo、SDK 或模型服务才能手工创作。是否可随附播放器/Core 要在真实授权与依赖核验后决定，未解决的发行依赖不能标记 E5 完成。插件 Marketplace 发布与游戏公开上传是额外操作，不是本地打包成功后的自动步骤。

## 9. 分阶段任务与验收门禁

阶段估算沿用 [07 路线](07-roadmap-validation.zh-cn.md)：E0 1–2、E1/E2/E3 各 2–3、E4/E5 各 1–2 人周，合计 9–15 人周。口径为一名熟悉项目的开发者加持续作者/QA 参与；上游 API/素材授权缺失会影响进度，E0 后重估，不作为日期承诺。

| 阶段/任务包 | 可交付结果 | 必须通过的出口 |
| --- | --- | --- |
| E0-A 工程骨架 | npm workspaces、扩展激活、UI 构建、fixture 与内部 VSIX | 干净环境可按实际脚本构建/安装；锁定最低宿主与工具版本 |
| E0-B 往返试验 | 一份真实 story XML 的 Custom Editor、局部台词补丁、源映射 | 文本/分镜双向同步、多个视图、撤销/重做；注释/空白/Opaque 不变 |
| E0-C 宿主与快照 | 含未保存 XML/JS 的完整冻结代次、版本冲突与取消 | 不误用旧磁盘内容，不覆盖新缓冲；快照不随源改变 |
| E0-D 外部边界 | 实际 CLI 检查/调试握手原型、AI mock/探测原型、依赖登记 | 核对真实工具；本地/远程 AI 验收方案明确，未接入服务不冒称通过 |
| E1-A 工程与分镜 | 首页、工程树、模板创建、完整幕/资源表单、稳定 ID | 无 AI 创建受管 demo；重排不改路由，复制获得新 ID |
| E1-B 路由与提交 | 类型化变量/条件/有序更新、差异预览、最小 journal | Advance/Choice/End 经真实引擎验证；失败不提交，基本 undo/冲突可用 |
| E1-C 试玩闭环 | 静态舞台、Problems、完整代次与自有播放器生命周期 | 无代码作者从入口完成分支 demo，隔离存档，退出码和清理正确 |
| E2-A 现有工程接管 | 多章节、Managed/Recognized/Opaque、最小补丁 | 合法未知代码保真；外部编辑/缓冲冲突拒绝旧补丁 |
| E2-B 资源与恢复 | 引用图、图集/点九/模型依赖、完整 journal 与恢复 | 替换缓存失效、越界/碰撞诊断；磁盘满/锁文件/崩溃可恢复 |
| E2-C 规模 | 虚拟分镜与有界索引/解码、100/1000 幕报告 | 操作不触发全量重复解码；取消与大文件处理有证据 |
| E3-A 服务客户端 | profile/秘密、能力探测、HTTP/SSE、错误/取消 | mock 契约集合通过，真实本地与远程服务分别记录 |
| E3-B 提案审阅 | 拆幕/关联/描述、来源、差异与可撤销应用 | 原文保真、无效引用为 0、过期提案拒绝，冻结集合评估 |
| E4 IDE 调试 | DAP、帧/XML 断点、只读状态/候选、轮询与路线记录 | 真实播放器验证单次提交、修订、去重、回滚、自循环与重连 |
| E5 发行 | 匹配工具、发布清单、KPAK 1/2、离线 VSIX/模板 | 全包自检、许可证/隐私检查、无源码/AI 服务环境可独立运行 |

所有阶段都执行信任/凭据边界；E2 的复杂恢复不意味着 E1 可跳过基本防覆盖。E0 的调试/AI 原型只验证边界，完整用户流程分别在 E3/E4 交付。

### 9.1 第一轮实施清单

首个开发迭代以 E0 为范围，任务按以下依赖顺序推进：

1. 登记实际引擎/工具来源和哈希，取得合法 demo/UI/字体许可；明确不可用依赖。
2. 创建 extension、webview、domain、source、protocol 最小包和构建/测试脚本；先不铺开全部空模块。
3. 注册 `kakera.storyboard`，展示 frame 卡片和源码定位；坏 XML 仍可切回源码修复。
4. 完成一次局部台词修改 → 候选验证 → WorkspaceEdit → undo/redo → 双视图同步。
5. 补充未保存 JS、外部改动、过期结果、BigInt 和 Opaque fixtures，锁定解析器及补丁策略。
6. 从缓冲生成私有代次，运行真实 `--check`；用真实播放器完成 status/断点/advance/resume 的最小契约验证。
7. 做 AI HTTP/SSE mock 与可配置端点探测，定义真实本地/远程服务验收记录，不因服务缺失阻塞手工编辑原型。
8. 输出 E0 验收记录、失败样本、最终版本清单与修订估算，更新 README 的实际运行命令，再进入 E1。

### 9.2 测试分层与证据

| 层级 | 重点 | 不能替代的检查 |
| --- | --- | --- |
| 领域/源码单元与 golden fixtures | ID、完整状态、受限条件、i64 边界、局部补丁和未知区域字节保真 | 真实引擎语义 |
| VS Code 宿主集成 | TextDocument、多视图、undo/redo、自动保存、信任与诊断 | 外部媒体/GUI 行为 |
| 协议/故障注入 | SSE、JSON Lines 分片/超限、去重、版本冲突、取消、IO 恢复 | 真实服务/播放器兼容性 |
| 引擎端到端 | 合法 demo、目标条件/隐藏选择/自循环、变量与历史回滚 | 设备显示、音轨与主观听感 |
| 发行验收 | VSIX 白名单、工具版本/哈希、KPAK 自检、清单/许可证、独立运行 | 未覆盖动态剧情的正确性 |

CI 先执行可离线复现的静态、fixture 和 mock 检查；Windows 宿主/引擎集成在专用任务运行，真实 AI 服务采用显式配置验收，不在普通 CI 中外发原稿。没有授权 Core、服务或播放器时报告未运行项，不用跳过结果冒充通过。

## 10. 风险与决策记录

| 风险 | 决策/缓解 | 决策时点 |
| --- | --- | --- |
| 上游源码/二进制/模板未提供 | 建版本与依赖登记，先验证真实 CLI；Rust 包公共边界单独确认 | E0，影响试玩与发行门禁 |
| 无损往返比预期复杂 | E0 用真实保真 fixtures 选型；E1 仅 Managed，Opaque 只读 | E0/E2 |
| 宿主保存/撤销不构成工程事务 | TextDocument 与 journal 分工，故障恢复与私有代次隔离 | E0/E1，E2 完整故障注入 |
| 调试无推送/源码指纹 | 串行有界轮询，自有启动冻结源映射，暂不开放任意 attach | E4 |
| AI 服务“兼容”程度不同 | 分能力探测、显式降级、mock 加两类真实服务验收 | E3 |
| 大资源占用与取消困难 | 分层校验、流式摘要、有界解码、专属可终止进程 | E0/E2 |
| Core/字体/模型分发条件未明确 | 用授权明确模板起步；完整模型能力与产品供应独立核验 | E0/E5 |
| 将规划当成功能说明 | README 能力表、阶段出口和实际证据同时更新 | 每次交付 |

需要增加引擎能力时，先记录现有契约缺口、最小上游修改和兼容策略；新能力未落地前不伪造 CLI 参数或在插件侧绕过事务。首版的可交付标准是合法内容、源码保真、可恢复编辑与真实运行闭环，随后用同一核心扩展 AI、调试和发行。
