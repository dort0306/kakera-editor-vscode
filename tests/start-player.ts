import { execFileSync } from 'node:child_process';
import { readStory, type Sources } from '../packages/source/src/index';
import { parseXml } from '../packages/source/src/xml';

/** Test diagnostics only: no foreground activation or simulated input. */
export function playerWindowFocus(pid: number | undefined): { foreground: boolean; foregroundPid: number; minimized: boolean } {
  if (!pid || !Number.isSafeInteger(pid)) throw new Error('测试播放器没有 PID');
  const script = String.raw`
Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid); [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);' -Name FocusInfo -Namespace KakeraTest
$h = (Get-Process -Id ${pid}).MainWindowHandle
$fg = [KakeraTest.FocusInfo]::GetForegroundWindow()
[uint32]$foregroundPid = 0
[KakeraTest.FocusInfo]::GetWindowThreadProcessId($fg, [ref]$foregroundPid) | Out-Null
@{ foreground = ($h -ne 0 -and $h -eq $fg); foregroundPid = $foregroundPid; minimized = [KakeraTest.FocusInfo]::IsIconic($h) } | ConvertTo-Json -Compress
`;
  return JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 10000, windowsHide: true, encoding: 'utf8' }));
}

/**
 * Test-only full-screen start button. Multi-entry players intentionally wait for
 * an explicit UI resume/restart, so integration tests need a deterministic input
 * surface rather than assuming a story auto-starts.
 */
export function addStartOverlay(input: Sources, entry?: string): Sources {
  const next = new Map(input), story = readStory(next);
  const start = entry ?? story.entries?.[0] ?? story.entry;
  if (!start || !story.frames.some(f => f.ref === start && !f.pending)) throw new Error('测试起始幕不存在');
  const uiFile = [...next.keys()].find(file => { try { return parseXml(next.get(file)!).tag === 'ui'; } catch { return false; } });
  if (!uiFile) throw new Error('测试工程没有 UI 入口');
  const xml = next.get(uiFile)!, root = parseXml(xml), initial = root.children.find(n => n.tag === 'screen' && n.attrs.id === root.attrs.initial);
  if (!initial) throw new Error('测试初始 UI 页面不存在');
  if (!xml.includes('id="kakera.test.start"')) {
    const button = '<button id="kakera.test.start" x="0" y="0" width="1280" height="720" text="开始" event="kakera.test.start" />';
    next.set(uiFile, xml.slice(0, initial.closeStart) + button + xml.slice(initial.closeStart));
  }
  const script = story.scripts.find(file => file.endsWith('ui.js')) ?? story.scripts[0];
  if (!script) throw new Error('测试工程没有声明脚本');
  const js = next.get(script) ?? '';
  if (!js.includes('ui("kakera.test.start").bind')) next.set(script, `${js}\nui("kakera.test.start").bind("kakera.test.start", ctx => { ctx.open(${JSON.stringify(initial.attrs.id)}); ctx.restart(${JSON.stringify(start)}); });\n`);
  return next;
}

/** Bring the player window to the foreground and click the full-screen test start button. */
export function clickStartOverlay(pid: number | undefined): void {
  if (!pid) throw new Error('测试播放器没有 PID');
  const script = String.raw`
$ErrorActionPreference = 'Stop'
$sig = '[DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out RECT r); [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr pid); [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint from,uint to,bool attach); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd); [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr hWnd, bool altTab); [DllImport("user32.dll")] public static extern IntPtr SetFocus(IntPtr hWnd); [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd); [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd,int n); [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref POINT p); [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y); [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint x,uint y,uint d,UIntPtr e); public struct RECT { public int L,T,R,B; } public struct POINT { public int X,Y; }'
Add-Type -MemberDefinition $sig -Name StartInput -Namespace KakeraTest
$h = 0
for ($i = 0; $i -lt 30; $i++) { $h = (Get-Process -Id ${pid}).MainWindowHandle; if ($h -ne 0) { break }; Start-Sleep -Milliseconds 200 }
if ($h -eq 0) { throw '测试播放器窗口未出现' }
$focused = $false
for ($i = 0; $i -lt 12; $i++) {
  if ([KakeraTest.StartInput]::GetForegroundWindow() -eq $h) { $focused = $true; break }
  $fg = [KakeraTest.StartInput]::GetForegroundWindow()
  $tid = [KakeraTest.StartInput]::GetWindowThreadProcessId($fg, [IntPtr]::Zero)
  $ttid = [KakeraTest.StartInput]::GetWindowThreadProcessId($h, [IntPtr]::Zero)
  [KakeraTest.StartInput]::AttachThreadInput($tid, $ttid, $true) | Out-Null
  [KakeraTest.StartInput]::ShowWindow($h, 9) | Out-Null
  [KakeraTest.StartInput]::BringWindowToTop($h) | Out-Null
  [KakeraTest.StartInput]::SwitchToThisWindow($h, $true)
  [KakeraTest.StartInput]::SetForegroundWindow($h) | Out-Null
  [KakeraTest.StartInput]::SetFocus($h) | Out-Null
  [KakeraTest.StartInput]::AttachThreadInput($tid, $ttid, $false) | Out-Null
  Start-Sleep -Milliseconds 150
}
if (-not $focused) { throw '无法把测试播放器切到前台' }
Write-Output ('focused ' + $h)
$r = New-Object KakeraTest.StartInput+RECT
[KakeraTest.StartInput]::GetClientRect($h, [ref]$r) | Out-Null
$p = New-Object KakeraTest.StartInput+POINT
$p.X = [int][Math]::Floor(($r.R - $r.L) / 2); $p.Y = [int][Math]::Floor(($r.B - $r.T) / 2)
[KakeraTest.StartInput]::ClientToScreen($h, [ref]$p) | Out-Null
[KakeraTest.StartInput]::SetCursorPos($p.X, $p.Y) | Out-Null
[KakeraTest.StartInput]::mouse_event(0x02, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 70
[KakeraTest.StartInput]::mouse_event(0x04, 0, 0, 0, [UIntPtr]::Zero)
`;
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 15000, windowsHide: true, encoding: 'utf8' });
  if (!output.includes('focused ')) throw new Error(`测试播放器起始点击未确认：${output.trim()}`);
}

export async function waitForStarted(client: { request: (command: { type: string }) => Promise<any> }, timeout = 8000): Promise<any> {
  const deadline = Date.now() + timeout;
  await new Promise(resolve => setTimeout(resolve, 1200));
  while (Date.now() < deadline) {
    const state = await client.request({ type: 'status' });
    if (state.game_started && state.frame_id) return state;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('播放器未从测试起始按钮进入剧情');
}
