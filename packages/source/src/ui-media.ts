import type { Sources } from './index';
import { uiFragments } from './ui-files';
import { parseXml, child, escapeXmlAttribute as escape, type XmlNode } from './xml';
import type { UiMediaItem } from '../../domain/src/ui';
const fields: Record<string, string[]> = { sound: ['id'], sequence: ['id', 'finish', 'skippable'], clip: ['asset', 'actor', 'weight', 'enabled'], fade: ['target', 'from', 'to', 'duration'], video: ['asset'], cue: ['ref'] };
export function readUiMedia(sources: Sources): UiMediaItem[] {
  const result: UiMediaItem[] = [], ids = new Set<string>();
  for (const f of uiFragments(sources)) for (const n of child(f.root, 'ui-media')?.children ?? []) {
    if (!['sound', 'sequence'].includes(n.tag) || !n.attrs.id || ids.has(`${n.tag}:${n.attrs.id}`)) throw new Error('UI 演出/音效声明无效或重复');
    ids.add(`${n.tag}:${n.attrs.id}`);
    result.push({ id: n.attrs.id, kind: n.tag as 'sound' | 'sequence', file: f.file, attrs: n.attrs, steps: n.children.map(s => ({ kind: s.tag, attrs: s.attrs })) });
  }
  return result;
}
export function editUiMedia(input: Sources, raw: unknown): Sources {
  const item = raw as UiMediaItem, all = readUiMedia(input);
  if (!item || !['sound', 'sequence'].includes(item.kind) || typeof item.id !== 'string' || !item.id.trim() || item.id.length > 128 || !Array.isArray(item.steps) || !item.steps.length || item.steps.length > 64) throw new Error('音效/演出需要标识及 1–64 个步骤');
  const old = all.find(i => i.id === item.id && i.kind === item.kind);
  const file = old?.file ?? item.file;
  if (!uiFragments(input).some(f => f.file === file) || all.filter(i => i.kind === item.kind).length >= 64 && !old) throw new Error('UI 媒体文件无效或数量超过 64');
  const attrs = (value: Record<string, string>, names: string[]) => {
    if (!value || typeof value !== 'object' || Object.keys(value).some(k => !names.includes(k)) || Object.values(value).some(v => typeof v !== 'string' || v.length > 4096)) throw new Error('不支持的演出属性');
    return Object.entries(value).filter(([,v]) => v !== '').map(([k,v]) => `${k}="${escape(v)}"`).join(' ');
  };
  let total = 0;
  const steps = item.steps.map(s => {
    if (!s || !(item.kind === 'sound' ? ['clip'] : ['fade', 'video', 'sound']).includes(s.kind)) throw new Error('不支持的演出步骤');
    if (s.kind === 'fade') { const from = Number(s.attrs.from ?? 0), to = Number(s.attrs.to ?? 1), ms = Number(s.attrs.duration ?? 400); if (![from,to,ms].every(Number.isFinite) || from < 0 || from > 1 || to < 0 || to > 1 || ms < 1 || ms > 10000) throw new Error('透明度须为 0–1，淡入淡出时长须为 1–10000ms'); total += ms; }
    if (s.kind === 'clip' && (!/^\d+$/.test(s.attrs.weight ?? '1') || Number(s.attrs.weight ?? 1) < 1 || Number(s.attrs.weight ?? 1) > 1000)) throw new Error('音效权重需要 1–1000 整数');
    return `<${s.kind} ${attrs(s.attrs, fields[s.kind === 'sound' ? 'cue' : s.kind])}/>`;
  }).join('\n');
  if (total > 600000) throw new Error('演出超过 10 分钟');
  let source = input.get(file)!; const root = parseXml(source), group = child(root, 'ui-media'), node = group?.children.find(n => n.tag === item.kind && n.attrs.id === item.id);
  const comments = node ? source.slice(node.start, node.end).match(/<!--[\s\S]*?-->/g)?.join('\n') ?? '' : '';
  const markup = `<${item.kind} ${attrs({ ...item.attrs, id: item.id }, fields[item.kind])}>\n${comments}\n${steps}\n</${item.kind}>`;
  const insert = (n: XmlNode, text: string) => source.slice(n.start,n.openEnd).endsWith('/>') ? source.slice(0,n.openEnd-2)+`>\n${text}\n</${n.tag}>`+source.slice(n.end) : source.slice(0,n.closeStart)+'\n'+text+'\n'+source.slice(n.closeStart);
  source = node ? source.slice(0,node.start)+markup+source.slice(node.end) : group ? insert(group,markup) : insert(root,`<ui-media>${markup}</ui-media>`);
  return new Map([[file, source]]);
}
