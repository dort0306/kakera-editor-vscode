import { parse } from 'acorn';
import type { Sources } from './index';
import { appendGroup, newShortId, readStory } from './index';
import { child, escapeXmlAttribute as escapeXml, parseXml, setAttribute, type XmlNode } from './xml';
import { uiFragments, type UiFragment } from './ui-files';
import { UI_ATTRIBUTES, UI_CONTAINERS, UI_KINDS, uiNodes, type UiDesign, type UiEdit, type UiEvent, type UiEventCommand, type UiGalleryEntry, type UiKind, type UiNode, type UiPaletteSlot, type UiScreen } from '../../domain/src/ui';
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
const uiCommandNames: UiEventCommand[] = ['open', 'close', 'advance', 'restart', 'choose', 'setting', 'setUi', 'sequence', 'playSound', 'soundEnabled', 'soundActor', 'soundExclude', 'present', 'resume', 'unlock', 'captureShortcut', 'cancelShortcutCapture', 'keybinding', 'resetKeybindings', 'colorPreference', 'resetColors', 'quit', 'locale'];
const eventSettings = ['text_speed', 'auto_delay', 'bgm_volume', 'voice_volume', 'se_volume', 'video_volume', 'muted', 'autosave', 'skip_all', 'fullscreen'];
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
type EventShape = { command: UiEventCommand; commandTarget?: string; page?: string; action?: string; resultEvent?: string; binding?: string | null; slot?: string; color?: string | null; colorVariable?: string; channel?: 'text' | 'voice'; locale?: string | null };
function eventCall(n: Ast, ctx: string): EventShape | undefined {
  if (n?.type !== 'ExpressionStatement' || n.expression?.type !== 'CallExpression') return;
  const call = n.expression, method = ctxMember(call.callee, ctx); if (!method) return;
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
/** v0.11.0 registration: ui(target).bind("event", callback). Targets are control
 * template IDs or page IDs; $game and $host are fixed virtual targets. */
function uiEvents(sources: Sources, warnings: string[]): { events: UiEvent[]; uncertain: boolean } {
  const events: UiEvent[] = [];
  let uncertain = false;
  try { for (const { file, ast } of scriptAst(sources)) {
    walkJs(ast, n => {
      if (n.type === 'CallExpression' && n.callee?.type === 'MemberExpression' && !n.callee.optional) {
        const method = n.callee.computed ? n.callee.property.value : n.callee.property.name;
        if (method === 'skipVideo') warnings.push(`${file}：v0.9.0 已移除 ctx.skipVideo；视频改用 UI 演出 sequence`);
        // v0.11.0 removed on.* without aliases; point authors at the migration table.
        if (n.callee.object?.type === 'Identifier' && n.callee.object.name === 'on' && ['advance', 'choice', 'end', 'ui', 'frameEnter', 'frameExit', 'screenOpen', 'screenClose'].includes(method)) {
          warnings.push(`${file}:${n.loc.start.line}：旧 on.${method} 注册已被 v0.11.0 移除；请改用 frame()/ui() 注册（上游 API 第 37.5 节）`);
          uncertain = true;
        }
      }
    });
    for (const n of ast.body) {
      const c = n.expression; if (n.type !== 'ExpressionStatement' || c?.type !== 'CallExpression' || c.optional) continue;
      if (c.callee?.type !== 'MemberExpression' || c.callee.optional || (c.callee.computed ? c.callee.property.value : c.callee.property.name) !== 'bind') continue;
      const selector = c.callee.object;
      if (selector?.type !== 'CallExpression' || selector.optional || selector.callee?.type !== 'Identifier' || selector.callee.name !== 'ui' || selector.arguments.length !== 1) {
        // A saved selector or an unsupported call shape: report it instead of guessing.
        if (selector?.type === 'Identifier' || selector?.type === 'CallExpression' && selector.callee?.name === 'ui') warnings.push(`${file}：存在无法静态解析的 ui(...).bind 注册，事件列表可能不完整`);
        uncertain = true; continue;
      }
      const targetArg = selector.arguments[0];
      const target = targetArg?.type === 'Literal' && typeof targetArg.value === 'string' ? targetArg.value : undefined;
      const eventArg = c.arguments[0];
      const name = eventArg?.type === 'Literal' && typeof eventArg.value === 'string' ? eventArg.value : undefined;
      if (target === undefined || name === undefined) {
        warnings.push(`${file}：ui(target).bind 的目标或事件名是动态表达式，事件列表可能不完整`);
        uncertain = true; continue;
      }
      if (lifecycleEvent(name)) continue;
      if (target === '$game') {
        if (name !== 'game.enter') { warnings.push(`${file}：$game 只接受 game.enter，已忽略 ${name}`); continue; }
      } else if (name === 'game.enter' || prefixLifecycle(name)) {
        warnings.push(`${file}：${name} 是保留生命周期或全局事件名，不能绑定到 ${target}`); continue;
      }
      if (c.arguments.length !== 2) { warnings.push(`${file}：${name} 的 bind 需要恰好一个回调`); uncertain = true; continue; }
      const shaped = readEventCallback(c);
      const event: UiEvent = { name, target, file, line: n.loc.start.line, start: n.start, end: n.end, editable: !!shaped, ...(shaped ?? {}) };
      if (!shaped) event.reason = '回调包含自定义逻辑或多条动作，保留源码';
      else if (/\/\/|\/\*/.test(sources.get(file)!.slice(n.start, n.end))) { event.editable = false; event.reason = '回调内包含注释，保留源码'; }
      events.push(event);
    }
    // Registration outside the top-level statement list is not part of the
    // assembly contract; keep it Opaque instead of silently dropping the event.
    const top = new Set(ast.body.filter((n: Ast) => n.type === 'ExpressionStatement').map((n: Ast) => n.expression));
    walkJs(ast, n => {
      if (n.type !== 'CallExpression' || n.callee?.type !== 'MemberExpression' || n.callee.optional || top.has(n)) return;
      if ((n.callee.computed ? n.callee.property.value : n.callee.property.name) !== 'bind') return;
      const selector = n.callee.object;
      if (selector?.type === 'CallExpression' && selector.callee?.type === 'Identifier' && selector.callee.name === 'ui') {
        warnings.push(`${file}:${n.loc.start.line}：ui(...).bind 注册不在顶层，事件列表可能不完整`); uncertain = true;
      }
    });
  } } catch (e) { warnings.push(`UI 事件解析失败：${e instanceof Error ? e.message : '语法错误'}`); uncertain = true; }
  const counts = new Map<string, number>(); for (const e of events) { const key = `${e.target}\0${e.name}`; counts.set(key, (counts.get(key) ?? 0) + 1); }
  for (const e of events) if ((counts.get(`${e.target}\0${e.name}`) ?? 0) > 1) { e.editable = false; e.reason = '同一目标存在重复注册，保留源码'; }
  return { events, uncertain };
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
  const result: UiDesign = { entry: entry.file, files: fragments.map(f => f.file), width: Number(entry.root.attrs.width ?? 1280), height: Number(entry.root.attrs.height ?? 720), initial: entry.root.attrs.initial, attrs: entry.root.attrs, screens: [], variables: [], palette: [], gallery: [], events: [], warnings: [], localizationUsages: [] };
  if (![result.width, result.height].every(Number.isFinite) || result.width < 640 || result.height < 360 || Math.abs(result.width * 9 - result.height * 16) > .1) throw new Error('UI 画布需要至少 640×360 的 16:9 尺寸');
  const ids = new Set<string>(), screens = new Set<string>(), vars = new Map<string, { type: 'int' | 'bool' | 'string'; initial: string }>(), palette = new Set<string>(), gallery = new Set<string>(); let count = 0, pickers = 0;
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
  function nodes(items: XmlNode[], fragment: UiFragment, depth: number, repeat = false): UiNode[] {
    return items.map(n => {
      if (depth > 8 || ++count > 1024) error(fragment.file, n, '超过 UI 深度 8 / 节点 1024 预算');
      if (!(UI_KINDS as readonly string[]).includes(n.tag)) error(fragment.file, n, '不是支持的 UI 控件');
      checkAttrs(fragment.file, n, ['id', ...UI_ATTRIBUTES[n.tag as UiKind]]);
      if (!n.attrs.id || ids.has(n.attrs.id)) error(fragment.file, n, '控件 ID 为空或全局重复'); ids.add(n.attrs.id);
      if (numeric(fragment.file, n, 'width') <= 0 || numeric(fragment.file, n, 'height') <= 0) error(fragment.file, n, '宽高必须大于零');
      numeric(fragment.file, n, 'x', 0); numeric(fragment.file, n, 'y', 0);
      if (n.attrs.color !== undefined) { try { parseColor(n.attrs.color); } catch (e) { error(fragment.file, n, `颜色非法：${e instanceof Error ? e.message : '格式错误'}`); } }
      const textKind = ['label', 'button', 'toggle'].includes(n.tag);
      const argChildren = n.children.filter(childNode => childNode.tag === 'text-arg');
      if (n.children.some(childNode => childNode.tag === 'text-arg') && !textKind) error(fragment.file, n, '只有文字控件可以使用 text-arg');
      if (n.children.length && !UI_CONTAINERS.includes(n.tag) && (!textKind || argChildren.length !== n.children.length)) error(fragment.file, n, '不能包含子控件');
      if (textKind && n.children.length && argChildren.length !== n.children.length) error(fragment.file, n, '文字控件只能包含 text-arg 子节点');
      const localized = textKind ? readLocalizedText(fragment, n) : undefined;
      if (n.tag === 'repeat' && repeat) error(fragment.file, n, '不支持嵌套 repeat');
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
        if (!n.attrs.event) error(fragment.file, n, 'color-picker 需要 event');
      }
      if (n.attrs['color-bind'] !== undefined) {
        if (n.attrs.color !== undefined) error(fragment.file, n, 'color 与 color-bind 不能同时设置');
        const path = n.attrs['color-bind'], valid = path.startsWith('ui.') ? vars.get(path.slice(3))?.type === 'string' : path.startsWith('colors.') ? palette.has(path.slice(7)) : false;
        if (!valid) error(fragment.file, n, 'color-bind 需要 ui 字符串或已声明的 colors 槽位');
      }
      return { id: n.attrs.id, kind: n.tag as UiKind, attrs: n.attrs, file: fragment.file, line: line(fragment, n), children: textKind ? [] : nodes(n.children, fragment, depth + 1, repeat || n.tag === 'repeat'), ...(localized ? { localized } : {}) };
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
  if (parsedEvents.uncertain) result.eventUncertain = true;
  const registrations = new Set(result.events.map(event => `${event.target}\0${event.name}`));
  for (const screen of result.screens) for (const node of uiNodes(screen.children)) if (node.kind === 'color-picker' && !registrations.has(`${node.id}\0${node.attrs.event}`)) throw new Error(`${node.file}:${node.line} 的 color-picker 事件没有绑定到该控件的注册：${node.attrs.event}`);
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
  const nodeById = new Map(result.screens.flatMap(screen => uiNodes(screen.children)).map(node => [node.id, node]));
  /** v0.11.0 matches one registration per (target, event); the XML side declares the event. */
  const declaredEvents = new Map<string, Set<string>>();
  for (const screen of result.screens) {
    declaredEvents.set(screen.id, new Set([screen.attrs['background-click'], screen.attrs['background-right-click']].filter((name): name is string => !!name)));
    for (const node of uiNodes(screen.children)) declaredEvents.set(node.id, new Set(node.attrs.event ? [node.attrs.event] : []));
  }
  const registered = new Set(result.events.map(event => `${event.target}\0${event.name}`));
  for (const screen of result.screens) if (virtualTargets.has(screen.id)) throw new Error(`${screen.file}:${screen.line} 页面 ID 不能是保留虚拟目标：${screen.id}`);
  for (const node of nodeById.values()) if (virtualTargets.has(node.id)) throw new Error(`${node.file}:${node.line} 控件 ID 不能是保留虚拟目标：${node.id}`);
  for (const event of result.events) {
    if (event.target === '$game') { if (event.name !== 'game.enter') fail(event, '$game 只接受 game.enter'); }
    else if (event.target === '$host') { if (prefixLifecycle(event.name) || event.name === 'game.enter') fail(event, '$host 只接受非保留的捕获结果事件名'); }
    else if (!declaredEvents.has(event.target)) fail(event, '注册目标不存在');
    else if (!declaredEvents.get(event.target)!.has(event.name)) result.warnings.push(`${event.file}:${event.line}：${event.name} 尚未在 ${event.target} 的 XML 中声明；播放器会拒绝未对应的注册`);
  }
  if (!result.eventUncertain) for (const [target, names] of declaredEvents) for (const name of names) if (!registered.has(`${target}\0${name}`)) result.warnings.push(`XML 事件 ${target}.${name} 没有对应的 ui("${target}").bind("${name}", …) 注册；播放器会拒绝`);
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
        // Only the registered target determines the control kind that submits this value.
        const users = result.screens.flatMap(screen => uiNodes(screen.children)).filter(node => node.id === event.target && node.attrs.event === event.name);
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
      if (!event.resultEvent || !result.events.some(item => item.target === '$host' && item.name === event.resultEvent)) fail(event, '快捷键捕获结果事件必须注册在 $host');
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
    }
  }
  const logic = analyzeLogic(sources, story);
  result.warnings.push(...logic.screenIssues);
  const eventByTarget = new Map(result.events.map(event => [`${event.target}\0${event.name}`, event]));
  for (const screen of result.screens) for (const node of uiNodes(screen.children)) {
    if (node.kind !== 'color-picker') continue;
    const handler = eventByTarget.get(`${node.id}\0${node.attrs.event}`);
    if (handler?.editable && handler.command && handler.command !== 'setUi') result.warnings.push(`${node.file}:${node.line}：color-picker 的事件 ${node.attrs.event} 是 ${handler.command} 动作，不会调用 ctx.setUi；播放器松开后会回到绑定值`);
  }
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
type CommandShape = { command: UiEventCommand; commandTarget?: string; page?: string; action?: string; resultEvent?: string; binding?: string | null; slot?: string; color?: string | null; colorVariable?: string; channel?: 'text' | 'voice'; locale?: string | null };
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
    case 'quit': return 'ctx.quit();';
    case 'locale': return `ctx.locale(${JSON.stringify(event.channel)}, ${event.locale === null || event.locale === undefined ? 'null' : JSON.stringify(event.locale)});`;
  }
}
function appendEvent(sources: Sources, design: UiDesign, target: string, name: string, body: string): void {
  const file = readStory(sources).scripts.at(-1); if (!file || !sources.has(file)) throw new Error('缺少可追加的已声明脚本');
  sources.set(file, sources.get(file)! + `\nui(${JSON.stringify(target)}).bind(${JSON.stringify(name)}, (ctx) => { ${body} });\n`);
  design.events.push({ name, target, file, line: sources.get(file)!.split('\n').length, start: 0, end: 0, editable: true, command: body.includes('ctx.quit()') ? 'quit' : undefined });
}
/** Removes one recognized registration statement together with its line ending. */
function removeEventStatement(sources: Sources, event: UiEvent): void {
  const source = sources.get(event.file); if (source === undefined || !event.start || !event.end) return;
  let start = event.start, end = event.end;
  if (source.slice(end, end + 2) === '\r\n') end += 2; else if (source[end] === '\n') end += 1;
  else if (start >= 2 && source.slice(start - 2, start) === '\r\n') start -= 2;
  else if (start >= 1 && source[start - 1] === '\n') start -= 1;
  sources.set(event.file, source.slice(0, start) + source.slice(end));
}
/** Deleting a page/control also removes its own recognized callbacks; opaque
 * callbacks or lifecycle registrations still block the delete. */
function removeTargetEvents(sources: Sources, design: UiDesign, targets: Set<string>): void {
  const list = design.events.filter(item => targets.has(item.target));
  for (const event of list) if (!event.editable) throw new Error(`事件 ${event.target} · ${event.name} 由自定义逻辑维护，不能随控件删除`);
  // Remove from the end so earlier source ranges stay valid.
  for (const event of [...list].sort((a, b) => b.start - a.start)) removeEventStatement(sources, event);
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
    patchAttrs(sources, op.id, patch, UI_ATTRIBUTES[at.node.tag as UiKind]); selected = op.id;
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
    // The page and every control it owns lose their recognized callbacks with it.
    removeTargetEvents(sources, design, new Set([id, ...uiNodes(page.children).map(node => node.id)]));
    const at = locateUi(sources, id, true); sources.set(at.file, sources.get(at.file)!.slice(0, at.node.start) + sources.get(at.file)!.slice(at.node.end)); screen = design.initial;
  } else if (op.action === 'addNode') {
    const kind = str(op.kind) as UiKind; if (!(UI_KINDS as readonly string[]).includes(kind)) throw new Error('未知 UI 控件类型');
    const page = design.screens.find(s => s.id === str(op.screen)); if (!page) throw new Error('页面不存在'); screen = page.id;
    const at = op.parent ? locateUi(sources, str(op.parent)) : locateUi(sources, page.id, true);
    if (op.parent && (!uiNodes(page.children).some(n => n.id === op.parent) || !UI_CONTAINERS.includes(at.node.tag))) throw new Error('请选择当前页面中的容器作为父级');
    if (kind === 'color-picker' && (op.parent && insideRepeat(page.children, op.parent))) throw new Error('color-picker 不能放在 repeat 中');
    const pickerAlpha = op.alpha !== 'false';
    const attrs: Record<string, string> = { id: newShortId(uiIds(design)), x: '24', y: '24', width: kind === 'scene' ? String(design.width) : kind === 'color-picker' ? '256' : '240', height: kind === 'scene' ? String(design.height) : kind === 'color-picker' ? (pickerAlpha ? '282' : '256') : kind === 'panel' || kind === 'repeat' || kind === 'nine-patch' ? '160' : '48' };
    if (['label', 'button', 'toggle'].includes(kind)) attrs.text = kind === 'label' ? '新的文字' : kind === 'button' ? '按钮' : '开关';
    if (kind === 'panel') attrs.color = '#263B4B';
    if (['image', 'nine-patch'].includes(kind)) { const asset = readStory(sources).assets.find(a => a.id === op.image && a.kind === (kind === 'nine-patch' ? 'nine-patch' : 'image')); if (!asset) throw new Error('请先选择已导入的对应图片资源'); attrs.image = asset.id; }
    if (['button', 'toggle', 'slider'].includes(kind) && op.event) {
      // v0.11.0 binds callbacks to one target. Reuse a proven fixed callback by
      // duplicating it onto the new control instead of leaving an unbound XML event.
      const source = typeof op.eventTarget === 'string' ? design.events.find(event => event.target === op.eventTarget && event.name === op.event) : undefined;
      if (!source || !source.editable || !source.command) throw new Error('请选择一个可复制的已注册事件（目标 + 事件名）；引擎要求每个控件事件各自绑定');
      attrs.event = op.event;
      appendEvent(sources, design, attrs.id, op.event, commandBody(source as CommandShape));
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
        const source = typeof op.eventTarget === 'string' ? design.events.find(event => event.target === op.eventTarget && event.name === op.event) : undefined;
        if (!source || !source.editable || !source.command) throw new Error('color-picker 需要可复制的已注册更新事件');
        attrs.event = op.event;
        appendEvent(sources, design, attrs.id, op.event, commandBody(source as CommandShape));
      } else {
        // Engine pickers only propose a color; the bound UI string changes only when an
        // event calls ctx.setUi. Create that minimal handler so a new picker works.
        const base = `color-${attrs.id}`;
        let eventName = base;
        for (let index = 2; design.events.some(event => event.target === attrs.id && event.name === eventName); index++) eventName = `${base}-${index}`;
        appendEvent(sources, design, attrs.id, eventName, `ctx.setUi(${JSON.stringify(value.slice(3))}, ctx.value);`);
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
      // A v0.11.0 callback belongs to this target; remove its recognized events with the control.
      removeTargetEvents(sources, design, new Set(uiNodes([moving]).map(node => node.id)));
      sources.set(at.file, source.slice(0, at.node.start) + source.slice(at.node.end));
    }
    else {
      let markup = source.slice(at.node.start, at.node.end); const ids = uiNodes([moving]).map(n => n.id);
      const used = uiIds(design), mapping = new Map<string, string>();
      for (const id of ids) { const local: XmlNode[] = []; const find = (n: XmlNode) => { if (n.attrs.id === id) local.push(n); n.children.forEach(find); }; find(parseXml(markup)); const fresh = newShortId(used); used.add(fresh); mapping.set(id, fresh); markup = setAttribute(markup, local[0], 'id', fresh); if (id === op.id) selected = fresh; }
      sources.set(at.file, source.slice(0, at.node.end) + '\n' + markup + source.slice(at.node.end));
      // Duplicated interactive controls need their own target-scoped registrations.
      for (const [oldId, newId] of mapping) {
        const original = design.screens.flatMap(s => uiNodes(s.children)).find(n => n.id === oldId);
        const eventName = original?.attrs.event; if (!eventName) continue;
        const registration = design.events.find(item => item.target === oldId && item.name === eventName);
        if (!registration || !registration.editable || !registration.command) throw new Error(`控件 ${oldId} 的事件 ${eventName} 由自定义逻辑维护，复制后无法自动绑定；请先处理该事件`);
        appendEvent(sources, design, newId, eventName, commandBody(registration as CommandShape));
      }
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
      // The generated confirm button is a new target, so copy a proven fixed callback
      // from the chosen source registration onto it.
      const source = typeof op.eventTarget === 'string' ? design.events.find(item => item.target === op.eventTarget && item.name === event) : undefined;
      if (!source || !source.editable || !source.command) throw new Error('弹窗确认事件必须是可复制的固定回调，请选择目标与事件名');
      appendEvent(sources, design, confirmId, event, commandBody(source as CommandShape));
    }
    if (accept === 'quit') {
      event = 'quit-confirm';
      for (let index = 2; design.events.some(item => item.target === confirmId && item.name === event); index++) event = `quit-confirm-${index}`;
      appendEvent(sources, design, confirmId, event, 'ctx.quit();');
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
    const bindingKeys = ['bind', 'value', 'visible', 'enabled', 'image-bind', 'region-bind', 'color-bind', 'text-key-bind'];
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
    const name = str(op.name, 128), target = str(op.target, 128);
    if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(name)) throw new Error('事件名须由英文、数字、点、下划线或连字符组成');
    const virtual = virtualTargets.has(target);
    if (!virtual) {
      const exists = design.screens.some(s => s.id === target) || design.screens.some(s => uiNodes(s.children).some(n => n.id === target));
      if (!exists) throw new Error('注册目标控件或页面不存在');
      if (name === 'game.enter' || prefixLifecycle(name)) throw new Error('screen.open / screen.close 请用生命周期编辑；普通事件不能使用保留名称');
    } else if (target === '$game') {
      if (name !== 'game.enter') throw new Error('$game 只接受 game.enter');
    } else if (name === 'game.enter' || prefixLifecycle(name)) throw new Error('$host 只接受非保留的捕获结果事件名');
    const original = typeof op.original === 'string' && op.original ? str(op.original, 128) : undefined;
    const identity = original === undefined ? undefined : `${target}\0${original}`;
    if (design.events.some(e => `${e.target}\0${e.name}` === `${target}\0${name}` && `${e.target}\0${e.name}` !== identity)) throw new Error('同一目标已存在此事件名');
    const matches = original !== undefined ? design.events.filter(e => e.target === target && e.name === original) : [];
    if (original !== undefined && matches.length !== 1) throw new Error(matches.length ? '存在重复注册，请先处理源码' : '要修改的事件已不存在，请刷新');
    if (original !== undefined && !matches[0].editable) throw new Error(matches[0].reason ?? '该事件由自定义逻辑维护，不能可视化修改');
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
      if (!resultEvent || !design.events.some(item => item.target === '$host' && item.name === resultEvent)) throw new Error('快捷键捕获结果事件必须注册在 $host');
      if (target === '$host' && resultEvent === name) throw new Error('快捷键捕获结果事件不能指向自身');
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
    else if (!['close', 'advance', 'choose', 'soundEnabled', 'cancelShortcutCapture', 'resetKeybindings', 'resetColors', 'quit'].includes(op.command)) throw new Error('不支持的事件动作');
    const body = commandBody(shape);
    if (original !== undefined) {
      const event = matches[0], source = sources.get(event.file)!;
      sources.set(event.file, source.slice(0, event.start) + `ui(${JSON.stringify(target)}).bind(${JSON.stringify(name)}, (ctx) => { ${body} });` + source.slice(event.end));
      if (name !== original) {
        // Only this target's XML event changes; other targets may keep the same event name.
        if (design.screens.some(s => s.id === target)) {
          const page = design.screens.find(s => s.id === target)!;
          for (const key of ['background-click', 'background-right-click'] as const) if (page.attrs[key] === original) patchAttrs(sources, page.id, { [key]: name }, [key], true);
        } else if (design.screens.some(s => uiNodes(s.children).some(n => n.id === target))) patchAttrs(sources, target, { event: name }, ['event']);
      }
    } else appendEvent(sources, design, target, name, body);
  } else if (op.action === 'deleteEvent') {
    const name = str(op.name, 128), target = str(op.target, 128), matches = design.events.filter(e => e.target === target && e.name === name);
    if (matches.length !== 1) throw new Error(matches.length ? '存在重复注册，请先处理源码' : '要删除的事件已不存在，请刷新');
    const event = matches[0];
    if (!event.editable) throw new Error(event.reason ?? '该事件由自定义逻辑维护，不能删除');
    const page = design.screens.find(s => s.id === target);
    const control = design.screens.flatMap(s => uiNodes(s.children)).find(n => n.id === target);
    if (page && ['background-click', 'background-right-click'].some(key => page.attrs[key] === name) || control?.attrs.event === name) throw new Error('仍有控件或页面背景引用此事件，请先把相关事件改为其他动作');
    if (target === '$host' && design.events.some(item => item.command === 'captureShortcut' && item.resultEvent === name)) throw new Error('仍有快捷键捕获指向此结果事件，请先修改或删除捕获事件');
    const source = sources.get(event.file)!;
    let start = event.start, end = event.end;
    if (source.slice(end, end + 2) === '\r\n') end += 2; else if (source[end] === '\n') end += 1;
    else if (start >= 2 && source.slice(start - 2, start) === '\r\n') start -= 2;
    else if (start >= 1 && source[start - 1] === '\n') start -= 1;
    sources.set(event.file, source.slice(0, start) + source.slice(end));
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
