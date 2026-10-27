import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { readStory, readManagedRoutes, emitRoutes, type Sources } from '../../source/src/index';
import { child, parseXml } from '../../source/src/xml';
import { validateRoutes, validateStory, type Story, type Route } from '../../domain/src/index';
import { contentPath, safePath, hashText, freezeContent, type Frozen } from './files';
import { launch } from './tools';
export interface Loaded { story: Story; sources: Sources; documents: Map<string, vscode.TextDocument>; versions: Map<string, number>; revision: string; routes?: Route[]; managedFile?: string }
export class Session {
  constructor(readonly root: string, readonly storage: string, readonly output: vscode.OutputChannel, readonly getPlayer: () => Promise<string>) {}
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
    const story = readStory(sources);
    for (const script of story.scripts) await read(script);
    const ui = child(parseXml(sources.get('story.xml')!), 'interface')?.attrs.src;
    if (ui) await read(ui);
    let routes: Route[] | undefined, managedFile: string | undefined;
    const managed = story.scripts.map(file => ({ file, routes: readManagedRoutes(sources.get(file)!) })).filter(item => item.routes !== undefined);
    if (managed.length === 1) {
      try { validateRoutes(story, managed[0].routes!); routes = managed[0].routes; managedFile = managed[0].file; } catch { /* inconsistent scripts stay read-only */ }
    }
    return { story, sources, documents, versions, revision: hashText(JSON.stringify([...sources].map(([file, text]) => [file, versions.get(file), text]))), routes, managedFile };
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
    await launch(player, ['--project', frozen.directory, '--check', '--no-audio'], s => this.output.append(s), signal).done;
  }
  async apply(base: Loaded, changes: Map<string, string>, signal?: AbortSignal): Promise<void> {
    if (!vscode.workspace.isTrusted) throw new Error('需要信任工作区才能编辑');
    if ((await this.load()).revision !== base.revision) throw new Error('源码已改变，请重新审阅');
    const candidate = new Map([...base.sources, ...changes]);
    const story = readStory(candidate);
    const issues = validateStory(story).filter(i => i.severity === 'error');
    if (issues.length) throw new Error(issues.map(i => i.message).join('\n'));
    if (base.managedFile) validateRoutes(story, readManagedRoutes(candidate.get(base.managedFile)!) ?? []);
    const frozen = await this.freeze(base, changes, signal);
    try {
      await this.check(frozen, signal); await frozen.assertCurrent();
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
    } finally { await frozen.dispose().catch(() => this.output.appendLine('私有候选清理失败，可在关闭播放器后清理缓存。')); }
  }
}
export async function findRoot(uri: vscode.Uri): Promise<string> {
  if (uri.scheme !== 'file') throw new Error('只支持本地文件工程');
  let directory = path.dirname(uri.fsPath);
  while (true) {
    try {
      const manifest = JSON.parse(await fs.readFile(path.join(directory, 'project.kakera-editor.json'), 'utf8'));
      if (manifest.editorSchema !== 1 || manifest.engineContract !== '0.8.3') throw new Error('工程清单版本不支持');
      return await safePath(directory, manifest.contentRoot);
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    try { await fs.access(path.join(directory, 'story.xml')); return directory; } catch { /* ascend */ }
    const parent = path.dirname(directory); if (parent === directory) break; directory = parent;
  }
  throw new Error('未找到 story.xml 或工程清单');
}
