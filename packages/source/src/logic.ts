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
  /** v0.11.0 selector call `frame("id")` and its argument, used for renames. */
  selector: Node; frameArg: Node;
  route?: Route; target?: Node; context?: string; callback?: Node; updates?: Node[]; guard?: Node;
  branchNodes?: { when: Node; target: Node }[];
}
export interface LogicAnalysis extends LogicSummary {
  registrationUncertain: boolean;
  screenIssues: string[];
  routes: Route[]; records: Registration[]; appendFile?: string;
  /** frame(id).enter/exit and ui(id).bind("screen.open"/"screen.close"); never story route edges. */
  lifecycle: LogicLifecycle[];
  /** Frames/screens mentioned by lifecycle or ctx.resume/ctx.present; used to block unsafe deletion. */
  references: LogicReferences;
}
export function protectedLogicTargets(analysis: LogicAnalysis): Set<string> | undefined {
  const opaque = analysis.links.filter(r => !analysis.frames[r.frame]?.editable && r.kind !== 'end');
  return opaque.some(r => r.dynamic || !r.target) ? undefined : new Set(opaque.flatMap(routeDestinations).map(d => d.target!));
}
const methods = new Set(['advance', 'choice', 'end']);
const key = (r: Pick<Route, 'frame' | 'kind' | 'option'>) => `${r.frame}\0${r.kind}\0${r.option ?? ''}`;
const legacy = (name: string) => ['advance', 'choice', 'end', 'ui', 'frameEnter', 'frameExit', 'screenOpen', 'screenClose'].includes(name);
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
function bindingNames(pattern: Node | undefined, into = new Set<string>()): Set<string> {
  if (!pattern) return into;
  if (pattern.type === 'Identifier') into.add(pattern.name);
  else if (pattern.type === 'ObjectPattern') for (const property of pattern.properties) bindingNames(property.type === 'RestElement' ? property.argument : property.value, into);
  else if (pattern.type === 'ArrayPattern') for (const element of pattern.elements) bindingNames(element, into);
  else if (pattern.type === 'AssignmentPattern') bindingNames(pattern.left, into);
  else if (pattern.type === 'RestElement') bindingNames(pattern.argument, into);
  return into;
}
/** True when `name` at this node resolves to a local binding instead of the v0.11.0 global selector. */
function shadowed(node: Node, name: string, parents: Map<Node, Node>): boolean {
  for (let scope = parents.get(node); scope; scope = parents.get(scope)) {
    if (['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'].includes(scope.type)) {
      if (scope.id?.name === name || scope.params?.some((param: Node) => bindingNames(param).has(name))) return true;
    }
    if (scope.type === 'CatchClause' && bindingNames(scope.param).has(name)) return true;
    const items = scope.type === 'ForStatement' ? [scope.init] : scope.type === 'ForInStatement' || scope.type === 'ForOfStatement' ? [scope.left] : scope.type === 'BlockStatement' || scope.type === 'Program' ? scope.body ?? [] : [];
    for (const item of items) {
      if (item?.type === 'VariableDeclaration' && item.declarations.some((declaration: Node) => bindingNames(declaration.id).has(name))) return true;
      if (['FunctionDeclaration', 'ClassDeclaration'].includes(item?.type) && item.id?.name === name) return true;
    }
  }
  return false;
}
/** Static only: never execute scripts, callbacks or helper functions in the host. */
export function analyzeLogic(sources: Sources, story: Story): LogicAnalysis {
  const frameAliases = new Map(story.frames.flatMap(f => [f.ref, f.id, f.name].filter((s): s is string => !!s).map(s => [s, f.ref])));
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
        const hide = (pattern?: Node) => { for (const name of bindingNames(pattern)) visible.delete(name); };
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
      // v0.11.0 selectors are recognized only in their canonical form. Saving,
      // aliasing or passing `frame`/`ui` is reported as uncertainty instead of guessing.
      const selectorCall = (n: Node | undefined, visible: Map<string, Node>) => {
        if (n?.type !== 'CallExpression' || n.optional || n.arguments.length !== 1) return;
        if (n.callee?.type !== 'Identifier' || !['frame', 'ui'].includes(n.callee.name) || shadowed(n.callee, n.callee.name, parents)) return;
        return { kind: n.callee.name as 'frame' | 'ui', raw: staticString(n.arguments[0], visible), arg: n.arguments[0], node: n };
      };
      const markGlobal = (reason: string) => { globalReason = `${file}：${reason}`; };
      const storyRef = (raw: string | undefined) => raw === undefined ? undefined : frameAliases.get(raw) ?? raw;
      walk(ast, (n) => {
        // v0.9.0 handoff commands mention frames/screens but are not story routes.
        // Collect their static targets so deleting a referenced frame/screen stays blocked.
        if (n.type === 'CallExpression' && n.callee?.type === 'MemberExpression' && !n.callee.optional) {
          const callee = member(n.callee);
          if ((callee === 'resume' || callee === 'present') && n.callee.object?.type === 'Identifier' && !['on', 'frame', 'ui'].includes(n.callee.object.name) && (n.arguments[0] || callee === 'present')) {
            const raw = staticString(n.arguments[0], referenceConstants(n));
            if (raw !== undefined) {
              if (callee === 'resume') {
                const target = storyRef(raw) ?? raw;
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
        if (n.type === 'Identifier' && ['eval', 'Function'].includes(n.name) && !shadowed(n, n.name, parents)) markGlobal('包含动态代码执行，无法证明全部注册关系');
        if (n.type === 'MemberExpression' && (member(n) === 'constructor' || n.object?.name === 'globalThis')) markGlobal('包含全局或间接注册访问，无法证明全部注册关系');
        // v0.11.0 removed the whole on.* table without aliases. Report the exact
        // migration form instead of silently treating those routes as custom code.
        if (n.type === 'Identifier' && n.name === 'on' && !shadowed(n, 'on', parents)) {
          const parent = parents.get(n);
          if (parent?.type === 'MemberExpression' && parent.object === n && legacy(member(parent) ?? '')) {
            const call = parents.get(parent);
            issues.push(`${file}:${n.loc.start.line} 仍使用已移除的 on.${member(parent)}；请改为 frame("幕").advance/choice/end 或 ui("目标").bind("事件", 回调)（上游 API 第 37.5 节）`);
            if (call?.type === 'CallExpression' && call.callee === parent && !call.optional) markGlobal(`第 ${n.loc.start.line} 行仍使用已移除的 on.* 注册；必须迁移到 frame()/ui() 注册后重新检查`);
            return;
          }
          if (parent?.type === 'MemberExpression' && parent.property === n && !parent.computed) return;
          if (parent?.type === 'Property' && parent.key === n && !parent.computed) return;
          if (parent?.type === 'VariableDeclarator' && parent.id === n) return;
          if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ClassDeclaration', 'ClassExpression', 'AssignmentExpression'].includes(parent?.type ?? '')) return;
          markGlobal(`第 ${n.loc?.start.line ?? 0} 行仍访问已移除的 on.* 注册对象；必须迁移到 frame()/ui() 注册后重新检查`);
          return;
        }
        if (n.type === 'Identifier' && ['frame', 'ui'].includes(n.name) && !shadowed(n, n.name, parents)) {
          const usage = parents.get(n);
          if (usage?.type === 'CallExpression' && usage.callee === n && usage.arguments.length === 1) return;
          if (usage?.type === 'MemberExpression' && usage.property === n && !usage.computed) return;
          if (usage?.type === 'Property' && usage.key === n && !usage.computed) return;
          if (usage?.type === 'VariableDeclarator' && usage.id === n) return;
          if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(usage?.type ?? '')) return;
          markGlobal(`${n.name}() 选择器存在别名、重定义或动态调用，无法证明全部注册关系`);
          return;
        }
        const selector = n.type === 'CallExpression' ? selectorCall(n, top.has(n) ? constants : new Map()) : undefined;
        if (selector) {
          const usage = parents.get(n);
          const direct = usage?.type === 'MemberExpression' && usage.object === n && !usage.optional && member(usage) !== undefined && parents.get(usage)?.type === 'CallExpression' && parents.get(usage)?.callee === usage;
          if (!direct && usage?.type !== 'ExpressionStatement') markGlobal('frame()/ui() 选择器被保存、传递或以动态方式使用，暂不能证明全部注册');
          return;
        }
        if (n.type !== 'CallExpression' || n.callee?.type !== 'MemberExpression' || n.optional || n.callee.optional) return;
        const target = selectorCall(n.callee.object, top.has(n) ? constants : new Map());
        if (!target) return;
        const method = member(n.callee);
        if (target.kind === 'frame') {
          if (method === 'enter' || method === 'exit') {
            const raw = target.raw, statement = top.get(n) ?? n;
            const entry: LogicLifecycle = { kind: method === 'enter' ? 'frameEnter' : 'frameExit', target: raw ?? '', file, line: n.loc.start.line, start: statement.start, end: statement.end, ...(raw === undefined ? { dynamic: true } : {}) };
            lifecycle.push(entry);
            if (raw === undefined) { references.dynamicFrames = true; issues.push(`${file}:${n.loc.start.line} 生命周期目标不确定；删除相关幕或页面需先查看源码`); }
            else {
              const ref = storyRef(raw);
              if (!ref || !story.frames.some(f => f.ref === ref)) issues.push(`${file}:${n.loc.start.line} 生命周期幕不存在：${raw}`);
              else { references.frames.add(ref); frames[ref].locations.push({ file, line: n.loc.start.line, start: statement.start, end: statement.end }); }
            }
            return;
          }
          if (!method || !methods.has(method)) { markGlobal('存在未知的 frame(...) 注册方法'); return; }
          if (target.raw === undefined) { markGlobal('存在动态幕注册；已知连线仍显示，自动改线暂停'); return; }
          const frame = storyRef(target.raw);
          if (!frame || !story.frames.some(f => f.ref === frame)) { issues.push(`${file}:${n.loc.start.line} 注册的幕不存在：${target.raw}`); return; }
          const option = method === 'choice' ? staticString(n.arguments[0], constants) : undefined;
          const statement = top.get(n) ?? n;
          const record: Registration = { frame, kind: method as Route['kind'], option, file, statement, call: n, selector: target.node, frameArg: target.arg };
          records.push(record);
          frames[frame].locations.push({ file, line: n.loc.start.line, start: statement.start, end: statement.end });
          let reason: string | undefined;
          try {
            if (!top.has(n)) throw new Error('注册位于函数、循环或条件中');
            if (method === 'choice' && option === undefined) throw new Error('选项 ID 是动态表达式');
            const route: Route = { frame, kind: method as Route['kind'], ...(option !== undefined ? { option } : {}), updates: [] };
            if (method === 'end') { if (n.arguments.length !== 0) throw new Error('结束注册参数不确定'); }
            else {
              const index = method === 'choice' ? 1 : 0, run = n.arguments[index];
              if (run === undefined) throw new Error('缺少目标或回调');
              if (['Literal', 'Identifier', 'TemplateLiteral', 'BinaryExpression'].includes(run.type)) {
                // The engine treats a static string target as "no updates, return this string".
                const raw = staticString(run, constants);
                if (raw === undefined) throw new Error('目标不是固定字符串或内联回调');
                route.target = storyRef(raw); record.target = run;
              } else {
                callback(run);
                const context = run.params[0]?.name ?? freshContext(source);
                record.context = context; record.callback = run;
                const statements = run.body.type === 'BlockStatement' ? run.body.body.filter((s: Node) => s.type !== 'EmptyStatement') : [];
                const localConstants = new Map(constants); for (const p of run.params) bindingNames(p).forEach(name => localConstants.delete(name)); if (run.id) localConstants.delete(run.id.name);
                const decisionStart = statements.findIndex((s: Node) => s.type === 'IfStatement' || s.type === 'ReturnStatement');
                const decision = readDecision(run.body.type === 'BlockStatement' ? statements.slice(decisionStart < 0 ? statements.length : decisionStart) : [{ type: 'ReturnStatement', argument: run.body }],
                  node => expression(node as Node, context), node => { const value = staticString(node as Node, localConstants); if (value === undefined) throw new Error('后续目标由条件或自定义逻辑决定'); return storyRef(value) ?? value; });
                record.target = decision.targetNode as Node; route.target = decision.target;
                record.branchNodes = decision.branchNodes as Registration['branchNodes'];
                if (decision.branches.length) route.branches = decision.branches;
                record.updates = decisionStart < 0 ? [] : statements.slice(0, decisionStart);
                route.updates = record.updates!.map(s => {
                  const c = s.expression, op = member(c?.callee);
                  if (s.type !== 'ExpressionStatement' || c?.type !== 'CallExpression' || c.optional || c.callee.object?.name !== context || !['set', 'add'].includes(op ?? '') || c.arguments.length !== 2) throw new Error('回调包含自定义语句');
                  const variable = staticString(c.arguments[0], localConstants); if (variable === undefined) throw new Error('变量 ID 不确定');
                  if (!run.params.length) throw new Error('更新回调缺少上下文参数');
                  return { op: op as 'set' | 'add', variable, value: expression(c.arguments[1], context, true) };
                });
              }
              if (n.arguments[index + 1]) {
                if (method !== 'choice') throw new Error('注册包含额外参数');
                const guard = n.arguments[index + 1]; callback(guard); route.guard = expression(bodyValue(guard), guard.params[0]?.name ?? freshContext(source)); record.guard = guard;
              }
              if (n.arguments.length > index + 2) throw new Error('注册包含额外参数');
            }
            // Validate each record independently, and ownership as a group below.
            const f = story.frames.find(f => f.ref === frame)!;
            validateRoutes({ ...story, frames: story.frames.map(frame => frame === f ? { ...f, options: route.kind === 'choice' ? f.options.filter(o => o.id === option) : [] } : frame) }, [route], true);
            record.route = route;
          } catch (e) { reason = e instanceof Error ? e.message : '无法识别此注册'; }
          if (record.route) links.push(record.route);
          else {
            frames[frame].reason = reason;
            const base: Route = { frame, kind: method as Route['kind'], option, updates: [], conditional: true };
            if (method === 'end') links.push(base);
            else {
              const value = n.arguments[method === 'choice' ? 1 : 0];
              const fn = value?.type === 'Identifier' ? functions.get(value.name) ?? constants.get(value.name) : value;
              const targetConstants = new Map(constants);
              if (fn) { for (const p of fn.params ?? []) bindingNames(p).forEach(name => targetConstants.delete(name)); if (fn.id) targetConstants.delete(fn.id.name); if (fn.body) walk(fn.body, n => { if (n.type === 'VariableDeclarator') bindingNames(n.id).forEach(name => targetConstants.delete(name)); }); }
              const targets = new Set<string>(); let unknown = false;
              const collect = (node?: Node) => {
                if (node?.type === 'ConditionalExpression') { collect(node.consequent); collect(node.alternate); return; }
                const s = staticString(node, targetConstants); if (s === undefined) unknown = true; else targets.add(storyRef(s) ?? s);
              };
              if (fn && ['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'].includes(fn.type)) {
                if (fn.body.type !== 'BlockStatement') collect(fn.body);
                else {
                  let returns = 0;
                  walk(fn.body, node => { if (['FunctionExpression', 'FunctionDeclaration', 'ArrowFunctionExpression'].includes(node.type)) return false; if (node.type === 'ReturnStatement') { returns++; collect(node.argument); } });
                  if (!returns || fn.body.body.at(-1)?.type !== 'ReturnStatement') unknown = true;
                }
              } else if (['Literal', 'Identifier', 'TemplateLiteral', 'BinaryExpression'].includes(value?.type)) collect(value);
              else unknown = true;
              for (const destination of targets) links.push({ ...base, target: destination });
              if (unknown || !targets.size) links.push({ ...base, dynamic: true });
            }
          }
          return;
        }
        // ui(id).bind(...) is the v0.11.0 interface callback and page lifecycle form.
        if (target.kind === 'ui') {
          if (method !== 'bind') { markGlobal('存在未知的 ui(...) 注册方法'); return; }
          const event = staticString(n.arguments[0], constants);
          if (event === 'screen.open' || event === 'screen.close') {
            const statement = top.get(n) ?? n;
            const kind: LifecycleKind = event === 'screen.open' ? 'screenOpen' : 'screenClose';
            const raw = target.raw;
            const entry: LogicLifecycle = { kind, target: raw ?? '', file, line: n.loc.start.line, start: statement.start, end: statement.end, ...(raw === undefined ? { dynamic: true } : {}) };
            lifecycle.push(entry);
            if (raw === undefined) screenIssue(`${file}:${n.loc.start.line} 生命周期目标不确定；删除相关幕或页面需先查看源码`);
            else { references.screens.add(raw); if (screens && !screens.has(raw)) screenIssue(`${file}:${n.loc.start.line} 生命周期页面不存在：${raw}`); }
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
    const cb = record.callback, context = record.context;
    if (!cb) {
      // A static string target has no callback yet. Richer edits convert only the
      // run argument (and an optional guard) into the engine's inline run form.
      const needFunction = after.updates.length > 0 || (after.branches?.length ?? 0) > 0;
      const targetChanged = before.target !== after.target, guardChanged = !same(before.guard, after.guard);
      if (needFunction) {
        const end = record.guard ? record.guard.end : record.target!.end;
        add(record.file, { start: record.target!.start, end }, `(ctx) => {\n${emitRouteBody(after)}\n}${after.guard ? `, (ctx) => ${emitExpression(after.guard)}` : ''}`);
      } else {
        if (targetChanged) add(record.file, record.target!, JSON.stringify(after.target));
        if (guardChanged) {
          if (record.guard && after.guard) add(record.file, bodyValue(record.guard), emitExpression(after.guard));
          else if (record.guard) add(record.file, { start: record.target!.end, end: record.guard.end }, '');
          else if (after.guard) add(record.file, { start: record.call.end - 1, end: record.call.end - 1 }, `, (ctx) => ${emitExpression(after.guard)}`);
        }
      }
      continue;
    }
    if (before.branches?.length || after.branches?.length) {
      if ((before.branches?.length ?? 0) === (after.branches?.length ?? 0) && same(before.updates, after.updates)) {
        if (before.target !== after.target) add(record.file, record.target!, JSON.stringify(after.target));
        for (let i = 0; i < (after.branches?.length ?? 0); i++) {
          const old = before.branches![i], branch = after.branches![i], nodes = record.branchNodes![i];
          if (old.target !== branch.target) add(record.file, nodes.target, JSON.stringify(branch.target));
          if (!same(old.when, branch.when)) { bindContext(record.file, cb, context!); add(record.file, nodes.when, emitExpression(branch.when, context!)); }
        }
      } else {
        bindContext(record.file, cb, context!);
        // A structural decision edit replaces only this recognized callback body.
        // Keep every author comment, including comments among the old branches.
        const oldBody = sources.get(record.file)!.slice(cb.body.start, cb.body.end), comments: string[] = [];
        const tokens = tokenizer(oldBody, { ecmaVersion: 2022, onComment: (_block, _value, start, end) => { comments.push(oldBody.slice(start, end)); } });
        while (tokens.getToken().type.label !== 'eof') { /* tokenize, never execute */ }
        add(record.file, cb.body, `{\n${comments.map(c => `  ${c}\n`).join('')}${emitRouteBody(after, context!)}\n}`);
      }
    } else {
      if (before.target !== after.target) add(record.file, record.target!, JSON.stringify(after.target));
      if (!same(before.updates, after.updates)) {
        if (after.updates.length) bindContext(record.file, cb, context!);
        if (cb.body.type !== 'BlockStatement') {
          // One callback replacement also includes its target patch.
          const list = patches.get(record.file) ?? []; patches.set(record.file, list.filter(p => p.start !== record.target!.start));
          add(record.file, cb.body, `{\n${after.updates.map(u => `  ${context}.${u.op}(${JSON.stringify(u.variable)}, ${emitExpression(u.value, context!)});`).join('\n')}\n  return ${JSON.stringify(after.target)};\n}`);
        } else {
          const updates = record.updates!;
          for (let i = 0; i < updates.length; i++) {
            const old = updates[i], u = after.updates[i];
            if (!u) add(record.file, old, '');
            else {
              const call = old.expression, oldUpdate = before.updates[i];
              if (oldUpdate.op !== u.op) add(record.file, call.callee.property, call.callee.computed ? JSON.stringify(u.op) : u.op);
              if (oldUpdate.variable !== u.variable) add(record.file, call.arguments[0], JSON.stringify(u.variable));
              if (!same(oldUpdate.value, u.value)) add(record.file, call.arguments[1], emitExpression(u.value, context!));
            }
          }
          if (after.updates.length > updates.length) { const position = cb.body.body.findLast((s: Node) => s.type === 'ReturnStatement').start; add(record.file, { start: position, end: position }, after.updates.slice(updates.length).map(u => `${context}.${u.op}(${JSON.stringify(u.variable)}, ${emitExpression(u.value, context!)});\n  `).join('')); }
        }
      }
    }
    if (!same(before.guard, after.guard)) {
      const guard = record.guard;
      if (guard && after.guard) { const guardContext = guard.params[0]?.name ?? freshContext(sources.get(record.file)!); bindContext(record.file, guard, guardContext); add(record.file, bodyValue(guard), emitExpression(after.guard, guardContext)); }
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
