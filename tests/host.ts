import * as vscode from 'vscode';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Session } from '../packages/extension/src/session';
import { emitRoutes, patchFrame, parseXml } from '../packages/source/src/index';
import { toolchain } from '../packages/extension/src/tools';
import { Adapter } from '../packages/debug-adapter/src/adapter';
import { Playtests } from '../packages/extension/src/playtest';
export async function run(): Promise<void> {
  const root = process.env.KAKERA_TEST_ROOT!, content = path.join(root, 'content');
  const toolInfo = await toolchain(process.env.KAKERA_TEST_TOOLS!);
  await fs.writeFile(path.join(content, 'scripts/routes.js'), emitRoutes([
    { frame: 'opening', kind: 'choice', option: 'explore', target: 'journey', updates: [{ op: 'add', variable: 'trust', value: { kind: 'constant', type: 'int', value: '1' } }] },
    { frame: 'opening', kind: 'choice', option: 'stay', target: 'ending', updates: [] },
    { frame: 'journey', kind: 'advance', target: 'journey', updates: [{ op: 'add', variable: 'trust', value: { kind: 'constant', type: 'int', value: '1' } }] }, { frame: 'ending', kind: 'end', updates: [] }
  ]));
  const extension = vscode.extensions.getExtension('dort0306.kakera-editor-vscode'); assert.ok(extension); await extension.activate();
  const commands = await vscode.commands.getCommands(true); assert.ok(commands.includes('kakera.storyboard.open'));
  const session = new Session(content, path.join(root, 'private'), vscode.window.createOutputChannel('Kakera Test'), async () => toolInfo.player);
  const loaded = await session.load(); assert.ok(loaded.routes); assert.equal(loaded.story.frames.length, 3);
  const doc = loaded.documents.get('story.xml')!; await vscode.window.showTextDocument(doc);
  const unsaved = patchFrame(doc.getText(), 'journey', { text: '未保存的宿主文档。' });
  const edit = new vscode.WorkspaceEdit(); edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), unsaved); assert.ok(await vscode.workspace.applyEdit(edit));
  const dirty = await session.load(); assert.equal(dirty.story.frames[1].text, '未保存的宿主文档。'); assert.ok(doc.isDirty);
  const frozen = await session.freeze(dirty); assert.ok((await fs.readFile(path.join(frozen.directory, 'story.xml'), 'utf8')).includes('未保存的宿主文档。')); await session.check(frozen); await frozen.dispose();
  await assert.rejects(session.apply(loaded, new Map([['story.xml', loaded.sources.get('story.xml')!]])), /改变/);
  const next = patchFrame(unsaved, 'journey', { text: '可撤销的可视修改。' }); await session.apply(dirty, new Map([['story.xml', next]])); assert.ok(doc.getText().includes('可撤销的可视修改。'));
  await vscode.commands.executeCommand('undo'); assert.ok(doc.getText().includes('未保存的宿主文档。')); await vscode.commands.executeCommand('redo'); assert.ok(doc.getText().includes('可撤销的可视修改。'));
  const latest = await session.load(), js = latest.documents.get('scripts/routes.js')!, jsBefore = js.getText();
  const pair = new Map([['story.xml', patchFrame(doc.getText(), 'journey', { text: '跨文件修改。' })], ['scripts/routes.js', jsBefore.replace('"journey"', '"missing"')]]);
  // The proposed pair is deliberately invalid and must never change either buffer.
  await assert.rejects(session.apply(latest, pair)); assert.equal(doc.getText(), latest.sources.get('story.xml')); assert.equal(js.getText(), jsBefore);
  const validPair = new Map([['story.xml', patchFrame(doc.getText(), 'journey', { text: '两个文件共同撤销。' })], ['scripts/routes.js', emitRoutes(latest.routes!.map(r => r.frame === 'opening' && r.option === 'stay' ? { ...r, target: 'journey' } : r))]]);
  await session.apply(latest, validPair); assert.ok(doc.getText().includes('两个文件共同撤销。')); assert.notEqual(js.getText(), jsBefore);
  await vscode.commands.executeCommand('undo'); assert.equal(doc.getText(), latest.sources.get('story.xml')); assert.equal(js.getText(), jsBefore);
  await vscode.commands.executeCommand('redo'); assert.ok(doc.getText().includes('两个文件共同撤销。'));
  await vscode.commands.executeCommand('undo');
  await vscode.commands.executeCommand('vscode.openWith', doc.uri, 'kakera.storyboard');
  await vscode.commands.executeCommand('workbench.action.splitEditor');
  assert.ok(vscode.window.tabGroups.all.flatMap(g => g.tabs).filter(t => t.input instanceof vscode.TabInputCustom).length >= 2);
  // Exercise the actual player through the inline DAP adapter without relying on a mock.
  const playtests = new Playtests(), adapter = new Adapter(session, playtests), responses = new Map<number, (message: any) => void>();
  adapter.onDidSendMessage((message: any) => { if (message.type === 'response') responses.get(message.request_seq)?.(message); });
  let seq = 0;
  const request = (command: string, args: object = {}): Promise<any> => new Promise((resolve, reject) => {
    const id = ++seq, timer = setTimeout(() => reject(new Error(`DAP timeout: ${command}`)), 30000);
    responses.set(id, message => { clearTimeout(timer); responses.delete(id); message.success ? resolve(message.body) : reject(new Error(message.message)); });
    adapter.handleMessage({ seq: id, type: 'request', command, arguments: args });
  });
  try {
    await request('initialize'); await request('launch'); await request('configurationDone');
    const journey = (await session.load()).story.frames[1];
    await request('setBreakpoints', { source: { path: doc.uri.fsPath }, breakpoints: [{ line: journey.line }, { line: 1, condition: 'x' }] });
    const stack = await request('stackTrace'); assert.equal(stack.stackFrames.length, 1);
    assert.ok((await request('source', { sourceReference: 1 })).content.includes('可撤销的可视修改。'));
    assert.ok((await request('variables', { variablesReference: 1 })).variables.some((v: any) => v.name === 'trust'));
    await assert.rejects(request('evaluate', { expression: '1+1' }));
    await request('next');
    const client = playtests.current!.debug!;
    let state = await client.request({ type: 'choose', option: 'explore' });
    assert.equal(state.frame_id, 'opening'); assert.equal(state.pending_frame, 'journey'); assert.equal(state.variables.trust.value, '0'); assert.equal(state.pending_variables!.trust.value, '1');
    await request('next'); state = await client.request({ type: 'status' }); assert.equal(state.frame_id, 'journey'); assert.equal(state.variables.trust.value, '1'); assert.equal(state.pending_frame, null);
    await client.request({ type: 'reveal' }); state = await client.request({ type: 'advance' }); assert.equal(state.frame_id, 'journey'); assert.equal(state.pending_frame, 'journey'); assert.equal(state.pending_variables!.trust.value, '2');
    await request('next'); state = await client.request({ type: 'status' }); assert.equal(state.variables.trust.value, '2');
    await request('disconnect');
  } finally { adapter.dispose(); await playtests.stop(); }
  console.log('HOST PASS: activation, dirty buffers, frozen CLI validation, stale rejection, undo/redo, invalid transaction, multiple custom editors, real-player inline DAP.');
}
