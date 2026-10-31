import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import assert from 'node:assert/strict';
import { launch, type toolchain } from '../packages/extension/src/tools';
import { archiveEntries } from '../packages/extension/src/archive';
import { emitRoutes, readStory } from '../packages/source/src/index';

type Tools = Awaited<ReturnType<typeof toolchain>>;

/** Generate a minimal author-selected localization project and prove that the
 * matching v0.11.0 engine accepts it through both the source and KPAK paths. */
export async function verifyLocalization(tools: Tools, root: string): Promise<void> {
  const content = path.join(root, 'localization-content');
  await fs.cp('templates/minimal/content', content, { recursive: true });
  await fs.writeFile(path.join(content, 'scripts/routes.js'), emitRoutes([
    { frame: 'opening', kind: 'choice', option: 'explore', target: 'journey', updates: [] },
    { frame: 'opening', kind: 'choice', option: 'stay', target: 'ending', updates: [] },
    { frame: 'journey', kind: 'advance', target: 'ending', updates: [] },
    { frame: 'ending', kind: 'end', updates: [] }
  ]));
  let story = await fs.readFile(path.join(content, 'story.xml'), 'utf8');
  story = story.replace(/<story([^>]*)>/, '<story$1>\n  <localization enabled="true" src="languages.xml" />')
    .replace('<text>故事从这里开始。你想探索哪条路？</text>', '<text key="opening" />');
  await fs.writeFile(path.join(content, 'story.xml'), story);
  let ui = await fs.readFile(path.join(content, 'ui.xml'), 'utf8');
  ui = ui.replace('title="Kakera 故事"', 'title-key="title"').replace('text="已结束"', 'text-key="ended"');
  await fs.writeFile(path.join(content, 'ui.xml'), ui);
  await fs.writeFile(path.join(content, 'languages.xml'), `<localization schema="1" default-text="zh-CN">
  <texts>
    <locale id="zh-CN" label="简体中文"><messages src="locales/zh-CN.ftl" /><font ref="dialogue" /></locale>
    <locale id="en-US" label="English"><messages src="locales/en-US.ftl" /><font ref="dialogue" /></locale>
  </texts>
  <voices />
</localization>
`);
  await fs.mkdir(path.join(content, 'locales'));
  const chinese = 'opening = 本地化{ "\\u5F00" }场\nended = 已结束\ntitle = Kakera 本地化测试\nnegative = { -42 }\npath = C:\\new\\test\n';
  await fs.writeFile(path.join(content, 'locales/zh-CN.ftl'), chinese);
  await fs.writeFile(path.join(content, 'locales/en-US.ftl'), 'opening = Localized opening\nended = Ended\ntitle = Kakera Localization Test\n');
  await fs.writeFile(path.join(content, 'language.json'), '{"schema_version":1,"story_id":"new-story","text":null,"voice":null}');
  const output = (text: string) => process.stdout.write(text);
  const files = ['story.xml', 'ui.xml', 'languages.xml', 'locales/zh-CN.ftl', 'locales/en-US.ftl'];
  const sources = new Map(await Promise.all(files.map(async file => [file, await fs.readFile(path.join(content, file), 'utf8')] as const)));
  assert.equal(readStory(sources).frames.find(frame => frame.ref === 'opening')!.text, '本地化开场');
  await launch(tools.player, ['--project', content, '--check', '--no-audio', '--no-live2d'], output).done;
  for (const format of ['1', '2']) {
    const pack = path.join(root, `localization-v${format}.kpak`);
    await launch(tools.packer, [content, pack, '--format', format, '--level', '1', '--no-live2d'], output).done;
    // The editor's release-index reader deliberately supports KPAK 2 only.
    if (format === '2') {
      const entries = await archiveEntries(pack);
      assert.ok(entries.some(entry => entry.path === 'languages.xml'), 'KPAK 必须包含语言清单');
      assert.ok(entries.some(entry => entry.path === 'locales/zh-CN.ftl'), 'KPAK 必须包含全部声明语言的 FTL');
      assert.ok(entries.some(entry => entry.path === 'locales/en-US.ftl'), 'KPAK 必须包含非默认语言 FTL');
      assert.ok(!entries.some(entry => /(^|\/)language\.json$/i.test(entry.path)), 'language.json 是玩家偏好，不能进入发行包');
    }
    await launch(tools.player, ['--package', pack, '--check', '--no-audio', '--no-live2d'], output).done;
  }
  console.log('LOCALIZATION NATIVE PASS: Unicode 转义/负数/反斜杠与语言清单被 v0.11.0 引擎接受；KPAK 1/2 包含全部声明语言，language.json 排除。');
}
