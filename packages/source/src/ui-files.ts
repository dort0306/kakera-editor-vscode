import { parseXml, child, type XmlNode } from './xml';
import type { Sources } from './index';
export function uiPath(file: string): string {
  if (typeof file !== 'string' || !file || new TextEncoder().encode(file).length > 1024 || !file.endsWith('.xml') || /[\\:\x00-\x1f<>"|?*]/.test(file) || file.split('/').some(p => !p || p === '.' || p === '..' || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(p))) throw new Error('UI 路径必须是游戏根内的 .xml 相对路径');
  return file;
}
export function uiEntry(sources: Sources): string {
  const file = child(parseXml(sources.get('story.xml') ?? ''), 'interface')?.attrs.src;
  if (!file) throw new Error('缺少 UI 入口'); return uiPath(file);
}
function inspect(source: string, file: string, entry: boolean): XmlNode {
  const root = parseXml(source);
  const attrs = entry ? ['schema', 'width', 'height', 'initial', 'title', 'title-bind', 'title-key', 'title-key-bind'] : ['schema'];
  if (root.tag !== 'ui' || root.attrs.schema !== '3' || Object.keys(root.attrs).some(k => !attrs.includes(k)) || root.text.trim()) throw new Error(`${file}：UI 3 根属性不合法；子文件仅允许 schema`);
  const groups = new Set<string>();
  for (const node of root.children) {
    if (!['include', 'variables', 'gallery', 'palette', 'ui-media', 'screen'].includes(node.tag)) throw new Error(`${file}：未知 UI 根节点 ${node.tag}`);
    if (node.tag === 'include' && (Object.keys(node.attrs).length !== 1 || !node.attrs.src || node.children.length || node.text.trim())) throw new Error(`${file}：include 仅允许 src`);
    if (['variables', 'gallery', 'palette', 'ui-media'].includes(node.tag)) { if (groups.has(node.tag)) throw new Error(`${file}：重复 UI 分组 ${node.tag}`); groups.add(node.tag); }
  }
  return root;
}
/** A single bounded DFS, shared by buffered host reads and synchronous source maps. */
export async function loadUiFiles(entry: string, read: (file: string) => Promise<string>): Promise<string[]> {
  const seen = new Set<string>(), files: string[] = []; let bytes = 0;
  async function visit(file: string, depth: number): Promise<void> {
    uiPath(file);
    if (depth > 16 || files.length >= 128 || seen.has(file.toLowerCase())) throw new Error(`${file}：UI include 循环、重复/大小写重复或文件/深度超限`);
    seen.add(file.toLowerCase()); files.push(file);
    const source = await read(file); bytes += new TextEncoder().encode(source).length;
    if (bytes > 1024 * 1024) throw new Error(`${file}：UI 源累计超过 1MiB`);
    const root = inspect(source, file, depth === 1);
    for (const node of root.children) if (node.tag === 'include') await visit(node.attrs.src, depth + 1);
  }
  await visit(entry, 1); return files;
}
export interface UiFragment { file: string; source: string; root: XmlNode }
export function uiFragments(sources: Sources): UiFragment[] {
  const seen = new Set<string>(), fragments: UiFragment[] = []; let bytes = 0, merged = 0;
  function visit(file: string, depth: number): void {
    uiPath(file);
    if (depth > 16 || fragments.length >= 128 || seen.has(file.toLowerCase())) throw new Error(`${file}：UI include 循环、重复/大小写重复或文件/深度超限`);
    seen.add(file.toLowerCase());
    const source = sources.get(file); if (source === undefined) throw new Error(`缺少 UI 文件：${file}`);
    bytes += new TextEncoder().encode(source).length; if (bytes > 1024 * 1024) throw new Error('UI 源累计超过 1MiB');
    const root = inspect(source, file, depth === 1); fragments.push({ file, source, root });
    for (const n of root.children) {
      if (n.tag === 'include') visit(n.attrs.src, depth + 1);
      else merged += new TextEncoder().encode(source.slice(n.start, n.end)).length;
    }
  }
  visit(uiEntry(sources), 1);
  const first = fragments[0]; merged += new TextEncoder().encode(first.source.slice(first.root.start, first.root.openEnd)).length + 6;
  if (merged > 1024 * 1024) throw new Error('合并 UI XML 超过 1MiB');
  return fragments;
}
/** UI file list for navigation. Structural include errors fall back to the declared entry. */
export function uiFileList(sources: Sources): string[] {
  try { return uiFragments(sources).map(fragment => fragment.file); }
  catch { try { return [uiEntry(sources)]; } catch { return []; } }
}
