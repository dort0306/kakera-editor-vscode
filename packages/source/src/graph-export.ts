import type { Expr, Route, Story } from '../../domain/src/index';
import { routeDestinations, storyEntries } from '../../domain/src/index';
import { buildStoryGraph, graphEdgeGeometry, GRAPH_NODE_WIDTH as W, GRAPH_NODE_HEIGHT as H } from '../../domain/src/graph';
import type { Point } from './workbench';
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
function lines(text: string, width: number, limit: number): string[] {
  const result: string[] = []; let line = '', length = 0;
  for (const c of text.replace(/\s+/g, ' ')) { const size = c.codePointAt(0)! > 255 ? 2 : 1; if (length + size > width) { result.push(line); line = ''; length = 0; } line += c; length += size; }
  if (line) result.push(line);
  return result.length > limit ? [...result.slice(0, limit - 1), result[limit - 1].slice(0, -1) + '…'] : result;
}
function expression(e: Expr): string {
  if (e.kind === 'constant') return e.type === 'string' ? JSON.stringify(e.value) : e.value;
  if (e.kind === 'variable') return e.id;
  if (e.kind === 'not') return `非 (${expression(e.value)})`;
  return `(${expression(e.left)} ${e.kind === 'compare' ? e.op : e.kind === 'and' ? '且' : '或'} ${expression(e.right)})`;
}
export interface GraphExportOptions { title: string; layout?: Record<string, Point>; revision?: string }
/** Plain SVG only: no foreignObject, scripts, external CSS, images or URLs. */
export function renderGraphExport(story: Story, routes: Route[] | undefined, options: GraphExportOptions, format: 'svg' | 'html'): string {
  if (story.frames.length > 2000 || (routes?.length ?? 0) > 10000) throw new Error('流程图超过导出预算（2000 幕 / 10000 条候选路线）');
  const graph = buildStoryGraph(story, routes, options.layout), authors = story.frames.filter(f => !f.pending);
  const frames = new Map(story.frames.map(f => [f.ref, f])), aliases = new Map(story.frames.flatMap(f => [f.ref, f.id, f.name].filter((x): x is string => !!x).map(x => [x, f.ref])));
  const indices = new Map(authors.map((f, i) => [f.ref, i])), nodes = new Map(graph.nodes.map(n => [n.id, n]));
  const geometry = graph.edges.map((e, i) => graphEdgeGeometry(graph, e, i));
  const minX = Math.min(0, ...graph.nodes.map(n => n.x - 50)), width = graph.width - minX, bottom = Math.max(graph.height, ...geometry.map(g => g.bottom + 32)), height = bottom + 96;
  const colors = [...new Set(graph.edges.map(e => e.color))], unknown = graph.nodes.filter(n => n.unknown).length, pending = graph.nodes.filter(n => n.pending).length, detached = graph.nodes.filter(n => n.frameRef && n.disconnected).length;
  const summary = `${authors.length} 幕 · ${graph.edges.length} 条连线 · 待连接 ${pending} · 未知目标 ${unknown} · 未接入入口 ${detached}`;
  const entryIds = new Set(storyEntries(story).map(entry => aliases.get(entry) ?? entry));
  const name = (ref: string) => { const f = frames.get(ref); return f?.pending ? '待连接' : f ? f.name || `第 ${(indices.get(ref) ?? 0) + 1} 幕` : '未知目标'; };
  const cardKind = (ref: string) => { const frame = frames.get(ref); if (!frame) return '未知目标'; if (frame.pending) return '待连接'; if (frame.options.length) return '选择'; const owned = routes?.filter(r => aliases.get(r.frame) === ref); return owned?.some(r => r.kind === 'end') ? '结束' : owned?.some(r => r.branches?.length) ? '条件分流' : owned?.some(r => r.dynamic || r.conditional) || !owned?.length ? '脚本路线' : '推进'; };
  const edgeSvg = graph.edges.map((edge, i) => {
    const g = geometry[i], label = `${edge.label}${edge.conditional ? ' · 有条件/候选' : ''}${edge.loop ? ' · 循环' : ''}${edge.pending ? ' · 待连接' : ''}`;
    return `<g><title>${escape(`${name(edge.source)} → ${name(edge.target)}：${label}`)}</title><path d="${g.d}" fill="none" stroke="${escape(edge.color)}" stroke-width="2"${edge.uncertain || edge.conditional || edge.pending ? ' stroke-dasharray="6 4"' : ''} marker-end="url(#branch-${colors.indexOf(edge.color)})"/><text x="${g.lx}" y="${g.ly}" text-anchor="middle" font-size="11" fill="#263748" stroke="#f6f8fb" stroke-width="4" stroke-linejoin="round" paint-order="stroke">${lines(label, 32, 3).map((s, n) => `<tspan x="${g.lx}" dy="${n ? 14 : 0}">${escape(s)}</tspan>`).join('')}</text></g>`;
  }).join('');
  const nodeSvg = graph.nodes.map((node, i) => {
    const frame = frames.get(node.id), kind = cardKind(node.id), label = node.pending ? '待连接' : node.unknown ? '未知目标' : name(node.id), text = node.pending || node.unknown ? node.label : frame!.text;
    const badge = node.disconnected && node.frameRef ? ' · 未接入入口' : entryIds.has(node.id) ? ' · 入口' : '';
    const content = `<g id="graph-node-${i}" data-frame-ref="${escape(node.frameRef ?? '')}"><title>${escape(`${label} · ${kind}${badge}\n${text}${frame && !frame.pending ? `\n引用：${frame.ref}\n位置：${frame.file}:${frame.line}` : ''}`)}</title><rect x="${node.x}" y="${node.y}" width="${W}" height="${H}" rx="8" fill="${node.pending ? '#fff3d9' : node.unknown ? '#fff0ef' : '#ffffff'}" stroke="${node.disconnected || node.pending || node.unknown ? '#bc8b47' : '#7898b1'}"${node.disconnected || node.unknown ? ' stroke-dasharray="5 3"' : ''}/><text x="${node.x + 10}" y="${node.y + 19}" font-size="12" font-weight="700" fill="#172b3a">${escape(lines(label, 24, 1)[0] ?? '')}</text><text x="${node.x + 10}" y="${node.y + 36}" font-size="10" fill="#677b8b">${escape(kind + badge)}</text><text x="${node.x + 10}" y="${node.y + 56}" font-size="12" fill="#263748">${lines(text, 26, 3).map((s, n) => `<tspan x="${node.x + 10}" dy="${n ? 17 : 0}">${escape(s)}</tspan>`).join('')}</text></g>`;
    return format === 'html' && node.frameRef ? `<a href="#frame-${indices.get(node.frameRef)}">${content}</a>` : content;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${minX} -72 ${width} ${height}" role="img" aria-labelledby="flow-title flow-desc" font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif"><title id="flow-title">${escape(options.title)} · 幕流程图</title><desc id="flow-desc">${escape(summary)}。悬停查看完整文字；动态候选不代表运行结果。</desc><rect x="${minX}" y="-72" width="${width}" height="${height}" fill="#f6f8fb"/><defs>${colors.map((c, i) => `<marker id="branch-${i}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${escape(c)}"/></marker>`).join('')}</defs><text x="${minX + 24}" y="-44" font-size="20" font-weight="700" fill="#172b3a">${escape(lines(options.title + ' · 幕流程图', 64, 1)[0] ?? '')}</text><text x="${minX + 24}" y="-18" font-size="12" fill="#546b7c">${escape(summary)}</text>${edgeSvg}${nodeSvg}</svg>`;
  if (format === 'svg') return '<?xml version="1.0" encoding="UTF-8"?>\n' + svg;
  const list = authors.map((frame, i) => {
    const node = nodes.get(frame.ref)!, owned = routes?.filter(r => aliases.get(r.frame) === frame.ref) ?? [];
    const details = owned.flatMap(r => (r.kind === 'end' ? [{}] : routeDestinations(r)).map(destination => ({ r, destination }))).map(({ r, destination: dest }) => {
      const d = dest as { target?: string; when?: Expr; branch?: number };
      const target = d.target ? aliases.get(d.target) : undefined, targetIndex = target ? indices.get(target) : undefined;
      const destination = r.kind === 'end' ? '结束' : targetIndex !== undefined ? `<a href="#frame-${targetIndex}">${escape(name(target!))}</a>` : escape(target ? name(target) : r.dynamic ? '动态目标 · 需试玩确认' : d.target ? `不存在的目标：${d.target}` : '未知目标');
      const label = r.kind === 'choice' ? frame.options.find(o => o.id === r.option)?.text ?? r.option ?? '未知选项' : r.kind === 'end' ? '结束路线' : '推进';
      return `<li><strong>${escape(label)}${d.when ? ` · 条件 ${d.branch! + 1}` : r.branches?.length ? ' · 否则（默认）' : ''}</strong> → ${destination}${r.conditional ? '（候选目标）' : ''}${d.when ? `<div>分流条件（按顺序首个满足）：${escape(expression(d.when))}</div>` : ''}${r.branches?.length ? '<div>先执行变量更新，再判断条件；均不满足时进入默认线路。</div>' : ''}${r.guard ? `<div>显示条件：${escape(expression(r.guard))}</div>` : ''}${r.updates.map(u => `<div>变量更新：${escape(u.variable)} ${u.op === 'add' ? '+=' : '='} ${escape(expression(u.value))}</div>`).join('')}</li>`;
    }).join('');
    return `<article id="frame-${i}"><h2>${escape(name(frame.ref))} <small>${cardKind(frame.ref)}${node.disconnected ? ' · 未接入入口' : ''}</small></h2><p class="meta">${escape(frame.ref)} · ${escape(frame.file)}:${frame.line}</p><p class="dialogue">${escape(frame.text)}</p><ul>${details || '<li>未知脚本路线 · 需试玩确认</li>'}</ul><a href="#top">返回流程图</a></article>`;
  }).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escape(options.title)} · 幕流程图</title><style>body{margin:24px;color:#203547;background:#f6f8fb;font:14px/1.7 'Microsoft YaHei',sans-serif}h1{font-size:24px}a{color:#216c9e}.diagram{max-height:75vh;overflow:auto;border:1px solid #b4c4d0;background:white}.diagram svg{display:block}article{background:white;border:1px solid #d1dce5;border-radius:8px;padding:18px;margin:20px 0;scroll-margin-top:16px}h2{margin:0;font-size:18px}small,.meta{font-size:12px;color:#637b8c}.dialogue{white-space:pre-wrap;overflow-wrap:anywhere}li{margin:8px 0;overflow-wrap:anywhere}@media print{.diagram{max-height:none;overflow:visible}.diagram svg{max-width:100%;height:auto}article{break-inside:avoid}}</style></head><body id="top"><h1>${escape(options.title)} · 幕流程图</h1><p>${escape(summary)}</p><p>浏览器缩放查看 · Ctrl+F 查找全文 · 点击幕卡片跳到完整台词和路线。导出来自当前源码缓冲，动态候选须通过试玩确认。</p><p class="meta">源码快照：${escape(options.revision ?? '未提供')}</p><div class="diagram">${svg}</div><h2>幕与路线完整清单</h2>${list}</body></html>`;
}
