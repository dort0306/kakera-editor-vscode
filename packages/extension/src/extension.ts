import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Session, findRoot, type Loaded } from './session';
import { contentPath, hashFile, hashText, safePath, ensureDirectory } from './files';
import { launch, toolchain } from './tools';
import { Playtests } from './playtest';
import { Adapter } from '../../debug-adapter/src/adapter';
import { readMessage, type EditorState } from '../../protocol/src/index';
import { validateRoutes, validateStory, i64, type Route } from '../../domain/src/index';
import { addAsset, appendGroup, emitRoutes, escapeXml, insertFrame, newFrameRef, newShortId, patchFrame, readStory, reorderFrames, readGameTitle, patchGameTitle, editCharacter, addCharacterLooks, characterLooks, assignCharacterLook, setFrameVisual, reconcilePendingRoutes, insertConnectedFrame, deleteConnectedFrame, deleteConnectedFrames, duplicateConnectedFrames, setStoryEntry, setStoryEntries, addStoryVariable, editStoryVariable, deleteStoryVariable, deleteCharacter, patchLogicRoutes, protectedLogicTargets } from '../../source/src/index';
import { child, parseXml, setAttribute } from '../../source/src/xml';
import { endpoint, splitProposal, type AiProfile } from '../../ai-client/src/index';
import { archiveEntries } from './archive';
import { CharacterImport } from './character-import';
import { inspectTexture, saveTexture, packTexture } from './texture-service';
import { WORKBENCH_FILE, readWorkbench, frameLayout, moveFrame, moveFrames } from '../../source/src/workbench';
import { reconnectFrame, renameFrame } from '../../source/src/editing';
import { saveGraphExport } from './graph-export';
import { readUiDesign, editUi, locateUi } from '../../source/src/ui-source';
import { uiEntry } from '../../source/src/ui-files';
import { uiNodes } from '../../domain/src/ui';
import { UiImageCache } from './ui-assets';

type TreeCategory = 'characters' | 'art' | 'media' | 'frames' | 'variables' | 'scripts' | 'ui';
type TreeCategoryNode = { kind: 'category'; category: TreeCategory };
type TreeNode =
  | TreeCategoryNode
  | { kind: 'character'; id: string; name: string }
  | { kind: 'asset'; id: string; assetKind: string }
  | { kind: 'frameFile'; file: string }
  | { kind: 'frame'; ref: string; file: string; name: string }
  | { kind: 'variable'; id: string; variableType: string; initial: string }
  | { kind: 'script'; file: string }
  | { kind: 'ui' };
class KakeraTreeItem extends vscode.TreeItem {
  constructor(readonly node: TreeNode, label: string, collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None) { super(label, collapsibleState); }
}
class Tree implements vscode.TreeDataProvider<vscode.TreeItem> {
  emitter = new vscode.EventEmitter<void>(); readonly onDidChangeTreeData = this.emitter.event;
  loaded?: Loaded;
  title?: string;
  view?: vscode.TreeView<vscode.TreeItem>;
  syncView(): void { if (this.view) this.view.description = this.title ?? ''; }
  getTreeItem(item: vscode.TreeItem): vscode.TreeItem { return item; }
  private category(category: TreeCategory, count: number): KakeraTreeItem {
    const labels: Record<TreeCategory, string> = { characters: '人物', art: '美术资源', media: '音频与字体', frames: '剧本', variables: '变量', scripts: 'JS 程序', ui: '界面' };
    const icons: Record<TreeCategory, string> = { characters: 'person', art: 'file-media', media: 'unmute', frames: 'book', variables: 'symbol-variable', scripts: 'file-code', ui: 'layout' };
    const item = new KakeraTreeItem({ kind: 'category', category }, labels[category], vscode.TreeItemCollapsibleState.Collapsed);
    item.id = `kakera:category:${category}`; item.contextValue = `kakera.category.${category}`; item.description = String(count); item.iconPath = new vscode.ThemeIcon(icons[category]); return item;
  }
  getChildren(item?: vscode.TreeItem): vscode.TreeItem[] {
    if (!this.loaded || item && !(item instanceof KakeraTreeItem)) return [];
    const node = item instanceof KakeraTreeItem ? item.node : undefined;
    if (!node) {
      const story = this.loaded.story, art = story.assets.filter(a => ['image', 'cg', 'nine-patch', 'live2d'].includes(a.kind)), media = story.assets.filter(a => ['audio', 'font'].includes(a.kind));
      return [this.category('characters', story.characters.length), this.category('art', art.length), this.category('media', media.length), this.category('frames', story.frames.filter(f => !f.pending).length), this.category('variables', story.variables.length), this.category('scripts', story.scripts.length), this.category('ui', 1)];
    }
    if (node.kind === 'frameFile') {
      const kinds = new Map((this.loaded.routes ?? []).map(route => [route.frame, route.kind]));
      return this.loaded.story.frames.filter(f => !f.pending && f.file === node.file).map(f => {
        const child = new KakeraTreeItem({ kind: 'frame', ref: f.ref, file: f.file, name: f.name ?? f.ref }, f.name || f.ref);
        child.id = `kakera:frame:${f.ref}`; child.description = kinds.get(f.ref) ?? '脚本'; child.contextValue = 'kakera.frame'; child.iconPath = new vscode.ThemeIcon('book'); child.tooltip = f.text; child.command = { command: 'kakera.frame.open', title: '在可视化编辑器中定位', arguments: [f.ref] }; return child;
      });
    }
    if (node.kind !== 'category') return [];
    const story = this.loaded.story;
    if (node.category === 'characters') return story.characters.map(c => {
      const child = new KakeraTreeItem({ kind: 'character', id: c.id, name: c.name }, c.name);
      child.id = `kakera:character:${c.id}`; child.description = c.id; child.contextValue = 'kakera.character'; child.iconPath = new vscode.ThemeIcon('person'); child.tooltip = `人物 ${c.name} · ${c.id}`; return child;
    });
    if (node.category === 'art' || node.category === 'media') {
      const kinds = node.category === 'art' ? ['image', 'cg', 'nine-patch', 'live2d'] : ['audio', 'font'];
      return story.assets.filter(a => kinds.includes(a.kind)).map(a => {
        const child = new KakeraTreeItem({ kind: 'asset', id: a.id, assetKind: a.kind }, a.id);
        child.id = `kakera:asset:${a.id}`; child.description = a.kind; child.contextValue = 'kakera.asset'; child.iconPath = new vscode.ThemeIcon(a.kind === 'audio' ? 'unmute' : a.kind === 'live2d' ? 'symbol-class' : 'file-media'); child.tooltip = `${a.kind} · ${a.src}`; child.command = { command: 'kakera.asset.references', title: '查看资源引用', arguments: [a.id] }; return child;
      });
    }
    if (node.category === 'frames') {
      const groups = new Map<string, typeof story.frames>();
      for (const frame of story.frames.filter(f => !f.pending)) groups.set(frame.file, [...(groups.get(frame.file) ?? []), frame]);
      return [...groups].map(([file, frames]) => {
        const child = new KakeraTreeItem({ kind: 'frameFile', file }, file, vscode.TreeItemCollapsibleState.Collapsed);
        child.id = `kakera:frame-file:${file}`; child.description = `${frames.length} 幕`; child.contextValue = 'kakera.frameFile'; child.iconPath = new vscode.ThemeIcon('file-code'); child.tooltip = `${file} · ${frames.length} 幕`; child.command = { command: 'kakera.storyboard.open', title: '打开分镜', arguments: [file] }; return child;
      });
    }
    if (node.category === 'variables') return story.variables.map(v => {
      const child = new KakeraTreeItem({ kind: 'variable', id: v.id, variableType: v.type, initial: v.initial }, v.id);
      child.id = `kakera:variable:${v.id}`; child.description = `${v.type} = ${v.initial}`; child.contextValue = 'kakera.variable'; child.iconPath = new vscode.ThemeIcon('symbol-variable'); child.tooltip = `变量 ${v.id} · ${v.type}`; return child;
    });
    if (node.category === 'scripts') return story.scripts.map(file => {
      const child = new KakeraTreeItem({ kind: 'script', file }, file);
      child.id = `kakera:script:${file}`; child.description = 'JS'; child.contextValue = 'kakera.script'; child.iconPath = new vscode.ThemeIcon('file-code'); child.tooltip = `编辑 ${file}`; child.command = { command: 'kakera.source.open', title: '打开 JS 程序', arguments: [file] }; return child;
    });
    const ui = new KakeraTreeItem({ kind: 'ui' }, 'UI 编辑器');
    ui.id = 'kakera:ui:open'; ui.description = 'UI 3'; ui.contextValue = 'kakera.ui'; ui.iconPath = new vscode.ThemeIcon('layout'); ui.command = { command: 'kakera.ui.open', title: '打开 UI 编辑器' }; return [ui];
  }
}
function variableUsedByRoutes(routes: Route[] | undefined, id: string): boolean {
  const uses = (expr: any): boolean => !!expr && (expr.kind === 'variable' && expr.id === id || expr.kind === 'not' && uses(expr.value) || (expr.kind === 'and' || expr.kind === 'or' || expr.kind === 'compare') && (uses(expr.left) || uses(expr.right)));
  return !!routes?.some(route => uses(route.guard) || route.branches?.some(branch => uses(branch.when)) || route.updates.some(update => update.variable === id || uses(update.value)));
}
class Preview implements vscode.TextDocumentContentProvider {
  texts = new Map<string, string>();
  provideTextDocumentContent(uri: vscode.Uri): string { return this.texts.get(uri.toString()) ?? ''; }
  add(name: string, value: string): vscode.Uri { const uri = vscode.Uri.from({ scheme: 'kakera-preview', path: `/${randomUUID()}/${name}` }); this.texts.set(uri.toString(), value); return uri; }
}
function assertWritable(): void {
  if (!vscode.workspace.isTrusted) throw new Error('当前工作区未信任，只能只读查看');
  if (process.platform !== 'win32' || vscode.env.remoteName || vscode.env.uiKind !== vscode.UIKind.Desktop) throw new Error('当前版本只支持 Windows 本地桌面工作区');
}
function string(value: unknown, max = 65536): string { if (typeof value !== 'string' || value.length > max) throw new Error('输入类型或长度无效'); return value; }
let stopOwnedProcesses: () => Promise<void> = async () => {};
async function waitReview<T>(promise: Thenable<T>, signal?: AbortSignal): Promise<T | undefined> {
  if (!signal) return promise;
  if (signal.aborted) return;
  let abort = () => {};
  const cancelled = new Promise<undefined>(resolve => { abort = () => resolve(undefined); signal.addEventListener('abort', abort, { once: true }); });
  try { return await Promise.race([Promise.resolve(promise), cancelled]); } finally { signal.removeEventListener('abort', abort); }
}
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel('Kakera'), diagnostics = vscode.languages.createDiagnosticCollection('kakera');
  const tree = new Tree(), preview = new Preview(), playtests = new Playtests();
  stopOwnedProcesses = () => playtests.stop();
  const sessions = new Map<string, Session>(), panels = new Map<vscode.WebviewPanel, Session>(), busy = new Set<string>();
  const refreshTimers = new Map<vscode.WebviewPanel, NodeJS.Timeout>();
  const lastApplied = new Map<vscode.WebviewPanel, string>();
  let treeTimer: NodeJS.Timeout | undefined;
  function scheduleTreeRefresh(session: Session): void {
    if (treeTimer) clearTimeout(treeTimer);
    treeTimer = setTimeout(async () => {
      treeTimer = undefined;
      try { const loaded = await session.load(); if (active !== session) return; tree.loaded = loaded; tree.title = readGameTitle(loaded.sources).text; tree.syncView(); tree.emitter.fire(); } catch { /* 临时解析失败保留旧树 */ }
    }, 150);
  }
  function scheduleRefresh(session?: Session): void {
    for (const [panel, target] of panels) {
      if (session && session !== target) continue;
      const timer = refreshTimers.get(panel); if (timer) clearTimeout(timer);
      refreshTimers.set(panel, setTimeout(() => { refreshTimers.delete(panel); void refresh(panel, target); }, 150));
    }
    const target = session ?? active; if (target) scheduleTreeRefresh(target);
  }
  const storage = context.globalStorageUri.fsPath;
  let active: Session | undefined;
  const tools = async () => {
    assertWritable();
    const override = vscode.workspace.getConfiguration('kakera').inspect<string>('tools.directory')?.globalValue;
    return toolchain(override || context.asAbsolutePath('resources/tools/win32-x64'));
  };
  const engineArgs = async () => {
    const core = vscode.workspace.getConfiguration('kakera').inspect<string>('tools.cubismCore')?.globalValue;
    if (!core) return ['--no-live2d'];
    const stat = await fs.lstat(core); if (!stat.isFile() || stat.isSymbolicLink() || path.extname(core).toLowerCase() !== '.dll') throw new Error('Cubism Core 必须是用户配置的本地 DLL 文件');
    return ['--cubism-core', core];
  };
  async function sessionFor(uri: vscode.Uri): Promise<Session> {
    const root = await findRoot(uri);
    let session = sessions.get(root);
    if (!session) {
      session = new Session(root, path.join(storage, 'projects', hashText(root).slice(0, 24)), output, async () => (await tools()).player, engineArgs); sessions.set(root, session);
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(root), '**/*'));
      const target = session; context.subscriptions.push(watcher, watcher.onDidChange(() => scheduleRefresh(target)), watcher.onDidCreate(() => scheduleRefresh(target)), watcher.onDidDelete(() => scheduleRefresh(target)));
    }
    active = session; scheduleTreeRefresh(session); return session;
  }
  async function current(): Promise<Session> {
    const document = vscode.window.activeTextEditor?.document;
    if (document?.uri.scheme === 'file') { try { return await sessionFor(document.uri); } catch { /* use selected project */ } }
    if (active) return active;
    const files = await vscode.workspace.findFiles('**/story.xml', '**/{node_modules,.work,builds,.git}/**', 20);
    if (!files.length) throw new Error('请先打开或新建 Kakera 工程');
    const selected = files.length === 1 ? files[0] : (await vscode.window.showQuickPick(files.map(uri => ({ label: vscode.workspace.asRelativePath(uri), uri }))))?.uri;
    if (!selected) throw new Error('未选择工程'); return sessionFor(selected);
  }
  async function run<T>(session: Session, title: string, action: (signal: AbortSignal) => Promise<T>): Promise<T> {
    assertWritable(); if (busy.has(session.root)) throw new Error('该工程已有任务，请等待完成或取消');
    busy.add(session.root);
    try { return await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title, cancellable: true }, async (_progress, token) => {
      const controller = new AbortController(); const subscription = token.onCancellationRequested(() => controller.abort());
      try { return await action(controller.signal); } finally { subscription.dispose(); }
    }); } finally { busy.delete(session.root); }
  }
  async function retainedImport(session: Session, relative: string): Promise<boolean> {
    const storyFile = path.join(session.root, 'story.xml');
    const buffer = vscode.workspace.textDocuments.find(d => d.uri.scheme === 'file' && d.uri.fsPath === storyFile);
    if (buffer?.getText().includes(relative)) return true;
    return (await fs.readFile(storyFile, 'utf8').catch(() => '')).includes(relative);
  }
  const refreshSerial = new Map<vscode.WebviewPanel, number>();
  const selectedFrames = new Map<vscode.WebviewPanel, string>();
  const panelFiles = new Map<vscode.WebviewPanel, string>(), pendingFrameSelections = new Map<string, string>();
  const selectedCharacters = new Map<vscode.WebviewPanel, string>();
  const selectedViews = new Map<vscode.WebviewPanel, 'story' | 'ui'>(), selectedUiScreens = new Map<vscode.WebviewPanel, string>(), selectedUiNodes = new Map<vscode.WebviewPanel, string>();
  const uiImages = new UiImageCache();
  async function refresh(panel: vscode.WebviewPanel, session: Session, appliedRequestId?: string): Promise<void> {
    if (appliedRequestId) lastApplied.set(panel, appliedRequestId);
    const serial = (refreshSerial.get(panel) ?? 0) + 1; refreshSerial.set(panel, serial);
    const state: EditorState = { revision: '', issues: [], writable: vscode.workspace.isTrusted && !vscode.env.remoteName && process.platform === 'win32', images: Object.create(null), appliedRequestId: lastApplied.get(panel) };
    try {
      const loaded = await session.load(); state.revision = loaded.revision; state.story = loaded.story; state.routes = loaded.routes; state.managedFile = loaded.managedFile;
      state.logic = { frames: loaded.logic.frames, links: loaded.logic.links, complete: loaded.logic.complete, issues: loaded.logic.issues };
      state.layout = frameLayout(readWorkbench(loaded.sources.get(WORKBENCH_FILE)), loaded.story);
      state.selected = selectedFrames.get(panel);
      state.view = selectedViews.get(panel) ?? 'story';
      state.uiScreen = selectedUiScreens.get(panel); state.uiSelected = selectedUiNodes.get(panel);
      try { state.ui = readUiDesign(loaded.sources); } catch (e) { state.issues.push(`UI：${e instanceof Error ? e.message : '读取失败'}`); }
      state.title = readGameTitle(loaded.sources);
      state.characterLooks = Object.fromEntries(loaded.story.characters.map(c => [c.id, characterLooks(loaded.sources, c.id)]));
      state.live2dMode = vscode.workspace.getConfiguration('kakera').inspect<string>('tools.cubismCore')?.globalValue ? 'native' : 'fallback';
      tree.loaded = loaded; tree.title = state.title.text; tree.syncView(); tree.emitter.fire();
      state.issues.push(...validateStory(loaded.story).map(i => i.message));
      state.issues.push(...loaded.logic.issues);
      for (const file of loaded.story.files) {
        const doc = loaded.documents.get(file)!;
        const issues = validateStory(loaded.story).filter(i => i.file === file).map(i => new vscode.Diagnostic(new vscode.Range(Math.max(0, i.line - 1), 0, Math.max(0, i.line - 1), 1), i.message, i.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning));
        diagnostics.set(doc.uri, issues);
      }
      // Only declared image resources can enter the webview. No API secrets or raw machine paths.
      const imageCache = path.join(session.storage, 'images');
      if (state.writable) await fs.mkdir(imageCache, { recursive: true });
      panel.webview.options = { enableScripts: true, localResourceRoots: [context.extensionUri, vscode.Uri.file(imageCache)] };
      const frame = loaded.story.frames.find(f => f.ref === selectedFrames.get(panel)) ?? loaded.story.frames[0];
      const visual = loaded.story.visuals.find(v => v.id === frame?.visual);
      const needed = new Set([visual?.background, visual?.cg, ...(visual?.portraits.map(p => p.image) ?? [])]);
      const selectedCharacter = selectedCharacters.get(panel);
      if (selectedCharacter) for (const look of state.characterLooks[selectedCharacter]?.slice(0, 50) ?? []) needed.add(look.image);
      for (const asset of loaded.story.assets.filter(a => (a.kind === 'image' || a.kind === 'cg') && needed.has(a.id))) {
        if (!state.writable) continue;
        try {
          const file = await safePath(session.root, asset.src), stat = await fs.stat(file);
          if (stat.size > 8 * 1024 * 1024) { state.issues.push(`图片 ${asset.id} 超过静态预览 8MiB 预算，请使用播放器查看`); continue; }
          const hash = await hashFile(file), target = path.join(imageCache, `${hash}${path.extname(file).toLowerCase()}`);
          try { await fs.access(target); } catch { await fs.copyFile(file, target, fs.constants.COPYFILE_EXCL); }
          state.images[asset.id] = panel.webview.asWebviewUri(vscode.Uri.file(target)).toString();
        } catch { state.issues.push(`无法读取图片：${asset.id}`); }
      }
      if (state.view === 'ui' && state.ui && state.writable) {
        // Publish editable metadata/commit acknowledgement before image decoding.
        // Image preparation is bounded and may finish after a newer source revision.
        if (refreshSerial.get(panel) !== serial) return;
        try { await panel.webview.postMessage({ type: 'state', state: { ...state, uiTextures: {} } }); } catch { return; }
        const page = state.ui.screens.find(s => s.id === state.uiScreen) ?? state.ui.screens.find(s => s.id === state.ui!.initial)!;
        const ids = new Set<string>();
        for (const node of uiNodes(page.children)) {
          for (const key of ['image', 'hover-image', 'disabled-image']) if (node.attrs[key]) ids.add(node.attrs[key]);
          const bound = node.attrs['image-bind']; if (bound?.startsWith('ui.')) { const v = state.ui.variables.find(v => v.id === bound.slice(3)); if (v) ids.add(v.initial); }
        }
        state.uiTextures = Object.create(null); let pixels = 0, prepared = 0;
        for (const id of ids) {
          if (refreshSerial.get(panel) !== serial) return;
          if (prepared >= 8 || pixels >= 16 * 1024 * 1024) { state.ui.warnings.push('图片预览达到 8 张 / 16M 像素预算，其余控件显示占位。'); break; }
          try { const image = await uiImages.prepare(session, loaded, id, context.asAbsolutePath('dist/texture-worker.cjs')); prepared++; pixels += image.width * image.height; if (pixels > 16 * 1024 * 1024) continue; state.uiTextures![id] = { ...image, uri: panel.webview.asWebviewUri(vscode.Uri.file(image.uri)).toString() }; }
          catch (e) { state.ui.warnings.push('图片 ' + id + '：' + (e instanceof Error ? e.message : '预览不可用')); }
        }
      }
    } catch (e) { state.issues.push(e instanceof Error ? e.message : '工程读取失败'); }
    if (refreshSerial.get(panel) !== serial) return;
    try { await panel.webview.postMessage({ type: 'state', state }); } catch { /* disposed */ }
  }
  async function showDiff(session: Session, loaded: Loaded, changes: Map<string, string>, signal?: AbortSignal): Promise<boolean> {
    for (const [file, text] of changes) {
      const before = preview.add(file, loaded.sources.get(file) ?? ''), after = preview.add(file, text);
      await vscode.commands.executeCommand('vscode.diff', before, after, `Kakera 待应用：${file}`, { preview: false });
    }
    return await waitReview(vscode.window.showInformationMessage(`已打开 ${changes.size} 个文件的差异标签，可逐一查看。审阅后选择“校验并应用”，或取消。`, '校验并应用', '取消'), signal) === '校验并应用';
  }
  function html(webview: vscode.Webview): string {
    const nonce = randomUUID().replaceAll('-', ''), js = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview.js')), css = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview.css'));
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; connect-src 'none';"><link rel="stylesheet" href="${css}"></head><body><div id="root"></div><script nonce="${nonce}" src="${js}"></script></body></html>`;
  }
  async function handle(session: Session, value: unknown, panel: vscode.WebviewPanel): Promise<void> {
    const message = readMessage(value);
    if (message.type === 'ready') { await refresh(panel, session); return; }
    const loaded = await session.load();
    if (message.type === 'preview') {
      if (message.payload.view !== undefined) {
        if (!['ui', 'story'].includes(String(message.payload.view))) throw new Error('未知编辑视图');
        selectedViews.set(panel, message.payload.view as 'ui' | 'story');
        if (message.payload.screen !== undefined) { const id = string(message.payload.screen); if (!readUiDesign(loaded.sources).screens.some(s => s.id === id)) throw new Error('未知 UI 页面'); selectedUiScreens.set(panel, id); }
      } else if (message.payload.characterId !== undefined) {
        const id = string(message.payload.characterId); if (!loaded.story.characters.some(c => c.id === id)) throw new Error('未知人物'); selectedCharacters.set(panel, id);
      } else {
        const ref = string(message.payload.ref); if (!loaded.story.frames.some(f => f.ref === ref)) throw new Error('未知幕'); selectedFrames.set(panel, ref);
      }
      await refresh(panel, session); return;
    }
    if (message.type === 'uiSource') {
      const id = message.payload.id === undefined ? '' : string(message.payload.id);
      const target = id ? locateUi(loaded.sources, id, message.payload.screen === true) : undefined;
      const file = target?.file ?? uiEntry(loaded.sources), doc = loaded.documents.get(file)!;
      const position = target ? doc.positionAt(target.node.start) : new vscode.Position(0, 0);
      await vscode.window.showTextDocument(doc, { selection: new vscode.Range(position, position) }); return;
    }
    if (message.type === 'source') {
      const ref = string(message.payload.ref); const frame = loaded.story.frames.find(f => f.ref === ref);
      if (!frame) throw new Error('未知幕');
      const logic = message.payload.logic === true ? loaded.logic.frames[ref]?.locations[0] : undefined;
      const line = (logic?.line ?? frame.line) - 1;
      await vscode.window.showTextDocument(loaded.documents.get(logic?.file ?? frame.file)!, { selection: new vscode.Range(line, 0, line, 0) }); return;
    }
    if (message.revision !== loaded.revision) throw new Error('分镜内容已更新，请刷新后重试；你的草稿仍保留');
    if (message.type === 'uiEdit') {
      await run(session, '正在保存 UI', async signal => {
        const result = editUi(loaded.sources, message.payload.operation);
        if (result.changes.size) await session.apply(loaded, result.changes, signal, { save: true });
        if (result.screen) selectedUiScreens.set(panel, result.screen);
        selectedUiNodes.set(panel, result.selected ?? (result.screen ? '' : selectedUiNodes.get(panel) ?? ''));
      });
      await refresh(panel, session, message.requestId); await panel.webview.postMessage({ type: 'settled', requestId: message.requestId }); return;
    }
    if (message.type === 'graphExport') {
      assertWritable();
      const file = await vscode.window.showSaveDialog({ title: '导出完整幕流程图', saveLabel: '导出流程图', defaultUri: vscode.Uri.file(path.join(path.dirname(session.root), '幕流程图.svg')), filters: { 'SVG 矢量图': ['svg'], 'HTML 浏览检验页': ['html'] } });
      if (file) {
        if (file.scheme !== 'file') throw new Error('只支持导出到本地文件');
        await run(session, '正在导出幕流程图', async signal => saveGraphExport(session, loaded, file.fsPath, signal));
        void vscode.window.showInformationMessage('幕流程图已导出，可用浏览器打开查看。', '打开文件').then(choice => { if (choice) void vscode.env.openExternal(file); });
      }
      await panel.webview.postMessage({ type: 'settled', requestId: message.requestId }); return;
    }
    const worker = context.asAbsolutePath('dist/texture-worker.cjs');
    if (message.type === 'textureOpen') {
      const result = await run(session, '正在打开图片编辑器', signal => inspectTexture(session, loaded, string(message.payload.assetId, 256), worker, signal));
      if ((await session.load()).revision !== loaded.revision) throw new Error('工程已改变，请重新打开图片');
      const { preview, ...data } = result;
      await panel.webview.postMessage({ type: 'texture', requestId: message.requestId, data: { ...data, uri: panel.webview.asWebviewUri(vscode.Uri.file(preview)).toString() } }); return;
    }
    if (message.type === 'textureSave' || message.type === 'texturePack') {
      const id = await run(session, '正在保存图片资源', signal => message.type === 'texturePack'
        ? packTexture(session, loaded, worker, message.payload.ids as string[], Number(message.payload.width), Number(message.payload.padding), signal)
        : saveTexture(session, loaded, worker, { ...message.payload, assetId: string(message.payload.assetId, 256), hash: string(message.payload.hash, 64) } as Parameters<typeof saveTexture>[3], signal));
      await refresh(panel, session, message.requestId);
      await panel.webview.postMessage({ type: 'textureSaved', requestId: message.requestId, assetId: id });
      await panel.webview.postMessage({ type: 'settled', requestId: message.requestId }); return;
    }
    if (message.type === 'layout') {
      const meta = readWorkbench(loaded.sources.get(WORKBENCH_FILE));
      let next: ReturnType<typeof moveFrame>;
      if (message.payload.reset === true) next = moveFrame(meta, loaded.story);
      else if (message.payload.positions && typeof message.payload.positions === 'object' && !Array.isArray(message.payload.positions)) {
        const points: Record<string, { x: number; y: number }> = {};
        for (const [ref, point] of Object.entries(message.payload.positions as Record<string, unknown>)) {
          if (!point || typeof point !== 'object' || Array.isArray(point)) throw new Error('分镜布局坐标无效');
          points[string(ref, 256)] = { x: Number((point as { x?: unknown }).x), y: Number((point as { y?: unknown }).y) };
        }
        next = moveFrames(meta, loaded.story, points);
      } else next = moveFrame(meta, loaded.story, string(message.payload.ref), { x: Number(message.payload.x), y: Number(message.payload.y) });
      await run(session, '正在保存分镜布局', signal => session.apply(loaded, new Map([[WORKBENCH_FILE, JSON.stringify(next)]]), signal, { save: true, metadataOnly: true }));
      await refresh(panel, session, message.requestId); await panel.webview.postMessage({ type: 'settled', requestId: message.requestId }); return;
    }
    const applied = await run(session, '正在保存游戏内容', async signal => {
      const changes = new Map<string, string>(); const ref = message.payload.ref === undefined ? '' : string(message.payload.ref);
      const listed = (message.type === 'delete' || message.type === 'duplicate') && Array.isArray(message.payload.refs) ? [...new Set(message.payload.refs.map(value => string(value, 256)))] : [];
      const refs = listed.length ? listed : ref ? [ref] : [];
      let selection: string | undefined;
      const frame = loaded.story.frames.find(f => f.ref === (refs[0] ?? ref));
      if (['patch', 'rename', 'insert', 'delete', 'duplicate', 'reorder', 'visual', 'appearance'].includes(message.type) && (!frame || frame.pending)) throw new Error('请选择一个实际的幕');
      if ((message.type === 'delete' || message.type === 'duplicate') && (!refs.length || refs.length > 100)) throw new Error('请选择 1–100 个实际幕');
      if ((message.type === 'delete' || message.type === 'duplicate') && refs.some(target => !loaded.story.frames.some(candidate => candidate.ref === target && !candidate.pending))) throw new Error('复制或删除列表包含不存在的幕，请刷新');
      if (message.type === 'rename') {
        const result = renameFrame(loaded.sources, loaded.logic, ref, string(message.payload.next, 200));
        for (const [file, text] of result.changes) changes.set(file, text);
        selection = result.selected;
      } else if (message.type === 'reconnect') {
        const branch = message.payload.branch;
        if (branch !== undefined && (typeof branch !== 'number' || !Number.isInteger(branch) || branch < 0 || branch >= 32)) throw new Error('条件连接点无效');
        for (const [file, text] of reconnectFrame(loaded.sources, loaded.logic, ref, string(message.payload.target), message.payload.option === undefined ? undefined : string(message.payload.option, 256), branch)) changes.set(file, text);
      } else if (message.type === 'title') {
        for (const [file, xml] of patchGameTitle(loaded.sources, string(message.payload.title, 1024), message.payload.fixed === true)) changes.set(file, xml);
      } else if (message.type === 'character') {
        const id = message.payload.id === undefined ? undefined : string(message.payload.id, 256);
        for (const [file, xml] of editCharacter(loaded.sources, id, string(message.payload.name, 1024)).changes) changes.set(file, xml);
      } else if (message.type === 'characterLooks') {
        const looks = message.payload.looks;
        if (!Array.isArray(looks) || looks.some(l => !l || typeof l.image !== 'string' || (l.live2d !== undefined && typeof l.live2d !== 'string') || (l.visualId !== undefined && typeof l.visualId !== 'string'))) throw new Error('人物外观无效');
        for (const [file, xml] of addCharacterLooks(loaded.sources, string(message.payload.characterId, 256), looks)) changes.set(file, xml);
      } else if (message.type === 'appearance') {
        for (const [file, xml] of assignCharacterLook(loaded.sources, ref, string(message.payload.visualId, 256), string(message.payload.slot, 16))) changes.set(file, xml);
      } else
      if (message.type === 'patch') {
        const patch = message.payload.patch as Parameters<typeof patchFrame>[2];
        if (!patch || Object.keys(patch).some(k => !['text', 'speaker', 'visual', 'audio', 'options'].includes(k))) throw new Error('不支持的幕属性');
        if (patch.text !== undefined) string(patch.text);
        for (const field of ['speaker', 'visual'] as const) if (patch[field] !== undefined) string(patch[field], 256);
        changes.set(frame!.file, patchFrame(loaded.sources.get(frame!.file)!, ref, patch));
        if (message.payload.routes !== undefined) {
          if (!loaded.routes || !loaded.logic.frames[ref]?.editable || !Array.isArray(message.payload.routes)) throw new Error(loaded.logic.frames[ref]?.reason ?? '此幕路线尚不能安全编辑');
          const incoming = message.payload.routes as Route[];
          if (incoming.some(r => r.frame !== ref)) throw new Error('超出当前幕管理范围');
          const first = loaded.routes.findIndex(r => r.frame === ref);
          const routes = loaded.routes.filter(r => r.frame !== ref); routes.splice(first, 0, ...incoming);
          const candidate = new Map([...loaded.sources, ...changes]), normalized = reconcilePendingRoutes(candidate, routes, !loaded.logic.complete, protectedLogicTargets(loaded.logic));
          for (const [file, text] of normalized.sources) if (loaded.sources.get(file) !== text) changes.set(file, text);
          for (const [file, text] of patchLogicRoutes(loaded.sources, loaded.logic, normalized.routes, loaded.logic.records.find(r => r.frame === ref)?.file)) changes.set(file, text);
        } else if (patch.options) throw new Error('选项修改必须同时提供受管路由');
      } else if (message.type === 'insert' || message.type === 'delete') {
        const targets = message.type === 'delete' ? refs : [ref];
        if (!loaded.routes || targets.some(target => !loaded.logic.frames[target]?.editable)) throw new Error(loaded.logic.frames[targets.find(target => !loaded.logic.frames[target]?.editable) ?? ref]?.reason ?? '此幕尚未映射到可编辑路线');
        const file = loaded.logic.records.find(r => targets.includes(r.frame))?.file ?? loaded.logic.appendFile!;
        const result = message.type === 'insert' ? insertConnectedFrame(loaded.sources, loaded.routes, file, ref, loaded.logic) : targets.length > 1 ? deleteConnectedFrames(loaded.sources, loaded.routes, file, targets, loaded.logic) : deleteConnectedFrame(loaded.sources, loaded.routes, file, ref, loaded.logic);
        for (const [name, text] of result.changes) changes.set(name, text); selection = result.selected;
      } else if (message.type === 'entry') {
        const refs = Array.isArray(message.payload.refs) ? message.payload.refs.map(value => string(value, 256)) : [ref];
        for (const [file, text] of setStoryEntries(loaded.sources, refs)) changes.set(file, text);
      } else if (message.type === 'duplicate') {
        if (!loaded.routes || refs.some(target => !loaded.logic.frames[target]?.editable)) throw new Error(loaded.logic.frames[refs.find(target => !loaded.logic.frames[target]?.editable) ?? ref]?.reason ?? '此幕路线尚不能安全复制');
        const after = message.payload.after === undefined ? undefined : string(message.payload.after, 256);
        const file = loaded.logic.records.find(r => refs.includes(r.frame))?.file ?? loaded.logic.appendFile!;
        const result = duplicateConnectedFrames(loaded.sources, loaded.routes, file, refs, loaded.logic, after);
        for (const [name, text] of result.changes) changes.set(name, text);
        selection = result.selected;
      } else if (message.type === 'reorder') {
        const refs = message.payload.refs;
        if (!Array.isArray(refs) || refs.some(r => typeof r !== 'string')) throw new Error('排序无效');
        const pending = loaded.story.frames.filter(f => f.file === frame!.file && f.pending).map(f => f.ref);
        changes.set(frame!.file, reorderFrames(loaded.sources.get(frame!.file)!, [...refs, ...pending]));
      } else if (message.type === 'visual') {
        const background = string(message.payload.background, 256), portraits = message.payload.portraits as { character: string; image: string; slot: string; live2d?: string }[], cg = message.payload.cg === undefined || message.payload.cg === '' ? '' : string(message.payload.cg, 256);
        if (cg && !loaded.story.assets.some(a => a.id === cg && a.kind === 'cg')) throw new Error('CG 专用资源不存在');
        if (background && !loaded.story.assets.some(a => a.id === background && a.kind === 'image')) throw new Error('背景图片不存在');
        if (!Array.isArray(portraits) || portraits.length > 3 || new Set(portraits.map(p => p.slot)).size !== portraits.length) throw new Error('立绘最多三槽且不能重复');
        for (const p of portraits) if (!['left', 'center', 'right'].includes(p.slot) || !loaded.story.assets.some(a => a.id === p.image && a.kind === 'image') || !loaded.story.characters.some(c => c.id === p.character)) throw new Error('立绘槽、人物或图片不合法');
        for (const [file, xml] of setFrameVisual(loaded.sources, ref, background, portraits, cg)) changes.set(file, xml);
      } else if (message.type === 'variable') {
        const original = message.payload.original === undefined ? undefined : string(message.payload.original, 128);
        const id = string(message.payload.id, 128), initial = string(message.payload.initial, 4096);
        const min = message.payload.min === undefined ? undefined : string(message.payload.min, 128);
        const max = message.payload.max === undefined ? undefined : string(message.payload.max, 128);
        if (original) {
          const variable = loaded.story.variables.find(v => v.id === original);
          if (!variable || id !== original) throw new Error('变量 ID 创建后固定，不能改名；请先备份并处理脚本引用');
          if (message.payload.valueType !== undefined && string(message.payload.valueType, 16) !== variable.type) throw new Error('变量类型创建后固定，不能修改');
          for (const [file, text] of editStoryVariable(loaded.sources, id, initial, min, max)) changes.set(file, text);
        } else {
          const type = string(message.payload.valueType, 16);
          if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(id) || loaded.story.variables.some(v => v.id === id) || !['int', 'bool', 'string'].includes(type)) throw new Error('变量名称重复或类型无效');
          if (type === 'int') i64(initial); if (type === 'bool' && !['true', 'false'].includes(initial)) throw new Error('布尔值应为 true 或 false');
          const attrs = `id="${escapeXml(id)}" initial="${escapeXml(initial)}"${min ? ` min="${escapeXml(min)}"` : ''}${max ? ` max="${escapeXml(max)}"` : ''}`;
          changes.set('story.xml', appendGroup(loaded.sources.get('story.xml')!, 'variables', `<${type} ${attrs} />`));
        }
      } else if (message.type === 'deleteVariable') {
        const id = string(message.payload.id, 128), variable = loaded.story.variables.find(v => v.id === id);
        if (!variable) throw new Error('变量不存在，请刷新');
        if (variableUsedByRoutes(loaded.routes, id)) throw new Error('变量仍被路线条件或更新引用，请先修改相关路线');
        for (const [file, text] of deleteStoryVariable(loaded.sources, id)) changes.set(file, text);
      }
      if (!changes.size) throw new Error('没有可应用的变更');
      await session.apply(loaded, changes, signal, { save: true });
      if (selection) selectedFrames.set(panel, selection);
      return true;
    });
    await refresh(panel, session, applied ? message.requestId : undefined);
    await panel.webview.postMessage({ type: 'settled', requestId: message.requestId });
  }
  const provider: vscode.CustomTextEditorProvider = {
    async resolveCustomTextEditor(document, panel) {
      try {
        const session = await sessionFor(document.uri); panels.set(panel, session); panelFiles.set(panel, document.uri.fsPath.toLowerCase());
        try { const loaded = await session.load(); if (readUiDesign(loaded.sources).files.some(file => path.resolve(session.root, file).toLowerCase() === document.uri.fsPath.toLowerCase())) selectedViews.set(panel, 'ui'); } catch { /* source remains available while repairing invalid XML */ }
        const pendingFrame = pendingFrameSelections.get(document.uri.fsPath.toLowerCase());
        if (pendingFrame) { const loaded = await session.load(); if (loaded.story.frames.some(frame => frame.ref === pendingFrame)) { selectedFrames.set(panel, pendingFrame); selectedViews.set(panel, 'story'); } pendingFrameSelections.delete(document.uri.fsPath.toLowerCase()); }
        panel.webview.options = { enableScripts: true, localResourceRoots: [context.extensionUri] }; panel.webview.html = html(panel.webview);
        const seen = new Set<string>();
        const subscription = panel.webview.onDidReceiveMessage(value => {
          if (value?.type === 'command' && ['kakera.validate', 'kakera.playtest.start', 'kakera.playtest.stop', 'kakera.debug.start', 'kakera.asset.import', 'kakera.asset.references', 'kakera.build.run', 'kakera.ai.configure', 'kakera.recovery', 'kakera.tools.configureCore', 'kakera.character.importPortraits', 'kakera.character.importLive2d'].includes(value.command)) {
            active = session;
            if (value.command.startsWith('kakera.character.')) {
              const id = typeof value.characterId === 'string' ? value.characterId : '';
              void session.load().then(loaded => { if (!loaded.story.characters.some(c => c.id === id)) throw new Error('请选择已保存的人物'); return vscode.commands.executeCommand(value.command, id); }).catch(e => panel.webview.postMessage({ type: 'error', message: String(e) }));
            } else void vscode.commands.executeCommand(value.command);
            return;
          }
          const id = value?.requestId;
          if (typeof id !== 'string' || seen.has(id)) return;
          seen.add(id); if (seen.size > 1024) seen.delete(seen.values().next().value!);
          void handle(session, value, panel).catch(e => panel.webview.postMessage({ type: 'error', requestId: id, message: e instanceof Error ? e.message : '操作失败' }));
        });
        panel.onDidChangeViewState(e => { if (e.webviewPanel.active) active = session; });
        panel.onDidDispose(() => { panels.delete(panel); panelFiles.delete(panel); refreshSerial.delete(panel); selectedFrames.delete(panel); selectedCharacters.delete(panel); selectedViews.delete(panel); selectedUiScreens.delete(panel); selectedUiNodes.delete(panel); lastApplied.delete(panel); const timer = refreshTimers.get(panel); if (timer) clearTimeout(timer); refreshTimers.delete(panel); subscription.dispose(); });
      } catch (e) { panel.webview.html = '<p>该文件不属于可识别的 Kakera 工程，请使用普通文本编辑器打开。</p>'; output.appendLine(String(e)); }
    }
  };
  const command = (id: string, handler: (...args: any[]) => unknown) => context.subscriptions.push(vscode.commands.registerCommand(id, async (...args: any[]) => {
    try { return await handler(...args); } catch (e) { const message = e instanceof Error ? e.message : '操作失败'; output.appendLine(message); void vscode.window.showErrorMessage(message); }
  }));
  command('kakera.home', () => {
    const panel = vscode.window.createWebviewPanel('kakera.home', 'Kakera 创作首页', vscode.ViewColumn.One, { enableScripts: true, localResourceRoots: [context.extensionUri] }); panel.webview.html = html(panel.webview);
    const allowed = ['kakera.project.create', 'kakera.project.open', 'kakera.storyboard.open', 'kakera.ui.open', 'kakera.tools.configure', 'kakera.ai.configure', 'kakera.validate', 'kakera.playtest.start', 'kakera.build.run', 'kakera.debug.start', 'kakera.recovery'];
    panel.webview.onDidReceiveMessage(m => { if (m?.type === 'command' && allowed.includes(m.command)) void vscode.commands.executeCommand(m.command); });
  });
  command('kakera.project.open', async () => {
    const selected = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: '打开游戏工程' }); if (!selected?.[0]) return;
    const dir = selected[0].fsPath;
    let file = path.join(dir, 'story.xml');
    try { await fs.access(path.join(dir, 'project.kakera-editor.json')); file = path.join(dir, 'project.kakera-editor.json'); } catch { /* plain root */ }
    const session = await sessionFor(vscode.Uri.file(file)); await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(path.join(session.root, 'story.xml')), 'kakera.storyboard');
  });
  command('kakera.storyboard.open', async (arg?: unknown) => {
    const session = await current(), relative = typeof arg === 'string' ? arg : arg instanceof KakeraTreeItem && (arg.node.kind === 'frame' || arg.node.kind === 'frameFile') ? arg.node.file : undefined;
    const file = relative && (await session.load()).story.files.includes(relative) ? relative : 'story.xml';
    await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(await safePath(session.root, file)), 'kakera.storyboard');
  });
  command('kakera.frame.open', async (arg?: unknown) => {
    const session = await current(), loaded = await session.load();
    const ref = typeof arg === 'string' ? arg : arg instanceof KakeraTreeItem && arg.node.kind === 'frame' ? arg.node.ref : '';
    const frame = loaded.story.frames.find(f => f.ref === ref && !f.pending);
    if (!frame) throw new Error('请选择一个实际幕');
    active = session;
    const target = await safePath(session.root, frame.file), targetFile = target.toLowerCase();
    const candidates = [...panels].filter(([panel, owner]) => owner === session && panelFiles.has(panel));
    const existing = candidates.find(([panel]) => panelFiles.get(panel) === targetFile) ?? candidates[0];
    if (existing) {
      const [panel] = existing; selectedFrames.set(panel, frame.ref); selectedViews.set(panel, 'story');
      await refresh(panel, session); panel.reveal(vscode.ViewColumn.Active); return;
    }
    pendingFrameSelections.set(targetFile, frame.ref);
    await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(target), 'kakera.storyboard');
  });
  command('kakera.ui.open', async () => { const session = await current(), loaded = await session.load(); await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(await safePath(session.root, uiEntry(loaded.sources))), 'kakera.storyboard'); });
  command('kakera.source.open', async (arg?: unknown) => {
    const session = await current(), relative = typeof arg === 'string' ? arg : arg instanceof KakeraTreeItem && arg.node.kind === 'script' ? arg.node.file : 'story.xml';
    await vscode.window.showTextDocument(vscode.Uri.file(await safePath(session.root, relative)));
  });
  command('kakera.project.create', async () => {
    assertWritable();
    const parent = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: '选择新工程的父目录' }); if (!parent?.[0]) return;
    const name = await vscode.window.showInputBox({ title: '工程目录名', value: 'MyGame', validateInput: v => /^[A-Za-z0-9_-]+$/.test(v) ? undefined : '目录名使用英文字母、数字、下划线或连字符' }); if (!name) return;
    const target = path.join(parent[0].fsPath, name); await fs.mkdir(target); // Refuses overwrite.
    try {
      await fs.cp(context.asAbsolutePath('templates/minimal/content'), path.join(target, 'content'), { recursive: true, force: false, errorOnExist: true });
      let xml = await fs.readFile(path.join(target, 'content/story.xml'), 'utf8');
      const used = new Set<string>(), ids = new Map(['opening', 'journey', 'ending'].map(ref => { const id = newFrameRef(used); used.add(id); return [ref, id] as const; }));
      for (const [old, id] of ids) {
        const node = child(parseXml(xml), 'frames')!.children.find(n => n.attrs.id === old)!; xml = setAttribute(xml, node, 'id', id);
      }
      xml = setAttribute(xml, parseXml(xml), 'id', name); xml = setAttribute(xml, parseXml(xml), 'entry', ids.get('opening')!);
      await fs.writeFile(path.join(target, 'content/story.xml'), xml);
      const routes: Route[] = [
        { frame: ids.get('opening')!, kind: 'choice', option: 'explore', target: ids.get('journey')!, updates: [{ op: 'add', variable: 'trust', value: { kind: 'constant', type: 'int', value: '1' } }] },
        { frame: ids.get('opening')!, kind: 'choice', option: 'stay', target: ids.get('ending')!, updates: [] },
        { frame: ids.get('journey')!, kind: 'advance', target: ids.get('ending')!, updates: [] },
        { frame: ids.get('ending')!, kind: 'end', updates: [] }
      ];
      await fs.writeFile(path.join(target, 'content/scripts/routes.js'), emitRoutes(routes));
      await fs.writeFile(path.join(target, 'project.kakera-editor.json'), JSON.stringify({ editorSchema: 1, engineContract: '0.10.0', contentRoot: 'content' }, null, 2) + '\n');
      await fs.writeFile(path.join(target, '.gitignore'), '.editor/\n.cache/\n.work/\nbuilds/\n');
      await fs.mkdir(path.join(target, 'authoring'));
      const session = await sessionFor(vscode.Uri.file(path.join(target, 'project.kakera-editor.json')));
      await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(path.join(session.root, 'story.xml')), 'kakera.storyboard');
    } catch (e) { output.appendLine(`新建工程未完成，保留 ${target} 供检查。`); throw e; }
  });
  command('kakera.tools.configure', async () => {
    assertWritable(); const dirs = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: '选择含 tools.json 的工具目录' }); if (!dirs?.[0]) return;
    await toolchain(dirs[0].fsPath); await vscode.workspace.getConfiguration('kakera').update('tools.directory', dirs[0].fsPath, vscode.ConfigurationTarget.Global); void vscode.window.showInformationMessage('工具版本与 SHA-256 校验通过');
  });
  command('kakera.tools.configureCore', async () => {
    assertWritable();
    const choice = await vscode.window.showQuickPick(['选择本机 Cubism Core DLL', '使用静态回退模式']); if (!choice) return;
    let core = '';
    if (choice === '选择本机 Cubism Core DLL') { const files = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { 'Cubism Core': ['dll'] } }); if (!files?.[0]) return; core = files[0].fsPath; if ((await fs.lstat(core)).isSymbolicLink()) throw new Error('Core DLL 不可为链接'); }
    await vscode.workspace.getConfiguration('kakera').update('tools.cubismCore', core, vscode.ConfigurationTarget.Global); scheduleRefresh();
  });
  async function importCharacterAssets(kind: 'image' | 'live2d', requestedId?: string): Promise<void> {
    assertWritable(); const session = await current(), initial = await session.load();
    const character = requestedId ? initial.story.characters.find(c => c.id === requestedId) : (await vscode.window.showQuickPick(initial.story.characters.map(c => ({ label: c.name, character: c }))))?.character;
    if (!character) throw new Error('请先在人物设置中创建并保存人物');
    const files = await vscode.window.showOpenDialog({ canSelectMany: true, openLabel: kind === 'image' ? '批量导入人物立绘' : '导入 Live2D 模型及其引用依赖', filters: kind === 'image' ? { '立绘': ['png', 'jpg', 'jpeg'] } : { 'Live2D model3': ['json'] } });
    if (!files?.length) return;
    if (files.length > (kind === 'image' ? 100 : 8)) throw new Error('立绘每批最多 100 张，模型最多 8 个');
    let fallbackId: string | undefined, fallbackFile: string | undefined;
    if (kind === 'live2d') {
      const options = [{ label: '导入一张静态回退图', id: '' }, ...initial.story.assets.filter(a => a.kind === 'image').map(a => ({ label: a.src.split('/').pop()!, id: a.id }))];
      const selected = await vscode.window.showQuickPick(options, { title: '为模型选择静态回退图（后续可逐个编辑）' }); if (!selected) return;
      if (selected.id) fallbackId = selected.id;
      else { const picture = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { '静态回退图': ['png', 'jpg', 'jpeg'] } }); if (!picture?.[0]) return; fallbackFile = picture[0].fsPath; }
    }
    const license = await vscode.window.showInputBox({ title: '人物素材授权来源', prompt: '填写作者、来源及使用授权；模型的使用许可需要单独确认' }); if (!license?.trim()) return;
    await run(session, `导入 ${character.name} 的${kind === 'image' ? '立绘' : '模型与依赖'}`, async signal => {
      const loaded = await session.load(); if (loaded.revision !== initial.revision) throw new Error('选择文件期间工程已改变，请重新导入');
      const stage = new CharacterImport(session.root, loaded.story.assets.map(asset => asset.id)); let applied = false;
      try {
        const looks: { image: string; live2d?: string }[] = [];
        if (fallbackFile) fallbackId = await stage.image(fallbackFile, signal);
        for (const file of files) {
          if (kind === 'image') looks.push({ image: await stage.image(file.fsPath, signal) });
          else looks.push({ image: fallbackId!, live2d: await stage.model(file.fsPath, signal) });
        }
        await stage.license(license);
        let xml = loaded.sources.get('story.xml')!;
        for (const asset of stage.assets) xml = appendGroup(xml, 'assets', `<${asset.kind} id="${asset.id}" src="${escapeXml(asset.src)}" />`);
        const candidate = new Map([...loaded.sources, ['story.xml', xml] as [string, string]]);
        const changes = new Map([['story.xml', xml], ...addCharacterLooks(candidate, character.id, looks)]);
        await session.apply(loaded, changes, signal, { save: true }); applied = true;
      } finally { if (!applied && !await retainedImport(session, stage.relative)) await stage.dispose(); }
      scheduleRefresh(session);
    });
  }
  command('kakera.character.importPortraits', (arg?: unknown) => importCharacterAssets('image', typeof arg === 'string' ? arg : arg instanceof KakeraTreeItem && arg.node.kind === 'character' ? arg.node.id : undefined));
  command('kakera.character.importLive2d', (arg?: unknown) => importCharacterAssets('live2d', typeof arg === 'string' ? arg : arg instanceof KakeraTreeItem && arg.node.kind === 'character' ? arg.node.id : undefined));
  command('kakera.validate', async () => {
    const session = await current(); await run(session, '完整引擎校验', async signal => {
      const loaded = await session.load(), frozen = await session.freeze(loaded, undefined, signal);
      try { await session.check(frozen, signal); await frozen.assertCurrent(); if ((await session.load()).revision !== loaded.revision) throw new Error('校验结果已过期'); void vscode.window.showInformationMessage('完整引擎校验通过；动态剧情路线尚需试玩验证'); } finally { await frozen.dispose(); }
    });
  });
  command('kakera.playtest.start', async () => { const session = await current(); await run(session, '准备入口试玩', signal => playtests.start(session, false, signal)); });
  command('kakera.playtest.stop', () => playtests.stop());
  command('kakera.debug.start', async () => { assertWritable(); await current(); await vscode.debug.startDebugging(undefined, { type: 'kakera', name: 'Kakera 帧级调试', request: 'launch' }); });
  command('kakera.debug.choose', async () => {
    assertWritable(); const debug = playtests.current?.debug; if (!debug) throw new Error('尚未启动帧级调试');
    const state = await debug.request({ type: 'status' }); const options = state.available_options as { id: string; text: string }[];
    const selected = await vscode.window.showQuickPick(options.map(o => ({ label: o.text, id: o.id })), { title: '选择当前可用选项' }); if (selected) await debug.request({ type: 'choose', option: selected.id });
  });
  const importAsset = async (forced?: 'cg') => {
    const session = await current(); assertWritable();
    const files = await vscode.window.showOpenDialog({ canSelectMany: false, filters: forced ? { 'CG 图片': ['png', 'jpg', 'jpeg'] } : { '运行素材': ['png', 'jpg', 'jpeg', 'wav', 'ogg', 'mp4', 'ttf', 'otf'] } }); if (!files?.[0]) return;
    const source = files[0].fsPath; if ((await fs.lstat(source)).isSymbolicLink()) throw new Error('不导入链接文件');
    const initial = await session.load();
    const id = await vscode.window.showInputBox({ title: forced ? 'CG 资源 ID' : '资源 ID', value: newShortId(initial.story.assets.map(asset => asset.id)) }); if (!id || !/^[A-Za-z0-9_.-]+$/.test(id)) return;
    const license = await vscode.window.showInputBox({ title: '授权来源（随资源许可证保存）', prompt: '填写作者、来源与使用授权' }); if (!license?.trim()) throw new Error('请填写授权来源');
    await run(session, forced ? '导入 CG 资源' : '导入资源', async signal => {
      const loaded = await session.load(); if (loaded.story.assets.some(a => a.id === id)) throw new Error('资源 ID 重复');
      const ext = path.extname(source).toLowerCase(), inferred = ['.ttf', '.otf'].includes(ext) ? 'font' : ['.wav', '.ogg'].includes(ext) ? 'audio' : ext === '.mp4' ? 'video' : source.endsWith('.9.png') ? 'nine-patch' : 'image';
      if (forced && !['image'].includes(inferred) || forced && source.endsWith('.9.png')) throw new Error('CG 必须是普通图片，不能是音频、字体、视频或点九');
      const kind = forced ?? inferred;
      const logical = `assets/imported/${randomUUID()}${kind === 'nine-patch' ? '.9.png' : ext}`;
      const outputFile = path.join(session.root, logical); await ensureDirectory(session.root, 'assets/imported');
      let applied = false, licenseFile: string | undefined;
      try {
        const before = await hashFile(source, signal); await fs.copyFile(source, outputFile, fs.constants.COPYFILE_EXCL);
        if (await hashFile(source, signal) !== before || await hashFile(outputFile, signal) !== before) throw new Error('导入期间源素材改变');
        const licenseDir = await ensureDirectory(session.root, 'assets/licenses'); licenseFile = path.join(licenseDir, `${id}-${randomUUID()}.txt`);
        await fs.writeFile(licenseFile, `${id}\n${license}\nSHA-256: ${before}\n`, { flag: 'wx' });
        const changes = new Map([['story.xml', addAsset(loaded.sources.get('story.xml')!, { id, src: logical, kind })]]);
        await session.apply(loaded, changes, signal, { save: true }); applied = true;
      } finally { if (!applied && !await retainedImport(session, logical)) { await fs.rm(outputFile, { force: true }); if (licenseFile) await fs.rm(licenseFile, { force: true }); } }
    });
  };
  command('kakera.asset.import', () => importAsset());
  command('kakera.asset.importCg', () => importAsset('cg'));
  command('kakera.asset.references', async (arg?: unknown) => {
    const session = await current(), loaded = await session.load();
    const id = typeof arg === 'string' ? arg : arg instanceof KakeraTreeItem && arg.node.kind === 'asset' ? arg.node.id : undefined;
    const selected = id ? loaded.story.assets.find(a => a.id === id) : undefined;
    if (id && !selected) throw new Error('资源不存在，请刷新侧栏');
    const asset = selected ? { label: selected.id, asset: selected } : await vscode.window.showQuickPick(loaded.story.assets.map(a => ({ label: a.id, asset: a }))); if (!asset) return;
    const refs = loaded.story.frames.filter(f => loaded.story.visuals.some(v => v.id === f.visual && (v.background === asset.label || v.cg === asset.label || v.portraits.some(p => p.image === asset.label))) || Object.values(f.audio).includes(asset.label));
    const text = [`资源：${asset.label}`, ...refs.map(f => `${f.file}:${f.line} ${f.ref}`), '', '仅列出已知画面/音频引用。UI、视频、模型及动态 JS 仍需源码检查；高级逻辑不确定。'].join('\n'); await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ content: text, language: 'plaintext' }));
  });
  command('kakera.ai.configure', async () => {
    assertWritable();
    const baseUrl = await vscode.window.showInputBox({ title: 'Chat Completions API 基址', prompt: '例如 http://127.0.0.1:8080/v1；远程使用 HTTPS' }); if (!baseUrl) return; endpoint(baseUrl);
    const model = await vscode.window.showInputBox({ title: '模型精确 ID' }); if (!model?.trim()) return;
    const secret = await vscode.window.showInputBox({ title: 'Bearer 密钥（留空表示无鉴权）', password: true }); if (secret === undefined) return;
    const stream = await vscode.window.showQuickPick([{ label: '普通 JSON 响应', value: false }, { label: 'SSE 流式响应', value: true }]); if (!stream) return;
    await context.secrets.store('kakera.ai.key', secret); await context.globalState.update('kakera.ai.profile', { baseUrl, model, stream: stream.value, revision: randomUUID() } satisfies AiProfile);
    void vscode.window.showInformationMessage('AI 配置已保存。当前只发送选中的纯文本，不包含图片；尚未验证服务兼容性。');
  });
  command('kakera.ai.propose', async () => {
    assertWritable(); const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) throw new Error('请在原稿文本编辑器中选择要拆幕的文字');
    const original = editor.document.getText(editor.selection), originalVersion = editor.document.version;
    if (original.length > 20000) throw new Error('每次最多选取 20000 个字符');
    const session = active ?? await current(), loaded = await session.load();
    if (!loaded.routes || !loaded.managedFile) throw new Error('AI 新增幕需要完整受管路由');
    const profile = context.globalState.get<AiProfile>('kakera.ai.profile'); if (!profile) throw new Error('请先配置 AI 服务');
    const service = new URL(profile.baseUrl).origin;
    if (await vscode.window.showInformationMessage(`向 ${service} / ${profile.model} 发送所选 ${original.length} 个字符；素材 0 个、图片 0 张。只创建拆幕提案，原稿保持不变。`, { modal: true }, '发送所选原文') !== '发送所选原文') return;
    await run(session, 'AI 拆幕提案', async signal => {
      const segments = await splitProposal(profile, await context.secrets.get('kakera.ai.key'), original, signal);
      if (editor.document.version !== originalVersion || context.globalState.get<AiProfile>('kakera.ai.profile')?.revision !== profile.revision || (await session.load()).revision !== loaded.revision) throw new Error('提案原稿、工程输入或服务配置已改变');
      let xml = loaded.sources.get('story.xml')!; const ids: string[] = [], used = new Set(loaded.story.frames.flatMap(frame => [frame.ref, frame.id, frame.name].filter((value): value is string => !!value)));
      for (const segment of segments) { const added = insertFrame(xml, undefined, undefined, used); used.add(added.ref); xml = patchFrame(added.source, added.ref, { text: segment.text }); ids.push(added.ref); }
      const routes: Route[] = [...loaded.routes!, ...ids.map((frame, i): Route => i + 1 < ids.length ? { frame, kind: 'advance', target: ids[i + 1], updates: [] } : { frame, kind: 'end', updates: [] })];
      const changes = new Map([['story.xml', xml], [loaded.managedFile!, emitRoutes(routes)]]);
      if (await showDiff(session, loaded, changes, signal)) await session.apply(loaded, changes, signal);
    });
  });
  command('kakera.build.run', async () => {
    const session = await current(); assertWritable();
    const parent = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: '选择发行父目录（内容根之外）' }); if (!parent?.[0]) return;
    const relative = path.relative(session.root, parent[0].fsPath); if (!relative.startsWith('..') && !path.isAbsolute(relative)) throw new Error('发行目录必须位于内容根之外');
    await run(session, '构建独立游戏', async signal => {
      const loaded = await session.load();
      if (loaded.story.frames.some(f => f.pending)) throw new Error('还有选项或后续剧情尚未连接。请先补齐路线，再构建游戏。');
      const frozen = await session.freeze(loaded, undefined, signal), toolsInfo = await tools();
      const name = `${loaded.story.id}-${Date.now()}-${randomUUID().slice(0, 6)}`, candidate = path.join(parent[0].fsPath, `.${name}.candidate`), target = path.join(parent[0].fsPath, name);
      await fs.mkdir(candidate);
      try {
        await session.check(frozen, signal); await frozen.assertCurrent();
        if (await vscode.window.showInformationMessage(`将以 v0.10.0 依赖选择构建 ${loaded.story.id}。全部声明资源及 licenses、assets/licenses 中的许可证会入包；额外文件仅按 kakera.package.json。请确认授权与附加清单，动态路线需自行试玩覆盖。`, { modal: true }, '生成本地发行目录') !== '生成本地发行目录') return;
        const pack = path.join(candidate, 'game.kpak');
        const hasModels = loaded.story.assets.some(a => a.kind === 'live2d');
        if (hasModels && await waitReview(vscode.window.showWarningMessage('当前构建会生成 Live2D 静态回退版，不复制 Cubism Core；请通过“开始游戏.cmd”运行。', '构建静态回退版', '取消'), signal) !== '构建静态回退版') return;
        await launch(toolsInfo.packer, [frozen.directory, pack, '--format', '2', '--level', '19', '--no-live2d'], s => output.append(s), signal).done;
        await launch(toolsInfo.player, ['--package', pack, '--check', '--no-audio', '--no-live2d'], s => output.append(s), signal).done;
        const entries = await archiveEntries(pack);
        await vscode.window.showTextDocument(preview.add('发行文件清单.txt', entries.map(e => `${e.path}\t${e.bytes} bytes`).join('\n')));
        if (await waitReview(vscode.window.showInformationMessage(`已展示 ${entries.length} 个实际包内文件。确认资源授权、许可证和隐私清单后完成发行目录。`, '完成发行目录', '取消'), signal) !== '完成发行目录') return;
        await frozen.assertCurrent(); if ((await session.load()).revision !== loaded.revision) throw new Error('构建期间输入已改变');
        await fs.copyFile(toolsInfo.player, path.join(candidate, 'kakera-avg.exe')); await fs.copyFile(context.asAbsolutePath('LICENSE'), path.join(candidate, 'LICENSE'));
        if (hasModels) await fs.writeFile(path.join(candidate, '开始游戏.cmd'), '@echo off\r\n"%~dp0kakera-avg.exe" --no-live2d\r\n');
        const manifest = { engineVersion: toolsInfo.engineVersion, revision: loaded.revision, sourceFingerprint: frozen.fingerprint, toolHashes: toolsInfo.hashes, packageHash: await hashFile(pack, signal), contentVersion: loaded.story.contentVersion, idPolicy: loaded.story.frames.every(f => f.id) ? 'explicit' : 'contains-implicit-ids', packageFiles: entries, checks: ['engine-check', 'package-check'], dynamicRoutes: '未穷举' };
        await fs.writeFile(path.join(candidate, 'build-manifest.json'), JSON.stringify({ ...manifest, live2dMode: hasModels ? 'fallback' : 'none' }, null, 2)); await fs.writeFile(path.join(candidate, '开始游戏.txt'), `${hasModels ? '双击“开始游戏.cmd”以静态回退模式运行。' : '双击 kakera-avg.exe 运行。'}许可证随游戏内容打包；本发行物不包含 Live2D Core。\n`);
        signal.throwIfAborted(); await fs.rename(candidate, target); void vscode.window.showInformationMessage(`独立游戏已构建：${target}`);
      } finally { await frozen.dispose(); await fs.rm(candidate, { recursive: true, force: true }); }
    });
  });
  command('kakera.recovery', async () => {
    const session = await current(); assertWritable();
    const directory = path.join(session.storage, 'journal'); const names = await fs.readdir(directory).catch(() => []);
    if (!names.length) { void vscode.window.showInformationMessage('没有编辑恢复记录'); return; }
    const records = await Promise.all(names.filter(n => n.endsWith('.json')).map(async n => ({ file: path.join(directory, n), data: JSON.parse(await fs.readFile(path.join(directory, n), 'utf8')) })));
    const selected = await vscode.window.showQuickPick(records.reverse().map(r => ({ label: path.basename(r.file), description: r.data.phase, record: r }))); if (!selected) return;
    const choice = await vscode.window.showQuickPick(['查看原始恢复记录', '恢复事务前内容', '恢复事务后内容']); if (!choice) return;
    if (choice === '查看原始恢复记录') { await vscode.window.showTextDocument(vscode.Uri.file(selected.record.file)); return; }
    const edit = new vscode.WorkspaceEdit();
    for (const item of selected.record.data.files) {
      const uri = vscode.Uri.file(await safePath(session.root, contentPath(item.file))), doc = await vscode.workspace.openTextDocument(uri), hash = hashText(doc.getText());
      if (![item.beforeHash, item.afterHash].includes(hash)) throw new Error('文件有后续修改，拒绝覆盖；请查看记录并手工三方合并');
      edit.replace(uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), choice === '恢复事务前内容' ? item.before ?? '' : item.after);
    }
    await vscode.workspace.applyEdit(edit);
  });
  const treeNode = (value: unknown): TreeNode | undefined => value instanceof KakeraTreeItem ? value.node : undefined;
  command('kakera.tree.refresh', async () => {
    const session = await current(), loaded = await session.load();
    tree.loaded = loaded; tree.title = readGameTitle(loaded.sources).text; tree.syncView(); tree.emitter.fire();
  });
  command('kakera.character.create', async () => {
    assertWritable(); const session = await current(), loaded = await session.load();
    const name = await vscode.window.showInputBox({ title: '新建人物', prompt: '人物显示名', validateInput: value => value.trim() ? undefined : '人物名不能为空' }); if (!name?.trim()) return;
    await run(session, '新建人物', async signal => { const edit = editCharacter(loaded.sources, undefined, name.trim()); await session.apply(loaded, edit.changes, signal, { save: true }); });
  });
  command('kakera.character.rename', async (arg?: unknown) => {
    assertWritable(); const node = treeNode(arg); if (node?.kind !== 'character') throw new Error('请从人物条目重命名');
    const session = await current(), loaded = await session.load(), character = loaded.story.characters.find(c => c.id === node.id); if (!character) throw new Error('人物不存在');
    const name = await vscode.window.showInputBox({ title: '重命名人物', value: character.name, validateInput: value => value.trim() ? undefined : '人物名不能为空' }); if (!name?.trim() || name.trim() === character.name) return;
    await run(session, '重命名人物', async signal => { const edit = editCharacter(loaded.sources, character.id, name.trim()); await session.apply(loaded, edit.changes, signal, { save: true }); });
  });
  command('kakera.character.delete', async (arg?: unknown) => {
    assertWritable(); const node = treeNode(arg); if (node?.kind !== 'character') throw new Error('请从人物条目删除');
    const session = await current(), loaded = await session.load(), character = loaded.story.characters.find(c => c.id === node.id); if (!character) throw new Error('人物不存在');
    if (await vscode.window.showWarningMessage(`删除人物 ${character.name}？仍被立绘引用时会拒绝。`, { modal: true }, '删除') !== '删除') return;
    await run(session, '删除人物', async signal => { const changes = deleteCharacter(loaded.sources, character.id); await session.apply(loaded, changes, signal, { save: true }); });
  });
  command('kakera.variable.create', async () => {
    assertWritable(); const session = await current(), loaded = await session.load();
    const id = await vscode.window.showInputBox({ title: '新建变量', prompt: '变量名（不含点号前缀限制）', validateInput: value => /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(value) && !loaded.story.variables.some(v => v.id === value) ? undefined : '变量名无效或重复' }); if (!id) return;
    const type = await vscode.window.showQuickPick(['int', 'bool', 'string'], { title: '变量类型' }); if (!type) return;
    const initial = await vscode.window.showInputBox({ title: '初始值', value: type === 'int' ? '0' : type === 'bool' ? 'false' : '' }); if (initial === undefined) return;
    let min: string | undefined, max: string | undefined;
    if (type === 'int') { min = await vscode.window.showInputBox({ title: '下限（可留空）', prompt: 'i64 范围；留空表示不限制' }); if (min === undefined) return; max = await vscode.window.showInputBox({ title: '上限（可留空）', prompt: 'i64 范围；留空表示不限制' }); if (max === undefined) return; }
    await run(session, '新建变量', async signal => { const changes = addStoryVariable(loaded.sources, id, type as 'int' | 'bool' | 'string', initial, min || undefined, max || undefined); await session.apply(loaded, changes, signal, { save: true }); });
  });
  command('kakera.variable.edit', async (arg?: unknown) => {
    assertWritable(); const node = treeNode(arg); if (node?.kind !== 'variable') throw new Error('请从变量条目编辑');
    const session = await current(), loaded = await session.load(), variable = loaded.story.variables.find(v => v.id === node.id); if (!variable) throw new Error('变量不存在');
    const initial = await vscode.window.showInputBox({ title: `编辑变量 ${variable.id}`, value: variable.initial }); if (initial === undefined) return;
    let min: string | undefined, max: string | undefined;
    if (variable.type === 'int') { min = await vscode.window.showInputBox({ title: '下限（可留空）', value: variable.min ?? '' }); if (min === undefined) return; max = await vscode.window.showInputBox({ title: '上限（可留空）', value: variable.max ?? '' }); if (max === undefined) return; }
    await run(session, '编辑变量', async signal => { const changes = editStoryVariable(loaded.sources, variable.id, initial, variable.type === 'int' ? min : undefined, variable.type === 'int' ? max : undefined); await session.apply(loaded, changes, signal, { save: true }); });
  });
  command('kakera.variable.delete', async (arg?: unknown) => {
    assertWritable(); const node = treeNode(arg); if (node?.kind !== 'variable') throw new Error('请从变量条目删除');
    const session = await current(), loaded = await session.load(), variable = loaded.story.variables.find(v => v.id === node.id); if (!variable) throw new Error('变量不存在');
    if (variableUsedByRoutes(loaded.routes, variable.id)) throw new Error('变量仍被路线条件或更新引用，请先修改相关路线');
    if (await vscode.window.showWarningMessage(`删除变量 ${variable.id}？`, { modal: true }, '删除') !== '删除') return;
    await run(session, '删除变量', async signal => { const changes = deleteStoryVariable(loaded.sources, variable.id); await session.apply(loaded, changes, signal, { save: true }); });
  });
  command('kakera.frame.create', async (arg?: unknown) => {
    assertWritable(); const node = treeNode(arg); if (node?.kind !== 'frame') throw new Error('请从剧本幕条目新建后续幕');
    const session = await current(), loaded = await session.load();
    if (!loaded.routes || !loaded.logic.frames[node.ref]?.editable) throw new Error(loaded.logic.frames[node.ref]?.reason ?? '此幕尚未映射到可编辑路线');
    const file = loaded.logic.records.find(record => record.frame === node.ref)?.file ?? loaded.logic.appendFile!;
    await run(session, '新建后续幕', async signal => { const result = insertConnectedFrame(loaded.sources, loaded.routes!, file, node.ref, loaded.logic); await session.apply(loaded, result.changes, signal, { save: true }); });
  });
  command('kakera.frame.delete', async (arg?: unknown) => {
    assertWritable(); const node = treeNode(arg); if (node?.kind !== 'frame') throw new Error('请从剧本幕条目删除');
    const session = await current(), loaded = await session.load(); if (!loaded.routes) throw new Error('此工程尚未映射到可编辑路线');
    if (await vscode.window.showWarningMessage(`删除幕 ${node.ref}？相关入口/路线会按现有规则重连或保留待连接。`, { modal: true }, '删除') !== '删除') return;
    const file = loaded.logic.records.find(record => record.frame === node.ref)?.file ?? loaded.logic.appendFile!;
    await run(session, '删除幕', async signal => { const result = deleteConnectedFrame(loaded.sources, loaded.routes!, file, node.ref, loaded.logic); await session.apply(loaded, result.changes, signal, { save: true }); });
  });
  const treeView = vscode.window.createTreeView('kakera.project', { treeDataProvider: tree, showCollapseAll: true }); tree.view = treeView;
  void (async () => {
    try {
      const session = await current(), loaded = await session.load();
      tree.loaded = loaded; tree.title = readGameTitle(loaded.sources).text; tree.syncView(); tree.emitter.fire();
    } catch { /* 未打开 Kakera 工程时保留欢迎页 */ }
  })();
  context.subscriptions.push(output, diagnostics, tree.emitter, treeView, vscode.workspace.registerTextDocumentContentProvider('kakera-preview', preview), vscode.window.registerCustomEditorProvider('kakera.storyboard', provider, { supportsMultipleEditorsPerDocument: true }),
    vscode.debug.registerDebugAdapterDescriptorFactory('kakera', { async createDebugAdapterDescriptor() { assertWritable(); return new vscode.DebugAdapterInlineImplementation(new Adapter(await current(), playtests)); } }),
    vscode.workspace.onDidChangeTextDocument(() => scheduleRefresh()),
    vscode.workspace.onDidGrantWorkspaceTrust(() => { for (const [panel, session] of panels) void refresh(panel, session); }),
    { dispose: () => { uiImages.dispose(); for (const timer of refreshTimers.values()) clearTimeout(timer); if (treeTimer) clearTimeout(treeTimer); void playtests.stop(); } }
  );
}
export async function deactivate(): Promise<void> { await stopOwnedProcesses(); }
