import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { contentPath, ensureDirectory, hashFile, safePath } from './files';
export function modelDependencies(value: unknown): string[] {
  const model = value as { Version: number; FileReferences: Record<string, unknown> };
  if (!model || model.Version !== 3 || !model.FileReferences || typeof model.FileReferences !== 'object') throw new Error('需要 model3 Version 3 文件');
  const refs = model.FileReferences, paths = new Set<string>();
  const add = (v: unknown) => { if (typeof v !== 'string') throw new Error('模型依赖需要相对文件路径'); paths.add(contentPath(v)); };
  add(refs.Moc);
  if (!Array.isArray(refs.Textures) || !refs.Textures.length || refs.Textures.length > 16) throw new Error('模型需要 1–16 张贴图');
  refs.Textures.forEach(add);
  for (const key of ['Physics', 'Pose', 'DisplayInfo', 'UserData']) if (refs[key] !== undefined) add(refs[key]);
  if (refs.Expressions !== undefined) {
    if (!Array.isArray(refs.Expressions) || refs.Expressions.length > 128) throw new Error('模型表情列表无效');
    for (const entry of refs.Expressions) add(entry?.File);
  }
  if (refs.Motions !== undefined) {
    if (!refs.Motions || typeof refs.Motions !== 'object' || Array.isArray(refs.Motions)) throw new Error('模型动作列表无效');
    let count = 0;
    for (const group of Object.values(refs.Motions)) {
      if (!Array.isArray(group)) throw new Error('模型动作组无效');
      for (const entry of group) { if (++count > 256) throw new Error('模型动作超过 256 项'); add(entry?.File); if (entry?.Sound !== undefined) add(entry.Sound); }
    }
  }
  return [...paths];
}
export class CharacterImport {
  readonly relative = `assets/characters/${randomUUID()}`;
  readonly assets: { id: string; kind: 'image' | 'live2d'; src: string }[] = [];
  private licenseFile?: string;
  constructor(readonly root: string) {}
  private async copy(sourceRoot: string, sourceRelative: string, outputRelative: string, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    const file = await safePath(sourceRoot, sourceRelative), stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > 128 * 1024 * 1024) throw new Error('导入资源必须是最多 128MiB 的普通文件');
    const before = await hashFile(file, signal), directory = path.posix.dirname(outputRelative);
    await ensureDirectory(this.root, directory);
    const output = path.join(this.root, ...contentPath(outputRelative).split('/'));
    await fs.copyFile(file, output, fs.constants.COPYFILE_EXCL);
    if (await hashFile(file, signal) !== before || await hashFile(output, signal) !== before) throw new Error('导入期间素材发生变化，请重试');
  }
  async image(file: string, signal?: AbortSignal): Promise<string> {
    if (!/\.(png|jpe?g)$/i.test(file) || /\.9\.png$/i.test(file)) throw new Error('立绘需要普通 PNG/JPEG 图片，不能使用点九');
    if (this.assets.length >= 100) throw new Error('一次最多导入 100 项资源');
    const id = `portrait.${randomUUID()}`, src = `${this.relative}/${this.assets.length + 1}-${path.basename(file)}`;
    await this.copy(path.dirname(file), path.basename(file), src, signal); this.assets.push({ id, kind: 'image', src }); return id;
  }
  async model(file: string, signal?: AbortSignal): Promise<string> {
    if (!file.toLowerCase().endsWith('.model3.json')) throw new Error('请选择 .model3.json 文件');
    const root = path.dirname(file), original = await safePath(root, path.basename(file));
    if ((await fs.stat(original)).size > 8 * 1024 * 1024) throw new Error('模型 JSON 超过 8MiB');
    const hash = await hashFile(original, signal), model = JSON.parse(await fs.readFile(original, 'utf8'));
    const prefix = `${this.relative}/model-${randomUUID()}`;
    for (const relative of [path.basename(file), ...modelDependencies(model)]) await this.copy(root, relative, `${prefix}/${relative}`, signal);
    if (await hashFile(original, signal) !== hash) throw new Error('导入期间模型描述改变');
    const id = `model.${randomUUID()}`; this.assets.push({ id, kind: 'live2d', src: `${prefix}/${path.basename(file)}` }); return id;
  }
  async license(text: string): Promise<void> {
    if (!text.trim() || text.length > 16384) throw new Error('请填写授权来源，最多 16384 字符');
    const folder = await ensureDirectory(this.root, 'assets/licenses');
    this.licenseFile = path.join(folder, `characters-${randomUUID()}.txt`);
    await fs.writeFile(this.licenseFile, `人物素材授权记录\n${text}\n\n${this.assets.map(a => a.src).join('\n')}\n`, { flag: 'wx' });
  }
  async dispose(): Promise<void> {
    // This import owns a newly-generated UUID directory only; never delete sources.
    const target = path.resolve(this.root, ...contentPath(this.relative).split('/'));
    const relative = path.relative(path.resolve(this.root), target);
    if (relative.startsWith('..') || path.isAbsolute(relative) || !relative) throw new Error('导入暂存清理路径越界');
    await fs.rm(target, { recursive: true, force: true });
    if (this.licenseFile) await fs.rm(this.licenseFile, { force: true });
  }
}
