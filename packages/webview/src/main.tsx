import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { EditorState } from '../../protocol/src/index';
import type { Expr, Frame, Route, Story, Update } from '../../domain/src/index';
declare function acquireVsCodeApi(): { postMessage: (message: unknown) => void };
const host = acquireVsCodeApi();
const command = (name: string) => host.postMessage({ type: 'command', command: name });
function send(state: EditorState, type: string, payload: Record<string, unknown> = {}) { const requestId = crypto.randomUUID(); host.postMessage({ version: 1, requestId, revision: state.revision, type, payload }); return requestId; }
function Select({ value, onChange, items, empty = '无' }: { value: string; onChange: (value: string) => void; items: { id: string; name?: string }[]; empty?: string }) {
  return <select value={value} onChange={e => onChange(e.target.value)}><option value="">{empty}</option>{items.map(i => <option key={i.id} value={i.id}>{i.name || i.id}</option>)}</select>;
}
function Condition({ value, change, story }: { value?: Expr; change: (e?: Expr) => void; story: Story }) {
  const compare = value?.kind === 'compare' && value.left.kind === 'variable' && value.right.kind === 'constant' ? value : undefined;
  const variableId = compare?.left.kind === 'variable' ? compare.left.id : undefined;
  const variable = story.variables.find(v => v.id === variableId);
  if (value && !compare) return <p>此条件包含组合表达式，请在源码模式查看。<button onClick={() => change()}>清除此条件</button></p>;
  return <div className="condition"><Select value={variable?.id ?? ''} empty="始终可见" items={story.variables} onChange={id => { const v = story.variables.find(v => v.id === id); change(v ? { kind: 'compare', op: '===', left: { kind: 'variable', id }, right: { kind: 'constant', type: v.type, value: v.initial } } : undefined); }} />{compare && variable && <><select value={compare.op} onChange={e => change({ ...compare, op: e.target.value as typeof compare.op })}>{(variable.type === 'int' ? ['===', '!==', '<', '<=', '>', '>='] : ['===', '!==']).map(op => <option key={op}>{op}</option>)}</select><input aria-label="条件比较值" value={compare.right.kind === 'constant' ? compare.right.value : ''} onChange={e => change({ ...compare, right: { kind: 'constant', type: variable.type, value: e.target.value } })} /></>}</div>;
}
function Updates({ value, change, story }: { value: Update[]; change: (u: Update[]) => void; story: Story }) {
  return <div>{value.map((u, i) => <div className="update" key={i}><span>{i + 1}</span><Select value={u.variable} items={story.variables} onChange={id => { const v = story.variables.find(v => v.id === id); if (v) change(value.map((item, at) => at === i ? { op: 'set', variable: id, value: { kind: 'constant', type: v.type, value: v.initial } } : item)); }} /><select value={u.op} onChange={e => change(value.map((item, at) => at === i ? { ...item, op: e.target.value as 'set' | 'add' } : item))}><option value="set">赋值</option>{story.variables.find(v => v.id === u.variable)?.type === 'int' && <option value="add">加减</option>}</select>{u.value.kind === 'constant' ? <input aria-label="更新值" value={u.value.value} onChange={e => change(value.map((item, at) => at === i ? { ...item, value: { ...u.value, value: e.target.value } as Expr } : item))} /> : <span>表达式（源码中编辑）</span>}<button onClick={() => change(value.filter((_, at) => at !== i))}>移除</button></div>)}<button disabled={!story.variables.length} onClick={() => { const v = story.variables[0]; change([...value, { op: 'set', variable: v.id, value: { kind: 'constant', type: v.type, value: v.initial } }]); }}>＋变量更新</button></div>;
}
function Editor({ frame, state, onDirty }: { frame: Frame; state: EditorState; onDirty: (value: boolean) => void }) {
  const story = state.story!;
  const [draft, setDraft] = useState(frame), [base, setBase] = useState(state.revision), [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState('');
  useEffect(() => { onDirty(dirty || !!pending); }, [dirty, pending]);
  const owned = () => state.routes?.filter(r => r.frame === frame.ref) ?? [];
  const [routes, setRoutes] = useState<Route[]>(owned), [visual, setVisual] = useState(false);
  const preset = story.visuals.find(v => v.id === frame.visual);
  const [background, setBackground] = useState(preset?.background ?? ''), [portraits, setPortraits] = useState(preset?.portraits ?? []);
  const mark = (patch: Partial<Frame>) => { setDirty(true); setDraft({ ...draft, ...patch }); };
  const routeChange = (next: Route[]) => { setDirty(true); setRoutes(next); };
  const reload = () => { setDraft(frame); setRoutes(owned()); setBase(state.revision); setDirty(false); setBackground(preset?.background ?? ''); setPortraits(preset?.portraits ?? []); };
  useEffect(() => { if (!dirty && state.revision !== base) reload(); }, [state.revision]);
  useEffect(() => { if (pending && state.appliedRequestId === pending) { reload(); setPending(''); } }, [state.appliedRequestId]);
  useEffect(() => { const listener = (event: MessageEvent) => { if ((event.data.type === 'error' || event.data.type === 'settled') && event.data.requestId === pending) setPending(''); }; window.addEventListener('message', listener); return () => window.removeEventListener('message', listener); }, [pending]);
  const conflict = dirty && base !== state.revision;
  const targetItems = story.frames.map(f => ({ id: f.ref, name: `${f.text.slice(0, 22)} · ${f.ref.slice(0, 8)}` }));
  const images = story.assets.filter(a => a.kind === 'image');
  const audio = story.assets.filter(a => a.kind === 'audio');
  const changeKind = (kind: Route['kind']) => {
    const next = kind === 'choice' ? [{ id: 'choice1', text: '新的选择' }] : [];
    mark({ options: next });
    routeChange(kind === 'choice' ? [{ frame: frame.ref, kind, option: 'choice1', target: frame.ref, updates: [] }] : [{ frame: frame.ref, kind, ...(kind === 'advance' ? { target: frame.ref } : {}), updates: [] }]);
  };
  return <section className="properties">
    <div className="section-title"><h2>当前幕</h2><button onClick={() => send(state, 'source', { ref: frame.ref })}>查看源码</button></div>
    <p className="muted">{frame.file}:{frame.line} · {frame.ref}</p>
    {conflict && <div className="notice">源文件已更新。你的草稿保留在这里，请复制需要的内容后重新载入。<button onClick={reload}>载入最新源码</button></div>}
    <fieldset disabled={!state.writable || !!pending}>
      <label>台词<textarea rows={5} value={draft.text} onChange={e => mark({ text: e.target.value })} /></label>
      <label>说话人<Select value={draft.speaker} items={story.characters} empty="旁白（无角色）" onChange={speaker => mark({ speaker })} /></label>
      <label>完整画面<Select value={draft.visual} items={story.visuals} empty="空画面" onChange={v => mark({ visual: v })} /></label>
      <div className="audio-grid">{['bgm', 'voice', 'se'].map((field, i) => <label key={field}>{['背景音乐', '语音', '音效'][i]}<Select value={draft.audio[field] ?? ''} items={audio} empty="停止 / 静音" onChange={value => mark({ audio: { ...draft.audio, [field]: value } })} /></label>)}</div>
      {state.routes ? <><h3>剧情路由</h3><select value={routes[0]?.kind ?? 'end'} onChange={e => changeKind(e.target.value as Route['kind'])}><option value="advance">推进到下一幕</option><option value="choice">显示选择</option><option value="end">结束</option></select>
        {routes.map((route, index) => <div className="route" key={index}>
          {route.kind === 'choice' && <label>选项文字<input value={draft.options.find(o => o.id === route.option)?.text ?? ''} onChange={e => mark({ options: draft.options.map(o => o.id === route.option ? { ...o, text: e.target.value } : o) })} /></label>}
          {route.kind !== 'end' && <label>明确目标<Select value={route.target ?? ''} items={targetItems} empty="请选择目标" onChange={target => routeChange(routes.map((r, at) => at === index ? { ...r, target } : r))} /></label>}
          {route.kind === 'choice' && <><label>选项显示条件</label><Condition story={story} value={route.guard} change={guard => routeChange(routes.map((r, at) => at === index ? { ...r, guard } : r))} /></>}
          {route.kind !== 'end' && <Updates story={story} value={route.updates} change={updates => routeChange(routes.map((r, at) => at === index ? { ...r, updates } : r))} />}
          {route.kind === 'choice' && routes.length > 1 && <button onClick={() => { mark({ options: draft.options.filter(o => o.id !== route.option) }); routeChange(routes.filter((_, i) => i !== index)); }}>移除此选项</button>}
        </div>)}
        {routes[0]?.kind === 'choice' && <button onClick={() => { const id = `choice.${crypto.randomUUID()}`; mark({ options: [...draft.options, { id, text: '新的选择' }] }); routeChange([...routes, { frame: frame.ref, kind: 'choice', option: id, target: frame.ref, updates: [] }]); }}>＋添加选项</button>}
      </> : <p className="notice">高级逻辑保留原文，请在源码中修改路由。</p>}
      <div className="actions"><button className="primary" disabled={!dirty || conflict || !!pending} onClick={() => { setPending(send({ ...state, revision: base }, 'patch', { ref: frame.ref, patch: { text: draft.text, speaker: draft.speaker, visual: draft.visual, audio: draft.audio, ...(state.routes ? { options: draft.options } : {}) }, ...(state.routes ? { routes } : {}) })); }}>预览差异并应用</button><button disabled={!!pending} onClick={reload}>撤销表单草稿</button></div>
      <details open={visual} onToggle={e => setVisual(e.currentTarget.open)}><summary>为此幕创建独立画面</summary><p className="muted">保存完整背景与三槽立绘；已有共享画面保持原样。高级姿态/模型请使用源码。</p>
        <label>背景<Select value={background} items={images} empty="无背景" onChange={setBackground} /></label>
        {['left', 'center', 'right'].map(slot => { const portrait = portraits.find(p => p.slot === slot); return <div className="portrait" key={slot}><label>{({ left: '左侧', center: '中间', right: '右侧' })[slot]}立绘<Select value={portrait?.image ?? ''} items={images} onChange={image => { const rest = portraits.filter(p => p.slot !== slot); setPortraits(image ? [...rest, { slot, image, character: portrait?.character || story.characters[0]?.id || '' }] : rest); }} /></label>{portrait && <Select value={portrait.character} items={story.characters} empty="选择人物" onChange={character => setPortraits(portraits.map(p => p.slot === slot ? { ...p, character } : p))} />}</div>; })}
        <button disabled={dirty || conflict} onClick={() => send(state, 'visual', { ref: frame.ref, background, portraits })}>预览并创建此幕画面</button>
      </details>
    </fieldset>
  </section>;
}
function Home() {
  return <main className="home"><div className="eyebrow">KAKERA · VISUAL STORY WORKBENCH</div><h1>让每一幕，<br />成为故事的起点。</h1><p>一格一幕，保留 XML / JS。先写下台词和选择，再走进真实的故事。</p><div className="home-actions"><button className="primary" onClick={() => command('kakera.project.create')}>新建游戏工程</button><button onClick={() => command('kakera.project.open')}>打开已有工程</button></div><div className="home-grid">{[['kakera.storyboard.open', '01', '可视分镜', '台词、构图与明确分支'], ['kakera.tools.configure', '02', '准备工具', '配置 v0.8.3 播放器和打包器'], ['kakera.ai.configure', '03', '可选 AI', '用户配置的服务，原文先审阅'], ['kakera.debug.start', '04', '真实试玩', '帧级断点和只读运行状态']].map(([id, n, title, text]) => <button className="home-card" key={id} onClick={() => command(id)}><span>{n}</span><strong>{title}</strong><small>{text}</small></button>)}</div><p className="muted">Windows 本地桌面 · AI 未配置也可创作 · 调试不提供 JS 行级步进</p></main>;
}
function Variables({ state }: { state: EditorState }) {
  const [id, setId] = useState(''), [type, setType] = useState('int'), [value, setValue] = useState('0');
  return <details className="variables"><summary>变量 · {state.story!.variables.length}</summary>{state.story!.variables.map(v => <p key={v.id}>{v.id} <span className="muted">{v.type} · 初始值 {v.initial}</span></p>)}<div className="update"><input placeholder="新变量名" aria-label="变量名" value={id} onChange={e => setId(e.target.value)} /><select value={type} onChange={e => { setType(e.target.value); setValue(e.target.value === 'bool' ? 'false' : e.target.value === 'int' ? '0' : ''); }}><option>int</option><option>bool</option><option>string</option></select><input aria-label="变量初始值" value={value} onChange={e => setValue(e.target.value)} /><button disabled={!id || !state.writable} onClick={() => send(state, 'variable', { id, valueType: type, initial: value })}>添加</button></div></details>;
}
function App() {
  const [state, setState] = useState<EditorState>(), [selected, setSelected] = useState(''), [error, setError] = useState(''), [query, setQuery] = useState(''), [offset, setOffset] = useState(0);
  const [draftDirty, setDraftDirty] = useState(false);
  useEffect(() => {
    const listener = (event: MessageEvent) => { if (event.data.type === 'state') { setState(event.data.state); setError(''); } else if (event.data.type === 'error') setError(event.data.message); };
    window.addEventListener('message', listener); host.postMessage({ version: 1, requestId: crypto.randomUUID(), revision: '', type: 'ready', payload: {} }); return () => window.removeEventListener('message', listener);
  }, []);
  if (!state) return <Home />;
  if (!state.story) return <main><h1>工程暂时无法解析</h1>{state.issues.map((i, n) => <p key={n}>{i}</p>)}<p>请用普通源码编辑器修复。修复后分镜会自动刷新。</p></main>;
  const frames = state.story.frames, frame = frames.find(f => f.ref === selected) ?? frames[0], visual = state.story.visuals.find(v => v.id === frame?.visual);
  const filtered = frames.filter(f => !query || f.text.includes(query) || f.ref.includes(query));
  const visible = filtered.slice(offset, offset + 50);
  const move = (delta: number) => { if (!frame) return; const local = frames.filter(f => f.file === frame.file).map(f => f.ref), index = local.indexOf(frame.ref), to = index + delta; if (to < 0 || to >= local.length) return; [local[index], local[to]] = [local[to], local[index]]; send(state, 'reorder', { ref: frame.ref, refs: local }); };
  return <main className="workspace"><header><div><span className="eyebrow">KAKERA / {state.story.id}</span><h1>故事工作台 <small>{frames.length} 幕</small></h1></div><div className="toolbar"><button onClick={() => command('kakera.validate')}>校验</button><button onClick={() => command('kakera.playtest.start')}>试玩</button><button onClick={() => command('kakera.playtest.stop')}>停止</button><button onClick={() => command('kakera.asset.import')}>导入资源</button><button onClick={() => command('kakera.debug.start')}>调试</button><button onClick={() => command('kakera.build.run')}>构建</button><button onClick={() => send(state, 'ready')}>刷新</button></div></header>
    {!state.writable && <div className="notice">当前为只读模式。编辑与运行需要 Windows 本地桌面受信任工作区。</div>}
    {error && <div role="alert" className="error">{error}<button onClick={() => setError('')}>关闭</button></div>}
    {!!state.issues.length && <details className="issues"><summary>注意事项 · {state.issues.length}</summary>{state.issues.map((i, n) => <p key={n}>{i}</p>)}</details>}
    <div className="workbench"><section className="story"><div className="stage" aria-label="静态构图预览">{visual?.background && state.images[visual.background] && <img className="background" src={state.images[visual.background]} alt="背景" />}{visual?.portraits.map(p => state.images[p.image] && <img key={p.slot} className={`actor ${p.slot}`} src={state.images[p.image]} alt={p.character} />)}<div className="stage-label">静态构图 · 精确效果请用播放器试玩</div><div className="dialogue"><strong>{state.story.characters.find(c => c.id === frame?.speaker)?.name ?? '旁白'}</strong><p>{frame?.text ?? '暂无幕'}</p></div></div>
      <div className="strip-title"><h2>分镜</h2><span className="muted">排序只改变组织顺序</span><input aria-label="搜索分镜" placeholder="搜索台词或幕 ID" value={query} onChange={e => { setQuery(e.target.value); setOffset(0); }} /></div>
      <div className="frame-tools"><button disabled={!state.writable || !state.routes || !frame} onClick={() => send(state, 'insert', { ref: frame.ref })}>＋新增幕</button><button disabled={!state.writable || !state.routes || !frame} onClick={() => send(state, 'duplicate', { ref: frame.ref })}>复制幕</button><button disabled={!state.writable || !frame} onClick={() => move(-1)}>前移</button><button disabled={!state.writable || !frame} onClick={() => move(1)}>后移</button></div>
      <div className="frames">{visible.map(f => <button className={`frame ${frame?.ref === f.ref ? 'selected' : ''}`} key={f.ref} onClick={() => { if (draftDirty && f.ref !== frame?.ref) { setError('当前幕有未应用的草稿，请先应用或撤销表单草稿。'); return; } setSelected(f.ref); send(state, 'preview', { ref: f.ref }); }}><span className="frame-top">{String(frames.indexOf(f) + 1).padStart(2, '0')} <small>{state.routes?.find(r => r.frame === f.ref)?.kind === 'choice' ? '选择' : state.routes?.find(r => r.frame === f.ref)?.kind === 'end' ? '结束' : state.routes ? '推进' : '高级逻辑'}</small></span><p>{f.text}</p><span className="muted">{f.ref.slice(0, 12)}</span></button>)}</div>
      {filtered.length > 50 && <div className="pager"><button disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 50))}>上一批</button><span>{offset + 1}–{Math.min(offset + 50, filtered.length)} / {filtered.length}</span><button disabled={offset + 50 >= filtered.length} onClick={() => setOffset(offset + 50)}>下一批</button></div>}
      <Variables state={state} />
    </section>{frame && <Editor key={frame.ref} frame={frame} state={state} onDirty={setDraftDirty} />}</div>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App />);
