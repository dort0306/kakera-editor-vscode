import React, { useEffect, useId, useRef, useState } from 'react';
import type { Story } from '../../domain/src/index';
import { previewUi, type UiPreviewNode } from '../../domain/src/ui-preview';
import type { UiDesign, UiScreen, UiTextures } from '../../domain/src/ui';
import { patchAxis } from '../../domain/src/textures';
import { normalizeColor, parseColor } from '../../domain/src/colors';
import { HslPickerGraphic, pickerGeometry } from './color-picker';
const color = (s: string | undefined, fallback: string) => { try { return normalizeColor(s ?? ''); } catch { return fallback; } };
const pickerColor = (s: string | undefined) => { try { return parseColor(s ?? '#FF0000FF'); } catch { return parseColor('#FF0000FF'); } };
export function UiCanvas({ design, screen, story, frame, textures, selected, select, disabled, commit }: { design: UiDesign; screen: UiScreen; story?: Story; frame?: string; textures: UiTextures; selected: string; select: (id: string) => void; disabled: boolean; commit: (id: string, patch: Record<string, string>) => void }) {
  const [zoom, setZoom] = useState(.65), [snap, setSnap] = useState(true), [showHidden, setShowHidden] = useState(true), [local, setLocal] = useState<Record<string, string>>();
  const svg = useRef<SVGSVGElement>(null), gesture = useRef<{ id: string; x: number; y: number; original: [number, number, number, number]; resize: boolean; moved: boolean; pointer: number } | undefined>(undefined);
  const prefix = useId().replaceAll(':', '');
  const patched = local && gesture.current ? { ...screen, children: (() => { const patch = (nodes: typeof screen.children): typeof nodes => nodes.map(n => ({ ...n, attrs: n.id === gesture.current!.id ? { ...n.attrs, ...local } : n.attrs, children: patch(n.children) })); return patch(screen.children); })() } : screen;
  const items = previewUi(design, patched, story, frame, textures, showHidden), active = items.find(n => n.node.id === selected && !n.template);
  const cancel = () => { gesture.current = undefined; setLocal(undefined); };
  useEffect(() => { cancel(); }, [screen, disabled]);
  // A host repaint can drop pointer capture mid-drag; keep the gesture and
  // commit from the window when the release happens outside the SVG.
  useEffect(() => {
    const finishOutside = () => { const drag = gesture.current; if (!drag) return; const wasMoved = drag.moved; gesture.current = undefined; if (wasMoved && local && !disabled) commit(drag.id, local); setLocal(undefined); };
    const cancelOutside = () => { if (!gesture.current) return; cancel(); };
    window.addEventListener('pointerup', finishOutside);
    window.addEventListener('pointercancel', cancelOutside);
    return () => { window.removeEventListener('pointerup', finishOutside); window.removeEventListener('pointercancel', cancelOutside); };
  }, [local, disabled, commit]);
  const begin = (e: React.PointerEvent, item: UiPreviewNode, resize = false) => {
    if (e.button !== 0) return; e.stopPropagation(); select(item.node.id);
    if (disabled || item.template) return;
    const a = item.node.attrs; gesture.current = { id: item.node.id, x: e.clientX, y: e.clientY, original: [Number(a.x ?? 0), Number(a.y ?? 0), Number(a.width), Number(a.height)], resize, moved: false, pointer: e.pointerId };
  };
  const finish = (e: React.PointerEvent) => {
    const drag = gesture.current;
    if (drag?.moved && local && !disabled) commit(drag.id, local);
    cancel(); if (svg.current?.hasPointerCapture?.(e.pointerId)) svg.current.releasePointerCapture(e.pointerId);
  };
  const skin = (item: UiPreviewNode) => {
    const texture = textures[item.image ?? '']; if (!texture) return null;
    const [x, y, w, h] = item.rect;
    if (item.node.kind === 'nine-patch' && texture.spec) {
      const xs = patchAxis(texture.width, texture.spec.horizontal, w, Number(item.node.attrs.density ?? 1)), ys = patchAxis(texture.height, texture.spec.vertical, h, Number(item.node.attrs.density ?? 1));
      return ys.flatMap((row, r) => xs.map((col, c) => <svg key={`${r}:${c}`} x={x + col.target[0]} y={y + row.target[0]} width={col.target[1] - col.target[0]} height={row.target[1] - row.target[0]} viewBox={`${col.source[0]} ${row.source[0]} ${col.source[1] - col.source[0]} ${row.source[1] - row.source[0]}`} preserveAspectRatio="none"><image href={texture.uri} width={texture.width} height={texture.height}/></svg>));
    }
    const region = item.region?.split(',').map(Number);
    const view = region?.length === 4 && region.every(Number.isFinite) ? region : [0, 0, texture.width, texture.height];
    return <svg x={x} y={y} width={w} height={h} viewBox={view.join(' ')} preserveAspectRatio={item.node.attrs.fit === 'contain' ? 'xMidYMid meet' : item.node.attrs.fit === 'cover' ? 'xMidYMid slice' : 'none'}><image href={texture.uri} width={texture.width} height={texture.height}/></svg>;
  };
  return <section className="ui-canvas-wrap" aria-label="UI 设计画布">
    <div className="ui-canvas-toolbar"><button aria-label="缩小 UI 画布" onClick={() => setZoom(z => Math.max(.2, z - .1))}>−</button><span>{Math.round(zoom * 100)}%</span><button aria-label="放大 UI 画布" onClick={() => setZoom(z => Math.min(2, z + .1))}>＋</button><button onClick={() => setZoom(.65)}>适合常用窗口</button><label><input type="checkbox" checked={snap} onChange={e => setSnap(e.target.checked)}/>8px 吸附</label><label><input type="checkbox" checked={showHidden} onChange={e => setShowHidden(e.target.checked)}/>显示隐藏控件</label></div>
    <p className="muted">静态设计示例 · 拖动或缩放后自动保存 · 列表显示示例数据，精确效果请试玩</p>
    <div className="ui-canvas-scroll"><svg ref={svg} className="ui-canvas" width={design.width * zoom} height={design.height * zoom} viewBox={`0 0 ${design.width} ${design.height}`} tabIndex={0} role="group" aria-label="UI 控件画布" onPointerDown={e => { if (e.target === svg.current) select(''); }}
      onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); cancel(); } else if (!disabled && selected && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) { e.preventDefault(); const item = items.find(n => n.node.id === selected && !n.template); if (item) { const amount = e.shiftKey ? 8 : 1; commit(selected, { x: String(Number(item.node.attrs.x ?? 0) + (e.key === 'ArrowLeft' ? -amount : e.key === 'ArrowRight' ? amount : 0)), y: String(Number(item.node.attrs.y ?? 0) + (e.key === 'ArrowUp' ? -amount : e.key === 'ArrowDown' ? amount : 0)) }); } } }}
      onPointerMove={e => {
        const drag = gesture.current; if (!drag || disabled) return;
        if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 4) return;
        if (!drag.moved) { drag.moved = true; svg.current?.setPointerCapture?.(e.pointerId); }
        const dx = (e.clientX - drag.x) / zoom, dy = (e.clientY - drag.y) / zoom, unit = snap ? 8 : 1, round = (n: number) => Math.round(n / unit) * unit;
        const [x, y, w, h] = drag.original;
        setLocal(drag.resize ? { width: String(Math.max(1, round(w + dx))), height: String(Math.max(1, round(h + dy))) } : { x: String(Math.max(-100000, Math.min(100000, round(x + dx)))), y: String(Math.max(-100000, Math.min(100000, round(y + dy)))) });
      }} onPointerUp={finish} onPointerCancel={cancel} onPointerLeave={() => { if (gesture.current && !gesture.current.moved) cancel(); }} onLostPointerCapture={() => { if (gesture.current && !gesture.current.moved) cancel(); }}>
      <defs><pattern id={`${prefix}-grid`} width="32" height="32" patternUnits="userSpaceOnUse"><path d="M 32 0 L 0 0 0 32" fill="none" stroke="#22374b" strokeWidth="1"/></pattern></defs>
      <rect width={design.width} height={design.height} fill="#0e1a26" pointerEvents="none"/>
      <rect width={design.width} height={design.height} fill={`url(#${prefix}-grid)`} pointerEvents="none" opacity=".55"/>
      {items.map((item, i) => {
        const a = item.node.attrs, [x, y, w, h] = item.rect, clip = `${prefix}-clip-${i}`, font = Number(a['font-size'] ?? 20);
        const pickerAlpha = a.alpha !== 'false', pickerLayout = item.node.kind === 'color-picker' ? pickerGeometry(w, h, pickerAlpha) : undefined;
        return <g key={item.instance} data-ui-node={item.node.id} data-ui-instance={item.instance} role="button" tabIndex={0} aria-label={`${item.node.kind}：${item.node.id}`} aria-pressed={selected === item.node.id} onPointerDown={e => begin(e, item)} onClick={e => { e.stopPropagation(); select(item.node.id); }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(item.node.id); } }} opacity={!item.visible ? .35 : !item.enabled ? .6 : 1}>
          <title>{item.node.kind} · {item.node.id} · {item.node.file}:{item.node.line}{item.template ? ' · 模板实例' : ''}{a.effect ? ' · 效果请试玩确认' : ''}</title>
          <defs><clipPath id={clip}><rect x={item.clip[0]} y={item.clip[1]} width={item.clip[2]} height={item.clip[3]}/></clipPath></defs>
          <g clipPath={`url(#${clip})`}>
            <rect x={x} y={y} width={w} height={h} rx={Number(a.radius ?? 0)} fill={item.node.kind === 'label' || item.node.kind === 'image' || item.node.kind === 'repeat' || item.node.kind === 'color-picker' || item.node.kind === 'component' ? 'transparent' : color(item.colorValue ?? a.color, item.node.kind === 'button' ? '#29455f' : item.node.kind === 'panel' ? '#1b2c3e' : '#1a3044')} stroke={item.node.kind === 'repeat' || item.node.kind === 'scene' ? '#476983' : item.node.kind === 'component' ? '#8a7bd8' : 'none'} strokeDasharray={item.node.kind === 'repeat' || item.node.kind === 'component' ? '6 4' : undefined}/>
            {item.node.kind === 'component' && <text x={x + 8} y={y + 16} fontSize="14" fill="#b9a9f2">{item.node.component ?? 'x-component'} · 组合标签（展开效果请试玩）</text>}
            {pickerLayout ? <svg x={x} y={y} width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="ui-color-picker-preview" aria-label="color-picker 静态预览">
              <HslPickerGraphic color={pickerColor(item.colorValue)} alpha={pickerAlpha} geometry={pickerLayout}/>
            </svg> : null}
            {skin(item)}
            {item.colorValue && !['label', 'button', 'toggle', 'color-picker'].includes(item.node.kind) && <rect x={x} y={y} width={w} height={h} rx={Number(a.radius ?? 0)} fill={color(item.colorValue, '#00000000')} opacity=".45" pointerEvents="none"/>}
            {item.node.kind === 'scene' && <text x={x + 16} y={y + 30} fontSize="20" fill="#9cb2c8">剧情画面占位 · 实际舞台请用播放器查看</text>}
            {item.node.kind === 'repeat' && !item.node.children.length && <text x={x + 8} y={y + 24} fontSize="16" fill="#b1c8df">repeat：{a.source}（添加子控件设计模板）</text>}
            {item.node.kind === 'slider' && <><rect x={x + 8} y={y + h / 2 - 3} width={Math.max(1, w - 16)} height="6" rx="3" fill="#3a536b"/><rect x={x + 8} y={y + h / 2 - 3} width={Math.max(1, (w - 16) * .6)} height="6" rx="3" fill="#5fd8c4"/><circle cx={x + 8 + (w - 16) * .6} cy={y + h / 2} r={Math.min(10, h / 3)} fill="#dffaf4" stroke="#2a9e92" strokeWidth="2"/></>}
            {['label', 'button', 'toggle'].includes(item.node.kind) && <foreignObject x={x + (item.node.kind === 'toggle' ? 32 : 0)} y={y} width={Math.max(1, w - (item.node.kind === 'toggle' ? 32 : 0))} height={h} pointerEvents="none"><div className={`ui-preview-text ${item.node.kind === 'button' ? 'center' : ''}`} style={{ fontSize: font, color: item.node.kind === 'button' ? '#e8f2fa' : color(item.colorValue ?? a.color, '#dbe7f3') }}>{item.text}</div></foreignObject>}
            {item.node.kind === 'toggle' && <><rect x={x + 4} y={y + (h - 22) / 2} width="22" height="22" rx="6" fill="#35566e" stroke="#7ea2bb"/><path d={`M ${x + 10} ${y + h / 2} l3 3 l6 -7`} fill="none" stroke="#8fe6d8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></>}
            <rect className="ui-node-hit" x={x} y={y} width={w} height={h} fill="transparent"/>
          </g>
        </g>;
      })}
      {active && <g className="ui-selection"><rect x={active.rect[0]} y={active.rect[1]} width={active.rect[2]} height={active.rect[3]} fill="none" stroke="#5ee1e0" strokeWidth={2 / zoom} pointerEvents="none"/>{!disabled && <rect className="ui-resize-handle" aria-label="调整控件大小" role="button" tabIndex={0} x={active.rect[0] + active.rect[2] - 6 / zoom} y={active.rect[1] + active.rect[3] - 6 / zoom} width={12 / zoom} height={12 / zoom} fill="#5ee1e0" onPointerDown={e => begin(e, active, true)}/>}</g>}
    </svg></div>
  </section>;
}
