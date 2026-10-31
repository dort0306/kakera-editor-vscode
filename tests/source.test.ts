import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readStory, patchFrame, insertFrame, reorderFrames, parseXml, emitRoutes, readManagedRoutes } from '../packages/source/src/index';
import { i64, validateRoutes, type Route } from '../packages/domain/src/index';
const xml = `<?xml version="1.0"?>\r\n<!-- 保留 🐈 -->\r\n<story schema="8" id="test" content-version="1" entry="a"><frames>\r\n  <!-- 原注释 --> <frame id='a'><text><![CDATA[你好 < 世界 🐈]]></text></frame>\r\n  <frame id="b"><text>结束 &amp; 继续</text></frame>\r\n</frames><next end="true" /></story>`;
test('XML 范围在 CRLF、emoji、CDATA 下只修改选中 text 内容', () => {
  const after = patchFrame(xml, 'a', { text: '新台词 < & " 🐈' });
  assert.equal(after, xml.replace('<![CDATA[你好 < 世界 🐈]]>', '新台词 &lt; &amp; &quot; 🐈'));
  assert.equal(readStory(new Map([['story.xml', after]])).frames[0].text, '新台词 < & " 🐈');
});
test('属性值中 >、引号与相似字段不干扰范围补丁', () => {
  const original = xml.replace("id='a'", "id='a' name='alias' speaker='old' visual='x>y'");
  const after = patchFrame(original, 'alias', { speaker: 'new', visual: '' });
  assert.ok(after.includes('speaker="new"')); assert.ok(!after.includes("visual='x>y'"));
  assert.ok(after.includes("name='alias'")); assert.equal(readStory(new Map([['story.xml', after]])).frames[0].id, 'a');
});
test('表单提交未变字段时，CDATA、属性引号和音频/选项内注释逐字保留', () => {
  const original = xml.replace("id='a'", "id='a' speaker='narrator'").replace('</text></frame>', '</text><audio bgm=\'bgm\'><!-- 音频备注 --></audio><options><!-- 选项备注 --><option id=\'x\'>继续</option></options></frame>');
  const after = patchFrame(original, 'a', { text: '你好 < 世界 🐈', speaker: 'narrator', visual: '', audio: { bgm: 'bgm', voice: '', se: '' }, options: [{ id: 'x', text: '继续' }] });
  assert.equal(after, original);
});
test('复制获得新 ID，排序保留原文本、注释和稳定 ID', () => {
  const copy = insertFrame(xml, 'a', 'a'); const story = readStory(new Map([['story.xml', copy.source]]));
  assert.equal(story.frames.length, 3); assert.notEqual(copy.ref, 'a'); assert.equal(story.frames[1].text, story.frames[0].text);
  const moved = reorderFrames(xml, ['b', 'a']);
  assert.equal(readStory(new Map([['story.xml', moved]])).frames[1].id, 'a'); assert.ok(moved.includes('<!-- 原注释 -->')); assert.ok(moved.includes('<![CDATA[你好 < 世界 🐈]]>'));
});
test('DTD、未知实体、命名空间和坏 XML 拒绝', () => {
  for (const invalid of ['<!DOCTYPE story SYSTEM "file:///secret"><story />', '<story>&missing;</story>', '<story xmlns="x" />', '<story><frame></story>']) assert.throws(() => parseXml(invalid));
});
test('Managed BigInt/条件/更新确定性往返，任意手写代码为 Opaque', () => {
  const routes: Route[] = [{ frame: 'a', kind: 'choice', option: 'x', target: 'b', updates: [{ op: 'add', variable: 'score', value: { kind: 'constant', type: 'int', value: '-9223372036854775808' } }], guard: { kind: 'compare', op: '>=', left: { kind: 'variable', id: 'score' }, right: { kind: 'constant', type: 'int', value: '9007199254740993' } } }, { frame: 'b', kind: 'end', updates: [] }];
  const js = emitRoutes(routes); assert.deepEqual(readManagedRoutes(js), routes); assert.equal(emitRoutes(readManagedRoutes(js)!), js);
  for (const opaque of [js + '// 手写注释', js.replace('ctx.add', 'ctx.something'), js.replace('return "b"', 'return compute()'), 'frame("a").advance("b");']) assert.equal(readManagedRoutes(opaque), undefined);
});
test('i64 边界不经 Number 转换，越界与错误类型拒绝', () => {
  assert.equal(i64('9223372036854775807'), '9223372036854775807'); assert.equal(i64('-9223372036854775808'), '-9223372036854775808');
  for (const v of ['9223372036854775808', '-9223372036854775809', '1.1', '01', 'NaN']) assert.throws(() => i64(v));
});
test('路由不按分镜顺序推断、坏目标与选项不一致拒绝', () => {
  const story = readStory(new Map([['story.xml', xml]]));
  const routes: Route[] = [{ frame: 'a', kind: 'advance', target: 'b', updates: [] }, { frame: 'b', kind: 'end', updates: [] }];
  validateRoutes(story, routes);
  assert.throws(() => validateRoutes(story, [{ ...routes[0], target: 'missing' }, routes[1]]));
  assert.throws(() => validateRoutes(story, [{ ...routes[0], kind: 'choice', option: 'x' }, routes[1]]));
});
