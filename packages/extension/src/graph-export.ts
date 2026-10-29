import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import type { Loaded, Session } from './session';
import { renderGraphExport } from '../../source/src/graph-export';
import { readWorkbench, frameLayout, WORKBENCH_FILE } from '../../source/src/workbench';
import { readGameTitle } from '../../source/src/index';
import { contentPath, hashFile } from './files';
export async function saveGraphExport(session: Session, loaded: Loaded, destination: string, signal?: AbortSignal): Promise<void> {
  if (!vscode.workspace.isTrusted) throw new Error('需要信任工作区才能导出文件');
  signal?.throwIfAborted();
  const extension = path.extname(destination).toLowerCase();
  if (!['.svg', '.html'].includes(extension)) throw new Error('请选择 .svg 或 .html 文件');
  const parent = await fs.realpath(path.dirname(destination)), output = path.join(parent, path.basename(destination)), root = await fs.realpath(session.root);
  const identity = (file: string) => path.resolve(file).toLowerCase();
  const protectedFiles = [...loaded.sources.keys(), ...loaded.story.assets.map(a => a.src)].flatMap(file => { try { return [identity(path.join(root, contentPath(file)))]; } catch { return []; } });
  if (protectedFiles.includes(identity(output))) throw new Error('请将流程图另存，不能覆盖工程源码或资源');
  const dirty = () => vscode.workspace.textDocuments.some(d => d.uri.scheme === 'file' && identity(d.uri.fsPath) === identity(output) && d.isDirty);
  if (dirty()) throw new Error('目标文件有未保存的编辑，请先保存或选择另一个文件');
  const fingerprint = async () => { try { const stat = await fs.lstat(output); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('导出目标需为普通文件，不能是链接'); return await hashFile(output); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw e; } };
  const before = await fingerprint();
  let title = loaded.story.id; try { title = readGameTitle(loaded.sources).text; } catch { /* Invalid UI should not prevent inspecting the story graph. */ }
  const text = renderGraphExport(loaded.story, loaded.logic.links, { title, layout: frameLayout(readWorkbench(loaded.sources.get(WORKBENCH_FILE)), loaded.story), revision: loaded.revision }, extension === '.svg' ? 'svg' : 'html');
  if (Buffer.byteLength(text) > 32 * 1024 * 1024) throw new Error('导出内容超过 32MiB，请精简工程后重试');
  if ((await session.load()).revision !== loaded.revision) throw new Error('流程图已改变，请重新导出');
  const temporary = path.join(parent, `.kakera-flow-${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, text, { flag: 'wx', encoding: 'utf8' });
    if ((await session.load()).revision !== loaded.revision || await fingerprint() !== before || dirty()) throw new Error('导出期间源内容或目标文件已改变，请重试');
    signal?.throwIfAborted();
    await fs.rename(temporary, output);
  } finally { await fs.rm(temporary, { force: true }); }
}
