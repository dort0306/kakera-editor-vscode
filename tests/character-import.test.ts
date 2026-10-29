import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { CharacterImport, modelDependencies } from '../packages/extension/src/character-import';
test('Live2D 收集模型、贴图、动作/声音、表情/物理依赖；拒绝越界', () => {
  const refs = { Moc: 'model.moc3', Textures: ['textures/a.png'], Motions: { Idle: [{ File: 'motions/idle.json', Sound: 'sounds/idle.wav' }] }, Expressions: [{ Name: 'happy', File: 'expressions/happy.json' }], Physics: 'physics.json' };
  assert.deepEqual(modelDependencies({ Version: 3, FileReferences: refs }), ['model.moc3', 'textures/a.png', 'physics.json', 'expressions/happy.json', 'motions/idle.json', 'sounds/idle.wav']);
  for (const file of ['../secret', 'C:/secret', '/secret', 'textures\\evil.png']) assert.throws(() => modelDependencies({ Version: 3, FileReferences: { ...refs, Moc: file } }));
});
test('批量导入保留源文件，取消只清理本次新文件与授权记录', async () => {
  await fs.mkdir('.test-work', { recursive: true }); const root = await fs.mkdtemp(path.resolve('.test-work/character-import-'));
  const source = path.join(root, 'source'), content = path.join(root, 'content'); await fs.mkdir(source); await fs.mkdir(content); await fs.writeFile(path.join(source, 'a.png'), 'image bytes'); await fs.writeFile(path.join(source, 'b.png'), 'other image');
  const stage = new CharacterImport(content);
  try {
    const a = await stage.image(path.join(source, 'a.png')), b = await stage.image(path.join(source, 'b.png')); assert.notEqual(a, b); assert.equal(stage.assets.length, 2); await stage.license('作者授权');
    assert.equal(await fs.readFile(path.join(content, stage.assets[0].src), 'utf8'), 'image bytes'); await stage.dispose();
    assert.equal(await fs.readFile(path.join(source, 'a.png'), 'utf8'), 'image bytes'); assert.equal((await fs.readdir(path.join(content, 'assets/licenses'))).length, 0);
    await assert.rejects(fs.access(path.join(content, stage.relative)));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
