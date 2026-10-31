import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act, useState } from 'react';
import { JSDOM } from 'jsdom';
import { UiEditor } from '../packages/webview/src/ui-editor';
import { readUiDesign, editUi } from '../packages/source/src/ui-source';
import { readStory, type Sources } from '../packages/source/src/index';
import { uiNodes } from '../packages/domain/src/ui';
import type { EditorState } from '../packages/protocol/src/index';

function fixture(): Sources {
  return new Map([
    ['story.xml', '<story schema="8" id="s" content-version="1" entry="a"><interface src="ui.xml"/><scripts><script src="ui.js"/></scripts><frames><frame id="a"><text>台词</text></frame></frames><next end="true"/></story>'],
    ['ui.js', 'ui("backgroundPicker").bind("color-bg", (ctx) => { ctx.setUi("bgDraft", ctx.value); });\nui("advance").bind("advance", (ctx) => { ctx.advance(); });\nui("$host").bind("shortcut-captured", (ctx) => { ctx.setUi("shortcutDraft", ctx.value); });\n'],
    ['ui.xml', `<ui schema="3" width="1280" height="720" initial="hud"><variables><string id="bgDraft" initial="#10253BFF"/><string id="shortcutDraft" initial=""/></variables><palette><color id="dialogue_background" initial="#10253BFF"/></palette><screen id="hud" modal="false" pause="false"><panel id="panel" x="20" y="20" width="300" height="120" color="#263B4B"/><color-picker id="backgroundPicker" x="40" y="160" width="256" height="320" value="ui.bgDraft" event="color-bg"/><button id="advance" x="40" y="520" width="200" height="40" text="继续" event="advance"/></screen></ui>`]
  ]);
}

test('UI 编辑器接入 palette、color-picker、HSL 选色器、快捷键事件和快捷弹窗', async () => {
  const dom = new JSDOM('<div id="test-root"></div>', { url: 'https://test.local' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, SVGSVGElement: dom.window.SVGSVGElement, IS_REACT_ACT_ENVIRONMENT: true });
  const { createRoot } = await import('react-dom/client'), node = document.getElementById('test-root')!, root = createRoot(node);
  let sources = fixture(), revision = 1, update: (state: EditorState) => void = () => {};
  const state = (): EditorState => ({ revision: String(revision), ui: readUiDesign(sources), uiScreen: 'hud', uiSelected: '', story: readStory(sources), writable: true, images: {}, issues: [] });
  const packets: { type: string; payload: any }[] = [];
  function Harness() {
    const [current, setCurrent] = useState(state()); update = setCurrent;
    return React.createElement(UiEditor, { state: current, onDirty: () => {}, onBack: () => {}, send: (before, type, payload = {}) => {
      const id = `request.${packets.length}`; packets.push({ type, payload });
      if (type === 'uiEdit') {
        const result = editUi(sources, payload.operation); sources = new Map([...sources, ...result.changes]); revision++;
        queueMicrotask(() => setCurrent({ ...state(), appliedRequestId: id, uiScreen: result.screen ?? current.uiScreen, uiSelected: result.selected ?? current.uiSelected }));
      }
      return id;
    } });
  }
  const button = (text: string) => [...node.querySelectorAll('button')].find(item => item.textContent === text)!;
  const click = async (element: Element) => { assert.ok(element); await act(async () => { element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); }); };
  const input = async (label: string, value: string) => { const element = node.querySelector<HTMLInputElement>(`[aria-label="${label}"]`); assert.ok(element); await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new dom.window.Event('input', { bubbles: true })); }); };
  const select = async (label: string, value: string) => { const element = node.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`); assert.ok(element); await act(async () => { element.value = value; element.dispatchEvent(new dom.window.Event('change', { bubbles: true })); }); };
  try {
    await act(async () => root.render(React.createElement(Harness)));
    await click([...node.querySelectorAll('.ui-tree-node')].find(item => item.textContent?.includes('panel'))!);
    const originalColor = uiNodes(readUiDesign(sources).screens[0].children).find(item => item.id === 'panel')!.attrs.color;
    assert.ok(node.querySelector('[aria-label="UI color-bind"]')); assert.ok(node.querySelector('[aria-label="颜色 #RRGGBB / #RRGGBBAA"]'));
    const swatch = node.querySelector<HTMLButtonElement>('[aria-label="颜色 #RRGGBB / #RRGGBBAA：打开 HSL 选色器"]')!; assert.ok(swatch);
    await click(swatch);
    const picker = node.querySelector<SVGSVGElement>('svg[aria-label="HSL 正方形选色器"]')!; assert.ok(picker);
    await act(async () => Object.defineProperty(picker, 'getBoundingClientRect', { value: () => ({ left: 0, top: 0, width: 260, height: 300, right: 260, bottom: 300, x: 0, y: 0, toJSON: () => ({}) }) }));
    await act(async () => { const event = new dom.window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 130, clientY: 10 }); Object.defineProperty(event, 'pointerId', { value: 1 }); picker.dispatchEvent(event); });
    const fieldColor = node.querySelector<HTMLInputElement>('[aria-label="颜色 #RRGGBB / #RRGGBBAA"]')!, chosen = fieldColor.value;
    assert.notEqual(chosen, originalColor);
    await act(async () => { const event = new dom.window.MouseEvent('pointerup', { bubbles: true, button: 0, clientX: 130, clientY: 10 }); Object.defineProperty(event, 'pointerId', { value: 1 }); picker.dispatchEvent(event); });
    assert.equal(fieldColor.value, chosen);
    await click(button('保存属性'));
    assert.notEqual(uiNodes(readUiDesign(sources).screens[0].children).find(item => item.id === 'panel')!.attrs.color, originalColor);

    await click(button('＋新增配色槽位')); await input('UI 表单 palette id', 'accent');
    const paletteColor = node.querySelector<HTMLInputElement>('[aria-label="配色初值"]')!;
    await input('配色初值', '#FF00FFFF'); await act(async () => paletteColor.dispatchEvent(new dom.window.FocusEvent('focusout', { bubbles: true })));
    await click(button('保存设置'));
    assert.equal(readUiDesign(sources).palette.find(slot => slot.id === 'accent')!.initial, '#FF00FFFF');

    await select('控件类型', 'color-picker'); await select('新控件颜色变量', 'ui.bgDraft'); await select('新控件事件', 'backgroundPicker\u0000color-bg'); await click(button('添加控件'));
    assert.ok(readUiDesign(sources).screens[0].children.some(item => item.kind === 'color-picker' && item.attrs.value === 'ui.bgDraft'));
    await select('新控件事件', ''); await click(button('添加控件'));
    const autoPicker = readUiDesign(sources).screens[0].children.filter(item => item.kind === 'color-picker').at(-1)!;
    const autoEvent = readUiDesign(sources).events.find(event => event.name === autoPicker.attrs.event)!;
    assert.equal(autoEvent.command, 'setUi'); assert.equal(autoEvent.commandTarget, 'bgDraft');
    assert.ok(sources.get('ui.js')!.includes('ctx.setUi("bgDraft", ctx.value);'));
    await select('新控件颜色变量', ''); await select('新控件事件', ''); await click(button('添加控件'));
    const freshPicker = readUiDesign(sources).screens[0].children.filter(item => item.kind === 'color-picker').at(-1)!;
    const freshName = freshPicker.attrs.value.slice(3);
    assert.match(freshName, /^color[0-9a-f]+$/);
    assert.equal(readUiDesign(sources).variables.find(variable => variable.id === freshName)!.initial, '#FFFFFFFF');

    await click(button('＋快捷弹窗')); await input('UI 表单 title', '退出确认'); await input('UI 表单 popupConfirm', '退出'); await select('UI 表单 accept', 'quit'); await click(button('保存设置'));
    const popup = readUiDesign(sources).screens.find(item => uiNodes(item.children).some(child => child.attrs.text === '退出确认'))!;
    assert.ok(popup && popup.attrs.modal === 'true'); assert.ok(sources.get('ui.js')!.includes('ctx.quit();'));

    await click(button('＋新建事件'));
    const commandOptions = [...node.querySelectorAll<HTMLOptionElement>('select[aria-label="UI 表单 command"] option')].map(option => option.textContent ?? '');
    assert.equal(commandOptions.some(text => /v0\.10\.[01]/.test(text)), false);
    await click(button('取消'));

    await click(button('＋新建事件')); await input('UI 表单 name', 'shortcut-set'); await select('UI 表单 command', 'keybinding'); await select('UI 表单 actionValue', 'advance'); await input('UI 表单 binding', 'enter'); await click(button('保存设置'));
    const binding = readUiDesign(sources).events.find(event => event.name === 'shortcut-set')!; assert.equal(binding.command, 'keybinding'); assert.equal(binding.binding, 'Enter'); assert.ok(sources.get('ui.js')!.includes('ctx.keybinding("advance", "Enter");'));

    await click(button('＋新建事件')); await input('UI 表单 name', 'shortcut-capture'); await select('UI 表单 command', 'captureShortcut'); await select('UI 表单 actionValue', 'fast_forward'); await select('UI 表单 resultEvent', 'shortcut-captured'); await click(button('保存设置'));
    assert.ok(sources.get('ui.js')!.includes('ctx.captureShortcut("fast_forward", "shortcut-captured");'));

    await click(button('＋新建事件')); await input('UI 表单 name', 'color-apply'); await select('UI 表单 command', 'colorPreference'); await select('UI 表单 slot', 'accent'); await input('UI 表单 color', '#00FF00FF'); await click(button('保存设置'));
    assert.ok(sources.get('ui.js')!.includes('ctx.colorPreference("accent", "#00FF00FF");'));

    await click(button('＋新建事件')); await input('UI 表单 name', 'color-draft'); await select('UI 表单 command', 'colorPreference'); await select('UI 表单 slot', 'accent'); await select('UI 表单 colorSource', 'ui'); await select('UI 表单 colorVariable', 'bgDraft'); await click(button('保存设置'));
    assert.ok(sources.get('ui.js')!.includes('ctx.colorPreference("accent", ctx.ui.bgDraft);'));
    assert.equal(readUiDesign(sources).events.find(event => event.name === 'color-draft')!.colorVariable, 'bgDraft');
    const draftRow = [...node.querySelectorAll('.event-row')].find(row => row.textContent?.includes('color-draft'))!; assert.ok(draftRow);
    await click(draftRow.querySelector('button')!);
    assert.equal(node.querySelector<HTMLSelectElement>('select[aria-label="UI 表单 colorSource"]')!.value, 'ui');
    assert.equal(node.querySelector<HTMLSelectElement>('select[aria-label="UI 表单 colorVariable"]')!.value, 'bgDraft');
    await click(button('取消'));

    await click(button('＋新增 UI 变量')); await input('UI 表单 name', 'tempVariable'); await input('UI 表单 initial', 'true'); await click(button('保存设置'));
    assert.equal(readUiDesign(sources).variables.some(variable => variable.id === 'tempVariable'), true);
    const variableRow = [...node.querySelectorAll('.variable-row')].find(row => row.textContent?.includes('tempVariable'))!; assert.ok(variableRow);
    await click([...variableRow.querySelectorAll('button')].find(item => item.textContent === '删除')!);
    assert.equal(readUiDesign(sources).variables.some(variable => variable.id === 'tempVariable'), false);
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});
