import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { readStory, readManagedRoutes, analyzeLogic, readLocalizationConfig, localizationFiles, localizationIssues, storyLocalizationUsages, type LogicAnalysis, type Sources } from '../../source/src/index';
import { child, parseXml } from '../../source/src/xml';
import { validateRoutes, validateStory, type Story, type Route } from '../../domain/src/index';
import { contentPath, safePath, hashText, freezeContent, ensureDirectory, type Frozen } from './files';
import { WORKBENCH_FILE, readWorkbench } from '../../source/src/workbench';
import { loadUiFiles } from '../../source/src/ui-files';
import { launch } from './tools';
export interface Loaded { story: Story; sources: Sources; documents: Map<string, vscode.TextDocument>; versions: Map<string, number>; revision: string; routes?: Route[]; managedFile?: string; logic: LogicAnalysis }
export class Session {
  constructor(readonly root: string, readonly storage: string, readonly output: vscode.OutputChannel, readonly getPlayer: () => Promise<string>, readonly getEngineArgs: () => Promise<string[]> = async () => []) {}
  async load(): Promise<Loaded> {
    const sources = new Map<string, string>(), documents = new Map<string, vscode.TextDocument>(), versions = new Map<string, number>();
    const read = async (logical: string) => {
      contentPath(logical);
      if (!sources.has(logical)) {
        const file = await safePath(this.root, logical);
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
        if (doc.getText().length > 16 * 1024 * 1024) throw new Error('源码文件超过预算');
        sources.set(logical, doc.getText()); documents.set(logical, doc); versions.set(logical, doc.version);
      }
    };
    let next: string | undefined = 'story.xml'; const seen = new Set<string>();
    while (next) {
      if (seen.has(next) || seen.size >= 128) throw new Error('章节链循环或超限');
      seen.add(next); await read(next);
      const root = parseXml(sources.get(next)!); next = child(root, 'next')?.attrs.src;
    }
    const localizationConfig = readLocalizationConfig(sources);
    if (localizationConfig.enabled && localizationConfig.src) {
      await read(localizationConfig.src);
      for (const message of localizationFiles(sources).messages) await read(message);
    }
    const story = readStory(sources);
    for (const script of story.scripts) await read(script);
    const ui = child(parseXml(sources.get('story.xml')!), 'interface')?.attrs.src;
    if (ui) await loadUiFiles(ui, async file => { await read(file); return sources.get(file)!; });
    try { await read(WORKBENCH_FILE); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    const logic = analyzeLogic(sources, story); const routes = logic.routes;
    let managedFile: string | undefined;
    const managed = story.scripts.map(file => ({ file, routes: readManagedRoutes(sources.get(file)!) })).filter(item => item.routes !== undefined);
    if (managed.length === 1 && logic.complete) {
      try { validateRoutes(story, managed[0].routes!); managedFile = managed[0].file; } catch { /* other scripts may own routes */ }
    }
    return { story, sources, documents, versions, revision: hashText(JSON.stringify([...sources].map(([file, text]) => [file, versions.get(file), text]))), routes, managedFile, logic };
  }
  async freeze(loaded: Loaded, overrides = new Map<string, string>(), signal?: AbortSignal): Promise<Frozen> {
    const buffers = new Map(loaded.sources), dirtyVersions = new Map<vscode.TextDocument, number>();
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.uri.scheme !== 'file' || !doc.isDirty) continue;
      const relative = path.relative(this.root, doc.uri.fsPath).split(path.sep).join('/');
      if (!relative.startsWith('../') && relative !== '..' && !path.isAbsolute(relative)) { buffers.set(contentPath(relative), doc.getText()); dirtyVersions.set(doc, doc.version); }
    }
    for (const [file, text] of overrides) buffers.set(file, text);
    const frozen = await freezeContent(this.root, path.join(this.storage, 'generations'), buffers, signal);
    const assertDisk = frozen.assertCurrent;
    frozen.assertCurrent = async () => {
      await assertDisk();
      for (const [doc, version] of dirtyVersions) if (doc.version !== version) throw new Error('未保存文档已改变，快照过期');
    };
    try { await frozen.assertCurrent(); if ((await this.load()).revision !== loaded.revision) throw new Error('文档已改变，快照过期'); return frozen; }
    catch (e) { await frozen.dispose(); throw e; }
  }
  async check(frozen: Frozen, signal?: AbortSignal): Promise<void> {
    const player = await this.getPlayer();
    const args = await this.getEngineArgs();
    if (args.includes('--no-live2d')) this.output.appendLine('Live2D：显式静态回退校验，未进行 Core 原生模型校验。');
    await launch(player, ['--project', frozen.directory, '--check', '--no-audio', ...args], s => this.output.append(s), signal).done;
  }
  async apply(base: Loaded, changes: Map<string, string>, signal?: AbortSignal, options: { save?: boolean; metadataOnly?: boolean } = {}): Promise<void> {
    if (!vscode.workspace.isTrusted) throw new Error('需要信任工作区才能编辑');
    signal?.throwIfAborted();
    if (options.metadataOnly && [...changes.keys()].some(f => f !== WORKBENCH_FILE)) throw new Error('布局操作不可改写游戏源码');
    if ((await this.load()).revision !== base.revision) throw new Error('内容已改变，请刷新后重试；你的编辑尚未覆盖新内容');
    if (changes.has(WORKBENCH_FILE) && !base.documents.has(WORKBENCH_FILE)) {
      readWorkbench(changes.get(WORKBENCH_FILE)); await ensureDirectory(this.root, '.editor');
      const uri = vscode.Uri.file(path.join(this.root, WORKBENCH_FILE)), setup = new vscode.WorkspaceEdit();
      setup.createFile(uri, { overwrite: false }); setup.insert(uri, new vscode.Position(0, 0), JSON.stringify(readWorkbench()));
      if (!await vscode.workspace.applyEdit(setup)) throw new Error('无法创建编辑器布局文件');
      const doc = await vscode.workspace.openTextDocument(uri); if (!await doc.save()) throw new Error('无法保存编辑器布局文件');
      const refreshed = await this.load();
      for (const [file, old] of base.documents) if (old.version !== base.versions.get(file) || refreshed.sources.get(file) !== base.sources.get(file)) throw new Error('初始化布局期间源码已改变');
      base = refreshed;
    }
    changes = new Map([...changes].map(([file, text]) => {
      const doc = base.documents.get(file);
      return [file, doc ? text.replace(/\r\n|\r|\n/g, doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n') : text];
    }));
    const candidate = new Map([...base.sources, ...changes]);
    if (changes.has(WORKBENCH_FILE)) readWorkbench(changes.get(WORKBENCH_FILE));
    const story = readStory(candidate);
    const issues = validateStory(story).filter(i => i.severity === 'error');
    issues.push(...localizationIssues(story, storyLocalizationUsages(story)).filter(i => i.severity === 'error'));
    if (issues.length) throw new Error(issues.map(i => i.message).join('\n'));
    const logic = analyzeLogic(candidate, story);
    for (const [ref, frame] of Object.entries(base.logic.frames)) if (frame.editable && logic.frames[ref] && !logic.frames[ref].editable) throw new Error(`此修改使路线无法映射：${logic.frames[ref].reason}`);
    for (const frame of story.frames.filter(f => !base.story.frames.some(old => old.ref === f.ref))) if (!logic.frames[frame.ref]?.editable) throw new Error(`新幕缺少明确路由：${frame.ref}`);
    const frozen = options.metadataOnly ? undefined : await this.freeze(base, changes, signal);
    try {
      if (frozen) { await this.check(frozen, signal); await frozen.assertCurrent(); }
      if ((await this.load()).revision !== base.revision) throw new Error('验证期间源码已改变');
      signal?.throwIfAborted();
      await fs.mkdir(path.join(this.storage, 'journal'), { recursive: true });
      const journalFile = path.join(this.storage, 'journal', `${randomUUID()}.json`);
      const journal = { schema: 1, root: this.root, phase: 'validated', files: [...changes].map(([file, after]) => ({ file, before: base.sources.get(file), after, beforeHash: hashText(base.sources.get(file) ?? ''), afterHash: hashText(after) })) };
      await fs.writeFile(journalFile, JSON.stringify(journal), { flag: 'wx' });
      const edit = new vscode.WorkspaceEdit();
      for (const [file, text] of changes) {
        const doc = base.documents.get(file);
        if (!doc || doc.getText() !== base.sources.get(file)) throw new Error('源文档已改变或超出管理范围');
        // A minimal contiguous edit preserves surrounding bytes and host undo.
        const before = doc.getText(); let start = 0, oldEnd = before.length, newEnd = text.length;
        while (start < oldEnd && start < newEnd && before[start] === text[start]) start++;
        while (oldEnd > start && newEnd > start && before[oldEnd - 1] === text[newEnd - 1]) { oldEnd--; newEnd--; }
        edit.replace(doc.uri, new vscode.Range(doc.positionAt(start), doc.positionAt(oldEnd)), text.slice(start, newEnd));
      }
      // No await between final buffer-version check and handing edit to VS Code.
      for (const [file, doc] of base.documents) if (doc.version !== base.versions.get(file) || doc.getText() !== base.sources.get(file)) throw new Error('源缓冲已改变');
      journal.phase = 'applying'; await fs.writeFile(journalFile, JSON.stringify(journal));
      for (const [file, doc] of base.documents) if (doc.version !== base.versions.get(file) || doc.getText() !== base.sources.get(file)) throw new Error('源缓冲已改变');
      if (!await vscode.workspace.applyEdit(edit)) throw new Error('宿主拒绝文档编辑');
      journal.phase = 'applied'; await fs.writeFile(journalFile, JSON.stringify(journal)).catch(() => this.output.appendLine('文档已应用，但恢复记录状态未更新；请保留现有恢复记录。'));
      if (options.save) {
        const versions = new Map([...changes.keys()].map(file => [file, base.documents.get(file)!.version]));
        journal.phase = 'committing'; await fs.writeFile(journalFile, JSON.stringify(journal));
        try {
          for (const [file, expected] of changes) {
            signal?.throwIfAborted();
            const doc = base.documents.get(file)!;
            if (doc.version !== versions.get(file) || doc.getText() !== expected) throw new Error('保存期间出现其他编辑');
            if (!await doc.save()) throw new Error('文件未能保存，请检查文件权限');
            const disk = (await fs.readFile(doc.uri.fsPath, 'utf8')).replace(/^\uFEFF/, '');
            if (doc.getText() !== expected || disk !== expected) throw new Error('保存时内容被其他操作修改');
          }
          journal.phase = 'completed'; await fs.writeFile(journalFile, JSON.stringify(journal));
        } catch (e) {
          journal.phase = 'save_failed'; await fs.writeFile(journalFile, JSON.stringify(journal)).catch(() => {});
          throw new Error(`修改已保留在编辑器中，但自动保存未完成：${e instanceof Error ? e.message : '保存失败'}。可使用恢复记录处理，避免重复新建。`);
        }
      }
    } finally { await frozen?.dispose().catch(() => this.output.appendLine('私有候选清理失败，可在关闭播放器后清理缓存。')); }
  }
}
export async function findRoot(uri: vscode.Uri): Promise<string> {
  if (uri.scheme !== 'file') throw new Error('只支持本地文件工程');
  let directory = path.dirname(uri.fsPath);
  while (true) {
    try {
      const manifest = JSON.parse(await fs.readFile(path.join(directory, 'project.kakera-editor.json'), 'utf8'));
      if (manifest.editorSchema !== 1 || !['0.8.3', '0.8.4', '0.9.0', '0.9.1', '0.10.0', '0.10.1', '0.11.0', '0.11.1', '0.11.2'].includes(manifest.engineContract)) throw new Error('工程清单版本不支持');
      return await safePath(directory, manifest.contentRoot);
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    try { await fs.access(path.join(directory, 'story.xml')); return directory; } catch { /* ascend */ }
    const parent = path.dirname(directory); if (parent === directory) break; directory = parent;
  }
  throw new Error('未找到 story.xml 或工程清单');
}
