import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import assert from 'node:assert/strict';
import { splitUiFixture } from './ui-fixture';
import { readUiDesign, editUi } from '../packages/source/src/ui-source';
import { readGameTitle, patchGameTitle, readStory, type Sources } from '../packages/source/src/index';
import { launch } from '../packages/extension/src/tools';
import { archiveEntries } from '../packages/extension/src/archive';
import { zstdDecompressSync } from 'node:zlib';
import { pngFixture } from './image-fixture';
async function pathsV1(file: string): Promise<{ path: string }[]> {
  const bytes = await fs.readFile(file); assert.equal(bytes.readUInt32LE(8), 1); assert.ok(bytes.readBigUInt64LE(24) < 64n * 1024n * 1024n);
  const payload = zstdDecompressSync(bytes.subarray(64), { maxOutputLength: 64 * 1024 * 1024 });
  const result: { path: string }[] = []; let offset = 4;
  for (let i = 0; i < payload.readUInt32LE(0); i++) { const n = payload.readUInt16LE(offset); offset += 2; result.push({ path: payload.toString('utf8', offset, offset + n) }); offset += n + 4; }
  return result;
}
export async function verifyUiEditor(tools: { player: string; packer: string }, root: string, original: string): Promise<void> {
  const content = path.join(root, 'ui-editor-content'); await fs.cp(original, content, { recursive: true });
  const sources: Sources = new Map(); for (const file of ['story.xml', 'ui.xml', 'scripts/ui.js', 'scripts/routes.js']) sources.set(file, await fs.readFile(path.join(content, file), 'utf8'));
  let next = splitUiFixture(sources);
  next = new Map([...next, ...patchGameTitle(next, 'UI 编辑器真实校验')]);
  const apply = (operation: unknown) => { const result = editUi(next, operation); next = new Map([...next, ...result.changes]); return result; };
  apply({ action: 'patchNode', id: 'text', patch: { x: '32', y: '48', width: '1100', 'font-size': '26' } });
  apply({ action: 'patchNode', id: 'speaker', patch: { color: '#FFEEDDFF' } });
  const page = apply({ action: 'addScreen', file: 'ui/pages.xml', name: 'editorHelp' }).screen!;
  apply({ action: 'event', name: 'editor.openHelp', command: 'open', target: page });
  apply({ action: 'event', name: 'editor.closeHelp', command: 'close' });
  apply({ action: 'event', name: 'editor.mute', command: 'setting', target: 'muted' });
  next.set('story.xml', next.get('story.xml')!.replace('</assets>', '<audio id="ui.testTone" src="ui-tone.wav"/></assets>'));
  const wave = Buffer.alloc(204); wave.write('RIFF'); wave.writeUInt32LE(196,4); wave.write('WAVEfmt ',8); wave.writeUInt32LE(16,16); wave.writeUInt16LE(1,20); wave.writeUInt16LE(1,22); wave.writeUInt32LE(8000,24); wave.writeUInt32LE(16000,28); wave.writeUInt16LE(2,32); wave.writeUInt16LE(16,34); wave.write('data',36); wave.writeUInt32LE(160,40); await fs.writeFile(path.join(content,'ui-tone.wav'),wave);
  apply({action:'media',item:{kind:'sound',id:'ui.click',file:'ui/state.xml',attrs:{},steps:[{kind:'clip',attrs:{asset:'ui.testTone',weight:'2',enabled:'true'}}]}});
  const button = apply({ action: 'addNode', screen: 'hud', kind: 'button', event: 'editor.openHelp' }).selected!;
  apply({ action: 'patchNode', id: button, patch: { event: '', route: `open:${page}` } });
  const panel = apply({ action: 'addNode', screen: page, kind: 'panel' }).selected!;
  const label = apply({ action: 'addNode', screen: page, parent: panel, kind: 'label' }).selected!;
  apply({ action: 'patchNode', id: label, patch: { text: '第一行\n第二行 & <UI>', color: '#FFFFFF' } });
  const close = apply({ action: 'addNode', screen: page, parent: panel, kind: 'button', event: 'editor.closeHelp' }).selected!;
  apply({ action: 'patchNode', id: close, patch: { event: '', route: 'close' } });
  apply({ action: 'addNode', screen: page, kind: 'toggle', event: 'editor.mute' });
  apply({action:'media',item:{kind:'sequence',id:'ui.reveal',file:'ui/pages.xml',attrs:{finish:'return',skippable:'true'},steps:[{kind:'fade',attrs:{target:panel,from:'0',to:'1',duration:'400'}},{kind:'sound',attrs:{ref:'ui.click'}}]}});
  apply({action:'patchScreen',id:page,patch:{sequence:'ui.reveal'}});
  apply({action:'patchNode',id:button,patch:{sound:'ui.click'}});
  apply({action:'event',name:'editor.reveal',command:'sequence',target:'ui.reveal'});
  apply({action:'event',name:'editor.click',command:'playSound',target:'ui.click'});
  apply({action:'event',name:'editor.soundEnabled',command:'soundEnabled'});
  apply({action:'event',name:'editor.present',command:'present',target:page});
  apply({action:'event',name:'editor.resume',command:'resume',target:'opening',page:'hud'});
  assert.ok(next.get('scripts/ui.js')!.includes('ctx.open("hud"); ctx.resume("opening")'));
  apply({action:'event',name:'editor.temp',command:'close'});
  apply({action:'event',original:'editor.temp',name:'editor.temp.next',command:'advance'});
  assert.ok(next.get('scripts/ui.js')!.includes('on.ui("editor.temp.next"'));
  apply({action:'deleteEvent',name:'editor.temp.next'});
  assert.ok(!next.get('scripts/ui.js')!.includes('editor.temp.next'));
  await fs.mkdir(path.join(content, 'assets/cg'), { recursive: true }); await fs.writeFile(path.join(content, 'assets/cg/test.png'), pngFixture());
  next.set('story.xml', next.get('story.xml')!.replace('</assets>', '<cg id="cg.test" src="assets/cg/test.png"/></assets>').replace('<visuals>', '<visuals><visual id="cg.testVisual" cg="cg.test" />').replace('visual="empty"', 'visual="cg.testVisual"'));
  next.set('ui/state.xml', next.get('ui/state.xml')!.replace('</ui>', '<gallery><cg id="cg.test" image="cg.test" title="测试 CG" unlocked="true" /></gallery></ui>'));
  next.set('ui/pages/hud.xml', next.get('ui/pages/hud.xml')!.replace('</screen>', '<label id="cgProgress" x="10" y="10" width="400" height="40" bind="cg.progress" /></screen>'));
  apply({action:'event',name:'cg.unlock',command:'unlock',target:'cg.test'});
  assert.ok(next.get('scripts/ui.js')!.includes('ctx.unlock("cg.test")'));
  assert.equal(readUiDesign(next).gallery.find(g => g.id === 'cg.test')!.title, '测试 CG');
  const soundOnly = apply({action:'addNode',screen:page,kind:'button',event:'editor.click'}).selected!;
  apply({action:'patchNode',id:soundOnly,patch:{event:'',sound:'ui.click'}});
  apply({ action: 'variable', file: 'ui/state.xml', name: 'hugeInteger', type: 'int', initial: '9007199254740993' });
  next.set('scripts/ui.js', next.get('scripts/ui.js')! + `\non.frameEnter('opening', ctx => ctx.setUi('windowTitle', '进入'));\non.frameExit('opening', ctx => ctx.open(${JSON.stringify(page)}));\non.screenOpen(${JSON.stringify(page)}, ctx => ctx.sequence('ui.reveal'));\non.screenClose(${JSON.stringify(page)}, ctx => ctx.resume('opening'));\n`);
  assert.equal(readGameTitle(next).text, 'UI 编辑器真实校验'); assert.ok(readUiDesign(next).screens.some(s => s.id === page));
  assert.ok(readStory(next).scripts.includes('scripts/ui.js'));
  for (const [file, text] of next) { await fs.mkdir(path.dirname(path.join(content, file)), { recursive: true }); await fs.writeFile(path.join(content, file), text); }
  await launch(tools.player, ['--project', content, '--check', '--no-audio', '--no-live2d'], () => {}).done;
  const bad = next.get('ui/pages.xml')!.replace('target="'+panel+'"','target="missing.control"');
  await fs.writeFile(path.join(content,'ui/pages.xml'),bad);
  await assert.rejects(launch(tools.player,['--project',content,'--check','--no-audio','--no-live2d'],()=>{}).done);
  await fs.writeFile(path.join(content,'ui/pages.xml'),next.get('ui/pages.xml')!);
  await fs.writeFile(path.join(content,'ui-audio.json'),'private preference');
  await fs.writeFile(path.join(content,'flow-checkpoint.json'),'{"schema":1,"active":true}');
  const before = new Map(next);
  for (const format of [1, 2]) {
    const output = path.join(root, `ui-editor-${format}.kpak`);
    await launch(tools.packer, [content, output, '--format', String(format), '--level', '1', '--no-live2d'], () => {}).done;
    await launch(tools.player, ['--package', output, '--check', '--no-audio', '--no-live2d'], () => {}).done;
    const entries = format === 2 ? await archiveEntries(output) : await pathsV1(output);
    assert.ok(!entries.some(e => e.path === 'ui-audio.json')); assert.ok(!entries.some(e => e.path === 'flow-checkpoint.json'));
    assert.ok(entries.some(e => e.path === 'ui-tone.wav')); assert.ok(entries.some(e => e.path === 'ui.xml')); assert.ok(!entries.some(e => e.path.startsWith('ui/'))); assert.ok(entries.some(e => e.path === 'scripts/ui.js'));
  }
  for (const [file, text] of before) assert.equal(await fs.readFile(path.join(content, file), 'utf8'), text);
  assert.ok(next.get('ui/pages/hud.xml')!.includes(button));
  console.log('UI EDITOR NATIVE PASS: nested includes, cross-file title/control edits, pages/buttons/toggle/events/UI i64 variables, CG asset/visual/gallery/progress/unlock bindings, UI sequences/sound groups/sound-only buttons, present/resume events, frame/screen lifecycle registrations, invalid fade target rejection, audio preference and hidden-checkpoint exclusion, real engine validation, KPAK 1/2 merge, independent package check and original source preservation.');
}
