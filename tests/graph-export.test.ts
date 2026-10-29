import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderGraphExport } from '../packages/source/src/graph-export';
import { buildStoryGraph, graphEdgeGeometry } from '../packages/domain/src/graph';
import type { Route, Story } from '../packages/domain/src/index';
const story: Story = { id: 's', entry: 'a-id', contentVersion: '1', frames: ['a', 'b', 'c', 'd', 'pending'].map(ref => ({ ref, id: `${ref}-id`, name: ref, text: ref === 'a' ? '完整台词 & <标签> "你好" 🐈\n' + '长段落。'.repeat(50) + '最后一句不丢失。' : ref, speaker: '', visual: '', audio: {}, file: 'story.xml', line: 3, options: ref === 'a' ? [{ id: 'x', text: '选择 <路线甲> & 继续' }, { id: 'y', text: '未完成的路线乙' }] : [], ...(ref === 'pending' ? { pending: true } : {}) })), scripts: [], files: ['story.xml'], assets: [], characters: [], visuals: [], variables: [] };
const routes: Route[] = [{ frame: 'a', kind: 'choice', option: 'x', target: 'b', guard: { kind: 'constant', type: 'bool', value: 'true' }, updates: [{ op: 'add', variable: '信任', value: { kind: 'constant', type: 'int', value: '9007199254740993' } }] }, { frame: 'a', kind: 'choice', option: 'y', target: 'pending', updates: [] }, { frame: 'b', kind: 'advance', target: 'b', updates: [] }, { frame: 'c', kind: 'advance', dynamic: true, updates: [] }, { frame: 'd', kind: 'end', updates: [] }, { frame: 'pending', kind: 'end', updates: [] }];
const options = { title: '游戏 <img src=x onerror="alert(1)"> & 🐈', layout: { b: { x: 20, y: 300 } }, revision: 'test-revision' };
test('独立 SVG 保留全图布局/分支颜色/完整悬停文字，循环线不裁切，不依赖 HTML 或外部资源', () => {
  const before = JSON.stringify({ story, routes, options }), svg = renderGraphExport(story, routes, options, 'svg'), dom = new JSDOM(svg, { contentType: 'image/svg+xml' }), doc = dom.window.document;
  assert.equal(doc.querySelector('parsererror'), null); assert.equal(doc.querySelectorAll('foreignObject,script,image,link').length, 0); assert.equal(doc.querySelectorAll('a').length, 0);
  assert.ok(doc.documentElement.textContent!.includes('最后一句不丢失。')); assert.ok(doc.documentElement.textContent!.includes('待连接 1')); assert.ok(doc.documentElement.textContent!.includes('未知目标 1'));
  assert.equal(doc.querySelector('[data-frame-ref="b"] rect')!.getAttribute('x'), '20');
  const graph = buildStoryGraph(story, routes, options.layout), paths = [...doc.querySelectorAll('path[marker-end]')];
  assert.equal(paths.length, graph.edges.length);
  paths.forEach((p, i) => { assert.equal(p.getAttribute('d'), graphEdgeGeometry(graph, graph.edges[i], i).d); assert.equal(p.getAttribute('stroke'), graph.edges[i].color); const marker = p.getAttribute('marker-end')!.slice(5, -1); assert.equal(doc.getElementById(marker)!.querySelector('path')!.getAttribute('fill'), graph.edges[i].color); });
  const view = doc.documentElement.getAttribute('viewBox')!.split(' ').map(Number); assert.ok(view[0] < 0); assert.ok(graph.edges.every((e, i) => graphEdgeGeometry(graph, e, i).bottom < view[1] + view[3]));
  assert.equal(JSON.stringify({ story, routes, options }), before); assert.equal(renderGraphExport(story, routes, options, 'svg'), svg); dom.window.close();
});
test('HTML 包含全文/选项/条件/i64 更新与内部跳转，恶意标记只作为文字显示，无脚本或网络依赖', () => {
  const html = renderGraphExport(story, routes, options, 'html'), dom = new JSDOM(html), doc = dom.window.document;
  assert.equal(doc.querySelectorAll('script,img,iframe,object,link').length, 0); assert.equal(doc.querySelector('article .dialogue')!.textContent, story.frames[0].text);
  assert.ok(doc.body.textContent!.includes('选择 <路线甲> & 继续')); assert.ok(doc.body.textContent!.includes('显示条件：true')); assert.ok(doc.body.textContent!.includes('信任 += 9007199254740993'));
  assert.ok(doc.body.textContent!.includes('未接入入口')); assert.ok(doc.body.textContent!.includes('动态目标 · 需试玩确认')); assert.ok(doc.querySelector('meta[http-equiv="Content-Security-Policy"]')!.getAttribute('content')!.includes("default-src 'none'"));
  for (const a of doc.querySelectorAll('a')) { const href = a.getAttribute('href')!; assert.ok(href.startsWith('#')); assert.ok(doc.getElementById(href.slice(1))); }
  assert.equal(doc.querySelectorAll('article').length, 4); dom.window.close();
});
test('空流程图和未识别脚本也可导出，保留未知目标；超过明确预算拒绝生成', () => {
  const empty = { ...story, frames: [] }; assert.ok(renderGraphExport(empty, [], options, 'svg').includes('0 幕'));
  assert.ok(renderGraphExport(story, undefined, options, 'html').includes('未知脚本路线'));
  assert.throws(() => renderGraphExport({ ...story, frames: Array.from({ length: 2001 }, () => story.frames[0]) }, routes, options, 'svg'), /预算/);
});
