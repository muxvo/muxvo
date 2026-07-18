/**
 * bridge-isolation — 桥隔离断言（M1 任务 7 验收门，bridge-v1.md §3 截图契约隔离铁律
 * + 桥 v2 草案 §6 六道闸 #4：洞分支/layoutReport 截图零泄漏）。
 *
 * 场景 A（隔离）：?screenshot=1 下 bridge 路径一行不执行——spy 零调用、__muxvoBridge 未安装；
 *   且加载 terminal-grid fixture 后 **无 .tile-term-hole**（content 恒存在走原渲染路径）、
 *   layoutReport 天然零发送（无桥无 onAction）——洞/上报绝不泄漏进截图 DOM（草案 §6.3/§6.4）。
 * 场景 B（活性）：正常模式恰发一条 hello，receive 先于 hello 安装（时序契约）、无版本横幅；
 *   demoFixture（content 存在）→ 无洞 → 无 layoutReport ui.action（证明产生端仅真状态源触发）。
 *   B 证明 spy 装得对、桥真的会发——否则 A 的零调用是真空通过。
 *
 * 纯断言：不写任何文件（golden/current/report 零污染），非零退出码即失败。
 * 前置：web dev server 已在 5198（cd web && npm run dev）。
 * 用法：node src/bridge-isolation.mjs（CURRENT_ORIGIN 可覆盖默认 http://localhost:5198）
 */

// terminal-grid fixture（content 存在 → 原渲染路径，验证洞分支不泄漏进截图 DOM）
const GRID_FIXTURE = {
  id: 'iso-grid',
  theme: 'dark',
  homePath: '/Users/x',
  viewMode: 'Tiling',
  focusedId: null,
  selectedId: null,
  activeSidebarId: null,
  maxReached: false,
  dragging: null,
  dragOver: null,
  editing: null,
  waitingNotification: null,
  searchBar: null,
  quitConfirm: null,
  palette: { background: '#1e1e1e', foreground: '#cccccc' },
  terminals: [
    { id: 't1', state: 'Running', cwd: '/Users/x/proj', content: [[{ t: 'hello', hex: '#ffffff' }]] },
  ],
};

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const legacyRequire = createRequire(
  join(here, '..', '..', '..', '..', 'muxvo-legacy', 'package.json'),
);
const { chromium } = legacyRequire('playwright');

const ORIGIN = process.env.CURRENT_ORIGIN || 'http://localhost:5198';

// 与 capture.mjs 同源：直连下载被墙，固定用本机 headless shell，CHROMIUM_PATH 可覆盖
// B5 起 pin 1200（1223 被 playwright GC 清理，像素级等价验证见 capture.mjs 头注释）
const executablePath =
  process.env.CHROMIUM_PATH ||
  join(
    process.env.HOME,
    'Library/Caches/ms-playwright/chromium_headless_shell-1200/chrome-headless-shell-mac-arm64/chrome-headless-shell',
  );

const failures = [];
function check(cond, label) {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures.push(label);
}

const browser = await chromium.launch({ executablePath });

async function newSpyPage() {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  // spy 必须在任何页面代码前注入：伪装 WKWebView 宿主，记录全部 postMessage 调用
  await page.addInitScript(() => {
    window.__bridgeSpy = [];
    window.webkit = {
      messageHandlers: {
        muxvo: {
          postMessage(msg) {
            window.__bridgeSpy.push({
              msg,
              receiveInstalledFirst: typeof window.__muxvoBridge?.receive === 'function',
            });
            return Promise.resolve(
              msg?.type === 'bridge.hello'
                ? {
                    ok: true,
                    payload: {
                      protocolVersion: msg.payload.protocolVersion,
                      appVersion: '0.0.0-spy',
                      active: ['bridge.hello', 'ui.state', 'ui.action', 'term.command'],
                    },
                  }
                : { ok: true, payload: null },
            );
          },
        },
      },
    };
  });
  return page;
}

// ---------- 场景 A：截图模式桥零执行 ----------
console.log('场景 A：?screenshot=1 桥隔离');
{
  const page = await newSpyPage();
  await page.goto(`${ORIGIN}/?screenshot=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__fixturePageUp === true, null, { timeout: 15000 });
  // 给潜在的（违规）动态 import 留 resolve 窗口
  await page.waitForTimeout(800);
  const a = await page.evaluate(() => ({
    spyCalls: window.__bridgeSpy.length,
    bridgeInstalled: typeof window.__muxvoBridge !== 'undefined',
  }));
  check(a.spyCalls === 0, `spy 零调用（实际 ${a.spyCalls}）——不发 hello`);
  check(!a.bridgeInstalled, '__muxvoBridge 未安装——不装 receive');

  // 加载 terminal-grid fixture（content 存在）→ 断言走原渲染路径、洞分支零泄漏（草案 §6.3/§6.4）
  await page.evaluate((fx) => window.__loadFixture(fx), GRID_FIXTURE);
  await page.waitForFunction(() => window.__fixtureReady === true, null, { timeout: 15000 });
  const rendered = await page.evaluate(() => ({
    holes: document.querySelectorAll('.tile-term-hole').length,
    tiles: document.querySelectorAll('.tile-terminal').length,
    spyCalls: window.__bridgeSpy.length,
    bridgeInstalled: typeof window.__muxvoBridge !== 'undefined',
  }));
  check(rendered.holes === 0, `无 .tile-term-hole（实际 ${rendered.holes}）——content 存在走原路径`);
  check(rendered.tiles > 0, `原渲染路径就位：.tile-terminal 存在（${rendered.tiles}）`);
  check(rendered.spyCalls === 0, `加载 fixture 后 spy 仍零调用（实际 ${rendered.spyCalls}）——layoutReport 天然零发送`);
  check(!rendered.bridgeInstalled, '加载 fixture 后 __muxvoBridge 仍未安装');
  await page.close();
}

// ---------- 场景 B：正常模式桥活性 ----------
console.log('场景 B：正常模式桥活性（证明 spy 有效，A 非真空通过）');
{
  const page = await newSpyPage();
  await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__bridgeSpy.length > 0, null, { timeout: 15000 });
  await page.waitForTimeout(300); // 等潜在的多余调用（StrictMode 双 effect 等）暴露
  const b = await page.evaluate(() => ({
    calls: window.__bridgeSpy.map((c) => ({
      type: c.msg?.type,
      v: c.msg?.v,
      kind: c.msg?.payload?.kind,
      protocolVersion: c.msg?.payload?.protocolVersion,
      receiveInstalledFirst: c.receiveInstalledFirst,
    })),
    bridgeInstalled: typeof window.__muxvoBridge?.receive === 'function',
    banner: document.getElementById('muxvo-version-banner') !== null,
  }));
  const hellos = b.calls.filter((c) => c.type === 'bridge.hello');
  check(hellos.length === 1, `恰一条 hello（实际 ${hellos.length}，全部调用 ${b.calls.length}）`);
  check(hellos[0]?.v === 1, '信封 v=1');
  check(typeof hellos[0]?.protocolVersion === 'number', 'hello 携带数字 protocolVersion');
  check(hellos[0]?.receiveInstalledFirst === true, 'receive 先于 hello 安装（时序契约）');
  check(b.bridgeInstalled, '__muxvoBridge.receive 已安装');
  check(!b.banner, '版本匹配，无错误横幅');
  // demoFixture content 存在 → 无洞 → layoutReport 产生端不触发（仅真状态源的洞才上报，草案 §3.1）
  const layoutReports = b.calls.filter((c) => c.type === 'ui.action' && c.kind === 'layoutReport');
  check(layoutReports.length === 0, `无 layoutReport（实际 ${layoutReports.length}）——content 存在无洞`);
  await page.close();
}

await browser.close();

if (failures.length > 0) {
  console.error(`\nbridge-isolation RED：${failures.length} 项失败`);
  process.exit(1);
}
console.log('\nbridge-isolation GREEN：场景 A/B 全部通过');
