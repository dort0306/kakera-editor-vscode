import React, { useEffect, useState } from 'react';
import type { EditorState } from '../../protocol/src/index';
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
  const [tab, setTab] = useState<'title' | 'characters'>('title');
  const [dirty, setDirty] = useState(false);
  useEffect(() => { onDirty(dirty); }, [dirty]);
  return <section className="project-settings">
    <div className="section-title"><h2>游戏设置</h2><div className="view-tabs"><button aria-pressed={tab === 'title'} onClick={() => { if (!dirty) setTab('title'); }}>标题</button><button aria-pressed={tab === 'characters'} onClick={() => { if (!dirty) setTab('characters'); }}>人物</button></div></div>
    {dirty && <p className="muted">当前设置有未保存的编辑，请先保存或还原，再切换设置页。</p>}
    {tab === 'title' ? <TitleSettings state={state} send={send} onDirty={setDirty} /> : <CharacterSettings state={state} send={send} command={command} currentFrame={currentFrame} onDirty={setDirty} />}
  </section>;
}
function TitleSettings({ state, send, onDirty }: { state: EditorState; send: Send; onDirty: (value: boolean) => void }) {
  const [title, setTitle] = useState(state.title?.text ?? ''), [fixed, setFixed] = useState(false);
  const dirty = title !== (state.title?.text ?? '') || fixed;
  const review = useReview(state, dirty, () => { setTitle(state.title?.text ?? ''); setFixed(false); });
  useEffect(() => { onDirty(dirty || !!review.pending); }, [dirty, review.pending]);
  return <fieldset disabled={!state.writable || !!review.pending}>
    <label>游戏标题<input aria-label="游戏标题" value={title} onChange={e => setTitle(e.target.value)} placeholder="输入游戏名称" /></label>
    {state.title?.binding && <><p className="muted">标题由 {state.title.binding} 控制。默认修改初始标题，运行中的脚本仍可改变它。</p><label className="check-label"><input type="checkbox" checked={fixed} onChange={e => setFixed(e.target.checked)} />改用固定标题，解除此标题绑定</label></>}
    {review.conflict && <p className="notice">源码已更新，草稿已保留。请还原后重新编辑。</p>}
      <div className="actions"><button className="primary" disabled={!dirty || !title.trim() || review.conflict} onClick={() => review.setPending(send({ ...state, revision: review.base }, 'title', { title, fixed }))}>保存标题</button><button onClick={review.reload}>还原</button></div>
    <p className="muted">同时用于工作台和游戏窗口；故事标识与已有存档不变。</p>
  </fieldset>;
}
function CharacterSettings({ state, send, command, currentFrame, onDirty }: { state: EditorState; send: Send; command: Command; currentFrame?: string; onDirty: (value: boolean) => void }) {
  const characters = state.story!.characters;
  const [selected, setSelected] = useState(characters[0]?.id ?? ''), [creating, setCreating] = useState(!characters.length);
  const [creationIds, setCreationIds] = useState(characters.map(c => c.id));
  useEffect(() => { if (selected && !creating) send(state, 'preview', { characterId: selected }); }, [selected, creating]);
  const selectedCharacter = characters.find(c => c.id === selected);
  const [name, setName] = useState(selectedCharacter?.name ?? '');
  const dirty = creating ? !!name : name !== (selectedCharacter?.name ?? '');
  const [images, setImages] = useState<string[]>([]), [model, setModel] = useState(''), [fallback, setFallback] = useState(''), [lookId, setLookId] = useState(''), [slot, setSlot] = useState('center');
  const selectedLook = looksForSelection();
  function looksForSelection() { return state.characterLooks?.[selected]?.find(l => l.visualId === lookId); }
  const libraryDirty = images.length > 0 || (lookId ? fallback !== selectedLook?.image || model !== (selectedLook?.live2d ?? '') : !!model);
  const review = useReview(state, dirty || libraryDirty, () => { setName(selectedCharacter?.name ?? ''); setCreating(!characters.length); });
  useEffect(() => { onDirty(dirty || libraryDirty || !!review.pending); }, [dirty, libraryDirty, review.pending]);
  useEffect(() => { if (review.pending && state.appliedRequestId === review.pending) { if (creating) { const created = characters.find(c => c.name === name && !creationIds.includes(c.id)); if (created) { setSelected(created.id); setName(created.name); setCreating(false); } } setImages([]); setModel(''); setLookId(''); } }, [state.appliedRequestId]);
  const looks = !creating ? state.characterLooks?.[selected] ?? [] : [];
  const imageAssets = state.story!.assets.filter(a => a.kind === 'image'), models = state.story!.assets.filter(a => a.kind === 'live2d');
  const label = (id: string) => state.story!.assets.find(a => a.id === id)?.src.split('/').pop() ?? id;
  const changeCharacter = (id: string) => { if (dirty || libraryDirty || review.pending) return; setSelected(id); setCreating(false); setName(characters.find(c => c.id === id)?.name ?? ''); setImages([]); setModel(''); setLookId(''); send(state, 'preview', { characterId: id }); };
  return <div className="characters-settings">
    <div className="character-picker"><select aria-label="选择人物" value={creating ? '' : selected} disabled={dirty || libraryDirty || !!review.pending} onChange={e => changeCharacter(e.target.value)}><option value="" disabled>新人物</option>{characters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select><button disabled={!state.writable || dirty || libraryDirty || !!review.pending} onClick={() => { setCreationIds(characters.map(c => c.id)); setCreating(true); setName(''); }}>＋新建人物</button></div>
    <fieldset disabled={!state.writable || !!review.pending}>
      <label>人物名字<input aria-label="人物名字" value={name} onChange={e => setName(e.target.value)} placeholder="角色在对话中的名字" /></label>
      {review.conflict && <p className="notice">人物源码已更新，请还原草稿后重试。</p>}
      <div className="actions"><button className="primary" disabled={!dirty || !name.trim() || review.conflict} onClick={() => review.setPending(send({ ...state, revision: review.base }, 'character', { ...(creating ? {} : { id: selected }), name }))}>{creating ? '创建人物' : '保存名字'}</button><button onClick={() => { review.reload(); setImages([]); setModel(''); setLookId(''); }}>还原编辑</button></div>
      {!creating && selectedCharacter && <>
        <h3>立绘与 Live2D 外观 <small>{looks.length} 个</small></h3>
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
