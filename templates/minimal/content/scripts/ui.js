// UI events use the player's restricted host, never the extension host.
on.ui("advance", (ctx) => { ctx.advance(); });
on.ui("choose", (ctx) => { ctx.choose(ctx.item.id); });
on.ui("restart", (ctx) => { ctx.restart(); });
