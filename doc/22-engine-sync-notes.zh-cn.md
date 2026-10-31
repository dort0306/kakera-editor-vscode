# 22 引擎同步与版本增量

本文件承接根 README 迁出的上游同步说明：记录与 Kakera 播放器各版本的契约变化、编辑器随版本调整的行为，以及工具/模板的版本对齐。日常操作见 [21 使用说明](21-usage-guide.zh-cn.md)，实现与验证证据见 [12 实现与验证记录](12-implementation-status.zh-cn.md)，逐版本变更条目见 [CHANGELOG](../CHANGELOG.md)，下版本规划见 [PLAN.md](../PLAN.md)。

更新：2026-11-01。当前基线：插件 0.11.3，匹配 Kakera 播放器/打包器 v0.11.3（story 8 / UI 3 / save 9，调试协议 v1，demo content-version=11）。

## 1. 版本同步原则

- 插件版本 `x.y` 必须与匹配的上游引擎一致，`z` 只表示同一引擎兼容范围内的插件修复或增量；匹配引擎本版本为 v0.11.3。
- 引擎升级时同步 `tools.json` 哈希、工程清单/调试/构建版本检查、模板与测试新语法，并用真实 `--check`/KPAK 回归验证；静态源码测试不能替代匹配播放器的注册装配验证。
- 编辑器只写当前引擎语法，不提供旧语法自动迁移；遇到旧注册只给迁移诊断并暂停相关可视化改写。
- 玩家偏好文件（`keybindings.json`、`ui-colors.json`、`language.json`、`flow-checkpoint.json`、`ui-audio.json` 等）由匹配播放器维护，编辑器不创建、不写入，并排除出冻结代次、监控与发行包。

## 2. 2D 图片粒子、总音量与 UI 快捷键（0.11.3 插件 / 引擎 v0.11.3）

- **粒子节点**：UI XML 新增普通节点 `<particles>`，可放在 screen 或 panel/nine-patch 的直接子节点位置，不能放进 repeat 模板；共享 `id/x/y/width/height/visible/color`，另有纹理与运动属性（`image/rate/burst/max/life/life-max/size/size-max/vx/vx-max/vy/vy-max/accel-x/accel-y/spin/spin-max/fade/autostart`）。`image` 必须是已声明 image/cg 资源，`rate` 0–200 与 `burst` 0–128 不能同时为 0，`max` 1–512，`life` 0.1–10、`size` 0.5–512、速度/加速度 ±2000、转速 ±720，成对上限不得小于下限；每页最多 4 个、整份 UI 最多 32 个。
- **编辑器行为**：阅读时按上述范围严格校验并拒绝未知属性（粒子没有 `enabled`）、非有限值、越界、范围倒置、未声明图片、repeat 内声明与预算超限，错误保留文件名、控件 ID 与原因；添加控件要求先选择已声明纹理，默认参数为 `rate="24"` 等可用初值；属性检查器提供雨/雪/花瓣/光点预设（只填草稿）、发射器说明与预算提示；设计画布绘制虚线发射区域、纹理静态样本与 rate/burst/autostart 标注，不执行发射、时钟、随机或引擎状态。
- **JS 命令**：事件向导新增“控制粒子发射器”，生成 `ctx.particles("发射器").start()/stop()/clear()/burst()`；start 要求该发射器 `rate > 0`，burst 要求已声明 `burst`，目标必须是已声明发射器，循环/动态/多条命令的写法保持源码维护（`editable=false`）。发射器必须位于提交后仍在页面栈中的页面，`game.enter` 与 `screen.open/close` 不接受粒子命令，由匹配播放器在运行时整批校验。
- **总音量**：`ctx.setting("master_volume", ctx.value)` 通过设置白名单，静态预览的 `settings` 示例加入 `master_volume`；settings.json 仍由玩家播放器维护，编辑器不创建或改写。
- **UI 编辑器快捷键与布局**：`Delete`/`Backspace` 删除选中控件、`Ctrl+D` 复制、`Ctrl+C`/`Ctrl+V` 复制粘贴、`Ctrl+S` 保存属性草稿；输入框/下拉框/`contenteditable` 内的原生按键不被拦截，只读、草稿未保存、表单打开、源码冲突时拒绝并给出原因。画布工具栏提供选中控件复制/删除与快捷键提示，状态栏显示已复制控件；“插入组合标签”收为可展开的次级面板以让出画布高度，粒子说明与预设放在分组属性之前。
- **版本与工具**：从相邻 v0.11.3 `target/release` 重新准备 `resources/tools/win32-x64`（播放器 SHA-256 `f29374094e08f015be52914140df7a7ef6883319c7e3b8db82cd59b168a17873`、打包器 `3689347129a46f6ef63dc830662b3c4ecd6baf8b693ce71be84d80e897591e36`），`tools.json` 为 0.11.3；工程清单默认生成并接受 0.11.3（保留 0.8.3–0.11.2 打开兼容），调试客户端、`prepare-tools`/`verify-release`、工程清单 schema 与状态栏同步。story 8 / UI 3 / save 9 / profile 1 / read 1 / 隐藏槽 1 / KPAK 1、2 与 demo content-version=11 不变。
- **验证边界**：静态画布、单元/浏览器测试与真实 `--check`/KPAK 只证明声明的属性与命令可被引擎接受；粒子容量、菜单/失焦/调试暂停、设备重建、跨 GPU 表现与真实窗口中的快捷键行为仍需匹配播放器手工验收。

## 3. 新版 JS 注册 API、独立事件与控件绑定（0.11.0 / 0.11.1）

同步 Kakera v0.11.x，剧情和界面注册不再使用全局 `on.*`：

- **剧情与生命周期**：`frame("幕ID").advance(targetOrRun)`、`.choice("选项ID", targetOrRun, when?)`、`.end()`；离幕/进入用 `frame(id).exit/enter(...)`，页面关闭/进入用 `ui("页面").bind("screen.close"/"screen.open", ...)`。全局进入钩子固定为 `ui("$game").bind("game.enter", ...)`；v0.11.1 起快捷键捕获结果也改用普通 `event.register(结果事件ID, 回调)`，不再需要 `$host` 绑定。
- **独立事件定义**：普通界面回调先写 `event.register("事件ID", 回调)`，同一 ID 只能定义一次；多个控件共享同一事件，未绑定定义允许存在。控件 XML `event`、页面 `background-click`/`background-right-click` 或单参数 `ui("控件或页面").bind("事件ID")` 是三种引用方式，控件事件可以省略或为空。`screen.open/close` 仍是生命周期，由页面生命周期编辑维护。
- **编辑器行为**：交互事件列表显示事件 ID 与已证明的绑定目标；编辑动作会替换该 `event.register`，改名同步可证明的 XML 属性与脚本 bind，删除前要求解除全部引用。新增控件、`color-picker` 自动事件和快捷弹窗只引用已有定义（没有定义时自动创建新 ID），不再复制其他目标的回调。`route` 按钮、只读控件、重复 bind、未知引用与保留名称仍在校验或诊断中拒绝。
- **旧脚本迁移**：`on.*` 与 v0.11.0 两参数普通 `ui(id).bind("事件", 回调)` 已被播放器删除且无别名；旧工程在启动、`--check` 和打包时会被拒绝。编辑器遇到旧注册只给带上游 API 第 37.2–37.4 节指引的诊断，不自动整文件迁移，也不把旧注册猜成可编辑事件。
- **工具与版本**：模板、受管路线文件头（`Kakera Managed Routes v2`）、真实引擎检查、KPAK 1/2 和宿主测试同步到 v0.11.1；插件版本按“x.y 与上游一致”的规则升至 0.11.1，已在 AGENTS §8 记录。

## 4. 组合标签与 repeat 通用分页（0.11.2）

- 脚本装配阶段用 `component.register("x-名字", { props, expand })` 注册加载期组合标签，UI XML 直接写 `<x-名字 …/>`；展开结果仍是普通 UI 3 节点。标签名、prop 名与类型、必需/默认属性、实例内 `id` 与 `$root` 映射、`binding` 的 `valueType`，以及 `expand` 只能返回单个 `panel`/`nine-patch` 根等约束由匹配引擎最终校验，编辑器只静态认识可证明的顶层字面量注册，动态名/别名/函数内注册给 `componentUncertain` 诊断并暂停相关改写。
- 内置组件 `x-tabs`/`x-pagination` 的唯一来源是 `packages/source/src/ui-components.ts` 的 `BUILTIN_COMPONENTS_SOURCE`，新工程模板 `scripts/components.js` 必须与它字节一致（有测试断言）；插入时写注册到**已声明**脚本，不新建文件。
- repeat 通用分页要求 `page-size`（1–200）与 `page-bind` 成对，`page-bind` 引用已声明 UI int 且 `min="1"`、`max` 不小于实际最大页数，一个页变量只能绑定一个 repeat；只读元数据绑定仅为 `repeat.<完整节点ID>.<字段>`（`page/pages/pageSize/total/start/end/canPrev/canNext/pageText`），未分页或不存在的引用报错。页码、页缓存、滚动与焦点都不入剧情槽或隐藏交接文件。
- story 8 / UI 3 / save 9 / profile 1 / read 1 / 隐藏槽 1 / KPAK 1、2 与 demo content-version=11 不变；旧播放器拒绝新语法。`--check` 只校验 XML 引用、分页声明与元数据绑定，不执行普通事件回调，命令名错误另需在源头审查或真实窗口验证。
- 编辑器侧的操作入口见 [21 使用说明](21-usage-guide.zh-cn.md) 第 3.5–3.7 节；规则细节以[仓库协作规范](../AGENTS.md)与上游 API 为准。

## 5. 幕/页面生命周期与隐藏交接（0.7.0 / 引擎 v0.9.0）

同步 Kakera v0.9.0：`frame(id).enter/exit`、`ui(page).bind("screen.open"/"screen.close")` 被识别为独立的源码生命周期注册，不混入 `frame(id).advance/choice/end` 或按钮事件；静态目标参与删除保护，动态/缺失目标显示约束。`ctx.present` 和 `ctx.resume` 可由事件向导追加，帧/页面目标在写入前校验。视频只在 UI `ui-media.sequence` 中创建；frame 级 `<video>`、`ctx.skipVideo` 和 `game.videoPlaying/game.videoSkippable` 等旧契约会显示诊断或不再出现在绑定建议中。隐藏 `flow-checkpoint.json` 与 `ui-audio.json` 等玩家文件一样排除出冻结代次和发行包；save 9 由真实播放器负责，编辑器不写玩家槽位。

引擎 v0.9.1 起末幕不再因末幕身份被禁止 `frameExit`：文字完成后的手动继续执行一次，补全不触发，自动播放/Ctrl 仍在结尾停止；UI 返回同一末幕不重放进入/退出。编辑器提示不得再写“结束幕没有离幕动作”。

## 6. 游戏国际化与独立语言偏好（0.10.1）

同步 Kakera v0.10.1 的默认关闭游戏本地化：

- **清单与消息**：入口 `story.xml` 可声明 `<localization enabled="true" src="languages.xml"/>`；清单 schema 1 分别声明文本语言（messages 与 font）和可选语音语言（clip 映射）。编辑器读取全部已声明语言和 FTL，严格校验语言标识、默认值、字体/音频引用、重复、预算与参数引用；结构错误阻止加载，覆盖/参数问题显示为定位诊断。
- **文本来源**：frame `<text>` 的 `key`、option `text-key`、character `name-key`、剧情变量 `label-key`、UI label/button/toggle 的 `text-key`/`text-key-bind`、画廊 `title-key` 和 UI 根 `title-key`/`title-key-bind`。UI 另有最多 16 个 `text-arg`，只允许 UI 标量、`cg.total/unlocked`、`saves.page/pages`、`locale.text/voice`；动态 key 只绑定 UI string。编辑器在幕、选项、人物、UI 控件、画廊和标题属性中提供来源切换与 key 选择；无 key 的字面量保持原样。
- **本地化面板**：工程设置新增“本地化”，可编辑默认文本/语音、文本语言显示名、消息新增/编辑/删除，以及语音语言显示名和 clip 映射；消息正文保留 Fluent 参数/术语/select 语法，不支持属性、函数或带参数术语。面板不自动创建新清单/FTL 文件；新增语言文件仍需在源码建立后再编辑。
- **玩家选择**：事件向导可写 `ctx.locale("text"|"voice", 已声明 ID 或 null)`；UI 绑定建议加入 `locale.enabled/text/voice/textRequested/voiceRequested/textSource/voiceSource`，repeat 数据源加入 `textLocales`/`voiceLocales`。编辑器只写 XML/JS，`language.json` 是匹配播放器的独立偏好，不属于 KPAK 内容、冻结代次或发行包；静态画布按默认语言和初始值格式化预览，不执行 `ctx.locale`、系统语言探测或偏好写入。
- **版本与工具**：播放器/打包器升级 v0.10.1，`tools.json` 哈希、工程清单、调试版本和发行检查接受并默认生成 0.10.1；story 8 / UI 3 / save 9 / profile 1 / read 1 / KPAK 1/2 与 demo content-version=11 不变。实际引擎 `--check`、KPAK 1/2 和全语言依赖检查见[实现记录](12-implementation-status.zh-cn.md)。

## 7. 快捷弹窗、玩家快捷键与 HSL 配色（0.10.0）

同步 Kakera v0.10.0 的三个 UI 扩展工作包：

- **快捷弹窗**：使用普通 XML 模态 `screen`，不新增原生对话框样式。UI 编辑器的“＋快捷弹窗”写入遮罩、面板、可选标题、正文和确认/取消按钮；确认动作可为 `route="close"`、调用已有事件，或自动追加 `ctx.quit()` 事件。生成页面不修改剧情路由；取消按钮始终关闭当前页。
- **玩家快捷键**：作者用 UI 控件和普通事件组合设置页。事件向导写入 `ctx.captureShortcut(动作, 结果事件)`、`ctx.cancelShortcutCapture()`、`ctx.keybinding(动作, 绑定或 null)`、`ctx.resetKeybindings()`；绑定只接受文档列出的 ASCII token，按 Ctrl、Alt、Shift 规范排序，拒绝 Escape、Meta、Ctrl+Alt 和系统保留组合。捕获结果通过结果事件的 `ctx.value` 交给作者草稿，不自动写文件；编辑器不创建 `keybindings.json`。XML 可绑定 `shortcuts.advanceLabel/fastForwardLabel/skipSequenceLabel/captureText/captureActive/bindings.*`，画布按默认绑定显示示例文本。
- **HSL 方形与配色**：根级 `<palette><color id="..." initial="#RRGGBBAA"/></palette>` 声明作者配色槽位（`[a-z][a-z0-9_]{0,63}`，最多 32 个，可在 include 中声明）；`color-bind` 可把 panel/image/nine-patch/label/button/toggle 绑定到 `ui.<string>` 或 `colors.<槽位>`，与静态 `color` 互斥。`color-picker` 必需 `value`（UI string）和 `event`，`alpha` 可隐藏透明条；`alpha=false` 至少 128×128，默认/`true` 至少 128×154（推荐 256×256 / 256×282），最多 8 个、不能放入 repeat。控件只绘制环、正方形和可选 alpha 条；没有内置色块预览或 HEX，需用 `color-bind` 面板/图片和 `bind` label 读取同一草稿组合。色盘直径 `D=min(W,H−R)`、`R=alpha?26:0`，整组居中，矩形内留白点击不改色。事件值为规范 `#RRGGBBAA`，拖拽只产生候选，作者用 `ctx.setUi` 决定是否提交。

这不是编辑器随意拆分，而是引擎设计：`color-picker` 只接受 UI string 草稿，`palette` 是作者默认/玩家覆盖层，`color-bind` 只读槽位，持久化由 `ctx.colorPreference` 完成。添加选色器时更新事件留空会自动生成 `ctx.setUi("草稿", ctx.value)`，避免松开后回到旧值；也可在事件向导选择“设置 UI 变量（使用控件当前值）”。编辑器提供色相环 + S/L 正方形 + alpha 条的属性色盘和画布预览；玩家 `ui-colors.json` 由匹配播放器维护，编辑器不写该文件。

0.10.1 把旧 HSV 三角形替换为编码 sRGB HSL：环调 H，方形横向 S=0…1、纵向上 L=1 下 L=0；整个方形含边界可点击，拖出按轴夹取且锁定手势区域，释放终点先处理再清理。黑/白保留 H/S，灰色保留 H；自身 RGBA 回显保留浮点标记，外部不同颜色重新定位，隐藏 alpha 不丢透明度或 RGB。XML/JS、UI 3、RGBA、palette 和玩家偏好格式不变，不写玩家偏好，不新增旧形状开关。

## 8. 工程图标与视觉色调（0.10.4 / 0.11.2）

仓库根目录的 `kakera.svg` 是唯一图形来源；0.11.2 起按新图形（四块碎块被白色“K”形缝隙分开）重绘派生图标，四个品牌色 `#0058E0`/`#008AFF`/`#0060A8`/`#FF6FE3` 不变。`resources/kakera.svg` 是根目录图形拆出的 24×24 单色标记，继续作为 Activity Bar 图标——VS Code 会把扩展图标当成 alpha 掩膜再用主题前景色着色，所以该文件只用一种灰填充，外轮廓取自图形的圆角方框，碎块与“K”形缝隙保持透明；`resources/kakera.png`（256×256，透明背景）由同一图形直接渲染（含原图的白色底面与投影），作为清单 `icon` 出现在 VSIX 与市场页。

工作台、UI 编辑器和创作首页的品牌位使用内联 `KakeraMark`，它同样先画白色底面再叠四块碎块，因此“K”形缝隙与 PNG 一致，而不是让背后界面透出；创作首页 Webview 面板通过 `iconPath` 在编辑器标签显示该 PNG。分镜/UI 自定义编辑器的标签图标由宿主文件图标主题决定，`contributes.customEditors` 没有图标字段，不接管。

界面色调沿用图形本色，深色/浅色主题分别配平表面、边框、按钮与画布；面板标题、抽屉标题、检查器分段、页签、保存按钮和提示卡片使用内联 SVG 图标（`currentColor` 单色，不引入外部字体或网络图标）。这些改动只影响呈现层，按钮文字、无障碍名称和测试选择器保持不变。

## 9. 历史版本增量摘要

- v0.6.2 同步 ui-media/`screen.sequence`/`button.sound` 演出与音效声明；旧同版本 release 工具可能没有这些能力，准备工具前需从对应源码构建并用真实引擎验收。
- 历史 UI 拆分补丁曾沿用 v0.8.3 版本号；按钮原生导航及 UI 演出增量沿用 v0.8.4 版本号。
- v0.9.0 增加生命周期、隐藏交接槽与 save 9；v0.9.1 增加末幕退出和 UI 显式起始幕。
- v0.10.0 增加快捷弹窗、玩家快捷键、HSL 方形/配色槽位与动态图片查看组合；v0.10.1 增加默认关闭的游戏文本/语音国际化、Fluent 词条、独立语言偏好与 `ctx.locale`。
- v0.11.0 把 JS 注册改为 `frame()`/`ui()`、按目标绑定事件并移除旧 `on.*`；v0.11.1 把普通界面回调拆为独立 `event.register` 定义与可选控件绑定，删除两参数普通 bind 和 `$host`。
- v0.11.2 增加 `component.register` 组合标签（内置 `x-tabs`/`x-pagination`）与 repeat 通用分页，新工程模板补齐 7 个常用页面，并按新图形更新工程图标。
- v0.11.3 增加 `<particles>` 2D 图片粒子与 `ctx.particles` 命令、`settings.master_volume` 总音量；编辑器新增粒子可视化、UI 快捷键与画布/检查器布局调整。

准备工具时从当前 v0.11.3 源码编译 release 后重新运行准备脚本；自定义工具目录必须含 `tools.json` 哈希清单，并通过 **Kakera：配置播放器工具目录** 设置。当前不包含 Live2D Core。
