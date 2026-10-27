import { build } from 'esbuild';
import { spawn } from 'node:child_process';
await build({ entryPoints: ['tests/native.ts'], outfile: '.test-work/native.cjs', bundle: true, platform: 'node', format: 'cjs' });
const p = spawn(process.execPath, ['.test-work/native.cjs', ...process.argv.slice(2)], { stdio: 'inherit', windowsHide: true });
p.on('exit', code => process.exitCode = code ?? 1);
