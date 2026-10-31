import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act, useState } from 'react';
import { JSDOM } from 'jsdom';
import { HslPicker, pickerGeometry } from '../packages/webview/src/color-picker';

test('HSL 选色器按引擎尺寸契约居中，alpha 条紧随色盘且无内置预览/HEX', () => {
  const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
  const plain = pickerGeometry(128, 128, false)!; assert.ok(plain); close(plain.center.x, 64); close(plain.center.y, 64);
  close(plain.outer, 58); close(plain.inner, 58 * .82); close(plain.square.side, 58 * .78 * Math.SQRT2);
  assert.equal(plain.alphaBar, undefined);
  const compact = pickerGeometry(128, 154, true)!; assert.ok(compact); close(compact.center.y, 64);
  assert.deepEqual(compact.alphaBar, { x: 8, y: 136, width: 112, height: 18 });
  const normal = pickerGeometry(256, 282, true)!; assert.ok(normal); close(normal.center.y, 128);
  assert.deepEqual(normal.alphaBar, { x: 8, y: 264, width: 240, height: 18 });
  const tall = pickerGeometry(256, 320, true)!; assert.ok(tall); close(tall.center.y, 147);
  assert.deepEqual(tall.alphaBar, { x: 8, y: 283, width: 240, height: 18 });
  const wide = pickerGeometry(400, 282, true)!; assert.ok(wide); close(wide.center.x, 200); close(wide.outer, 122);
  assert.deepEqual(wide.alphaBar, { x: 8, y: 264, width: 384, height: 18 });
  const narrowTall = pickerGeometry(128, 400, false)!; assert.ok(narrowTall); close(narrowTall.center.y, 200);
  assert.equal(pickerGeometry(128, 153, true), undefined);
  assert.equal(pickerGeometry(128, 128, true), undefined);
  assert.equal(pickerGeometry(127, 400, false), undefined);
  assert.equal(pickerGeometry(Number.NaN, 400, false), undefined);
});

test('HSL 隐藏 alpha 保留透明 RGB，外部颜色重新定位，取消和只读停止手势', async () => {
  const dom = new JSDOM('<div id="root"></div>');
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, SVGSVGElement: dom.window.SVGSVGElement, IS_REACT_ACT_ENVIRONMENT: true });
  const { createRoot } = await import('react-dom/client'), container = document.getElementById('root')!, root = createRoot(container);
  let setValue!: (value: string) => void, setDisabled!: (value: boolean) => void;
  let value = '', changes = 0;
  function Harness() {
    const [color, update] = useState('#FF000080'), [disabled, lock] = useState(false);
    setValue = update; setDisabled = lock; value = color;
    return React.createElement(HslPicker, { value: color, alpha: false, disabled, onChange: next => { changes++; update(next); } });
  }
  const pointer = async (type: string, x: number, y: number, target: EventTarget) => act(async () => {
    const event = new dom.window.MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
    Object.defineProperty(event, 'pointerId', { value: 1 }); target.dispatchEvent(event);
  });
  try {
    await act(async () => root.render(React.createElement(Harness)));
    const svg = container.querySelector('svg')!;
    Object.defineProperty(svg, 'getBoundingClientRect', { value: () => ({ left: 0, top: 0, width: 260, height: 300 }) });
    const square = container.querySelector('[data-hsl-square]')!, x = +square.getAttribute('x')!, y = +square.getAttribute('y')!, side = +square.getAttribute('width')!;
    assert.equal(container.querySelector('[data-picker-area="alpha"]'), null);
    await pointer('pointerdown', x + side * .25, y + side * .25, svg);
    await pointer('pointerup', x + side * .25, y + side * .25, window);
    assert.equal(value, '#CFAFAF80');
    await act(async () => setValue('#00FF0080'));
    assert.equal(container.querySelector('[aria-label="色相 H"]')!.getAttribute('aria-valuenow'), '120');
    await pointer('pointerdown', x + side / 2, y + side / 2, svg);
    await act(async () => window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    const afterCancel = changes;
    await pointer('pointermove', x + side, y, window); await pointer('pointerup', x + side, y, window);
    assert.equal(changes, afterCancel);
    await pointer('pointerdown', x + side / 2, y + side / 2, svg);
    await act(async () => setDisabled(true));
    const afterDisabled = changes;
    await pointer('pointermove', x, y + side, window); await pointer('pointerup', x, y + side, window);
    await pointer('pointerdown', x, y + side, svg);
    assert.equal(changes, afterDisabled);
    assert.equal(container.querySelector('[data-picker-area="square"]')!.getAttribute('tabindex'), '-1');
    assert.equal(value.slice(-2), '80');
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});
