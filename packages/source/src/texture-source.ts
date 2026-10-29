import type { Sources } from './index';
import { readStory, addAsset } from './index';
import { child, parseXml, setAttribute, escapeXml, type XmlNode } from './xml';
import { uiFragments } from './ui-files';
import { locateUi } from './ui-source';
import type { AtlasRegion } from '../../domain/src/textures';
export interface TextureTarget { id: string; tag: string; screen: string; image?: string; region?: string; bound: boolean; density: number }
export interface TextureUi { file: string; screens: string[]; targets: TextureTarget[] }
function walk(n: XmlNode, screen: string, visit: (n: XmlNode, screen: string) => void): void { const current = n.tag === 'screen' ? n.attrs.id : screen; visit(n, current); for (const c of n.children) walk(c, current, visit); }
export function textureUi(sources: Sources): TextureUi {
  const file = child(parseXml(sources.get('story.xml')!), 'interface')?.attrs.src;
  const result: TextureUi = { file: file ?? '', screens: [], targets: [] }; if (!file || !sources.has(file)) return result;
  for (const fragment of uiFragments(sources)) walk(fragment.root, '', (n, screen) => { if (n.tag === 'screen') result.screens.push(n.attrs.id); if (['image', 'panel', 'button', 'nine-patch'].includes(n.tag) && n.attrs.id) result.targets.push({ id: n.attrs.id, tag: n.tag, screen, image: n.attrs.image, region: n.attrs.region, bound: !!(n.attrs['image-bind'] || n.attrs['region-bind']), density: Number(n.attrs.density ?? 1) }); });
  return result;
}
export function assignTexture(sources: Sources, assetId: string, kind: 'image' | 'nine-patch', target: string, region?: AtlasRegion, density = 1): Sources {
  const info = textureUi(sources); if (!info.file || !target) throw new Error('请选择 UI 控件或页面');
  if (!Number.isFinite(density) || density < .125 || density > 8) throw new Error('density 需在 0.125–8 之间');
  const screen = info.screens.includes(target), location = locateUi(sources, target, screen), file = location.file;
  let source = sources.get(file)!;
  const find = () => { const found: XmlNode[] = []; walk(parseXml(source), '', n => { if (n.attrs.id === target) found.push(n); }); if (found.length !== 1) throw new Error('UI 目标不存在或 ID 不唯一'); return found[0]; };
  const node = find();
  if (node.tag === 'screen') {
    const id = `texture.${assetId.replace(/[^a-zA-Z0-9_.-]/g, '_')}`;
    const extra = kind === 'nine-patch' ? ` density="${density}"` : region ? ` region="${region.x},${region.y},${region.width},${region.height}"` : '';
    if (info.targets.some(t => t.id === id)) throw new Error('此页面示例控件已存在，请选择已有控件编辑');
    const markup = `<${kind === 'nine-patch' ? 'nine-patch' : 'image'} id="${id}" x="20" y="20" width="320" height="180" image="${escapeXml(assetId)}"${extra}/>`;
    if (source.slice(node.start, node.openEnd).endsWith('/>')) throw new Error('请先选择非空 UI 页面');
    source = source.slice(0, node.closeStart) + `\n    ${markup}\n` + source.slice(node.closeStart);
  } else {
    if (!(kind === 'nine-patch' ? node.tag === 'nine-patch' : ['image', 'panel', 'button'].includes(node.tag))) throw new Error('UI 控件类型与资源不匹配');
    for (const [name, value] of [['image', assetId], ['image-bind', ''], ['region-bind', ''], ...(kind === 'nine-patch' ? [['density', String(density)]] : [['region', region ? `${region.x},${region.y},${region.width},${region.height}` : '']])]) source = setAttribute(source, find(), name, value);
  }
  parseXml(source); return new Map([[file, source]]);
}
export function registerTexture(sources: Sources, assetId: string, kind: 'image' | 'nine-patch', src: string): Sources {
  const asset = readStory(sources).assets.find(a => a.id === assetId);
  if (!asset) return new Map([['story.xml', addAsset(sources.get('story.xml')!, { id: assetId, kind, src })]]);
  if (asset.kind !== kind) throw new Error('不能改变既有资源的类型');
  const xml = sources.get(asset.file)!, node = child(parseXml(xml), 'assets')?.children.find(n => n.attrs.id === assetId); if (!node) throw new Error('资源声明已改变');
  return new Map([[asset.file, setAttribute(xml, node, 'src', src)]]);
}
