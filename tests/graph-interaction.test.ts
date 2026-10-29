import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act, useState } from 'react';
import { JSDOM } from 'jsdom';
import { StoryGraphView } from '../packages/webview/src/story-graph';
import type { Story, Route } from '../packages/domain/src/index';
test('幕卡拖动在松手时保存；缩放后的拖线、点击连接、取消和键盘移动可用', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://test.local' }); Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  const { createRoot } = await import('react-dom/client'); const node = document.getElementById('root')!, root = createRoot(node);
  const story: Story = { id: 's', entry: 'a', contentVersion: '1', frames: ['a', 'b', 'c'].map(ref => ({ ref, id: ref, text: ref, file: 'story.xml', line: 1, options: ref === 'a' ? [{ id: 'x', text: '路线甲' }, { id: 'y', text: '路线乙' }] : [], speaker: '', visual: '', audio: {} })), files: ['story.xml'], scripts: [], assets: [], variables: [], visuals: [], characters: [] };
  const routes: Route[] = [{ frame: 'a', kind: 'choice', option: 'x', target: 'b', updates: [] }, { frame: 'a', kind: 'choice', option: 'y', target: 'c', updates: [] }, { frame: 'b', kind: 'end', updates: [] }, { frame: 'c', kind: 'end', updates: [] }];
  const moves: any[] = [], wires: any[] = []; let readonly = false;
  function Harness() { const [layout, setLayout] = useState({}); return React.createElement(StoryGraphView, { story, routes, query: '', select: () => {}, layout, disabled: readonly, onLayout: (ref, point) => { moves.push({ ref, point }); setLayout(old => ref ? { ...old, [ref]: point } : {}); }, onReconnect: (ref, target, option) => wires.push({ ref, target, option }) }); }
  const pointer = async (el: Element, type: string, x: number, y: number) => { await act(async () => el.dispatchEvent(new dom.window.MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y }))); };
  const click = async (el: Element) => { await act(async () => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))); };
  const key = async (el: Element, key: string, altKey = false) => { await act(async () => el.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, altKey, bubbles: true }))); };
  try {
    await act(async () => root.render(React.createElement(Harness))); const svg = node.querySelector('.graph-scroll svg')!, card = node.querySelector('[data-frame-ref="a"]')!;
    await pointer(card, 'pointerdown', 40, 60); await pointer(svg, 'pointermove', 160, 140); assert.equal(moves.length, 0); await pointer(svg, 'pointerup', 160, 140);
    assert.deepEqual(moves[0], { ref: 'a', point: { x: 152, y: 128 } });
    await click(node.querySelector('[aria-label="缩小分支图"]')!);
    const port = node.querySelector('[aria-label="从 a 连接：路线甲"]')!; const cx = Number(port.getAttribute('cx')), cy = Number(port.getAttribute('cy'));
    const c = node.querySelector('[data-frame-ref="c"]')!.parentElement!, tx = Number(c.getAttribute('x')) + 30, ty = Number(c.getAttribute('y')) + 50;
    await pointer(port, 'pointerdown', cx * .85, cy * .85); await pointer(svg, 'pointermove', tx * .85, ty * .85); await pointer(svg, 'pointerup', tx * .85, ty * .85);
    assert.deepEqual(wires[0], { ref: 'a', target: 'c', option: 'x' });
    await key(port, 'Enter'); await click(node.querySelector('[aria-label="连接到：b"]')!); assert.equal(wires[1].target, 'b');
    await key(port, 'Enter'); await key(svg, 'Escape'); assert.equal(node.querySelector('.wire-preview'), null); assert.equal(wires.length, 2);
    await key(card, 'ArrowRight', true); assert.equal(moves.at(-1).point.x, 172);
    const moveCount = moves.length; readonly = true; await act(async () => root.render(React.createElement(Harness))); await pointer(card, 'pointerdown', 30, 40); await pointer(svg, 'pointermove', 300, 300); await pointer(svg, 'pointerup', 300, 300); assert.equal(moves.length, moveCount); assert.equal(node.querySelectorAll('.output-port').length, 0);
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});

test('普通点击不被 SVG 捕获；拖动后下一次鼠标或键盘选中不被旧状态吞掉', async () => {  const dom = new JSDOM('<div id="root"></div>', { url: 'https://test.local' }); Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  let captured: Element | undefined;
  Object.assign(dom.window.Element.prototype, { setPointerCapture(this: Element) { captured = this; }, hasPointerCapture(this: Element) { return captured === this; }, releasePointerCapture(this: Element) { if (captured === this) captured = undefined; } });
  const { createRoot } = await import('react-dom/client'), node = document.getElementById('root')!, root = createRoot(node);
  const story: Story = { id: 's', entry: 'a', contentVersion: '1', frames: ['a', 'b'].map(ref => ({ ref, id: ref, text: ref, file: 'story.xml', line: 1, options: [], speaker: '', visual: '', audio: {} })), files: [], scripts: [], assets: [], variables: [], visuals: [], characters: [] };
  const selections: string[] = [], moves: unknown[] = [];
  const props = { story, query: '', select: (ref: string) => selections.push(ref), onLayout: (...args: unknown[]) => moves.push(args) };
  const pointer = async (el: Element, type: string, x = 50, y = 60) => { const event = new dom.window.MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y }); Object.defineProperty(event, 'pointerId', { value: 1 }); await act(async () => el.dispatchEvent(event)); };
  const click = async (el: Element, detail = 1) => { await act(async () => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, detail }))); };
  try {
    await act(async () => root.render(React.createElement(StoryGraphView, props)));
    const svg = node.querySelector('.graph-scroll svg')!, a = node.querySelector('[data-frame-ref="a"] p')!, b = node.querySelector('[data-frame-ref="b"] p')!;
    await pointer(b, 'pointerdown'); assert.equal(captured, undefined, '按下不能提前捕获到 SVG');
    await pointer(b, 'pointermove', 52, 61); assert.equal(captured, undefined); const clickTarget = captured ?? b;
    await pointer(clickTarget, 'pointerup', 52, 61); await click(clickTarget); assert.deepEqual(selections, ['b']); assert.equal(moves.length, 0);
    await pointer(a, 'pointerdown'); await pointer(svg, 'pointermove', 150, 160); assert.equal(captured, svg);
    const dragTarget = captured!; await pointer(dragTarget, 'pointerup', 150, 160); await click(dragTarget); assert.equal(moves.length, 1); assert.deepEqual(selections, ['b']);
    await click(b, 0); assert.deepEqual(selections, ['b', 'b'], '键盘触发的 detail=0 点击不应被拖动吞掉');
    await pointer(a, 'pointerdown'); await pointer(a, 'pointerup'); await click(a); assert.equal(selections.at(-1), 'a');
    await pointer(a, 'pointerdown'); await pointer(svg, 'pointermove', 150, 160); await pointer(svg, 'pointercancel'); captured = undefined; assert.equal(moves.length, 1);
    await act(async () => root.render(React.createElement(StoryGraphView, { ...props, disabled: true })));
    await pointer(b, 'pointerdown'); assert.equal(captured, undefined); await pointer(b, 'pointerup'); await click(b); assert.equal(selections.at(-1), 'b');
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});

test('Ctrl+A 全选、方向键/Shift 扩展、Alt 批量微调与多幕拖动', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://test.local' }); Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  const { createRoot } = await import('react-dom/client'); const node = document.getElementById('root')!, root = createRoot(node);
  const story: Story = { id: 's', entry: 'a', contentVersion: '1', frames: ['a', 'b', 'c'].map(ref => ({ ref, id: ref, text: ref, file: 'story.xml', line: 1, options: [], speaker: '', visual: '', audio: {} })), files: ['story.xml'], scripts: [], assets: [], variables: [], visuals: [], characters: [] };
  const routes: Route[] = [{ frame: 'a', kind: 'advance', target: 'b', updates: [] }, { frame: 'b', kind: 'advance', target: 'c', updates: [] }, { frame: 'c', kind: 'end', updates: [] }];
  const selected: { refs: string[]; primary?: string }[] = [], layouts: { ref: string; point: { x: number; y: number } }[][] = [];
  function Harness() {
    const [selection, setSelection] = useState(['a']), [primary, setPrimary] = useState('a'), [layout, setLayout] = useState({});
    return React.createElement(StoryGraphView, { story, routes, selected: primary, selection, query: '', layout, select: (ref: string) => { setSelection([ref]); setPrimary(ref); }, selectMany: (refs: string[], next?: string) => { selected.push({ refs, primary: next }); setSelection(refs); if (next) setPrimary(next); }, onLayoutMany: (moves: { ref: string; point: { x: number; y: number } }[]) => { layouts.push(moves); setLayout(old => ({ ...old, ...Object.fromEntries(moves.map(move => [move.ref, move.point])) })); } });
  }
  const key = async (key: string, options: { ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean } = {}) => { const surface = node.querySelector('.graph-scroll')!; await act(async () => surface.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options }))); };
  const pointer = async (el: Element, type: string, x: number, y: number) => { const event = new dom.window.MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y }); Object.defineProperty(event, 'pointerId', { value: 1 }); await act(async () => el.dispatchEvent(event)); };
  try {
    await act(async () => root.render(React.createElement(Harness)));
    await key('a', { ctrlKey: true });
    assert.deepEqual(selected.at(-1), { refs: ['a', 'b', 'c'], primary: 'a' });
    assert.equal(node.querySelectorAll('.graph-node.selected').length, 3);
    assert.equal(node.querySelector('.graph-selection')?.textContent, '已选 3 幕');
    await key('ArrowRight'); assert.deepEqual(selected.at(-1), { refs: ['b'], primary: 'b' });
    await key('ArrowRight', { shiftKey: true }); assert.deepEqual(selected.at(-1), { refs: ['b', 'c'], primary: 'c' });
    await key('a', { ctrlKey: true });
    const before = layouts.length; await key('ArrowRight', { altKey: true }); assert.equal(layouts.length, before + 1); assert.equal(layouts.at(-1)!.length, 3);
    assert.deepEqual(layouts.at(-1)!.map(move => move.ref), ['a', 'b', 'c']);
    const card = node.querySelector('[data-frame-ref="a"]')!; const rect = card.getBoundingClientRect(); const svg = node.querySelector('.graph-scroll svg')!; const count = layouts.length;
    await pointer(card, 'pointerdown', rect.left + 10, rect.top + 10); await pointer(svg, 'pointermove', rect.left + 40, rect.top + 30); await pointer(svg, 'pointerup', rect.left + 40, rect.top + 30);
    assert.equal(layouts.length, count + 1); assert.equal(layouts.at(-1)!.length, 3);
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});
