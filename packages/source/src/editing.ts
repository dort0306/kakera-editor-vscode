import type { Frame, Route, Story } from '../../domain/src/index';
import { validateRoutes, routeDestinations, storyEntries, i64 } from '../../domain/src/index';
import { appendGroup, insertFrame, newFrameRef, newShortId, readStory, type Sources } from './index';
import { group, parseXml, setAttribute, escapeXml } from './xml';
import { emitRoutes } from './routes';
import { patchLogicRoutes, protectedLogicTargets, type LogicAnalysis } from './logic';
export function reconnectFrame(input: Sources, logic: LogicAnalysis, ref: string, target: string, option?: string, branch?: number): Sources {
  if (!logic.frames[ref]?.editable) throw new Error(logic.frames[ref]?.reason ?? '此幕路线不可改写');
  const story = readStory(input), frame = resolve(story, ref);
  if (!frame || frame.pending || (target && (!resolve(story, target) || resolve(story, target)?.pending))) throw new Error('请选择实际的幕作为连接目标');
  const owned = logic.routes.filter(r => r.frame === ref);
  const previous = frame.options.length ? owned.find(r => r.kind === 'choice' && r.option === option) : owned.find(r => r.kind !== 'choice');
  if (!previous) throw new Error('选项连接点已改变，请刷新后重试');
  if (branch !== undefined && (!Number.isInteger(branch) || branch < 0 || !previous.branches?.[branch])) throw new Error('条件连接点已改变，请刷新后重试');
  const routes = logic.routes.map(r => r === previous ? previous.kind === 'end' ? { frame: ref, kind: 'advance' as const, target, updates: [] } : setDestination(r, target, branch) : r);
  const ready = reconcilePendingRoutes(input, routes, !logic.complete, protectedLogicTargets(logic));
  return changesFor(input, ready.sources, logic.records.find(r => r.frame === ref)!.file, ready.routes, logic);
}
function setDestination(route: Route, target: string, branch?: number): Route {
  return branch === undefined ? { ...route, target } : { ...route, branches: route.branches!.map((b, i) => i === branch ? { ...b, target } : b) };
}
function resolve(story: Story, ref?: string): Frame | undefined { return story.frames.find(f => f.ref === ref || f.id === ref || f.name === ref); }
interface SourcePatch { start: number; end: number; text: string }
/** Rename a frame and every statically proven route target/owner. Opaque or
 * dynamic references reject the operation instead of silently leaving routes
 * pointing at the old ID. */
export function renameFrame(input: Sources, logic: LogicAnalysis, ref: string, nextRef: string): { changes: Sources; selected: string } {
  const story = readStory(input), frame = resolve(story, ref);
  if (!frame || frame.pending) throw new Error('请选择要重命名的实际幕');
  const id = nextRef.trim();
  if (!id || id.length > 200 || !/^[\p{L}\p{N}_.:-]+$/u.test(id)) throw new Error('幕 ID 只能包含文字、数字、下划线、点、冒号或连字符，且不能含空格');
  if (story.frames.some(f => f !== frame && [f.ref, f.id, f.name].includes(id))) throw new Error('幕 ID 或名称已存在');
  if (id === frame.ref && frame.id === id && (!frame.name || frame.name === id)) return { changes: new Map(), selected: frame.ref };
  const actualFrames = story.frames.filter(f => !f.pending);
  if (logic.registrationUncertain || actualFrames.some(f => !logic.frames[f.ref]?.editable)) throw new Error('仍有动态或自定义路线，暂不能安全重命名幕；请先在源码中改为固定路线');
  if (logic.references.dynamicFrames) throw new Error('仍有动态生命周期或 ctx.resume 目标，暂不能安全重命名幕；请先在源码中明确目标');
  if (logic.references.frames.has(frame.ref)) throw new Error('该幕仍被生命周期或 ctx.resume 目标引用，请先处理相关注册');
  const changes: Sources = new Map(), patches = new Map<string, SourcePatch[]>();
  const add = (file: string, node: { start: number; end: number }, text: string) => { const list = patches.get(file) ?? []; list.push({ start: node.start, end: node.end, text }); patches.set(file, list); };
  let xml = input.get(frame.file)!;
  const node = group(parseXml(xml), 'frames').find(n => (n.attrs.name || n.attrs.id) === frame.ref);
  if (!node) throw new Error('该幕 XML 已改变，请刷新后重试');
  xml = setAttribute(xml, node, 'id', id);
  const renamed = group(parseXml(xml), 'frames').find(n => n.attrs.id === id || n.attrs.name === frame.ref);
  if (!renamed) throw new Error('重命名后无法定位幕节点');
  if (renamed.attrs.name !== undefined) xml = setAttribute(xml, renamed, 'name', id);
  const entryRefs = storyEntries(story);
  if (entryRefs.includes(frame.ref)) {
    const entryValue = entryRefs.map(entry => entry === frame.ref ? id : story.frames.find(f => f.ref === entry)?.id ?? entry).join(' ');
    if (frame.file === 'story.xml') xml = setAttribute(xml, parseXml(xml), 'entry', entryValue);
    else changes.set('story.xml', setAttribute(input.get('story.xml')!, parseXml(input.get('story.xml')!), 'entry', entryValue));
  }
  changes.set(frame.file, xml);
  for (const record of logic.records) {
    if (!record.route) continue;
    if (record.frame === frame.ref) add(record.file, record.frameArg, JSON.stringify(id));
    if (record.route.target === frame.ref && record.target) add(record.file, record.target, JSON.stringify(id));
    record.route.branches?.forEach((branch, index) => { if (branch.target === frame.ref && record.branchNodes?.[index]) add(record.file, record.branchNodes[index].target, JSON.stringify(id)); });
  }
  for (const [file, list] of patches) {
    let source = input.get(file)!;
    for (const patch of list.sort((a, b) => b.start - a.start)) source = source.slice(0, patch.start) + patch.text + source.slice(patch.end);
    changes.set(file, source);
  }
  const next = new Map([...input, ...changes]), nextStory = readStory(next);
  if (!nextStory.frames.some(f => f.ref === id)) throw new Error('幕 ID 重命名结果未生效');
  return { changes: new Map([...changes].filter(([file, text]) => input.get(file) !== text)), selected: id };
}
function removeFrame(sources: Sources, frame: Frame): void {
  const xml = sources.get(frame.file)!;
  const node = group(parseXml(xml), 'frames').find(n => (n.attrs.name || n.attrs.id) === frame.ref);
  if (!node) throw new Error('该幕已改变，请刷新后重试');
  sources.set(frame.file, xml.slice(0, node.start) + xml.slice(node.end));
}
function variableLocation(sources: Sources, story: Story, id: string): { file: string; xml: string; node: ReturnType<typeof parseXml> } | undefined {
  for (const file of story.files) {
    const xml = sources.get(file); if (!xml) continue;
    const node = group(parseXml(xml), 'variables').find(n => n.attrs.id === id);
    if (node) return { file, xml, node };
  }
}
export function addStoryVariable(sources: Sources, id: string, type: 'int' | 'bool' | 'string', initial: string, min?: string, max?: string): Sources {
  const story = readStory(sources);
  if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(id) || story.variables.some(v => v.id === id)) throw new Error('变量名重复或无效');
  if (type === 'int') {
    const value = BigInt(i64(initial)), lower = min ? BigInt(i64(min)) : undefined, upper = max ? BigInt(i64(max)) : undefined;
    if (lower !== undefined && upper !== undefined && lower > upper) throw new Error('变量下限不能大于上限');
    if (lower !== undefined && value < lower || upper !== undefined && value > upper) throw new Error('变量初始值超出范围');
  } else if (type === 'bool' && !['true', 'false'].includes(initial)) throw new Error('布尔值应为 true 或 false');
  const attrs = `id="${escapeXml(id)}" initial="${escapeXml(initial)}"${min ? ` min="${escapeXml(min)}"` : ''}${max ? ` max="${escapeXml(max)}"` : ''}`;
  return new Map([['story.xml', appendGroup(sources.get('story.xml')!, 'variables', `<${type} ${attrs} />`)]]);
}
export function editStoryVariable(sources: Sources, id: string, initial: string, min?: string, max?: string): Sources {
  const story = readStory(sources), variable = story.variables.find(v => v.id === id), found = variable && variableLocation(sources, story, id);
  if (!variable || !found) throw new Error('变量不存在，请刷新');
  if (variable.type === 'int') {
    const value = BigInt(i64(initial)), lowerText = min === undefined ? variable.min : min, upperText = max === undefined ? variable.max : max;
    const lower = lowerText ? BigInt(i64(lowerText)) : undefined, upper = upperText ? BigInt(i64(upperText)) : undefined;
    if (lower !== undefined && upper !== undefined && lower > upper) throw new Error('变量下限不能大于上限');
    if (lower !== undefined && value < lower || upper !== undefined && value > upper) throw new Error('变量初始值超出范围');
  } else if (variable.type === 'bool' && !['true', 'false'].includes(initial)) throw new Error('布尔值应为 true 或 false');
  let xml = setAttribute(found.xml, found.node, 'initial', initial, false);
  for (const [key, value] of [['min', min], ['max', max]] as const) {
    if (value === undefined) continue;
    const current = group(parseXml(xml), 'variables').find(n => n.attrs.id === id)!;
    xml = setAttribute(xml, current, key, value);
  }
  return new Map([[found.file, xml]]);
}
export function deleteCharacter(sources: Sources, id: string): Sources {
  const story = readStory(sources);
  if (!story.characters.some(c => c.id === id)) throw new Error('人物不存在，请刷新');
  if (story.visuals.some(v => v.portraits.some(p => p.character === id))) throw new Error('人物仍被立绘引用，请先从相关视觉预设移除');
  for (const file of story.files) {
    const xml = sources.get(file), node = xml && group(parseXml(xml), 'characters').find(n => n.attrs.id === id);
    if (node) return new Map([[file, xml!.slice(0, node.start) + xml!.slice(node.end)]]);
  }
  throw new Error('人物声明不存在');
}
export function deleteStoryVariable(sources: Sources, id: string): Sources {
  const story = readStory(sources), found = variableLocation(sources, story, id);
  if (!story.variables.some(v => v.id === id) || !found) throw new Error('变量不存在，请刷新');
  return new Map([[found.file, found.xml.slice(0, found.node.start) + found.xml.slice(found.node.end)]]);
}
export function setStoryEntries(sources: Sources, frameRefs: string[]): Sources {
  if (!Array.isArray(frameRefs) || !frameRefs.length) throw new Error('故事入口至少需要一个实际幕');
  const story = readStory(sources), seen = new Set<string>(), entries: string[] = [];
  for (const ref of frameRefs) {
    const frame = resolve(story, ref); if (!frame || frame.pending) throw new Error('故事入口必须是实际幕');
    if (seen.has(frame.ref)) throw new Error('故事入口不能重复');
    seen.add(frame.ref); entries.push(frame.id ?? frame.ref);
  }
  const xml = sources.get('story.xml')!;
  return new Map([['story.xml', setAttribute(xml, parseXml(xml), 'entry', entries.join(' '))]]);
}
export function setStoryEntry(sources: Sources, frameRef: string): Sources { return setStoryEntries(sources, [frameRef]); }
/** Empty editor targets are persisted as explicit, marked End frames. The player
 * remains valid, source is authoritative, and publication blocks these placeholders. */
export function reconcilePendingRoutes(input: Sources, proposed: Route[], partial = false, protectedTargets?: Set<string>): { sources: Sources; routes: Route[] } {
  const sources = new Map(input), routes = proposed.map(r => ({ ...r, ...(r.branches ? { branches: r.branches.map(b => ({ ...b })) } : {}) }));
  let story = readStory(sources);
  const reserved = new Set(story.frames.flatMap(frame => [frame.ref, frame.id, frame.name].filter((value): value is string => !!value)));
  for (const route of [...routes]) {
    for (const destination of routeDestinations(route)) {
      if (destination.target) continue;
      const owner = resolve(story, route.frame); if (!owner) throw new Error('路由所属幕不存在');
      const id = newFrameRef(reserved), name = `kakera.pending.${id}`;
      const markup = `<frame id="${id}" name="${name}"><!-- Kakera pending route v1 --><text>后续剧情尚未连接。</text></frame>`;
      sources.set(owner.file, appendGroup(sources.get(owner.file)!, 'frames', markup));
      reserved.add(id); reserved.add(name);
      if (destination.branch === undefined) route.target = name; else route.branches![destination.branch].target = name;
      routes.push({ frame: name, kind: 'end', updates: [] });
    }
  }
  story = readStory(sources);
  const targets = new Set(routes.flatMap(routeDestinations).map(r => resolve(story, r.target)?.ref));
  const entries = new Set(storyEntries(story));
  const unused = story.frames.filter(f => f.pending && !targets.has(f.ref) && !entries.has(f.ref) && (!partial || (protectedTargets && !protectedTargets.has(f.ref))));
  for (const frame of unused) removeFrame(sources, frame);
  const removed = new Set(unused.map(f => f.ref));
  const filtered = routes.filter(r => !removed.has(resolve(story, r.frame)?.ref ?? r.frame));
  validateRoutes(readStory(sources), filtered, partial);
  return { sources, routes: filtered };
}
function changesFor(input: Sources, sources: Sources, managedFile: string, routes: Route[], logic?: LogicAnalysis): Sources {
  const changes = new Map([...sources].filter(([file, text]) => input.get(file) !== text));
  if (logic) for (const [file, text] of patchLogicRoutes(input, logic, routes, managedFile)) changes.set(file, text);
  else { const generated = emitRoutes(routes); if (input.get(managedFile) !== generated) changes.set(managedFile, generated); }
  return changes;
}
export function insertConnectedFrame(input: Sources, routes: Route[], managedFile: string, selectedRef: string, logic?: LogicAnalysis): { changes: Sources; selected: string } {
  const story = readStory(input), selected = resolve(story, selectedRef);
  if (!selected || selected.pending) throw new Error('请先选择要继续创作的幕');
  const owned = routes.filter(r => resolve(story, r.frame)?.ref === selected.ref);
  let connection: Route | undefined, branch: number | undefined;
  const openDestination = (r: Route) => routeDestinations(r).find(d => !d.target || resolve(story, d.target)?.pending);
  if (selected.options.length) {
    for (const option of selected.options) {
      const route = owned.find(r => r.kind === 'choice' && r.option === option.id);
      const open = route && openDestination(route);
      if (route && open) { connection = route; branch = open.branch; break; }
    }
    if (!connection) throw new Error('所有选项都已有后续幕。请先添加一个选项，或选择某条分支上的幕继续创作。');
  } else {
    connection = owned.find(r => r.kind === 'advance' || r.kind === 'end');
    if (connection?.branches?.length) { const open = openDestination(connection); if (!open) throw new Error('所有条件线路都已有后续幕。请先添加条件线路，或选择线路上的幕继续创作。'); branch = open.branch; }
  }
  if (!connection) throw new Error('这段高级逻辑暂不能自动连接，请选择可视编辑的幕');
  const inserted = insertFrame(input.get(selected.file)!, selected.ref, undefined, story.frames.flatMap(frame => [frame.ref, frame.id, frame.name].filter((value): value is string => !!value))), candidate = new Map(input);
  candidate.set(selected.file, inserted.source);
  const oldTargetRef = branch === undefined ? connection.target : connection.branches![branch].target;
  const oldTarget = connection.kind === 'advance' ? resolve(story, oldTargetRef) : undefined;
  const nextRoutes = routes.map(r => r === connection ? connection!.kind === 'end' ? { frame: connection!.frame, kind: 'advance' as const, target: inserted.ref, updates: [] } : setDestination(r, inserted.ref, branch) : r);
  nextRoutes.push(oldTarget && !oldTarget.pending ? { frame: inserted.ref, kind: 'advance', target: oldTargetRef, updates: [] } : { frame: inserted.ref, kind: 'end', updates: [] });
  const ready = reconcilePendingRoutes(candidate, nextRoutes, logic ? !logic.complete : false, logic ? protectedLogicTargets(logic) : undefined);
  return { changes: changesFor(input, ready.sources, managedFile, ready.routes, logic), selected: inserted.ref };
}
export function deleteConnectedFrame(input: Sources, routes: Route[], managedFile: string, ref: string, logic?: LogicAnalysis): { changes: Sources; selected: string } {
  if (logic && !logic.complete) throw new Error('仍有动态路线无法确定入边，暂不能安全删除幕；台词和可识别路线仍可编辑');
  const story = readStory(input), frame = resolve(story, ref), authors = story.frames.filter(f => !f.pending);
  if (!frame || frame.pending) throw new Error('请选择要删除的幕');
  if (logic?.references?.dynamicFrames) throw new Error('仍有动态 frame(id).enter/exit 或 ctx.resume 目标，暂不能安全删除幕；请先在源码中明确目标');
  if (logic?.references?.frames.has(frame.ref)) throw new Error('该幕仍被 frame(id).enter/exit 或 ctx.resume 目标引用，请先在已声明脚本中移除相关注册');
  if (authors.length <= 1) throw new Error('故事至少需要保留一幕');
  const owned = routes.filter(r => resolve(story, r.frame)?.ref === frame.ref);
  const forward = owned.length === 1 && owned[0].kind === 'advance' && !owned[0].branches?.length ? resolve(story, owned[0].target) : undefined;
  const successor = forward && !forward.pending && forward.ref !== frame.ref ? forward : undefined;
  const incoming = routes.filter(r => routeDestinations(r).some(d => resolve(story, d.target)?.ref === frame.ref) && resolve(story, r.frame)?.ref !== frame.ref);
  const nextRoutes = routes.filter(r => resolve(story, r.frame)?.ref !== frame.ref).map(r => {
    let next = r;
    for (const destination of routeDestinations(r)) if (resolve(story, destination.target)?.ref === frame.ref) next = setDestination(next, successor?.ref ?? '', destination.branch);
    return next;
  });
  const sources = new Map(input);
  const next = successor ?? resolve(story, incoming[0]?.frame) ?? authors[(authors.indexOf(frame) + 1) % authors.length];
  const entryRefs = storyEntries(story);
  if (entryRefs.includes(frame.ref)) {
    const remaining = entryRefs.filter(entry => entry !== frame.ref);
    if (!remaining.length) remaining.push((successor ?? authors.find(f => f.ref !== frame.ref)!).ref);
    for (const [file, text] of setStoryEntries(input, remaining)) sources.set(file, text);
  }
  removeFrame(sources, frame);
  const ready = reconcilePendingRoutes(sources, nextRoutes);
  return { changes: changesFor(input, ready.sources, managedFile, ready.routes, logic), selected: next.ref };
}
/** Delete several author frames in one validated transaction. Every incoming
 * route is rewired to the selected chain's explicit exit, or to a marked pending
 * placeholder, never to an arbitrary neighbouring branch. */
export function deleteConnectedFrames(input: Sources, routes: Route[], managedFile: string, refs: string[], logic?: LogicAnalysis): { changes: Sources; selected: string } {
  if (!Array.isArray(refs) || !refs.length) throw new Error('请选择要删除的幕');
  if (logic && !logic.complete) throw new Error('仍有动态路线无法确定入边，暂不能安全删除幕；台词和可识别路线仍可编辑');
  const story = readStory(input), authors = story.frames.filter(frame => !frame.pending), selected: Frame[] = [], seen = new Set<string>();
  for (const value of refs) {
    const frame = resolve(story, value);
    if (!frame || frame.pending) throw new Error('请选择要删除的幕');
    if (seen.has(frame.ref)) throw new Error('删除列表中的幕不能重复');
    seen.add(frame.ref); selected.push(frame);
  }
  if (authors.length <= selected.length) throw new Error('故事至少需要保留一幕');
  if (logic?.references?.dynamicFrames) throw new Error('仍有动态 frame(id).enter/exit 或 ctx.resume 目标，暂不能安全删除幕；请先在源码中明确目标');
  for (const frame of selected) {
    if (logic && !logic.frames[frame.ref]?.editable) throw new Error(logic.frames[frame.ref]?.reason ?? `幕 ${frame.ref} 的路线尚不能安全删除`);
    if (logic?.references?.frames.has(frame.ref)) throw new Error(`幕 ${frame.ref} 仍被 frame(id).enter/exit 或 ctx.resume 目标引用，请先在已声明脚本中移除相关注册`);
  }
  const selectedRefs = new Set(selected.map(frame => frame.ref));
  const exitOf = (frame: Frame, trail = new Set<string>()): Frame | undefined => {
    if (trail.has(frame.ref)) return undefined;
    trail.add(frame.ref);
    const owned = routes.filter(route => resolve(story, route.frame)?.ref === frame.ref);
    const forward = owned.length === 1 && owned[0].kind === 'advance' && !owned[0].branches?.length ? resolve(story, owned[0].target) : undefined;
    if (!forward || forward.pending) return undefined;
    return selectedRefs.has(forward.ref) ? exitOf(forward, trail) : forward;
  };
  const fallback = (frame: Frame): Frame | undefined => {
    const incoming = routes.find(route => resolve(story, route.frame)?.ref !== frame.ref && routeDestinations(route).some(destination => resolve(story, destination.target)?.ref === frame.ref));
    const owner = incoming ? resolve(story, incoming.frame) : undefined;
    if (owner && !owner.pending && !selectedRefs.has(owner.ref)) return owner;
    const index = authors.indexOf(frame);
    for (let offset = 1; offset <= authors.length; offset++) {
      const candidate = authors[(index + offset) % authors.length];
      if (!selectedRefs.has(candidate.ref)) return candidate;
    }
    return undefined;
  };
  const exits = new Map(selected.map(frame => [frame.ref, exitOf(frame)] as const));
  const nextRoutes = routes.flatMap(route => {
    const owner = resolve(story, route.frame);
    if (owner && selectedRefs.has(owner.ref)) return [];
    let next = route;
    for (const destination of routeDestinations(route)) {
      const target = resolve(story, destination.target);
      if (target && selectedRefs.has(target.ref)) next = setDestination(next, exits.get(target.ref)?.ref ?? '', destination.branch);
    }
    return [next];
  });
  const sources = new Map(input);
  const entryRefs = storyEntries(story);
  if (entryRefs.some(ref => selectedRefs.has(ref))) {
    const remaining = entryRefs.filter(ref => !selectedRefs.has(ref));
    if (!remaining.length) {
      const replacement = selected.map(frame => exits.get(frame.ref)).find((frame): frame is Frame => !!frame && !selectedRefs.has(frame.ref)) ?? authors.find(frame => !selectedRefs.has(frame.ref));
      if (!replacement) throw new Error('故事至少需要保留一幕');
      remaining.push(replacement.ref);
    }
    for (const [file, text] of setStoryEntries(input, remaining)) sources.set(file, text);
  }
  for (const frame of selected) removeFrame(sources, frame);
  const ready = reconcilePendingRoutes(sources, nextRoutes);
  const next = selected.map(frame => exits.get(frame.ref) ?? fallback(frame)).find((frame): frame is Frame => !!frame && !selectedRefs.has(frame.ref)) ?? authors.find(frame => !selectedRefs.has(frame.ref))!;
  return { changes: changesFor(input, ready.sources, managedFile, ready.routes, logic), selected: next.ref };
}
/** Duplicate one or more recognised frames and the routes they own. Targets that
 * stay inside the copied set are remapped to the new IDs; external targets are
 * preserved. A paste anchor may be in another chapter file. */
export function duplicateConnectedFrames(input: Sources, routes: Route[], managedFile: string, refs: string[], logic?: LogicAnalysis, afterRef?: string): { changes: Sources; selected: string } {
  if (!Array.isArray(refs) || !refs.length) throw new Error('请选择要复制的幕');
  const story = readStory(input), selected: Frame[] = [], seen = new Set<string>();
  for (const value of refs) {
    const frame = resolve(story, value);
    if (!frame || frame.pending) throw new Error('请选择要复制的实际幕');
    if (seen.has(frame.ref)) throw new Error('复制列表中的幕不能重复');
    seen.add(frame.ref); selected.push(frame);
  }
  if (logic && selected.some(frame => !logic.frames[frame.ref]?.editable)) throw new Error(selected.map(frame => logic.frames[frame.ref]?.reason).find(Boolean) ?? '此幕路线尚不能安全复制');
  const anchor = afterRef ? resolve(story, afterRef) : undefined;
  if (afterRef && (!anchor || anchor.pending)) throw new Error('粘贴位置必须是实际幕');
  const reserved = new Set(story.frames.flatMap(frame => [frame.ref, frame.id, frame.name].filter((value): value is string => !!value)));
  const changes: Sources = new Map(), mapping = new Map<string, string>();
  for (const frame of [...selected].reverse()) {
    const source = changes.get(frame.file) ?? input.get(frame.file)!;
    const node = group(parseXml(source), 'frames').find(candidate => (candidate.attrs.name || candidate.attrs.id) === frame.ref);
    if (!node) throw new Error('幕已改变，请刷新');
    const newRef = newShortId(reserved); reserved.add(newRef);
    let markup = source.slice(node.start, node.end);
    markup = setAttribute(markup, parseXml(markup), 'name', '');
    markup = setAttribute(markup, parseXml(markup), 'id', newRef);
    const file = anchor?.file ?? frame.file;
    const target = changes.get(file) ?? input.get(file)!;
    const position = anchor ? group(parseXml(target), 'frames').find(candidate => (candidate.attrs.name || candidate.attrs.id) === anchor.ref) : group(parseXml(target), 'frames').find(candidate => (candidate.attrs.name || candidate.attrs.id) === frame.ref);
    if (!position) throw new Error(anchor ? '粘贴位置已改变，请刷新' : '幕已改变，请刷新');
    changes.set(file, target.slice(0, position.end) + `\n    ${markup}\n` + target.slice(position.end));
    mapping.set(frame.ref, newRef);
  }
  const copies: Route[] = [];
  const remap = (target: string) => mapping.get(resolve(story, target)?.ref ?? '') ?? target;
  for (const frame of selected) {
    const newRef = mapping.get(frame.ref)!;
    for (const route of routes.filter(item => resolve(story, item.frame)?.ref === frame.ref)) copies.push({
      ...route,
      frame: newRef,
      ...(route.kind === 'end' || route.target === undefined ? {} : { target: remap(route.target) }),
      ...(route.branches ? { branches: route.branches.map(branch => ({ ...branch, target: remap(branch.target) })) } : {}),
      updates: route.updates.map(update => ({ ...update }))
    });
  }
  const candidate = new Map([...input, ...changes]);
  const ready = reconcilePendingRoutes(candidate, [...routes, ...copies], logic ? !logic.complete : false, logic ? protectedLogicTargets(logic) : undefined);
  return { changes: changesFor(input, ready.sources, managedFile, ready.routes, logic), selected: mapping.get(selected[0].ref)! };
}
