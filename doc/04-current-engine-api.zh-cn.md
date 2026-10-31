# 04 当前引擎 API 参考

状态：**现有能力**，核对日期 2026-10-31。用于开发编辑器适配器，不能替代完整 XML/JS 手册。以下 Rust 名称为当前源码接口，不承诺跨版本稳定 ABI；编辑器应与引擎发布版本锁定。当前基线 v0.11.1：story 8 / UI 3 / save 9。

## 1. 格式与入口

| 对象 | 当前契约 | 编辑器规则 |
| --- | --- | --- |
| 游戏入口 | 固定 story.xml，schema 8 | 不能导出旧 schema 或 flow.xml |
| 章节 | 每份一个 next.src 或 next end=true | src 按游戏根解释；链只负责合并，不生成剧情边 |
| XML UI | schema 3，必需 | 使用当前模板，不能依赖内置兼容菜单 |
| 剧情存档 | save 9；story_id/content_version/实际 frame ID/变量/历史（每条 `resume_to`，普通路由为 null） | 不把编辑器对象或调试指针塞入槽位；不迁移 save 8 |
| 隐藏交接 | `flow-checkpoint.json` schema 1，独立于手动/自动槽 | 不显示在槽位页、不进入监控或发行包；编辑器不写该文件 |
| profile/read/UI 音效 | profile/read 各 schema 1；ui-audio.json schema 1 | 测试与正式数据隔离；音效偏好不进入剧情槽 |
| 资源容器 | KPAK 2 默认，1 显式兼容 | 容器兼容不恢复旧内容/存档 |

story 根需要 id、content-version、entry 和 schema；包含 scripts、interface、assets、characters、visuals、variables、frames 等当前分组。后续章节根仅 schema，全链分组先合并再校验；未知元素/属性、命名空间、重复标识及错误引用拒绝。结构细节见主手册第 4、21 节和 [story_chain](../../src/story_chain.rs)。

## 2. 场景与资源映射

| 内容 | 当前 API/语义 | 表单或生成器注意事项 |
| --- | --- | --- |
| frame | id 可省略；缺省时 name 必填；text 恰好一项且非空 | 编辑器新建显式稳定 ID，导入缺省 ID 保留并提示 |
| 作者别名 | entry、JS 注册/目标可解析 name 或实际 id | 名字不得与其他幕的 ID/name 冲突 |
| visual | 完整 background、最多三槽 portrait | 不支持 visual 继承或 frame 内局部覆盖 |
| portrait | character/image/slot 必填；pose 为最终姿态 | 槽仅 left/center/right；动作要匹配最终姿态 |
| options | 每幕内 option.id 唯一、正文非空 | 每个选项对应一个 JS 注册，无默认路由 |
| audio | bgm/voice/se 为 audio 资源 ID | 省略为停止/静音；相同连续 BGM 不重启 |
| video | v0.9.0 禁止 frame 子节点 | 视频只放在 UI `ui-media.sequence.video`；旧 `frame.video`/`ctx.skipVideo` 拒绝 |
| Live2D | portrait 内 live2d 引用模型、动作/表情和参数 | 静态 image fallback 必需；Core 是受信任宿主依赖 |
| 转场/效果 | frame transition、visual/portrait/UI 的既有声明 | 使用主手册枚举和范围，不生成未知效果 |

资源表使用 image、nine-patch、font、audio、video、live2d，src 是游戏根内相对路径。普通 image 当前 PNG/JPEG；nine-patch 是带标记边框的源 .9.png；字体 OTF/TTF；音频 WAV/Ogg Vorbis；视频是否可解码取决于 Windows 系统媒体组件，当前实测为 H.264/AAC MP4。

点九使用资源/UI 专用标签，不能拿普通 image 标签替代；每轴 1–8 个伸缩段，内容区至多一段，density 为 0.125–8。图集继续普通图片资源，image/panel/button 使用 region 或 region-bind（互斥），源像素矩形 x/y 非负、宽高正、不得越界；绑定仅 UI string，修改后只换 UV。见主手册第 26 节和 [image_layout](../../src/image_layout.rs)。

## 3. 剧情 JS 契约

| 入口 | 回调行为 | 不能做的事 |
| --- | --- | --- |
| on.advance(frameRef, callback) | 同步返回目标幕引用 | 不能返回 Promise 或缺失目标 |
| on.choice(frameRef, optionId, callback, when?) | callback 返回目标；when 返回 boolean | 不能为隐藏选项伪造选择，不混合 Advance/End |
| on.end(frameRef) | 注册结束幕 | 继续不默认推进 |

全部 frame 必须覆盖且路由种类与 XML options 一致。条件在更新前变量上计算；主回调收集有序更新；目标条件也通过后才提交变量、位置与历史。动态目标只能在执行边界验证，启动检查不穷举全部路径。

v0.9.0 另有四个独立生命周期注册，不产生剧情路由：v0.11.1 写法为 `frame(id).enter(fn)`、`frame(id).exit(fn)`、`ui("页面").bind("screen.open", fn)`、`ui("页面").bind("screen.close", fn)`（旧 `on.*` 入口已删除）。frame 可用实际 ID 或稳定 name，按实际幕去重；screen 必须是已声明页面。回调只收集 UI 命令，按候选计划整批提交。正常离幕在 Controller 目标/条件/更新验证后触发 exit 再 enter；自循环也触发，读档/隐藏槽恢复/历史重放不重放。`screen.close` 额外允许 `ctx.resume`；进入幕交接与 UI 页面在同一事务提交。编辑器静态分析只读取注册和目标，不执行回调。

| 剧情 ctx | 类型/语义 |
| --- | --- |
| frameId / optionId | name 优先的场景引用 / 选项 ID 或 null |
| vars | 只读草稿视图，int 是 BigInt |
| set(name, value) | 已声明变量赋值，类型/长度/范围校验 |
| add(name, amount) | 仅 int，i64 与声明范围校验 |

主剧情 ctx 没有 setUi、save、open 或任意宿主调用。预先保存的 vars 快照不会被后续更新改写；需要草稿新值时重新读取。每次求值隔离重建 QuickJS，闭包与全局变量不跨事件保存。

## 4. UI XML 与 JS 契约

UI 设计画布为至少 640×360 的 16:9。页面包括 scene、panel、image、nine-patch、label、button、slider、toggle、repeat。位置/基础样式/页面放 XML；交互放 JS。图片、视频、模型均通过资源 ID，不能绑定任意路径。

| 配置 | 当前行为 |
| --- | --- |
| UI root initial | 存在且非模态的 screen |
| screen modal/pause | 页面栈和暂停；仅顶层接收输入 |
| background-click/right-click | 顶层背景事件，控件/黑边/浮层等阻挡 |
| image region-bind | UI string，用 setUi 修改后整批校验 |
| root title/title-bind | 静态或 UI string 窗口标题，互斥；默认 Kakera AVG |
| fullscreen 设置 | bool，独立设置事务后由原生宿主切换 |

窗口标题最多 256 个 Unicode 标量值，非纯空白、无控制字符；不进入剧情档/settings。读档/重开保留 UI 变量，再执行 game.enter。详见主手册第 28 节。

所有 UI 回调使用 on.ui(eventName, callback)，同步返回 undefined；字段为 game/settings/saves、vars/ui、item/value 的只读事件开始快照。UI 中没有剧情 ctx 的 set/add/frameId，应使用 game.frameId。以下只列调用面，详细参数范围以主手册对应节为准。

| 命令组 | 已有方法 | 提交约束 |
| --- | --- | --- |
| 页面与局部值 | open、close、setUi、message | 页面/类型/范围/绑定严格校验 |
| 剧情 | advance、choose、restart | 至多一种剧情/IO 操作，不开放任意 jump；v0.9.0 已移除 skipVideo |
| 存档 | save、load、loadAuto、slotsPage | 手动 1–200、自动 1–10；overwrite 显式控制 |
| 偏好 | setting | text_speed、音量、muted、autosave、skip_all、fullscreen、auto_delay 白名单 |
| CG | unlock | 已声明 CG，多项可聚合 |
| 呈现 | transition、animate、portrait、live2d、autoPlay | 各自目标/时机/枚举校验，不产生通用媒体 IO |
| UI 演出/音效 | playSound、sequence、soundEnabled、soundActor、soundExclude | 音效/演出已声明；一次最多一个 sequence；偏好聚合成一次 ui-audio.json 写入 |
| 交接 | present、resume | 受隐藏交接事务约束；resume 只允许普通 on.ui 或 screenClose；不能与普通剧情/存读档/settings/profile 混合 |

game.enter 是特殊 UI 生命周期入口：可 unlock/setUi/message 和受约束转场、图片/立绘/模型动作；不允许在里面保存、读档、跳转、设置、开启自动播放或交接。候选状态先验证，错误保留原 Session/音频/呈现。历史重放不执行它。

普通 UI 事件不能混合 save+setting、load+restart、advance+choose 等多种 IO/剧情操作；多个设置、多个解锁或最多 32 条生命周期页面命令可分别聚合，ui-audio 偏好只允许同类聚合。setUi 只是排队，不改变同一回调里 ui 快照，生成器必须用局部值继续计算。

按钮可只有 `sound`，或 `sound` 与 `event`/`route` 之一组合；`event/route` 仍互斥。页面 `sequence` 在成为顶层时自动启动；演出步骤为 fade/video/sound，`finish` 为 return/close/open:页面。v0.9.0 的视频只在这里播放，不再由 Controller 推进。

## 5. 当前 Rust 接入点

2026-10-28 核对相邻引擎 v0.9.0：UI 入口支持根级 `include.src`，路径相对游戏根，子根仅 `ui schema="3"`；完整页面/variables/gallery/ui-media 按声明顺序 DFS 展开，不支持控件内片段。上限 128 文件/含入口 16 层，源累计和合并 XML 各 1MiB，原控件/变量等全局预算不变。KPAK 1/2 合并到原 UI 入口路径并移除实际子文件，原工程不变。本插件随包工具已通过拆分工程、UI 演出与发布检查，见 [16 UI 编辑器](16-ui-editor.zh-cn.md)。

| 源文件 | 现有入口 | 编辑器用途/限制 |
| --- | --- | --- |
| [content](../../src/content.rs) | ContentSource.read/open/copy_to；DirectorySource::new；validate_path | 统一逻辑资源来源；编辑器不要泄漏物理路径给游戏规则 |
| [story_chain](../../src/story_chain.rs) | compile；CompiledStory.xml/files；diagnostic；publication_xml | 合并、源位置和发布 UUID；不是剧情排序器 |
| [loader](../../src/loader.rs) | load_game(source) → LoadedStory + ScriptLogic；initial_ui_plans（逐个入口） | 内容/注册/入口条件和初始 UI 计划校验，不做全部资源解码 |
| [runtime](../../src/runtime.rs) | Bundle::load(source, LoadOptions) | 资源/媒体/模型准备；LoadOptions 仅 core、no_live2d |
| [script](../../src/script.rs) | ScriptLogic::load、ui_handlers、ui_event；model::Logic 实现 | 使用现有隔离和预算；不在编辑器高权限 JS 环境替代执行 |
| [model](../../src/model.rs) | Story::start、resolve_frame、validate_session_with；Logic::resolve/options | 领域与条件查询，编辑器不伪造旧档 |
| [controller](../../src/controller.rs) | transition_with(story, session, Intent, logic) | Advance/Choose，返回 session 与显式 entered；只有成功才有新状态 |
| [interface host](../../src/interface/host.rs) | State::new；prepare(def,state,settings,profile,commands,entering) | 纯 UI Plan；不是执行文件 IO 的 API |
| [interface presentation](../../src/interface/presentation.rs) | ui-media 解析、音效过滤/带权选择、ui-audio 偏好校验 | 演出/音效声明与偏好边界，不执行播放 |
| [app lifecycle](../../src/app/lifecycle.rs) | 幕/页面回调派发、隐藏交接槽、返回事务 | 候选顺序、预算与恢复语义；不是编辑器可写存档 |
| [app ui_media](../../src/app/ui_media.rs) | UI 演出/视频/音频运行时与跳过一次路由 | 呈现层瞬时状态，不入 Model/存档 |
| [assets](../../src/assets.rs) | PreparedAssets::load_from/load_deferred；validate_interface | 解码/绑定几何校验，避免另写不一致图片裁剪规则 |
| [development](../../src/development.rs) | ProjectMonitor::new/poll；compatible_session | 原生监控与完整候选；不是可远程订阅的调试服务 |
| [package](../../src/package.rs) | Snapshot::directory/for_publication/encode；Archive::open/verify_all | 1 小包与 1/2 读取；不要直接以私有容器结构编写编辑器 |
| [staged](../../src/package/staged.rs) | StagedProject::capture/for_publication/ensure_unchanged | 2 的固定磁盘快照与源指纹 |
| [streaming](../../src/package/streaming.rs) | write_streaming | 编码/验证候选后原子发布，失败保留旧文件 |
| [save](../../src/save.rs) | Snapshot::capture_with/restore_with；SaveStore | 测试路线验证，不能以调试快照冒充正式槽位 |

Bundle 会准备全部已声明资源，可能耗时/占用大量缓存；不适合每敲一个字符就完整调用。编辑器区分轻量解析、批量资源准备与真实试玩校验。它只保证入口计划和资源准备，不能证明每个动态 JS 分支永远正确。

## 6. 已有命令行

播放器 `kakera-avg.exe`：

| 参数 | 语义 |
| --- | --- |
| --project 目录 | 工程模式，监控与候选热更 |
| --package 包文件 | 发布模式，只读 KPAK 1/2；与 project 互斥 |
| --check | 完整资源检查后退出；包模式扫描全部唯一块 |
| --renderer auto/d3d11/cpu | 渲染选择；cpu 在 Windows 仍经 D3D11/WARP 呈现 |
| --no-audio | 禁设备输出但仍解码检查 |
| --no-live2d | 显式 fallback，不等于完整 Core 校验 |
| --cubism-core DLL | 受信任宿主 Core 路径 |
| --save-dir 目录 | 直接指定用户数据目录，不自动追加 story_id |
| --help / -h | 用法 |

默认优先 exe 旁 game.kpak；源码运行才可能回退 demo 工程。发布坏包不得回退目录。v0.8.3 已提供 --debug-listen 与 --debug-token-file 的工程专用远程状态/帧级断点接口，需显式 --project 和 --save-dir；发布与 --check 拒绝。详见第 10 篇。仍没有 --start-frame、--debug、--check-json、任意跳转或 JS 行级调试。

`kakera-pack.exe` 的两个位置参数为工程目录、输出包，之后支持 --format 1/2、--force、--level 1..22、--cubism-core、--no-live2d。默认格式 2/级别 19；输出必须在工程根之外，覆盖需 force。它没有播放器的 renderer/check/save-dir 参数。v0.8.3 默认只收集验证时实际访问的依赖与 assets/licenses、licenses 目录；可选 kakera.package.json（schema=1、include 为显式相对文件列表，不能通配）。清单本身不入包，未知字段/重复/缺失/越界/符号链接拒绝。普通未引用文件不再隐式加入。

`tools/package.ps1` 参数为 Project、Output、CompressionLevel、Format；需要源码工具链，构建 release 后组装固定宿主 Core 和许可证，已存在输出目录会拒绝。不能直接当作不带 Rust 环境的最终编辑器发行器；产品需随附匹配的工具，并实现等价受控组装。

Windows 播放器为 GUI 子系统。自动化必须等待进程退出并捕获退出码/重定向输出，不能以 PowerShell 启动语句返回就当检查完成。当前诊断主要为文本/JS 栈，不存在稳定 JSON 诊断协议。

## 7. 重要预算

| 项目 | 当前上限或行为 |
| --- | --- |
| 剧本链 | 128 文件、XML 合计 16MiB |
| JS | 1–32 文件、源码合计 1MiB；每求值 200ms/10000 次中断检查 |
| QuickJS | 堆 16MiB、栈 256KiB |
| 回调 | 剧情最多 128 更新，UI 最多 32 命令 |
| 变量 | 剧情/UI 各 128；int 为 i64，string 4096 UTF-8 字节 |
| UI | XML 1MiB，1–64 页面、1024 节点、深度 8、栈 8 |
| 普通图像 | 单边 8192；滤镜额外缓存 256MiB |
| 音频 | 单段 300 秒、PCM 单资源 128MiB、总量 256MiB |
| 视频 | 最多 16，1920×1080、约 60fps、300 秒；音轨总 PCM 256MiB |
| Live2D | 最多 8 模型；模型/纹理/动作等细分预算见主手册 19.7 |
| ContentSource | read 128MiB；open/copy_to 64GiB，解码预算另外检查 |
| KPAK 1 | 包/逻辑总量 512MiB，单文件 128MiB，10000 文件 |
| KPAK 2 | 包/逻辑总量 1TiB，单文件 64GiB，100000 文件；1MiB 独立块，索引 128MiB |
| 历史/存档 | 最多 1000 历史；save JSON 2MiB；缩略图 PNG 320×180/压缩最多 256KiB |

这些上限不是建议规模或性能保证。编辑器应提前预警，但最终校验仍以引擎为准。更细的资源规则见 [KPAK 规范](../kpak-format.zh-cn.md)、主手册第 14/19/26 节及对应源码。

## 8. v0.8.3 新增宿主接口

[debug::Server](../../src/debug.rs) 提供有界认证 JSON Lines 传输，[PlayerApp::attach_debug/poll_debug](../../src/app/debug.rs) 在 App 边界处理状态与控制，Model/Controller 不依赖网络。完整命令及修订语义见 [调试 API](10-player-debug-api.zh-cn.md)。

[package::selection::Selection](../../src/package/selection.rs) 的 discover/validate_candidate/ensure_unchanged 负责依赖、附加清单与复查；Snapshot::directory_selected 和 StagedProject::capture_selected 建立有界固定候选。原 directory/capture 为工程/低层容器用途，不能拿它们替代 CLI 的发布策略。


附加清单也拒绝保留用户文件/目录及临时文件（如 settings.json、profile.json、read.json、ui-audio.json、flow-checkpoint.json、slot-/auto- JSON、saves/、target/、.git/、*.tmp）；不能用显式 include 绕过原有排除规则。

## 9. v0.9.0 生命周期与隐藏交接

- 应用版本 0.9.0；story 8 / UI 3 / save 9；KPAK 1/2 保留；demo content-version=9。v0.8 以前的存档、项目视频写法和旧字段补齐仍不迁移。
- 视频只在 UI `ui-media.sequence`；frame 不接受 video，`ctx.skipVideo` 与 `game.videoPlaying/game.videoSkippable` 已删除。编辑器应把旧写法作为迁移诊断，不生成新副本。
- `frame(id).enter/exit` 与 `ui("页面").bind("screen.open"/"screen.close", …)` 注册按实际幕/页面严格解析；同一实际幕不能按 ID/name 重复注册同类回调。XML 不能直接派发这些保留事件名。
- 进入幕打开 UI 时该幕与 UI 同事务提交；离幕打开 UI 保存完整 source/continuation 隐藏槽，UI 返回后再提交待续剧情。恢复活动隐藏槽只重开 UI，演出从零播放，不重放 frameEnter/Exit/game.enter。
- 隐藏槽固定为存档目录 `flow-checkpoint.json`，schema 1，内嵌两份 save 9 快照、UI 栈/变量/原栈与演出 ID；总大小 2MiB，先完整校验与准备再原子覆盖。成功返回写 `active=false` 墓碑。它独立于手动槽和 auto-1..10，不受 autosave 开关影响，排除监控和资源包。
- 隐藏槽恢复时源与 continuation 必须分别可完整重放，且二者是同一状态或恰好一次合法 Controller 推进；UI 栈、变量、资源与来源再次校验。坏槽/原子写失败保留旧 UI/剧情/隐藏文件，不部分提交。
- save 9 每条 history 必填 `resume_to`（普通路由 null，UI 返回为实际目标 ID 且 `choice_id=null`）；旧 save 8 拒绝。编辑器只读其协议与文件边界，不生成或迁移玩家槽，也不写入隐藏槽。
- 活动交接期间禁止普通存读档、重开、设置及其他持久 IO；编辑器预览、源码编辑和试玩工具按原边界工作，不声称可绕过播放器交接事务。

完整契约见相邻引擎 `doc/xml-js-api.zh-cn.md` 第 31–32 节、`doc/v0.9.0-implementation-plan.zh-cn.md` 与 `doc/v0.9.0-validation.zh-cn.md`；这些上游文件不在本仓库，不虚构其内容。

## 10. v0.9.1 末幕退出与 UI 显式起始幕

- 应用版本 0.9.1；story 8 / UI 3 / save 9、content-version 9 与 KPAK 1/2 不变，没有 XML/JS 语法新增。
- 末幕 `frame(id).end()` 在文字完成后的**手动继续**触发一次 `frame(id).exit`；补全文字不触发，自动播放和 Ctrl 仍在结尾停止。末幕注册 exit 时 `game.canAdvance` 保留继续入口，成功后不再重复；普通读档/重开重置该状态。无退出回调的末幕保持结束显示。
- UI 控件（普通 `ui("目标").bind(...)`）和自动 `screen.close` 都可复用 `ctx.resume(frame?)`。无活动交接时读取并完整验证磁盘 `flow-checkpoint.json`（包括 inactive）；省略目标时恢复其 continuation，首次没有隐藏槽且没有目标时拒绝。显式目标以隐藏 continuation 为基础（首次无槽时以当前初始 Session 为基础），记录显式 UI 返回并沿用隐藏槽变量/历史，不是清空变量的 restart。
- 显式目标与同批自动关闭回调的无参 resume 合并时保留显式目标；两个不同显式目标拒绝整批操作。所有进入回调和媒体验证成功、隐藏 source/continuation 原子同步后才提交剧情；失败保留旧剧情、UI 和隐藏文件。成功无下一交接时写 inactive，下一次无参 resume 仍可显式读取其 continuation；inactive 不会在启动时自动恢复。
- 编辑器可写 `ctx.open("页面"); ctx.resume("幕")`、`ctx.resume("幕")` 或 `ctx.resume()`；目标必须是实际幕/页面，不伪造隐藏槽或待连接目标。真实运行、隐藏槽跨进程和末幕 GUI 行为由匹配播放器验收，编辑器静态检查不能替代。

## 11. 专用 CG 资源与共享解锁（v0.9.1 增量）

- story `<assets>` 新增 `<cg id="稳定标记" src="图片路径"/>`，kind 为专用 CG，不复用普通 image。`<visual cg="cg.id"/>` 与 `background`/`portrait` 严格互斥；CG visual 展开为无人物的完整背景，frame 通过 visual 引用。资源仍受图片格式、解码和 8MiB 编辑预算约束。
- 所有 CG 资产自动进入 gallery，默认标题为资源 ID、未解锁；显式 `<gallery><cg id="cg.id" image="cg.id" title="标题" unlocked="true|false"/></gallery>` 可提供标题和初始解锁，专用 CG 的 id 必须等于 image 资源 ID。普通 image 收藏项仍可自定义 ID；总数最多 256。
- `game.cgId` 为当前 frame 的专用 CG ID，普通画面为空；`cg.total` / `cg.unlocked` 为数值，`cg.progress` 为“已解锁 N / M”文字。它们来自 story 画廊声明和独立 profile 解锁集合，不写入剧情槽、自动槽或隐藏槽。
- `ctx.unlock(cgId)` 由作者 JS 调用（例如 `game.enter` 中 `if (ctx.game.cgId) ctx.unlock(ctx.game.cgId)`），加载/显示 CG 不自动解锁。profile schema 1、save 9、story 8、UI 3 不变；同 CG 多幕只计一次，读档/重开不撤销共享解锁。编辑器只写 XML/JS 和读状态，不写玩家 profile。

## 12. 多起始幕与 UI 首次进入（v0.9.1 增量）

- `story.entry` 为至少一个、空白分隔的 frame ID/name 列表；未知目标、空列表、重复或不同别名指向同一幕均拒绝，保留源位置。列表顺序**不**代表默认自动进入；story 8/UI 3/save 9/KPAK 1/2 不变。
- 启动只显示 UI 初始页面，不提交剧情、不执行 `game.enter` / frame 生命周期、不播放剧情音频、不生成自动档或已读。首次必须由 UI 事件显式 `ctx.resume("起始幕")`、`ctx.restart("起始幕")`，或手动/自动读档。首次无目标的 resume/restart、推进、保存和自动播放拒绝。
- 首次显式选择只接受声明的入口，以初始变量和单条起点历史建立新会话；不沿用 inactive 隐藏槽。运行中 `resume` 保持隐藏续接语义；`ctx.restart(frame)` 始终建立新会话，多入口无参 `restart` 拒绝。活动交接槽仍按完整验证恢复。
- 调试状态新增 `game_started`；未进入时 `frame_id` / `frame_name` 为 null、历史长度为零、候选为空，剧情步进被拒绝。工程热更新/渲染重建不把“待选择”变成已进入。
- 上游 2026-10-29 的 GUI 修正：UI 事件先 `ctx.open("hud")` 再 `ctx.restart/resume` 时，以已准备候选栈作为幕回调比较基线，不再把标题页切 HUD 误判为 frameEnter 交接；真正交接仍保留并返回指定 HUD。

## 13. v0.10.0 UI 扩展

- 应用版本 0.10.0；story 8 / UI 3 / save 9 / profile 1 / read 1 / KPAK 1/2 与 demo content-version=11 不变。新增语法属于 UI 3 的受约束扩展，旧播放器应拒绝而不是猜测。
- **动态图片查看**不新增 Rust 图片 API：同一页使用一个固定 image 控件和 `image-bind="ui.变量"`，切换时由 `ctx.setUi` 写入已声明 image/CG 资源 ID；`fit`、图集 region 和按钮工具栏仍走现有属性。编辑器只生成声明和普通绑定，不拼接文件路径或每图一页。
- **玩家快捷键**：动作固定为 `advance`、`fast_forward`（按住）、`skip_sequence`，默认 Space/Ctrl/Space。绑定为规范 ASCII token 或 `null`，修饰键 Ctrl/Alt/Shift，最多 64 字节；拒绝 Escape、Meta、Ctrl+Alt 和系统保留组合，并检查快进按住前缀冲突。普通 `on.ui` 可用 `ctx.captureShortcut(action, resultEvent)`、`ctx.cancelShortcutCapture()`、`ctx.keybinding(action, bindingOrNull)`、`ctx.resetKeybindings()`；只读 `ctx.shortcuts` 暴露 bindings、显示 Label、captureActive/captureText。XML 可绑定 `shortcuts.advanceLabel/fastForwardLabel/skipSequenceLabel/captureText/captureActive/bindings.*`。偏好写固定 `keybindings.json`（schema 1/story_id/三个绑定），缺文件用默认、坏文件保留并提示、同目录原子替换；不进入剧情槽、隐藏槽、监控或 KPAK。
- **HSL 方形 与玩家配色**：`color-picker` 必需 UI string 的 `value` 和普通 `event`，可选 `alpha`（默认 true）；`alpha=false` 至少 128×128，`alpha` 默认/true 时至少 128×154（推荐 256×256 / 256×282），最多 8 个、不能放入 repeat，不接受子控件/图片/region/route/color。色盘直径 `D=min(width,height−R)`，`R=alpha?26:0`；环、正方形与可选 alpha 条作为一组在控件外矩形内居中，alpha 条高 18、距色盘 8、左右各留 8、宽 `width−16`。控件自身只绘制环、正方形、可选 alpha 条和必要焦点/禁用反馈，**没有内置颜色预览或 HEX 文本**；作者用 `color-bind` 面板/图片和 `bind` label 读取同一草稿独立组合预览与十六进制。事件值为规范 `#RRGGBBAA`，拖拽只提交候选，由作者 `ctx.setUi` 决定是否更新；矩形内留白/间隙不改色、不启动抓取。`color-bind` 可作用于 panel/image/nine-patch/label/button/toggle，来源限 `ui.<string>` 或 `colors.<槽位>`，与静态 `color` 互斥。根级 `<palette><color id="..." initial="#RRGGBBAA"/></palette>` 最多 32 个，ID 为 `[a-z][a-z0-9_]{0,63}`；`ctx.colors` 是只读快照，`ctx.colorPreference(slot, rgbaOrNull)`/`ctx.resetColors()` 写固定 `ui-colors.json`（schema 1/story_id/稀疏 overrides）。两个偏好文件都由匹配播放器原子维护，编辑器不读取或写入。
- **确认弹窗与退出**：确认页是普通模态 `screen`，可用 panel/图片/点九、绑定、RGBA、按钮皮肤和 `route="close"` 组合；`ctx.quit()` 仅在普通 `on.ui` 可用，整批验证成功后请求宿主正常关闭，不触发 frameExit/screenClose、不保存新槽、不消耗隐藏交接。退出补写由播放器负责，编辑器不伪造原生对话框。
- 编辑器边界：新控件/属性通过范围补丁写实际 XML/JS，静态画布不执行捕获、焦点、偏好落盘或页面交接；最终冲突、按键所有权、颜色缓存与偏好回滚由匹配播放器验收。

## 14. v0.10.1 国际化

- 应用版本 0.10.1；story 8 / UI 3 / save 9 / profile 1 / read 1 / KPAK 1/2 与 demo content-version=11 不变。宿主提示内嵌 `locales/engine/zh-CN.ftl`，使用 Fluent 和稳定诊断 ID；当前正式宿主只有中文，游戏不能覆盖宿主词条。
- 游戏本地化默认关闭。入口 `story.xml` 可声明 `<localization enabled="true" src="..."/>`；清单 schema 1 分开 `texts`（1–32 种，messages+font）和 `voices`（0–32 种，key→audio/silent）。默认文本/语音必须属于对应集合；系统语言与玩家选择按通道分别精确匹配，不做地区/脚本猜测。
- 文本来源：frame text `key`、option `text-key`、character `name-key`、变量 `label-key`、UI label/button/toggle `text-key`/`text-key-bind`、UI 根 `title-key`/`title-key-bind`、画廊 `title-key`。UI 可带最多 16 个 `text-arg`，参数只从 UI 标量、`cg`/`saves` 只读标量和 `locale.text/voice` 取值；剧情静态位置没有外部参数。动态 key 只绑定 UI string。
- 普通 `on.ui` 可调用 `ctx.locale(channel, idOrNull)`；只读 `ctx.localeInfo` 提供 enabled/textRequested/voiceRequested/text/voice/textSource/voiceSource；XML 对应 locale 标量以空串表示 null，repeat 数据源 `textLocales`/`voiceLocales` 只有 id/label/selected/default。语言选择写 SaveStore 下固定 `language.json`（schema 1/story_id/text/voice），不属于内容根或 KPAK；切换事务、字体/语音候选、截图 revision 与隐藏恢复由播放器负责。
- 全部游戏 FTL 最多 128 个/16MiB、单文件 1MiB、50000 条消息/术语、单 bundle 100000 条引用；拒绝属性导出/引用、带参数术语和自定义函数。编辑器读取/校验清单、FTL、文本来源和参数契约，但不执行 Fluent 或语言事务。
- KPAK 1/2 在开启时收集全部声明语言依赖；`language.json` 及大小写变体排除监控、冻结和打包。编辑器工具哈希、工程清单和调试版本接受 0.11.1，同时保留 0.8.3–0.11.1 打开兼容。

## 15. v0.11.x 新版 JS 注册 API

- 应用版本 0.11.1；story 8 / UI 3 / save 9 / profile 1 / read 1 / KPAK 1/2 与 demo content-version=11 不变。`ctx` 参数、命令白名单、事务与预算不变。旧 `on.advance/choice/end/ui/frameEnter/frameExit/screenOpen/screenClose` **已删除且没有别名**，启动、`--check` 与打包会带文件名和栈拒绝。
- 剧情路由：`frame("幕ID").advance(targetOrRun)`、`frame("幕ID").choice("选项ID", targetOrRun, when?)`、`frame("幕ID").end()`。`targetOrRun` 只能是固定非空字符串或无副作用的同步回调；字符串等价于直接返回该字符串，函数可先 `ctx.set/add` 再返回。第三参数 `when` 只能是返回 boolean 的只读函数。同一幕只允许一种路由，选项集合必须与 XML 相等；重复 option、重复 advance/end、混合路由、ID/name 指向同一幕均拒绝。
- 生命周期：`frame(id).enter(callback)` / `frame(id).exit(callback)` 只拿到 UI 命令上下文，不是剧情 set/add 上下文；页面用 `ui("页面").bind("screen.open"/"screen.close", callback)`。全局进入钩子固定为 `ui("$game").bind("game.enter", callback)`。`$game`/`$host` 是保留虚拟目标，不能作为真实 XML 页面/控件 ID，也不能新增其他虚拟目标；v0.11.1 起 `$host` 只保留宿主内部派发类别，不再接受脚本绑定。
- 普通界面事件（v0.11.1）：`event.register("事件ID", callback)` 独立定义，同一 ID 只能定义一次。控件 XML `event`、页面 `background-click`/`background-right-click` 或单参数 `ui("控件模板ID或页面ID").bind("事件ID")` 是三种引用方式；控件事件可省略或为空，未被引用的事件定义允许存在。多个控件可引用同一 ID 共享回调，`ctx.item/value` 仍按行/控件传递。`event.register` 不接受 `game.enter`、`screen.open`/`screen.close` 或 `frame.*` 保留前缀。
- 装配校验：每个非空 XML/JS 引用必须指向真实页面/按钮/滑条/开关/选色器与已定义事件；只读节点、`route` 按钮、重复绑定、同控件 XML 与 JS 指向不同事件、`$host` 绑定、未知目标都会拒绝。未绑定的 slider/toggle/picker 只更新自身显示，不自动提交业务值。
- 注册隔离：`frame`/`ui`/`event` 是不可写、不可配置的全局入口，选择器与 `event` 对象冻结；回调执行期间再注册或替换入口失败。选择器可以保存到变量或解构方法而不丢目标，单独的 `frame(id)` 不注册任何内容。静态字符串目标在完整装配后加载期校验存在，函数目标在执行边界校验；所有目标都走同一 Controller 条件/更新/历史事务。错误位置同时给出 JS 调用行与相关 XML 位置。
- 编辑器规则：只读写上述规范形式；旧 `on.*` 与 v0.11.0 两参数普通 `ui(id).bind(事件, 回调)` 只给迁移诊断（见上游 API 第 37.2–37.4 节），不自动整文件迁移；动态/别名/非顶层/共享回调保持 Opaque。受管路线文件使用 `// Kakera Managed Routes v2` 和 `frame(...)` 生成；UI 事件按独立事件 ID 管理，定义与引用分开，改名只同步可证明的 XML 属性与脚本 bind。工具哈希、工程清单、调试与构建版本检查按 0.11.1 同步，最终装配由真实 `--check`/KPAK 验证。

## 16. v0.11.2 组合标签与 repeat 分页

- 应用版本 0.11.2；story 8 / UI 3 / save 9 / profile 1 / read 1 / 隐藏槽 1 / KPAK 1、2 与 demo content-version=11 不变。`image` 与 `panel` 仅内部归一，作者契约未放宽。
- 组合标签：脚本装配阶段 `component.register("x-名字", { props, expand })`，标签名 `x-` 前缀小写 ASCII/数字/单连字符、≤64 字节、最多 128 个；prop 名同样小写且不能占用 `id/x/y/width/height/visible/enabled`，每个 prop 恰好 `required: true` 或类型匹配的 `default`，`min/max` 仅 int/number、`maxLength` 仅 string、`binding` 必须带 `valueType`。`expand` 同步返回一个 `{ tag, attrs?, children? }`，根必须是 `panel`/`nine-patch` 且 `attrs.id="$root"`，只能输出宿主标签或已注册组合标签，不能生成根级声明，也不能访问 ctx、会话、时钟、随机、网络或文件。实例 `id` 映射 `$root`，局部 ID 展开为 `实例ID.局部ID`，作者子节点按原顺序各插入一次；注册、事件与绑定允许前向引用。
- 预算：组件嵌套 8 层、整个 UI 最多 1024 个展开实例、单实例描述 256KiB、累计 1MiB；源/合并 UI 各 1MiB、include 128 文件/16 层、最终节点 1024/深度 8 不变。
- repeat 分页：`page-size`（1–200）与 `page-bind`（已声明 UI int，`min="1"`，一变量一 repeat）成对出现；只读元数据 `repeat.<完整节点ID>.<字段>` 支持 `page/pages/pageSize/total/start/end/canPrev/canNext/pageText`，JS 侧同名快照为 `ctx.repeats[完整ID]`。换页只重置该 repeat 滚动；页数 `max(1, ceil(total/pageSize))`，空集固定第 1 页且禁用翻页；缩短源时夹取到最后一页并写回候选 UI int。页码/缓存/滚动/焦点不入剧情槽或隐藏交接文件。
- 工程热更、`--check` 与两种 KPAK 都走同一条展开流水线；包内保留原始组合标签 XML 与脚本，独立重载时重新展开。`--check` 校验声明、变量独占、容量、前向引用与空源，但不执行普通事件回调，也不读玩家存档。
- 编辑器规则：只静态认识可证明的顶层字面量注册与实例属性，画布不执行 expand、组件实例只允许布局属性补丁；`x-tabs`/`x-pagination` 由编辑器内置并插入到已声明脚本、入口变量与事件中。旧播放器拒绝新语法，编辑器不做迁移。

## 17. v0.11.3 总音量与 2D 图片粒子

- 应用版本 0.11.3；story 8 / UI 3 / save 9 / profile 1 / read 1 / 隐藏槽 1 / KPAK 1、2 与 demo content-version=11 不变。
- 总音量：`settings.master_volume`（0–1，默认 1）与四项分项相乘，`ctx.setting("master_volume", ctx.value)` 是普通 UI 命令；音乐、语音、剧情音效、UI 音效和 sequence 视频音轨都走同一增益，在播声音只改增益。settings.json 缺少 `master_volume` 按坏设置提示并使用完整默认值，不做字段补齐。编辑器把该键列入设置白名单与静态示例，不写 settings.json。
- 粒子节点：`<particles>` 是普通 UI 节点，可放在 screen 或 panel/nine-patch 的直接子节点位置，不能放在 repeat 模板中；位置由父节点偏移决定，绘制按兄弟顺序，粒子被本节点矩形裁剪。共享属性只有 `id/x/y/width/height/visible/color`，另有 `image/rate/burst/max/life/life-max/size/size-max/vx/vx-max/vy/vy-max/accel-x/accel-y/spin/spin-max/fade/autostart`；`image` 必须是已声明 image/cg 资源，`rate` 0–200、`burst` 0–128 且两者不能同时为 0，`max` 1–512（默认 128），`life` 0.1–10、`size` 0.5–512、速度与加速度 ±2000、转速 ±720，每一对 `-max` 不得小于下限；未知属性、非有限值、越界、范围倒置、未声明图片与 repeat 内声明都按严格 XML 报错。
- 预算：每页最多 4 个发射器、整份 UI 最多 32 个，全局存活粒子 2048、单发射器 512、单次更新最多生成 256 个、物理步长最多 0.1 秒；超预算只钳制生成而不使候选失败。持续发射用累积器，长帧不补发。
- JS 命令：`ctx.particles(id)` 返回冻结对象，方法只有 `start()`/`stop()`/`clear()`/`burst()`；start 要求 `rate > 0`，burst 要求已声明 `burst`；同一发射器一次只能有一个命令，页面必须出现在提交后的页面栈中，`game.enter` 与 `screen.open/close` 不接受粒子命令。
- 时钟与恢复：粒子使用 UI 演出时钟（菜单暂停时继续，失焦/宿主提示/调试暂停冻结且不补积累），随页面关闭清理；读档、重开、首次进入与成功热更按当前页面栈重建声明初态，不重放 burst；实例、随机状态与纹理句柄不入 Model、存档、隐藏槽、偏好或截图。
- 编辑器规则：只写上述属性与固定命令，画布静态示意不执行发射；新控件需要已声明纹理，属性检查器按同一范围校验并拒绝 `enabled` 等未知属性；`ctx.particles` 的循环/动态写法保持源码维护。
