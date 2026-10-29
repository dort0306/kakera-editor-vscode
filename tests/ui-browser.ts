import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { UiEditor } from '../packages/webview/src/ui-editor';
import type { EditorState } from '../packages/protocol/src/index';
import type { UiDesign, UiNode, UiEdit } from '../packages/domain/src/ui';
declare global { interface Window { uiTest: { ready: boolean; operations: UiEdit[]; setReadonly: (value: boolean) => void; externalEdit: () => void } } }
const node = (id: string, kind: UiNode['kind'], attrs: Record<string, string>, children: UiNode[] = []): UiNode => ({ id, kind, attrs: { id, ...attrs }, children, file: 'ui/hud.xml', line: 2 });
const design: UiDesign = { entry: 'ui.xml', files: ['ui.xml', 'ui/hud.xml'], width: 1280, height: 720, initial: 'hud', attrs: { schema: '3' }, variables: [{ id: 'bgDraft', type: 'string', initial: '#10253BFF', file: 'ui.xml', line: 1 }], events: [{ name: 'advance', file: 'ui.js', line: 1, start: 0, end: 26, editable: true, command: 'advance' }], palette: [{ id: 'accent', initial: '#00FF00FF', file: 'ui.xml', line: 1 }], gallery: [], warnings: [], screens: [{ id: 'hud', file: 'ui/hud.xml', line: 1, attrs: { id: 'hud', modal: 'false', pause: 'false' }, children: [node('panel', 'panel', { x: '40', y: '50', width: '500', height: '300', color: '#243950' }, [node('caption', 'label', { x: '20', y: '30', width: '300', height: '40', text: '可视 UI 编辑器', 'font-size': '24' })]), node('advance', 'button', { x: '40', y: '400', width: '200', height: '50', text: '继续剧情', event: 'advance' }), node('picker', 'color-picker', { x: '640', y: '40', width: '256', height: '320', value: 'ui.bgDraft', event: 'advance' })] }] };
design.screens.push({ id: 'help', file: 'ui/hud.xml', line: 8, attrs: { id: 'help' }, children: [] });
design.lifecycle = { frameExit: {}, screenClose: { hud: { mode: 'none', editable: true }, help: { mode: 'none', editable: true } } };
window.uiTest = { ready: false, operations: [], setReadonly: () => {}, externalEdit: () => {} };
function Fixture() {
  const [state, setState] = useState<EditorState>({ revision: '1', writable: true, issues: [], images: {}, ui: design, view: 'ui', uiScreen: 'hud', uiSelected: '', story: { id: 's', entry: 'a', contentVersion: '1', frames: [{ ref: 'a', id: 'a', name: '开场', text: '', speaker: 'lin', visual: '', audio: {}, options: [], file: 'story.xml', line: 1 }], assets: [], files: [], scripts: [], visuals: [], characters: [], variables: [] } });
  window.uiTest.ready = true; window.uiTest.setReadonly = value => setState(s => ({ ...s, writable: !value }));
  window.uiTest.externalEdit = () => setState(s => ({ ...s, revision: String(Number(s.revision) + 1), ui: { ...s.ui!, screens: s.ui!.screens.map(p => ({ ...p })) } }));
  return React.createElement(UiEditor, { state, onDirty: () => {}, onBack: () => {}, send: (_state, type, payload = {}) => {
    const id = `ui-request-${window.uiTest.operations.length}`;
    if (type === 'uiEdit') {
      const op = payload.operation as UiEdit; window.uiTest.operations.push(op);
      if (op.action === 'lifecycle') queueMicrotask(() => setState(s => ({ ...s, revision: String(Number(s.revision) + 1), appliedRequestId: id, ui: { ...s.ui!, lifecycle: { ...s.ui!.lifecycle!, [op.kind]: { ...s.ui!.lifecycle![op.kind], [op.owner]: { mode: op.mode, target: op.target, editable: true } } } } })));
      if (op.action === 'patchNode') queueMicrotask(() => setState(s => {
        const patch = (nodes: UiNode[]): UiNode[] => nodes.map(n => ({ ...n, attrs: n.id === op.id ? { ...n.attrs, ...op.patch } : n.attrs, children: patch(n.children) }));
        return { ...s, revision: String(Number(s.revision) + 1), appliedRequestId: id, uiSelected: op.id, ui: { ...s.ui!, screens: s.ui!.screens.map(p => ({ ...p, children: patch(p.children) })) } };
      }));
      else if (op.action !== 'lifecycle') queueMicrotask(() => setState(s => ({ ...s, revision: String(Number(s.revision) + 1), appliedRequestId: id })));
    }
    return id;
  } });
}
createRoot(document.getElementById('root')!).render(React.createElement(Fixture));
