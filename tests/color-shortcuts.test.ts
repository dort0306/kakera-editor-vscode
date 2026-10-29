import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatColor, hsvaToRgba, normalizeColor, parseColor, rgbaToHsva, triangleVertices, triangleWeights, weightsColor } from '../packages/domain/src/colors';
import { normalizeShortcutBinding, shortcutDisplay } from '../packages/domain/src/shortcuts';

test('v0.10.0 颜色严格 HEX、sRGB HSV 与三角重心权重', () => {
  assert.equal(normalizeColor('#10253b'), '#10253BFF');
  assert.equal(normalizeColor('#10253B80'), '#10253B80');
  for (const invalid of ['', '#12345', '#GGGGGG', 'red', ' #FFFFFF', '#FFFFFFFFF']) assert.throws(() => parseColor(invalid));
  assert.equal(formatColor(hsvaToRgba({ h: 0, s: 1, v: 1, a: 1 })), '#FF0000FF');
  assert.equal(formatColor(hsvaToRgba({ h: 120, s: 1, v: 1, a: 1 })), '#00FF00FF');
  assert.equal(formatColor(hsvaToRgba({ h: 240, s: 1, v: 1, a: 1 })), '#0000FFFF');
  assert.equal(formatColor(hsvaToRgba({ h: 0, s: 0, v: 1, a: 0 })), '#FFFFFF00');
  assert.equal(formatColor(hsvaToRgba({ h: 0, s: 0, v: 1, a: Number.NaN })), '#FFFFFFFF');
  const gray = rgbaToHsva(parseColor('#80808000'), 210, .7);
  assert.equal(gray.h, 210); assert.equal(gray.a, 0);
  const black = rgbaToHsva(parseColor('#000000FF'), 210, .7);
  assert.equal(black.v, 0); assert.equal(black.s, .7);
  const weights: [number, number, number] = [.25, .25, .5];
  assert.equal(formatColor(weightsColor(0, weights)), '#804040FF');
  const vertices = triangleVertices({ x: 0, y: 0 }, 10);
  assert.equal(vertices[0].y, -10);
  const roundTrip = triangleWeights(vertices[0], vertices);
  assert.ok(roundTrip[0] > .999);
  assert.ok(triangleWeights({ x: 100, y: 100 }, vertices)[0] >= 0);
});

test('v0.10.0 快捷键规范化、保留组合与显示名', () => {
  assert.equal(normalizeShortcutBinding('Space', 'advance'), 'Space');
  assert.equal(normalizeShortcutBinding('enter', 'advance'), 'Enter');
  assert.equal(normalizeShortcutBinding('shift+ctrl+keyk', 'advance'), 'Ctrl+Shift+KeyK');
  assert.equal(normalizeShortcutBinding('Ctrl', 'fast_forward'), 'Ctrl');
  assert.equal(normalizeShortcutBinding('Alt', 'fast_forward'), 'Alt');
  assert.equal(normalizeShortcutBinding('Digit1', 'skip_sequence'), 'Digit1');
  for (const [binding, action] of [['Escape', 'advance'], ['Ctrl+Alt+KeyK', 'advance'], ['Alt+F4', 'advance'], ['Alt+Tab', 'advance'], ['Ctrl', 'advance'], ['Ctrl+Shift', 'fast_forward'], ['KeyK+KeyJ', 'advance'], ['Unknown', 'advance'], ['Ctrl++KeyK', 'advance'], ['Ctrl+KeyK+KeyJ', 'advance']]) assert.throws(() => normalizeShortcutBinding(binding!, action!), /快捷键|键位|组合|保留|主键|修饰键/);
  assert.equal(shortcutDisplay('Space'), '空格');
  assert.equal(shortcutDisplay('Ctrl'), '按住 Ctrl');
  assert.equal(shortcutDisplay(null), '未绑定');
  assert.equal(shortcutDisplay('Ctrl+KeyK'), 'Ctrl+K');
  assert.equal(shortcutDisplay('Tab'), '制表键');
  assert.equal(shortcutDisplay('Alt+F1'), 'Alt+F1 功能键');
  assert.equal(shortcutDisplay('NumpadAdd'), '小键盘加号');
  assert.equal(shortcutDisplay('Shift+Digit2'), 'Shift+2');
});
