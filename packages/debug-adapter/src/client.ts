import { createConnection, type Socket } from 'node:net';
export interface DebugState { protocol: string; version: number; process_id: number; engine_version: string; state_revision: number; paused: boolean; game_started?: boolean; frame_id: string | null; frame_name: string | null; pending_frame: string | null; variables: Record<string, { type: string; value: string | boolean }>; pending_variables: Record<string, { type: string; value: string | boolean }> | null; ui_variables: Record<string, { type: string; value: string | boolean }>; reason: string; available_options: { id: string; text: string }[]; [key: string]: unknown }
export class DebugClient {
  private socket?: Socket;
  private nextId = 1;
  private queue: Promise<unknown> = Promise.resolve();
  private buffer = Buffer.alloc(0);
  private waiter?: { id: number; resolve: (state: DebugState) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };
  state?: DebugState;
  private processId?: number;
  constructor(readonly port: number, private token: string) { if (!Number.isInteger(port) || port < 1 || port > 65535 || !/^[A-Za-z0-9_-]{32,128}$/.test(token)) throw new Error('调试连接参数无效'); }
  async request(command: { type: string; frames?: string[]; option?: string }): Promise<DebugState> {
    const result = this.queue.then(async () => {
      if (!this.socket || this.socket.destroyed) this.state = undefined;
      if (command.type !== 'status' && !this.state) await this.send({ type: 'status' });
      try { return await this.send(command); }
      catch (e) { this.state = undefined; throw e; } // Next control first obtains fresh status; never auto-repeat a control.
    });
    this.queue = result.catch(() => {}); return result;
  }
  private async connect(): Promise<void> {
    if (this.socket && !this.socket.destroyed) return;
    this.buffer = Buffer.alloc(0);
    const socket = createConnection({ host: '127.0.0.1', port: this.port }); this.socket = socket;
    socket.on('data', bytes => {
      this.buffer = Buffer.concat([this.buffer, bytes]);
      if (this.buffer.length > 2 * 1024 * 1024 + 1) { this.fail(new Error('调试响应超限')); socket.destroy(); return; }
      const end = this.buffer.indexOf(10); if (end < 0) return;
      const frame = this.buffer.subarray(0, end); this.buffer = this.buffer.subarray(end + 1);
      try {
        const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(frame));
        if (!this.waiter || value.version !== 1 || value.id !== this.waiter.id) throw new Error('调试响应 ID/版本不一致');
        if (!value.ok) throw new Error(`播放器拒绝控制请求：${String(value.error ?? '请刷新状态后检查操作条件')}`);
        const state = value.result as DebugState;
        if (state.protocol !== 'KakeraEditorDebug' || state.version !== 1 || !['0.8.3', '0.8.4', '0.9.0', '0.9.1', '0.10.0', '0.10.1', '0.11.0'].includes(state.engine_version) || !Number.isSafeInteger(state.state_revision) || (this.processId !== undefined && state.process_id !== this.processId)) throw new Error('调试协议、引擎、进程或修订不兼容');
        this.processId = state.process_id; this.state = state;
        const waiter = this.waiter; this.waiter = undefined; clearTimeout(waiter.timer); waiter.resolve(state);
      } catch (e) { this.fail(e as Error); socket.destroy(); }
    });
    socket.on('error', () => { if (this.socket === socket) { this.state = undefined; this.fail(new Error('调试连接失败；操作可能已执行，请先刷新状态')); } });
    socket.on('close', () => { if (this.socket === socket) { this.state = undefined; this.fail(new Error('调试连接断开；操作可能已执行，请先刷新状态')); } });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { socket.destroy(); reject(new Error('调试连接超时')); }, 5000);
      socket.once('connect', () => { clearTimeout(timer); resolve(); });
      socket.once('error', () => { clearTimeout(timer); reject(new Error('调试连接失败')); });
    });
  }
  private async send(command: { type: string; frames?: string[]; option?: string }): Promise<DebugState> {
    if (!['status', 'pause', 'resume', 'breakpoints', 'advance', 'choose', 'reveal', 'skip_transition'].includes(command.type)) throw new Error('不支持的调试命令');
    await this.connect();
    if (!Number.isSafeInteger(this.nextId)) throw new Error('请求 ID 已耗尽，需重启播放器');
    const id = this.nextId++;
    const bytes = Buffer.from(JSON.stringify({ version: 1, id, token: this.token, ...(command.type !== 'status' ? { expected_revision: this.state!.state_revision } : {}), command }) + '\n');
    if (bytes.length > 65537) throw new Error('调试请求超限');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.fail(new Error('调试超时；操作可能已经执行')); this.socket?.destroy(); }, 7000);
      this.waiter = { id, resolve, reject, timer }; this.socket!.write(bytes);
    });
  }
  private fail(e: Error): void { const w = this.waiter; this.waiter = undefined; if (w) { clearTimeout(w.timer); w.reject(e); } }
  dispose(): void { this.fail(new Error('调试会话已关闭')); this.socket?.destroy(); this.socket = undefined; this.token = ''; this.state = undefined; }
}
