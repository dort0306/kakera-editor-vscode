import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act, useState } from 'react';
import { JSDOM } from 'jsdom';
import { ConditionalTargets } from '../packages/webview/src/conditions';
import { validateRoutes, type Route, type Story } from '../packages/domain/src/index';
import { StoryGraphView } from '../packages/webview/src/story-graph';

test('条件表单：bool 下拉、i64 范围、且/或组合、顺序及默认出口，重载不丢值', async () => {
  const dom = new JSDOM('<div id="test-root"></div>', { url: 'https://test.local' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  const { createRoot } = await import('react-dom/client'), node = document.getElementById('test-root')!, root = createRoot(node);
  const story: Story = { id: 's', contentVersion: '1', entry: 'a', assets: [], characters: [], scripts: [], files: [], visuals: [], variables: [{ id: 'flag', type: 'bool', initial: 'false' }, { id: 'score', type: 'int', initial: '0' }], frames: ['a', 'b', 'c'].map(ref => ({ ref, id: ref, text: ref, file: 'story.xml', line: 1, options: [], audio: {}, speaker: '', visual: '' })) };
  let saved: Route = { frame: 'a', kind: 'advance', target: 'c', updates: [] }, readonly = false;
  function Harness() { const [route, setRoute] = useState(saved); return React.createElement('fieldset', { disabled: readonly }, React.createElement(ConditionalTargets, { story, route, change: next => { saved = next; setRoute(next); } })); }
  const button = (text: string) => [...node.querySelectorAll('button')].find(b => b.textContent === text)!;
  const click = async (element: Element) => { assert.ok(element); await act(async () => { element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); }); };
  const select = async (label: string, value: string, index = 0) => { const el = node.querySelectorAll<HTMLSelectElement>(`select[aria-label="${label}"]`)[index]; assert.ok(el); await act(async () => { el.value = value; el.dispatchEvent(new dom.window.Event('change', { bubbles: true })); }); };
  const input = async (label: string, value: string) => { const el = node.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!; assert.ok(el); await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(el, value); el.dispatchEvent(new dom.window.Event('input', { bubbles: true })); }); };
  try {
    await act(async () => root.render(React.createElement(Harness)));
    await click(button('按变量条件分流')); await select('条件比较值', 'false'); await select('条件 1 满足时进入', 'b');
    assert.equal((saved.branches![0].when as any).right.value, 'false');
    await click(button('＋添加条件线路')); await select('条件变量', 'score', 1); await select('比较方式', 'between', 1);
    await input('范围下限', '9007199254740993'); await input('范围上限', '9223372036854775807'); await select('条件 2 满足时进入', 'a');
    assert.equal((saved.branches![1].when as any).left.right.value, '9007199254740993');
    await click(button('下移条件')); assert.equal((saved.branches![0].when as any).kind, 'and'); assert.equal(saved.target, 'c');
    const rangeRule = node.querySelector('.branch-rule')!;
    await click([...rangeRule.querySelectorAll('button')].find(b => b.textContent === '＋任一满足')!);
    assert.equal(saved.branches![0].when.kind, 'or');
    await select('条件组合方式', 'and'); assert.equal(saved.branches![0].when.kind, 'and');
    validateRoutes(story, [saved, { frame: 'b', kind: 'end', updates: [] }, { frame: 'c', kind: 'end', updates: [] }]);
    await act(async () => root.render(React.createElement(Harness, { key: 'reload' })));
    assert.equal(node.querySelector<HTMLInputElement>('[aria-label="范围下限"]')!.value, '9007199254740993');
    readonly = true; await act(async () => root.render(React.createElement(Harness, { key: 'reload' })));
    assert.equal(node.querySelector('fieldset')!.disabled, true);
    const wires: unknown[][] = [];
    await act(async () => root.render(React.createElement(StoryGraphView, { story, routes: [saved, { frame: 'b', kind: 'end', updates: [] }, { frame: 'c', kind: 'end', updates: [] }], query: '', select: () => {}, onReconnect: (...args) => wires.push(args) })));
    const ports = node.querySelectorAll('.output-port'); assert.equal(ports.length, 5);
    const keyboard = async (el: Element) => { await act(async () => el.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))); };
    await keyboard(ports[0]); await click(node.querySelector('[aria-label="连接到：c"]')!); assert.deepEqual(wires.at(-1), ['a', 'c', undefined, 0]);
    await keyboard(ports[1]); await click(node.querySelector('[aria-label="连接到：b"]')!); assert.deepEqual(wires.at(-1), ['a', 'b', undefined, 1]);
    await keyboard(ports[2]); await click(node.querySelector('[aria-label="连接到：a"]')!); assert.deepEqual(wires.at(-1), ['a', 'a', undefined, undefined]);
    await click(node.querySelector('.graph-edge')!); await click(button('断开所选连线')); assert.deepEqual(wires.at(-1), ['a', '', undefined, 0]);
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});
