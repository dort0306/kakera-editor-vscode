import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRoutes, type Expr, type Route } from '../packages/domain/src/index';
import { buildStoryGraph } from '../packages/domain/src/graph';
import { analyzeLogic, patchLogicRoutes, emitRoutes, readManagedRoutes, readStory, reconcilePendingRoutes, insertConnectedFrame, deleteConnectedFrame, type Sources } from '../packages/source/src/index';
import { reconnectFrame } from '../packages/source/src/editing';
import { renderGraphExport } from '../packages/source/src/graph-export';

const xml = '<story schema="8" id="s" content-version="1" entry="a"><scripts><script src="routes.js"/></scripts><variables><bool id="flag" initial="false"/><int id="score" initial="0"/></variables><frames><frame id="a"><text>判断</text></frame><frame id="b"><text>真</text></frame><frame id="c"><text>范围内</text></frame><frame id="d"><text>默认</text></frame></frames><next end="true"/></story>';
const bool: Expr = { kind: 'compare', op: '===', left: { kind: 'variable', id: 'flag' }, right: { kind: 'constant', type: 'bool', value: 'true' } };
const compare = (op: '<=' | '>=', value: string): Expr => ({ kind: 'compare', op, left: { kind: 'variable', id: 'score' }, right: { kind: 'constant', type: 'int', value } });
const range: Expr = { kind: 'and', left: compare('>=', '9007199254740993'), right: compare('<=', '9223372036854775807') };
const routes: Route[] = [{ frame: 'a', kind: 'advance', target: 'd', updates: [], branches: [{ when: bool, target: 'b' }, { when: range, target: 'c' }] }, ...['b', 'c', 'd'].map(frame => ({ frame, kind: 'end' as const, updates: [] }))];
const input = (js = emitRoutes(routes)): Sources => new Map([['story.xml', xml], ['routes.js', js], ['other.js', '// untouched 🐈\r\n']]);
const analyze = (s: Sources) => analyzeLogic(s, readStory(s));
const merge = (s: Sources, changes: Sources) => new Map([...s, ...changes]);

test('有序布尔/整数范围分流生成合法 BigInt，默认目标完整，Managed 与实时映射往返', () => {
  const sources = input(), story = readStory(sources), js = sources.get('routes.js')!;
  validateRoutes(story, routes);
  assert.ok(js.includes('9007199254740993n')); assert.ok(js.includes('9223372036854775807n'));
  assert.deepEqual(readManagedRoutes(js), routes);
  const logic = analyze(sources); assert.equal(logic.complete, true); assert.deepEqual(logic.routes, routes);
  assert.equal(patchLogicRoutes(sources, logic, logic.routes).size, 0);
  const guards = [undefined, { kind: 'constant' as const, type: 'bool' as const, value: 'true' }];
  for (const guard of guards) {
    const choiceXml = xml.replace('<text>判断</text>', '<text>判断</text><options><option id="x">继续</option></options>');
    const choiceRoutes = routes.map(r => r.frame === 'a' ? { ...r, kind: 'choice' as const, option: 'x', ...(guard ? { guard } : {}) } : r);
    const choiceSources = new Map([['story.xml', choiceXml], ['routes.js', emitRoutes(choiceRoutes)]]);
    assert.equal(analyze(choiceSources).complete, true); assert.deepEqual(readManagedRoutes(choiceSources.get('routes.js')!), choiceRoutes);
  }
});

test('缺默认目标、错类型、越界整数、无条件或过多分支均拒绝', () => {
  const story = readStory(input());
  for (const invalid of [
    { ...routes[0], target: '' },
    { ...routes[0], branches: [{ when: { kind: 'variable', id: 'score' }, target: 'b' }] },
    { ...routes[0], branches: [{ when: compare('>=', '9223372036854775808'), target: 'b' }] },
    { ...routes[0], branches: [{ when: { ...bool, right: { kind: 'constant', type: 'int', value: '1' } }, target: 'b' }] },
    { ...routes[0], branches: [{ target: 'b' }] },
    { ...routes[0], branches: Array.from({ length: 33 }, () => ({ when: bool, target: 'b' })) }
  ]) assert.throws(() => validateRoutes(story, [invalid as Route, ...routes.slice(1)]));
});

test('Recognized if/else-if/三元式可编辑，分支内自定义副作用和不完整返回保留 Opaque', () => {
  const endings = 'on.end("b");on.end("c");on.end("d");';
  for (const callback of [
    `s => s.vars.flag ? 'b' : s.vars.score >= 5n ? 'c' : 'd'`,
    `function(s) { if(s.vars.flag) { return 'b'; } else if(s.vars.score >= 5n) return 'c'; else { return 'd'; } }`,
    `s => { if(s.vars.flag) return 'b'; if(s.vars.score >= 5n) return 'c'; return 'd'; }`
  ]) {
    const sources = input(`// before\non.advance('a', ${callback}); // after\n${endings}`), logic = analyze(sources);
    assert.equal(logic.complete, true, callback); assert.equal(logic.routes[0].branches!.length, 2);
    const updated = logic.routes.map(r => r.frame === 'a' ? { ...r, branches: r.branches!.map((b, i) => i === 1 ? { ...b, target: 'b' } : b) } : r);
    const changed = merge(sources, patchLogicRoutes(sources, logic, updated));
    assert.equal(analyze(changed).routes[0].branches![1].target, 'b');
    assert.ok(changed.get('routes.js')!.startsWith('// before\n')); assert.ok(changed.get('routes.js')!.includes('// after')); assert.equal(changed.get('other.js'), sources.get('other.js'));
  }
  for (const callback of [
    `s => { if(s.vars.flag) { s.add('score', 1n); return 'b'; } return 'd'; }`,
    `s => { if(s.vars.flag) return 'b'; }`,
    `s => s.vars.flag ? compute() : 'd'`,
    `s => { if (check(s)) return 'b'; return 'd'; }`
  ]) assert.equal(analyze(input(`on.advance('a', ${callback}); ${endings}`)).frames.a.editable, false, callback);
});

test('条件数量/更新变化保留作者注释，单条件编辑只改对应 AST 范围，零参数回调只绑定一次', () => {
  const sources = input(`// begin\non.advance('a', function (state) { /* 台词旁注 */ if (/* 判断 */ state.vars.flag) return /* 真目标 */ 'b'; return /* 默认 */ 'd'; }); // end\non.end('b');on.end('c');on.end('d');`), logic = analyze(sources);
  const changed = merge(sources, patchLogicRoutes(sources, logic, logic.routes.map(r => r.frame === 'a' ? { ...r, branches: [{ ...r.branches![0], target: 'c' }] } : r)));
  assert.equal(changed.get('routes.js'), sources.get('routes.js')!.replace("/* 真目标 */ 'b'", '/* 真目标 */ "c"'));
  const structured = merge(sources, patchLogicRoutes(sources, logic, logic.routes.map(r => r.frame === 'a' ? { ...r, branches: routes[0].branches, updates: [{ op: 'add', variable: 'score', value: { kind: 'constant', type: 'int', value: '1' } }] } : r)));
  assert.equal(analyze(structured).complete, true);
  for (const comment of ['/* 台词旁注 */', '/* 判断 */', '/* 真目标 */', '/* 默认 */', '// begin', '// end']) assert.ok(structured.get('routes.js')!.includes(comment));
  assert.ok(structured.get('routes.js')!.indexOf('state.add') < structured.get('routes.js')!.indexOf('if (('));
  const zero = input(`on.advance('a', () => true ? 'b' : false ? 'c' : 'd'); on.end('b');on.end('c');on.end('d');`), z = analyze(zero);
  const bound = merge(zero, patchLogicRoutes(zero, z, z.routes.map(r => r.frame === 'a' ? { ...r, branches: routes[0].branches } : r)));
  assert.equal(analyze(bound).complete, true); assert.equal(bound.get('routes.js')!.match(/_kakeraCtx\) =>/g)?.length, 1);
});

test('拖线/断线只修改选中条件；占位被保留、按序填充和清理；已满条件不覆盖', () => {
  let sources = input(), logic = analyze(sources);
  sources = merge(sources, reconnectFrame(sources, logic, 'a', '', undefined, 1)); logic = analyze(sources);
  const pending = readStory(sources).frames.find(f => f.pending)!;
  assert.ok(pending); assert.equal(logic.routes[0].branches![0].target, 'b'); assert.equal(logic.routes[0].target, 'd');
  assert.equal(logic.routes[0].branches![1].target, pending.ref);
  const fill = insertConnectedFrame(sources, logic.routes, 'routes.js', 'a', logic); sources = merge(sources, fill.changes); logic = analyze(sources);
  assert.equal(logic.routes.find(r => r.frame === 'a')!.branches![1].target, fill.selected); assert.equal(readStory(sources).frames.some(f => f.pending), false);
  assert.throws(() => insertConnectedFrame(sources, logic.routes, 'routes.js', 'a', logic), /所有条件线路/);
  assert.throws(() => reconnectFrame(sources, logic, 'a', 'b', undefined, 8), /条件连接点/);
  const disconnected = merge(sources, reconnectFrame(sources, logic, 'a', '', undefined, 0)), d = analyze(disconnected);
  const removedBranch = d.routes.map(r => r.frame === 'a' ? { ...r, branches: r.branches!.slice(1) } : r);
  const normalized = reconcilePendingRoutes(disconnected, removedBranch);
  assert.equal(readStory(normalized.sources).frames.some(f => f.pending), false);
});

test('删除条件目标保留其他分支；删除分流幕不会替作者选择默认分支', () => {
  const sources = input(), logic = analyze(sources);
  const result = deleteConnectedFrame(sources, logic.routes, 'routes.js', 'b', logic), changed = merge(sources, result.changes), next = analyze(changed);
  assert.equal(next.complete, true); assert.equal(next.routes.find(r => r.frame === 'a')!.branches![1].target, 'c'); assert.equal(next.routes.find(r => r.frame === 'a')!.target, 'd');
  assert.equal(readStory(changed).frames.find(f => f.ref === next.routes.find(r => r.frame === 'a')!.branches![0].target)!.pending, true);
  const loop = input(emitRoutes([...routes.filter(r => r.frame !== 'b'), { frame: 'b', kind: 'advance', target: 'a', updates: [] }])), l = analyze(loop);
  const deleted = deleteConnectedFrame(loop, l.routes, 'routes.js', 'a', l), after = merge(loop, deleted.changes), a = analyze(after);
  assert.equal(readStory(after).frames.find(f => f.ref === a.routes.find(r => r.frame === 'b')!.target)!.pending, true);
});

test('流程图/导出完整显示条件分色、默认线路和大整数，不标为未知候选', () => {
  const story = readStory(input()), graph = buildStoryGraph(story, routes), edges = graph.edges.filter(e => e.source === 'a');
  assert.equal(edges.length, 3); assert.equal(new Set(edges.map(e => e.color)).size, 3); assert.deepEqual(edges.map(e => e.branch), [0, 1, undefined]);
  assert.ok(edges.every(e => !e.uncertain && !e.conditional)); assert.ok(edges[2].label.includes('默认'));
  const html = renderGraphExport(story, routes, { title: '条件图' }, 'html');
  assert.ok(html.includes('9007199254740993')); assert.ok(html.includes('9223372036854775807')); assert.ok(html.includes('否则（默认）')); assert.ok(html.includes('按顺序首个满足')); assert.ok(!html.includes('（候选目标）'));
});
