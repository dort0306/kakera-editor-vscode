import { readFile, access } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
const root = 'resources/tools/win32-x64';
const manifest = JSON.parse(await readFile(`${root}/tools.json`, 'utf8').catch(() => { throw new Error('先执行 node scripts/prepare-tools.mjs <v0.11.1 工具目录>，再打包离线 VSIX'); }));
if (manifest.engineVersion !== '0.11.1') throw new Error('工具版本不匹配');
for (const file of ['kakera-avg.exe', 'kakera-pack.exe']) {
  const hash = createHash('sha256'); for await (const chunk of createReadStream(`${root}/${file}`)) hash.update(chunk);
  if (hash.digest('hex') !== manifest.files[file]) throw new Error(`工具哈希不匹配：${file}`);
}
for (const file of ['templates/minimal/content/assets/fonts/chinese.otf', 'templates/minimal/content/assets/licenses/OFL.txt', 'THIRD_PARTY_NOTICES.txt']) await access(file);
console.log('离线工具、哈希、模板字体与许可检查通过。');
await access('dist/texture-worker.cjs');
