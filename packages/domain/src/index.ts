export type ValueType = 'int' | 'bool' | 'string';
export interface Variable { id: string; type: ValueType; initial: string; min?: string; max?: string }
export type Expr = { kind: 'constant'; type: ValueType; value: string } | { kind: 'variable'; id: string } | { kind: 'compare'; op: '===' | '!==' | '<' | '<=' | '>' | '>='; left: Expr; right: Expr } | { kind: 'and' | 'or'; left: Expr; right: Expr } | { kind: 'not'; value: Expr };
export interface Update { op: 'set' | 'add'; variable: string; value: Expr }
export interface Route { frame: string; kind: 'advance' | 'choice' | 'end'; target?: string; option?: string; guard?: Expr; updates: Update[] }
export interface Span { start: number; end: number }
export interface Frame {
  ref: string; id?: string; name?: string; text: string; speaker: string; visual: string;
  audio: Record<string, string>; options: { id: string; text: string }[]; file: string; line: number;
}
export interface Asset { id: string; kind: string; src: string; file: string }
export interface Visual { id: string; background: string; portraits: { image: string; character: string; slot: string }[] }
export interface Story {
  id: string; entry: string; contentVersion: string; frames: Frame[]; assets: Asset[];
  visuals: Visual[]; variables: Variable[]; characters: { id: string; name: string }[]; scripts: string[]; files: string[];
}
export interface Issue { file: string; line: number; message: string; severity: 'error' | 'warning' }
export function i64(value: string): string {
  if (!/^-?(0|[1-9]\d*)$/.test(value) || BigInt(value) < -(1n << 63n) || BigInt(value) > (1n << 63n) - 1n) throw new Error('整数必须是 i64 范围内的十进制字符串');
  return BigInt(value).toString();
}
export function expressionType(expr: Expr, vars: Variable[], depth = 0): ValueType {
  if (depth > 16 || !expr || typeof expr !== 'object') throw new Error('条件表达式过深或无效');
  const typeOf = (child: Expr) => expressionType(child, vars, depth + 1);
  if (expr.kind === 'constant') {
    if (typeof expr.value !== 'string') throw new Error('常量必须使用字符串表示');
    if (expr.type === 'int') i64(expr.value);
    else if (expr.type === 'bool') { if (!['true', 'false'].includes(expr.value)) throw new Error('布尔常量无效'); }
    else if (expr.type !== 'string' || new TextEncoder().encode(expr.value).length > 4096) throw new Error('字符串常量无效');
    return expr.type;
  }
  if (expr.kind === 'variable') {
    const variable = vars.find(v => v.id === expr.id);
    if (!variable) throw new Error(`变量不存在：${expr.id}`);
    return variable.type;
  }
  if (expr.kind === 'not') { if (typeOf(expr.value) !== 'bool') throw new Error('非运算需要布尔值'); return 'bool'; }
  if (expr.kind === 'and' || expr.kind === 'or') { if (typeOf(expr.left) !== 'bool' || typeOf(expr.right) !== 'bool') throw new Error('逻辑运算需要布尔值'); return 'bool'; }
  if (expr.kind !== 'compare' || !['===', '!==', '<', '<=', '>', '>='].includes(expr.op)) throw new Error('不支持的表达式');
  const left = typeOf(expr.left), right = typeOf(expr.right);
  if (left !== right || (!['===', '!=='].includes(expr.op) && left !== 'int')) throw new Error('比较类型不一致，大小比较仅支持整数');
  return 'bool';
}
export function validateRoutes(story: Story, routes: Route[]): void {
  const refs = new Set(story.frames.flatMap(f => [f.id, f.name].filter((v): v is string => !!v)));
  if (routes.length > 2000) throw new Error('路由数量超限');
  for (const route of routes) {
    if (!refs.has(route.frame) || !['advance', 'choice', 'end'].includes(route.kind)) throw new Error('路由幕或类型无效');
    if (route.kind !== 'end' && (!route.target || !refs.has(route.target))) throw new Error(`路由目标不存在：${route.target ?? ''}`);
    if (route.guard && expressionType(route.guard, story.variables) !== 'bool') throw new Error('条件必须返回布尔值');
    if (route.guard && route.kind !== 'choice') throw new Error('显示条件仅用于选择路由');
    if (route.kind === 'end' && (route.target || route.guard || route.updates.length)) throw new Error('结束路由不能携带目标、条件或更新');
    if (!Array.isArray(route.updates) || route.updates.length > 128) throw new Error('变量更新超限');
    for (const update of route.updates) {
      const variable = story.variables.find(v => v.id === update.variable);
      if (!variable || !['set', 'add'].includes(update.op) || expressionType(update.value, story.variables) !== variable.type || (update.op === 'add' && variable.type !== 'int')) throw new Error('变量更新类型不合法');
    }
  }
  for (const frame of story.frames) {
    const owned = routes.filter(r => r.frame === frame.ref);
    if (frame.options.length) {
      if (owned.length !== frame.options.length || owned.some(r => r.kind !== 'choice') || frame.options.some(o => owned.filter(r => r.option === o.id).length !== 1)) throw new Error(`${frame.ref} 的选项与路由不一致`);
    } else if (owned.length !== 1 || owned[0].kind === 'choice') throw new Error(`${frame.ref} 需要一个推进或结束路由`);
  }
}
export function validateStory(story: Story): Issue[] {
  const issues: Issue[] = [], seen = new Set<string>();
  for (const f of story.frames) {
    for (const ref of new Set([f.id, f.name].filter((v): v is string => !!v))) {
      if (seen.has(ref)) issues.push({ file: f.file, line: f.line, message: `重复幕引用：${ref}`, severity: 'error' });
      seen.add(ref);
    }
    if (!f.text.trim()) issues.push({ file: f.file, line: f.line, message: '台词不能为空', severity: 'error' });
    if (!f.id) issues.push({ file: f.file, line: f.line, message: '未固定幕 ID，重新打包可能影响旧存档', severity: 'warning' });
    if (f.visual && !story.visuals.some(v => v.id === f.visual)) issues.push({ file: f.file, line: f.line, message: `画面不存在：${f.visual}`, severity: 'error' });
  }
  if (!seen.has(story.entry)) issues.push({ file: 'story.xml', line: 1, message: '故事入口不存在', severity: 'error' });
  return issues;
}
