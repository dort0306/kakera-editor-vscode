import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { emitRoutes, readStory, analyzeLogic } from '../packages/source/src/index';
import { validateRoutes, type Expr, type Route } from '../packages/domain/src/index';
import { launch, plainDiagnostic } from '../packages/extension/src/tools';
import { DebugClient, type DebugState } from '../packages/debug-adapter/src/client';
import { addStartOverlay, clickStartOverlay, waitForStarted } from './start-player';

/** Exercise generated JS only in the matching real QuickJS player. */
export async function verifyConditionalRoutes(player: string, root: string): Promise<void> {
  const content = path.join(root, 'conditional-content'); await fs.cp('templates/minimal/content', content, { recursive: true });
  const cases = [
    { value: '-9223372036854775808', flag: false, expected: 'low' },
    { value: '8', flag: false, expected: 'low' },
    { value: '9', flag: false, expected: 'range' },
    { value: '19', flag: false, expected: 'range' },
    { value: '20', flag: false, expected: 'high' },
    { value: '9007199254740992', flag: false, expected: 'exact' },
    { value: '9223372036854775806', flag: false, expected: 'high' },
    { value: '14', flag: true, expected: 'yes' }
  ];
  const frames = `<frame id="opening" visual="empty"><text>选择测试数据</text><options>${cases.map((_, i) => `<option id="case${i}">测试 ${i}</option>`).join('')}</options></frame>` + ['gate', 'yes', 'low', 'range', 'exact', 'high'].map(id => `<frame id="${id}" visual="empty"><text>${id}</text></frame>`).join('');
  const originalXml = await fs.readFile(path.join(content, 'story.xml'), 'utf8');
  const xml = originalXml.replace(/<variables>[\s\S]*?<\/variables>/, '<variables><int id="trust" initial="0" min="0" max="100"/><int id="score" initial="0"/><bool id="flag" initial="false"/></variables>').replace(/<frames>[\s\S]*?<\/frames>/, `<frames>${frames}</frames>`);
  const compare = (op: '===' | '<' | '<=' | '>=', value: string): Expr => ({ kind: 'compare', op, left: { kind: 'variable', id: 'score' }, right: { kind: 'constant', type: 'int', value } });
  const routes: Route[] = [
    ...cases.map((c, i): Route => ({ frame: 'opening', kind: 'choice', option: `case${i}`, target: 'gate', updates: [{ op: 'set', variable: 'flag', value: { kind: 'constant', type: 'bool', value: String(c.flag) } }, { op: 'set', variable: 'score', value: { kind: 'constant', type: 'int', value: c.value } }] })),
    { frame: 'gate', kind: 'advance', target: 'high', updates: [{ op: 'add', variable: 'score', value: { kind: 'constant', type: 'int', value: '1' } }], branches: [{ when: { kind: 'variable', id: 'flag' }, target: 'yes' }, { when: compare('<', '10'), target: 'low' }, { when: { kind: 'and', left: compare('>=', '10'), right: compare('<=', '20') }, target: 'range' }, { when: compare('===', '9007199254740993'), target: 'exact' }] },
    ...['yes', 'low', 'range', 'exact', 'high'].map((frame): Route => ({ frame, kind: 'advance', target: 'opening', updates: [] }))
  ];
  const js = emitRoutes(routes);
  let sources = new Map([['story.xml', xml], ['scripts/routes.js', js], ['scripts/ui.js', await fs.readFile(path.join(content, 'scripts/ui.js'), 'utf8')], ['ui.xml', await fs.readFile(path.join(content, 'ui.xml'), 'utf8')]]);
  sources = addStartOverlay(sources);
  const story = readStory(sources); validateRoutes(story, routes); assert.equal(analyzeLogic(sources, story).complete, true);
  await fs.writeFile(path.join(content, 'story.xml'), xml); await fs.writeFile(path.join(content, 'scripts/routes.js'), js); await fs.writeFile(path.join(content, 'scripts/ui.js'), sources.get('scripts/ui.js')!); await fs.writeFile(path.join(content, 'ui.xml'), sources.get('ui.xml')!);
  await launch(player, ['--project', content, '--check', '--no-audio', '--no-live2d'], () => {}).done;
  const token = randomBytes(32).toString('hex'), tokenFile = path.join(root, 'conditional.token'); await fs.writeFile(tokenFile, token);
  let log = '', resolvePort: (port: number) => void = () => {}, rejectPort: (e: Error) => void = () => {};
  const port = new Promise<number>((resolve, reject) => { resolvePort = resolve; rejectPort = reject; });
  const process = launch(player, ['--project', content, '--save-dir', path.join(root, 'conditional-saves'), '--debug-listen', '127.0.0.1:0', '--debug-token-file', tokenFile, '--no-audio', '--no-live2d'], text => { log = (log + text).slice(-16384); const match = /调试 API：127\.0\.0\.1:(\d+)/.exec(plainDiagnostic(log)); if (match) resolvePort(Number(match[1])); });
  const timer = setTimeout(() => rejectPort(new Error('条件分流测试未取得调试端口')), 15000);
  process.done.then(() => rejectPort(new Error('测试播放器提前退出')), rejectPort);
  let client: DebugClient | undefined;
  try {
    client = new DebugClient(await port, token); clearTimeout(timer);
    const waiting = await client.request({ type: 'status' }); assert.equal(waiting.game_started, false); assert.equal(waiting.frame_id, null);
    await client.request({ type: 'resume' }); clickStartOverlay(process.child.pid);
    assert.equal((await waitForStarted(client)).frame_id, 'opening');
    await client.request({ type: 'pause' });
    for (let i = 0; i < cases.length; i++) {
      await client.request({ type: 'reveal' });
      let state: DebugState = await client.request({ type: 'choose', option: `case${i}` }); assert.equal(state.frame_id, 'gate');
      await client.request({ type: 'reveal' }); state = await client.request({ type: 'advance' });
      assert.equal(state.frame_id, cases[i].expected, `case ${i}: ${cases[i].value} / ${cases[i].flag}`);
      assert.equal(state.variables.score.value, String(BigInt(cases[i].value) + 1n));
      await client.request({ type: 'reveal' }); state = await client.request({ type: 'advance' }); assert.equal(state.frame_id, 'opening');
    }
  } finally {
    clearTimeout(timer); client?.dispose();
    if (process.child.exitCode === null) process.child.kill(); await process.done.catch(() => {}); await fs.rm(tokenFile, { force: true });
  }
  console.log('CONDITIONAL NATIVE PASS: bool true/false, first-match priority, inclusive range endpoints, fallback, updated variable reads, exact >2^53 and i64 boundaries in real matching QuickJS.');
}
