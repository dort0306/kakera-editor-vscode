import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Point } from '../../source/src/workbench';
import type { Route, Story } from '../../domain/src/index';
import { routeDestinations, describeExpression, storyEntries } from '../../domain/src/index';
import { buildStoryGraph, graphEdgeGeometry, GRAPH_NODE_HEIGHT as H, GRAPH_NODE_WIDTH as W } from '../../domain/src/graph';
import { Icon } from './icons';
const EMPTY_LAYOUT: Record<string, Point> = {};
export function StoryGraphView({ story, routes, selected, query, select, layout = EMPTY_LAYOUT, disabled = false, editable, onLayout, onReconnect, onExport }: { story: Story; routes?: Route[]; selected?: string; query: string; select: (ref: string) => void; layout?: Record<string, Point>; disabled?: boolean; editable?: (ref: string) => boolean; onLayout?: (ref?: string, point?: Point) => void; onReconnect?: (ref: string, target: string, option?: string, branch?: number) => void; onExport?: () => void }) {
  const [positions, setPositions] = useState(layout);
  const entryRefs = useMemo(() => new Set(storyEntries(story)), [story]);
  const graph = useMemo(() => buildStoryGraph(story, routes, positions), [story, routes, positions]);
  const [zoom, setZoom] = useState(1);
  const svg = useRef<SVGSVGElement>(null), scroll = useRef<HTMLDivElement>(null), panSurface = useRef<SVGRectElement>(null), moved = useRef(false);
  const gesture = useRef<{ ref: string; start: Point; origin: Point; last: Point } | undefined>(undefined);
  const pan = useRef<{ x: number; y: number; left: number; top: number } | undefined>(undefined);
  const [panning, setPanning] = useState(false);
  const [wire, setWire] = useState<{ ref: string; option?: string; branch?: number; start: Point; end: Point; moved: boolean }>();
  const wireRef = useRef(wire); wireRef.current = wire;
  const [edgeSelection, setEdgeSelection] = useState<{ ref: string; option?: string; branch?: number }>();
  useEffect(() => { if (!gesture.current) setPositions(layout); }, [layout]);
  useEffect(() => { const failed = (e: MessageEvent) => { if (e.data.type === 'error') { gesture.current = undefined; setWire(undefined); setPositions(layout); } }; window.addEventListener('message', failed); return () => window.removeEventListener('message', failed); }, [layout]);
  useEffect(() => { const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') { pan.current = undefined; setPanning(false); gesture.current = undefined; setWire(undefined); setPositions(layout); } }; window.addEventListener('keydown', escape); return () => window.removeEventListener('keydown', escape); }, [layout]);
  // Pointer capture can be dropped by the host when the SVG subtree is updated.
  // Keep the gesture alive and still commit when the release happens outside the canvas.
  useEffect(() => {
    const moveOutside = (e: PointerEvent) => { const active = pan.current, area = scroll.current; if (!active || !area) return; area.scrollLeft = active.left - (e.clientX - active.x); area.scrollTop = active.top - (e.clientY - active.y); };
    const finishOutside = () => { if (pan.current) { pan.current = undefined; setPanning(false); } const drag = gesture.current; if (!drag) return; const wasMoved = moved.current; gesture.current = undefined; moved.current = false; if (wasMoved) onLayout?.(drag.ref, drag.last); };
    const cancelOutside = () => { pan.current = undefined; setPanning(false); if (!gesture.current) return; gesture.current = undefined; moved.current = false; setPositions(layout); };
    window.addEventListener('pointermove', moveOutside);
    window.addEventListener('pointerup', finishOutside);
    window.addEventListener('pointercancel', cancelOutside);
    return () => { window.removeEventListener('pointermove', moveOutside); window.removeEventListener('pointerup', finishOutside); window.removeEventListener('pointercancel', cancelOutside); };
  }, [layout, onLayout]);
  const point = (e: { clientX: number; clientY: number }): Point => { const rect = svg.current!.getBoundingClientRect(); return { x: (e.clientX - rect.left) / zoom, y: (e.clientY - rect.top) / zoom }; };
  const canWire = (ref: string) => !disabled && !!onReconnect && (editable?.(ref) ?? true);
  const beginWire = (e: React.PointerEvent, ref: string, option: string | undefined, start: Point, branch?: number) => { if (!canWire(ref) || e.button > 0) return; e.stopPropagation(); e.preventDefault(); moved.current = false; setWire({ ref, option, branch, start, end: point(e), moved: false }); svg.current?.setPointerCapture?.(e.pointerId); };
  const finishWire = (ref: string) => { const active = wireRef.current; if (!active || !canWire(active.ref)) return; onReconnect?.(active.ref, ref, active.option, active.branch); setWire(undefined); };
  const markerPrefix = useId().replaceAll(':', '');
  const colors = [...new Set(graph.edges.map(e => e.color))];
  const authors = story.frames.filter(f => !f.pending);
  const disconnectedY = Math.min(...graph.nodes.filter(n => n.disconnected).map(n => n.y));
  return <section className="branch-view" aria-label="剧情分支图">
    <div className="graph-toolbar"><span className="muted">分支分色 · 拖动幕调整布局 · 拖动空白处平移画布 · 拖出连接点或箭头端点重新连线</span><div>{onExport && <button disabled={disabled || !!wire || !!gesture.current} onClick={onExport}><Icon name="package" size={13} />导出流程图</button>}{onLayout && <button disabled={disabled} onClick={() => { setPositions({}); onLayout(); }}><Icon name="grid" size={13} />自动排列</button>}{onReconnect && <button disabled={!edgeSelection || !canWire(edgeSelection.ref)} onClick={() => { if (edgeSelection) onReconnect(edgeSelection.ref, '', edgeSelection.option, edgeSelection.branch); setEdgeSelection(undefined); }}><Icon name="trash" size={13} />断开所选连线</button>}<button aria-label="缩小分支图" title="缩小" onClick={() => setZoom(Math.max(.35, zoom - .15))}><Icon name="zoom-out" size={13} /></button><span className="zoom-value">{Math.round(zoom * 100)}%</span><button aria-label="放大分支图" title="放大" onClick={() => setZoom(Math.min(1.8, zoom + .15))}><Icon name="zoom-in" size={13} /></button><button onClick={() => setZoom(1)}><Icon name="fit" size={13} />重置缩放</button></div></div>
    {wire && <p className="connection-hint" role="status"><Icon name="alert" size={13} />选择后续幕的左侧连接点；Escape 取消</p>}
    <div ref={scroll} className={`graph-scroll ${panning ? 'panning' : ''}`}><svg ref={svg} width={graph.width * zoom} height={graph.height * zoom} viewBox={`0 0 ${graph.width} ${graph.height}`} role="group" aria-label="幕与选项连接"
      onPointerDown={e => {
        if (e.button !== 0 || e.target !== panSurface.current || wireRef.current || gesture.current) return;
        const area = scroll.current; if (!area) return;
        e.preventDefault();
        pan.current = { x: e.clientX, y: e.clientY, left: area.scrollLeft, top: area.scrollTop };
        setPanning(true); svg.current?.setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={e => { if (pan.current) { const area = scroll.current; if (area) { area.scrollLeft = pan.current.left - (e.clientX - pan.current.x); area.scrollTop = pan.current.top - (e.clientY - pan.current.y); } return; } const p = point(e), drag = gesture.current; if (drag) {
        // Capturing on pointerdown retargets even a plain click to the SVG.
        // Wait for a real drag, measured in screen pixels at every zoom level.
        if (Math.hypot(p.x - drag.start.x, p.y - drag.start.y) * zoom < 4 && !moved.current) return;
        if (!moved.current) svg.current?.setPointerCapture?.(e.pointerId);
        moved.current = true; drag.last = { x: Math.max(20, Math.min(100000, drag.origin.x + p.x - drag.start.x)), y: Math.max(40, Math.min(100000, drag.origin.y + p.y - drag.start.y)) }; setPositions(old => ({ ...old, [drag.ref]: drag.last }));
      } else if (wireRef.current) { const active = wireRef.current; setWire({ ...active, end: p, moved: active.moved || Math.hypot(p.x - active.start.x, p.y - active.start.y) > 8 }); } }}
      onPointerUp={e => { if (pan.current) { pan.current = undefined; setPanning(false); if (svg.current?.hasPointerCapture?.(e.pointerId)) svg.current.releasePointerCapture(e.pointerId); return; } const drag = gesture.current; gesture.current = undefined; if (drag && moved.current) onLayout?.(drag.ref, drag.last); else if (wireRef.current?.moved) { const p = point(e), node = graph.nodes.find(n => n.frameRef && p.x >= n.x - 18 && p.x <= n.x + W && p.y >= n.y && p.y <= n.y + H); if (node?.frameRef) finishWire(node.frameRef); else setWire(undefined); } if (svg.current?.hasPointerCapture?.(e.pointerId)) svg.current.releasePointerCapture(e.pointerId); }}
      onPointerLeave={() => { if (gesture.current && !moved.current) gesture.current = undefined; }}
      onLostPointerCapture={() => { if (!pan.current && gesture.current && !moved.current) { gesture.current = undefined; moved.current = false; setPositions(layout); } }}
      onPointerCancel={() => { pan.current = undefined; setPanning(false); gesture.current = undefined; moved.current = false; setWire(undefined); setPositions(layout); }}>
      <rect ref={panSurface} className="graph-pan-surface" x="0" y="0" width={graph.width} height={graph.height} fill="transparent" pointerEvents="all" />
      <defs>{colors.map((color, i) => <marker key={color} id={`${markerPrefix}-arrow-${i}`} fill={color} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" /></marker>)}</defs>
      <text x="32" y="25" className="graph-section">故事入口与剧情路线</text>
      {Number.isFinite(disconnectedY) && <text x="32" y={disconnectedY - 18} className="graph-section">未连接到入口的幕（不会自动按文件顺序连接）</text>}
      {graph.edges.map((edge, i) => {
        const { sx, sy, tx, ty, d, lx, ly } = graphEdgeGeometry(graph, edge, i);
        const label = `${edge.label}${edge.conditional ? ' · 有条件' : ''}${edge.loop ? ' · 循环' : ''}`;
        return <g key={edge.id} stroke={edge.color} data-branch-color={edge.color} className={`graph-edge ${edge.uncertain || edge.pending ? 'uncertain' : edge.conditional ? 'conditional' : ''}`} onClick={() => setEdgeSelection({ ref: edge.source, option: edge.option, branch: edge.branch })}><title>{label}</title><path className="edge-hit" d={d}/><path d={d} markerEnd={`url(#${markerPrefix}-arrow-${colors.indexOf(edge.color)})`} /><text x={lx} y={ly} textAnchor="middle">{label.length > 18 ? label.slice(0, 17) + '…' : label}</text>{canWire(edge.source) && <circle className="reconnect-handle" cx={tx - 18} cy={ty} r={6} aria-label={`重新连接：${edge.label}`} onPointerDown={e => beginWire(e, edge.source, edge.option, { x: sx, y: sy }, edge.branch)}/>}</g>;
      })}
      {graph.nodes.map(node => {
        const frame = story.frames.find(f => f.ref === node.frameRef);
        const ownRoute = routes?.find(r => r.frame === frame?.ref), kind = ownRoute?.kind;
        const match = !query || node.label.includes(query) || node.id.includes(query);
        return <foreignObject x={node.x} y={node.y} width={W} height={H} key={node.id}><button data-frame-ref={node.frameRef} className={`graph-node ${node.unknown ? 'unknown' : ''} ${node.id === selected ? 'selected' : ''} ${node.frameRef && entryRefs.has(node.frameRef) ? 'entry' : ''} ${match ? '' : 'dimmed'}`} disabled={!node.frameRef} aria-pressed={node.id === selected}
          onPointerDown={e => { if (e.button === 0) moved.current = false; if (!disabled && onLayout && node.frameRef && e.button === 0 && !wireRef.current) { const p = point(e); gesture.current = { ref: node.frameRef, start: p, origin: { x: node.x, y: node.y }, last: { x: node.x, y: node.y } }; } }}
          onKeyDown={e => { if (e.altKey && !disabled && onLayout && node.frameRef && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) { e.preventDefault(); onLayout(node.frameRef, { x: Math.max(20, node.x + (e.key === 'ArrowLeft' ? -20 : e.key === 'ArrowRight' ? 20 : 0)), y: Math.max(40, node.y + (e.key === 'ArrowUp' ? -20 : e.key === 'ArrowDown' ? 20 : 0)) }); } }}
          onClick={e => { const dragged = moved.current; moved.current = false; if (dragged && e.detail !== 0) return; if (node.frameRef) { if (wireRef.current) finishWire(node.frameRef); else select(node.frameRef); } }}>
          <span className="frame-top">{node.pending ? '待连接' : node.unknown ? '未知目标' : frame?.name ?? `第 ${authors.indexOf(frame!) + 1} 幕`}<small>{node.pending ? '' : kind === 'choice' ? '选择' : kind === 'end' ? '结束' : ownRoute?.branches?.length ? '条件分流' : node.unknown ? '' : routes ? '推进' : '高级逻辑'}</small>{node.frameRef && entryRefs.has(node.frameRef) && <small className="entry-tag">入口</small>}</span><p>{node.label}</p>
        </button></foreignObject>;
      })}
      {onReconnect && graph.nodes.filter(n => n.frameRef).map(node => { const frame = story.frames.find(f => f.ref === node.frameRef)!; const owned = routes?.filter(r => r.frame === frame.ref && !r.conditional && !r.dynamic) ?? []; const ports = owned.length ? owned.flatMap(r => r.kind === 'end' ? [{ option: undefined, branch: undefined, label: '后续幕' }] : routeDestinations(r).map(d => ({ option: r.option, branch: d.branch, label: `${r.option ? frame.options.find(o => o.id === r.option)?.text ?? r.option : ''}${d.when ? `条件 ${d.branch! + 1}：${describeExpression(d.when)}` : r.branches?.length ? '否则（默认）' : r.option ? '' : '后续幕'}` }))) : frame.options.length ? frame.options.map(o => ({ option: o.id, branch: undefined, label: o.text })) : [{ option: undefined, branch: undefined, label: '后续幕' }]; return <g key={`ports:${node.id}`}>
        <circle role="button" tabIndex={disabled ? -1 : 0} aria-label={`连接到：${frame.text}`} className={`input-port ${wire ? 'ready' : ''}`} cx={node.x} cy={node.y + H / 2} r={7} onClick={e => { e.stopPropagation(); finishWire(frame.ref); }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); finishWire(frame.ref); } }}/>
        {canWire(frame.ref) && ports.map((port, i) => { const start = { x: node.x + W, y: ports.length === 1 ? node.y + H / 2 : node.y + 28 + (i + 1) * (H - 40) / (ports.length + 1) }; return <circle key={`${port.option ?? 'advance'}:${port.branch ?? 'default'}`} role="button" tabIndex={0} aria-label={`从 ${frame.text} 连接：${port.label}`} className="output-port" cx={start.x} cy={start.y} r={7} onPointerDown={e => beginWire(e, frame.ref, port.option, start, port.branch)} onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setWire({ ref: frame.ref, option: port.option, branch: port.branch, start, end: start, moved: false }); } }}/>; })}
      </g>; })}
      {wire && <path className="wire-preview" d={`M ${wire.start.x} ${wire.start.y} L ${wire.end.x} ${wire.end.y}`}/>}
    </svg></div>
  </section>;
}
