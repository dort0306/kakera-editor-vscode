import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import type { EditorState } from '../packages/protocol/src/index';
import type { Story, Route } from '../packages/domain/src/index';
const story: Story = { id: 'test', entry: 'a', contentVersion: '1', frames: ['a', 'b', 'c'].map(id => ({ ref: id, id, text: `幕 ${id}`, speaker: '', visual: '', audio: {}, options: id === 'a' ? [{ id: 'left', text: '左路' }, { id: 'right', text: '右路' }] : [], file: 'story.xml', line: 1 })), assets: [{ id: 'red', src: 'red.png', kind: 'image', file: 'story.xml' }, { id: 'blue', src: 'blue.png', kind: 'image', file: 'story.xml' }], visuals: [], variables: [], characters: [{ id: 'lin', name: '凛' }], files: ['story.xml'], scripts: [] };
const routes: Route[] = [{ frame: 'a', kind: 'choice', option: 'left', target: 'b', updates: [] }, { frame: 'a', kind: 'choice', option: 'right', target: 'c', updates: [] }, { frame: 'b', kind: 'end', updates: [] }, { frame: 'c', kind: 'end', updates: [] }];
test('React 表单实际输入/保存：标题、人物改名和批量外观；分支卡片可导航', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://kakera.test' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  const { createRoot } = await import('react-dom/client');
  const { ProjectSettings } = await import('../packages/webview/src/project-settings');
  const { StoryGraphView } = await import('../packages/webview/src/story-graph');
  const node = document.getElementById('root')!, root = createRoot(node), sent: { id: string; type: string; payload: any }[] = [];
  let state: EditorState = { revision: '1', story, routes, title: { file: 'ui.xml', text: '原标题' }, writable: true, issues: [], images: {}, characterLooks: { lin: [] } };
  const send = (_state: EditorState, type: string, payload: Record<string, unknown> = {}) => { const id = `request-${sent.length}`; sent.push({ id, type, payload }); return id; };
  const render = async () => { await act(async () => { root.render(React.createElement(ProjectSettings, { state, send, command: () => {}, currentFrame: 'a', onDirty: () => {} })); }); };
  const button = (label: string) => [...node.querySelectorAll('button')].find(b => b.textContent === label)!;
  const click = async (element: Element) => { assert.ok(element); await act(async () => { element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); }); };
  const input = async (label: string, value: string) => {
    const element = node.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
    await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
  };
  try {
    await render(); await input('游戏标题', '雨中的约定'); await click(button('保存标题'));
    assert.deepEqual(sent.at(-1)!.payload, { title: '雨中的约定', fixed: false });
    state = { ...state, revision: '2', appliedRequestId: sent.at(-1)!.id, title: { file: 'ui.xml', text: '雨中的约定' } }; await render();
    await click(button('人物')); await input('人物名字', '小凛'); await click(button('保存名字'));
    assert.deepEqual(sent.at(-1)!.payload, { id: 'lin', name: '小凛' });
    state = { ...state, revision: '3', appliedRequestId: sent.at(-1)!.id, story: { ...story, characters: [{ id: 'lin', name: '小凛' }] } }; await render();
    const images = node.querySelector<HTMLSelectElement>('select[aria-label="选择一批立绘"]')!;
    await act(async () => { for (const option of images.options) option.selected = true; images.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
    await click(button('添加所选外观')); assert.deepEqual(sent.at(-1)!.payload, { characterId: 'lin', looks: [{ image: 'red' }, { image: 'blue' }] });
    const selected: string[] = [];
    await act(async () => { root.render(React.createElement(StoryGraphView, { story, routes, selected: 'a', query: '', select: (id: string) => selected.push(id) })); });
    assert.equal(node.querySelectorAll('.graph-node').length, 3); assert.ok(node.textContent?.includes('左路')); assert.ok(node.textContent?.includes('右路'));
    const colors = [...node.querySelectorAll('.graph-edge')].map(e => e.getAttribute('data-branch-color')); assert.equal(new Set(colors).size, 2);
    const markers = [...node.querySelectorAll('marker')].map(e => e.getAttribute('fill')); assert.deepEqual(new Set(markers), new Set(colors));
    const cards = [...node.querySelectorAll('.graph-node')]; await click(cards.find(c => c.textContent?.includes('幕 b'))!); assert.deepEqual(selected, ['b']);
    const b = cards.find(c => c.textContent?.includes('幕 b'))!.parentElement!, c = cards.find(c => c.textContent?.includes('幕 c'))!.parentElement!; assert.notEqual(b.getAttribute('y'), c.getAttribute('y'));
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});
