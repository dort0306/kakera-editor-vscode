import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { hashFile } from './files';
export interface ToolManifest { engineVersion: '0.8.3' | '0.8.4' | '0.9.0' | '0.9.1' | '0.10.0'; files: Record<string, string> }
export async function toolchain(directory: string): Promise<{ player: string; packer: string; engineVersion: '0.8.3' | '0.8.4' | '0.9.0' | '0.9.1' | '0.10.0'; hashes: Record<string, string> }> {
  const manifest = JSON.parse(await fs.readFile(path.join(directory, 'tools.json'), 'utf8')) as ToolManifest;
  if (!['0.8.3', '0.8.4', '0.9.0', '0.9.1', '0.10.0'].includes(manifest.engineVersion) || !manifest.files) throw new Error('工具目录需要 v0.8.3/v0.8.4/v0.9.0/v0.9.1/v0.10.0 tools.json 哈希清单；运行 prepare-tools 脚本生成');
  for (const name of ['kakera-avg.exe', 'kakera-pack.exe']) {
    if ((await fs.lstat(path.join(directory, name))).isSymbolicLink() || await hashFile(path.join(directory, name)) !== manifest.files[name]) throw new Error('工具哈希不匹配，请重新准备工具');
  }
  return { player: path.join(directory, 'kakera-avg.exe'), packer: path.join(directory, 'kakera-pack.exe'), engineVersion: manifest.engineVersion, hashes: manifest.files };
}
export function launch(exe: string, args: string[], output: (chunk: string) => void, signal?: AbortSignal): { child: ChildProcess; done: Promise<void> } {
  signal?.throwIfAborted();
  const child = spawn(exe, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let total = 0;
  const write = (data: Buffer) => { total += data.length; if (total < 2 * 1024 * 1024) output(data.toString('utf8')); };
  child.stdout?.on('data', write); child.stderr?.on('data', write);
  const abort = () => { child.kill(); };
  signal?.addEventListener('abort', abort, { once: true });
  const done = new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, reason) => {
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) reject(new Error('任务已取消'));
      else if (code === 0) resolve(); else reject(new Error(`工具退出失败（${code ?? reason}），请查看 Kakera 日志`));
    });
  });
  return { child, done };
}
