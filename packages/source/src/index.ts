import { randomBytes, randomUUID } from 'node:crypto';
import type { Asset, Frame, Story } from '../../domain/src/index';
import { formatFtlValue } from '../../domain/src/localization';
import { child, escapeXml, group, parseXml, setAttribute, type XmlNode } from './xml';
import { readLocalization, type LocalizationUsage } from './localization';
export { emitRoutes, readManagedRoutes } from './routes';
export { analyzeLogic, patchLogicRoutes, protectedLogicTargets, type LogicAnalysis, type LogicSummary } from './logic';
export { parseXml, escapeXml } from './xml';
export type Sources = Map<string, string>;
function localizedText(catalog: Story['localization'], key: string): string {
  if (!catalog?.enabled) return '';
  try { return formatFtlValue(catalog, undefined, key, {}); } catch { return ''; }
}
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
  const localization = readLocalization(sources);
  const story: Story = { id: first.attrs.id ?? '', entry: first.attrs.entry ?? '', entries: [], contentVersion: first.attrs['content-version'] ?? '', frames: [], assets: [], visuals: [], variables: [], characters: [], scripts: [], files, localization };
  for (const [chapter, { file, root, source }] of nodes.entries()) {
    if (chapter > 0 && child(root, 'localization')) throw new Error(`${file}：只有入口 story.xml 可以声明 localization`);
    for (const n of group(root, 'frames')) {
      if (n.tag !== 'frame') throw new Error('frames 中包含未知元素');
      const text = child(n, 'text');
      if (!text || n.children.filter(x => x.tag === 'text').length !== 1) throw new Error('每幕需要一个 text');
      const textKey = text.attrs.key;
      if (textKey !== undefined) {
        if (!textKey || textKey.length > 128 || Object.keys(text.attrs).length !== 1 || text.children.length || text.text.trim()) throw new Error(`${file}：key 文本必须是只带 key 属性的空 text 元素`);
      } else if (text.children.length || !text.text.trim()) throw new Error('每幕文字 text 需要纯文本或 key');
      const pending = !!n.attrs.id && !!n.attrs.name?.startsWith('kakera.pending.') && n.children.length === 1 && text.text === '后续剧情尚未连接。' && source.slice(n.openEnd, text.start).includes('<!-- Kakera pending route v1 -->');
      const legacyVideo = n.children.some(x => x.tag === 'video');
      const options = group(n, 'options').map(o => {
        if (o.tag !== 'option') throw new Error('options 中包含未知元素');
        const key = o.attrs['text-key'];
        if (key !== undefined) {
          if (!key || o.children.length || o.text.trim() || Object.keys(o.attrs).some(name => !['id', 'text-key'].includes(name))) throw new Error(`${file}：选项 text-key 与正文/未知属性不能同时出现`);
          return { id: o.attrs.id, text: localizedText(localization, key), textKey: key };
        }
        if (o.children.length || !o.text.trim()) throw new Error('选项目前需要纯文本或 text-key');
        return { id: o.attrs.id, text: o.text };
      });
      story.frames.push({ ref: n.attrs.name || n.attrs.id || '', id: n.attrs.id, name: n.attrs.name, speaker: n.attrs.speaker ?? '', visual: n.attrs.visual ?? '', text: textKey === undefined ? text.text : localizedText(localization, textKey), ...(textKey === undefined ? {} : { textKey }), audio: child(n, 'audio')?.attrs ?? {}, options, file, line: source.slice(0, n.start).split('\n').length, ...(pending ? { pending: true } : {}), ...(legacyVideo ? { legacyVideo: true } : {}) });
    }
    story.assets.push(...group(root, 'assets').map(n => ({ id: n.attrs.id, kind: n.tag, src: n.attrs.src, file })));
    story.characters.push(...group(root, 'characters').map(n => {
      if (n.tag !== 'character') throw new Error('characters 中包含未知元素');
      const nameKey = n.attrs['name-key'];
      if (n.attrs.name !== undefined && nameKey !== undefined) throw new Error(`${file}：人物 name 与 name-key 不能同时出现`);
      if (nameKey !== undefined) return { id: n.attrs.id, name: localizedText(localization, nameKey), nameKey };
      return { id: n.attrs.id, name: n.attrs.name ?? '' };
    }));
    story.visuals.push(...group(root, 'visuals').map(n => ({ id: n.attrs.id, background: n.attrs.background ?? '', portraits: n.children.filter(p => p.tag === 'portrait').map(p => ({ image: p.attrs.image, character: p.attrs.character, slot: p.attrs.slot, ...(child(p, 'live2d') ? { live2d: child(p, 'live2d')!.attrs.asset } : {}) })), ...(n.attrs.cg ? { cg: n.attrs.cg } : {}) })));
    story.variables.push(...group(root, 'variables').map(n => {
      if (!['int', 'bool', 'string'].includes(n.tag)) throw new Error('未知变量类型');
      const labelKey = n.attrs['label-key'];
      if (n.attrs.label !== undefined && labelKey !== undefined) throw new Error(`${file}：变量 label 与 label-key 不能同时出现`);
      return { id: n.attrs.id, type: n.tag as 'int' | 'bool' | 'string', initial: n.attrs.initial, min: n.attrs.min, max: n.attrs.max, ...(n.attrs.label === undefined ? {} : { label: n.attrs.label }), ...(labelKey === undefined ? {} : { labelKey, label: localizedText(localization, labelKey) }) };
    }));
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
/** All static story text targets used by the localization coverage checks. */
export function storyLocalizationUsages(story: Story): LocalizationUsage[] {
  const usages: LocalizationUsage[] = [];
  for (const frame of story.frames) {
    if (frame.textKey) usages.push({ key: frame.textKey, file: frame.file, line: frame.line, label: `幕 ${frame.ref} 台词` });
    for (const option of frame.options) if (option.textKey) usages.push({ key: option.textKey, file: frame.file, line: frame.line, label: `幕 ${frame.ref} 选项 ${option.id}` });
  }
  for (const character of story.characters) if (character.nameKey) usages.push({ key: character.nameKey, file: 'story.xml', line: 1, label: `人物 ${character.id} 名称` });
  for (const variable of story.variables) if (variable.labelKey) usages.push({ key: variable.labelKey, file: 'story.xml', line: 1, label: `变量 ${variable.id} 标签` });
  return usages;
}
export { readLocalization, localizationIssues, localizationFiles, readLocalizationConfig, editFtlMessage, deleteFtlMessage, editLocalizationManifest, localeMessages, formatForPreview, type LocalizationUsage, type LocalizationManifestEdit } from './localization';
export { readGameTitle, patchGameTitle, editCharacter, addCharacterLooks, characterLooks, assignCharacterLook, setFrameVisual } from './project';
export { reconcilePendingRoutes, insertConnectedFrame, deleteConnectedFrame, deleteConnectedFrames, duplicateConnectedFrames, setStoryEntry, setStoryEntries, addStoryVariable, editStoryVariable, deleteStoryVariable, deleteCharacter, renameFrame } from './editing';
function frameNode(source: string, ref: string): XmlNode {
  const node = group(parseXml(source), 'frames').find(n => (n.attrs.name || n.attrs.id) === ref);
  if (!node) throw new Error('幕已改变，请刷新');
  return node;
}
export function patchFrame(source: string, ref: string, patch: { text?: string; textKey?: string | null; speaker?: string; visual?: string; audio?: Record<string, string>; options?: { id: string; text: string; textKey?: string }[] }): string {
  let next = source;
  const current = frameNode(next, ref), currentText = child(current, 'text')!;
  if (patch.textKey !== undefined) {
    const key = (patch.textKey ?? '').trim();
    if (key) {
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(key)) throw new Error('本地化 key 必须以英文字母开头，且只包含英文、数字、下划线或连字符');
      const markup = `<text key="${escapeXml(key)}" />`;
      if (source.slice(currentText.start, currentText.end) !== markup) next = next.slice(0, currentText.start) + markup + next.slice(currentText.end);
    } else {
      const text = patch.text ?? '';
      if (!text.trim()) throw new Error('台词不能为空');
      const markup = `<text>${escapeXml(text)}</text>`;
      if (source.slice(currentText.start, currentText.end) !== markup) next = next.slice(0, currentText.start) + markup + next.slice(currentText.end);
    }
  } else if (patch.text !== undefined) {
    if (currentText.attrs.key !== undefined) {
      if (patch.text !== currentText.text) throw new Error('此幕使用本地化 key，请在本地化面板编辑消息，或切换为固定文字');
    } else {
      if (!patch.text.trim()) throw new Error('台词不能为空');
      const text = child(frameNode(next, ref), 'text')!;
      if (text.text !== patch.text) next = next.slice(0, text.openEnd) + escapeXml(patch.text) + next.slice(text.closeStart);
    }
  }
  for (const name of ['speaker', 'visual'] as const) if (patch[name] !== undefined && (frameNode(next, ref).attrs[name] ?? '') !== patch[name]) next = setAttribute(next, frameNode(next, ref), name, patch[name]!);
  if (patch.audio !== undefined) {
    if (Object.keys(patch.audio).some(k => !['bgm', 'voice', 'se'].includes(k))) throw new Error('未知音频字段');
    const node = frameNode(next, ref), audio = child(node, 'audio');
    const markup = Object.entries(patch.audio).filter(([, v]) => v).length ? `<audio ${Object.entries(patch.audio).filter(([, v]) => v).map(([k, v]) => `${k}="${escapeXml(v)}"`).join(' ')} />` : '';
    if (['bgm', 'voice', 'se'].some(k => (audio?.attrs[k] ?? '') !== (patch.audio![k] ?? ''))) next = audio ? next.slice(0, audio.start) + markup + next.slice(audio.end) : next.slice(0, node.closeStart) + markup + next.slice(node.closeStart);
  }
  if (patch.options !== undefined) {
    if (patch.options.length > 100 || new Set(patch.options.map(o => o.id)).size !== patch.options.length || patch.options.some(o => !o.id || (!o.textKey && !o.text.trim()))) throw new Error('选项必须有唯一 ID 和非空文字或 key');
    const options = patch.options.map(option => {
      if (option.textKey) {
        if (!/^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(option.textKey)) throw new Error('选项本地化 key 必须以英文字母开头，且只包含英文、数字、下划线或连字符');
        return { node: `<option id="${escapeXml(option.id)}" text-key="${escapeXml(option.textKey)}" />`, textKey: option.textKey };
      }
      return { node: `<option id="${escapeXml(option.id)}">${escapeXml(option.text)}</option>`, textKey: undefined };
    });
    const node = frameNode(next, ref), optionsNode = child(node, 'options');
    const markup = patch.options.length ? `<options>${options.map(option => option.node).join('')}</options>` : '';
    const currentOptions = (optionsNode?.children ?? []).map(n => ({ id: n.attrs.id, text: n.attrs['text-key'] ? '' : n.text, textKey: n.attrs['text-key'] }));
    const desired = patch.options.map(option => option.textKey ? { id: option.id, text: '', textKey: option.textKey } : { id: option.id, text: option.text, textKey: undefined });
    if (JSON.stringify(currentOptions) !== JSON.stringify(desired)) next = optionsNode ? next.slice(0, optionsNode.start) + markup + next.slice(optionsNode.end) : next.slice(0, node.closeStart) + markup + next.slice(node.closeStart);
  }
  parseXml(next); return next;
}
/** Stable short ID shared by frames, characters, assets, visuals and UI nodes.
 * The UUID is only a collision fallback after 64 attempts, never the normal path. */
export function newShortId(reserved: Iterable<string> = []): string {
  const used = new Set(reserved);
  for (let attempt = 0; attempt < 64; attempt++) {
    const id = randomBytes(8).toString('hex');
    if (!used.has(id)) return id;
  }
  // UUID remains the collision fallback only.
  return randomUUID();
}
export function newFrameRef(reserved: Iterable<string> = []): string { return newShortId(reserved); }
export function insertFrame(source: string, afterRef?: string, duplicateRef?: string, reserved: Iterable<string> = []): { source: string; ref: string } {
  const root = parseXml(source), frames = child(root, 'frames');
  if (!frames || frames.openEnd === frames.closeStart) throw new Error('请先在源码中建立非自闭合 frames 分组');
  const used = new Set(reserved);
  for (const node of frames.children) for (const value of [node.attrs.id, node.attrs.name]) if (value) used.add(value);
  const ref = newFrameRef(used);
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
