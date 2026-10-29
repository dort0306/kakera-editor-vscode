# 08 依据与外部 API

核对日期：2026-10-29。播放器 v0.9.1（story 8 / UI 3 / save 9）；编辑器采用 VS Code 插件，AI 使用用户可配置的兼容 API，不绑定必需模型。下表部分路径属于相邻上游工程，未随本仓库提供；实际插件验证以 [12 实现记录](12-implementation-status.zh-cn.md)为准。

## 1. 仓库依据

| 文档/源码 | 用途 |
| --- | --- |
| [主 XML/JS 手册](../xml-js-api.zh-cn.md) | 当前 story/UI/save、点九/图集/名字/标题以及本版调试/发布 |
| [工程发布指南](../project-release-pack-guide.zh-cn.md) | 参数、Core、KPAK 和发行检查 |
| 上游 `doc/v0.9.0-implementation-plan.zh-cn.md` / `doc/v0.9.0-validation.zh-cn.md` | 生命周期、隐藏交接、save 9 的计划与播放器验收（不在本仓库） |
| 上游 `doc/v0.9.1-implementation-plan.zh-cn.md` / `doc/v0.9.1-validation.zh-cn.md` | 末幕 frameExit、UI 显式起始幕与隐藏续接增量（不在本仓库） |
| 上游 `doc/cg-resources-implementation-plan.zh-cn.md` / `doc/cg-resources-validation.zh-cn.md` | 专用 CG 资源、画廊、共享解锁与验收（不在本仓库） |
| 上游 `doc/multiple-entries-implementation-plan.zh-cn.md` / `doc/multiple-entries-validation.zh-cn.md` | 多起始幕、UI 首次进入、显式 resume/restart 与调试 game_started（不在本仓库） |
| [v0.8.3 策略](../v0.8.3-implementation-plan.zh-cn.md) / [验收](../v0.8.3-validation.zh-cn.md) | 历史版本实现与真实检查范围 |
| [调试 transport](../../src/debug.rs) / [App](../../src/app/debug.rs) | 真实请求、认证、修订与提交前断点 |
| [发布选择](../../src/package/selection.rs) | 运行依赖/许可证/显式 include 的实际策略 |
| [调试 API 手册](10-player-debug-api.zh-cn.md) | 已实现命令；不是 DAP 或 HTTP |
| [v0.8.2 策略](../v0.8.2-implementation-plan.zh-cn.md) / [验收](../v0.8.2-validation.zh-cn.md) | 图集/点九/UUID 历史依据 |
| [v0.8.1 验收](../v0.8.1-validation.zh-cn.md) | 大包历史实测，不当作本轮复测 |
| [demo](../../games/demo/story.xml) / [UI](../../games/demo/ui.xml) | 真实资源和交互，不从归档示例猜完整素材 |

## 2. 官方接口资料

| 来源 | 用途 |
| --- | --- |
| [VS Code Custom Editor](https://code.visualstudio.com/api/extension-guides/custom-editors) | XML 可视分镜与 TextDocument/WorkspaceEdit 同步 |
| [VS Code Webview](https://code.visualstudio.com/api/extension-guides/webview) | 作者舞台/素材/提案 UI 及受限资源边界 |
| [Debugger Extension](https://code.visualstudio.com/api/extension-guides/debugger-extension) | 开发 DAP 转换层，不假装引擎协议直接兼容 |
| [SecretStorage](https://code.visualstudio.com/api/references/vscode-api#SecretStorage) | API 密钥，不放工作区内容 |
| [Workspace Trust](https://code.visualstudio.com/api/extension-guides/workspace-trust) | 受限工作区与运行任务能力 |
| [VS Code FAQ](https://code.visualstudio.com/docs/supporting/faq) | Code-OSS 与微软产品组成/发行差异 |
| [llama.cpp server](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md) | 可选自部署兼容服务的聊天/流/结构格式参考 |
| [Qwen3.8-27B 模型卡](https://huggingface.co/Qwen/Qwen3.8-27B) | 用户自行选择该模型时参考，非客户端硬依赖 |

兼容 API 的共同子集与探测/降级见第 03 篇；各服务私有字段依真实版本，不将模型卡当成所有兼容端点的规范。本文未实际调用用户本地或远程 AI 服务。

## 3. 实施时版本清单

锁定插件 engines.vscode、前端/后端工具哈希、引擎/模板/编译器版本和调试协议 v1；AI 配置记录 profile revision、model ID、可选服务报告版本和探测结果。服务没有不可变模型哈希时明确未知，不伪造 modelFingerprint。

JS 往返解析库仍待 E0 选型并验证 BigInt/源码保真；独立壳若后续立项需另做 GUI/纹理互操作。现有与拟议接口分开维护，第 05 篇不能因播放器 API 完成而整体标为已实现。
