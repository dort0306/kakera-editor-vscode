import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { EditorState } from '../../protocol/src/index';
import type { Expr, Frame, Route, Story, Update, Variable } from '../../domain/src/index';
import { ProjectSettings } from './project-settings';
import { StoryGraphView } from './story-graph';
import { ImageTools } from './image-tools';
import { Condition, ConditionalTargets } from './conditions';
import { UiEditor } from './ui-editor';
import { LifecycleEditor } from './lifecycle-editor';
import { Icon } from './icons';
import { routeDestinations, storyEntries } from '../../domain/src/index';
declare function acquireVsCodeApi(): { postMessage: (message: unknown) => void };
const host = acquireVsCodeApi();
const command = (name: string, characterId?: string) => host.postMessage({ type: 'command', command: name, ...(characterId ? { characterId } : {}) });
function send(state: EditorState, type: string, payload: Record<string, unknown> = {}) { const requestId = crypto.randomUUID(); host.postMessage({ version: 1, requestId, revision: state.revision, type, payload }); return requestId; }
function Select({ value, onChange, items, empty = '无' }: { value: string; onChange: (value: string) => void; items: { id: string; name?: string }[]; empty?: string }) {
  return <select value={value} onChange={e => onChange(e.target.value)}><option value="">{empty}</option>{items.map(i => <option key={i.id} value={i.id}>{i.name || i.id}</option>)}</select>;
}
function Updates({ value, change, story }: { value: Update[]; change: (u: Update[]) => void; story: Story }) {
  return <div>{value.map((u, i) => <div className="update" key={i}><span>{i + 1}</span><Select value={u.variable} items={story.variables} onChange={id => { const v = story.variables.find(v => v.id === id); if (v) change(value.map((item, at) => at === i ? { op: 'set', variable: id, value: { kind: 'constant', type: v.type, value: v.initial } } : item)); }} /><select value={u.op} onChange={e => change(value.map((item, at) => at === i ? { ...item, op: e.target.value as 'set' | 'add' } : item))}><option value="set">赋值</option>{story.variables.find(v => v.id === u.variable)?.type === 'int' && <option value="add">加减</option>}</select>{u.value.kind === 'constant' ? <input aria-label="更新值" value={u.value.value} onChange={e => change(value.map((item, at) => at === i ? { ...item, value: { ...u.value, value: e.target.value } as Expr } : item))} /> : <span>表达式（源码中编辑）</span>}<button onClick={() => change(value.filter((_, at) => at !== i))}>移除</button></div>)}<button disabled={!story.variables.length} onClick={() => { const v = story.variables[0]; change([...value, { op: 'set', variable: v.id, value: { kind: 'constant', type: v.type, value: v.initial } }]); }}>＋变量更新</button></div>;
}
function Editor({ frame, state, onDirty }: { frame: Frame; state: EditorState; onDirty: (value: boolean) => void }) {
  const story = state.story!, entryRefs = storyEntries(story);
  const routeEditable = state.logic ? state.logic.frames[frame.ref]?.editable === true : !!state.routes;
  const changeEntries = (refs: string[]) => setPending(send({ ...state, revision: base }, 'entry', { refs }));
  const [draft, setDraft] = useState(frame), [base, setBase] = useState(state.revision), [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState('');
  const [nextRef, setNextRef] = useState(frame.ref);
  const [lifecycleDirty, setLifecycleDirty] = useState(false);
  useEffect(() => { onDirty(dirty || !!pending || lifecycleDirty); }, [dirty, pending, lifecycleDirty]);
  const owned = () => state.routes?.filter(r => r.frame === frame.ref) ?? [];
  const [routes, setRoutes] = useState<Route[]>(owned), [visual, setVisual] = useState(false);
  const preset = story.visuals.find(v => v.id === frame.visual);
  const [background, setBackground] = useState(preset?.background ?? ''), [portraits, setPortraits] = useState(preset?.portraits ?? []), [cg, setCg] = useState(preset?.cg ?? '');
  const mark = (patch: Partial<Frame>) => { setDirty(true); setDraft({ ...draft, ...patch }); };
  const routeChange = (next: Route[]) => { setDirty(true); setRoutes(next); };
  const reload = () => { setDraft(frame); setRoutes(owned()); setBase(state.revision); setDirty(false); setBackground(preset?.background ?? ''); setPortraits(preset?.portraits ?? []); setCg(preset?.cg ?? ''); };
  useEffect(() => { if (!dirty && state.revision !== base) reload(); }, [state.revision]);
  useEffect(() => { const selected = story.visuals.find(v => v.id === draft.visual); setBackground(selected?.background ?? ''); setPortraits(selected?.portraits ?? []); setCg(selected?.cg ?? ''); }, [draft.visual, state.revision]);
  useEffect(() => { if (pending && state.appliedRequestId === pending) { reload(); setPending(''); } }, [state.appliedRequestId]);
  useEffect(() => { const listener = (event: MessageEvent) => { if ((event.data.type === 'error' || event.data.type === 'settled') && event.data.requestId === pending) setPending(''); }; window.addEventListener('message', listener); return () => window.removeEventListener('message', listener); }, [pending]);
  const conflict = dirty && base !== state.revision;
  const targetItems = story.frames.filter(f => !f.pending).map(f => ({ id: f.ref, name: f.text.slice(0, 32) }));
  const images = story.assets.filter(a => a.kind === 'image');
  const cgs = story.assets.filter(a => a.kind === 'cg');
  const audio = story.assets.filter(a => a.kind === 'audio');
  const changeKind = (kind: Route['kind']) => {
    const next = kind === 'choice' ? [{ id: 'choice1', text: '新的选择' }] : [];
    mark({ options: next });
    routeChange(kind === 'choice' ? [{ frame: frame.ref, kind, option: 'choice1', target: '', updates: [] }] : [{ frame: frame.ref, kind, ...(kind === 'advance' ? { target: '' } : {}), updates: [] }]);
  };
  const routeLabel = routes.length ? routes[0].kind === 'choice' ? '选择幕' : routes[0].kind === 'end' ? '结束幕' : '推进幕' : '脚本路线';
  return <section className="properties inspector-panel">
    <header className="inspector-head">
      <div><span className="panel-kicker">SCENE / {frame.ref}</span><h2>当前幕</h2><p className="muted mono">{frame.file}:{frame.line}</p></div>
      <div className="inspector-head-actions"><span className="badge accent">{routeLabel}</span><button className="ghost compact" onClick={() => send(state, 'source', { ref: frame.ref })}><Icon name="code" size={14} />查看源码</button></div>
    </header>
    <div className="inspector-scroll">
      {conflict && <div className="notice banner">源文件已更新。你的草稿保留在这里，请复制需要的内容后重新载入。<button className="ghost compact" onClick={reload}>载入最新源码</button></div>}
      <fieldset disabled={!state.writable || !!pending || lifecycleDirty}>
        <div className="inspector-section">
          <div className="section-label"><span>故事起点</span><span className="badge">{entryRefs.length} 个</span></div>
          <div className="entry-list">{entryRefs.map(ref => <span className="entry-chip" key={ref}>{story.frames.find(f => f.ref === ref)?.name || ref}<button aria-label={`移除起始幕 ${ref}`} disabled={entryRefs.length <= 1 || !!pending} onClick={() => changeEntries(entryRefs.filter(entry => entry !== ref))}>×</button></span>)}</div>
          <div className="actions"><button className="subtle" disabled={entryRefs.includes(frame.ref) || !!pending} onClick={() => changeEntries([...entryRefs, frame.ref])}><Icon name="flag" size={14} />加入起始幕</button><button className="subtle" disabled={entryRefs.length === 1 && entryRefs[0] === frame.ref || !!pending} onClick={() => changeEntries([frame.ref])}>设为唯一入口</button></div>
          <p className="muted">可声明多个起始幕；播放器启动后先显示初始 UI，不会自动进入第一个。主菜单/UI 事件用 <code>ctx.restart("幕")</code> 或 <code>ctx.resume("幕")</code> 显式选择；至少保留一个。</p>
        </div>
        <div className="inspector-section">
          <div className="section-label"><span>幕标识</span><span className="muted">ID / 引用名</span></div>
          <label>幕 ID<input aria-label="幕 ID" value={nextRef} maxLength={200} spellCheck={false} onChange={e => setNextRef(e.target.value)} /></label>
          <div className="actions"><button className="subtle" disabled={!nextRef.trim() || nextRef.trim() === frame.ref || !!pending || dirty || conflict} onClick={() => setPending(send({ ...state, revision: base }, 'rename', { ref: frame.ref, next: nextRef.trim() }))}>重命名幕</button></div>
          <p className="muted">会同步更新故事入口和已识别的推进/选项目标。存在动态路线或 `ctx.resume`/生命周期引用时会拒绝，避免留下悬空目标。</p>
        </div>
        <div className="inspector-section">
          <div className="section-label"><span>台词与人物</span><span className="muted">{draft.text.length} 字</span></div>
          <label>台词<textarea rows={5} value={draft.text} onChange={e => mark({ text: e.target.value })} /></label>
          <div className="field-grid two"><label>说话人<Select value={draft.speaker} items={story.characters} empty="旁白（无角色）" onChange={speaker => mark({ speaker })} /></label><label>完整画面<Select value={draft.visual} items={story.visuals} empty="空画面" onChange={v => mark({ visual: v })} /></label></div>
          <div className="audio-grid">{['bgm', 'voice', 'se'].map((field, i) => <label key={field}>{['背景音乐', '语音', '音效'][i]}<Select value={draft.audio[field] ?? ''} items={audio} empty="停止 / 静音" onChange={value => mark({ audio: { ...draft.audio, [field]: value } })} /></label>)}</div>
        </div>
        <div className="inspector-section">
          <div className="section-label"><span>剧情路由</span><span className="badge">{routeLabel}</span></div>
          {routeEditable ? <><select aria-label="剧情路由类型" value={routes[0]?.kind ?? 'end'} onChange={e => changeKind(e.target.value as Route['kind'])}><option value="advance">推进到下一幕</option><option value="choice">显示选择</option><option value="end">结束</option></select>
            {routes.map((route, index) => <div className="route" key={index}>
              {route.kind === 'choice' && <label>选项文字<input value={draft.options.find(o => o.id === route.option)?.text ?? ''} onChange={e => mark({ options: draft.options.map(o => o.id === route.option ? { ...o, text: e.target.value } : o) })} /></label>}
              {route.kind !== 'end' && <ConditionalTargets route={route} story={story} change={next => routeChange(routes.map((r, at) => at === index ? next : r))} />}
              {route.kind === 'choice' && <><label>选项显示条件</label><Condition optional story={story} value={route.guard} change={guard => routeChange(routes.map((r, at) => at === index ? { ...r, guard } : r))} /></>}
              {route.kind !== 'end' && <Updates story={story} value={route.updates} change={updates => routeChange(routes.map((r, at) => at === index ? { ...r, updates } : r))} />}
              {route.kind === 'choice' && routes.length > 1 && <button className="subtle danger-ghost" onClick={() => { mark({ options: draft.options.filter(o => o.id !== route.option) }); routeChange(routes.filter((_, i) => i !== index)); }}><Icon name="trash" size={13} />移除此选项</button>}
            </div>)}
            {routes[0]?.kind === 'choice' && <button className="subtle" onClick={() => { const id = `choice.${crypto.randomUUID()}`; mark({ options: [...draft.options, { id, text: '新的选择' }] }); routeChange([...routes, { frame: frame.ref, kind: 'choice', option: id, target: '', updates: [] }]); }}><Icon name="plus" size={13} />＋添加选项</button>}
          </> : <p className="notice">此幕路线由脚本控制：{state.logic?.frames[frame.ref]?.reason ?? '尚未识别到固定注册'}。已知目标显示在分支图中，仍可保存台词、人物与画面。</p>}
          {!!state.logic?.frames[frame.ref]?.locations.length && <button className="subtle" onClick={() => send(state, 'source', { ref: frame.ref, logic: true })}><Icon name="code" size={13} />查看此幕逻辑</button>}
        </div>
        <div className="inspector-section">
          <div className="section-label"><span>画面</span><span className="muted">完整背景与三槽立绘</span></div>
          <details open={visual} onToggle={e => setVisual(e.currentTarget.open)}><summary>为此幕创建独立画面</summary><p className="muted">保存完整背景与三槽立绘，或选择专用 CG；CG 画面不能同时有背景或人物。已有共享画面保持原样。</p>
            <label>CG 专用画面<Select value={cg} items={cgs} empty="不使用 CG" onChange={value => { setCg(value); if (value) { setBackground(''); setPortraits([]); } }} /></label>
            {cg ? <p className="notice">当前使用 CG 资源 {cg}：运行帧显示完整图片，不叠加人物；请在 game.enter 中按需解锁。</p> : <>
              <label>背景<Select value={background} items={images} empty="无背景" onChange={setBackground} /></label>
              {['left', 'center', 'right'].map(slot => { const portrait = portraits.find(p => p.slot === slot); return <div className="portrait" key={slot}><label>{({ left: '左侧', center: '中间', right: '右侧' })[slot]}立绘<Select value={portrait?.image ?? ''} items={images} onChange={image => { const rest = portraits.filter(p => p.slot !== slot); setPortraits(image ? [...rest, { ...portrait, slot, image, character: portrait?.character || story.characters[0]?.id || '' }] : rest); }} /></label>{portrait && <Select value={portrait.character} items={story.characters} empty="选择人物" onChange={character => setPortraits(portraits.map(p => p.slot === slot ? { ...p, character } : p))} />}</div>; })}
            </>}
            <button className="subtle" disabled={dirty || conflict} onClick={() => setPending(send(state, 'visual', { ref: frame.ref, background: cg ? '' : background, portraits: cg ? [] : portraits, cg }))}><Icon name="image" size={14} />保存此幕画面</button>
          </details>
        </div>
      </fieldset>
      <LifecycleEditor key={frame.ref} state={state} kind="frameExit" owner={frame.ref} disabled={dirty || !!pending} onDirty={setLifecycleDirty} save={(operation, revision) => send({ ...state, revision }, 'uiEdit', { operation })}/>
    </div>
    <div className="inspector-savebar"><div className="actions"><button className="primary" disabled={!dirty || conflict || !!pending} onClick={() => { setPending(send({ ...state, revision: base }, 'patch', { ref: frame.ref, patch: { text: draft.text, speaker: draft.speaker, visual: draft.visual, audio: draft.audio, ...(routeEditable ? { options: draft.options } : {}) }, ...(routeEditable ? { routes } : {}) })); }}>{pending ? '正在保存…' : '保存幕'}</button><button className="subtle" disabled={!!pending} onClick={reload}><Icon name="undo" size={14} />还原编辑</button></div></div>
  </section>;
}
function Home() {
  const cards: [string, React.ReactNode, string, string][] = [
    ['kakera.storyboard.open', <Icon name="film" size={20} />, '可视分镜', '台词、构图与明确分支'],
    ['kakera.ui.open', <Icon name="layout" size={20} />, 'UI 编辑器', '页面、控件与可视布局'],
    ['kakera.tools.configure', <Icon name="wrench" size={20} />, '准备工具', '配置 v0.9.1 播放器和打包器'],
    ['kakera.ai.configure', <Icon name="sparkles" size={20} />, '可选 AI', '用户配置的服务，原文先审阅'],
    ['kakera.debug.start', <Icon name="bug" size={20} />, '真实试玩', '帧级断点和只读运行状态']
  ];
  return <main className="home">
    <div className="home-atmosphere" aria-hidden="true"><i /><i /><i /></div>
    <section className="home-hero">
      <div className="home-brand"><span className="brand-mark">K</span><span>KAKERA</span></div>
      <span className="eyebrow">VISUAL STORY WORKBENCH</span>
      <h1>让每一幕，<br /><em>成为故事的起点。</em></h1>
      <p className="home-lede">一格一幕，保留 XML / JS。先写下台词和选择，再走进真实的故事。</p>
      <div className="home-actions"><button className="primary large" onClick={() => command('kakera.project.create')}><Icon name="plus" />新建游戏工程</button><button className="large" onClick={() => command('kakera.project.open')}><Icon name="book" />打开已有工程</button></div>
      <div className="home-pills"><span><Icon name="lock" size={13} />本地桌面</span><span><Icon name="code" size={13} />XML / JS 源码</span><span><Icon name="check" size={13} />真实引擎校验</span></div>
    </section>
    <section className="home-panel" aria-label="快速开始">
      <div className="home-panel-head"><div><span className="eyebrow">QUICK START</span><h2>从哪里开始？</h2></div><span className="status-pill"><span className="status-dot" />就绪</span></div>
      <div className="home-grid">{cards.map(([id, icon, title, text], index) => <button className="home-card" key={id} onClick={() => command(id)}>
        <span className="home-card-icon">{icon}</span>
        <span className="home-card-copy"><strong>{title}</strong><small>{text}</small></span>
        <span className="home-card-index">{String(index + 1).padStart(2, '0')}</span>
        <Icon name="chevron" size={15} className="home-card-arrow" />
      </button>)}</div>
      <p className="muted home-footnote">Windows 本地桌面 · AI 未配置也可创作 · 调试不提供 JS 行级步进</p>
    </section>
  </main>;
}
function Variables({ state }: { state: EditorState }) {
  const [id, setId] = useState(''), [type, setType] = useState('int'), [value, setValue] = useState('0'), [min, setMin] = useState(''), [max, setMax] = useState(''), [original, setOriginal] = useState('');
  const editing = !!original;
  const reset = () => { setOriginal(''); setId(''); setType('int'); setValue('0'); setMin(''); setMax(''); };
  const begin = (v: Variable) => { setOriginal(v.id); setId(v.id); setType(v.type); setValue(v.initial); setMin(v.min ?? ''); setMax(v.max ?? ''); };
  const save = () => send(state, 'variable', { ...(editing ? { original } : {}), id, valueType: type, initial: value, min: type === 'int' ? min : undefined, max: type === 'int' ? max : undefined });
  return <details className="variables rail-card"><summary><span><Icon name="layers" size={15} />变量 · {state.story!.variables.length}</span><Icon name="chevron" size={14} className="summary-chevron" /></summary><div className="rail-card-body">
    {state.story!.variables.map(v => <div className="variable-row" key={v.id}><code>{v.id}</code><span className="badge">{v.type}</span><span className="variable-value">{v.initial}{v.min !== undefined ? ` · ${v.min}…${v.max ?? '∞'}` : ''}</span><div className="variable-actions"><button className="subtle" disabled={!state.writable} title="修改变量初始值和范围；ID/类型固定" onClick={() => begin(v)}>编辑</button><button className="subtle danger-ghost" disabled={!state.writable} title="删除变量前需解除路线引用" onClick={() => send(state, 'deleteVariable', { id: v.id })}>删除</button></div></div>)}
    {!state.story!.variables.length && <p className="muted">还没有变量。创建后可做条件分流与更新。</p>}
    <div className="variable-form"><div className="variable-form-head">{editing ? `编辑 ${original}` : '新增变量'}{editing && <span>ID/类型创建后固定</span>}</div><input placeholder="变量名" aria-label="变量名" value={id} disabled={editing} onChange={e => setId(e.target.value)} /><select aria-label="变量类型" value={type} disabled={editing} onChange={e => { setType(e.target.value); setValue(e.target.value === 'bool' ? 'false' : e.target.value === 'int' ? '0' : ''); }}><option>int</option><option>bool</option><option>string</option></select><input aria-label="变量初始值" value={value} onChange={e => setValue(e.target.value)} />{type === 'int' && <><input aria-label="变量下限（可留空）" placeholder="下限" value={min} onChange={e => setMin(e.target.value)} /><input aria-label="变量上限（可留空）" placeholder="上限" value={max} onChange={e => setMax(e.target.value)} /></>}<div className="update"><button className="primary" disabled={!id || !state.writable} onClick={save}>{editing ? '保存变量' : <><Icon name="plus" size={14} />添加</>}</button>{editing && <button className="subtle" disabled={!state.writable} onClick={reset}>取消</button>}</div></div>
  </div></details>;
}
export function App() {
  const [state, setState] = useState<EditorState>(), [selected, setSelected] = useState(''), [error, setError] = useState(''), [query, setQuery] = useState(''), [offset, setOffset] = useState(0);
  const [draftDirty, setDraftDirty] = useState(false);
  const [uiMode, setUiMode] = useState(false), [uiDirty, setUiDirty] = useState(false);
  useEffect(() => { if (state?.view) setUiMode(state.view === 'ui'); }, [state?.view]);
  const [assetDirty, setAssetDirty] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false), [view, setView] = useState<'branches' | 'files'>('branches');
  const [structural, setStructural] = useState('');
  const [drawer, setDrawer] = useState<'settings' | 'images' | null>(null);
  useEffect(() => {
    if (!drawer) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setDrawer(null); };
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', close);
    return () => { window.removeEventListener('keydown', close); document.body.style.overflow = previous; };
  }, [drawer]);
  useEffect(() => { if (state?.selected) { setSelected(state.selected); setQuery(''); } }, [state?.selected, state?.appliedRequestId]);
  useEffect(() => {
    const listener = (event: MessageEvent) => { if (event.data.type === 'state') { setState(event.data.state); setError(''); } else if (event.data.type === 'error') { setError(event.data.message); setStructural(''); } else if (event.data.type === 'settled') setStructural(''); };
    window.addEventListener('message', listener); host.postMessage({ version: 1, requestId: crypto.randomUUID(), revision: '', type: 'ready', payload: {} }); return () => window.removeEventListener('message', listener);
  }, []);
  if (!state) return <Home />;
  if (!state.story) return <main><h1>工程暂时无法解析</h1>{state.issues.map((i, n) => <p key={n}>{i}</p>)}<p>请用普通源码编辑器修复。修复后分镜会自动刷新。</p></main>;
  if (uiMode) return <UiEditor state={state} send={send} onDirty={setUiDirty} onBack={() => { if (uiDirty) return; setUiMode(false); send(state, 'preview', { view: 'story' }); }} />;
  const frames = state.story.frames.filter(f => !f.pending), frame = frames.find(f => f.ref === selected) ?? frames[0], visual = state.story.visuals.find(v => v.id === frame?.visual);
  const filtered = frames.filter(f => !query || f.text.includes(query) || f.ref.includes(query));
  const visible = filtered.slice(offset, offset + 50);
  const selectFrame = (ref: string) => { if ((draftDirty || settingsDirty || assetDirty || structural) && ref !== frame?.ref) { setError('请先保存或还原当前编辑，再切换幕。'); return; } setSelected(ref); send(state, 'preview', { ref }); };
  const ownedRoutes = state.routes?.filter(r => r.frame === frame?.ref) ?? [];
  const hasOpenTarget = ownedRoutes.flatMap(routeDestinations).some(d => !d.target || state.story!.frames.some(f => f.pending && (f.ref === d.target || f.id === d.target)));
  const canInsert = !frame?.options.length && !ownedRoutes.some(r => r.branches?.length) || hasOpenTarget;
  const locked = !state.writable || draftDirty || settingsDirty || assetDirty || !!structural;
  const routeEditable = !!frame && (state.logic ? state.logic.frames[frame.ref]?.editable === true : !!state.routes);
  const move = (delta: number) => { if (!frame) return; const local = frames.filter(f => f.file === frame.file).map(f => f.ref), index = local.indexOf(frame.ref), to = index + delta; if (to < 0 || to >= local.length) return; [local[index], local[to]] = [local[to], local[index]]; send(state, 'reorder', { ref: frame.ref, refs: local }); };
  const routeKind = state.routes?.find(r => r.frame === frame?.ref)?.kind;
  return <main className="workspace app-shell">
    <header className="app-bar">
      <div className="app-brand">
        <span className="brand-mark">K</span>
        <div className="app-brand-copy"><span className="eyebrow">KAKERA / {state.story.id}</span><h1>{state.title?.text ?? '故事工作台'}</h1></div>
      </div>
      <div className="app-actions" role="toolbar" aria-label="工程操作">
        <div className="action-group">
          <button className="tool-button accent-ghost" disabled={draftDirty || settingsDirty || assetDirty || !!structural} onClick={() => { setUiMode(true); send(state, 'preview', { view: 'ui' }); }}><Icon name="layout" />UI 编辑器</button>
          <button className="tool-button" onClick={() => command('kakera.validate')}><Icon name="check" />校验</button>
          <button className="tool-button" onClick={() => command('kakera.playtest.start')}><Icon name="play" />试玩</button>
          <button className="tool-button subtle" onClick={() => command('kakera.playtest.stop')}><Icon name="stop" />停止</button>
        </div>
        <div className="action-group">
          <button className="tool-button" aria-expanded={drawer === 'settings'} onClick={() => setDrawer('settings')}><Icon name="settings" />工程</button>
          <button className="tool-button" aria-expanded={drawer === 'images'} onClick={() => setDrawer('images')}><Icon name="image" />图片</button>
          <button className="tool-button" onClick={() => command('kakera.asset.import')}><Icon name="plus" />导入</button>
          <button className="tool-button" title="导入 CG 专用资源" onClick={() => command('kakera.asset.importCg')}><Icon name="image" />导入 CG</button>
        </div>
        <div className="action-group">
          <button className="tool-button" onClick={() => command('kakera.debug.start')}><Icon name="bug" />调试</button>
          <button className="tool-button" onClick={() => command('kakera.build.run')}><Icon name="package" />构建</button>
          <button className="icon-button" aria-label="刷新" title="刷新" onClick={() => send(state, 'ready')}><Icon name="refresh" /></button>
        </div>
      </div>
    </header>

    <div className="workspace-alerts">
      {!state.writable && <div className="notice banner"><Icon name="lock" />当前为只读模式。编辑与运行需要 Windows 本地桌面受信任工作区。</div>}
      {error && <div role="alert" className="error banner">{error}<button className="ghost compact" onClick={() => setError('')}>关闭</button></div>}
      {state.story.assets.some(a => a.kind === 'live2d') && state.live2dMode === 'fallback' && <p className="notice banner"><Icon name="alert" />Live2D 当前使用静态回退进行校验和试玩。配置受信任的 Cubism Core 后可验证真实模型。</p>}
    </div>

    <div className="workbench">
      <aside className="project-rail" aria-label="工程概览">
        <section className="rail-card project-card">
          <div className="rail-card-title"><Icon name="book" size={15} /><h2>工程</h2><span className={`status-pill ${state.writable ? '' : 'warn'}`}><span className="status-dot" />{state.writable ? '可编辑' : '只读'}</span></div>
          <strong className="project-name">{state.title?.text ?? '故事工作台'}</strong>
          <p className="muted mono">{state.story.id}</p>
          <div className="metric-grid"><div><strong>{frames.length}</strong><span>幕</span></div><div><strong>{state.story.assets.length}</strong><span>资源</span></div><div><strong>{state.story.variables.length}</strong><span>变量</span></div></div>
          <div className="rail-actions"><button className="subtle" onClick={() => setDrawer('settings')}><Icon name="settings" size={14} />工程设置</button><button className="subtle" onClick={() => setDrawer('images')}><Icon name="image" size={14} />图片工具</button></div>
        </section>
        <Variables state={state} />
        <details className="issues rail-card"><summary><span><Icon name="alert" size={15} />注意事项 · {state.issues.length}</span><Icon name="chevron" size={14} className="summary-chevron" /></summary><div className="rail-card-body">{state.issues.length ? state.issues.map((i, n) => <p key={n}>{i}</p>) : <p className="muted">当前没有需要处理的问题。</p>}</div></details>
        <section className="rail-card rail-hint"><span className="eyebrow">TIP</span><p>拖动幕卡调整布局，拖出右侧连接点即可重新连线。Alt + 方向键可微调位置。</p></section>
      </aside>

      <section className="story-column">
        <section className="panel stage-panel">
          <div className="panel-head">
            <div className="panel-title"><span className="panel-kicker">STAGE</span><h2>舞台预览</h2></div>
            <div className="stage-meta"><span className="badge">{visual?.cg ? 'CG 专用画面' : visual ? '完整画面' : '空画面'}</span><span className="pill">{Math.max(0, frames.indexOf(frame!)) + 1} / {frames.length}</span></div>
          </div>
          <div className="stage-frame"><div className="stage" aria-label="静态构图预览">
            {(visual?.cg || visual?.background) && state.images[(visual.cg || visual.background)!] && <img className="background" src={state.images[(visual.cg || visual.background)!]} alt={visual.cg ? 'CG 画面' : '背景'} />}
            {!visual?.cg && visual?.portraits.map(p => state.images[p.image] && <img key={p.slot} className={`actor ${p.slot}`} src={state.images[p.image]} alt={p.character} />)}
            <div className="stage-grid" aria-hidden="true" />
            <div className="stage-label"><Icon name="film" size={12} />静态构图 · 精确效果请用播放器试玩</div>
            <div className="dialogue"><strong>{state.story.characters.find(c => c.id === frame?.speaker)?.name ?? '旁白'}</strong><p>{frame?.text ?? '暂无幕'}</p></div>
          </div></div>
          <div className="stage-foot"><span className="mono muted">{frame?.file}:{frame?.line}</span><span className="badge">{frame?.ref}</span><span className="muted">16:9 · 静态预览</span></div>
        </section>

        <section className="panel story-panel">
          <div className="panel-head story-head">
            <div className="panel-title"><span className="panel-kicker">STORYBOARD</span><h2>分镜</h2></div>
            <div className="view-tabs"><button aria-pressed={view === 'branches'} onClick={() => setView('branches')}><Icon name="layout" size={14} />分支视图</button><button aria-pressed={view === 'files'} onClick={() => setView('files')}><Icon name="film" size={14} />文件顺序</button></div>
            <label className="search-box"><Icon name="search" size={14} /><input aria-label="搜索分镜" placeholder="搜索台词或幕 ID" value={query} onChange={e => { setQuery(e.target.value); setOffset(0); }} /></label>
          </div>
          <div className="frame-tools">
            <button className="subtle" disabled={locked || !routeEditable || !canInsert} onClick={() => setStructural(send(state, 'insert', { ref: frame!.ref }))}><Icon name="plus" size={14} />＋新增幕</button>
            <button className="subtle" disabled={locked || !routeEditable} onClick={() => setStructural(send(state, 'duplicate', { ref: frame!.ref }))}><Icon name="copy" size={14} />复制幕</button>
            <button className="subtle danger-ghost" disabled={locked || !routeEditable || state.logic?.complete === false || frames.length <= 1} onClick={() => setStructural(send(state, 'delete', { ref: frame!.ref }))}><Icon name="trash" size={14} />删除幕</button>
            <button className="subtle" disabled={locked || !frame} onClick={() => setStructural(send(state, 'entry', { refs: [frame.ref] }))}><Icon name="flag" size={14} />设为唯一入口</button>
            {view === 'files' && <><button className="subtle" disabled={locked || !frame} onClick={() => move(-1)}>前移</button><button className="subtle" disabled={locked || !frame} onClick={() => move(1)}>后移</button></>}
            {structural && <span className="saving-status"><span className="spinner" />正在保存…</span>}
          </div>
          <div className="story-meta-row">
            {state.logic && <p className="sync-state" role="status"><span className="status-dot" /><span>JS / XML 实时同步 · {Object.values(state.logic.frames).filter(f => f.editable).length} / {state.story.frames.length} 幕路线可编辑{!state.logic.complete ? ' · 自定义路线保留原文；删除幕需先明确所有入边' : ''}</span></p>}
            <span className="muted">{filtered.length} 幕匹配</span>
          </div>
          <div className="story-notes">
            {frame?.options.length && !canInsert ? <p className="muted">此幕的选项都已连接。可先添加选项，或点击分支上的幕继续新增。</p> : null}
            {!frame?.options.length && !canInsert && <p className="muted">条件线路都已连接。可先添加条件线路，或点击线路上的幕继续新增。</p>}
            {(draftDirty || settingsDirty) && <p className="muted">保存当前编辑后，即可继续新建或删除幕。</p>}
          </div>
          <div className="story-view">
            {view === 'branches' ? <StoryGraphView story={state.story} routes={state.logic?.links ?? state.routes} selected={frame?.ref} query={query} select={selectFrame} layout={state.layout} disabled={locked} onExport={() => setStructural(send(state, 'graphExport'))} editable={ref => state.logic ? state.logic.frames[ref]?.editable === true : !!state.routes} onLayout={(ref, point) => setStructural(send(state, 'layout', ref && point ? { ref, ...point } : { reset: true }))} onReconnect={(ref, target, option, branch) => setStructural(send(state, 'reconnect', { ref, target, option, branch }))}/> : <><p className="muted">排序只改变组织顺序，不修改剧情路线。</p><div className="frames">{visible.map(f => <button className={`frame ${frame?.ref === f.ref ? 'selected' : ''}`} key={f.ref} onClick={() => selectFrame(f.ref)}><span className="frame-top">{String(frames.indexOf(f) + 1).padStart(2, '0')} <small>{state.routes?.find(r => r.frame === f.ref)?.kind === 'choice' ? '选择' : state.routes?.find(r => r.frame === f.ref)?.kind === 'end' ? '结束' : state.logic && !state.logic.frames[f.ref]?.editable ? '脚本路线' : state.routes ? '推进' : '高级逻辑'}</small></span><p>{f.text}</p><span className="muted">{f.ref.slice(0, 12)}</span></button>)}</div>{filtered.length > 50 && <div className="pager"><button className="subtle" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 50))}>上一批</button><span>{offset + 1}–{Math.min(offset + 50, filtered.length)} / {filtered.length}</span><button className="subtle" disabled={offset + 50 >= filtered.length} onClick={() => setOffset(offset + 50)}>下一批</button></div>}</>}
          </div>
        </section>
      </section>

      {frame && <Editor key={frame.ref} frame={frame} state={assetDirty ? { ...state, writable: false } : state} onDirty={setDraftDirty} />}
    </div>

    <footer className="status-bar">
      <span className={`status-item ${state.writable ? 'ok' : 'warn'}`}><span className="status-dot" />{state.writable ? '可编辑' : '只读'}</span>
      <span className="status-item"><Icon name="film" size={13} />{frames.length} 幕</span>
      <span className="status-item"><Icon name="layers" size={13} />{state.story.variables.length} 变量</span>
      <span className="status-item"><Icon name="alert" size={13} />{state.issues.length} 条提示</span>
      <span className="status-spacer" />
      <span className="status-item">{routeKind === 'end' ? '结束幕' : routeKind === 'choice' ? '选择幕' : routeKind ? '推进幕' : '脚本路线'}</span>
      <span className="status-item"><Icon name="check" size={13} />Kakera v0.9.1</span>
    </footer>

    <div className={`drawer-scrim ${drawer ? 'open' : ''}`} onClick={() => setDrawer(null)} aria-hidden="true" />
    <aside className={`side-drawer ${drawer === 'settings' ? 'open' : ''}`} role="dialog" aria-modal={drawer === 'settings' ? 'true' : undefined} aria-hidden={drawer !== 'settings'} aria-label="工程设置">
      <div className="drawer-head"><div><span className="eyebrow">PROJECT</span><h2>工程设置</h2></div><button className="icon-button" aria-label="关闭工程设置" onClick={() => setDrawer(null)}>×</button></div>
      <div className="drawer-body"><ProjectSettings state={assetDirty ? { ...state, writable: false } : state} send={send} command={command} currentFrame={frame?.ref} onDirty={setSettingsDirty} /></div>
    </aside>
    <aside className={`side-drawer wide ${drawer === 'images' ? 'open' : ''}`} role="dialog" aria-modal={drawer === 'images' ? 'true' : undefined} aria-hidden={drawer !== 'images'} aria-label="图片工具">
      <div className="drawer-head"><div><span className="eyebrow">ASSETS</span><h2>图片工具</h2></div><button className="icon-button" aria-label="关闭图片工具" onClick={() => setDrawer(null)}>×</button></div>
      <div className="drawer-body"><ImageTools state={state} send={send} blocked={draftDirty || settingsDirty || !!structural} onDirty={setAssetDirty} /></div>
    </aside>
  </main>;
}
const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
