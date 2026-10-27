import { SaxesParser } from 'saxes';
export interface XmlNode { tag: string; attrs: Record<string, string>; children: XmlNode[]; start: number; openEnd: number; closeStart: number; end: number; text: string }
export function parseXml(source: string): XmlNode {
  if (source.length > 16 * 1024 * 1024) throw new Error('XML 超过 16MiB');
  const parser = new SaxesParser({ xmlns: false });
  const stack: XmlNode[] = [];
  let root: XmlNode | undefined;
  parser.on('doctype', () => { throw new Error('不支持 DTD 或外部实体'); });
  parser.on('error', e => { throw e; });
  parser.on('opentag', tag => {
    const end = parser.position;
    const node: XmlNode = { tag: tag.name, attrs: { ...tag.attributes } as Record<string, string>, children: [], start: source.lastIndexOf('<', end - 1), openEnd: end, closeStart: end, end, text: '' };
    if (tag.name.includes(':') || Object.keys(node.attrs).some(a => a === 'xmlns' || a.includes(':'))) throw new Error('引擎不支持 XML 命名空间');
    if (stack.length) stack[stack.length - 1].children.push(node); else root = node;
    stack.push(node);
  });
  parser.on('text', value => { if (stack.length) stack[stack.length - 1].text += value; });
  parser.on('cdata', value => { if (stack.length) stack[stack.length - 1].text += value; });
  parser.on('closetag', tag => {
    const node = stack.pop()!;
    node.end = parser.position;
    node.closeStart = tag.isSelfClosing ? node.openEnd : source.lastIndexOf('</', parser.position - 1);
  });
  parser.write(source).close();
  if (!root) throw new Error('XML 为空');
  return root;
}
export function child(node: XmlNode, name: string): XmlNode | undefined { return node.children.find(c => c.tag === name); }
export function group(node: XmlNode, name: string): XmlNode[] { return child(node, name)?.children ?? []; }
export function escapeXml(value: string): string {
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error('文本包含 XML 不允许的控制字符');
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}
export function setAttribute(source: string, node: XmlNode, name: string, value: string): string {
  // Saxes validates the opening tag; tokenize only this bounded tag to preserve other bytes.
  const opening = source.slice(node.start, node.openEnd);
  const pattern = /([^\s=<>/]+)\s*=\s*(["'])([\s\S]*?)\2/g;
  for (const match of opening.matchAll(pattern)) {
    if (match[1] !== name) continue;
    const from = node.start + match.index!, to = from + match[0].length;
    return source.slice(0, from) + (value ? `${name}="${escapeXml(value)}"` : '') + source.slice(to);
  }
  if (!value) return source;
  const insert = node.openEnd - (opening.endsWith('/>') ? 2 : 1);
  return source.slice(0, insert) + ` ${name}="${escapeXml(value)}"` + source.slice(insert);
}
