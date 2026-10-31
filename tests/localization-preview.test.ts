import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatFtlValue, messageParameters, parseFtl, type LocalizationCatalog } from '../packages/domain/src/localization';

function catalog(source: string, id = 'en-US'): LocalizationCatalog {
  const parsed = parseFtl('test.ftl', source);
  assert.deepEqual(parsed.issues, []);
  return { enabled: true, defaultText: id, voices: [], texts: [{ id, label: id, fonts: [], file: 'languages.xml', line: 1, messages: [{ src: 'test.ftl', file: 'test.ftl', entries: parsed.entries }] }] };
}

test('Fluent 预览解码引号内 Unicode 转义，保留普通反斜杠和负数', () => {
  const input = catalog(String.raw`escaped = { "\u4E00\U01F600" }
path = C:\new\test
negative = { -42 }
braces = \{ "literal" }
`);
  assert.equal(formatFtlValue(input, undefined, 'escaped'), '一😀');
  assert.equal(formatFtlValue(input, undefined, 'path'), String.raw`C:\new\test`);
  assert.equal(formatFtlValue(input, undefined, 'negative'), '-42');
  assert.equal(formatFtlValue(input, undefined, 'braces'), '\\literal');
  assert.ok(parseFtl('test.ftl', String.raw`bad = { "\n" }`).issues.length);
});

test('Fluent 引用仅在整条消息所属语言求解，缺消息才整条回退', () => {
  const input = catalog('message = English { -term }\n-term = term\n');
  input.texts.push({ ...input.texts[0], id: 'zh-CN', messages: [{ src: 'zh.ftl', file: 'zh.ftl', entries: parseFtl('zh.ftl', 'message = 中文 { -term }\n').entries }] });
  assert.throws(() => formatFtlValue(input, 'zh-CN', 'message'), /不存在/);
  input.texts[1].messages[0].entries = [];
  assert.equal(formatFtlValue(input, 'zh-CN', 'message'), 'English term');
});

test('Fluent select 按语言使用数值复数规则，字符串数值不自动变成复数', () => {
  const input = catalog('count = { $n ->\n    [one] one\n    [2] exact\n    [few] few\n   *[other] other\n    }\n', 'ru');
  assert.equal(formatFtlValue(input, undefined, 'count', { n: 2 }), 'exact');
  assert.equal(formatFtlValue(input, undefined, 'count', { n: 3 }), 'few');
  assert.equal(formatFtlValue(input, undefined, 'count', { n: '2' }), 'other');
  assert.throws(() => formatFtlValue(input, undefined, 'count'), /缺少参数/);
});

test('Fluent 预览拒绝循环、指数空引用和超过 UTF-8 输出预算', () => {
  const cyclic = catalog('a = { b }\nb = { a }\n');
  assert.throws(() => formatFtlValue(cyclic, undefined, 'a'), /循环/);
  const source = ['m0 = { "" }', ...Array.from({ length: 20 }, (_, i) => `m${i + 1} = { m${i} }{ m${i} }`)].join('\n');
  const exponential = catalog(source);
  assert.throws(() => messageParameters(exponential, 'en-US', 'm20'), /预算/);
  assert.throws(() => formatFtlValue(exponential, undefined, 'm20'), /预算/);
  assert.throws(() => formatFtlValue(catalog(`large = ${'中'.repeat(22000)}`), undefined, 'large'), /64KiB/);
});
