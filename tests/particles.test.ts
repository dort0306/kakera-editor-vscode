import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readUiDesign, editUi } from '../packages/source/src/ui-source';
import { readStory } from '../packages/source/src/index';
import { uiNodes } from '../packages/domain/src/ui';
import { previewUi } from '../packages/domain/src/ui-preview';
import { uiFixture } from './ui-fixture';

/** Adds one emitter as the last child of the fixture `hud` page. */
function withEmitter(attrs: string, assets = ''): ReturnType<typeof uiFixture> {
  const sources = uiFixture();
  if (assets) sources.set('story.xml', sources.get('story.xml')!.replace('</assets>', `${assets}</assets>`));
  sources.set('ui/pages/hud.xml', sources.get('ui/pages/hud.xml')!.replace('</screen>', `<particles id="rain" x="700" y="380" width="240" height="300" image="picture" ${attrs} /></screen>`));
  return sources;
}
const emitterNode = (sources: ReturnType<typeof uiFixture>) => uiNodes(readUiDesign(sources).screens.find(screen => screen.id === 'hud')!.children).find(node => node.id === 'rain')!;
const rejects = (attrs: string, message: RegExp, assets = '') => assert.throws(() => readUiDesign(withEmitter(attrs, assets)), message);

test('v0.11.3 粒子发射器按引擎范围解析，未知属性/非有限/倒置/缺纹理都拒绝', () => {
  assert.equal(emitterNode(withEmitter('rate="40"')).kind, 'particles');
  assert.equal(emitterNode(withEmitter('rate="40" burst="0" max="64" life="0.5" size="8" autostart="true"')).attrs.autostart, 'true');
  // The engine accepts image or cg textures only.
  assert.equal(emitterNode(withEmitter('rate="12"', '<cg id="cg.dust" src="assets/cg/dust.png"/>')).attrs.image, 'picture');
  const cg = withEmitter('rate="12"', '<cg id="cg.dust" src="assets/cg/dust.png"/>');
  cg.set('ui/pages/hud.xml', cg.get('ui/pages/hud.xml')!.replace('image="picture" rate="12"', 'image="cg.dust" rate="12"'));
  assert.equal(emitterNode(cg).attrs.image, 'cg.dust');
  rejects('rate="0"', /rate 与 burst 不能同时为 0/);
  rejects('rate="201"', /rate 需要 0–200/);
  rejects('rate="-1"', /rate 需要 0–200/);
  rejects('rate=""', /rate 需要 0–200/);
  rejects('rate="1e9"', /rate 需要 0–200/);
  rejects('burst="129"', /burst 需要 0–128 的整数/);
  rejects('burst="1.5"', /burst 需要 0–128 的整数/);
  rejects('max="0" rate="10"', /max 至少为 1/);
  rejects('max="513" rate="10"', /max 需要 0–512 的整数/);
  rejects('life="0" rate="10"', /life 需要 0.1–10/);
  rejects('life="2" life-max="1" rate="10"', /life-max 不能小于 life/);
  rejects('size="600" rate="10"', /size 需要 0.5–512/);
  rejects('vx="10" vx-max="-10" rate="10"', /vx-max 不能小于 vx/);
  rejects('vy="10" vy-max="-10" rate="10"', /vy-max 不能小于 vy/);
  rejects('spin="90" spin-max="-90" rate="10"', /spin-max 不能小于 spin/);
  rejects('accel-x="3000" rate="10"', /accel-x 需要 -2000–2000/);
  rejects('fade="yes" rate="10"', /fade 必须是 true\/false/);
  rejects('autostart="1" rate="10"', /autostart 必须是 true\/false/);
  // Emitters own no `enabled` attribute (engine §39.2).
  rejects('rate="10" enabled="true"', /包含未知属性或正文/);
  const unknownTexture = withEmitter('rate="10"');
  unknownTexture.set('ui/pages/hud.xml', unknownTexture.get('ui/pages/hud.xml')!.replace('image="picture" rate="10"', 'image="missing" rate="10"'));
  assert.throws(() => readUiDesign(unknownTexture), /image 必须是已声明的图片或 CG 资源/);
  const missing = withEmitter('rate="10"');
  missing.set('ui/pages/hud.xml', missing.get('ui/pages/hud.xml')!.replace(' image="picture" rate="10"', ' rate="10"'));
  assert.throws(() => readUiDesign(missing), /particles 需要 image 纹理/);
});

test('v0.11.3 粒子发射器不能放进 repeat，按页 4 个/整份 UI 32 个计数', () => {
  const nested = uiFixture();
  nested.set('ui/pages/hud.xml', nested.get('ui/pages/hud.xml')!.replace('</repeat>', '<particles id="nested" width="40" height="40" image="picture" rate="10" /></repeat>'));
  assert.throws(() => readUiDesign(nested), /particles 不能放在 repeat 模板中/);
  const full = uiFixture();
  const emitters = Array.from({ length: 5 }, (_, index) => `<particles id="p${index}" x="0" y="0" width="40" height="40" image="picture" rate="10" />`).join('');
  full.set('ui/pages/hud.xml', full.get('ui/pages/hud.xml')!.replace('</screen>', `${emitters}</screen>`));
  assert.throws(() => readUiDesign(full), /页面 hud 最多 4 个粒子发射器/);
  const many = uiFixture();
  const screens = Array.from({ length: 9 }, (_, page) => `<screen id="extra${page}"><particles id="e${page}a" width="40" height="40" image="picture" rate="10" /><particles id="e${page}b" width="40" height="40" image="picture" rate="10" /><particles id="e${page}c" width="40" height="40" image="picture" rate="10" /><particles id="e${page}d" width="40" height="40" image="picture" rate="10" /></screen>`).join('');
  many.set('ui/pages/hud.xml', many.get('ui/pages/hud.xml')!.replace('</ui>', `${screens}</ui>`));
  assert.throws(() => readUiDesign(many), /最多 32 个粒子发射器/);
});

test('v0.11.3 新增粒子发射器写入纹理与默认参数，属性补丁沿用同一白名单', () => {
  const sources = uiFixture();
  const created = editUi(sources, { action: 'addNode', screen: 'hud', kind: 'particles', image: 'picture' });
  const markup = created.changes.get('ui/pages/hud.xml')!;
  assert.match(markup, /<particles [^>]*image="picture"/);
  assert.match(markup, /rate="24"/);
  const next = new Map([...sources, ...created.changes]), node = uiNodes(readUiDesign(next).screens.find(screen => screen.id === 'hud')!.children).find(item => item.id === created.selected)!;
  assert.equal(node.kind, 'particles'); assert.equal(node.attrs.max, '96'); assert.equal(node.attrs.autostart, undefined);
  assert.throws(() => editUi(sources, { action: 'addNode', screen: 'hud', kind: 'particles', image: '' }), /粒子纹理/);
  assert.throws(() => editUi(sources, { action: 'addNode', screen: 'hud', kind: 'particles', image: 'missing' }), /粒子纹理/);
  const patched = editUi(next, { action: 'patchNode', id: node.id, patch: { rate: '80', 'life-max': '2.4', fade: 'false' } });
  const value = uiNodes(readUiDesign(new Map([...next, ...patched.changes])).screens.find(screen => screen.id === 'hud')!.children).find(item => item.id === node.id)!;
  assert.deepEqual([value.attrs.rate, value.attrs['life-max'], value.attrs.fade], ['80', '2.4', 'false']);
  assert.throws(() => editUi(next, { action: 'patchNode', id: node.id, patch: { enabled: 'true' } }), /不支持的 UI 属性/);
  assert.throws(() => editUi(next, { action: 'patchNode', id: node.id, patch: { rate: '0', burst: '0' } }), /rate 与 burst 不能同时为 0/);
  // Four emitters already fill the page; a fifth insert is refused before writing.
  const filled = uiFixture();
  filled.set('ui/pages/hud.xml', filled.get('ui/pages/hud.xml')!.replace('</screen>', `${Array.from({ length: 4 }, (_, index) => `<particles id="full${index}" x="0" y="0" width="40" height="40" image="picture" rate="10" />`).join('')}</screen>`));
  assert.throws(() => editUi(filled, { action: 'addNode', screen: 'hud', kind: 'particles', image: 'picture' }), /每个页面最多 4 个粒子发射器/);
});

test('v0.11.3 ctx.particles 命令可生成、读回和改名，动作与发射器受静态校验', () => {
  const sources = withEmitter('rate="40" burst="24"');
  const created = editUi(sources, { action: 'event', name: 'rain.start', command: 'particles', targetValue: 'rain', particleAction: 'start' });
  assert.ok(created.changes.get('ui.js')!.includes('event.register("rain.start", (ctx) => { ctx.particles("rain").start(); });'));
  const next = new Map([...sources, ...created.changes]), design = readUiDesign(next);
  const event = design.events.find(item => item.name === 'rain.start')!;
  assert.deepEqual([event.command, event.commandTarget, event.particleAction, event.editable], ['particles', 'rain', 'start', true]);
  const edited = editUi(next, { action: 'event', original: 'rain.start', name: 'rain.burst', command: 'particles', targetValue: 'rain', particleAction: 'burst' });
  assert.ok(edited.changes.get('ui.js')!.includes('ctx.particles("rain").burst();'));
  const removed = editUi(new Map([...next, ...edited.changes]), { action: 'deleteEvent', name: 'rain.burst' });
  assert.ok(!removed.changes.get('ui.js')!.includes('rain.burst'));
  // start needs rate, burst needs a declared burst count.
  assert.throws(() => editUi(withEmitter('burst="12"'), { action: 'event', name: 'no.rate', command: 'particles', targetValue: 'rain', particleAction: 'start' }), /没有 rate/);
  assert.throws(() => editUi(withEmitter('rate="12"'), { action: 'event', name: 'no.burst', command: 'particles', targetValue: 'rain', particleAction: 'burst' }), /没有声明 burst/);
  assert.throws(() => editUi(sources, { action: 'event', name: 'missing', command: 'particles', targetValue: 'ghost', particleAction: 'start' }), /请选择已声明的粒子发射器/);
  assert.throws(() => editUi(sources, { action: 'event', name: 'invalid', command: 'particles', targetValue: 'rain', particleAction: 'pause' }), /只接受 start\/stop\/clear\/burst/);
  // v0.11.3 also accepts the new master volume setting through the same fixed command.
  const volume = editUi(sources, { action: 'event', name: 'volume.master', command: 'setting', targetValue: 'master_volume' });
  assert.ok(volume.changes.get('ui.js')!.includes('ctx.setting("master_volume", ctx.value);'));
  // Hand-written loops stay source-maintained instead of being guessed into one emitter.
  const opaque = withEmitter('rate="40"');
  opaque.set('ui.js', `event.register("many", (ctx) => { for (const id of ["rain"]) ctx.particles(id).start(); });\n`);
  const opaqueEvent = readUiDesign(opaque).events.find(item => item.name === 'many')!;
  assert.equal(opaqueEvent.editable, false);
});

test('v0.11.3 静态画布按发射区域和纹理生成粒子示意，不执行时钟或随机状态', () => {
  const sources = withEmitter('rate="40"');
  const design = readUiDesign(sources), screen = design.screens.find(item => item.id === 'hud')!, story = readStory(sources);
  const items = previewUi(design, screen, story, undefined, {});
  const node = items.find(item => item.node.id === 'rain')!;
  assert.deepEqual(node.rect, [700, 380, 240, 300]);
  assert.equal(node.image, 'picture');
  assert.equal(node.node.kind, 'particles');
});
