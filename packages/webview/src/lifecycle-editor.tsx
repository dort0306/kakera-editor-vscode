import React, { useEffect, useState } from 'react';
import type { EditorState } from '../../protocol/src/index';
import type { LifecycleBinding, UiEdit } from '../../domain/src/ui';

export function LifecycleEditor({ state, kind, owner, disabled, save, onDirty }: {
  state: EditorState; kind: 'frameExit' | 'screenClose'; owner: string; disabled?: boolean;
  save: (operation: UiEdit, revision: string) => string; onDirty: (dirty: boolean) => void;
}) {
  const binding = state.ui?.lifecycle?.[kind][owner];
  const [mode, setMode] = useState<LifecycleBinding['mode']>(binding?.mode ?? 'none'), [target, setTarget] = useState(binding?.target ?? '');
  const [base, setBase] = useState(state.revision), [dirty, setDirty] = useState(false), [pending, setPending] = useState(''), [error, setError] = useState('');
  const reset = () => { setMode(binding?.mode ?? 'none'); setTarget(binding?.target ?? ''); setBase(state.revision); setDirty(false); setPending(''); setError(''); };
  useEffect(() => { onDirty(dirty || !!pending); return () => onDirty(false); }, [dirty, pending]);
  useEffect(() => { if (!dirty && !pending) reset(); }, [state.revision]);
  useEffect(() => { if (pending && state.appliedRequestId === pending) reset(); }, [state.appliedRequestId]);
  useEffect(() => {
    const listener = (event: MessageEvent) => { if (event.data.requestId === pending && ['error', 'settled'].includes(event.data.type)) { if (event.data.type === 'error') setError(event.data.message); setPending(''); } };
    window.addEventListener('message', listener); return () => window.removeEventListener('message', listener);
  }, [pending]);
  const conflict = dirty && base !== state.revision;
  const pages = state.ui?.screens.filter(s => kind !== 'screenClose' || s.id !== owner).map(s => ({ id: s.id, name: s.id })) ?? [];
  const frames = state.story?.frames.filter(f => !f.pending).map(f => ({ id: f.ref, name: `${f.name ?? f.ref} · ${f.text.slice(0, 25)}` })) ?? [];
  const items = mode === 'page' ? pages : frames;
  return <section className="lifecycle-editor"><h3>{kind === 'frameExit' ? '幕结束后（离开时）' : '页面结束后（关闭时）'}</h3>
    {!binding?.editable ? <p className="notice">{binding?.reason ?? '暂时无法读取生命周期，请修复源码后刷新。'}{binding?.file && <small> {binding.file}:{binding.line}</small>}</p> : <>
      <fieldset disabled={!state.writable || disabled || !!pending}>
        <label>结束后动作<select aria-label={`${kind} 动作`} value={mode} onChange={e => { setMode(e.target.value as LifecycleBinding['mode']); setTarget(''); setDirty(true); }}>
          <option value="none">不添加动作</option><option value="page">打开页面</option>{kind === 'screenClose' && <><option value="frame">从指定幕开始 / 续接</option><option value="continue">从隐藏槽恢复</option></>}
        </select></label>
        {['page', 'frame'].includes(mode) && <label>{mode === 'page' ? '目标页面' : '起始 / 续接幕'}<select aria-label={`${kind} 目标`} value={target} onChange={e => { setTarget(e.target.value); setDirty(true); }}><option value="">请选择</option>{target && !items.some(i => i.id === target) && <option value={target}>{target}（目标缺失）</option>}{items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>}
        <div className="actions"><button disabled={!dirty || conflict || ['page', 'frame'].includes(mode) && !items.some(i => i.id === target)} onClick={() => { setError(''); setPending(save({ action: 'lifecycle', kind, owner, mode, target }, base)); }}>保存结束后动作</button></div>
      </fieldset>
      <button disabled={!dirty || !!pending} onClick={reset}>还原结束后动作</button>
      {binding.file && <p className="muted">{binding.file}:{binding.line}</p>}
    </>}
    {kind === 'frameExit' ? <p className="muted">按正常剧情路线离开本幕时打开页面，保留原后续。末幕在文字完成后的手动继续触发一次；补全文字不触发，自动播放和 Ctrl 仍在结尾停止。</p> : <p className="muted">关闭页面时执行。自动演出需将结束行为设为“关闭页面”；普通页面可用关闭按钮结束。“从指定幕开始 / 续接”会以该幕为显式起点并保留隐藏槽变量与历史；留空恢复隐藏槽 continuation，首次没有隐藏槽时播放器会拒绝。</p>}
    {(error || conflict) && <p className="error" role="alert">{error || '源码已改变，请还原结束后动作后重新编辑。'}</p>}
  </section>;
}
