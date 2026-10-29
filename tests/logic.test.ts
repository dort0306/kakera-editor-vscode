import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeLogic, patchLogicRoutes, readStory, insertConnectedFrame, deleteConnectedFrame, reconcilePendingRoutes, protectedLogicTargets, type Sources } from '../packages/source/src/index';
import { buildStoryGraph } from '../packages/domain/src/graph';
import type { Route } from '../packages/domain/src/index';
const xml = `<story schema="8" id="s" content-version="1" entry="a-id"><variables><int id="score" initial="0"/><bool id="flag" initial="false"/></variables><scripts><script src="routes.js"/><script src="ui.js"/></scripts><frames><frame id="a-id" name="a"><text>开场</text></frame><frame id="b-id" name="b"><text>后续</text></frame><frame id="c-id" name="c"><text>结尾</text></frame></frames><next end="true"/></story>`;
const input = (js: string, story = xml, ui = 'on.ui("game.enter", state => { state.setUi("status", "就绪"); }); // 保留 UI\n'): Sources => new Map([['story.xml', story], ['routes.js', js], ['ui.js', ui]]);
const analyze = (sources: Sources) => analyzeLogic(sources, readStory(sources));
const apply = (sources: Sources, changes: Sources) => new Map([...sources, ...changes]);

test('没有生成标记、CRLF、注释、引号、普通函数和简写箭头仍可实时映射与编辑', () => {
  const js = `"use strict";\r\n// 作者备注 🐈\r\non['advance']('a-id', () => 'b-id');\r\non.advance('b', function (state) {\r\n  // 保留更新旁注\r\n  state.add('score', 1);\r\n  return /* 下一幕 */ 'c';\r\n});\r\non.end('c'); // 结尾\r\n`;
  const sources = input(js), result = analyze(sources);
  assert.equal(result.complete, true); assert.equal(result.routes[0].frame, 'a'); assert.equal(result.routes[0].target, 'b');
  assert.equal(result.routes[1].updates[0].value.kind, 'constant'); assert.deepEqual(result.frames.a.locations, [{ file: 'routes.js', line: 3, start: js.indexOf("on['advance']"), end: js.indexOf(';', js.indexOf("on['advance']")) + 1 }]);
  assert.equal(patchLogicRoutes(sources, result, result.routes).size, 0);
  const changes = patchLogicRoutes(sources, result, result.routes.map(r => r.frame === 'a' ? { ...r, target: 'c' } : r));
  assert.equal(changes.get('routes.js'), js.replace("() => 'b-id'", '() => "c"')); assert.equal(changes.has('ui.js'), false);
  assert.equal(analyze(apply(sources, changes)).complete, true);
});

test('跨脚本注册、幕 ID/名称别名和常量目标统一映射，改线仅补丁对应文件', () => {
  const sources = input("const NEXT = 'b-id'; on.advance('a-id', () => NEXT); on.end('c');", xml, "// 另一个文件\non.advance('b-id', state => 'c-id');");
  const result = analyze(sources); assert.equal(result.complete, true);
  const change = patchLogicRoutes(sources, result, result.routes.map(r => r.frame === 'b' ? { ...r, target: 'a' } : r));
  assert.deepEqual([...change.keys()], ['ui.js']); assert.equal(change.get('ui.js'), '// 另一个文件\non.advance(\'b-id\', state => "a");');
});

test('条件与有序更新按节点修改，保留回调样式、注释和其他手写语句', () => {
  const story = xml.replace('<text>开场</text>', '<text>选择</text><options><option id="x">继续</option></options>');
  const js = `const untouched = 'ctx.vars'; // 手写旁注\non.choice('a', 'x', function (s) { s.add(/* 数值 */ 'score', 1); return /* 目标 */ 'b'; }, function(g) { return g.vars.score >= 2n && g.vars['flag']; });\non.advance('b', () => 'c'); on.end('c');`;
  const sources = input(js, story), result = analyze(sources); assert.equal(result.complete, true);
  const routes = result.routes.map(r => r.frame === 'a' ? { ...r, target: 'c', updates: [{ ...r.updates[0], value: { kind: 'constant' as const, type: 'int' as const, value: '9007199254740993' } }], guard: { kind: 'variable' as const, id: 'flag' } } : r);
  const text = patchLogicRoutes(sources, result, routes).get('routes.js')!;
  assert.equal(text, js.replace("'score', 1", "'score', 9007199254740993n").replace("/* 目标 */ 'b'", '/* 目标 */ "c"').replace("g.vars.score >= 2n && g.vars['flag']", 'g.vars["flag"]'));
  assert.equal(analyze(apply(sources, new Map([['routes.js', text]]))).complete, true);
});

test('给零参数回调添加更新会补上下文参数，多个更新保持原顺序', () => {
  for (const cb of ["() => 'b'", "function /* 保留 */ () { return/* 目标 */'b'; }"]) {
    const sources = input(`on.advance('a', ${cb}); on.advance('b', () => 'c'); on.end('c');`), result = analyze(sources);
    const updates: Route['updates'] = [{ op: 'set', variable: 'score', value: { kind: 'constant', type: 'int', value: '1' } }, { op: 'add', variable: 'score', value: { kind: 'constant', type: 'int', value: '2' } }];
    const changed = apply(sources, patchLogicRoutes(sources, result, result.routes.map(r => r.frame === 'a' ? { ...r, updates } : r)));
    assert.equal(analyze(changed).complete, true); assert.deepEqual(analyze(changed).routes[0].updates, updates);
    if (cb.includes('保留')) assert.ok(changed.get('routes.js')!.includes('/* 保留 */'));
  }
});

test('新增和删除幕在 Recognized 源码中保留其他代码、注释、原注册写法', () => {
  const js = `// 故事\non.advance('a', state => { /* 更新注释 */ state.add('score', 1); return 'b'; });\non.advance('b', () => 'c');\non.end('c');\nconst helper = () => '保留';\n`;
  const sources = input(js), logic = analyze(sources);
  const inserted = insertConnectedFrame(sources, logic.routes, 'routes.js', 'a', logic), added = apply(sources, inserted.changes), after = analyze(added);
  assert.equal(after.complete, true); assert.equal(after.routes.find(r => r.frame === inserted.selected)!.target, 'b');
  assert.ok(added.get('routes.js')!.includes("state.add('score', 1)")); assert.ok(added.get('routes.js')!.includes("const helper = () => '保留';"));
  const removed = deleteConnectedFrame(added, after.routes, 'routes.js', inserted.selected, after), final = analyze(apply(added, removed.changes));
  assert.equal(final.complete, true); assert.equal(final.routes.find(r => r.frame === 'a')!.target, 'b');
});

test('零参数 guard 编辑后绑定上下文，更新新增参数不会遮蔽旧常量目标', () => {
  const story = xml.replace('<text>开场</text>', '<text>选择</text><options><option id="x">继续</option></options>');
  const sources = input("const ctx = 'b'; on.choice('a','x', () => { return ctx; }, () => true); on.advance('b',()=> 'c'); on.end('c');", story), logic = analyze(sources);
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
  const sources = input("on.advance('a', ctx => checkFlag(ctx.vars.flag) ? 'b' : 'c'); on.advance('b', () => 'c'); on.end('c');"), result = analyze(sources);
  assert.equal(result.frames.a.editable, false); assert.equal(result.frames.b.editable, true); assert.equal(result.complete, false);
  assert.deepEqual(result.links.filter(r => r.frame === 'a').map(r => r.target).sort(), ['b', 'c']);
  assert.ok(result.links.filter(r => r.frame === 'a').every(r => r.conditional));
  const graph = buildStoryGraph(readStory(sources), result.links); assert.equal(graph.edges.filter(e => e.source === 'a').length, 2);
  const inserted = insertConnectedFrame(sources, result.routes, 'routes.js', 'b', result); assert.equal(analyze(apply(sources, inserted.changes)).frames.b.editable, true);
  assert.ok(apply(sources, inserted.changes).get('routes.js')!.includes("checkFlag(ctx.vars.flag) ? 'b' : 'c'"));
  assert.throws(() => deleteConnectedFrame(sources, result.routes, 'routes.js', 'b', result), /动态路线/);
});

test('共享函数只读追踪 return，任意调用不执行，未知目标保留明确未知节点', () => {
  const js = "function route(ctx) { if(ctx.vars.flag) return 'b'; return computeTarget(); } on.advance('a', route); on.advance('b',()=> 'c'); on.end('c');";
  const sources = input(js), result = analyze(sources);
  assert.equal(result.frames.a.editable, false); assert.equal(result.frames.b.editable, true);
  assert.ok(result.links.some(r => r.frame === 'a' && r.target === 'b')); assert.ok(result.links.some(r => r.frame === 'a' && r.dynamic));
});

test('重复注册、XML/选项不一致、坏目标、动态注册和注册对象别名不自动接管', () => {
  const suffix = "on.advance('b',()=> 'c'); on.end('c');";
  for (const [js, global] of [["on.advance('a',()=> 'b'); on.end('a');", false], ["on.choice('a','missing',()=> 'b');", false], ["on.advance('a',()=> 'missing');", false], ["const reg = on; reg.end('a');", true], ["for (const f of getFrames()) on.advance(f,()=> 'b');", true], ["on.advance = custom; on.advance('a',()=> 'b');", true]] as const) {
    const result = analyze(input(js + suffix)); assert.equal(result.frames.a.editable, false, js); assert.equal(result.frames.b.editable, !global, js);
  }
});

test('源脚本语法暂时不完整会给出诊断，修复后重新映射，绝不沿用旧范围', () => {
  const original = input("on.advance('a',()=> 'b'); on.advance('b',()=> 'c'); on.end('c');"), first = analyze(original); assert.equal(first.complete, true);
  const broken = new Map(original); broken.set('routes.js', "on.advance('a', () => {"); const bad = analyze(broken); assert.equal(bad.complete, false); assert.ok(bad.issues[0].includes('routes.js')); assert.equal(bad.routes.length, 0);
  assert.equal(analyze(original).complete, true);
});

test('上下文参数和局部声明遮蔽常量时不猜测目标；间接动态注册保持只读', () => {
  for (const cb of ['NEXT => NEXT', "ctx => { const NEXT = ctx.vars.flag; return NEXT; }"]) {
    const result = analyze(input(`const NEXT = 'b'; on.advance('a', ${cb}); on.advance('b',()=> 'c'); on.end('c');`));
    assert.equal(result.frames.a.editable, false); assert.equal(result.links.some(r => r.frame === 'a' && r.target === 'b'), false); assert.ok(result.links.some(r => r.frame === 'a' && r.dynamic));
  }
  for (const js of ["globalThis['on'].end('a');", "new Function('on.end(\"a\")')();"]) assert.equal(analyze(input(js + "on.advance('b',()=> 'c'); on.end('c');")).frames.b.editable, false);
});

test('不把严格比较中的 Number 误识别为 BigInt，不对不安全整数做近似映射', () => {
  const story = xml.replace('<text>开场</text>', '<text>选择</text><options><option id="x">继续</option></options>');
  for (const expr of ['ctx.vars.score === 2', 'ctx.vars.score !== 2', 'ctx.vars.score > 9007199254740993']) assert.equal(analyze(input(`on.choice('a','x',()=> 'b',ctx => ${expr}); on.advance('b',()=> 'c'); on.end('c');`, story)).frames.a.editable, false);
  assert.equal(analyze(input("on.choice('a','x',()=> 'b',ctx => ctx.vars.score > 2); on.advance('b',()=> 'c'); on.end('c');", story)).complete, true);
});

test('待连接选项补幕后仍能持续识别，不依赖生成器逐字匹配', () => {
  const story = xml.replace('<text>开场</text>', '<text>选择</text><options><option id="x">继续</option></options>');
  const sources = input("on.choice('a','x', () => 'b'); on.advance('b',()=> 'c'); on.end('c');", story), logic = analyze(sources);
  const pending = reconcilePendingRoutes(sources, logic.routes.map(r => r.frame === 'a' ? { ...r, target: '' } : r));
  const stored = apply(pending.sources, patchLogicRoutes(sources, logic, pending.routes)), ready = analyze(stored); assert.equal(ready.complete, true);
  const filled = insertConnectedFrame(stored, ready.routes, 'routes.js', 'a', ready), complete = apply(stored, filled.changes);
  assert.equal(analyze(complete).complete, true); assert.equal(readStory(complete).frames.some(f => f.pending), false);
});

test('v0.9.0 生命周期注册不当作剧情路由，仍保留幕引用与删除保护', () => {
  const sources = input("on.advance('a',()=> 'b'); on.advance('b',()=> 'c'); on.end('c');\non.frameEnter('a-id', ctx => {}); on.frameExit('b', state => state.open('hud'));\non.screenOpen('hud', ctx => {});\non.screenClose('hud', ctx => ctx.resume('c-id'));\non.ui('handoff', ctx => ctx.present('hud'));");
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
  const unknown = analyze(input("on.advance('a',()=> 'b'); on.advance('b',()=> 'c'); on.end('c');\non.frameExit('missing', ctx => {});"));
  assert.equal(unknown.complete, true); assert.ok(unknown.issues.some(issue => issue.includes('生命周期幕不存在')));
  const dynamic = analyze(input("on.advance('a',()=> 'b'); on.advance('b',()=> 'c'); on.end('c');\non.frameExit(target(), ctx => {});"));
  assert.equal(dynamic.complete, true); assert.equal(dynamic.references.dynamicFrames, true); assert.ok(dynamic.issues.some(issue => issue.includes('生命周期目标不确定')));
  assert.throws(() => deleteConnectedFrame(sources, dynamic.routes, 'routes.js', 'b', dynamic), /动态/);
  const dynamicResume = analyze(input("on.advance('a',()=> 'b'); on.advance('b',()=> 'c'); on.end('c');\non.ui('back', ctx => ctx.resume(ctx.value));"));
  assert.equal(dynamicResume.references.dynamicFrames, true); assert.ok(dynamicResume.issues.some(issue => issue.includes('UI 返回目标不确定')));
  const pendingResume = analyze(input("on.advance('a',()=> 'b'); on.advance('b',()=> 'c'); on.end('c');\non.ui('back', ctx => ctx.resume());"));
  assert.equal(pendingResume.references.dynamicFrames, false);
  const resumeMissing = analyze(input("on.advance('a',()=> 'b'); on.advance('b',()=> 'c'); on.end('c');\non.ui('back', ctx => ctx.resume('missing'));"));
  assert.ok(resumeMissing.issues.some(issue => issue.includes('UI 返回目标不存在')));
});

test('页面引用缺失诊断进入剧情工作台但不限制已识别路由，坏 UI 不误报全部目标缺失', () => {
  const sources = input("on.advance('a',()=> 'b'); on.advance('b',()=> 'c'); on.end('c');\non.screenOpen('missing', ctx => {});\non.ui('show', ctx => ctx.present('hud'));", xml.replace('<scripts>', '<interface src="ui.xml"/><scripts>'));
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
  const sources = input("on.advance('a', ctx => ctx.vars.flag ? 'b' : 'c'); on.advance('b',()=> 'c'); on.end('c');"), logic = analyze(sources);
  const pending = reconcilePendingRoutes(sources, logic.routes.map(r => r.frame === 'b' ? { ...r, target: '' } : r), true, protectedLogicTargets(logic));
  const stored = apply(pending.sources, patchLogicRoutes(sources, logic, pending.routes)), ready = analyze(stored);
  const filled = insertConnectedFrame(stored, ready.routes, 'routes.js', 'b', ready);
  assert.equal(readStory(apply(stored, filled.changes)).frames.some(f => f.pending), false);
  const unknown = new Map(stored); unknown.set('routes.js', unknown.get('routes.js')!.replace("ctx.vars.flag ? 'b' : 'c'", 'getTarget()'));
  const dynamic = analyze(unknown), dynamicFill = insertConnectedFrame(unknown, dynamic.routes, 'routes.js', 'b', dynamic);
  assert.equal(readStory(apply(unknown, dynamicFill.changes)).frames.some(f => f.pending), true);
});
