import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addCharacterLooks, assignCharacterLook, characterLooks, editCharacter, patchGameTitle, readGameTitle, readStory, parseXml, setFrameVisual } from '../packages/source/src/index';
const base = `<story schema="8" id="unchanged" content-version="1" entry="a"><interface src="screens/ui.xml"/><assets><image id="red" src="red.png"/><image id="blue" src="blue.png"/><live2d id="model" src="model.model3.json"/></assets><characters><!-- 保留人物备注 --><character id='lin' name='凛'/><character id="other" name="另一个人"/></characters><visuals><visual id="room" background="red"><portrait character="other" image="blue" slot="left" pose="normal"/><!-- 保留场景备注 --></visual></visuals><frames><frame id="a" visual="room" speaker="lin"><text>你好</text></frame></frames><next end="true"/></story>`;
const sources = () => new Map([['story.xml', base], ['screens/ui.xml', `<ui schema="3" width="1280" height="720" initial="hud" title='旧标题'><!-- 界面备注 --><screen id="hud"/></ui>`]]);
test('标题修改 UI 根属性，保留故事/幕 ID、UI 注释和其他文件', () => {
  const input = sources(), changes = patchGameTitle(input, '雨中的约定 & 你');
  assert.equal(changes.size, 1); assert.ok(changes.get('screens/ui.xml')!.includes('title="雨中的约定 &amp; 你"')); assert.ok(changes.get('screens/ui.xml')!.includes('<!-- 界面备注 -->'));
  assert.equal(readGameTitle(new Map([...input, ...changes])).text, '雨中的约定 & 你'); assert.equal(input.get('story.xml'), base);
  for (const title of ['', ' ', 'x\n', '\u0000', '界'.repeat(257)]) assert.throws(() => patchGameTitle(input, title));
  assert.doesNotThrow(() => patchGameTitle(input, '🐈'.repeat(256)));
});
test('绑定标题默认修改 UI string 初始值；显式固定才解除绑定', () => {
  const input = sources(); input.set('screens/ui.xml', `<ui schema="3" title-bind="ui.title"><variables><string id='title' initial='原名'/></variables></ui>`);
  const bound = patchGameTitle(input, '新名').get('screens/ui.xml')!; assert.ok(bound.includes('title-bind="ui.title"')); assert.ok(bound.includes('initial="新名"'));
  const fixed = patchGameTitle(input, '固定名', true).get('screens/ui.xml')!; assert.ok(!fixed.includes('title-bind')); assert.equal(parseXml(fixed).attrs.title, '固定名');
});
test('人物改名保留稳定引用和章节范围；新建一次生成 ID', () => {
  const input = sources(), edited = editCharacter(input, 'lin', '林 & 凛');
  assert.equal(edited.id, 'lin'); assert.ok(edited.changes.get('story.xml')!.includes("id='lin'")); assert.ok(edited.changes.get('story.xml')!.includes('<!-- 保留人物备注 -->'));
  assert.equal(readStory(new Map([...input, ...edited.changes])).frames[0].speaker, 'lin');
  const created = editCharacter(input, undefined, '真纪'); assert.ok(created.id.startsWith('character.')); assert.equal(readStory(new Map([...input, ...created.changes])).characters.at(-1)!.name, '真纪');
  const chapters = new Map(input); chapters.set('story.xml', base.replace(`<character id='lin' name='凛'/>`, '').replace('<next end="true"/>', '<next src="chapter.xml"/>')); chapters.set('chapter.xml', `<story schema="8"><characters><character id="lin" name="凛"/></characters><next end="true"/></story>`);
  assert.deepEqual([...editCharacter(chapters, 'lin', '新名').changes.keys()], ['chapter.xml']);
  assert.throws(() => editCharacter(input, 'missing', '名字'));
});
test('一批立绘和 Live2D 外观保存为合法 visual 预设；不注入编辑器私有字段', () => {
  const input = sources(), changes = addCharacterLooks(input, 'lin', [{ image: 'red' }, { image: 'blue', live2d: 'model' }]);
  const next = new Map([...input, ...changes]), looks = characterLooks(next, 'lin');
  assert.equal(looks.length, 2); assert.equal(looks[1].live2d, 'model'); assert.equal(readStory(next).characters.length, 2);
  assert.ok(changes.get('story.xml')!.includes('<live2d asset="model"')); assert.throws(() => addCharacterLooks(input, 'lin', [{ image: 'model' }]));
  assert.throws(() => addCharacterLooks(input, 'lin', [{ image: 'red', live2d: 'missing' }]));
  const edited = addCharacterLooks(next, 'lin', [{ visualId: looks[1].visualId, image: 'red' }]);
  assert.equal(characterLooks(new Map([...next, ...edited]), 'lin')[1].live2d, 'model');
});
test('人物外观放入当前幕：保留背景和另一人物；模型仍具静态回退；不修改共享旧画面', () => {
  const input = sources(), next = new Map([...input, ...addCharacterLooks(input, 'lin', [{ image: 'blue', live2d: 'model' }])]);
  const look = characterLooks(next, 'lin')[0], changes = assignCharacterLook(next, 'a', look.visualId, 'right');
  const story = readStory(new Map([...next, ...changes])), visual = story.visuals.find(v => v.id === story.frames[0].visual)!;
  assert.equal(visual.background, 'red'); assert.equal(visual.portraits.length, 2); assert.equal(visual.portraits[0].character, 'other'); assert.equal(visual.portraits[1].live2d, 'model'); assert.equal(visual.portraits[1].image, 'blue');
  assert.equal(story.visuals.find(v => v.id === 'room')!.portraits.length, 1); assert.ok(changes.get('story.xml')!.includes('<!-- 保留场景备注 -->'));
  assert.throws(() => assignCharacterLook(next, 'a', look.visualId, 'bottom'));
});
test('修改背景或回退图时保留已有模型动作、参数、其他人物与注释', () => {
  const input = sources(); input.set('story.xml', base.replace('<!-- 保留场景备注 -->', '<portrait character="lin" image="red" slot="right" pose="normal"><live2d asset="model" motion="Idle:0"><parameter id="ParamAngleX" value="10"/></live2d></portrait><!-- 保留场景备注 -->'));
  const current = readStory(input).visuals.find(v => v.id === 'room')!;
  const changes = setFrameVisual(input, 'a', 'blue', current.portraits.map(p => p.character === 'lin' ? { ...p, image: 'blue' } : p));
  const xml = changes.get('story.xml')!;
  assert.ok(xml.includes('motion="Idle:0"><parameter id="ParamAngleX" value="10"/>'));
  const story = readStory(new Map([...input, ...changes])), visual = story.visuals.find(v => v.id === story.frames[0].visual)!;
  assert.equal(visual.background, 'blue'); assert.equal(visual.portraits[1].live2d, 'model'); assert.equal(visual.portraits[1].image, 'blue'); assert.equal(visual.portraits[0].character, 'other');
});
