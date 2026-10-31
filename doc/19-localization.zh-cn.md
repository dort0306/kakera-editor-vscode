# 19 游戏本地化编辑器（0.10.1 功能 / 引擎 v0.11.0）

适用版本：插件 **0.11.0**，匹配播放器 **v0.11.0**（story 8 / UI 3 / save 9）。本文说明可视化编辑器对 Kakera v0.10.1 引入、v0.11.0 继续支持的默认关闭游戏文本/语音国际化的读写范围、预览与限制；完整播放器语义仍以引擎的 `doc/xml-js-api.zh-cn.md` 第 36 节和实际源码为准。

## 1. 边界

- 本地化是**内容作者开关**，不是插件设置。未声明 `<localization>` 或 `enabled="false"` 时，原字面量文本/语音完全保持原样；编辑器不自动开启、不探测系统语言、不创建 `language.json`。
- 清单 `languages.xml`、FTL、字体和音频都是游戏内容源文件，读取当前 `TextDocument` 缓冲并进入冻结代次与 KPAK。`language.json` 是玩家偏好，位于匹配播放器的 SaveStore，不属于内容根、不进入工程监控/冻结/发行包（文件名大小写不敏感排除）。
- 编辑器不执行 Fluent、系统语言匹配、`ctx.locale` 事务、音频切换或偏好原子写；这些由匹配 v0.11.0 播放器负责。静态画布仅按默认文本语言和初始 UI 变量格式化预览。
- 目录存在 FTL 不会自动启用；必须由入口 `story.xml` 显式声明并给出已声明的字体资源。章节文件不能重复声明根配置。

## 2. 清单与消息

入口声明：

```xml
<localization enabled="true" src="languages.xml" />
```

清单 schema 1：

```xml
<localization schema="1" default-text="zh-CN" default-voice="ja-JP">
  <texts>
    <locale id="zh-CN" label="简体中文">
      <messages src="locales/zh-CN.ftl" />
      <font ref="dialogue" />
    </locale>
    <locale id="en-US" label="English">
      <messages src="locales/en-US.ftl" />
      <font ref="dialogue" />
    </locale>
  </texts>
  <voices>
    <locale id="ja-JP" label="日本語">
      <clip key="voice.opening" asset="voice.ja.opening" />
    </locale>
    <locale id="zh-CN" label="中文">
      <clip key="voice.opening" silent="true" />
    </locale>
  </voices>
</localization>
```

编辑器读取并校验：

- `texts` 为 1–32 种，每种 1–16 个 `messages`、1–16 个 `font`；`voices` 为 0–32 种。
- 语言 ID 使用规范 Unicode language identifier（如 `zh-CN`、`en-US`、`ja-JP`），最多 64 ASCII 字节；拒绝下划线、`und`、扩展/私有子标签和非规范大小写。显示名 1–64 个字符，不是业务 ID。
- `default-text` 必须属于 `texts`；`default-voice` 在 `voices` 非空时必需、为空时禁止。语音 key 必须被剧情 `audio.voice` 使用，asset 必须是 `audio` 资源，默认语音语言必须覆盖全部使用的 voice key；字体 ref 必须是 `font` 资源。
- 全部 FTL 最多 128 个/16MiB，单个 1MiB；单 locale 的重复消息 ID、坏引用、循环、过深、函数/属性/带参数术语、未满足参数契约都会阻止加载或显示诊断。编辑器执行文件/条目/重复/引用/参数等较严格的校验；播放器还会执行完整引用边、展开缓存和输出上限计量，编辑器不重复实现全部缓存计数。编辑器不把内部 key 当作界面文案。

## 3. 可本地化的文本位置

| 位置 | 新来源 | 编辑器行为 |
| --- | --- | --- |
| frame/text | `key`（空 text 元素） | 幕属性“台词来源”可切换固定文字/key；key 模式显示默认文本并引用本地化面板消息 |
| option | `text-key` | 选择项可切换固定文字/本地化 key；保留同一 option ID |
| character | `name-key` | 人物设置“名字来源”可切换；key 模式不修改人物 ID |
| 剧情变量 | `label-key` | 解析并保留；当前属性面板不提供 label 编辑 |
| UI label/button/toggle | `text-key`、`text-key-bind` | UI 检查器“内容”可选择已有默认消息或 UI string key 变量；与 text/bind 四选一 |
| UI 画廊 | `title-key` | 画廊表单可切换固定标题/title-key |
| UI 根窗口标题 | `title-key`、`title-key-bind` | 标题设置可切换固定标题/本地化 key/key 绑定 |

无 key 的字面量永远原样显示，不参与翻译。动态 key 仅允许绑定 UI string；repeat 模板可用静态 key，但不接受 `item` 提供任意消息 ID。编辑 key 模式文本时，应在“工程 → 游戏设置 → 本地化”编辑消息正文；切换回固定文字后可直接改字面量。根标题和剧情静态位置不支持外部参数。

## 4. text-arg

文字控件可在 key 后声明最多 16 个 `text-arg`：

```xml
<label id="count" width="500" height="50" text-key="count">
  <text-arg name="n" bind="ui.count" />
</label>
```

UI 检查器“本地化参数”可编辑 name、固定值或绑定。name 不重复且需为英文标识符；`value` 是字面字符串，`bind` 仅允许 `ui` 标量、`cg.total`、`cg.unlocked`、`saves.page`、`saves.pages`、`locale.text`、`locale.voice`。bool 显示为 `true/false`；超过 ±(2^53−1) 的 int 不接受无损数值承诺。消息参数集合会与默认及所有已声明语言的实际消息比较，缺参/多参报错；编辑器不通过反复格式化失败来猜参数。

FTL 支持正文、字符串/数值、消息/无参数术语引用、变量与 select；不支持属性导出/引用、带参数术语和自定义函数。编辑器在保存消息时解析并拒绝明显语法/引用错误，最终仍由匹配引擎校验预算、方向隔离和字体覆盖。

## 5. 本地化面板

“工程设置 → 本地化”提供：

- 默认文本/语音选择，文本语言显示名编辑。
- 消息表：key、默认文本、当前语言覆盖、参数、是否被工程引用；可新增、编辑、删除当前语言的消息。默认语言缺 key 会阻止引擎通过；非默认语言缺失时按引擎回退默认。
- 语音语言显示名与 `key = 音频资源 ID` / `key = silent` 映射编辑；可新增语音语言（不需要新文件）或删除非默认语言。
- “查看清单源码/当前语言 FTL”；消息编辑只改对应 FTL 的局部正文，保留其他消息、注释和换行。
- 结构错误、默认覆盖、参数契约、字体/音频引用、未使用 voice key 等以源码位置诊断显示。

不自动完成的操作：新增清单/FTL 文件、开启/关闭本地化、改变已有 key 的 FTL 文件归属、创建第一份语言清单。这些需要先在源码建立合法文件/根声明；编辑器在文件已存在时负责后续编辑。

## 6. 预览与绑定

- 画布按默认文本语言解析静态 key；`text-key-bind` 使用 UI string 初始值；`text-arg` 使用固定值或 UI/`cg`/`saves`/`locale` 初始标量。缺失消息显示 `⟦key⟧` 占位，不伪装成翻译。
- 绑定建议加入 `locale.enabled/text/voice/textRequested/voiceRequested/textSource/voiceSource`；repeat 数据源加入 `textLocales`/`voiceLocales`，示例项有 `id/label/selected/default`。原始系统语言列表不进入 Webview。
- 事件向导“切换文本/语音语言”写 `ctx.locale("text"|"voice", 已声明 ID 或 null)`；空值表示跟随系统。目标必须是该通道已声明规范 ID；语音集合为空时提示；其他命令与本操作保持独立。
- 静态预览不执行 `ctx.locale`、系统匹配、字体安装、语音停止/切换、截图失效或隐藏槽恢复；运行效果以真实播放器为准。
- FTL 字符串中的 `\uXXXX`/`\UXXXXXX` 按 Unicode 解码；普通正文中的反斜杠原样保留。数字与字符串参数保持区别，复数类别使用当前环境的 `Intl.PluralRules`；其语言数据版本可能与播放器不同，精确排版和复数结果仍需匹配播放器验收。非默认语言仅在整条消息缺失时回退，不借用默认语言的术语；引用循环、展开预算和 64KiB UTF-8 输出超限会拒绝预览。

## 7. 存档、构建与排除

- `language.json`、`keybindings.json`、`ui-colors.json`、`ui-audio.json`、`flow-checkpoint.json` 等玩家偏好/隐藏状态不进入冻结代次和 KPAK；清单/FTL/字体/音频进入内容依赖。只修改翻译不改变 story 8/save 9；已读共享稳定 frame ID，语言不进入 save 9/history/隐藏槽。
- 真实引擎 `--check` 会验证全部声明语言、默认覆盖、音频/字体引用与预算；插件构建在写盘前冻结候选并运行匹配工具。KPAK 1/2 都应包含清单与全部 FTL。
- 宿主提示（v0.11.0 内嵌中文 Fluent）不受游戏开关影响；游戏不能覆盖宿主词条。

## 8. 版本与限制

- 插件 0.11.0 默认工程清单 `engineContract: "0.11.0"`；仍接受 0.8.3–0.11.0 的已声明工程。工具 `tools.json` 必须由 v0.11.0 release 生成并通过 SHA-256 校验。
- 不支持通过可视化面板创建新 FTL/清单、编辑 FTL 属性/函数/带参数术语、逐语言图片/视频/Live2D、视频多音轨、剧情参数化、RTL 排版或完整脚本化语言页面。新增文本语言和清单结构仍以源码为事实来源。事件向导一次写入一个 `ctx.locale` 通道；同一个 `ui("目标").bind(...)` 同时提交 text/voice 的固定回调保留源码只读，避免把两个通道误当成一个动作。
- 真实播放器中的系统语言探测、手动/默认回退、字体字形、语音停止时机、`language.json` 原子写与坏文件保留、跨进程读档和 D3D11 窗口需单独验收；静态解析、浏览器 DOM 和引擎 `--check` 不替代这些运行态检查。实际已执行范围见 [12 实现记录](12-implementation-status.zh-cn.md)。
