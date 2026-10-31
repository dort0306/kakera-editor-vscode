import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act, useState } from 'react';
import { JSDOM } from 'jsdom';
import { UiEditor } from '../packages/webview/src/ui-editor';
import { readUiDesign, editUi } from '../packages/source/src/ui-source';
import { readStory } from '../packages/source/src/index';
import { uiNodes } from '../packages/domain/src/ui';
import type { EditorState } from '../packages/protocol/src/index';
import { uiFixture } from './ui-fixture';

test('UI 编辑器表单、页面/控件创建、事件和变量请求实际生成对应源码，冲突保留草稿', async () => {
  const dom = new JSDOM('<div id="test-root"></div>', { url: 'https://test.local' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  const { createRoot } = await import('react-dom/client'), node = document.getElementById('test-root')!, root = createRoot(node);
  let sources = uiFixture(), revision = 1, patchState: (s: EditorState) => void = () => {}, dirty = false;
  sources.set('story.xml', sources.get('story.xml')!.replace('</assets>', '<cg id="cg.promise" src="assets/cg/promise.png"/></assets>'));
  const packets: { type: string; payload: any }[] = [];
  const state = (): EditorState => ({ revision: String(revision), ui: readUiDesign(sources), uiScreen: 'hud', uiSelected: '', story: readStory(sources), writable: true, images: {}, issues: [] });
  function Harness() {
    const [current, setCurrent] = useState(state()); patchState = setCurrent;
    return React.createElement(UiEditor, { state: current, onDirty: value => { dirty = value; }, onBack: () => {}, send: (before, type, payload = {}) => {
      const id = `request.${packets.length}`; packets.push({ type, payload });
      if (type === 'uiEdit') {
        assert.equal(before.revision, String(revision));
        const result = editUi(sources, payload.operation); sources = new Map([...sources, ...result.changes]); revision++;
        queueMicrotask(() => setCurrent({ ...state(), appliedRequestId: id, uiScreen: result.screen ?? current.uiScreen, uiSelected: result.selected ?? current.uiSelected }));
      }
      return id;
    } });
  }
  const button = (text: string) => [...node.querySelectorAll('button')].find(b => b.textContent === text)!;
  const click = async (el: Element) => { assert.ok(el); await act(async () => { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); }); };
  const input = async (label: string, value: string) => { const el = node.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!; assert.ok(el); const prototype = el.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype; await act(async () => { Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(el, value); el.dispatchEvent(new dom.window.Event('input', { bubbles: true })); }); };
  const select = async (label: string, value: string) => { const el = node.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!; assert.ok(el); await act(async () => { el.value = value; el.dispatchEvent(new dom.window.Event('change', { bubbles: true })); }); };
  try {
    await act(async () => root.render(React.createElement(Harness)));
    await click([...node.querySelectorAll('.ui-tree-node')].find(n => n.textContent?.includes('caption'))!);
    await input('UI text', '改过的文字\n第二行'); assert.equal(dirty, true); assert.equal(button('返回分镜').disabled, true);
    await click(button('保存属性')); assert.equal(uiNodes(readUiDesign(sources).screens[0].children).find(n => n.id === 'caption')!.attrs.text, '改过的文字\n第二行'); assert.equal(dirty, false);
    await select('控件类型', 'label'); await click(button('添加控件')); const created = packets.at(-1)!.payload.operation; assert.equal(created.action, 'addNode'); assert.equal(created.kind, 'label');
    await click(button('复制控件')); assert.equal(packets.at(-1)!.payload.operation.action, 'duplicateNode');
    await click(button('＋新增页面')); await input('UI 表单 name', 'helpPage'); await select('UI 表单 file', 'ui/pages.xml'); await click(button('保存设置')); assert.ok(readUiDesign(sources).screens.some(s => s.id === 'helpPage'));
    await click(button('＋新建事件')); await input('UI 表单 name', 'open.help'); await select('UI 表单 target', 'helpPage'); await click(button('保存设置')); assert.ok(sources.get('ui.js')!.includes('ctx.open("helpPage")'));
    await click(button('＋新建事件')); await input('UI 表单 name', 'present.help'); await select('UI 表单 command', 'present'); await select('UI 表单 target', 'helpPage'); await click(button('保存设置')); assert.ok(sources.get('ui.js')!.includes('ctx.present("helpPage")'));
    await click(button('＋新建事件')); await input('UI 表单 name', 'resume.a'); await select('UI 表单 command', 'resume'); await select('UI 表单 target', 'a'); await select('UI 表单 page', 'helpPage'); await click(button('保存设置')); assert.ok(sources.get('ui.js')!.includes('ctx.open("helpPage"); ctx.resume("a")'));
    await click(button('＋新建事件')); await input('UI 表单 name', 'resume.pending'); await select('UI 表单 command', 'resume'); await select('UI 表单 target', ''); await select('UI 表单 page', 'helpPage'); await click(button('保存设置')); assert.ok(sources.get('ui.js')!.includes('ctx.open("helpPage"); ctx.resume();'));
    await click(button('＋新建事件')); await input('UI 表单 name', 'restart.a'); await select('UI 表单 command', 'restart'); await select('UI 表单 target', 'a'); await select('UI 表单 page', 'helpPage'); await click(button('保存设置')); assert.ok(sources.get('ui.js')!.includes('ctx.open("helpPage"); ctx.restart("a")'));
    const resumeRow = [...node.querySelectorAll('.event-row')].find(r => r.textContent?.includes('resume.a'))!; assert.ok(resumeRow); await click(resumeRow.querySelector('button')!);
    await input('UI 表单 name', 'resume.edited'); await click(button('保存设置')); assert.ok(sources.get('ui.js')!.includes('ui("helpPage").bind("resume.edited"'));
    assert.equal(packets.at(-1)!.payload.operation.original, 'resume.a');
    const editedRow = [...node.querySelectorAll('.event-row')].find(r => r.textContent?.includes('resume.edited'))!; assert.ok(editedRow); await click(editedRow.querySelectorAll('button')[1]!);
    assert.equal(readUiDesign(sources).events.some(e => e.name === 'resume.edited'), false); assert.ok(!sources.get('ui.js')!.includes('ui("helpPage").bind("resume.edited"'));
    const galleryRow = [...node.querySelectorAll('.gallery-row')].find(r => r.textContent?.includes('cg.promise'))!; assert.ok(galleryRow); await click(galleryRow.querySelector('button')!);
    await input('UI 表单 title', '约定的 CG'); await select('UI 表单 unlocked', 'true'); await click(button('保存设置'));
    assert.equal(readUiDesign(sources).gallery.find(g => g.id === 'cg.promise')!.title, '约定的 CG');
    assert.equal(readUiDesign(sources).gallery.find(g => g.id === 'cg.promise')!.unlocked, true);
    await click(button('＋新建事件')); await input('UI 表单 name', 'cg.unlock'); await select('UI 表单 command', 'unlock'); await select('UI 表单 target', 'cg.promise'); await click(button('保存设置'));
    assert.ok(sources.get('ui.js')!.includes('ctx.unlock("cg.promise")'));
    assert.equal(node.querySelector('#ui-bindings option[value="cg.total"]')?.getAttribute('value'), 'cg.total');
    assert.equal(node.querySelector('#ui-bindings option[value="game.cgId"]')?.getAttribute('value'), 'game.cgId');
    assert.equal(node.querySelector('#ui-bindings option[value="game.videoPlaying"]'), null);
    await select('UI 页面', 'settings'); await click(button('页面属性'));
    await select('screenClose 动作', 'frame'); await select('screenClose 目标', 'a');
    assert.equal(dirty, true); await click(button('保存结束后动作'));
    assert.equal(readUiDesign(sources).lifecycle!.screenClose.settings.target, 'a');
    await select('screenClose 动作', 'page'); await select('screenClose 目标', 'hud'); await click(button('保存结束后动作'));
    assert.equal(readUiDesign(sources).lifecycle!.screenClose.settings.mode, 'page');
    await select('screenClose 动作', 'continue'); await click(button('保存结束后动作'));
    assert.equal(readUiDesign(sources).lifecycle!.screenClose.settings.mode, 'continue');
    await select('screenClose 动作', 'none'); await click(button('保存结束后动作'));
    assert.equal(readUiDesign(sources).lifecycle!.screenClose.settings.mode, 'none');
    await click(button('＋新增 UI 变量')); await input('UI 表单 name', 'helpVisible'); await input('UI 表单 initial', 'true'); await click(button('保存设置')); assert.equal(readUiDesign(sources).variables.find(v => v.id === 'helpVisible')!.initial, 'true');
    await select('UI 页面', 'hud');
    await click([...node.querySelectorAll('.ui-tree-node')].find(n => n.textContent?.includes('caption'))!);
    await select('控件目标页面', 'helpPage'); await click(button('放到目标顶层'));
    assert.equal(readUiDesign(sources).screens.find(s => s.id === 'helpPage')!.children.some(n => n.id === 'caption'), true);
    await select('控件目标页面', 'hud'); await select('移动控件父级', 'panel'); await click(button('放到目标底层'));
    assert.equal(readUiDesign(sources).screens[0].children.find(n => n.id === 'panel')!.children[0].id, 'caption');
    await click([...node.querySelectorAll('.ui-tree-node')].find(n => n.textContent?.includes('caption'))!); await input('UI text', '未保存草稿');
    revision++; await act(async () => patchState({ ...state(), uiSelected: 'caption' }));
    assert.equal(node.querySelector<HTMLTextAreaElement>('[aria-label="UI text"]')!.value, '未保存草稿'); assert.equal(button('保存属性').disabled, true); assert.ok(node.textContent?.includes('源码已改变'));
    await click(button('还原并载入最新')); assert.equal(node.querySelector<HTMLTextAreaElement>('[aria-label="UI text"]')!.value, '改过的文字\n第二行');
    await click(button('演出与音效')); await input('媒体标识', 'ui.reveal'); await click(button('添加淡入淡出')); await input('步骤 1 duration', '600'); await click(button('保存演出/音效'));
    assert.equal(readUiDesign(sources).media!.find(m=>m.id==='ui.reveal')!.steps[0].attrs.duration,'600');
    await click(button('页面属性')); await select('UI sequence','ui.reveal'); await click(button('保存属性')); assert.equal(readUiDesign(sources).screens[0].attrs.sequence,'ui.reveal');
    await click(button('＋新增 UI 变量')); await input('UI 表单 name', 'staleVariable'); revision++;
    await act(async () => patchState({ ...state(), uiSelected: 'caption' }));
    assert.equal(button('保存设置').disabled, true); assert.equal(node.querySelector<HTMLInputElement>('[aria-label="UI 表单 name"]')!.value, 'staleVariable');
    await click(button('还原并载入最新')); assert.equal(node.querySelector('[aria-label="UI 表单 name"]'), null);
    await click([...node.querySelectorAll('.ui-tree-node')].find(n => n.textContent?.includes('choice'))!);
    await select('按钮导航方式', 'open'); await select('导航目标页面', 'settings'); await click(button('保存属性'));
    assert.equal(uiNodes(readUiDesign(sources).screens[0].children).find(n => n.id === 'choice')!.attrs.route, 'open:settings');
    await select('按钮导航方式', 'close'); await click(button('保存属性'));
    assert.equal(uiNodes(readUiDesign(sources).screens[0].children).find(n => n.id === 'choice')!.attrs.route, 'close');
    assert.ok(!node.textContent?.includes('校验并应用')); assert.ok(!node.textContent?.includes('待应用'));
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});
