// v0.11.1: events are independent definitions; XML event attributes attach them.
event.register("advance", (ctx) => { ctx.advance(); });
event.register("choose", (ctx) => { ctx.choose(ctx.item.id); });
event.register("restart", (ctx) => { ctx.restart(); });
