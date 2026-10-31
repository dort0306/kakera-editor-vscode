import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeLogic, patchLogicRoutes, readStory, insertConnectedFrame, deleteConnectedFrame, reconcilePendingRoutes, protectedLogicTargets, type Sources } from '../packages/source/src/index';
import { buildStoryGraph } from '../packages/domain/src/graph';
import type { Route } from '../packages/domain/src/index';
const xml = `<story schema="8" id="s" content-version="1" entry="a-id"><variables><int id="score" initial="0"/><bool id="flag" initial="false"/></variables><scripts><script src="routes.js"/><script src="ui.js"/></scripts><frames><frame id="a-id" name="a"><text>开场</text></frame><frame id="b-id" name="b"><text>后续</text></frame><frame id="c-id" name="c"><text>结尾</text></frame></frames><next end="true"/></story>`;
const input = (js: string, story = xml, ui = 'ui("$game").bind("game.enter", state => { state.setUi("status", "就绪"); }); // 保留 UI\n'): Sources => new Map([['story.xml', story], ['routes.js', js], ['ui.js', ui]]);
const analyze = (sources: Sources) => analyzeLogic(sources, readStory(sources));
const apply = (sources: Sources, changes: Sources) => new Map([...sources, ...changes]);

test('没有生成标记、CRLF、注释、引号、普通函数和简写箭头仍可实时映射与编辑', () => {
  const js = `"use strict";\r\n// 作者备注 🐈\r\nframe('a-id')['advance'](() => 'b-id');\r\nframe('b').advance(function (state) {\r\n  // 保留更新旁注\r\n  state.add('score', 1);\r\n  return /* 下一幕 */ 'c';\r\n});\r\nframe('c').end(); // 结尾\r\n`;
  const sources = input(js), result = analyze(sources);
  assert.equal(result.complete, true); assert.equal(result.routes[0].frame, 'a'); assert.equal(result.routes[0].target, 'b');
  assert.equal(result.routes[1].updates[0].value.kind, 'constant'); assert.deepEqual(result.frames.a.locations, [{ file: 'routes.js', line: 3, start: js.indexOf("frame('a-id')['advance']"), end: js.indexOf(';', js.indexOf("frame('a-id')['advance']")) + 1 }]);
  assert.equal(patchLogicRoutes(sources, result, result.routes).size, 0);
  const changes = patchLogicRoutes(sources, result, result.routes.map(r => r.frame === 'a' ? { ...r, target: 'c' } : r));
  assert.equal(changes.get('routes.js'), js.replace("() => 'b-id'", '() => "c"')); assert.equal(changes.has('ui.js'), false);
  assert.equal(analyze(apply(sources, changes)).complete, true);
});

test('跨脚本注册、幕 ID/名称别名和常量目标统一映射，改线仅补丁对应文件', () => {
  const sources = input("const NEXT = 'b-id'; frame('a-id').advance(() => NEXT); frame('c').end();", xml, "// 另一个文件\nframe('b-id').advance(state => 'c-id');");
  const result = analyze(sources); assert.equal(result.complete, true);
  const change = patchLogicRoutes(sources, result, result.routes.map(r => r.frame === 'b' ? { ...r, target: 'a' } : r));
  assert.deepEqual([...change.keys()], ['ui.js']); assert.equal(change.get('ui.js'), '// 另一个文件\nframe(\'b-id\').advance(state => "a");');
});

test('条件与有序更新按节点修改，保留回调样式、注释和其他手写语句', () => {
  const story = xml.replace('<text>开场</text>', '<text>选择</text><options><option id="x">继续</option></options>');
  const js = `const untouched = 'ctx.vars'; // 手写旁注\nframe('a').choice('x', function (s) { s.add(/* 数值 */ 'score', 1); return /* 目标 */ 'b'; }, function(g) { return g.vars.score >= 2n && g.vars['flag']; });\nframe('b').advance(() => 'c'); frame('c').end();`;
  const sources = input(js, story), result = analyze(sources); assert.equal(result.complete, true);
  const routes = result.routes.map(r => r.frame === 'a' ? { ...r, target: 'c', updates: [{ ...r.updates[0], value: { kind: 'constant' as const, type: 'int' as const, value: '9007199254740993' } }], guard: { kind: 'variable' as const, id: 'flag' } } : r);
  const text = patchLogicRoutes(sources, result, routes).get('routes.js')!;
  assert.equal(text, js.replace("'score', 1", "'score', 9007199254740993n").replace("/* 目标 */ 'b'", '/* 目标 */ "c"').replace("g.vars.score >= 2n && g.vars['flag']", 'g.vars["flag"]'));
  assert.equal(analyze(apply(sources, new Map([['routes.js', text]]))).complete, true);
});

test('给零参数回调添加更新会补上下文参数，多个更新保持原顺序', () => {
  for (const cb of ["() => 'b'", "function /* 保留 */ () { return/* 目标 */'b'; }"]) {
    const sources = input(`frame('a').advance(${cb}); frame('b').advance(() => 'c'); frame('c').end();`), result = analyze(sources);
    const updates: Route['updates'] = [{ op: 'set', variable: 'score', value: { kind: 'constant', type: 'int', value: '1' } }, { op: 'add', variable: 'score', value: { kind: 'constant', type: 'int', value: '2' } }];
    const changed = apply(sources, patchLogicRoutes(sources, result, result.routes.map(r => r.frame === 'a' ? { ...r, updates } : r)));
    assert.equal(analyze(changed).complete, true); assert.deepEqual(analyze(changed).routes[0].updates, updates);
    if (cb.includes('保留')) assert.ok(changed.get('routes.js')!.includes('/* 保留 */'));
  }
});

test('新增和删除幕在 Recognized 源码中保留其他代码、注释、原注册写法', () => {
  const js = `// 故事\nframe('a').advance(state => { /* 更新注释 */ state.add('score', 1); return 'b'; });\nframe('b').advance(() => 'c');\nframe('c').end();\nconst helper = () => '保留';\n`;
  const sources = input(js), logic = analyze(sources);
  const inserted = insertConnectedFrame(sources, logic.routes, 'routes.js', 'a', logic), added = apply(sources, inserted.changes), after = analyze(added);
  assert.equal(after.complete, true); assert.equal(after.routes.find(r => r.frame === inserted.selected)!.target, 'b');
  assert.ok(added.get('routes.js')!.includes("state.add('score', 1)")); assert.ok(added.get('routes.js')!.includes("const helper = () => '保留';"));
  const removed = deleteConnectedFrame(added, after.routes, 'routes.js', inserted.selected, after), final = analyze(apply(added, removed.changes));
  assert.equal(final.complete, true); assert.equal(final.routes.find(r => r.frame === 'a')!.target, 'b');
});

test('零参数 guard 编辑后绑定上下文，更新新增参数不会遮蔽旧常量目标', () => {
  const story = xml.replace('<text>开场</text>', '<text>选择</text><options><option id="x">继续</option></options>');
  const sources = input("const ctx = 'b'; frame('a').choice('x', () => { return ctx; }, () => true); frame('b').advance(()=> 'c'); frame('c').end();", story), logic = analyze(sources);
  assert.equal(logic.complete, true);
  const routes = logic.routes.map(r => r.frame === 'a' ? { ...r, guard: { kind: 'variable' as const, id: 'flag' }, updates: [{ op: 'add' as const, variable: 'score', value: { kind: 'constant' as const, type: 'int' as const, value: '1' } }] } : r);
  const changed = apply(sources, patchLogicRoutes(sources, logic, routes)); assert.equal(analyze(changed).complete, true);
  assert.ok(changed.get('routes.js')!.includes('return ctx;')); assert.ok(changed.get('routes.js')!.includes('(_kakeraCtx)'));
  const changedLogic = analyze(changed), removed = apply(changed, patchLogicRoutes(changed, changedLogic, changedLogic.routes.map(r => r.frame === 'a' ? { ...r, guard: undefined, updates: [] } : r)));
  assert.equal(analyze(removed).complete, true); assert.equal(analyze(removed).routes[0].guard, undefined);
  const removedLogic = analyze(removed), addedGuard = apply(removed, patchLogicRoutes(removed, removedLogic, removedLogic.routes.map(r => r.frame === 'a' ? { ...r, guard: { kind: 'variable' as const, id: 'flag' } } : r)));
  assert.equal(analyze(addedGuard).complete, true); assert.deepEqual(analyze(addedGuard).routes[0].guard, { kind: 'variable', id: 'flag' });
});

test('混合自定义条件只限制对应幕，条件返回映射所有候选目标，XML 文本仍可编辑', () => {
  const sources = input("frame('a').advance(ctx => checkFlag(ctx.vars.flag) ? 'b' : 'c'); frame('b').advance(() => 'c'); frame('c').end();"), result = analyze(sources);
  assert.equal(result.frames.a.editable, false); assert.equal(result.frames.b.editable, true); assert.equal(result.complete, false);
  assert.deepEqual(result.links.filter(r => r.frame === 'a').map(r => r.target).sort(), ['b', 'c']);
  assert.ok(result.links.filter(r => r.frame === 'a').every(r => r.conditional));
  const graph = buildStoryGraph(readStory(sources), result.links); assert.equal(graph.edges.filter(e => e.source === 'a').length, 2);
  const inserted = insertConnectedFrame(sources, result.routes, 'routes.js', 'b', result); assert.equal(analyze(apply(sources, inserted.changes)).frames.b.editable, true);
  assert.ok(apply(sources, inserted.changes).get('routes.js')!.includes("checkFlag(ctx.vars.flag) ? 'b' : 'c'"));
  assert.throws(() => deleteConnectedFrame(sources, result.routes, 'routes.js', 'b', result), /动态路线/);
});

test('共享函数只读追踪 return，任意调用不执行，未知目标保留明确未知节点', () => {
  const js = "function route(ctx) { if(ctx.vars.flag) return 'b'; return computeTarget(); } frame('a').advance(route); frame('b').advance(()=> 'c'); frame('c').end();";
  const sources = input(js), result = analyze(sources);
  assert.equal(result.frames.a.editable, false); assert.equal(result.frames.b.editable, true);
  assert.ok(result.links.some(r => r.frame === 'a' && r.target === 'b')); assert.ok(result.links.some(r => r.frame === 'a' && r.dynamic));
});

test('重复注册、XML/选项不一致、坏目标、动态注册和选择器别名不自动接管', () => {
  const suffix = "frame('b').advance(()=> 'c'); frame('c').end();";
  for (const [js, global] of [["frame('a').advance(()=> 'b'); frame('a').end();", false], ["frame('a').choice('missing',()=> 'b');", false], ["frame('a').advance(()=> 'missing');", false], ["const reg = frame; reg.end('a');", true], ["for (const f of getFrames()) frame(f).advance(()=> 'b');", true], ["frame = custom; frame('a').advance(()=> 'b');", true]] as const) {
    const result = analyze(input(js + suffix)); assert.equal(result.frames.a.editable, false, js); assert.equal(result.frames.b.editable, !global, js);
  }
});

test('旧 on.* 注册给出迁移诊断，不再当作可编辑路线', () => {
  const sources = input("on.advance('a',()=> 'b'); frame('b').advance(()=> 'c'); frame('c').end();");
  const result = analyze(sources);
  assert.equal(result.complete, false); assert.equal(result.registrationUncertain, true);
  assert.ok(result.issues.some(issue => issue.includes('on.advance') && issue.includes('第 37.5 节')));
  assert.ok(result.frames.a.reason?.includes('on.*'));
});

test('源脚本语法暂时不完整会给出诊断，修复后重新映射，绝不沿用旧范围', () => {
  const original = input("frame('a').advance(()=> 'b'); frame('b').advance(()=> 'c'); frame('c').end();"), first = analyze(original); assert.equal(first.complete, true);
  const broken = new Map(original); broken.set('routes.js', "frame('a').advance(() => {"); const bad = analyze(broken); assert.equal(bad.complete, false); assert.ok(bad.issues[0].includes('routes.js')); assert.equal(bad.routes.length, 0);
  assert.equal(analyze(original).complete, true);
});

test('上下文参数和局部声明遮蔽常量时不猜测目标；间接动态注册保持只读', () => {
  for (const cb of ['NEXT => NEXT', "ctx => { const NEXT = ctx.vars.flag; return NEXT; }"]) {
    const result = analyze(input(`const NEXT = 'b'; frame('a').advance(${cb}); frame('b').advance(()=> 'c'); frame('c').end();`));
    assert.equal(result.frames.a.editable, false); assert.equal(result.links.some(r => r.frame === 'a' && r.target === 'b'), false); assert.ok(result.links.some(r => r.frame === 'a' && r.dynamic));
  }
  for (const js of ["globalThis['frame'].end('a');", "new Function('frame(\"a\").end()')();"]) assert.equal(analyze(input(js + "frame('b').advance(()=> 'c'); frame('c').end();")).frames.b.editable, false);
});

test('不把严格比较中的 Number 误识别为 BigInt，不对不安全整数做近似映射', () => {
  const story = xml.replace('<text>开场</text>', '<text>选择</text><options><option id="x">继续</option></options>');
  for (const expr of ['ctx.vars.score === 2', 'ctx.vars.score !== 2', 'ctx.vars.score > 9007199254740993']) assert.equal(analyze(input(`frame('a').choice('x',()=> 'b',ctx => ${expr}); frame('b').advance(()=> 'c'); frame('c').end();`, story)).frames.a.editable, false);
  assert.equal(analyze(input("frame('a').choice('x',()=> 'b',ctx => ctx.vars.score > 2); frame('b').advance(()=> 'c'); frame('c').end();", story)).complete, true);
});

test('待连接选项补幕后仍能持续识别，不依赖生成器逐字匹配', () => {
  const story = xml.replace('<text>开场</text>', '<text>选择</text><options><option id="x">继续</option></options>');
  const sources = input("frame('a').choice('x', () => 'b'); frame('b').advance(()=> 'c'); frame('c').end();", story), logic = analyze(sources);
  const pending = reconcilePendingRoutes(sources, logic.routes.map(r => r.frame === 'a' ? { ...r, target: '' } : r));
  const stored = apply(pending.sources, patchLogicRoutes(sources, logic, pending.routes)), ready = analyze(stored); assert.equal(ready.complete, true);
  const filled = insertConnectedFrame(stored, ready.routes, 'routes.js', 'a', ready), complete = apply(stored, filled.changes);
  assert.equal(analyze(complete).complete, true); assert.equal(readStory(complete).frames.some(f => f.pending), false);
});

test('v0.11.0 生命周期注册不当作剧情路由，仍保留幕/页面引用与删除保护', () => {
  const sources = input("frame('a').advance(()=> 'b'); frame('b').advance(()=> 'c'); frame('c').end();\nframe('a-id').enter(ctx => {}); frame('b').exit(state => state.open('hud'));\nui('hud').bind('screen.open', ctx => {});\nui('hud').bind('screen.close', ctx => ctx.resume('c-id'));\nui('back').bind('present', ctx => ctx.present('hud'));");
  const result = analyze(sources);
  assert.equal(result.complete, true);
  assert.deepEqual(result.lifecycle.map(l => `${l.kind}:${l.target}`).sort(), ['frameEnter:a-id', 'frameExit:b', 'screenClose:hud', 'screenOpen:hud']);
  assert.equal(result.references.frames.has('a'), true);
  assert.equal(result.references.frames.has('b'), true);
  assert.equal(result.references.frames.has('c'), true);
  assert.equal(result.references.screens.has('hud'), true);
  assert.equal(result.frames.a.locations.length, 2);
  assert.throws(() => deleteConnectedFrame(sources, result.routes, 'routes.js', 'b', result), /生命周期|ctx\.resume/);
  assert.throws(() => deleteConnectedFrame(sources, result.routes, 'routes.js', 'c', result), /ctx\.resume/);
  const unknown = analyze(input("frame('a').advance(()=> 'b'); frame('b').advance(()=> 'c'); frame('c').end();\nframe('missing').exit(ctx => {});"));
  assert.equal(unknown.complete, true); assert.ok(unknown.issues.some(issue => issue.includes('生命周期幕不存在')));
  const dynamic = analyze(input("frame('a').advance(()=> 'b'); frame('b').advance(()=> 'c'); frame('c').end();\nframe(target()).exit(ctx => {});"));
  assert.equal(dynamic.complete, true); assert.equal(dynamic.references.dynamicFrames, true); assert.ok(dynamic.issues.some(issue => issue.includes('生命周期目标不确定')));
  assert.throws(() => deleteConnectedFrame(sources, dynamic.routes, 'routes.js', 'b', dynamic), /动态/);
  const dynamicResume = analyze(input("frame('a').advance(()=> 'b'); frame('b').advance(()=> 'c'); frame('c').end();\nui('back').bind('resume', ctx => ctx.resume(ctx.value));"));
  assert.equal(dynamicResume.references.dynamicFrames, true); assert.ok(dynamicResume.issues.some(issue => issue.includes('UI 返回目标不确定')));
  const pendingResume = analyze(input("frame('a').advance(()=> 'b'); frame('b').advance(()=> 'c'); frame('c').end();\nui('back').bind('resume', ctx => ctx.resume());"));
  assert.equal(pendingResume.references.dynamicFrames, false);
  const resumeMissing = analyze(input("frame('a').advance(()=> 'b'); frame('b').advance(()=> 'c'); frame('c').end();\nui('back').bind('resume', ctx => ctx.resume('missing'));"));
  assert.ok(resumeMissing.issues.some(issue => issue.includes('UI 返回目标不存在')));
});

test('页面引用缺失诊断进入剧情工作台但不限制已识别路由，坏 UI 不误报全部目标缺失', () => {
  const sources = input("frame('a').advance(()=> 'b'); frame('b').advance(()=> 'c'); frame('c').end();\nui('missing').bind('screen.open', ctx => {});\nui('show').bind('present', ctx => ctx.present('hud'));", xml.replace('<scripts>', '<interface src="ui.xml"/><scripts>'));
  sources.set('ui.xml', '<ui schema="3"><include src="pages.xml"/></ui>');
  sources.set('pages.xml', '<ui schema="3"><screen id="hud"/></ui>');
  const result = analyze(sources);
  assert.deepEqual(result.screenIssues, ['routes.js:2 生命周期页面不存在：missing']);
  assert.ok(result.issues.includes(result.screenIssues[0]));
  assert.equal(result.complete, true); assert.equal(result.links.length, 3);
  assert.deepEqual([...result.references.screens], ['missing', 'hud']);
  sources.set('pages.xml', '<ui');
  assert.equal(analyze(sources).screenIssues.length, 0);
});

test('部分可编辑工程补幕时清理已知无引用占位，不清理动态脚本可能使用的占位', () => {
  const sources = input("frame('a').advance(ctx => ctx.vars.flag ? 'b' : 'c'); frame('b').advance(()=> 'c'); frame('c').end();"), logic = analyze(sources);
  const pending = reconcilePendingRoutes(sources, logic.routes.map(r => r.frame === 'b' ? { ...r, target: '' } : r), true, protectedLogicTargets(logic));
  const stored = apply(pending.sources, patchLogicRoutes(sources, logic, pending.routes)), ready = analyze(stored);
  const filled = insertConnectedFrame(stored, ready.routes, 'routes.js', 'b', ready);
  assert.equal(readStory(apply(stored, filled.changes)).frames.some(f => f.pending), false);
  const unknown = new Map(stored); unknown.set('routes.js', unknown.get('routes.js')!.replace("ctx.vars.flag ? 'b' : 'c'", 'getTarget()'));
  const dynamic = analyze(unknown), dynamicFill = insertConnectedFrame(unknown, dynamic.routes, 'routes.js', 'b', dynamic);
  assert.equal(readStory(apply(unknown, dynamicFill.changes)).frames.some(f => f.pending), true);
});

test('v0.11.0 字符串目标可以改线，加入更新时只把目标参数转成内联回调', () => {
  const story = xml.replace('<text>开场</text>', '<text>选择</text><options><option id="x">继续</option></options>');
  const sources = input("frame('a').choice('x', 'b', ctx => ctx.vars.flag); frame('b').advance(() => 'c'); frame('c').end();", story), logic = analyze(sources);
  assert.equal(logic.complete, true);
  const route = logic.routes.find(r => r.frame === 'a')!;
  assert.equal(route.target, 'b'); assert.deepEqual(route.guard, { kind: 'variable', id: 'flag' });
  const changed = apply(sources, patchLogicRoutes(sources, logic, logic.routes.map(r => r.frame === 'a' ? { ...r, target: 'c' } : r)));
  assert.ok(changed.get('routes.js')!.includes('choice(\'x\', "c", ctx => ctx.vars.flag)'));
  assert.equal(analyze(changed).complete, true);
  const changedLogic = analyze(changed);
  const richer = apply(changed, patchLogicRoutes(changed, changedLogic, changedLogic.routes.map(r => r.frame === 'a' ? { ...r, updates: [{ op: 'set' as const, variable: 'score', value: { kind: 'constant' as const, type: 'int' as const, value: '1' } }] } : r)));
  const text = richer.get('routes.js')!;
  assert.ok(text.includes('(ctx) => {')); assert.ok(text.includes('ctx.set("score", 1n);')); assert.ok(text.includes('return "c";'));
  const final = analyze(richer); assert.equal(final.complete, true); assert.equal(final.routes.find(r => r.frame === 'a')!.updates.length, 1);
});
