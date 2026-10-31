# Kakera Editor for VS Code

面向 Kakera AVG 的可视创作插件：以“一格一幕”的分镜工作台编辑剧情，保留普通 XML/JS 源码，使用真实播放器验证和试玩。

**当前版本：0.11.3，Windows x64 本地桌面开发预览版；匹配 Kakera v0.11.3 播放器与打包器。** 首版面向 Windows 本地桌面 VS Code，播放器独立开窗；浏览器版、SSH/容器远程环境、Code-OSS 分叉、原生舞台内嵌和 JS 行级调试不在首版范围。

- **一格一幕**：每个分镜格对应一个完整 XML `frame`，明确背景、人物、台词、音频和路由；分镜排序不改剧情，新幕 ID 只生成一次。
- **源码往返**：可视编辑只补丁对应的语法范围，手写 JS、注释与排版保留，复杂逻辑作为 Opaque 代码块展示。
- **真实播放器**：以匹配版本的外部播放器试玩，DAP 适配帧级断点与只读状态，最终构建独立游戏发行目录。
- **可选 AI**：接入用户自配置的 Chat Completions 兼容服务，生成经校验、审阅、可撤销的编辑提案；未配置服务时手工创作照常可用。

XML/JS 始终是内容的事实来源，打开文档以当前 `TextDocument` 缓冲为准。文档入口：能力与状态 [20](doc/20-capabilities-status.zh-cn.md)、使用说明 [21](doc/21-usage-guide.zh-cn.md)、可视化编辑器使用说明 [18](doc/18-visual-editor-guide.zh-cn.md)、引擎同步与版本增量 [22](doc/22-engine-sync-notes.zh-cn.md)、实现与验证记录 [12](doc/12-implementation-status.zh-cn.md)、完整文档索引 [doc/README.zh-cn.md](doc/README.zh-cn.md)、未实现的下版本规划 [PLAN.md](PLAN.md)、协作规范 [AGENTS.md](AGENTS.md)。

## 构建与测试

开发需要 Node.js 22 或更高版本、npm，以及 Windows 本地 VS Code。依赖版本由 `package-lock.json` 锁定。

```powershell
npm ci
npm run check                 # 类型、单元/协议测试与构建
npm run test:browser          # Edge/Chromium：工作台/首页、流程图与 UI 控件原生交互及截图
# 准备匹配工具，参数为实际 v0.11.3 release 二进制目录
node scripts/prepare-tools.mjs D:\path\to\kakera\target\release
npm run test:integration      # 真实模板、快照、KPAK 1/2 与独立宿主检查
npm run test:host             # 本机 VS Code：未保存缓冲、undo/redo、多视图、DAP
npm run package               # 生成 artifacts/ 下的离线 VSIX
```

`test:host` 默认使用 `%LOCALAPPDATA%/Programs/Microsoft VS Code/Code.exe`；其他安装路径通过 `VSCODE_EXECUTABLE` 指定。所有集成测试使用 `.test-work/` 下的隔离工程与宿主数据。开发调试可直接在本仓库按 F5。

浏览器交互回归使用已安装的 Edge/Chromium，创建独立临时配置，通过原生输入验证点击、拖动和键盘选中。可用 `KAKERA_TEST_BROWSER` 指定浏览器可执行文件；不会下载浏览器或操作日常浏览器会话。

源码仓库不提交工具二进制，干净克隆需要执行准备脚本；现成 VSIX 已附工具。自定义工具目录必须含 `tools.json` 哈希清单，通过 **Kakera：配置播放器工具目录** 设置；当前不包含 Live2D Core。工具、模板与引擎的版本对齐记录见 [22 引擎同步与版本增量](doc/22-engine-sync-notes.zh-cn.md)。

## 许可证

本仓库代码采用 [MIT 许可证](LICENSE)。React、Acorn、Saxes 等运行依赖的声明由构建脚本汇总至 `THIRD_PARTY_NOTICES.txt`；saxes npm 包遗漏的许可来自[官方 v6.0.0 LICENSE](https://raw.githubusercontent.com/lddubeau/saxes/v6.0.0/LICENSE)。v0.11.x 播放器内嵌的 Fluent/unic-langid 双许可选择与全文随离线包放在 `resources/licenses/engine-i18n/`，并汇总进同一通知文件。模板字体遵循 [SIL OFL 1.1](templates/minimal/content/assets/licenses/OFL.txt)。播放器及其他素材保留各自授权，当前内部预览包不包含 Live2D Core 或模型。
