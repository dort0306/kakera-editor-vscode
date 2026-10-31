# 10 播放器调试 API v1（v0.8.3 已实现，v0.11.0 保持兼容）

这是已实现的播放器宿主 API，源码见 [transport](../../src/debug.rs) 与 [App 适配](../../src/app/debug.rs)。本仓库 DAP 适配器已接入，但这里描述的是播放器端 TCP 契约；不要与通用 AI HTTP API 混淆。协议版本仍为 1；v0.9.0 未增加新命令/字段，v0.9.1 多起始幕增加 `game_started` 并允许未进入时 `frame_id/frame_name=null`，v0.10.0 只把 `engine_version` 推进到 0.10.0；v0.10.1 继续把 `engine_version` 推进到 0.10.1；v0.11.0 把 `engine_version` 推进到 0.11.0，未增加调试命令或字段。

## 1. 启动

播放器需显式给出 --project、--save-dir、--debug-listen、--debug-token-file；禁止与 --package 或 --check 混用。仅 loopback 地址允许，端口 0 可由系统分配并在工程日志输出实际端口。跨主机由部署者配置安全隧道，播放器本身不监听公网或实现 TLS。

```powershell
# 测试令牌使用随机值，不放入游戏目录或版本库。
([guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')) |
  Set-Content -Encoding ascii target/debug-token.txt
./target/release/kakera-avg.exe --project games/demo --save-dir target/debug-saves `
  --debug-listen 127.0.0.1:19200 --debug-token-file target/debug-token.txt --no-audio
```

令牌为 32–128 个 ASCII 字母/数字/-/_，允许文件末尾换行。每条请求都要携带令牌；不通过响应或日志返回令牌。初始状态暂停，调试会话默认关闭自动保存并丢弃初始待自动保存；设置仍属于该显式数据目录，调用者应选独立测试目录。

## 2. 传输与请求

TCP 上 UTF-8 JSON Lines，每行一条请求/响应。不是 HTTP、JSON-RPC 或 DAP。一次处理一个连接；连接空闲约 30 秒关闭，可重新连接。请求最多 64KiB（不含换行），响应最多 2MiB；队列有界为 8，排队/等待约 5 秒后超时。

```json
{"version":1,"id":1,"token":"<实际令牌>","command":{"type":"status"}}
```

| 字段 | 要求 |
| --- | --- |
| version | 固定 1，不猜旧字段 |
| id | 非零 u64；同一服务生命周期全局递增，客户端建议使用安全整数范围 |
| token | 实际令牌文件内容，不是上面的占位符 |
| expected_revision | 控制命令必需，为最近状态的 state_revision；status 不需要 |
| command | 下表定义的对象，不允许额外字段 |

同一个 id 的相同请求字节可重发：最近 8 个响应直接复用，不重复执行。id 相同但内容改变报冲突；已离开缓存的旧 id 拒绝。状态刷新须用新 id。断线/超时不等于命令一定未执行，应先以新 id 查询状态；不能盲目使用新 id 重复推进。

## 3. 命令

| type | 额外字段 | 语义 |
| --- | --- | --- |
| status | 无 | 返回只读状态，不运行游戏 JS |
| pause | 无 | 在更新边界暂停；停止自动播放 |
| resume | 无 | 有未决断点则提交该完整候选一次，再恢复运行 |
| breakpoints | frames: string[] | 整批替换断点；最多 1000 个，单引用最多 256 字节；接受现有 ID/name |
| advance | 无 | 仅暂停时；未决断点提交一次并保持暂停，否则按跳转场→补全文字→Advance 的普通仲裁处理 |
| choose | option: string | 仅暂停且文字/转场/视频已就绪；必须是当前缓存中的可用选项 |
| reveal | 无 | 暂停时补全当前句，视频播放时拒绝 |
| skip_transition | 无 | 暂停时完成当前转场，不推进剧情 |

步进仍受菜单/宿主提示/自动存档等待阻挡，不能穿透 UI。未决断点只接受 advance/resume 来提交，不能替候选选择选项。不支持任意跳转、改变量、eval、保存、文件路径、条件断点、事件订阅或 JS 行级步进。

命中断点发生在 Controller、目标条件、game.enter 计划及候选媒体验证成功后、任何新 Session/UI/音频/效果/CG 写入前。当前状态保持旧幕；pending_frame 即使等于当前 frame_id 也表示自循环待提交。候选失败不触发断点。渲染设备重建时未决 GPU 候选会丢弃并报告，旧会话保留。

暂停冻结逐字、转场、自动/Ctrl、视频与动作时间，同时暂停音轨；正常剧情输入被阻挡。热更替换在暂停期间延后，继续先提交原快照的候选，再由普通热更验证流程处理新内容。不可把它当任意时点改代码后继续旧函数栈的调试器。

## 4. 响应和状态

成功响应为 version/id/ok=true/result；错误为 version/id/ok=false/error 字符串。无法解析的帧可能返回 id=0。错误字符串保留原因但不是稳定机器错误码；客户端不得依赖中文文本做协议分派。

| 状态字段组 | 内容 |
| --- | --- |
| 协议/宿主 | protocol=KakeraEditorDebug、version、process_id、engine_version、capabilities |
| 修订 | state_revision（控制前置条件）、presentation_revision（画面捕获修订） |
| 故事 | story_id、content_version、game_started、frame_id、frame_name、history_length、available_options |
| 事务 | paused、reason、last_error、pending_frame、pending_variables |
| 数据 | variables、ui_variables、ui_stack、window_title |
| 呈现 | text_complete、transitioning、transition_age、video_playing/video_position、live2d_active、auto_playing |
| 阻挡 | host_prompt、menu_paused、autosave_pending、breakpoints |

多起始幕启动只显示初始 UI：`game_started=false` 时 `frame_id/frame_name=null`、`history_length=0`、`available_options=[]`，advance/choose/reveal/skip_transition 等剧情步进被拒绝，直到 UI 显式 `resume/restart` 或读档。调试协议没有“从外部指定起点”的命令，客户端不得伪造 frame；需要真实起点时从播放器 UI 操作或加载存档。

v0.9.0 起 `video_playing/video_position` 只描述 UI 演出中的视频；frame 视频已删除，字段名保留以兼容协议 v1。活动隐藏交接或 UI 演出一律会阻挡调试步进/补全，客户端应按错误提示后重新查询状态，不能假设一次 advance 未被执行。调试状态不是 save 9 槽位，也不包含 `resume_to`、隐藏槽内容或 UI 音效偏好。

变量值是带 type 的对象；int 的 value 为十进制字符串，bool/string 保持 JSON 原类型。没有完整历史、指针、纹理、库句柄、物理资源路径或 API 令牌。状态是 App 更新边界的快照，呈现时钟可在两次查询间自然变化；state_revision 不是每一帧时钟的计数。

客户端应同时关联 process_id、地址和当前启动凭据，不能将另一次启动的修订当作同一会话。原生 UI 提交、剧情操作、断点与控制改变修订；控制失败可能更新诊断或操作计数，失败后先查询再继续。

## 5. 与 VS Code 的关系

VS Code DAP 适配器是后续编辑器工作：把 frame 的 XML 行映射为断点，使用 status 展示变量和候选，通过现有控制命令推进。当前协议没有推送事件，适配器需有界轮询；条件断点、源码指纹、受控候选替换和通用 JSON 诊断仍是未来能力，不在本版伪装为已实现。


## 6. 最小客户端顺序

连接后先用新 id 查询 status，保存 result.state_revision。假设返回值为 0，设置断点示例为：

```json
{"version":1,"id":2,"token":"<实际令牌>","expected_revision":0,"command":{"type":"breakpoints","frames":["opening"]}}
```

后续使用这次成功响应中的新修订，而不是沿用 0。以 advance 执行一次仲裁后检查 pending_frame；非 null 说明候选尚未提交，下一次 advance 或 resume 才提交。若 id=2 的响应丢失，只能逐字节重发原帧来取缓存结果；查询新状态使用更大的 id。单服务仅有一套递增 ID 序列，不支持多个各自从 1 开始的客户端同时控制。

调试端点通常短期存在；断开客户端不自动退出或恢复播放器，暂停仍保持。编辑器应提供明显的“继续 / 停止本次试玩”，并优先正常关闭自己启动的播放器。本版没有远程 quit 命令。
