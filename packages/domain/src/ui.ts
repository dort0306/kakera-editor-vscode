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
  label: [...common, 'text', 'bind', 'text-key', 'text-key-bind', 'font-size', 'color-bind'],
  button: [...common, 'text', 'bind', 'text-key', 'text-key-bind', 'font-size', 'event', 'route', 'sound', 'image', 'hover-image', 'disabled-image', 'region', 'region-bind', 'radius', 'color-bind'],
  slider: [...common, 'value', 'min', 'max', 'event'],
  toggle: [...common, 'text', 'text-key', 'text-key-bind', 'value', 'event', 'font-size', 'color-bind'],
  repeat: [...common, 'source', 'columns', 'item-width', 'item-height', 'gap'],
  'color-picker': ['x', 'y', 'width', 'height', 'visible', 'enabled', 'value', 'event', 'alpha']
};
export interface UiLocation { file: string; line: number }
export interface UiTextArg { name: string; value?: string; bind?: string }
export interface UiLocalizedText { /** Static message key (text-key / title-key). */ key?: string; /** Dynamic key held by a UI string variable (text-key-bind). */ keyBound?: boolean; args: UiTextArg[] }
export interface UiNode extends UiLocation { id: string; kind: UiKind; attrs: Record<string, string>; children: UiNode[]; localized?: UiLocalizedText }
export interface UiScreen extends UiLocation { id: string; attrs: Record<string, string>; children: UiNode[] }
export interface UiVariable extends Variable, UiLocation {}
export interface UiPaletteSlot extends UiLocation { id: string; initial: string }
export interface UiGalleryEntry { id: string; image: string; title: string; unlocked: boolean; file?: string; line?: number; /** Added automatically from a <cg> resource, not declared in UI XML. */ implicit?: boolean; /** v0.10.1 static title message key. */ titleKey?: string }
/** Static localization target collected from UI XML for coverage and argument checks. */
export interface UiTextUsage { key: string; file: string; line: number; label: string; arguments?: string[]; dynamic?: boolean }
export type UiEventCommand = 'open' | 'close' | 'advance' | 'restart' | 'choose' | 'setting' | 'setUi' | 'sequence' | 'playSound' | 'soundEnabled' | 'soundActor' | 'soundExclude' | 'present' | 'resume' | 'unlock' | 'captureShortcut' | 'cancelShortcutCapture' | 'keybinding' | 'resetKeybindings' | 'colorPreference' | 'resetColors' | 'quit' | 'locale';
export interface UiEvent extends UiLocation {
  /** Independent event ID registered through `event.register(name, callback)`. */
  name: string;
  /** 'event' = event.register(...); 'game' = the preserved `ui("$game").bind("game.enter", …)` hook. */
  kind: 'event' | 'game';
  /** start/end are source ranges of the top-level registration call. */
  start: number;
  end: number;
  editable: boolean;
  reason?: string;
  command?: UiEventCommand;
  /** Page/frame/asset/setting/variable target of the command, depending on command. setUi uses the UI variable ID without the ui. prefix. */
  commandTarget?: string;
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
  /** colorPreference: UI string variable read through ctx.ui instead of a literal color. */
  colorVariable?: string;
  /** locale: text/voice channel and canonical locale or null (follow system). */
  channel?: 'text' | 'voice';
  locale?: string | null;
  /** Control/page IDs proven to attach this definition through XML `event` or `ui(id).bind(id)`. */
  targets?: string[];
}
/** One proven reference from a control/page to an event definition (v0.11.1). */
export interface UiBinding extends UiLocation {
  /** Control template ID or page ID. `$game`/`$host` are reserved targets and never ordinary bindings. */
  target: string;
  /** Event ID for ordinary bindings; reserved name for legacy two-argument callbacks. */
  name: string;
  /** 'xml' event attribute/background reference, 'script' single-argument bind, 'legacy' removed two-argument bind. */
  kind: 'xml' | 'script' | 'legacy';
  /** Script statement range for script/legacy bindings; undefined for XML references. */
  start?: number;
  end?: number;
  editable?: boolean;
  reason?: string;
}
export interface LifecycleBinding { mode: 'none' | 'page' | 'frame' | 'continue'; target?: string; editable: boolean; reason?: string; file?: string; line?: number }
export interface LifecycleDesign { frameExit: Record<string, LifecycleBinding>; screenClose: Record<string, LifecycleBinding> }
export interface LifecycleEdit { action: 'lifecycle'; kind: 'frameExit' | 'screenClose'; owner: string; mode: LifecycleBinding['mode']; target?: string }
export interface UiMediaItem { id: string; kind: 'sound' | 'sequence'; file: string; attrs: Record<string, string>; steps: { kind: string; attrs: Record<string, string> }[] }
export interface UiDesign {
  lifecycle?: LifecycleDesign;
  media?: UiMediaItem[];
  entry: string; files: string[]; width: number; height: number; initial: string; attrs: Record<string, string>;
  screens: UiScreen[]; variables: UiVariable[]; palette: UiPaletteSlot[]; gallery: UiGalleryEntry[]; events: UiEvent[]; bindings: UiBinding[]; warnings: string[];
  /** Some event registration/binding was dynamic or removed syntax; event coverage cannot be proven. */
  eventUncertain?: boolean;
  /** Static text-key/title-key targets for the matching-engine coverage checks. */
  localizationUsages?: UiTextUsage[];
}
export interface UiTexture { uri: string; width: number; height: number; spec?: NinePatchSpec }
export type UiTextures = Record<string, UiTexture>;
export function uiNodes(nodes: UiNode[]): UiNode[] { return nodes.flatMap(n => [n, ...uiNodes(n.children)]); }
/** Serializable whitelist operation; the host validates every field again. */
export type UiEdit =
  | LifecycleEdit
  | { action: 'media'; item: UiMediaItem }
  | { action: 'patchNode'; id: string; patch: Record<string, string> }
  | { action: 'textArgs'; id: string; args: UiTextArg[] }
  | { action: 'addNode'; screen: string; parent?: string; kind: UiKind; image?: string; /** existing event.register ID referenced by the new control's XML event. */ event?: string; value?: string; alpha?: string; colorBind?: string }
  | { action: 'duplicateNode' | 'deleteNode'; id: string }
  | { action: 'moveNode'; id: string; parent?: string; screen: string; index: number }
  | { action: 'patchScreen'; id: string; patch: Record<string, string> }
  | { action: 'addScreen'; file: string; name?: string }
  | { action: 'deleteScreen'; id: string }
  | { action: 'patchRoot'; patch: Record<string, string> }
  | { action: 'palette'; original?: string; file: string; id: string; initial: string }
  | { action: 'deletePalette'; id: string }
  | { action: 'addPopup'; file: string; name?: string; title?: string; message?: string; confirmText?: string; cancelText?: string; accept?: 'close' | 'event' | 'quit'; /** existing event.register ID referenced by the generated confirm button. */ event?: string }
  | { action: 'variable'; file: string; id?: string; name?: string; type: 'int' | 'bool' | 'string'; initial: string; min?: string; max?: string }
  | { action: 'deleteVariable'; id: string }
  | { action: 'event'; name: string; /** optional new binding target for a newly created event: control/page ID, `$game`, or empty for an unbound definition. */ target?: string; command: UiEventCommand; targetValue?: string; /** resume only: open this screen before starting/restoring the story. */ page?: string; /** existing event ID when editing instead of appending. */ original?: string; /** captureShortcut / keybinding action. */ actionValue?: string; /** captureShortcut result event ID. */ resultEvent?: string; /** keybinding canonical value or empty string for null. */ binding?: string; /** colorPreference slot. */ slot?: string; /** colorPreference color or empty string for null. */ color?: string; /** colorPreference UI string variable read through ctx.ui. */ colorVariable?: string; /** locale channel. */ channel?: string; /** locale canonical ID or empty string for null. */ locale?: string }
  | { action: 'deleteEvent'; name: string }
  | { action: 'gallery'; original?: string; id: string; image: string; title: string; /** v0.10.1 static title message key; mutually exclusive with title. */ titleKey?: string; unlocked: boolean }
  | { action: 'deleteGallery'; id: string };
