export type Interval = [number, number];
export interface NinePatchSpec { horizontal: Interval[]; vertical: Interval[]; content: [number, number, number, number] }
export interface AtlasRegion { name: string; x: number; y: number; width: number; height: number }
export const MAX_TEXTURE_PIXELS = 4 * 1024 * 1024;
export function textureSize(width: number, height: number): void {
  if (![width, height].every(n => Number.isInteger(n) && n > 0 && n <= 4096) || width * height > MAX_TEXTURE_PIXELS) throw new Error('图片需在 4096 像素边长、总计 4M 像素以内');
}
export function validateNinePatch(spec: NinePatchSpec, width: number, height: number): void {
  textureSize(width, height);
  for (const [spans, size] of [[spec?.horizontal, width], [spec?.vertical, height]] as const) {
    if (!Array.isArray(spans) || !spans.length || spans.length > 8) throw new Error('每轴需要 1–8 个伸缩段');
    let end = -1;
    for (const span of spans) { if (!Array.isArray(span) || span.length !== 2 || !span.every(Number.isInteger) || span[0] < 0 || span[0] <= end || span[1] <= span[0] || span[1] > size) throw new Error('伸缩段需按顺序排列、不重叠或相接，且不能越界'); end = span[1]; }
  }
  const c = spec?.content;
  if (!Array.isArray(c) || c.length !== 4 || !c.every(Number.isInteger) || c[0] < 0 || c[1] < 0 || c[2] <= c[0] || c[3] <= c[1] || c[2] > width || c[3] > height) throw new Error('内容区需为图片内的有效矩形');
}
export function validateRegions(regions: AtlasRegion[], width: number, height: number): void {
  textureSize(width, height);
  if (!Array.isArray(regions) || !regions.length || regions.length > 256) throw new Error('图集需要 1–256 个区域');
  const names = new Set<string>();
  for (const r of regions) {
    if (!r || typeof r.name !== 'string' || !r.name.trim() || r.name.length > 128 || names.has(r.name)) throw new Error('区域名称需非空且唯一'); names.add(r.name);
    if (![r.x, r.y, r.width, r.height].every(Number.isInteger) || r.x < 0 || r.y < 0 || r.width <= 0 || r.height <= 0 || r.x + r.width > width || r.y + r.height > height) throw new Error('图集裁切区域越界或无效');
  }
}
export function gridRegions(width: number, height: number, cellWidth: number, cellHeight: number, gap = 0, margin = 0): AtlasRegion[] {
  if (![cellWidth, cellHeight].every(n => Number.isInteger(n) && n > 0) || ![gap, margin].every(n => Number.isInteger(n) && n >= 0)) throw new Error('网格尺寸或间距无效');
  const result: AtlasRegion[] = [];
  for (let y = margin; y + cellHeight <= height - margin; y += cellHeight + gap) for (let x = margin; x + cellWidth <= width - margin; x += cellWidth + gap) { result.push({ name: `区域${result.length + 1}`, x, y, width: cellWidth, height: cellHeight }); if (result.length > 256) throw new Error('网格超过 256 个区域'); }
  validateRegions(result, width, height); return result;
}
// Same fixed/stretch allocation as Kakera v0.8.3 image_layout::axis.
export function patchAxis(length: number, spans: Interval[], size: number, density: number): { source: Interval; target: Interval }[] {
  const scale = 1 / density, flexible = spans.reduce((n, s) => n + s[1] - s[0], 0), fixed = (length - flexible) * scale, shrink = fixed > size ? size / fixed : 1;
  const cuts = [...new Set([0, length, ...spans.flat()])].sort((a, b) => a - b); let offset = 0;
  return cuts.slice(0, -1).map((start, i) => { const end = cuts[i + 1], stretch = spans.some(s => start >= s[0] && end <= s[1]); const extent = stretch ? Math.max(0, size - fixed) * (end - start) / flexible : (end - start) * scale * shrink; const from = offset; offset += extent; return { source: [start, end], target: [from, offset] }; });
}
