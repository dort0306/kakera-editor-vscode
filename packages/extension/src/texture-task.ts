import { Worker } from 'node:worker_threads';
import type { NinePatchSpec, AtlasRegion } from '../../domain/src/textures';
export function textureTask(workerFile: string, request: Record<string, unknown>, signal?: AbortSignal): Promise<{ png: Uint8Array; width: number; height: number; spec?: NinePatchSpec; regions?: AtlasRegion[] }> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerFile, { resourceLimits: { maxOldGenerationSizeMb: 256 } }); let finished = false;
    const stop = (error?: Error, result?: any) => { if (finished) return; finished = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); void worker.terminate(); error ? reject(error) : resolve(result); };
    const abort = () => stop(new Error('已取消纹理处理'));
    const timer = setTimeout(() => stop(new Error('纹理处理超过 30 秒预算')), 30000);
    signal?.addEventListener('abort', abort, { once: true });
    worker.once('error', e => stop(e)); worker.once('exit', code => { if (!finished) stop(new Error(`纹理线程提前退出：${code}`)); });
    worker.once('message', message => message.error ? stop(new Error(message.error)) : stop(undefined, message.result)); worker.postMessage(request);
  });
}
