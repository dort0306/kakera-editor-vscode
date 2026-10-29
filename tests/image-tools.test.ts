import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import type { EditorState, TexturePreview } from '../packages/protocol/src/index';
import { ImageTools } from '../packages/webview/src/image-tools';
test('图片工具可框选点九伸缩段、提交真实标记及图集区域，异步请求关联正确', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://test.local' }); Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  const { createRoot } = await import('react-dom/client'), root = createRoot(document.getElementById('root')!), node = document.getElementById('root')!;
  const state: EditorState = { revision: '1', writable: true, images: {}, issues: [], story: { id: 's', entry: 'a', contentVersion: '1', frames: [], characters: [], scripts: [], files: [], visuals: [], variables: [], assets: [{ id: 'image', kind: 'image', src: 'image.png', file: 'story.xml' }] } };
  const packets: any[] = []; const send = (_state: EditorState, type: string, payload: any = {}) => { const requestId = String(packets.length + 1); packets.push({ type, payload, requestId }); return requestId; };
  const button = (text: string) => [...node.querySelectorAll('button')].find(b => b.textContent === text)!;
  const click = async (el: Element) => { assert.ok(el); await act(async () => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))); };
  const deliver = async (type: string, extra: any) => { await act(async () => window.dispatchEvent(new dom.window.MessageEvent('message', { data: { type, requestId: packets.at(-1).requestId, ...extra } }))); };
  const preview: TexturePreview = { assetId: 'image', hash: 'a'.repeat(64), width: 16, height: 12, uri: 'data:image/png;base64,AA==', regions: [], ui: { file: 'ui.xml', screens: ['hud'], targets: [] } };
  const open = async () => { const select = node.querySelector('[aria-label="图片工具源资源"]') as HTMLSelectElement; await act(async () => { select.value = 'image'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })); }); await click(button('打开图片')); await deliver('texture', { data: preview }); };
  try {
    await act(async () => root.render(React.createElement(ImageTools, { state, send, blocked: false, onDirty: () => {} }))); await open();
    const canvas = node.querySelector('[aria-label="图片区域编辑画布"]')!; Object.defineProperty(canvas, 'getBoundingClientRect', { value: () => ({ left: 0, top: 0, width: 160, height: 120 }) });
    await act(async () => canvas.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 20, clientY: 20 })));
    await act(async () => canvas.dispatchEvent(new dom.window.MouseEvent('pointerup', { bubbles: true, button: 0, clientX: 60, clientY: 80 })));
    await click(button('保存点九图')); assert.equal(packets.at(-1).type, 'textureSave'); assert.deepEqual(packets.at(-1).payload.spec.horizontal, [[2, 7]]); assert.ok(node.querySelector('[aria-label="点九拉伸预览"]'));
    await deliver('error', { message: '注入失败，保留草稿' }); assert.ok(node.textContent!.includes('注入失败')); await click(button('放弃图片编辑')); await click(button('图集')); await open();
    const atlasCanvas = node.querySelector('[aria-label="图片区域编辑画布"]')!, regionRect = node.querySelector('.atlas-region')!; Object.defineProperty(atlasCanvas, 'getBoundingClientRect', { value: () => ({ left: 0, top: 0, width: 160, height: 120 }) });
    await act(async () => { regionRect.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 20, clientY: 20 })); regionRect.dispatchEvent(new dom.window.MouseEvent('pointerup', { bubbles: true, button: 0, clientX: 20, clientY: 20 })); }); await click(regionRect);
    await click(button('保存图集区域')); assert.equal(packets.at(-1).payload.mode, 'atlas'); assert.deepEqual(packets.at(-1).payload.regions, [{ name: '区域1', x: 0, y: 0, width: 16, height: 12 }]);
  } finally { await act(async () => root.unmount()); dom.window.close(); }
});
