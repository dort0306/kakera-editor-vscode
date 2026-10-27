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
import { addAsset, appendGroup, emitRoutes, escapeXml, insertFrame, patchFrame, readStory, reorderFrames } from '../../source/src/index';
import { child, parseXml, setAttribute } from '../../source/src/xml';
import { endpoint, splitProposal, type AiProfile } from '../../ai-client/src/index';
import { archiveEntries } from './archive';

class Tree implements vscode.TreeDataProvider<vscode.TreeItem> {
  emitter = new vscode.EventEmitter<void>(); readonly onDidChangeTreeData = this.emitter.event;
  loaded?: Loaded;
  getTreeItem(item: vscode.TreeItem): vscode.TreeItem { return item; }
  getChildren(item?: vscode.TreeItem): vscode.TreeItem[] {
    if (item || !this.loaded) return [];
    const story = this.loaded.story;
    return [new vscode.TreeItem(`故事：${story.id}`), new vscode.TreeItem(`${story.frames.length} 幕 · ${story.assets.length} 个资源`), ...story.files.map(file => {
      const item = new vscode.TreeItem(file); item.iconPath = new vscode.ThemeIcon('file-code'); item.command = { command: 'kakera.storyboard.open', title: '分镜', arguments: [file] }; return item;
    }), ...story.variables.map(v => new vscode.TreeItem(`${v.id} = ${v.initial} (${v.type})`))];
  }
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
  function scheduleRefresh(session?: Session): void {
    for (const [panel, target] of panels) {
      if (session && session !== target) continue;
      const timer = refreshTimers.get(panel); if (timer) clearTimeout(timer);
      refreshTimers.set(panel, setTimeout(() => { refreshTimers.delete(panel); void refresh(panel, target); }, 150));
    }
  }
  const storage = context.globalStorageUri.fsPath;
  let active: Session | undefined;
  const tools = async () => {
    assertWritable();
    const override = vscode.workspace.getConfiguration('kakera').inspect<string>('tools.directory')?.globalValue;
    return toolchain(override || context.asAbsolutePath('resources/tools/win32-x64'));
  };
  async function sessionFor(uri: vscode.Uri): Promise<Session> {
    const root = await findRoot(uri);
    let session = sessions.get(root);
    if (!session) {
      session = new Session(root, path.join(storage, 'projects', hashText(root).slice(0, 24)), output, async () => (await tools()).player); sessions.set(root, session);
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(root), '**/*'));
      const target = session; context.subscriptions.push(watcher, watcher.onDidChange(() => scheduleRefresh(target)), watcher.onDidCreate(() => scheduleRefresh(target)), watcher.onDidDelete(() => scheduleRefresh(target)));
    }
    active = session; return session;
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
  const refreshSerial = new Map<vscode.WebviewPanel, number>();
  const selectedFrames = new Map<vscode.WebviewPanel, string>();
  async function refresh(panel: vscode.WebviewPanel, session: Session, appliedRequestId?: string): Promise<void> {
    if (appliedRequestId) lastApplied.set(panel, appliedRequestId);
    const serial = (refreshSerial.get(panel) ?? 0) + 1; refreshSerial.set(panel, serial);
    const state: EditorState = { revision: '', issues: [], writable: vscode.workspace.isTrusted && !vscode.env.remoteName && process.platform === 'win32', images: Object.create(null), appliedRequestId: lastApplied.get(panel) };
    try {
      const loaded = await session.load(); state.revision = loaded.revision; state.story = loaded.story; state.routes = loaded.routes; state.managedFile = loaded.managedFile;
      tree.loaded = loaded; tree.emitter.fire();
      state.issues = validateStory(loaded.story).map(i => i.message);
      if (!loaded.routes) state.issues.push('剧情脚本为高级逻辑，保留原文；新增幕和路由编辑暂不可用。');
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
      const needed = new Set([visual?.background, ...(visual?.portraits.map(p => p.image) ?? [])]);
      for (const asset of loaded.story.assets.filter(a => a.kind === 'image' && needed.has(a.id))) {
        if (!state.writable) continue;
        try {
          const file = await safePath(session.root, asset.src), stat = await fs.stat(file);
          if (stat.size > 8 * 1024 * 1024) { state.issues.push(`图片 ${asset.id} 超过静态预览 8MiB 预算，请使用播放器查看`); continue; }
          const hash = await hashFile(file), target = path.join(imageCache, `${hash}${path.extname(file).toLowerCase()}`);
          try { await fs.access(target); } catch { await fs.copyFile(file, target, fs.constants.COPYFILE_EXCL); }
          state.images[asset.id] = panel.webview.asWebviewUri(vscode.Uri.file(target)).toString();
        } catch { state.issues.push(`无法读取图片：${asset.id}`); }
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
      const ref = string(message.payload.ref); if (!loaded.story.frames.some(f => f.ref === ref)) throw new Error('未知幕');
      selectedFrames.set(panel, ref); await refresh(panel, session); return;
    }
    if (message.type === 'source') {
      const ref = string(message.payload.ref); const frame = loaded.story.frames.find(f => f.ref === ref);
      if (!frame) throw new Error('未知幕');
      await vscode.window.showTextDocument(loaded.documents.get(frame.file)!, { selection: new vscode.Range(frame.line - 1, 0, frame.line - 1, 0) }); return;
    }
    if (message.revision !== loaded.revision) throw new Error('分镜已过期，请刷新后重新编辑；旧草稿未应用');
    const applied = await run(session, '校验并应用分镜修改', async signal => {
      const changes = new Map<string, string>(); const ref = message.payload.ref === undefined ? '' : string(message.payload.ref);
      const frame = loaded.story.frames.find(f => f.ref === ref);
      if (['patch', 'insert', 'duplicate', 'reorder', 'visual'].includes(message.type) && !frame) throw new Error('幕不存在');
      if (message.type === 'patch') {
        const patch = message.payload.patch as Parameters<typeof patchFrame>[2];
        if (!patch || Object.keys(patch).some(k => !['text', 'speaker', 'visual', 'audio', 'options'].includes(k))) throw new Error('不支持的幕属性');
        if (patch.text !== undefined) string(patch.text);
        for (const field of ['speaker', 'visual'] as const) if (patch[field] !== undefined) string(patch[field], 256);
        changes.set(frame!.file, patchFrame(loaded.sources.get(frame!.file)!, ref, patch));
        if (message.payload.routes !== undefined) {
          if (!loaded.routes || !loaded.managedFile || !Array.isArray(message.payload.routes)) throw new Error('不可改写高级逻辑');
          const incoming = message.payload.routes as Route[];
          if (incoming.some(r => r.frame !== ref)) throw new Error('超出当前幕管理范围');
          const owned = loaded.routes.filter(r => r.frame === ref), first = loaded.routes.findIndex(r => r.frame === ref);
          const routes = loaded.routes.filter(r => r.frame !== ref); routes.splice(first, 0, ...incoming);
          validateRoutes(readStory(new Map([...loaded.sources, ...changes])), routes);
          if (emitRoutes(owned) !== emitRoutes(incoming)) changes.set(loaded.managedFile, emitRoutes(routes));
        } else if (patch.options) throw new Error('选项修改必须同时提供受管路由');
      } else if (message.type === 'insert' || message.type === 'duplicate') {
        if (!loaded.managedFile || !loaded.routes) throw new Error('高级逻辑不自动接管，请使用源码编辑');
        const result = insertFrame(loaded.sources.get(frame!.file)!, ref, message.type === 'duplicate' ? ref : undefined);
        changes.set(frame!.file, result.source);
        const added: Route[] = message.type === 'duplicate' ? loaded.routes.filter(r => r.frame === ref).map(r => ({ ...r, frame: result.ref })) : [{ frame: result.ref, kind: 'end', updates: [] }];
        changes.set(loaded.managedFile, emitRoutes([...loaded.routes, ...added]));
      } else if (message.type === 'reorder') {
        const refs = message.payload.refs;
        if (!Array.isArray(refs) || refs.some(r => typeof r !== 'string')) throw new Error('排序无效');
        changes.set(frame!.file, reorderFrames(loaded.sources.get(frame!.file)!, refs));
      } else if (message.type === 'visual') {
        const background = string(message.payload.background, 256), portraits = message.payload.portraits as { character: string; image: string; slot: string }[];
        if (background && !loaded.story.assets.some(a => a.id === background && a.kind === 'image')) throw new Error('背景图片不存在');
        if (!Array.isArray(portraits) || portraits.length > 3 || new Set(portraits.map(p => p.slot)).size !== portraits.length) throw new Error('立绘最多三槽且不能重复');
        for (const p of portraits) if (!['left', 'center', 'right'].includes(p.slot) || !loaded.story.assets.some(a => a.id === p.image && a.kind === 'image') || !loaded.story.characters.some(c => c.id === p.character)) throw new Error('立绘槽、人物或图片不合法');
        const id = `visual.${randomUUID()}`;
        const markup = `<visual id="${id}"${background ? ` background="${escapeXml(background)}"` : ''}>${portraits.map(p => `<portrait character="${escapeXml(p.character)}" image="${escapeXml(p.image)}" slot="${p.slot}" />`).join('')}</visual>`;
        changes.set(frame!.file, patchFrame(appendGroup(loaded.sources.get(frame!.file)!, 'visuals', markup), ref, { visual: id }));
      } else if (message.type === 'variable') {
        const id = string(message.payload.id, 128), type = string(message.payload.valueType, 16), initial = string(message.payload.initial, 4096);
        if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(id) || loaded.story.variables.some(v => v.id === id) || !['int', 'bool', 'string'].includes(type)) throw new Error('变量名称重复或类型无效');
        if (type === 'int') i64(initial); if (type === 'bool' && !['true', 'false'].includes(initial)) throw new Error('布尔值应为 true 或 false');
        changes.set('story.xml', appendGroup(loaded.sources.get('story.xml')!, 'variables', `<${type} id="${escapeXml(id)}" initial="${escapeXml(initial)}" />`));
      }
      if (!changes.size) throw new Error('没有可应用的变更');
      if (await showDiff(session, loaded, changes, signal)) { await session.apply(loaded, changes, signal); return true; }
      return false;
    });
    await refresh(panel, session, applied ? message.requestId : undefined);
    await panel.webview.postMessage({ type: 'settled', requestId: message.requestId });
  }
  const provider: vscode.CustomTextEditorProvider = {
    async resolveCustomTextEditor(document, panel) {
      try {
        const session = await sessionFor(document.uri); panels.set(panel, session);
        panel.webview.options = { enableScripts: true, localResourceRoots: [context.extensionUri] }; panel.webview.html = html(panel.webview);
        const seen = new Set<string>();
        const subscription = panel.webview.onDidReceiveMessage(value => {
          if (value?.type === 'command' && ['kakera.validate', 'kakera.playtest.start', 'kakera.playtest.stop', 'kakera.debug.start', 'kakera.asset.import', 'kakera.asset.references', 'kakera.build.run', 'kakera.ai.configure', 'kakera.recovery'].includes(value.command)) { active = session; void vscode.commands.executeCommand(value.command); return; }
          const id = value?.requestId;
          if (typeof id !== 'string' || seen.has(id)) return;
          seen.add(id); if (seen.size > 1024) seen.delete(seen.values().next().value!);
          void handle(session, value, panel).catch(e => panel.webview.postMessage({ type: 'error', requestId: id, message: e instanceof Error ? e.message : '操作失败' }));
        });
        panel.onDidChangeViewState(e => { if (e.webviewPanel.active) active = session; });
        panel.onDidDispose(() => { panels.delete(panel); refreshSerial.delete(panel); selectedFrames.delete(panel); lastApplied.delete(panel); const timer = refreshTimers.get(panel); if (timer) clearTimeout(timer); refreshTimers.delete(panel); subscription.dispose(); });
      } catch (e) { panel.webview.html = '<p>该文件不属于可识别的 Kakera 工程，请使用普通文本编辑器打开。</p>'; output.appendLine(String(e)); }
    }
  };
  const command = (id: string, handler: (...args: any[]) => unknown) => context.subscriptions.push(vscode.commands.registerCommand(id, async (...args: any[]) => {
    try { return await handler(...args); } catch (e) { const message = e instanceof Error ? e.message : '操作失败'; output.appendLine(message); void vscode.window.showErrorMessage(message); }
  }));
  command('kakera.home', () => {
    const panel = vscode.window.createWebviewPanel('kakera.home', 'Kakera 创作首页', vscode.ViewColumn.One, { enableScripts: true, localResourceRoots: [context.extensionUri] }); panel.webview.html = html(panel.webview);
    const allowed = ['kakera.project.create', 'kakera.project.open', 'kakera.storyboard.open', 'kakera.tools.configure', 'kakera.ai.configure', 'kakera.validate', 'kakera.playtest.start', 'kakera.build.run', 'kakera.debug.start', 'kakera.recovery'];
    panel.webview.onDidReceiveMessage(m => { if (m?.type === 'command' && allowed.includes(m.command)) void vscode.commands.executeCommand(m.command); });
  });
  command('kakera.project.open', async () => {
    const selected = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: '打开游戏工程' }); if (!selected?.[0]) return;
    const dir = selected[0].fsPath;
    let file = path.join(dir, 'story.xml');
    try { await fs.access(path.join(dir, 'project.kakera-editor.json')); file = path.join(dir, 'project.kakera-editor.json'); } catch { /* plain root */ }
    const session = await sessionFor(vscode.Uri.file(file)); await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(path.join(session.root, 'story.xml')), 'kakera.storyboard');
  });
  command('kakera.storyboard.open', async (relative?: string) => { const session = await current(); const file = relative && (await session.load()).story.files.includes(relative) ? relative : 'story.xml'; await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(await safePath(session.root, file)), 'kakera.storyboard'); });
  command('kakera.source.open', async () => { const session = await current(); await vscode.window.showTextDocument(vscode.Uri.file(path.join(session.root, 'story.xml'))); });
  command('kakera.project.create', async () => {
    assertWritable();
    const parent = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, openLabel: '选择新工程的父目录' }); if (!parent?.[0]) return;
    const name = await vscode.window.showInputBox({ title: '工程目录名', value: 'MyGame', validateInput: v => /^[A-Za-z0-9_-]+$/.test(v) ? undefined : '目录名使用英文字母、数字、下划线或连字符' }); if (!name) return;
    const target = path.join(parent[0].fsPath, name); await fs.mkdir(target); // Refuses overwrite.
    try {
      await fs.cp(context.asAbsolutePath('templates/minimal/content'), path.join(target, 'content'), { recursive: true, force: false, errorOnExist: true });
      let xml = await fs.readFile(path.join(target, 'content/story.xml'), 'utf8');
      const ids = new Map(['opening', 'journey', 'ending'].map(ref => [ref, randomUUID()]));
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
      await fs.writeFile(path.join(target, 'project.kakera-editor.json'), JSON.stringify({ editorSchema: 1, engineContract: '0.8.3', contentRoot: 'content' }, null, 2) + '\n');
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
  command('kakera.asset.import', async () => {
    const session = await current(); assertWritable();
    const files = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { '运行素材': ['png', 'jpg', 'jpeg', 'wav', 'ogg', 'mp4', 'ttf', 'otf'] } }); if (!files?.[0]) return;
    const source = files[0].fsPath; if ((await fs.lstat(source)).isSymbolicLink()) throw new Error('不导入链接文件');
    const id = await vscode.window.showInputBox({ title: '资源 ID', value: `asset.${randomUUID()}` }); if (!id || !/^[A-Za-z0-9_.-]+$/.test(id)) return;
    const license = await vscode.window.showInputBox({ title: '授权来源（随资源许可证保存）', prompt: '填写作者、来源与使用授权' }); if (!license?.trim()) throw new Error('请填写授权来源');
    await run(session, '导入资源', async signal => {
      const loaded = await session.load(); if (loaded.story.assets.some(a => a.id === id)) throw new Error('资源 ID 重复');
      const ext = path.extname(source).toLowerCase(), kind = ['.ttf', '.otf'].includes(ext) ? 'font' : ['.wav', '.ogg'].includes(ext) ? 'audio' : ext === '.mp4' ? 'video' : source.endsWith('.9.png') ? 'nine-patch' : 'image';
      const logical = `assets/imported/${randomUUID()}${kind === 'nine-patch' ? '.9.png' : ext}`;
      const outputFile = path.join(session.root, logical); await ensureDirectory(session.root, 'assets/imported');
      let applied = false, licenseFile: string | undefined;
      try {
        const before = await hashFile(source, signal); await fs.copyFile(source, outputFile, fs.constants.COPYFILE_EXCL);
        if (await hashFile(source, signal) !== before || await hashFile(outputFile, signal) !== before) throw new Error('导入期间源素材改变');
        const licenseDir = await ensureDirectory(session.root, 'assets/licenses'); licenseFile = path.join(licenseDir, `${id}-${randomUUID()}.txt`);
        await fs.writeFile(licenseFile, `${id}\n${license}\nSHA-256: ${before}\n`, { flag: 'wx' });
        const changes = new Map([['story.xml', addAsset(loaded.sources.get('story.xml')!, { id, src: logical, kind })]]);
        if (await showDiff(session, loaded, changes, signal)) { await session.apply(loaded, changes, signal); applied = true; }
      } finally { if (!applied) { await fs.rm(outputFile, { force: true }); if (licenseFile) await fs.rm(licenseFile, { force: true }); } }
    });
  });
  command('kakera.asset.references', async () => {
    const session = await current(), loaded = await session.load(); const asset = await vscode.window.showQuickPick(loaded.story.assets.map(a => ({ label: a.id, asset: a }))); if (!asset) return;
    const refs = loaded.story.frames.filter(f => loaded.story.visuals.some(v => v.id === f.visual && (v.background === asset.label || v.portraits.some(p => p.image === asset.label))) || Object.values(f.audio).includes(asset.label));
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
      let xml = loaded.sources.get('story.xml')!; const ids: string[] = [];
      for (const segment of segments) { const added = insertFrame(xml); xml = patchFrame(added.source, added.ref, { text: segment.text }); ids.push(added.ref); }
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
      const loaded = await session.load(), frozen = await session.freeze(loaded, undefined, signal), toolsInfo = await tools();
      const name = `${loaded.story.id}-${Date.now()}-${randomUUID().slice(0, 6)}`, candidate = path.join(parent[0].fsPath, `.${name}.candidate`), target = path.join(parent[0].fsPath, name);
      await fs.mkdir(candidate);
      try {
        await session.check(frozen, signal); await frozen.assertCurrent();
        if (await vscode.window.showInformationMessage(`将以 v0.8.3 依赖选择构建 ${loaded.story.id}。全部声明资源及 licenses、assets/licenses 中的许可证会入包；额外文件仅按 kakera.package.json。请确认授权与附加清单，动态路线需自行试玩覆盖。`, { modal: true }, '生成本地发行目录') !== '生成本地发行目录') return;
        const pack = path.join(candidate, 'game.kpak');
        await launch(toolsInfo.packer, [frozen.directory, pack, '--format', '2', '--level', '19'], s => output.append(s), signal).done;
        await launch(toolsInfo.player, ['--package', pack, '--check', '--no-audio'], s => output.append(s), signal).done;
        const entries = await archiveEntries(pack);
        await vscode.window.showTextDocument(preview.add('发行文件清单.txt', entries.map(e => `${e.path}\t${e.bytes} bytes`).join('\n')));
        if (await waitReview(vscode.window.showInformationMessage(`已展示 ${entries.length} 个实际包内文件。确认资源授权、许可证和隐私清单后完成发行目录。`, '完成发行目录', '取消'), signal) !== '完成发行目录') return;
        await frozen.assertCurrent(); if ((await session.load()).revision !== loaded.revision) throw new Error('构建期间输入已改变');
        await fs.copyFile(toolsInfo.player, path.join(candidate, 'kakera-avg.exe')); await fs.copyFile(context.asAbsolutePath('LICENSE'), path.join(candidate, 'LICENSE'));
        const manifest = { engineVersion: '0.8.3', revision: loaded.revision, sourceFingerprint: frozen.fingerprint, toolHashes: toolsInfo.hashes, packageHash: await hashFile(pack, signal), contentVersion: loaded.story.contentVersion, idPolicy: loaded.story.frames.every(f => f.id) ? 'explicit' : 'contains-implicit-ids', packageFiles: entries, checks: ['engine-check', 'package-check'], dynamicRoutes: '未穷举' };
        await fs.writeFile(path.join(candidate, 'build-manifest.json'), JSON.stringify(manifest, null, 2)); await fs.writeFile(path.join(candidate, '开始游戏.txt'), '双击 kakera-avg.exe 运行。许可证随游戏内容打包；本发行物不包含 Live2D Core。\n');
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
      edit.replace(uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), choice === '恢复事务前内容' ? item.before : item.after);
    }
    await vscode.workspace.applyEdit(edit);
  });
  context.subscriptions.push(output, diagnostics, tree.emitter, vscode.window.registerTreeDataProvider('kakera.project', tree), vscode.workspace.registerTextDocumentContentProvider('kakera-preview', preview), vscode.window.registerCustomEditorProvider('kakera.storyboard', provider, { supportsMultipleEditorsPerDocument: true }),
    vscode.debug.registerDebugAdapterDescriptorFactory('kakera', { async createDebugAdapterDescriptor() { assertWritable(); return new vscode.DebugAdapterInlineImplementation(new Adapter(await current(), playtests)); } }),
    vscode.workspace.onDidChangeTextDocument(() => scheduleRefresh()),
    vscode.workspace.onDidGrantWorkspaceTrust(() => { for (const [panel, session] of panels) void refresh(panel, session); }),
    { dispose: () => { for (const timer of refreshTimers.values()) clearTimeout(timer); void playtests.stop(); } }
  );
}
export async function deactivate(): Promise<void> { await stopOwnedProcesses(); }
