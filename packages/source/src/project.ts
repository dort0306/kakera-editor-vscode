import { randomUUID } from 'node:crypto';
import type { CharacterLook, GameTitle, Portrait } from '../../domain/src/index';
import { appendGroup, patchFrame, readStory, type Sources } from './index';
import { child, escapeXml, group, parseXml, setAttribute, type XmlNode } from './xml';
import { uiFragments } from './ui-files';

export function readGameTitle(sources: Sources): GameTitle {
  const file = child(parseXml(sources.get('story.xml')!), 'interface')?.attrs.src;
  if (!file || !sources.has(file)) throw new Error('缺少 UI 文件');
  const ui = parseXml(sources.get(file)!);
  if (ui.tag !== 'ui' || ui.attrs.schema !== '3') throw new Error('只支持 UI schema 3');
  const binding = ui.attrs['title-bind'];
  const owner = binding?.startsWith('ui.') ? uiFragments(sources).flatMap(f => group(f.root, 'variables').filter(n => n.tag === 'string' && n.attrs.id === binding.slice(3)).map(variable => ({ file: f.file, variable }))) : [];
  const variable = owner[0]?.variable;
  if (binding && !variable) throw new Error('窗口标题绑定必须引用已声明的 UI string');
  if (owner.length > 1) throw new Error('窗口标题变量重复');
  return { file, text: variable?.attrs.initial ?? ui.attrs.title ?? 'Kakera AVG', ...(binding ? { binding } : {}), ...(owner[0] && owner[0].file !== file ? { variableFile: owner[0].file } : {}) };
}
export function patchGameTitle(sources: Sources, title: string, fixed = false): Sources {
  if (typeof title !== 'string' || !title.trim() || [...title].length > 256 || /\p{Cc}/u.test(title)) throw new Error('标题必须为 1–256 个字符且不能包含控制字符');
  const info = readGameTitle(sources), file = info.binding && !fixed ? info.variableFile ?? info.file : info.file; let xml = sources.get(file)!;
  if (info.binding && !fixed) {
    const variable = group(parseXml(xml), 'variables').find(n => n.tag === 'string' && n.attrs.id === info.binding!.slice(3))!;
    xml = setAttribute(xml, variable, 'initial', title);
  } else {
    if (info.binding) xml = setAttribute(xml, parseXml(xml), 'title-bind', '');
    xml = setAttribute(xml, parseXml(xml), 'title', title);
  }
  return new Map([[file, xml]]);
}
export function editCharacter(sources: Sources, id: string | undefined, name: string): { changes: Sources; id: string } {
  if (typeof name !== 'string' || !name.trim() || [...name].length > 256 || /\p{Cc}/u.test(name)) throw new Error('人物名必须非空，最多 256 个字符，且不含控制字符');
  const story = readStory(sources);
  if (!id) {
    const newId = `character.${randomUUID()}`;
    return { changes: new Map([['story.xml', appendGroup(sources.get('story.xml')!, 'characters', `<character id="${newId}" name="${escapeXml(name)}" />`)]]), id: newId };
  }
  for (const file of story.files) {
    const xml = sources.get(file)!, character = group(parseXml(xml), 'characters').find(n => n.attrs.id === id);
    if (character) return { changes: new Map([[file, character.attrs.name === name ? xml : setAttribute(xml, character, 'name', name)]]), id };
  }
  throw new Error('人物不存在或已被外部修改');
}
/** Reusable appearances are real, empty-background single-character XML visuals.
 * No second copy of the game or editor-only XML attributes are introduced. */
export function characterLooks(sources: Sources, characterId: string): CharacterLook[] {
  const story = readStory(sources), looks: CharacterLook[] = [], seen = new Set<string>();
  for (const file of story.files) for (const visual of group(parseXml(sources.get(file)!), 'visuals')) {
    const portraits = visual.children.filter(n => n.tag === 'portrait');
    if (!visual.attrs.background && portraits.length === 1 && portraits[0].attrs.character === characterId) {
      const key = JSON.stringify([portraits[0].attrs.image, child(portraits[0], 'live2d')?.attrs.asset]);
      if (seen.has(key)) continue; seen.add(key);
      looks.push({ visualId: visual.attrs.id, image: portraits[0].attrs.image, file, ...(child(portraits[0], 'live2d') ? { live2d: child(portraits[0], 'live2d')!.attrs.asset } : {}) });
    }
  }
  return looks;
}
export function addCharacterLooks(sources: Sources, characterId: string, looks: { image: string; live2d?: string; visualId?: string }[]): Sources {
  const story = readStory(sources);
  if (!story.characters.some(c => c.id === characterId) || !Array.isArray(looks) || !looks.length || looks.length > 100) throw new Error('请选择人物和 1–100 个外观');
  const changes = new Map<string, string>();
  for (const look of looks) {
    if (!story.assets.some(a => a.id === look.image && a.kind === 'image') || (look.live2d && !story.assets.some(a => a.id === look.live2d && a.kind === 'live2d'))) throw new Error('立绘或模型资源不存在，模型必须有静态回退图');
    if (look.visualId) {
      const owned = characterLooks(sources, characterId).find(l => l.visualId === look.visualId);
      if (!owned) throw new Error('只能编辑此人物的独立外观预设');
      let xml = changes.get(owned.file) ?? sources.get(owned.file)!;
      const visual = group(parseXml(xml), 'visuals').find(n => n.attrs.id === look.visualId)!;
      const portrait = visual.children.find(n => n.tag === 'portrait')!;
      // Advanced Live2D pose/motion data is preserved when only the image changes.
      let markup = xml.slice(portrait.start, portrait.end);
      if (portrait.attrs.image !== look.image) markup = setAttribute(markup, parseXml(markup), 'image', look.image);
      const model = child(parseXml(markup), 'live2d');
      if ('live2d' in look && look.live2d !== (model?.attrs.asset ?? '')) {
        if (model && look.live2d) markup = setAttribute(markup, model, 'asset', look.live2d);
        else if (model) markup = markup.slice(0, model.start) + markup.slice(model.end);
        else if (look.live2d) markup = insertChild(markup, `<live2d asset="${escapeXml(look.live2d)}" />`);
      }
      xml = xml.slice(0, portrait.start) + markup + xml.slice(portrait.end); changes.set(owned.file, xml);
    } else {
      const id = `look.${randomUUID()}`;
      const markup = `<visual id="${id}"><portrait character="${escapeXml(characterId)}" image="${escapeXml(look.image)}" slot="center">${look.live2d ? `<live2d asset="${escapeXml(look.live2d)}" />` : ''}</portrait></visual>`;
      changes.set('story.xml', appendGroup(changes.get('story.xml') ?? sources.get('story.xml')!, 'visuals', markup));
    }
  }
  return changes;
}
function insertChild(xml: string, markup: string): string {
  const root = parseXml(xml);
  if (xml.slice(root.start, root.openEnd).endsWith('/>')) return xml.slice(0, root.openEnd - 2) + `>${markup}</${root.tag}>` + xml.slice(root.end);
  return xml.slice(0, root.closeStart) + markup + xml.slice(root.closeStart);
}
export function assignCharacterLook(sources: Sources, frameRef: string, lookId: string, slot: string): Sources {
  if (!['left', 'center', 'right'].includes(slot)) throw new Error('人物仅支持左、中、右三个槽位');
  const story = readStory(sources), frame = story.frames.find(f => f.ref === frameRef);
  if (!frame) throw new Error('当前幕不存在');
  let look: { node: XmlNode; xml: string } | undefined, current: { node: XmlNode; xml: string } | undefined;
  for (const file of story.files) {
    const xml = sources.get(file)!;
    for (const node of group(parseXml(xml), 'visuals')) {
      if (node.attrs.id === lookId) look = { node, xml };
      if (node.attrs.id === frame.visual) current = { node, xml };
    }
  }
  if (!look || look.node.attrs.background || look.node.attrs.cg || look.node.children.filter(n => n.tag === 'portrait').length !== 1) throw new Error('请选择人物的独立外观预设');
  if (current?.node.attrs.cg) throw new Error('CG 专用画面不能叠加人物；请先改为普通背景画面');
  const sourcePortrait = look.node.children.find(n => n.tag === 'portrait')!;
  let portrait = look.xml.slice(sourcePortrait.start, sourcePortrait.end);
  portrait = setAttribute(portrait, parseXml(portrait), 'slot', slot);
  let visual = current ? current.xml.slice(current.node.start, current.node.end) : '<visual />';
  // Replace the chosen slot only; preserve background, other people and advanced declarations.
  for (const node of parseXml(visual).children.filter(n => n.tag === 'portrait' && n.attrs.slot === slot).reverse()) visual = visual.slice(0, node.start) + visual.slice(node.end);
  const id = `visual.${randomUUID()}`;
  visual = setAttribute(visual, parseXml(visual), 'id', id); visual = insertChild(visual, portrait);
  const changed = appendGroup(sources.get(frame.file)!, 'visuals', visual);
  return new Map([[frame.file, patchFrame(changed, frameRef, { visual: id })]]);
}
export function setFrameVisual(sources: Sources, frameRef: string, background: string, portraits: Portrait[], cg = ''): Sources {
  const story = readStory(sources), frame = story.frames.find(f => f.ref === frameRef);
  if (!frame || portraits.length > 3 || new Set(portraits.map(p => p.slot)).size !== portraits.length) throw new Error('画面幕或人物槽位无效');
  if (cg) {
    if (background || portraits.length) throw new Error('CG 画面不能同时设置背景或人物');
    if (!story.assets.some(a => a.id === cg && a.kind === 'cg')) throw new Error('CG 专用资源不存在');
    const id = `visual.${randomUUID()}`, markup = `<visual id="${id}" cg="${escapeXml(cg)}" />`;
    return new Map([[frame.file, patchFrame(appendGroup(sources.get(frame.file)!, 'visuals', markup), frameRef, { visual: id })]]);
  }
  if (background && !story.assets.some(a => a.id === background && a.kind === 'image')) throw new Error('背景图片不存在');
  for (const p of portraits) if (!['left', 'center', 'right'].includes(p.slot) || !story.characters.some(c => c.id === p.character) || !story.assets.some(a => a.id === p.image && a.kind === 'image') || (p.live2d && !story.assets.some(a => a.id === p.live2d && a.kind === 'live2d'))) throw new Error('人物外观引用无效');
  let visual = '<visual />';
  for (const file of story.files) {
    const xml = sources.get(file)!, node = group(parseXml(xml), 'visuals').find(n => n.attrs.id === frame.visual);
    if (node) visual = xml.slice(node.start, node.end);
  }
  if (parseXml(visual).attrs.cg !== undefined) visual = setAttribute(visual, parseXml(visual), 'cg', '');
  const existing = parseXml(visual).children.filter(n => n.tag === 'portrait'), slots = new Set(existing.map(n => n.attrs.slot));
  for (const node of [...existing].reverse()) {
    const desired = portraits.find(p => p.slot === node.attrs.slot);
    let markup = '';
    if (desired) {
      markup = visual.slice(node.start, node.end);
      for (const key of ['character', 'image'] as const) if (node.attrs[key] !== desired[key]) markup = setAttribute(markup, parseXml(markup), key, desired[key]);
      const model = child(parseXml(markup), 'live2d');
      if ((model?.attrs.asset ?? '') !== (desired.live2d ?? '')) {
        if (model && desired.live2d) markup = setAttribute(markup, model, 'asset', desired.live2d);
        else if (model) markup = markup.slice(0, model.start) + markup.slice(model.end);
        else if (desired.live2d) markup = insertChild(markup, `<live2d asset="${escapeXml(desired.live2d)}"/>`);
      }
    }
    visual = visual.slice(0, node.start) + markup + visual.slice(node.end);
  }
  for (const p of portraits.filter(p => !slots.has(p.slot))) visual = insertChild(visual, `<portrait character="${escapeXml(p.character)}" image="${escapeXml(p.image)}" slot="${p.slot}">${p.live2d ? `<live2d asset="${escapeXml(p.live2d)}"/>` : ''}</portrait>`);
  visual = setAttribute(visual, parseXml(visual), 'background', background);
  const id = `visual.${randomUUID()}`; visual = setAttribute(visual, parseXml(visual), 'id', id);
  return new Map([[frame.file, patchFrame(appendGroup(sources.get(frame.file)!, 'visuals', visual), frameRef, { visual: id })]]);
}
