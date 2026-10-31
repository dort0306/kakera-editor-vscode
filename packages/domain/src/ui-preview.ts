import type { Story } from './index';
import { formatFtlValue, type LocalizationCatalog } from './localization';
import { patchAxis } from './textures';
import { normalizeColor } from './colors';
import { shortcutDefaults, shortcutDisplay } from './shortcuts';
import { type UiDesign, type UiNode, type UiScreen, type UiTextures } from './ui';
export type UiRect = [number, number, number, number];
export interface UiPreviewNode { node: UiNode; rect: UiRect; clip: UiRect; text: string; image?: string; region?: string; colorValue?: string; visible: boolean; enabled: boolean; instance: string; template: boolean }
export function intersectUi(a: UiRect, b: UiRect): UiRect {
  const x = Math.max(a[0], b[0]), y = Math.max(a[1], b[1]); return [x, y, Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - x), Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - y)];
}
export function uiContentRect(rect: UiRect, node: UiNode, textures: UiTextures): UiRect {
  const texture = textures[node.attrs.image ?? '']; if (node.kind !== 'nine-patch' || !texture?.spec) return rect;
  const { width, height, spec } = texture, density = Number(node.attrs.density ?? 1);
  const x = patchAxis(width, spec.horizontal, rect[2], density), y = patchAxis(height, spec.vertical, rect[3], density);
  const map = (spans: typeof x, value: number) => { const part = spans.find(s => value >= s.source[0] && value <= s.source[1]) ?? spans.at(-1)!; return part.target[0] + (value - part.source[0]) / (part.source[1] - part.source[0]) * (part.target[1] - part.target[0]); };
  const [l, t, r, b] = spec.content, left = map(x, l), top = map(y, t);
  return [rect[0] + left, rect[1] + top, map(x, r) - left, map(y, b) - top];
}
/** Design-time sample data only; no scripts, saved games or live session are evaluated. */
export function previewUi(design: UiDesign, screen: UiScreen, story?: Story, frameRef?: string, textures: UiTextures = {}, showHidden = true): UiPreviewNode[] {
  const frame = story?.frames.find(f => f.ref === frameRef) ?? story?.frames.find(f => !f.pending), result: UiPreviewNode[] = [];
  const defaults = shortcutDefaults();
  const colors = Object.fromEntries((design.palette ?? []).map(slot => { try { return [slot.id, normalizeColor(slot.initial)]; } catch { return [slot.id, '#000000FF']; } }));
  const catalog = story?.localization;
  const localeValues = {
    enabled: !!catalog?.enabled, textRequested: '', voiceRequested: '',
    text: catalog?.defaultText ?? '', voice: catalog?.defaultVoice ?? '',
    textSource: catalog?.enabled ? 'default' : 'disabled', voiceSource: catalog?.defaultVoice ? 'default' : 'disabled'
  };
  const localeList = (kind: 'text' | 'voice') => kind === 'text'
    ? (catalog?.texts ?? []).map(locale => ({ id: locale.id, label: locale.label, selected: locale.id === catalog?.defaultText, default: locale.id === catalog?.defaultText }))
    : (catalog?.voices ?? []).map(locale => ({ id: locale.id, label: locale.label, selected: locale.id === catalog?.defaultVoice, default: locale.id === catalog?.defaultVoice }));
  const values: Record<string, any> = {
    game: { frameId: frame?.ref ?? '', speaker: story?.characters.find(c => c.id === frame?.speaker)?.name ?? '旁白', text: frame?.text ?? '台词示例', continueText: '继续', autoText: '自动播放', complete: true, canAdvance: !frame?.options.length, ended: false, noChoices: false, live2dEnabled: false, autoPlaying: false, transitioning: false },
    settings: { muted: false, autosave: true, skip_all: false, fullscreen: false, text_speed: 30, auto_delay: 2, master_volume: 1, bgm_volume: .7, voice_volume: .8, se_volume: .7, video_volume: .8 },
    saves: { page: 1, pages: 20, pageText: '第 1 页 / 共 20 页', canPrev: false, canNext: true },
    ui: Object.fromEntries(design.variables.map(v => [v.id, v.type === 'bool' ? v.initial === 'true' : v.initial])),
    colors,
    locale: localeValues,
    shortcuts: { bindings: defaults, advanceLabel: shortcutDisplay(defaults.advance), fastForwardLabel: shortcutDisplay(defaults.fast_forward), skipSequenceLabel: shortcutDisplay(defaults.skip_sequence), captureActive: false, captureText: '' }
  };
  const resolve = (path: string, item: any): any => { if (path === 'true') return true; if (path === 'false') return false; if (path.startsWith('not:')) return !resolve(path.slice(4), item); if (path === 'audio.enabled') return true; if (path.startsWith('audio.actor.')) return story?.characters.some(c => c.id === path.slice(12)) ? true : undefined; if (path.startsWith('audio.excluded.')) return story?.assets.some(a => a.kind === 'audio' && a.id === path.slice(15)) ? false : undefined; const [root, ...tail] = path.split('.'); let v = root === 'item' ? item : values[root]; for (const part of tail) v = v?.[part]; return v; };
  const sample = (source: string) => source === 'choices' ? frame?.options.length ? frame.options : [{ id: 'example', text: '示例选项' }] : source === 'variables' ? story?.variables.map(v => ({ id: v.id, label: v.label ?? v.id, value: v.initial })) ?? [] : source === 'gallery' ? design.gallery : source === 'history' ? [{ speaker: '旁白', text: frame?.text ?? '历史示例', choice: '' }] : source === 'textLocales' ? localeList('text') : source === 'voiceLocales' ? localeList('voice') : Array.from({ length: 10 }, (_, i) => ({ slot: i + 1, title: `槽位 ${i + 1}`, preview: '空存档 · 设计示例', excerpt: '', exists: false, loadable: false, hasScreenshot: false, savedAt: '', image: '' }));
  const formatLocalized = (catalogValue: LocalizationCatalog | undefined, key: string, args: Record<string, string | number>): string => {
    if (!catalogValue?.enabled) return `⟦${key}⟧`;
    try { return formatFtlValue(catalogValue, undefined, key, args); } catch { return `⟦${key}⟧`; }
  };
  const argumentValue = (arg: { value?: string; bind?: string }, item: any): string => {
    if (arg.value !== undefined) return arg.value;
    const value = arg.bind ? resolve(arg.bind, item) : undefined;
    if (value === undefined || value === null) return arg.bind ? `⟦${arg.bind}⟧` : '';
    return typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value);
  };
  function nodes(items: UiNode[], origin: UiRect, clip: UiRect, item: any, parentVisible: boolean, parentEnabled: boolean, instance: string, template: boolean): void {
    for (const node of items) {
      if (result.length >= 2000) return;
      const a = node.attrs, visible = parentVisible && resolve(a.visible || 'true', item) === true, enabled = parentEnabled && resolve(a.enabled || 'true', item) === true;
      if (!visible && !showHidden) continue;
      const rect: UiRect = [origin[0] + Number(a.x ?? 0), origin[1] + Number(a.y ?? 0), Number(a.width), Number(a.height)], clipped = intersectUi(rect, clip);
      let text = a.bind ? resolve(a.bind, item) : a.text ?? '';
      if (node.localized) {
        const args = Object.fromEntries(node.localized.args.map(arg => [arg.name, argumentValue(arg, item)]));
        const key = node.localized.key ?? (node.localized.keyBound ? resolve(a['text-key-bind'], item) : undefined);
        if (typeof key === 'string' && key) text = formatLocalized(catalog, key, args);
        else if (node.localized.key || node.localized.keyBound) text = `⟦${node.localized.key ?? a['text-key-bind'] ?? 'text-key'}⟧`;
      }
      const image = a.image ?? (a['image-bind'] ? resolve(a['image-bind'], item) : undefined);
      const region = a.region ?? (a['region-bind'] ? resolve(a['region-bind'], item) : undefined);
      const boundColor = a['color-bind'] ? resolve(a['color-bind'], item) : undefined;
      const pickerColor = node.kind === 'color-picker' ? resolve(a.value, item) : undefined;
      const colorValue = typeof pickerColor === 'string' ? pickerColor : typeof boundColor === 'string' ? boundColor : undefined;
      result.push({ node, rect, clip: clipped, text: text === undefined ? `⟦${a.bind}⟧` : typeof text === 'boolean' ? text ? '是' : '否' : String(text), image: typeof image === 'string' ? image : undefined, region: typeof region === 'string' ? region : undefined, colorValue, visible, enabled, instance: `${instance}/${node.id}`, template });
      if (node.kind === 'repeat') {
        const columns = Math.max(1, Math.min(8, Number(a.columns ?? 1))), w = Number(a['item-width']), h = Number(a['item-height']), gap = Number(a.gap ?? 8);
        sample(a.source).slice(0, 10).forEach((value, i) => nodes(node.children, [rect[0] + i % columns * (w + gap), rect[1] + Math.floor(i / columns) * (h + gap), w, h], clipped, value, visible, enabled, `${instance}/${node.id}:${i}`, template || i > 0));
      } else if (node.children.length) { const content = uiContentRect(rect, node, textures); nodes(node.children, content, intersectUi(clipped, content), item, visible, enabled, `${instance}/${node.id}`, template); }
    }
  }
  nodes(screen.children, [0, 0, design.width, design.height], [0, 0, design.width, design.height], {}, true, true, screen.id, false); return result;
}
