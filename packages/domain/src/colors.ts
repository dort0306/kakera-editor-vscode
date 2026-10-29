/** Strict sRGB RGBA and HSV helpers shared by UI parsing, preview and the editor picker.
 * The engine stores unpremultiplied #RRGGBBAA; HSV is over encoded sRGB, not linear light. */
export interface Rgba { r: number; g: number; b: number; a: number }
export interface Hsva { h: number; s: number; v: number; a: number }
export interface Point { x: number; y: number }

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export const clampUnit = (value: number) => clamp(Number.isFinite(value) ? value : 0, 0, 1);
export const normalizeHue = (value: number) => { const hue = Number.isFinite(value) ? value % 360 : 0; return hue < 0 ? hue + 360 : hue; };
const quantize = (value: number) => Math.round(clampUnit(value) * 255);

/** Parse the engine's strict author input. Six digits fill alpha=FF. */
export function parseColor(text: string): Rgba {
  if (typeof text !== 'string' || !text) throw new Error('颜色为空，要求 #RRGGBB 或 #RRGGBBAA');
  if (!text.startsWith('#')) throw new Error('颜色必须以 # 开头');
  const hex = text.slice(1);
  if (!/^(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(hex)) throw new Error('颜色必须是 #RRGGBB 或 #RRGGBBAA');
  return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16), a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : 255 };
}
export function formatColor(color: Rgba): string {
  const part = (value: number) => Math.round(clamp(Number.isFinite(value) ? value : 0, 0, 255)).toString(16).padStart(2, '0').toUpperCase();
  return `#${part(color.r)}${part(color.g)}${part(color.b)}${part(color.a)}`;
}
export function normalizeColor(text: string): string { return formatColor(parseColor(text)); }
export function isColorText(text: string | undefined): text is string { if (!text) return false; try { parseColor(text); return true; } catch { return false; } }
export function rgbaToHsva(color: Rgba, lastHue = 0, lastSaturation = 0): Hsva {
  const r = color.r / 255, g = color.g / 255, b = color.b / 255, max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  const v = max, s = max > 0 ? delta / max : 0;
  let h = 0;
  if (delta > 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h *= 60;
  }
  return { h: s === 0 ? normalizeHue(lastHue) : normalizeHue(h), s: v === 0 ? clampUnit(lastSaturation) : s, v, a: color.a / 255 };
}
export function hsvaToRgba(value: Hsva): Rgba {
  const h = normalizeHue(value.h), s = clampUnit(value.s), v = clampUnit(value.v), a = Number.isFinite(value.a) ? clampUnit(value.a) : 1;
  const chroma = v * s, sector = h / 60, second = chroma * (1 - Math.abs((sector % 2) - 1));
  const [r, g, b] = sector < 1 ? [chroma, second, 0] : sector < 2 ? [second, chroma, 0] : sector < 3 ? [0, chroma, second] : sector < 4 ? [0, second, chroma] : sector < 5 ? [second, 0, chroma] : [chroma, 0, second];
  const offset = v - chroma;
  return { r: quantize(r + offset), g: quantize(g + offset), b: quantize(b + offset), a: quantize(a) };
}
export function hueAt(center: Point, point: Point): number { const dx = point.x - center.x, dy = point.y - center.y; if (!dx && !dy) return 0; return normalizeHue(Math.atan2(dx, -dy) * 180 / Math.PI); }
export function huePoint(center: Point, radius: number, hue: number): Point { const angle = normalizeHue(hue) * Math.PI / 180; return { x: center.x + Math.sin(angle) * radius, y: center.y - Math.cos(angle) * radius }; }
export function triangleVertices(center: Point, radius: number): [Point, Point, Point] {
  const horizontal = radius * Math.sqrt(3) / 2, half = radius / 2;
  return [{ x: center.x, y: center.y - radius }, { x: center.x - horizontal, y: center.y + half }, { x: center.x + horizontal, y: center.y + half }];
}
export function weightsToPoint(vertices: [Point, Point, Point], weights: [number, number, number]): Point {
  const total = weights.reduce((sum, value) => sum + (Number.isFinite(value) && value > 0 ? value : 0), 0) || 1;
  const [h, w, b] = vertices;
  return { x: (Math.max(0, weights[0]) * h.x + Math.max(0, weights[1]) * w.x + Math.max(0, weights[2]) * b.x) / total, y: (Math.max(0, weights[0]) * h.y + Math.max(0, weights[1]) * w.y + Math.max(0, weights[2]) * b.y) / total };
}
export function weightsForHsva(value: Hsva): [number, number, number] { const s = clampUnit(value.s), v = clampUnit(value.v); return [v * s, v * (1 - s), 1 - v]; }
export function triangleContains(point: Point, vertices: [Point, Point, Point]): boolean {
  const sign = (a: Point, b: Point, p: Point) => (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y);
  const [a, b, c] = vertices, d1 = sign(a, b, point), d2 = sign(b, c, point), d3 = sign(c, a, point);
  return !((d1 < -1e-6 || d2 < -1e-6 || d3 < -1e-6) && (d1 > 1e-6 || d2 > 1e-6 || d3 > 1e-6));
}
export function triangleWeights(point: Point, vertices: [Point, Point, Point]): [number, number, number] {  const [h, w, b] = vertices;
  const denominator = (w.y - b.y) * (h.x - b.x) + (b.x - w.x) * (h.y - b.y);
  if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-12) return [1 / 3, 1 / 3, 1 / 3];
  const a = ((w.y - b.y) * (point.x - b.x) + (b.x - w.x) * (point.y - b.y)) / denominator;
  const c = ((b.y - h.y) * (point.x - b.x) + (h.x - b.x) * (point.y - b.y)) / denominator;
  const weights: [number, number, number] = [a, c, 1 - a - c];
  if (weights.every(value => value >= -1e-6)) return weights.map(value => Math.max(0, value)) as [number, number, number];
  // Outside the triangle: project onto the closest segment instead of zeroing negatives.
  let nearest: Point = h, distance = Infinity;
  const edges: [Point, Point][] = [[h, w], [w, b], [b, h]];
  for (const [start, end] of edges) {
    const dx = end.x - start.x, dy = end.y - start.y, length = dx * dx + dy * dy;
    const t = length ? clampUnit(((point.x - start.x) * dx + (point.y - start.y) * dy) / length) : 0;
    const candidate = { x: start.x + dx * t, y: start.y + dy * t };
    const current = (candidate.x - point.x) ** 2 + (candidate.y - point.y) ** 2;
    if (current < distance) { distance = current; nearest = candidate; }
  }
  const d = (w.y - b.y) * (h.x - b.x) + (b.x - w.x) * (h.y - b.y);
  const u = ((w.y - b.y) * (nearest.x - b.x) + (b.x - w.x) * (nearest.y - b.y)) / d;
  const v = ((b.y - h.y) * (nearest.x - b.x) + (h.x - b.x) * (nearest.y - b.y)) / d;
  return [Math.max(0, u), Math.max(0, v), Math.max(0, 1 - u - v)];
}
export function weightsColor(hue: number, weights: [number, number, number], alpha = 1): Rgba {
  const pure = hsvaToRgba({ h: hue, s: 1, v: 1, a: 1 });
  const total = weights.reduce((sum, value) => sum + Math.max(0, value), 0) || 1;
  const wh = Math.max(0, weights[0]) / total, ww = Math.max(0, weights[1]) / total;
  return { r: quantize(wh * pure.r / 255 + ww), g: quantize(wh * pure.g / 255 + ww), b: quantize(wh * pure.b / 255 + ww), a: quantize(clampUnit(alpha)) };
}
