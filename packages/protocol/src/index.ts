import type { Route, Story } from '../../domain/src/index';
export interface EditorState {
  revision: string; story?: Story; routes?: Route[]; managedFile?: string;
  issues: string[]; writable: boolean; images: Record<string, string>; selected?: string; appliedRequestId?: string;
}
export interface Message { version: 1; requestId: string; revision: string; type: 'ready' | 'preview' | 'source' | 'patch' | 'insert' | 'duplicate' | 'reorder' | 'visual' | 'variable'; payload: Record<string, unknown> }
export function readMessage(value: unknown): Message {
  if (!value || typeof value !== 'object' || JSON.stringify(value).length > 1024 * 1024) throw new Error('消息无效或超限');
  const m = value as Message;
  if (m.version !== 1 || typeof m.requestId !== 'string' || m.requestId.length > 128 || typeof m.revision !== 'string' || !['ready', 'preview', 'source', 'patch', 'insert', 'duplicate', 'reorder', 'visual', 'variable'].includes(m.type) || !m.payload || typeof m.payload !== 'object' || Array.isArray(m.payload)) throw new Error('不支持的编辑消息');
  return m;
}
