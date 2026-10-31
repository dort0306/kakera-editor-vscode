// Kakera 最小模板的界面脚本。
// v0.11.1 起界面回调是独立定义：event.register("事件ID", ctx => { ... })。
// XML 的 event="事件ID" 只做引用，同一事件可以被多个控件共用；这里不使用旧 on.* 或两参数 bind。

// 基础动作：继续对话、选择选项、关闭当前页。
event.register("advance", ctx => { ctx.advance(); });
event.register("choose", ctx => { ctx.choose(ctx.item.id); });
event.register("close-page", ctx => { ctx.close(); });

// 进入剧情：hud 是非模态根页面，open 之后再重新开始。
// 模板只有一个起始幕，因此这里使用无参 restart，由引擎按 story.xml 的 entry 解析；
// 不要写死幕 ID，kakera.project.create 会为新建工程重新分配幕 ID。
event.register("start-game", ctx => { ctx.open("hud"); ctx.restart(); });
event.register("restart", ctx => { ctx.restart(); });

// 继续：内存中已有剧情会话时直接回到 hud（页面栈切换不影响剧情），
// 否则打开读档页。引擎没有向脚本暴露“最近自动档槽号”，
// 因此不能在这里一键读取最近自动档；读档页的自动存档列表按最新在前排列。
event.register("continue-game", ctx => {
  if (ctx.game.frameId === "") { ctx.open("load"); return; }
  ctx.open("hud");
});

// 页面入口。
event.register("open-save", ctx => { ctx.open("save"); });
event.register("open-load", ctx => { ctx.open("load"); });
event.register("open-gallery", ctx => { ctx.open("gallery"); });
// 返回标题：hud 与 title 都是非模态根页面，替换根栈不会结束内存中的剧情会话，
// 所以返回后“继续”可以直接回到 hud。
event.register("back-title", ctx => { ctx.open("title"); });

// 手动存档：空槽直接写入；已有存档的槽先打开确认页，覆盖需要显式 overwrite=true。
// 保存成功后留在本页，槽位列表由宿主刷新，提示写入 ui.saveNotice。
event.register("save-slot", ctx => {
  if (ctx.item.exists) {
    ctx.setUi("saveSlot", ctx.item.slot);
    ctx.setUi("confirmText", `槽位 ${ctx.item.slot} 已有存档，确认覆盖？`);
    ctx.open("confirm-save");
    return;
  }
  ctx.save(ctx.item.slot);
  ctx.setUi("saveNotice", `已保存到槽位 ${ctx.item.slot}`);
});
event.register("confirm-save", ctx => {
  ctx.save(Number(ctx.ui.saveSlot), true);
  ctx.setUi("saveNotice", `已覆盖槽位 ${ctx.ui.saveSlot}`);
  ctx.close();
});

// 手动存档分页（v0.11.2）：页码来自 repeat.saveSlots 的只读元数据快照，
// 写回 page-bind 绑定的 ui.savePage；同一批 setUi 不会让快照同步变化。
event.register("save-prev", ctx => {
  const page = ctx.repeats.saveSlots;
  if (page.canPrev) ctx.setUi("savePage", page.page - 1);
});
event.register("save-next", ctx => {
  const page = ctx.repeats.saveSlots;
  if (page.canNext) ctx.setUi("savePage", page.page + 1);
});

// 读档页标签页与读取：自动存档用 loadAuto，手动存档用 load，成功后关闭本页并回到 hud。
event.register("load-tab-auto", ctx => { ctx.setUi("loadAutoTab", true); });
event.register("load-tab-slots", ctx => { ctx.setUi("loadAutoTab", false); });
event.register("load-auto-slot", ctx => {
  ctx.loadAuto(ctx.item.slot);
  ctx.close();
  ctx.open("hud");
});
event.register("load-slot", ctx => {
  ctx.load(ctx.item.slot);
  ctx.close();
  ctx.open("hud");
});
event.register("load-prev", ctx => {
  const page = ctx.repeats.loadSlots;
  if (page.canPrev) ctx.setUi("loadPage", page.page - 1);
});
event.register("load-next", ctx => {
  const page = ctx.repeats.loadSlots;
  if (page.canNext) ctx.setUi("loadPage", page.page + 1);
});

// CG 画廊分页：模板没有 CG 条目时只有第 1 页、没有行、也不能翻页。
event.register("gallery-prev", ctx => {
  const page = ctx.repeats.galleryCards;
  if (page.canPrev) ctx.setUi("galleryPage", page.page - 1);
});
event.register("gallery-next", ctx => {
  const page = ctx.repeats.galleryCards;
  if (page.canNext) ctx.setUi("galleryPage", page.page + 1);
});

// 退出：先打开确认页，确认后请求宿主关闭窗口；不会隐式保存新存档。
event.register("request-quit", ctx => { ctx.open("confirm-quit"); });
event.register("quit-game", ctx => { ctx.quit(); });
