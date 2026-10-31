import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Route } from '../packages/domain/src/index';
import { validateRoutes } from '../packages/domain/src/index';
import { readStory, readManagedRoutes, emitRoutes, reconcilePendingRoutes, insertConnectedFrame, deleteConnectedFrame, deleteConnectedFrames, duplicateConnectedFrames, renameFrame, setFrameVisual, setStoryEntries, editStoryVariable, deleteStoryVariable, addStoryVariable, deleteCharacter, type Sources } from '../packages/source/src/index';
import { analyzeLogic } from '../packages/source/src/logic';
const managed = 'routes.js';
const xml = `<story schema="8" id="s" content-version="1" entry="a"><scripts><script src="routes.js"/></scripts><frames><!-- 留下备注 --><frame id="a"><text>开场</text></frame><frame id="b"><text>中间</text></frame><frame id="c"><text>结尾</text></frame></frames><next end="true"/></story>`;
const baseRoutes: Route[] = [{ frame: 'a', kind: 'advance', target: 'b', updates: [] }, { frame: 'b', kind: 'advance', target: 'c', updates: [] }, { frame: 'c', kind: 'end', updates: [] }];
const source = (text = xml, routes = baseRoutes): Sources => new Map([['story.xml', text], [managed, emitRoutes(routes)], ['ui.js', '// 手写 UI 不应改变\n']]);
function merged(input: Sources, changes: Sources) { const next = new Map([...input, ...changes]); const routes = readManagedRoutes(next.get(managed)!)!; validateRoutes(readStory(next), routes); return { sources: next, story: readStory(next), routes }; }
test('新幕插入已选推进幕之后，保留原后续与稳定 ID', () => {
  const input = source(), added = insertConnectedFrame(input, baseRoutes, managed, 'a'), next = merged(input, added.changes);
  assert.match(added.selected, /^[0-9a-f]{16}$/);
  assert.equal(next.routes.find(r => r.frame === 'a')!.target, added.selected); assert.equal(next.routes.find(r => r.frame === added.selected)!.target, 'b');
  assert.deepEqual(next.story.frames.filter(f => f.id !== added.selected).map(f => f.id), ['a', 'b', 'c']); assert.ok(next.sources.get('story.xml')!.includes('<!-- 留下备注 -->')); assert.equal(next.sources.get('ui.js'), input.get('ui.js'));
});
test('结束幕后自动续写，原结束幕改为推进，新幕成为结束', () => {
  const input = source(), added = insertConnectedFrame(input, baseRoutes, managed, 'c'), next = merged(input, added.changes);
  assert.equal(next.routes.find(r => r.frame === 'c')!.target, added.selected); assert.equal(next.routes.find(r => r.frame === added.selected)!.kind, 'end');
});
test('未连接选项保存为明确标记的合法 End；再次读取不重复生成 ID', () => {
  const input = source(xml.replace('<text>开场</text>', '<text>选择</text><options><option id="one">第一项</option><option id="two">第二项</option></options>'));
  const proposed: Route[] = [{ frame: 'a', kind: 'choice', option: 'two', target: '', updates: [] }, { frame: 'a', kind: 'choice', option: 'one', target: '', updates: [] }, ...baseRoutes.slice(1)];
  const ready = reconcilePendingRoutes(input, proposed); assert.equal(readStory(ready.sources).frames.filter(f => f.pending).length, 2);
  const again = reconcilePendingRoutes(ready.sources, ready.routes); assert.equal(again.sources.get('story.xml'), ready.sources.get('story.xml'));
  const saved = new Map(ready.sources); saved.set(managed, emitRoutes(ready.routes));
  const first = insertConnectedFrame(saved, ready.routes, managed, 'a'), firstResult = merged(saved, first.changes);
  assert.equal(firstResult.routes.find(r => r.frame === 'a' && r.option === 'one')!.target, first.selected);
  assert.equal(firstResult.story.frames.filter(f => f.pending).length, 1);
  const second = insertConnectedFrame(firstResult.sources, firstResult.routes, managed, 'a'), secondResult = merged(firstResult.sources, second.changes);
  assert.equal(secondResult.routes.find(r => r.frame === 'a' && r.option === 'two')!.target, second.selected); assert.equal(secondResult.story.frames.some(f => f.pending), false);
  assert.throws(() => insertConnectedFrame(secondResult.sources, secondResult.routes, managed, 'a'), /所有选项/);
});
test('删除中间幕直接重连后续；其他幕和代码保持不变', () => {
  const input = source(), removed = deleteConnectedFrame(input, baseRoutes, managed, 'b'), next = merged(input, removed.changes);
  assert.deepEqual(next.story.frames.map(f => f.ref), ['a', 'c']); assert.equal(next.routes.find(r => r.frame === 'a')!.target, 'c'); assert.equal(next.sources.get('ui.js'), input.get('ui.js'));
});
test('删除选项目标后保留选项和更新，生成待连接节点，新增幕可按顺序补齐', () => {
  const text = xml.replace('<text>开场</text>', '<text>选择</text><options><option id="one">第一项</option><option id="two">第二项</option></options>');
  const routes: Route[] = [{ frame: 'a', kind: 'choice', option: 'one', target: 'c', updates: [] }, { frame: 'a', kind: 'choice', option: 'two', target: 'c', updates: [] }, ...baseRoutes.slice(1)];
  const input = source(text, routes), removed = deleteConnectedFrame(input, routes, managed, 'c'), next = merged(input, removed.changes);
  assert.equal(next.story.frames.filter(f => f.pending).length, 3); // b's advance is also pending.
  assert.deepEqual(next.story.frames.find(f => f.ref === 'a')!.options.map(o => o.id), ['one', 'two']);
  const added = insertConnectedFrame(next.sources, next.routes, managed, 'a'), filled = merged(next.sources, added.changes);
  assert.equal(filled.routes.find(r => r.frame === 'a' && r.option === 'one')!.target, added.selected);
  assert.equal(filled.story.frames.filter(f => f.pending).length, 2);
});
test('删除分支幕不猜选项；删除入口调整为剩余实际幕，最后一幕不可删除', () => {
  const text = xml.replace('<text>中间</text>', '<text>选择</text><options><option id="x">路线一</option><option id="y">路线二</option></options>');
  const routes: Route[] = [baseRoutes[0], { frame: 'b', kind: 'choice', option: 'x', target: 'c', updates: [] }, { frame: 'b', kind: 'choice', option: 'y', target: 'a', updates: [] }, baseRoutes[2]];
  const input = source(text, routes), removed = deleteConnectedFrame(input, routes, managed, 'b'), next = merged(input, removed.changes);
  assert.ok(next.story.frames.find(f => f.ref === next.routes.find(r => r.frame === 'a')!.target)?.pending); assert.ok(next.story.frames.some(f => f.ref === 'c'));
  const entryDeleted = merged(source(), deleteConnectedFrame(source(), baseRoutes, managed, 'a').changes); assert.equal(entryDeleted.story.entry, 'b');
  const one = source(xml.replace(/<frame id="[bc]">[\s\S]*?<\/frame>/g, ''), [{ frame: 'a', kind: 'end', updates: [] }]);
  assert.throws(() => deleteConnectedFrame(one, [{ frame: 'a', kind: 'end', updates: [] }], managed, 'a'), /至少/);
});
test('自循环插入保持循环且只生成一个新幕，删除后还原原循环', () => {
  const routes: Route[] = [{ frame: 'a', kind: 'advance', target: 'a', updates: [] }, ...baseRoutes.slice(1)];
  const input = source(xml, routes), added = insertConnectedFrame(input, routes, managed, 'a'), next = merged(input, added.changes);
  assert.equal(next.routes.find(r => r.frame === added.selected)!.target, 'a');
  const back = merged(next.sources, deleteConnectedFrame(next.sources, next.routes, managed, added.selected).changes); assert.equal(back.routes.find(r => r.frame === 'a')!.target, 'a');
});
test('批量删除按选中链的明确出口重连，不猜测分支；入口与至少一幕受保护', () => {
  const four = `<story schema="8" id="s" content-version="1" entry="a"><scripts><script src="routes.js"/></scripts><frames><frame id="a"><text>A</text></frame><frame id="b"><text>B</text></frame><frame id="c"><text>C</text></frame><frame id="d"><text>D</text></frame></frames><next end="true"/></story>`;
  const routes: Route[] = [{ frame: 'a', kind: 'advance', target: 'b', updates: [] }, { frame: 'b', kind: 'advance', target: 'c', updates: [] }, { frame: 'c', kind: 'advance', target: 'd', updates: [] }, { frame: 'd', kind: 'end', updates: [] }];
  const input = source(four, routes), removed = deleteConnectedFrames(input, routes, managed, ['b', 'c']), next = merged(input, removed.changes);
  assert.deepEqual(next.story.frames.map(f => f.ref), ['a', 'd']); assert.equal(next.routes.find(r => r.frame === 'a')!.target, 'd'); assert.equal(removed.selected, 'd');
  const entry = merged(source(four, routes), deleteConnectedFrames(source(four, routes), routes, managed, ['a', 'b']).changes);
  assert.deepEqual(entry.story.frames.map(f => f.ref), ['c', 'd']); assert.equal(entry.story.entry, 'c');
  assert.throws(() => deleteConnectedFrames(input, routes, managed, ['a', 'b', 'c', 'd']), /至少/);
  assert.throws(() => deleteConnectedFrames(input, routes, managed, ['a', 'a']), /重复/);
  const choice = `<story schema="8" id="s" content-version="1" entry="a"><scripts><script src="routes.js"/></scripts><frames><frame id="a"><text>A</text></frame><frame id="b"><text>B</text></frame><frame id="c"><text>C</text></frame></frames><next end="true"/></story>`;
  const split: Route[] = [{ frame: 'a', kind: 'choice', option: 'x', target: 'b', updates: [] }, { frame: 'a', kind: 'choice', option: 'y', target: 'c', updates: [] }, { frame: 'b', kind: 'end', updates: [] }, { frame: 'c', kind: 'end', updates: [] }];
  const branched = merged(source(choice.replace('<text>A</text>', '<text>A</text><options><option id="x">X</option><option id="y">Y</option></options>'), split), deleteConnectedFrames(source(choice.replace('<text>A</text>', '<text>A</text><options><option id="x">X</option><option id="y">Y</option></options>'), split), split, managed, ['b']).changes);
  const xRoute = branched.routes.find(r => r.frame === 'a' && r.option === 'x')!;
  assert.ok(branched.story.frames.find(frame => frame.ref === xRoute.target)?.pending);
  assert.equal(branched.routes.find(r => r.frame === 'a' && r.option === 'y')!.target, 'c');
});
test('批量复制生成短 ID，内部目标重映射，外部目标和其他源码保留', () => {
  const input = source(), copied = duplicateConnectedFrames(input, baseRoutes, managed, ['a', 'b']), next = merged(input, copied.changes);
  assert.match(copied.selected, /^[0-9a-f]{16}$/);
  const copyA = copied.selected, copyB = next.story.frames.find(frame => !['a', 'b', 'c'].includes(frame.ref) && frame.ref !== copyA)!.ref;
  assert.match(copyB, /^[0-9a-f]{16}$/);
  assert.equal(next.routes.find(route => route.frame === copyA)!.target, copyB);
  assert.equal(next.routes.find(route => route.frame === copyB)!.target, 'c');
  assert.equal(next.routes.find(route => route.frame === 'a')!.target, 'b');
  assert.ok(next.sources.get('story.xml')!.includes('<!-- 留下备注 -->')); assert.equal(next.sources.get('ui.js'), input.get('ui.js'));
  const pasted = duplicateConnectedFrames(input, baseRoutes, managed, ['a'], undefined, 'c'), pastedNext = merged(input, pasted.changes);
  assert.deepEqual(pastedNext.story.frames.map(frame => frame.ref).slice(0, 4), ['a', 'b', 'c', pasted.selected]);
  assert.equal(pastedNext.routes.find(route => route.frame === pasted.selected)!.target, 'b');
  assert.throws(() => duplicateConnectedFrames(input, baseRoutes, managed, ['a', 'a']), /重复/);
});
test('CG 专用资源可创建无人物的完整画面，拒绝与背景/立绘混用', () => {
  const cgXml = xml.replace('<frames>', '<assets><cg id="cg.test" src="assets/cg/test.png"/></assets><visuals><visual id="cg.visual" cg="cg.test"/></visuals><frames>');
  const input = source(cgXml), next = new Map([...input, ...setFrameVisual(input, 'a', '', [], 'cg.test')]), story = readStory(next), frame = story.frames.find(f => f.ref === 'a')!;
  const visual = story.visuals.find(v => v.id === frame.visual)!;
  assert.match(visual.id, /^[0-9a-f]{16}$/); assert.equal(visual.cg, 'cg.test'); assert.equal(visual.background, ''); assert.deepEqual(visual.portraits, []);
  const reverted = new Map([...next, ...setFrameVisual(next, 'a', '', [], '')]), revertedStory = readStory(reverted), revertedFrame = revertedStory.frames.find(f => f.ref === 'a')!;
  assert.equal(revertedStory.visuals.find(v => v.id === revertedFrame.visual)!.cg, undefined);
  assert.throws(() => setFrameVisual(input, 'a', 'bg.room', [], 'cg.test'), /不能同时/);
});

test('多起始幕解析、列表编辑、删除和重命名保持其他起点', () => {
  const multi = xml.replace('entry="a"', 'entry="a b"'), input = source(multi), story = readStory(input);
  assert.deepEqual(story.entries, ['a', 'b']); assert.equal(story.entry, 'a');
  const edited = new Map([...input, ...setStoryEntries(input, ['b', 'c'])]), editedStory = readStory(edited);
  assert.deepEqual(editedStory.entries, ['b', 'c']); assert.equal(editedStory.entry, 'b');
  assert.throws(() => readStory(source(xml.replace('entry="a"', 'entry="a a"'))), /重复/);
  assert.throws(() => readStory(source(xml.replace('entry="a"', 'entry="missing"'))), /不存在/);
  const deleted = merged(input, deleteConnectedFrame(input, baseRoutes, managed, 'a').changes);
  assert.deepEqual(deleted.story.entries, ['b']); assert.equal(deleted.story.entry, 'b');
  const logic = analyzeLogic(input, story);
  const renamed = merged(input, renameFrame(input, logic, 'b', 'second').changes);
  assert.deepEqual(renamed.story.entries, ['a', 'second']);
});

test('人物可删除，仍被立绘引用时拒绝', () => {
  const characterXml = xml.replace('<frames>', '<characters><character id="lin" name="凛"/></characters><frames>'), input = source(characterXml);
  assert.equal(readStory(new Map([...input, ...deleteCharacter(input, 'lin')])).characters.length, 0);
  const referenced = characterXml.replace('<frames>', '<visuals><visual id="look"><portrait character="lin" image="pic" slot="center"/></visual></visuals><frames>');
  assert.throws(() => deleteCharacter(source(referenced), 'lin'), /立绘/);
});

test('变量可修改初始值/i64 范围并删除，越界和类型错误拒绝', () => {
  const variableXml = xml.replace('<frames>', '<variables><int id="score" initial="0" min="0" max="10"/><bool id="flag" initial="false"/></variables><frames>'), input = source(variableXml);
  const edited = merged(input, editStoryVariable(input, 'score', '5', '1', '9')), story = edited.story;
  assert.equal(story.variables.find(v => v.id === 'score')!.initial, '5');
  assert.equal(story.variables.find(v => v.id === 'score')!.min, '1');
  assert.throws(() => editStoryVariable(input, 'score', '11'), /超出范围/);
  assert.throws(() => editStoryVariable(input, 'flag', 'yes'), /布尔/);
  const added = merged(input, addStoryVariable(input, 'bonus', 'int', '3', '1', '5'));
  assert.equal(added.story.variables.find(v => v.id === 'bonus')!.initial, '3');
  const deleted = merged(input, deleteStoryVariable(input, 'flag'));
  assert.equal(deleted.story.variables.some(v => v.id === 'flag'), false);
});

test('幕 ID 重命名同步入口、注册与静态目标，名称/ID 对齐，生命周期引用拒绝', () => {
  const routes: Route[] = [{ frame: 'a', kind: 'advance', target: 'b', updates: [] }, { frame: 'b', kind: 'advance', target: 'a', updates: [] }, baseRoutes[2]];
  const input = source(xml, routes), logic = analyzeLogic(input, readStory(input)), renamed = renameFrame(input, logic, 'a', 'start'), next = merged(input, renamed.changes);
  assert.equal(next.story.entry, 'start'); assert.deepEqual(next.story.frames.map(f => f.ref), ['start', 'b', 'c']);
  assert.equal(next.routes.find(r => r.frame === 'start')!.target, 'b'); assert.equal(next.routes.find(r => r.frame === 'b')!.target, 'start');
  assert.ok(next.sources.get(managed)!.includes('frame("start")'));
  assert.throws(() => renameFrame(input, logic, 'a', 'b'), /已存在/);
  assert.throws(() => renameFrame(input, logic, 'a', 'bad/id'), /只能包含/);
  const named = source(xml.replace('<frame id="a">', '<frame id="a-old" name="a">'), routes), namedLogic = analyzeLogic(named, readStory(named));
  const namedNext = merged(named, renameFrame(named, namedLogic, 'a', 'start').changes).story.frames.find(f => f.ref === 'start')!;
  assert.equal(namedNext.id, 'start'); assert.equal(namedNext.name, 'start');
  const withLifecycle = new Map(input); withLifecycle.set(managed, input.get(managed)! + '\nframe("a").exit(ctx => {});\n');
  const lifecycleLogic = analyzeLogic(withLifecycle, readStory(withLifecycle));
  assert.throws(() => renameFrame(withLifecycle, lifecycleLogic, 'a', 'start'), /生命周期|resume/);
});
