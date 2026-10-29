import { parse, tokenizer } from 'acorn';
import type { Expr, Route, Span, Story } from '../../domain/src/index';
import { validateRoutes, routeDestinations } from '../../domain/src/index';
import { emitExpression, emitRoutes, emitRouteBody, readDecision, MANAGED_HEADER } from './routes';
import type { Sources } from './index';
import { uiFragments } from './ui-files';

type Node = Record<string, any> & Span;
export interface LogicLocation { file: string; line: number; start: number; end: number }
export interface LogicFrame { editable: boolean; reason?: string; locations: LogicLocation[] }
export interface LogicSummary { frames: Record<string, LogicFrame>; links: Route[]; issues: string[]; complete: boolean }
export type LifecycleKind = 'frameEnter' | 'frameExit' | 'screenOpen' | 'screenClose';
export interface LogicLifecycle extends LogicLocation { kind: LifecycleKind; target: string; dynamic?: boolean }
export interface LogicReferences { frames: Set<string>; screens: Set<string>; dynamicFrames: boolean }
interface Registration {
  frame: string; kind: Route['kind']; option?: string; file: string; statement: Node; call: Node;
  route?: Route; target?: Node; context?: string; callback?: Node; updates?: Node[]; guard?: Node;
  branchNodes?: { when: Node; target: Node }[];
}
export interface LogicAnalysis extends LogicSummary {
  registrationUncertain: boolean;
  screenIssues: string[];
  routes: Route[]; records: Registration[]; appendFile?: string;
  /** v0.9.0 on.frameEnter/Exit and on.screenOpen/Close; they never become story route edges. */
  lifecycle: LogicLifecycle[];
  /** Frames/screens mentioned by lifecycle or ctx.resume/ctx.present; used to block unsafe deletion. */
  references: LogicReferences;
}
export function protectedLogicTargets(analysis: LogicAnalysis): Set<string> | undefined {
  const opaque = analysis.links.filter(r => !analysis.frames[r.frame]?.editable && r.kind !== 'end');
  return opaque.some(r => r.dynamic || !r.target) ? undefined : new Set(opaque.flatMap(routeDestinations).map(d => d.target!));
}
const methods = new Set(['advance', 'choice', 'end']);
const lifecycleMethods = new Set<LifecycleKind>(['frameEnter', 'frameExit', 'screenOpen', 'screenClose']);
const key = (r: Pick<Route, 'frame' | 'kind' | 'option'>) => `${r.frame}\0${r.kind}\0${r.option ?? ''}`;
function member(n: Node | undefined): string | undefined {
  if (n?.type !== 'MemberExpression' || n.optional) return;
  return n.computed ? n.property.type === 'Literal' && typeof n.property.value === 'string' ? n.property.value : undefined : n.property.name;
}
function children(n: Node): Node[] {
  return Object.entries(n).filter(([k]) => !['loc', 'start', 'end'].includes(k)).flatMap(([, v]) => Array.isArray(v) ? v.filter(x => x?.type) : v?.type ? [v] : []);
}
function walk(root: Node, visit: (node: Node, parent?: Node) => boolean | void): void {
  const stack: [Node, Node?][] = [[root]]; let budget = 100000;
  while (stack.length) { if (!--budget) throw new Error('脚本语法节点超过分析预算'); const [n, p] = stack.pop()!; if (visit(n, p) !== false) for (const c of children(n).reverse()) stack.push([c, n]); }
}
function staticString(n: Node | undefined, constants: Map<string, Node>, seen = new Set<string>()): string | undefined {
  if (!n || seen.size > 32) return;
  if (n.type === 'Literal' && typeof n.value === 'string') return n.value;
  if (n.type === 'Identifier' && constants.has(n.name) && !seen.has(n.name)) return staticString(constants.get(n.name), constants, new Set([...seen, n.name]));
  if (n.type === 'TemplateLiteral') {
    let result = n.quasis[0].value.cooked;
    for (let i = 0; i < n.expressions.length; i++) { const s = staticString(n.expressions[i], constants, seen); if (s === undefined) return; result += s + n.quasis[i + 1].value.cooked; }
    return result;
  }
  if (n.type === 'BinaryExpression' && n.operator === '+') { const a = staticString(n.left, constants, seen), b = staticString(n.right, constants, seen); if (a !== undefined && b !== undefined) return a + b; }
}
function expression(n: Node, context: string, allowNumber = false): Expr {
  if (n.type === 'Literal') {
    if (typeof n.value === 'bigint') return { kind: 'constant', type: 'int', value: String(n.value) };
    if (allowNumber && typeof n.value === 'number' && Number.isSafeInteger(n.value)) return { kind: 'constant', type: 'int', value: String(n.value) };
    if (typeof n.value === 'string' || typeof n.value === 'boolean') return { kind: 'constant', type: typeof n.value === 'string' ? 'string' : 'bool', value: String(n.value) };
  }
  if (n.type === 'UnaryExpression' && n.operator === '-' && ['bigint', 'number'].includes(typeof n.argument?.value)) { const v = expression(n.argument, context, allowNumber); return { ...v, value: `-${(v as { value: string }).value}` } as Expr; }
  if (n.type === 'UnaryExpression' && n.operator === '!') return { kind: 'not', value: expression(n.argument, context) };
  if (n.type === 'MemberExpression' && member(n.object) === 'vars' && n.object.object?.name === context && member(n)) return { kind: 'variable', id: member(n)! };
  if (n.type === 'BinaryExpression' && ['===', '!==', '<', '<=', '>', '>='].includes(n.operator)) { const numeric = !['===', '!=='].includes(n.operator); return { kind: 'compare', op: n.operator, left: expression(n.left, context, numeric), right: expression(n.right, context, numeric) }; }
  if (n.type === 'LogicalExpression' && ['&&', '||'].includes(n.operator)) return { kind: n.operator === '&&' ? 'and' : 'or', left: expression(n.left, context), right: expression(n.right, context) };
  throw new Error('条件或变量更新包含自定义表达式');
}
function callback(n: Node): string {
  if (!['ArrowFunctionExpression', 'FunctionExpression'].includes(n?.type) || n.async || n.generator || n.params.length > 1 || (n.params.length && n.params[0].type !== 'Identifier')) throw new Error('共享函数或自定义回调保留原文');
  return n.params[0]?.name ?? 'ctx';
}
function freshContext(source: string): string { let name = '_kakeraCtx'; while (source.includes(name)) name += '_'; return name; }
function bodyValue(n: Node): Node {
  if (n.body.type !== 'BlockStatement') return n.body;
  if (n.body.body.length === 1 && n.body.body[0].type === 'ReturnStatement') return n.body.body[0].argument;
  throw new Error('条件包含自定义语句');
}
/** Static only: never execute scripts, callbacks or helper functions in the host. */
export function analyzeLogic(sources: Sources, story: Story): LogicAnalysis {
  const aliases = new Map(story.frames.flatMap(f => [f.ref, f.id, f.name].filter((s): s is string => !!s).map(s => [s, f.ref])));
  const frames: Record<string, LogicFrame> = Object.create(null), records: Registration[] = [], links: Route[] = [], issues: string[] = [];
  const lifecycle: LogicLifecycle[] = [], references: LogicReferences = { frames: new Set<string>(), screens: new Set<string>(), dynamicFrames: false };
  const screenIssues: string[] = [];
  let screens: Set<string> | undefined;
  try { screens = new Set(uiFragments(sources).flatMap(f => f.root.children.filter(n => n.tag === 'screen').map(n => n.attrs.id))); }
  catch { /* Invalid/incomplete UI is diagnosed by the UI reader; do not report every target as missing. */ }
  const screenIssue = (message: string) => { screenIssues.push(message); issues.push(message); };
  for (const f of story.frames) frames[f.ref] = { editable: false, locations: [] };
  let globalReason: string | undefined;
  for (const file of [...new Set(story.scripts)]) {
    const source = sources.get(file); if (source === undefined) continue;
    try {
      if (source.length > 2 * 1024 * 1024) throw new Error('脚本超过 2MiB 静态分析预算');
      const ast = parse(source, { ecmaVersion: 2022, locations: true }) as unknown as Node;
      const constants = new Map<string, Node>(), functions = new Map<string, Node>(), written = new Set<string>();
      for (const s of ast.body) {
        if (s.type === 'VariableDeclaration' && s.kind === 'const') for (const d of s.declarations) if (d.id.type === 'Identifier' && d.init) constants.set(d.id.name, d.init);
        if (s.type === 'FunctionDeclaration' && s.id) functions.set(s.id.name, s);
      }
      walk(ast, n => { if (n.type === 'AssignmentExpression' || n.type === 'UpdateExpression') walk(n.left ?? n.argument, x => { if (x.type === 'Identifier') written.add(x.name); }); });
      for (const name of written) { constants.delete(name); functions.delete(name); }
      const top = new Map<Node, Node>(ast.body.filter((s: Node) => s.type === 'ExpressionStatement').map((s: Node) => [s.expression, s]));
      const parents = new Map<Node, Node>(); walk(ast, (n, parent) => { if (parent) parents.set(n, parent); });
      const referenceConstants = (node: Node) => {
        const visible = new Map(constants);
        const hide = (pattern?: Node) => { if (pattern) walk(pattern, n => { if (n.type === 'Identifier') visible.delete(n.name); }); };
        for (let scope = parents.get(node); scope && scope !== ast; scope = parents.get(scope)) {
          if (['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'].includes(scope.type)) { scope.params.forEach(hide); hide(scope.id); }
          if (scope.type === 'CatchClause') hide(scope.param);
          const declarations = scope.type === 'BlockStatement' ? scope.body : scope.type === 'ForStatement' ? [scope.init] : ['ForInStatement', 'ForOfStatement'].includes(scope.type) ? [scope.left] : [];
          for (const declaration of declarations) {
            if (declaration?.type === 'VariableDeclaration') declaration.declarations.forEach((d: Node) => hide(d.id));
            if (declaration?.type === 'FunctionDeclaration' || declaration?.type === 'ClassDeclaration') hide(declaration.id);
          }
        }
        return visible;
      };
      const markGlobal = (reason: string) => { globalReason = `${file}：${reason}`; };
      walk(ast, (n, parent) => {
        // v0.9.0 handoff commands mention frames/screens but are not story routes.
        // Collect their static targets so deleting a referenced frame/screen stays blocked.
        if (n.type === 'CallExpression' && n.callee?.type === 'MemberExpression' && !n.callee.optional) {
          const callee = member(n.callee);
          if ((callee === 'resume' || callee === 'present') && n.callee.object?.type === 'Identifier' && n.callee.object.name !== 'on' && (n.arguments[0] || callee === 'present')) {
            const raw = staticString(n.arguments[0], referenceConstants(n));
            if (raw !== undefined) {
              if (callee === 'resume') {
                const target = aliases.get(raw) ?? raw;
                if (story.frames.some(f => f.ref === target)) references.frames.add(target);
                else issues.push(`${file}:${n.loc.start.line} UI 返回目标不存在：${raw}`);
              } else {
                references.screens.add(raw);
                if (screens && !screens.has(raw)) screenIssue(`${file}:${n.loc.start.line} UI 交接目标页面不存在：${raw}`);
              }
            } else if (callee === 'resume') {
              references.dynamicFrames = true;
              issues.push(`${file}:${n.loc.start.line} UI 返回目标不确定；删除幕需先查看源码`);
            } else screenIssue(`${file}:${n.loc.start.line} UI 交接目标页面不确定；请查看源码`);
          }
        }
        // An engine registration object must never be inferred through aliases,
        // reassignment, optional calls or executable registration factories.
        if (n.type === 'Identifier' && n.name === 'on') {
          if (!(parent?.type === 'MemberExpression' && parent.object === n && ['advance', 'choice', 'end', 'ui', ...lifecycleMethods].includes(member(parent) ?? ''))) markGlobal('注册对象存在别名、重定义或动态访问');
        }
        if (n.type === 'Identifier' && ['eval', 'Function'].includes(n.name)) markGlobal('包含动态代码执行，无法证明全部注册关系');
        if (n.type === 'MemberExpression' && (member(n) === 'constructor' || n.object?.name === 'globalThis')) markGlobal('包含全局或间接注册访问，无法证明全部注册关系');
        if (n.type !== 'MemberExpression' || n.object?.name !== 'on') return;
        const kind = member(n);
        if (parent?.type !== 'CallExpression' || parent.callee !== n || parent.optional) { markGlobal('注册方法存在间接调用或修改'); return; }
        if (kind && lifecycleMethods.has(kind as LifecycleKind)) {
          const call = parent, raw = staticString(call.arguments[0], top.has(call) ? constants : new Map()), statement = top.get(call) ?? call;
          const entry: LogicLifecycle = { kind: kind as LifecycleKind, target: raw ?? '', file, line: call.loc.start.line, start: statement.start, end: statement.end, ...(raw === undefined ? { dynamic: true } : {}) };
          lifecycle.push(entry);
          if (raw === undefined) {
            if (kind === 'frameEnter' || kind === 'frameExit') references.dynamicFrames = true;
            const message = `${file}:${call.loc.start.line} 生命周期目标不确定；删除相关幕或页面需先查看源码`;
            if (kind === 'screenOpen' || kind === 'screenClose') screenIssue(message); else issues.push(message);
          } else if (kind === 'frameEnter' || kind === 'frameExit') {
            const ref = aliases.get(raw);
            if (!ref) issues.push(`${file}:${call.loc.start.line} 生命周期幕不存在：${raw}`);
            else {
              references.frames.add(ref);
              frames[ref].locations.push({ file, line: call.loc.start.line, start: statement.start, end: statement.end });
            }
          } else {
            references.screens.add(raw);
            if (screens && !screens.has(raw)) screenIssue(`${file}:${call.loc.start.line} 生命周期页面不存在：${raw}`);
          }
          return;
        }
        if (!kind || !methods.has(kind)) return;
        const call = parent, rawFrame = staticString(call.arguments[0], top.has(call) ? constants : new Map()), frame = rawFrame && aliases.get(rawFrame);
        if (!rawFrame) { markGlobal('存在动态幕注册；已知连线仍显示，自动改线暂停'); return; }
        if (!frame) { issues.push(`${file}:${call.loc.start.line} 注册的幕不存在：${rawFrame}`); return; }
        const option = kind === 'choice' ? staticString(call.arguments[1], constants) : undefined;
        const statement = top.get(call) ?? call;
        const record: Registration = { frame, kind: kind as Route['kind'], option, file, statement, call }; records.push(record);
        frames[frame].locations.push({ file, line: call.loc.start.line, start: statement.start, end: statement.end });
        let reason: string | undefined;
        try {
          if (!top.has(call)) throw new Error('注册位于函数、循环或条件中');
          if (kind === 'choice' && option === undefined) throw new Error('选项 ID 是动态表达式');
          const route: Route = { frame, kind: kind as Route['kind'], ...(option !== undefined ? { option } : {}), updates: [] };
          if (kind === 'end') { if (call.arguments.length !== 1) throw new Error('结束注册参数不确定'); }
          else {
            const index = kind === 'choice' ? 2 : 1, cb = call.arguments[index]; callback(cb);
            const context = cb.params[0]?.name ?? freshContext(source);
            record.context = context; record.callback = cb;
            const statements = cb.body.type === 'BlockStatement' ? cb.body.body.filter((s: Node) => s.type !== 'EmptyStatement') : [];
            const localConstants = new Map(constants); for (const p of cb.params) localConstants.delete(p.name); if (cb.id) localConstants.delete(cb.id.name);
            const decisionStart = statements.findIndex((s: Node) => s.type === 'IfStatement' || s.type === 'ReturnStatement');
            const decision = readDecision(cb.body.type === 'BlockStatement' ? statements.slice(decisionStart < 0 ? statements.length : decisionStart) : [{ type: 'ReturnStatement', argument: cb.body }],
              node => expression(node as Node, context), node => { const value = staticString(node as Node, localConstants); if (value === undefined) throw new Error('后续目标由条件或自定义逻辑决定'); return aliases.get(value) ?? value; });
            record.target = decision.targetNode as Node; route.target = decision.target;
            record.branchNodes = decision.branchNodes as Registration['branchNodes'];
            if (decision.branches.length) route.branches = decision.branches;
            record.updates = decisionStart < 0 ? [] : statements.slice(0, decisionStart);
            route.updates = record.updates!.map(s => {
              const c = s.expression, op = member(c?.callee);
              if (s.type !== 'ExpressionStatement' || c?.type !== 'CallExpression' || c.optional || c.callee.object?.name !== context || !['set', 'add'].includes(op ?? '') || c.arguments.length !== 2) throw new Error('回调包含自定义语句');
              const variable = staticString(c.arguments[0], localConstants); if (variable === undefined) throw new Error('变量 ID 不确定');
              if (!cb.params.length) throw new Error('更新回调缺少上下文参数');
              return { op: op as 'set' | 'add', variable, value: expression(c.arguments[1], context, true) };
            });
            if (call.arguments[index + 1]) { const guard = call.arguments[index + 1]; callback(guard); route.guard = expression(bodyValue(guard), guard.params[0]?.name ?? ''); record.guard = guard; }
            if (call.arguments.length > index + 2 || (kind === 'advance' && route.guard)) throw new Error('注册包含额外参数');
          }
          // Validate each record independently, and ownership as a group below.
          const f = story.frames.find(f => f.ref === frame)!;
          validateRoutes({ ...story, frames: story.frames.map(frame => frame === f ? { ...f, options: route.kind === 'choice' ? f.options.filter(o => o.id === option) : [] } : frame) }, [route], true);
          record.route = route;
        } catch (e) { reason = e instanceof Error ? e.message : '无法识别此注册'; }
        if (record.route) links.push(record.route);
        else {
          frames[frame].reason = reason;
          const base: Route = { frame, kind: kind as Route['kind'], option, updates: [], conditional: true };
          if (kind === 'end') links.push(base);
          else {
            const value = call.arguments[kind === 'choice' ? 2 : 1];
            const fn = value?.type === 'Identifier' ? functions.get(value.name) ?? constants.get(value.name) : value;
            const targetConstants = new Map(constants);
            if (fn) { for (const p of fn.params ?? []) if (p.name) targetConstants.delete(p.name); if (fn.id) targetConstants.delete(fn.id.name); if (fn.body) walk(fn.body, n => { if (n.type === 'VariableDeclarator') walk(n.id, id => { if (id.type === 'Identifier') targetConstants.delete(id.name); }); }); }
            const targets = new Set<string>(); let unknown = false;
            const target = (value?: Node) => {
              if (value?.type === 'ConditionalExpression') { target(value.consequent); target(value.alternate); return; }
              const s = staticString(value, targetConstants); if (s === undefined) unknown = true; else targets.add(aliases.get(s) ?? s);
            };
            if (fn && ['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'].includes(fn.type)) {
              if (fn.body.type !== 'BlockStatement') target(fn.body);
              else {
                let returns = 0;
                walk(fn.body, n => { if (['FunctionExpression', 'FunctionDeclaration', 'ArrowFunctionExpression'].includes(n.type)) return false; if (n.type === 'ReturnStatement') { returns++; target(n.argument); } });
                if (!returns || fn.body.body.at(-1)?.type !== 'ReturnStatement') unknown = true;
              }
            } else unknown = true;
            for (const target of targets) links.push({ ...base, target });
            if (unknown || !targets.size) links.push({ ...base, dynamic: true });
          }
        }
      });
    } catch (e) { const message = `${file}：${e instanceof Error ? e.message : '脚本分析失败'}`; issues.push(message); globalReason = message; }
  }
  const routes: Route[] = [];
  for (const f of story.frames) {
    const owned = records.filter(r => r.frame === f.ref);
    try {
      if (globalReason) throw new Error(globalReason);
      if (!owned.length) throw new Error('尚未找到此幕的固定路由注册');
      if (owned.some(r => !r.route)) throw new Error(frames[f.ref].reason ?? '此幕包含自定义路由');
      validateRoutes(story, owned.map(r => r.route!), true);
      frames[f.ref].editable = true; delete frames[f.ref].reason; routes.push(...owned.map(r => r.route!));
    } catch (e) { frames[f.ref].reason = e instanceof Error ? e.message : '路由不一致'; }
    // Every XML option is represented, including missing/temporarily broken JS.
    for (const option of f.options.length ? f.options : [{ id: undefined }]) if (!links.some(r => r.frame === f.ref && (f.options.length ? r.option === option.id : true))) links.push({ frame: f.ref, kind: f.options.length ? 'choice' : 'advance', option: option.id, updates: [], dynamic: true });
  }
  if (globalReason && !issues.includes(globalReason)) issues.push(globalReason);
  return { frames, links, issues, screenIssues, registrationUncertain: !!globalReason, routes, records, lifecycle, references, complete: story.frames.every(f => frames[f.ref].editable), appendFile: records.find(r => frames[r.frame]?.editable)?.file };
}

/** Apply only mapped syntax ranges; all unrelated code and comments remain bytes. */
export function patchLogicRoutes(sources: Sources, analysis: LogicAnalysis, routes: Route[], preferredFile?: string): Sources {
  const changes: Sources = new Map(), patches = new Map<string, (Span & { text: string })[]>();
  const add = (file: string, node: Span, text: string) => { const list = patches.get(file) ?? []; list.push({ start: node.start, end: node.end, text }); patches.set(file, list); };
  const next = new Map(routes.map(r => [key(r), r]));
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const bound = new Set<Node>();
  const bindContext = (file: string, cb: Node, context: string) => {
    if (cb.params.length || bound.has(cb)) return;
    bound.add(cb);
    const tokens = [...tokenizer(sources.get(file)!.slice(cb.start, cb.body.start), { ecmaVersion: 2022 })];
    const open = tokens.find(t => t.type.label === '('); if (!open) throw new Error('无法定位回调参数');
    add(file, { start: cb.start + open.end, end: cb.start + open.end }, context);
  };
  for (const record of analysis.records.filter(r => analysis.frames[r.frame]?.editable)) {
    const before = record.route!, after = next.get(key(before)); next.delete(key(before));
    if (!after) { add(record.file, record.statement, ''); continue; }
    if (same(before, after)) continue;
    if (before.kind === 'end') continue;
    const cb = record.callback!, context = record.context!;
    if (before.branches?.length || after.branches?.length) {
      if ((before.branches?.length ?? 0) === (after.branches?.length ?? 0) && same(before.updates, after.updates)) {
        if (before.target !== after.target) add(record.file, record.target!, JSON.stringify(after.target));
        for (let i = 0; i < (after.branches?.length ?? 0); i++) {
          const old = before.branches![i], branch = after.branches![i], nodes = record.branchNodes![i];
          if (old.target !== branch.target) add(record.file, nodes.target, JSON.stringify(branch.target));
          if (!same(old.when, branch.when)) { bindContext(record.file, cb, context); add(record.file, nodes.when, emitExpression(branch.when, context)); }
        }
      } else {
        bindContext(record.file, cb, context);
        // A structural decision edit replaces only this recognized callback body.
        // Keep every author comment, including comments among the old branches.
        const oldBody = sources.get(record.file)!.slice(cb.body.start, cb.body.end), comments: string[] = [];
        const tokens = tokenizer(oldBody, { ecmaVersion: 2022, onComment: (_block, _value, start, end) => { comments.push(oldBody.slice(start, end)); } });
        while (tokens.getToken().type.label !== 'eof') { /* tokenize, never execute */ }
        add(record.file, cb.body, `{\n${comments.map(c => `  ${c}\n`).join('')}${emitRouteBody(after, context)}\n}`);
      }
    } else {
      if (before.target !== after.target) add(record.file, record.target!, JSON.stringify(after.target));
      if (!same(before.updates, after.updates)) {
        if (after.updates.length) bindContext(record.file, cb, context);
        if (cb.body.type !== 'BlockStatement') {
          // One callback replacement also includes its target patch.
          const list = patches.get(record.file) ?? []; patches.set(record.file, list.filter(p => p.start !== record.target!.start));
          add(record.file, cb.body, `{\n${after.updates.map(u => `  ${context}.${u.op}(${JSON.stringify(u.variable)}, ${emitExpression(u.value, context)});`).join('\n')}\n  return ${JSON.stringify(after.target)};\n}`);
        } else {
          const updates = record.updates!;
          for (let i = 0; i < updates.length; i++) {
            const old = updates[i], u = after.updates[i];
            if (!u) add(record.file, old, '');
            else {
              const call = old.expression, oldUpdate = before.updates[i];
              if (oldUpdate.op !== u.op) add(record.file, call.callee.property, call.callee.computed ? JSON.stringify(u.op) : u.op);
              if (oldUpdate.variable !== u.variable) add(record.file, call.arguments[0], JSON.stringify(u.variable));
              if (!same(oldUpdate.value, u.value)) add(record.file, call.arguments[1], emitExpression(u.value, context));
            }
          }
          if (after.updates.length > updates.length) { const position = cb.body.body.findLast((s: Node) => s.type === 'ReturnStatement').start; add(record.file, { start: position, end: position }, after.updates.slice(updates.length).map(u => `${context}.${u.op}(${JSON.stringify(u.variable)}, ${emitExpression(u.value, context)});\n  `).join('')); }
        }
      }
    }
    if (!same(before.guard, after.guard)) {
      const guard = record.guard;
      if (guard && after.guard) { const context = guard.params[0]?.name ?? freshContext(sources.get(record.file)!); bindContext(record.file, guard, context); add(record.file, bodyValue(guard), emitExpression(after.guard, context)); }
      else if (guard) add(record.file, { start: cb.end, end: guard.end }, '');
      else if (after.guard) add(record.file, { start: cb.end, end: cb.end }, `, (ctx) => ${emitExpression(after.guard)}`);
    }
  }
  if (next.size) {
    const file = preferredFile ?? analysis.appendFile;
    if (!file || !sources.has(file)) throw new Error('没有可写的剧情注册位置');
    add(file, { start: sources.get(file)!.length, end: sources.get(file)!.length }, '\n' + emitRoutes([...next.values()]).slice(MANAGED_HEADER.length));
  }
  for (const [file, list] of patches) {
    let source = sources.get(file)!, boundary = source.length;
    for (const patch of list.sort((a, b) => b.start - a.start || b.end - a.end)) {
      if (patch.end > boundary) throw new Error('路由范围发生冲突，请刷新');
      source = source.slice(0, patch.start) + patch.text + source.slice(patch.end); boundary = patch.start;
    }
    if (source !== sources.get(file)) changes.set(file, source);
  }
  return changes;
}
