import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { emitRoutes, patchFrame, insertFrame, readStory } from '../packages/source/src/index';
import { launch, toolchain } from '../packages/extension/src/tools';
import { freezeContent } from '../packages/extension/src/files';
import { archiveEntries } from '../packages/extension/src/archive';
import assert from 'node:assert/strict';
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
const original = await fs.readFile(path.join(content, 'story.xml'), 'utf8');
await fs.writeFile(path.join(content, 'authoring-secret.txt'), '不应进入发行物');
const changed = patchFrame(original, 'journey', { text: '这是未保存缓冲中的新台词。' });
const frozen = await freezeContent(content, path.join(root, 'work'), new Map([['story.xml', changed]]));
await launch(tools.player, ['--project', frozen.directory, '--check', '--no-audio'], output).done;
await launch(tools.packer, [frozen.directory, path.join(root, 'game.kpak'), '--format', '2', '--level', '1'], output).done;
await launch(tools.player, ['--package', path.join(root, 'game.kpak'), '--check', '--no-audio'], output).done;
const entries = await archiveEntries(path.join(root, 'game.kpak'));
assert.ok(!entries.some(e => e.path === 'authoring-secret.txt')); assert.ok(entries.some(e => e.path === 'assets/licenses/OFL.txt'));
await launch(tools.packer, [frozen.directory, path.join(root, 'game-v1.kpak'), '--format', '1', '--level', '1'], output).done;
await launch(tools.player, ['--package', path.join(root, 'game-v1.kpak'), '--check', '--no-audio'], output).done;
await fs.copyFile(tools.player, path.join(root, 'kakera-avg.exe'));
await launch(path.join(root, 'kakera-avg.exe'), ['--check', '--no-audio'], output).done;
await frozen.dispose();
console.log(`真实 v0.8.3 模板、未保存缓冲代次、KPAK 1/2、依赖/许可选择及独立宿主全包检查通过。报告目录：${root}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
