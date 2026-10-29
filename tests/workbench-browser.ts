import type { EditorState } from '../packages/protocol/src/index';
import type { UiDesign } from '../packages/domain/src/ui';
import type { Route, Story, Visual } from '../packages/domain/src/index';

declare global {
  interface Window {
    workbenchTest: { ready: boolean; messages: string[] };
    acquireVsCodeApi?: () => { postMessage: (message: unknown) => void };
  }
}

const svg = (body: string) => `data:image/svg+xml,${encodeURIComponent(body)}`;
const background = svg(`<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#294960"/><stop offset=".52" stop-color="#172b3d"/><stop offset="1" stop-color="#0c1722"/></linearGradient></defs><rect width="1280" height="720" fill="url(#g)"/><circle cx="1030" cy="140" r="210" fill="#e8b86a" opacity=".16"/><path d="M0 540 L180 320 L340 470 L520 280 L760 500 L980 360 L1280 520 V720 H0Z" fill="#0b1721" opacity=".78"/><g stroke="#6b8da6" stroke-width="2" opacity=".35"><path d="M120 90h1040M120 630h1040"/><path d="M120 90v540M1160 90v540"/></g><text x="126" y="132" fill="#93b3c8" font-family="Segoe UI" font-size="18" letter-spacing="6">KAKERA / STAGE</text></svg>`);
const actor = svg(`<svg xmlns="http://www.w3.org/2000/svg" width="420" height="620" viewBox="0 0 420 620"><defs><linearGradient id="c" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#f2d7a8"/><stop offset="1" stop-color="#b97d68"/></linearGradient></defs><circle cx="210" cy="150" r="90" fill="url(#c)"/><path d="M210 225c-96 0-158 70-158 180v215h316V405c0-110-62-180-158-180Z" fill="#334f68"/><path d="M210 225c-40 0-72 14-96 38 30-8 62-12 96-12s66 4 96 12c-24-24-56-38-96-38Z" fill="#8fd8ca" opacity=".85"/><path d="M88 250c34-48 74-70 122-70 50 0 92 22 126 70l-26 34c-28-34-60-52-100-52s-72 18-100 52Z" fill="#e8b86a" opacity=".8"/><path d="M160 420c16 16 34 24 50 24s34-8 50-24" stroke="#f2e8dc" stroke-width="8" fill="none" opacity=".55"/></svg>`);
const frames: Story['frames'] = [
  { ref: 'opening', id: 'opening', name: 'opening', text: '雨落在旧车站的玻璃穹顶上。凛把伞收了收，抬头看向空无一人的站台。', speaker: 'lin', visual: 'cg.rain', audio: { bgm: 'bgm.rain' }, options: [], file: 'story.xml', line: 8 },
  { ref: 'question', id: 'question', name: 'question', text: '“如果今天不回消息，你会来找我吗？”她问得很轻，像怕惊动雨声。', speaker: 'lin', visual: 'station.rain', audio: {}, options: [{ id: 'accept', text: '“会。现在就去。”' }, { id: 'wait', text: '“让我再想想。”' }], file: 'story.xml', line: 14 },
  { ref: 'journey', id: 'journey', name: 'journey', text: '伞下的距离缩短了一步。站外路灯次第亮起，雨水把城市折成两半。', speaker: 'you', visual: 'street.night', audio: {}, options: [], file: 'story.xml', line: 20 },
  { ref: 'interlude', id: 'interlude', name: 'interlude', text: '列车进站的广播响起，又慢慢远去。她低头笑了一下。', speaker: 'lin', visual: 'street.night', audio: {}, options: [], file: 'story.xml', line: 26 },
  { ref: 'ending', id: 'ending', name: 'ending', text: '雨停的时候，我们都没有提起回程。故事才刚刚开始。', speaker: 'narrator', visual: 'station.rain', audio: { bgm: 'bgm.ending' }, options: [], file: 'story.xml', line: 32 }
];
const routes: Route[] = [
  { frame: 'opening', kind: 'advance', target: 'question', updates: [] },
  { frame: 'question', kind: 'choice', option: 'accept', target: 'journey', updates: [{ op: 'add', variable: 'trust', value: { kind: 'constant', type: 'int', value: '1' } }] },
  { frame: 'question', kind: 'choice', option: 'wait', target: 'interlude', updates: [] },
  { frame: 'journey', kind: 'advance', target: 'ending', updates: [] },
  { frame: 'interlude', kind: 'advance', target: 'ending', updates: [] },
  { frame: 'ending', kind: 'end', updates: [] }
];
const visuals: Visual[] = [
  { id: 'cg.rain', background: '', portraits: [], cg: 'cg.rain' },
  { id: 'station.rain', background: 'bg.station', portraits: [{ character: 'lin', image: 'char.lin', slot: 'center' }] },
  { id: 'street.night', background: 'bg.street', portraits: [] }
];
const story: Story = {
  id: 'kakera-demo', entry: 'opening', entries: ['opening', 'journey'], contentVersion: '9',
  frames, visuals,
  assets: [
    { id: 'bg.station', kind: 'image', src: 'assets/bg/station.png', file: 'story.xml' },
    { id: 'bg.street', kind: 'image', src: 'assets/bg/street.png', file: 'story.xml' },
    { id: 'char.lin', kind: 'image', src: 'assets/char/lin.png', file: 'story.xml' },
    { id: 'cg.rain', kind: 'cg', src: 'assets/cg/rain.png', file: 'story.xml' },
    { id: 'bgm.rain', kind: 'audio', src: 'assets/audio/rain.ogg', file: 'story.xml' },
    { id: 'voice.lin', kind: 'audio', src: 'assets/audio/lin.ogg', file: 'story.xml' }
  ],
  variables: [{ id: 'trust', type: 'int', initial: '0' }, { id: 'sawEnding', type: 'bool', initial: 'false' }],
  characters: [{ id: 'lin', name: '凛' }, { id: 'you', name: '你' }],
  scripts: ['scripts/routes.js', 'scripts/ui.js'], files: ['story.xml', 'chapters/rain.xml']
};
const ui: UiDesign = {
  entry: 'ui.xml', files: ['ui.xml'], width: 1280, height: 720, initial: 'hud', attrs: {},
  screens: [], variables: [], palette: [], gallery: [], events: [], warnings: [],
  lifecycle: { frameExit: { opening: { mode: 'none', editable: true } }, screenClose: {} }
};
const state: EditorState = {
  revision: '8', writable: true, issues: [], images: { 'bg.station': background, 'bg.street': background, 'char.lin': actor, 'cg.rain': background },
  selected: 'opening', title: { file: 'ui.xml', text: '雨中的约定' }, story, routes, ui,
  logic: {
    frames: Object.fromEntries(frames.map(f => [f.ref, { editable: true, locations: [{ file: 'scripts/routes.js', line: 4 + frames.indexOf(f) * 2, start: 0, end: 1 }] }])),
    links: routes,
    issues: [],
    complete: true
  },
  characterLooks: { lin: [{ visualId: 'look.lin', image: 'char.lin', file: 'story.xml' }] },
  live2dMode: 'fallback'
};
const homeOnly = new URLSearchParams(location.search).has('home');
window.workbenchTest = { ready: false, messages: [] };
window.acquireVsCodeApi = () => ({
  postMessage(message: unknown) {
    const value = message as { type?: string; command?: string; requestId?: string };
    if (value.type) window.workbenchTest.messages.push(value.type);
    if (value.type === 'layout' && value.requestId) queueMicrotask(() => window.postMessage({ type: 'settled', requestId: value.requestId }, '*'));
    if (value.type === 'ready') {
      if (homeOnly) window.workbenchTest.ready = true;
      else queueMicrotask(() => {
        window.postMessage({ type: 'state', state }, '*');
        window.workbenchTest.ready = true;
      });
    }
  }
});
void import('../packages/webview/src/main');
