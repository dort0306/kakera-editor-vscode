import { build } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
await mkdir('dist', { recursive: true });
await mkdir('artifacts', { recursive: true });
await build({ entryPoints: ['packages/extension/src/extension.ts'], outfile: 'dist/extension.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['vscode'], sourcemap: true });
await build({ entryPoints: ['packages/extension/src/texture-worker.ts'], outfile: 'dist/texture-worker.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node22' });
await build({ entryPoints: ['packages/webview/src/main.tsx'], outfile: 'dist/webview.js', bundle: true, platform: 'browser', target: 'es2022', minify: true, define: { 'process.env.NODE_ENV': '"production"' } });
await copyFile('packages/webview/src/style.css', 'dist/webview.css');
const notices = [];
for (const name of ['react', 'react-dom', 'scheduler', 'acorn', 'saxes', 'xmlchars', 'pngjs', 'jpeg-js']) {
  const info = JSON.parse(await readFile(`node_modules/${name}/package.json`, 'utf8'));
  let license;
  for (const file of ['LICENSE', 'LICENSE.md', 'LICENSE.txt']) { try { license = await readFile(`node_modules/${name}/${file}`, 'utf8'); break; } catch {} }
  if (!license && name === 'saxes') license = await readFile('resources/licenses/saxes-LICENSE.txt', 'utf8');
  if (!license) throw new Error(`缺少第三方许可：${name}`);
  notices.push(`${name} ${info.version}\n${license.split('\n').map(line => line.trimEnd()).join('\n')}`);
}
// The bundled v0.11.1 player embeds fluent/unic-langid. Their licenses and the
// engine's own selection notice travel with the offline VSIX.
const engineLicenseDirectory = 'resources/licenses/engine-i18n';
let engineLicenseFiles = [];
try { engineLicenseFiles = (await readdir(engineLicenseDirectory)).filter(file => file.endsWith('.txt')).sort(); } catch { throw new Error('缺少 Kakera v0.11.1 国际化依赖许可目录'); }
for (const file of engineLicenseFiles) notices.push(`Kakera AVG v0.11.1 i18n dependency license: ${file}\n${(await readFile(path.join(engineLicenseDirectory, file), 'utf8')).split('\n').map(line => line.trimEnd()).join('\n')}`);
notices.push(`Kakera AVG v0.11.1 i18n notices\n${(await readFile(path.join(engineLicenseDirectory, 'NOTICE.md'), 'utf8')).split('\n').map(line => line.trimEnd()).join('\n')}`);
await writeFile('THIRD_PARTY_NOTICES.txt', notices.join('\n\n----------------------------------------\n\n'));
