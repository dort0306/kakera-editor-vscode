import React, { useEffect, useState } from 'react';
import type { EditorState } from '../../protocol/src/index';
import { LocalizationSettings } from './localization-settings';
import { Icon } from './icons';
export type Send = (state: EditorState, type: string, payload?: Record<string, unknown>) => string;
export type Command = (name: string, characterId?: string) => void;

function useReview(state: EditorState, dirty: boolean, reset: () => void) {
  const [base, setBase] = useState(state.revision), [pending, setPending] = useState('');
  useEffect(() => {
    if ((pending && state.appliedRequestId === pending) || (!dirty && !pending)) {
      reset(); setBase(state.revision); setPending('');
    }
  }, [state.revision, state.appliedRequestId]);
  useEffect(() => {
    const listener = (event: MessageEvent) => { if (['error', 'settled'].includes(event.data.type) && event.data.requestId === pending) setPending(''); };
    window.addEventListener('message', listener); return () => window.removeEventListener('message', listener);
  }, [pending]);
  return { base, pending, setPending, conflict: dirty && base !== state.revision, reload: () => { reset(); setBase(state.revision); setPending(''); } };
}
export function ProjectSettings({ state, send, command, currentFrame, onDirty }: { state: EditorState; send: Send; command: Command; currentFrame?: string; onDirty: (value: boolean) => void }) {
  const [tab, setTab] = useState<'title' | 'characters' | 'localization'>('title');
  const [dirty, setDirty] = useState(false);
  useEffect(() => { onDirty(dirty); }, [dirty]);
  return <section className="project-settings">
    <div className="section-title"><h2><Icon name="settings" size={15} />游戏设置</h2><div className="view-tabs"><button aria-pressed={tab === 'title'} onClick={() => { if (!dirty) setTab('title'); }}><Icon name="type" size={13} />标题</button><button aria-pressed={tab === 'characters'} onClick={() => { if (!dirty) setTab('characters'); }}><Icon name="user" size={13} />人物</button><button aria-pressed={tab === 'localization'} onClick={() => { if (!dirty) setTab('localization'); }}><Icon name="globe" size={13} />本地化</button></div></div>
    {dirty && <p className="muted">当前设置有未保存的编辑，请先保存或还原，再切换设置页。</p>}
    {tab === 'title' ? <TitleSettings state={state} send={send} onDirty={setDirty} /> : tab === 'characters' ? <CharacterSettings state={state} send={send} command={command} currentFrame={currentFrame} onDirty={setDirty} /> : <LocalizationSettings state={state} send={send} onDirty={setDirty} />}
  </section>;
}
function TitleSettings({ state, send, onDirty }: { state: EditorState; send: Send; onDirty: (value: boolean) => void }) {
  const initialMode = state.title?.textKey !== undefined ? 'key' : state.title?.keyBinding !== undefined ? 'key-binding' : 'literal';
  const [title, setTitle] = useState(state.title?.text ?? ''), [fixed, setFixed] = useState(false);
  const [mode, setMode] = useState<'literal' | 'key' | 'key-binding'>(initialMode);
  const [key, setKey] = useState(state.title?.textKey ?? ''), [keyBinding, setKeyBinding] = useState(state.title?.keyBinding ?? '');
  const catalog = state.story?.localization;
  const defaultMessages = catalog?.texts.find(item => item.id === catalog.defaultText)?.messages.flatMap(file => file.entries.filter(entry => !entry.term)) ?? [];
  const stringVariables = (state.ui?.variables ?? []).filter(variable => variable.type === 'string');
  const saved = mode === 'key' ? key : mode === 'key-binding' ? keyBinding : title;
  const currentSaved = initialMode === 'key' ? state.title?.textKey ?? '' : initialMode === 'key-binding' ? state.title?.keyBinding ?? '' : state.title?.text ?? '';
  const dirty = mode !== initialMode || saved !== currentSaved || (mode === 'literal' && fixed);
  const review = useReview(state, dirty, () => { setTitle(state.title?.text ?? ''); setKey(state.title?.textKey ?? ''); setKeyBinding(state.title?.keyBinding ?? ''); setMode(initialMode); setFixed(false); });
  useEffect(() => { onDirty(dirty || !!review.pending); }, [dirty, review.pending]);
  const reviewConflict = review.conflict;
  return <fieldset disabled={!state.writable || !!review.pending}>
    <label>标题来源<select aria-label="标题来源" value={mode} onChange={e => setMode(e.target.value as typeof mode)}><option value="literal">固定标题 / 标题绑定</option><option value="key" disabled={!catalog?.enabled}>本地化静态 key</option><option value="key-binding" disabled={!catalog?.enabled || !stringVariables.length}>本地化 key 绑定</option></select></label>
    {mode === 'literal' && <label>游戏标题<input aria-label="游戏标题" value={title} onChange={e => setTitle(e.target.value)} placeholder="输入游戏名称" /></label>}
    {mode === 'key' && <><label>标题 key<input aria-label="标题 key" value={key} maxLength={128} onChange={e => setKey(e.target.value)} /></label><label>选择已有消息<select aria-label="标题消息" value={key} onChange={e => setKey(e.target.value)}><option value="">选择默认文本消息</option>{defaultMessages.map(entry => <option key={entry.id} value={entry.id}>{entry.id}</option>)}</select></label><p className="muted">当前默认语言解析：{key ? defaultMessages.find(entry => entry.id === key)?.value ?? '（缺少消息）' : '请选择 key'}。标题和消息正文在“本地化”设置页编辑。</p></>}
    {mode === 'key-binding' && <><label>标题 key 变量<select aria-label="标题 key 变量" value={keyBinding} onChange={e => setKeyBinding(e.target.value)}><option value="">选择 UI string 变量</option>{stringVariables.map(variable => <option key={variable.id} value={`ui.${variable.id}`}>ui.{variable.id} · 初始值 {variable.initial || '（空）'}</option>)}</select></label><p className="muted">变量保存消息 key；运行中由普通 ctx.setUi 更新，窗口标题随当前文本语言重新格式化。</p></>}
    {mode === 'literal' && state.title?.binding && <><p className="muted">标题由 {state.title.binding} 控制。默认修改初始标题，运行中的脚本仍可改变它。</p><label className="check-label"><input type="checkbox" checked={fixed} onChange={e => setFixed(e.target.checked)} />改用固定标题，解除此标题绑定</label></>}
    {mode !== 'literal' && (state.title?.textKey || state.title?.keyBinding) && <p className="muted">切换回固定标题会移除本地化标题来源；消息条目仍保留在 FTL 中。</p>}
    {reviewConflict && <p className="notice">源码已更新，草稿已保留。请还原后重新编辑。</p>}
    <div className="actions"><button className="primary" disabled={!dirty || (mode === 'literal' && !title.trim()) || (mode === 'key' && !key.trim()) || (mode === 'key-binding' && !keyBinding) || reviewConflict} onClick={() => review.setPending(send({ ...state, revision: review.base }, 'title', { title: mode === 'key' ? key : mode === 'key-binding' ? keyBinding : title, fixed, ...(mode === 'literal' ? {} : { mode }) }))}>保存标题</button><button onClick={review.reload}>还原</button></div>
    <p className="muted">同时用于工作台和游戏窗口；故事标识与已有存档不变。</p>
  </fieldset>;
}
function defaultMessageKeys(state: EditorState): string[] {
  const catalog = state.story?.localization;
  const locale = catalog?.texts.find(item => item.id === catalog.defaultText);
  return [...new Set((locale?.messages ?? []).flatMap(file => file.entries.filter(entry => !entry.term).map(entry => entry.id)))].sort();
}
function CharacterSettings({ state, send, command, currentFrame, onDirty }: { state: EditorState; send: Send; command: Command; currentFrame?: string; onDirty: (value: boolean) => void }) {
  const characters = state.story!.characters;
  const messageKeys = defaultMessageKeys(state);
  const [selected, setSelected] = useState(characters[0]?.id ?? ''), [creating, setCreating] = useState(!characters.length);
  const [creationIds, setCreationIds] = useState(characters.map(c => c.id));
  useEffect(() => { if (selected && !creating) send(state, 'preview', { characterId: selected }); }, [selected, creating]);
  const selectedCharacter = characters.find(c => c.id === selected);
  const [name, setName] = useState(selectedCharacter?.name ?? '');
  const [nameMode, setNameMode] = useState<'literal' | 'key'>(selectedCharacter?.nameKey ? 'key' : 'literal');
  const [nameKey, setNameKey] = useState(selectedCharacter?.nameKey ?? '');
  const dirty = creating ? (nameMode === 'key' ? !!nameKey : !!name) : nameMode !== (selectedCharacter?.nameKey ? 'key' : 'literal') || (nameMode === 'key' ? nameKey !== (selectedCharacter?.nameKey ?? '') : name !== (selectedCharacter?.name ?? ''));
  const [images, setImages] = useState<string[]>([]), [model, setModel] = useState(''), [fallback, setFallback] = useState(''), [lookId, setLookId] = useState(''), [slot, setSlot] = useState('center');
  const selectedLook = looksForSelection();
  function looksForSelection() { return state.characterLooks?.[selected]?.find(l => l.visualId === lookId); }
  const libraryDirty = images.length > 0 || (lookId ? fallback !== selectedLook?.image || model !== (selectedLook?.live2d ?? '') : !!model);
  const review = useReview(state, dirty || libraryDirty, () => { setName(selectedCharacter?.name ?? ''); setNameMode(selectedCharacter?.nameKey ? 'key' : 'literal'); setNameKey(selectedCharacter?.nameKey ?? ''); setCreating(!characters.length); });
  useEffect(() => { onDirty(dirty || libraryDirty || !!review.pending); }, [dirty, libraryDirty, review.pending]);
  useEffect(() => { if (review.pending && state.appliedRequestId === review.pending) { if (creating) { const created = characters.find(c => !creationIds.includes(c.id)); if (created) { setSelected(created.id); setName(created.name); setNameMode(created.nameKey ? 'key' : 'literal'); setNameKey(created.nameKey ?? ''); setCreating(false); } } setImages([]); setModel(''); setLookId(''); } }, [state.appliedRequestId]);
  const looks = !creating ? state.characterLooks?.[selected] ?? [] : [];
  const imageAssets = state.story!.assets.filter(a => a.kind === 'image'), models = state.story!.assets.filter(a => a.kind === 'live2d');
  const label = (id: string) => state.story!.assets.find(a => a.id === id)?.src.split('/').pop() ?? id;
  const changeCharacter = (id: string) => { if (dirty || libraryDirty || review.pending) return; const character = characters.find(c => c.id === id); setSelected(id); setCreating(false); setName(character?.name ?? ''); setNameMode(character?.nameKey ? 'key' : 'literal'); setNameKey(character?.nameKey ?? ''); setImages([]); setModel(''); setLookId(''); send(state, 'preview', { characterId: id }); };
  return <div className="characters-settings">
    <div className="character-picker"><select aria-label="选择人物" value={creating ? '' : selected} disabled={dirty || libraryDirty || !!review.pending} onChange={e => changeCharacter(e.target.value)}><option value="" disabled>新人物</option>{characters.map(c => <option key={c.id} value={c.id}>{c.name || c.id}</option>)}</select><button disabled={!state.writable || dirty || libraryDirty || !!review.pending} onClick={() => { setCreationIds(characters.map(c => c.id)); setCreating(true); setName(''); setNameMode('literal'); setNameKey(''); }}>＋新建人物</button></div>
    <fieldset disabled={!state.writable || !!review.pending}>
      <label>人物名字来源<select aria-label="人物名字来源" value={nameMode} onChange={e => setNameMode(e.target.value as 'literal' | 'key')}><option value="literal">固定名字</option><option value="key" disabled={!state.story!.localization?.enabled || !messageKeys.length}>本地化 name-key</option></select></label>
      {nameMode === 'literal' ? <label>人物名字<input aria-label="人物名字" value={name} onChange={e => setName(e.target.value)} placeholder="角色在对话中的名字" /></label> : <label>人物 name-key<select aria-label="人物 name-key" value={nameKey} onChange={e => setNameKey(e.target.value)}><option value="">选择默认文本消息</option>{messageKeys.map(key => <option key={key} value={key}>{key}</option>)}</select></label>}
      {review.conflict && <p className="notice">人物源码已更新，请还原草稿后重试。</p>}
      <div className="actions"><button className="primary" disabled={!dirty || (nameMode === 'literal' ? !name.trim() : !nameKey) || review.conflict} onClick={() => review.setPending(send({ ...state, revision: review.base }, 'character', { ...(creating ? {} : { id: selected }), name, ...(nameMode === 'key' ? { nameKey } : selectedCharacter?.nameKey ? { nameKey: '' } : {}) }))}>{creating ? '创建人物' : '保存名字'}</button><button onClick={() => { review.reload(); setImages([]); setModel(''); setLookId(''); }}>还原编辑</button></div>
      {!creating && selectedCharacter && <>
        <h3><span><Icon name="user" size={12} />立绘与 Live2D 外观</span><small>{looks.length} 个</small></h3>
        <div className="actions"><button disabled={dirty || libraryDirty} onClick={() => command('kakera.character.importPortraits', selected)}>批量导入立绘</button><button disabled={dirty || libraryDirty} onClick={() => command('kakera.character.importLive2d', selected)}>导入 Live2D 模型</button></div>
        <div className="looks-grid">{looks.slice(0, 50).map(look => <button className={`look-card ${lookId === look.visualId ? 'selected' : ''}`} key={look.visualId} aria-pressed={lookId === look.visualId} onClick={() => { setLookId(look.visualId); setFallback(look.image); setModel(look.live2d ?? ''); }}>
          {state.images[look.image] ? <img src={state.images[look.image]} alt={`${selectedCharacter.name}：${label(look.image)}`} loading="lazy" /> : <span className="look-placeholder">立绘</span>}
          <strong>{label(look.live2d ?? look.image)}</strong><small>{look.live2d ? 'Live2D · 有静态回退图' : '静态立绘'}</small>
        </button>)}</div>
        {!looks.length && <p className="muted">为人物导入一批立绘，或添加模型与回退图，之后即可在幕中选用。</p>}
        <details open={!!lookId}><summary>{lookId ? '编辑所选外观 / 放入当前幕' : '从已有资源添加外观'}</summary>
          {lookId && state.story!.frames.some(f => f.visual === lookId) && <p className="notice">此预设由以下幕直接使用，修改外观会一起生效：{state.story!.frames.filter(f => f.visual === lookId).map(f => `${f.name ?? f.ref.slice(0, 8)}（${f.text.slice(0, 18)}）`).join('、')}。</p>}
          {!lookId && <label>批量选择已有立绘<select multiple size={Math.min(6, Math.max(2, imageAssets.length))} aria-label="选择一批立绘" value={images} onChange={e => setImages(Array.from(e.target.selectedOptions, o => o.value))}>{imageAssets.map(a => <option key={a.id} value={a.id}>{label(a.id)}</option>)}</select></label>}
          <label>Live2D 模型（可选）<select aria-label="Live2D 模型" value={model} onChange={e => setModel(e.target.value)}><option value="">静态立绘</option>{models.map(a => <option key={a.id} value={a.id}>{label(a.id)}</option>)}</select></label>
          {(lookId || model) && <label>{model ? '静态回退图（必需）' : '立绘图片'}<select aria-label="静态回退图" value={fallback} onChange={e => setFallback(e.target.value)}><option value="">请选择图片</option>{imageAssets.map(a => <option key={a.id} value={a.id}>{label(a.id)}</option>)}</select></label>}
          <button disabled={dirty || review.conflict || (lookId || model ? !fallback : !images.length)} onClick={() => review.setPending(send(state, 'characterLooks', { characterId: selected, looks: lookId ? [{ visualId: lookId, image: fallback, live2d: model }] : model ? [{ image: fallback, live2d: model }] : images.map(image => ({ image })) }))}>{lookId ? '保存外观' : '添加所选外观'}</button>
          {lookId && <div className="place-look"><label>放置位置<select aria-label="立绘放置位置" value={slot} onChange={e => setSlot(e.target.value)}><option value="left">左侧</option><option value="center">中间</option><option value="right">右侧</option></select></label><button disabled={!currentFrame || dirty || review.conflict || fallback !== looks.find(l => l.visualId === lookId)?.image || model !== (looks.find(l => l.visualId === lookId)?.live2d ?? '')} onClick={() => review.setPending(send(state, 'appearance', { ref: currentFrame, visualId: lookId, slot }))}>将此外观放入当前幕</button><p className="muted">复制完整画面后替换指定槽位，保留背景和其他人物。</p></div>}
        </details>
        {!!model && <div className="notice">{state.live2dMode === 'native' ? '已配置 Cubism Core，使用播放器检验模型。' : '未配置 Cubism Core，当前校验/试玩使用明确的静态回退模式；原生模型需配置 Core。'}<button onClick={() => command('kakera.tools.configureCore')}>配置 Cubism Core</button></div>}
      </>}
    </fieldset>
  </div>;
}
