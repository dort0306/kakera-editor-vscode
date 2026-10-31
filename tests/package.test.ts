import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
test('原生工程侧栏按人物/美术/剧本/变量/JS 分类，并贡献新建删除右键菜单', () => {
  assert.ok(pkg.contributes.views.kakera.some((view: { id: string }) => view.id === 'kakera.project'));
  const commands = new Set<string>(pkg.contributes.commands.map((command: { command: string }) => command.command));
  for (const id of ['kakera.tree.refresh', 'kakera.character.create', 'kakera.character.rename', 'kakera.character.delete', 'kakera.variable.create', 'kakera.variable.edit', 'kakera.variable.delete', 'kakera.frame.open', 'kakera.frame.create', 'kakera.frame.delete', 'kakera.ui.source']) assert.ok(commands.has(id), id);
  const context = pkg.contributes.menus['view/item/context'] as { command: string; when: string }[];
  for (const command of context) assert.ok(commands.has(command.command), command.command);
  const has = (command: string, viewItem: string) => context.some(menu => menu.command === command && menu.when.includes(`viewItem == ${viewItem}`));
  for (const category of ['kakera.category.characters', 'kakera.category.art', 'kakera.category.frames', 'kakera.category.variables']) assert.ok(context.some(menu => menu.when.includes(category)), category);
  assert.ok(has('kakera.character.create', 'kakera.category.characters'));
  assert.ok(has('kakera.variable.create', 'kakera.category.variables'));
  assert.ok(has('kakera.frame.open', 'kakera.frame'));
  assert.ok(has('kakera.frame.create', 'kakera.frame'));
  assert.ok(has('kakera.frame.delete', 'kakera.frame'));
  assert.ok(has('kakera.variable.delete', 'kakera.variable'));
  assert.ok(has('kakera.character.delete', 'kakera.character'));
  assert.ok(has('kakera.ui.open', 'kakera.category.ui'));
  assert.ok(has('kakera.ui.source', 'kakera.uiFile'));
  assert.equal(pkg.scripts.package.includes(`-${pkg.version}.vsix`), true);
  assert.ok(pkg.contributes.menus['view/title'].some((menu: { command: string }) => menu.command === 'kakera.tree.refresh'));
});
test('没有打开文件夹时，资源管理器欢迎区提供“打开 Kakera 工程目录”按钮', () => {
  const welcome = pkg.contributes.viewsWelcome as { view: string; when?: string; contents: string }[];
  const explorer = welcome.find(item => item.view === 'explorer');
  assert.ok(explorer, '缺少资源管理器欢迎内容');
  assert.equal(explorer.when, 'workspaceFolderCount == 0');
  const links = [...explorer.contents.matchAll(/\[([^\]]+)\]\(command:([^)]+)\)/g)].map(match => ({ label: match[1], command: match[2] }));
  assert.deepEqual(links.map(link => link.label), ['打开 Kakera 工程目录']);
  const commands = new Set<string>(pkg.contributes.commands.map((command: { command: string }) => command.command));
  for (const link of links) assert.ok(commands.has(link.command), link.command);
  // A welcome entry without explanatory text would not tell authors which directory to pick.
  assert.match(explorer.contents, /story\.xml/);
  assert.match(explorer.contents, /工作区/);
});
