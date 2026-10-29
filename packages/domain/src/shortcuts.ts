/** Mirrors the v0.10.0 keybinding token table closely enough for authoring validation.
 * The matching player remains the final validator; this module never writes preferences. */
export const SHORTCUT_ACTIONS = [
  { id: 'advance', label: '前进 / 补全', default: 'Space' },
  { id: 'fast_forward', label: '按住快进', default: 'Ctrl' },
  { id: 'skip_sequence', label: '跳过演出', default: 'Space' }
] as const;
export type ShortcutAction = typeof SHORTCUT_ACTIONS[number]['id'];
export const SHORTCUT_ACTION_IDS = SHORTCUT_ACTIONS.map(action => action.id) as ShortcutAction[];
const MODIFIERS = ['Ctrl', 'Alt', 'Shift'] as const;
const KEYS = new Set([
  'Space', 'Enter', 'Tab', 'Backspace', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown',
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Minus', 'Equal', 'BracketLeft', 'BracketRight', 'Backslash',
  'Semicolon', 'Quote', 'Backquote', 'Comma', 'Period', 'Slash', 'NumpadAdd', 'NumpadSubtract', 'NumpadMultiply',
  'NumpadDivide', 'NumpadDecimal', 'NumpadEnter',
  ...Array.from({ length: 26 }, (_, i) => `Key${String.fromCharCode(65 + i)}`),
  ...Array.from({ length: 10 }, (_, i) => `Digit${i}`),
  ...Array.from({ length: 10 }, (_, i) => `Numpad${i}`),
  ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`)
]);
const RESERVED = new Set(['Escape', 'Alt+F4', 'Alt+Tab', 'Alt+Escape', 'Alt+Space', 'Ctrl+Escape', 'Ctrl+Shift+Escape']);
const actionSet = new Set<string>(SHORTCUT_ACTION_IDS);
export function isShortcutAction(value: string | undefined): value is ShortcutAction { return !!value && actionSet.has(value); }
/** Accepts author spelling/case for tokens but stores the fixed modifier order. */
export function normalizeShortcutBinding(text: string, action: string): string {
  if (!isShortcutAction(action)) throw new Error('未知快捷键动作');
  if (typeof text !== 'string' || !text) throw new Error('快捷键不能为空');
  if (new TextEncoder().encode(text).length > 64 || !/^[\x20-\x7e]+$/.test(text)) throw new Error('快捷键必须是 64 字节以内的 ASCII');
  if (/\s/.test(text)) throw new Error('快捷键不能包含空白字符');
  const raw = text.split('+');
  if (raw.some(part => !part)) throw new Error('快捷键不能包含空段或多余的“+”');
  const modifiers: string[] = [];
  let key: string | undefined;
  for (const part of raw) {
    const token = [...MODIFIERS, ...KEYS].find(value => value.toLowerCase() === part.toLowerCase());
    if (!token) throw new Error(`未知键位标记「${part}」`);
    if ((MODIFIERS as readonly string[]).includes(token)) {
      if (modifiers.includes(token)) throw new Error(`快捷键包含重复的修饰键「${token}」`);
      modifiers.push(token);
    } else {
      if (key) throw new Error('快捷键只能有一个主键');
      key = token;
    }
  }
  if (!key) {
    if (action !== 'fast_forward') throw new Error('只有按住快进可以绑定单个修饰键');
    if (modifiers.length !== 1) throw new Error('纯修饰键绑定只能使用一个 Ctrl/Alt/Shift');
  }
  const ordered = MODIFIERS.filter(modifier => modifiers.includes(modifier));
  const canonical = [...ordered, ...(key ? [key] : [])].join('+');
  if (key === 'Escape') throw new Error('Escape 保留给快捷键捕获取消');
  if (ordered.includes('Ctrl') && ordered.includes('Alt')) throw new Error('不接受 Ctrl+Alt 组合，避免 AltGr/系统安全组合');
  if (RESERVED.has(canonical)) throw new Error('该组合是系统保留快捷键');
  return canonical;
}
/** Player-facing labels mirror v0.10.0's `Key::display`; never parse these back. */
const KEY_LABELS: Record<string, string> = {
  Space: '空格', Enter: '回车', Tab: '制表键', Backspace: '退格', Delete: '删除', Insert: '插入', Home: '行首', End: '行尾',
  PageUp: '向上翻页', PageDown: '向下翻页', ArrowLeft: '左方向键', ArrowRight: '右方向键', ArrowUp: '上方向键', ArrowDown: '下方向键',
  Minus: '减号', Equal: '等号', BracketLeft: '左方括号', BracketRight: '右方括号', Backslash: '反斜杠', Semicolon: '分号',
  Quote: '引号', Backquote: '反引号', Comma: '逗号', Period: '句点', Slash: '斜杠',
  NumpadAdd: '小键盘加号', NumpadSubtract: '小键盘减号', NumpadMultiply: '小键盘乘号', NumpadDivide: '小键盘除号',
  NumpadDecimal: '小键盘小数点', NumpadEnter: '小键盘回车'
};
for (let i = 0; i < 26; i++) KEY_LABELS[`Key${String.fromCharCode(65 + i)}`] = String.fromCharCode(65 + i);
for (let i = 0; i < 10; i++) { KEY_LABELS[`Digit${i}`] = String(i); KEY_LABELS[`Numpad${i}`] = `小键盘 ${i}`; }
for (let i = 1; i <= 12; i++) KEY_LABELS[`F${i}`] = `F${i} 功能键`;
export function shortcutDisplay(binding: string | null): string {
  if (binding === null) return '未绑定';
  const parts = binding.split('+');
  if (parts.length === 1 && (MODIFIERS as readonly string[]).includes(parts[0])) return `按住 ${parts[0]}`;
  const key = parts.at(-1) ?? '';
  return [...parts.slice(0, -1), KEY_LABELS[key] ?? key].join('+');
}
export function shortcutDefaults(): Record<ShortcutAction, string | null> { return Object.fromEntries(SHORTCUT_ACTIONS.map(action => [action.id, action.default])) as Record<ShortcutAction, string | null>; }
