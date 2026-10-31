/** Author-declared game localization catalogs (Kakera v0.10.1, story 8 / UI 3).
 * The matching player remains the final authority; this module provides the
 * editor's bounded read model, static formatting and shared diagnostics.
 */
export interface LocalizationIssue { file: string; line: number; message: string; severity: 'error' | 'warning' }

/** One Fluent message or term. Positions are UTF-16 offsets into the FTL source. */
export interface FtlEntry {
  id: string; term: boolean; value: string; file: string; line: number;
  start: number; end: number; valueStart: number; valueEnd: number;
  parameters: string[]; references: string[];
}
export interface FtlParseResult { entries: FtlEntry[]; issues: LocalizationIssue[] }
export interface LocalizationMessageFile { src: string; file: string; entries: FtlEntry[] }
export interface LocalizationTextLocale { id: string; label: string; messages: LocalizationMessageFile[]; fonts: string[]; file: string; line: number }
export interface LocalizationVoiceClip { key: string; asset?: string; silent: boolean }
export interface LocalizationVoiceLocale { id: string; label: string; clips: LocalizationVoiceClip[]; file: string; line: number }
export interface LocalizationCatalog {
  enabled: boolean;
  /** languages.xml relative path; absent when disabled. */
  file?: string;
  defaultText: string;
  defaultVoice?: string;
  texts: LocalizationTextLocale[];
  voices: LocalizationVoiceLocale[];
}
/** Author-facing manifest edit accepted by the host and webview. */
export interface LocalizationManifestEdit {
  action: 'defaults' | 'textLocale' | 'deleteTextLocale' | 'voiceLocale' | 'deleteVoiceLocale';
  defaultText?: string; defaultVoice?: string | null;
  id?: string; label?: string; clips?: { key: string; asset?: string; silent?: boolean }[];
}
export const EMPTY_LOCALIZATION: LocalizationCatalog = { enabled: false, defaultText: '', texts: [], voices: [] };
export const LOCALIZATION_BUDGETS = {
  manifest: 1024 * 1024, file: 1024 * 1024, files: 128, total: 16 * 1024 * 1024,
  texts: 32, voices: 32, messageFiles: 16, fonts: 16, entries: 50000, references: 100000,
  parameters: 16, depth: 32, output: 64 * 1024, args: 16, argument: 4096, label: 64
} as const;

/** Unicode language identifier subset accepted by the matching engine. */
export function canonicalLocaleId(value: unknown): string {
  if (typeof value !== 'string' || !value || new TextEncoder().encode(value).length > 64 || value.includes('_') || /\s/.test(value)) throw new Error('语言标识必须是 1–64 字节的规范 Unicode language identifier');
  const parts = value.split('-');
  if (!/^[A-Za-z]{2,3}$/.test(parts[0]) || parts[0].toLowerCase() === 'und') throw new Error(`语言标识不合法：${value}`);
  let index = 1, script = '', region = '';
  if (parts[index] && /^[A-Za-z]{4}$/.test(parts[index])) { script = parts[index]; index++; }
  if (parts[index] && (/^[A-Za-z]{2}$/.test(parts[index]) || /^[0-9]{3}$/.test(parts[index]))) { region = parts[index]; index++; }
  const variants = parts.slice(index);
  if (variants.some(part => !/^[A-Za-z0-9]{5,8}$/.test(part) && !/^[0-9][A-Za-z0-9]{3}$/.test(part))) throw new Error(`语言标识不合法：${value}`);
  const seen = new Set<string>();
  for (const part of variants) { const key = part.toLowerCase(); if (seen.has(key)) throw new Error(`语言标识包含重复子标签：${value}`); seen.add(key); }
  const canonical = [parts[0].toLowerCase(), script ? script[0].toUpperCase() + script.slice(1).toLowerCase() : '', region ? region.toUpperCase() : '', ...variants.map(part => part.toLowerCase())].filter(Boolean).join('-');
  if (canonical !== value) throw new Error(`语言标识必须使用规范拼写（例如 zh-CN、en-US）：${value}`);
  return value;
}
export function isCanonicalLocaleId(value: unknown): value is string { try { canonicalLocaleId(value); return true; } catch { return false; } }

interface SourceLine { text: string; start: number; end: number; eolEnd: number }
function sourceLines(source: string): SourceLine[] {
  const lines: SourceLine[] = []; let start = 0;
  for (let i = 0; i <= source.length; i++) {
    if (i < source.length && source[i] !== '\n') continue;
    const end = i > start && source[i - 1] === '\r' ? i - 1 : i;
    lines.push({ text: source.slice(start, end), start, end, eolEnd: Math.min(source.length, i + 1) });
    start = i + 1;
    if (i === source.length) break;
  }
  return lines;
}
function lineOf(source: string, offset: number): number { let line = 1; for (let i = 0; i < offset && i < source.length; i++) if (source[i] === '\n') line++; return line; }

interface Analysis { parameters: Set<string>; references: string[]; issues: string[] }
/** Fluent only interprets escapes inside quoted literals, never in plain text. */
function fluentString(value: string): string {
  if (!/^"(?:[^"\\\r\n]|\\(?:["\\]|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{6}))*"$/.test(value)) throw new Error('Fluent 字符串字面量或转义无效');
  return value.slice(1, -1).replace(/\\(?:u([0-9a-fA-F]{4})|U([0-9a-fA-F]{6})|(["\\]))/g, (_, short: string, long: string, escaped: string) => {
    if (escaped) return escaped;
    const code = parseInt(short ?? long, 16);
    return code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) ? '\uFFFD' : String.fromCodePoint(code);
  });
}
function analyzeInline(value: string, depth: number, file: string, line: number): Analysis {
  const result: Analysis = { parameters: new Set(), references: [], issues: [] };
  const text = value.trim();
  if (!text) { result.issues.push(`${file}:${line}：空占位符`); return result; }
  if (text.startsWith('$')) {
    if (!/^\$[A-Za-z][A-Za-z0-9_-]*$/.test(text)) result.issues.push(`${file}:${line}：变量占位符格式错误：{ ${text} }`);
    else result.parameters.add(text.slice(1));
    return result;
  }
  if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(text)) return result;
  if (text.startsWith('-')) {
    if (text.includes('(') || text.includes(')')) result.issues.push(`${file}:${line}：不支持带参数的术语引用`);
    else if (text.includes('.')) result.issues.push(`${file}:${line}：不支持术语属性引用`);
    else if (!/^-[A-Za-z][A-Za-z0-9_-]*$/.test(text)) result.issues.push(`${file}:${line}：术语引用格式错误`);
    else result.references.push(text);
    return result;
  }
  if (text.startsWith('"')) {
    try { fluentString(text); } catch (error) { result.issues.push(`${file}:${line}：${(error as Error).message}`); }
    let escaped = false, closed = false;
    for (let i = 1; i < text.length; i++) { const c = text[i]; if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') { closed = true; if (i !== text.length - 1) result.issues.push(`${file}:${line}：字符串字面量后有多余内容`); break; } }
    if (!closed) result.issues.push(`${file}:${line}：字符串字面量缺少结束引号`);
    return result;
  }
  if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(text)) return result;
  if (/^[A-Za-z][A-Za-z0-9_-]*$/.test(text)) { result.references.push(text); return result; }
  if (/^[A-Za-z][A-Za-z0-9_-]*\s*\(/.test(text)) { result.issues.push(`${file}:${line}：不支持 Fluent 函数调用`); return result; }
  result.issues.push(`${file}:${line}：不支持的占位符：{ ${text} }`);
  return result;
}
function mergeAnalysis(target: Analysis, value: Analysis): void { for (const name of value.parameters) target.parameters.add(name); target.references.push(...value.references); target.issues.push(...value.issues); }

/** Parse the bounded Fluent subset used by game content. Attributes, functions,
 * term arguments and unknown placeables are reported instead of guessed. */
function analyzePattern(value: string, file: string, line: number, depth = 0): Analysis {
  const result: Analysis = { parameters: new Set(), references: [], issues: [] };
  if (depth > LOCALIZATION_BUDGETS.depth) { result.issues.push(`${file}:${line}：Fluent 占位符嵌套超过 ${LOCALIZATION_BUDGETS.depth}`); return result; }
  let index = 0;
  while (index < value.length) {
    const c = value[index];
    if (c === '}') { result.issues.push(`${file}:${line}：多余的右花括号`); index++; continue; }
    if (c !== '{') { index++; continue; }
    const innerStart = ++index; let quoted = false, escaped = false, nested = 0;
    while (index < value.length) {
      const next = value[index];
      if (escaped) { escaped = false; index++; continue; }
      if (quoted && next === '\\') { escaped = true; index++; continue; }
      if (next === '"') { quoted = !quoted; index++; continue; }
      if (!quoted) {
        if (next === '{') { nested++; index++; continue; }
        if (next === '}') { if (nested) { nested--; index++; continue; } break; }
      }
      index++;
    }
    if (index >= value.length) { result.issues.push(`${file}:${line}：占位符缺少右花括号`); return result; }
    const inner = value.slice(innerStart, index); index++;
    const arrow = findSelectArrow(inner);
    if (arrow === undefined) { mergeAnalysis(result, analyzeInline(inner, depth + 1, file, line)); continue; }
    const selector = inner.slice(0, arrow).trim(), variants = inner.slice(arrow + 2);
    mergeAnalysis(result, analyzeInline(selector, depth + 1, file, line));
    const matches = [...variants.matchAll(/(\*?)\s*\[([^\]]*)\]\s*/g)];
    if (!matches.length) { result.issues.push(`${file}:${line}：select 缺少变体`); continue; }
    if (!matches.some(match => match[1] === '*')) result.issues.push(`${file}:${line}：select 缺少 * 默认变体`);
    if (matches.filter(match => match[1] === '*').length > 1) result.issues.push(`${file}:${line}：select 只能有一个 * 默认变体`);
    for (let at = 0; at < matches.length; at++) {
      const match = matches[at], from = match.index! + match[0].length, to = at + 1 < matches.length ? matches[at + 1].index! : variants.length;
      mergeAnalysis(result, analyzePattern(variants.slice(from, to), file, line, depth + 1));
    }
  }
  if (result.references.length > LOCALIZATION_BUDGETS.references) result.issues.push(`${file}:${line}：Fluent 引用超过预算`);
  return result;
}
function findSelectArrow(value: string): number | undefined {
  let quoted = false, escaped = false, depth = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (escaped) { escaped = false; continue; }
    if (quoted && c === '\\') { escaped = true; continue; }
    if (c === '"') { quoted = !quoted; continue; }
    if (quoted) continue;
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (depth === 0 && c === '-' && value[i + 1] === '>') return i;
  }
  return undefined;
}
function dedentValue(first: string, continuation: { text: string }[]): string {
  const values = continuation.map(line => line.text);
  const indents = values.filter(text => text.trim()).map(text => text.match(/^[ \t]*/)![0].length);
  const common = indents.length ? Math.min(...indents) : 0;
  return [first.trim(), ...values.map(text => text.slice(common).trimEnd())].join('\n').replace(/\s+$/, '');
}
export function parseFtl(file: string, source: string): FtlParseResult {
  const result: FtlParseResult = { entries: [], issues: [] };
  const lines = sourceLines(source), seen = new Set<string>();
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.text.trim() || line.text.trimStart().startsWith('#')) { index++; continue; }
    const match = /^(-?[A-Za-z][A-Za-z0-9_-]*)[ \t]*=[ \t]*(.*)$/.exec(line.text);
    if (!match) { result.issues.push({ file, line: index + 1, message: '无法识别的 Fluent 行', severity: 'error' }); index++; continue; }
    const term = match[1].startsWith('-'), id = match[1];
    const start = line.start, valueStart = line.start + line.text.length - match[2].length;
    const continuation: { text: string }[] = [];
    let last = index, cursor = index + 1, attribute = false;
    while (cursor < lines.length) {
      const next = lines[cursor];
      if (!next.text.trim()) break;
      if (!/^[ \t]/.test(next.text)) break;
      if (next.text.trimStart().startsWith('.')) { attribute = true; result.issues.push({ file, line: cursor + 1, message: 'v0.10.1 不支持 Fluent 属性导出/引用', severity: 'error' }); }
      else continuation.push({ text: next.text });
      last = cursor; cursor++;
    }
    const value = dedentValue(match[2], continuation);
    const valueEnd = lines[last].end;
    const entry: FtlEntry = { id, term, value, file, line: index + 1, start, end: valueEnd, valueStart, valueEnd, parameters: [], references: [] };
    const analysis = analyzePattern(value, file, entry.line);
    entry.parameters = [...analysis.parameters]; entry.references = analysis.references;
    for (const issue of analysis.issues) result.issues.push({ file, line: entry.line, message: issue, severity: 'error' });
    if (seen.has(id)) result.issues.push({ file, line: entry.line, message: `重复 Fluent ID：${id}`, severity: 'error' }); else seen.add(id);
    if (id.length > 128) result.issues.push({ file, line: entry.line, message: `Fluent ID 超过 128 字节：${id}`, severity: 'error' });
    if (attribute || !value) result.issues.push({ file, line: entry.line, message: `Fluent 消息缺少正文：${id}`, severity: 'error' });
    result.entries.push(entry);
    index = last + 1;
  }
  if (result.entries.length > LOCALIZATION_BUDGETS.entries) result.issues.push({ file, line: 1, message: `Fluent 条目超过 ${LOCALIZATION_BUDGETS.entries}`, severity: 'error' });
  return result;
}
export function messageMap(locale: LocalizationTextLocale): Map<string, FtlEntry> {
  const map = new Map<string, FtlEntry>();
  for (const file of locale.messages) for (const entry of file.entries) if (!map.has(entry.id)) map.set(entry.id, entry);
  return map;
}
export function catalogMessages(catalog: LocalizationCatalog, localeId?: string): Map<string, FtlEntry> {
  const locale = catalog.texts.find(item => item.id === localeId) ?? catalog.texts.find(item => item.id === catalog.defaultText);
  return locale ? messageMap(locale) : new Map();
}
export function messageFor(catalog: LocalizationCatalog, localeId: string | undefined, key: string): { entry: FtlEntry; locale: string; fallback: boolean } | undefined {
  const locale = catalog.texts.find(item => item.id === localeId), fallback = catalog.texts.find(item => item.id === catalog.defaultText);
  const own = locale ? messageMap(locale).get(key) : undefined;
  if (own) return { entry: own, locale: locale!.id, fallback: false };
  const base = fallback ? messageMap(fallback).get(key) : undefined;
  return base ? { entry: base, locale: fallback!.id, fallback: locale !== undefined && locale.id !== fallback!.id } : undefined;
}
export function messageParameters(catalog: LocalizationCatalog, localeId: string, key: string, stack: string[] = [], budget = { remaining: LOCALIZATION_BUDGETS.output as number }): string[] {
  if (--budget.remaining < 0) throw new Error('Fluent 引用展开超过预算');
  const found = messageFor(catalog, localeId, key);
  if (!found) throw new Error(`缺少消息：${key}`);
  if (stack.includes(key) || stack.length > LOCALIZATION_BUDGETS.depth) throw new Error(`Fluent 引用循环或过深：${[...stack, key].join(' → ')}`);
  const parameters = new Set(found.entry.parameters);
  const locale = catalog.texts.find(item => item.id === found.locale)!;
  const messages = messageMap(locale);
  for (const reference of found.entry.references) {
    if (!messages.has(reference)) throw new Error(`消息 ${key} 引用了不存在的 ${reference}`);
    for (const parameter of messageParameters(catalog, found.locale, reference, [...stack, key], budget)) parameters.add(parameter);
  }
  return [...parameters].sort();
}
export function formatFtlValue(catalog: LocalizationCatalog, localeId: string | undefined, key: string, args: Record<string, string | number> = {}, stack: string[] = []): string {
  const found = messageFor(catalog, localeId, key);
  if (!found) throw new Error(`缺少消息：${key}`);
  if (stack.includes(key) || stack.length > LOCALIZATION_BUDGETS.depth) throw new Error(`Fluent 引用循环：${[...stack, key].join(' → ')}`);
  const locale = catalog.texts.find(item => item.id === found.locale)!;
  return formatPattern(catalog, locale, found.entry.value, args, [...stack, key], { remaining: LOCALIZATION_BUDGETS.output });
}
interface FormatBudget { remaining: number }
function formatPattern(catalog: LocalizationCatalog, locale: LocalizationTextLocale, pattern: string, args: Record<string, string | number>, stack: string[], budget: FormatBudget): string {
  if (stack.length > LOCALIZATION_BUDGETS.depth || --budget.remaining < 0) throw new Error('Fluent 引用展开超过预算');
  let output = '', index = 0;
  while (index < pattern.length) {
    const c = pattern[index];
    if (c !== '{') { output += c; index++; continue; }
    const start = ++index; let quoted = false, escaped = false, nested = 0;
    while (index < pattern.length) {
      const next = pattern[index];
      if (escaped) { escaped = false; index++; continue; }
      if (quoted && next === '\\') { escaped = true; index++; continue; }
      if (next === '"') { quoted = !quoted; index++; continue; }
      if (!quoted) { if (next === '{') { nested++; index++; continue; } if (next === '}') { if (nested) { nested--; index++; continue; } break; } }
      index++;
    }
    const inner = pattern.slice(start, index); index++;
    const arrow = findSelectArrow(inner);
    if (arrow === undefined) { output += formatInline(catalog, locale, inner, args, stack, budget); if (new TextEncoder().encode(output).length > LOCALIZATION_BUDGETS.output) throw new Error('Fluent 输出超过 64KiB'); continue; }
    const selector = inner.slice(0, arrow).trim(), variants = inner.slice(arrow + 2);
    const value = String(formatInline(catalog, locale, selector, args, stack, budget));
    const raw = selector.startsWith('$') ? args[selector.slice(1)] : /^-?(0|[1-9]\d*)(\.\d+)?$/.test(selector) ? Number(selector) : undefined;
    const numeric = typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
    const matches = [...variants.matchAll(/(\*?)\s*\[([^\]]*)\]\s*/g)];
    let chosen = matches.find(match => /^-?(0|[1-9]\d*)(\.\d+)?$/.test(match[2]) ? numeric !== undefined && Number(match[2]) === numeric : match[2] === value);
    if (!chosen) {
      if (numeric !== undefined) {
        const category = new Intl.PluralRules(locale.id).select(numeric);
        chosen = matches.find(match => match[2] === category);
      }
    }
    chosen = chosen ?? matches.find(match => match[1] === '*');
    if (!chosen) { output += pattern.slice(start, index); continue; }
    const at = matches.indexOf(chosen), from = chosen.index! + chosen[0].length, to = at + 1 < matches.length ? matches[at + 1].index! : variants.length;
    output += formatPattern(catalog, locale, variants.slice(from, to).trimEnd(), args, stack, budget);
    if (new TextEncoder().encode(output).length > LOCALIZATION_BUDGETS.output) throw new Error('Fluent 输出超过 64KiB');
  }
  if (new TextEncoder().encode(output).length > LOCALIZATION_BUDGETS.output) throw new Error('Fluent 输出超过 64KiB');
  return output;
}
function formatInline(catalog: LocalizationCatalog, locale: LocalizationTextLocale, value: string, args: Record<string, string | number>, stack: string[], budget: FormatBudget): string {
  const text = value.trim();
  if (text.startsWith('$')) {
    const name = text.slice(1); if (!Object.hasOwn(args, name)) throw new Error(`消息缺少参数：${name}`);
    return String(args[name]);
  }
  if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(text)) return text;
  if (text.startsWith('-') || /^[A-Za-z][A-Za-z0-9_-]*$/.test(text)) {
    if (stack.includes(text)) throw new Error(`Fluent 引用循环：${[...stack, text].join(' → ')}`);
    const entry = messageMap(locale).get(text);
    if (!entry) throw new Error(`引用了不存在的消息：${text}`);
    return formatPattern(catalog, locale, entry.value, args, [...stack, text], budget);
  }
  if (text.startsWith('"')) return fluentString(text);
  return text;
}
/** Selected-locale value for a no-argument message used in static content. */
export function localizedStatic(catalog: LocalizationCatalog | undefined, key: string, localeId?: string): string {
  if (!catalog || !catalog.enabled) throw new Error(`未开启本地化，不能使用消息 key：${key}`);
  const value = formatFtlValue(catalog, localeId, key, {});
  if (!value.trim()) throw new Error(`消息 ${key} 在 ${localeId ?? catalog.defaultText} 中为空`);
  return value;
}
export function emptyLocalization(): LocalizationCatalog { return { ...EMPTY_LOCALIZATION, texts: [], voices: [] }; }
