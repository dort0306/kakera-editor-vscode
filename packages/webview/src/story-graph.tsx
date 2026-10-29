import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Point } from '../../source/src/workbench';
import type { Route, Story } from '../../domain/src/index';
import { routeDestinations, describeExpression, storyEntries } from '../../domain/src/index';
import { buildStoryGraph, graphEdgeGeometry, GRAPH_NODE_HEIGHT as H, GRAPH_NODE_WIDTH as W } from '../../domain/src/graph';
import { Icon } from './icons';
const EMPTY_LAYOUT: Record<string, Point> = {};
export function StoryGraphView({ story, routes, selected, selection, query, select, selectMany, layout = EMPTY_LAYOUT, disabled = false, editable, onLayout, onLayoutMany, onReconnect, onExport }: { story: Story; routes?: Route[]; selected?: string; selection?: string[]; query: string; select?: (ref: string) => void; selectMany?: (refs: string[], primary?: string) => void; layout?: Record<string, Point>; disabled?: boolean; editable?: (ref: string) => boolean; onLayout?: (ref?: string, point?: Point) => void; onLayoutMany?: (moves: { ref: string; point: Point }[]) => void; onReconnect?: (ref: string, target: string, option?: string, branch?: number) => void; onExport?: () => void }) {
  const [positions, setPositions] = useState(layout);
  const entryRefs = useMemo(() => new Set(storyEntries(story)), [story]);
  const graph = useMemo(() => buildStoryGraph(story, routes, positions), [story, routes, positions]);
  const authors = useMemo(() => story.frames.filter(frame => !frame.pending), [story]);
  const chosen = useMemo(() => new Set((selection !== undefined ? selection : selected ? [selected] : []).filter(ref => authors.some(frame => frame.ref === ref))), [selection, selected, authors]);
  const active = selected && authors.some(frame => frame.ref === selected) ? selected : [...chosen][0];
  const [zoom, setZoom] = useState(1);
  const svg = useRef<SVGSVGElement>(null), scroll = useRef<HTMLDivElement>(null), panSurface = useRef<SVGRectElement>(null), section = useRef<HTMLElement>(null), moved = useRef(false);
  const gesture = useRef<{ primary: string; anchor: Point; origins: Record<string, Point>; last: Record<string, Point> } | undefined>(undefined);
  const pan = useRef<{ x: number; y: number; left: number; top: number } | undefined>(undefined);
  const [panning, setPanning] = useState(false);
  const [wire, setWire] = useState<{ ref: string; option?: string; branch?: number; start: Point; end: Point; moved: boolean }>();
  const wireRef = useRef(wire); wireRef.current = wire;
  const [edgeSelection, setEdgeSelection] = useState<{ ref: string; option?: string; branch?: number }>();
  useEffect(() => { if (!gesture.current) setPositions(layout); }, [layout]);
  useEffect(() => { const failed = (e: MessageEvent) => { if (e.data.type === 'error') { gesture.current = undefined; setWire(undefined); setPositions(layout); } }; window.addEventListener('message', failed); return () => window.removeEventListener('message', failed); }, [layout]);
  const choose = (refs: string[], primary?: string) => {
    const unique = [...new Set(refs)].filter(ref => authors.some(frame => frame.ref === ref));
    if (selectMany) selectMany(unique, primary && unique.includes(primary) ? primary : unique[0]);
    else if (primary ?? unique[0]) select?.(primary ?? unique[0]);
  };
  const toggle = (ref: string) => { const next = new Set(chosen); if (next.has(ref)) next.delete(ref); else next.add(ref); if (!next.size && selected) next.add(selected); choose([...next], next.has(ref) ? ref : active); };
  const extend = (ref: string) => {
    const from = authors.findIndex(frame => frame.ref === (active ?? ref)), to = authors.findIndex(frame => frame.ref === ref);
    if (from < 0 || to < 0) { choose([ref], ref); return; }
    choose(authors.slice(Math.min(from, to), Math.max(from, to) + 1).map(frame => frame.ref), ref);
  };
  const commitLayout = (points: Record<string, Point>) => {
    const moves = Object.entries(points).map(([ref, point]) => ({ ref, point }));
    if (!moves.length) return;
    if (onLayoutMany) onLayoutMany(moves); else for (const move of moves) onLayout?.(move.ref, move.point);
  };
  const nudge = (dx: number, dy: number, refs?: string[]) => {
    if (!onLayout && !onLayoutMany) return;
    const listed = refs?.length ? refs : chosen.size ? [...chosen] : active ? [active] : [];
    const moves: Record<string, Point> = {};
    for (const ref of listed) {
      const node = graph.nodes.find(candidate => candidate.frameRef === ref);
      if (node) moves[ref] = { x: Math.max(20, Math.min(100000, node.x + dx)), y: Math.max(40, Math.min(100000, node.y + dy)) };
    }
    if (!Object.keys(moves).length) return;
    setPositions(old => ({ ...old, ...moves })); commitLayout(moves);
  };
  const focusFrame = (ref: string) => { const later = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0); later(() => { const target = [...(section.current?.querySelectorAll<HTMLElement>('[data-frame-ref]') ?? [])].find(element => element.getAttribute('data-frame-ref') === ref); target?.focus(); }); };
  useEffect(() => { const escape = (e: KeyboardEvent) => { if (e.key !== 'Escape') return; const activeGesture = !!pan.current || !!gesture.current || !!wireRef.current; pan.current = undefined; setPanning(false); gesture.current = undefined; moved.current = false; setWire(undefined); if (activeGesture) setPositions(layout); else if (chosen.size > 1 && section.current?.contains(document.activeElement)) choose(active ? [active] : [], active); }; window.addEventListener('keydown', escape); return () => window.removeEventListener('keydown', escape); }, [layout, chosen, active, authors]);
  // Pointer capture can be dropped by the host when the SVG subtree is updated.
  // Keep the gesture alive and still commit when the release happens outside the canvas.
  useEffect(() => {
    const moveOutside = (e: PointerEvent) => { const current = pan.current, area = scroll.current; if (!current || !area) return; area.scrollLeft = current.left - (e.clientX - current.x); area.scrollTop = current.top - (e.clientY - current.y); };
    const finishOutside = () => { if (pan.current) { pan.current = undefined; setPanning(false); } const drag = gesture.current; if (!drag) return; const wasMoved = moved.current; gesture.current = undefined; moved.current = false; if (wasMoved) commitLayout(drag.last); };
    const cancelOutside = () => { pan.current = undefined; setPanning(false); if (!gesture.current) return; gesture.current = undefined; moved.current = false; setPositions(layout); };
    window.addEventListener('pointermove', moveOutside);
    window.addEventListener('pointerup', finishOutside);
    window.addEventListener('pointercancel', cancelOutside);
    return () => { window.removeEventListener('pointermove', moveOutside); window.removeEventListener('pointerup', finishOutside); window.removeEventListener('pointercancel', cancelOutside); };
  }, [layout, onLayout, onLayoutMany]);
  const point = (e: { clientX: number; clientY: number }): Point => { const rect = svg.current!.getBoundingClientRect(); return { x: (e.clientX - rect.left) / zoom, y: (e.clientY - rect.top) / zoom }; };
  const canWire = (ref: string) => !disabled && !!onReconnect && (editable?.(ref) ?? true);
  const beginWire = (e: React.PointerEvent, ref: string, option: string | undefined, start: Point, branch?: number) => { if (!canWire(ref) || e.button > 0) return; e.stopPropagation(); e.preventDefault(); moved.current = false; setWire({ ref, option, branch, start, end: point(e), moved: false }); svg.current?.setPointerCapture?.(e.pointerId); };
  const finishWire = (ref: string) => { const active = wireRef.current; if (!active || !canWire(active.ref)) return; onReconnect?.(active.ref, ref, active.option, active.branch); setWire(undefined); };
  const markerPrefix = useId().replaceAll(':', '');
  const colors = [...new Set(graph.edges.map(e => e.color))];
  const disconnectedY = Math.min(...graph.nodes.filter(n => n.disconnected).map(n => n.y));
  const keyboard = (event: React.KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
    const key = event.key, mod = event.ctrlKey || event.metaKey;
    if (mod && !event.altKey && !event.shiftKey && key.toLowerCase() === 'a') {
      event.preventDefault(); event.stopPropagation();
      const refs = authors.map(frame => frame.ref);
      if (refs.length) choose(refs, active && refs.includes(active) ? active : refs[0]);
      return;
    }
    if (event.altKey && !mod && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) {
      event.preventDefault(); event.stopPropagation();
      const focused = (target?.closest('[data-frame-ref]') as HTMLElement | null)?.getAttribute('data-frame-ref');
      nudge(key === 'ArrowLeft' ? -20 : key === 'ArrowRight' ? 20 : 0, key === 'ArrowUp' ? -20 : key === 'ArrowDown' ? 20 : 0, focused && authors.some(frame => frame.ref === focused) ? [focused] : undefined);
      return;
    }
    if (mod || event.altKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(key)) return;
    event.preventDefault(); event.stopPropagation();
    const index = Math.max(0, authors.findIndex(frame => frame.ref === active));
    const at = key === 'Home' ? 0 : key === 'End' ? authors.length - 1 : key === 'ArrowLeft' || key === 'ArrowUp' ? Math.max(0, index - 1) : Math.min(authors.length - 1, index + 1);
    const frame = authors[at];
    if (!frame) return;
    if (event.shiftKey) extend(frame.ref); else choose([frame.ref], frame.ref);
    focusFrame(frame.ref);
  };
  return <section ref={section} className="branch-view" aria-label="剧情分支图">
    <div className="graph-toolbar"><span className="muted">Ctrl+A 全选 · Ctrl/Shift 单击多选 · 方向键切换 · Alt+方向键微调 · 拖动空白处平移 · 拖出连接点重新连线</span><div>{chosen.size > 1 && <span className="graph-selection" role="status">已选 {chosen.size} 幕</span>}{onExport && <button disabled={disabled || !!wire || !!gesture.current} onClick={onExport}><Icon name="package" size={13} />导出流程图</button>}{onLayout && <button disabled={disabled} onClick={() => { setPositions({}); onLayout(); }}><Icon name="grid" size={13} />自动排列</button>}{onReconnect && <button disabled={!edgeSelection || !canWire(edgeSelection.ref)} onClick={() => { if (edgeSelection) onReconnect(edgeSelection.ref, '', edgeSelection.option, edgeSelection.branch); setEdgeSelection(undefined); }}><Icon name="trash" size={13} />断开所选连线</button>}<button aria-label="缩小分支图" title="缩小" onClick={() => setZoom(Math.max(.35, zoom - .15))}><Icon name="zoom-out" size={13} /></button><span className="zoom-value">{Math.round(zoom * 100)}%</span><button aria-label="放大分支图" title="放大" onClick={() => setZoom(Math.min(1.8, zoom + .15))}><Icon name="zoom-in" size={13} /></button><button onClick={() => setZoom(1)}><Icon name="fit" size={13} />重置缩放</button></div></div>
    {wire && <p className="connection-hint" role="status"><Icon name="alert" size={13} />选择后续幕的左侧连接点；Escape 取消</p>}
    <div ref={scroll} className={`graph-scroll ${panning ? 'panning' : ''}`} tabIndex={0} onKeyDown={keyboard}><svg ref={svg} width={graph.width * zoom} height={graph.height * zoom} viewBox={`0 0 ${graph.width} ${graph.height}`} role="group" aria-label="幕与选项连接"
      onPointerDown={e => {
        if (e.button !== 0 || e.target !== panSurface.current || wireRef.current || gesture.current) return;
        const area = scroll.current; if (!area) return;
        e.preventDefault(); area.focus();
        pan.current = { x: e.clientX, y: e.clientY, left: area.scrollLeft, top: area.scrollTop };
        setPanning(true); svg.current?.setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={e => { if (pan.current) { const area = scroll.current; if (area) { area.scrollLeft = pan.current.left - (e.clientX - pan.current.x); area.scrollTop = pan.current.top - (e.clientY - pan.current.y); } return; } const p = point(e), drag = gesture.current; if (drag) {
        // Capturing on pointerdown retargets even a plain click to the SVG.
        // Wait for a real drag, measured in screen pixels at every zoom level.
        if (Math.hypot(p.x - drag.anchor.x, p.y - drag.anchor.y) * zoom < 4 && !moved.current) return;
        if (!moved.current) svg.current?.setPointerCapture?.(e.pointerId);
        moved.current = true;
        const points = Object.values(drag.origins), rawX = p.x - drag.anchor.x, rawY = p.y - drag.anchor.y;
        const minX = Math.min(...points.map(value => value.x)), maxX = Math.max(...points.map(value => value.x));
        const minY = Math.min(...points.map(value => value.y)), maxY = Math.max(...points.map(value => value.y));
        const dx = Math.max(20 - minX, Math.min(100000 - maxX, rawX)), dy = Math.max(40 - minY, Math.min(100000 - maxY, rawY));
        drag.last = Object.fromEntries(Object.entries(drag.origins).map(([ref, origin]) => [ref, { x: origin.x + dx, y: origin.y + dy }]));
        setPositions(old => ({ ...old, ...drag.last }));
      } else if (wireRef.current) { const active = wireRef.current; setWire({ ...active, end: p, moved: active.moved || Math.hypot(p.x - active.start.x, p.y - active.start.y) > 8 }); } }}
      onPointerUp={e => { if (pan.current) { pan.current = undefined; setPanning(false); if (svg.current?.hasPointerCapture?.(e.pointerId)) svg.current.releasePointerCapture(e.pointerId); return; } const drag = gesture.current; gesture.current = undefined; if (drag && moved.current) commitLayout(drag.last); else if (wireRef.current?.moved) { const p = point(e), node = graph.nodes.find(n => n.frameRef && p.x >= n.x - 18 && p.x <= n.x + W && p.y >= n.y && p.y <= n.y + H); if (node?.frameRef) finishWire(node.frameRef); else setWire(undefined); } if (svg.current?.hasPointerCapture?.(e.pointerId)) svg.current.releasePointerCapture(e.pointerId); }}
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
        return <foreignObject x={node.x} y={node.y} width={W} height={H} key={node.id}><button data-frame-ref={node.frameRef} className={`graph-node ${node.unknown ? 'unknown' : ''} ${node.frameRef && chosen.has(node.frameRef) ? 'selected' : ''} ${node.frameRef && entryRefs.has(node.frameRef) ? 'entry' : ''} ${match ? '' : 'dimmed'}`} disabled={!node.frameRef} aria-pressed={!!node.frameRef && chosen.has(node.frameRef)}
          onPointerDown={e => {
            if (e.button === 0) moved.current = false;
            if (disabled || (!onLayout && !onLayoutMany) || !node.frameRef || e.button !== 0 || wireRef.current) return;
            const modifier = e.ctrlKey || e.metaKey || e.shiftKey;
            const pickedRefs = [...chosen].filter(ref => graph.nodes.some(candidate => candidate.frameRef === ref));
            if (selectMany && !modifier && !chosen.has(node.frameRef)) choose([node.frameRef], node.frameRef);
            const group = !modifier && chosen.has(node.frameRef) ? pickedRefs : [node.frameRef];
            const origins: Record<string, Point> = {};
            for (const ref of group) { const candidate = graph.nodes.find(item => item.frameRef === ref); if (candidate) origins[ref] = { x: candidate.x, y: candidate.y }; }
            if (!origins[node.frameRef]) origins[node.frameRef] = { x: node.x, y: node.y };
            gesture.current = { primary: node.frameRef, anchor: point(e), origins, last: { ...origins } };
          }}
          onClick={e => { const dragged = moved.current; moved.current = false; if (dragged && e.detail !== 0) return; if (!node.frameRef) return; if (wireRef.current) finishWire(node.frameRef); else if (e.ctrlKey || e.metaKey) toggle(node.frameRef); else if (e.shiftKey) extend(node.frameRef); else if (select) select(node.frameRef); else choose([node.frameRef], node.frameRef); }}>
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
