import * as fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { contentPath } from './files';
export interface ArchiveEntry { path: string; bytes: string }
/** Read the bounded, uncompressed KPAK 2 index after the engine's full archive check.
 * Does not decode resources or replace engine validation. */
export async function archiveEntries(file: string): Promise<ArchiveEntry[]> {
  const handle = await fs.open(file, 'r');
  try {
    const header = Buffer.alloc(80); if ((await handle.read(header, 0, 80, 0)).bytesRead !== 80 || !header.subarray(0, 8).equals(Buffer.from('KPAK\r\n\x1a\0')) || header.readUInt32LE(8) !== 2 || header.readUInt32LE(12) !== 0) throw new Error('无法读取 KPAK 2 发布索引');
    const offset = header.readBigUInt64LE(16), length = header.readBigUInt64LE(24), total = BigInt((await handle.stat()).size);
    if (offset < 80n || length > 128n * 1024n * 1024n || offset + length !== total || header.readBigUInt64LE(32) !== total) throw new Error('发布索引长度无效');
    const index = Buffer.alloc(Number(length)); if ((await handle.read(index, 0, index.length, Number(offset))).bytesRead !== index.length) throw new Error('发布索引截断');
    if (!createHash('sha256').update(index).digest().equals(header.subarray(48, 80))) throw new Error('发布索引摘要不匹配');
    let at = 4; const count = index.readUInt32LE(0), entries: ArchiveEntry[] = [];
    if (count > 100000) throw new Error('发布文件数量超限');
    for (let i = 0; i < count; i++) {
      const size = index.readUInt16LE(at); at += 2; if (size > 1024 || size < 1 || at + size + 12 > index.length) throw new Error('发布路径长度无效');
      const name = contentPath(new TextDecoder('utf-8', { fatal: true }).decode(index.subarray(at, at + size))); at += size;
      const bytes = index.readBigUInt64LE(at).toString(); at += 8;
      const refs = index.readUInt32LE(at); at += 4 + refs * 4; if (at > index.length) throw new Error('发布索引引用越界');
      entries.push({ path: name, bytes });
    }
    return entries;
  } finally { await handle.close(); }
}
