import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readUiDesign, editUi } from '../packages/source/src/ui-source';
import { uiNodes } from '../packages/domain/src/ui';

const story = (scripts: string[] = ['scripts/ui.js'], frames = true) => `<?xml version="1.0" encoding="UTF-8"?>
<story schema="8" id="components" content-version="1" entry="opening">
  <interface src="ui.xml" />
  <scripts>${scripts.map(file => `<script src="${file}" />`).join('')}</scripts>
  <variables><int id="trust" initial="0" min="0" max="100" /></variables>
  <visuals><visual id="empty" /></visuals>
  <frames>${frames ? '<frame id="opening" speaker="" visual="empty"><text>开始</text></frame>' : ''}</frames>
</story>
`;
const design = (body: string, variables = '<int id="page" initial="1" min="1" max="4" />', scripts = ['scripts/ui.js']) => new Map<string, string>([
  ['story.xml', story(scripts)],
  ['ui.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<ui schema="3" width="1280" height="720" initial="main">\n  <variables>${variables}</variables>\n  <screen id="main" modal="false">${body}</screen>\n</ui>\n`],
  ['scripts/ui.js', 'event.register("advance", (ctx) => { ctx.advance(); });\n']
]);
const CARD = `component.register("x-card", {
  props: {
    title: { type: "string", required: true },
    "expanded": { type: "binding", valueType: "bool", required: true },
    "font-size": { type: "int", default: 18, min: 8, max: 64 },
    "on-open": { type: "event", required: true }
  },
  expand({ props, children }) { return { tag: "panel", attrs: { id: "$root" }, children }; }
});
event.register("card-open", (ctx) => { ctx.close(); });
`;
const withCard = (extra: string) => { const sources = design(extra, '<bool id="show" initial="false" /><int id="page" initial="1" min="1" max="4" />'); sources.set('scripts/ui.js', sources.get('scripts/ui.js')! + CARD); return sources; };

test('v0.11.2 组合标签注册按静态字面量解析，动态注册只给不确定诊断', () => {
  const sources = withCard('<x-card id="card" width="600" height="360" title="帮助" expanded="ui.show" on-open="card-open" />');
  const read = readUiDesign(sources);
  assert.deepEqual(read.components?.map(component => component.name), ['x-card']);
  assert.equal(read.components?.[0].props.title.required, true);
  assert.equal(read.components?.[0].props['font-size'].default, '18');
  assert.equal(read.components?.[0].props.expanded.valueType, 'bool');
  const node = read.screens[0].children[0];
  assert.equal(node.kind, 'component'); assert.equal(node.component, 'x-card');
  // The event-typed prop is a proven XML reference to the registered event.
  assert.ok(read.bindings.some(binding => binding.target === 'card' && binding.name === 'card-open'));

  const dynamic = design('<panel id="box" width="10" height="10" />');
  dynamic.set('scripts/ui.js', dynamic.get('scripts/ui.js')! + 'const name = "x-card"; component.register(name, { props: {}, expand() { return { tag: "panel", attrs: { id: "$root" } }; } });\n');
  const uncertain = readUiDesign(dynamic);
  assert.equal(uncertain.componentUncertain, true);
  assert.ok(uncertain.warnings.some(warning => warning.includes('组合标签名')));
});

test('v0.11.2 组合标签实例校验必需属性、类型、布局覆盖与实例内 ID', () => {
  const ok = withCard('<x-card id="card" width="600" height="360" title="帮助" expanded="ui.show" on-open="card-open"><label id="body" width="500" height="40" text="正文" /></x-card>');
  const read = readUiDesign(ok), card = read.screens[0].children[0];
  assert.equal(card.children[0].id, 'body');
  assert.equal(card.children[0].engineId, 'card.body');
  // A second instance may reuse the same local child ID; expansion prefixes it.
  const nested = withCard('<x-card id="one" width="600" height="360" title="a" expanded="ui.show" on-open="card-open"><label id="body" width="10" height="10" text="x" /></x-card><x-card id="two" width="600" height="360" title="b" expanded="ui.show" on-open="card-open"><label id="body" width="10" height="10" text="y" /></x-card>');
  const two = readUiDesign(nested);
  assert.deepEqual(two.screens[0].children.map(node => node.id), ['one', 'two']);
  const labels = two.screens[0].children.flatMap(node => uiNodes(node.children).map(child => child.engineId));
  assert.deepEqual(labels, ['one.body', 'two.body']);

  const missing = () => readUiDesign(withCard('<x-card id="card" width="600" height="360" on-open="card-open" />'));
  assert.throws(missing, /缺少必需属性 title/);
  const unknown = () => readUiDesign(withCard('<x-card id="card" width="600" height="360" title="a" expanded="ui.show" on-open="card-open" colour="red" />'));
  assert.throws(unknown, /不支持属性 colour/);
  const badType = () => readUiDesign(withCard('<x-card id="card" width="600" height="360" title="a" expanded="ui.show" on-open="card-open" font-size="huge" />'));
  assert.throws(badType, /必须是 64 位整数/);
  const badBinding = () => readUiDesign(withCard('<x-card id="card" width="600" height="360" title="a" expanded="ui.page" on-open="card-open" />'));
  assert.throws(badBinding, /需要 UI bool 变量/);
  const unregistered = () => readUiDesign(design('<x-unknown id="x" width="10" height="10" />'));
  assert.throws(unregistered, /未注册的组合标签 x-unknown/);
  const duplicate = () => readUiDesign(withCard('<x-card id="card" width="600" height="360" title="a" expanded="ui.show" on-open="card-open"><label id="body" width="10" height="10" text="x" /><label id="body" width="10" height="10" text="y" /></x-card>'));
  assert.throws(duplicate, /组合标签实例内控件 ID 重复/);
});

test('v0.11.2 repeat 分页声明成对出现，页变量必须 min=1 且一变量一列表', () => {
  const paginated = readUiDesign(design('<repeat id="cards" width="900" height="300" source="gallery" item-width="280" item-height="90" page-size="2" page-bind="ui.page"><label id="card" width="280" height="30" bind="item.title" /></repeat>'));
  const repeat = paginated.screens[0].children[0];
  assert.equal(repeat.attrs['page-size'], '2'); assert.equal(repeat.attrs['page-bind'], 'ui.page');
  const alone = () => readUiDesign(design('<repeat id="cards" width="900" height="300" source="gallery" item-width="280" item-height="90" page-size="2"><label id="card" width="280" height="30" bind="item.title" /></repeat>'));
  assert.throws(alone, /page-size 与 page-bind 必须同时出现/);
  const noMin = () => readUiDesign(design('<repeat id="cards" width="900" height="300" source="gallery" item-width="280" item-height="90" page-size="2" page-bind="ui.page"><label id="card" width="280" height="30" bind="item.title" /></repeat>', '<int id="page" initial="1" />'));
  assert.throws(noMin, /min="1"/);
  const shared = () => readUiDesign(design('<repeat id="one" width="900" height="300" source="gallery" item-width="280" item-height="90" page-size="2" page-bind="ui.page"><label id="a" width="10" height="10" bind="item.title" /></repeat><repeat id="two" width="900" height="300" source="gallery" item-width="280" item-height="90" page-size="2" page-bind="ui.page"><label id="b" width="10" height="10" bind="item.title" /></repeat>'));
  assert.throws(shared, /只能绑定一个 repeat/);
  const metadata = readUiDesign(design('<repeat id="cards" width="900" height="300" source="gallery" item-width="280" item-height="90" page-size="2" page-bind="ui.page"><label id="card" width="280" height="30" bind="item.title" /></repeat><label id="pageText" width="300" height="30" bind="repeat.cards.pageText" /><button id="next" width="120" height="40" text="下一页" enabled="repeat.cards.canNext" event="advance" />'));
  assert.equal(metadata.screens[0].children[1].attrs.bind, 'repeat.cards.pageText');
});

test('v0.11.2 编辑器插入内置 tabs 与 pagination 生成可用源码', () => {
  const sources = design('<panel id="box" width="1280" height="720" />', '<int id="page" initial="1" min="1" max="4" /><bool id="tabA" initial="true" />');
  sources.set('ui.xml', sources.get('ui.xml')!
    .replace('</ui>', '<screen id="other" modal="false"><panel id="otherBox" width="320" height="180" /></screen></ui>')
    .replace('</screen>', '<repeat id="cards" width="900" height="300" source="gallery" item-width="280" item-height="90" page-size="2" page-bind="ui.page"><label id="card" width="280" height="30" bind="item.title" /></repeat></screen>'));
  const apply = (operation: unknown) => { const { changes } = editUi(sources, operation); for (const [file, text] of changes) sources.set(file, text); return readUiDesign(sources); };
  const afterTabs = apply({ action: 'insertComponent', screen: 'main', component: 'tabs' });
  const tabs = afterTabs.screens.find(screen => screen.id === 'main')!.children.find(node => node.kind === 'component')!;
  assert.equal(tabs.component, 'x-tabs');
  assert.match(tabs.attrs.labels, /other/); assert.match(tabs.attrs.states, /^ui\.tab/);
  assert.ok(afterTabs.components?.some(component => component.name === 'x-tabs'));
  assert.ok(afterTabs.variables.some(variable => variable.type === 'bool' && variable.id === tabs.attrs.states.split(';')[0].slice(3)));
  assert.ok(afterTabs.events.some(event => event.name === tabs.attrs.events.split(';')[0]));
  const afterPager = apply({ action: 'insertComponent', screen: 'main', component: 'pagination', target: 'cards' });
  const pager = afterPager.screens.find(screen => screen.id === 'main')!.children.find(node => node.kind === 'component' && node.component === 'x-pagination')!;
  assert.equal(pager.attrs.target, 'cards');
  assert.match(sources.get('scripts/ui.js')!, /ctx\.repeats\.cards/);
  assert.ok(afterPager.components?.some(component => component.name === 'x-pagination'));
  assert.throws(() => editUi(sources, { action: 'insertComponent', screen: 'main', component: 'pagination', target: 'box' }), /不是带 page-size\/page-bind 的分页列表/);
});

test('v0.11.2 组合标签实例只允许布局属性做可视化补丁', () => {
  const sources = withCard('<x-card id="card" width="600" height="360" title="帮助" expanded="ui.show" on-open="card-open"><label id="body" width="10" height="10" text="正文" /></x-card>');
  const ok = editUi(sources, { action: 'patchNode', id: 'card', patch: { x: '12', width: '640' } });
  const patched = ok.changes.get('ui.xml')!;
  assert.match(patched, /<x-card id="card"[^>]*x="12"/); assert.match(patched, /<x-card id="card"[^>]*width="640"/);
  assert.throws(() => editUi(sources, { action: 'patchNode', id: 'card', patch: { labels: 'a' } }), /不支持的 UI 属性/);
  const child = editUi(sources, { action: 'patchNode', id: 'body', patch: { text: '改了' } });
  assert.match(child.changes.get('ui.xml')!, /text="改了"/);

});




