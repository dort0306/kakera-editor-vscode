import type { Route, Story } from './index';
import { routeDestinations, describeExpression, storyEntries } from './index';
export interface GraphNode { id: string; frameRef?: string; label: string; x: number; y: number; unknown: boolean; disconnected: boolean; pending?: boolean }
export interface GraphEdge { id: string; source: string; target: string; label: string; conditional: boolean; uncertain: boolean; loop: boolean; color: string; pending?: boolean; option?: string; branch?: number }
export interface StoryGraph { nodes: GraphNode[]; edges: GraphEdge[]; width: number; height: number }
export const GRAPH_NODE_WIDTH = 190, GRAPH_NODE_HEIGHT = 112;
export function graphEdgeGeometry(graph: StoryGraph, edge: GraphEdge, index: number) {
  const from = graph.nodes.find(n => n.id === edge.source)!, to = graph.nodes.find(n => n.id === edge.target)!;
  const siblings = graph.edges.filter(e => e.source === edge.source), at = siblings.indexOf(edge);
  const sx = from.x + GRAPH_NODE_WIDTH, sy = siblings.length === 1 ? from.y + GRAPH_NODE_HEIGHT / 2 : from.y + 28 + (at + 1) * (GRAPH_NODE_HEIGHT - 40) / (siblings.length + 1), tx = to.x, ty = to.y + GRAPH_NODE_HEIGHT / 2;
  if (edge.loop || tx <= sx) {
    const bottom = Math.max(from.y, to.y) + GRAPH_NODE_HEIGHT + 24 + (index % 3) * 12;
    return { sx, sy, tx, ty, bottom, d: `M ${sx} ${sy} C ${sx + 32} ${sy}, ${sx + 32} ${bottom}, ${sx} ${bottom} L ${tx - 22} ${bottom} C ${tx - 42} ${bottom}, ${tx - 42} ${ty}, ${tx} ${ty}`, lx: from.x + GRAPH_NODE_WIDTH / 2, ly: bottom - 5 };
  }
  const bend = (tx - sx) / 2;
  return { sx, sy, tx, ty, bottom: Math.max(sy, ty), d: `M ${sx} ${sy} C ${sx + bend} ${sy}, ${tx - bend} ${ty}, ${tx} ${ty}`, lx: (sx + tx) / 2, ly: (sy + ty) / 2 - 8 };
}
export function buildStoryGraph(story: Story, routes?: Route[], layout: Record<string, { x: number; y: number }> = {}): StoryGraph {
  const nodes: GraphNode[] = story.frames.map(f => ({ id: f.ref, ...(f.pending ? { pending: true } : { frameRef: f.ref }), label: f.pending ? '尚未连接 · 选中前一幕后点击“新增幕”' : f.text, x: 0, y: 0, unknown: false, disconnected: false }));
  const aliases = new Map(story.frames.flatMap(f => [f.id, f.name].filter((v): v is string => !!v).map(alias => [alias, f.ref])));
  const edges: GraphEdge[] = [];
  for (const frame of story.frames) {
    if (frame.pending) continue;
    const owned = routes?.filter(r => aliases.get(r.frame) === frame.ref).sort((a, b) => frame.options.findIndex(o => o.id === a.option) - frame.options.findIndex(o => o.id === b.option));
    if (!owned?.length) {
      const options = frame.options.length ? frame.options : [{ id: 'dynamic', text: '高级逻辑' }];
      for (const option of options) {
        const unknown = `?${frame.ref}:${option.id}`;
        nodes.push({ id: unknown, label: '动态目标未知', x: 0, y: 0, unknown: true, disconnected: false });
        edges.push({ id: `edge:${edges.length}`, source: frame.ref, target: unknown, label: option.text, conditional: false, uncertain: true, loop: false, color: '' });
      }
    } else for (const route of owned) for (const destination of routeDestinations(route)) {
      const target = destination.target ? aliases.get(destination.target) : undefined;
      const id = target ?? `?${frame.ref}:${route.option ?? 'advance'}:${edges.length}`;
      if (!target) nodes.push({ id, label: route.dynamic ? '动态目标 · 由脚本运行时决定' : '目标不存在', x: 0, y: 0, unknown: true, disconnected: false });
      const prefix = route.kind === 'choice' ? frame.options.find(o => o.id === route.option)?.text ?? route.option ?? '选择' : '推进';
      const label = destination.when ? `${prefix} · 条件 ${destination.branch! + 1}：${describeExpression(destination.when)}` : route.branches?.length ? `${prefix} · 否则（默认）` : prefix;
      edges.push({ id: `edge:${edges.length}`, source: frame.ref, target: id, option: route.option, branch: destination.branch, label, conditional: !!route.guard || !!route.conditional, uncertain: !target, loop: false, color: '', ...(story.frames.find(f => f.ref === target)?.pending ? { pending: true } : {}) });
    }
  }
  const outgoing = new Map(nodes.map(n => [n.id, [] as string[]]));
  for (const edge of edges) outgoing.get(edge.source)!.push(edge.target);
  // Condense strongly-connected components before assigning ranks. This handles
  // self-loops and arbitrary cycles without inventing duplicate scene cards.
  let cursor = 0;
  const order = new Map<string, number>(), low = new Map<string, number>(), stack: string[] = [], onStack = new Set<string>(), components: string[][] = [];
  function visit(id: string): void {
    order.set(id, cursor); low.set(id, cursor++); stack.push(id); onStack.add(id);
    for (const next of outgoing.get(id)!) {
      if (!order.has(next)) { visit(next); low.set(id, Math.min(low.get(id)!, low.get(next)!)); }
      else if (onStack.has(next)) low.set(id, Math.min(low.get(id)!, order.get(next)!));
    }
    if (order.get(id) === low.get(id)) { const group: string[] = []; let next: string; do { next = stack.pop()!; onStack.delete(next); group.push(next); } while (next !== id); components.push(group.reverse()); }
  }
  const entryIds = [...new Set(storyEntries(story).map(entry => aliases.get(entry) ?? entry))].filter(id => nodes.some(node => node.id === id));
  for (const entry of entryIds) if (!order.has(entry)) visit(entry);
  for (const node of nodes) if (!order.has(node.id)) visit(node.id);
  for (const group of components) group.sort((a, b) => order.get(a)! - order.get(b)!);
  const component = new Map(components.flatMap((group, i) => group.map(id => [id, i] as const)));
  const dag = components.map(() => new Set<number>()), incoming = components.map(() => 0), rank = components.map(() => 0);
  for (const edge of edges) {
    const a = component.get(edge.source)!, b = component.get(edge.target)!;
    edge.loop = a === b && components[a].indexOf(edge.target) <= components[a].indexOf(edge.source);
    if (a !== b && !dag[a].has(b)) { dag[a].add(b); incoming[b]++; }
  }
  const queue = incoming.map((v, i) => v === 0 ? i : -1).filter(i => i >= 0);
  for (let i = 0; i < queue.length; i++) for (const next of dag[queue[i]]) { rank[next] = Math.max(rank[next], rank[queue[i]] + components[queue[i]].length); if (--incoming[next] === 0) queue.push(next); }
  const reachable = new Set<string>(), pending = [...entryIds];
  while (pending.length) { const id = pending.pop()!; if (reachable.has(id)) continue; reachable.add(id); pending.push(...outgoing.get(id)!); }
  // A branch owns a lane across columns. Never repack each column separately:
  // unequal-length sibling routes must remain horizontal until they merge.
  const lanes = new Map<string, number>(), edgeMap = new Map(nodes.map(n => [n.id, [] as GraphEdge[]]));
  const parents = new Map(nodes.map(n => [n.id, 0]));
  for (const edge of edges) { edgeMap.get(edge.source)!.push(edge); if (!edge.loop) parents.set(edge.target, parents.get(edge.target)! + 1); }
  const palette = ['#68b7c8', '#e5a15b', '#b597ee', '#66c99e', '#ee879c', '#86a8ef', '#d1c75f', '#df93d1'];
  let nextLane = 0, nextColor = 1;
  const color = (i: number) => palette[i] ?? `hsl(${(i * 137.508) % 360} 68% 67%)`;
  function assign(id: string, lane: number, branchColor: string): void {
    if (lanes.has(id)) return;
    lanes.set(id, lane); nextLane = Math.max(nextLane, lane + 1);
    const children = edgeMap.get(id)!;
    const common = parents.get(id)! > 1 ? palette[0] : branchColor;
    for (let i = 0; i < children.length; i++) {
      const edge = children[i]; edge.color = children.length > 1 ? color(nextColor++) : common;
      const row = i === 0 ? lane : nextLane++;
      assign(edge.target, row, edge.color);
    }
  }
  if (entryIds.length) assign(entryIds[0], 0, palette[0]);
  for (const entry of entryIds.slice(1)) if (!lanes.has(entry)) assign(entry, nextLane++, palette[0]);
  for (const node of nodes) if (!lanes.has(node.id)) assign(node.id, nextLane++, palette[0]);
  for (const node of nodes) {
    node.disconnected = !reachable.has(node.id);
    const group = component.get(node.id)!, column = rank[group] + components[group].indexOf(node.id);
    node.x = 32 + column * 310; node.y = 48 + lanes.get(node.id)! * 174 + (node.disconnected ? 80 : 0);
    const saved = layout[node.id]; if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) { node.x = saved.x; node.y = saved.y; }
  }
  return { nodes, edges, width: Math.max(600, ...nodes.map(n => n.x + GRAPH_NODE_WIDTH + 80)), height: Math.max(240, ...nodes.map(n => n.y + GRAPH_NODE_HEIGHT + 48)) };
}
