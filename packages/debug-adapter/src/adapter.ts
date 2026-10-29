import * as vscode from 'vscode';
import * as path from 'node:path';
import type { Session } from '../../extension/src/session';
import { Playtests, type Playing } from '../../extension/src/playtest';
import type { DebugState } from './client';
import { group, parseXml } from '../../source/src/xml';
export class Adapter implements vscode.DebugAdapter {
  private emitter = new vscode.EventEmitter<vscode.DebugProtocolMessage>();
  readonly onDidSendMessage = this.emitter.event;
  private sequence = 1;
  private playing?: Playing;
  private timer?: NodeJS.Timeout;
  private breakpoints = new Map<string, string[]>();
  private stateKey = '';
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private session: Session, private playtests: Playtests) {}
  handleMessage(message: any): void {
    if (message.type !== 'request') return;
    this.queue = this.queue.then(() => this.dispatch(message)).catch(e => this.reply(message, undefined, e instanceof Error ? e.message : '调试失败'));
  }
  private send(type: string, fields: Record<string, unknown>): void { this.emitter.fire({ seq: this.sequence++, type, ...fields } as vscode.DebugProtocolMessage); }
  private reply(request: any, body: unknown = {}, error?: string): void { this.send('response', { request_seq: request.seq, command: request.command, success: !error, body, ...(error ? { message: error } : {}) }); }
  private event(event: string, body: unknown = {}): void { this.send('event', { event, body }); }
  private notify(state: DebugState, force = false): void {
    const key = JSON.stringify([state.paused, state.frame_id, state.pending_frame, state.state_revision]);
    if ((force || key !== this.stateKey) && state.paused) this.event('stopped', { reason: state.pending_frame ? 'breakpoint' : 'pause', description: state.pending_frame ? '候选幕提交前；当前会话仍为旧幕' : '帧级暂停（推进可能只补全台词或转场）', threadId: 1, allThreadsStopped: true });
    this.stateKey = key;
  }
  private schedule(): void {
    const interval = Math.max(250, vscode.workspace.getConfiguration('kakera').get<number>('debug.pollIntervalMs', 500));
    this.timer = setTimeout(() => {
      if (this.playing && this.playtests.current !== this.playing) { this.playing = undefined; this.event('terminated'); return; }
      this.queue = this.queue.then(async () => { if (this.playing?.debug) this.notify(await this.playing.debug.request({ type: 'status' })); }).catch(() => { this.event('output', { category: 'stderr', output: '调试状态查询失败，将先查询状态后再控制。\n' }); }).finally(() => { if (this.playing) this.schedule(); });
    }, interval);
  }
  private async dispatch(req: any): Promise<void> {
    const args = req.arguments ?? {};
    if (req.command === 'initialize') { this.reply(req, { supportsConfigurationDoneRequest: true, supportsTerminateRequest: true, supportsConditionalBreakpoints: false, supportsEvaluateForHovers: false, supportsSetVariable: false }); return; }
    if (req.command === 'launch') {
      this.playing = await this.playtests.start(this.session, true); this.reply(req); this.event('initialized'); this.schedule(); return;
    }
    if (req.command === 'disconnect' || req.command === 'terminate') { await this.stop(); this.reply(req); this.event('terminated'); return; }
    if (!this.playing?.debug) throw new Error('调试会话未启动');
    const { debug, loaded } = this.playing;
    if (req.command === 'configurationDone') { this.reply(req); this.notify(await debug.request({ type: 'status' }), true); return; }
    if (req.command === 'threads') { this.reply(req, { threads: [{ id: 1, name: '剧情帧' }] }); return; }
    if (req.command === 'setBreakpoints') {
      const files = loaded.story.files, sourceRef = args.source?.sourceReference;
      const file = sourceRef ? files[sourceRef - 1] : path.relative(this.session.root, args.source?.path ?? '').split(path.sep).join('/');
      const source = loaded.sources.get(file), nodes = source ? group(parseXml(source), 'frames') : [];
      const results = (args.breakpoints ?? []).map((bp: any) => {
        if (bp.condition || bp.hitCondition || bp.logMessage || !source) return { verified: false, line: bp.line, message: '仅支持 XML frame 的无条件断点' };
        const node = nodes.find(n => { const first = source.slice(0, n.start).split('\n').length, last = source.slice(0, n.end).split('\n').length; return bp.line >= first && bp.line <= last; });
        return node ? { verified: true, line: source.slice(0, node.start).split('\n').length, ref: node.attrs.id || node.attrs.name } : { verified: false, line: bp.line, message: '该行不在冻结代次的 frame 内' };
      });
      this.breakpoints.set(file, results.filter((r: any) => r.verified).map((r: any) => r.ref));
      await debug.request({ type: 'breakpoints', frames: [...new Set([...this.breakpoints.values()].flat())] });
      this.reply(req, { breakpoints: results.map(({ ref, ...rest }: any) => rest) }); return;
    }
    if (req.command === 'stackTrace') {
      const state = await debug.request({ type: 'status' });
      const frame = loaded.story.frames.find(f => f.id === (state.pending_frame ?? state.frame_id) || f.name === (state.pending_frame ?? state.frame_name));
      this.reply(req, { stackFrames: frame ? [{ id: 1, name: `${state.pending_frame ? '提交前候选：' : '当前幕：'}${frame.ref}`, source: { name: frame.file, sourceReference: loaded.story.files.indexOf(frame.file) + 1 }, line: frame.line, column: 1 }] : [], totalFrames: frame ? 1 : 0 }); return;
    }
    if (req.command === 'source') { const file = loaded.story.files[(args.sourceReference ?? args.source?.sourceReference) - 1]; this.reply(req, { content: loaded.sources.get(file) ?? '', mimeType: 'application/xml' }); return; }
    if (req.command === 'scopes') { this.reply(req, { scopes: [{ name: '当前剧情变量', variablesReference: 1, expensive: false }, { name: '候选变量（尚未提交）', variablesReference: 2, expensive: false }, { name: 'UI 变量', variablesReference: 3, expensive: false }, { name: '暂停与阻挡状态', variablesReference: 4, expensive: false }] }); return; }
    if (req.command === 'variables') {
      const s = await debug.request({ type: 'status' });
      const values = args.variablesReference === 1 ? s.variables : args.variablesReference === 2 ? s.pending_variables ?? {} : args.variablesReference === 3 ? s.ui_variables : Object.fromEntries(['game_started', 'frame_id', 'frame_name', 'pending_frame', 'reason', 'text_complete', 'transitioning', 'menu_paused', 'host_prompt', 'video_playing'].map(k => [k, { type: 'state', value: s[k] }]));
      this.reply(req, { variables: Object.entries(values).map(([name, item]) => ({ name, value: typeof item.value === 'string' ? item.value : JSON.stringify(item.value), type: item.type, variablesReference: 0, presentationHint: { attributes: ['readOnly'] } })) }); return;
    }
    const command = ({ pause: 'pause', continue: 'resume', next: 'advance' } as Record<string, string>)[req.command];
    if (command) {
      const state = await debug.request({ type: command }); this.reply(req, req.command === 'continue' ? { allThreadsContinued: true } : {});
      if (!state.paused) this.event('continued', { threadId: 1, allThreadsContinued: true }); else this.notify(state, true); return;
    }
    throw new Error('此请求超出帧级调试能力；不支持 JS 求值、改变量或任意跳转');
  }
  private async stop(): Promise<void> { if (this.timer) clearTimeout(this.timer); const playing = this.playing; this.playing = undefined; await playing?.stop(); }
  dispose(): void { void this.stop(); this.emitter.dispose(); }
}
