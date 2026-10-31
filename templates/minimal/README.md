# 最小游戏模板

模板 XML/UI/JS 由本插件提供，MIT 许可。字体为 Noto Sans CJK SC Regular Sans 2.004，原始文件来自 Kakera v0.8.3 demo，SIL OFL 1.1；完整许可随 `content/assets/licenses/OFL.txt` 保留。

模板包含 7 个 UI 页面（title/hud/save/load/gallery/confirm-save/confirm-quit）、存档/读档/画廊的 repeat 分页和两个确认弹窗；`scripts/components.js` 用 v0.11.2 的 `component.register` 声明内置 `x-tabs`/`x-pagination` 组合标签，页面本身不必使用它们，编辑器随时可以插入实例。存档页与画廊页在没有任何存档/CG 时显示空列表并禁用翻页，属于引擎允许的空集行为。

模板没有 Live2D Core 或第三方模型。创建工程时使用同一短 ID 生成器分配新的显式 frame ID（8 字节随机数的 16 位十六进制），并根据实际 frame 引用生成受管脚本。
