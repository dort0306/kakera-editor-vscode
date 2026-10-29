import type { Story } from '../../domain/src/index';
import { validateRegions, type AtlasRegion } from '../../domain/src/textures';
export const WORKBENCH_FILE = '.editor/workbench.json';
export interface Point { x: number; y: number }
export interface Workbench { schema: 1; positions: Record<string, Point>; atlases: Record<string, { hash: string; width: number; height: number; regions: AtlasRegion[] }> }
export function readWorkbench(text?: string): Workbench {
  if (!text) return { schema: 1, positions: Object.create(null), atlases: Object.create(null) };
  if (text.length > 1024 * 1024) throw new Error('编辑器布局超过 1MiB');
  const data = JSON.parse(text) as Workbench;
  if (data.schema !== 1 || !data.positions || !data.atlases || Array.isArray(data.positions) || Array.isArray(data.atlases)) throw new Error('编辑器布局格式无效');
  for (const p of Object.values(data.positions)) if (!p || ![p.x, p.y].every(n => Number.isFinite(n) && n >= 0 && n <= 100000)) throw new Error('布局坐标超出范围');
  for (const a of Object.values(data.atlases)) { if (!a || !/^[a-f0-9]{64}$/.test(a.hash)) throw new Error('图集指纹无效'); validateRegions(a.regions, a.width, a.height); }
  return data;
}
export function frameLayout(meta: Workbench, story: Story): Record<string, Point> {
  return Object.fromEntries(story.frames.filter(f => !f.pending && meta.positions[f.id ?? f.ref]).map(f => [f.ref, meta.positions[f.id ?? f.ref]]));
}
export function moveFrame(meta: Workbench, story: Story, ref?: string, point?: Point): Workbench {
  if (!ref) return { ...meta, positions: Object.create(null) };
  return moveFrames(meta, story, { [ref]: point });
}
/** Persist several frame positions in one layout transaction (multi-select drag). */
export function moveFrames(meta: Workbench, story: Story, points: Record<string, Point | undefined>): Workbench {
  const entries = Object.entries(points);
  if (!entries.length) throw new Error('至少需要一个幕布局位置');
  const positions = { ...meta.positions };
  for (const [ref, point] of entries) {
    const frame = story.frames.find(candidate => candidate.ref === ref && !candidate.pending);
    if (!frame || !point || ![point.x, point.y].every(n => Number.isFinite(n) && n >= 0 && n <= 100000)) throw new Error('幕或拖动坐标无效');
    positions[frame.id ?? frame.ref] = { x: Math.round(point.x / 10) * 10, y: Math.round(point.y / 10) * 10 };
  }
  return { ...meta, positions };
}
