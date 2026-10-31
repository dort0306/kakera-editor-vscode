import { parse } from 'acorn';
import type { Sources } from './index';
import { readStory } from './index';
import { analyzeLogic, type LogicAnalysis } from './logic';
import { uiFragments } from './ui-files';
import type { LifecycleBinding, LifecycleDesign, LifecycleEdit } from '../../domain/src/ui';

type Node = Record<string, any>;
const member = (node: Node) => node?.type === 'MemberExpression' && !node.optional ? node.computed ? node.property.type === 'Literal' ? node.property.value : undefined : node.property.name : undefined;
function command(source: string, start: number, end: number): Node | undefined {
  const full = parse(source, { ecmaVersion: 2022 }) as Node;
  if (!full.body.some((n: Node) => n.type === 'ExpressionStatement' && n.start === start && n.end === end)) return;
  const ast = parse(source.slice(start, end), { ecmaVersion: 2022 }) as Node;
  const statement = ast.body[0], registration = statement?.expression;
  if (ast.body.length !== 1 || statement.type !== 'ExpressionStatement' || registration?.type !== 'CallExpression' || registration.optional) return;
  // Only the canonical v0.11.0 registration forms are editable here:
  // frame("id").exit(cb) and ui("page").bind("screen.close", cb).
  const method = member(registration.callee), selector = registration.callee?.object;
  const selectorCall = selector?.type === 'CallExpression' && selector.callee?.type === 'Identifier' && selector.arguments.length === 1 ? selector.callee.name : undefined;
  let callback: Node | undefined;
  if (selectorCall === 'frame' && method === 'exit' && registration.arguments.length === 1) callback = registration.arguments[0];
  else if (selectorCall === 'ui' && method === 'bind' && registration.arguments.length === 2 && registration.arguments[0]?.type === 'Literal' && registration.arguments[0].value === 'screen.close') callback = registration.arguments[1];
  if (!callback || !['ArrowFunctionExpression', 'FunctionExpression'].includes(callback.type) || callback.async || callback.generator || callback.params.length !== 1 || callback.params[0].type !== 'Identifier') return;
  const body = callback.body.type === 'BlockStatement' ? callback.body.body : undefined;
  const call = body ? body.length === 1 && body[0].type === 'ExpressionStatement' ? body[0].expression : undefined : callback.body;
  if (call?.type !== 'CallExpression' || call.optional || call.callee?.object?.name !== callback.params[0].name) return;
  if (!['open', 'resume'].includes(member(call.callee)) || call.arguments.length > 1 || call.arguments.some((arg: Node) => arg.type !== 'Literal' || typeof arg.value !== 'string')) return;
  if (member(call.callee) === 'open' && call.arguments.length !== 1) return;
  return call;
}

/** Only a single fixed open/resume command is editable; unknown callbacks remain source controlled. */
export function readLifecycle(sources: Sources, analysis?: LogicAnalysis): LifecycleDesign {
  const story = readStory(sources), logic = analysis ?? analyzeLogic(sources, story);
  const screens = uiFragments(sources).flatMap(f => f.root.children.filter(n => n.tag === 'screen').map(n => n.attrs.id));
  const result: LifecycleDesign = { frameExit: {}, screenClose: {} };
  for (const kind of ['frameExit', 'screenClose'] as const) {
    const registrations = logic.lifecycle.filter(l => l.kind === kind);
    for (const owner of kind === 'frameExit' ? story.frames.filter(f => !f.pending).map(f => f.ref) : screens) {
      const matches = registrations.filter(l => kind === 'frameExit' ? story.frames.find(f => [f.ref, f.id, f.name].includes(l.target))?.ref === owner : l.target === owner);
      const binding: LifecycleBinding = { mode: 'none', editable: true };
      result[kind][owner] = binding;
      // Unknown registration ownership must not create a duplicate or overwrite handwritten logic.
      if (registrations.some(l => l.dynamic) || logic.registrationUncertain || matches.length > 1) {
        binding.editable = false; binding.reason = '存在动态、重复或无法证明归属的注册，请先处理源码'; continue;
      }
      const entry = matches[0]; if (!entry) continue;
      binding.file = entry.file; binding.line = entry.line;
      const call = command(sources.get(entry.file)!, entry.start, entry.end);
      if (!call || kind === 'frameExit' && member(call.callee) !== 'open') { binding.editable = false; binding.reason = '已有手写生命周期包含自定义逻辑，保留源码'; continue; }
      binding.mode = member(call.callee) === 'open' ? 'page' : call.arguments.length ? 'frame' : 'continue';
      const raw = call.arguments[0]?.value;
      binding.target = binding.mode === 'frame' ? story.frames.find(f => [f.ref, f.id, f.name].includes(raw))?.ref ?? raw : raw;
    }
  }
  return result;
}

export function editLifecycle(sources: Sources, op: LifecycleEdit): Sources {
  if (!['frameExit', 'screenClose'].includes(op.kind) || typeof op.owner !== 'string' || !['none', 'page', 'frame', 'continue'].includes(op.mode) || op.kind === 'frameExit' && !['none', 'page'].includes(op.mode)) throw new Error('不支持的生命周期动作');
  const story = readStory(sources), logic = analyzeLogic(sources, story), current = readLifecycle(sources, logic)[op.kind][op.owner];
  if (!current) throw new Error('生命周期所属幕或页面不存在');
  if (!current.editable) throw new Error(current.reason);
  let target = op.target;
  if (op.mode === 'page') {
    const screens = uiFragments(sources).flatMap(f => f.root.children.filter(n => n.tag === 'screen').map(n => n.attrs.id));
    if (!screens.includes(target ?? '') || op.kind === 'screenClose' && target === op.owner) throw new Error('请选择其他有效目标页面，避免关闭后重新打开自身');
  } else if (op.mode === 'frame') {
    const frame = story.frames.find(f => f.ref === target && !f.pending); if (!frame) throw new Error('请选择有效目标幕'); target = frame.ref;
  }
  const entry = logic.lifecycle.find(l => l.kind === op.kind && (op.kind === 'screenClose' ? l.target === op.owner : story.frames.find(f => [f.ref, f.id, f.name].includes(l.target))?.ref === op.owner));
  if (!entry && op.mode === 'none') return new Map();
  const file = entry?.file ?? story.scripts.at(-1); if (!file || !sources.has(file)) throw new Error('缺少可写的已声明脚本');
  const source = sources.get(file)!;
  if (op.mode === 'none') return new Map([[file, source.slice(0, entry!.start) + source.slice(entry!.end)]]);
  const method = op.mode === 'page' ? 'open' : 'resume', argument = op.mode === 'continue' ? '' : JSON.stringify(target);
  if (!entry) {
    const newline = source.includes('\r\n') ? '\r\n' : '\n';
    const registration = op.kind === 'frameExit'
      ? `frame(${JSON.stringify(op.owner)}).exit(ctx => { ctx.${method}(${argument}); });`
      : `ui(${JSON.stringify(op.owner)}).bind("screen.close", ctx => { ctx.${method}(${argument}); });`;
    return new Map([[file, source + `${newline}${registration}${newline}`]]);
  }
  const call = command(source, entry.start, entry.end)!;
  const edits = [{ start: call.callee.property.start, end: call.callee.property.end, text: call.callee.computed ? JSON.stringify(method) : method }];
  const arg = call.arguments[0];
  edits.push(arg ? { start: arg.start, end: arg.end, text: argument } : { start: call.end - 1, end: call.end - 1, text: argument });
  let next = source; for (const edit of edits.sort((a,b) => b.start - a.start)) next = next.slice(0, entry.start + edit.start) + edit.text + next.slice(entry.start + edit.end);
  return next === source ? new Map() : new Map([[file, next]]);
}
