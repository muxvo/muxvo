/**
 * bridge-roundtrip — 任务 15 demo 闭环的机器验证（零依赖 node）。
 *
 * 原理：起本地 http server（默认 5197）serve 一张 harness 页；用
 *   MUXVO_WEB_URL=http://localhost:5197/harness.html scripts/app.sh run
 * 把真 app 的 WKWebView 指过来。harness 按 bridge-v1.md §3 真实握手契约走全链：
 *   ① 先装 __muxvoBridge.receive → ② 发 bridge.hello → ③ 收 ui.state #1
 *   （DemoStatePusher 的 3-tile 初始快照，selectedId=null）→ ④ 自动发
 *   ui.action tileClick(第 2 块 tile) → ⑤ 收 ui.state #2（selectedId 已更新）
 * 每步 fetch 回报本 server。整条链 = 真 WKWebView + 真 BridgeBus + 真
 * DemoStatePusher，无任何 mock（教训见 memory：mock 测试通过 ≠ 真 app 修好）。
 *
 * 用法：node tools/bridge-roundtrip/run.mjs        # 起 server，结果写 stdout
 *       （另一终端跑 app；本进程收到 state2 即判定并退出：0=PASS 1=FAIL）
 *       --timeout <s>  等待判定超时（默认 60s），超时退出 1
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.BRIDGE_RT_PORT || 5197);
const timeoutArg = process.argv.indexOf('--timeout');
const TIMEOUT_S = timeoutArg > 0 ? Number(process.argv[timeoutArg + 1]) || 60 : 60;

const HARNESS_HTML = `<!doctype html>
<html><head><meta charset="UTF-8"><title>Muxvo bridge-roundtrip harness</title></head>
<body><pre id="log">bridge-roundtrip harness</pre>
<script>
  const logEl = document.getElementById('log');
  const report = (phase, data) => {
    logEl.textContent += '\\n' + phase + ' ' + JSON.stringify(data);
    return fetch('/report?phase=' + phase + '&data=' + encodeURIComponent(JSON.stringify(data)))
      .catch(() => {});
  };
  const port = window.webkit?.messageHandlers?.muxvo;
  if (!port) {
    report('fatal', 'no webkit message handler (页面没跑在 app 的 WKWebView 里)');
  } else {
    let stateCount = 0;
    // ① 先装 receive（§3 时序契约：receive 先于 hello）
    window.__muxvoBridge = {
      receive(m) {
        if (m?.type === 'ui.state' && m.payload?.kind === 'snapshot') {
          stateCount++;
          const s = m.payload.state;
          report('state' + stateCount, {
            stateId: s.id,
            selectedId: s.selectedId,
            tiles: (s.terminals || []).map(t => t.id),
          });
          if (stateCount === 1) {
            // ④ 对第 2 块 tile 发 tileClick（与 web TermTile onClick 同信封）
            const target = s.terminals[1]?.id;
            report('click', { terminalId: target });
            void port.postMessage({ v: 1, type: 'ui.action',
              payload: { kind: 'tileClick', terminalId: target } }).catch(() => {});
          }
        }
      },
    };
    // ② 再发 hello
    port.postMessage({ v: 1, type: 'bridge.hello',
      payload: { protocolVersion: 1, webBuild: 'bridge-roundtrip-harness' } })
      .then(r => report('hello', r))
      .catch(e => report('fatal', 'hello rejected: ' + e));
  }
</script></body></html>`;

const phases = {};
let finished = false;

function finish(code, message) {
  if (finished) return;
  finished = true;
  console.log(message);
  console.log(`bridge-roundtrip ${code === 0 ? 'PASS' : 'FAIL'}`);
  server.close(() => process.exit(code));
  setTimeout(() => process.exit(code), 500).unref();
}

function judge() {
  // 判定：state1 = 3 tile 且未选中；click 打向 state1 的第 2 块；state2 选中该块
  const s1 = phases.state1;
  const s2 = phases.state2;
  const click = phases.click;
  if (!s1 || !s2 || !click) return;
  const checks = [
    ['state1 为 3-tile 快照', Array.isArray(s1.tiles) && s1.tiles.length === 3],
    ['state1 初始未选中', s1.selectedId === null],
    ['click 目标 = state1 第 2 块 tile', click.terminalId === s1.tiles[1]],
    ['state2 选中态 = 点击目标（round-trip 闭环）', s2.selectedId === click.terminalId],
    ['state2 仍为同一组 3 tile', JSON.stringify(s2.tiles) === JSON.stringify(s1.tiles)],
  ];
  for (const [label, ok] of checks) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  finish(checks.every(([, ok]) => ok) ? 0 : 1, `phases: ${JSON.stringify(phases)}`);
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === '/harness.html' || url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(HARNESS_HTML);
    return;
  }
  if (url.pathname === '/report') {
    const phase = url.searchParams.get('phase') || 'unknown';
    let data = null;
    try { data = JSON.parse(url.searchParams.get('data') || 'null'); } catch { /* 原样存字符串 */
      data = url.searchParams.get('data');
    }
    phases[phase] = data;
    console.log(`[report] ${phase}: ${JSON.stringify(data)}`);
    res.writeHead(200).end('ok');
    if (phase === 'fatal') finish(1, `fatal: ${JSON.stringify(data)}`);
    else judge();
    return;
  }
  res.writeHead(404).end();
});

server.listen(PORT, () => {
  console.log(`harness 就绪: http://localhost:${PORT}/harness.html`);
  console.log(`另开终端: MUXVO_WEB_URL=http://localhost:${PORT}/harness.html scripts/app.sh run`);
});

setTimeout(() => finish(1, `超时 ${TIMEOUT_S}s 未完成判定，已收 phases: ${JSON.stringify(phases)}`), TIMEOUT_S * 1000);
