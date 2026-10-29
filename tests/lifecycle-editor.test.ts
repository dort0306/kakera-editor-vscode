import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { LifecycleEditor } from '../packages/webview/src/lifecycle-editor';
import { readUiDesign } from '../packages/source/src/ui-source';
import { readStory } from '../packages/source/src/index';
import { uiFixture } from './ui-fixture';
import type { EditorState } from '../packages/protocol/src/index';

test('幕生命周期表单校验目标、过期草稿与只读保护，发送带 revision 的宿主请求', async () => {
  const dom = new JSDOM('<div id="test-root"></div>', { url: 'https://test.local' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  const { createRoot } = await import('react-dom/client'), root = createRoot(document.getElementById('test-root')!);
  const sources = uiFixture();
  let state: EditorState = { revision: '1', story: readStory(sources), ui: readUiDesign(sources), writable: true, images: {}, issues: [] };
  let dirty = false; const packets: any[] = [];
  const render = () => act(async () => root.render(React.createElement(LifecycleEditor, { state, kind: 'frameExit', owner: 'a', onDirty: v => { dirty = v; }, save: (operation, revision) => { packets.push({ operation, revision }); return 'request1'; } })));
  const select = async (label: string, value: string) => { const el = document.querySelector<HTMLSelectElement>(`[aria-label="${label}"]`)!; await act(async () => { el.value = value; el.dispatchEvent(new dom.window.Event('change', { bubbles: true })); }); };
  const button = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent === text)!;
  const click = (text: string) => act(async () => button(text).click());
  try {
    await render(); await select('frameExit 动作', 'page'); assert.equal(dirty, true);
    assert.equal(button('保存结束后动作').disabled, true);
    await select('frameExit 目标', 'settings');
    state = { ...state, revision: '2' }; await render(); assert.equal(button('保存结束后动作').disabled, true);
    assert.equal(document.querySelector<HTMLSelectElement>('[aria-label="frameExit 目标"]')!.value, 'settings');
    await click('还原结束后动作'); await select('frameExit 动作', 'page'); await select('frameExit 目标', 'settings');
    await click('保存结束后动作');
    assert.deepEqual(packets, [{ operation: { action: 'lifecycle', kind: 'frameExit', owner: 'a', mode: 'page', target: 'settings' }, revision: '2' }]);
    await act(async () => window.dispatchEvent(new dom.window.MessageEvent('message', { data: { type: 'error', requestId: 'request1', message: '测试冲突' } })));
    assert.ok(document.body.textContent?.includes('测试冲突')); assert.equal(dirty, true);
    state = { ...state, writable: false }; await render();
    assert.equal(document.querySelector('[aria-label="frameExit 动作"]')!.matches(':disabled'), true);
    await click('保存结束后动作'); assert.equal(packets.length, 1);
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});
