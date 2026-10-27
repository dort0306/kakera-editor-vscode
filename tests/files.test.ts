import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { contentPath, freezeContent, safePath } from '../packages/extension/src/files';
test('内容路径拒绝 Windows/相对越界、ADS、保留设备名和通配', () => {
  for (const value of ['../secret', 'C:/secret', '/secret', 'foo\\bar', 'a//b', 'con.txt', 'a:NUL', 'a/../b', 'a./x', 'a/*.png']) assert.throws(() => contentPath(value), value);
  assert.equal(contentPath('assets/人物.png'), 'assets/人物.png');
});
test('冻结未保存缓冲，源替换不改变代次并使 assertCurrent 失败', async () => {
  await fs.mkdir('.test-work', { recursive: true });
  const root = await fs.mkdtemp(path.resolve('.test-work/files-')); const source = path.join(root, 'content'), work = path.join(root, 'work');
  await fs.mkdir(source); await fs.writeFile(path.join(source, 'story.xml'), '磁盘旧内容'); await fs.writeFile(path.join(source, 'unused.bin'), '资源');
  await fs.mkdir(path.join(source, '.git')); await fs.writeFile(path.join(source, '.git/config'), '秘密');
  const frozen = await freezeContent(source, work, new Map([['story.xml', '未保存内容']]));
  try {
    assert.equal(await fs.readFile(path.join(frozen.directory, 'story.xml'), 'utf8'), '未保存内容'); await assert.rejects(fs.access(path.join(frozen.directory, '.git/config')));
    await frozen.assertCurrent(); await fs.writeFile(path.join(source, 'unused.bin'), '同名新资源');
    assert.equal(await fs.readFile(path.join(frozen.directory, 'unused.bin'), 'utf8'), '资源'); await assert.rejects(frozen.assertCurrent());
  } finally { await frozen.dispose(); await fs.rm(root, { recursive: true, force: true }); }
});
test('快照取消、路径大小写冲突和目录联接拒绝', async () => {
  await fs.mkdir('.test-work', { recursive: true });
  const root = await fs.mkdtemp(path.resolve('.test-work/paths-'));
  try {
    await fs.mkdir(path.join(root, 'Assets')); await assert.rejects(safePath(root, 'assets'));
    const controller = new AbortController(); controller.abort(); await assert.rejects(freezeContent(root, path.resolve('.test-work/abort'), new Map(), controller.signal));
    await fs.symlink(path.resolve(root), path.join(root, 'link'), 'junction'); await assert.rejects(safePath(root, 'link'));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
