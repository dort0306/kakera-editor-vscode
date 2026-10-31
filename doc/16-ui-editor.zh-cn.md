# 16 UI 编辑器与上游拆分适配

## 0.6.1 页面导航（播放器 v0.8.4）

已核对相邻引擎的 v0.8.4 源码及实施/验收文档。button 新增 `route="open:页面ID"` / `route="close"`，与 event 严格二选一，目标在完整 include 装配后校验。其他控件继续使用事件。

选择按钮，在“按钮导航”设置“打开页面”及目标，或“关闭当前页面”，然后保存属性。已有 JS 不删除或改写；切回“使用交互事件”时需选择具体事件。按钮尺寸/样式编辑保持原有导航属性。

“编辑目标页面”用于设计时快速切换，不执行按钮。画布单击仍用于选中控件。运行时 open 根据目标 modal 属性压栈或替换根页，close 关闭顶层；唯一根页不能关闭，重复模态或栈超限按引擎事务拒绝。导航不具备剧情跳转或文件访问权限。

原生 route 需要 v0.8.4；随包工具已更新。旧 v0.8.3 工程清单仍可读取，原有 event + JS 导航保留。源码、表单与真实两种 KPAK 检查覆盖跨文件目标和打开/关闭声明；本轮未重新进行播放器窗口的手动点击/媒体听感验收。

日期：2026-10-28。插件 v0.6.0，播放器仍为 v0.8.3，story 8 / UI 3 / save 8，KPAK 1/2 不变。

## 上游扫描

只读检查相邻 `kakera-avg-rust` 的当前源码、未提交变更、UI 手册、拆分方案/验收、demo 及 release 工具；没有修改上游。HEAD 为 `dea14ed`，新拆分实现尚在上游工作树中，不能把 HEAD 本身当作已包含该补丁的证据。

本次变化集中在 `src/interface/source.rs`、loader 和两种 package 装配路径：

- UI 入口由 story 的 `interface.src` 指定；根级 `<include src="ui/page.xml"/>` 相对游戏根读取。
- 子文件仅允许 `<ui schema="3">` 根；完整 screen、variables、gallery 和嵌套 include 按声明顺序深度优先展开。入口独占画布/初始页面/窗口标题属性，不支持控件内 include 或组件片段。
- 最多 128 文件、含入口 16 层；源累计和合并 XML 各 1MiB；原有 64 页、1024 控件、控件深度 8、128 UI 变量和 256 CG 不放宽。重复/大小写重复、循环、越界路径拒绝。
- KPAK 1/2 均把 UI 合并到原入口路径，移除实际展开的子文件，保留 JS 和其他依赖，源工程不变。

以插件解析器只读扫描当前上游 demo，得到 14 个 UI 文件、12 页、186 控件、11 UI 变量和 44 个事件，解析无警告。该扫描验证源码映射，未把它等同于本轮完整 demo 媒体/GUI 验收。

本地已准备包含该补丁的 release 工具，实际哈希记录于 `resources/tools/win32-x64/tools.json`。同为 v0.8.3 的旧二进制未必支持 include；本轮通过真实拆分工程和两种 KPAK 的完整检查验证随包工具。没有在插件中另造打包合并器。

## 使用

工作台顶部点击“UI 编辑器”，在 Activity Bar 侧栏“界面”点击某个 UI XML，或命令面板执行“Kakera：打开 UI 编辑器”；侧栏左键按文件打开 Custom Editor，入口保持初始页面，子文件定位到该文件首个页面；右键“打开 UI 源码”打开原 XML。直接“打开方式 → Kakera 分镜”打开所属 UI 文件也会进入 UI 模式。

1. 左侧选择页面，再从控件树或画布选择控件；树显示稳定 ID 与原文件位置。
2. 中间选择控件类型、父容器及必要的图片/事件，点击“添加控件”。支持 scene、panel、image、nine-patch、label、button、slider、toggle、repeat、v0.10.0 的 color-picker 与 v0.10.1 的本地化文本来源。
3. 拖动调整相对父级位置，右下角手柄调整宽高；移动超过 4 屏幕像素才开始拖动，支持 8px 吸附、缩放和 Escape 取消。方向键微调 1px，Shift+方向键 8px。
4. 右侧填写尺寸、样式、文字/图片与绑定、事件、图集 region、点九 density、列表数据源及单元格等实际属性。“保存属性”后台验证后直接保存；拖动/缩放松手自动提交。
5. “层级与顺序”可选择目标页面和父容器，移动到绘制最底层/最顶层。坐标继续相对新父级，不自动改写事件脚本。复制为整棵子树生成新 ID，复用既有资源和事件。
6. “新增页面”选择一个已加载 UI 文件，可在创建时指定唯一标识；已有 ID 不自动改名。初始页面必须存在且非模态。被脚本明确或动态 `open` 引用的页面不能直接删除。
7. “UI 变量”创建 int/bool/string，编辑初始值和整数范围，或删除未被引用的变量；已有类型/ID 保持，int 始终用十进制字符串传输。删除前检查控件绑定、窗口标题、已识别事件和脚本中的 `ctx.ui`/`ctx.setUi` 引用；无法证明归属的动态脚本访问拒绝删除。文字空初始值、换行/Tab 和 XML 实体正确保存。
8. “新建事件”支持打开/关闭页面、推进、重开、选择 choices 列表项及滑条/开关更新白名单设置。追加到已声明脚本；已有回调只供选择与源码定位，不自动重写自定义逻辑。

新建或删除、跨页面移动都不要求作者审阅源码差异。修改仅涉及本次文件；源码并发变化时草稿保留，旧 revision 不覆盖新内容。宿主撤销/重做恢复缓冲，必要时用 VS Code 保存，不承诺磁盘多文件原子事务。

### 侧栏 UI XML 导航（0.10.2）

Activity Bar 的 Kakera“界面”分类按入口和 include 深度列出全部已加载 UI XML；文件条目使用稳定路径 id。左键调用 `kakera.ui.open` 打开该 XML 的可视化编辑器：入口保持声明的初始页面，include 子文件自动定位到该文件中声明的第一个页面。右键“打开 UI 源码”调用 `kakera.ui.source` 打开原 XML 文本编辑器。UI 结构损坏导致 include 无法遍历时只回退显示入口；不会为了导航猜测、复制或改写文件。

## 预览边界

- 静态画布使用 UI 变量初始值、当前选中幕的说话人/台词及示例列表，不读取真实存档或执行 JS。scene 当前显示画面占位；动态生命周期、媒体、滤镜、动画、换行/字体精确效果和事件执行以播放器为准。
- 父容器裁切、点九内容区坐标及伸缩分段采用当前引擎规则。repeat 显示最多十个示例项；修改模板一次，所有示例跟随。默认显示隐藏控件以便选择，可关闭；禁用控件仍可在设计画布选择。
- 普通图片/点九在独立串行 Worker 中解码，单图 8MiB、边长 4096、4M 像素；单次页面预览最多八张图、16M 像素，任务最多八个等待，内存索引最多 32 项。超预算或失败显示占位及原因，最终引擎资源预算不变。
- 每次预览最多 2000 个实例；不是大规模 UI 性能承诺。SVG/HTML 文本与 URI 按数据处理，图片仅来自已声明资源和私有缓存，CSP/Workspace Trust 仍生效。

## 数据与写入

`ui-files.ts` 统一有界 include 遍历。Session 读取入口及所有子文件的当前 TextDocument，纳入版本、revision 和冻结代次；无 include 的单文件仍使用同一 UI 3 契约。

`ui-source.ts` 按原 XML 范围编辑，保留未修改的注释、排版、ID、其他控件及文件；移动携带原控件片段，复制仅替换子树 ID。新事件仅追加白名单回调。前端 UiDesign/示例是可重建的只读投影，不写入 sidecar，不作为另一份游戏来源。

保存经过命令白名单、信任检查、版本复查、私有冻结、真实 CLI 校验和 WorkspaceEdit；不覆盖打开缓冲。新图片继续沿用版本化资源导入；标题绑定变量与纹理应用可位于任意实际包含文件。

## 检查与剩余范围

实际运行结果以 [12 实现记录](12-implementation-status.zh-cn.md)为准。新增测试覆盖 include 安全/预算、原文件编辑保真、标题/纹理跨文件、层级/复制/删除、变量与事件、点九与 repeat 坐标、表单请求、原生浏览器输入、宿主未保存子文件和跨文件 undo/redo，以及真实两种 KPAK 合并/独立加载/源不变。

当前未提供可视化 include 新建/迁移、组件模板、自动布局约束、批量多选对齐、事件图/任意 JS 回调重写、完整 CG 数据编辑器或动画时间线。新增页面写入已加载 UI 文件；需要新的拆分文件时先在源码添加合法 include，再在编辑器操作其中页面。没有完成所有 DPI/触屏/笔、最低 VS Code 版本或整套播放器媒体/听感的手工矩阵。

## UI 演出与音效增量（0.6.2）

扫描依据为相邻引擎 HEAD 00a08e2 之上的当前工作区增量：interface/presentation.rs、script/bridge.js、app/ui_media.rs、demo/ui/presentation.xml 及 UI 演出验收文档。上游仍报告 v0.8.4，格式版本不变；不能只凭版本号使用旧 release 工具。

顶部“演出与音效”编辑 ui-media 下 sound/sequence 声明。支持 clip 的 asset/actor/weight/enabled，fade 的 target/from/to/duration，video 的 asset、sound 的 ref，序列的 finish/skippable。步骤可添加、上移、删除；已有声明保持 ID 与文件。淡入淡出目标排除 repeat 子树；引用、角色归属、预算及运行规则由真实引擎最终验证。每次仅重建选中声明范围，保留其他文件与手写 JS；声明内注释保留但可能移到步骤之前，不声称整声明逐字往返。

页面 sequence 自动触发和按钮 sound 写入真实属性。事件向导追加 ctx.sequence/playSound/soundEnabled/soundActor/soundExclude；三种偏好命令适合使用 bool 值的开关控件。新增 audio.enabled、audio.actor.ID、audio.excluded.ID 绑定建议，画布使用默认示例值。运行时随机过滤、视频、透明度、跳过、偏好落盘由播放器负责；编辑器不播放这些媒体，也不写玩家偏好文件。ui-audio.json 排除出冻结代次，真实打包器排除其发行依赖。

## 幕/页面生命周期与交接（0.7.0，播放器 v0.9.0）

扫描相邻引擎 v0.9.0 的 `src/app/lifecycle.rs`、`src/interface/presentation.rs`、`src/app/ui_media.rs`、`src/controller.rs`、`src/save.rs`、demo 与 API 第 31–32 节。story 8/UI 3 保留，save 升到 9，demo content-version=9，KPAK 1/2 不变。frame 视频、`ctx.skipVideo` 和 `game.videoPlaying/game.videoSkippable` 已删除；视频只允许出现在 UI `ui-media.sequence` 中。

当前幕属性底部提供“幕结束后（离开时）”：选择“打开页面”并选择目标，生成独立 `frame("幕").exit` 中的 `ctx.open`。保留原 Advance/Choice 后续与变量更新，只有正常路线验证成功、确实离开幕时才交接；结束幕不会凭空触发退出，自循环仍按引擎规则触发。

UI 页面的“页面属性”底部提供“页面结束后（关闭时）”：选择“续接指定幕”生成 `ui("页面").bind("screen.close", ...)` 的 `ctx.resume(幕)`，选择“恢复待续剧情”生成 `ctx.resume()`，选择“打开页面”生成 `ctx.open(另一页面)`。目标只能是当前已声明页面或实际幕，不能选待连接占位；关闭后重开自身在表单与宿主均拒绝。页面须真正关闭才触发，演出自然结束/跳过后自动续接时，把序列 finish 设为 `close`；finish=`return` 不关闭页面。普通页面可用 route=`close` 的按钮关闭。

两处均点击“保存结束后动作”后台验证并直接保存，选择“不添加动作”移除已识别的简单注册。新动作追加到已有声明脚本；既有单条固定 open/resume 回调只补丁调用节点，保留其他源码和调用旁注释。自定义/多条语句/共享函数/动态/重复或归属不明的注册保持只读，显示源码位置或原因，不自动接管。源码缓冲变化时重读，过期草稿拒绝保存；支持宿主撤销/重做。这些注册不进入剧情连线或按钮事件列表，`frameEnter`/`screenOpen` 等其他回调仍由源码维护。

“新建事件”新增 `ctx.present(页面)` 和 `ctx.resume()`/`ctx.resume(幕)`。present 目标必须是已加载页面；resume 可选实际幕，留空表示恢复待续位置；不允许待连接占位或保留生命周期名。写入仍只追加白名单回调，已有手写 JS 不重写。

旧 `frame.video` 在故事工作台显示错误诊断，旧 `game.video*` 绑定在 UI 编辑器给出源码警告并从绑定建议移除；画布不模拟视频、演出、生命周期或隐藏槽。每次保存仍由真实 v0.9.0 引擎校验，`flow-checkpoint.json`、`ui-audio.json` 与玩家槽位不进入冻结代次或发行包。编辑器不写隐藏槽、不迁移 save 8、不执行 UI 返回。

## 快捷弹窗、玩家快捷键与 HSL 配色（0.10.0，播放器 v0.10.0）

扫描依据为相邻 `kakera-avg-rust` v0.10.0（提交 `9924e85`）的 `src/color.rs`、`src/interface/palette.rs`、`src/app/colors.rs`、`src/shortcuts.rs`、`src/app/shortcuts.rs`、`src/interface.rs`、`src/interface/render.rs`、demo `ui/confirmation.xml`、`ui/shortcuts.xml`、`ui/colors.xml`，以及 API 第 33–35 节和 UI 扩展性验收。story 8 / UI 3 / save 9、KPAK 1/2 与 demo content-version=11 不变；`keybindings.json` 和 `ui-colors.json` 是玩家偏好，匹配播放器负责加载、校验和原子保存，编辑器既不读取也不写入它们，冻结代次和发行包按文件名大小写不敏感排除。

### 快捷确认弹窗

“＋快捷弹窗”把所选 UI 文件作为写入目标，可填写页面 ID（留空由短 ID 生成器创建）、标题、正文、确认/取消文字和确认动作。生成内容是一页普通 XML 模态 `screen`：

```xml
<screen id="…" modal="true" pause="true">
  <panel … color="#000000B8" />
  <panel … color="#18232AF2" radius="16">
    <label … text="退出游戏" … />
    <label … text="确定退出吗？" … />
    <button … text="退出" event="…" … />
    <button … text="取消" route="close" … />
  </panel>
</screen>
```

确认动作有三种：`route="close"`、调用已注册普通事件、或生成 `ctx.quit()` 事件（自动选择不冲突的事件名）。遮罩、面板、按钮尺寸按画布居中计算，全部使用现有控件属性和短 ID。标题留空时不生成标题 label；取消始终 `route="close"`。工具不自动创建打开弹窗的按钮/事件，也不把正文改为绑定；作者可继续用属性检查器改成 `bind`/`visible` 或添加入口。`ctx.quit()` 只在普通事件回调（`event.register` 定义的固定动作）中合法，不写剧情、存档或玩家偏好；真实退出补写由播放器负责。

### 玩家快捷键

事件向导新增四个普通 UI 动作：

| 动作 | 写入 |
| --- | --- |
| 捕获键盘快捷键 | `ctx.captureShortcut("动作", "结果事件");` |
| 取消快捷键捕获 | `ctx.cancelShortcutCapture();` |
| 修改快捷键绑定 | `ctx.keybinding("动作", "规范绑定");` 或 `ctx.keybinding("动作", null);` |
| 恢复默认快捷键 | `ctx.resetKeybindings();` |

“动作”只列 `advance` / `fast_forward` / `skip_sequence`。绑定输入接受作者大小写并规范化：修饰键固定 Ctrl、Alt、Shift 顺序，主键为文档 token 表，最多 64 字节 ASCII；拒绝 Escape、Meta/Windows、Ctrl+Alt、系统保留组合、重复 token、空白和裸 `+`。留空绑定写 `null` 表示禁用该键盘动作；编辑器逐条校验 token 和保留组合，跨动作的按住前缀冲突、整批交换和最终偏好写入由匹配播放器事务校验。

捕获结果事件通过 `ctx.value` 收到规范绑定，`ctx.item.action` 收到动作 ID；v0.11.1 起结果事件是普通 `event.register(结果事件, …)` 定义，不需要 `$host` 或控件引用，`captureShortcut` 只按事件 ID 查找。编辑器在表单中从已定义事件选择结果事件，不实现捕获状态机，也不自动写文件。作者通常用 UI string 保存草稿，再由“应用”按钮生成 `keybinding` 事件。设计画布把 `shortcuts.advanceLabel`、`fastForwardLabel`、`skipSequenceLabel`、`captureText`、`captureActive` 和 `shortcuts.bindings.*` 作为默认示例值预览；显示 Label 只用于界面，不能当存储格式回解析。

### HSL 方形、配色槽位与 color-bind

`palette` 只能声明在 UI 根级（入口或 include 子文件均可），槽位 ID 为 `[a-z][a-z0-9_]{0,63}`，每项必需 `initial`，装配后全局唯一、最多 32 个。编辑器的“配色槽位”区域可新增、改初值或删除；ID 创建后固定，删除会先检查控件 `color-bind` 与已识别 `colorPreference` 事件。未覆盖的动态 JS 引用交给真实引擎校验，编辑器不猜。

palette 与 UI string 分开是匹配引擎的设计，不是编辑器另造模型：`color-picker` 的 `value` 只接受 `ui.<string>` 草稿，不能直接绑定 `colors.<槽位>`；`palette` 保存作者默认和玩家覆盖，`color-bind` 只读取槽位，持久化由作者的 `ctx.colorPreference(slot, draftOrNull)` 提交。常见写法是页面打开时把 `ctx.colors[slot]` 复制到草稿，选色器更新草稿，应用时再写回槽位。编辑器提供 `color-bind` 和 `colorPreference`，不把两个命名空间合并，也不在静态预览中写玩家偏好。事件向导的“保存颜色覆盖”可选择固定颜色、作者默认（`null`）或读取已声明的 UI string 变量，生成 `ctx.colorPreference("槽位", ctx.ui.变量)`；不能写成点号的 ID 使用 `ctx.ui["变量"]`。

`color-picker` 的编辑约束与引擎一致：

- 必需 `value`，且只能指向已声明 UI string；该变量初始值必须能解析为 `#RRGGBB` 或 `#RRGGBBAA`。
- 可选 `event`：v0.11.1 起可以省略或为空，此时控件仍占据交互区域但不会提交颜色，只显示 `value` 初始值。非空时必须引用一个已定义事件（XML `event` 或该控件上的单参数 `ui(...).bind(事件ID)`），该事件只有在直接调用 `ctx.setUi("草稿变量", ctx.value)` 时才会提交候选；否则播放器在松开后回到绑定变量的已提交值。添加控件时“更新事件”留空会自动创建独立的 `event.register` 定义并写入 XML `event`；事件向导也有“设置 UI 变量（使用控件当前值）”动作可手动创建或修复。
- 编辑器会显示两类解析注意事项：事件写入的 UI 变量与 `value` 不一致，或事件是 `open`/`colorPreference` 等不会调用 `ctx.setUi` 的固定动作。手写共享函数或动态提交无法证明时不误判，仍以匹配播放器为准。
- 可选 `alpha="true|false"`，默认显示透明条；隐藏 alpha 条不强制改写原颜色的 alpha。
- `alpha=false` 时宽高至少 128×128；`alpha` 默认/true 时色盘直径至少 128，即高度至少 154（推荐 256×256 / 256×282）；整个 UI 最多 8 个；不能放入 repeat；不接受子控件、图片、region、route、color 或未知属性。
- 色盘直径 `D=min(width,height−R)`，`R=alpha?26:0`；环、正方形与可选 alpha 条作为一组在控件外矩形内居中，alpha 条高 18、距色盘 8、左右各留 8、宽 `width−16`。控件自身只绘制环、正方形、可选 alpha 条和焦点/禁用反馈，**没有内置颜色预览或 HEX 文本**；预览用 `color-bind` 面板/图片、HEX 用 `bind` label 读取同一草稿独立组合。控件矩形内留白不启动选色、不改色。
- 拖动只产生候选颜色；事件值规范为九个 ASCII 字符的 `#RRGGBBAA`，由作者回调 `ctx.setUi` 决定是否更新绑定。外部 setUi、打开页面、读档和改布局不回发事件。

颜色属性（`color`、palette 初值、`colorPreference` 事件）使用文本加 HSL 色盘编辑：色相环包围正方形，横向 S 从 0 到 1，纵向 L 从上到下为 1 到 0；上白、下黑、左侧灰阶、右侧中点为当前纯色，可选 alpha 条。整个方形及边界均可点击，拖出后沿两轴夹取，释放时处理最终位置。黑白端点保留 H/S，灰色保留 H，自身 RGBA 回显不丢失浮点标记；外部更改颜色时重新定位。方向键可调色，Shift 加大步长，Esc/失焦/只读取消手势；隐藏 alpha 时仍保留原透明度。组件按编码 sRGB HSL 计算，输出大写十六进制并保留 alpha=0 时的 RGB；这些数学只用于编辑/预览，最终显示由匹配播放器校验。画布上的 `color-picker` 按同一 `D=min(W,H−R)` 几何居中绘制环/方形/可选 alpha，不绘制内置预览或 HEX；它是只读示意图，不能拖动指针或获取焦点。

`color-bind` 可用于 panel、image、nine-patch、label、button、toggle，与静态 `color` 互斥，来源只能是 `ui.<string>` 或 `colors.<槽位>`；不支持 scene、repeat 容器、slider 或任意 JS 表达式。设计画布按当前 palette 初值/UI string 初值着色：panel/image 显示 tint 近似，label/toggle 显示文字颜色，button 只显示背景 tint 并把文字保持默认白色；nine-patch 用半透明覆盖近似整段 tint，精确分段结果需试玩。`colors` 本身只是 JS 只读快照，不作为普通 `bind` 的 XML 绑定源。

### UI 变量删除与颜色覆盖来源（0.10.1 同版本增量）

- **删除 UI 变量**：左侧“UI 变量”条目提供“编辑/删除”。删除只移除声明文件 `<variables>` 中的原标签；存在控件 `bind`/`value`/`visible`/`enabled`/`image-bind`/`region-bind`/`color-bind`/`text-key-bind`、`text-arg`、入口 `title-bind`/`title-key-bind` 或已识别 `setUi`/`colorPreference` 事件引用时拒绝并列出文件/行；脚本中直接 `ctx.ui.变量`、`ctx.setUi("变量", ...)` 以及无法证明名称的动态 `ctx.ui[...]`/`ctx.setUi(名称)` 也拒绝删除。扫描覆盖直接成员访问和调用，不解析先把 `ctx`/`ctx.setUi` 赋给其他名称的间接写法；匹配播放器的 `--check` 不执行事件回调，因此这不只是依赖引擎的静态检查。
- **颜色覆盖来源**：事件向导的“保存颜色覆盖”新增“颜色来源”，可写固定颜色、作者默认（`null`）或读取已声明 UI string 变量；后者生成 `ctx.colorPreference("槽位", ctx.ui.变量)`，不能写成点号的 ID 使用 `ctx.ui["变量"]`。变量初值不是合法颜色时只显示解析注意事项，不阻止保存；实际应用仍由播放器解析并在失败时回滚。编辑器不合并 palette 与 UI string 两层，也不写 `ui-colors.json`。
- **事件动作名称**：动作列表不再附带版本号后缀，只保留功能名称。

### 验证范围

新增的源码/表单回归覆盖 palette 解析与预算、color-picker 尺寸/重复/repeat/绑定限制、color-bind 互斥、快捷键规范化与保留组合、快捷弹窗生成、自动/手动 `ctx.setUi` 更新事件、快捷键事件写入、UI 变量删除引用保护和颜色覆盖读取 UI string；浏览器回归覆盖 HSL 色盘交互以及画布/工作台交互。真实 v0.10.x `--check` 与 KPAK 1/2 集成工程包含 palette、color-bind、color-picker、自动生成的 setUi 事件、快捷键捕获/绑定/重置、颜色偏好（固定颜色与 `ctx.ui` 变量来源）和 `ctx.quit` 弹窗，证明生成内容可被匹配引擎接受；实际按键捕获、焦点清理、跨动作冲突、偏好文件写入/回滚、`ctx.ui` 运行态解析和 D3D11 原生窗口仍需在真实播放器中验收。静态画布不替代这些运行态检查。

## 界面重构（0.8.0）

Webview 统一为现代游戏编辑器/IDE 视觉：应用栏、工程侧栏、舞台/分镜主区和属性检查器使用同一组颜色、圆角、阴影、状态标签与内联 SVG 图标；底部状态栏显示只读状态、幕/变量/提示数和当前路线。工程设置与图片工具从长页面移到右侧抽屉，顶部“工程/图片”和侧栏均可打开，支持遮罩、关闭按钮和 Esc 收起；关闭抽屉不会丢失未保存草稿。

UI 编辑器保留页面/层级树、设计画布和检查器三栏，但新增：页面树图标与文件行、填满可用高度的可滚动树/画布、画布网格、选中框和缩放工具栏、按“布局与外观 / 内容与资源 / 交互与数据”分组的属性，以及底部状态栏。窄窗口改为单列顺序，页面、画布和属性入口均保留；页面树直接按钮顺序和既有 aria-label 不变，虚拟测试仍可定位。

本次只改变呈现和布局，不改变 UI XML/JS 写回、命令 schema、保存事务、冻结代次、预览数据源或引擎契约。浏览器截图来自 Edge 夹具，不是 VS Code 实机 Webview；宿主回归验证命令和缓冲，不替代桌面视觉人工验收。

0.8.1 修复界面重构后的拖动回归：移除的 `touch-action:none`/`user-select:none` 已恢复；宿主重绘导致 pointer capture 丢失时，不再清空已经越过拖动阈值的手势，并可由窗口级 pointerup 提交；未越过阈值的点击/取消语义保持不变。真实工作台 DOM 回归要求流程图拖动发出 `layout` 保存请求。

## 从 UI 显式开始/恢复剧情（0.8.2，播放器 v0.9.1）

“新建事件”的动作“开始 / 恢复剧情（可指定起始幕）”写入普通事件定义 `event.register(事件ID, 回调)`，再由控件 XML `event` 或 `ui(...).bind(事件ID)` 引用：

```javascript
// 可选先打开主界面，再从指定幕开始；也可省略页面。
event.register("start-story", ctx => { ctx.open("hud"); ctx.resume("opening"); });
event.register("hidden-story", ctx => { ctx.open("hud"); ctx.resume("secret-entry"); });
event.register("continue-story", ctx => { ctx.open("hud"); ctx.resume(); });
```

起始幕下拉只列实际幕，不列待连接占位；可选“先打开页面”只列已加载 UI 页面。留空起始幕时生成 `ctx.resume()`，播放器读取隐藏槽 continuation；首次没有隐藏槽会拒绝，编辑器不写隐藏槽也不伪造目标。指定幕沿用隐藏槽变量与历史，不是 `ctx.restart`，不会清空变量。相同页面可在运行期按 modal 规则压栈；编辑器只校验目标页面存在。

页面“页面结束后（关闭时）”生命周期同步支持“从指定幕开始 / 续接”与“从隐藏槽恢复”，由自动 `screenClose` 或关闭按钮触发。显式目标与同批无参关闭回调合并由播放器处理；冲突目标拒绝并保留旧状态。末幕 `frameExit` 在文字完成后的手动继续执行一次，补全不触发；表单提示不再声称结束幕不能退出。

本次只新增控件事件/生命周期写入，不新增 XML 属性或 JS API；宿主仍以匹配 v0.9.1 引擎的验证、隐藏槽原子写和运行结果显示为准。

## 事件编辑/删除与幕 ID（0.8.3 / v0.11.1 独立事件）

“交互事件”列表中的固定事件定义有 **编辑/删除**，v0.11.1 起每行显示事件 ID 与已证明的绑定目标。编辑会预填事件 ID、动作、命令目标和起始幕，保存时替换该 `event.register(事件ID, 回调)` 定义；改名同步可证明的 XML `event`/页面 `background-click`/`background-right-click` 与单参数 `ui(...).bind(事件ID)` 引用，不触碰其他事件。删除前必须解除全部 XML/脚本/`captureShortcut` 结果引用；手写回调、带注释回调、重复定义或非固定动作保持源码维护，不能可视化改写或删除。事件源范围、绑定校验与动作白名单见 [18 使用说明](18-visual-editor-guide.zh-cn.md) 和 [13 实时映射](13-live-logic-mapping.zh-cn.md)。

幕 ID 重命名在故事工作台完成，不在 UI 编辑器；它更新 `<frame>` ID/name、入口和已识别剧情目标，遇到动态路线或生命周期/`ctx.resume` 引用会拒绝。UI 事件中的“先打开页面/起始幕”仍由同一工作台保存链写入。

## CG 资源、画廊与解锁（0.8.4）

`<cg>` 是专用图片资产；故事 `<visual cg="...">` 与 background/portrait 互斥，运行帧为无人物的完整背景。UI 编辑器的“CG 画廊”自动列出所有 CG 资源：无显式 XML 条目时显示自动默认标题（资源 ID、未解锁）；编辑会写 `<gallery><cg id="资源ID" image="资源ID" title="中文标题" unlocked="true|false"/></gallery>`，专用 CG 的 ID 必须等于资源 ID。普通 image 收藏项仍可自定义 ID。

“解锁 CG”事件生成 `ctx.unlock("cg.id")`，留空生成 `ctx.unlock(ctx.game.cgId)`，用于进入 CG 幕时按作者回调解锁；加载 CG 本身不解锁。UI 绑定 `game.cgId`、`cg.total`、`cg.unlocked`、`cg.progress` 来自播放器当前 CG 和独立 profile 集合。编辑器不写 `profile.json`，不把画廊自动条目冒充显式声明；真实引擎校验、KPAK 和运行态共享解锁由匹配播放器验收。

## 多起始幕与 UI 首次进入（0.8.6）

故事检查器的“故事起点”管理空白分隔的 `story.entry` 列表；UI 编辑器本身不重复存储入口。新建“重新开始（可指定起始幕）”事件时：

- 多起始幕必须从已声明起点中选择目标，生成 `ctx.restart("幕")`；
- 可选“先打开页面”生成 `ctx.open("页面"); ctx.restart("幕")`，用于主菜单先切 HUD 再开始；
- 单入口可留空生成 `ctx.restart()`，多入口留空会在保存前拒绝。

播放器启动先显示 UI 初始页面，不自动进入剧情；`game_started=false` 时没有当前幕，调试面板显示空栈，直到 UI 事件显式 resume/restart 或读档。UI 编辑器的静态画布不执行该进入动作；真实条件/生命周期/调试验证必须从实际 UI 起点进入。详见 [18 使用说明](18-visual-editor-guide.zh-cn.md) 和上游 `multiple-entries-implementation-plan`。

## 游戏本地化（0.10.1，播放器 v0.10.1）

UI 编辑器读取全部已声明文本语言/语音语言和 FTL，并在 `工程设置 → 本地化` 提供默认语言、文本语言显示名、消息新增/编辑/删除、语音语言与 clip 映射编辑。清单、FTL、字体和音频仍以源码为事实来源；编辑器可以编辑既有文件，但不自动创建新的清单/FTL 或开启本地化。

- **文字控件**：label/button/toggle 的 `text-key` 引用默认文本语言消息；`text-key-bind` 只接受已声明 UI string。二者与 `text`/`bind` 四选一，切换时写入空属性删除旧来源；`text`/`bind` 的字面量行为保持不变。
- **参数**：key 控件可添加最多 16 个 `text-arg`，name 唯一，`value`/`bind` 二选一；bind 仅允许 UI 标量、`cg.total/unlocked`、`saves.page/pages`、`locale.text/voice`。检查器按默认及全部已声明语言的消息参数契约校验，保存时只写选中控件的参数子节点。
- **画廊与窗口标题**：画廊条目可写 `title-key`；入口 UI 根可写 `title-key`/`title-key-bind`，标题设置提供来源切换。专用 CG 的 ID 约束、`profile.json` 解锁和玩家偏好仍由匹配播放器维护。
- **locale 绑定/数据**：绑定建议和 repeat 示例加入 `locale.*`、`textLocales`、`voiceLocales`；事件向导“切换文本/语音语言”写 `ctx.locale` 固定调用，目标必须是该通道已声明规范 ID 或 null。
- **预览**：画布按默认文本语言和初始 UI 变量格式化静态 key/参数；缺失消息显示 `⟦key⟧`。不执行系统语言探测、`ctx.locale` 事务、字体安装、音频停止/替换、偏好写盘或隐藏槽恢复。

本地化不会改变 story 8/UI 3/save 9 或 UI 页面/include 规则；`language.json` 不进入冻结代次和发行包。详细接口、预算、语音映射与限制见 [19 游戏本地化](19-localization.zh-cn.md)。

## v0.11.1 独立事件与控件绑定（引擎 v0.11.1）

- 普通 UI 回调从 v0.11.0 的 `ui("目标").bind("事件", 回调)` 改为独立定义 `event.register("事件ID", 回调)`，同级事件 ID 只能定义一次；控件 XML `event`、页面 `background-click`/`background-right-click` 或单参数 `ui("控件或页面").bind("事件ID")` 只是引用。控件事件可省略或为空，未被引用的事件定义合法；多个控件可引用同一 ID 共享回调。
- 事件列表显示事件 ID 与已证明的绑定目标（`targets`）。新建事件可选绑定目标（控件/页面、`$game` 或不绑定）；`$game` 仍只接受 `game.enter` 并使用 `ui("$game").bind("game.enter", …)`。`captureShortcut` 结果事件从已定义事件中选择，不再需要 `$host`。`screen.open`/`screen.close` 由页面生命周期编辑维护，不出现在普通控件事件列表。
- 新增控件、复制控件、`color-picker` 自动事件和快捷弹窗只引用已有定义（`color-picker`/`ctx.quit` 在缺少定义时创建新 ID），不再复制其他目标的回调。`route` 按钮、只读控件、重复 bind、同控件 XML 与脚本指向不同事件、未知引用和保留名称都在编辑器诊断或引擎装配时拒绝。
- 旧 `on.*` 与 v0.11.0 两参数普通 bind 已被引擎移除且无别名；编辑器只显示迁移诊断并暂停事件可视化改写，不把旧注册当作可编辑事件，也不自动整文件迁移。命名、删除与结果事件校验按独立事件模型执行；真实装配由匹配 v0.11.1 播放器 `--check` 最终验证。
