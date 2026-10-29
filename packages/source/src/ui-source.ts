import { randomUUID } from 'node:crypto';
import { parse } from 'acorn';
import type { Sources } from './index';
import { appendGroup, readStory } from './index';
import { child, escapeXmlAttribute as escapeXml, parseXml, setAttribute, type XmlNode } from './xml';
import { uiFragments, type UiFragment } from './ui-files';
import { UI_ATTRIBUTES, UI_CONTAINERS, UI_KINDS, uiNodes, type UiDesign, type UiEdit, type UiEvent, type UiEventCommand, type UiGalleryEntry, type UiKind, type UiNode, type UiScreen } from '../../domain/src/ui';
import { readUiMedia, editUiMedia } from './ui-media';
import { i64 } from '../../domain/src/index';
import { analyzeLogic } from './logic';
import { readLifecycle, editLifecycle } from './lifecycle';

type Ast = Record<string, any>;
const lifecyclePrefixes = ['frame.enter:', 'frame.exit:', 'screen.open:', 'screen.close:'];
const reservedLifecycle = (name: string) => lifecyclePrefixes.some(prefix => name.startsWith(prefix));
function walkJs(n: Ast, visit: (node: Ast) => void): void {
  const stack = [n]; let budget = 100000;
  while (stack.length) { if (!--budget) throw new Error('UI 脚本节点超过预算'); const node = stack.pop()!; visit(node); for (const [key, value] of Object.entries(node)) if (!['loc', 'start', 'end'].includes(key)) { if (Array.isArray(value)) stack.push(...value.filter(v => v?.type)); else if (value?.type) stack.push(value); } }
}
function scriptAst(sources: Sources): { file: string; ast: Ast }[] { return readStory(sources).scripts.map(file => ({ file, ast: parse(sources.get(file) ?? '', { ecmaVersion: 2022, locations: true }) as Ast })); }
const uiCommandNames: UiEventCommand[] = ['open', 'close', 'advance', 'restart', 'choose', 'setting', 'sequence', 'playSound', 'soundEnabled', 'soundActor', 'soundExclude', 'present', 'resume', 'unlock'];
const eventSettings = ['text_speed', 'auto_delay', 'bgm_volume', 'voice_volume', 'se_volume', 'video_volume', 'muted', 'autosave', 'skip_all', 'fullscreen'];
const ctxMember = (n: Ast | undefined, ctx: string): string | undefined => n?.type === 'MemberExpression' && !n.optional && n.object?.name === ctx ? n.computed ? typeof n.property?.value === 'string' ? n.property.value : undefined : n.property?.name : undefined;
function literalArg(n: Ast | undefined): string | undefined { return n?.type === 'Literal' && typeof n.value === 'string' ? n.value : undefined; }
function eventCall(n: Ast, ctx: string): { command: UiEventCommand; target?: string; page?: string } | undefined {
  if (n?.type !== 'ExpressionStatement' || n.expression?.type !== 'CallExpression') return;
  const call = n.expression, method = ctxMember(call.callee, ctx); if (!method) return;
  if (call.arguments.length > 2) return;
  const first = literalArg(call.arguments[0]), second = call.arguments[1];
  const valueArg = (arg: Ast | undefined) => ctxMember(arg, ctx) === 'value';
  if (method === 'open') { if (call.arguments.length !== 1 || first === undefined) return; return { command: 'open', target: first }; }
  if (['close', 'advance'].includes(method)) { if (call.arguments.length) return; return { command: method as UiEventCommand }; }
  if (method === 'restart') { if (!call.arguments.length) return { command: 'restart' }; if (call.arguments.length === 1 && first !== undefined) return { command: 'restart', target: first }; return; }
  if (method === 'choose') { const arg = call.arguments[0]; if (call.arguments.length !== 1 || arg?.type !== 'MemberExpression' || arg.object?.type !== 'MemberExpression' || arg.object.object?.name !== ctx || arg.object.property?.name !== 'item' || arg.property?.name !== 'id') return; return { command: 'choose' }; }
  if (method === 'soundEnabled') { if (call.arguments.length !== 1 || !valueArg(call.arguments[0])) return; return { command: 'soundEnabled' }; }
  if (method === 'soundActor' || method === 'soundExclude') { if (call.arguments.length !== 2 || first === undefined || !valueArg(second)) return; return { command: method, target: first }; }
  if (method === 'sequence' || method === 'playSound' || method === 'present') { if (call.arguments.length !== 1 || first === undefined) return; return { command: method, target: first }; }
  if (method === 'setting') { if (call.arguments.length !== 2 || first === undefined || !valueArg(second)) return; return { command: 'setting', target: first }; }
  if (method === 'resume') { if (call.arguments.length > 1 || call.arguments.length === 1 && first === undefined) return; return { command: 'resume', ...(first === undefined ? {} : { target: first }) }; }
  if (method === 'unlock') {
    if (call.arguments.length !== 1) return;
    if (first !== undefined) return { command: 'unlock', target: first };
    const arg = call.arguments[0];
    if (arg?.type === 'MemberExpression' && !arg.computed && arg.property?.name === 'cgId' && arg.object?.type === 'MemberExpression' && arg.object.object?.name === ctx && arg.object.property?.name === 'game') return { command: 'unlock' };
    return;
  }
}
function readEventCallback(c: Ast): { command: UiEventCommand; target?: string; page?: string } | undefined {
  if (c.arguments.length !== 2) return;
  const cb = c.arguments[1];
  if (!cb || !['ArrowFunctionExpression', 'FunctionExpression'].includes(cb.type) || cb.async || cb.generator || cb.params.length !== 1 || cb.params[0].type !== 'Identifier') return;
  const ctx = cb.params[0].name;
  const statements = cb.body.type === 'BlockStatement' ? cb.body.body : [{ type: 'ExpressionStatement', expression: cb.body }];
  if (statements.length < 1 || statements.length > 2) return;
  const calls = statements.map((s: Ast) => eventCall(s, ctx));
  if (calls.some((x: any) => !x)) return;
  if (calls.length === 1) return calls[0];
  // The visual resume/restart events may open a screen first; keep both calls in order.
  if (calls[0].command !== 'open' || !['resume', 'restart'].includes(calls[1].command)) return;
  return { ...calls[1], page: calls[0].target };
}
function uiEvents(sources: Sources, warnings: string[]): UiEvent[] {
  const events: UiEvent[] = [];
  try { for (const { file, ast } of scriptAst(sources)) {
    const constants = new Map<string, string>();
    for (const n of ast.body) if (n.type === 'VariableDeclaration' && n.kind === 'const') for (const d of n.declarations) if (d.id.type === 'Identifier' && typeof d.init?.value === 'string') constants.set(d.id.name, d.init.value);
    walkJs(ast, n => {
      if (n.type === 'CallExpression' && n.callee?.type === 'MemberExpression' && !n.callee.optional && (n.callee.computed ? n.callee.property.value : n.callee.property.name) === 'skipVideo') warnings.push(`${file}：v0.9.0 已移除 ctx.skipVideo；视频改用 UI 演出 sequence`);
    });
    for (const n of ast.body) {
      const c = n.expression; if (c?.type !== 'CallExpression' || c.callee?.object?.name !== 'on' || (c.callee.computed ? c.callee.property.value : c.callee.property.name) !== 'ui') continue;
      const name = typeof c.arguments[0]?.value === 'string' ? c.arguments[0].value : constants.get(c.arguments[0]?.name);
      if (name && name !== 'game.enter') {
        if (reservedLifecycle(name)) { warnings.push(`${file}：${name} 是 v0.9.0 保留生命周期事件，不能作为节点 event`); continue; }
        const shaped = typeof c.arguments[0]?.value === 'string' ? readEventCallback(c) : undefined;
        const event: UiEvent = { name, file, line: n.loc.start.line, start: n.start, end: n.end, editable: !!shaped, ...(shaped ?? {}) };
        if (!shaped) event.reason = typeof c.arguments[0]?.value !== 'string' ? '事件名由常量或表达式提供，保留源码' : '回调包含自定义逻辑或多条动作，保留源码';
        else if (/\/\/|\/\*/.test(sources.get(file)!.slice(n.start, n.end))) { event.editable = false; event.reason = '回调内包含注释，保留源码'; }
        events.push(event);
      } else if (!name) warnings.push(`${file}：动态事件名需使用源码查看`);
    }
  } } catch (e) { warnings.push(`UI 事件解析失败：${e instanceof Error ? e.message : '语法错误'}`); }
  const counts = new Map<string, number>(); for (const e of events) counts.set(e.name, (counts.get(e.name) ?? 0) + 1);
  for (const e of events) if ((counts.get(e.name) ?? 0) > 1) { e.editable = false; e.reason = '存在重复事件名，保留源码'; }
  return events;
}
function error(file: string, n: XmlNode, message: string): never { throw new Error(`${file}：${n.attrs.id ?? n.tag} ${message}`); }
function checkAttrs(file: string, n: XmlNode, names: string[]): void { if (n.text.trim() || Object.keys(n.attrs).some(k => !names.includes(k))) error(file, n, '包含未知属性或正文'); }
function numeric(file: string, n: XmlNode, key: string, fallback?: number): number {
  const value = n.attrs[key] === undefined ? fallback : Number(n.attrs[key]);
  if (value === undefined || !Number.isFinite(value) || !Number.isFinite(Math.fround(value)) || n.attrs[key]?.trim() === '') error(file, n, `${key} 需要有限数值`);
  return value;
}
export function readUiDesign(sources: Sources): UiDesign {
  const fragments = uiFragments(sources), byFile = new Map(fragments.map(f => [f.file, f])), entry = fragments[0];
  const result: UiDesign = { entry: entry.file, files: fragments.map(f => f.file), width: Number(entry.root.attrs.width ?? 1280), height: Number(entry.root.attrs.height ?? 720), initial: entry.root.attrs.initial, attrs: entry.root.attrs, screens: [], variables: [], gallery: [], events: [], warnings: [] };
  if (![result.width, result.height].every(Number.isFinite) || result.width < 640 || result.height < 360 || Math.abs(result.width * 9 - result.height * 16) > .1) throw new Error('UI 画布需要至少 640×360 的 16:9 尺寸');
  const ids = new Set<string>(), screens = new Set<string>(), vars = new Set<string>(), gallery = new Set<string>(); let count = 0;
  function nodes(items: XmlNode[], fragment: UiFragment, depth: number, repeat = false): UiNode[] {
    return items.map(n => {
      if (depth > 8 || ++count > 1024) error(fragment.file, n, '超过 UI 深度 8 / 节点 1024 预算');
      if (!(UI_KINDS as readonly string[]).includes(n.tag)) error(fragment.file, n, '不是支持的 UI 控件');
      checkAttrs(fragment.file, n, ['id', ...UI_ATTRIBUTES[n.tag as UiKind]]);
      if (!n.attrs.id || ids.has(n.attrs.id)) error(fragment.file, n, '控件 ID 为空或全局重复'); ids.add(n.attrs.id);
      if (numeric(fragment.file, n, 'width') <= 0 || numeric(fragment.file, n, 'height') <= 0) error(fragment.file, n, '宽高必须大于零');
      numeric(fragment.file, n, 'x', 0); numeric(fragment.file, n, 'y', 0);
      if (n.children.length && !UI_CONTAINERS.includes(n.tag)) error(fragment.file, n, '不能包含子控件');
      if (n.tag === 'repeat' && repeat) error(fragment.file, n, '不支持嵌套 repeat');
      return { id: n.attrs.id, kind: n.tag as UiKind, attrs: n.attrs, file: fragment.file, line: fragment.source.slice(0, n.start).split('\n').length, children: nodes(n.children, fragment, depth + 1, repeat || n.tag === 'repeat') };
    });
  }
  function expand(fragment: UiFragment): void {
    for (const n of fragment.root.children) {
      if (n.tag === 'include') { expand(byFile.get(n.attrs.src)!); continue; }
      if (n.tag === 'screen') {
        checkAttrs(fragment.file, n, ['id', 'modal', 'pause', 'background-click', 'background-right-click', 'sequence']);
        if (!n.attrs.id || screens.has(n.attrs.id)) error(fragment.file, n, '页面 ID 为空或重复'); screens.add(n.attrs.id);
        result.screens.push({ id: n.attrs.id, attrs: n.attrs, file: fragment.file, line: fragment.source.slice(0, n.start).split('\n').length, children: nodes(n.children, fragment, 1) });
      } else if (n.tag === 'variables') {
        checkAttrs(fragment.file, n, []);
        for (const v of n.children) {
          if (!['int', 'bool', 'string'].includes(v.tag) || !v.attrs.id || vars.has(v.attrs.id) || v.children.length) error(fragment.file, v, 'UI 变量类型或 ID 无效');
          checkAttrs(fragment.file, v, ['id', 'initial', 'min', 'max']); vars.add(v.attrs.id);
          if (v.attrs.initial === undefined) error(fragment.file, v, '变量缺少 initial');
          if (v.tag === 'int') { const initial = BigInt(i64(v.attrs.initial)); if (v.attrs.min !== undefined && initial < BigInt(i64(v.attrs.min)) || v.attrs.max !== undefined && initial > BigInt(i64(v.attrs.max))) error(fragment.file, v, '变量初始值超出范围'); }
          if (v.tag === 'bool' && !['true', 'false'].includes(v.attrs.initial)) error(fragment.file, v, '布尔值必须是 true/false');
          result.variables.push({ id: v.attrs.id, type: v.tag as 'int' | 'bool' | 'string', initial: v.attrs.initial, min: v.attrs.min, max: v.attrs.max, file: fragment.file, line: fragment.source.slice(0, v.start).split('\n').length });
        }
      } else if (n.tag === 'gallery') {
        checkAttrs(fragment.file, n, []);
        for (const cg of n.children) {
          if (cg.tag !== 'cg' || !cg.attrs.id || !cg.attrs.image || !cg.attrs.title || gallery.has(cg.attrs.id)) error(fragment.file, cg, 'CG 声明需要唯一 ID、image 和 title');
          checkAttrs(fragment.file, cg, ['id', 'image', 'title', 'unlocked']);
          if (cg.attrs.unlocked !== undefined && !['true', 'false'].includes(cg.attrs.unlocked)) error(fragment.file, cg, 'CG unlocked 必须是 true/false');
          gallery.add(cg.attrs.id);
          result.gallery.push({ id: cg.attrs.id, image: cg.attrs.image, title: cg.attrs.title, unlocked: cg.attrs.unlocked === 'true', file: fragment.file, line: fragment.source.slice(0, cg.start).split('\n').length });
        }
      }
    }
  }
  expand(entry);
  for (const screen of result.screens) for (const node of uiNodes(screen.children)) {
    const route = node.attrs.route;
    if (route !== undefined && (node.attrs.event !== undefined || route !== 'close' && (!route.startsWith('open:') || !screens.has(route.slice(5))))) error(node.file, { attrs: node.attrs } as XmlNode, '按钮导航需要合法目标且不能同时设置 event');
  }
  if (!result.screens.length || result.screens.length > 64 || result.variables.length > 128 || result.gallery.length > 256) throw new Error('UI 页面/变量/CG 超过引擎预算');
  const initial = result.screens.find(s => s.id === result.initial); if (!initial || initial.attrs.modal !== 'false') throw new Error('初始 UI 页面必须存在且 modal=false');
  // v0.9.0 removed frame video bindings; keep the old text visible as a source warning instead of silently previewing it.
  const removedVideoBinding = /^(?:not:)?game\.(?:videoPlaying|videoSkippable)$/;
  for (const screen of result.screens) for (const node of uiNodes(screen.children)) for (const key of ['bind', 'value', 'visible', 'enabled', 'image-bind', 'region-bind']) {
    const value = node.attrs[key];
    if (value && removedVideoBinding.test(value)) result.warnings.push(`${node.file}:${node.line}：${key} 引用了 v0.9.0 已移除的 ${value}`);
  }
  result.media = readUiMedia(sources);
  result.events = uiEvents(sources, result.warnings);
  const story = readStory(sources), screensById = new Set(result.screens.map(s => s.id));
  for (const entry of result.gallery) {
    const asset = story.assets.find(a => a.id === entry.image);
    if (!asset || !['image', 'cg'].includes(asset.kind)) throw new Error(`${entry.file}:${entry.line} 画廊图片资源不存在：${entry.image}`);
    const cgAsset = story.assets.find(a => a.id === entry.id && a.kind === 'cg');
    if (asset.kind === 'cg' && entry.id !== entry.image || cgAsset && entry.image !== entry.id) throw new Error(`${entry.file}:${entry.line} 专用 CG 画廊条目 ID 必须等于其资源 ID`);
  }
  const galleryIds = new Set(result.gallery.map(g => g.id));
  for (const asset of story.assets.filter(a => a.kind === 'cg')) if (!galleryIds.has(asset.id)) result.gallery.push({ id: asset.id, image: asset.id, title: asset.id, unlocked: false, implicit: true });
  result.gallery.sort((a, b) => a.id.localeCompare(b.id));
  if (result.gallery.length > 256) throw new Error('CG 画廊超过 256 项');
  const fail = (event: UiEvent, reason: string) => { event.editable = false; event.reason = reason; };
  const entryRefs = new Set(story.entries ?? [story.entry]);
  for (const event of result.events) {
    if (!event.editable || !event.command) continue;
    const command = event.command;
    if (command === 'open' || command === 'present') {
      if (!event.target || !screensById.has(event.target)) fail(event, '目标页面不存在');
    } else if (command === 'resume') {
      if (event.page && !screensById.has(event.page)) fail(event, '先打开的页面不存在');
      if (event.target) {
        const frame = story.frames.find(f => f.ref === event.target || f.id === event.target || f.name === event.target);
        if (!frame || frame.pending) fail(event, '起始或返回幕不存在，仍是待连接占位');
        else { event.target = frame.ref; if (!entryRefs.has(frame.ref)) event.reason = '该幕不是声明的起始幕；首次启动会被拒绝，剧情开始后可用于返回'; }
      }
    } else if (command === 'sequence') {
      if (!event.target || !result.media?.some(m => m.kind === 'sequence' && m.id === event.target)) fail(event, '演出序列不存在');
    } else if (command === 'playSound') {
      if (!event.target || !(result.media?.some(m => m.kind === 'sound' && m.id === event.target) || story.assets.some(a => a.kind === 'audio' && a.id === event.target))) fail(event, '音效不存在');
    } else if (command === 'soundActor') {
      if (!event.target || !story.characters.some(c => c.id === event.target)) fail(event, '人物不存在');
    } else if (command === 'soundExclude') {
      if (!event.target || !story.assets.some(a => a.kind === 'audio' && a.id === event.target)) fail(event, '音频素材不存在');
    } else if (command === 'restart') {
      if (event.page && !screensById.has(event.page)) event.reason = '先打开的页面不存在';
      if (event.target) {
        const frame = story.frames.find(f => f.ref === event.target || f.id === event.target || f.name === event.target);
        if (!frame || frame.pending || !entryRefs.has(frame.ref)) event.reason = '重新开始目标不是已声明的起始幕';
        else event.target = frame.ref;
      } else if (entryRefs.size > 1) event.reason = '多起始幕的重新开始动作必须指定起始幕';
    } else if (command === 'setting') {
      if (!event.target || !eventSettings.includes(event.target)) fail(event, '未知设置项');
    } else if (command === 'unlock') {
      if (event.target && !story.assets.some(a => a.id === event.target && a.kind === 'cg')) fail(event, 'CG 专用资源不存在');
    }
  }
  const logic = analyzeLogic(sources, story);
  result.warnings.push(...logic.screenIssues);
  result.lifecycle = readLifecycle(sources, logic);
  return result;
}
export function locateUi(sources: Sources, id: string, screen = false): { file: string; node: XmlNode } {
  const found: { file: string; node: XmlNode }[] = [];
  function walk(file: string, n: XmlNode): void { if ((screen ? n.tag === 'screen' : (UI_KINDS as readonly string[]).includes(n.tag)) && n.attrs.id === id) found.push({ file, node: n }); for (const c of n.children) walk(file, c); }
  for (const f of uiFragments(sources)) walk(f.file, f.root);
  if (found.length !== 1) throw new Error('UI 目标不存在或 ID 不唯一'); return found[0];
}
function append(source: string, n: XmlNode, markup: string, index?: number): string {
  if (source.slice(n.start, n.openEnd).endsWith('/>')) return source.slice(0, n.openEnd - 2) + `>\n${markup}\n</${n.tag}>` + source.slice(n.end);
  const at = index !== undefined && index < n.children.length ? n.children[index].start : n.closeStart;
  return source.slice(0, at) + `\n${markup}\n` + source.slice(at);
}
function patchAttrs(sources: Sources, id: string, patch: Record<string, string>, names: string[], screen = false): void {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(k => !names.includes(k)) || Object.values(patch).some(v => typeof v !== 'string' || v.length > 4096)) throw new Error('不支持的 UI 属性或属性值');
  for (const [key, value] of Object.entries(patch)) { const at = locateUi(sources, id, screen); if ((at.node.attrs[key] ?? '') !== value) sources.set(at.file, setAttribute(sources.get(at.file)!, at.node, key, value)); }
}
const str = (v: unknown, max = 256): string => { if (typeof v !== 'string' || v.length > max) throw new Error('UI 参数类型或长度错误'); return v; };
/** Source range edits only. The matching engine remains the final semantic validator. */
export function editUi(input: Sources, value: unknown): { changes: Sources; selected?: string; screen?: string } {
  const op = value as UiEdit; if (!op || typeof op !== 'object' || typeof op.action !== 'string') throw new Error('UI 操作无效');
  const design = readUiDesign(input), sources = new Map(input); let selected: string | undefined, screen: string | undefined;
  if (op.action === 'lifecycle') { for (const [file, text] of editLifecycle(input, op)) sources.set(file, text); }
  else if (op.action === 'media') { for (const [file,text] of editUiMedia(input, op.item)) sources.set(file,text); }
  else if (op.action === 'patchNode') { const at = locateUi(sources, str(op.id)); patchAttrs(sources, op.id, op.patch, UI_ATTRIBUTES[at.node.tag as UiKind]); selected = op.id; }
  else if (op.action === 'patchScreen') { patchAttrs(sources, str(op.id), op.patch, ['modal', 'pause', 'background-click', 'background-right-click', 'sequence'], true); screen = op.id; }
  else if (op.action === 'patchRoot') {
    if (!op.patch || typeof op.patch !== 'object' || Object.keys(op.patch).some(k => !['width', 'height', 'initial'].includes(k))) throw new Error('不支持的 UI 入口属性');
    let source = sources.get(design.entry)!;
    for (const [key, raw] of Object.entries(op.patch)) { const v = str(raw); if (parseXml(source).attrs[key] !== v) source = setAttribute(source, parseXml(source), key, v); }
    sources.set(design.entry, source);
  } else if (op.action === 'addScreen') {
    if (!design.files.includes(str(op.file))) throw new Error('只能添加到已加载的 UI 文件');
    const id = op.name ? str(op.name) : `screen.${randomUUID()}`;
    if (!id.trim() || /\s/.test(id) || design.screens.some(s => s.id === id)) throw new Error('页面标识为空、含空白或重复');
    sources.set(op.file, append(sources.get(op.file)!, parseXml(sources.get(op.file)!), `<screen id="${escapeXml(id)}" modal="true" pause="true" />`)); screen = id;
  } else if (op.action === 'deleteScreen') {
    const id = str(op.id); if (id === design.initial) throw new Error('请先设置另一个非模态初始页面');
    if (design.screens.some(s => uiNodes(s.children).some(n => n.attrs.route === `open:${id}`))) throw new Error('仍有按钮导航到此页面，请先修改按钮目标');
    for (const { ast } of scriptAst(sources)) walkJs(ast, n => {
      if (n.type !== 'CallExpression' || n.callee?.type !== 'MemberExpression') return;
      const callee = n.callee.computed ? n.callee.property.value : n.callee.property.name, arg = n.arguments[0];
      if (n.callee.object?.name === 'on' && ['screenOpen', 'screenClose'].includes(callee) && (arg?.type !== 'Literal' || arg.value === id)) throw new Error('仍有 on.screenOpen/on.screenClose 生命周期注册引用此页面，请先在源码中处理');
      if (['open', 'present'].includes(callee) && (arg?.type !== 'Literal' || arg.value === id)) throw new Error('脚本可能打开或交接此页面，请先在源码中处理相关事件');
    });
    const at = locateUi(sources, id, true); sources.set(at.file, sources.get(at.file)!.slice(0, at.node.start) + sources.get(at.file)!.slice(at.node.end)); screen = design.initial;
  } else if (op.action === 'addNode') {
    const kind = str(op.kind) as UiKind; if (!(UI_KINDS as readonly string[]).includes(kind)) throw new Error('未知 UI 控件类型');
    const page = design.screens.find(s => s.id === str(op.screen)); if (!page) throw new Error('页面不存在'); screen = page.id;
    const at = op.parent ? locateUi(sources, str(op.parent)) : locateUi(sources, page.id, true);
    if (op.parent && (!uiNodes(page.children).some(n => n.id === op.parent) || !UI_CONTAINERS.includes(at.node.tag))) throw new Error('请选择当前页面中的容器作为父级');
    const attrs: Record<string, string> = { id: `control.${randomUUID()}`, x: '24', y: '24', width: kind === 'scene' ? String(design.width) : '240', height: kind === 'scene' ? String(design.height) : kind === 'panel' || kind === 'repeat' || kind === 'nine-patch' ? '160' : '48' };
    if (['label', 'button', 'toggle'].includes(kind)) attrs.text = kind === 'label' ? '新的文字' : kind === 'button' ? '按钮' : '开关';
    if (kind === 'panel') attrs.color = '#263B4B';
    if (['image', 'nine-patch'].includes(kind)) { const asset = readStory(sources).assets.find(a => a.id === op.image && a.kind === (kind === 'nine-patch' ? 'nine-patch' : 'image')); if (!asset) throw new Error('请先选择已导入的对应图片资源'); attrs.image = asset.id; }
    if (['button', 'toggle', 'slider'].includes(kind)) { if (!design.events.some(e => e.name === op.event)) throw new Error('请先选择已注册事件或新建事件'); attrs.event = op.event!; }
    if (kind === 'slider') Object.assign(attrs, { value: 'settings.bgm_volume', min: '0', max: '1' });
    if (kind === 'toggle') attrs.value = 'settings.muted';
    if (kind === 'repeat') Object.assign(attrs, { source: 'choices', 'item-width': '220', 'item-height': '48', gap: '8' });
    sources.set(at.file, append(sources.get(at.file)!, at.node, `<${kind} ${Object.entries(attrs).map(([k, v]) => `${k}="${escapeXml(v)}"`).join(' ')} />`)); selected = attrs.id;
  } else if (op.action === 'deleteNode' || op.action === 'duplicateNode') {
    const at = locateUi(sources, str(op.id)), source = sources.get(at.file)!;
    if (op.action === 'deleteNode') { sources.set(at.file, source.slice(0, at.node.start) + source.slice(at.node.end)); }
    else {
      let markup = source.slice(at.node.start, at.node.end); const ids = uiNodes([design.screens.flatMap(s => uiNodes(s.children)).find(n => n.id === op.id)!]).map(n => n.id);
      for (const id of ids) { const local: XmlNode[] = []; const find = (n: XmlNode) => { if (n.attrs.id === id) local.push(n); n.children.forEach(find); }; find(parseXml(markup)); const fresh = `control.${randomUUID()}`; markup = setAttribute(markup, local[0], 'id', fresh); if (id === op.id) selected = fresh; }
      sources.set(at.file, source.slice(0, at.node.end) + '\n' + markup + source.slice(at.node.end));
    }
  } else if (op.action === 'moveNode') {
    const at = locateUi(sources, str(op.id)), page = design.screens.find(s => s.id === str(op.screen)); if (!page) throw new Error('目标页面不存在');
    const moving = design.screens.flatMap(s => uiNodes(s.children)).find(n => n.id === op.id)!;
    if (op.parent && (uiNodes([moving]).some(n => n.id === op.parent) || !uiNodes(page.children).some(n => n.id === op.parent))) throw new Error('不能移动到自身/子控件或其他页面的容器');
    if (!Number.isInteger(op.index) || op.index < 0 || op.index > 1024) throw new Error('控件顺序无效');
    const markup = sources.get(at.file)!.slice(at.node.start, at.node.end); sources.set(at.file, sources.get(at.file)!.slice(0, at.node.start) + sources.get(at.file)!.slice(at.node.end));
    const target = op.parent ? locateUi(sources, str(op.parent)) : locateUi(sources, page.id, true);
    if (op.parent && !UI_CONTAINERS.includes(target.node.tag)) throw new Error('目标不是容器');
    sources.set(target.file, append(sources.get(target.file)!, target.node, markup, op.index)); selected = op.id; screen = page.id;
  } else if (op.action === 'variable') {
    const variable = op.id ? design.variables.find(v => v.id === str(op.id)) : undefined;
    if (op.id && !variable) throw new Error('UI 变量不存在');
    const file = variable?.file ?? str(op.file); if (!design.files.includes(file) || !['int', 'bool', 'string'].includes(op.type)) throw new Error('UI 变量文件或类型错误');
    if (variable && variable.type !== op.type) throw new Error('不能改变既有 UI 变量类型');
    const id = variable?.id ?? str(op.name); if (!id.trim() || /\s/.test(id) || design.variables.some(v => v.id === id && v !== variable)) throw new Error('变量名为空、含空白或重复');
    const attrs: Record<string, string> = { id, initial: str(op.initial, 4096), ...(op.min ? { min: str(op.min) } : {}), ...(op.max ? { max: str(op.max) } : {}) };
    let source = sources.get(file)!;
    if (variable) {
      if ('min' in op) attrs.min = op.min ?? ''; if ('max' in op) attrs.max = op.max ?? '';
      for (const [key, value] of Object.entries(attrs).filter(([key]) => key !== 'id')) { const v = child(parseXml(source), 'variables')!.children.find(n => n.attrs.id === id)!; if (v.attrs[key] !== value) source = setAttribute(source, v, key, value, key !== 'initial'); }
    }
    else { const markup = `<${op.type} ${Object.entries(attrs).map(([k, v]) => `${k}="${escapeXml(v)}"`).join(' ')} />`; const group = child(parseXml(source), 'variables'); source = group ? append(source, group, markup) : append(source, parseXml(source), `<variables>${markup}</variables>`); }
    sources.set(file, source);
  } else if (op.action === 'event') {
    const name = str(op.name, 128);
    if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(name) || name === 'game.enter' || reservedLifecycle(name)) throw new Error('事件名须唯一且由英文、数字、点、下划线或连字符组成，不能使用保留生命周期名');
    const original = typeof op.original === 'string' && op.original ? str(op.original, 128) : undefined;
    if (design.events.some(e => e.name === name && e.name !== original)) throw new Error('事件名已存在');
    const matches = original ? design.events.filter(e => e.name === original) : [];
    if (original && matches.length !== 1) throw new Error(matches.length ? '存在重复事件名，请先处理源码' : '要修改的事件已不存在，请刷新');
    if (original && !matches[0].editable) throw new Error(matches[0].reason ?? '该事件由自定义逻辑维护，不能可视化修改');
    const beforePage = typeof op.page === 'string' && op.page ? str(op.page) : undefined;
    if (beforePage !== undefined && !['resume', 'restart'].includes(op.command)) throw new Error('只有开始/恢复剧情或重新开始可以指定先打开页面');
    let body: string;
    if (op.command === 'open') { if (!design.screens.some(s => s.id === op.target)) throw new Error('请选择目标页面'); body = `ctx.open(${JSON.stringify(op.target)});`; }
    else if (['close', 'advance'].includes(op.command)) body = `ctx.${op.command}();`;
    else if (op.command === 'choose') body = 'ctx.choose(ctx.item.id);';
    else if (['soundEnabled', 'soundActor', 'soundExclude'].includes(op.command)) { const story = readStory(sources); if (op.command === 'soundActor' && !story.characters.some(c => c.id === op.target) || op.command === 'soundExclude' && !story.assets.some(a => a.kind === 'audio' && a.id === op.target)) throw new Error('人物或音频素材不存在'); body = `ctx.${op.command}(${op.command === 'soundEnabled' ? '' : JSON.stringify(op.target) + ', '}ctx.value);`; }
    else if (op.command === 'sequence' || op.command === 'playSound') { const exists = design.media?.some(m => m.kind === (op.command === 'sequence' ? 'sequence' : 'sound') && m.id === op.target) || op.command === 'playSound' && readStory(sources).assets.some(a => a.kind === 'audio' && a.id === op.target); if (!exists) throw new Error('演出或音效不存在'); body = `ctx.${op.command}(${JSON.stringify(op.target)});`; }
    else if (op.command === 'present') { if (!design.screens.some(s => s.id === op.target)) throw new Error('请选择要交接的 UI 页面'); body = `ctx.present(${JSON.stringify(op.target)});`; }
    else if (op.command === 'resume') {
      const target = typeof op.target === 'string' && op.target ? str(op.target) : undefined;
      if (beforePage && !design.screens.some(s => s.id === beforePage)) throw new Error('先打开的 UI 页面不存在');
      const open = beforePage ? `ctx.open(${JSON.stringify(beforePage)}); ` : '';
      if (target) {
        const frame = readStory(sources).frames.find(f => f.ref === target || f.id === target || f.name === target);
        if (!frame || frame.pending) throw new Error('起始或返回幕不存在，仍是待连接占位');
        body = `${open}ctx.resume(${JSON.stringify(frame.ref)});`;
      } else body = `${open}ctx.resume();`;
    }
    else if (op.command === 'restart') {
      const target = typeof op.target === 'string' && op.target ? str(op.target) : undefined, story = readStory(sources);
      const page = typeof op.page === 'string' && op.page ? str(op.page) : undefined;
      if (page && !design.screens.some(s => s.id === page)) throw new Error('先打开的页面不存在');
      if (target) {
        const frame = story.frames.find(f => f.ref === target || f.id === target || f.name === target);
        if (!frame || frame.pending || !(story.entries ?? [story.entry]).includes(frame.ref)) throw new Error('重新开始目标必须是已声明的起始幕');
        body = `${page ? `ctx.open(${JSON.stringify(page)}); ` : ''}ctx.restart(${JSON.stringify(frame.ref)});`;
      } else {
        if ((story.entries ?? [story.entry]).length > 1) throw new Error('多起始幕的重新开始动作必须指定起始幕');
        body = `${page ? `ctx.open(${JSON.stringify(page)}); ` : ''}ctx.restart();`;
      }
    }
    else if (op.command === 'setting') { if (!['text_speed', 'auto_delay', 'bgm_volume', 'voice_volume', 'se_volume', 'video_volume', 'muted', 'autosave', 'skip_all', 'fullscreen'].includes(op.target ?? '')) throw new Error('未知设置项'); body = `ctx.setting(${JSON.stringify(op.target)}, ctx.value);`; }
    else if (op.command === 'unlock') {
      const target = typeof op.target === 'string' && op.target ? str(op.target) : undefined;
      if (target && !readStory(sources).assets.some(a => a.id === target && a.kind === 'cg')) throw new Error('CG 专用资源不存在');
      body = target ? `ctx.unlock(${JSON.stringify(target)});` : 'ctx.unlock(ctx.game.cgId);';
    }
    else throw new Error('不支持的事件动作');
    if (original) {
      const event = matches[0], source = sources.get(event.file)!;
      sources.set(event.file, source.slice(0, event.start) + `on.ui(${JSON.stringify(name)}, (ctx) => { ${body} });` + source.slice(event.end));
      if (name !== original) for (const s of design.screens) {
        for (const node of uiNodes(s.children)) if (node.attrs.event === original) patchAttrs(sources, node.id, { event: name }, ['event']);
        for (const key of ['background-click', 'background-right-click'] as const) if (s.attrs[key] === original) patchAttrs(sources, s.id, { [key]: name }, [key], true);
      }
    } else {
      const file = readStory(sources).scripts.at(-1); if (!file || !sources.has(file)) throw new Error('缺少可追加的已声明脚本');
      sources.set(file, sources.get(file)! + `\non.ui(${JSON.stringify(name)}, (ctx) => { ${body} });\n`);
    }
  } else if (op.action === 'deleteEvent') {
    const name = str(op.name, 128), matches = design.events.filter(e => e.name === name);
    if (matches.length !== 1) throw new Error(matches.length ? '存在重复事件名，请先处理源码' : '要删除的事件已不存在，请刷新');
    const event = matches[0];
    if (!event.editable) throw new Error(event.reason ?? '该事件由自定义逻辑维护，不能删除');
    if (design.screens.some(s => uiNodes(s.children).some(n => n.attrs.event === name) || s.attrs['background-click'] === name || s.attrs['background-right-click'] === name)) throw new Error('仍有控件或页面背景引用此事件，请先把相关事件改为其他动作');
    const source = sources.get(event.file)!;
    let start = event.start, end = event.end;
    if (source.slice(end, end + 2) === '\r\n') end += 2; else if (source[end] === '\n') end += 1;
    else if (start >= 2 && source.slice(start - 2, start) === '\r\n') start -= 2;
    else if (start >= 1 && source[start - 1] === '\n') start -= 1;
    sources.set(event.file, source.slice(0, start) + source.slice(end));
  } else if (op.action === 'gallery') {
    const id = str(op.id, 128), image = str(op.image, 256), title = str(op.title, 1024);
    if (!id.trim() || !image || !title.trim()) throw new Error('画廊条目需要 ID、图片和标题');
    if (typeof op.unlocked !== 'boolean') throw new Error('画廊解锁初值无效');
    const story = readStory(sources), asset = story.assets.find(a => a.id === image);
    if (!asset || !['image', 'cg'].includes(asset.kind)) throw new Error('画廊图片资源不存在');
    if (asset.kind === 'cg' && id !== image) throw new Error('专用 CG 的画廊 ID 必须等于资源 ID');
    const original = typeof op.original === 'string' && op.original ? str(op.original, 128) : undefined;
    if (design.gallery.some(g => g.id === id && !g.implicit && (!original || g.id !== original))) throw new Error('画廊 ID 已存在');
    const previous = original ? design.gallery.find(g => g.id === original && !g.implicit) : undefined;
    if (original && !previous) throw new Error('要修改的画廊条目已不存在或只是自动 CG');
    const markup = `<cg id="${escapeXml(id)}" image="${escapeXml(image)}" title="${escapeXml(title)}" unlocked="${op.unlocked ? 'true' : 'false'}" />`;
    if (previous) {
      const xml = sources.get(previous.file!)!, group = child(parseXml(xml), 'gallery');
      const node = group?.children.find(n => n.attrs.id === original);
      if (!group || !node) throw new Error('画廊条目源码已改变，请刷新');
      let next = xml;
      for (const [key, value] of [['image', image], ['title', title], ['unlocked', op.unlocked ? 'true' : 'false'], ['id', id]] as const) {
        const at = child(parseXml(next), 'gallery')?.children.find(n => n.attrs.id === original);
        if (!at) break;
        next = setAttribute(next, at, key, value);
      }
      sources.set(previous.file!, next);
    } else {
      const fragment = uiFragments(sources).find(f => f.root.children.some(n => n.tag === 'gallery')) ?? uiFragments(sources).find(f => f.file === design.entry);
      if (!fragment) throw new Error('缺少可写的 UI 入口文件');
      sources.set(fragment.file, appendGroup(fragment.source, 'gallery', markup));
    }
  } else if (op.action === 'deleteGallery') {
    const id = str(op.id, 128), entry = design.gallery.find(g => g.id === id && !g.implicit);
    if (!entry) throw new Error('只能删除 UI XML 中显式声明的画廊条目');
    const xml = sources.get(entry.file!)!, group = child(parseXml(xml), 'gallery'), node = group?.children.find(n => n.attrs.id === id);
    if (!node) throw new Error('画廊条目源码已改变，请刷新');
    sources.set(entry.file!, xml.slice(0, node.start) + xml.slice(node.end));
  } else throw new Error('不支持的 UI 编辑操作');
  readUiDesign(sources);
  return { changes: new Map([...sources].filter(([file, text]) => input.get(file) !== text)), selected, screen };
}
