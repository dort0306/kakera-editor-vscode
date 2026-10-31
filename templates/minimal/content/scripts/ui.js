// v0.11.0 registers every UI callback on its real XML target.
ui("hud").bind("advance", (ctx) => { ctx.advance(); });
ui("continue").bind("advance", (ctx) => { ctx.advance(); });
ui("choice").bind("choose", (ctx) => { ctx.choose(ctx.item.id); });
ui("startStory").bind("restart", (ctx) => { ctx.restart(); });
ui("restart").bind("restart", (ctx) => { ctx.restart(); });
