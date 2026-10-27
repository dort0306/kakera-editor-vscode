import { parse } from 'acorn';
import type { Expr, Route } from '../../domain/src/index';
export const MANAGED_HEADER = '// Kakera Managed Routes v1\n';
const quote = (value: string) => JSON.stringify(value).replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
export function emitExpression(expr: Expr): string {
  if (expr.kind === 'constant') return expr.type === 'string' ? quote(expr.value) : expr.type === 'int' ? `${BigInt(expr.value)}n` : expr.value;
  if (expr.kind === 'variable') return `ctx.vars[${quote(expr.id)}]`;
  if (expr.kind === 'not') return `(!${emitExpression(expr.value)})`;
  return `(${emitExpression(expr.left)} ${expr.kind === 'compare' ? expr.op : expr.kind === 'and' ? '&&' : '||'} ${emitExpression(expr.right)})`;
}
export function emitRoutes(routes: Route[]): string {
  return MANAGED_HEADER + routes.map(r => {
    if (r.kind === 'end') return `on.end(${quote(r.frame)});`;
    const body = r.updates.map(u => `  ctx.${u.op}(${quote(u.variable)}, ${emitExpression(u.value)});`).concat(`  return ${quote(r.target!)};`).join('\n');
    const args = [quote(r.frame), ...(r.kind === 'choice' ? [quote(r.option!)] : []), `(ctx) => {\n${body}\n}`, ...(r.guard ? [`(ctx) => ${emitExpression(r.guard)}`] : [])];
    return `on.${r.kind}(${args.join(', ')});`;
  }).join('\n\n') + '\n';
}
// AST is deliberately consumed as untrusted data; unsupported syntax remains Opaque.
type Ast = Record<string, any>;
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
export function readManagedRoutes(source: string): Route[] | undefined {
  if (!source.startsWith(MANAGED_HEADER)) return;
  try {
    const ast = parse(source, { ecmaVersion: 2022 }) as unknown as Ast;
    const routes: Route[] = ast.body.map((statement: Ast) => {
      const call = statement.expression;
      if (statement.type !== 'ExpressionStatement' || call?.type !== 'CallExpression' || call.callee.type !== 'MemberExpression' || call.callee.computed || call.callee.object.name !== 'on') throw new Error('不支持的注册');
      const kind = call.callee.property.name;
      if (!['advance', 'choice', 'end'].includes(kind)) throw new Error('未知注册');
      const route: Route = { kind, frame: literal(call.arguments[0]), updates: [] };
      if (kind === 'end') { if (call.arguments.length !== 1) throw new Error('错误参数'); return route; }
      if (kind === 'choice') route.option = literal(call.arguments[1]);
      const index = kind === 'choice' ? 2 : 1, cb = call.arguments[index];
      callback(cb);
      if (cb.body.type !== 'BlockStatement') throw new Error('回调必须是语句块');
      const statements: Ast[] = cb.body.body;
      if (!statements.length || statements[statements.length - 1].type !== 'ReturnStatement') throw new Error('没有目标');
      route.target = literal(statements[statements.length - 1].argument);
      route.updates = statements.slice(0, -1).map((s: Ast) => {
        const c = s.expression;
        if (s.type !== 'ExpressionStatement' || c?.type !== 'CallExpression' || c.callee.type !== 'MemberExpression' || c.callee.computed || c.callee.object.name !== 'ctx' || !['set', 'add'].includes(c.callee.property.name) || c.arguments.length !== 2) throw new Error('不支持的更新');
        return { op: c.callee.property.name, variable: literal(c.arguments[0]), value: readExpr(c.arguments[1]) };
      });
      if (call.arguments[index + 1]) { callback(call.arguments[index + 1]); route.guard = readExpr(call.arguments[index + 1].body); }
      if (call.arguments.length > index + 2) throw new Error('额外参数');
      return route;
    });
    // Only byte-identical generator output can be managed, including comments.
    return emitRoutes(routes) === source ? routes : undefined;
  } catch { return; }
}
