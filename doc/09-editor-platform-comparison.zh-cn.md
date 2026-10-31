# 09 编辑器实现方案比较与结论

评估日期：2026-10-31，基于播放器 v0.11.0 的调试 API、依赖文件选择、UI 生命周期/显式起始幕、快捷弹窗、玩家快捷键、HSL 圆环/方形选色器与配色、游戏国际化及 `frame()`/`ui()` 注册边界。以下为工程判断，实际交付以 [12 实现记录](12-implementation-status.zh-cn.md)为准，不是新的工期承诺。

## 1. 结论

**优先开发 VS Code 插件，提供面向作者的可视分镜工作台；不建议先分叉 Code-OSS，也不建议第一版从头构建完整桌面编辑器。** 核心内容表示、编译/验证和资源规则保持独立，由 Rust 工具与版本化协议承载，便于以后增加专用壳。

理由是当前交付源就是 XML/JS，首版很需要文本往返、文件树、差异、撤销、诊断、任务和调试工作台。插件能复用这些基础设施，开发集中到分镜/素材/AI/引擎适配。非程序作者仍看到专用首页、分镜和中文属性，不要求操作终端或编写代码。

若试用证明 VS Code 的安装与概念负担仍显著阻碍目标作者，或必须深度内嵌原生舞台/独立品牌体验，再以同一核心增加专用编辑器。不要一开始承担整个 Code-OSS 的跟版维护成本。

## 2. 比较

| 维度 | VS Code 插件 | Code-OSS 分叉二次开发 | 从头专用编辑器 |
| --- | --- | --- | --- |
| 首个可用版本 | 较快，复用文本/工作区/任务/诊断 | 慢于插件，先维护发行外壳 | 需先建设文件、文本、撤销和任务基础设施 |
| XML/JS 双向编辑 | 主优势，原生文本编辑和差异可复用 | 同样强，但继承庞大代码库 | 必须自建或集成代码编辑组件 |
| 分镜/资源库 | Custom Editor/Webview 定制，仍需自己开发 | 可更深改 UI，维护面增大 | 最自由，但全部交互由项目承担 |
| 无代码作者体验 | 需要专用首页、隐藏高级功能和引导 | 可裁剪工作台，但成本高 | 最能控制体验，早期基础质量风险大 |
| 调试 | 可做 DAP 适配、变量/断点工作台 | 同插件并可深改 | 自建运行态/断点/轨迹 UI |
| 精确 D3D11/Live2D | 首版外部播放器；Webview 不是原生纹理宿主 | 分叉仍不能自动解决 GPU 互操作 | 更适合后续原生内嵌，但当前仍需另做宿主 |
| AI 服务 | Extension Host 发通用 API，SecretStorage 放密钥 | 同插件并增加发行维护 | 自建凭据/HTTP/取消/日志集成 |
| 多文件保存 | WorkspaceEdit/文档版本可用；仍需事务/快照 | 不自动获得整工程磁盘原子性 | 全部由项目负责 |
| 安装/离线 | 依赖宿主；可提供 VSIX、匹配工具和模板 | 自行更新/安装/签名/分发 | 同样承担独立发行维护 |
| 长期维护 | 稳定公开 API，测试宿主升级 | 追踪上游 Electron/VS Code、安全修复及产品差异 | 控制依赖较直接，但自行维护功能较多 |

这是相对判断：插件并不免费提供剧情编译、任意 JS 可视化、素材依赖或完整的游戏调试器。v0.11.0 的 `frame()`/`ui()` API 解决播放器一侧的注册与目标边界；本仓库已交付 VSIX、DAP 适配器、AI 客户端、UI 生命周期/显式起始幕静态映射、快捷弹窗/玩家快捷键事件、HSL 选色器与配色控件编辑，但仍有未验收的高级资源/AI/媒体/运行态按键能力，见 [12 实现记录](12-implementation-status.zh-cn.md)。

## 3. 插件的具体落点

- Activity Bar 提供“游戏工程”，Tree View 展示章节/人物/变量/资源和问题；Welcome 页面提供新建、导入、试玩和发布。
- XML 使用 Custom Text Editor 展示可视分镜，与 TextDocument/WorkspaceEdit 同步；复杂 JS 保持普通编辑器和明确的 Opaque 标记。自定义编辑器与文本同步机制依据 [Custom Editor 官方文档](https://code.visualstudio.com/api/extension-guides/custom-editors)。
- 舞台、素材选择器和 AI 提案审阅使用 Webview，限制可读取本地资源与脚本来源，消息只承载受限命令。真实媒体/模型先调用外部播放器，不能声称浏览器预览就是相同 GPU 管线。[Webview 官方文档](https://code.visualstudio.com/api/extension-guides/webview)
- 诊断映射到 Problems，编译/资源准备/打包作为取消任务，源码差异复用宿主工作台；后台任务不能直接改未保存文本缓冲。
- DAP 适配器将 VS Code 断点/继续/变量请求翻译到本版帧级 API；以 XML frame/源码映射定位，不承诺 JS 行级 stepping。引擎当前 JSON Lines 协议不是 DAP，需要这一转换层。[Debugger Extension 文档](https://code.visualstudio.com/api/extension-guides/debugger-extension)
- HTTP 和秘密处理放 Extension Host，Webview 不直接持有密钥。使用 [SecretStorage API](https://code.visualstudio.com/api/references/vscode-api#SecretStorage)；未信任工作区仅允许只读查看，运行脚本、工具和发送素材前按 [Workspace Trust](https://code.visualstudio.com/api/extension-guides/workspace-trust) 约定处理。

VS Code 远程扩展宿主可能运行在另一台机器。第一版声明本地桌面 Windows 支持，路径/播放器/调试令牌均在同一宿主；SSH/容器远程模式需单独映射文件和安全隧道，不能把本机 loopback 地址解释为客户端电脑。

## 4. 数据与进程边界

建议结构为 TypeScript 插件/UI + 可复用的 Rust 内容工具 + 独立播放器。AI 使用配置的通用 HTTP API；本地与远程是配置差异，不改变游戏内容格式。不要为了插件引入第二个剧情解释器。

未保存的 XML/JS 以 TextDocument 版本为准；预览/验证先从全部相关缓冲形成私有冻结快照，不能让 Rust 后端悄悄用旧磁盘文本覆盖缓冲。WorkspaceEdit 负责文档更新，显式保存时再配合日志与代次快照；它不是多个文件的磁盘事务保证。

调试状态带进程及 state_revision，控制请求必须使用最新修订；断点暂停时不自动写新源码覆盖旧候选。打包任务使用 v0.11.0 依赖选择及显式附加清单，仍保留发行物检查，密钥、玩家偏好和隐藏交接槽不进入内容根或发行包。

## 5. 为什么不先分叉

Code-OSS 源码与微软发行的 Visual Studio Code 产品并不是同一发行许可/组成，官方 FAQ 明确区分二者。[官方 FAQ](https://code.visualstudio.com/docs/supporting/faq)

分叉意味着独立跟版、打包/升级/签名、品牌资源和扩展分发方案；不能假设继承微软全部产品服务。这些工作对“一格一幕”的核心需求帮助有限。只有稳定插件已证明宿主限制是主要障碍时，才值得评估分叉或独立壳；具体再分发事项由发行方案核对，不把源码开放当全部组件的自动授权。

## 6. 调整后的路线

先验证 VS Code 可视分镜/未保存缓冲往返、通用 AI 服务探测和本版断点 API；再完成手动创作 MVP、资源/AI 提案、调试适配与发布。独立壳作为后续可选投资，不与插件第一版同时完整开发。首版总量仍需 E0 验证后估算，不能将“复用宿主”直接换算成固定节省百分比。
