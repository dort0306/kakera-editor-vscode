import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editUi, readUiDesign } from '../packages/source/src/ui-source';
import { readStory, type Sources } from '../packages/source/src/index';
import { previewUi } from '../packages/domain/src/ui-preview';
import { uiNodes } from '../packages/domain/src/ui';

const script = [
  'ui("advance").bind("advance", (ctx) => { ctx.advance(); });',
  'ui("backgroundPicker").bind("color-bg", (ctx) => { ctx.setUi("bgDraft", ctx.value); });',
  'ui("textPicker").bind("color-bg", (ctx) => { ctx.setUi("textDraft", ctx.value); });',
  'ui("$host").bind("shortcut-captured", (ctx) => { ctx.setUi("shortcutDraft", ctx.value); });'
].join('\n');

function fixture(): Sources {
  return new Map([
    ['story.xml', '<story schema="8" id="s" content-version="1" entry="a"><interface src="ui.xml"/><scripts><script src="ui.js"/></scripts><frames><frame id="a"><text>台词</text></frame></frames><next end="true"/></story>'],
    ['ui.xml', `<ui schema="3" width="1280" height="720" initial="hud"><variables><string id="bgDraft" initial="#10253BFF"/><string id="textDraft" initial="#F4EAD8FF"/><string id="shortcutDraft" initial=""/></variables><palette><color id="dialogue_background" initial="#10253BFF"/><color id="dialogue_text" initial="#F4EAD8FF"/></palette><screen id="hud" modal="false" pause="false"><panel id="panel" x="20" y="20" width="300" height="120" color-bind="colors.dialogue_background"/><color-picker id="backgroundPicker" x="40" y="160" width="256" height="320" value="ui.bgDraft" event="color-bg" alpha="true"/><color-picker id="textPicker" x="330" y="160" width="256" height="320" value="ui.textDraft" event="color-bg" alpha="false"/><button id="capture" x="40" y="500" width="200" height="40" text="更改" event="advance"/></screen></ui>`],
    ['ui.js', script]
  ]);
}

test('v0.10.0 palette、color-picker、color-bind 与快捷键事件按源码解析', () => {
  const sources = fixture(), design = readUiDesign(sources);
  assert.deepEqual(design.palette.map(slot => [slot.id, slot.initial]), [['dialogue_background', '#10253BFF'], ['dialogue_text', '#F4EAD8FF']]);
  const pickers = design.screens.flatMap(screen => screen.children).filter(node => node.kind === 'color-picker');
  assert.equal(pickers.length, 2); assert.equal(pickers[0].attrs.alpha, 'true'); assert.equal(pickers[1].attrs.alpha, 'false');
  assert.equal(design.screens[0].children.find(node => node.id === 'panel')!.attrs['color-bind'], 'colors.dialogue_background');
  assert.ok(design.events.some(event => event.command === 'advance'));
  const preview = previewUi(design, design.screens[0], readStory(sources), 'a');
  assert.equal(preview.find(item => item.node.id === 'panel')!.colorValue, '#10253BFF');
  assert.equal(preview.find(item => item.node.id === 'backgroundPicker')!.colorValue, '#10253BFF');
  assert.equal(preview.find(item => item.node.id === 'textPicker')!.colorValue, '#F4EAD8FF');
});

test('palette、color-picker、color-bind 的源码事务和严格校验', () => {
  let sources = fixture();
  const added = editUi(sources, { action: 'palette', file: 'ui.xml', id: 'accent', initial: '#ff0000' }); sources = new Map([...sources, ...added.changes]);
  assert.equal(readUiDesign(sources).palette.find(slot => slot.id === 'accent')!.initial, '#FF0000FF');
  assert.ok(sources.get('ui.xml')!.includes('<color id="accent" initial="#FF0000FF" />'));
  const edited = editUi(sources, { action: 'palette', original: 'accent', file: 'ui.xml', id: 'accent', initial: '#00FF00FF' }); sources = new Map([...sources, ...edited.changes]);
  assert.equal(readUiDesign(sources).palette.find(slot => slot.id === 'accent')!.initial, '#00FF00FF');
  assert.throws(() => editUi(sources, { action: 'palette', original: 'accent', file: 'ui.xml', id: 'renamed', initial: '#00FF00FF' }), /创建后固定/);
  assert.throws(() => editUi(sources, { action: 'palette', file: 'ui.xml', id: 'bad-id', initial: '#00FF00FF' }), /\[a-z\]/);
  assert.throws(() => editUi(sources, { action: 'palette', file: 'ui.xml', id: 'accent', initial: '#GG0000' }), /颜色/);
  const node = editUi(sources, { action: 'addNode', screen: 'hud', kind: 'color-picker', value: 'ui.bgDraft', event: 'color-bg', eventTarget: 'backgroundPicker', alpha: 'false' }); sources = new Map([...sources, ...node.changes]);
  const picker = readUiDesign(sources).screens[0].children.find(item => item.id === node.selected)!;
  assert.equal(picker.kind, 'color-picker'); assert.equal(picker.attrs.alpha, 'false');
  assert.deepEqual([picker.attrs.width, picker.attrs.height], ['256', '256']);
  const auto = editUi(sources, { action: 'addNode', screen: 'hud', kind: 'color-picker', value: 'ui.bgDraft' }); sources = new Map([...sources, ...auto.changes]);
  const autoPicker = readUiDesign(sources).screens[0].children.find(item => item.id === auto.selected)!;
  assert.deepEqual([autoPicker.attrs.width, autoPicker.attrs.height], ['256', '282']);
  const autoEvent = readUiDesign(sources).events.find(event => event.name === autoPicker.attrs.event)!;
  assert.equal(autoEvent.command, 'setUi'); assert.equal(autoEvent.commandTarget, 'bgDraft');
  assert.ok(sources.get('ui.js')!.includes('ctx.setUi("bgDraft", ctx.value);'));
  const autoDraft = editUi(sources, { action: 'addNode', screen: 'hud', kind: 'color-picker' }); sources = new Map([...sources, ...autoDraft.changes]);
  const autoDraftNode = readUiDesign(sources).screens[0].children.find(item => item.id === autoDraft.selected)!;
  assert.deepEqual([autoDraftNode.attrs.width, autoDraftNode.attrs.height], ['256', '282']);
  assert.match(autoDraftNode.attrs.value, /^ui\.color[0-9a-f]+$/);
  const draftName = autoDraftNode.attrs.value.slice(3);
  assert.equal(readUiDesign(sources).variables.find(variable => variable.id === draftName)!.initial, '#FFFFFFFF');
  const autoDraftEvent = readUiDesign(sources).events.find(event => event.name === autoDraftNode.attrs.event)!;
  assert.equal(autoDraftEvent.command, 'setUi'); assert.equal(autoDraftEvent.commandTarget, draftName);
  assert.throws(() => editUi(sources, { action: 'addNode', screen: 'hud', kind: 'color-picker', value: 'ui.missing' }), /UI string/);
  const bound = editUi(sources, { action: 'patchNode', id: 'panel', patch: { 'color-bind': 'colors.accent' } }); sources = new Map([...sources, ...bound.changes]);
  assert.equal(readUiDesign(sources).screens[0].children.find(item => item.id === 'panel')!.attrs['color-bind'], 'colors.accent');
  assert.throws(() => editUi(sources, { action: 'patchNode', id: 'panel', patch: { color: '#FFFFFFFF' } }), /color-bind/);
  assert.throws(() => editUi(sources, { action: 'patchNode', id: 'panel', patch: { 'color-bind': 'colors.missing' } }), /color-bind/);
});

test('快捷键、颜色覆盖与退出事件生成固定回调；非法动作/保留组合拒绝', () => {
  let sources = fixture();
  const add = (name: string, command: string, extra: Record<string, string>) => { const result = editUi(sources, { action: 'event', name, command: command as any, target: 'backgroundPicker', ...extra }); sources = new Map([...sources, ...result.changes]); };
  add('shortcut-capture-advance', 'captureShortcut', { actionValue: 'advance', resultEvent: 'shortcut-captured' });
  assert.ok(sources.get('ui.js')!.includes('ctx.captureShortcut("advance", "shortcut-captured");'));
  add('shortcut-set', 'keybinding', { actionValue: 'advance', binding: 'enter' });
  assert.ok(sources.get('ui.js')!.includes('ctx.keybinding("advance", "Enter");'));
  add('shortcut-clear', 'keybinding', { actionValue: 'skip_sequence', binding: '' });
  assert.ok(sources.get('ui.js')!.includes('ctx.keybinding("skip_sequence", null);'));
  add('shortcut-reset', 'resetKeybindings', {});
  add('update-bg', 'setUi', { targetValue: 'bgDraft' });
  assert.ok(sources.get('ui.js')!.includes('ctx.setUi("bgDraft", ctx.value);'));
  assert.equal(readUiDesign(sources).events.find(event => event.name === 'update-bg')!.command, 'setUi');
  add('color-apply', 'colorPreference', { slot: 'dialogue_text', color: '#ff0000' });
  assert.ok(sources.get('ui.js')!.includes('ctx.colorPreference("dialogue_text", "#FF0000FF");'));
  add('color-draft', 'colorPreference', { slot: 'dialogue_text', colorVariable: 'bgDraft' });
  assert.ok(sources.get('ui.js')!.includes('ctx.colorPreference("dialogue_text", ctx.ui.bgDraft);'));
  add('color-reset', 'resetColors', {});
  add('quit-game', 'quit', {});
  assert.ok(sources.get('ui.js')!.includes('ctx.quit();'));
  const design = readUiDesign(sources);
  assert.equal(design.events.find(event => event.name === 'shortcut-set')!.binding, 'Enter');
  assert.equal(design.events.find(event => event.name === 'shortcut-clear')!.binding, null);
  assert.equal(design.events.find(event => event.name === 'color-apply')!.color, '#FF0000FF');
  assert.equal(design.events.find(event => event.name === 'color-draft')!.colorVariable, 'bgDraft');
  assert.equal(design.events.find(event => event.name === 'color-draft')!.color, undefined);
  assert.equal(design.events.find(event => event.name === 'quit-game')!.command, 'quit');
  let cjk = new Map([...sources, ...editUi(sources, { action: 'variable', file: 'ui.xml', name: '草稿', type: 'string', initial: '#00FF00FF' }).changes]);
  cjk = new Map([...cjk, ...editUi(cjk, { action: 'event', name: 'color-cjk', command: 'colorPreference', target: 'backgroundPicker', slot: 'dialogue_text', colorVariable: '草稿' }).changes]);
  assert.ok(cjk.get('ui.js')!.includes('ctx.colorPreference("dialogue_text", ctx.ui["草稿"]);'));
  assert.equal(readUiDesign(cjk).events.find(event => event.name === 'color-cjk')!.colorVariable, '草稿');
  let colorRef = new Map([...sources, ...editUi(sources, { action: 'variable', file: 'ui.xml', name: 'applyDraft', type: 'string', initial: '#00FF00FF' }).changes]);
  colorRef = new Map([...colorRef, ...editUi(colorRef, { action: 'event', name: 'color-apply-draft', command: 'colorPreference', target: 'backgroundPicker', slot: 'dialogue_text', colorVariable: 'applyDraft' }).changes]);
  assert.throws(() => editUi(colorRef, { action: 'deleteVariable', id: 'applyDraft' }), /事件 color-apply-draft/);
  const empty = new Map([...sources, ...editUi(sources, { action: 'variable', file: 'ui.xml', name: 'emptyColor', type: 'string', initial: '' }).changes]);
  const warned = new Map([...empty, ...editUi(empty, { action: 'event', name: 'color-empty', command: 'colorPreference', target: 'backgroundPicker', slot: 'dialogue_text', colorVariable: 'emptyColor' }).changes]);
  assert.ok(readUiDesign(warned).warnings.some(warning => warning.includes('emptyColor') && warning.includes('颜色')));
  assert.throws(() => editUi(sources, { action: 'event', name: 'bad', command: 'keybinding', target: 'backgroundPicker', actionValue: 'advance', binding: 'Escape' }), /Escape/);
  assert.throws(() => editUi(sources, { action: 'event', name: 'bad', command: 'keybinding', target: 'backgroundPicker', actionValue: 'advance', binding: 'Ctrl+Alt+KeyK' }), /Ctrl\+Alt/);
  assert.throws(() => editUi(sources, { action: 'event', name: 'bad', command: 'captureShortcut', target: 'backgroundPicker', actionValue: 'missing', resultEvent: 'shortcut-captured' }), /动作/);
  assert.throws(() => editUi(sources, { action: 'event', name: 'bad', command: 'captureShortcut', target: 'backgroundPicker', actionValue: 'advance', resultEvent: 'missing' }), /结果事件/);
  assert.throws(() => editUi(sources, { action: 'event', name: 'bad', command: 'colorPreference', target: 'backgroundPicker', slot: 'missing', color: '#FFFFFFFF' }), /槽位/);
  assert.throws(() => editUi(sources, { action: 'event', name: 'bad', command: 'colorPreference', target: 'backgroundPicker', slot: 'dialogue_background', color: 'red' }), /颜色/);
  assert.throws(() => editUi(sources, { action: 'event', name: 'bad', command: 'colorPreference', target: 'backgroundPicker', slot: 'dialogue_text', colorVariable: 'missing' }), /UI string/);
  assert.throws(() => editUi(sources, { action: 'event', name: 'bad', command: 'colorPreference', target: 'backgroundPicker', slot: 'dialogue_text', colorVariable: 'bgDraft', color: '#FFFFFFFF' }), /之一/);
  assert.throws(() => editUi(sources, { action: 'deleteVariable', id: 'bgDraft' }), /value|事件/);
  assert.throws(() => editUi(sources, { action: 'deletePalette', id: 'dialogue_text' }), /颜色事件/);
});

test('快捷弹窗生成模态页面、唯一短 ID，可选 ctx.quit 事件', () => {
  let sources = fixture();
  const popup = editUi(sources, { action: 'addPopup', file: 'ui.xml', title: '退出游戏', message: '确定退出吗？', confirmText: '退出', cancelText: '取消', accept: 'quit' });
  sources = new Map([...sources, ...popup.changes]);
  const design = readUiDesign(sources), screen = design.screens.find(item => item.id === popup.screen)!;
  assert.ok(screen); assert.equal(screen.attrs.modal, 'true'); assert.equal(screen.attrs.pause, 'true');
  const nodes = uiNodes(screen.children); assert.ok(nodes.some(node => node.kind === 'panel'));
  assert.ok(nodes.some(node => node.kind === 'label' && node.attrs.text === '退出游戏'));
  assert.ok(nodes.some(node => node.kind === 'label' && node.attrs.text === '确定退出吗？'));
  assert.ok(nodes.some(node => node.kind === 'button' && node.attrs.text === '退出' && design.events.some(event => event.name === node.attrs.event && event.command === 'quit')));
  assert.ok(nodes.some(node => node.kind === 'button' && node.attrs.text === '取消' && node.attrs.route === 'close'));
  assert.ok(nodes.every(node => node.id.length === 16 && /^[0-9a-f]{16}$/.test(node.id)));
  assert.ok(sources.get('ui.js')!.includes('ctx.quit();'));
  const closePopup = editUi(sources, { action: 'addPopup', file: 'ui.xml', name: 'confirmClose', message: '关闭？', accept: 'close' });
  assert.equal(uiNodes(readUiDesign(new Map([...sources, ...closePopup.changes])).screens.find(item => item.id === 'confirmClose')!.children).some(node => node.kind === 'button' && node.attrs.text === '确定' && node.attrs.route === 'close'), true);
});

test('v0.10.0 新节点/绑定/事件的严格限制与不可编辑诊断', () => {
  const broken = (xml: string, js = script) => new Map([...fixture()].map(([file, text]) => [file, file === 'ui.xml' ? xml : file === 'ui.js' ? js : text]));
  const base = fixture().get('ui.xml')!;
  assert.throws(() => readUiDesign(broken(base.replace(' event="color-bg"', ''), script)), /color-picker 需要 event/);
  const picker = (width: string, height: string, alpha?: string) => base.replace('<color-picker id="backgroundPicker" x="40" y="160" width="256" height="320" value="ui.bgDraft" event="color-bg" alpha="true"/>', `<color-picker id="backgroundPicker" x="40" y="160" width="${width}" height="${height}" value="ui.bgDraft" event="color-bg"${alpha ? ` alpha="${alpha}"` : ''}/>`);
  for (const [width, height, alpha] of [['127', '282'], ['128', '153', 'true'], ['128', '128']] as const) assert.throws(() => readUiDesign(broken(picker(width, height, alpha), script)), /至少 128×128/);
  for (const [width, height, alpha] of [['128', '128', 'false'], ['128', '153', 'false'], ['128', '154', 'true'], ['256', '320', 'true']] as const) assert.ok(readUiDesign(broken(picker(width, height, alpha), script)), `${width}x${height} alpha=${alpha ?? 'default'} 应接受`);
  assert.throws(() => readUiDesign(broken(base.replace('<panel id="panel"', '<repeat id="r" x="0" y="0" width="400" height="200" source="choices" item-width="200" item-height="60"><color-picker id="nested" width="256" height="320" value="ui.bgDraft" event="color-bg"/></repeat><panel id="panel"'), script)), /repeat/);
  assert.throws(() => readUiDesign(broken(base.replace('<color id="dialogue_text" initial="#F4EAD8FF"/>', '<color id="dialogue_text" initial="#F4EAD8FF"/><color id="dialogue_text" initial="#FFFFFFFF"/>'), script)), /唯一/);
  assert.throws(() => readUiDesign(broken(base.replace('<color id="dialogue_text" initial="#F4EAD8FF"/>', '<color id="Bad" initial="#F4EAD8FF"/>'), script)), /\[a-z\]/);
  assert.throws(() => readUiDesign(broken(base.replace('color-bind="colors.dialogue_background"', 'color="#FFFFFFFF" color-bind="colors.dialogue_background"'), script)), /不能同时/);
  assert.throws(() => readUiDesign(broken(base.replace('color-bind="colors.dialogue_background"', 'color-bind="colors.missing"'), script)), /color-bind/);
  assert.throws(() => readUiDesign(broken(base.replace('value="ui.bgDraft"', 'value="ui.missing"'), script)), /UI string/);
  const invalidCapture = readUiDesign(broken(base, script + '\nui("backgroundPicker").bind("captured", (ctx) => { ctx.keybinding("advance", "Escape"); });'));
  assert.equal(invalidCapture.events.at(-1)!.editable, false); assert.match(invalidCapture.events.at(-1)!.reason!, /Escape/);
  const invalidSlot = readUiDesign(broken(base, script + '\nui("backgroundPicker").bind("captured", (ctx) => { ctx.colorPreference("missing", "#FFFFFFFF"); });'));
  assert.equal(invalidSlot.events.at(-1)!.editable, false); assert.match(invalidSlot.events.at(-1)!.reason!, /槽位/);
  const mismatch = readUiDesign(broken(base.replace('event="color-bg"', 'event="update-bg"'), script + '\nui("backgroundPicker").bind("update-bg", (ctx) => { ctx.setUi("textDraft", ctx.value); });'));
  assert.ok(mismatch.warnings.some(warning => /绑定变量|会回退|事件 update-bg/.test(warning)));
  const invalidSet = readUiDesign(broken(base, script + '\nui("backgroundPicker").bind("update-missing", (ctx) => { ctx.setUi("missing", ctx.value); });'));
  assert.equal(invalidSet.events.find(event => event.name === 'update-missing')!.editable, false); assert.match(invalidSet.events.find(event => event.name === 'update-missing')!.reason!, /变量/);
  const notSetUi = readUiDesign(broken(base.replace('event="color-bg"', 'event="advance"'), script + '\nui("backgroundPicker").bind("advance", (ctx) => { ctx.advance(); });'));
  assert.ok(notSetUi.warnings.some(warning => /不会调用 ctx.setUi/.test(warning)));
  assert.throws(() => editUi(fixture(), { action: 'deletePalette', id: 'dialogue_background' }), /color-bind/);
});
