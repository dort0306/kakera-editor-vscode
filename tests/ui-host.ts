import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import assert from 'node:assert/strict';
import { Session } from '../packages/extension/src/session';
import { readUiDesign, editUi } from '../packages/source/src/ui-source';
import { splitUiFixture } from './ui-fixture';
import { patchGameTitle } from '../packages/source/src/index';

export async function verifyUiHost(session: Session): Promise<void> {
  let loaded = await session.load();
  const before = loaded.sources.get('ui.xml')!, jsBefore = loaded.sources.get('scripts/ui.js')!;
  let split = splitUiFixture(loaded.sources); split = new Map([...split, ...patchGameTitle(split, '新游戏标题')]);
  // Prepare only new, unreferenced test fixture files; canonical entry changes via WorkspaceEdit.
  for (const [file, text] of split) if (!loaded.sources.has(file)) { const absolute = path.join(session.root, file); await fs.mkdir(path.dirname(absolute), { recursive: true }); await fs.writeFile(absolute, text, { flag: 'wx' }); }
  await session.apply(loaded, new Map([['ui.xml', split.get('ui.xml')!]]), undefined, { save: true });
  loaded = await session.load(); assert.ok(loaded.documents.has('ui/pages/hud.xml')); assert.ok(loaded.documents.has('ui/state.xml'));
  const hud = loaded.documents.get('ui/pages/hud.xml')!, state = loaded.documents.get('ui/state.xml')!;
  const draft = editUi(loaded.sources, { action: 'patchNode', id: 'text', patch: { x: '33' } }).changes.get('ui/pages/hud.xml')!;
  const replace = new vscode.WorkspaceEdit(); replace.replace(hud.uri, new vscode.Range(hud.positionAt(0), hud.positionAt(hud.getText().length)), draft); assert.equal(await vscode.workspace.applyEdit(replace), true);
  loaded = await session.load(); assert.equal(hud.isDirty, true); assert.equal(readUiDesign(loaded.sources).screens[0].file, 'ui/pages/hud.xml');
  const frozen = await session.freeze(loaded); try { assert.equal(await fs.readFile(path.join(frozen.directory, 'ui/pages/hud.xml'), 'utf8'), hud.getText()); await session.check(frozen); } finally { await frozen.dispose(); }
  const stale = loaded;
  const changed = editUi(loaded.sources, { action: 'patchNode', id: 'text', patch: { x: '40', width: '1100' } });
  await session.apply(loaded, changed.changes, undefined, { save: true }); assert.equal(hud.isDirty, false); assert.ok(hud.getText().includes('x="40"'));
  await vscode.window.showTextDocument(hud); await vscode.commands.executeCommand('undo'); assert.ok(hud.getText().includes('x="33"')); await vscode.commands.executeCommand('redo'); assert.ok(hud.getText().includes('x="40"')); await hud.save();
  await assert.rejects(session.apply(stale, changed.changes, undefined, { save: true }), /改变/);
  loaded = await session.load(); const title = patchGameTitle(loaded.sources, '子文件标题'); assert.deepEqual([...title.keys()], ['ui/state.xml']); await session.apply(loaded, title, undefined, { save: true }); assert.equal(state.isDirty, false);
  loaded = await session.load(); await session.apply(loaded, patchGameTitle(loaded.sources, '新游戏标题'), undefined, { save: true });
  loaded = await session.load();
  const variableDocument = loaded.documents.get('ui/state.xml')!;
  await session.apply(loaded, editUi(loaded.sources, { action: 'deleteVariable', id: 'show' }).changes, undefined, { save: true });
  assert.equal(readUiDesign((await session.load()).sources).variables.some(variable => variable.id === 'show'), false);
  await vscode.window.showTextDocument(variableDocument);
  await vscode.commands.executeCommand('undo');
  assert.equal(readUiDesign((await session.load()).sources).variables.some(variable => variable.id === 'show'), true);
  await vscode.commands.executeCommand('redo');
  assert.equal(readUiDesign((await session.load()).sources).variables.some(variable => variable.id === 'show'), false);
  await variableDocument.save(); assert.equal(variableDocument.isDirty, false);
  loaded = await session.load();
  const beforeMoveHud = hud.getText(), pages = loaded.documents.get('ui/pages.xml')!, beforeMovePages = pages.getText();
  const move = editUi(loaded.sources, { action: 'moveNode', id: 'end', screen: 'settings', index: 0 }); assert.equal(move.changes.size, 2); await session.apply(loaded, move.changes, undefined, { save: true });
  assert.ok(!hud.getText().includes('id="end"')); assert.ok(pages.getText().includes('id="end"')); assert.equal(hud.isDirty, false); assert.equal(pages.isDirty, false);
  await vscode.window.showTextDocument(hud); await vscode.commands.executeCommand('undo'); assert.equal(hud.getText(), beforeMoveHud); assert.equal(pages.getText(), beforeMovePages);
  await vscode.commands.executeCommand('redo'); assert.ok(pages.getText().includes('id="end"'));
  await vscode.commands.executeCommand('undo'); await hud.save(); await pages.save();
  loaded = await session.load(); assert.equal(loaded.sources.get('scripts/ui.js'), jsBefore);
  // Reject a bad binding using the real engine, leaving both source buffers and disk intact.
  const invalid = editUi(loaded.sources, { action: 'patchNode', id: 'text', patch: { bind: 'ui.notDeclared' } });
  await assert.rejects(session.apply(loaded, invalid.changes, undefined, { save: true })); assert.equal(hud.getText(), beforeMoveHud);
  assert.notEqual(before, loaded.sources.get('ui.xml')); assert.ok(loaded.sources.get('ui.xml')!.includes('<include'));
  // Missing screen references follow unsaved JS and included XML, without writing either file.
  const script = loaded.documents.get('scripts/ui.js')!, scriptBefore = script.getText(), pagesBefore = pages.getText();
  const replaceBuffer = async (document: vscode.TextDocument, text: string) => {
    const edit = new vscode.WorkspaceEdit(); edit.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), text);
    assert.equal(await vscode.workspace.applyEdit(edit), true);
  };
  try {
    await replaceBuffer(script, scriptBefore + '\nui("settings").bind("screen.open", ctx => {});\nevent.register("handoff.check", ctx => ctx.present("settings"));\n');
    await replaceBuffer(pages, pagesBefore.replace('id="settings"', 'id="settings.draft"'));
    loaded = await session.load();
    assert.equal(script.isDirty, true); assert.equal(pages.isDirty, true);
    assert.equal(loaded.logic.screenIssues.filter(i => i.includes('页面不存在：settings')).length, 2);
    assert.deepEqual(readUiDesign(loaded.sources).warnings.filter(i => i.includes('页面不存在')), loaded.logic.screenIssues);
    assert.equal(await fs.readFile(script.uri.fsPath, 'utf8'), scriptBefore);
    assert.equal(await fs.readFile(pages.uri.fsPath, 'utf8'), pagesBefore);
    await replaceBuffer(pages, pagesBefore);
    assert.equal((await session.load()).logic.screenIssues.length, 0);
  } finally { await replaceBuffer(script, scriptBefore); await replaceBuffer(pages, pagesBefore); }
  console.log('HOST SCREEN REFERENCES PASS: unsaved JS/include diagnostics, source positions, buffer repair clears warnings, disk unchanged.');
  loaded = await session.load(); const lifecycleBefore = script.getText();
  await session.apply(loaded, editUi(loaded.sources, { action: 'lifecycle', kind: 'frameExit', owner: 'journey', mode: 'page', target: 'settings' }).changes, undefined, { save: true });
  loaded = await session.load();
  await session.apply(loaded, editUi(loaded.sources, { action: 'lifecycle', kind: 'screenClose', owner: 'settings', mode: 'frame', target: 'opening' }).changes, undefined, { save: true });
  loaded = await session.load();
  assert.equal(readUiDesign(loaded.sources).lifecycle!.frameExit.journey.target, 'settings');
  assert.equal(readUiDesign(loaded.sources).lifecycle!.screenClose.settings.target, 'opening');
  assert.equal(await fs.readFile(script.uri.fsPath, 'utf8'), script.getText());
  await vscode.window.showTextDocument(script);
  await vscode.commands.executeCommand('undo'); await vscode.commands.executeCommand('undo'); assert.equal(script.getText(), lifecycleBefore);
  await vscode.commands.executeCommand('redo'); await vscode.commands.executeCommand('redo');
  assert.equal(readUiDesign((await session.load()).sources).lifecycle!.screenClose.settings.mode, 'frame');
  await vscode.commands.executeCommand('undo'); await vscode.commands.executeCommand('undo'); await script.save();
  assert.equal(script.getText(), lifecycleBefore);
  console.log('HOST LIFECYCLE EDITOR PASS: generated frame/page hooks, engine validation, direct save, undo/redo and source preservation.');
  const commands = await vscode.commands.getCommands(true); assert.ok(commands.includes('kakera.ui.open'));
  await vscode.commands.executeCommand('kakera.ui.open');
  const target = path.join(session.root, 'ui.xml').toLowerCase();
  assert.ok(vscode.window.tabGroups.all.flatMap(g => g.tabs).some(t => t.input instanceof vscode.TabInputCustom && t.input.uri.fsPath.toLowerCase() === target), 'UI 入口应在 Custom Editor 中打开（Windows 路径忽略盘符大小写）');
  const hudUi = path.join(session.root, 'ui/pages/hud.xml');
  await vscode.commands.executeCommand('kakera.ui.open', 'ui/pages/hud.xml');
  assert.ok(vscode.window.tabGroups.all.flatMap(g => g.tabs).some(t => t.input instanceof vscode.TabInputCustom && t.input.uri.fsPath.toLowerCase() === hudUi.toLowerCase()), '侧栏 UI 文件应以 Custom Editor 打开对应 XML');
  await vscode.commands.executeCommand('kakera.ui.source', 'ui/pages/hud.xml');
  assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath.toLowerCase(), hudUi.toLowerCase(), 'UI 源码命令应打开对应 XML 文本编辑器');
  console.log('HOST UI EDITOR PASS: nested buffered documents, private frozen child XML, direct save, stale rejection, title in included state file, two-file reparent undo/redo, invalid binding rollback and UI custom editor command.');
}
