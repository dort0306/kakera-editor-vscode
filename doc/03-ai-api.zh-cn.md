# 03 通用 AI API 与资源关联

更新：2026-10-27，v0.8.3 编辑器规划。编辑器客户端尚未实现；不再要求内置 Qwen3.8-27B、下载权重或绑定某个推理后端。用户可以连接自行部署的本机/内网服务，也可以连接远程服务。

## 1. 协议与兼容范围

首选通用的 Chat Completions 兼容 HTTP JSON 格式：以 model、messages、stream 和生成预算描述请求，以 choices/message/content 或流式 delta 接收输出。兼容指这一最小请求/响应子集，不承诺所有厂商私有参数、模型列表、JSON schema、思考模式和工具调用完全通用。

建议第一版只实现该兼容适配器。非兼容原生服务通过用户部署的转换网关接入；以后有真实需求再添加独立适配器。AI API 与播放器的 TCP JSON Lines 调试 API 是两个不同接口，不能混用。

| 配置项 | 设计 |
| --- | --- |
| profileId / displayName | 稳定服务配置 ID 和作者可读名 |
| baseUrl | 用户提供的 API 基址，明确是否含 /v1；客户端只追加一次 chat/completions，避免重复 /v1 |
| protocol | chat-completions-compatible，版本锁定为编辑器适配器契约 1 |
| model | 用户输入服务接受的精确模型 ID；允许服务不支持模型列表 |
| auth | none 或 bearer；密钥用 secretRef 引用，不保存进项目 XML/JS/清单 |
| extraHeaders | 非秘密头及独立秘密引用；禁止在普通日志回显 Authorization |
| timeout / requestBudget | 连接/响应超时、输入/输出与图片字节预算 |
| capabilities | text、image、stream、jsonObject、jsonSchema；分未知、宣称、已探测三态 |
| providerOptions | 命名隔离的显式可选参数；默认不发送私有 thinking 等字段 |

同一工程可选择不同配置完成拆幕、视觉描述和资源排序。Qwen3.8-27B 仅是可选模型示例，模型大小不影响编辑器自身协议。用户部署的模型文件不由编辑器自动下载、升级或打进游戏。

## 2. 服务部署与凭据

本机示例为用户运行的兼容服务，内网/远程为用户提供地址的兼容网关。编辑器负责配置、测试连接、发送任务和取消请求，不要求管理模型进程或 GPU 驱动。未经配置不自动发现/连接外部服务。

本机 loopback 可使用 HTTP；内网/远程默认使用 HTTPS，证书错误不自动忽略，跨主机重定向不转发密钥。需要非 TLS 内网部署时应作为显式的受限环境配置并清楚显示当前传输方式，而不是静默降级。

VS Code 插件使用 SecretStorage，独立壳使用操作系统凭据存储；工作区只保存非秘密配置或配置引用。用户切换机器需要重新绑定秘密，不在 Git、游戏包、错误报告或 AI 提案里嵌入密钥。服务地址本身也可能敏感，诊断默认隐藏路径中的凭据/查询参数。

“测试连接”验证地址和最小文本请求，不能自动证明看图或结构输出能力。缺少 image 能力时只按人工标签/既有描述推荐，并明确显示“未进行视觉核对”；视觉任务可另选已验证的服务配置。

## 3. 最小消息与输出契约

system 消息包含当前引擎契约、允许操作和输出字段；user 消息只包含选中剧本、候选资源元数据及授权发送的缩略图。图片使用服务支持的内容块形式，优先有限字节的数据 URL；不让服务根据模型生成的任意 URL/本机路径自行取文件。

响应必须区分最终 content、可选 reasoning 信息、结束原因、usage 和传输错误。最终结构对象从 content 解析，不能把 reasoning 当 JSON 提案。流式 SSE 按事件边界拼接 delta，处理分片 UTF-8、结束标记、连接中断和 finish_reason；未完成流不能提交。

jsonSchema 能力可用时发送该服务支持的 response_format；不支持时降为 JSON 对象或严格提示加本地解析/业务校验。降级必须可见，不能因格式看似合法省略资源/变量/目标检查。模型返回工具调用时，首版拒绝该结果，不把它变成 shell 或任意编辑器调用。

请求配置区分 max_tokens 等兼容字段与服务差异；未知参数先不发送。模型没有报告不可变 revision 时记录 model ID、profile revision 和请求指纹，不伪造模型哈希或稳定版本保证。

## 4. 关联流水线

1. 导入阶段确定性读取资源类型、尺寸/时长、内容摘要、依赖、人工标签和授权来源。
2. 可选视觉服务为缩略图生成结构化描述；人工与 AI 标签分开，后者不覆盖已确认信息。
3. 拆幕保留原段落范围，提取人物、地点、时段、情绪、台词与显式选择；原台词不擅自改写。
4. 本地按角色/类型/标签检索有限候选；首版不强制额外 embedding 模型或向量数据库。
5. 配置的 AI 服务返回候选资源 ID、依据、冲突及替代项。无匹配返回 unresolved，不捏造文件或 ID。
6. 作者审阅分镜/素材/路由差异，接受后进入确定性编译器生成 XML/JS，经过现有引擎验证再提交。

资源与剧本是数据，里面的指令、图片文字或文件名不能改变系统约束。提案只允许编辑操作白名单，不带任意写文件路径、DLL、发布或脚本执行命令。

## 5. 发送范围和可追溯性

开始任务前显示正在使用的服务、模型、选中段落、拟发送资源数量和是否包含图片。作者执行任务表示按该范围发送；服务/范围变化后更新说明。原稿母版、许可证、用户存档、机器路径、秘密配置和整个工程不默认发送。

任务记录 profileId/profileRevision、modelId、服务报告的可选 modelRevision、source/resource 指纹、模板版本和简明关联理由。已接受提案的编译不再调用服务。远程模型结果不保证可重复，编译产物则应确定。

## 6. 错误、取消与预算

区分无服务、认证失败、限流、超时、TLS、上下文超限、不支持图片/结构输出、截断、坏 JSON 和业务校验失败。401/403 不盲目重试；429/可恢复网络错误采用有界退避并遵守 Retry-After；最多两次结构修复，仍失败返回草稿诊断。重试不能重复应用提案。

取消关闭请求并使任务过期，不提交部分 XML/JS；服务端是否已经完成计算不能仅由客户端取消推断。UI 任务状态、输出预算和错误日志须可检查。长期任务期间源或素材改变，结果必须重新验证或失效。

初始产品预算可暂设 20 幕/任务、8 张不超过 1024 像素缩略图/批、最终提案 2MiB、连接 15 秒、总任务 5 分钟；均为拟议可配置限制，不是厂商能力或性能实测。服务上下文/费用/速度由用户选择的部署决定，不再使用 27B 权重算术估算作为编辑器最低配置。

## 7. 接入验收

至少验证一个本地自部署兼容服务和一个远程兼容服务，另用确定性 mock 覆盖无鉴权/密钥、文本/图片、流/非流、schema 支持/拒绝、缺模型列表、分片、截断、429、认证、超时、取消和过期提案。未实际调用的服务不得列为已支持。

冻结模型/服务配置与中文素材集合，分别统计文本保真、Top-3、无匹配识别、无效资源 ID、结构验证、人工修订时间及端到端耗时。规划阈值不是本次运行结果。客户端实现前不宣称已经连通任意本地或远程服务。

协议实现与提案字段见 [编辑器 API](05-editor-api-proposal.zh-cn.md)，技术选型见 [方案比较](09-editor-platform-comparison.zh-cn.md)。


## 8. HTTP 线级示例（供客户端实现）

以下地址和模型 ID 均为配置示例，不代表本次已连接。baseUrl=`http://127.0.0.1:8080/v1` 时，实际路径为 `POST /v1/chat/completions`；Content-Type 为 application/json，只有 bearer 配置才添加 Authorization 头（从 secretRef 解析，日志不回显）。不自动追加第二次 /v1。

```json
{
  "model": "author-configured-model",
  "messages": [
    {"role": "system", "content": "仅返回当前契约允许的资源关联提案 JSON。"},
    {"role": "user", "content": "将选中的门口场景关联到候选资源 bg.room、portrait.lin。缺少依据时返回 unresolved。"}
  ],
  "stream": false,
  "max_tokens": 2048
}
```

max_tokens 是否接受应由适配器探测；不支持时使用该服务明确支持的生成预算字段，而不是不断叠加互斥参数。最终 content 是字符串，需再次解析为 Proposal，再进行 schema/资源/变量/路由校验：

```json
{
  "choices": [{"index": 0, "message": {"role": "assistant", "content": "{\"schema\":1,\"associations\":[]}"}, "finish_reason": "stop"}],
  "usage": {"prompt_tokens": 120, "completion_tokens": 32, "total_tokens": 152}
}
```

上面的空对象仅说明外层 HTTP 响应与内层字符串的关系，不是可直接接受的完整 Proposal。拒绝空 choices、无 content、错误类型、超限、length 截断与工具调用；usage 可缺省，不把缺失当零消耗。

已确认 image 能力时，单条 user.content 可以是受限内容块数组，例如：

```json
[
  {"type":"text","text":"只比较这张已授权缩略图与候选说明。"},
  {"type":"image_url","image_url":{"url":"data:image/png;base64,<受限缩略图字节>"}}
]
```

服务不接受此形式时标记 image 不兼容或走显式转换网关，不上传原始 PSD/整个目录。支持结构输出的服务才发送 response_format；json_object 与 json_schema 是分别探测的能力，不预设严格 schema 通用。

stream=true 时验证 HTTP 成功与 text/event-stream，再累积 `data:` 事件中的 choices[].delta.content。`data: [DONE]` 为常见结束标记，但仍校验内容和 finish_reason；reasoning/usage/空 delta 不混入最终提案。服务提供的其他结束方式需锁定适配器规则，不能在断线时猜完成。错误响应保留状态码及有界净化消息，密钥/完整原稿不进诊断。

兼容子集参考 [llama.cpp server 官方说明](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)，实施时记录实际服务版本及能力结果。通用格式并不保证任意端点免适配。
