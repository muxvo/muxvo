#!/usr/bin/env node
// 假更新源（specs/behavior/auto-update.md 验证专用；⭐R-04：只绑 127.0.0.1，与真 GitHub feed
// 物理隔绝——本服务器 serve 的是 appcast.xml（Sparkle 格式），在野老客户端只认 latest-mac.yml）。
//
// 用法: node tools/update-swap/serve.mjs --dir <stage目录> [--port 0] [--scenario normal]
//   stage 目录内容物: appcast.xml + 更新 zip（脚本/调用方自备）
//   --scenario:
//     normal            原样静态服务
//     http404           一切请求 404（检查失败路径）
//     malformed-feed    appcast.xml 回垃圾字节（坏 feed 路径）
//     drop-after:<N>    zip 请求发 N 字节后断socket，仅首次（重试即成功——验自动重试 1 次）
//     slow:<bps>        zip 限速（字节/秒）
//   请求日志: GET /__log 回 JSON（[{path, ts}]）——断言检查间隔/重试计数用。
//   就绪信号: 启动后 stdout 打 `LISTENING <port>`。

import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, normalize } from 'node:path';

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
}
const dir = arg('dir', null);
const port = Number(arg('port', '0'));
const scenario = arg('scenario', 'normal');
if (!dir) {
  console.error('usage: serve.mjs --dir <stage> [--port 0] [--scenario normal]');
  process.exit(2);
}

const requestLog = [];
const droppedOnce = new Set();

const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/__log') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(requestLog));
    return;
  }
  requestLog.push({ path, ts: Date.now() });

  if (scenario === 'http404') {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  if (scenario === 'malformed-feed' && path.endsWith('appcast.xml')) {
    res.writeHead(200, { 'content-type': 'application/xml' });
    res.end('<<<不是 XML 的垃圾字节>>>');
    return;
  }

  const file = normalize(join(dir, path));
  if (!file.startsWith(normalize(dir)) || !existsSync(file)) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  const body = readFileSync(file);
  const isZip = path.endsWith('.zip');

  if (isZip && scenario.startsWith('drop-after:') && !droppedOnce.has(path)) {
    droppedOnce.add(path);
    const n = Number(scenario.split(':')[1]);
    res.writeHead(200, { 'content-type': 'application/zip', 'content-length': body.length });
    res.write(body.subarray(0, n));
    setTimeout(() => res.destroy(), 50); // 半途断流（仅首次；重试即完整服务）
    return;
  }

  if (isZip && scenario.startsWith('slow:')) {
    const bps = Number(scenario.split(':')[1]);
    res.writeHead(200, { 'content-type': 'application/zip', 'content-length': body.length });
    let offset = 0;
    const tick = setInterval(() => {
      if (offset >= body.length) {
        clearInterval(tick);
        res.end();
        return;
      }
      res.write(body.subarray(offset, offset + bps));
      offset += bps;
    }, 1000);
    res.on('close', () => clearInterval(tick));
    return;
  }

  res.writeHead(200, {
    'content-type': path.endsWith('.xml') ? 'application/xml' : 'application/octet-stream',
    'content-length': body.length,
  });
  res.end(body);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`LISTENING ${server.address().port}`);
});
