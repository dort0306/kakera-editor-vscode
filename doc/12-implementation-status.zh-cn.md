# 12 实现与验证记录

日期：2026-10-29。插件 0.8.8，匹配播放器 0.9.1，story 8 / UI 3 / save 9（demo content-version=11）。

2026-10-29 工作区修复：补齐 `on.screenOpen/Close` 与 `ctx.present` 的缺失页面静态诊断，按 UI 入口/include 当前缓冲核对；分镜工作台与 UI 编辑器均显示脚本文件/行号，动态页面目标标为不确定。UI 尚未完整解析时避免级联误报，诊断不执行脚本或改写原文。`npm run check` 的 88 项测试、类型检查与构建通过；真实宿主结果见 [0.7.0 独立验收及修复复验](17-v0.7.0-acceptance.zh-cn.md)。媒体运行态等原有未验收范围仍保留。

2026-10-29 常用生命周期可视编辑：当前幕属性可设置离幕打开页面，UI 页面属性可设置关闭后续接指定幕、恢复待续剧情或打开另一页面。只编辑可证明的单条固定 open/resume 回调；其他手写回调保持只读。真实播放器新增三组运行态验证，覆盖自动淡出关页、待续与指定幕返回、页面串接、隐藏槽建立和变量只提交一次；未运行视频/音频、跨进程恢复或 save 9 历史重放。使用方式见 [16 UI 编辑器](16-ui-editor.zh-cn.md)。

本次生命周期增量 `npm run check`（91 项、0 跳过）、`test:integration`、`test:host`、`test:browser`、`package` 和隔离 VSIX 安装均通过；详见 [独立验收记录](17-v0.7.0-acceptance.zh-cn.md)。

2026-10-29 界面重构 0.8.0：Webview 改为现代游戏编辑器/IDE 壳层（应用栏、工程侧栏、舞台/分镜主区、属性检查器、状态栏），工程设置与图片工具收进可关闭抽屉；UI 编辑器改为页面层级/设计画布/分组检查器三栏，并新增首页快速开始布局。此次只改变 React 呈现、CSS 与内联图标，不改变 XML/JS 写回、命令 payload、保存事务、冻结代次或引擎契约；0.7.0 的独立验收记录保持其原版本范围。

0.8.1 修复流程图和 UI 设计画布拖动：0.8.0 重写 CSS 时遗漏了 `touch-action:none`/`user-select:none`；拖动阈值后宿主重绘可能立即丢失 pointer capture，而原 `onLostPointerCapture` 会清空手势，导致幕卡在第一次移动后回弹或不再跟随。现在恢复触摸/选择样式，捕获丢失后保留已开始的手势，并增加窗口级 pointerup 提交与取消；浏览器回归新增“完整工作台内拖动必须发出 layout 请求”，普通点击、缩放、连线、Escape 和只读取消仍保留。

0.8.8 重构 VS Code Activity Bar 工程侧栏：原生 TreeView 按人物、美术资源、音频与字体、剧本、变量、JS 程序、界面分类，使用主题图标、计数/描述和工具提示；新增原生右键菜单和新建/编辑/删除命令，侧栏在激活及文档/文件变化后刷新。

0.8.7 修复变量与入口操作：工作台变量列表支持编辑初始值/int 范围和删除，ID/类型固定，删除前检查已识别路线条件与更新；修复“加入起始幕”被宿主的当前幕守卫误拒绝，入口请求只校验提交的 `refs` 列表。

0.8.6 同步上游多起始幕与 UI 首次进入：`story.entry` 解析/编辑空白分隔列表，工作台“故事起点”支持加入/移除/唯一入口；关系图所有起点作为根并标“入口”，删除/重命名只改对应列表项。UI“重新开始”事件可选已声明起点和先打开页面，生成 `ctx.open(...); ctx.restart("...")`；未声明/多起点无参保存前拒绝。调试状态接受 `game_started=false` 与空 `frame_id/frame_name`，不伪造进入状态。

0.8.5 增加流程图背景平移：空白背景拖动只改变 `.graph-scroll` 的滚动位置，不写布局、不移动幕卡、不触发布局保存；幕卡/端点/边缘手势优先，pointer capture 丢失时由窗口级 pointermove/pointerup 继续或结束。工具栏提示和抓取光标同步更新。

0.8.4 同步上游 CG 资源增量：识别 `<cg>` 资产、CG visual 完整画面、自动/显式画廊、`game.cgId`、`cg.total/unlocked/progress` 与 `ctx.unlock`；新增导入 CG、故事舞台 CG 预览、CG 画廊标题/初始解锁编辑、CG 事件动作和绑定建议。CG 与背景/人物严格互斥；编辑器不写 `profile.json`，也不会因加载 CG 自动解锁。

0.8.3 增加 UI 事件的编辑/删除和幕 ID 重命名，并新增 [18 可视化编辑器使用说明](18-visual-editor-guide.zh-cn.md)。事件只改可证明的单一 `on.ui` 固定回调；改名同步控件与页面背景引用，删除前需解除引用，手写/带注释/重复/动态事件保留源码。幕重命名更新 `<frame>` ID/name、入口、已识别的推进/选择 owner 与目标；存在动态路线、生命周期/`ctx.resume` 引用或 ID 冲突时拒绝。

0.8.2 同步上游 v0.9.1 的两项增量：末幕 frameExit 和 UI 显式起始幕。UI 编辑器“新建事件”现在把 `resume` 呈现为“开始 / 恢复剧情（可指定起始幕）”，可选择一个实际幕并可选“先打开页面”，写入 `ctx.open("页面"); ctx.resume("幕")`；留空起始幕写入 `ctx.resume()`，从隐藏槽 continuation 恢复。自动 `screenClose` 表单同步改为“从指定幕开始 / 续接”和“从隐藏槽恢复”。显式幕沿用隐藏槽变量与历史，不等于清空变量的 restart；首次无隐藏槽且无目标由播放器拒绝，编辑器不伪造隐藏状态。末幕提示更新为“文字完成后的手动继续执行一次，补全不触发”。

本记录描述实际交付，不把 [11 落地方案](11-vscode-extension-implementation-plan.zh-cn.md)中的完整阶段出口全部标为完成。原始 01–10 仍作为设计/引擎契约基线，当前实现状态以根 README 与本文为准。

0.6.1 增加按钮原生页面导航：打开指定跨文件页面、关闭顶层页面；route/event 二选一，保留 JS 原文，并检查页面删除入边。已运行 82 项测试、真实 v0.8.4 两种 KPAK 和宿主/调试回归；未复测播放器手动导航点击。

0.6.2 同步相邻引擎 HEAD 00a08e2 后尚未提交的 UI 演出/角色音效增量：新增 ui-media 的可视声明编辑、页面 sequence、按钮 sound、演出/播放/偏好事件向导及 audio 绑定建议。重新从当前源码构建 release 工具；编辑器保持静态画布，不模拟演出或随机选择。声明级编辑保留其他源范围，声明内注释保留但可移动到步骤前。

0.7.0 同步相邻引擎 v0.9.0 提交 f4db8f3：静态映射识别 `on.frameEnter/Exit`、`on.screenOpen/Close`，不把它们当作剧情路由，并为被引用的幕/页面和 `ctx.resume` 目标增加删除保护；动态幕目标或动态返回目标给出诊断并暂不允许删除，事件向导可追加 `ctx.present` 与 `ctx.resume()`/`ctx.resume(幕)`。视频只保留 UI 演出序列，旧 frame 视频和 `game.video*` 绑定显示迁移诊断并从建议中移除；`flow-checkpoint.json` 与 `ui-audio.json` 一起排除出冻结代次和发行包。重新从 v0.9.0 源码构建 release 播放器/打包器；编辑器仍不执行生命周期、演出、隐藏槽或 UI 返回，也不迁移 save 8。

## 已实现

| 模块 | 实际范围 |
| --- | --- |
| 宿主 | Windows 本地扩展、Activity Bar、首页、CustomTextEditor、源码导航、基本 Problems 诊断、命令与可取消进度 |
| 手工创作 | 新建模板工程、稳定 UUID、自动接续新幕、删除幕并处理入边、设置入口、幕复制/文件内排序、台词/人物/画面/音频、选择/类型化条件分流/组合条件/有序变量更新、新增类型化变量 |
| 标题 | UI title 与 title-bind 初始值编辑、显式解除绑定；工作台/工程树展示标题，故事和幕 ID 保持不变 |
| 人物 | 创建/改名、批量 PNG/JPEG 导入、已有资源批量关联、Live2D model3 与声明依赖导入、回退图/模型编辑、外观放入当前幕 |
| 分支图 | 真实路由、分支分色/同行、共用汇合节点、循环/动态目标/待连接；支持缩放、幕拖动与布局保存、拖线/点击/键盘重新连线、断线和自动排列；另保留文件顺序列表 |
| 源码 | Saxes 校验与原范围补丁；Acorn 实时关联全部声明脚本/章节中的幕、选项、目标和源码范围；Managed 与 Recognized 可编辑，自定义回调候选只读映射，按幕判定能力；识别 v0.9.0/v0.9.1 生命周期注册、显式起始幕与 `ctx.resume/present` 引用 |
| 文档与恢复 | TextDocument 当前缓冲、版本/哈希前置条件、冻结代次、引擎验证后 WorkspaceEdit；日常手工操作直接保存本次涉及的文件，保留换行与 BOM；恢复记录保存前/后内容，后续修改拒绝自动覆盖；冻结排除玩家/隐藏槽位文件 |
| 资源 | 基本类型与 CG 导入、授权文本、哈希、引用与图片私有缓存；PNG/JPEG 点九生成/编辑、多段标记及预览；图集框选/网格/多图合成/区域编辑/真实 UI 应用；独立 Worker 与预算；路径/大小写/目录联接拒绝 |
| UI 编辑器 | 多文件 UI/include 当前缓冲、页面/九类控件树与设计画布、单击/拖动/缩放/取消/键盘、属性/绑定/图片/点九/图集、跨页面层级与顺序、页面/变量、白名单事件创建/编辑/删除、CG 画廊标题/初始解锁；present/resume、CG 解锁、演出/音效与旧视频绑定诊断；静态示例预览，不执行游戏 JS |
| CG | 专用 `<cg>` 资产、`visual cg` 完整画面、自动/显式画廊、`game.cgId`、`cg.total/unlocked/progress` 绑定与 `ctx.unlock` 事件；不写共享 profile，不在加载时自动解锁 |
| 多起始幕 | 空白分隔 `story.entry` 列表、加入/移除/唯一入口、多根关系图、入口标记、删除/重命名只改对应项；UI `restart` 目标/先打开页面；调试 `game_started=false`、空当前幕；播放器初始 UI 等待显式起点，不自动进入第一项 |
| 变量编辑 | 变量初始值及 int min/max 编辑，ID/类型固定；删除变量并检查路线条件/更新引用；范围与类型校验、XML 范围补丁和宿主撤销/保存链 |
| 原生工程侧栏 | 原生 TreeView 分类人物/美术资源/音频与字体/剧本/变量/JS 程序/界面；ThemeIcon、计数/描述、激活加载与变化刷新；分类/条目右键新建、重命名、删除、导入、打开和引用命令，跟随 VS Code 主题 |
| AI | 单一用户 profile/SecretStorage、Chat Completions 文本/JSON/SSE、取消/连接与总任务预算、连续 UTF-16 原文片段白名单、差异审阅后新增幕 |
| 试玩/调试 | 私有内容代次、隔离存档、自有进程；JSON Lines 串行控制/修订、只读变量、XML 行/帧断点、候选语义、DAP sourceReference 冻结源码、状态轮询 |
| 构建 | 匹配打包 CLI、KPAK 2、全包检查、实际索引文件清单审阅、新发行目录、哈希与构建报告；不自动上传 |
| 插件供应 | 版本与工具哈希校验、离线 VSIX、模板及字体/JS 运行依赖许可；源码仓库通过准备脚本取得工具 |
| 流程图导出 | 完整 SVG/离线 HTML，保留布局/分色/未知关系；HTML 含全文/条件/更新及内部跳转，源码与目标冲突检查，不修改游戏 |

新增幕从选中幕接续：推进路线插入并保留原后续，结束幕向后延伸，选项幕按 XML 显示顺序填首个待连接选项。全部选项已有连接时不覆盖既有路线。删除幕保留其他场景；有唯一明确后续时接回，否则保留待连接。待连接使用带明确标记的合法 End 幕持久化，界面不把它计为作者的幕，插件构建阻止尚未补齐的路线。

日常手工保存、新建/删除与导入不再打开源码差异或要求“校验并应用”；后台验证、冲突检查和宿主撤销/重做保留。AI 提案仍单独审阅。

0.4.0 使用语法树识别常见手写注册，不再以生成器逐字一致作为日常可写条件。JS/XML 当前缓冲变化后自动刷新；条件返回与共享函数显示候选目标，自定义回调只限制对应幕，未知注册范围则保守限制写入。Recognized 编辑只补丁关联节点，提供 JS 注册导航与具体受限原因，详见 [13 同步映射](13-live-logic-mapping.zh-cn.md)。

0.5.0 增加拖动/重新连线及点九/图集工具。拖动只保存视图布局，改线保留条件与更新；点九输出真实标记 PNG，图集应用真实 UI region。图像版本化保存而不覆盖原图，布局与区域预设不进入发行内容，详见 [14 交互与图片工具](14-graph-and-texture-tools.zh-cn.md)。

0.5.1 增加“导出流程图”：SVG 和 HTML 均使用全图与当前源码缓冲，独立于 Webview 视口；HTML 提供完整台词和路线清单。保持候选关系的不确定性，不把导出当作运行时路线证明。

0.5.3 修复拖动启用后单击无法选中：取消按下即捕获 SVG 的行为，超过 4 个屏幕像素才开始拖动。点击、拖动后下一次点击、Enter 选中及只读查看分别处理，补齐捕获取消/丢失的清理。

0.5.4 增加变量条件分流：普通推进和选择回调均可按 bool、int/string 比较、整数闭区间和布尔组合决定目标，明确顺序与默认出口。图中各条件独立连接、分色并参与导出；新增/删除/断线处理全部出口。受限 if/else 与三元表达式可识别回写；自定义判断和分支内副作用仍保持只读。详见 [15 条件分流](15-variable-conditional-routes.zh-cn.md)。

0.6.0 只读核对上游当前未提交的 UI 拆分补丁，并提供 UI 编辑器。实际 demo 扫描为 14 个 UI 文件/12 页/186 控件/11 UI 变量/44 事件，无解析警告；不把它视作完整媒体验收。页面、控件、变量和常用事件编辑写回真实源码，图片由有界 Worker 准备，拖动直接保存；详见 [16 UI 编辑器](16-ui-editor.zh-cn.md)。

## 本轮已执行的检查

以下保留各版本的累计验收记录。0.7.0 本轮执行类型/86 项单元回归/构建、原生浏览器流程图与 UI 交互、v0.9.0 真实引擎/KPAK 和宿主/调试回归。旧版模型/Core 检查保留各自版本标记，不把 DOM 测试当成原生点击证明。

环境：Windows x64，Node.js 24.17.0、npm 12.2.0。0.3.0 使用 VS Code 1.142.0；0.4.0 起的宿主回归使用 VS Code 1.143.1（commit `e646868227c3e3a9e3f24277c8c7220be42c0be7`）。清单声明最低 VS Code 1.100.0，但尚未在该最低版本复测。

引擎从开发机相邻 Kakera v0.9.0 源码（提交 `f4db8f3`）重新构建 release 工具核对，未修改上游。模板 UI、资源/字体和 CLI 与实际 loader/接口比对后由真实工具校验。工具二进制的 SHA-256 由 `resources/tools/win32-x64/tools.json` 记录，不硬编码开发机绝对路径。

- `npm run typecheck`：通过。
- `npm test`：86 项通过。0.7.0 增加生命周期注册/引用与删除保护、present/resume 事件、frame.video 与 game.video* 诊断、隐藏槽排除；保留 UI 演出、条件分流、UI/include、点击/拖动/键盘等回归。
- `npm run test:browser`：使用本机 Edge `156.0.4314.42` 的独立无头配置，以原生鼠标/键盘输入复现旧版 `pointerup:svg / click:svg`、选中回调未触发的问题；修复后验证普通单击及选中状态、缩小后轻微手抖、拖动不误选、拖动后 Enter/单击、Escape、重新连线与只读选中均通过。未验证其他浏览器、触屏/笔和手动桌面 GUI 矩阵。
- 0.6.0 `npm run test:integration`：新增真实嵌套 UI/include 工程，验证子文件标题/控件、页面、按钮、开关、事件注册与 UI i64 变量通过引擎完整校验；两种 KPAK 的实际索引均确认只保留 UI 入口，子文件移除、JS 保留，全包可独立加载且源文件逐字不变。原分流/资源/打包回归一并通过，本次未提供模型/Core。
- `npm run test:integration`（0.5.4）：真实 QuickJS 在隔离工程中验证 8 组状态，覆盖 bool true/false、条件首个匹配、闭区间两端、默认线路、更新后的变量值、超过 2^53 的精确比较和 i64 边界。模板/资源、KPAK 1/2、未保存代次和独立宿主检查一并通过；本次未提供模型/Core。
- `npm run test:integration`（0.5.0）：真实播放器校验模板、编辑后标题、新人物及两张测试立绘、人物外观放入当前幕和含未保存台词的代次；该次显式提供本机 Haru 测试模型与 Core DLL，完成 model3 依赖导入、静态回退校验及原生 Core 模型准备。KPAK 1/2 和独立宿主的静态回退全包检查通过。测试模型/Core 仅在忽略的测试目录使用，不随插件分发。
- 0.5.0 引擎/打包回归同时包含生成的多伸缩段 `.9.png`、合成图集和 UI region，验证 KPAK 1/2 与独立宿主检查通过，新资源被包含、`.editor` 预设被排除。
- `npm run test:host`（最近为 0.7.0）：真实 VS Code 激活、未保存 TextDocument、冻结校验、旧 revision 拒绝、单文件及有效多文件 undo/redo、无效多文件候选不提交、多 Custom Editor 视图；通过真实 v0.9.0 播放器执行 inline DAP 启动、配置、断点、栈/源码/变量、候选提交前状态、自循环及变量单次提交、拒绝 evaluate、断开与清理。第二个真实受限工作区验证只读激活、修改被拒、未执行工具或写入项目元数据。
- 0.5.4 真实宿主额外验证未保存三元分流识别为可写、只修改条件目标并保存、undo/redo 后重新获取 revision，保留原有映射/资源/导出/DAP 检查；受限工作区回归通过。
- 0.6.0 浏览器回归使用真实 Edge 输入验证 UI 控件单击、缩放后的父级相对拖动、尺寸手柄、Escape、源码变化/只读时取消拖动、轻微手抖和只读选中；生成并检查实际生产组件的设计器截图。
- 0.6.0 真实宿主验证 include 子文档的未保存缓冲进入冻结代次、控件直接保存、旧 revision 拒绝、跨文件标题绑定、两文件改父级共同 undo/redo、坏绑定引擎拒绝且原文不变；UI 入口命令及受限工作区通过。
- 宿主用例检查 UI 标题撤销/重做、人物创建/改名、稳定幕 ID、立绘外观保存/放入当前幕；调试播放器状态中的 `window_title` 对照修改后的标题检查。0.3.0 额外实测新增/删除后 XML 与 JS 直接落盘、保存后的撤销/重做、待连接选项通过真实引擎验证并按顺序补幕、CRLF/UTF-8 BOM 保留，以及注入保存失败后保留编辑缓冲和原磁盘内容。
- 0.4.0 真实宿主额外验证未保存手写 JS 自动映射、局部新增/删除后保留函数写法/注释/辅助代码、条件返回候选、自定义路线的 XML 台词保存、语法错误修复重建映射。完整宿主与受限工作区均通过；曾遇本机更新锁导致启动失败，待更新完成后重跑通过。
- 0.5.0 真实宿主额外验证初次布局创建后的持久化/撤销/重做、布局不改 XML/JS、重连落盘、后台 Worker、点九生成/解析/版本化编辑、图集合成/预设与 UI region、旧图片哈希拒绝、取消及 sidecar 排除。开发窗口未提供可接管的可见窗口，手动截图/真实鼠标主观 GUI 验收未完成；指针交互已在 React DOM 中测试。
- 0.5.1 真实宿主验证 SVG/HTML 落盘、保留布局和全文、确定性覆盖、源码不变、未保存目标保护、源码覆盖拒绝、过期/取消拒绝和临时文件清理；受限工作区导出被拒绝且无输出。导出保存对话框手动操作和各浏览器截图/打印外观未在本轮验收。
- `npm run package`：生成内部离线 VSIX，采用显式文件白名单；不包含 node_modules、测试工作区、AI 凭据或原稿。包中包含工具与字体。
- 安装验证使用 VS Code CLI、`.test-work/installed-extensions` 和隔离用户数据目录，不修改日常扩展环境。
- 0.6.0 已打包 `kakera-editor-vscode-0.6.0.vsix`（25 文件，19.57MB），隔离安装后 CLI 确认 `dort0306.kakera-editor-vscode@0.6.0`。0.7.0 已打包 `kakera-editor-vscode-0.7.0.vsix`（25 文件，19.72MB），隔离安装后 CLI 确认 `dort0306.kakera-editor-vscode@0.7.0`。索引和第 04 篇继承的上游 API/KPAK/验收及 `../../src/` 链接仍不在本仓库，未虚构或复制缺失文件。
- 0.5.4 离线 VSIX 打包并隔离安装通过，CLI 确认 `dort0306.kakera-editor-vscode@0.5.4`。本次核对 57 个有效本地文档链接；索引继承的 `../v0.8.3-validation.zh-cn.md` 与 `../v0.8.3-implementation-plan.zh-cn.md` 仍缺少上游文件，未虚构或补写其内容。

本地协议与宿主测试需要 loopback 连接；受限执行沙箱阻止时使用具备相应权限的测试环境运行。mock 验证仅代表客户端契约，不代表已连接任何真实 AI 服务。

## 尚未完成或未验收

- 未完成所有 E0–E5 出口；尤其最低宿主版本矩阵、100/1000 幕性能测量、磁盘满/进程崩溃的完整恢复故障注入尚未验收。当前 journal 是可检查的前后内容恢复记录，不能声称整工程磁盘原子事务或自动三方合并。
- Rust 独立结构化内容工具未实现；直接复用已存在的播放器/打包器 CLI，完整校验日志仍是文本，不伪造 JSON 诊断或源码行号。
- JS Recognized 固定注册与受限类型化条件分流已开放编辑，表单支持简单比较、整数范围、且/或组合及已识别非条件。共享/自定义回调重写、分支内任意副作用、动态循环注册展开尚未开放；条件重叠按首个匹配处理，不保证每条线路可达。
- 点九和图集基础工具已交付；自动紧密装箱/旋转/trim、UI 自动布局/多选对齐/事件图/动画时间线、视频和复杂模型动作/物理参数工具、资源批量重命名/删除、完整 UI/动态引用图仍未交付；UI 编辑器支持基础几何/属性/绑定和页面，新增页面写入已有 UI 文件，新的 include 文件需先用源码建立。现有高级声明保持原文，最终由引擎校验。
- 静态图片预览准备当前画面和当前人物前 50 个外观使用的普通图片，单文件限 8MiB；没有声称与 D3D11/媒体/Live2D 渲染完全一致。分镜默认分支图，文件顺序列表每批 50 幕；尚未完成大图性能与连续虚拟滚动验收。
- AI 当前只做纯文本拆幕；图片、资源关联、结构输出能力探测、多个服务 profile、自动重试/修复、真实本地/远程服务和冻结中文集合评估尚未完成。未配置的服务不自动连接。
- DAP 为帧级适配；条件断点、JS 调用栈/求值/行级步进、任意跳转或写变量均不提供。完整路线录制/重放、断线去重缓存重发与渲染重建全矩阵尚未验收；当前不自动重试控制命令。
- 游戏构建 UI 当前使用 KPAK 2；格式 1 已通过底层工具集成测试，尚未作为 UI 选项开放。大包上限、设备音轨、主观听感、复杂存档兼容及全媒体 GUI 测试未在本轮覆盖。
- v0.9.0 生命周期与隐藏交接已按静态契约、真实引擎 `--check` 和三组自动淡出交接运行测试接入；没有手工验收播放器窗口中的幕↔页面视频交接、跳过、失焦、跨进程隐藏槽恢复或 save 9 历史重放。生命周期仅提供离幕/关页的单动作可视编辑，不提供任意回调编辑、save 8 迁移或隐藏槽查看/写入。
- 没有附带 Live2D Core 或第三方模型。Core 可由用户显式配置用于原生校验/试玩；含模型的构建目前显式生成静态回退版和启动脚本，不自动复制 Core，不宣称完整原生模型发行支持。没有公开发布 Marketplace 或上传游戏。

后续优先补齐版本/信任矩阵和恢复故障注入，再按设计扩展资源、AI 能力探测与路线回放；已有可用功能不能替代这些尚未完成的验收。

## 0.6.2 本轮验证

- npm run check：83 项单元/源码/表单回归通过，类型检查和构建通过。
- npm run test:integration：真实 release 播放器接受带权音效组、页面演出、fade/sound 和仅音效按钮，拒绝不存在的 fade 目标；KPAK 1/2 全包检查通过，音频依赖入包，ui-audio.json 不入包。
- npm run test:browser：Edge 156 真实画布/流程图交互回归通过；npm run test:host：真实 VS Code 缓冲、撤销/多文件保存、受限工作区和播放器调试回归通过。新演出表单通过 React DOM 实际输入与源码保存回归；未人工验收播放器视频/音频、随机权重听感、跳过和焦点生命周期。上游自己的验收结果不计为本插件实测。
- 0.6.2 离线 VSIX（25 文件、19.67MB）打包并隔离安装通过，CLI 确认 dort0306.kakera-editor-vscode@0.6.2。当前上游 demo 的 30 幕/13 页/2 视频/1 模型通过 release --check（no-audio/no-live2d），不代表实际播放或 Core 模型验收。

## 0.7.0 本轮验证

- `npm run check`：类型检查、86 项单元/源码/表单回归和构建通过。
- `npm run test:integration`：真实 v0.9.0 release 播放器接受 UI 演出/音效、页面 sequence、按钮 sound、present/resume 事件和 `on.frameEnter/Exit`、`on.screenOpen/Close` 注册；拒绝不存在的 fade 目标。KPAK 1/2 全包检查通过，音频依赖入包，`ui-audio.json` 与 `flow-checkpoint.json` 均不入包；原模板、条件分流、未保存代次、独立宿主与源文件逐字不变通过。
- `npm run test:browser`：本机 Edge 156.0.4314.42 的真实画布/流程图点击、拖动、缩放、键盘、Escape、重新连线和只读选中回归通过；本轮新增的 present/resume 表单通过 React DOM 实际输入与源码保存回归。未人工操作桌面窗口。
- `npm run test:host`：真实 VS Code 的未保存缓冲、冻结校验、旧 revision 拒绝、撤销/重做、多 Custom Editor、UI include 子文档、受限工作区以及真实 v0.9.0 播放器 inline DAP 回归通过。
- `npm run package`：`kakera-editor-vscode-0.7.0.vsix` 共 25 文件、19.72MB；工具 SHA-256 与 v0.9.0 清单一致，白名单不含 node_modules、测试工作区、AI 凭据或原稿。隔离扩展目录安装后 CLI 确认 `dort0306.kakera-editor-vscode@0.7.0`。
- 未执行：播放器窗口中的真实 UI 视频/音效交接、隐藏槽跨进程恢复、save 9 历史重放、视频/音频主观听感和设备丢失；编辑器不会写这些玩家文件。上游 v0.9.0 自己的验收记录不计为本插件实测。

## 0.8.0 本轮验证

- `npm run check`：类型检查、91 项单元/源码/表单回归和构建通过；工作台壳层测试实际打开/关闭工程设置抽屉并验证 Esc 关闭。
- `npm run test:browser`：Edge 156.0.4314.42 的流程图、UI 画布、缩放/拖动/键盘/重命名连线、生命周期表单回归通过；新增工作台/首页结构、工程侧栏、舞台、分镜图、检查器、状态栏、设置抽屉和响应式 1280/1440 截图检查，输出 `workbench.png`、`workbench-1280.png`、`workbench-settings.png`、`home.png`、`ui-editor.png`。
- `npm run test:host`：真实 VS Code 的未保存缓冲、撤销/重做、UI include、生命周期编辑、受限工作区和真实 v0.9.0 播放器 inline DAP 回归通过。
- `npm run test:integration`：条件分流和 UI 编辑器真实引擎/KPAK 子项通过；运行到新增的 lifecycle-native 自动演出步骤时失败。本机桌面当前没有可取得前台焦点的播放器窗口，UI 演出时钟按设计在失焦时暂停，页面 `finish=close` 未完成，因此 `continue` 模式停在 opening。该测试路径直接启动 Rust 播放器，界面重构未修改它；需要在有前台窗口的桌面重跑。由于 main 流程中止，后续模板/KPAK/独立宿主子项本轮未执行。
- `npm run package`：`kakera-editor-vscode-0.8.0.vsix` 共 25 文件、19.73MB；隔离扩展目录安装后 CLI 确认 `dort0306.kakera-editor-vscode@0.8.0`。SHA-256 `403C92C3A081C577AB824876FCC997728C0F518EC2A655323D193126A8685D5A`。
- 浏览器截图来自独立的 Edge 夹具与 VS Code 变量注入，不是 VS Code 实机 Webview 截图；未人工审查所有 DPI、浅色主题、触屏/笔和窄窗口桌面流程。

## 0.8.1 本轮验证

- 原因与修复：0.8.0 的 CSS 重写漏掉 `.graph-node`/`.ui-canvas` 的 `touch-action:none` 与 `user-select:none`；真实工作台中拖动首次移动会丢失 pointer capture，旧 `onLostPointerCapture` 无条件清空手势，节点因此回弹或停止跟随。还原这些样式，并把“捕获丢失”改为只在尚未越过拖动阈值时取消；已开始拖动由窗口级 pointerup 提交，pointercancel 仍回滚。
- `npm run check`：类型检查、91 项单元/源码/表单回归和构建通过。
- `npm run test:browser`：Edge 156 的独立流程图/UI 画布和**完整工作台布局**拖动回归通过；工作台拖动确实发送 `layout` 保存请求，随后点击、缩放、连线/Escape 和只读取消断言通过。
- `npm run test:host`：真实 VS Code 的未保存缓冲、撤销/重做、UI include、生命周期编辑、受限工作区和真实 v0.9.0 播放器 inline DAP 回归通过。
- `npm run package`：`kakera-editor-vscode-0.8.1.vsix` 共 25 文件、19.73MB；隔离安装后 CLI 确认 `dort0306.kakera-editor-vscode@0.8.1`。SHA-256 `89B2A55759FC7D838EFEEA046414C5D2D7B6BD96B0402859A20CC6E9275FD6BD`。
- 仍未在真实 VS Code Webview 中做人工鼠标/触屏拖动验收；`test:integration` 的 lifecycle-native 运行态步骤仍依赖可取得前台焦点的播放器窗口，本机桌面复跑结果见 0.8.0 节记录。

## 0.8.2 本轮验证

- 上游核对：工作区 v0.9.1 未提交增量，API 说明 `ctx.resume` 在普通 `on.ui`/`screenClose` 中可显式指定起始幕；无活动交接触发时读取磁盘隐藏槽（含 inactive）；无隐藏槽且无目标拒绝；显式目标以隐藏 continuation 为基础，指定目标与自动关闭的无参 resume 合并时保留显式目标。末幕修复同步到 `frameExit` 提示。
- `npm run check`：类型检查、91 项单元/源码/表单回归和构建通过；新增 `ctx.open(页面); ctx.resume(幕)` / `ctx.resume()` 源码断言，缺失页面和“先打开页面”误用于其他动作均拒绝。
- `npm run test:integration`：真实 v0.9.1 release 播放器的条件分流、UI 编辑器、生命周期编辑、KPAK 1/2 和独立宿主检查全部通过；lifecycle-native 的显式幕/无参续接、隐藏槽和单次变量提交通过。
- `npm run test:browser`：Edge 156 的流程图/UI 画布拖动、生命周期表单、工作台/首页/抽屉和 1280/1440 截图回归通过；新增“开始/恢复剧情”表单的起始幕 `a`、先打开页面 `help` 操作 payload 断言。
- `npm run test:host`：真实 VS Code 的未保存缓冲、撤销/重做、UI include、生命周期编辑、受限工作区和真实 v0.9.1 播放器 inline DAP 通过。
- `npm run package`：`kakera-editor-vscode-0.8.2.vsix` 共 25 文件、19.74MB；隔离安装后 CLI 确认 `dort0306.kakera-editor-vscode@0.8.2`。SHA-256 `8E9F77271AC8F47B50915ADAE7B7A61CBDEFB9A3CAB8708F7FA68E3D4C1D9C7C`。
- 未执行：真实 GUI 中从按钮点击显式起始幕/隐藏剧情、视频/音频主观听感、隐藏槽跨进程恢复和 save 9 历史重放；这些由匹配播放器和上游验收负责。浏览器截图来自 Edge 夹具，不是 VS Code 实机 Webview。

## 0.8.3 本轮验证

- 事件：只解析单一顶层 `on.ui("字面量", 回调)` 且回调为固定白名单动作（含先 `ctx.open` 再 `ctx.resume`）；改名同步控件 `event` 与页面背景事件，删除前检查引用；带注释、自定义语句、重复/动态名称显示源码维护。源码测试覆盖修改名称/动作、控件引用同步、未引用删除和手写回调拒绝。
- 幕 ID：更新 `<frame>` id/name、入口、已识别推进/选择注册 owner 与所有静态目标；动态/未识别路线、生命周期/`ctx.resume` 引用、ID 冲突拒绝。源码测试覆盖入口/注册/目标、名称对齐、生命周期拒绝和真实 v0.9.1 `--check`。
- `npm run check`：类型检查、**93 项**单元/源码/表单回归和构建通过；App 表单测试实际发送 `rename`，UI 表单测试实际编辑并删除事件。
- `npm run test:browser`：Edge 156 的流程图/UI 画布拖动、生命周期、显式起始幕表单、工作台/首页/抽屉和截图回归通过。
- `npm run test:integration`：新增真实 v0.9.1 幕重命名 `--check` 通过；UI 编辑器真实校验包含临时事件创建/改名/删除；条件分流、生命周期、KPAK 1/2 与独立宿主检查全部通过。
- `npm run test:host`：真实 VS Code 激活、未保存缓冲、撤销/重做、UI include、生命周期、受限工作区和真实 v0.9.1 播放器 inline DAP 通过。
- `npm run package`：`kakera-editor-vscode-0.8.3.vsix` 共 25 文件、19.74MB；隔离安装后 CLI 确认 `dort0306.kakera-editor-vscode@0.8.3`。SHA-256 `947B9824847C509D851AD4D43882512A85CF7178211EC2FC90753864A23BA0D7`。
- 未执行：真实 VS Code Webview 中逐项点击事件编辑/删除和幕 ID 重命名的人工验收；动态事件/动态路线仅验证拒绝路径，不把它们改写。浏览器截图来自 Edge 夹具，不是 VS Code 实机 Webview。

## 0.8.4 本轮验证

- 上游核对：工作区 v0.9.1 的 CG 增量包括 `AssetKind::Cg`、`visual cg`、自动/显式画廊、`game.cgId`、`cg.total/unlocked/progress` 和 `ctx.unlock`；应用版本仍为 0.9.1，story 8/UI 3/save 9/profile 1 不变，demo content-version=10。CG visual 与 background/portrait 严格互斥，画廊 ID 与专用资源 ID 绑定。
- 编辑器：识别 `<cg>` 和 `visual cg`；故事舞台显示完整 CG 且不叠加人物；顶部可导入 CG；UI 编辑器自动列出 CG 画廊并可编辑中文标题/初始解锁；事件新增 `unlock`；绑定建议加入 `game.cgId/cg.total/cg.unlocked/cg.progress`。资源引用检查覆盖 visual.cg。
- `npm run check`：类型检查、**95 项**单元/源码/表单回归和构建通过；新增 CG visual 互斥、自动/显式画廊、ID 约束、CG 解锁事件和表单回填测试。
- `npm run test:integration`：真实 v0.9.1 播放器接受 CG 资源/画面/画廊/`cg.progress` 绑定/`ctx.unlock`，KPAK 1/2 和独立宿主全包检查通过；原有条件、UI、生命周期和幕重命名检查保持通过。
- `npm run test:browser`：Edge 156 的工作台/UI 画布/生命周期/显式起始幕/拖动回归通过；工作台夹具实际渲染 CG 画面并断言“CG 专用画面”徽标与图片 alt；CG 画廊/解锁表单由 jsdom/React 表单回归覆盖。
- `npm run test:host`：真实 VS Code 宿主与 inline DAP 回归通过。
- `npm run package`：`kakera-editor-vscode-0.8.4.vsix` 共 25 文件、19.75MB；隔离安装后 CLI 确认 `dort0306.kakera-editor-vscode@0.8.4`。SHA-256 `4AF0A046774639FE3DF8C66DA92FA738B47B0AE96405C0B9E78D0E5E3DD18557`。
- 未执行：真实 GUI 中解锁 CG 后跨进程查看 profile 共享进度、CG 缩略图/大图主观效果、音频听感和不同 DPI/浅色主题的 CG 画廊验收；这些由匹配播放器和上游验收负责。编辑器不写 `profile.json`，也不把加载 CG 当作解锁。

## 0.8.5 本轮验证

- 实现：流程图 SVG 增加独立全幅背景命中层；空白按下后滚动 `.graph-scroll`，pointer capture 丢失由窗口级 pointermove 继续、pointerup/cancel/Escape 清理。背景层位于幕卡/边缘/端点之下，幕卡拖动、连线与点击保持原逻辑。
- `npm run check`：类型检查、**95 项**单元/源码/表单回归和构建通过。
- `npm run test:browser`：工作台 1280 布局下扫描真实空白背景，拖动后 `scrollLeft` 改变；断言未新增 `layout` 消息，并清零滚动；原幕卡拖动、连线、缩放、生命周期、显式起始幕和 UI 画布回归继续通过。
- `npm run test:integration`：真实 v0.9.1 引擎的 CG、条件、UI、生命周期、幕重命名和 KPAK 1/2 检查通过（平移仅改视口，不涉及引擎内容）。
- `npm run test:host`：真实 VS Code 宿主及 inline DAP 回归通过。
- `npm run package`：`kakera-editor-vscode-0.8.5.vsix` 共 25 文件、19.75MB；隔离安装后 CLI 确认 `dort0306.kakera-editor-vscode@0.8.5`。SHA-256 `C22472A9D9DF6D971AAF2E0516D709A2B68203065B8A5E1790B62D4470ACE7C2`。
- 未执行：真实 VS Code Webview 内不同 DPI/触控板惯性和 macOS 触控板人工验收；浏览器测试使用 Edge 夹具和鼠标事件，不覆盖所有设备手势。

## 0.8.6 本轮验证

- 上游核对：工作区新增多起始幕/UI 首次进入及 2026-10-29 GUI 修正；`entry` 为空白分隔列表，未知/空/重复拒绝，启动只显示初始 UI，首次必须由 `ctx.resume/restart` 或读档进入；单入口也不再自动进入。应用 v0.9.1、story 8/UI 3/save 9/profile 1/KPAK 1/2 不变，demo content-version=11。
- 编辑器：`Story.entries` 从源码解析并校验，`entry` 保留首项兼容；工作台“故事起点”可增删/设为唯一入口；关系图/导出多根和“入口”标记；删除/重命名入口幕只改列表对应项。UI 事件“重新开始”支持已声明起点和可选先打开页面，多入口无参保存前拒绝；调试状态接受 `game_started=false`、空 `frame_id/frame_name`。
- 工具：从上游工作区重建 v0.9.1 `kakera-avg/kakera-pack` 并更新 SHA-256；播放器没有命令行指定起点的参数，真实 UI 必须自行选线或读档。
- `npm run check`：类型检查、**98 项**单元/源码/表单回归和构建通过；新增多起点解析/编辑/删除/重命名、多根关系图和 UI restart 目标/页面回归。
- `npm run test:integration`：真实 v0.9.1 播放器从测试专用初始 UI 起点按钮 `ctx.open("hud"); ctx.restart("opening")` 进入后，条件分流、生命周期交接、幕重命名、CG/UI、KPAK 1/2 和独立宿主检查通过。测试辅助起点的 `PostMessage`/窗口聚焦代码仅在 `tests/start-player.ts`，不进入产品模板或安装包。
- `npm run test:browser`：工作台夹具声明两个起点，断言两个 `.entry-chip` 和关系图入口；原平移、幕卡/连线、生命周期、显式起始幕、CG/UI 画布回归通过。
- `npm run test:host`：真实 VS Code 宿主先通过 DAP resume + 测试起始按钮进入，再验证断点、步进、撤销/重做和 inline DAP；受限宿主回归通过。
- `npm run package`：`kakera-editor-vscode-0.8.6.vsix` 共 25 文件、19.77MB；隔离安装后 CLI 确认 `dort0306.kakera-editor-vscode@0.8.6`。SHA-256 `80B553F739233313D4DEE47ED8BC614A0CE56D55B3B0FC4C36E8D507FF36D865`。
- 未执行：真实 GUI 中逐项点击多起点菜单的完整矩阵（上游已做一次实际窗口复验）、跨进程 auto/手动读档与所有入口的变量历史；未重跑上游 Rust 全量测试。测试起点按钮只属于集成夹具，不能代表产品 UI 的默认入口。

## 0.8.7 本轮验证

- 变量：新增 `editStoryVariable`/`deleteStoryVariable` 源码范围编辑，支持初始值和 int min/max，校验 i64 范围、上下限和 bool；变量 ID/类型固定，避免静默破坏脚本引用。宿主删除前检查已识别路线条件/更新；无法静态证明的 JS 引用交给真实引擎验证。前端变量卡片新增编辑/删除、范围字段和表单测试。
- 入口修复：移除宿主对 `entry` 消息的当前幕强制守卫；入口操作只解析提交的 `refs` 列表。工具栏“设为唯一入口”和检查器“加入起始幕”现在都发送 `refs`，不再误报“请选择一个实际的幕”。
- `npm run check`：类型检查、**99 项**回归和构建通过；新增变量编辑/删除及入口表单断言。
- `npm run test:browser`：工作台断言入口标签和变量编辑按钮；原多起点/平移/UI 回归通过。
- `npm run test:integration`：真实播放器条件、生命周期、CG/UI、KPAK 1/2 通过（测试专用入口按钮）。
- `npm run test:host`：真实 VS Code 宿主、inline DAP、撤销/重做和受限宿主通过。
- `npm run package`：`kakera-editor-vscode-0.8.7.vsix` 共 25 文件、19.77MB；隔离安装后 CLI 确认 `dort0306.kakera-editor-vscode@0.8.7`。SHA-256 `6C5EC52DFFE7B9071BCEB6E55187489BD7A20F6B0041E47A1B9910C1E656B64A`。
- 未执行：真实 Webview 中逐项修改/删除变量并观察引擎错误的人工验收；删除被 opaque JS 动态引用的变量需要引擎 `--check` 最终拒绝。

## 0.8.8 本轮验证

- 实现：`kakera.project` 从扁平 TreeDataProvider 改为原生 `createTreeView`，顶层分类人物/美术资源/音频与字体/剧本/变量/JS 程序/界面；ThemeIcon、计数、描述、tooltip、稳定 item id 和 contextValue。激活时自动加载工程，文档/文件变化后 150ms 防抖刷新；刷新按钮重新读取。
- 右键菜单：分类贡献新建人物/变量、导入立绘/Live2D/资源；人物条目重命名/删除/导入；变量条目编辑/删除；幕条目新建后续/删除；资源引用、脚本源码、分镜和 UI 打开。所有命令校验树条目类型后再走 source/session 保存链。
- 真实窗口检查：隔离 VS Code Extension Development Host 中看到七类原生树、计数、主题图标；右键剧本分类显示“打开分镜/完整引擎校验”，分类头部只保留刷新图标。未在自动化中逐项点击所有右键命令。
- `npm run check`：类型检查、**101 项**回归和构建通过；新增 package 贡献/菜单 when 条件、人物删除和变量编辑/删除/删除引用检查测试。
- `npm run test:browser`：工作台变量编辑按钮、多起点标签和原 UI 回归通过。
- `npm run test:integration`：真实播放器条件、生命周期、CG/UI、KPAK 1/2 通过。
- `npm run test:host`：真实 VS Code 宿主命令贡献、激活、撤销/重做、inline DAP 和受限宿主通过。
- `npm run package`：`kakera-editor-vscode-0.8.8.vsix` 共 25 文件、19.77MB；隔离安装后 CLI 确认 `dort0306.kakera-editor-vscode@0.8.8`。SHA-256 `41DA2134C82A7E6FDC5E9574DA99B67E43800B5D676D084313D939CAD80F2374`。
- 未执行：右键“新建人物/变量/后续幕”逐项真实点击并写入磁盘的人工验收；这些命令的源码/表单/命令注册已覆盖，但完整 GUI 交互仍需单独确认。资源/脚本/人物删除只覆盖安全可证明范围，动态引用由引擎校验兜底。
