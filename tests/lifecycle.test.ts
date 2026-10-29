import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uiFixture } from './ui-fixture';
import { editUi, readUiDesign } from '../packages/source/src/ui-source';
import { analyzeLogic, readStory } from '../packages/source/src/index';

test('生命周期可视编辑创建、修改与移除，只补丁固定白名单调用并保留原路由/注释', () => {
  let sources = uiFixture();
  const before = new Map(sources);
  const apply = (operation: unknown) => { const result = editUi(sources, operation); sources = new Map([...sources, ...result.changes]); return result; };
  apply({ action: 'lifecycle', kind: 'frameExit', owner: 'a', mode: 'page', target: 'settings' });
  apply({ action: 'lifecycle', kind: 'screenClose', owner: 'settings', mode: 'frame', target: 'a' });
  assert.ok(sources.get('ui.js')!.startsWith(before.get('ui.js')!));
  const design = readUiDesign(sources);
  assert.equal(design.lifecycle!.frameExit.a.target, 'settings');
  assert.equal(design.lifecycle!.screenClose.settings.mode, 'frame');
  assert.equal(sources.get('routes.js'), before.get('routes.js'));
  assert.equal(sources.get('story.xml'), before.get('story.xml'));
  assert.throws(() => editUi(sources, { action: 'deleteScreen', id: 'settings' }), /生命周期/);
  const logic = analyzeLogic(sources, readStory(sources));
  assert.equal(logic.links.length, 2); assert.equal(logic.references.frames.has('a'), true);
  sources.set('ui.js', sources.get('ui.js')!.replace('ctx.resume("a")', 'ctx["resume"](/* 保留注释 */ "a" /* 尾注 */)'));
  apply({ action: 'lifecycle', kind: 'screenClose', owner: 'settings', mode: 'page', target: 'hud' });
  assert.ok(sources.get('ui.js')!.includes('ctx["open"](/* 保留注释 */ "hud" /* 尾注 */)'));
  apply({ action: 'lifecycle', kind: 'screenClose', owner: 'settings', mode: 'continue' });
  assert.ok(sources.get('ui.js')!.includes('ctx["resume"](/* 保留注释 */  /* 尾注 */)'));
  assert.equal(readUiDesign(sources).lifecycle!.screenClose.settings.mode, 'continue');
  apply({ action: 'lifecycle', kind: 'screenClose', owner: 'settings', mode: 'none' });
  apply({ action: 'lifecycle', kind: 'frameExit', owner: 'a', mode: 'none' });
  assert.equal(analyzeLogic(sources, readStory(sources)).lifecycle.length, 0);
  assert.equal(apply({ action: 'lifecycle', kind: 'frameExit', owner: 'a', mode: 'none' }).changes.size, 0);
  for (const op of [
    { kind: 'frameExit', owner: 'a', mode: 'page', target: 'missing' },
    { kind: 'frameExit', owner: 'a', mode: 'frame', target: 'a' },
    { kind: 'screenClose', owner: 'settings', mode: 'frame', target: 'missing' },
    { kind: 'screenClose', owner: 'settings', mode: 'page', target: 'settings' },
    { kind: 'screenClose', owner: 'missing', mode: 'none' },
  ]) assert.throws(() => apply({ action: 'lifecycle', ...op }));
});

test('复杂、重复、动态、间接和非顶层生命周期注册保持只读，不接管作者脚本', () => {
  for (const js of [
    'on.screenClose("settings", ctx => { ctx.message("保留"); ctx.resume("a"); });',
    'on.screenClose("settings", sharedCallback);',
    'on.screenClose("settings", ctx => ctx.resume(target()));',
    'on.screenClose("settings", ctx => ctx.resume()); on.screenClose("settings", ctx => ctx.resume());',
    'on.screenClose(target(), ctx => ctx.resume());',
    'const alias = on; alias.screenClose("settings", ctx => ctx.resume());',
    'function register() { on.screenClose("settings", ctx => ctx.resume()); }',
    'on.screenClose(',
  ]) {
    const sources = uiFixture(); sources.set('ui.js', js);
    assert.equal(readUiDesign(sources).lifecycle!.screenClose.settings.editable, false, js);
    assert.throws(() => editUi(sources, { action: 'lifecycle', kind: 'screenClose', owner: 'settings', mode: 'none' }), Error, js);
    assert.equal(sources.get('ui.js'), js);
  }
});
