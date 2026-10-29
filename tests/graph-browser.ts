import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StoryGraphView } from '../packages/webview/src/story-graph';
import type { Story, Route } from '../packages/domain/src/index';
import type { Point } from '../packages/source/src/workbench';
declare global { interface Window { graphTest: { selections: string[]; moves: { ref?: string; point?: Point }[]; wires: unknown[]; events: string[]; setDisabled: (value: boolean) => void; ready: boolean } } }
const story: Story = { id: 'click-regression', entry: 'a', contentVersion: '1', frames: ['a', 'b', 'c'].map(ref => ({ ref, id: ref, text: `测试幕 ${ref}`, speaker: '', visual: '', audio: {}, options: [], file: 'story.xml', line: 1 })), files: ['story.xml'], scripts: [], assets: [], variables: [], characters: [], visuals: [] };
const routes: Route[] = [{ frame: 'a', kind: 'advance', target: 'b', updates: [] }, { frame: 'b', kind: 'advance', target: 'c', updates: [] }, { frame: 'c', kind: 'end', updates: [] }];
window.graphTest = { selections: [], moves: [], wires: [], events: [], setDisabled: () => {}, ready: false };
for (const type of ['pointerup', 'click', 'keydown', 'keyup']) document.addEventListener(type, e => { const target = e.target as Element; window.graphTest.events.push(`${type}:${target.tagName}:${target.closest('[data-frame-ref]')?.getAttribute('data-frame-ref') ?? ''}`); });
function Fixture() {
  const [selected, setSelected] = useState('a'), [layout, setLayout] = useState<Record<string, Point>>({}), [disabled, setDisabled] = useState(false);
  window.graphTest.setDisabled = setDisabled; window.graphTest.ready = true;
  return React.createElement(StoryGraphView, { story, routes, layout, selected, query: '', disabled,
    select: ref => { window.graphTest.selections.push(ref); setSelected(ref); },
    onLayout: (ref, point) => { window.graphTest.moves.push({ ref, point }); setLayout(old => ref && point ? { ...old, [ref]: point } : {}); },
    onReconnect: (ref, target, option) => window.graphTest.wires.push({ ref, target, option }) });
}
createRoot(document.getElementById('root')!).render(React.createElement(Fixture));
