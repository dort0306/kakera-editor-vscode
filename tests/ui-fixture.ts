import type { Sources } from '../packages/source/src/index';
import { parseXml, setAttribute } from '../packages/source/src/xml';
/** Only test fixtures are split here; production always edits original ranges. */
export function splitUiFixture(input: Sources): Sources {
  const sources = new Map(input), file = 'ui.xml', source = sources.get(file)!;
  const root = parseXml(source), screens = root.children.filter(n => n.tag === 'screen').map(n => source.slice(n.start, n.end)).join('\n');
  let entry = source.slice(0, root.openEnd) + '\n  <include src="ui/state.xml"/>\n  <include src="ui/pages.xml"/>\n' + source.slice(root.closeStart);
  entry = setAttribute(entry, parseXml(entry), 'title', ''); entry = setAttribute(entry, parseXml(entry), 'title-bind', 'ui.windowTitle');
  sources.set(file, entry);
  sources.set('ui/state.xml', '<ui schema="3"><variables><string id="windowTitle" initial="拆分界面"/><bool id="show" initial="true"/></variables></ui>');
  sources.set('ui/pages.xml', '<ui schema="3"><include src="ui/pages/hud.xml"/><screen id="settings"><label id="settings.caption" x="10" y="10" width="400" height="40" text="设置示例"/></screen></ui>');
  sources.set('ui/pages/hud.xml', '<ui schema="3">\n' + screens + '\n</ui>'); return sources;
}
export function uiFixture(): Sources {
  return splitUiFixture(new Map([
    ['story.xml', '<story schema="8" id="s" content-version="1" entry="a"><interface src="ui.xml"/><assets><image id="picture" src="picture.png"/><nine-patch id="nine" src="nine.9.png"/></assets><scripts><script src="routes.js"/><script src="ui.js"/></scripts><frames><frame id="a"><text>台词 🐈</text><options><option id="yes">好的</option><option id="no">再想想</option></options></frame></frames><next end="true"/></story>'],
    ['routes.js', 'frame("a").choice("yes",()=>"a");frame("a").choice("no",()=>"a");'],
    ['ui.js', '// 作者 JS，保持原文\r\nevent.register("advance", function (ctx) { ctx.advance(); });\r\nconst helper = () => "不要改写";\r\n'],
    ['ui.xml', `<ui schema="3" width="1280" height="720" initial="hud" title="标题"><screen id="hud" modal="false" pause="false"><!-- 作者布局 🐈 -->\r\n<panel id='panel' x='40' y='50' width='600' height='300' color='#182A3D'><label id='caption' x='10' y='20' width='400' height='40' text='原文 &amp; 备注'/></panel>\r\n<repeat id="list" x="700" y="100" width="400" height="300" source="choices" item-width="380" item-height="50" gap="8"><button id="choice" width="380" height="50" bind="item.text" event="advance"/></repeat><image id="picture.node" x="40" y="400" width="100" height="100" image="picture" region="0,0,1,1"/></screen></ui>`]
  ]));
}
