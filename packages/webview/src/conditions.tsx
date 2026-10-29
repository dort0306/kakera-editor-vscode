import React from 'react';
import type { Expr, Story } from '../../domain/src/index';
import { describeExpression } from '../../domain/src/index';

export function initialCondition(story: Story): Expr {
  const variable = story.variables[0];
  return variable ? { kind: 'compare', op: '===', left: { kind: 'variable', id: variable.id }, right: { kind: 'constant', type: variable.type, value: variable.type === 'bool' ? 'true' : variable.initial } } : { kind: 'constant', type: 'bool', value: 'true' };
}
export function Condition({ value, change, story, optional = false, depth = 0 }: { value?: Expr; change: (value?: Expr) => void; story: Story; optional?: boolean; depth?: number }) {
  const variableId = value?.kind === 'variable' ? value.id : value?.kind === 'compare' && value.left.kind === 'variable' ? value.left.id : undefined;
  const variable = story.variables.find(v => v.id === variableId);
  const comparison = value?.kind === 'compare' && value.right.kind === 'constant' && variable ? value : undefined;
  const group = value?.kind === 'and' || value?.kind === 'or' ? value : undefined;
  const range = group?.kind === 'and' && group.left.kind === 'compare' && group.right.kind === 'compare' && group.left.op === '>=' && group.right.op === '<=' && group.left.left.kind === 'variable' && group.right.left.kind === 'variable' && group.left.left.id === group.right.left.id && group.left.right.kind === 'constant' && group.right.right.kind === 'constant' && group.left.right.type === 'int' && group.right.right.type === 'int' ? { id: group.left.left.id, low: group.left.right.value, high: group.right.right.value } : undefined;
  const scalar = (id: string): Expr | undefined => {
    const v = story.variables.find(v => v.id === id);
    return v ? { kind: 'compare', op: '===', left: { kind: 'variable', id }, right: { kind: 'constant', type: v.type, value: v.type === 'bool' ? 'true' : v.initial } } : undefined;
  };
  const makeRange = (id: string, low: string, high: string): Expr => ({ kind: 'and', left: { kind: 'compare', op: '>=', left: { kind: 'variable', id }, right: { kind: 'constant', type: 'int', value: low } }, right: { kind: 'compare', op: '<=', left: { kind: 'variable', id }, right: { kind: 'constant', type: 'int', value: high } } });
  const known = !value || !!comparison || value.kind === 'variable' && variable?.type === 'bool' || !!range;
  return <div className="condition-editor">
    {known ? <div className="condition">
      <select aria-label="条件变量" value={range?.id ?? variable?.id ?? ''} onChange={e => change(scalar(e.target.value))}>
        <option value="" disabled={!optional}>{optional ? '始终可见' : '选择变量'}</option>
        {story.variables.map(v => <option key={v.id} value={v.id}>{v.id} · {v.type}</option>)}
      </select>
      {(comparison || range || value?.kind === 'variable') && <>
        <select aria-label="比较方式" value={range ? 'between' : comparison?.op ?? '==='} onChange={e => {
          const id = range?.id ?? variable!.id, v = story.variables.find(v => v.id === id)!;
          const constant = comparison?.right.kind === 'constant' ? comparison.right.value : range?.low ?? 'true';
          change(e.target.value === 'between' ? makeRange(id, constant, constant) : { kind: 'compare', op: e.target.value as '===', left: { kind: 'variable', id }, right: { kind: 'constant', type: v.type, value: constant } });
        }}>{[['===', '等于'], ['!==', '不等于'], ...((range || variable?.type === 'int') ? [['<', '小于'], ['<=', '小于等于'], ['>', '大于'], ['>=', '大于等于'], ['between', '介于（含边界）']] : [])].map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
        {range ? <><input aria-label="范围下限" inputMode="numeric" value={range.low} onChange={e => change(makeRange(range.id, e.target.value, range.high))}/><span>至</span><input aria-label="范围上限" inputMode="numeric" value={range.high} onChange={e => change(makeRange(range.id, range.low, e.target.value))}/></> : variable?.type === 'bool' ? <select aria-label="条件比较值" value={comparison?.right.kind === 'constant' ? comparison.right.value : 'true'} onChange={e => change({ kind: 'compare', op: comparison?.op ?? '===', left: { kind: 'variable', id: variable.id }, right: { kind: 'constant', type: 'bool', value: e.target.value } })}><option value="true">true（是）</option><option value="false">false（否）</option></select> : <input aria-label="条件比较值" value={comparison?.right.kind === 'constant' ? comparison.right.value : ''} onChange={e => change({ ...comparison!, right: { kind: 'constant', type: variable!.type, value: e.target.value } })}/>}
      </>}
    </div> : group ? <fieldset className="condition-group"><legend><select aria-label="条件组合方式" value={group.kind} onChange={e => change({ ...group, kind: e.target.value as 'and' | 'or' })}><option value="and">同时满足（且）</option><option value="or">任一满足（或）</option></select></legend><Condition story={story} value={group.left} depth={depth + 1} change={left => { if (left) change({ ...group, left }); }}/><Condition story={story} value={group.right} depth={depth + 1} change={right => { if (right) change({ ...group, right }); }}/></fieldset> : value?.kind === 'not' ? <fieldset><legend>不满足以下条件</legend><Condition story={story} value={value.value} depth={depth + 1} change={next => { if (next) change({ kind: 'not', value: next }); }}/></fieldset> : <p>{value ? describeExpression(value) : ''}<button onClick={() => change(initialCondition(story))}>重新设置条件</button></p>}
    {value && depth < 5 && <div className="condition-actions"><button disabled={!story.variables.length} onClick={() => change({ kind: 'and', left: value, right: initialCondition(story) })}>＋同时满足</button><button disabled={!story.variables.length} onClick={() => change({ kind: 'or', left: value, right: initialCondition(story) })}>＋任一满足</button>{(group || value.kind === 'not') && <button onClick={() => change(initialCondition(story))}>改为单一条件</button>}{optional && <button onClick={() => change()}>清除显示条件</button>}</div>}
    {!story.variables.length && <p className="muted">请先在左侧“变量”中添加变量。</p>}
  </div>;
}

export function ConditionalTargets({ route, story, change }: { route: import('../../domain/src/index').Route; story: Story; change: (route: import('../../domain/src/index').Route) => void }) {
  const branches = route.branches ?? [];
  const target = (current: string | undefined, set: (target: string) => void, label: string) => <label>{label}<select aria-label={label} value={story.frames.some(f => f.pending && (f.ref === current || f.id === current)) ? '' : current ?? ''} onChange={e => set(e.target.value)}><option value="">未连接（新增幕时自动接上）</option>{story.frames.filter(f => !f.pending).map(f => <option key={f.ref} value={f.ref}>{f.text.slice(0, 32)}</option>)}</select></label>;
  return <div className="conditional-targets">
    {!!branches.length && <p className="muted">先执行本线路的变量更新，再从上到下判断；第一条满足的条件生效。均不满足时走默认线路。</p>}
    {branches.map((branch, i) => <fieldset key={i} className="branch-rule"><legend>条件线路 {i + 1}</legend><Condition story={story} value={branch.when} change={when => { if (when) change({ ...route, branches: branches.map((b, at) => at === i ? { ...b, when } : b) }); }}/>{target(branch.target, target => change({ ...route, branches: branches.map((b, at) => at === i ? { ...b, target } : b) }), `条件 ${i + 1} 满足时进入`)}<div className="condition-actions"><button disabled={i === 0} onClick={() => { const next = [...branches]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; change({ ...route, branches: next }); }}>上移条件</button><button disabled={i === branches.length - 1} onClick={() => { const next = [...branches]; [next[i + 1], next[i]] = [next[i], next[i + 1]]; change({ ...route, branches: next }); }}>下移条件</button><button onClick={() => change({ ...route, branches: branches.length > 1 ? branches.filter((_, at) => at !== i) : undefined })}>移除此条件线路</button></div></fieldset>)}
    {target(route.target, target => change({ ...route, target }), branches.length ? '否则进入（默认线路）' : '后续幕')}
    <button disabled={!story.variables.length || branches.length >= 32} onClick={() => change({ ...route, branches: [...branches, { when: initialCondition(story), target: '' }] })}>{branches.length ? '＋添加条件线路' : '按变量条件分流'}</button>
    {!story.variables.length && <p className="muted">添加变量后可设置条件分流。</p>}
  </div>;
}
