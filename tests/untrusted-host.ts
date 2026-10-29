import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { Session } from '../packages/extension/src/session';
import { saveGraphExport } from '../packages/extension/src/graph-export';
export async function run(): Promise<void> {
  assert.equal(vscode.workspace.isTrusted, false, '测试工作区应处于受限模式');
  const extension = vscode.extensions.getExtension('dort0306.kakera-editor-vscode'); assert.ok(extension); await extension.activate();
  const root = path.join(process.env.KAKERA_TEST_ROOT!, 'content');
  let called = false;
  const session = new Session(root, path.join(process.env.KAKERA_TEST_ROOT!, 'untrusted-private'), vscode.window.createOutputChannel('Kakera Restricted Test'), async () => { called = true; throw new Error('不得调用工具'); });
  const loaded = await session.load(); assert.equal(loaded.story.frames.length, 3);
  await assert.rejects(session.apply(loaded, new Map([['story.xml', loaded.sources.get('story.xml')!]])), /信任/); assert.equal(called, false);
  await assert.rejects(saveGraphExport(session, loaded, path.join(process.env.KAKERA_TEST_ROOT!, 'untrusted.svg')), /信任/);
  await assert.rejects(fs.access(path.join(process.env.KAKERA_TEST_ROOT!, 'untrusted.svg')));
  await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(path.join(root, 'story.xml')), 'kakera.storyboard');
  await assert.rejects(fs.access(path.join(process.env.KAKERA_TEST_ROOT!, 'untrusted-private')));
  console.log('RESTRICTED HOST PASS: read-only activation, no tool execution or metadata write, mutation rejected.');
}
