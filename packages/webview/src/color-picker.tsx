import React, { useEffect, useId, useRef, useState } from 'react';
import { formatColor, hslaToRgba, hueAt, huePoint, normalizeColor, parseColor, rgbaToHsla, clampUnit, normalizeHue, type Hsla, type Point, type Rgba } from '../../domain/src/colors';

const safeColor = (value?: string): Rgba => { try { return parseColor(value || '#FF0000FF'); } catch { return parseColor('#FF0000FF'); } };
const authoringCenter = { x: 130, y: 106 }, authoringOuter = 96, authoringInner = 78;
const authoringSide = authoringOuter * .78 * Math.SQRT2, authoringLeft = authoringCenter.x - authoringSide / 2, authoringTop = authoringCenter.y - authoringSide / 2;
type Area = 'ring' | 'square' | 'alpha';
export interface PickerGraphicGeometry {
  width: number; height: number; alpha: boolean;
  center: Point; outer: number; inner: number;
  square: { left: number; top: number; side: number };
  alphaBar?: { x: number; y: number; width: number; height: number };
}
/** Editor color field keeps its compact fixed layout. */
const authoringGeometry: PickerGraphicGeometry = {
  width: 260, height: 300, alpha: true, center: authoringCenter, outer: authoringOuter, inner: authoringInner,
  square: { left: authoringLeft, top: authoringTop, side: authoringSide },
  alphaBar: { x: 14, y: 237, width: 232, height: 16 }
};
/** Match the matching player's current `PickerGeometry`: D=min(W,H−R), R=alpha?26:0.
 * The ring/square/optional alpha group is centred; there is no built-in preview or HEX row. */
export function pickerGeometry(width: number, height: number, alpha: boolean): PickerGraphicGeometry | undefined {
  const reserved = alpha ? 26 : 0, diameter = Math.min(width, height - reserved);
  if (!Number.isFinite(diameter) || diameter < 128) return undefined;
  const top = height / 2 - (diameter + reserved) / 2, center = { x: width / 2, y: top + diameter / 2 };
  const outer = diameter / 2 - 6, inner = outer * .82, side = outer * .78 * Math.SQRT2;
  return {
    width, height, alpha, center, outer, inner,
    square: { left: center.x - side / 2, top: center.y - side / 2, side },
    ...(alpha ? { alphaBar: { x: 8, y: top + diameter + 8, width: width - 16, height: 18 } } : {})
  };
}

/** Encoded-sRGB HSL: interpolate gray to hue at L=.5, then to white/black on
 * either half of the L axis. Exact SVG gradients replace the player's mesh. */
export function HslPickerGraphic({ color, alpha = true, showMarkers = true, hsla: override, geometry }: { color: Rgba; alpha?: boolean; showMarkers?: boolean; hsla?: Hsla; geometry?: PickerGraphicGeometry }) {
  const prefix = useId().replaceAll(':', ''), hsla = override ?? rgbaToHsla(color);
  const layout = geometry ?? authoringGeometry, showAlpha = geometry ? geometry.alpha : alpha;
  const { center, outer, inner } = layout, { left, top, side } = layout.square;
  const rendered = hslaToRgba(hsla), ringMarker = huePoint(center, (outer + inner) / 2, hsla.h);
  const squareMarker = { x: left + side * hsla.s, y: top + side * (1 - hsla.l) };
  const ring = Array.from({ length: 96 }, (_, index) => {
    const a0 = index / 96 * Math.PI * 2, a1 = (index + 1) / 96 * Math.PI * 2, hue = index / 96 * 360;
    const p = (radius: number, angle: number) => ({ x: center.x + Math.sin(angle) * radius, y: center.y - Math.cos(angle) * radius });
    const o0 = p(outer, a0), o1 = p(outer, a1), i1 = p(inner, a1), i0 = p(inner, a0);
    return <path key={index} d={`M ${o0.x} ${o0.y} A ${outer} ${outer} 0 0 1 ${o1.x} ${o1.y} L ${i1.x} ${i1.y} A ${inner} ${inner} 0 0 0 ${i0.x} ${i0.y} Z`} fill={`hsl(${hue} 100% 50%)`} stroke={`hsl(${hue} 100% 50%)`} strokeWidth=".5" />;
  });
  const marker = (p: Point, area: Area) => <g data-color-marker={area}><circle cx={p.x} cy={p.y} r="7" fill="none" stroke="#fff" strokeWidth="3"/><circle cx={p.x} cy={p.y} r="7" fill="none" stroke="#000" strokeWidth="1"/></g>;
  const bar = showAlpha ? layout.alphaBar : undefined;
  return <g aria-hidden="true" pointerEvents="none" colorInterpolation="sRGB">
    <defs>
      <pattern id={`${prefix}-check`} width="10" height="10" patternUnits="userSpaceOnUse"><rect width="10" height="10" fill="#f4f4f4"/><path d="M0 0h5v5H0zM5 5h5v5H5z" fill="#b9c0c8"/></pattern>
      <linearGradient id={`${prefix}-saturation`}><stop offset="0" stopColor="rgb(50% 50% 50%)"/><stop offset="1" stopColor={`hsl(${hsla.h} 100% 50%)`}/></linearGradient>
      <linearGradient id={`${prefix}-lightness`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff"/><stop offset=".5" stopColor="#fff" stopOpacity="0"/><stop offset=".5" stopColor="#000" stopOpacity="0"/><stop offset="1" stopColor="#000"/></linearGradient>
      <linearGradient id={`${prefix}-alpha`}><stop offset="0" stopColor={formatColor({ ...rendered, a: 255 })} stopOpacity="0"/><stop offset="1" stopColor={formatColor({ ...rendered, a: 255 })}/></linearGradient>
    </defs>
    <circle cx={center.x} cy={center.y} r={outer + 3} fill="none" stroke="#0a1118" strokeWidth="3"/>{ring}
    <rect x={left} y={top} width={side} height={side} fill={`url(#${prefix}-saturation)`}/>
    <rect data-hsl-square="true" x={left} y={top} width={side} height={side} fill={`url(#${prefix}-lightness)`} stroke="#0a1118" strokeWidth="2"/>
    {bar && <><rect x={bar.x} y={bar.y} width={bar.width} height={bar.height} fill={`url(#${prefix}-check)`} rx="3"/><rect x={bar.x} y={bar.y} width={bar.width} height={bar.height} fill={`url(#${prefix}-alpha)`} rx="3" stroke="#0a1118"/></>}
    {showMarkers && <>{marker(ringMarker, 'ring')}{marker(squareMarker, 'square')}{bar && marker({ x: bar.x + hsla.a * bar.width, y: bar.y + bar.height / 2 }, 'alpha')}</>}
  </g>;
}

/** Authoring-only input; game execution and preferences remain with the player. */
export function HslPicker({ value, onChange, alpha = true, disabled = false }: { value: string; onChange: (value: string) => void; alpha?: boolean; disabled?: boolean }) {
  const color = safeColor(value), svg = useRef<SVGSVGElement>(null);
  const layout = authoringGeometry, { center, outer, inner } = layout, { left, top, side } = layout.square, bar = layout.alphaBar!;
  const current = useRef(rgbaToHsla(color)), [hsla, setHsla] = useState(current.current);
  const gesture = useRef<{ area: Area; pointerId: number } | undefined>(undefined);
  const emit = (next: Hsla) => { current.current = next; setHsla(next); onChange(formatColor(hslaToRgba(next))); };
  useEffect(() => {
    const committed = safeColor(value);
    // RGBA echoes must not discard float positions at white/black/quantized colors.
    if (formatColor(hslaToRgba(current.current)) === formatColor(committed)) return;
    const next = rgbaToHsla(committed, current.current.h, current.current.s);
    current.current = next; setHsla(next);
  }, [value]);
  const point = (event: { clientX: number; clientY: number }): Point => {
    const matrix = svg.current!.getScreenCTM?.();
    if (matrix) return new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    const r = svg.current!.getBoundingClientRect();
    return { x: (event.clientX - r.left) / Math.max(1, r.width) * 260, y: (event.clientY - r.top) / Math.max(1, r.height) * 300 };
  };
  const areaAt = (p: Point): Area | undefined => {
    // Pointer coordinates cross a browser float32 boundary; include exact edges
    // despite sub-pixel conversion error (well below one screen pixel).
    const epsilon = 1e-4;
    if (p.x >= left - epsilon && p.x <= left + side + epsilon && p.y >= top - epsilon && p.y <= top + side + epsilon) return 'square';
    const distance = Math.hypot(p.x - center.x, p.y - center.y);
    if (distance >= inner && distance <= outer) return 'ring';
    if (alpha && p.x >= bar.x && p.x <= bar.x + bar.width && p.y >= bar.y && p.y <= bar.y + bar.height) return 'alpha';
  };
  const apply = (area: Area, p: Point) => {
    const next = { ...current.current };
    if (area === 'ring') next.h = hueAt(center, p);
    else if (area === 'square') { next.s = clampUnit((p.x - left) / side); next.l = 1 - clampUnit((p.y - top) / side); }
    else next.a = clampUnit((p.x - bar.x) / bar.width);
    emit(next);
  };
  const cancel = () => {
    const active = gesture.current; gesture.current = undefined;
    if (active && svg.current?.hasPointerCapture?.(active.pointerId)) svg.current.releasePointerCapture(active.pointerId);
  };
  const handlers = useRef({ move: (_: PointerEvent) => {}, finish: (_: PointerEvent) => {}, cancel });
  handlers.current = {
    move: e => { if (!disabled && gesture.current?.pointerId === e.pointerId) { e.preventDefault(); apply(gesture.current.area, point(e)); } },
    finish: e => { if (gesture.current?.pointerId !== e.pointerId) return; if (!disabled && e.type === 'pointerup') apply(gesture.current.area, point(e)); cancel(); }, cancel
  };
  useEffect(() => {
    const move = (e: PointerEvent) => handlers.current.move(e), finish = (e: PointerEvent) => handlers.current.finish(e);
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') handlers.current.cancel(); }, blur = () => handlers.current.cancel();
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish); window.addEventListener('pointercancel', finish); window.addEventListener('keydown', escape); window.addEventListener('blur', blur);
    return () => { handlers.current.cancel(); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', finish); window.removeEventListener('keydown', escape); window.removeEventListener('blur', blur); };
  }, []);
  useEffect(() => { if (disabled || (!alpha && gesture.current?.area === 'alpha')) cancel(); }, [disabled, alpha]);
  const begin = (e: React.PointerEvent) => {
    if (disabled || e.button !== 0) return;
    const p = point(e), area = areaAt(p); if (!area) return;
    e.preventDefault(); e.stopPropagation(); gesture.current = { area, pointerId: e.pointerId };
    try { svg.current?.setPointerCapture?.(e.pointerId); } catch { /* Window handlers retain the gesture. */ }
    svg.current?.querySelector<SVGElement>(`[data-picker-area="${area}"]`)?.focus({ preventScroll: true }); apply(area, p);
  };
  const keyboard = (e: React.KeyboardEvent) => {
    if (disabled || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    const area = (e.target as Element).getAttribute('data-picker-area') as Area | null; if (!area) return;
    if (area !== 'square' && !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault(); e.stopPropagation();
    const next = { ...current.current }, fine = e.shiftKey ? .1 : .01, direction = e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 1;
    if (area === 'ring') next.h = normalizeHue(next.h + direction * (e.shiftKey ? 10 : 1));
    else if (area === 'alpha') next.a = clampUnit(next.a + direction * fine);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') next.s = clampUnit(next.s + direction * fine);
    else next.l = clampUnit(next.l + direction * fine);
    emit(next);
  };
  return <div className="hsl-picker">
    <svg ref={svg} viewBox="0 0 260 300" className={disabled ? 'disabled' : ''} role="group" aria-label="HSL 正方形选色器" onPointerDown={begin} onKeyDown={keyboard}>
      <HslPickerGraphic color={color} alpha={alpha} hsla={hsla}/>
      <circle data-picker-area="ring" cx={center.x} cy={center.y} r={(outer + inner) / 2} fill="none" stroke="transparent" strokeWidth={outer - inner} tabIndex={disabled ? -1 : 0} role="slider" aria-label="色相 H" aria-valuemin={0} aria-valuemax={360} aria-valuenow={Math.round(hsla.h)}/>
      <rect data-picker-area="square" x={left} y={top} width={side} height={side} fill="transparent" tabIndex={disabled ? -1 : 0} role="group" aria-label="饱和度 S / 亮度 L：方向键调整"/>
      {alpha && <rect data-picker-area="alpha" x={bar.x} y={bar.y} width={bar.width} height={bar.height} fill="transparent" tabIndex={disabled ? -1 : 0} role="slider" aria-label="透明度 A" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(hsla.a * 100)}/>}
    </svg>
    <div className="hsl-picker-meta"><span className="hsl-swatch" style={{ background: value }} /><code>{value}</code><span className="muted">H {Math.round(hsla.h)}° · S {Math.round(hsla.s * 100)}% · L {Math.round(hsla.l * 100)}%{alpha ? ` · A ${Math.round(hsla.a * 100)}%` : ''}</span></div>
  </div>;
}

/** Text + HSL surface used by the inspector and palette forms. */
export function ColorField({ label, value, onChange, alpha = true, disabled = false, hint }: { label: string; value: string; onChange: (value: string) => void; alpha?: boolean; disabled?: boolean; hint?: string }) {
  const [text, setText] = useState(value), [open, setOpen] = useState(false), [problem, setProblem] = useState('');
  useEffect(() => setText(value), [value]);
  const commit = (raw: string) => { try { const next = normalizeColor(raw); setText(next); setProblem(''); if (next !== value) onChange(next); } catch (e) { setProblem(e instanceof Error ? e.message : '颜色格式错误'); } };
  return <div className="color-field">
    <div className="color-field-row"><input aria-label={label} value={text} disabled={disabled} spellCheck={false} placeholder="#RRGGBB / #RRGGBBAA" onChange={e => { setText(e.target.value); setProblem(''); }} onBlur={() => commit(text)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(text); } }}/><button type="button" className="color-field-swatch" disabled={disabled} aria-label={`${label}：打开 HSL 选色器`} title="打开 HSL 选色器" style={{ background: (() => { try { return normalizeColor(text); } catch { return '#000'; } })() }} onClick={() => setOpen(value => !value)} /></div>
    <div className="color-field-foot"><span className="muted">{hint ?? '严格 #RRGGBB 或 #RRGGBBAA；仅作为 UI/配色声明，不会直接修改剧情。'}</span><button type="button" className="ghost compact" disabled={disabled} onClick={() => setOpen(value => !value)}>{open ? '收起色盘' : 'HSL 色盘'}</button></div>
    {problem && <p className="error">{problem}</p>}
    {open && <HslPicker value={(() => { try { return normalizeColor(text); } catch { return value; } })()} alpha={alpha} disabled={disabled} onChange={next => { setText(next); setProblem(''); onChange(next); }}/>}
  </div>;
}
