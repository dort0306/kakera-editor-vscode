import { build } from 'esbuild';
import { mkdir, cp, writeFile, readFile, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { runTests } from '@vscode/test-electron';
import { spawn } from 'node:child_process';
await mkdir('.test-work', { recursive: true });
await build({ entryPoints: ['tests/host.ts'], outfile: '.test-work/host.cjs', bundle: true, platform: 'node', format: 'cjs', external: ['vscode'] });
const root = await mkdtemp(path.resolve('.test-work/host-workspace-'));
await mkdir(root, { recursive: true });
await cp('templates/minimal/content', path.join(root, 'content'), { recursive: true });
// The multi-entry player intentionally waits on the initial UI. Give the host
// integration test a deterministic full-screen start control.
const uiPath = path.join(root, 'content', 'ui.xml'), ui = await readFile(uiPath, 'utf8');
if (!ui.includes('kakera.test.start')) await writeFile(uiPath, ui.replace('</screen>', '<button id="kakera.test.start" x="0" y="0" width="1280" height="720" text="开始" event="kakera.test.start" /></screen>'));
const hostUiScript = path.join(root, 'content', 'scripts', 'ui.js');
await writeFile(hostUiScript, (await readFile(hostUiScript, 'utf8')) + '\non.ui("kakera.test.start", ctx => { ctx.open("hud"); ctx.restart("opening"); });\n');
const storyPath = path.join(root, 'content', 'story.xml');
await writeFile(storyPath, '\uFEFF' + (await readFile(storyPath, 'utf8')).replace(/^\uFEFF/, ''));
await writeFile(path.join(root, 'project.kakera-editor.json'), JSON.stringify({ editorSchema: 1, engineContract: '0.10.0', contentRoot: 'content' }));
const executable = process.env.VSCODE_EXECUTABLE || path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe');
await runTests({
  vscodeExecutablePath: executable, extensionDevelopmentPath: process.cwd(), extensionTestsPath: path.resolve('.test-work/host.cjs'),
  extensionTestsEnv: { KAKERA_TEST_ROOT: root, KAKERA_TEST_TOOLS: path.resolve('resources/tools/win32-x64') },
  launchArgs: [root, '--disable-extensions', '--disable-workspace-trust', '--disable-gpu', '--skip-welcome', '--skip-release-notes', '--disable-telemetry', '--user-data-dir', path.resolve('.test-work/vscode-user'), '--extensions-dir', path.resolve('.test-work/vscode-extensions')]
});
await build({ entryPoints: ['tests/untrusted-host.ts'], outfile: '.test-work/untrusted-host.cjs', bundle: true, platform: 'node', format: 'cjs', external: ['vscode'] });
const restrictedData = path.resolve('.test-work/vscode-restricted-user');
await mkdir(path.join(restrictedData, 'User'), { recursive: true });
await writeFile(path.join(restrictedData, 'User', 'settings.json'), JSON.stringify({ 'security.workspace.trust.enabled': true, 'security.workspace.trust.startupPrompt': 'never', 'workbench.startupEditor': 'none' }));
// test-electron unconditionally disables Workspace Trust; use a direct, isolated
// launch for this test so the trust gate is exercised rather than bypassed.
await new Promise((resolve, reject) => {
  const p = spawn(executable, [root, `--extensionDevelopmentPath=${process.cwd()}`, `--extensionTestsPath=${path.resolve('.test-work/untrusted-host.cjs')}`, '--no-sandbox', '--disable-updates', '--disable-extensions', '--disable-gpu', '--skip-welcome', '--skip-release-notes', '--disable-telemetry', '--user-data-dir', restrictedData, '--extensions-dir', path.resolve('.test-work/vscode-restricted-extensions')], { shell: false, windowsHide: true, stdio: 'inherit', env: { ...process.env, KAKERA_TEST_ROOT: root } });
  p.on('error', reject); p.on('exit', code => code === 0 ? resolve() : reject(new Error(`Restricted host failed: ${code}`)));
});
