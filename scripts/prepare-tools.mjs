import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { spawn } from 'node:child_process';
const source = process.argv[2];
if (!source) throw new Error('用法：node scripts/prepare-tools.mjs <v0.8.3 target/release 目录>');
const target = 'resources/tools/win32-x64';
await mkdir(target, { recursive: true });
const info = await new Promise((resolve, reject) => {
  const p = spawn(path.join(source, 'kakera-avg.exe'), ['--help'], { windowsHide: true });
  let text = ''; p.stdout.on('data', b => text += b); p.stderr.on('data', b => text += b); p.on('error', reject); p.on('exit', code => code === 0 && text.includes('v0.8.3') ? resolve(text) : reject(new Error('播放器必须报告 v0.8.3')));
});
const files = {};
for (const name of ['kakera-avg.exe', 'kakera-pack.exe']) {
  await copyFile(path.join(source, name), path.join(target, name));
  const hash = createHash('sha256');
  for await (const data of createReadStream(path.join(target, name))) hash.update(data);
  files[name] = hash.digest('hex');
}
await writeFile(path.join(target, 'tools.json'), JSON.stringify({ engineVersion: '0.8.3', files }, null, 2) + '\n');
await copyFile('LICENSE', path.join(target, 'LICENSE'));
console.log('已准备 v0.8.3 播放器、打包器和 SHA-256 清单。未包含 Live2D Core。');
