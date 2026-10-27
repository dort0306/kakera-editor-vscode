import { build } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await mkdir('artifacts', { recursive: true });
await build({ entryPoints: ['packages/extension/src/extension.ts'], outfile: 'dist/extension.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['vscode'], sourcemap: true });
await build({ entryPoints: ['packages/webview/src/main.tsx'], outfile: 'dist/webview.js', bundle: true, platform: 'browser', target: 'es2022', minify: true, define: { 'process.env.NODE_ENV': '"production"' } });
await copyFile('packages/webview/src/style.css', 'dist/webview.css');
const notices = [];
for (const name of ['react', 'react-dom', 'scheduler', 'acorn', 'saxes', 'xmlchars']) {
  const info = JSON.parse(await readFile(`node_modules/${name}/package.json`, 'utf8'));
  let license;
  for (const file of ['LICENSE', 'LICENSE.md', 'LICENSE.txt']) { try { license = await readFile(`node_modules/${name}/${file}`, 'utf8'); break; } catch {} }
  if (!license && name === 'saxes') license = await readFile('resources/licenses/saxes-LICENSE.txt', 'utf8');
  if (!license) throw new Error(`缺少第三方许可：${name}`);
  notices.push(`${name} ${info.version}\n${license}`);
}
await writeFile('THIRD_PARTY_NOTICES.txt', notices.join('\n\n----------------------------------------\n\n'));
