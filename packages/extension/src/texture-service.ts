import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import type { Loaded, Session } from './session';
import { safePath, ensureDirectory, hashFile } from './files';
import { textureTask } from './texture-task';
import { textureUi, assignTexture, registerTexture } from '../../source/src/texture-source';
import { newShortId } from '../../source/src/index';
import { WORKBENCH_FILE, readWorkbench } from '../../source/src/workbench';
import { validateRegions, type NinePatchSpec, type AtlasRegion } from '../../domain/src/textures';
export async function textureBytes(session: Session, loaded: Loaded, assetId: string): Promise<{ bytes: Buffer; hash: string; nine: boolean }> {
  const asset = loaded.story.assets.find(a => a.id === assetId && ['image', 'cg', 'nine-patch'].includes(a.kind)); if (!asset) throw new Error('请选择已导入的图片、CG 或点九图片');
  const file = await safePath(session.root, asset.src), stat = await fs.stat(file); if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw new Error('图片超过 8MiB 编辑预算');
  const handle = await fs.open(file, 'r'); let bytes: Buffer;
  try { const bounded = Buffer.alloc(stat.size + 1); let count = 0; while (count < bounded.length) { const part = await handle.read(bounded, count, bounded.length - count, count); if (!part.bytesRead) break; count += part.bytesRead; } if (count > stat.size) throw new Error('图片读取期间改变，请重试'); bytes = Buffer.from(bounded.subarray(0, count)); } finally { await handle.close(); }
  return { bytes, hash: createHash('sha256').update(bytes).digest('hex'), nine: asset.kind === 'nine-patch' };
}
export async function inspectTexture(session: Session, loaded: Loaded, assetId: string, worker: string, signal?: AbortSignal) {
  const input = await textureBytes(session, loaded, assetId), result = await textureTask(worker, { mode: 'inspect', ...input }, signal);
  const folder = path.join(session.storage, 'images'); await fs.mkdir(folder, { recursive: true }); const preview = path.join(folder, `texture-v1-${input.nine ? 'nine' : 'image'}-${input.hash}.png`);
  try { await fs.writeFile(preview, result.png, { flag: 'wx' }); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
  const saved = readWorkbench(loaded.sources.get(WORKBENCH_FILE)).atlases[assetId];
  return { assetId, hash: input.hash, width: result.width, height: result.height, spec: result.spec, regions: saved?.hash === input.hash ? saved.regions : [], ui: textureUi(loaded.sources), preview };
}
export async function saveTexture(session: Session, loaded: Loaded, worker: string, request: { assetId: string; hash: string; mode: 'nine' | 'atlas'; spec?: NinePatchSpec; regions?: AtlasRegion[]; region?: number; target?: string; density?: number }, signal?: AbortSignal): Promise<string> {
  const input = await textureBytes(session, loaded, request.assetId); if (input.hash !== request.hash) throw new Error('图片已改变，请重新打开后编辑');
  const result = await textureTask(worker, { mode: request.mode === 'nine' ? 'nine' : 'inspect', ...input, spec: request.spec }, signal);
  if ((await textureBytes(session, loaded, request.assetId)).hash !== input.hash) throw new Error('图片在处理期间改变');
  if (request.mode === 'atlas') {
    if (input.nine) throw new Error('图集需要普通图片'); validateRegions(request.regions!, result.width, result.height);
    const meta = readWorkbench(loaded.sources.get(WORKBENCH_FILE)); meta.atlases = { ...meta.atlases, [request.assetId]: { hash: input.hash, width: result.width, height: result.height, regions: request.regions! } };
    const changes = new Map([[WORKBENCH_FILE, JSON.stringify(meta)]]);
    if (request.target) { const region = request.regions![request.region ?? 0]; if (!region) throw new Error('请选择有效区域'); for (const [f, text] of assignTexture(loaded.sources, request.assetId, 'image', request.target, region)) changes.set(f, text); }
    await session.apply(loaded, changes, signal, { save: true }); return request.assetId;
  }
  if (request.mode !== 'nine') throw new Error('不支持的资源操作');
  const id = input.nine ? request.assetId : newShortId(loaded.story.assets.map(asset => asset.id));
  return commitTexture(session, loaded, id, 'nine-patch', result.png, undefined, request.target, request.density, signal);
}
export async function packTexture(session: Session, loaded: Loaded, worker: string, ids: string[], width: number, padding: number, signal?: AbortSignal): Promise<string> {
  if (!Array.isArray(ids) || !ids.length || ids.length > 64 || new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string')) throw new Error('请选择 1–64 张不同的图片');
  const inputs: { name: string; bytes: Buffer; hash: string }[] = []; let bytes = 0;
  for (const id of ids) { const image = await textureBytes(session, loaded, id); if (image.nine) throw new Error('不能把点九边框当成普通图集合成'); bytes += image.bytes.length; if (bytes > 32 * 1024 * 1024) throw new Error('源文件总计超过 32MiB'); inputs.push({ name: `${inputs.length + 1}-${id.slice(0, 120)}`, ...image }); }
  const result = await textureTask(worker, { mode: 'pack', inputs, width, padding }, signal);
  for (let i = 0; i < ids.length; i++) if ((await textureBytes(session, loaded, ids[i])).hash !== inputs[i].hash) throw new Error('合成源图片已改变');
  validateRegions(result.regions!, result.width, result.height);
  return commitTexture(session, loaded, newShortId(loaded.story.assets.map(asset => asset.id)), 'image', result.png, result.regions, undefined, undefined, signal);
}
async function commitTexture(session: Session, loaded: Loaded, id: string, kind: 'image' | 'nine-patch', png: Uint8Array, regions?: AtlasRegion[], target?: string, density?: number, signal?: AbortSignal): Promise<string> {
  if (png.length > 8 * 1024 * 1024) throw new Error('生成图片超过 8MiB，请减小尺寸');
  const folder = await ensureDirectory(session.root, 'assets/generated'), relative = `assets/generated/${randomUUID()}${kind === 'nine-patch' ? '.9.png' : '.png'}`, output = path.join(folder, path.basename(relative));
  signal?.throwIfAborted(); await fs.writeFile(output, png, { flag: 'wx' });
  try {
    const changes = registerTexture(loaded.sources, id, kind, relative), candidate = new Map([...loaded.sources, ...changes]);
    if (target) for (const [f, text] of assignTexture(candidate, id, kind, target, undefined, density)) changes.set(f, text);
    if (regions) { const meta = readWorkbench(loaded.sources.get(WORKBENCH_FILE)), bytes = Buffer.from(png); meta.atlases = { ...meta.atlases, [id]: { hash: await hashFile(output), width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), regions } }; changes.set(WORKBENCH_FILE, JSON.stringify(meta)); }
    await session.apply(loaded, changes, signal, { save: true }); return id;
  } catch (e) {
    // A save failure can happen after the XML buffer references this file.
    const current = await session.load().catch(() => undefined);
    if (current && ![...current.sources.values()].some(text => text.includes(relative))) { const safe = await safePath(session.root, relative).catch(() => undefined); if (safe) await fs.rm(safe, { force: true }); }
    throw e;
  }
}
