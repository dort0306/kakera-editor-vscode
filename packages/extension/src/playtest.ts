import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { launch, plainDiagnostic } from './tools';
import { Session, type Loaded } from './session';
import type { Frozen } from './files';
import { DebugClient } from '../../debug-adapter/src/client';
export interface Playing { frozen: Frozen; loaded: Loaded; debug?: DebugClient; pid?: number; stop: () => Promise<void> }
export class Playtests {
  current?: Playing;
  async start(session: Session, debug: boolean, signal?: AbortSignal): Promise<Playing> {
    if (this.current) throw new Error('请先停止当前试玩');
    const loaded = await session.load(), frozen = await session.freeze(loaded, undefined, signal);
    let tokenFile: string | undefined;
    try {
      await session.check(frozen, signal); await frozen.assertCurrent();
      if ((await session.load()).revision !== loaded.revision) throw new Error('试玩输入已过期');
      const saveDir = path.join(session.storage, 'saves', randomUUID()); await fs.mkdir(saveDir, { recursive: true });
      const args = ['--project', frozen.directory, '--save-dir', saveDir, ...await session.getEngineArgs()];
      const token = randomBytes(32).toString('hex');
      if (debug) {
        tokenFile = path.join(session.storage, `debug-${randomUUID()}.token`);
        await fs.writeFile(tokenFile, token, { flag: 'wx', mode: 0o600 });
        args.push('--debug-listen', '127.0.0.1:0', '--debug-token-file', tokenFile);
      }
      let accumulated = '', portResolve: (port: number) => void = () => {}, portReject: (e: Error) => void = () => {};
      const portPromise = debug ? new Promise<number>((resolve, reject) => { portResolve = resolve; portReject = reject; }) : undefined;
      const process = launch(await session.getPlayer(), args, text => {
        accumulated = (accumulated + text).slice(-8192); session.output.append(text);
        const match = /调试 API：127\.0\.0\.1:(\d+)/.exec(plainDiagnostic(accumulated)); if (match) portResolve(Number(match[1]));
      }, signal);
      let stopping = false;
      const stop = async () => {
        if (stopping) return; stopping = true;
        playing.debug?.dispose();
        if (process.child.exitCode === null) {
          // Windows GUI player: first request a normal window close; kill only our process if it does not exit.
          if (process.child.pid && globalThis.process.platform === 'win32') {
            const close = launch('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', `(Get-Process -Id ${process.child.pid} -ErrorAction SilentlyContinue).CloseMainWindow() | Out-Null`], () => {});
            await close.done.catch(() => {});
          }
          await Promise.race([process.done.catch(() => {}), new Promise(resolve => setTimeout(resolve, 1500))]);
          if (process.child.exitCode === null) process.child.kill();
          await process.done.catch(() => {});
        }
        if (tokenFile) await fs.rm(tokenFile, { force: true });
        await frozen.dispose(); if (this.current === playing) this.current = undefined;
      };
      const playing: Playing = { frozen, loaded, pid: process.child.pid, stop }; this.current = playing;
      process.done.then(() => portReject(new Error('播放器已退出')), () => portReject(new Error('播放器启动失败'))).finally(() => { void stop(); });
      if (portPromise) {
        const timer = setTimeout(() => portReject(new Error('15 秒内未发现调试端口')), 15000);
        try { playing.debug = new DebugClient(await portPromise, token); await playing.debug.request({ type: 'status' }); }
        catch (e) { await stop(); throw e; } finally { clearTimeout(timer); }
      }
      return playing;
    } catch (e) { if (tokenFile) await fs.rm(tokenFile, { force: true }); await frozen.dispose(); throw e; }
  }
  async stop(): Promise<void> { await this.current?.stop(); }
}
