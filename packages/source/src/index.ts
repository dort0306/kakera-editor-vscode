import { randomUUID } from 'node:crypto';
import type { Asset, Frame, Story } from '../../domain/src/index';
import { child, escapeXml, group, parseXml, setAttribute, type XmlNode } from './xml';
export { emitRoutes, readManagedRoutes } from './routes';
export { analyzeLogic, patchLogicRoutes, protectedLogicTargets, type LogicAnalysis, type LogicSummary } from './logic';
export { parseXml, escapeXml } from './xml';
export type Sources = Map<string, string>;
export function readStory(sources: Sources): Story {
  const files: string[] = [], nodes: { file: string; root: XmlNode; source: string }[] = [];
  let file: string | undefined = 'story.xml';
  for (let n = 0; file; n++) {
    if (n >= 128 || files.includes(file)) throw new Error('章节链超限或循环');
    const source = sources.get(file);
    if (source === undefined) throw new Error(`缺少章节：${file}`);
    const root = parseXml(source);
    if (root.tag !== 'story' || root.attrs.schema !== '8') throw new Error(`${file}：只支持 story schema 8`);
    files.push(file); nodes.push({ file, root, source });
    const next = child(root, 'next');
    file = next?.attrs.src;
  }
  const first = nodes[0].root;
  const story: Story = { id: first.attrs.id ?? '', entry: first.attrs.entry ?? '', entries: [], contentVersion: first.attrs['content-version'] ?? '', frames: [], assets: [], visuals: [], variables: [], characters: [], scripts: [], files };
  for (const { file, root, source } of nodes) {
    for (const n of group(root, 'frames')) {
      if (n.tag !== 'frame') throw new Error('frames 中包含未知元素');
      const text = child(n, 'text');
      if (!text || text.children.length || n.children.filter(x => x.tag === 'text').length !== 1) throw new Error('每幕需要一个纯文本 text');
      const pending = !!n.attrs.id && !!n.attrs.name?.startsWith('kakera.pending.') && n.children.length === 1 && text.text === '后续剧情尚未连接。' && source.slice(n.openEnd, text.start).includes('<!-- Kakera pending route v1 -->');
      const legacyVideo = n.children.some(x => x.tag === 'video');
      story.frames.push({ ref: n.attrs.name || n.attrs.id || '', id: n.attrs.id, name: n.attrs.name, speaker: n.attrs.speaker ?? '', visual: n.attrs.visual ?? '', text: text.text, audio: child(n, 'audio')?.attrs ?? {}, options: group(n, 'options').map(o => ({ id: o.attrs.id, text: o.text })), file, line: source.slice(0, n.start).split('\n').length, ...(pending ? { pending: true } : {}), ...(legacyVideo ? { legacyVideo: true } : {}) });
    }
    story.assets.push(...group(root, 'assets').map(n => ({ id: n.attrs.id, kind: n.tag, src: n.attrs.src, file })));
    story.characters.push(...group(root, 'characters').map(n => ({ id: n.attrs.id, name: n.attrs.name })));
    story.visuals.push(...group(root, 'visuals').map(n => ({ id: n.attrs.id, background: n.attrs.background ?? '', portraits: n.children.filter(p => p.tag === 'portrait').map(p => ({ image: p.attrs.image, character: p.attrs.character, slot: p.attrs.slot, ...(child(p, 'live2d') ? { live2d: child(p, 'live2d')!.attrs.asset } : {}) })), ...(n.attrs.cg ? { cg: n.attrs.cg } : {}) })));
    story.variables.push(...group(root, 'variables').map(n => { if (!['int', 'bool', 'string'].includes(n.tag)) throw new Error('未知变量类型'); return { id: n.attrs.id, type: n.tag as 'int' | 'bool' | 'string', initial: n.attrs.initial, min: n.attrs.min, max: n.attrs.max }; }));
    story.scripts.push(...group(root, 'scripts').map(n => n.attrs.src));
  }
  if (story.frames.some(f => !f.ref)) throw new Error('幕必须有 id 或 name');
  const rawEntries = (first.attrs.entry ?? '').trim().split(/\s+/).filter(Boolean);
  if (!rawEntries.length) throw new Error('story.entry 必须声明至少一个起始幕');
  const aliases = new Map(story.frames.flatMap(f => [f.ref, f.id, f.name].filter((v): v is string => !!v).map(alias => [alias, f.ref])));
  const entries = rawEntries.map(raw => { const ref = aliases.get(raw); if (!ref) throw new Error(`story.entry 起始幕不存在：${raw}`); return ref; });
  if (new Set(entries).size !== entries.length) throw new Error('story.entry 起始幕重复或别名指向同一幕');
  story.entries = entries; story.entry = entries[0];
  return story;
}
export { readGameTitle, patchGameTitle, editCharacter, addCharacterLooks, characterLooks, assignCharacterLook, setFrameVisual } from './project';
export { reconcilePendingRoutes, insertConnectedFrame, deleteConnectedFrame, setStoryEntry, setStoryEntries, addStoryVariable, editStoryVariable, deleteStoryVariable, deleteCharacter, renameFrame } from './editing';
function frameNode(source: string, ref: string): XmlNode {
  const node = group(parseXml(source), 'frames').find(n => (n.attrs.name || n.attrs.id) === ref);
  if (!node) throw new Error('幕已改变，请刷新');
  return node;
}
export function patchFrame(source: string, ref: string, patch: { text?: string; speaker?: string; visual?: string; audio?: Record<string, string>; options?: { id: string; text: string }[] }): string {
  let next = source;
  if (patch.text !== undefined) {
    if (!patch.text.trim()) throw new Error('台词不能为空');
    const text = child(frameNode(next, ref), 'text')!;
    if (text.text !== patch.text) next = next.slice(0, text.openEnd) + escapeXml(patch.text) + next.slice(text.closeStart);
  }
  for (const name of ['speaker', 'visual'] as const) if (patch[name] !== undefined && (frameNode(next, ref).attrs[name] ?? '') !== patch[name]) next = setAttribute(next, frameNode(next, ref), name, patch[name]!);
  if (patch.audio !== undefined) {
    if (Object.keys(patch.audio).some(k => !['bgm', 'voice', 'se'].includes(k))) throw new Error('未知音频字段');
    const node = frameNode(next, ref), audio = child(node, 'audio');
    const markup = Object.entries(patch.audio).filter(([, v]) => v).length ? `<audio ${Object.entries(patch.audio).filter(([, v]) => v).map(([k, v]) => `${k}="${escapeXml(v)}"`).join(' ')} />` : '';
    if (['bgm', 'voice', 'se'].some(k => (audio?.attrs[k] ?? '') !== (patch.audio![k] ?? ''))) next = audio ? next.slice(0, audio.start) + markup + next.slice(audio.end) : next.slice(0, node.closeStart) + markup + next.slice(node.closeStart);
  }
  if (patch.options !== undefined) {
    if (patch.options.length > 100 || new Set(patch.options.map(o => o.id)).size !== patch.options.length || patch.options.some(o => !o.id || !o.text.trim())) throw new Error('选项必须有唯一 ID 和非空文字');
    const node = frameNode(next, ref), options = child(node, 'options');
    const markup = patch.options.length ? `<options>${patch.options.map(o => `<option id="${escapeXml(o.id)}">${escapeXml(o.text)}</option>`).join('')}</options>` : '';
    const current = (options?.children ?? []).map(n => ({ id: n.attrs.id, text: n.text }));
    if (JSON.stringify(current) !== JSON.stringify(patch.options)) next = options ? next.slice(0, options.start) + markup + next.slice(options.end) : next.slice(0, node.closeStart) + markup + next.slice(node.closeStart);
  }
  parseXml(next); return next;
}
export function insertFrame(source: string, afterRef?: string, duplicateRef?: string): { source: string; ref: string } {
  const root = parseXml(source), frames = child(root, 'frames');
  if (!frames || frames.openEnd === frames.closeStart) throw new Error('请先在源码中建立非自闭合 frames 分组');
  const ref = randomUUID();
  let markup = `<frame id="${ref}"><text>新的一幕。</text></frame>`;
  if (duplicateRef) {
    const original = frameNode(source, duplicateRef);
    markup = source.slice(original.start, original.end);
    let copy = parseXml(markup);
    markup = setAttribute(markup, copy, 'name', ''); copy = parseXml(markup);
    markup = setAttribute(markup, copy, 'id', ref);
  }
  const position = afterRef ? frameNode(source, afterRef).end : frames.closeStart;
  return { source: source.slice(0, position) + `\n    ${markup}\n` + source.slice(position), ref };
}
export function reorderFrames(source: string, refs: string[]): string {
  const nodes = group(parseXml(source), 'frames');
  if (refs.length !== nodes.length || new Set(refs).size !== nodes.length) throw new Error('排序必须包含本文件所有幕且不可重复');
  const byRef = new Map(nodes.map(n => [n.attrs.name || n.attrs.id, source.slice(n.start, n.end)]));
  const replacements = nodes.map((n, i) => { const value = byRef.get(refs[i]); if (!value) throw new Error('排序包含未知幕'); return { node: n, value }; });
  let next = source;
  for (const { node, value } of replacements.reverse()) next = next.slice(0, node.start) + value + next.slice(node.end);
  return next;
}
export function addAsset(source: string, asset: Omit<Asset, 'file'>): string {
  if (!['image', 'cg', 'nine-patch', 'font', 'audio', 'video', 'live2d'].includes(asset.kind)) throw new Error('资源类型不支持');
  const root = parseXml(source), assets = child(root, 'assets');
  if (!assets || assets.openEnd === assets.closeStart) throw new Error('需要非自闭合 assets 分组');
  if (assets.children.some(n => n.attrs.id === asset.id)) throw new Error('资源 ID 已存在');
  return source.slice(0, assets.closeStart) + `\n    <${asset.kind} id="${escapeXml(asset.id)}" src="${escapeXml(asset.src)}" />\n  ` + source.slice(assets.closeStart);
}
export function appendGroup(source: string, name: string, markup: string): string {
  const root = parseXml(source), node = child(root, name);
  if (!node) return source.slice(0, root.closeStart) + `\n  <${name}>${markup}</${name}>\n` + source.slice(root.closeStart);
  if (source.slice(node.start, node.openEnd).endsWith('/>')) return source.slice(0, node.start) + `<${name}>${markup}</${name}>` + source.slice(node.end);
  return source.slice(0, node.closeStart) + `\n    ${markup}\n  ` + source.slice(node.closeStart);
}
