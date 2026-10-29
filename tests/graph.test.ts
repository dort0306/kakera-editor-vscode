import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStoryGraph } from '../packages/domain/src/graph';
import type { Story, Route } from '../packages/domain/src/index';
const story: Story = { id: 'test', entry: 'a-id', contentVersion: '1', frames: ['a', 'b', 'c', 'merge', 'alone'].map(id => ({ ref: id, id: `${id}-id`, name: id, text: id, speaker: '', visual: '', audio: {}, options: id === 'a' ? [{ id: 'left', text: '去左边' }, { id: 'right', text: '去右边' }] : [], file: 'story.xml', line: 1 })), assets: [], visuals: [], variables: [], characters: [], scripts: [], files: ['story.xml'] };
const routes: Route[] = [{ frame: 'a', kind: 'choice', option: 'left', target: 'b-id', updates: [] }, { frame: 'a', kind: 'choice', option: 'right', target: 'c', updates: [] }, { frame: 'b', kind: 'advance', target: 'merge', updates: [] }, { frame: 'c', kind: 'advance', target: 'merge-id', updates: [] }, { frame: 'merge', kind: 'end', updates: [] }, { frame: 'alone', kind: 'end', updates: [] }];
test('选项分成不同分支，别名正确解析，汇合节点只显示一次', () => {
  const graph = buildStoryGraph(story, routes), node = (id: string) => graph.nodes.find(n => n.id === id)!;
  assert.notEqual(node('b').y, node('c').y); assert.ok(node('b').x > node('a').x); assert.ok(node('merge').x > node('b').x);
  assert.deepEqual(graph.edges.filter(e => e.source === 'a').map(e => e.label), ['去左边', '去右边']);
  assert.equal(graph.nodes.filter(n => n.frameRef === 'merge').length, 1); assert.equal(graph.edges.filter(e => e.target === 'merge').length, 2);
  assert.equal(node('alone').disconnected, true); assert.equal(graph.edges.some(e => e.target === 'alone'), false);
});
test('多个 story 入口都作为可达根，不再标记为未接入', () => {
  const graph = buildStoryGraph({ ...story, entries: ['a', 'alone'], entry: 'a' }, routes);
  assert.equal(graph.nodes.find(n => n.id === 'alone')!.disconnected, false);
  assert.ok(graph.nodes.find(n => n.id === 'alone')!.x > graph.nodes.find(n => n.id === 'a')!.x || graph.nodes.find(n => n.id === 'alone')!.y !== graph.nodes.find(n => n.id === 'a')!.y);
});
test('重排文件顺序不创造路由；条件/循环/动态目标保持准确', () => {
  const reordered = { ...story, frames: [...story.frames].reverse() };
  const graph = buildStoryGraph(reordered, routes);
  assert.deepEqual(graph.edges.map(e => [e.source, e.target]).sort(), buildStoryGraph(story, routes).edges.map(e => [e.source, e.target]).sort());
  const loops = buildStoryGraph(story, routes.map(r => r.frame === 'merge' ? { ...r, kind: 'advance', target: 'a', updates: [] } : r));
  assert.equal(loops.nodes.length, story.frames.length); assert.ok(loops.edges.some(e => e.loop)); assert.ok(loops.nodes.every(n => Number.isFinite(n.x) && Number.isFinite(n.y)));
  const unknown = buildStoryGraph(story); assert.ok(unknown.nodes.some(n => n.unknown)); assert.ok(unknown.edges.every(e => e.uncertain)); assert.ok(!unknown.edges.some(e => e.source === 'a' && e.target === 'b'));
});
test('长短不同的分支全程保持同行、同色，汇合只连接一个节点', () => {
  const extended: Story = { ...story, frames: [...story.frames, ...['b2', 'c2', 'c3'].map(id => ({ ...story.frames[1], ref: id, id, name: id, text: id }))] };
  const paths: Route[] = routes.map(r => r.frame === 'b' ? { ...r, target: 'b2' } : r.frame === 'c' ? { ...r, target: 'c2' } : r).concat([{ frame: 'b2', kind: 'advance', target: 'merge', updates: [] }, { frame: 'c2', kind: 'advance', target: 'c3', updates: [] }, { frame: 'c3', kind: 'advance', target: 'merge', updates: [] }]);
  const graph = buildStoryGraph(extended, paths), node = (id: string) => graph.nodes.find(n => n.id === id)!;
  assert.equal(node('b').y, node('b2').y); assert.equal(node('c').y, node('c2').y); assert.equal(node('c2').y, node('c3').y); assert.notEqual(node('b').y, node('c').y);
  const edge = (from: string, to: string) => graph.edges.find(e => e.source === from && e.target === to)!;
  assert.notEqual(edge('a', 'b').color, edge('a', 'c').color); assert.equal(edge('a', 'b').color, edge('b', 'b2').color); assert.equal(edge('a', 'c').color, edge('c2', 'c3').color);
  const reversed = buildStoryGraph({ ...extended, frames: [...extended.frames].reverse() }, paths);
  for (const id of ['a', 'b', 'b2', 'c', 'c2', 'c3', 'merge']) assert.equal(reversed.nodes.find(n => n.id === id)!.y, node(id).y);
});
