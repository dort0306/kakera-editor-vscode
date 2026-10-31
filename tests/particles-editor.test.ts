import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act, useState } from 'react';
import { JSDOM } from 'jsdom';
import { UiEditor } from '../packages/webview/src/ui-editor';
import { readUiDesign, editUi } from '../packages/source/src/ui-source';
import { readStory } from '../packages/source/src/index';
import type { EditorState } from '../packages/protocol/src/index';
import { uiFixture } from './ui-fixture';

/** Fixture with one emitter on the `hud` page plus a decodable texture preview. */
function particleFixture() {
  const sources = uiFixture();
  sources.set('ui/pages/hud.xml', sources.get('ui/pages/hud.xml')!.replace('</screen>', `<particles id="rain" x="700" y="380" width="240" height="300" image="picture" rate="40" burst="24" max="64" life="0.5" size="8" /><particles id="spark" x="700" y="40" width="240" height="300" image="picture" burst="36" /></screen>`));
  return sources;
}

test('v0.11.3 粒子画布示意、预设、快捷键与事件向导写入对应命令', async () => {
  const dom = new JSDOM('<div id="test-root"></div>', { url: 'https://test.local' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  const { createRoot } = await import('react-dom/client'), node = document.getElementById('test-root')!, root = createRoot(node);
  let sources = particleFixture(), revision = 1, patchState: (state: EditorState) => void = () => {}, lastError = '';
  const packets: { type: string; payload: any }[] = [];
  const state = (): EditorState => ({ revision: String(revision), ui: readUiDesign(sources), uiScreen: 'hud', uiSelected: '', story: readStory(sources), writable: true, images: {}, issues: [], uiTextures: { picture: { uri: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', width: 8, height: 8 } } });
  function Harness() {
    const [current, setCurrent] = useState(state()); patchState = setCurrent;
    return React.createElement(UiEditor, { state: current, onDirty: () => {}, onBack: () => {}, send: (before, type, payload = {}) => {
      const id = `request.${packets.length}`; packets.push({ type, payload });
      if (type === 'uiEdit') {
        assert.equal(before.revision, String(revision));
        try {
          const result = editUi(sources, payload.operation); sources = new Map([...sources, ...result.changes]); revision++;
          queueMicrotask(() => setCurrent({ ...state(), appliedRequestId: id, uiScreen: result.screen ?? current.uiScreen, uiSelected: result.selected ?? current.uiSelected }));
        } catch (e) { lastError = e instanceof Error ? e.message : String(e); }
      }
      return id;
    } });
  }
  const button = (text: string) => [...node.querySelectorAll('button')].find(item => item.textContent === text)!;
  const click = async (element: Element) => { assert.ok(element, 'target element'); await act(async () => { element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); }); };
  const key = async (name: string, init: Record<string, boolean> = {}) => { await act(async () => { dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init })); }); };
  const input = async (label: string, value: string) => { const element = node.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!; assert.ok(element, label); await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new dom.window.Event('input', { bubbles: true })); }); };
  const select = async (label: string, value: string) => { const element = node.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!; assert.ok(element, label); await act(async () => { element.value = value; element.dispatchEvent(new dom.window.Event('change', { bubbles: true })); }); };
  const tree = (id: string) => [...node.querySelectorAll('.ui-tree-node')].find(item => item.textContent?.includes(id))!;
  try {
    await act(async () => root.render(React.createElement(Harness)));
    // Static emitter preview: dashed region plus deterministic sample textures, no engine clock.
    assert.ok(node.querySelector('[data-ui-node="rain"] image'), '粒子示意应使用已声明纹理');
    assert.match(node.querySelector('[data-ui-node="rain"]')!.textContent ?? '', /粒子 · picture · 40\/s · burst 24/);
    assert.ok((node.querySelector('[data-ui-node="rain"]')!.querySelectorAll('image').length) >= 8);
    const kinds = [...node.querySelectorAll<HTMLSelectElement>('select[aria-label="控件类型"] option')].map(option => option.getAttribute('value'));
    assert.ok(kinds.includes('particles'), '添加控件应提供粒子发射器');
    // Emitter presets only fill the draft until "保存属性" writes it.
    await click(tree('rain'));
    await click(button('雨'));
    assert.equal(node.querySelector<HTMLInputElement>('[aria-label="UI rate"]')!.value, '55');
    await click(button('保存属性'));
    let operation = packets.at(-1)!.payload.operation;
    assert.equal(operation.action, 'patchNode'); assert.equal(operation.id, 'rain');
    assert.equal(operation.patch.rate, '55'); assert.equal(operation.patch.burst, ''); assert.equal(operation.patch.autostart, 'true');
    // Ctrl+C / Ctrl+V duplicate the copied control; Delete removes the selected one.
    await click(tree('rain'));
    await key('c', { ctrlKey: true });
    await key('v', { ctrlKey: true });
    operation = packets.at(-1)!.payload.operation;
    assert.deepEqual([operation.action, operation.id], ['duplicateNode', 'rain']);
    const duplicate = readUiDesign(sources).screens.find(screen => screen.id === 'hud')!.children.filter(item => item.kind === 'particles').map(item => item.id).find(id => id !== 'rain' && id !== 'spark')!;
    assert.ok(duplicate, '粘贴应生成新 ID 副本');
    await key('Delete');
    assert.deepEqual([packets.at(-1)!.payload.operation.action, packets.at(-1)!.payload.operation.id], ['deleteNode', duplicate]);
    // Ctrl+D duplicates and Ctrl+S saves the property draft.
    await click(tree('rain'));
    await key('d', { ctrlKey: true });
    assert.equal(packets.at(-1)!.payload.operation.action, 'duplicateNode');
    await click(tree('rain'));
    await input('UI max', '200');
    await key('s', { ctrlKey: true });
    operation = packets.at(-1)!.payload.operation;
    assert.deepEqual([operation.action, operation.patch.max], ['patchNode', '200']);
    // Insert palette writes a new emitter with the chosen texture.
    await select('控件类型', 'particles'); await select('新控件图片', 'picture'); await click(button('添加控件'));
    operation = packets.at(-1)!.payload.operation;
    assert.deepEqual([operation.action, operation.kind, operation.image], ['addNode', 'particles', 'picture']);
    // Event wizard exposes the fixed ctx.particles command.
    await click(button('＋新建事件'));
    await input('UI 表单 name', 'rain.burst');
    await select('UI 表单 command', 'particles');
    await select('UI 表单 target', 'spark');
    await select('UI 表单 particleAction', 'burst');
    await click(button('保存设置'));
    operation = packets.at(-1)!.payload.operation;
    assert.deepEqual([operation.action, operation.command, operation.targetValue, operation.particleAction], ['event', 'particles', 'spark', 'burst']);
    assert.ok(sources.get('ui.js')!.includes('event.register("rain.burst", (ctx) => { ctx.particles("spark").burst(); });'));
    const event = readUiDesign(sources).events.find(item => item.name === 'rain.burst')!;
    assert.deepEqual([event.command, event.commandTarget, event.particleAction], ['particles', 'spark', 'burst']);
    // Editing an existing command keeps its action instead of defaulting to start.
    const eventRow = [...node.querySelectorAll('.event-row')].find(row => row.textContent?.includes('rain.burst'))!;
    await click(eventRow.querySelector('button')!);
    assert.equal(node.querySelector<HTMLSelectElement>('select[aria-label="UI 表单 particleAction"]')!.value, 'burst');
    await select('UI 表单 particleAction', 'stop');
    await click(button('保存设置'));
    const edited = readUiDesign(sources).events.find(item => item.name === 'rain.burst')!;
    assert.deepEqual([edited.commandTarget, edited.particleAction], ['spark', 'stop']);
    assert.ok(sources.get('ui.js')!.includes('ctx.particles("spark").stop();'));
    // A burst-only emitter is refused by start, and the host keeps the source unchanged.
    await click(button('＋新建事件'));
    await input('UI 表单 name', 'spark.start');
    await select('UI 表单 command', 'particles');
    await select('UI 表单 target', 'spark');
    await select('UI 表单 particleAction', 'start');
    await click(button('保存设置'));
    assert.match(lastError, /没有 rate/);
    assert.ok(!sources.get('ui.js')!.includes('spark.start'));
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});
