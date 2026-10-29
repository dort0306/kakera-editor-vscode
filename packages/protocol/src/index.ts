import type { CharacterLook, GameTitle, Route, Story } from '../../domain/src/index';
import type { LogicSummary } from '../../source/src/logic';
import type { Point } from '../../source/src/workbench';
import type { TextureUi } from '../../source/src/texture-source';
import type { NinePatchSpec, AtlasRegion } from '../../domain/src/textures';
import type { UiDesign, UiTextures } from '../../domain/src/ui';
export interface TexturePreview { assetId: string; hash: string; width: number; height: number; uri: string; spec?: NinePatchSpec; regions: AtlasRegion[]; ui: TextureUi }
export interface EditorState {
  revision: string; story?: Story; routes?: Route[]; managedFile?: string;
  issues: string[]; writable: boolean; images: Record<string, string>; selected?: string; appliedRequestId?: string;
  title?: GameTitle; characterLooks?: Record<string, CharacterLook[]>; live2dMode?: 'native' | 'fallback';
  logic?: LogicSummary;
  layout?: Record<string, Point>;
  ui?: UiDesign; uiTextures?: UiTextures; view?: 'story' | 'ui'; uiScreen?: string; uiSelected?: string;
}
export interface Message { version: 1; requestId: string; revision: string; type: 'ready' | 'preview' | 'source' | 'patch' | 'rename' | 'insert' | 'delete' | 'entry' | 'duplicate' | 'reorder' | 'visual' | 'variable' | 'deleteVariable' | 'title' | 'character' | 'characterLooks' | 'appearance' | 'layout' | 'reconnect' | 'textureOpen' | 'textureSave' | 'texturePack' | 'graphExport' | 'uiEdit' | 'uiSource'; payload: Record<string, unknown> }
export function readMessage(value: unknown): Message {
  if (!value || typeof value !== 'object' || JSON.stringify(value).length > 1024 * 1024) throw new Error('消息无效或超限');
  const m = value as Message;
  if (m.version !== 1 || typeof m.requestId !== 'string' || m.requestId.length > 128 || typeof m.revision !== 'string' || !['ready', 'preview', 'source', 'patch', 'rename', 'insert', 'delete', 'entry', 'duplicate', 'reorder', 'visual', 'variable', 'deleteVariable', 'title', 'character', 'characterLooks', 'appearance', 'layout', 'reconnect', 'textureOpen', 'textureSave', 'texturePack', 'graphExport', 'uiEdit', 'uiSource'].includes(m.type) || !m.payload || typeof m.payload !== 'object' || Array.isArray(m.payload)) throw new Error('不支持的编辑消息');
  return m;
}
