import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { DebugClient } from '../packages/debug-adapter/src/client';
test('调试串行请求共享 ID/修订；失败后先 status，不重复控制', async () => {
  const commands: any[] = []; let revision = 0, fail = true;
  const server = createServer(socket => { let buffer = ''; socket.on('data', bytes => { buffer += bytes; let end; while ((end = buffer.indexOf('\n')) >= 0) { const req = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1); commands.push(req);
    if (req.command.type === 'advance' && fail) { fail = false; revision++; socket.write(JSON.stringify({ version: 1, id: req.id, ok: false, error: 'arbitrary text' }) + '\n'); continue; }
    if (req.command.type !== 'status') { assert.equal(req.expected_revision, revision); revision++; }
    const response = JSON.stringify({ version: 1, id: req.id, ok: true, result: { protocol: 'KakeraEditorDebug', version: 1, engine_version: '0.8.3', process_id: 42, state_revision: revision, frame_id: 'a', paused: true, pending_frame: null, variables: {} } }) + '\n';
    socket.write(response.slice(0, 20)); socket.write(response.slice(20));
  } }); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const client = new DebugClient((server.address() as any).port, 'a'.repeat(32));
  try {
    await client.request({ type: 'status' }); await assert.rejects(client.request({ type: 'advance' })); await client.request({ type: 'pause' });
    assert.deepEqual(commands.map(c => c.command.type), ['status', 'advance', 'status', 'pause']); assert.deepEqual(commands.map(c => c.id), [1, 2, 3, 4]);
    await assert.rejects(client.request({ type: 'eval' }));
  } finally { client.dispose(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
