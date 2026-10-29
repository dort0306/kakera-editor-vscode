import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { encode as jpeg } from 'jpeg-js';
import { decodeTexture, encodeTexture, readNinePatch, writeNinePatch, packTextures } from '../packages/extension/src/texture-codec';
import { gridRegions, patchAxis, validateNinePatch, validateRegions, type NinePatchSpec } from '../packages/domain/src/textures';
import { assignTexture, registerTexture, textureUi } from '../packages/source/src/texture-source';
import { readWorkbench, moveFrame, moveFrames, frameLayout } from '../packages/source/src/workbench';
import { readStory, analyzeLogic } from '../packages/source/src/index';
import { reconnectFrame } from '../packages/source/src/editing';
import { buildStoryGraph } from '../packages/domain/src/graph';
const raster = (width = 16, height = 12) => ({ width, height, data: Buffer.from(Array.from({ length: width * height }, (_, i) => [i % 255, 70, 150, 255]).flat()) });
const spec: NinePatchSpec = { horizontal: [[2, 5], [7, 13]], vertical: [[3, 9]], content: [1, 2, 15, 10] };
test('点九生成后读取保持所有原像素、多段伸缩和内容区，四角透明', () => {
  const original = raster(), png = writeNinePatch(original, spec), encoded = decodeTexture(png), parsed = readNinePatch(encoded);
  assert.equal(encoded.width, 18); assert.equal(encoded.height, 14); assert.deepEqual(parsed.image, original); assert.deepEqual(parsed.spec, spec); assert.deepEqual([...encoded.data.subarray(0, 4)], [0, 0, 0, 0]);
});
test('点九拒绝非法边框/黑角/缺标记，默认内容区与引擎规则一致', () => {
  const valid = decodeTexture(writeNinePatch(raster(), spec));
  const bad = { ...valid, data: Buffer.from(valid.data) }; bad.data.set([255, 0, 0, 255], 4); assert.throws(() => readNinePatch(bad), /边框/);
  bad.data.set([0, 0, 0, 255], 0); assert.throws(() => readNinePatch(bad), /四角/);
  const blank = raster(4, 4); blank.data.fill(0); assert.throws(() => readNinePatch(blank), /缺失/);
  for (let x = 1; x < valid.width - 1; x++) valid.data.fill(0, ((valid.height - 1) * valid.width + x) * 4, ((valid.height - 1) * valid.width + x + 1) * 4);
  assert.deepEqual(readNinePatch(valid).spec.content, [2, 2, 13, 10]);
});
test('点九区间/内容边界、相接段与数量限制均验证', () => {
  for (const horizontal of [[], [[0, 17]], [[2, 3], [3, 4]], Array.from({ length: 9 }, (_, i) => [i * 2, i * 2 + 1])]) assert.throws(() => validateNinePatch({ ...spec, horizontal: horizontal as [number, number][] }, 16, 12));
  assert.throws(() => validateNinePatch({ ...spec, content: [2, 1, 1, 4] }, 16, 12));
});
test('点九预览保持固定边角、多伸缩比例，过小目标按引擎规则收缩固定段', () => {
  const normal = patchAxis(16, [[4, 12]], 80, 1); assert.deepEqual(normal.map(s => s.target), [[0, 4], [4, 76], [76, 80]]);
  assert.deepEqual(patchAxis(16, [[4, 12]], 2, 1).map(s => s.target), [[0, 1], [1, 1], [1, 2]]);
  assert.equal(patchAxis(16, [[4, 12]], 80, 2)[0].target[1], 2);
});
test('普通 PNG/JPEG 受限解码；巨型 PNG 在解压前拒绝', () => {
  const image = raster(); assert.deepEqual(decodeTexture(encodeTexture(image)), image);
  assert.equal(decodeTexture(jpeg(image, 80).data).width, image.width);
  const huge = encodeTexture(image); huge.writeUInt32BE(9000, 16); assert.throws(() => decodeTexture(huge), /4M/); assert.throws(() => decodeTexture(Buffer.from('bad')), /PNG/);
});
test('多图合成保留原像素，间距透明、区域无重叠；放不下时拒绝', () => {
  const images = [raster(7, 5), raster(8, 6), raster(10, 2)], packed = packTextures(images.map((image, i) => ({ name: `图${i}`, bytes: encodeTexture(image) })), 24, 2), output = PNG.sync.read(packed.png);
  validateRegions(packed.regions, packed.width, packed.height); assert.deepEqual([...output.data.subarray(0, 4)], [0, 0, 0, 0]);
  for (let i = 0; i < images.length; i++) { const r = packed.regions[i]; for (let row = 0; row < r.height; row++) assert.deepEqual(output.data.subarray(((r.y + row) * output.width + r.x) * 4, ((r.y + row) * output.width + r.x + r.width) * 4), images[i].data.subarray(row * r.width * 4, (row + 1) * r.width * 4)); }
  assert.throws(() => packTextures([{ name: '宽图', bytes: encodeTexture(raster(32, 1)) }], 16, 2), /宽度不足/);
});
test('网格裁切只生成完整格，区域越界/同名/超过上限拒绝', () => {
  assert.deepEqual(gridRegions(35, 19, 8, 8, 1, 1).map(r => [r.x, r.y]), [[1, 1], [10, 1], [19, 1], [1, 10], [10, 10], [19, 10]]);
  assert.throws(() => gridRegions(1024, 1024, 1, 1), /256/); assert.throws(() => validateRegions([{ name: 'a', x: 3, y: 0, width: 2, height: 1 }], 4, 4), /越界/);
});
const storyXml = `<story schema="8" id="s" entry="a"><interface src="ui.xml"/><scripts><script src="routes.js"/></scripts><assets><image id="sheet" src="sheet.png"/><nine-patch id="panel" src="old.9.png"/></assets><variables><int id="score" initial="0"/></variables><frames><frame id="a"><text>选</text><options><option id="x">路线甲</option></options></frame><frame id="b"><text>后</text></frame></frames></story>`;
const ui = `<ui schema="3"><screen id="main"><!-- 原注释 --><image id="sprite" image="sheet" region-bind="ui.cell" x="0" y="0" width="10" height="10"/><nine-patch id="box" image="panel" density="2"><label id="txt" text="保留"/></nine-patch></screen></ui>`;
const sources = () => new Map([['story.xml', storyXml], ['ui.xml', ui], ['routes.js', `// 留下手写\non.choice('a','x', ctx => { ctx.add('score',1); return 'b'; }, ctx => ctx.vars.score >= 0n); on.end('b');`]]);
test('图集应用只改选中控件、解除 region 绑定并保留 UI 子节点/注释；点九密度写入真实标签', () => {
  const input = sources(), changed = assignTexture(input, 'sheet', 'image', 'sprite', { name: 'a', x: 2, y: 4, width: 6, height: 8 });
  assert.ok(changed.get('ui.xml')!.includes('region="2,4,6,8"')); assert.ok(!changed.get('ui.xml')!.includes('region-bind')); assert.ok(changed.get('ui.xml')!.includes('<!-- 原注释 -->'));
  assert.ok(assignTexture(input, 'panel', 'nine-patch', 'box', undefined, .5).get('ui.xml')!.includes('density="0.5"')); assert.throws(() => assignTexture(input, 'panel', 'nine-patch', 'sprite'));
  assert.equal(textureUi(input).targets.length, 2);
});
test('既有点九编辑保持资源 ID、位置及其他章节内容；页面可追加可运行节点', () => {
  const input = sources(), changes = registerTexture(input, 'panel', 'nine-patch', 'new.9.png'); assert.equal(changes.get('story.xml'), storyXml.replace('old.9.png', 'new.9.png'));
  assert.match(assignTexture(input, 'panel', 'nine-patch', 'main').get('ui.xml')!, /<nine-patch id="[0-9a-f]{16}" x="20" y="20" width="320" height="180" image="panel" density="1"\/>/); assert.equal(changes.has('routes.js'), false);
});
test('拖动布局使用稳定 ID 保存、不改变剧情顺序；重置只清空位置', () => {
  const input = sources(), story = readStory(input), meta = moveFrame(readWorkbench(), story, 'a', { x: 123, y: 246 }); assert.deepEqual(meta.positions.a, { x: 120, y: 250 });
  const layout = frameLayout(readWorkbench(JSON.stringify(meta)), { ...story, frames: story.frames.map(f => f.ref === 'a' ? { ...f, name: 'renamed', ref: 'renamed' } : f) }); assert.deepEqual(layout.renamed, meta.positions.a);
  const graph = buildStoryGraph(story, analyzeLogic(input, story).routes, frameLayout(meta, story)); assert.equal(graph.nodes.find(n => n.id === 'a')!.x, 120); assert.deepEqual(Object.keys(moveFrame(meta, story).positions), []); assert.equal(input.get('story.xml'), storyXml);
  assert.throws(() => moveFrame(meta, story, 'a', { x: NaN, y: 0 }));
  const multi = moveFrames(meta, story, { a: { x: 11, y: 22 }, b: { x: 33, y: 44 } });
  assert.deepEqual(multi.positions.a, { x: 10, y: 20 }); assert.deepEqual(multi.positions.b, { x: 30, y: 40 });
  assert.throws(() => moveFrames(meta, story, {})); assert.throws(() => moveFrames(meta, story, { missing: { x: 1, y: 2 } })); assert.throws(() => moveFrames(meta, story, { a: { x: NaN, y: 0 } }));
});
test('重新连线与断开保留选项/条件/更新/注释，结束幕可接续，自循环合法，Opaque 拒绝', () => {
  const input = sources(), logic = analyzeLogic(input, readStory(input)), connected = reconnectFrame(input, logic, 'a', 'a', 'x'), next = new Map([...input, ...connected]), mapped = analyzeLogic(next, readStory(next));
  assert.equal(mapped.routes[0].target, 'a'); assert.deepEqual(mapped.routes[0].updates, logic.routes[0].updates); assert.deepEqual(mapped.routes[0].guard, logic.routes[0].guard); assert.ok(next.get('routes.js')!.startsWith('// 留下手写'));
  const disconnected = new Map([...input, ...reconnectFrame(input, logic, 'a', '', 'x')]); assert.ok(readStory(disconnected).frames.some(f => f.pending)); assert.equal(disconnected.get('story.xml')!.includes('路线甲'), true);
  const end = new Map([...input, ...reconnectFrame(input, logic, 'b', 'a')]); assert.equal(analyzeLogic(end, readStory(end)).routes.find(r => r.frame === 'b')!.kind, 'advance');
  assert.throws(() => reconnectFrame(input, { ...logic, frames: { ...logic.frames, a: { editable: false, locations: [], reason: '自定义' } } }, 'a', 'b', 'x'), /自定义/);
});
