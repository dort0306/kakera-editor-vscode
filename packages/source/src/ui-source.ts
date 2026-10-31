import { parse } from 'acorn';
import type { Sources } from './index';
import { appendGroup, newShortId, readStory } from './index';
import { child, escapeXmlAttribute as escapeXml, parseXml, setAttribute, type XmlNode } from './xml';
import { uiFragments, type UiFragment } from './ui-files';
import { UI_ATTRIBUTES, UI_COMPONENT_ATTRIBUTES, UI_CONTAINERS, UI_KINDS, UI_BUILTIN_COMPONENTS, UI_REPEAT_METADATA, UI_PARTICLES, UI_PARTICLE_ACTIONS, uiNodes, type UiBinding, type UiDesign, type UiEdit, type UiEvent, type UiEventCommand, type UiGalleryEntry, type UiKind, type UiNode, type UiNodeKind, type UiPaletteSlot, type UiParticleAction, type UiScreen, type UiComponentProp, type UiBuiltinComponent } from '../../domain/src/ui';
import { COMPONENT_LAYOUT_ATTRIBUTES, BUILTIN_COMPONENTS_SOURCE, componentList, readComponents } from './ui-components';
import { readUiMedia, editUiMedia } from './ui-media';
import { canonicalLocaleId, formatFtlValue } from '../../domain/src/localization';
import { i64 } from '../../domain/src/index';
import { normalizeColor, parseColor } from '../../domain/src/colors';
import { isShortcutAction, normalizeShortcutBinding } from '../../domain/src/shortcuts';
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
const uiCommandNames: UiEventCommand[] = ['open', 'close', 'advance', 'restart', 'choose', 'setting', 'setUi', 'sequence', 'playSound', 'soundEnabled', 'soundActor', 'soundExclude', 'present', 'resume', 'unlock', 'captureShortcut', 'cancelShortcutCapture', 'keybinding', 'resetKeybindings', 'colorPreference', 'resetColors', 'quit', 'locale', 'particles'];
const eventSettings = ['text_speed', 'auto_delay', 'master_volume', 'bgm_volume', 'voice_volume', 'se_volume', 'video_volume', 'muted', 'autosave', 'skip_all', 'fullscreen'];
const ctxMember = (n: Ast | undefined, ctx: string): string | undefined => n?.type === 'MemberExpression' && !n.optional && n.object?.name === ctx ? n.computed ? typeof n.property?.value === 'string' ? n.property.value : undefined : n.property?.name : undefined;
function literalArg(n: Ast | undefined): string | undefined { return n?.type === 'Literal' && typeof n.value === 'string' ? n.value : undefined; }
function nullableLiteralArg(n: Ast | undefined): string | null | undefined { return n?.type === 'Literal' && (typeof n.value === 'string' || n.value === null) ? n.value : undefined; }
/** Reads `ctx.ui.name` or `ctx.ui["name"]` without evaluating scripts. */
function uiVariableArg(n: Ast | undefined, ctx: string): string | undefined {
  if (n?.type !== 'MemberExpression' || n.optional || ctxMember(n.object, ctx) !== 'ui') return undefined;
  if (n.computed) return n.property?.type === 'Literal' && typeof n.property.value === 'string' ? n.property.value : undefined;
  return typeof n.property?.name === 'string' ? n.property.name : undefined;
}
/** Emits dot access for ASCII identifiers and bracket access for other declared IDs. */
function uiVariableAccess(id: string): string { return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(id) ? `ctx.ui.${id}` : `ctx.ui[${JSON.stringify(id)}]`; }
type EventShape = { command: UiEventCommand; commandTarget?: string; page?: string; action?: string; resultEvent?: string; binding?: string | null; slot?: string; color?: string | null; colorVariable?: string; channel?: 'text' | 'voice'; locale?: string | null; particleAction?: UiParticleAction };
/** `ctx.particles("发射器").start()/stop()/clear()/burst()` (engine §39.3). */
function particleCommand(call: Ast, ctx: string): EventShape | undefined {
  if (call.arguments.length !== 0 || call.optional) return;
  const callee = call.callee;
  if (callee?.type !== 'MemberExpression' || callee.optional || callee.computed) return;
  const action = callee.property?.name;
  if (!(UI_PARTICLE_ACTIONS as readonly string[]).includes(action)) return;
  const handle = callee.object;
  if (handle?.type !== 'CallExpression' || handle.optional || handle.arguments.length !== 1) return;
  const factory = handle.callee;
  if (factory?.type !== 'MemberExpression' || factory.optional || factory.computed) return;
  if (factory.object?.type !== 'Identifier' || factory.object.name !== ctx || factory.property?.name !== 'particles') return;
  const id = literalArg(handle.arguments[0]);
  if (!id) return;
  return { command: 'particles', commandTarget: id, particleAction: action as UiParticleAction };
}
function eventCall(n: Ast, ctx: string): EventShape | undefined {
  if (n?.type !== 'ExpressionStatement' || n.expression?.type !== 'CallExpression') return;
  const call = n.expression;
  const particle = particleCommand(call, ctx); if (particle) return particle;
  const method = ctxMember(call.callee, ctx); if (!method) return;
  if (call.arguments.length > 2) return;
  const first = literalArg(call.arguments[0]), second = call.arguments[1];
  const valueArg = (arg: Ast | undefined) => ctxMember(arg, ctx) === 'value';
  if (method === 'open') { if (call.arguments.length !== 1 || first === undefined) return; return { command: 'open', commandTarget: first }; }
  if (['close', 'advance', 'cancelShortcutCapture', 'resetKeybindings', 'resetColors', 'quit'].includes(method)) { if (call.arguments.length) return; return { command: method as UiEventCommand }; }
  if (method === 'restart') { if (!call.arguments.length) return { command: 'restart' }; if (call.arguments.length === 1 && first !== undefined) return { command: 'restart', commandTarget: first }; return; }
  if (method === 'choose') { const arg = call.arguments[0]; if (call.arguments.length !== 1 || arg?.type !== 'MemberExpression' || arg.object?.type !== 'MemberExpression' || arg.object.object?.name !== ctx || arg.object.property?.name !== 'item' || arg.property?.name !== 'id') return; return { command: 'choose' }; }
  if (method === 'soundEnabled') { if (call.arguments.length !== 1 || !valueArg(call.arguments[0])) return; return { command: 'soundEnabled' }; }
  if (method === 'soundActor' || method === 'soundExclude') { if (call.arguments.length !== 2 || first === undefined || !valueArg(second)) return; return { command: method as UiEventCommand, commandTarget: first }; }
  if (method === 'sequence' || method === 'playSound' || method === 'present') { if (call.arguments.length !== 1 || first === undefined) return; return { command: method as UiEventCommand, commandTarget: first }; }
  if (method === 'setting') { if (call.arguments.length !== 2 || first === undefined || !valueArg(second)) return; return { command: 'setting', commandTarget: first }; }
  if (method === 'setUi') { if (call.arguments.length !== 2 || first === undefined || !valueArg(second)) return; return { command: 'setUi', commandTarget: first }; }
  if (method === 'captureShortcut') { if (call.arguments.length !== 2 || first === undefined) return; const resultEvent = literalArg(second); if (!resultEvent) return; return { command: 'captureShortcut', action: first, resultEvent }; }
  if (method === 'keybinding') { if (call.arguments.length !== 2 || first === undefined) return; const binding = nullableLiteralArg(second); if (binding === undefined) return; return { command: 'keybinding', action: first, binding }; }
  if (method === 'colorPreference') {
    if (call.arguments.length !== 2 || first === undefined) return;
    const color = nullableLiteralArg(second);
    if (color !== undefined) return { command: 'colorPreference', slot: first, color };
    const colorVariable = uiVariableArg(second, ctx);
    if (colorVariable !== undefined) return { command: 'colorPreference', slot: first, colorVariable };
    return;
  }
  if (method === 'locale') { if (call.arguments.length !== 2 || (first !== 'text' && first !== 'voice')) return; const locale = nullableLiteralArg(second); if (locale === undefined) return; return { command: 'locale', channel: first, locale }; }
  if (method === 'resume') { if (call.arguments.length > 1 || call.arguments.length === 1 && first === undefined) return; return { command: 'resume', ...(first === undefined ? {} : { commandTarget: first }) }; }
  if (method === 'unlock') {
    if (call.arguments.length !== 1) return;
    if (first !== undefined) return { command: 'unlock', commandTarget: first };
    const arg = call.arguments[0];
    if (arg?.type === 'MemberExpression' && !arg.computed && arg.property?.name === 'cgId' && arg.object?.type === 'MemberExpression' && arg.object.object?.name === ctx && arg.object.property?.name === 'game') return { command: 'unlock' };
    return;
  }
}
function readEventCallback(c: Ast): EventShape | undefined {
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
const lifecycleEvent = (name: string) => name === 'screen.open' || name === 'screen.close';
/** Controls whose XML `event`/`ui(id).bind(id)` may attach an ordinary event. */
const interactiveKinds = new Set(['button', 'slider', 'toggle', 'color-picker']);
function jsParents(ast: Ast): Map<Ast, Ast> {
  const parents = new Map<Ast, Ast>();
  walkJs(ast, n => {
    for (const [key, value] of Object.entries(n)) {
      if (['loc', 'start', 'end'].includes(key)) continue;
      if (Array.isArray(value)) { for (const child of value) if (child?.type) parents.set(child, n); }
      else if (value?.type) parents.set(value, n);
    }
  });
  return parents;
}
/** v0.11.1 registration: `event.register(id, callback)` defines an independent
 * event; XML `event`/background attributes and single-argument
 * `ui(id).bind(eventId)` attach it. Two-argument ordinary bind is the removed
 * v0.11.0 form: diagnose it and never guess or rewrite it. */
function uiEvents(sources: Sources, warnings: string[]): { events: UiEvent[]; bindings: UiBinding[]; uncertain: boolean } {
  const events: UiEvent[] = [], bindings: UiBinding[] = [];
  let uncertain = false;
  const warn = (message: string) => warnings.push(message);
  try { for (const { file, ast } of scriptAst(sources)) {
    walkJs(ast, n => {
      if (n.type === 'CallExpression' && n.callee?.type === 'MemberExpression' && !n.callee.optional) {
        const method = n.callee.computed ? n.callee.property.value : n.callee.property.name;
        if (method === 'skipVideo') warnings.push(`${file}：v0.9.0 已移除 ctx.skipVideo；视频改用 UI 演出 sequence`);
        // v0.11.0 removed on.* without aliases; point authors at the migration section.
        if (n.callee.object?.type === 'Identifier' && n.callee.object.name === 'on' && ['advance', 'choice', 'end', 'ui', 'frameEnter', 'frameExit', 'screenOpen', 'screenClose'].includes(method)) {
          warnings.push(`${file}:${n.loc.start.line}：旧 on.${method} 注册已被 v0.11.0 移除；请改用 frame() 与 event.register 注册（上游 API 第 37.4 节）`);
          uncertain = true;
        }
      }
    });
    // `event` is a non-writable global entry. Saving, aliasing or replacing it
    // makes the definition list unprovable; report it instead of guessing.
    const parents = jsParents(ast);
    const topCall = new Set(ast.body.filter((s: Ast) => s.type === 'ExpressionStatement').map((s: Ast) => s.expression));
    for (const statement of ast.body) if ((statement.type === 'VariableDeclaration' && statement.declarations.some((declaration: Ast) => declaration.id?.type === 'Identifier' && declaration.id.name === 'event')) || (['FunctionDeclaration', 'ClassDeclaration'].includes(statement.type) && statement.id?.name === 'event')) { warn(`${file}：event 是保留全局入口，不能声明或重定义`); uncertain = true; }
    walkJs(ast, n => {
      if (n.type !== 'Identifier' || n.name !== 'event') return;
      const parent = parents.get(n);
      if (parent?.type === 'MemberExpression' && parent.object === n) {
        const call = parents.get(parent), method = parent.computed ? parent.property?.value : parent.property?.name;
        if (method === 'register' && call?.type === 'CallExpression' && call.callee === parent) {
          if (!topCall.has(call)) { warn(`${file}:${n.loc.start.line}：event.register 不在顶层，事件列表可能不完整`); uncertain = true; }
          return;
        }
        warn(`${file}:${n.loc.start.line}：event 只有 register 方法，其他访问无法静态解析`); uncertain = true; return;
      }
      if (parent?.type === 'MemberExpression' && parent.property === n && !parent.computed) return;
      if (parent?.type === 'Property' && parent.key === n && !parent.computed) return;
      if (parent?.type === 'VariableDeclarator' && parent.id === n) return;
      if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ClassDeclaration', 'ClassExpression', 'AssignmentPattern', 'RestElement'].includes(parent?.type ?? '')) return;
      warn(`${file}:${n.loc.start.line}：event 被保存、传递或以动态方式使用，事件列表可能不完整`); uncertain = true;
    });
    for (const n of ast.body) {
      const c = n.expression; if (n.type !== 'ExpressionStatement' || c?.type !== 'CallExpression' || c.optional) continue;
      if (c.callee?.type !== 'MemberExpression' || c.callee.optional) continue;
      const method = c.callee.computed ? c.callee.property?.value : c.callee.property?.name;
      const object = c.callee.object;
      if (method === 'register' && object?.type === 'Identifier' && object.name === 'event') {
        const name = c.arguments[0]?.type === 'Literal' && typeof c.arguments[0].value === 'string' ? c.arguments[0].value : undefined;
        if (name === undefined) { warn(`${file}:${n.loc.start.line}：event.register 的事件 ID 是动态表达式，事件列表可能不完整`); uncertain = true; continue; }
        if (c.arguments.length !== 2) { warn(`${file}:${n.loc.start.line}：event.register(${name}) 需要恰好一个回调`); uncertain = true; continue; }
        if (prefixLifecycle(name)) {
          warn(`${file}:${n.loc.start.line}：${name} 是保留生命周期或全局事件名，不能用 event.register 注册；播放器会拒绝`);
          events.push({ name, kind: 'event', file, line: n.loc.start.line, start: n.start, end: n.end, editable: false, reason: '保留生命周期或全局事件名，不能用 event.register 注册' });
          continue;
        }
        const shaped = readEventCallback(c);
        const event: UiEvent = { name, kind: 'event', file, line: n.loc.start.line, start: n.start, end: n.end, editable: !!shaped, ...(shaped ?? {}) };
        if (!shaped) event.reason = '回调包含自定义逻辑或多条动作，保留源码';
        else if (/\/\/|\/\*/.test(sources.get(file)!.slice(n.start, n.end))) { event.editable = false; event.reason = '回调内包含注释，保留源码'; }
        events.push(event);
        continue;
      }
      if (method !== 'bind') continue;
      const selector = object;
      if (selector?.type !== 'CallExpression' || selector.optional || selector.callee?.type !== 'Identifier' || selector.callee.name !== 'ui' || selector.arguments.length !== 1) {
        // A saved selector or an unsupported call shape: report it instead of guessing.
        if (selector?.type === 'Identifier' || selector?.type === 'CallExpression' && selector.callee?.name === 'ui') warn(`${file}:${n.loc.start.line}：存在无法静态解析的 ui(...).bind 注册，事件列表可能不完整`);
        uncertain = true; continue;
      }
      const target = selector.arguments[0]?.type === 'Literal' && typeof selector.arguments[0].value === 'string' ? selector.arguments[0].value : undefined;
      const name = c.arguments[0]?.type === 'Literal' && typeof c.arguments[0].value === 'string' ? c.arguments[0].value : undefined;
      if (target === undefined || name === undefined) {
        warn(`${file}:${n.loc.start.line}：ui(target).bind 的目标或事件名是动态表达式，事件列表可能不完整`);
        uncertain = true; continue;
      }
      if (lifecycleEvent(name)) continue;
      if (target === '$game') {
        if (name !== 'game.enter') { warn(`${file}:${n.loc.start.line}：$game 只接受 game.enter，已忽略 ${name}`); continue; }
        if (c.arguments.length !== 2) { warn(`${file}:${n.loc.start.line}：game.enter 需要恰好一个回调`); uncertain = true; continue; }
        const shaped = readEventCallback(c);
        const event: UiEvent = { name, kind: 'game', file, line: n.loc.start.line, start: n.start, end: n.end, editable: !!shaped, ...(shaped ?? {}) };
        if (!shaped) event.reason = '回调包含自定义逻辑或多条动作，保留源码';
        events.push(event);
        continue;
      }
      if (prefixLifecycle(name)) { warn(`${file}:${n.loc.start.line}：${name} 是保留名称，不能绑定到控件或页面`); uncertain = true; continue; }
      if (target === '$host') {
        warn(`${file}:${n.loc.start.line}：v0.11.1 已删除 $host 绑定；请改用 event.register("${name}", 回调)，结果事件不需要控件`);
        bindings.push({ target, name, kind: 'legacy', file, line: n.loc.start.line, start: n.start, end: n.end, editable: false, reason: '$host 绑定已在 v0.11.1 删除' });
        uncertain = true; continue;
      }
      if (c.arguments.length === 1) {
        bindings.push({ target, name, kind: 'script', file, line: n.loc.start.line, start: n.start, end: n.end, editable: true });
      } else if (c.arguments.length === 2) {
        warn(`${file}:${n.loc.start.line}：普通 ui("${target}").bind("${name}", 回调) 已在 v0.11.1 移除；请改为 event.register("${name}", 回调) 后再 ui("${target}").bind("${name}")（上游 API 第 37.2–37.4 节）`);
        bindings.push({ target, name, kind: 'legacy', file, line: n.loc.start.line, start: n.start, end: n.end, editable: false, reason: 'v0.11.0 两参数回调已移除，保留源码' });
        uncertain = true;
      } else { warn(`${file}:${n.loc.start.line}：${name} 的 bind 参数无效`); uncertain = true; }
    }
  } } catch (e) { warnings.push(`UI 事件解析失败：${e instanceof Error ? e.message : '语法错误'}`); uncertain = true; }
  const counts = new Map<string, number>(); for (const e of events) counts.set(e.name, (counts.get(e.name) ?? 0) + 1);
  for (const e of events) if ((counts.get(e.name) ?? 0) > 1) { e.editable = false; e.reason = '同名事件存在重复定义，保留源码'; }
  return { events, bindings, uncertain };
}
/** XML `event`/background references are bindings too, including empty-free values. */
function xmlEventBindings(design: Pick<UiDesign, 'screens'>): UiBinding[] {
  const bindings: UiBinding[] = [];
  for (const screen of design.screens) {
    for (const key of ['background-click', 'background-right-click'] as const) {
      const name = screen.attrs[key];
      if (name) bindings.push({ target: screen.id, name, kind: 'xml', file: screen.file, line: screen.line });
    }
    for (const node of uiNodes(screen.children)) if (node.attrs.event) bindings.push({ target: node.id, name: node.attrs.event, kind: 'xml', file: node.file, line: node.line });
  }
  return bindings;
}
const virtualTargets = new Set(['$game', '$host']);
function prefixLifecycle(name: string): boolean { return reservedLifecycle(name) || ['game.enter', 'screen.open', 'screen.close'].includes(name); }

function error(file: string, n: XmlNode, message: string): never { throw new Error(`${file}：${n.attrs.id ?? n.tag} ${message}`); }
function checkAttrs(file: string, n: XmlNode, names: string[]): void { if (n.text.trim() || Object.keys(n.attrs).some(k => !names.includes(k))) error(file, n, '包含未知属性或正文'); }
function numeric(file: string, n: XmlNode, key: string, fallback?: number): number {
  const value = n.attrs[key] === undefined ? fallback : Number(n.attrs[key]);
  if (value === undefined || !Number.isFinite(value) || !Number.isFinite(Math.fround(value)) || n.attrs[key]?.trim() === '') error(file, n, `${key} 需要有限数值`);
  return value;
}
export function readUiDesign(sources: Sources): UiDesign {
  const fragments = uiFragments(sources), byFile = new Map(fragments.map(f => [f.file, f])), entry = fragments[0];
  const story = readStory(sources), catalog = story.localization;
  const result: UiDesign = { entry: entry.file, files: fragments.map(f => f.file), width: Number(entry.root.attrs.width ?? 1280), height: Number(entry.root.attrs.height ?? 720), initial: entry.root.attrs.initial, attrs: entry.root.attrs, screens: [], variables: [], palette: [], gallery: [], events: [], bindings: [], warnings: [], localizationUsages: [] };
  if (![result.width, result.height].every(Number.isFinite) || result.width < 640 || result.height < 360 || Math.abs(result.width * 9 - result.height * 16) > .1) throw new Error('UI 画布需要至少 640×360 的 16:9 尺寸');
  const ids = new Set<string>(), screens = new Set<string>(), vars = new Map<string, { type: 'int' | 'bool' | 'string'; initial: string }>(), palette = new Set<string>(), gallery = new Set<string>(); let count = 0, pickers = 0;
  // v0.11.2 composition tags: registrations come from `component.register` in the declared scripts.
  const componentInfo = readComponents(sources), componentByName = new Map(componentInfo.components.map(component => [component.name, component]));
  result.components = componentInfo.components;
  if (componentInfo.uncertain) result.componentUncertain = true;
  result.warnings.push(...componentInfo.warnings);
  const engineIds = new Set<string>(), pageRepeats = new Map<string, string>(), componentEvents: UiBinding[] = [];
  const line = (fragment: UiFragment, node: XmlNode) => fragment.source.slice(0, node.start).split('\n').length;
  const localized = (key: string): string => { if (!catalog?.enabled) return key; try { return formatFtlValue(catalog, undefined, key, {}); } catch { return key; } };
  const validArgumentBind = (path: string): boolean => {
    if (path.startsWith('ui.')) { const variable = vars.get(path.slice(3)); return !!variable; }
    if (['cg.total', 'cg.unlocked', 'saves.page', 'saves.pages'].includes(path)) return true;
    return ['locale.text', 'locale.voice'].includes(path);
  };
  function textArguments(fragment: UiFragment, node: XmlNode): { args: { name: string; value?: string; bind?: string }[]; names: string[] } {
    const args: { name: string; value?: string; bind?: string }[] = [], names: string[] = [];
    for (const childNode of node.children) {
      if (childNode.tag !== 'text-arg') continue;
      if (childNode.children.length || childNode.text.trim()) error(fragment.file, childNode, 'text-arg 不能包含子节点或正文');
      if (Object.keys(childNode.attrs).some(key => !['name', 'value', 'bind'].includes(key))) error(fragment.file, childNode, 'text-arg 只能使用 name/value/bind');
      const name = childNode.attrs.name ?? '';
      if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(name)) error(fragment.file, childNode, 'text-arg name 必须以英文字母开头，且只包含英文、数字、下划线或连字符');
      if (names.includes(name)) error(fragment.file, childNode, `text-arg name 重复：${name}`);
      const hasValue = childNode.attrs.value !== undefined, hasBind = childNode.attrs.bind !== undefined;
      if (hasValue === hasBind) error(fragment.file, childNode, 'text-arg 需要 value 或 bind 二选一');
      if (hasBind && !validArgumentBind(childNode.attrs.bind)) error(fragment.file, childNode, `text-arg bind 需要 UI 标量、cg 或 saves 标量：${childNode.attrs.bind}`);
      if (args.length >= 16) error(fragment.file, childNode, 'text-arg 最多 16 个');
      names.push(name); args.push({ name, ...(hasValue ? { value: childNode.attrs.value } : { bind: childNode.attrs.bind }) });
    }
    return { args, names };
  }
  function readLocalizedText(fragment: UiFragment, node: XmlNode): UiNode['localized'] {
    if (!['label', 'button', 'toggle'].includes(node.tag)) return undefined;
    const sources = ['text', 'bind', 'text-key', 'text-key-bind'].filter(key => node.attrs[key] !== undefined);
    if (sources.length > 1) error(fragment.file, node, '文字、文字绑定、text-key 与 text-key-bind 只能四选一');
    const key = node.attrs['text-key'], keyBind = node.attrs['text-key-bind'];
    const args = textArguments(fragment, node);
    if (!key && !keyBind && args.args.length) error(fragment.file, node, '只有 text-key/text-key-bind 控件可以使用 text-arg');
    if (key !== undefined) {
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(key)) error(fragment.file, node, 'text-key 格式无效');
      result.localizationUsages!.push({ key, file: fragment.file, line: line(fragment, node), label: `UI 控件 ${node.attrs.id} 文字`, arguments: args.names });
    }
    if (keyBind !== undefined) {
      if (!keyBind.startsWith('ui.') || vars.get(keyBind.slice(3))?.type !== 'string') error(fragment.file, node, 'text-key-bind 必须引用已声明的 UI string');
      result.localizationUsages!.push({ key: '', file: fragment.file, line: line(fragment, node), label: `UI 控件 ${node.attrs.id} 动态文字`, arguments: args.names, dynamic: true });
    }
    return key !== undefined ? { key, args: args.args } : keyBind !== undefined ? { keyBound: true, args: args.args } : args.args.length ? { args: args.args } : undefined;
  }
  function groups(fragment: UiFragment): void {
    for (const n of fragment.root.children) {
      if (n.tag === 'include') { groups(byFile.get(n.attrs.src)!); continue; }
      if (n.tag === 'variables') {
        checkAttrs(fragment.file, n, []);
        for (const v of n.children) {
          if (!['int', 'bool', 'string'].includes(v.tag) || !v.attrs.id || vars.has(v.attrs.id) || v.children.length) error(fragment.file, v, 'UI 变量类型或 ID 无效');
          checkAttrs(fragment.file, v, ['id', 'initial', 'min', 'max']); vars.set(v.attrs.id, { type: v.tag as 'int' | 'bool' | 'string', initial: v.attrs.initial ?? '' });
          if (v.attrs.initial === undefined) error(fragment.file, v, '变量缺少 initial');
          if (v.tag === 'int') { const initial = BigInt(i64(v.attrs.initial)); if (v.attrs.min !== undefined && initial < BigInt(i64(v.attrs.min)) || v.attrs.max !== undefined && initial > BigInt(i64(v.attrs.max))) error(fragment.file, v, '变量初始值超出范围'); }
          if (v.tag === 'bool' && !['true', 'false'].includes(v.attrs.initial)) error(fragment.file, v, '布尔值必须是 true/false');
          result.variables.push({ id: v.attrs.id, type: v.tag as 'int' | 'bool' | 'string', initial: v.attrs.initial, min: v.attrs.min, max: v.attrs.max, file: fragment.file, line: line(fragment, v) });
        }
      } else if (n.tag === 'palette') {
        checkAttrs(fragment.file, n, []);
        for (const slot of n.children) {
          if (slot.tag !== 'color' || !slot.attrs.id || !slot.attrs.initial || palette.has(slot.attrs.id) || slot.children.length) error(fragment.file, slot, '配色槽位需要唯一 ID、initial 且不能有子节点');
          checkAttrs(fragment.file, slot, ['id', 'initial']);
          if (!/^[a-z][a-z0-9_]{0,63}$/.test(slot.attrs.id)) error(fragment.file, slot, '配色槽位 ID 必须为 [a-z][a-z0-9_]{0,63}');
          try { parseColor(slot.attrs.initial); } catch (e) { error(fragment.file, slot, `配色初值非法：${e instanceof Error ? e.message : '格式错误'}`); }
          palette.add(slot.attrs.id);
          result.palette.push({ id: slot.attrs.id, initial: slot.attrs.initial, file: fragment.file, line: line(fragment, slot) });
        }
      } else if (n.tag === 'gallery') {
        checkAttrs(fragment.file, n, []);
        for (const cg of n.children) {
          const titleKey = cg.attrs['title-key'];
          if (cg.tag !== 'cg' || !cg.attrs.id || !cg.attrs.image || (!cg.attrs.title && !titleKey) || (cg.attrs.title !== undefined && titleKey !== undefined) || gallery.has(cg.attrs.id)) error(fragment.file, cg, 'CG 声明需要唯一 ID、image 和 title/title-key');
          checkAttrs(fragment.file, cg, ['id', 'image', 'title', 'title-key', 'unlocked']);
          if (titleKey !== undefined) {
            if (!/^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(titleKey)) error(fragment.file, cg, '画廊 title-key 格式无效');
            result.localizationUsages!.push({ key: titleKey, file: fragment.file, line: line(fragment, cg), label: `画廊 ${cg.attrs.id} 标题` });
          }
          if (cg.attrs.unlocked !== undefined && !['true', 'false'].includes(cg.attrs.unlocked)) error(fragment.file, cg, 'CG unlocked 必须是 true/false');
          gallery.add(cg.attrs.id);
          const title = titleKey !== undefined ? localized(titleKey) : cg.attrs.title;
          result.gallery.push({ id: cg.attrs.id, image: cg.attrs.image, title, unlocked: cg.attrs.unlocked === 'true', file: fragment.file, line: line(fragment, cg), ...(titleKey !== undefined ? { titleKey } : {}) });
        }
      }
    }
  }
  groups(entry);
  if (result.variables.length > 128 || result.palette.length > 32 || result.gallery.length > 256) throw new Error('UI 变量/配色槽位/CG 超过引擎预算');
  /** Validates one declared composition-tag property value (engine §38.2 conversion rules). */
  function componentPropValue(fragment: UiFragment, n: XmlNode, tag: string, key: string, prop: UiComponentProp, value: string): void {
    function fail(message: string): never { return error(fragment.file, n, `组合标签 ${tag} 的属性 ${key} ${message}`); }
    if (prop.type === 'bool') { if (!['true', 'false'].includes(value)) fail('必须是 true/false'); return; }
    if (prop.type === 'int') {
      let parsed: bigint;
      try { parsed = BigInt(i64(value)); } catch { fail('必须是 64 位整数'); }
      if (prop.min !== undefined && parsed < BigInt(i64(prop.min)) || prop.max !== undefined && parsed > BigInt(i64(prop.max))) fail('超出声明范围');
      return;
    }
    if (prop.type === 'number') { if (!Number.isFinite(Number(value)) || !value.trim()) fail('必须是数字'); return; }
    if (prop.type === 'string') { if (value.length > (prop.maxLength ?? 32768)) fail(`超过长度上限 ${prop.maxLength ?? 32768}`); return; }
    if (prop.type === 'event') { if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(value)) fail('必须是事件 ID'); return; }
    const path = value.startsWith('not:') ? value.slice(4) : value;
    if (!path) fail('需要绑定路径');
    if (prop.valueType && path.startsWith('ui.')) {
      const variable = vars.get(path.slice(3));
      if (!variable) fail(`引用了未声明的 UI 变量 ${path}`);
      const ok = variable.type === prop.valueType || prop.valueType === 'number' && variable.type === 'int';
      if (!ok) fail(`需要 UI ${prop.valueType} 变量`);
    }
  }
  /** v0.11.3 `<particles>`: strict ranges and range ordering mirror engine §39.2. */
  function particleEmitter(fragment: UiFragment, n: XmlNode): void {
    if (!n.attrs.image) error(fragment.file, n, 'particles 需要 image 纹理');
    if (!story.assets.some(asset => asset.id === n.attrs.image && (asset.kind === 'image' || asset.kind === 'cg'))) error(fragment.file, n, `particles 的 image 必须是已声明的图片或 CG 资源：${n.attrs.image}`);
    const numericText = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
    const scalar = (key: string, min: number, max: number, fallback: number): number => {
      const raw = n.attrs[key];
      if (raw === undefined) return fallback;
      const value = numericText.test(raw) ? Number(raw) : NaN;
      if (!Number.isFinite(value) || value < min || value > max) error(fragment.file, n, `${key} 需要 ${min}–${max} 范围内的有限数值`);
      return value;
    };
    const countOf = (key: string, max: number, fallback: number): number => {
      const raw = n.attrs[key];
      if (raw === undefined) return fallback;
      if (!/^\d+$/.test(raw) || Number(raw) > max) error(fragment.file, n, `${key} 需要 0–${max} 的整数`);
      return Number(raw);
    };
    const twin = (low: string, high: string, min: number, max: number, first: number): void => {
      const value = scalar(low, min, max, first), limit = scalar(high, min, max, value);
      if (limit < value) error(fragment.file, n, `${high} 不能小于 ${low}`);
    };
    const rate = scalar('rate', 0, UI_PARTICLES.rateMax, 0), burst = countOf('burst', UI_PARTICLES.burstMax, 0);
    if (rate === 0 && burst === 0) error(fragment.file, n, 'particles 的 rate 与 burst 不能同时为 0');
    if (countOf('max', UI_PARTICLES.maxMax, 128) < 1) error(fragment.file, n, 'particles 的 max 至少为 1');
    twin('life', 'life-max', UI_PARTICLES.lifeMin, UI_PARTICLES.lifeMax, 2);
    twin('size', 'size-max', UI_PARTICLES.sizeMin, UI_PARTICLES.sizeMax, 16);
    twin('vx', 'vx-max', -UI_PARTICLES.speed, UI_PARTICLES.speed, 0);
    twin('vy', 'vy-max', -UI_PARTICLES.speed, UI_PARTICLES.speed, 0);
    scalar('accel-x', -UI_PARTICLES.accel, UI_PARTICLES.accel, 0); scalar('accel-y', -UI_PARTICLES.accel, UI_PARTICLES.accel, 0);
    twin('spin', 'spin-max', -UI_PARTICLES.spin, UI_PARTICLES.spin, 0);
    for (const key of ['fade', 'autostart']) if (n.attrs[key] !== undefined && !['true', 'false'].includes(n.attrs[key])) error(fragment.file, n, `${key} 必须是 true/false`);
  }
  function nodes(items: XmlNode[], fragment: UiFragment, depth: number, repeat = false, scope?: { prefix: string; local: Set<string> }): UiNode[] {
    return items.map(n => {
      if (depth > 8 || ++count > 1024) error(fragment.file, n, '超过 UI 深度 8 / 节点 1024 预算');
      const rawId = n.attrs.id;
      if (!rawId) error(fragment.file, n, '控件 ID 为空或全局重复');
      // v0.11.2 composition-tag children keep local IDs (`实例ID.局部ID` after expansion).
      const fullId = scope ? `${scope.prefix}.${rawId}` : rawId;
      if (scope) { if (scope.local.has(rawId)) error(fragment.file, n, `组合标签实例内控件 ID 重复：${rawId}`); scope.local.add(rawId); }
      else { if (ids.has(rawId)) error(fragment.file, n, '控件 ID 为空或全局重复'); ids.add(rawId); }
      if (engineIds.has(fullId)) error(fragment.file, n, `控件 ID 与组合标签展开后的其他控件冲突：${fullId}`);
      engineIds.add(fullId);
      if (numeric(fragment.file, n, 'width') <= 0 || numeric(fragment.file, n, 'height') <= 0) error(fragment.file, n, '宽高必须大于零');
      numeric(fragment.file, n, 'x', 0); numeric(fragment.file, n, 'y', 0);
      if (n.tag.startsWith('x-')) {
        const component = componentByName.get(n.tag);
        if (!component) {
          if (componentInfo.uncertain) result.warnings.push(`${fragment.file}:${line(fragment, n)}：组合标签 ${n.tag} 未在静态分析中注册；播放器会拒绝未知标签`);
          else error(fragment.file, n, `未注册的组合标签 ${n.tag}；需要 component.register("${n.tag}", …)`);
        }
        if (n.text.trim()) error(fragment.file, n, '组合标签不能包含正文');
        for (const key of Object.keys(n.attrs)) if (key !== 'id' && !COMPONENT_LAYOUT_ATTRIBUTES.includes(key) && !component?.props[key]) error(fragment.file, n, `组合标签 ${n.tag} 不支持属性 ${key}`);
        if (component) for (const [key, prop] of Object.entries(component.props)) {
          const value = n.attrs[key];
          if (value === undefined) { if (prop.required) error(fragment.file, n, `组合标签 ${n.tag} 缺少必需属性 ${key}`); continue; }
          componentPropValue(fragment, n, n.tag, key, prop, value);
          if (prop.type === 'event') componentEvents.push({ target: fullId, name: value, kind: 'xml', file: fragment.file, line: line(fragment, n) });
        }
        if (n.children.some(childNode => childNode.tag === 'text-arg')) error(fragment.file, n, '组合标签不能包含 text-arg');
        return { id: rawId, kind: 'component' as UiNodeKind, component: n.tag, attrs: n.attrs, file: fragment.file, line: line(fragment, n), children: nodes(n.children, fragment, depth + 1, repeat, { prefix: fullId, local: new Set() }), ...(scope ? { engineId: fullId } : {}) };
      }
      if (!(UI_KINDS as readonly string[]).includes(n.tag)) error(fragment.file, n, '不是支持的 UI 控件');
      checkAttrs(fragment.file, n, ['id', ...UI_ATTRIBUTES[n.tag as UiKind]]);
      if (n.attrs.color !== undefined) { try { parseColor(n.attrs.color); } catch (e) { error(fragment.file, n, `颜色非法：${e instanceof Error ? e.message : '格式错误'}`); } }
      const textKind = ['label', 'button', 'toggle'].includes(n.tag);
      const argChildren = n.children.filter(childNode => childNode.tag === 'text-arg');
      if (n.children.some(childNode => childNode.tag === 'text-arg') && !textKind) error(fragment.file, n, '只有文字控件可以使用 text-arg');
      if (n.children.length && !UI_CONTAINERS.includes(n.tag) && (!textKind || argChildren.length !== n.children.length)) error(fragment.file, n, '不能包含子控件');
      if (textKind && n.children.length && argChildren.length !== n.children.length) error(fragment.file, n, '文字控件只能包含 text-arg 子节点');
      const localized = textKind ? readLocalizedText(fragment, n) : undefined;
      if (n.tag === 'repeat' && repeat) error(fragment.file, n, '不支持嵌套 repeat');
      if (n.tag === 'repeat') {
        // v0.11.2 explicit pagination: page-size and page-bind come together; one variable per repeat.
        const pageSize = n.attrs['page-size'], pageBind = n.attrs['page-bind'];
        if ((pageSize === undefined) !== (pageBind === undefined)) error(fragment.file, n, 'page-size 与 page-bind 必须同时出现');
        if (pageSize !== undefined) {
          if (!/^[1-9][0-9]*$/.test(pageSize) || Number(pageSize) < 1 || Number(pageSize) > 200) error(fragment.file, n, 'page-size 必须是 1–200 的整数');
          if (!pageBind!.startsWith('ui.')) error(fragment.file, n, 'page-bind 必须引用已声明的 UI int 变量');
          const variable = result.variables.find(item => item.id === pageBind!.slice(3));
          if (!variable || variable.type !== 'int') error(fragment.file, n, 'page-bind 必须引用已声明的 UI int 变量');
          if (variable.min !== '1') error(fragment.file, n, 'page-bind 变量必须声明 min="1"');
          const bound = pageRepeats.get(pageBind!);
          if (bound) error(fragment.file, n, `UI 变量 ${pageBind} 已绑定到分页 repeat ${bound}；一个页变量只能绑定一个 repeat`);
          pageRepeats.set(pageBind!, rawId);
        }
      }
      if (n.tag === 'color-picker') {
        if (repeat) error(fragment.file, n, 'color-picker 不能放在 repeat 中');
        if (++pickers > 8) error(fragment.file, n, 'color-picker 最多 8 个');
        if (n.attrs.alpha !== undefined && !['true', 'false'].includes(n.attrs.alpha)) error(fragment.file, n, 'alpha 必须是 true/false');
        const alpha = n.attrs.alpha !== 'false', reserved = alpha ? 26 : 0;
        if (numeric(fragment.file, n, 'width') < 128 || numeric(fragment.file, n, 'height') - reserved < 128) error(fragment.file, n, 'color-picker 至少 128×128；启用透明条（alpha 默认）时至少 128×154');
        if (!n.attrs.value?.startsWith('ui.')) error(fragment.file, n, 'color-picker 的 value 必须是 ui.<string> 变量');
        const variable = vars.get(n.attrs.value.slice(3));
        if (!variable || variable.type !== 'string') error(fragment.file, n, 'color-picker 的 value 必须是已声明的 UI string');
        try { parseColor(variable.initial); } catch (e) { error(fragment.file, n, `color-picker 初值非法：${e instanceof Error ? e.message : '格式错误'}`); }
      }
      if (n.tag === 'particles') {
        // v0.11.3 emitters are declared by a page or a plain container, never per repeat item.
        if (repeat) error(fragment.file, n, 'particles 不能放在 repeat 模板中');
        particleEmitter(fragment, n);
      }
      if (n.attrs['color-bind'] !== undefined) {
        if (n.attrs.color !== undefined) error(fragment.file, n, 'color 与 color-bind 不能同时设置');
        const path = n.attrs['color-bind'], valid = path.startsWith('ui.') ? vars.get(path.slice(3))?.type === 'string' : path.startsWith('colors.') ? palette.has(path.slice(7)) : false;
        if (!valid) error(fragment.file, n, 'color-bind 需要 ui 字符串或已声明的 colors 槽位');
      }
      return { id: rawId, kind: n.tag as UiNodeKind, attrs: n.attrs, file: fragment.file, line: line(fragment, n), children: textKind ? [] : nodes(n.children, fragment, depth + 1, repeat || n.tag === 'repeat', scope), ...(localized ? { localized } : {}), ...(scope ? { engineId: fullId } : {}) };
    });
  }
  function expand(fragment: UiFragment): void {
    for (const n of fragment.root.children) {
      if (n.tag === 'include') { expand(byFile.get(n.attrs.src)!); continue; }
      if (n.tag === 'screen') {
        checkAttrs(fragment.file, n, ['id', 'modal', 'pause', 'background-click', 'background-right-click', 'sequence']);
        if (!n.attrs.id || screens.has(n.attrs.id)) error(fragment.file, n, '页面 ID 为空或重复'); screens.add(n.attrs.id);
        result.screens.push({ id: n.attrs.id, attrs: n.attrs, file: fragment.file, line: line(fragment, n), children: nodes(n.children, fragment, 1) });
      }
    }
  }
  expand(entry);
  for (const screen of result.screens) {
    // Emitters belong to the page that declares them (engine §39.2 per-page budget).
    const emitters = uiNodes(screen.children).filter(node => node.kind === 'particles').length;
    if (emitters > UI_PARTICLES.perScreen) throw new Error(`${screen.file}：页面 ${screen.id} 最多 ${UI_PARTICLES.perScreen} 个粒子发射器`);
  }
  if (result.screens.flatMap(screen => uiNodes(screen.children)).filter(node => node.kind === 'particles').length > UI_PARTICLES.total) throw new Error(`UI 最多 ${UI_PARTICLES.total} 个粒子发射器`);
  for (const screen of result.screens) for (const node of uiNodes(screen.children)) {
    const route = node.attrs.route;
    if (route !== undefined && (node.attrs.event !== undefined || route !== 'close' && (!route.startsWith('open:') || !screens.has(route.slice(5))))) error(node.file, { attrs: node.attrs } as XmlNode, '按钮导航需要合法目标且不能同时设置 event');
  }
  if (!result.screens.length || result.screens.length > 64) throw new Error('UI 页面数量超过引擎预算');
  const initial = result.screens.find(s => s.id === result.initial); if (!initial || initial.attrs.modal !== 'false') throw new Error('初始 UI 页面必须存在且 modal=false');
  // v0.9.0 removed frame video bindings; keep the old text visible as a source warning instead of silently previewing it.
  const removedVideoBinding = /^(?:not:)?game\.(?:videoPlaying|videoSkippable)$/;
  for (const screen of result.screens) for (const node of uiNodes(screen.children)) for (const key of ['bind', 'value', 'visible', 'enabled', 'image-bind', 'region-bind', 'color-bind']) {
    const value = node.attrs[key];
    if (value && removedVideoBinding.test(value)) result.warnings.push(`${node.file}:${node.line}：${key} 引用了 v0.9.0 已移除的 ${value}`);
  }
  result.media = readUiMedia(sources);
  const parsedEvents = uiEvents(sources, result.warnings);
  result.events = parsedEvents.events;
  result.bindings = [...xmlEventBindings(result), ...componentEvents, ...parsedEvents.bindings];
  if (parsedEvents.uncertain) result.eventUncertain = true;
  for (const event of result.events) {
    const targets = [...new Set(result.bindings.filter(binding => binding.kind !== 'legacy' && binding.name === event.name).map(binding => binding.target))];
    if (targets.length) event.targets = targets;
  }
  for (const screen of result.screens) for (const node of uiNodes(screen.children)) if (node.kind === 'color-picker' && !result.bindings.some(binding => binding.target === node.id && binding.kind !== 'legacy')) result.warnings.push(`${node.file}:${node.line}：color-picker 未绑定事件；松开后不会提交候选颜色，引擎只显示 value 初值`);
  const titleKey = entry.root.attrs['title-key'], titleKeyBind = entry.root.attrs['title-key-bind'];
  if (titleKey !== undefined) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(titleKey)) throw new Error('UI 根 title-key 格式无效');
    result.localizationUsages!.push({ key: titleKey, file: entry.file, line: 1, label: '窗口标题' });
  }
  if (titleKeyBind !== undefined) {
    if (!titleKeyBind.startsWith('ui.') || vars.get(titleKeyBind.slice(3))?.type !== 'string') throw new Error('UI 根 title-key-bind 必须引用已声明的 UI string');
    result.localizationUsages!.push({ key: '', file: entry.file, line: 1, label: '窗口标题', dynamic: true });
  }
  const screensById = new Set(result.screens.map(s => s.id));
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
  const nodeById = new Map(result.screens.flatMap(screen => uiNodes(screen.children)).map(node => [node.engineId ?? node.id, node]));
  // v0.11.2 read-only `repeat.<节点ID>.<字段>` metadata bindings: only declared paginated repeats,
  // and only the documented fields (engine §38.3).
  const paginatedIds = new Set([...nodeById.values()].filter(node => node.kind === 'repeat' && node.attrs['page-size'] !== undefined).map(node => node.engineId ?? node.id));
  for (const node of nodeById.values()) for (const key of ['bind', 'visible', 'enabled', 'value', 'image-bind', 'region-bind', 'color-bind']) {
    const raw = node.attrs[key]; if (!raw) continue;
    const path = raw.startsWith('not:') ? raw.slice(4) : raw;
    if (!path.startsWith('repeat.')) continue;
    const rest = path.slice(7), at = rest.lastIndexOf('.');
    if (at <= 0) throw new Error(`${node.file}:${node.line}：repeat 元数据绑定需要 repeat.<节点ID>.<字段>：${raw}`);
    const id = rest.slice(0, at), field = rest.slice(at + 1);
    if (!(UI_REPEAT_METADATA as readonly string[]).includes(field)) throw new Error(`${node.file}:${node.line}：未知的 repeat 元数据字段：${field}`);
    if (!paginatedIds.has(id)) throw new Error(`${node.file}:${node.line}：repeat 元数据引用了未分页或不存在的 repeat：${id}`);
  }
  /** v0.11.1: definitions are independent; XML references and single-argument
   * `ui(id).bind(eventId)` attach them, and unused definitions are valid. */
  const definitions = new Map<string, UiEvent>();
  for (const event of result.events) {
    const previous = definitions.get(event.name);
    if (previous) { for (const duplicate of [previous, event]) { duplicate.editable = false; duplicate.reason = '同名事件存在重复定义，保留源码'; } continue; }
    definitions.set(event.name, event);
  }
  for (const screen of result.screens) if (virtualTargets.has(screen.id)) throw new Error(`${screen.file}:${screen.line} 页面 ID 不能是保留虚拟目标：${screen.id}`);
  for (const node of nodeById.values()) if (virtualTargets.has(node.id)) throw new Error(`${node.file}:${node.line} 控件 ID 不能是保留虚拟目标：${node.id}`);
  const scriptBinds = new Set<string>();
  for (const binding of result.bindings) {
    const page = result.screens.find(screen => screen.id === binding.target), node = nodeById.get(binding.target);
    if (binding.kind === 'xml') {
      if (prefixLifecycle(binding.name)) result.warnings.push(`XML 事件 ${binding.target}.${binding.name} 使用了保留生命周期或全局名称；播放器会拒绝`);
      else if (!definitions.has(binding.name)) result.warnings.push(`XML 事件 ${binding.target}.${binding.name} 没有 event.register("${binding.name}", …) 定义；播放器会拒绝`);
      continue;
    }
    if (binding.kind === 'legacy') continue;
    if (!page && !node) result.warnings.push(`${binding.file}:${binding.line}：ui(${JSON.stringify(binding.target)}).bind 目标不存在；播放器会拒绝`);
    else if (node && !interactiveKinds.has(node.kind)) result.warnings.push(`${binding.file}:${binding.line}：ui(${JSON.stringify(binding.target)}).bind 只能绑定页面或按钮/滑条/开关/选色器；播放器会拒绝`);
    else if (node && node.attrs.route) result.warnings.push(`${binding.file}:${binding.line}：${binding.target} 是 route 按钮，不能再通过 bind 附加事件；播放器会拒绝`);
    else if (node && node.attrs.event && node.attrs.event !== binding.name) result.warnings.push(`${binding.file}:${binding.line}：${binding.target} 的 XML 已声明事件 ${node.attrs.event}，bind(${JSON.stringify(binding.name)}) 会被播放器拒绝`);
    else if (page) {
      const declared = [page.attrs['background-click'], page.attrs['background-right-click']].filter((name): name is string => !!name);
      if (declared.length && !declared.includes(binding.name)) result.warnings.push(`${binding.file}:${binding.line}：页面 ${page.id} 已声明背景事件 ${declared.join('/')}，bind(${JSON.stringify(binding.name)}) 会被播放器拒绝；请直接修改 XML 背景事件`);
    }
    if (!definitions.has(binding.name)) result.warnings.push(`${binding.file}:${binding.line}：ui(${JSON.stringify(binding.target)}).bind(${JSON.stringify(binding.name)}) 没有对应的 event.register 定义；播放器会拒绝`);
    const identity = `${binding.target}\0${binding.name}`;
    if (scriptBinds.has(identity)) result.warnings.push(`${binding.file}:${binding.line}：${binding.target} 重复 bind 了事件 ${binding.name}；播放器会拒绝`);
    scriptBinds.add(identity);
  }
  for (const event of result.events) {
    if (!event.editable || !event.command) continue;
    const command = event.command, commandTarget = event.commandTarget;
    if (command === 'open' || command === 'present') {
      if (!commandTarget || !screensById.has(commandTarget)) fail(event, '目标页面不存在');
    } else if (command === 'resume') {
      if (event.page && !screensById.has(event.page)) fail(event, '先打开的页面不存在');
      if (commandTarget) {
        const frame = story.frames.find(f => f.ref === commandTarget || f.id === commandTarget || f.name === commandTarget);
        if (!frame || frame.pending) fail(event, '起始或返回幕不存在，仍是待连接占位');
        else { event.commandTarget = frame.ref; if (!entryRefs.has(frame.ref)) event.reason = '该幕不是声明的起始幕；首次启动会被拒绝，剧情开始后可用于返回'; }
      }
    } else if (command === 'sequence') {
      if (!commandTarget || !result.media?.some(m => m.kind === 'sequence' && m.id === commandTarget)) fail(event, '演出序列不存在');
    } else if (command === 'playSound') {
      if (!commandTarget || !(result.media?.some(m => m.kind === 'sound' && m.id === commandTarget) || story.assets.some(a => a.kind === 'audio' && a.id === commandTarget))) fail(event, '音效不存在');
    } else if (command === 'soundActor') {
      if (!commandTarget || !story.characters.some(c => c.id === commandTarget)) fail(event, '人物不存在');
    } else if (command === 'soundExclude') {
      if (!commandTarget || !story.assets.some(a => a.kind === 'audio' && a.id === commandTarget)) fail(event, '音频素材不存在');
    } else if (command === 'restart') {
      if (event.page && !screensById.has(event.page)) event.reason = '先打开的页面不存在';
      if (commandTarget) {
        const frame = story.frames.find(f => f.ref === commandTarget || f.id === commandTarget || f.name === commandTarget);
        if (!frame || frame.pending || !entryRefs.has(frame.ref)) event.reason = '重新开始目标不是已声明的起始幕';
        else event.commandTarget = frame.ref;
      } else if (entryRefs.size > 1) event.reason = '多起始幕的重新开始动作必须指定起始幕';
    } else if (command === 'setting') {
      if (!commandTarget || !eventSettings.includes(commandTarget)) fail(event, '未知设置项');
    } else if (command === 'setUi') {
      const variable = commandTarget ? vars.get(commandTarget) : undefined;
      if (!commandTarget || !variable) fail(event, '目标 UI 变量不存在');
      else {
        // Binding targets determine which control kinds submit this value.
        const users = result.bindings.filter(binding => binding.kind !== 'legacy' && binding.name === event.name).map(binding => nodeById.get(binding.target)).filter((node): node is UiNode => !!node);
        if (users.length && users.every(node => node.kind === 'color-picker') && variable.type !== 'string') fail(event, 'color-picker 的更新事件必须写入 UI string');
        if (users.length && users.every(node => node.kind === 'slider') && variable.type !== 'int') fail(event, 'slider 的更新事件必须写入 UI int');
        if (users.length && users.every(node => node.kind === 'toggle') && variable.type !== 'bool') fail(event, 'toggle 的更新事件必须写入 UI bool');
        for (const picker of users.filter(node => node.kind === 'color-picker')) {
          const bound = picker.attrs.value?.startsWith('ui.') ? picker.attrs.value.slice(3) : '';
          if (bound && bound !== commandTarget) result.warnings.push(`${picker.file}:${picker.line}：color-picker 的 value 是 ui.${bound}，但事件 ${event.name} 写入 ui.${commandTarget}；播放器会在松开后回到绑定变量，请让两者一致`);
        }
      }
    } else if (command === 'unlock') {
      if (commandTarget && !story.assets.some(a => a.id === commandTarget && a.kind === 'cg')) fail(event, 'CG 专用资源不存在');
    } else if (command === 'captureShortcut') {
      if (!isShortcutAction(event.action)) fail(event, '未知快捷键动作');
      else if (!event.resultEvent || !definitions.has(event.resultEvent)) fail(event, '快捷键捕获结果事件必须是已定义的 event.register 事件');
      else if (event.resultEvent === event.name) fail(event, '快捷键捕获结果事件不能指向自身');
    } else if (command === 'keybinding') {
      if (!isShortcutAction(event.action)) fail(event, '未知快捷键动作');
      else if (event.binding !== null) try { event.binding = normalizeShortcutBinding(event.binding!, event.action!); } catch (e) { fail(event, e instanceof Error ? e.message : '快捷键无效'); }
    } else if (command === 'colorPreference') {
      if (!event.slot || !palette.has(event.slot)) fail(event, '配色槽位不存在');
      if (event.colorVariable !== undefined) {
        const variable = vars.get(event.colorVariable);
        if (!variable || variable.type !== 'string') fail(event, '颜色覆盖只能读取已声明的 UI string 变量');
        else try { parseColor(variable.initial); } catch { result.warnings.push(`${event.file}:${event.line}：颜色事件 ${event.name} 读取 ui.${event.colorVariable}，但该变量初值不是合法颜色；首次应用会被播放器拒绝`); }
      } else if (event.color !== null && event.color !== undefined) try { event.color = normalizeColor(event.color); } catch (e) { fail(event, e instanceof Error ? e.message : '颜色无效'); }
    } else if (command === 'locale') {
      if (!catalog?.enabled) fail(event, '游戏未开启本地化，ctx.locale 会被播放器拒绝');
      else if (event.channel !== 'text' && event.channel !== 'voice') fail(event, 'ctx.locale 第一个参数只接受 text/voice');
      else if (event.locale !== null && event.locale !== undefined) {
        const list = event.channel === 'text' ? catalog.texts : catalog.voices;
        if (event.channel === 'voice' && !catalog.voices.length) fail(event, '本游戏没有声明语音语言');
        else if (!list.some(locale => locale.id === event.locale)) fail(event, '语言 ID 不属于对应通道的已声明集合');
      }
    } else if (command === 'particles') {
      const emitter = commandTarget ? nodeById.get(commandTarget) : undefined;
      if (!emitter || emitter.kind !== 'particles') fail(event, '粒子发射器不存在');
      else if (!(UI_PARTICLE_ACTIONS as readonly string[]).includes(event.particleAction ?? '')) fail(event, '粒子动作只接受 start/stop/clear/burst');
      else if (event.particleAction === 'start' && !(Number(emitter.attrs.rate ?? 0) > 0)) fail(event, '该发射器没有 rate，不能 start');
      else if (event.particleAction === 'burst' && !(Number(emitter.attrs.burst ?? 0) > 0)) fail(event, '该发射器没有声明 burst');
    }
  }
  const logic = analyzeLogic(sources, story);
  result.warnings.push(...logic.screenIssues);
  const eventByName = new Map(result.events.map(event => [event.name, event]));
  for (const screen of result.screens) for (const node of uiNodes(screen.children)) {
    if (node.kind !== 'color-picker' || !node.attrs.event) continue;
    const handler = eventByName.get(node.attrs.event);
    if (handler?.editable && handler.command && handler.command !== 'setUi') result.warnings.push(`${node.file}:${node.line}：color-picker 的事件 ${node.attrs.event} 是 ${handler.command} 动作，不会调用 ctx.setUi；播放器松开后会回到绑定值`);
  }
  result.lifecycle = readLifecycle(sources, logic);
  return result;
}
export function locateUi(sources: Sources, id: string, screen = false): { file: string; node: XmlNode } {
  const found: { file: string; node: XmlNode }[] = [];
  function walk(file: string, n: XmlNode): void { if ((screen ? n.tag === 'screen' : (UI_KINDS as readonly string[]).includes(n.tag) || n.tag.startsWith('x-')) && n.attrs.id === id) found.push({ file, node: n }); for (const c of n.children) walk(file, c); }
  for (const f of uiFragments(sources)) walk(f.file, f.root);
  if (found.length !== 1) throw new Error(found.length > 1 ? '控件 ID 在组合标签实例内重复；请直接编辑源码' : 'UI 目标不存在或 ID 不唯一'); return found[0];
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
function uiIds(design: UiDesign): Set<string> {
  const ids = new Set(design.screens.map(screen => screen.id));
  for (const screen of design.screens) for (const node of uiNodes(screen.children)) ids.add(node.id);
  return ids;
}
function insideRepeat(nodes: UiNode[], id: string, repeat = false): boolean {
  for (const node of nodes) {
    if (node.id === id) return repeat || node.kind === 'repeat';
    if (insideRepeat(node.children, id, repeat || node.kind === 'repeat')) return true;
  }
  return false;
}
/** UI variable path of a binding attribute (`ui.id` / `not:ui.id`) or undefined. */
function bindingVariable(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const path = value.startsWith('not:') ? value.slice(4) : value;
  return path.startsWith('ui.') ? path.slice(3) : undefined;
}
/** Rejects deletion when opaque JS still reads or writes the variable. Editable single-action events are checked separately. */
function uiVariableScriptReferences(sources: Sources, id: string, editable: UiEvent[]): string[] {
  const found: string[] = [];
  const known = (file: string, n: Ast) => editable.some(event => event.file === file && n.start >= event.start && n.end <= event.end);
  try {
    for (const { file, ast } of scriptAst(sources)) {
      // Mark `ctx.ui` nodes that are followed by a direct member access; any other
      // use (destructuring, aliasing) cannot be resolved to one declared variable.
      const chained = new Set<number>();
      walkJs(ast, n => { if (n.type === 'MemberExpression' && n.object?.type === 'MemberExpression' && ctxMember(n.object, 'ctx') === 'ui') chained.add(n.object.start); });
      walkJs(ast, n => {
        if (n.type !== 'MemberExpression' && n.type !== 'CallExpression') return;
        if (known(file, n)) return;
        if (n.type === 'MemberExpression') {
          if (ctxMember(n.object, 'ctx') === 'ui') {
            const key = n.computed ? (n.property?.type === 'Literal' && typeof n.property.value === 'string' ? n.property.value : undefined) : n.property?.name;
            if (key === undefined) found.push(`${file}:${n.loc.start.line}（动态 ctx.ui 读取）`);
            else if (key === id) found.push(`${file}:${n.loc.start.line}（ctx.ui.${key}）`);
          } else if (ctxMember(n, 'ctx') === 'ui' && !chained.has(n.start)) found.push(`${file}:${n.loc.start.line}（无法确定成员的 ctx.ui 访问）`);
        } else {
          if (ctxMember(n.callee, 'ctx') !== 'setUi') return;
          const arg = n.arguments[0];
          const name = arg?.type === 'Literal' && typeof arg.value === 'string' ? arg.value : undefined;
          if (name === undefined) found.push(`${file}:${n.loc.start.line}（动态 ctx.setUi 名称）`);
          else if (name === id) found.push(`${file}:${n.loc.start.line}（ctx.setUi(${JSON.stringify(name)})）`);
        }
      });
    }
  } catch (e) { throw new Error(`脚本无法静态检查，不能删除 UI 变量：${e instanceof Error ? e.message : '语法错误'}`); }
  return found;
}
function validColorBind(design: UiDesign, path: string): boolean {
  return path.startsWith('ui.') ? design.variables.some(variable => variable.id === path.slice(3) && variable.type === 'string') : path.startsWith('colors.') ? design.palette.some(slot => slot.id === path.slice(7)) : false;
}
function validTextArgumentBind(design: UiDesign, path: string): boolean {
  if (path.startsWith('ui.')) return design.variables.some(variable => variable.id === path.slice(3));
  if (['cg.total', 'cg.unlocked', 'saves.page', 'saves.pages', 'locale.text', 'locale.voice'].includes(path)) return true;
  return false;
}
function textArgumentMarkup(args: { name: string; value?: string; bind?: string }[]): string {
  return args.map(arg => `<text-arg name="${escapeXml(arg.name)}" ${arg.bind !== undefined ? `bind="${escapeXml(arg.bind)}"` : `value="${escapeXml(arg.value ?? '')}"`} />`).join('');
}
function setTextArguments(source: string, node: XmlNode, args: { name: string; value?: string; bind?: string }[]): string {
  const markup = textArgumentMarkup(args);
  let next = source;
  // Remove existing text-arg nodes from the end so earlier ranges stay valid.
  for (const childNode of [...node.children].filter(childNode => childNode.tag === 'text-arg').reverse()) next = next.slice(0, childNode.start) + next.slice(childNode.end);
  const opening = next.slice(node.start, node.openEnd);
  if (!markup) return next;
  if (opening.endsWith('/>')) return next.slice(0, node.openEnd - 2) + `>${markup}</${node.tag}>` + next.slice(node.end);
  const refreshed = parseXml(next), target = (function find(current: XmlNode): XmlNode | undefined { if (current.start === node.start && current.tag === node.tag) return current; for (const childNode of current.children) { const found = find(childNode); if (found) return found; } })(refreshed);
  if (!target) throw new Error('文字控件源码已改变，请刷新');
  return next.slice(0, target.closeStart) + markup + next.slice(target.closeStart);
}
type CommandShape = { command: UiEventCommand; commandTarget?: string; page?: string; action?: string; resultEvent?: string; binding?: string | null; slot?: string; color?: string | null; colorVariable?: string; channel?: 'text' | 'voice'; locale?: string | null; particleAction?: UiParticleAction };
/** Emits the same fixed command forms that the visual editor can read back. */
function commandBody(event: CommandShape): string {
  const target = event.commandTarget !== undefined ? JSON.stringify(event.commandTarget) : undefined;
  switch (event.command) {
    case 'open': return `ctx.open(${target});`;
    case 'close': return 'ctx.close();';
    case 'advance': return 'ctx.advance();';
    case 'choose': return 'ctx.choose(ctx.item.id);';
    case 'soundEnabled': return 'ctx.soundEnabled(ctx.value);';
    case 'soundActor': case 'soundExclude': return `ctx.${event.command}(${target}, ctx.value);`;
    case 'sequence': case 'playSound': case 'present': return `ctx.${event.command}(${target});`;
    case 'resume': return `${event.page ? `ctx.open(${JSON.stringify(event.page)}); ` : ''}ctx.resume(${target ?? ''});`;
    case 'restart': return `${event.page ? `ctx.open(${JSON.stringify(event.page)}); ` : ''}ctx.restart(${target ?? ''});`;
    case 'setting': return `ctx.setting(${target}, ctx.value);`;
    case 'setUi': return `ctx.setUi(${target}, ctx.value);`;
    case 'unlock': return target ? `ctx.unlock(${target});` : 'ctx.unlock(ctx.game.cgId);';
    case 'captureShortcut': return `ctx.captureShortcut(${JSON.stringify(event.action)}, ${JSON.stringify(event.resultEvent)});`;
    case 'cancelShortcutCapture': return 'ctx.cancelShortcutCapture();';
    case 'keybinding': return `ctx.keybinding(${JSON.stringify(event.action)}, ${event.binding === null || event.binding === undefined ? 'null' : JSON.stringify(event.binding)});`;
    case 'resetKeybindings': return 'ctx.resetKeybindings();';
    case 'colorPreference': return `ctx.colorPreference(${JSON.stringify(event.slot)}, ${event.colorVariable !== undefined ? uiVariableAccess(event.colorVariable) : event.color === null || event.color === undefined ? 'null' : JSON.stringify(event.color)});`;
    case 'resetColors': return 'ctx.resetColors();';
    case 'particles': return `ctx.particles(${target}).${event.particleAction}();`;
    case 'quit': return 'ctx.quit();';
    case 'locale': return `ctx.locale(${JSON.stringify(event.channel)}, ${event.locale === null || event.locale === undefined ? 'null' : JSON.stringify(event.locale)});`;
  }
}
/** Appends a fixed independent event definition to the last declared script. */
function appendEvent(sources: Sources, design: UiDesign, name: string, body: string, command?: UiEventCommand): void {
  const file = readStory(sources).scripts.filter(script => sources.has(script)).at(-1); if (!file) throw new Error('缺少可追加的已声明脚本');
  sources.set(file, sources.get(file)! + `\nevent.register(${JSON.stringify(name)}, (ctx) => { ${body} });\n`);
  design.events.push({ name, kind: 'event', file, line: sources.get(file)!.split('\n').length, start: 0, end: 0, editable: true, ...(command ? { command } : {}) });
}
/** The `game.enter` hook keeps its preserved virtual target form. */
function appendGameEvent(sources: Sources, design: UiDesign, body: string): void {
  const file = readStory(sources).scripts.filter(script => sources.has(script)).at(-1); if (!file) throw new Error('缺少可追加的已声明脚本');
  sources.set(file, sources.get(file)! + `\nui("$game").bind("game.enter", (ctx) => { ${body} });\n`);
  design.events.push({ name: 'game.enter', kind: 'game', file, line: sources.get(file)!.split('\n').length, start: 0, end: 0, editable: true });
}
/** Removes one recognized script statement (definition or binding) with its line ending. */
function removeStatement(sources: Sources, range: { file: string; start?: number; end?: number }): void {
  const source = sources.get(range.file); if (source === undefined || !range.start || !range.end) return;
  let start = range.start, end = range.end;
  if (source.slice(end, end + 2) === '\r\n') end += 2; else if (source[end] === '\n') end += 1;
  else if (start >= 2 && source.slice(start - 2, start) === '\r\n') start -= 2;
  else if (start >= 1 && source[start - 1] === '\n') start -= 1;
  sources.set(range.file, source.slice(0, start) + source.slice(end));
}
/** Deleting a page/control removes its own recognized script bindings. Event
 * definitions stay: v0.11.1 permits unused definitions. Legacy callbacks or
 * other opaque references still block the delete. */
function removeTargetBindings(sources: Sources, design: UiDesign, targets: Set<string>): void {
  const list = design.bindings.filter(binding => binding.kind !== 'xml' && targets.has(binding.target));
  for (const binding of list) if (!binding.editable) throw new Error(`ui(${JSON.stringify(binding.target)}).bind("${binding.name}") 由旧式或自定义逻辑维护，不能随控件删除；请先迁移或删除该注册`);
  for (const binding of [...list].sort((a, b) => (b.start ?? 0) - (a.start ?? 0))) removeStatement(sources, binding);
}
/** Applies non-overlapping source replacements; every script edit goes through here. */
function patchScriptRanges(sources: Sources, patches: Map<string, { start: number; end: number; text: string }[]>): void {
  for (const [file, list] of patches) {
    let source = sources.get(file); if (source === undefined) continue;
    let boundary = source.length;
    for (const patch of list.sort((a, b) => b.start - a.start || b.end - a.end)) {
      if (patch.end > boundary) throw new Error('事件源码范围发生冲突，请刷新');
      source = source.slice(0, patch.start) + patch.text + source.slice(patch.end); boundary = patch.start;
    }
    if (source !== sources.get(file)) sources.set(file, source);
  }
}
/** Attaches a newly created definition through the declarative XML reference. */
function attachEventBinding(sources: Sources, design: UiDesign, name: string, target: string): void {
  const page = design.screens.find(screen => screen.id === target);
  if (page) {
    if (page.attrs['background-click'] && page.attrs['background-right-click']) throw new Error('页面背景已声明左右键事件，请直接在 XML 中引用该事件');
    const key = page.attrs['background-click'] ? 'background-right-click' : 'background-click';
    patchAttrs(sources, target, { [key]: name }, [key], true);
    return;
  }
  const node = design.screens.flatMap(item => uiNodes(item.children)).find(item => item.id === target);
  if (!node) throw new Error('绑定目标控件或页面不存在');
  if (!interactiveKinds.has(node.kind)) throw new Error('只能把事件绑定到按钮、滑条、开关、选色器或页面背景');
  if (node.attrs.route) throw new Error('route 按钮不能同时绑定事件');
  if (node.attrs.event && node.attrs.event !== name) throw new Error('控件已声明其他事件，请先清除');
  patchAttrs(sources, target, { event: name }, ['event']);
}

/** Adds an instance of a built-in composition tag (tabs/pagination) with the UI variables and
 * event definitions it needs. v0.11.2 composition tags cannot create scripts or root groups, so
 * the registration goes into an already declared script and variables into the entry `<variables>`. */
function insertComponentEdit(sources: Sources, design: UiDesign, op: Extract<UiEdit, { action: 'insertComponent' }>): { changes: Sources; selected: string; screen: string } {
  const kind = str(op.component, 32) as UiBuiltinComponent;
  if (!(UI_BUILTIN_COMPONENTS as readonly string[]).includes(kind)) throw new Error('未知的内置组件');
  const tag = `x-${kind}`;
  const screenId = str(op.screen, 128), page = design.screens.find(screen => screen.id === screenId);
  if (!page) throw new Error('目标页面不存在，请刷新');
  // 1. Ensure the registration exists; append to a declared script instead of creating a file.
  let next = design;
  if (!design.components?.some(component => component.name === tag)) {
    const scripts = readStory(sources).scripts.filter(file => sources.has(file));
    const file = scripts.includes('scripts/components.js') ? 'scripts/components.js' : scripts.at(-1);
    if (!file) throw new Error('工程没有可追加的已声明脚本，无法注册组合标签');
    const current = sources.get(file)!;
    sources.set(file, `${current}${current.endsWith('\n') ? '' : '\n'}${BUILTIN_COMPONENTS_SOURCE}`);
    next = readUiDesign(sources);
    if (!next.components?.some(component => component.name === tag)) throw new Error(`无法在 ${file} 中确认 ${tag} 的注册，请检查该脚本`);
    design = next;
  }
  const used = new Set<string>([...uiIds(design), ...design.variables.map(variable => variable.id)]), hex = newShortId(used);
  const uniqueId = (prefix: string) => { const id = `${prefix}${hex}`; if (used.has(id)) throw new Error('组件实例 ID 冲突，请重试'); used.add(id); return id; };
  const instanceX = 40, instanceY = op.parent ? 24 : 40;
  const appendInstance = (target: { file: string; node: XmlNode }, markup: string) => { sources.set(target.file, append(sources.get(target.file)!, target.node, markup)); };
  const markup: string[] = [];
  let selected = '';
  if (kind === 'tabs') {
    const instance = uniqueId('tabs');
    const pages = design.screens.filter(screen => screen.id !== screenId && screen.attrs.modal !== 'true').slice(0, 3);
    if (!pages.length) throw new Error('标签页需要至少另一个非模态页面作为目标');
    const labels: string[] = [], events: string[] = [], states: string[] = [], stateIds: string[] = [], variables: string[] = [];
    pages.forEach((item, index) => {
      const state = uniqueId('tab');
      stateIds.push(state);
      variables.push(`<bool id="${state}" initial="${index === 0 ? 'true' : 'false'}" />`);
      labels.push(item.id); events.push(`${instance}-${index + 1}`); states.push(`ui.${state}`);
    });
    const xml = sources.get(design.entry)!;
    const variablesGroup = child(parseXml(xml), 'variables');
    const variableMarkup = variables.join('');
    sources.set(design.entry, variablesGroup ? append(xml, variablesGroup, variableMarkup) : append(xml, parseXml(xml), `<variables>${variableMarkup}</variables>`));
    pages.forEach((item, index) => {
      const body = [`ctx.open(${JSON.stringify(item.id)});`, ...stateIds.map((state, position) => `ctx.setUi(${JSON.stringify(state)}, ${position === index});`)].join(' ');
      appendEvent(sources, design, events[index], body);
    });
    markup.push(`<${tag} id="${instance}" x="${instanceX}" y="${instanceY}" width="${Math.min(720, pages.length * 148)}" height="50" labels="${escapeXml(labels.join(';'))}" events="${escapeXml(events.join(';'))}" states="${escapeXml(states.join(';'))}" />`);
    selected = instance;
  } else {
    const instance = uniqueId('pager');
    const repeats = uiNodes(design.screens.flatMap(item => item.children)).filter(node => node.kind === 'repeat' && node.attrs['page-size'] !== undefined && node.attrs['page-bind'] !== undefined);
    const requested = op.target ? str(op.target, 128) : undefined;
    const repeat = requested ? repeats.find(node => node.id === requested || node.engineId === requested) : repeats.length === 1 ? repeats[0] : undefined;
    if (!repeat) throw new Error(requested ? '所选 repeat 不是带 page-size/page-bind 的分页列表' : '请先在目标 repeat 上声明 page-size 与 page-bind，或明确选择要分页的列表');
    const repeatId = repeat.engineId ?? repeat.id, pageVariable = repeat.attrs['page-bind']!.slice(3);
    const access = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(repeatId) ? `ctx.repeats.${repeatId}` : `ctx.repeats[${JSON.stringify(repeatId)}]`;
    const prevEvent = `${instance}Prev`, nextEvent = `${instance}Next`;
    appendEvent(sources, design, prevEvent, `const page = ${access}; if (page.canPrev) ctx.setUi(${JSON.stringify(pageVariable)}, page.page - 1);`);
    appendEvent(sources, design, nextEvent, `const page = ${access}; if (page.canNext) ctx.setUi(${JSON.stringify(pageVariable)}, page.page + 1);`);
    markup.push(`<${tag} id="${instance}" x="${instanceX}" y="${instanceY}" width="424" height="44" target="${escapeXml(repeatId)}" prev-event="${prevEvent}" next-event="${nextEvent}" />`);
    selected = instance;
  }
  // Resolve the insertion parent after every other edit: node offsets from an earlier parse
  // would point into shifted source text.
  const target = op.parent ? locateUi(sources, str(op.parent)) : locateUi(sources, screenId, true);
  appendInstance(target, markup.join('\n'));
  const check = readUiDesign(sources);
  if (!check.components?.some(component => component.name === tag)) throw new Error(`插入后未找到组合标签 ${tag}`);
  return { changes: sources, selected, screen: screenId };
}

/** Source range edits only. The matching engine remains the final semantic validator. */
export function editUi(input: Sources, value: unknown): { changes: Sources; selected?: string; screen?: string } {
  const op = value as UiEdit; if (!op || typeof op !== 'object' || typeof op.action !== 'string') throw new Error('UI 操作无效');
  const design = readUiDesign(input), sources = new Map(input); let selected: string | undefined, screen: string | undefined;
  if (op.action === 'lifecycle') { for (const [file, text] of editLifecycle(input, op)) sources.set(file, text); }
  else if (op.action === 'media') { for (const [file,text] of editUiMedia(input, op.item)) sources.set(file,text); }
  else if (op.action === 'patchNode') {
    const at = locateUi(sources, str(op.id)), patch = op.patch;
    if (patch && ('color' in patch) && patch.color && at.node.attrs['color-bind'] && !('color-bind' in patch)) throw new Error('请先清除 color-bind 再设置静态颜色');
    if (patch && ('color-bind' in patch) && patch['color-bind'] && at.node.attrs.color && !('color' in patch)) throw new Error('请先清除静态颜色再设置 color-bind');
    if (patch) {
      const textFields = ['text', 'bind', 'text-key', 'text-key-bind'].filter(key => key in patch);
      if (textFields.length) {
        const nonEmpty = textFields.filter(key => (patch[key] ?? '') !== '');
        if (nonEmpty.length > 1) throw new Error('文字、文字绑定、text-key 与 text-key-bind 只能四选一');
        if (nonEmpty.length === 1) for (const key of ['text', 'bind', 'text-key', 'text-key-bind']) if (key !== nonEmpty[0]) patch[key] = '';
        const key = patch['text-key'], keyBind = patch['text-key-bind'];
        if (key) {
          if (!/^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(key)) throw new Error('text-key 必须以英文字母开头，且只包含英文、数字、下划线或连字符');
          const catalog = readStory(sources).localization;
          if (!catalog?.enabled || !catalog.texts.find(locale => locale.id === catalog.defaultText)?.messages.some(file => file.entries.some(entry => entry.id === key && !entry.term))) throw new Error(`默认文本语言没有消息：${key}`);
        }
        if (keyBind && (!keyBind.startsWith('ui.') || !design.variables.some(variable => variable.id === keyBind.slice(3) && variable.type === 'string'))) throw new Error('text-key-bind 必须引用已声明的 UI string');
      }
    }
    patchAttrs(sources, op.id, patch, UI_ATTRIBUTES[at.node.tag as UiKind] ?? [...UI_COMPONENT_ATTRIBUTES]); selected = op.id;
  }
  else if (op.action === 'insertComponent') {
    const result = insertComponentEdit(sources, design, op);
    for (const [file, text] of result.changes) sources.set(file, text);
    selected = result.selected; screen = result.screen;
  }
  else if (op.action === 'textArgs') {
    const at = locateUi(sources, str(op.id));
    if (!['label', 'button', 'toggle'].includes(at.node.tag)) throw new Error('只有文字控件可以使用 text-arg');
    const args = Array.isArray(op.args) ? op.args : [];
    if (args.length > 16) throw new Error('text-arg 最多 16 个');
    const names = new Set<string>();
    for (const arg of args) {
      if (!arg || typeof arg.name !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(arg.name)) throw new Error('text-arg name 必须以英文字母开头，且只包含英文、数字、下划线或连字符');
      if (names.has(arg.name)) throw new Error(`text-arg name 重复：${arg.name}`);
      names.add(arg.name);
      const hasValue = arg.value !== undefined, hasBind = arg.bind !== undefined;
      if (hasValue === hasBind) throw new Error(`text-arg ${arg.name} 需要 value 或 bind 二选一`);
      if (hasBind && (typeof arg.bind !== 'string' || !validTextArgumentBind(design, arg.bind))) throw new Error(`text-arg ${arg.name} 绑定必须是 UI 标量、cg.total/cg.unlocked、saves.page/saves.pages 或 locale 标量`);
      if (hasValue && (typeof arg.value !== 'string' || arg.value.length > 4096)) throw new Error(`text-arg ${arg.name} 的值无效`);
    }
    if (!at.node.attrs['text-key'] && !at.node.attrs['text-key-bind']) throw new Error('只有 text-key/text-key-bind 控件可以使用 text-arg');
    sources.set(at.file, setTextArguments(sources.get(at.file)!, at.node, args.map(arg => ({ name: arg.name, ...(arg.value !== undefined ? { value: arg.value } : { bind: arg.bind }) }))));
    selected = op.id;
  }
  else if (op.action === 'patchScreen') { patchAttrs(sources, str(op.id), op.patch, ['modal', 'pause', 'background-click', 'background-right-click', 'sequence'], true); screen = op.id; }
  else if (op.action === 'patchRoot') {
    if (!op.patch || typeof op.patch !== 'object' || Object.keys(op.patch).some(k => !['width', 'height', 'initial', 'title', 'title-bind', 'title-key', 'title-key-bind'].includes(k))) throw new Error('不支持的 UI 入口属性');
    const titleFields = Object.keys(op.patch).filter(key => ['title', 'title-bind', 'title-key', 'title-key-bind'].includes(key) && (op.patch[key] ?? '') !== '');
    if (titleFields.length > 1) throw new Error('窗口标题的 title/title-bind/title-key/title-key-bind 只能四选一');
    if (op.patch['title-key']) {
      const key = str(op.patch['title-key']);
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(key)) throw new Error('title-key 格式无效');
      const catalog = readStory(sources).localization;
      if (!catalog?.enabled || !catalog.texts.find(locale => locale.id === catalog.defaultText)?.messages.some(file => file.entries.some(entry => entry.id === key && !entry.term))) throw new Error(`默认文本语言没有消息：${key}`);
    }
    if (op.patch['title-key-bind']) {
      const path = str(op.patch['title-key-bind']);
      if (!path.startsWith('ui.') || !design.variables.some(variable => variable.id === path.slice(3) && variable.type === 'string')) throw new Error('title-key-bind 必须引用已声明的 UI string');
    }
    let source = sources.get(design.entry)!;
    if (titleFields.length === 1) for (const key of ['title', 'title-bind', 'title-key', 'title-key-bind']) if (key !== titleFields[0]) op.patch[key] = '';
    for (const [key, raw] of Object.entries(op.patch)) { const v = str(raw); if (parseXml(source).attrs[key] !== v) source = setAttribute(source, parseXml(source), key, v); }
    sources.set(design.entry, source);
  } else if (op.action === 'addScreen') {
    if (!design.files.includes(str(op.file))) throw new Error('只能添加到已加载的 UI 文件');
    const id = op.name ? str(op.name) : newShortId(uiIds(design));
    if (!id.trim() || /\s/.test(id) || design.screens.some(s => s.id === id)) throw new Error('页面标识为空、含空白或重复');
    sources.set(op.file, append(sources.get(op.file)!, parseXml(sources.get(op.file)!), `<screen id="${escapeXml(id)}" modal="true" pause="true" />`)); screen = id;
  } else if (op.action === 'deleteScreen') {
    const id = str(op.id); if (id === design.initial) throw new Error('请先设置另一个非模态初始页面');
    const page = design.screens.find(s => s.id === id); if (!page) throw new Error('页面不存在，请刷新');
    if (design.screens.some(s => uiNodes(s.children).some(n => n.attrs.route === `open:${id}`))) throw new Error('仍有按钮导航到此页面，请先修改按钮目标');
    if (design.eventUncertain) throw new Error('存在无法静态解析的 UI 注册，暂不能安全删除页面');
    const logic = analyzeLogic(sources, readStory(sources));
    if (logic.lifecycle.some(l => (l.kind === 'screenOpen' || l.kind === 'screenClose') && (l.dynamic || l.target === id))) throw new Error('仍有页面生命周期注册引用此页面，请在源码中处理');
    for (const { ast } of scriptAst(sources)) walkJs(ast, n => {
      if (n.type !== 'CallExpression' || n.callee?.type !== 'MemberExpression') return;
      const callee = n.callee.computed ? n.callee.property.value : n.callee.property.name, arg = n.arguments[0], selector = n.callee.object;
      if (callee === 'bind' && selector?.type === 'Identifier') throw new Error('脚本可能通过保存的页面选择器注册此页面，请先在源码中处理');
      if (['open', 'present'].includes(callee) && (arg?.type !== 'Literal' || arg.value === id)) throw new Error('脚本可能打开或交接此页面，请先在源码中处理相关事件');
    });
    // The page and every control it owns lose their recognized script bindings with it.
    removeTargetBindings(sources, design, new Set([id, ...uiNodes(page.children).map(node => node.id)]));
    const at = locateUi(sources, id, true); sources.set(at.file, sources.get(at.file)!.slice(0, at.node.start) + sources.get(at.file)!.slice(at.node.end)); screen = design.initial;
  } else if (op.action === 'addNode') {
    const kind = str(op.kind) as UiKind; if (!(UI_KINDS as readonly string[]).includes(kind)) throw new Error('未知 UI 控件类型');
    const page = design.screens.find(s => s.id === str(op.screen)); if (!page) throw new Error('页面不存在'); screen = page.id;
    const at = op.parent ? locateUi(sources, str(op.parent)) : locateUi(sources, page.id, true);
    if (op.parent && (!uiNodes(page.children).some(n => n.id === op.parent) || !UI_CONTAINERS.includes(at.node.tag))) throw new Error('请选择当前页面中的容器作为父级');
    if (kind === 'color-picker' && (op.parent && insideRepeat(page.children, op.parent))) throw new Error('color-picker 不能放在 repeat 中');
    if (kind === 'particles') {
      if (op.parent && insideRepeat(page.children, op.parent)) throw new Error('particles 不能放在 repeat 中');
      if (uiNodes(page.children).filter(n => n.kind === 'particles').length >= UI_PARTICLES.perScreen) throw new Error(`每个页面最多 ${UI_PARTICLES.perScreen} 个粒子发射器`);
    }
    const pickerAlpha = op.alpha !== 'false';
    const attrs: Record<string, string> = { id: newShortId(uiIds(design)), x: '24', y: '24', width: kind === 'scene' ? String(design.width) : kind === 'color-picker' ? '256' : '240', height: kind === 'scene' ? String(design.height) : kind === 'color-picker' ? (pickerAlpha ? '282' : '256') : kind === 'particles' ? '320' : kind === 'panel' || kind === 'repeat' || kind === 'nine-patch' ? '160' : '48' };
    if (['label', 'button', 'toggle'].includes(kind)) attrs.text = kind === 'label' ? '新的文字' : kind === 'button' ? '按钮' : '开关';
    if (kind === 'panel') attrs.color = '#263B4B';
    if (['image', 'nine-patch'].includes(kind)) { const asset = readStory(sources).assets.find(a => a.id === op.image && a.kind === (kind === 'nine-patch' ? 'nine-patch' : 'image')); if (!asset) throw new Error('请先选择已导入的对应图片资源'); attrs.image = asset.id; }
    if (kind === 'particles') {
      // v0.11.3 emitters reuse the declared image/CG texture cache; the texture is required.
      const asset = readStory(sources).assets.find(a => a.id === op.image && (a.kind === 'image' || a.kind === 'cg'));
      if (!asset) throw new Error('请先选择已导入的图片或 CG 资源作为粒子纹理');
      Object.assign(attrs, { image: asset.id, rate: '24', max: '96', life: '0.8', 'life-max': '1.6', size: '8', 'size-max': '16', vy: '40', 'vy-max': '90' });
    }
    if (['button', 'toggle', 'slider'].includes(kind) && op.event) {
      // v0.11.1 definitions are independent; the new control only references one.
      const source = design.events.find(event => event.kind === 'event' && event.name === op.event);
      if (!source) throw new Error('请选择一个已注册的 event.register 事件');
      attrs.event = op.event;
    }
    if (kind === 'slider') Object.assign(attrs, { value: 'settings.bgm_volume', min: '0', max: '1' });
    if (kind === 'toggle') attrs.value = 'settings.muted';
    if (kind === 'repeat') Object.assign(attrs, { source: 'choices', 'item-width': '220', 'item-height': '48', gap: '8' });
    let draftId: string | undefined;
    if (kind === 'color-picker') {
      let value = typeof op.value === 'string' && op.value ? str(op.value) : '';
      if (value) {
        if (!value.startsWith('ui.') || !design.variables.some(variable => variable.id === value.slice(3) && variable.type === 'string')) throw new Error('请选择颜色值绑定的 UI string 变量');
      } else {
        // A picker needs a UI string draft. Create one by default so adding a picker
        // never produces a control that cannot display or commit a color.
        const existing = new Set(design.variables.map(variable => variable.id));
        draftId = `color${attrs.id}`;
        for (let index = 2; existing.has(draftId); index++) draftId = `color${attrs.id}-${index}`;
        value = `ui.${draftId}`;
      }
      attrs.value = value;
      if (typeof op.event === 'string' && op.event) {
        const source = design.events.find(event => event.kind === 'event' && event.name === op.event);
        if (!source) throw new Error('color-picker 需要选择一个已注册的更新事件');
        attrs.event = op.event;
      } else {
        // Engine pickers only propose a color; the bound UI string changes only when an
        // event calls ctx.setUi. Create that minimal handler so a new picker works.
        const base = `color-${attrs.id}`;
        let eventName = base;
        for (let index = 2; design.events.some(event => event.name === eventName); index++) eventName = `${base}-${index}`;
        appendEvent(sources, design, eventName, `ctx.setUi(${JSON.stringify(value.slice(3))}, ctx.value);`, 'setUi');
        attrs.event = eventName;
      }
      if (!pickerAlpha) attrs.alpha = 'false';
    }
    if (op.colorBind !== undefined) {
      if (!['panel', 'image', 'nine-patch', 'label', 'button', 'toggle'].includes(kind) || !validColorBind(design, str(op.colorBind))) throw new Error('color-bind 需要已声明的 ui string 或 colors 槽位');
      delete attrs.color; attrs['color-bind'] = op.colorBind;
    }
    sources.set(at.file, append(sources.get(at.file)!, at.node, `<${kind} ${Object.entries(attrs).map(([k, v]) => `${k}="${escapeXml(v)}"`).join(' ')} />`)); selected = attrs.id;
    if (draftId) {
      const source = sources.get(at.file)!;
      const group = child(parseXml(source), 'variables');
      const markup = `<string id="${escapeXml(draftId)}" initial="#FFFFFFFF" />`;
      sources.set(at.file, group ? append(source, group, markup) : append(source, parseXml(source), `<variables>${markup}</variables>`));
    }
  } else if (op.action === 'deleteNode' || op.action === 'duplicateNode') {
    const moving = design.screens.flatMap(s => uiNodes(s.children)).find(n => n.id === str(op.id));
    if (!moving) throw new Error('控件不存在，请刷新');
    const at = locateUi(sources, str(op.id)), source = sources.get(at.file)!;
    if (op.action === 'deleteNode') {
      // Script bindings that name this subtree are removed with it; the now-unused
      // event definitions stay because v0.11.1 permits unreferenced definitions.
      removeTargetBindings(sources, design, new Set(uiNodes([moving]).map(node => node.id)));
      sources.set(at.file, source.slice(0, at.node.start) + source.slice(at.node.end));
    }
    else {
      let markup = source.slice(at.node.start, at.node.end); const ids = uiNodes([moving]).map(n => n.id);
      const used = uiIds(design);
      for (const id of ids) { const local: XmlNode[] = []; const find = (n: XmlNode) => { if (n.attrs.id === id) local.push(n); n.children.forEach(find); }; find(parseXml(markup)); const fresh = newShortId(used); used.add(fresh); markup = setAttribute(markup, local[0], 'id', fresh); if (id === op.id) selected = fresh; }
      // XML event attributes are references, so a copy shares the same definitions.
      sources.set(at.file, source.slice(0, at.node.end) + '\n' + markup + source.slice(at.node.end));
    }
  } else if (op.action === 'moveNode') {
    const at = locateUi(sources, str(op.id)), page = design.screens.find(s => s.id === str(op.screen)); if (!page) throw new Error('目标页面不存在');
    const moving = design.screens.flatMap(s => uiNodes(s.children)).find(n => n.id === op.id)!;
    if (op.parent && (uiNodes([moving]).some(n => n.id === op.parent) || !uiNodes(page.children).some(n => n.id === op.parent))) throw new Error('不能移动到自身/子控件或其他页面的容器');
    if (!Number.isInteger(op.index) || op.index < 0 || op.index > 1024) throw new Error('控件顺序无效');
    const markup = sources.get(at.file)!.slice(at.node.start, at.node.end); sources.set(at.file, sources.get(at.file)!.slice(0, at.node.start) + sources.get(at.file)!.slice(at.node.end));
    const target = op.parent ? locateUi(sources, str(op.parent)) : locateUi(sources, page.id, true);
    if (op.parent && !UI_CONTAINERS.includes(target.node.tag) && !target.node.tag.startsWith('x-')) throw new Error('目标不是容器');
    sources.set(target.file, append(sources.get(target.file)!, target.node, markup, op.index)); selected = op.id; screen = page.id;
  } else if (op.action === 'palette') {
    const id = str(op.id, 64), initial = normalizeColor(str(op.initial, 64));
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(id)) throw new Error('配色槽位 ID 必须为 [a-z][a-z0-9_]{0,63}');
    const original = typeof op.original === 'string' && op.original ? str(op.original, 64) : undefined;
    if (original) {
      const slot = design.palette.find(item => item.id === original);
      if (!slot) throw new Error('配色槽位不存在，请刷新');
      if (id !== original) throw new Error('配色槽位 ID 创建后固定；请先处理 color-bind 与颜色事件');
      const xml = sources.get(slot.file)!, node = child(parseXml(xml), 'palette')?.children.find(item => item.attrs.id === id);
      if (!node) throw new Error('配色槽位源码已改变，请刷新');
      sources.set(slot.file, setAttribute(xml, node, 'initial', initial));
    } else {
      const file = str(op.file);
      if (!design.files.includes(file)) throw new Error('只能添加到已加载的 UI 文件');
      if (design.palette.some(slot => slot.id === id)) throw new Error('配色槽位 ID 已存在');
      if (design.palette.length >= 32) throw new Error('配色槽位最多 32 个');
      sources.set(file, appendGroup(sources.get(file)!, 'palette', `<color id="${escapeXml(id)}" initial="${escapeXml(initial)}" />`));
    }
  } else if (op.action === 'deletePalette') {
    const id = str(op.id, 64), slot = design.palette.find(item => item.id === id);
    if (!slot) throw new Error('配色槽位不存在，请刷新');
    if (design.screens.some(screen => uiNodes(screen.children).some(node => node.attrs['color-bind'] === `colors.${id}`))) throw new Error('仍有控件 color-bind 引用此配色槽位');
    if (design.events.some(event => event.command === 'colorPreference' && event.slot === id)) throw new Error('仍有颜色事件写入此配色槽位');
    const xml = sources.get(slot.file)!, group = child(parseXml(xml), 'palette'), node = group?.children.find(item => item.attrs.id === id);
    if (!group || !node) throw new Error('配色槽位源码已改变，请刷新');
    sources.set(slot.file, xml.slice(0, node.start) + xml.slice(node.end));
  } else if (op.action === 'addPopup') {
    const file = str(op.file), pageId = op.name ? str(op.name) : newShortId(uiIds(design));
    if (!design.files.includes(file)) throw new Error('只能添加到已加载的 UI 文件');
    if (!pageId.trim() || /\s/.test(pageId) || design.screens.some(screen => screen.id === pageId)) throw new Error('页面标识为空、含空白或重复');
    const title = op.title ? str(op.title, 1024) : '', message = op.message ? str(op.message, 4096) : '确定要执行此操作吗？';
    const confirmText = op.confirmText ? str(op.confirmText, 256) : '确定', cancelText = op.cancelText ? str(op.cancelText, 256) : '取消';
    const accept = op.accept ?? 'close';
    if (!['close', 'event', 'quit'].includes(accept)) throw new Error('弹窗确认动作无效');
    let event = typeof op.event === 'string' && op.event ? str(op.event, 128) : '';
    const used = uiIds(design); used.add(pageId); const fresh = () => { const id = newShortId(used); used.add(id); return id; };
    const width = Math.min(600, design.width - 80), height = title ? 300 : 250, x = Math.round((design.width - width) / 2), y = Math.round((design.height - height) / 2);
    const buttonWidth = Math.floor((width - 104) / 2), buttonY = height - 90;
    const shade = fresh(), panel = fresh(), titleId = title ? fresh() : '', messageId = fresh(), confirmId = fresh(), cancelId = fresh();
    if (accept === 'event') {
      // The generated confirm button references one existing independent definition.
      if (!design.events.some(item => item.kind === 'event' && item.name === event)) throw new Error('弹窗确认事件必须是已定义的 event.register 事件');
    }
    if (accept === 'quit') {
      event = 'quit-confirm';
      for (let index = 2; design.events.some(item => item.name === event); index++) event = `quit-confirm-${index}`;
      appendEvent(sources, design, event, 'ctx.quit();', 'quit');
    }
    const action = accept === 'close' ? 'route="close"' : `event="${escapeXml(event)}"`;
    const markup = `<screen id="${escapeXml(pageId)}" modal="true" pause="true">\n      <panel id="${shade}" width="${design.width}" height="${design.height}" color="#000000B8" />\n      <panel id="${panel}" x="${x}" y="${y}" width="${width}" height="${height}" color="#18232AF2" radius="16">\n        ${title ? `<label id="${titleId}" x="36" y="26" width="${width - 72}" height="42" text="${escapeXml(title)}" font-size="28" color="#F0CA89" />\n        ` : ''}<label id="${messageId}" x="36" y="${title ? 92 : 64}" width="${width - 72}" height="${title ? 84 : 96}" text="${escapeXml(message)}" font-size="23" color="#F5F1E8FF" />\n        <button id="${confirmId}" x="36" y="${buttonY}" width="${buttonWidth}" height="52" text="${escapeXml(confirmText)}" ${action} color="#315F73" font-size="22" radius="8" />\n        <button id="${cancelId}" x="${36 + buttonWidth + 32}" y="${buttonY}" width="${buttonWidth}" height="52" text="${escapeXml(cancelText)}" route="close" color="#43576FCC" font-size="22" radius="8" />\n      </panel>\n    </screen>`;
    const source = sources.get(file)!;
    sources.set(file, append(source, parseXml(source), markup)); screen = pageId; selected = confirmId;
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
  } else if (op.action === 'deleteVariable') {
    const id = str(op.id, 128), variable = design.variables.find(v => v.id === id);
    if (!variable) throw new Error('UI 变量不存在，请刷新');
    const references: string[] = [];
    const bindingKeys = ['bind', 'value', 'visible', 'enabled', 'image-bind', 'region-bind', 'color-bind', 'text-key-bind', 'page-bind'];
    for (const page of design.screens) for (const node of uiNodes(page.children)) {
      for (const key of bindingKeys) if (bindingVariable(node.attrs[key]) === id) references.push(`${node.file}:${node.line} 控件 ${node.id} ${key}`);
      for (const arg of node.localized?.args ?? []) if (bindingVariable(arg.bind) === id) references.push(`${node.file}:${node.line} 控件 ${node.id} text-arg ${arg.name}`);
    }
    for (const key of ['title-bind', 'title-key-bind']) if (bindingVariable(design.attrs[key]) === id) references.push(`${design.entry}:1 入口 ${key}`);
    for (const event of design.events) {
      if (event.command === 'setUi' && event.commandTarget === id || event.command === 'colorPreference' && event.colorVariable === id) references.push(`${event.file}:${event.line} 事件 ${event.name}`);
    }
    if (references.length) throw new Error(`仍有控件、标题或事件引用 UI 变量 ${id}：${references.join('、')}；请先修改或删除引用`);
    const scriptReferences = uiVariableScriptReferences(sources, id, design.events.filter(event => event.editable));
    if (scriptReferences.length) throw new Error(`脚本仍可能引用 UI 变量 ${id}：${scriptReferences.join('、')}；请先在源码中处理`);
    const xml = sources.get(variable.file)!, group = child(parseXml(xml), 'variables'), node = group?.children.find(item => item.attrs.id === id);
    if (!group || !node) throw new Error('UI 变量源码已改变，请刷新');
    sources.set(variable.file, xml.slice(0, node.start) + xml.slice(node.end));
  } else if (op.action === 'event') {
    const name = str(op.name, 128);
    if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(name)) throw new Error('事件名须由英文、数字、点、下划线或连字符组成');
    const original = typeof op.original === 'string' && op.original ? str(op.original, 128) : undefined;
    const target = typeof op.target === 'string' && op.target ? str(op.target, 128) : undefined;
    const matches = original !== undefined ? design.events.filter(event => event.name === original) : [];
    if (original !== undefined && matches.length !== 1) throw new Error(matches.length ? '存在重复定义，请先处理源码' : '要修改的事件已不存在，请刷新');
    if (original !== undefined && !matches[0].editable) throw new Error(matches[0].reason ?? '该事件由自定义逻辑维护，不能可视化修改');
    const game = matches[0]?.kind === 'game' || target === '$game';
    if (game) {
      if (name !== 'game.enter' || original !== undefined && original !== 'game.enter') throw new Error('game.enter 只能绑定 $game 且不能改名');
      if (original !== undefined && matches[0].kind !== 'game') throw new Error('game.enter 是全局钩子，与普通事件不同');
      if (original === undefined && design.events.some(event => event.kind === 'game')) throw new Error('game.enter 已经注册');
      if (target !== undefined && target !== '$game') throw new Error('$game 只接受 game.enter');
    } else {
      if (name === 'game.enter' || prefixLifecycle(name)) throw new Error('screen.open / screen.close 与 game.enter 是保留名称；请用生命周期编辑或 $game 目标');
      if (original === undefined && design.events.some(event => event.name === name)) throw new Error('已存在同名事件定义');
      if (target !== undefined) {
        const page = design.screens.find(screen => screen.id === target), node = design.screens.flatMap(screen => uiNodes(screen.children)).find(item => item.id === target);
        if (!page && !node) throw new Error('绑定目标控件或页面不存在');
        if (node && !interactiveKinds.has(node.kind)) throw new Error('只能把事件绑定到按钮、滑条、开关、选色器或页面背景');
        if (node?.attrs.route) throw new Error('route 按钮不能同时绑定事件');
        if (node?.attrs.event && node.attrs.event !== name) throw new Error('控件已声明其他事件，请先清除');
        if (page && page.attrs['background-click'] && page.attrs['background-right-click']) throw new Error('页面背景已声明左右键事件，请直接在 XML 中引用');
      }
    }
    const beforePage = typeof op.page === 'string' && op.page ? str(op.page) : undefined;
    if (beforePage !== undefined && !['resume', 'restart'].includes(op.command)) throw new Error('只有开始/恢复剧情或重新开始可以指定先打开页面');
    const commandTarget = typeof op.targetValue === 'string' && op.targetValue ? str(op.targetValue) : undefined;
    const shape: CommandShape = { command: op.command };
    if (op.command === 'open') { if (!commandTarget || !design.screens.some(s => s.id === commandTarget)) throw new Error('请选择目标页面'); shape.commandTarget = commandTarget; }
    else if (['soundActor', 'soundExclude'].includes(op.command)) { const story = readStory(sources); if (!commandTarget || op.command === 'soundActor' && !story.characters.some(c => c.id === commandTarget) || op.command === 'soundExclude' && !story.assets.some(a => a.kind === 'audio' && a.id === commandTarget)) throw new Error('人物或音频素材不存在'); shape.commandTarget = commandTarget; }
    else if (op.command === 'sequence' || op.command === 'playSound') { const exists = design.media?.some(m => m.kind === (op.command === 'sequence' ? 'sequence' : 'sound') && m.id === commandTarget) || op.command === 'playSound' && readStory(sources).assets.some(a => a.kind === 'audio' && a.id === commandTarget); if (!exists) throw new Error('演出或音效不存在'); shape.commandTarget = commandTarget; }
    else if (op.command === 'present') { if (!commandTarget || !design.screens.some(s => s.id === commandTarget)) throw new Error('请选择要交接的 UI 页面'); shape.commandTarget = commandTarget; }
    else if (op.command === 'resume') {
      if (beforePage && !design.screens.some(s => s.id === beforePage)) throw new Error('先打开的 UI 页面不存在');
      shape.page = beforePage;
      if (commandTarget) {
        const frame = readStory(sources).frames.find(f => f.ref === commandTarget || f.id === commandTarget || f.name === commandTarget);
        if (!frame || frame.pending) throw new Error('起始或返回幕不存在，仍是待连接占位');
        shape.commandTarget = frame.ref;
      }
    }
    else if (op.command === 'restart') {
      const story = readStory(sources);
      if (beforePage && !design.screens.some(s => s.id === beforePage)) throw new Error('先打开的 UI 页面不存在');
      shape.page = beforePage;
      if (commandTarget) {
        const frame = story.frames.find(f => f.ref === commandTarget || f.id === commandTarget || f.name === commandTarget);
        if (!frame || frame.pending || !(story.entries ?? [story.entry]).includes(frame.ref)) throw new Error('重新开始目标必须是已声明的起始幕');
        shape.commandTarget = frame.ref;
      } else if ((story.entries ?? [story.entry]).length > 1) throw new Error('多起始幕的重新开始动作必须指定起始幕');
    }
    else if (op.command === 'setting') { if (!eventSettings.includes(commandTarget ?? '')) throw new Error('未知设置项'); shape.commandTarget = commandTarget; }
    else if (op.command === 'setUi') {
      if (!commandTarget || !design.variables.some(variable => variable.id === commandTarget)) throw new Error('请选择已声明的 UI 变量');
      shape.commandTarget = commandTarget;
    }
    else if (op.command === 'unlock') {
      if (commandTarget && !readStory(sources).assets.some(a => a.id === commandTarget && a.kind === 'cg')) throw new Error('CG 专用资源不存在');
      shape.commandTarget = commandTarget;
    }
    else if (op.command === 'captureShortcut') {
      const action = typeof op.actionValue === 'string' ? str(op.actionValue, 32) : '';
      if (!isShortcutAction(action)) throw new Error('请选择快捷键动作');
      const resultEvent = typeof op.resultEvent === 'string' ? str(op.resultEvent, 128) : '';
      if (!resultEvent || !design.events.some(item => item.kind === 'event' && item.name === resultEvent)) throw new Error('快捷键捕获结果事件必须是已定义的 event.register 事件');
      if (resultEvent === name) throw new Error('快捷键捕获结果事件不能指向自身');
      shape.action = action; shape.resultEvent = resultEvent;
    }
    else if (op.command === 'keybinding') {
      const action = typeof op.actionValue === 'string' ? str(op.actionValue, 32) : '';
      if (!isShortcutAction(action)) throw new Error('请选择快捷键动作');
      const raw = typeof op.binding === 'string' ? op.binding.trim() : '';
      shape.action = action; shape.binding = raw ? normalizeShortcutBinding(raw, action) : null;
    }
    else if (op.command === 'colorPreference') {
      const slot = typeof op.slot === 'string' ? str(op.slot, 64) : '';
      if (!design.palette.some(item => item.id === slot)) throw new Error('请选择已声明的配色槽位');
      const colorVariable = typeof op.colorVariable === 'string' ? op.colorVariable.trim() : '';
      const raw = typeof op.color === 'string' ? op.color.trim() : '';
      if (colorVariable && raw) throw new Error('颜色覆盖只能选择固定颜色或 UI 变量之一');
      shape.slot = slot;
      if (colorVariable) {
        if (!design.variables.some(variable => variable.id === colorVariable && variable.type === 'string')) throw new Error('颜色覆盖只能读取已声明的 UI string 变量');
        shape.colorVariable = colorVariable;
      } else shape.color = raw ? normalizeColor(raw) : null;
    }
    else if (op.command === 'locale') {
      const channel = op.channel === 'text' || op.channel === 'voice' ? op.channel : '';
      if (!channel) throw new Error('ctx.locale 需要 text 或 voice 通道');
      const catalog = readStory(sources).localization;
      if (!catalog?.enabled) throw new Error('游戏没有开启本地化，不能写入 ctx.locale');
      const raw = typeof op.locale === 'string' ? op.locale.trim() : '';
      const locale = raw ? canonicalLocaleId(raw) : null;
      if (locale !== null) {
        const list = channel === 'text' ? catalog.texts : catalog.voices;
        if (!list.some(item => item.id === locale)) throw new Error(`语言 ${locale} 不属于 ${channel} 通道的已声明集合`);
      } else if (channel === 'voice' && !catalog.voices.length) throw new Error('本游戏没有声明语音语言，不能提交语音选择');
      shape.channel = channel; shape.locale = locale;
    }
    else if (op.command === 'particles') {
      const emitter = design.screens.flatMap(item => uiNodes(item.children)).find(node => node.kind === 'particles' && node.id === commandTarget);
      if (!emitter) throw new Error('请选择已声明的粒子发射器');
      const action = typeof op.particleAction === 'string' ? str(op.particleAction, 16) : '';
      if (!(UI_PARTICLE_ACTIONS as readonly string[]).includes(action)) throw new Error('粒子动作只接受 start/stop/clear/burst');
      if (action === 'start' && !(Number(emitter.attrs.rate ?? 0) > 0)) throw new Error('该发射器没有 rate，不能 start；请提高 rate 或改用 burst/stop');
      if (action === 'burst' && !(Number(emitter.attrs.burst ?? 0) > 0)) throw new Error('该发射器没有声明 burst 数量');
      shape.commandTarget = emitter.id; shape.particleAction = action as UiParticleAction;
    }
    else if (!['close', 'advance', 'choose', 'soundEnabled', 'cancelShortcutCapture', 'resetKeybindings', 'resetColors', 'quit'].includes(op.command)) throw new Error('不支持的事件动作');
    const body = commandBody(shape);
    if (game) {
      if (matches[0]?.kind === 'game') {
        const event = matches[0], source = sources.get(event.file)!;
        sources.set(event.file, source.slice(0, event.start) + `ui("$game").bind("game.enter", (ctx) => { ${body} });` + source.slice(event.end));
      } else appendGameEvent(sources, design, body);
    } else if (original !== undefined) {
      const event = matches[0];
      if (name !== original && design.eventUncertain) throw new Error('存在无法静态解析的注册，不能自动重命名事件');
      const patches = new Map<string, { start: number; end: number; text: string }[]>();
      const add = (file: string, start: number, end: number, text: string) => { const list = patches.get(file) ?? []; list.push({ start, end, text }); patches.set(file, list); };
      add(event.file, event.start, event.end, `event.register(${JSON.stringify(name)}, (ctx) => { ${body} });`);
      if (name !== original && !game) {
        // Rename updates every proven reference: script binds and XML attributes.
        for (const binding of design.bindings) if (binding.kind === 'script' && binding.name === original && binding.start !== undefined && binding.end !== undefined) add(binding.file, binding.start, binding.end, `ui(${JSON.stringify(binding.target)}).bind(${JSON.stringify(name)});`);
      }
      patchScriptRanges(sources, patches);
      if (name !== original) for (const page of design.screens) {
        for (const key of ['background-click', 'background-right-click'] as const) if (page.attrs[key] === original) patchAttrs(sources, page.id, { [key]: name }, [key], true);
        for (const node of uiNodes(page.children)) if (node.attrs.event === original) patchAttrs(sources, node.id, { event: name }, ['event']);
      }
    } else {
      appendEvent(sources, design, name, body, shape.command);
      if (target !== undefined) attachEventBinding(sources, design, name, target);
    }
  } else if (op.action === 'deleteEvent') {
    const name = str(op.name, 128), matches = design.events.filter(event => event.name === name);
    if (matches.length !== 1) throw new Error(matches.length ? '存在重复定义，请先处理源码' : '要删除的事件已不存在，请刷新');
    const event = matches[0];
    if (!event.editable) throw new Error(event.reason ?? '该事件由自定义逻辑维护，不能删除');
    const references = design.bindings.filter(binding => binding.name === name).map(binding => `${binding.file}:${binding.line} ${binding.kind === 'xml' ? 'XML 引用' : binding.kind === 'legacy' ? '旧式回调' : 'ui(...).bind'} ${binding.target}`);
    if (references.length) throw new Error(`仍有控件、页面或脚本引用事件 ${name}：${references.join('、')}；请先删除或改用其他事件`);
    if (design.events.some(item => item.command === 'captureShortcut' && item.resultEvent === name)) throw new Error('仍有快捷键捕获指向此结果事件，请先修改或删除捕获事件');
    removeStatement(sources, event);
  } else if (op.action === 'gallery') {
    const id = str(op.id, 128), image = str(op.image, 256);
    const titleKey = typeof op.titleKey === 'string' && op.titleKey.trim() ? str(op.titleKey, 128) : undefined;
    const title = titleKey ? '' : str(op.title, 1024);
    if (!id.trim() || !image || (!title.trim() && !titleKey)) throw new Error('画廊条目需要 ID、图片和标题或 title-key');
    if (titleKey) {
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(titleKey)) throw new Error('画廊 title-key 格式无效');
      const catalog = readStory(sources).localization;
      if (!catalog?.enabled || !catalog.texts.find(locale => locale.id === catalog.defaultText)?.messages.some(file => file.entries.some(entry => entry.id === titleKey && !entry.term))) throw new Error(`默认文本语言没有消息：${titleKey}`);
    }
    if (typeof op.unlocked !== 'boolean') throw new Error('画廊解锁初值无效');
    const story = readStory(sources), asset = story.assets.find(a => a.id === image);
    if (!asset || !['image', 'cg'].includes(asset.kind)) throw new Error('画廊图片资源不存在');
    if (asset.kind === 'cg' && id !== image) throw new Error('专用 CG 的画廊 ID 必须等于资源 ID');
    const original = typeof op.original === 'string' && op.original ? str(op.original, 128) : undefined;
    if (design.gallery.some(g => g.id === id && !g.implicit && (!original || g.id !== original))) throw new Error('画廊 ID 已存在');
    const previous = original ? design.gallery.find(g => g.id === original && !g.implicit) : undefined;
    if (original && !previous) throw new Error('要修改的画廊条目已不存在或只是自动 CG');
    const titleMarkup = titleKey ? `title-key="${escapeXml(titleKey)}"` : `title="${escapeXml(title)}"`;
    const markup = `<cg id="${escapeXml(id)}" image="${escapeXml(image)}" ${titleMarkup} unlocked="${op.unlocked ? 'true' : 'false'}" />`;
    if (previous) {
      const xml = sources.get(previous.file!)!, group = child(parseXml(xml), 'gallery');
      const node = group?.children.find(n => n.attrs.id === original);
      if (!group || !node) throw new Error('画廊条目源码已改变，请刷新');
      let next = xml;
      for (const [key, value] of [['image', image], ['title', title], ['title-key', titleKey ?? ''], ['unlocked', op.unlocked ? 'true' : 'false'], ['id', id]] as const) {
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
