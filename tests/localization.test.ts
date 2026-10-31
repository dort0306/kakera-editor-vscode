import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  editCharacter, editFtlMessage, editLocalizationManifest, localizationIssues, parseXml, patchFrame,
  patchGameTitle, readGameTitle, readLocalization, readStory, storyLocalizationUsages, type Sources
} from '../packages/source/src/index';
import { editUi, readUiDesign } from '../packages/source/src/ui-source';
import { previewUi } from '../packages/domain/src/ui-preview';
import { parseFtl } from '../packages/domain/src/localization';

function fixture(): Sources {
  return new Map([
    ['story.xml', `<story schema="8" id="loc" content-version="1" entry="a">
  <localization enabled="true" src="languages.xml"/>
  <interface src="ui.xml"/>
  <scripts><script src="ui.js"/></scripts>
  <assets><font id="zh" src="zh.otf"/><font id="latin" src="latin.otf"/><audio id="voice.a" src="a.wav"/><audio id="voice.b" src="b.wav"/><image id="pic" src="pic.png"/><cg id="cg1" src="cg1.png"/></assets>
  <characters><character id="lin" name-key="name"/></characters>
  <variables><int id="count" initial="2" label-key="countLabel"/></variables>
  <frames>
    <frame id="a" speaker="lin"><text key="opening"/><audio voice="voice.a"/><options><option id="go" text-key="go"/></options></frame>
    <frame id="b"><text key="ending"/><audio voice="voice.b"/></frame>
  </frames>
  <next end="true"/>
</story>`],
    ['languages.xml', `<localization schema="1" default-text="zh-CN" default-voice="ja-JP">
  <texts>
    <locale id="zh-CN" label="简体中文"><messages src="zh.ftl"/><font ref="zh"/></locale>
    <locale id="en-US" label="English"><messages src="en.ftl"/><font ref="latin"/></locale>
  </texts>
  <voices>
    <locale id="ja-JP" label="日本語"><clip key="voice.a" asset="voice.b"/><clip key="voice.b" silent="true"/></locale>
    <locale id="zh-CN" label="中文"><clip key="voice.a" asset="voice.a"/><clip key="voice.b" asset="voice.a"/></locale>
  </voices>
</localization>`],
    ['zh.ftl', 'title = 测试标题\ngalleryTitle = 画廊标题\nname = 小林\ncountLabel = 计数\nopening = 开场文字\ngo = 出发\nending = 结束\ncounter = 计数 { $n }\n'],
    ['en.ftl', 'title = Test title\ngalleryTitle = Gallery title\nname = Lin\ncountLabel = Count\nopening = Opening text\ngo = Go\nending = Ending\ncounter = Count { $n }\n'],
    ['ui.xml', `<ui schema="3" width="1280" height="720" initial="hud" title-key="title">
  <variables><int id="count" initial="2"/><string id="messageKey" initial="opening"/></variables>
  <gallery><cg id="cg1" image="cg1" title-key="galleryTitle" unlocked="true"/></gallery>
  <screen id="hud" modal="false">
    <label id="line" x="10" y="10" width="500" height="40" text-key="opening"/>
    <label id="counter" x="10" y="60" width="500" height="40" text-key="counter"><text-arg name="n" bind="ui.count"/></label>
    <button id="dynamic" x="10" y="110" width="500" height="40" text-key-bind="ui.messageKey" event="advance"/>
    <label id="plain" x="10" y="160" width="500" height="40" text="字面量"/>
  </screen>
</ui>`],
    ['ui.js', 'event.register("advance", (ctx) => { ctx.advance(); });\nevent.register("switch-language", (ctx) => { ctx.locale("text", "en-US"); });\nui("dynamic").bind("switch-language");']
  ]);
}
const merge = (input: Sources, changes: Sources) => new Map([...input, ...changes]);

test('v0.10.1 本地化清单、key 文本、参数和独立语音按源码解析', () => {
  const sources = fixture(), story = readStory(sources), design = readUiDesign(sources);
  assert.equal(story.localization?.enabled, true);
  assert.deepEqual(story.localization?.texts.map(locale => locale.id), ['zh-CN', 'en-US']);
  assert.equal(story.frames[0].textKey, 'opening'); assert.equal(story.frames[0].text, '开场文字');
  assert.equal(story.frames[0].options[0].textKey, 'go'); assert.equal(story.frames[0].options[0].text, '出发');
  assert.equal(story.characters[0].nameKey, 'name'); assert.equal(story.characters[0].name, '小林');
  assert.equal(story.variables[0].labelKey, 'countLabel'); assert.equal(story.variables[0].label, '计数');
  assert.equal(design.gallery[0].titleKey, 'galleryTitle'); assert.equal(design.gallery[0].title, '画廊标题');
  const line = design.screens[0].children.find(node => node.id === 'line')!;
  const counter = design.screens[0].children.find(node => node.id === 'counter')!;
  const dynamic = design.screens[0].children.find(node => node.id === 'dynamic')!;
  assert.equal(line.localized?.key, 'opening'); assert.equal(line.localized?.args.length, 0);
  assert.deepEqual(counter.localized?.args, [{ name: 'n', bind: 'ui.count' }]);
  assert.equal(dynamic.localized?.keyBound, true);
  assert.equal(readGameTitle(sources).text, '测试标题'); assert.equal(readGameTitle(sources).textKey, 'title');
  const preview = previewUi(design, design.screens[0], story, 'a');
  assert.equal(preview.find(node => node.node.id === 'line')!.text, '开场文字');
  assert.equal(preview.find(node => node.node.id === 'counter')!.text, '计数 2');
  assert.equal(preview.find(node => node.node.id === 'dynamic')!.text, '开场文字');
  assert.deepEqual(localizationIssues(story, storyLocalizationUsages(story)), []);
});

test('key 文本、选项和人物名可切换回字面量，未知 key 与参数错误给出诊断', () => {
  let sources = fixture();
  let xml = patchFrame(sources.get('story.xml')!, 'a', { textKey: 'opening' });
  sources = new Map([...sources, ['story.xml', xml]]);
  assert.equal(readStory(sources).frames[0].textKey, 'opening');
  xml = patchFrame(sources.get('story.xml')!, 'a', { textKey: '', text: '新的字面量', options: [{ id: 'go', text: '直接出发' }] });
  sources = new Map([...sources, ['story.xml', xml]]);
  assert.equal(readStory(sources).frames[0].text, '新的字面量'); assert.equal(readStory(sources).frames[0].textKey, undefined);
  assert.equal(readStory(sources).frames[0].options[0].textKey, undefined);
  const changed = editCharacter(sources, 'lin', '林', null); sources = merge(sources, changed.changes);
  const character = readStory(sources).characters[0]; assert.equal(character.name, '林'); assert.equal(character.nameKey, undefined);
  const keyed = editCharacter(sources, 'lin', '', 'name'); sources = merge(sources, keyed.changes);
  assert.equal(readStory(sources).characters[0].name, '小林');
  sources.set('zh.ftl', sources.get('zh.ftl')!.replace('ending = 结束\n', '').replace('counter = 计数 { $n }\n', 'counter = 计数\n'));
  const brokenStory = readStory(sources), brokenUi = readUiDesign(sources);
  const issues = localizationIssues(brokenStory, [...storyLocalizationUsages(brokenStory), ...(brokenUi.localizationUsages ?? [])]);
  assert.ok(issues.some(issue => issue.message.includes('ending')));
  assert.ok(issues.some(issue => issue.message.includes('计数') || issue.message.includes('参数')));
  assert.throws(() => patchFrame(sources.get('story.xml')!, 'a', { textKey: 'bad key!' }), /key/);
  assert.throws(() => editCharacter(sources, 'lin', '新名字'), /本地化/);
});

test('FTL 消息编辑/新增/删除保留其他正文与注释，严格拒绝语法、循环和坏引用', () => {
  let sources = fixture();
  sources.set('en.ftl', `# translator note\nopening = Old opening\ncounter = Count { $n }\n`);
  let changes = editFtlMessage(sources, 'en-US', 'opening', 'New opening'); sources = merge(sources, changes);
  assert.ok(sources.get('en.ftl')!.includes('# translator note')); assert.ok(sources.get('en.ftl')!.includes('opening = New opening'));
  assert.throws(() => editFtlMessage(sources, 'en-US', 'opening', 'bad { placeable'), /占位符|Fluent|花括号/);
  changes = editFtlMessage(sources, 'en-US', 'added', 'Added value'); sources = merge(sources, changes);
  assert.equal(readLocalization(sources).texts.find(locale => locale.id === 'en-US')!.messages[0].entries.some(entry => entry.id === 'added'), true);
  const added = parseFtl('en.ftl', sources.get('en.ftl')!).entries.find(entry => entry.id === 'added')!;
  sources.set('en.ftl', sources.get('en.ftl')!.replace('Added value', '{ missingMessage }'));
  assert.throws(() => readLocalization(sources), /missingMessage/);
  sources.set('en.ftl', sources.get('en.ftl')!.replace('{ missingMessage }', 'Added value'));
  sources.set('en.ftl', sources.get('en.ftl')!.replace('Added value', 'Added value\nloop-a = { loop-b }\nloop-b = { loop-a }'));
  assert.throws(() => readLocalization(sources), /循环|过深/);
  assert.ok(added.parameters.length === 0);
});

test('清单默认值、显示名与语音映射可编辑，结构性错误拒绝', () => {
  let sources = fixture();
  let changes = editLocalizationManifest(sources, { action: 'defaults', defaultText: 'en-US', defaultVoice: 'zh-CN' }); sources = merge(sources, changes);
  assert.equal(readLocalization(sources).defaultText, 'en-US'); assert.equal(readLocalization(sources).defaultVoice, 'zh-CN');
  changes = editLocalizationManifest(sources, { action: 'textLocale', id: 'zh-CN', label: '中文' }); sources = merge(sources, changes);
  assert.equal(readLocalization(sources).texts.find(locale => locale.id === 'zh-CN')!.label, '中文');
  changes = editLocalizationManifest(sources, { action: 'voiceLocale', id: 'ja-JP', label: '日语', clips: [{ key: 'voice.a', asset: 'voice.a' }, { key: 'voice.b', silent: true }] }); sources = merge(sources, changes);
  assert.equal(readLocalization(sources).voices.find(locale => locale.id === 'ja-JP')!.label, '日语');
  assert.throws(() => editLocalizationManifest(sources, { action: 'defaults', defaultText: 'fr-FR' }), /默认文本/);
  assert.throws(() => editLocalizationManifest(sources, { action: 'deleteTextLocale', id: 'en-US' }));
  assert.throws(() => editLocalizationManifest(sources, { action: 'voiceLocale', id: 'ja-JP', label: '日语', clips: [{ key: 'voice.a', asset: 'voice.a', silent: true }] }), /二选一/);
  const selfClosing = fixture(); selfClosing.set('languages.xml', selfClosing.get('languages.xml')!.replace('<locale id="ja-JP" label="日本語"><clip key="voice.a" asset="voice.b"/><clip key="voice.b" silent="true"/></locale>', '<locale id="ja-JP" label="日本語" />'));
  const converted = merge(selfClosing, editLocalizationManifest(selfClosing, { action: 'voiceLocale', id: 'ja-JP', label: '日本語', clips: [{ key: 'voice.a', asset: 'voice.b' }, { key: 'voice.b', silent: true }] }));
  assert.ok(converted.get('languages.xml')!.includes('<locale id="ja-JP" label="日本語"><clip key="voice.a" asset="voice.b" /><clip key="voice.b" silent="true" /></locale>'), converted.get('languages.xml')!);
  assert.equal(readLocalization(converted).voices.find(locale => locale.id === 'ja-JP')!.clips.length, 2);
  const firstVoice = fixture(); firstVoice.set('languages.xml', firstVoice.get('languages.xml')!.replace(' default-voice="ja-JP"', '').replace(/<voices>[\s\S]*?<\/voices>/, '<voices />'));
  assert.equal(readLocalization(firstVoice).voices.length, 0);
  const withVoice = merge(firstVoice, editLocalizationManifest(firstVoice, { action: 'voiceLocale', id: 'ja-JP', label: '日本語', clips: [{ key: 'voice.a', asset: 'voice.b' }, { key: 'voice.b', silent: true }] }));
  assert.equal(readLocalization(withVoice).defaultVoice, 'ja-JP');
  assert.equal(readLocalization(withVoice).voices[0].clips.length, 2);
  assert.ok(withVoice.get('languages.xml')!.includes('default-voice="ja-JP"'));
  const broken = fixture(); broken.set('languages.xml', broken.get('languages.xml')!.replace('id="zh-CN"', 'id="zh_CN"'));
  assert.throws(() => readLocalization(broken), /语言标识/);
  broken.set('languages.xml', fixture().get('languages.xml')!.replace('default-text="zh-CN"', 'default-text="fr-FR"'));
  assert.throws(() => readLocalization(broken), /default-text/);
  broken.set('languages.xml', fixture().get('languages.xml')!.replace('<font ref="zh"/>', '<font ref="missing"/>'));
  const brokenWithFont = new Map([...broken, ['languages.xml', fixture().get('languages.xml')!.replace('<font ref="zh"/>', '<font ref="missing"/>')]]);
  assert.ok(localizationIssues(readStory(brokenWithFont), storyLocalizationUsages(readStory(brokenWithFont))).some(issue => issue.message.includes('字体')));
});

test('UI text-key、动态 key、text-arg、画廊与根标题可编辑且保持互斥', () => {
  let sources = fixture();
  let result = editUi(sources, { action: 'patchNode', id: 'plain', patch: { 'text-key': 'opening', text: '', bind: '' } }); sources = merge(sources, result.changes);
  let design = readUiDesign(sources); let node = design.screens[0].children.find(item => item.id === 'plain')!;
  assert.equal(node.localized?.key, 'opening'); assert.equal(node.attrs.text, undefined);
  result = editUi(sources, { action: 'patchNode', id: 'plain', patch: { text: '字面量', 'text-key': '' } }); sources = merge(sources, result.changes);
  node = readUiDesign(sources).screens[0].children.find(item => item.id === 'plain')!; assert.equal(node.attrs.text, '字面量'); assert.equal(node.localized, undefined);
  result = editUi(sources, { action: 'textArgs', id: 'counter', args: [{ name: 'n', bind: 'ui.count' }, { name: 'total', value: '3' }] }); sources = merge(sources, result.changes);
  assert.deepEqual(readUiDesign(sources).screens[0].children.find(item => item.id === 'counter')!.localized?.args, [{ name: 'n', bind: 'ui.count' }, { name: 'total', value: '3' }]);
  assert.ok(sources.get('ui.xml')!.includes('<text-arg name="total" value="3" />'));
  assert.throws(() => editUi(sources, { action: 'textArgs', id: 'plain', args: [{ name: 'n', value: '1' }] }), /text-key/);
  assert.throws(() => editUi(sources, { action: 'textArgs', id: 'counter', args: [{ name: 'n', bind: 'ui.missing' }] }), /绑定/);
  result = editUi(sources, { action: 'gallery', original: 'cg1', id: 'cg1', image: 'cg1', title: '', titleKey: 'galleryTitle', unlocked: true }); sources = merge(sources, result.changes);
  assert.equal(readUiDesign(sources).gallery.find(entry => entry.id === 'cg1')!.titleKey, 'galleryTitle');
  result = editUi(sources, { action: 'patchRoot', patch: { 'title-key': 'title' } }); sources = merge(sources, result.changes);
  assert.equal(readGameTitle(sources).textKey, 'title');
  assert.throws(() => editUi(sources, { action: 'patchNode', id: 'plain', patch: { 'text-key': 'opening', text: '同时' } }), /四选一/);
  assert.throws(() => editUi(sources, { action: 'patchNode', id: 'plain', patch: { 'text-key': 'missing' } }), /默认文本/);
  const events = readUiDesign(sources).events;
  assert.equal(events.find(event => event.name === 'switch-language')!.channel, 'text');
  assert.equal(events.find(event => event.name === 'switch-language')!.locale, 'en-US');
  result = editUi(sources, { action: 'event', name: 'switch-language', original: 'switch-language', command: 'locale', channel: 'voice', locale: 'zh-CN' }); sources = merge(sources, result.changes);
  assert.ok(sources.get('ui.js')!.includes('ctx.locale("voice", "zh-CN")'));
  assert.throws(() => editUi(sources, { action: 'event', name: 'bad-locale', command: 'locale', channel: 'text', locale: 'fr-FR' }), /已声明/);
  assert.throws(() => editUi(sources, { action: 'event', name: 'bad-channel', command: 'locale', channel: 'music', locale: 'en-US' }), /通道/);
  result = editUi(sources, { action: 'event', name: 'auto-language', command: 'locale', channel: 'text', locale: '' }); sources = merge(sources, result.changes);
  assert.ok(sources.get('ui.js')!.includes('ctx.locale("text", null)'));
});

test('本地化标题来源切换保留故事 ID，并拒绝多个来源', () => {
  let sources = fixture();
  assert.equal(readGameTitle(sources).textKey, 'title');
  let changes = patchGameTitle(sources, '固定标题', true); sources = merge(sources, changes);
  assert.equal(readGameTitle(sources).text, '固定标题'); assert.equal(readGameTitle(sources).textKey, undefined);
  changes = patchGameTitle(sources, 'title', true, 'key'); sources = merge(sources, changes);
  assert.equal(readGameTitle(sources).textKey, 'title');
  const broken = fixture(); broken.set('ui.xml', broken.get('ui.xml')!.replace('title-key="title"', 'title="冲突" title-key="title"'));
  assert.throws(() => readGameTitle(broken), /不能同时设置/);
  assert.throws(() => parseXml('<a>'), /not well-formed|Unexpected|unclosed/i);
});
