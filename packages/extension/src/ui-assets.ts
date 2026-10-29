import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import type { Loaded, Session } from './session';
import { textureBytes } from './texture-service';
import { textureTask } from './texture-task';
import type { UiTexture } from '../../domain/src/ui';
/** One bounded image worker at a time; immutable hash-addressed previews. */
export class UiImageCache {
  private queue: Promise<unknown> = Promise.resolve();
  private jobs = new Map<string, Promise<UiTexture>>();
  private controller = new AbortController();
  private pending = 0;
  dispose(): void { this.controller.abort(); this.jobs.clear(); }
  async prepare(session: Session, loaded: Loaded, id: string, worker: string): Promise<UiTexture> {
    this.controller.signal.throwIfAborted();
    if (this.pending >= 8) throw new Error('图片预览任务队列已满，请稍后刷新');
    const input = await textureBytes(session, loaded, id), key = `${session.storage}:${input.nine}:${input.hash}`;
    const found = this.jobs.get(key); if (found) return found;
    if (this.jobs.size >= 32) this.jobs.delete(this.jobs.keys().next().value!);
    this.pending++;
    const job = this.queue.catch(() => {}).then(async () => {
      this.controller.signal.throwIfAborted();
      const result = await textureTask(worker, { mode: 'inspect', ...input }, this.controller.signal);
      const folder = path.join(session.storage, 'images'); await fs.mkdir(folder, { recursive: true });
      const uri = path.join(folder, `ui-v1-${input.nine ? 'nine' : 'image'}-${input.hash}.png`);
      try { await fs.writeFile(uri, result.png, { flag: 'wx' }); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
      return { uri, width: result.width, height: result.height, spec: result.spec };
    }).finally(() => { this.pending--; });
    this.jobs.set(key, job); this.queue = job; job.catch(() => { if (this.jobs.get(key) === job) this.jobs.delete(key); }); return job;
  }
}
