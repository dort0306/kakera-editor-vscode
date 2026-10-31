import { parse } from 'acorn';
import type { Sources } from './index';
import { readStory } from './index';
import type { UiBuiltinComponent, UiComponent, UiComponentProp, UiComponentPropType } from '../../domain/src/ui';

type Ast = Record<string, any>;

/** Engine §38.2: prop names are lowercase ASCII with digits and single hyphens, at most 64 bytes. */
const PROP_NAME = /^[a-z][a-z0-9-]{0,63}$/;
/** Engine §38.2: `x-` prefix, lowercase ASCII, digits and single hyphens, at most 64 bytes. */
const TAG_PATTERN = /^x-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PROP_TYPES: readonly UiComponentPropType[] = ['string', 'bool', 'int', 'number', 'binding', 'event'];
const VALUE_TYPES = ['bool', 'int', 'number', 'string'];
/** Instance layout attributes stay reserved; `id` is handled by the host. */
export const COMPONENT_LAYOUT_ATTRIBUTES = ['x', 'y', 'width', 'height', 'visible', 'enabled'];
const PROPERTY_KEYS = ['type', 'required', 'default', 'valueType', 'min', 'max', 'maxLength'];

export interface ComponentRegistry {
  components: UiComponent[];
  /** A `component.register` call or related dynamic usage the editor cannot prove. */
  uncertain: boolean;
  warnings: string[];
}

const literal = (n: Ast | undefined): string | number | boolean | undefined =>
  n?.type === 'Literal' && ['string', 'number', 'boolean'].includes(typeof n.value) ? n.value : undefined;

function parseProp(name: string, value: Ast | undefined): UiComponentProp | string {
  if (value?.type !== 'ObjectExpression') return `属性 ${name} 必须是对象`;
  const keys = value.properties.map((property: Ast) => property.type === 'Property' && !property.computed && property.key?.type === 'Identifier' ? property.key.name : undefined);
  if (keys.some((key: string | undefined) => !key) || new Set(keys).size !== keys.length) return `属性 ${name} 包含重复或计算键`;
  const entries = new Map<string, Ast>();
  for (const property of value.properties) entries.set(property.key.name, property.value);
  for (const key of keys) if (!PROPERTY_KEYS.includes(key)) return `属性 ${name} 使用未知键 ${key}`;
  const type = literal(entries.get('type'));
  if (typeof type !== 'string' || !PROP_TYPES.includes(type as UiComponentPropType)) return `属性 ${name} 的 type 无效`;
  const required = literal(entries.get('required'));
  if (required !== undefined && typeof required !== 'boolean') return `属性 ${name} 的 required 必须是布尔值`;
  const hasDefault = entries.has('default');
  if ((required === true) === hasDefault) return `属性 ${name} 必须恰好声明 required: true 或 default`;
  const fallback = hasDefault ? literal(entries.get('default')) : undefined;
  if (hasDefault && fallback === undefined) return `属性 ${name} 的 default 必须是字符串、数字或布尔值`;
  if (fallback !== undefined) {
    const ok = type === 'bool' ? typeof fallback === 'boolean'
      : type === 'int' ? typeof fallback === 'number' && Number.isSafeInteger(fallback)
        : type === 'number' ? typeof fallback === 'number' && Number.isFinite(fallback)
          : typeof fallback === 'string';
    if (!ok) return `属性 ${name} 的 default 与 ${type} 不匹配`;
  }
  const prop: UiComponentProp = { type: type as UiComponentPropType, required: required === true, ...(fallback !== undefined ? { default: String(fallback) } : {}) };
  const min = literal(entries.get('min')), max = literal(entries.get('max')), maxLength = literal(entries.get('maxLength')), valueType = literal(entries.get('valueType'));
  if (min !== undefined || max !== undefined) {
    if (type !== 'int' && type !== 'number') return `属性 ${name} 只有 int/number 可以使用 min/max`;
    if (typeof min !== 'number' || typeof max !== 'number' || !Number.isFinite(min) || !Number.isFinite(max) || min > max) return `属性 ${name} 的 min/max 无效`;
    prop.min = String(min); prop.max = String(max);
  }
  if (maxLength !== undefined) {
    if (type !== 'string' || typeof maxLength !== 'number' || !Number.isSafeInteger(maxLength) || maxLength < 1 || maxLength > 32768) return `属性 ${name} 的 maxLength 无效`;
    prop.maxLength = maxLength;
  }
  if (valueType !== undefined) {
    if (type !== 'binding' || typeof valueType !== 'string' || !VALUE_TYPES.includes(valueType)) return `属性 ${name} 的 valueType 无效`;
    prop.valueType = valueType as UiComponentProp['valueType'];
  }
  if (type === 'binding' && prop.valueType === undefined) return `属性 ${name} 是 binding，必须声明 valueType`;
  return prop;
}

/**
 * Reads `component.register("x-…", { props, expand })` definitions. Anything else that touches
 * `component` (aliases, dynamic names, calls inside functions) makes the registry unprovable so
 * instances are only reported instead of silently accepted.
 */
export function readComponents(sources: Sources): ComponentRegistry {
  const components: UiComponent[] = [], warnings: string[] = [];
  const seen = new Set<string>();
  let uncertain = false;
  let scripts: string[] = [];
  try { scripts = readStory(sources).scripts; } catch (e) { return { components, uncertain: true, warnings: [`组件注册无法读取：${e instanceof Error ? e.message : '脚本清单无效'}`] }; }
  for (const file of scripts) {
    const source = sources.get(file);
    if (source === undefined) { uncertain = true; warnings.push(`${file}：组件注册所在脚本缺失`); continue; }
    let ast: Ast;
    try { ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true }) as unknown as Ast; } catch { uncertain = true; warnings.push(`${file}：脚本无法解析，组件注册不确定`); continue; }
    const topCalls = new Set(ast.body.filter((statement: Ast) => statement.type === 'ExpressionStatement').map((statement: Ast) => statement.expression));
    const provenCalls = new Set<Ast>();
    for (const statement of ast.body) {
      if (statement.type !== 'ExpressionStatement') continue;
      const call = statement.expression;
      if (call?.type !== 'CallExpression' || call.callee?.type !== 'MemberExpression' || call.callee.computed) continue;
      const object = call.callee.object, method = call.callee.property?.name;
      if (object?.type !== 'Identifier' || object.name !== 'component') continue;
      if (method !== 'register') { uncertain = true; warnings.push(`${file}:${statement.loc.start.line}：component.${method} 不是受支持的注册方法`); continue; }
      provenCalls.add(call);
      const name = literal(call.arguments[0]);
      if (typeof name !== 'string' || !TAG_PATTERN.test(name) || name.length > 64) { uncertain = true; warnings.push(`${file}:${statement.loc.start.line}：组合标签名必须是 x- 前缀的小写短横线名（最多 64 字节）`); continue; }
      if (seen.has(name)) { warnings.push(`${file}:${statement.loc.start.line}：组合标签 ${name} 重复注册；播放器会拒绝`); continue; }
      const definition = call.arguments[1];
      if (call.arguments.length !== 2 || definition?.type !== 'ObjectExpression') { uncertain = true; warnings.push(`${file}:${statement.loc.start.line}：component.register(${name}) 需要 { props, expand }`); continue; }
      const keys = definition.properties.map((property: Ast) => property.type === 'Property' && !property.computed && property.key?.type === 'Identifier' ? property.key.name : undefined);
      if (keys.some((key: string | undefined) => !key) || keys.length !== 2 || !keys.includes('props') || !keys.includes('expand')) { uncertain = true; warnings.push(`${file}:${statement.loc.start.line}：${name} 的定义只能包含 props 与 expand`); continue; }
      const values = new Map<string, Ast>(); for (const property of definition.properties) values.set(property.key.name, property.value);
      const expand = values.get('expand')!;
      if (!['FunctionExpression', 'ArrowFunctionExpression'].includes(expand.type) || expand.async || expand.generator) { uncertain = true; warnings.push(`${file}:${statement.loc.start.line}：${name} 的 expand 必须是同步函数`); continue; }
      const propsNode = values.get('props')!;
      if (propsNode.type !== 'ObjectExpression') { uncertain = true; warnings.push(`${file}:${statement.loc.start.line}：${name} 的 props 必须是对象字面量`); continue; }
      const props: Record<string, UiComponentProp> = {};
      let broken: string | undefined;
      for (const property of propsNode.properties) {
        // Declared names may be quoted strings (kebab-case props cannot be identifiers).
        const key = property.type === 'Property' && !property.computed
          ? property.key?.type === 'Identifier' ? property.key.name : property.key?.type === 'Literal' && typeof property.key.value === 'string' ? property.key.value : undefined
          : undefined;
        if (!key) { broken = `${name} 的 props 包含计算或无效键`; break; }
        if (!PROP_NAME.test(key)) { broken = `${name} 的属性名 ${key} 必须是小写 ASCII、数字或连字符（最多 64 字节）`; break; }
        if (['id', ...COMPONENT_LAYOUT_ATTRIBUTES].includes(key)) { broken = `${name} 不能把布局属性 ${key} 声明为 prop`; break; }
        const parsed = parseProp(key, property.value);
        if (typeof parsed === 'string') { broken = parsed; break; }
        props[key] = parsed;
      }
      if (broken) { uncertain = true; warnings.push(`${file}:${statement.loc.start.line}：${broken}`); continue; }
      seen.add(name); components.push({ name, props, file, line: statement.loc.start.line });
      provenCalls.add(call);
    }
    // Any other `component` usage outside a proven top-level registration makes the registry unprovable.
    const walk = (node: Ast): void => {
      if (provenCalls.has(node)) return;
      for (const [key, value] of Object.entries(node)) {
        if (['loc', 'start', 'end'].includes(key)) continue;
        if (Array.isArray(value)) { for (const item of value) if (item?.type) walk(item); continue; }
        if (!value?.type) continue;
        if (value.type === 'Identifier' && value.name === 'component') {
          uncertain = true; warnings.push(`${file}:${value.loc?.start?.line ?? 0}：component 被保存或以动态方式使用，组件注册不确定`);
          return;
        }
        walk(value);
      }
    };
    walk(ast);
  }
  return { components, uncertain, warnings };
}

/** Splits a `;` separated component prop list; empty entries are kept so counts stay checkable. */
export function componentList(value: string): string[] { return value.split(';'); }

/** Source of the two components the editor inserts; also shipped in the new-project template. */
export const BUILTIN_COMPONENTS_SOURCE = `// Kakera v0.11.2 composition tags used by the editor's UI component library.
// They expand to ordinary UI 3 nodes; every event and UI variable stays author JS.
// Prop names are lowercase with hyphens because the engine restricts declared prop names.
component.register("x-tabs", {
  props: {
    labels: { type: "string", required: true },
    events: { type: "string", required: true },
    states: { type: "string", required: true },
    "tab-width": { type: "int", default: 140 },
    "mark-color": { type: "string", default: "#4DB4FFFF" }
  },
  expand({ props }) {
    const labels = props.labels.split(";"), events = props.events.split(";"), states = props.states.split(";");
    if (!labels.length || labels.length !== events.length || labels.length !== states.length) throw new Error("x-tabs 的 labels/events/states 数量必须一致");
    const width = props["tab-width"], children = [];
    for (let index = 0; index < labels.length; index++) {
      children.push({ tag: "button", attrs: { id: "tab" + (index + 1), x: index * (width + 8), y: 0, width: width, height: 44, text: labels[index], event: events[index] } });
      children.push({ tag: "panel", attrs: { id: "mark" + (index + 1), x: index * (width + 8), y: 46, width: width, height: 4, color: props["mark-color"], visible: states[index] } });
    }
    return { tag: "panel", attrs: { id: "$root", width: labels.length * (width + 8) - 8, height: 50 }, children };
  }
});

component.register("x-pagination", {
  props: {
    target: { type: "string", required: true },
    "prev-event": { type: "event", required: true },
    "next-event": { type: "event", required: true },
    "prev-text": { type: "string", default: "上一页" },
    "next-text": { type: "string", default: "下一页" },
    "text-width": { type: "int", default: 160 }
  },
  expand({ props }) {
    const width = props["text-width"], children = [
      { tag: "button", attrs: { id: "prev", x: 0, y: 0, width: 120, height: 44, text: props["prev-text"], enabled: "repeat." + props.target + ".canPrev", event: props["prev-event"] } },
      { tag: "label", attrs: { id: "text", x: 132, y: 8, width: width, height: 28, "font-size": 18, bind: "repeat." + props.target + ".pageText" } },
      { tag: "button", attrs: { id: "next", x: 144 + width, y: 0, width: 120, height: 44, text: props["next-text"], enabled: "repeat." + props.target + ".canNext", event: props["next-event"] } }
    ];
    return { tag: "panel", attrs: { id: "$root", width: 264 + width, height: 44 }, children };
  }
});
`;

/** Component names the editor can insert without an author-written registration. */
export function builtinComponentTag(kind: UiBuiltinComponent): string { return `x-${kind}`; }
