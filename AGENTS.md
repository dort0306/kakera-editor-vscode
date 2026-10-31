# 仓库协作规范

适用于本仓库及子目录；更深层的 `AGENTS.md` 可补充对应模块的约束。文档与面向作者的说明优先使用简体中文，标识符使用清晰的英文。

## 1. 先确认事实与任务边界

- 当前基线为 Kakera 播放器 v0.11.3：story 8、UI 3、save 9，调试协议 v1，demo content-version=11，JS 注册使用 `frame(id).advance/choice/end`、独立 `event.register(id, callback)` 定义，XML `event` / 单参数 `ui(id).bind(eventId)` 引用，UI 额外支持 `component.register` 组合标签、repeat 通用分页与 `<particles>` 2D 图片粒子。插件已有 0.11.3 开发预览实现；实际能力和未完成项见 [实现记录](doc/12-implementation-status.zh-cn.md)，不要把全部规划当成交付。
- 未实现的下版本规划在 [PLAN.md](PLAN.md) 里。根 README 只保留项目简介、构建与测试方法和许可证；能力状态见 [20](doc/20-capabilities-status.zh-cn.md)，日常操作见 [21](doc/21-usage-guide.zh-cn.md)，引擎同步与版本增量见 [22](doc/22-engine-sync-notes.zh-cn.md)，逐版本变更见 [CHANGELOG](CHANGELOG.md)。新增内容按此分工放置，不往 README 堆功能说明或路线图。
- 本文件初次编写时仓库只有文档与许可证，没有插件源码、引擎源码、构建系统或测试。开始任务时重新检查实际文件，不把规划目录和命令当作已经存在。
- 当前实际检查命令为 `npm run check`、`npm run test:browser`、`npm run test:integration`、`npm run test:host` 和 `npm run package`。浏览器测试需本机 Edge/Chromium；引擎/宿主检查需要已准备的匹配工具/本机 VS Code，详见 README。独立 Rust wrapper 仍未实现，当前通过真实 CLI 复用引擎。
- 本仓库负责 VS Code 插件及其内容工具适配，不默认承担上游引擎改造、Code-OSS 分叉或独立桌面壳。
- 不虚构包脚本、可安装 VSIX、服务兼容性、测试通过或性能结果。实现完成后同步更新 README 中的实际命令、[能力状态](doc/20-capabilities-status.zh-cn.md)和 [PLAN.md](PLAN.md)（已实现条目移出规划）。
- 保留用户已有修改，不在未请求时搬迁工程、全库格式化、下载模型、发布插件或上传游戏。

## 2. 阅读与依据

先阅读 [README](README.md)、[能力与状态](doc/20-capabilities-status.zh-cn.md)、[PLAN.md](PLAN.md) 和[插件落地方案](doc/11-vscode-extension-implementation-plan.zh-cn.md)，再按任务读取原始设计：

| 任务 | 必读依据 |
| --- | --- |
| 产品与分镜 | [01](doc/01-product-workflows.zh-cn.md)、[02](doc/02-architecture-project-compiler.zh-cn.md) |
| 源码、领域命令与事务 | [02](doc/02-architecture-project-compiler.zh-cn.md)、[05](doc/05-editor-api-proposal.zh-cn.md) |
| AI 与凭据 | [03](doc/03-ai-api.zh-cn.md)、[05](doc/05-editor-api-proposal.zh-cn.md) |
| 引擎、试玩与发行 | [04](doc/04-current-engine-api.zh-cn.md)、[06](doc/06-debug-build-release.zh-cn.md) |
| DAP 与播放器协议 | [10](doc/10-player-debug-api.zh-cn.md)，不得根据 DAP 名称猜引擎能力 |
| 阶段、支持平台与验收 | [07](doc/07-roadmap-validation.zh-cn.md)、[09](doc/09-editor-platform-comparison.zh-cn.md) |

第 05 篇全是拟议编辑器接口，第 10 篇才是已有播放器协议。原始文档指向的上游 `src/`、`tests/`、demo 和版本验收可能不在本仓库；需要实际取得后才能宣称核对或运行。发现契约冲突时记录差异并更新相关设计，不能悄悄改引擎格式来迁就插件。

## 3. 模块与执行边界

- 按落地方案拆分 extension、webview、domain、source、protocol、ai-client、debug-adapter 和 Rust content-tool；这些是规划目录，按阶段建立。
- domain/source/protocol 不依赖 `vscode` 或浏览器 UI；Webview 只通过版本化白名单消息请求宿主操作。
- Extension Host 持有文档、凭据、网络和进程生命周期；大资源解码、引擎校验、打包放有界后台任务或独立进程。
- 复用引擎的 QuickJS、Controller、资源和打包规则；禁止在 Node、Webview、`eval` 或 `Function` 中执行游戏脚本。
- 使用参数数组启动工具，不把工程名、文件名、模型结果或设置拼成 shell 命令。取消只能停止当前任务拥有的进程。
- 第一版只支持 Windows 本地桌面工作区。远程、虚拟工作区和浏览器环境要明确限制，不能把远程 loopback 当作用户电脑。

## 4. 内容与源码不变量

1. XML/JS 是内容事实来源。已打开文件以 `TextDocument` 当前版本和内容为准，冻结验证必须包含相关未保存缓冲。
2. 一格是一整个 `frame`；背景、音频、三个人物槽与最终姿态按引擎完整状态导出，不发明跨幕继承或任意坐标。
3. 新建幕只生成一次稳定显式 ID；复制新建 ID，重排/改名不改 ID。导入缺省 ID 不自动补齐，需显示旧档兼容风险。
4. 分镜重排不自动重连剧情；章节 `next.src` 仅是文件合并链。Advance、Choice、End 必须有明确注册与目标。
5. JS 分为 Managed、Recognized、Opaque。未经明确接管不整文件重写；Opaque 原文保留，未知动态目标显示为不确定。
6. XML 使用范围编辑或保格式语法表示；不得把完整模型重序列化或正则替换称为无损往返。
7. 受限条件只做类型化比较和布尔组合，有序更新只生成合法 `set/add`。i64 在跨进程/前端数据中使用十进制字符串，生成 JS BigInt，禁止先转 Number。
8. sidecar 仅保存标签、布局、管理范围、来源与恢复信息，不维护另一份优先于 XML/JS 的剧情；`game.enter` 仍只有一个同名回调。
9. 标题写入 UI title/绑定变量初始值，不用 story.id 冒充展示名。人物名更新保持 character.id；人物外观库使用实际单人物 visual，放入幕时复制完整画面并保留其他槽位。关系图按路由解析，未知目标不猜边，布局不改源码。
10. 同一分支的普通续接幕保持水平行和颜色，分叉分色、汇合共用节点。新建幕是明确的路由修改：推进幕插入并保留原后续，选项幕按 XML 选项顺序填首个待连接项，满连接时不覆盖既有分支。
11. 尚未连接的可视路由使用源码中带明确标记的合法 End 幕保留，界面显示待连接节点；不伪造引擎未支持的空目标，不把真实自循环猜成未连接。插件构建阻止未连接占位。删除幕保留其他场景，明确后续可重连，否则保留待连接，不能替作者选择分支。
12. JS/XML 实时映射使用全部已声明脚本的当前缓冲，按语法树范围和幕 ID/name 关联；格式或注释变化不能使整工程降级。Recognized 只修改明确节点；受限类型化 if/else 与三元分流可编辑，未识别条件/共享函数显示候选目标，动态注册和歧义说明具体原因。按幕开放路由编辑；全局入边不确定时禁止自动删除，不执行脚本来做静态分析。
13. 手动拖动位置和图集区域预设存于 `.editor/workbench.json`，不是剧情或 UI 的另一份事实来源。拖线明确修改已识别路由且保留选项/条件/更新；断线使用合法待连接占位。点九生成真实带标记边框的 PNG，图集应用写真实 UI image/region，密度只属于 nine-patch 控件。
14. 图片解码/生成在有界 Worker 中执行。编辑资源保留 ID，输出到新的 UUID 文件并经引擎验证后改引用，不覆盖原二进制；失败后不得清理仍被当前缓冲引用的文件。布局和区域预设不进入游戏发行包。
15. 流程图导出读取当前源码缓冲与布局，保留动态/待连接标记，不把候选关系说成实际运行结果。SVG 不依赖 Webview/CSS/外部资源，HTML 提供完整清单且不执行脚本；用户文本需转义。导出不得覆盖游戏源码/资源或未保存的目标编辑，也不改变剧情内容。

16. 条件分流在单个 Advance/Choice 回调内保存为有序类型化条件与明确默认目标；先执行公共有序更新，再按首个满足条件选目标。所有条件和默认出口参与引用、待连接、连线、删除和导出；不得把已识别条件分流当作动态候选或代替作者选择默认分支。

17. UI 编辑以入口和 include 子文件的当前 XML 缓冲为事实来源；路径相对游戏根，严格处理 128 文件/16 层/源与合并各 1MiB 预算、重复与循环。控件稳定 ID、父级相对坐标、点九内容区和 repeat 模板应保留；局部修改原文件，不把预览示例数据写回剧情。已有 JS 事件不自动重写，新事件仅追加白名单动作。

## 5. 修改、并发与恢复

- 写入统一走 Command → ChangeSet → 候选生成/验证 → 版本复查 → Apply。检查工程 revision、相关 `TextDocument.version`、源和资源哈希。
- 根据用户明确要求，日常手工编辑、新建/删除幕与资源导入直接后台验证、应用并保存对应文件，不再弹源码差异或“校验并应用”确认。AI 提案和发行清单仍保留各自审阅。保存只涉及本次文件，不用 Save All 保存无关缓冲。
- 修改打开的源文件使用 `WorkspaceEdit`，订阅文档变化同步所有分镜视图；不以 `fs.writeFile` 覆盖缓冲。
- 一个作者操作记录可恢复的变更及逆操作。撤销不重新调用 AI；外部修改导致冲突时先合并。
- `WorkspaceEdit` 不等于多文件磁盘原子事务。显式保存使用事务日志、前后内容和完成标记；恢复时复查用户后续修改，禁止直接覆盖新稿。
- 多文件事务中的保存、自动保存、撤销与崩溃行为必须实测。不能声称插件能拦截宿主所有普通保存；发现磁盘部分落盘时阻止相关试玩/构建并进入恢复。
- 校验、试玩和构建读取私有冻结代次，播放器不监控多文件写入中的 canonical content。源改变后丢弃过期输出。
- 缓存包含内容哈希和相关版本；取消不应用部分结果。大资源流式处理，分镜与缩略图任务必须有界。

## 6. 路径、凭据与 AI

- 所有 ContentPath 先验证相对路径、规范化边界、Windows 大小写冲突及符号链接/reparse point，不能仅检查字符串前缀。
- 工作区未信任时只读查看，禁用写入、工具执行、试玩/构建和 AI 外发；命令处理器也要校验，不能只隐藏按钮。
- Webview 限定本地资源根与 CSP，所有输入按数据处理；密钥不进入 Webview、项目、日志、提案或发行物。
- AI 使用用户配置的 Chat Completions 兼容服务，密钥走 SecretStorage；不强制模型、不自动下载权重，不默认上传完整工程。
- 发起任务前显示服务/模型、选中原文、素材数量及是否含图片；文本/图片/流/结构输出能力分别探测。
- AI 仅生成白名单 Proposal，经结构、引用、类型、revision 校验和作者审阅后编译。拒绝 shell、任意路径、改既有 ID、删除资源或接管 Opaque 的模型指令。
- SSE 未完成、截断、取消、过期或错误响应都不得落源码。HTTP 客户端不忽略证书错误，不跨主机转发凭据；日志净化并限制大小。

## 7. 调试与发布

- 播放器使用 TCP UTF-8 JSON Lines v1，不是 HTTP 或 DAP；DAP 由适配器转换。每条请求鉴权，控制使用最新 `expected_revision`。
- 同一服务生命周期请求 ID 全局递增。重发必须使用原 ID 和完全相同的字节；超时/断线后先以新 ID 查询状态，不能盲目重复 advance/choose。
- 关联进程、地址、凭据、快照和源码映射；单控制队列串行请求，遵守 64KiB 请求、2MiB 响应及队列限制。
- 断点停在候选提交前，区分当前幕与 `pending_frame`，包括自循环；`next` 不保证每次跨一幕。
- 不提供引擎没有的任意 jump、setVariables、eval、条件断点、JS 行级步进或推送事件。变量面板只读。
- 试玩从入口启动，使用独立 save-dir；只管理自己启动的播放器。既有会话不悄悄替换成新代次。
- 使用匹配的 `kakera-pack` 及 v0.11.3 依赖选择，额外文件只走 `kakera.package.json` 显式文件清单，保留排除规则。
- 包和发行候选位于内容根之外，失败保留旧产物；发布前全包检查、许可证/隐私清单检查及源码外运行验证。公开上传需另有任务授权。

## 8. 验证与交付

- 先找实际 manifest、锁文件和 CI 再选命令。没有脚本时说明缺失；建立脚本后把可执行命令同步到 README。
- 文档任务检查本次新增/修改的链接、代码块、阶段状态与契约一致性；记录继承的上游缺失链接，不虚构其内容。
- 代码按影响范围验证：源码往返与 Opaque 字节保真、稳定 ID、未保存缓冲、冲突/恢复、过期/取消、资源依赖、i64 边界。
- 宿主集成验证 Custom Editor、多个视图、撤销/重做、Workspace Trust 与进程退出码；真实 GUI/音频/模型检查单列结果。
- AI mock 覆盖协议异常与凭据净化，真实本地/远程服务另验；调试 mock 不替代匹配播放器的断点/回滚/重连验证。
- 构建验证 VSIX 安装、实际文件白名单、KPAK 全量自检、无源码/AI 服务的独立游戏运行；无工具或授权素材时明确未执行项。
- 避免给低影响文档改动添加无关测试。实现测试覆盖可观察行为与风险，不只复述实现。
- 每次只测试与本次改动有关的必要部分，尽量精简单元测试：不新增加固未受影响代码的用例，一个针对性用例能证明的行为不重复堆测；未覆盖的风险在交付说明里明确列出，而不是靠扩测掩盖。
- 交付说明包含改了什么、实际检查、未验证部分和剩余依赖；能力实现后同步相关文档，不把计划阈值标成实测值。
- 每次实现新功能或可观察的行为变化（能力、交互、界面增量）都要在交付前打包，并把 `artifacts/kakera-editor-vscode-x.y.z.vsix` 一起交付，不只限于用户点名要打包时；纯文档、注释与测试整理不重新打包。打包放在版本号与 README/CHANGELOG 更新之后，若打包后又改动会进包的文件（README、CHANGELOG、`dist` 资源等）就重新打包一次。版本号与制品规则见下两条。
- 打包 VSIX 时若用户未指定版本号，默认把当前 `package.json` 的 patch 位 +1（x.y.z → x.y.(z+1)），并同步 `package-lock.json`、`package` 脚本的制品名、README 当前版本与 CHANGELOG；匹配播放器/引擎版本（vX.Y.Z）不随插件 patch 自动变化。制品输出到 `artifacts/kakera-editor-vscode-x.y.z.vsix`，交付时记录实际文件数和 SHA-256。
- 插件版本号 `x.y.z` 的 `x.y` 部分必须与匹配的上游引擎保持一致：上游引擎升级到 `vX.Y.*` 时，插件同步到 `X.Y`；`z` 只表示同一引擎兼容范围内的插件自身修复或增量。准备工具、工程清单/调试/构建版本检查和文档当前版本都要匹配该 `x.y`。

## UI 演出增量约束（0.6.2）

- v0.8.4 当前增量含 ui-media/screen.sequence/button.sound，旧同版本 release 工具可能没有这些能力；准备工具前从对应源码构建，并用真实引擎验收。
- 演出/音效声明属于实际 UI XML；编辑器静态预览不执行演出、随机选音或偏好写入。玩家 ui-audio.json 排除出冻结代次和发行包，不作为创作源文件。
- 编辑选中媒体声明只替换其局部范围；保留其他声明和 JS，未知属性拒绝编辑。序列引用、重复列表目标、角色音效归属与生命周期交给匹配引擎最终验证。

## 幕/页面生命周期与隐藏交接（0.7.0）

- v0.9.0 起视频只在 UI `ui-media.sequence` 中；frame 级 `<video>`、`ctx.skipVideo`、`game.videoPlaying/game.videoSkippable` 已移除。编辑器不得重新生成，并应显示可定位的迁移诊断。
- `frame(id).enter/exit` 与 `ui(id).bind("screen.open"/"screen.close")` 是独立生命周期注册，不是 `frame(id).advance/choice/end` 或按钮事件；静态映射可显示源码位置并保护被引用幕/页面，不得把它们伪造成剧情边。
- `ctx.present/resume` 受隐藏交接事务约束；事件向导只追加白名单调用并先校验页面/实际幕目标。编辑器不执行交接、不重放生命周期、不写隐藏槽。
- 固定隐藏 `flow-checkpoint.json`（schema 1）和玩家 `ui-audio.json` 一样排除出冻结代次、监控和发行包；save 9 的 `resume_to`、UI 返回历史和条目校验由匹配播放器负责，编辑器不迁移旧档。
- 删除幕/页面前检查生命周期与静态 `ctx.resume/present` 引用；动态目标无法证明时保守拒绝或保留诊断，不替作者猜测。

## 界面与交互（0.8.0）

- Webview 采用应用栏、工程侧栏、主编辑区、属性检查器和状态栏的 IDE 壳层；工程设置/图片工具使用可关闭抽屉。窄窗口通过媒体查询改为单列并保留全部入口，不能用隐藏面板替代功能。
- 新控件复用统一设计令牌、内联 SVG 图标和语义状态（按钮、标签、提示、禁用、只读）；不引入外部字体、网络图标或会泄漏资源的 URL。
- 保留已有无障碍名称、按钮文字和测试选择器；拖拽/画布/格式化的作用域不能因布局变化扩大到整页。Esc 关闭当前抽屉，不干扰画布/图形组件自己的取消逻辑。
- 界面重构不得改写 XML/JS 内容、命令 payload、保存事务、冻结代次或引擎契约；视觉截图和浏览器 DOM 回归不能替代真实 VS Code 宿主/播放器验收。
- 图/画布拖动必须在真实工作台 DOM 中验证命中、移动和保存请求，不能只用独立组件或 jsdom 桩。开始拖动后即使宿主重绘导致 pointer capture 丢失，也应继续手势或用窗口级 pointerup 提交，不得静默回弹/卡住；拖动结束要清理状态，普通点击和连线不能被误判为拖动。

## 工程图标与视觉色调（0.10.4）

- 根目录 `kakera.svg` 是唯一图形来源，四个碎块与四个品牌色（`#0058E0`/`#008AFF`/`#0060A8`/`#FF6FE3`）不要自行改色或另画标识。`resources/kakera.svg` 是派生出的 24×24 单色标记，`resources/kakera.png` 是同一图形的 256×256 渲染，分别用于 Activity Bar 与清单 `icon`；更换图形时三处（含 Webview 内联 `KakeraMark`）一起改。
- VS Code 把扩展 Activity Bar 图标当 alpha 掩膜着色。图标文件必须保持碎块之间的透明缝隙和单一填充色，不能改成位图、渐变、滤镜或大面积实心块，也不要假设文件里的颜色会显示出来。
- 主题颜色走 `style.css` 的 `--k-*` 令牌（含 `--k-mark-*` 品牌色与 `--k-accent-2`）；深色与浅色主题各自配平，不要在组件里写死主题相关颜色。品牌色在两种主题下保持同一值。
- 需要图标时优先复用 `icons.tsx` 的内联 SVG（`currentColor`、无外部字体/网络图标），面板/抽屉标题用 `.panel-icon` 图标块；新增图标要同步 `IconName` 与 `paths`。加图标不得改变按钮文字、`aria-label`、CSS 选择器和测试选择器（测试用 `textContent` 精确匹配按钮文案）。
- 视觉改动只属于呈现层：不改 XML/JS 写回、命令 payload、保存事务、冻结代次和引擎契约。`contributes.customEditors` 没有图标字段，不要用文件图标主题接管或伪造自定义编辑器标签图标；浏览器截图与 DOM 回归不能替代真实 VS Code Activity Bar/标签页验收。

## UI 显式起始幕与末幕退出（0.8.2 / 引擎 v0.9.1）

- 控件事件和自动 `screenClose` 复用 `ctx.resume(frame?)`；显式幕用于重新开始/进入隐藏剧情，省略时读取隐藏槽 continuation。首次没有隐藏槽且无目标由播放器拒绝，编辑器不伪造隐藏状态。
- 可视化事件只写显式 `ctx.open(页面); ctx.resume(幕);` / `ctx.resume();` 或生命周期单条固定调用；目标必须是实际幕/页面，待连接占位、缺失页面、显式目标与关闭回调冲突都拒绝。指定幕沿用隐藏槽变量/历史，不等于 `ctx.restart`。
- 末幕不再因末幕身份被禁止 `frameExit`：文字完成后的手动继续执行一次，补全不触发，自动播放/Ctrl 仍在结尾停止；UI 返回同一末幕不重放进入/退出。编辑器提示不得再写“结束幕没有离幕动作”。
- 引擎版本升级到 v0.9.1 时同步工具哈希、工程清单/调试版本检查和真实 `--check`；不修改上游数据格式，不把静态源码校验当成运行时隐藏槽/跨进程验收。

## 事件编辑与幕 ID 重命名（0.8.3）

- 事件修改/删除只作用于可证明的单一固定回调定义（v0.11.1 起为 `event.register("字面量事件", (ctx) => { 固定动作 })`，更早为目标作用域 bind）；带注释、自定义语句、重复定义或非字面量名称的注册保留源码。改名只同步可证明的控件 `event` 或页面 `background-click/background-right-click` 与单参数 bind；删除前必须确认没有这些引用。
- 幕 ID 重命名要同步 `<frame>` ID/name、入口、已识别推进/选项目标和连接。存在动态/未识别路线、`frame(id).enter/exit`、`ctx.resume` 等引用时拒绝，不做猜测性替换；分镜手动位置迁移可以暂不处理，但不能改错源代码。
- 所有改写走已有 revision/WorkspaceEdit/撤销/保存链；新增说明文档必须与实际按钮、限制和验证结果一致，不能把规划能力写成已交付。

## CG 资源与共享解锁（0.8.4 / 引擎 v0.9.1）

- `<cg>` 是专用图片资产，不能伪造普通 image 或点九；`<visual cg>` 与 `background`/`portrait` 严格互斥，CG 运行帧无人像叠加。动画/加载不自动解锁，解锁时机由作者 JS 决定。
- 画廊中专用 CG 的 ID 必须等于资源 ID；编辑器可把自动条目写为显式 `<gallery><cg>` 中文标题/初始 unlocked，不把默认自动条目误报成用户声明。普通 image 收藏项仍可自定义 ID。
- `game.cgId` 是当前幕专用标记，普通幕为空；`cg.total/unlocked/progress` 来自独立 profile 集合。编辑器只读展示/生成绑定，不写 profile.json 或隐藏槽，不把加载资源当解锁。
- CG 资产导入必须走有界图片校验、许可记录和撤销/保存链；资源引用检查需覆盖 visual/portrait/UI 与 gallery。真实引擎 `--check` 和 KPAK 回归不能由静态源码测试替代。

## 短 ID、侧栏定位与流程图快捷键（0.8.9）

- 幕条目定位必须复用已打开的工作台并设置 `selectedFrames` 后刷新，不重复开 tab；无工作台时通过文件 URI 的待选映射在首次 ready 前注入。
- “剧本”必须是 XML 文件 → 幕两级；文件节点使用稳定文件路径 id，幕仍按全工程稳定 ref 关联。
- 编辑器自动生成的稳定 ID 统一为 8 字节随机数的 16 位十六进制短格式：幕、人物、立绘/模型资源、导入资源、visual/外观、UI 页面/控件、点九/图集与图片工具示例控件。必须检查对应命名空间冲突，64 次后才回退 UUID；已有手写或历史 ID 不批量改写。待连接占位、复制、AI 拆幕和工程模板都走同一生成器。
- 幕流程图支持 `Ctrl+A` 全选、`Ctrl/⌘/Shift` 单击多选、方向键/`Home`/`End` 切换、`Shift+方向键` 扩展、`Alt+方向键` 批量微调、`Delete/Backspace` 批量删除、`Ctrl+D` 复制、`Ctrl+C/V` 在当前工作台内复制粘贴、`Ctrl+F` 搜索、`Ctrl+S` 保存当前幕草稿；输入框、下拉框和 contenteditable 中的原生快捷键不得被拦截。
- 批量删除/复制/布局必须一次源事务提交：删除保留至少一幕，无法证明的多入边保留待连接，不替作者猜分支；批量布局一次写 `.editor/workbench.json`，不改剧情。只读状态允许选择查看但禁止写入。

## VS Code 原生工程侧栏（0.8.8）

- Activity Bar 的 `kakera.project` 使用原生 `TreeView`，不得用 Webview 模拟侧栏。分类、图标、计数、描述、工具提示和右键菜单都使用 VS Code API/主题，保持与本体一致。
- 条目必须携带稳定 `id`、`contextValue` 和明确的命令参数；分类/人物/变量/幕的新建、删除和编辑必须走 source/session 事务，不能在树里维护第二份内容。
- 侧栏在激活时加载，并在文档/文件变化后刷新；命令修改后也必须更新树，失败保留旧树。真实宿主回归要检查贡献命令、菜单 when 条件和树激活加载。
- “界面”分类按入口和 include 的实际 UI XML 列文件；左键以可视化编辑器打开对应文件，右键提供打开源码。不要用 Webview 或猜测文件列表代替 `uiFragments`/有界 UI 文件遍历；子文件定位只读取该文件已声明页面，不改写 XML。

## 变量编辑/删除（0.8.7）

- 故事变量 ID 和类型创建后固定，避免静默破坏脚本、条件和绑定；可编辑初始值及 int min/max，范围必须保持 i64 且初始值在范围内。
- 删除变量前检查已识别路线条件和更新；无法证明的 JS/动态引用交给真实引擎验证，失败不得落盘。不得只改 Webview 状态替代 XML 范围补丁。

## 多起始幕与 UI 首次进入（0.8.6 / 引擎 v0.9.1）

- `story.entry` 是至少一个空白分隔的 ID/name 列表；未知、空列表、重复或不同别名指向同幕都拒绝。列表顺序不代表默认进入；播放器首次只显示 XML 初始 UI，必须由 UI `ctx.resume("入口")`/`ctx.restart("入口")` 或读档显式选择。
- 编辑器可增删起点、设为唯一入口；关系图所有起点都是根。删除/重命名入口幕只改列表中对应项，不覆盖其他起点。不得把列表第一项当自动入口。
- `ctx.restart(frame)` 目标必须是已声明起点；多起始幕的无参 restart 拒绝。事件向导可先 `ctx.open(页面)` 再 restart/resume，但只有可证明的单个固定事件回调（v0.11.1 的 `event.register` 定义）可重写。
- 调试状态 `game_started=false` 时 `frame_id/frame_name` 为 null；未进入状态禁止推进/保存/自动播放。编辑器不伪造成已进入，也不写隐藏槽。
- 真实播放器集成测试需要 UI 起始输入；测试辅助代码只能添加在测试工程/测试脚本中，不进入产品模板。静态 `--check` 不能替代真实起点选择后的 DAP/生命周期验证。

## 流程图视口平移（0.8.5）

- 空白背景拖动只改变 `.graph-scroll` 的滚动位置，不得写入 `.editor/workbench.json`、移动幕卡或触发布局保存；幕卡/端点/边缘的指针手势优先，背景命中层必须位于它们下方。
- 使用窗口级 pointermove/pointerup 回退处理 pointer capture 丢失；Escape 和取消应清理平移状态。真实工作台 DOM 回归必须同时验证“空白拖动改变滚动”和“未新增 layout 消息”。

## UI 扩展：快捷弹窗、快捷键与 HSV（0.10.0 / 引擎 v0.10.0）

- 快捷确认弹窗使用普通 XML 模态 `screen`、现有控件/颜色/绑定和 `route="close"`，不得新增固定原生对话框或动态执行字符串。`ctx.quit()` 只允许普通事件回调（v0.11.1 的 `event.register` 定义）；编辑器不触发 frameExit/screenClose、不写新手动槽或隐藏槽。
- 玩家快捷键只写 `ctx.captureShortcut`、`ctx.cancelShortcutCapture`、`ctx.keybinding`、`ctx.resetKeybindings` 等普通 UI 命令；绑定须符合 v0.10.0 token/ASCII/保留组合/前缀冲突规则。`keybindings.json` 是玩家偏好，由匹配播放器加载和原子保存；编辑器不读取、不写入、不把显示 Label 当存储格式。冻结代次和发行包排除 `keybindings.json`/`ui-colors.json` 的大小写变体。
- HSV/配色只使用 UI 3 扩展：`color-picker`（必需 UI string `value` 与普通 event，`alpha` 可选默认 true；`alpha=false` ≥128×128、默认/true ≥128×154，最多 8 个，不能放入 repeat）、`color-bind`（panel/image/nine-patch/label/button/toggle，来源限 `ui.<string>`/`colors.<槽位>`，与 `color` 互斥）、根级 `palette`（`[a-z][a-z0-9_]{0,63}`，最多 32 个）。颜色值规范为未预乘大写 `#RRGGBBAA`；拖动只产生候选，由作者 `ctx.setUi` 决定提交。色盘按 `D=min(width,height−R)`（`R=alpha?26:0`）居中，控件只绘制环/正方形/可选 alpha 条，不内置预览或 HEX；作者用 `color-bind`/`bind` 读取同一草稿组合展示，矩形内留白不启动选色。palette 与 UI string 是引擎的分层设计：选色器不能直接绑定槽位；新增/修复选色器时必须保证存在直接 `ctx.setUi(草稿, ctx.value)` 更新事件，不能把其它固定动作当成提交。`ui-colors.json` 由匹配播放器维护，编辑器不创建或修改。
- 静态画布/预览只读初值与示例，不执行捕获、焦点、策略或偏好写入；真实按键所有权、冲突、回滚、DPI/指针与原生窗口必须由匹配播放器单独验收。工具升级时同步 `tools.json`、工程清单/调试/构建版本检查和真实 `--check`。

## 游戏国际化与语言偏好（0.10.1 / 引擎 v0.10.1）

- 游戏本地化默认关闭，仅由入口 `story.xml` 的 `<localization enabled="true" src="..."/>` 开启；关闭时禁止 src，章节不得重复声明。清单 schema 1、FTL、文本/语音语言、默认值和 key/参数契约属于实际内容源，不能另建 Webview 副本或自动启用。
- 文本必须来自可证明的单一来源：frame `text key`、option `text-key`、character `name-key`、变量 `label-key`、UI `text-key`/`text-key-bind`/`text-arg`、画廊 `title-key`、根 `title-key`/`title-key-bind`。无 key 的字面量保持原样；不能同时写正文与 key，不能把动态 key 扩展到非 UI string 或 `item` 任意消息 ID。
- 语言 ID 使用规范 Unicode language identifier，默认项必须属于对应集合；语音 key 必须被剧情 `audio.voice` 使用，默认语音覆盖全部使用项，字体/音频引用必须是已声明资源。编辑器读取/校验全部声明语言和 FTL，不执行 Fluent、系统语言探测或 `ctx.locale` 事务。
- UI `text-arg` 最多 16 个且 name 唯一，只允许 UI 标量、`cg.total/unlocked`、`saves.page/pages`、`locale.text/voice`；参数集合需满足默认与全部已声明语言的实际消息。超 ±(2^53−1) 的 int 不作无损数值承诺，不隐式转浮点。
- `language.json` 与 `keybindings.json`/`ui-colors.json` 等一样是匹配播放器维护的玩家偏好：不进入内容根监控、冻结代次、KPAK 或发布复制，不自动重写。编辑器只写清单/FTL/XML/JS，不写语言偏好、存档或隐藏槽。
- 静态画布只按默认文本语言和初始 UI 变量格式化预览，显示缺失占位；真实系统匹配、字体字形、语音停止/切换、偏好原子写、截图 revision、隐藏恢复和跨进程读档必须由匹配播放器单独验收。工具升级同步 `tools.json`、工程清单/调试/构建版本检查、FTL/清单预算与真实 `--check`。

## HSL 圆环与方形选色器（0.10.1 同版本增量）

- 当前 `color-picker` 替换旧 HSV 三角形：采用编码 sRGB HSL，环调 H，方形横向 S=0…1、纵向上 L=1 下 L=0；整个方形含边界可点击，拖出按轴夹取且锁定手势区域，释放终点先处理再清理。
- 黑/白保留 H/S，灰色保留 H；自身 RGBA 回显保留浮点标记，外部不同颜色重新定位，隐藏 alpha 不丢透明度或 RGB。编辑器属性色盘与只读画布示意同步，旧数学工具不参与当前选色器。
- XML/JS、UI 3、RGBA、palette 和玩家偏好格式不变；不写玩家偏好，不新增旧形状开关。准备工具前重新构建含 HSL 的同版本源码并更新哈希；真实 DOM 点阵/拖动不替代播放器 DPI/键盘/偏好验收。
- 0.10.3 起同步上游职责拆分：控件只绘制环/正方形/可选 alpha，不内置预览或 HEX；`alpha=false` 至少 128×128、默认/true 至少 128×154，色盘按 `D=min(W,H−R)`、`R=alpha?26:0` 居中。作者用 `color-bind` 面板/图片和 `bind` label 读取同一草稿组合预览/数值，矩形内留白不启动选色。静态画布应使用同一几何，不生成内置预览/HEX。

## 新版 JS 注册 API（引擎 v0.11.0 / v0.11.1）

- 剧情路由只写 `frame("幕ID").advance(targetOrRun)`、`frame("幕ID").choice("选项", targetOrRun, when?)`、`frame("幕ID").end()`；`targetOrRun` 是固定字符串或无副作用的同步回调。生命周期写 `frame(id).enter/exit` 与 `ui("页面").bind("screen.open"/"screen.close")`；全局进入钩子仍是 `ui("$game").bind("game.enter", …)`。`frame.enter:`/`frame.exit:`/`screen.open:`/`screen.close:` 是保留事件编码，不得作为普通 XML 事件。
- v0.11.1 起普通界面回调是独立定义：只写 `event.register("事件ID", 回调)`，同一 ID 只能定义一次；控件 XML `event`、页面 `background-click`/`background-right-click` 或单参数 `ui("控件或页面").bind("事件ID")` 只做引用。控件事件可省略或为空，未绑定定义允许存在；`$host` 绑定与两参数普通 `ui(id).bind(事件, 回调)` 已删除。多个控件可共享同一事件 ID，编辑器不得再按目标复制回调或按目标名去重。
- 编辑器只接管可证明的顶层字面量定义与绑定：选择器保存到变量、动态目标/事件名、函数/循环/条件内注册、共享回调、注释混合、未知方法或非白名单动作都保留源码 Opaque。事件改名只同步可证明的 XML 属性与脚本 bind；删除定义前必须解除 XML/脚本/`captureShortcut` 结果引用。保留名称与 `route` 冲突仍拒绝。
- 旧 `on.*`（以及 v0.11.0 的两参数普通 bind）启动、`--check` 与打包都会被拒绝。静态分析遇到旧注册只给迁移诊断并暂停相关可视化改写，不把旧注册猜成新事件，也不自动整文件迁移；作者按上游 API 第 37.2–37.4 节迁移后重新加载。
- 剧情 `frame()` 注册的静态字符串目标需要加入更新或条件时，只把该参数替换为内联回调，其他语句和注释保持字节；`color-picker` 自动生成的 `ctx.setUi` 事件是新的独立定义，只在该控件 XML 上引用。普通事件列表不包含 `screen.open`/`screen.close`，它们由生命周期编辑负责；`game.enter` 使用固定 `$game` 目标。
- 工具升级同步 `tools.json` 哈希、工程清单/调试/构建版本检查（0.11.1）、模板/测试新语法与真实 `--check`/KPAK 回归；静态源码测试不能替代匹配播放器的注册装配验证。玩家偏好（`keybindings.json`、`ui-colors.json`、`language.json` 等）仍由匹配播放器维护，编辑器不读写。

## 组合标签与 repeat 分页（引擎 v0.11.2）

- UI 3 新增加载期组合标签：脚本装配阶段只能写 `component.register("x-名字", { props, expand })`；标签名必须 `x-` 前缀的小写 ASCII/数字/单连字符、≤64 字节、最多 128 个且不能覆盖宿主标签。prop 名同样是小写 ASCII/数字/连字符且不能占用 `id/x/y/width/height/visible/enabled`；每个 prop 恰好声明 `required: true` 或类型匹配的 `default`，`min/max` 只用于 int/number，`maxLength` 只用于 string，`binding` 必须声明 `valueType`。
- `expand` 是同步纯函数：只能返回一个 `{ tag, attrs?, children? }`，根必须是 `panel`/`nine-patch` 且 `attrs.id="$root"`，只能输出宿主标签或已注册组合标签，不能生成 `ui/screen/include/variables/gallery/palette/ui-media`，也不能访问 ctx、会话、玩家偏好、时间、随机、网络或文件。实例 `id` 映射 `$root`，局部 ID 展开为 `实例ID.局部ID`，作者子节点必须按原顺序各插入一次。
- 编辑器只静态认识可证明的**顶层字面量**注册：动态名、别名、函数内注册、重复注册或打包进对象都只给 `componentUncertain` 诊断并暂停相关改写；未注册的 `x-*` 实例必须报错，不能当宽松解析。设计画布把实例画成虚线占位、不执行 expand；引擎 `--check` 仍是最终语义校验。
- 内置组件 `x-tabs`/`x-pagination` 的唯一来源是 `packages/source/src/ui-components.ts`（`BUILTIN_COMPONENTS_SOURCE`），新工程模板 `scripts/components.js` 必须与它字节一致（有测试断言）。插入时把注册写入**已声明**脚本（不新建文件）、变量写入入口 `<variables>`、事件用 `event.register` 追加；分页器只接受带 `page-size`/`page-bind` 的 repeat。
- repeat 通用分页：`page-size`（1–200）与 `page-bind` 必须成对；`page-bind` 引用已声明 UI int、必须 `min="1"`、`max` 不小于实际最大页数，一个页变量只能绑定一个 repeat。只读元数据绑定仅为 `repeat.<完整节点ID>.<字段>`（`page/pages/pageSize/total/start/end/canPrev/canNext/pageText`）；未分页或不存在的 repeat 引用报错。页码、页缓存、滚动与焦点都不入剧情槽或隐藏交接文件。
- story 8 / UI 3 / save 9 / profile 1 / read 1 / 隐藏槽 1 / KPAK 1、2 与 demo content-version=11 不变；旧播放器拒绝新语法，编辑器不做迁移。`--check` 只校验 XML 引用、分页声明与元数据绑定，不执行普通事件回调，命令名错误要另在源头审查或真实窗口验证。
- 新工程模板内置 `title/hud/save/load/gallery/confirm-save/confirm-quit` 七个页面、存档/读档/画廊分页与确认弹窗，并通过真实引擎 `--check`。模板“开始新游戏”使用无参 `ctx.restart()`：`kakera.project.create` 会重命名 frame ID 但不改写 `scripts/ui.js`，写死幕名会让新工程开箱即坏；测试起始覆盖也必须在重启后打开非暂停 HUD，而不是停留在暂停的标题页。

## 2D 图片粒子、UI 快捷键与布局（引擎 v0.11.3）

- `<particles>` 是普通 UI 节点：可放在 screen 或 panel/nine-patch 的直接子节点位置，不能放进 repeat；共享 `id/x/y/width/height/visible/color`，另有 `image/rate/burst/max/life/life-max/size/size-max/vx/vx-max/vy/vy-max/accel-x/accel-y/spin/spin-max/fade/autostart`。粒子没有 `enabled`、`bind` 或事件属性；`visible` 只隐藏绘制、不停止发射。
- 范围与预算属于匹配引擎：`image` 必须是已声明 image/cg 纹理；`rate` 0–200 与 `burst` 0–128 不能同时为 0；`max` 1–512（默认 128）；`life` 0.1–10、`size` 0.5–512、速度/加速度 ±2000、转速 ±720，每组 `-max` 不得小于下限；每页最多 4 个、整份 UI 最多 32 个。编辑器静态校验并保留文件/控件/原因，不得放宽或改成宽松解析。
- JS 只写 `ctx.particles("发射器").start()/stop()/clear()/burst()`：start 要求 `rate > 0`、burst 要求已声明 `burst`，目标必须是已声明发射器；识别范围仅限顶层单条固定命令，循环/动态名称/共享回调/多命令保持 Opaque。命令的页面栈、重复操作与生命周期限制由匹配播放器运行时整批校验，`game.enter`/`screen.open/close` 不接受粒子命令。
- `settings.master_volume` 与 `ctx.setting("master_volume", ctx.value)` 是普通设置项；`settings.json`、`keybindings.json`、`ui-colors.json`、`language.json` 等玩家偏好仍由匹配播放器维护，编辑器不写。
- 设计画布只做静态示意（虚线区域、纹理样本、rate/burst/autostart 标注），不得启动时钟、随机状态、引擎渲染或写入剧情；预设只填属性草稿，保存属性后才写 XML。真实粒子容量、暂停/失焦、页面清理、读档重建、热更与设备重建必须由匹配播放器验收，静态测试不能替代。
- UI 编辑器常用快捷键（窗口级、输入框/下拉框/`contenteditable` 内不拦截）：`Delete`/`Backspace` 删除选中控件、`Ctrl/⌘+D` 复制、`Ctrl/⌘+C`/`V` 复制与粘贴新 ID 副本、`Ctrl/⌘+S` 保存属性草稿。拒绝时必须给出原因（只读、草稿未保存、表单打开、revision 冲突），且只能走既有 `uiEdit` 事务，不新增消息类型或绕过保存链。
- 布局调整只属于呈现层：可折叠“插入组合标签”、把提示移入工具栏、在检查器先显示粒子说明与预设；不得删除既有入口、改变按钮文字/aria 名称/CSS 选择器/测试选择器，也不得改变 XML/JS 写回、命令 payload、冻结代次或引擎契约。
- 工具升级同步 `tools.json` 哈希、工程清单/调试/构建版本检查、模板/测试与真实 `--check`/KPAK 回归；v0.11.3 仍为 story 8 / UI 3 / save 9 / profile 1 / read 1 / 隐藏槽 1 / KPAK 1、2 与 demo content-version=11。