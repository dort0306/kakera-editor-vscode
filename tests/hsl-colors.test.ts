import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatColor, hslaToRgba, parseColor, rgbaToHsla } from '../packages/domain/src/colors';

test('HSL 六色相、亮度边界、透明 RGB 与退化色记忆匹配引擎', () => {
  for (const [h, hex] of [[0, '#FF0000FF'], [60, '#FFFF00FF'], [120, '#00FF00FF'], [180, '#00FFFFFF'], [240, '#0000FFFF'], [300, '#FF00FFFF']] as const) {
    assert.equal(formatColor(hslaToRgba({ h, s: 1, l: .5, a: 1 })), hex);
    assert.equal(rgbaToHsla(parseColor(hex)).l, .5);
  }
  assert.equal(formatColor(hslaToRgba({ h: 0, s: 1, l: .25, a: 0 })), '#80000000');
  for (const hex of ['#FFFFFFFF', '#00000000']) {
    const next = rgbaToHsla(parseColor(hex), 210, .7);
    assert.equal(next.h, 210); assert.equal(next.s, .7);
    assert.equal(formatColor(hslaToRgba(next)), hex);
  }
  assert.equal(rgbaToHsla(parseColor('#808080FF'), 210, .7).h, 210);
  assert.equal(rgbaToHsla(parseColor('#808080FF'), 210, .7).s, 0);
  assert.equal(formatColor(hslaToRgba({ h: NaN, s: Infinity, l: .5, a: NaN })), '#808080FF');
  assert.equal(formatColor(hslaToRgba({ h: -360, s: 2, l: .5, a: 2 })), '#FF0000FF');
});

test('HSL 4096 组 RGBA 往返保留通道，包含透明彩色', () => {
  for (let i = 0; i < 4096; i++) {
    const color = { r: ((i >> 8) & 15) * 17, g: ((i >> 4) & 15) * 17, b: (i & 15) * 17, a: (i * 37) & 255 };
    assert.deepEqual(hslaToRgba(rgbaToHsla(color)), color);
  }
});
