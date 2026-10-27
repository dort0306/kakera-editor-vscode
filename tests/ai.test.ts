import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { endpoint, completion, validateSegments } from '../packages/ai-client/src/index';
test('AI 基址不重复 /v1，拒绝凭据和非 TLS 远端', () => {
  assert.equal(endpoint('http://127.0.0.1:8080/v1/').pathname, '/v1/chat/completions');
  for (const url of ['http://remote.example/v1', 'https://user:secret@example.com/v1', 'https://example.com/v1?key=x']) assert.throws(() => endpoint(url));
});
test('提案必须逐字覆盖原文，只允许 createFrame 白名单', () => {
  const text = '你好🐈\n下一幕'; const proposal = { schema: 1, operations: [{ type: 'createFrame', start: 0, end: text.length, text }] };
  assert.equal(validateSegments(proposal, text)[0].text, text);
  for (const invalid of [{ ...proposal, shell: 'x' }, { schema: 1, operations: [{ ...proposal.operations[0], text: '改写' }] }, { schema: 1, operations: [{ ...proposal.operations[0], path: '../secret' }] }]) assert.throws(() => validateSegments(invalid, text));
});
test('兼容 HTTP 和分片 SSE，拒绝截断流、工具调用、HTTP 错误', async () => {
  let mode = 'json', received: any;
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const b of req) chunks.push(b); received = JSON.parse(Buffer.concat(chunks).toString());
    if (mode === '401') { res.writeHead(401); res.end('secret'); return; }
    if (mode === 'json') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: '你好' }, finish_reason: 'stop' }] })); return; }
    res.setHeader('Content-Type', 'text/event-stream');
    const body = mode === 'tool' ? 'data: {"choices":[{"delta":{"tool_calls":[{}]},"finish_reason":"tool_calls"}]}\n\n' : 'data: {"choices":[{"delta":{"content":"你好🐈"},"finish_reason":null}]}\n\n' + (mode === 'truncated' ? '' : 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
    const bytes = Buffer.from(body); for (let i = 0; i < bytes.length; i += 3) res.write(bytes.subarray(i, i + 3)); res.end();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const port = (server.address() as any).port;
  const profile = { baseUrl: `http://127.0.0.1:${port}/v1`, model: 'mock', stream: false, revision: '1' };
  try {
    assert.equal(await completion(profile, 'secret', [{ role: 'user', content: '原稿' }]), '你好'); assert.equal(received.model, 'mock');
    mode = 'stream'; assert.equal(await completion({ ...profile, stream: true }, undefined, []), '你好🐈');
    for (mode of ['truncated', 'tool', '401']) await assert.rejects(completion({ ...profile, stream: true }, undefined, []));
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
