import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import type { EditorState } from '../packages/protocol/src/index';
import { readStory, readGameTitle, type Sources } from '../packages/source/src/index';

function fixture(): Sources {
  return new Map([
    ['story.xml', '<story schema="8" id="loc-ui" content-version="1" entry="a"><localization enabled="true" src="languages.xml"/><interface src="ui.xml"/><assets><font id="font" src="font.otf"/></assets><frames><frame id="a"><text key="opening"/></frame></frames><next end="true"/></story>'],
    ['languages.xml', '<localization schema="1" default-text="zh-CN"><texts><locale id="zh-CN" label="简体中文"><messages src="zh.ftl"/><font ref="font"/></locale><locale id="en-US" label="English"><messages src="en.ftl"/><font ref="font"/></locale></texts><voices/></localization>'],
    ['zh.ftl', 'title = 本地化标题\nopening = 中文开场\n'],
    ['en.ftl', 'title = Localized title\nopening = English opening\n'],
    ['ui.xml', '<ui schema="3" width="1280" height="720" initial="hud" title-key="title"><screen id="hud" modal="false"><label id="line" x="10" y="10" width="400" height="40" text-key="opening"/></screen></ui>']
  ]);
}

test('本地化设置页真实渲染语言/消息并可新增消息请求', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="test-root"></div></body></html>', { url: 'https://kakera.test' });
  const packets: any[] = [];
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true, acquireVsCodeApi: () => ({ postMessage: (p: unknown) => packets.push(p) }) });
  const { createRoot } = await import('react-dom/client'), { App } = await import('../packages/webview/src/main');
  const root = createRoot(document.getElementById('test-root')!), node = document.getElementById('test-root')!;
  const sources = fixture(), story = readStory(sources);
  const state: EditorState = { revision: '1', story, writable: true, issues: [], images: {}, selected: 'a', title: readGameTitle(sources) };
  const click = async (element: Element | null) => { assert.ok(element, 'target button exists'); await act(async () => { element!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); }); };
  const button = (label: string) => [...node.querySelectorAll('button')].find(item => item.textContent === label) ?? null;
  const input = (label: string) => node.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`);
  const type = async (element: HTMLInputElement | HTMLTextAreaElement, value: string) => { await act(async () => { const prototype = element instanceof dom.window.HTMLTextAreaElement ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new dom.window.Event('input', { bubbles: true })); }); };
  try {
    await act(async () => { root.render(React.createElement(App)); });
    await act(async () => { window.dispatchEvent(new dom.window.MessageEvent('message', { data: { type: 'state', state } })); });
    await click(button('工程'));
    await click([...node.querySelectorAll('button')].find(item => item.textContent === '本地化') ?? null);
    assert.ok(node.textContent?.includes('简体中文'));
    assert.ok(node.textContent?.includes('中文开场'));
    assert.ok(node.textContent?.includes('本地化标题'));
    await click(button('＋新增消息'));
    await type(input('本地化消息 key') as HTMLInputElement, 'added');
    await type(input('本地化消息正文') as HTMLTextAreaElement, '新增正文');
    await click(button('保存消息'));
    const packet = packets.at(-1);
    assert.equal(packet.type, 'localization');
    assert.equal(packet.payload.operation.action, 'message');
    assert.equal(packet.payload.operation.locale, 'zh-CN');
    assert.equal(packet.payload.operation.key, 'added');
    assert.equal(packet.payload.operation.value, '新增正文');
    await act(async () => { window.dispatchEvent(new dom.window.MessageEvent('message', { data: { type: 'state', state: { ...state, revision: '2', appliedRequestId: packet.requestId } } })); });
    // Switch to the English catalog and edit the existing message through the same panel.
    const locale = node.querySelector<HTMLSelectElement>('[aria-label="选择文本语言"]')!;
    await act(async () => { locale.value = 'en-US'; locale.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
    const row = [...node.querySelectorAll('tr')].find(item => item.textContent?.includes('opening'))!;
    await click([...row.querySelectorAll('button')].find(item => item.textContent === '编辑') ?? null);
    await type(input('本地化消息正文') as HTMLTextAreaElement, 'Updated English');
    await click(button('保存消息'));
    const edited = packets.at(-1);
    assert.equal(edited.payload.operation.locale, 'en-US');
    assert.equal(edited.payload.operation.key, 'opening');
    assert.equal(edited.payload.operation.value, 'Updated English');
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});
