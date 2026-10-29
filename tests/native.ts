import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { emitRoutes, patchFrame, insertFrame, readStory, patchGameTitle, editCharacter, appendGroup, escapeXml, addCharacterLooks, characterLooks, assignCharacterLook, setFrameVisual, renameFrame } from '../packages/source/src/index';
import { analyzeLogic } from '../packages/source/src/logic';
import { launch, toolchain } from '../packages/extension/src/tools';
import { freezeContent } from '../packages/extension/src/files';
import { archiveEntries } from '../packages/extension/src/archive';
import assert from 'node:assert/strict';
import { CharacterImport } from '../packages/extension/src/character-import';
import { pngFixture } from './image-fixture';
import { encodeTexture, writeNinePatch, packTextures } from '../packages/extension/src/texture-codec';
import { assignTexture } from '../packages/source/src/texture-source';
import { verifyConditionalRoutes } from './conditional-native';
import { verifyUiEditor } from './ui-native';
import { verifyLifecycleEditor } from './lifecycle-native';
async function main() {
const root = await fs.mkdtemp(path.resolve('.test-work/native-'));
const tools = await toolchain(path.resolve(process.argv[2] ?? 'resources/tools/win32-x64'));
const content = path.join(root, 'content'); await fs.cp('templates/minimal/content', content, { recursive: true });
await fs.writeFile(path.join(content, 'scripts/routes.js'), emitRoutes([
  { frame: 'opening', kind: 'choice', option: 'explore', target: 'journey', updates: [{ op: 'add', variable: 'trust', value: { kind: 'constant', type: 'int', value: '1' } }] },
  { frame: 'opening', kind: 'choice', option: 'stay', target: 'ending', updates: [] },
  { frame: 'journey', kind: 'advance', target: 'ending', updates: [] },
  { frame: 'ending', kind: 'end', updates: [] }
]));
const output = (text: string) => process.stdout.write(text);
await launch(tools.player, ['--project', content, '--check', '--no-audio'], output).done;
const renameRoot = path.join(root, 'rename-content'); await fs.cp(content, renameRoot, { recursive: true });
const renameSources = new Map([['story.xml', await fs.readFile(path.join(renameRoot, 'story.xml'), 'utf8')], ['scripts/routes.js', await fs.readFile(path.join(renameRoot, 'scripts/routes.js'), 'utf8')]]);
const renameStory = readStory(renameSources), renameLogic = analyzeLogic(renameSources, renameStory), renamed = renameFrame(renameSources, renameLogic, 'journey', 'journey.renamed');
for (const [file, text] of renamed.changes) await fs.writeFile(path.join(renameRoot, file), text);
await launch(tools.player, ['--project', renameRoot, '--check', '--no-audio'], output).done;
console.log('RENAME NATIVE PASS: frame ID rename updates entry, route owner/targets and is accepted by the matching engine.');
await verifyConditionalRoutes(tools.player, root);
await verifyUiEditor(tools, root, content);
await verifyLifecycleEditor(tools.player, root);
const resources = path.join(root, 'source-pictures'); await fs.mkdir(resources);
await fs.writeFile(path.join(resources, '表情一.png'), pngFixture()); await fs.writeFile(path.join(resources, '表情二.png'), pngFixture());
const stage = new CharacterImport(content), image1 = await stage.image(path.join(resources, '表情一.png')), image2 = await stage.image(path.join(resources, '表情二.png'));
let sourceMap = new Map([['story.xml', await fs.readFile(path.join(content, 'story.xml'), 'utf8')], ['ui.xml', await fs.readFile(path.join(content, 'ui.xml'), 'utf8')]]);
sourceMap = new Map([...sourceMap, ...patchGameTitle(sourceMap, '雨中的约定')]);
const character = editCharacter(sourceMap, undefined, '小凛'); sourceMap = new Map([...sourceMap, ...character.changes]);
let modelId: string | undefined;
if (process.env.KAKERA_TEST_MODEL) modelId = await stage.model(process.env.KAKERA_TEST_MODEL);
let xml = sourceMap.get('story.xml')!;
for (const asset of stage.assets) xml = appendGroup(xml, 'assets', `<${asset.kind} id="${asset.id}" src="${escapeXml(asset.src)}" />`);
sourceMap.set('story.xml', xml);
sourceMap = new Map([...sourceMap, ...addCharacterLooks(sourceMap, character.id, [{ image: image1 }, { image: image2, ...(modelId ? { live2d: modelId } : {}) }])]);
const looks = characterLooks(sourceMap, character.id); assert.equal(looks.length, 2);
sourceMap = new Map([...sourceMap, ...assignCharacterLook(sourceMap, 'journey', looks[1].visualId, 'center')]);
const placedStory = readStory(sourceMap), placedVisual = placedStory.visuals.find(v => v.id === placedStory.frames.find(f => f.ref === 'journey')!.visual)!;
sourceMap = new Map([...sourceMap, ...setFrameVisual(sourceMap, 'journey', placedVisual.background, placedVisual.portraits)]);
if (modelId) assert.equal(readStory(sourceMap).visuals.at(-1)!.portraits[0].live2d, modelId);
const texture = { width: 16, height: 12, data: Buffer.alloc(16 * 12 * 4, 180) }, generated = path.join(content, 'assets/generated'); await fs.mkdir(generated, { recursive: true });
await fs.writeFile(path.join(generated, 'native.9.png'), writeNinePatch(texture, { horizontal: [[2, 5], [7, 13]], vertical: [[3, 9]], content: [1, 2, 15, 10] }));
const atlas = packTextures([{ name: '大图', bytes: encodeTexture(texture) }, { name: '小图', bytes: pngFixture() }], 64, 2); await fs.writeFile(path.join(generated, 'atlas.png'), atlas.png);
sourceMap.set('story.xml', appendGroup(sourceMap.get('story.xml')!, 'assets', '<nine-patch id="test.nine" src="assets/generated/native.9.png"/><image id="test.atlas" src="assets/generated/atlas.png"/>'));
sourceMap = new Map([...sourceMap, ...assignTexture(sourceMap, 'test.nine', 'nine-patch', 'hud')]);
sourceMap = new Map([...sourceMap, ...assignTexture(sourceMap, 'test.atlas', 'image', 'dialogue', atlas.regions[0])]);
await fs.mkdir(path.join(content, '.editor'), { recursive: true }); await fs.writeFile(path.join(content, '.editor/workbench.json'), '{"schema":1,"positions":{},"atlases":{}}');
for (const [file, text] of sourceMap) await fs.writeFile(path.join(content, file), text);
await stage.license('集成测试自制 1×1 PNG；模型仅使用显式提供的本地测试模型，不公开分发。');
await launch(tools.player, ['--project', content, '--check', '--no-audio', '--no-live2d'], output).done;
console.log(`PRIORITIES PASS: title, stable character name/ID, batch portrait presets, current-frame appearance${modelId ? ', real model3 dependency import and explicit Live2D fallback' : ''}.`);
if (modelId && process.env.KAKERA_TEST_CORE) {
  await launch(tools.player, ['--project', content, '--check', '--no-audio', '--cubism-core', process.env.KAKERA_TEST_CORE], output).done;
  console.log('CORE PASS: model prepared using explicitly supplied local Cubism Core.');
}
const original = await fs.readFile(path.join(content, 'story.xml'), 'utf8');
await fs.writeFile(path.join(content, 'authoring-secret.txt'), '不应进入发行物');
const changed = patchFrame(original, 'journey', { text: '这是未保存缓冲中的新台词。' });
const frozen = await freezeContent(content, path.join(root, 'work'), new Map([['story.xml', changed]]));
await launch(tools.player, ['--project', frozen.directory, '--check', '--no-audio', '--no-live2d'], output).done;
await launch(tools.packer, [frozen.directory, path.join(root, 'game.kpak'), '--format', '2', '--level', '1', '--no-live2d'], output).done;
await launch(tools.player, ['--package', path.join(root, 'game.kpak'), '--check', '--no-audio', '--no-live2d'], output).done;
const entries = await archiveEntries(path.join(root, 'game.kpak'));
assert.ok(!entries.some(e => e.path === 'authoring-secret.txt')); assert.ok(entries.some(e => e.path === 'assets/licenses/OFL.txt'));
assert.ok(entries.some(e => e.path === 'assets/generated/native.9.png')); assert.ok(entries.some(e => e.path === 'assets/generated/atlas.png')); assert.ok(!entries.some(e => e.path.startsWith('.editor/')));
await launch(tools.packer, [frozen.directory, path.join(root, 'game-v1.kpak'), '--format', '1', '--level', '1', '--no-live2d'], output).done;
await launch(tools.player, ['--package', path.join(root, 'game-v1.kpak'), '--check', '--no-audio', '--no-live2d'], output).done;
await fs.copyFile(tools.player, path.join(root, 'kakera-avg.exe'));
await launch(path.join(root, 'kakera-avg.exe'), ['--check', '--no-audio', '--no-live2d'], output).done;
await frozen.dispose();
console.log(`真实匹配引擎模板、未保存缓冲代次、KPAK 1/2、依赖/许可选择及独立宿主全包检查通过。报告目录：${root}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
