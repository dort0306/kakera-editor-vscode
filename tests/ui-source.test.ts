import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readUiDesign, editUi, locateUi } from '../packages/source/src/ui-source';
import { loadUiFiles, uiFileList, uiFragments } from '../packages/source/src/ui-files';
import { readGameTitle, patchGameTitle, readStory, type Sources } from '../packages/source/src/index';
import { textureUi, assignTexture } from '../packages/source/src/texture-source';
import { uiNodes } from '../packages/domain/src/ui';
import { validateStory } from '../packages/domain/src/index';
import { previewUi } from '../packages/domain/src/ui-preview';
import { uiFixture } from './ui-fixture';
const merge = (input: Sources, changes: Sources) => new Map([...input, ...changes]);
test('多起始幕 restart 事件必须选择已声明起点，并保留目标', () => {
  const input = uiFixture();
  input.set('story.xml', input.get('story.xml')!.replace('entry="a"', 'entry="a b"').replace('</frames>', '<frame id="b"><text>第二起点</text></frame></frames>'));
  const design = readUiDesign(input); assert.deepEqual(design.entry, 'ui.xml');
  const next = merge(input, editUi(input, { action: 'event', name: 'start.b', target: 'choice', command: 'restart', targetValue: 'b', page: 'hud' }).changes);
  assert.ok(next.get('ui.js')!.includes('ctx.open("hud"); ctx.restart("b")'));
  assert.throws(() => editUi(input, { action: 'event', name: 'start.none', target: 'choice', command: 'restart' }), /必须指定起始幕/);
  assert.throws(() => editUi(input, { action: 'event', name: 'start.c', target: 'choice', command: 'restart', targetValue: 'c' }), /起始幕/);
});
test('按钮原生页面导航跨 include 验证目标，event 互斥、错误路由及被引用页面删除拒绝', () => {
  const sources = uiFixture(), result = editUi(sources, { action: 'patchNode', id: 'choice', patch: { route: 'open:settings', event: '' } });
  const changed = merge(sources, result.changes);
  assert.equal(locateUi(changed, 'choice').node.attrs.route, 'open:settings'); assert.equal(locateUi(changed, 'choice').node.attrs.event, undefined);
  assert.equal(changed.get('ui.js'), sources.get('ui.js'));
  assert.throws(() => editUi(changed, { action: 'deleteScreen', id: 'settings' }), /按钮导航/);
  for (const route of ['open:missing', 'open:', 'jump:a', 'close:settings']) assert.throws(() => editUi(changed, { action: 'patchNode', id: 'choice', patch: { route } }));
  assert.throws(() => editUi(sources, { action: 'patchNode', id: 'choice', patch: { route: 'close' } }));
  assert.throws(() => editUi(sources, { action: 'patchNode', id: 'caption', patch: { route: 'close' } }));
  const closed = merge(changed, editUi(changed, { action: 'patchNode', id: 'choice', patch: { route: 'close' } }).changes);
  assert.equal(locateUi(closed, 'choice').node.attrs.route, 'close');
});

test('UI include 按游戏根 DFS 读取当前数据，标题/纹理定位到原子文件，原文不合并重写', async () => {
  const sources = uiFixture(), reads: string[] = [];
  const files = await loadUiFiles('ui.xml', async file => { reads.push(file); return sources.get(file)!; });
  assert.deepEqual(files, ['ui.xml', 'ui/state.xml', 'ui/pages.xml', 'ui/pages/hud.xml']); assert.deepEqual(reads, files);
  assert.deepEqual(uiFileList(sources), files);
  const brokenInclude = uiFixture(); brokenInclude.set('ui.xml', '<ui schema="3" initial="hud"><include src="missing.xml"/></ui>');
  assert.deepEqual(uiFileList(brokenInclude), ['ui.xml']);
  const ui = readUiDesign(sources); assert.deepEqual(ui.screens.map(s => s.id), ['hud', 'settings']); assert.equal(ui.screens[0].file, 'ui/pages/hud.xml'); assert.equal(ui.events[0].name, 'advance');
  assert.equal(readGameTitle(sources).text, '拆分界面');
  const title = patchGameTitle(sources, '新标题'); assert.deepEqual([...title.keys()], ['ui/state.xml']); assert.equal(readGameTitle(merge(sources, title)).text, '新标题');
  const assigned = assignTexture(sources, 'picture', 'image', 'picture.node', { name: '格子', x: 1, y: 2, width: 10, height: 20 });
  assert.deepEqual([...assigned.keys()], ['ui/pages/hud.xml']); assert.equal(textureUi(merge(sources, assigned)).targets.find(t => t.id === 'picture.node')!.region, '1,2,10,20');
  assert.equal(sources.get('ui/pages/hud.xml')!.includes("id='caption'"), true);
});

test('UI include 拒绝越界、重复、循环、子根入口属性、screen 内 include 与节点预算', async () => {
  for (const path of ['../outside.xml', 'C:/ui.xml', 'ui\\bad.xml', '/bad.xml', 'ui/../bad.xml', 'ui/con.xml', 'ui/a.XML']) {
    const s = uiFixture(); s.set('ui.xml', `<ui schema="3" initial="hud"><include src="${path}"/></ui>`);
    await assert.rejects(loadUiFiles('ui.xml', async file => s.get(file)!));
  }
  for (const mutate of [
    (s: Sources) => s.set('ui.xml', s.get('ui.xml')!.replace('<include src="ui/pages.xml"/>', '<include src="ui/state.xml"/>')),
    (s: Sources) => s.set('ui/state.xml', '<ui schema="3"><include src="ui.xml"/></ui>'),
    (s: Sources) => s.set('ui/state.xml', '<ui schema="3" width="1280"/>'),
    (s: Sources) => s.set('ui/pages/hud.xml', '<ui schema="3"><screen id="hud" modal="false"><include src="ui/state.xml"/></screen></ui>'),
    (s: Sources) => s.set('ui/pages/hud.xml', '<ui schema="3"><screen id="hud" modal="false">' + Array.from({ length: 1025 }, (_, i) => `<label id="x${i}" width="1" height="1"/>`).join('') + '</screen></ui>')
  ]) { const s = uiFixture(); mutate(s); assert.throws(() => readUiDesign(s)); }
  for (const count of [16, 17]) {
    const s = new Map(Array.from({ length: count }, (_, i) => [`p${i}.xml`, `<ui schema="3">${i + 1 < count ? `<include src="p${i + 1}.xml"/>` : ''}</ui>`]));
    if (count === 16) assert.equal((await loadUiFiles('p0.xml', async file => s.get(file)!)).length, 16); else await assert.rejects(loadUiFiles('p0.xml', async file => s.get(file)!));
  }
  await assert.rejects(loadUiFiles('ui.xml', async () => '<ui schema="3"><!--' + 'x'.repeat(1024 * 1024) + '--></ui>'), /1MiB/);
});

test('控件属性只改原范围，换行/实体/空值正确；ID 与手写脚本保持，越界操作不应用', () => {
  const sources = uiFixture(), result = editUi(sources, { action: 'patchNode', id: 'caption', patch: { text: '第一行\n第二行\t<&🐈', x: '24' } });
  assert.deepEqual([...result.changes.keys()], ['ui/pages/hud.xml']);
  const changed = merge(sources, result.changes), node = uiNodes(readUiDesign(changed).screens[0].children).find(n => n.id === 'caption')!;
  assert.equal(node.attrs.text, '第一行\n第二行\t<&🐈'); assert.ok(changed.get(node.file)!.includes('<!-- 作者布局 🐈 -->')); assert.ok(changed.get(node.file)!.includes("y='20'")); assert.equal(changed.get('ui.js'), sources.get('ui.js'));
  assert.equal(editUi(changed, { action: 'patchNode', id: 'caption', patch: { text: node.attrs.text, x: '24' } }).changes.size, 0);
  for (const patch of [{ id: 'hijack' }, { width: '0' }, { x: 'NaN' }, { src: '../secret' }, { event: 'unregistered' }]) assert.throws(() => editUi(sources, { action: 'patchNode', id: 'caption', patch }));
  assert.throws(() => editUi(sources, { action: 'patchRoot', patch: { width: '1000' } }), /16:9/);
  assert.equal(sources.get(node.file)!.includes("text='原文 &amp; 备注'"), true);
});

test('新增/复制/删除控件与跨文件改父级保持稳定 ID、子树及其他内容', () => {
  let sources = uiFixture();
  const added = editUi(sources, { action: 'addNode', screen: 'settings', kind: 'panel' }); sources = merge(sources, added.changes);
  const panel = added.selected!; assert.match(panel, /^[0-9a-f]{16}$/);
  const moved = editUi(sources, { action: 'moveNode', id: 'caption', screen: 'settings', parent: panel, index: 0 }); sources = merge(sources, moved.changes);
  assert.equal(moved.changes.size, 2); assert.equal(locateUi(sources, 'caption').file, 'ui/pages.xml'); assert.equal(uiNodes(readUiDesign(sources).screens[1].children).find(n => n.id === panel)!.children[0].id, 'caption');
  const clone = editUi(sources, { action: 'duplicateNode', id: panel }); sources = merge(sources, clone.changes);
  assert.match(clone.selected!, /^[0-9a-f]{16}$/);
  const nodes = readUiDesign(sources).screens.flatMap(s => uiNodes(s.children)); assert.equal(new Set(nodes.map(n => n.id)).size, nodes.length); assert.equal(nodes.find(n => n.id === clone.selected)!.children[0].attrs.text, '原文 & 备注');
  assert.throws(() => editUi(sources, { action: 'moveNode', id: panel, screen: 'settings', parent: 'caption', index: 0 }));
  const erased = editUi(sources, { action: 'deleteNode', id: panel }); sources = merge(sources, erased.changes); assert.ok(!readUiDesign(sources).screens.flatMap(s => uiNodes(s.children)).some(n => n.id === 'caption'));
  assert.equal(sources.get('ui.js'), uiFixture().get('ui.js'));
  assert.throws(() => editUi(sources, { action: 'addNode', screen: 'hud', parent: 'list', kind: 'repeat' }), /嵌套 repeat/);
  assert.throws(() => editUi(sources, { action: 'addNode', screen: 'hud', kind: 'button', event: 'missing' }));
});

test('页面、UI 变量和新事件使用真实 XML/JS；旧事件不重写，默认页面和引用受到保护', () => {
  let sources = uiFixture();
  const add = editUi(sources, { action: 'addScreen', file: 'ui/pages.xml', name: '' }); assert.match(add.screen!, /^[0-9a-f]{16}$/);
  const screen = editUi(sources, { action: 'addScreen', file: 'ui/pages.xml', name: 'newPage' }); sources = merge(sources, screen.changes); assert.equal(screen.screen, 'newPage');
  const event = editUi(sources, { action: 'event', name: 'open.newPage', target: 'choice', command: 'open', targetValue: 'newPage' }); sources = merge(sources, event.changes);
  assert.ok(sources.get('ui.js')!.startsWith(uiFixture().get('ui.js')!)); assert.ok(sources.get('ui.js')!.includes('ctx.open("newPage")'));
  const button = editUi(sources, { action: 'addNode', screen: 'hud', kind: 'button', event: 'open.newPage', eventTarget: 'choice' }); sources = merge(sources, button.changes);
  assert.equal(uiNodes(readUiDesign(sources).screens[0].children).find(n => n.id === button.selected)!.attrs.event, 'open.newPage');
  assert.throws(() => editUi(sources, { action: 'deleteScreen', id: 'newPage' }), /脚本可能/); assert.throws(() => editUi(sources, { action: 'deleteScreen', id: 'hud' }), /初始页面/);
  const variable = editUi(sources, { action: 'variable', file: 'ui/state.xml', name: 'score', type: 'int', initial: '9007199254740993', max: '9223372036854775807' }); sources = merge(sources, variable.changes);
  assert.equal(readUiDesign(sources).variables.find(v => v.id === 'score')!.initial, '9007199254740993');
  const cleared = editUi(sources, { action: 'variable', file: 'ui/state.xml', id: 'windowTitle', type: 'string', initial: '' }); assert.ok(cleared.changes.get('ui/state.xml')!.includes('initial=""')); assert.equal(readUiDesign(merge(sources, cleared.changes)).variables.find(v => v.id === 'windowTitle')!.initial, '');
  assert.throws(() => editUi(sources, { action: 'variable', file: 'ui/state.xml', name: 'bad', type: 'int', initial: '9223372036854775808' }));
});

test('UI 变量删除检查控件、标题、事件与脚本引用，只删除原声明', () => {
  let sources = uiFixture();
  assert.throws(() => editUi(sources, { action: 'deleteVariable', id: 'windowTitle' }), /title-bind/);
  const removed = editUi(sources, { action: 'deleteVariable', id: 'show' });
  assert.deepEqual([...removed.changes.keys()], ['ui/state.xml']);
  sources = merge(sources, removed.changes);
  assert.equal(readUiDesign(sources).variables.some(variable => variable.id === 'show'), false);
  assert.ok(sources.get('ui/state.xml')!.includes('id="windowTitle"'));

  let bound = merge(uiFixture(), editUi(uiFixture(), { action: 'variable', file: 'ui/state.xml', name: 'region', type: 'string', initial: '2,3,4,5' }).changes);
  bound = merge(bound, editUi(bound, { action: 'patchNode', id: 'picture.node', patch: { region: '', 'region-bind': 'ui.region' } }).changes);
  assert.throws(() => editUi(bound, { action: 'deleteVariable', id: 'region' }), /region-bind/);

  let events = merge(uiFixture(), editUi(uiFixture(), { action: 'event', name: 'update.show', target: 'choice', command: 'setUi', targetValue: 'show' }).changes);
  assert.throws(() => editUi(events, { action: 'deleteVariable', id: 'show' }), /事件 update\.show/);

  const scripted = new Map(uiFixture());
  scripted.set('ui.js', scripted.get('ui.js')! + '\nui("choice").bind("custom", ctx => { if (ctx.game.complete) ctx.setUi("show", true); });\n');
  assert.throws(() => editUi(scripted, { action: 'deleteVariable', id: 'show' }), /ctx\.setUi/);
  assert.equal(readUiDesign(scripted).variables.some(variable => variable.id === 'show'), true);

  const dynamic = new Map(uiFixture());
  dynamic.set('ui.js', dynamic.get('ui.js')! + '\nconst read = (ctx, name) => ctx.ui[name];\n');
  assert.throws(() => editUi(dynamic, { action: 'deleteVariable', id: 'show' }), /动态/);
  const destructured = new Map(uiFixture());
  destructured.set('ui.js', destructured.get('ui.js')! + '\nconst { show } = ctx.ui;\n');
  assert.throws(() => editUi(destructured, { action: 'deleteVariable', id: 'show' }), /无法确定成员/);
});

test('静态预览采用父级坐标、repeat 示例和点九真实内容区；不执行脚本', () => {
  const sources = uiFixture(), design = readUiDesign(sources), story = readStory(sources);
  let preview = previewUi(design, design.screens[0], story);
  assert.deepEqual(preview.find(n => n.node.id === 'caption')!.rect, [50, 70, 400, 40]);
  assert.deepEqual(preview.filter(n => n.node.id === 'choice').map(n => [n.text, n.rect[1], n.template]), [['好的', 100, false], ['再想想', 158, true]]);
  const screen = { ...design.screens[0], children: [{ ...design.screens[0].children[0], kind: 'nine-patch' as const, attrs: { id: 'panel', image: 'nine', x: '40', y: '50', width: '200', height: '100', density: '1' } }] };
  preview = previewUi(design, screen, story, undefined, { nine: { uri: 'test.png', width: 20, height: 20, spec: { horizontal: [[5, 15]], vertical: [[5, 15]], content: [5, 5, 15, 15] } } });
  assert.deepEqual(preview.find(n => n.node.id === 'caption')!.rect.slice(0, 2), [55, 75]);
  const hidden = editUi(sources, { action: 'patchNode', id: 'caption', patch: { visible: 'false' } }); const d = readUiDesign(merge(sources, hidden.changes));
  assert.equal(previewUi(d, d.screens[0], story, undefined, {}, false).some(n => n.node.id === 'caption'), false);
  assert.equal(uiFragments(sources).length, 4);
  const binding = editUi(sources, { action: 'variable', file: 'ui/state.xml', name: 'region', type: 'string', initial: '2,3,4,5' });
  const bound = merge(sources, binding.changes); const edited = editUi(bound, { action: 'patchNode', id: 'picture.node', patch: { region: '', 'region-bind': 'ui.region' } }); const ui = readUiDesign(merge(bound, edited.changes));
  assert.equal(previewUi(ui, ui.screens[0], story).find(n => n.node.id === 'picture.node')!.region, '2,3,4,5');
});


test('UI 演出与音效组跨文件编辑，步骤排序/注释保留，页面及按钮引用与脚本命令', () => {
  let sources = uiFixture();
  const apply = (operation: unknown) => { const result = editUi(sources, operation); sources = merge(sources, result.changes); return result; };
  apply({ action:'media', item:{kind:'sound',id:'ui.click',file:'ui/state.xml',attrs:{},steps:[{kind:'clip',attrs:{asset:'voice.lin',weight:'2',enabled:'true'}}]} });
  const untouched = sources.get('ui/state.xml');
  const item = {kind:'sequence',id:'reveal',file:'ui/pages.xml',attrs:{finish:'open:settings',skippable:'true'},steps:[{kind:'fade',attrs:{target:'panel',from:'0',to:'1',duration:'400'}},{kind:'sound',attrs:{ref:'ui.click'}}]};
  apply({action:'media',item});
  sources.set('ui/pages.xml', sources.get('ui/pages.xml')!.replace('<fade ', '<!-- 作者演出注释 --><fade '));
  const before = sources.get('ui/pages.xml')!;
  apply({action:'media',item:{...item,steps:[...item.steps].reverse()}});
  assert.equal(sources.get('ui/state.xml'),untouched); assert.ok(sources.get('ui/pages.xml')!.includes('<!-- 作者演出注释 -->'));
  assert.equal(sources.get('ui/pages.xml')!.split('<sequence')[0], before.split('<sequence')[0]);
  assert.deepEqual(readUiDesign(sources).media!.find(m=>m.id==='reveal')!.steps.map(s=>s.kind),['sound','fade']);
  apply({action:'patchScreen',id:'hud',patch:{sequence:'reveal'}});
  apply({action:'patchNode',id:'choice',patch:{event:'',sound:'ui.click'}});
  assert.equal(locateUi(sources,'choice').node.attrs.sound,'ui.click');
  const originalJs = sources.get('ui.js')!;
  apply({action:'event',name:'show.reveal',target:'choice',command:'sequence',targetValue:'reveal'});
  apply({action:'event',name:'play.click',target:'choice',command:'playSound',targetValue:'ui.click'});
  apply({action:'event',name:'sound.toggle',target:'choice',command:'soundEnabled'});
  assert.ok(sources.get('ui.js')!.startsWith(originalJs)); assert.ok(sources.get('ui.js')!.includes('ctx.sequence("reveal")')); assert.ok(sources.get('ui.js')!.includes('ctx.soundEnabled(ctx.value)'));
  for (const steps of [[{kind:'fade',attrs:{target:'panel',from:'2'}}],[{kind:'fade',attrs:{target:'panel',duration:'10001'}}],[{kind:'video',attrs:{asset:'v',src:'unsafe'}}],[]]) assert.throws(()=>apply({action:'media',item:{...item,steps}}));
  assert.throws(()=>apply({action:'media',item:{kind:'sound',id:'bad',file:'ui.xml',attrs:{},steps:[{kind:'clip',attrs:{asset:'v',weight:'0'}}]}}));
});

test('v0.9.1 交接触发事件可显式指定起始幕并先打开页面，目标受校验', () => {
  let sources = uiFixture();
  const apply = (operation: unknown) => { const result = editUi(sources, operation); sources = merge(sources, result.changes); return result; };
  apply({ action: 'event', name: 'watch.intro', target: 'choice', command: 'present', targetValue: 'settings' });
  apply({ action: 'event', name: 'back.pending', target: 'choice', command: 'resume', targetValue: '', page: 'settings' });
  apply({ action: 'event', name: 'back.hud', target: 'choice', command: 'resume', targetValue: 'a', page: 'settings' });
  const js = sources.get('ui.js')!;
  assert.ok(js.includes('ctx.present("settings")')); assert.ok(js.includes('ctx.open("settings"); ctx.resume();')); assert.ok(js.includes('ctx.open("settings"); ctx.resume("a")'));
  assert.throws(() => apply({ action: 'event', name: 'watch.missing', target: 'choice', command: 'present', targetValue: 'missing' }));
  assert.throws(() => apply({ action: 'event', name: 'back.missing', target: 'choice', command: 'resume', targetValue: 'missing' }));
  assert.throws(() => apply({ action: 'event', name: 'back.missingPage', target: 'choice', command: 'resume', targetValue: 'a', page: 'missing' }), /页面不存在/);
  assert.throws(() => apply({ action: 'event', name: 'bad.page', target: 'choice', command: 'open', targetValue: 'settings', page: 'settings' }), /只有开始/);
  for (const name of ['game.enter', 'frame.enter:a', 'screen.open:settings']) assert.throws(() => apply({ action: 'event', name, target: 'choice', command: 'close' }));
  const lifecycle = merge(sources, new Map([['ui.js', sources.get('ui.js')! + "\nui('settings').bind('screen.open', ctx => {});\n"]]));
  assert.throws(() => editUi(lifecycle, { action: 'deleteScreen', id: 'settings' }), /screen\.open|页面/);
  const present = merge(sources, new Map([['ui.js', sources.get('ui.js')! + "\nui('choice').bind('handoff', ctx => ctx.present('settings'));\n"]]));
  assert.throws(() => editUi(present, { action: 'deleteScreen', id: 'settings' }), /交接|页面/);
});

test('可视事件可修改名称/动作并同步控件引用，未引用事件可删除，手写回调保留', () => {
  const input = uiFixture(), design = readUiDesign(input), advance = design.events.find(e => e.name === 'advance')!;
  assert.equal(advance.editable, true); assert.equal(advance.command, 'advance');
  const edited = editUi(input, { action: 'event', original: 'advance', target: 'choice', name: 'advance.next', command: 'open', targetValue: 'settings' });
  const after = merge(input, edited.changes), next = readUiDesign(after);
  assert.ok(after.get('ui.js')!.includes('ctx.open("settings");')); assert.ok(after.get('ui.js')!.includes('// 作者 JS，保持原文'));
  assert.ok(after.get('ui/pages/hud.xml')!.includes('event="advance.next"'));
  assert.deepEqual(next.events.map(e => e.name), ['advance.next']);
  const background = merge(input, new Map([['ui/pages/hud.xml', input.get('ui/pages/hud.xml')!.replace('<screen id="hud" modal="false" pause="false">', '<screen id="hud" modal="false" pause="false" background-click="advance">')]]));
  const backgroundScript = new Map([...background, ['ui.js', background.get('ui.js')! + '\nui("hud").bind("advance", (ctx) => { ctx.advance(); });\n']]);
  const backgroundRenamed = merge(backgroundScript, editUi(backgroundScript, { action: 'event', original: 'advance', target: 'hud', name: 'advance.next', command: 'advance' }).changes);
  assert.ok(backgroundRenamed.get('ui/pages/hud.xml')!.includes('background-click="advance.next"'));
  assert.throws(() => editUi(backgroundScript, { action: 'deleteEvent', name: 'advance', target: 'hud' }), /背景/);
  assert.throws(() => editUi(after, { action: 'deleteEvent', name: 'advance.next', target: 'choice' }), /仍有控件/);
  const added = editUi(after, { action: 'event', name: 'unused.close', target: 'choice', command: 'close' });
  const withUnused = merge(after, added.changes);
  assert.equal(readUiDesign(withUnused).events.find(e => e.name === 'unused.close')!.editable, true);
  const removed = editUi(withUnused, { action: 'deleteEvent', name: 'unused.close', target: 'choice' });
  const cleaned = merge(withUnused, removed.changes);
  assert.equal(readUiDesign(cleaned).events.some(e => e.name === 'unused.close'), false);
  assert.ok(!cleaned.get('ui.js')!.includes('ui("choice").bind("unused.close"'));
  const custom = merge(after, new Map([['ui.js', after.get('ui.js')! + 'ui("choice").bind("custom", ctx => { const x = 1; ctx.advance(); });\n']]));
  assert.throws(() => editUi(custom, { action: 'event', original: 'custom', target: 'choice', name: 'custom.next', command: 'advance' }), /自定义|保留源码/);
  assert.throws(() => editUi(custom, { action: 'deleteEvent', name: 'custom', target: 'choice' }), /自定义|保留源码/);
});

test('CG 专用资源自动进入画廊，可编辑中文标题/初值并恢复自动条目', () => {
  let sources = uiFixture();
  sources.set('story.xml', sources.get('story.xml')!.replace('</assets>', '<cg id="cg.promise" src="assets/cg/promise.png"/></assets>'));
  const implicit = readUiDesign(sources).gallery.find(g => g.id === 'cg.promise')!;
  assert.equal(implicit.implicit, true); assert.equal(implicit.image, 'cg.promise'); assert.equal(implicit.title, 'cg.promise');
  const added = editUi(sources, { action: 'gallery', id: 'cg.promise', image: 'cg.promise', title: '约定的 CG', unlocked: true });
  sources = merge(sources, added.changes);
  const explicit = readUiDesign(sources).gallery.find(g => g.id === 'cg.promise')!;
  assert.equal(explicit.implicit, undefined); assert.equal(explicit.title, '约定的 CG'); assert.equal(explicit.unlocked, true);
  const edited = editUi(sources, { action: 'gallery', original: 'cg.promise', id: 'cg.promise', image: 'cg.promise', title: '新的标题', unlocked: false });
  sources = merge(sources, edited.changes);
  const updated = readUiDesign(sources).gallery.find(g => g.id === 'cg.promise')!;
  assert.equal(updated.title, '新的标题'); assert.equal(updated.unlocked, false); assert.equal(updated.implicit, undefined);
  const unlock = editUi(sources, { action: 'event', name: 'cg.unlock', target: 'choice', command: 'unlock', targetValue: 'cg.promise' });
  sources = merge(sources, unlock.changes);
  assert.ok(sources.get('ui.js')!.includes('ctx.unlock("cg.promise")'));
  const current = editUi(sources, { action: 'event', original: 'cg.unlock', target: 'choice', name: 'cg.unlock', command: 'unlock', targetValue: '' });
  sources = merge(sources, current.changes);
  assert.ok(sources.get('ui.js')!.includes('ctx.unlock(ctx.game.cgId)'));
  assert.equal(readUiDesign(sources).events.find(e => e.name === 'cg.unlock')!.editable, true);
  const removed = editUi(sources, { action: 'deleteGallery', id: 'cg.promise' });
  sources = merge(sources, removed.changes);
  const fallback = readUiDesign(sources).gallery.find(g => g.id === 'cg.promise')!;
  assert.equal(fallback.implicit, true); assert.equal(fallback.title, 'cg.promise');
  assert.throws(() => editUi(sources, { action: 'gallery', id: 'cg.promise', image: 'picture', title: '错误', unlocked: false }), /ID 必须等于/);
});

test('页面生命周期和交接引用以当前 include 缓冲诊断，保留源码位置与独立剧情路由', () => {
  const sources = uiFixture();
  const js = [
    'const TARGET = "settings";',
    'ui("missing.open").bind("screen.open", ctx => {});',
    'ui("missing.close")["bind"]("screen.close", ctx => {});',
    'ui("choice").bind("missing", ctx => ctx.present("missing.present"));',
    'ui(TARGET).bind("screen.open", ctx => {});',
    'ui("choice").bind("valid", state => state["present"](TARGET));',
    'ui(resolvePage()).bind("screen.close", ctx => {});',
    'ui("choice").bind("dynamic", ctx => ctx.present(ctx.value));',
    'ui("choice").bind("shadow", TARGET => TARGET.present(TARGET));',
  ].join('\r\n');
  sources.set('ui.js', js);
  const before = new Map(sources), design = readUiDesign(sources);
  assert.deepEqual(design.warnings.filter(warning => /生命周期|交接/.test(warning)), [
    'ui.js:2 生命周期页面不存在：missing.open',
    'ui.js:3 生命周期页面不存在：missing.close',
    'ui.js:4 UI 交接目标页面不存在：missing.present',
    'ui.js:7 生命周期目标不确定；删除相关幕或页面需先查看源码',
    'ui.js:8 UI 交接目标页面不确定；请查看源码',
    'ui.js:9 UI 交接目标页面不确定；请查看源码',
  ]);
  assert.deepEqual(sources, before);
  // A page added only to the source map (the host's current buffer) clears the diagnostics.
  sources.set('ui/pages.xml', sources.get('ui/pages.xml')!.replace('</ui>', '<screen id="missing.open"/><screen id="missing.close"/><screen id="missing.present"/></ui>'));
  assert.equal(readUiDesign(sources).warnings.some(w => w.includes('页面不存在')), false);
  sources.set('ui/pages.xml', sources.get('ui/pages.xml')!.replace('<screen id="settings">', '<screen id="renamed">'));
  assert.ok(readUiDesign(sources).warnings.some(w => w === 'ui.js:5 生命周期页面不存在：settings'));
  assert.ok(readUiDesign(sources).warnings.some(w => w === 'ui.js:6 UI 交接目标页面不存在：settings'));
});

test('v0.9.0 移除 frame 视频与 game.video* 绑定：旧内容给出源码诊断而不是继续生成', () => {
  const sources = uiFixture();
  sources.set('ui/pages/hud.xml', sources.get('ui/pages/hud.xml')!.replace('bind="item.text"', 'bind="game.videoPlaying"'));
  sources.set('ui.js', sources.get('ui.js')! + "\nui('choice').bind('skip-old', ctx => ctx.skipVideo());\n");
  const warnings = readUiDesign(sources).warnings;
  assert.ok(warnings.some(w => w.includes('game.videoPlaying')));
  assert.ok(warnings.some(w => w.includes('ctx.skipVideo')));
  const story = new Map([['story.xml', '<story schema="8" id="s" content-version="9" entry="a"><interface src="ui.xml"/><frames><frame id="a"><video asset="v"/><text>旧视频</text></frame><frame id="b"><text>结束</text></frame></frames><next end="true"/></story>']]);
  const parsed = readStory(story);
  assert.equal(parsed.frames[0].legacyVideo, true);
  assert.ok(validateStory(parsed).some(issue => issue.message.includes('frame.video')));
});

test('v0.11 目标作用域回调随控件复制/删除，页面删除清理自身与子控件注册', () => {
  let sources = uiFixture();
  const original = readUiDesign(sources).events.find(event => event.target === 'choice' && event.name === 'advance')!;
  assert.equal(original.editable, true);
  const clone = editUi(sources, { action: 'duplicateNode', id: 'choice' }); sources = merge(sources, clone.changes);
  const cloneId = clone.selected!;
  assert.ok(readUiDesign(sources).events.some(event => event.target === cloneId && event.name === 'advance'));
  assert.ok(sources.get('ui.js')!.includes(`ui(${JSON.stringify(cloneId)}).bind("advance"`));
  const removed = editUi(sources, { action: 'deleteNode', id: cloneId }); sources = merge(sources, removed.changes);
  assert.equal(readUiDesign(sources).events.some(event => event.target === cloneId), false);

  const pageResult = editUi(sources, { action: 'addScreen', file: 'ui/pages.xml', name: 'scratch' }); sources = merge(sources, pageResult.changes);
  const page = pageResult.screen!;
  const buttonResult = editUi(sources, { action: 'addNode', screen: page, kind: 'button' }); sources = merge(sources, buttonResult.changes);
  const button = buttonResult.selected!;
  sources = merge(sources, editUi(sources, { action: 'event', name: 'scratch.close', target: button, command: 'close' }).changes);
  sources = merge(sources, editUi(sources, { action: 'patchNode', id: button, patch: { event: 'scratch.close' } }).changes);
  assert.ok(sources.get('ui.js')!.includes('scratch.close'));
  const deleted = editUi(sources, { action: 'deleteScreen', id: page }); sources = merge(sources, deleted.changes);
  assert.equal(readUiDesign(sources).screens.some(screen => screen.id === page), false);
  assert.ok(!sources.get('ui.js')!.includes('scratch.close'));

  const guardedResult = editUi(sources, { action: 'addScreen', file: 'ui/pages.xml', name: 'guarded' }); sources = merge(sources, guardedResult.changes);
  const guarded = guardedResult.screen!;
  sources = merge(sources, editUi(sources, { action: 'lifecycle', kind: 'screenClose', owner: guarded, mode: 'continue' }).changes);
  assert.throws(() => editUi(sources, { action: 'deleteScreen', id: guarded }), /生命周期/);
});
