import type { Variable } from './index';
import type { NinePatchSpec } from './textures';
export const UI_KINDS = ['scene', 'panel', 'image', 'nine-patch', 'label', 'button', 'slider', 'toggle', 'repeat', 'color-picker'] as const;
export type UiKind = typeof UI_KINDS[number];
export const UI_CONTAINERS: readonly string[] = ['panel', 'nine-patch', 'repeat'];
const common = ['x', 'y', 'width', 'height', 'color', 'visible', 'enabled'];
export const UI_ATTRIBUTES: Record<UiKind, string[]> = {
  scene: common,
  panel: [...common, 'image', 'image-bind', 'fit', 'radius', 'effect', 'region', 'region-bind', 'color-bind'],
  image: [...common, 'image', 'image-bind', 'fit', 'effect', 'region', 'region-bind', 'color-bind'],
  'nine-patch': [...common, 'image', 'density', 'color-bind'],
  label: [...common, 'text', 'bind', 'font-size', 'color-bind'],
  button: [...common, 'text', 'bind', 'font-size', 'event', 'route', 'sound', 'image', 'hover-image', 'disabled-image', 'region', 'region-bind', 'radius', 'color-bind'],
  slider: [...common, 'value', 'min', 'max', 'event'],
  toggle: [...common, 'text', 'value', 'event', 'font-size', 'color-bind'],
  repeat: [...common, 'source', 'columns', 'item-width', 'item-height', 'gap'],
  'color-picker': ['x', 'y', 'width', 'height', 'visible', 'enabled', 'value', 'event', 'alpha']
};
export interface UiLocation { file: string; line: number }
export interface UiNode extends UiLocation { id: string; kind: UiKind; attrs: Record<string, string>; children: UiNode[] }
export interface UiScreen extends UiLocation { id: string; attrs: Record<string, string>; children: UiNode[] }
export interface UiVariable extends Variable, UiLocation {}
export interface UiPaletteSlot extends UiLocation { id: string; initial: string }
export interface UiGalleryEntry { id: string; image: string; title: string; unlocked: boolean; file?: string; line?: number; /** Added automatically from a <cg> resource, not declared in UI XML. */ implicit?: boolean }
export type UiEventCommand = 'open' | 'close' | 'advance' | 'restart' | 'choose' | 'setting' | 'sequence' | 'playSound' | 'soundEnabled' | 'soundActor' | 'soundExclude' | 'present' | 'resume' | 'unlock' | 'captureShortcut' | 'cancelShortcutCapture' | 'keybinding' | 'resetKeybindings' | 'colorPreference' | 'resetColors' | 'quit';
export interface UiEvent extends UiLocation {
  name: string;
  /** start/end are source ranges of the top-level on.ui registration. */
  start: number;
  end: number;
  editable: boolean;
  reason?: string;
  command?: UiEventCommand;
  target?: string;
  /** resume only: page opened before resuming. */
  page?: string;
  /** captureShortcut: stable action ID. */
  action?: string;
  /** captureShortcut: ordinary result event. */
  resultEvent?: string;
  /** keybinding: canonical binding or null (disabled). */
  binding?: string | null;
  /** colorPreference: declared palette slot. */
  slot?: string;
  /** colorPreference: canonical #RRGGBBAA or null (author default). */
  color?: string | null;
}
export interface LifecycleBinding { mode: 'none' | 'page' | 'frame' | 'continue'; target?: string; editable: boolean; reason?: string; file?: string; line?: number }
export interface LifecycleDesign { frameExit: Record<string, LifecycleBinding>; screenClose: Record<string, LifecycleBinding> }
export interface LifecycleEdit { action: 'lifecycle'; kind: 'frameExit' | 'screenClose'; owner: string; mode: LifecycleBinding['mode']; target?: string }
export interface UiMediaItem { id: string; kind: 'sound' | 'sequence'; file: string; attrs: Record<string, string>; steps: { kind: string; attrs: Record<string, string> }[] }
export interface UiDesign {
  lifecycle?: LifecycleDesign;
  media?: UiMediaItem[];
  entry: string; files: string[]; width: number; height: number; initial: string; attrs: Record<string, string>;
  screens: UiScreen[]; variables: UiVariable[]; palette: UiPaletteSlot[]; gallery: UiGalleryEntry[]; events: UiEvent[]; warnings: string[];
}
export interface UiTexture { uri: string; width: number; height: number; spec?: NinePatchSpec }
export type UiTextures = Record<string, UiTexture>;
export function uiNodes(nodes: UiNode[]): UiNode[] { return nodes.flatMap(n => [n, ...uiNodes(n.children)]); }
/** Serializable whitelist operation; the host validates every field again. */
export type UiEdit =
  | LifecycleEdit
  | { action: 'media'; item: UiMediaItem }
  | { action: 'patchNode'; id: string; patch: Record<string, string> }
  | { action: 'addNode'; screen: string; parent?: string; kind: UiKind; image?: string; event?: string; value?: string; alpha?: string; colorBind?: string }
  | { action: 'duplicateNode' | 'deleteNode'; id: string }
  | { action: 'moveNode'; id: string; parent?: string; screen: string; index: number }
  | { action: 'patchScreen'; id: string; patch: Record<string, string> }
  | { action: 'addScreen'; file: string; name?: string }
  | { action: 'deleteScreen'; id: string }
  | { action: 'patchRoot'; patch: Record<string, string> }
  | { action: 'palette'; original?: string; file: string; id: string; initial: string }
  | { action: 'deletePalette'; id: string }
  | { action: 'addPopup'; file: string; name?: string; title?: string; message?: string; confirmText?: string; cancelText?: string; accept?: 'close' | 'event' | 'quit'; event?: string }
  | { action: 'variable'; file: string; id?: string; name?: string; type: 'int' | 'bool' | 'string'; initial: string; min?: string; max?: string }
  | { action: 'event'; name: string; command: UiEventCommand; target?: string; /** resume only: open this screen before starting/restoring the story. */ page?: string; /** existing event name when editing instead of appending. */ original?: string; /** captureShortcut / keybinding action. */ actionValue?: string; /** captureShortcut result event. */ resultEvent?: string; /** keybinding canonical value or empty string for null. */ binding?: string; /** colorPreference slot. */ slot?: string; /** colorPreference color or empty string for null. */ color?: string }
  | { action: 'deleteEvent'; name: string }
  | { action: 'gallery'; original?: string; id: string; image: string; title: string; unlocked: boolean }
  | { action: 'deleteGallery'; id: string };
