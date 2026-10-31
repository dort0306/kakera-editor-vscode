import type { Story } from '../../domain/src/index';
import {
  EMPTY_LOCALIZATION, LOCALIZATION_BUDGETS, canonicalLocaleId, formatFtlValue, messageFor, messageMap,
  messageParameters, parseFtl, type FtlEntry, type LocalizationCatalog, type LocalizationIssue,
  type LocalizationMessageFile, type LocalizationTextLocale, type LocalizationVoiceLocale, type LocalizationManifestEdit
} from '../../domain/src/localization';
import { child, escapeXml, group, parseXml, setAttribute, type XmlNode } from './xml';
/** Source maps are intentionally typed locally to avoid a runtime import cycle with index.ts. */
export type LocalizationSources = Map<string, string>;
function validPath(value: string): string {
  if (typeof value !== 'string' || !value || value.length > 1024 || value.includes('\\') || value.includes(':') || value.startsWith('/') || /[\x00-\x1f<>"|?*]/.test(value) || value.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(part))) throw new Error(`需要游戏根内的相对路径：${value}`);
  return value;
}
function onlyAttrs(file: string, node: XmlNode, names: string[], allowText = false, allowChildren: string[] = []): void {
  if (Object.keys(node.attrs).some(key => !names.includes(key))) throw new Error(`${file}:${node.tag} 包含未知属性：${Object.keys(node.attrs).filter(key => !names.includes(key)).join('、')}`);
  if (!allowText && node.text.trim()) throw new Error(`${file}:${node.tag} 不能包含正文`);
  if (node.children.some(childNode => !allowChildren.includes(childNode.tag))) throw new Error(`${file}:${node.tag} 包含未知子节点`);
}
function lineOf(source: string, offset: number): number { return source.slice(0, offset).split('\n').length; }
function utf8(value: string): number { return new TextEncoder().encode(value).length; }
export interface LocalizationConfig { enabled: boolean; src?: string; line: number }
export function readLocalizationConfig(sources: LocalizationSources): LocalizationConfig {
  const source = sources.get('story.xml'); if (source === undefined) throw new Error('缺少 story.xml');
  const root = parseXml(source), nodes = root.children.filter(node => node.tag === 'localization');
  if (!nodes.length) return { enabled: false, line: 1 };
  if (nodes.length > 1) throw new Error('story.xml 只能声明一个 localization');
  const node = nodes[0];
  onlyAttrs('story.xml', node, ['enabled', 'src']);
  if (node.children.length) throw new Error('story.xml localization 不能包含子节点');
  if (node.attrs.enabled === 'false') {
    if (node.attrs.src !== undefined) throw new Error('关闭本地化时禁止 src');
    return { enabled: false, line: lineOf(source, node.start) };
  }
  if (node.attrs.enabled !== 'true') throw new Error('localization.enabled 必须为 true/false');
  const src = validPath(node.attrs.src ?? '');
  return { enabled: true, src, line: lineOf(source, node.start) };
}
/** Files that must be read from the content source before readStory can resolve keys. */
export function localizationFiles(sources: LocalizationSources): { manifest?: string; messages: string[] } {
  const config = readLocalizationConfig(sources);
  if (!config.enabled || !config.src) return { messages: [] };
  const manifest = sources.get(config.src); if (manifest === undefined) throw new Error(`缺少本地化清单：${config.src}`);
  const root = parseXml(manifest); onlyAttrs(config.src, root, ['schema', 'default-text', 'default-voice'], false, ['texts', 'voices']);
  const messages: string[] = [];
  for (const locale of root.children.filter(node => node.tag === 'texts').flatMap(node => node.children).filter(node => node.tag === 'locale')) {
    for (const item of locale.children.filter(node => node.tag === 'messages')) {
      const src = validPath(item.attrs.src ?? '');
      if (!messages.some(file => file.toLowerCase() === src.toLowerCase())) messages.push(src);
    }
  }
  return { manifest: config.src, messages };
}
function parseCatalog(sources: LocalizationSources): { catalog: LocalizationCatalog; issues: LocalizationIssue[] } {
  const config = readLocalizationConfig(sources);
  if (!config.enabled) return { catalog: { ...EMPTY_LOCALIZATION, texts: [], voices: [] }, issues: [] };
  const file = config.src!, manifest = sources.get(file)!;
  if (utf8(manifest) > LOCALIZATION_BUDGETS.manifest) throw new Error(`${file} 超过 1MiB`);
  const root = parseXml(manifest);
  onlyAttrs(file, root, ['schema', 'default-text', 'default-voice'], false, ['texts', 'voices']);
  if (root.tag !== 'localization' || root.attrs.schema !== '1') throw new Error(`${file}：只支持 localization schema 1`);
  if (root.children.filter(node => node.tag === 'texts').length !== 1 || root.children.filter(node => node.tag === 'voices').length !== 1) throw new Error(`${file}：必须恰有 texts 和 voices 两个分组`);
  const defaultText = canonicalLocaleId(root.attrs['default-text']);
  const defaultVoice = root.attrs['default-voice'] === undefined ? undefined : canonicalLocaleId(root.attrs['default-voice']);
  const catalog: LocalizationCatalog = { enabled: true, file, defaultText, ...(defaultVoice ? { defaultVoice } : {}), texts: [], voices: [] };
  const issues: LocalizationIssue[] = [];
  let totalFiles = 0, totalBytes = 0;
  const readFtl = (src: string): LocalizationMessageFile => {
    const source = sources.get(src);
    if (source === undefined) throw new Error(`${file}：缺少消息文件 ${src}`);
    if (utf8(source) > LOCALIZATION_BUDGETS.file) throw new Error(`${src} 超过 1MiB`);
    if (++totalFiles > LOCALIZATION_BUDGETS.files) throw new Error('消息文件超过 128 个');
    totalBytes += utf8(source); if (totalBytes > LOCALIZATION_BUDGETS.total) throw new Error('消息文件总量超过 16MiB');
    const parsed = parseFtl(src, source);
    if (parsed.issues.length) throw new Error(`${parsed.issues[0].file}:${parsed.issues[0].line}: ${parsed.issues[0].message}`);
    return { src, file: src, entries: parsed.entries };
  };
  const texts = child(root, 'texts')!;
  onlyAttrs(file, texts, [], false, ['locale']);
  for (const localeNode of texts.children) {
    if (localeNode.tag !== 'locale') throw new Error(`${file}:texts 包含未知节点`);
    onlyAttrs(file, localeNode, ['id', 'label'], false, ['messages', 'font']);
    const id = canonicalLocaleId(localeNode.attrs.id), label = localeNode.attrs.label ?? '';
    if (!label.trim() || [...label].length > LOCALIZATION_BUDGETS.label) throw new Error(`${file}:${id} 的 label 必须为 1–64 个字符`);
    if (!label.trim()) throw new Error(`${file}:${id} 的 label 不能为空`);
    const locale: LocalizationTextLocale = { id, label, messages: [], fonts: [], file, line: lineOf(manifest, localeNode.start) };
    for (const item of localeNode.children) {
      if (item.tag === 'messages') { onlyAttrs(file, item, ['src']); const src = validPath(item.attrs.src ?? ''); if (locale.messages.some(message => message.src.toLowerCase() === src.toLowerCase())) throw new Error(`${file}:${id} 重复消息文件 ${src}`); if (locale.messages.length >= LOCALIZATION_BUDGETS.messageFiles) throw new Error(`${file}:${id} 消息文件超过 16 个`); locale.messages.push(readFtl(src)); }
      else { onlyAttrs(file, item, ['ref']); const ref = item.attrs.ref ?? ''; if (!ref.trim() || locale.fonts.includes(ref) || locale.fonts.length >= LOCALIZATION_BUDGETS.fonts) throw new Error(`${file}:${id} 字体引用为空、重复或超过 16 个`); locale.fonts.push(ref); }
    }
    if (!locale.messages.length || !locale.fonts.length) throw new Error(`${file}:${id} 需要 1–16 个 messages 和 1–16 个 font`);
    if (catalog.texts.some(item => item.id === id)) throw new Error(`${file}:重复文本语言 ${id}`);
    if (catalog.texts.length >= LOCALIZATION_BUDGETS.texts) throw new Error(`${file}:文本语言超过 32 个`);
    catalog.texts.push(locale);
  }
  const voices = child(root, 'voices')!;
  onlyAttrs(file, voices, [], false, ['locale']);
  for (const localeNode of voices.children) {
    if (localeNode.tag !== 'locale') throw new Error(`${file}:voices 包含未知节点`);
    onlyAttrs(file, localeNode, ['id', 'label'], false, ['clip']);
    const id = canonicalLocaleId(localeNode.attrs.id), label = localeNode.attrs.label ?? '';
    if (!label.trim() || [...label].length > LOCALIZATION_BUDGETS.label) throw new Error(`${file}:${id} 的 label 必须为 1–64 个字符`);
    const locale: LocalizationVoiceLocale = { id, label, clips: [], file, line: lineOf(manifest, localeNode.start) };
    for (const clip of localeNode.children) {
      if (clip.tag !== 'clip') throw new Error(`${file}:voices 包含未知节点`);
      onlyAttrs(file, clip, ['key', 'asset', 'silent']);
      const key = clip.attrs.key ?? ''; if (!key.trim()) throw new Error(`${file}:${id} 的 clip 缺少 key`);
      if (locale.clips.some(item => item.key === key)) throw new Error(`${file}:${id} 重复语音 key：${key}`);
      const hasAsset = clip.attrs.asset !== undefined && clip.attrs.asset !== '', silent = clip.attrs.silent === 'true';
      if (hasAsset === silent || (clip.attrs.silent !== undefined && clip.attrs.silent !== 'true')) throw new Error(`${file}:${id}/${key} 需要 asset 或 silent="true" 二选一`);
      locale.clips.push({ key, ...(hasAsset ? { asset: clip.attrs.asset } : {}), silent });
    }
    if (catalog.voices.some(item => item.id === id)) throw new Error(`${file}:重复语音语言 ${id}`);
    if (catalog.voices.length >= LOCALIZATION_BUDGETS.voices) throw new Error(`${file}:语音语言超过 32 个`);
    catalog.voices.push(locale);
  }
  if (!catalog.texts.some(locale => locale.id === defaultText)) throw new Error(`${file}:default-text 必须属于 texts`);
  if (defaultVoice ? !catalog.voices.some(locale => locale.id === defaultVoice) : catalog.voices.length > 0) throw new Error(`${file}:default-voice 必须属于非空 voices，或 voices 为空时省略`);
  // Duplicate IDs across the files of one locale are rejected by the matching engine.
  for (const locale of catalog.texts) {
    const seen = new Map<string, string>();
    for (const message of locale.messages) for (const entry of message.entries) {
      const previous = seen.get(entry.id);
      if (previous) throw new Error(`${file}:${locale.id} 的 ${entry.id} 在 ${previous} 与 ${message.src} 重复`);
      seen.set(entry.id, message.src);
    }
    try {
      for (const entry of locale.messages.flatMap(message => message.entries)) {
        messageParameters(catalog, locale.id, entry.id);
        if (entry.parameters.length === 0 && !entry.term) formatFtlValue(catalog, locale.id, entry.id, {});
      }
    } catch (e) { throw new Error(`${locale.id}：${e instanceof Error ? e.message : 'Fluent 校验失败'}`); }
  }
  const entries = catalog.texts.reduce((sum, locale) => sum + locale.messages.reduce((count, message) => count + message.entries.length, 0), 0);
  if (entries > LOCALIZATION_BUDGETS.entries) throw new Error('本地化消息条目超过 50000');
  return { catalog, issues };
}
/** Read the manifest and every declared FTL from Sources. Structural errors throw. */
export function readLocalization(sources: LocalizationSources): LocalizationCatalog { return parseCatalog(sources).catalog; }

export interface LocalizationUsage { key: string; file: string; line: number; label: string; arguments?: string[]; dynamic?: boolean }
/** Coverage, argument-contract, font and voice checks performed after Story is built. */
export function localizationIssues(story: Story, usages: LocalizationUsage[] = []): LocalizationIssue[] {
  const catalog = story.localization;
  if (!catalog?.enabled) return usages.filter(usage => !usage.dynamic && usage.key).map(usage => ({ file: usage.file, line: usage.line, message: `${usage.label} 使用了本地化 key ${usage.key}，但游戏没有开启 localization`, severity: 'error' as const }));
  const issues: LocalizationIssue[] = [];
  for (const usage of usages) {
    if (usage.dynamic) continue;
    const found = messageFor(catalog, catalog.defaultText, usage.key);
    if (!found) { issues.push({ file: usage.file, line: usage.line, message: `${usage.label} 使用了未在默认文本语言声明的 key：${usage.key}`, severity: 'error' }); continue; }
    const parameters = messageParameters(catalog, catalog.defaultText, usage.key);
    const actual = new Set(usage.arguments ?? []);
    const missing = parameters.filter(name => !actual.has(name));
    const extra = (usage.arguments ?? []).filter(name => !parameters.includes(name));
    if (missing.length || extra.length) issues.push({ file: usage.file, line: usage.line, message: `${usage.label} 的 text-arg 与消息参数不一致${missing.length ? `，缺少：${missing.join('、')}` : ''}${extra.length ? `，多余：${extra.join('、')}` : ''}`, severity: 'error' });
    for (const locale of catalog.texts) {
      if (locale.id === catalog.defaultText) continue;
      const localized = messageFor(catalog, locale.id, usage.key);
      if (!localized || localized.locale !== locale.id) continue;
      let parametersForLocale: string[] = [];
      try { parametersForLocale = messageParameters(catalog, locale.id, usage.key); } catch (e) { issues.push({ file: usage.file, line: usage.line, message: `${locale.id}/${usage.key}：${e instanceof Error ? e.message : 'Fluent 校验失败'}`, severity: 'error' }); continue; }
      const missingLocale = parametersForLocale.filter(name => !actual.has(name));
      const extraLocale = (usage.arguments ?? []).filter(name => !parametersForLocale.includes(name));
      if (missingLocale.length || extraLocale.length) issues.push({ file: usage.file, line: usage.line, message: `${locale.id}/${usage.key} 的 text-arg 与消息参数不一致${missingLocale.length ? `，缺少：${missingLocale.join('、')}` : ''}${extraLocale.length ? `，多余：${extraLocale.join('、')}` : ''}`, severity: 'error' });
    }
  }
  const fonts = new Map(story.assets.map(asset => [asset.id, asset.kind]));
  for (const locale of catalog.texts) for (const font of locale.fonts) if (fonts.get(font) !== 'font') issues.push({ file: locale.file, line: locale.line, message: `${locale.id} 的字体 ${font} 不是已声明的 font 资源`, severity: 'error' });
  const voiceKeys = new Set(story.frames.map(frame => frame.audio.voice).filter((value): value is string => !!value));
  for (const locale of catalog.voices) for (const clip of locale.clips) {
    if (!voiceKeys.has(clip.key)) issues.push({ file: locale.file, line: locale.line, message: `${locale.id} 的语音 key 未被任何剧情 audio.voice 使用：${clip.key}`, severity: 'error' });
    if (clip.asset && fonts.get(clip.asset) !== 'audio') issues.push({ file: locale.file, line: locale.line, message: `${locale.id}/${clip.key} 的 asset 不是已声明的 audio 资源：${clip.asset}`, severity: 'error' });
  }
  if (catalog.defaultVoice) {
    const locale = catalog.voices.find(item => item.id === catalog.defaultVoice);
    const missing = [...voiceKeys].filter(key => locale && !locale.clips.some(clip => clip.key === key));
    if (missing.length) issues.push({ file: catalog.file ?? 'languages.xml', line: 1, message: `默认语音语言缺少剧情语音映射：${missing.join('、')}`, severity: 'error' });
  }
  return issues;
}

export interface LocalizationEdit { action: 'message' | 'deleteMessage'; locale?: string; file?: string; key?: string; value?: string; location?: { key: string; value: string }[] }
export type { LocalizationManifestEdit } from '../../domain/src/localization';
/** Strict source editing for the manifest's defaults, labels, text locales and
 * voice mapping. Adding files is intentionally not supported here: a new FTL
 * must already be a declared game source file.
 */
export function editLocalizationManifest(sources: LocalizationSources, edit: LocalizationManifestEdit): Map<string, string> {
  const catalog = readLocalization(sources);
  if (!catalog.enabled || !catalog.file) throw new Error('当前工程没有开启本地化');
  const file = catalog.file, source = sources.get(file)!;
  let root = parseXml(source);
  const findText = (id: string) => child(root, 'texts')?.children.find(node => node.tag === 'locale' && node.attrs.id === id);
  const findVoice = (id: string) => child(root, 'voices')?.children.find(node => node.tag === 'locale' && node.attrs.id === id);
  const write = (next: string) => { const candidate = new Map([...sources, [file, next]]); readLocalization(candidate); return new Map([[file, next]]); };
  if (edit.action === 'defaults') {
    const defaultText = canonicalLocaleId(edit.defaultText);
    if (!catalog.texts.some(locale => locale.id === defaultText)) throw new Error('默认文本语言必须属于已声明的 texts');
    let next = setAttribute(source, root, 'default-text', defaultText);
    root = parseXml(next);
    if (edit.defaultVoice === null || edit.defaultVoice === '') {
      if (catalog.voices.length) throw new Error('voices 非空时必须声明 default-voice');
      next = setAttribute(next, root, 'default-voice', '');
    } else if (edit.defaultVoice !== undefined) {
      const defaultVoice = canonicalLocaleId(edit.defaultVoice);
      if (!catalog.voices.some(locale => locale.id === defaultVoice)) throw new Error('默认语音语言必须属于已声明的 voices');
      next = setAttribute(next, root, 'default-voice', defaultVoice);
    }
    return write(next);
  }
  if (edit.action === 'textLocale') {
    const id = canonicalLocaleId(edit.id), node = findText(id);
    if (!node) throw new Error('只能在源码中新增文本语言；可视化面板可编辑既有语言');
    const label = edit.label ?? '';
    if (!label.trim() || [...label].length > LOCALIZATION_BUDGETS.label) throw new Error('语言显示名必须为 1–64 个字符');
    return write(setAttribute(source, node, 'label', label));
  }
  if (edit.action === 'deleteTextLocale') {
    const id = canonicalLocaleId(edit.id), node = findText(id);
    if (!node) throw new Error('文本语言不存在，请刷新');
    if (id === catalog.defaultText) throw new Error('不能删除默认文本语言');
    if (catalog.texts.length <= 1) throw new Error('至少需要一个文本语言');
    return write(source.slice(0, node.start) + source.slice(node.end));
  }
  if (edit.action === 'voiceLocale') {
    if (!edit.id) throw new Error('语音语言缺少 id');
    const id = canonicalLocaleId(edit.id), label = edit.label ?? '';
    if (!label.trim() || [...label].length > LOCALIZATION_BUDGETS.label) throw new Error('语言显示名必须为 1–64 个字符');
    const clips = edit.clips ?? [];
    if (clips.length > 256) throw new Error('语音映射过多');
    const keys = new Set<string>();
    const markup = clips.map(clip => {
      if (!clip || typeof clip.key !== 'string' || !clip.key.trim() || keys.has(clip.key)) throw new Error('语音 key 必须唯一且非空');
      keys.add(clip.key);
      const hasAsset = typeof clip.asset === 'string' && clip.asset !== '';
      if (hasAsset === (clip.silent === true) || (clip.silent !== undefined && clip.silent !== true)) throw new Error(`语音映射 ${clip.key} 需要 asset 或 silent="true" 二选一`);
      return `<clip key="${escapeXml(clip.key)}" ${hasAsset ? `asset="${escapeXml(clip.asset!)}"` : 'silent="true"'} />`;
    }).join('');
    const node = findVoice(id), voices = child(root, 'voices');
    if (!voices) throw new Error('清单缺少 voices 分组');
    if (node) {
      let next = setAttribute(source, node, 'label', label);
      const refreshed = parseXml(next), target = (function find(current: XmlNode): XmlNode | undefined { if (current.start === node.start && current.tag === 'locale') return current; for (const childNode of current.children) { const found = find(childNode); if (found) return found; } })(refreshed)!;
      if (next.slice(target.start, target.openEnd).endsWith('/>')) next = next.slice(0, target.openEnd - 2).replace(/[ \t]+$/, '') + `>${markup}</locale>` + next.slice(target.end);
      else next = next.slice(0, target.openEnd) + `${markup}` + next.slice(target.closeStart);
      // Replace existing clip children only; closing tag remains.
      return write(next);
    }
    const voiceNode = `<locale id="${escapeXml(id)}" label="${escapeXml(label)}">${markup}</locale>`;
    let added: string;
    if (source.slice(voices.start, voices.openEnd).endsWith('/>')) added = source.slice(0, voices.openEnd - 2).replace(/[ \t]+$/, '') + `>\n    ${voiceNode}\n  </voices>` + source.slice(voices.end);
    else added = source.slice(0, voices.closeStart) + `\n    ${voiceNode}\n  ` + source.slice(voices.closeStart);
    // A non-empty voices group requires default-voice; the first voice language
    // becomes the explicit default instead of leaving an invalid manifest.
    if (!catalog.voices.length) added = setAttribute(added, parseXml(added), 'default-voice', id);
    return write(added);
  }
  if (edit.action === 'deleteVoiceLocale') {
    const id = canonicalLocaleId(edit.id), node = findVoice(id);
    if (!node) throw new Error('语音语言不存在，请刷新');
    if (id === catalog.defaultVoice) throw new Error('不能删除默认语音语言；请先修改默认语音');
    return write(source.slice(0, node.start) + source.slice(node.end));
  }
  throw new Error('不支持的本地化清单操作');
}
function ftlEol(source: string): string { return source.includes('\r\n') ? '\r\n' : '\n'; }
function serializeValue(value: string, eol: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('消息正文不能为空');
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) throw new Error('消息正文包含控制字符');
  const lines = value.replace(/\r\n?/g, '\n').split('\n');
  return lines.map((line, index) => index === 0 ? line : `    ${line}`).join(eol);
}
function firstMessageFile(locale: LocalizationTextLocale): LocalizationMessageFile { const file = locale.messages[0]; if (!file) throw new Error(`${locale.id} 没有消息文件`); return file; }
/** Edit or add one message in a locale's FTL files. Source ranges preserve
 * other messages, comments and line endings. */
export function editFtlMessage(sources: LocalizationSources, localeId: string, key: string, value: string): Map<string, string> {
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(key)) throw new Error('消息 key 必须以英文字母开头，且只包含英文、数字、下划线或连字符，最多 128 字节');
  const catalog = readLocalization(sources), locale = catalog.texts.find(item => item.id === localeId);
  if (!locale) throw new Error('文本语言不存在');
  for (const file of locale.messages) {
    const source = sources.get(file.src);
    if (source === undefined) throw new Error(`缺少消息文件：${file.src}`);
    const existing = parseFtl(file.src, source).entries.find(entry => entry.id === key && !entry.term);
    if (!existing) continue;
    const changed = source.slice(0, existing.valueStart) + serializeValue(value, ftlEol(source)) + source.slice(existing.valueEnd);
    const check = parseFtl(file.src, changed); if (check.issues.length) throw new Error(`${check.issues[0].file}:${check.issues[0].line}: ${check.issues[0].message}`);
    const result = new Map([...sources, [file.src, changed]]);
    readLocalization(result);
    return new Map([[file.src, changed]]);
  }
  const file = firstMessageFile(locale), source = sources.get(file.src);
  if (source === undefined) throw new Error(`缺少消息文件：${file.src}`);
  const eol = ftlEol(source);
  let changed = source;
  if (!changed.endsWith(eol)) changed += eol;
  changed += `${key} = ${serializeValue(value, eol)}${eol}`;
  const result = new Map([...sources, [file.src, changed]]);
  readLocalization(result);
  return new Map([[file.src, changed]]);
}
export function deleteFtlMessage(sources: LocalizationSources, localeId: string, key: string): Map<string, string> {
  const catalog = readLocalization(sources), locale = catalog.texts.find(item => item.id === localeId);
  if (!locale) throw new Error('文本语言不存在');
  for (const file of locale.messages) {
    const source = sources.get(file.src); if (source === undefined) continue;
    const entry = parseFtl(file.src, source).entries.find(item => item.id === key && !item.term);
    if (!entry) continue;
    let end = entry.end;
    if (source.slice(end, end + 2) === '\r\n') end += 2; else if (source[end] === '\n') end += 1;
    const changed = source.slice(0, entry.start) + source.slice(end);
    const result = new Map([...sources, [file.src, changed]]);
    readLocalization(result);
    return new Map([[file.src, changed]]);
  }
  throw new Error('消息不存在，请刷新');
}
export function localeMessages(catalog: LocalizationCatalog, localeId?: string): FtlEntry[] {
  const locale = catalog.texts.find(item => item.id === localeId) ?? catalog.texts.find(item => item.id === catalog.defaultText);
  return locale ? [...messageMap(locale).values()].sort((a, b) => a.id.localeCompare(b.id)) : [];
}
export function usedKeys(usages: LocalizationUsage[]): Set<string> { return new Set(usages.filter(usage => !usage.dynamic).map(usage => usage.key)); }
export function formatForPreview(catalog: LocalizationCatalog | undefined, key: string, args: Record<string, string | number>, locale?: string): string {
  if (!catalog?.enabled) return key;
  try { return formatFtlValue(catalog, locale, key, args); } catch { return key; }
}
