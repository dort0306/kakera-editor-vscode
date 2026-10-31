import * as fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
export function contentPath(value: string): string {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes(':') || value.startsWith('/') || /[\x00-\x1f]/.test(value)) throw new Error('需要游戏内相对路径');
  const parts = value.split('/');
  if (parts.some(p => !p || p === '.' || p === '..' || /[. ]$/.test(p) || /[<>"|?*]/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(p))) throw new Error('内容路径无效或越界');
  return parts.join('/');
}
export async function safePath(root: string, relative: string): Promise<string> {
  const parts = contentPath(relative).split('/');
  const rootStat = await fs.lstat(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error('内容根不能是链接');
  let current = root;
  for (const part of parts) {
    const names = await fs.readdir(current);
    const matches = names.filter(n => n.toLowerCase() === part.toLowerCase());
    if (matches.length > 1 || (matches.length && matches[0] !== part)) throw new Error('路径大小写冲突');
    current = path.join(current, part);
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink()) throw new Error('内容不允许符号链接或目录联接');
  }
  return current;
}
export async function hashFile(file: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(file, { signal })) hash.update(bytes);
  return hash.digest('hex');
}
export const hashText = (value: string) => createHash('sha256').update(value).digest('hex');
export async function ensureDirectory(root: string, relative: string): Promise<string> {
  if ((await fs.lstat(root)).isSymbolicLink()) throw new Error('目录根不允许链接');
  let logical = '';
  for (const part of contentPath(relative).split('/')) {
    logical = logical ? `${logical}/${part}` : part;
    try { await safePath(root, logical); }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      await fs.mkdir(path.join(root, ...logical.split('/')));
      await safePath(root, logical);
    }
  }
  return safePath(root, logical);
}
const excluded = /^(\.git|\.editor|\.cache|\.work|target|node_modules|builds|saves|settings\.json|read\.json|profile\.json|ui-audio\.json|flow-checkpoint\.json|keybindings\.json|ui-colors\.json|language\.json|(?:slot-|auto-).*\.json)$|\.tmp$/i;
export interface Frozen { directory: string; hashes: Record<string, string>; fingerprint: string; assertCurrent: () => Promise<void>; dispose: () => Promise<void> }
export async function freezeContent(root: string, work: string, buffers: Map<string, string>, signal?: AbortSignal): Promise<Frozen> {
  await fs.mkdir(work, { recursive: true });
  const directory = path.join(work, randomUUID());
  await fs.mkdir(directory);
  const hashes: Record<string, string> = Object.create(null), sourceHashes = new Map<string, string>(), seen = new Set<string>();
  let count = 0;
  async function scan(relative: string): Promise<void> {
    const folder = relative ? await safePath(root, relative) : root;
    if ((await fs.lstat(folder)).isSymbolicLink()) throw new Error('不允许链接内容根');
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      signal?.throwIfAborted();
      if (excluded.test(entry.name)) continue;
      const logical = contentPath(relative ? `${relative}/${entry.name}` : entry.name);
      if (seen.has(logical.toLowerCase())) throw new Error('内容路径大小写碰撞');
      seen.add(logical.toLowerCase());
      const source = await safePath(root, logical);
      if (entry.isDirectory()) { await scan(logical); continue; }
      if (!entry.isFile() || ++count > 100000) throw new Error('不支持的文件或文件数超过预算');
      const before = await hashFile(source, signal);
      sourceHashes.set(logical, before);
      const output = path.join(directory, ...logical.split('/'));
      await fs.mkdir(path.dirname(output), { recursive: true });
      if (buffers.has(logical)) await fs.writeFile(output, buffers.get(logical)!, 'utf8'); else await fs.copyFile(source, output, fs.constants.COPYFILE_EXCL);
      hashes[logical] = await hashFile(output, signal);
      if (await hashFile(source, signal) !== before) throw new Error('捕获过程中源文件改变');
    }
  }
  async function assertCurrent(): Promise<void> {
    const names: string[] = [];
    async function walk(relative: string): Promise<void> {
      const folder = relative ? await safePath(root, relative) : root;
      for (const e of await fs.readdir(folder, { withFileTypes: true })) {
        if (excluded.test(e.name)) continue;
        const logical = relative ? `${relative}/${e.name}` : e.name;
        const file = await safePath(root, logical);
        if (e.isDirectory()) await walk(logical);
        else { names.push(logical); if (!sourceHashes.has(logical) || await hashFile(file, signal) !== sourceHashes.get(logical)) throw new Error('源文件已改变，请重试'); }
      }
    }
    await walk('');
    if (names.length !== sourceHashes.size) throw new Error('源文件集合已改变');
  }
  try {
    await scan(''); await assertCurrent();
    const fingerprint = hashText(JSON.stringify(Object.entries(hashes).sort()));
    return { directory, hashes, fingerprint, assertCurrent, dispose: () => fs.rm(directory, { recursive: true, force: true }) };
  } catch (e) { await fs.rm(directory, { recursive: true, force: true }); throw e; }
}
