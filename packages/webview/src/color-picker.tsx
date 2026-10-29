import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { formatColor, hsvaToRgba, hueAt, huePoint, normalizeColor, parseColor, rgbaToHsva, triangleContains, triangleVertices, triangleWeights, weightsColor, weightsForHsva, type Hsva, type Point, type Rgba } from '../../domain/src/colors';

const DEFAULT_COLOR = '#FF0000FF';
const safeColor = (value?: string): Rgba => { try { return parseColor(value || DEFAULT_COLOR); } catch { return parseColor(DEFAULT_COLOR); } };
const rgbaText = (color: Rgba) => `#${color.r.toString(16).padStart(2, '0')}${color.g.toString(16).padStart(2, '0')}${color.b.toString(16).padStart(2, '0')}`;

/** Ring + fixed-direction SV triangle + optional alpha strip. Purely visual; the
 * matching player draws the real control, this is only the authoring preview. */
export function HsvPickerGraphic({ color, alpha = true, detail = 12, showMarkers = true, hsva: override }: { color: Rgba; alpha?: boolean; detail?: number; showMarkers?: boolean; hsva?: Hsva }) {
  const prefix = useId().replaceAll(':', '');
  const center: Point = { x: 130, y: 106 }, outer = 96, inner = 78, triangleRadius = 69;
  const hsva = override ?? rgbaToHsva(color);
  const rendered = hsvaToRgba(hsva);
  const vertices = triangleVertices(center, triangleRadius);
  const markers = useMemo(() => {
    const weights = weightsForHsva(hsva), point = triangleVertices(center, triangleRadius), [h, w, b] = point;
    const total = weights[0] + weights[1] + weights[2] || 1;
    return {
      ring: huePoint(center, (outer + inner) / 2, hsva.h),
      triangle: { x: (weights[0] * h.x + weights[1] * w.x + weights[2] * b.x) / total, y: (weights[0] * h.y + weights[1] * w.y + weights[2] * b.y) / total },
      alpha: { x: 14 + hsva.a * 232, y: 245 }
    };
  }, [hsva.h, hsva.s, hsva.v, hsva.a]);
  const ring = Array.from({ length: 96 }, (_, index) => {
    const a0 = index / 96 * Math.PI * 2, a1 = (index + 1) / 96 * Math.PI * 2, hue = index / 96 * 360;
    const p = (radius: number, angle: number) => ({ x: center.x + Math.sin(angle) * radius, y: center.y - Math.cos(angle) * radius });
    const o0 = p(outer, a0), o1 = p(outer, a1), i1 = p(inner, a1), i0 = p(inner, a0);
    return <path key={index} d={`M ${o0.x} ${o0.y} A ${outer} ${outer} 0 0 1 ${o1.x} ${o1.y} L ${i1.x} ${i1.y} A ${inner} ${inner} 0 0 0 ${i0.x} ${i0.y} Z`} fill={`hsl(${hue} 100% 50%)`} stroke={`hsl(${hue} 100% 50%)`} strokeWidth=".5" />;
  });
  const triangles: React.ReactNode[] = [];
  const n = Math.max(3, detail), [h, w, b] = vertices;
  const pointAt = (a: number, c: number): Point => { const wa = a / n, wc = c / n, wb = 1 - wa - wc; return { x: wa * h.x + wc * w.x + wb * b.x, y: wa * h.y + wc * w.y + wb * b.y }; };
  for (let i = 0; i < n; i++) for (let j = 0; j < n - i; j++) {
    const p1 = pointAt(i, j), p2 = pointAt(i + 1, j), p3 = pointAt(i, j + 1);
    const weight = (a: number, c: number): [number, number, number] => [a / n, c / n, 1 - (a + c) / n];
    const color1 = weightsColor(hsva.h, weight(i + .33, j + .33)), color2 = weightsColor(hsva.h, weight(i + .67, j + .33)), color3 = weightsColor(hsva.h, weight(i + .33, j + .67));
    triangles.push(<polygon key={`t${i}:${j}`} points={`${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y}`} fill={formatColor(color1)} />);
    if (i + j + 1 < n) {
      const p4 = pointAt(i + 1, j + 1), color4 = weightsColor(hsva.h, weight(i + .67, j + .67));
      triangles.push(<polygon key={`u${i}:${j}`} points={`${p2.x},${p2.y} ${p4.x},${p4.y} ${p3.x},${p3.y}`} fill={formatColor(color4)} />);
    }
  }
  return <g aria-hidden="true">
    <defs>
      <pattern id={`${prefix}-check`} width="10" height="10" patternUnits="userSpaceOnUse"><rect width="10" height="10" fill="#f4f4f4"/><path d="M0 0h5v5H0zM5 5h5v5H5z" fill="#b9c0c8"/></pattern>
      <linearGradient id={`${prefix}-alpha`} x1="0" x2="1"><stop offset="0" stopColor={rgbaText(rendered)} stopOpacity="0"/><stop offset="1" stopColor={rgbaText(rendered)} stopOpacity="1"/></linearGradient>
    </defs>
    <circle cx={center.x} cy={center.y} r={outer + 3} fill="none" stroke="#0a1118" strokeWidth="3"/>
    {ring}
    {triangles}
    <polygon points={vertices.map(point => `${point.x},${point.y}`).join(' ')} fill="none" stroke="#0a1118" strokeWidth="2" strokeLinejoin="round"/>
    {alpha && <>
      <rect x="14" y="237" width="232" height="16" fill={`url(#${prefix}-check)`} rx="3"/>
      <rect x="14" y="237" width="232" height="16" fill={`url(#${prefix}-alpha)`} rx="3" stroke="#0a1118" strokeWidth="1"/>
    </>}
    {showMarkers && <>
      <circle cx={markers.ring.x} cy={markers.ring.y} r="7" fill="none" stroke="#fff" strokeWidth="3"/><circle cx={markers.ring.x} cy={markers.ring.y} r="7" fill="none" stroke="#000" strokeWidth="1"/>
      <circle cx={markers.triangle.x} cy={markers.triangle.y} r="7" fill="none" stroke="#fff" strokeWidth="3"/><circle cx={markers.triangle.x} cy={markers.triangle.y} r="7" fill="none" stroke="#000" strokeWidth="1"/>
      {alpha && <><circle cx={markers.alpha.x} cy={245} r="7" fill="none" stroke="#fff" strokeWidth="3"/><circle cx={markers.alpha.x} cy={245} r="7" fill="none" stroke="#000" strokeWidth="1"/></>}
    </>}
  </g>;
}

/** Interactive authoring picker. Emits canonical #RRGGBBAA on every accepted move. */
export function HsvPicker({ value, onChange, alpha = true, disabled = false }: { value: string; onChange: (value: string) => void; alpha?: boolean; disabled?: boolean }) {
  const color = safeColor(value);
  const parsed = rgbaToHsva(color), lastHue = useRef(parsed.h), lastSaturation = useRef(parsed.s), gesture = useRef<{ area: 'ring' | 'triangle' | 'alpha' } | undefined>(undefined), svg = useRef<SVGSVGElement>(null);
  const [hsva, setHsva] = useState<Hsva>(parsed), [error, setError] = useState('');
  useEffect(() => { const next = rgbaToHsva(safeColor(value), lastHue.current, lastSaturation.current); lastHue.current = next.h; if (next.v > 0) lastSaturation.current = next.s; setHsva(next); }, [value]);
  const point = (event: React.PointerEvent): Point => { const element = svg.current!, rect = element.getBoundingClientRect(), x = (event.clientX - rect.left) / Math.max(1, rect.width) * 260, y = (event.clientY - rect.top) / Math.max(1, rect.height) * 300; return { x, y }; };
  const areaAt = (point: Point): 'ring' | 'triangle' | 'alpha' | undefined => {
    const center = { x: 130, y: 106 }, distance = Math.hypot(point.x - center.x, point.y - center.y);
    if (triangleContains(point, triangleVertices(center, 69))) return 'triangle';
    if (distance >= 78 && distance <= 96) return 'ring';
    if (alpha && point.x >= 14 && point.x <= 246 && point.y >= 237 && point.y <= 253) return 'alpha';
    return undefined;
  };
  const apply = (area: 'ring' | 'triangle' | 'alpha', p: Point) => {
    let next = { ...hsva };
    if (area === 'ring') { next.h = hueAt({ x: 130, y: 106 }, p); lastHue.current = next.h; }
    else if (area === 'triangle') { const weights = triangleWeights(p, triangleVertices({ x: 130, y: 106 }, 69)), value = Math.max(0, Math.min(1, weights[0] + weights[1])), saturation = value > 1e-6 ? weights[0] / value : next.s; next = { ...next, h: lastHue.current, s: Math.max(0, Math.min(1, saturation)), v: value }; if (value > 0) lastSaturation.current = next.s; }
    else next.a = Math.max(0, Math.min(1, (p.x - 14) / 232));
    setHsva(next); setError('');
    onChange(formatColor(hsvaToRgba(next)));
  };
  // Keep the exact alpha when alpha editing is hidden; ring/triangle updates preserve it.
  const begin = (event: React.PointerEvent) => { if (disabled || event.button !== 0) return; const p = point(event), area = areaAt(p); if (!area) return; event.preventDefault(); event.stopPropagation(); gesture.current = { area }; svg.current?.setPointerCapture?.(event.pointerId); apply(area, p); };
  const move = (event: React.PointerEvent) => { if (!gesture.current || disabled) return; event.preventDefault(); apply(gesture.current.area, point(event)); };
  const finish = (event: React.PointerEvent) => { gesture.current = undefined; if (svg.current?.hasPointerCapture?.(event.pointerId)) svg.current.releasePointerCapture(event.pointerId); };
  return <div className="hsv-picker">
    <svg ref={svg} viewBox="0 0 260 300" className={disabled ? 'disabled' : ''} role="img" aria-label="HSV 三角选色器" onPointerDown={begin} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish}>
      <HsvPickerGraphic color={color} alpha={alpha} detail={12} hsva={hsva}/>
    </svg>
    <div className="hsv-picker-meta"><span className="hsv-swatch" style={{ background: value }} /><code>{value}</code><span className="muted">H {Math.round(hsva.h)}° · S {Math.round(hsva.s * 100)}% · V {Math.round(hsva.v * 100)}%{alpha ? ` · A ${Math.round(hsva.a * 100)}%` : ''}</span></div>
    {error && <p className="error">{error}</p>}
  </div>;
}

/** Text + real HSV surface used by the inspector and palette/shortcut forms. */
export function ColorField({ label, value, onChange, alpha = true, disabled = false, hint }: { label: string; value: string; onChange: (value: string) => void; alpha?: boolean; disabled?: boolean; hint?: string }) {
  const [text, setText] = useState(value), [open, setOpen] = useState(false), [problem, setProblem] = useState('');
  useEffect(() => setText(value), [value]);
  const commit = (raw: string) => { try { const next = normalizeColor(raw); setText(next); setProblem(''); if (next !== value) onChange(next); } catch (e) { setProblem(e instanceof Error ? e.message : '颜色格式错误'); } };
  return <div className="color-field">
    <div className="color-field-row"><input aria-label={label} value={text} disabled={disabled} spellCheck={false} placeholder="#RRGGBB / #RRGGBBAA" onChange={e => { setText(e.target.value); setProblem(''); }} onBlur={() => commit(text)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(text); } }}/><button type="button" className="color-field-swatch" disabled={disabled} aria-label={`${label}：打开 HSV 选色器`} title="打开 HSV 选色器" style={{ background: (() => { try { return normalizeColor(text); } catch { return '#000'; } })() }} onClick={() => setOpen(value => !value)} /></div>
    <div className="color-field-foot"><span className="muted">{hint ?? '严格 #RRGGBB 或 #RRGGBBAA；仅作为 UI/配色声明，不会直接修改剧情。'}</span><button type="button" className="ghost compact" disabled={disabled} onClick={() => setOpen(value => !value)}>{open ? '收起色盘' : 'HSV 色盘'}</button></div>
    {problem && <p className="error">{problem}</p>}
    {open && <HsvPicker value={(() => { try { return normalizeColor(text); } catch { return value; } })()} alpha={alpha} disabled={disabled} onChange={next => { setText(next); setProblem(''); onChange(next); }}/>}
  </div>;
}
