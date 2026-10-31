import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { emitRoutes } from '../packages/source/src/index';
import { editUi } from '../packages/source/src/ui-source';
import { launch, plainDiagnostic } from '../packages/extension/src/tools';
import { DebugClient } from '../packages/debug-adapter/src/client';
import { addStartOverlay, clickStartOverlay, playerWindowFocus, waitForStarted } from './start-player';

export async function verifyLifecycleEditor(player: string, root: string): Promise<void> {
  for (const mode of ['continue', 'frame', 'page'] as const) {
    const content = path.join(root, `lifecycle-${mode}`); await fs.cp('templates/minimal/content', content, { recursive: true });
    let sources = new Map<string, string>();
    for (const file of ['story.xml', 'ui.xml', 'scripts/ui.js']) sources.set(file, await fs.readFile(path.join(content, file), 'utf8'));
    sources.set('scripts/routes.js', emitRoutes([
      { frame: 'opening', kind: 'choice', option: 'explore', target: 'journey', updates: [{ op: 'add', variable: 'trust', value: { kind: 'constant', type: 'int', value: '1' } }] },
      { frame: 'opening', kind: 'choice', option: 'stay', target: 'ending', updates: [] },
      { frame: 'journey', kind: 'advance', target: 'ending', updates: [] },
      { frame: 'ending', kind: 'end', updates: [] },
    ]));
    sources.set('ui.xml', sources.get('ui.xml')!.replace('</ui>', '<ui-media><sequence id="cut.one" finish="close"><fade target="cut.label" duration="200"/></sequence><sequence id="cut.two" finish="close"><fade target="second.label" duration="200"/></sequence></ui-media><screen id="cut" sequence="cut.one"><label id="cut.label" width="400" height="40" text="交接"/></screen><screen id="second" sequence="cut.two"><label id="second.label" width="400" height="40" text="第二页"/></screen></ui>'));
    const apply = (operation: unknown) => { sources = new Map([...sources, ...editUi(sources, operation).changes]); };
    apply({ action: 'lifecycle', kind: 'frameExit', owner: 'opening', mode: 'page', target: 'cut' });
    apply({ action: 'lifecycle', kind: 'screenClose', owner: 'cut', mode, target: mode === 'page' ? 'second' : 'ending' });
    if (mode === 'page') apply({ action: 'lifecycle', kind: 'screenClose', owner: 'second', mode: 'frame', target: 'ending' });
    sources = addStartOverlay(sources);
    for (const [file, text] of sources) await fs.writeFile(path.join(content, file), text);
    await launch(player, ['--project', content, '--check', '--no-audio', '--no-live2d'], () => {}).done;
    const token = randomBytes(32).toString('hex'), tokenFile = path.join(root, `lifecycle-${mode}.token`), saveDir = path.join(root, `lifecycle-${mode}-saves`);
    await fs.writeFile(tokenFile, token);
    let output = '', resolvePort!: (port: number) => void, rejectPort!: (e: Error) => void;
    const port = new Promise<number>((resolve, reject) => { resolvePort = resolve; rejectPort = reject; });
    const running = launch(player, ['--project', content, '--save-dir', saveDir, '--debug-listen', '127.0.0.1:0', '--debug-token-file', tokenFile, '--no-audio', '--no-live2d'], text => { output = (output + text).slice(-16384); const match = /调试 API：127\.0\.0\.1:(\d+)/.exec(plainDiagnostic(output)); if (match) resolvePort(Number(match[1])); });
    const timer = setTimeout(() => rejectPort(new Error('生命周期测试未取得调试端口')), 15000);
    running.done.then(() => rejectPort(new Error('生命周期测试播放器提前退出')), rejectPort);
    let client: DebugClient | undefined;
    try {
      client = new DebugClient(await port, token); clearTimeout(timer);
      const waiting = await client.request({ type: 'status' }); assert.equal(waiting.game_started, false);
      await client.request({ type: 'resume' }); clickStartOverlay(running.child.pid);
      assert.equal((await waitForStarted(client)).frame_id, 'opening'); await client.request({ type: 'pause' });
      await client.request({ type: 'reveal' });
      const handoff = await client.request({ type: 'choose', option: 'explore' });
      assert.equal(handoff.frame_id, 'opening', `${mode}: 交接期间保留原幕`);
      assert.equal(handoff.variables.trust.value, '0');
      await fs.access(path.join(saveDir, 'flow-checkpoint.json'));
      await client.request({ type: 'resume' });
      console.log(`LIFECYCLE RUN: ${mode}, player PID ${running.child.pid}`);
      const expected = mode === 'continue' ? 'journey' : 'ending', deadline = Date.now() + 10000;
      let state = await client.request({ type: 'status' });
      while (state.frame_id !== expected && Date.now() < deadline) { await new Promise(resolve => setTimeout(resolve, 50)); state = await client.request({ type: 'status' }); }
      if (state.frame_id !== expected) {
        let focus: unknown;
        try { focus = playerWindowFocus(running.child.pid); } catch (error) { focus = { diagnosticError: String(error) }; }
        assert.fail(`${mode}: ${JSON.stringify({ expectedFrame: expected, state, focus })}`);
      }
      assert.equal(state.variables.trust.value, '1', '续接仅提交一次有序更新');
    } finally {
      clearTimeout(timer); client?.dispose(); if (running.child.exitCode === null) running.child.kill(); await running.done.catch(() => {}); await fs.rm(tokenFile, { force: true });
    }
  }
  console.log('LIFECYCLE EDITOR NATIVE PASS: generated frame exit/page close, automatic fade completion, pending continuation, explicit frame, page-to-page handoff, hidden checkpoint and single variable commit.');
}
