import React, { useEffect, useMemo, useState } from 'react';
import type { EditorState } from '../../protocol/src/index';
import type { FtlEntry, LocalizationCatalog, LocalizationManifestEdit } from '../../domain/src/localization';
import type { Send } from './project-settings';
import { Icon } from './icons';

interface LocaleEntries { all: Map<string, FtlEntry>; firstFile?: string }

function localeEntries(catalog: LocalizationCatalog, localeId: string): LocaleEntries {
  const all = new Map<string, FtlEntry>();
  const locale = catalog.texts.find(item => item.id === localeId);
  for (const file of locale?.messages ?? []) for (const entry of file.entries) if (!entry.term && !all.has(entry.id)) all.set(entry.id, entry);
  return { all, firstFile: locale?.messages[0]?.src };
}
function usedKeys(state: EditorState): string[] {
  const keys: string[] = [];
  for (const frame of state.story?.frames ?? []) {
    if (frame.textKey) keys.push(frame.textKey);
    for (const option of frame.options) if (option.textKey) keys.push(option.textKey);
  }
  for (const character of state.story?.characters ?? []) if (character.nameKey) keys.push(character.nameKey);
  for (const variable of state.story?.variables ?? []) if (variable.labelKey) keys.push(variable.labelKey);
  for (const entry of state.ui?.gallery ?? []) if (entry.titleKey) keys.push(entry.titleKey);
  for (const usage of state.ui?.localizationUsages ?? []) if (!usage.dynamic) keys.push(usage.key);
  if (state.title?.textKey) keys.push(state.title.textKey);
  return [...new Set(keys)];
}
function clipsText(locale: { clips: { key: string; asset?: string; silent: boolean }[] }): string {
  return locale.clips.map(clip => `${clip.key} = ${clip.silent ? 'silent' : clip.asset ?? ''}`).join('\n');
}
function parseClips(value: string): { key: string; asset?: string; silent?: boolean }[] {
  return value.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
    const at = line.indexOf('=');
    if (at <= 0) throw new Error(`语音映射行需要 key = asset 或 key = silent：${line}`);
    const key = line.slice(0, at).trim(), target = line.slice(at + 1).trim();
    if (!key || !target) throw new Error(`语音映射行不完整：${line}`);
    return target === 'silent' ? { key, silent: true } : { key, asset: target };
  });
}

export function LocalizationSettings({ state, send, onDirty }: { state: EditorState; send: Send; onDirty: (value: boolean) => void }) {
  const catalog = state.story?.localization;
  const [localeId, setLocaleId] = useState(catalog?.defaultText ?? '');
  const [pending, setPending] = useState('');
  const [editing, setEditing] = useState<{ locale: string; key: string; value: string; isNew: boolean } | null>(null);
  const [labelDraft, setLabelDraft] = useState('');
  const [defaults, setDefaults] = useState({ text: catalog?.defaultText ?? '', voice: catalog?.defaultVoice ?? '' });
  const [voiceForm, setVoiceForm] = useState<{ original: string; id: string; label: string; clips: string } | null>(null);
  const [error, setError] = useState('');
  const locale = catalog?.texts.find(item => item.id === localeId) ?? catalog?.texts.find(item => item.id === catalog.defaultText);
  const entries = useMemo(() => catalog && locale ? localeEntries(catalog, locale.id) : { all: new Map() }, [catalog, locale?.id]);
  const defaultsEntries = useMemo(() => catalog ? localeEntries(catalog, catalog.defaultText) : { all: new Map() }, [catalog]);
  const keys = useMemo(() => [...new Set([...defaultsEntries.all.keys(), ...entries.all.keys()])].sort(), [entries, defaultsEntries]);
  const used = useMemo(() => new Set(usedKeys(state)), [state.story, state.ui, state.title]);
  const dirty = !!editing || !!voiceForm || !!pending || (!!catalog && (defaults.text !== catalog.defaultText || defaults.voice !== (catalog.defaultVoice ?? '')));
  useEffect(() => { onDirty(dirty); }, [dirty]);
  useEffect(() => { if (catalog) { setLocaleId(previous => catalog.texts.some(locale => locale.id === previous) ? previous : catalog.defaultText); setDefaults({ text: catalog.defaultText, voice: catalog.defaultVoice ?? '' }); } }, [catalog?.defaultText, catalog?.defaultVoice, state.revision]);
  useEffect(() => { setLabelDraft(locale?.label ?? ''); }, [locale?.id, locale?.label, state.revision]);
  useEffect(() => { const listener = (event: MessageEvent) => { if ((event.data.type === 'error' || event.data.type === 'settled') && event.data.requestId === pending) { if (event.data.type === 'error') setError(event.data.message); setPending(''); } }; window.addEventListener('message', listener); return () => window.removeEventListener('message', listener); }, [pending]);
  useEffect(() => { if (pending && state.appliedRequestId === pending) { setPending(''); setEditing(null); setVoiceForm(null); setError(''); } }, [state.appliedRequestId]);
  const sendLocalization = (payload: Record<string, unknown>) => { if (!state.writable || pending) return; setError(''); setPending(send({ ...state, revision: state.revision }, 'localization', payload)); };
  const saveManifest = (manifest: LocalizationManifestEdit) => sendLocalization({ manifest });
  if (!catalog?.enabled) return <section className="localization-settings">
    <h3><Icon name="globe" size={12} />游戏本地化</h3>
    <p className="muted">本工程没有开启游戏文本/语音国际化。引擎默认关闭，原字面量文本与语音保持原样。</p>
    <p className="muted">开启方式：在入口 <code>story.xml</code> 根声明 <code>&lt;localization enabled="true" src="languages.xml"/&gt;</code>，并建立 schema 1 语言清单与已声明字体。编辑器不自动创建新文件；已有清单可直接编辑翻译。</p>
    {!state.writable && <p className="notice">当前工作区只读，不能修改本地化内容。</p>}
  </section>;
  return <section className="localization-settings">
    <div className="section-label"><span><Icon name="globe" size={12} />游戏本地化</span><span className="badge">{catalog.texts.length} 文本 · {catalog.voices.length} 语音</span></div>
    <p className="muted mono">{catalog.file} · 默认文本 {catalog.defaultText}{catalog.defaultVoice ? ` · 默认语音 ${catalog.defaultVoice}` : ' · 无语音通道'}</p>
    <div className="actions"><button className="subtle" disabled={!!pending} onClick={() => send(state, 'localizationSource', { manifest: true })}>查看清单源码</button>{locale && <button className="subtle" disabled={!!pending} onClick={() => send(state, 'localizationSource', { locale: locale.id })}>查看当前语言 FTL</button>}</div>
    {error && <p className="error" role="alert">{error}</p>}
    {!!pending && <p className="muted">正在保存本地化…</p>}
    <fieldset disabled={!state.writable || !!pending}>
      <h4>默认语言</h4>
      <div className="field-grid two">
        <label>默认文本<select aria-label="默认文本语言" value={defaults.text} onChange={e => setDefaults({ ...defaults, text: e.target.value })}>{catalog.texts.map(item => <option key={item.id} value={item.id}>{item.id} · {item.label}</option>)}</select></label>
        <label>默认语音<select aria-label="默认语音语言" value={defaults.voice} onChange={e => setDefaults({ ...defaults, voice: e.target.value })} disabled={!catalog.voices.length}>{!catalog.voices.length && <option value="">无语音语言</option>}{catalog.voices.map(item => <option key={item.id} value={item.id}>{item.id} · {item.label}</option>)}</select></label>
      </div>
      <div className="actions"><button className="primary" disabled={defaults.text === catalog.defaultText && defaults.voice === (catalog.defaultVoice ?? '')} onClick={() => saveManifest({ action: 'defaults', defaultText: defaults.text, ...(catalog.voices.length ? { defaultVoice: defaults.voice } : { defaultVoice: null }) })}>保存默认语言</button><button onClick={() => setDefaults({ text: catalog.defaultText, voice: catalog.defaultVoice ?? '' })}>还原</button></div>
      <p className="muted">默认语言是未命中系统/玩家选择时的回退，不会覆盖玩家已保存的偏好；default-voice 为空时语音通道禁用。</p>

      <h4>文本语言</h4>
      <div className="actions"><select aria-label="选择文本语言" value={locale?.id ?? ''} onChange={e => { setLocaleId(e.target.value); setEditing(null); }}>{catalog.texts.map(item => <option key={item.id} value={item.id}>{item.id} · {item.label}{item.id === catalog.defaultText ? '（默认）' : ''}</option>)}</select></div>
      {locale && <>
        <label>显示名（自称，最多 64 字符）<input aria-label="文本语言显示名" value={labelDraft} maxLength={64} onChange={e => setLabelDraft(e.target.value)} /></label>
        <div className="actions"><button disabled={!labelDraft.trim() || labelDraft === locale.label} onClick={() => saveManifest({ action: 'textLocale', id: locale.id, label: labelDraft })}>保存显示名</button>{locale.id !== catalog.defaultText && <button className="subtle danger-ghost" onClick={() => saveManifest({ action: 'deleteTextLocale', id: locale.id })}>删除此语言</button>}</div>
        <p className="muted">消息文件：{locale.messages.map(file => file.src).join('、')} · 字体：{locale.fonts.join('、')}。新增语言与消息文件请先在源码建立，再在此编辑。</p>
        <div className="localization-messages">
          <div className="section-label"><span><Icon name="text" size={12} />消息</span><span className="muted">{keys.length} 条 · 当前语言覆盖 {entries.all.size} 条</span><button className="subtle" disabled={!!pending} onClick={() => setEditing({ locale: locale.id, key: '', value: '', isNew: true })}>＋新增消息</button></div>
          {editing && <div className="localization-message-form">
            <label>消息 key<input aria-label="本地化消息 key" value={editing.key} disabled={!editing.isNew} maxLength={128} onChange={e => setEditing({ ...editing, key: e.target.value })} /></label>
            <label>FTL 正文<textarea aria-label="本地化消息正文" rows={5} value={editing.value} onChange={e => setEditing({ ...editing, value: e.target.value })} /></label>
            <p className="muted">支持 Fluent 正文、<code>{'{ $name }'}</code> 参数、消息/术语引用和 select；不支持属性、函数或带参数术语。key 和参数契约由匹配引擎最终校验。</p>
            <div className="actions"><button className="primary" disabled={!editing.key.trim() || !editing.value.trim()} onClick={() => sendLocalization({ operation: { action: 'message', locale: editing.locale, key: editing.key.trim(), value: editing.value } })}>保存消息</button><button onClick={() => setEditing(null)}>取消</button></div>
          </div>}
          <table className="localization-table"><thead><tr><th>key</th><th>默认文本</th><th>{locale.id}</th><th>引用</th><th /></tr></thead><tbody>
            {keys.map(key => {
              const own = entries.all.get(key), base = defaultsEntries.all.get(key);
              return <tr key={key} className={!own ? 'missing' : ''}>
                <td><code>{key}</code>{used.has(key) && <span className="badge">使用</span>}</td>
                <td className="message-preview">{base?.value ?? '—'}</td>
                <td className="message-preview">{own?.value ?? (locale.id === catalog.defaultText ? '—' : '缺失（回退默认）')}</td>
                <td>{base?.parameters.length ? base.parameters.map((name: string) => `$${name}`).join(', ') : '—'}</td>
                <td><div className="event-actions"><button className="subtle" disabled={!!pending} onClick={() => setEditing({ locale: locale.id, key, value: own?.value ?? base?.value ?? '', isNew: false })}>编辑</button>{own && <button className="subtle danger-ghost" disabled={!!pending} onClick={() => sendLocalization({ operation: { action: 'deleteMessage', locale: locale.id, key } })}>删除</button>}</div></td>
              </tr>;
            })}
          </tbody></table>
          {!keys.length && <p className="muted">还没有消息。新增默认文本消息后，可在幕/UI 属性中选择 key。</p>}
        </div>
      </>}

      <h4>语音语言</h4>
      {!catalog.voices.length ? <p className="muted">本游戏没有声明语音语言，语音通道禁用；剧情仍按 audio.voice 原字面量播放。</p> : <>
        <div className="voice-locale-list">{catalog.voices.map(item => <div className="event-row" key={item.id}><div><code>{item.id}</code> · {item.label}<small>{item.clips.length} 个映射{item.id === catalog.defaultVoice ? ' · 默认' : ''}</small></div><div className="event-actions"><button className="subtle" disabled={!!pending} onClick={() => setVoiceForm({ original: item.id, id: item.id, label: item.label, clips: clipsText(item) })}>编辑</button>{item.id !== catalog.defaultVoice && <button className="subtle danger-ghost" disabled={!!pending} onClick={() => saveManifest({ action: 'deleteVoiceLocale', id: item.id })}>删除</button>}</div></div>)}</div>
        <button className="subtle" disabled={!!pending} onClick={() => setVoiceForm({ original: '', id: '', label: '', clips: '' })}>＋新增语音语言</button>
        {voiceForm && <div className="localization-message-form">
          <div className="field-grid two"><label>语言 ID<input aria-label="语音语言 ID" value={voiceForm.id} disabled={!!voiceForm.original} placeholder="ja-JP" onChange={e => setVoiceForm({ ...voiceForm, id: e.target.value })} /></label><label>显示名<input aria-label="语音语言显示名" value={voiceForm.label} maxLength={64} onChange={e => setVoiceForm({ ...voiceForm, label: e.target.value })} /></label></div>
          <label>语音映射（每行 <code>剧情 voice key = 音频资源 ID</code>，或 <code>key = silent</code>）<textarea aria-label="语音映射" rows={5} value={voiceForm.clips} onChange={e => setVoiceForm({ ...voiceForm, clips: e.target.value })} /></label>
          <p className="muted">key 必须被剧情 <code>audio.voice</code> 使用；默认语音语言必须覆盖全部剧情语音 key。asset 必须引用已声明 audio 资源。</p>
          <div className="actions"><button className="primary" disabled={!voiceForm.id.trim() || !voiceForm.label.trim()} onClick={() => { try { saveManifest({ action: 'voiceLocale', id: voiceForm.id.trim(), label: voiceForm.label.trim(), clips: parseClips(voiceForm.clips) }); } catch (e) { setError(e instanceof Error ? e.message : '语音映射无效'); } }}>保存语音语言</button><button onClick={() => setVoiceForm(null)}>取消</button></div>
        </div>}
        <p className="muted">语音语言与文本语言独立选择；BGM、音效、UI 角色音效和视频音轨不随语音语言切换。</p>
      </>}
    </fieldset>
  </section>;
}
