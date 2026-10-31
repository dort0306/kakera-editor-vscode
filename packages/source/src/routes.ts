import { parse } from 'acorn';
import type { Expr, Route } from '../../domain/src/index';
export const MANAGED_HEADER = '// Kakera Managed Routes v2\n';
const quote = (value: string) => JSON.stringify(value).replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
export function emitExpression(expr: Expr, context = 'ctx'): string {
  if (expr.kind === 'constant') return expr.type === 'string' ? quote(expr.value) : expr.type === 'int' ? `${BigInt(expr.value)}n` : expr.value;
  if (expr.kind === 'variable') return `${context}.vars[${quote(expr.id)}]`;
  if (expr.kind === 'not') return `(!${emitExpression(expr.value, context)})`;
  return `(${emitExpression(expr.left, context)} ${expr.kind === 'compare' ? expr.op : expr.kind === 'and' ? '&&' : '||'} ${emitExpression(expr.right, context)})`;
}
/** v0.11.0 register API: frame("id").advance/choice/end, never the removed on.* table. */
export function emitRoutes(routes: Route[]): string {
  return MANAGED_HEADER + routes.map(r => {
    if (r.kind === 'end') return `frame(${quote(r.frame)}).end();`;
    const body = emitRouteBody(r);
    const args = [`(ctx) => {\n${body}\n}`, ...(r.guard ? [`(ctx) => ${emitExpression(r.guard)}`] : [])];
    return `frame(${quote(r.frame)}).${r.kind}(${r.kind === 'choice' ? `${quote(r.option!)}, ` : ''}${args.join(', ')});`;
  }).join('\n\n') + '\n';
}
export function emitRouteBody(route: Route, context = 'ctx'): string {
  return [...route.updates.map(u => `  ${context}.${u.op}(${quote(u.variable)}, ${emitExpression(u.value, context)});`),
    ...(route.branches ?? []).map(b => `  if (${emitExpression(b.when, context)}) return ${quote(b.target)};`),
    `  return ${quote(route.target!)};`].join('\n');
}
// AST is deliberately consumed as untrusted data; unsupported syntax remains Opaque.
type Ast = Record<string, any>;
/** Only ordered, side-effect-free tests with literal/static destinations are editable. */
export function readDecision(statements: Ast[], readExpression: (node: Ast) => Expr, readTarget: (node: Ast) => string) {
  const branches: NonNullable<Route['branches']> = [], branchNodes: { when: Ast; target: Ast }[] = [];
  const onlyReturn = (node: Ast): Ast => {
    if (node?.type === 'BlockStatement' && node.body.length === 1) return onlyReturn(node.body[0]);
    if (node?.type !== 'ReturnStatement' || !node.argument || node.argument.type === 'ConditionalExpression') throw new Error('分支包含自定义语句或嵌套分流');
    return node.argument;
  };
  const addBranch = (when: Ast, target: Ast) => {
    if (branches.length >= 32) throw new Error('条件分支超过 32 条');
    branches.push({ when: readExpression(when), target: readTarget(target) }); branchNodes.push({ when, target });
  };
  let remaining = statements;
  while (remaining.length) {
    const node = remaining[0];
    if (node.type === 'IfStatement') {
      addBranch(node.test, onlyReturn(node.consequent));
      if (node.alternate) {
        if (remaining.length !== 1) throw new Error('分支之后存在额外语句');
        remaining = node.alternate.type === 'BlockStatement' ? node.alternate.body : [node.alternate];
      } else remaining = remaining.slice(1);
      continue;
    }
    if (node.type !== 'ReturnStatement' || remaining.length !== 1 || !node.argument) throw new Error('分流需要明确的默认目标');
    let targetNode = node.argument;
    while (targetNode.type === 'ConditionalExpression') { addBranch(targetNode.test, targetNode.consequent); targetNode = targetNode.alternate; }
    return { target: readTarget(targetNode), targetNode, branches, branchNodes };
  }
  throw new Error('分流缺少默认目标');
}
function literal(node: Ast): string { if (node?.type !== 'Literal' || typeof node.value !== 'string') throw new Error('需要字符串字面量'); return node.value; }
function readExpr(node: Ast): Expr {
  if (node.type === 'Literal') {
    if (typeof node.value === 'bigint') return { kind: 'constant', type: 'int', value: node.value.toString() };
    if (typeof node.value === 'boolean') return { kind: 'constant', type: 'bool', value: String(node.value) };
    if (typeof node.value === 'string') return { kind: 'constant', type: 'string', value: node.value };
  }
  if (node.type === 'UnaryExpression' && node.operator === '-' && typeof node.argument.value === 'bigint') return { kind: 'constant', type: 'int', value: `-${node.argument.value}` };
  if (node.type === 'UnaryExpression' && node.operator === '!') return { kind: 'not', value: readExpr(node.argument) };
  if (node.type === 'MemberExpression' && node.computed && node.object.type === 'MemberExpression' && !node.object.computed && node.object.object.name === 'ctx' && node.object.property.name === 'vars') return { kind: 'variable', id: literal(node.property) };
  if (node.type === 'BinaryExpression' && ['===', '!==', '<', '<=', '>', '>='].includes(node.operator)) return { kind: 'compare', op: node.operator, left: readExpr(node.left), right: readExpr(node.right) };
  if (node.type === 'LogicalExpression' && ['&&', '||'].includes(node.operator)) return { kind: node.operator === '&&' ? 'and' : 'or', left: readExpr(node.left), right: readExpr(node.right) };
  throw new Error('不支持的表达式');
}
function callback(node: Ast): void { if (node.type !== 'ArrowFunctionExpression' || node.async || node.params.length !== 1 || node.params[0].name !== 'ctx') throw new Error('不支持的回调'); }
/** Only byte-identical generator output of MANAGED_HEADER v2 is managed. */
export function readManagedRoutes(source: string): Route[] | undefined {
  if (!source.startsWith(MANAGED_HEADER)) return;
  try {
    const ast = parse(source, { ecmaVersion: 2022 }) as unknown as Ast;
    const routes: Route[] = ast.body.map((statement: Ast) => {
      const call = statement.expression;
      if (statement.type !== 'ExpressionStatement' || call?.type !== 'CallExpression' || call.callee.type !== 'MemberExpression' || call.callee.computed) throw new Error('不支持的注册');
      const selector = call.callee.object, kind = call.callee.property.name;
      if (selector?.type !== 'CallExpression' || selector.callee.type !== 'Identifier' || selector.callee.name !== 'frame' || selector.arguments.length !== 1) throw new Error('不支持的注册目标');
      if (!['advance', 'choice', 'end'].includes(kind)) throw new Error('未知注册');
      const route: Route = { kind, frame: literal(selector.arguments[0]), updates: [] };
      if (kind === 'end') { if (call.arguments.length) throw new Error('错误参数'); return route; }
      if (kind === 'choice') route.option = literal(call.arguments[0]);
      const cb = call.arguments[kind === 'choice' ? 1 : 0];
      callback(cb);
      if (cb.body.type !== 'BlockStatement') throw new Error('回调必须是语句块');
      const statements: Ast[] = cb.body.body;
      const start = statements.findIndex(s => s.type === 'IfStatement' || s.type === 'ReturnStatement');
      if (start < 0) throw new Error('没有目标');
      const decision = readDecision(statements.slice(start), readExpr, literal);
      route.target = decision.target;
      if (decision.branches.length) route.branches = decision.branches;
      route.updates = statements.slice(0, start).map((s: Ast) => {
        const c = s.expression;
        if (s.type !== 'ExpressionStatement' || c?.type !== 'CallExpression' || c.callee.type !== 'MemberExpression' || c.callee.computed || c.callee.object.name !== 'ctx' || !['set', 'add'].includes(c.callee.property.name) || c.arguments.length !== 2) throw new Error('不支持的更新');
        return { op: c.callee.property.name, variable: literal(c.arguments[0]), value: readExpr(c.arguments[1]) };
      });
      if (kind === 'choice' && call.arguments[2]) {
        const guard = call.arguments[2]; callback(guard); route.guard = readExpr(guard.body);
      }
      if (call.arguments.length > (kind === 'choice' ? 3 : 1)) throw new Error('额外参数');
      return route;
    });
    // Only byte-identical generator output can be managed, including comments.
    return emitRoutes(routes) === source ? routes : undefined;
  } catch { return; }
}
