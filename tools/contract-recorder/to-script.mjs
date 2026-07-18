#!/usr/bin/env node
// fixture .jsonl → fake-cli.md §2 剧本 schema v1（JSON）。
// 每行 stream-json 事件 → 一个 `{ "emit": <event> }` step；末尾追加 `{ "exit": <code> }`。
// exit code 由末条 result 事件推导（is_error / subtype!=success → 1，否则 0）。
// requestPermission / sleep / hang 等交互 step 归批3 手写，**不在本器职责内**（本器只做
// 「原样 emit 回放」——防漂移锚 fake-cli.md §4 锚1 的「自动转可用剧本」）。
//
// 用法：node to-script.mjs <in.jsonl> [out.script.json]   # 缺 out 则写 stdout

import { readFileSync, writeFileSync } from 'node:fs';

function main() {
  const [inPath, outPath] = process.argv.slice(2);
  if (!inPath) { console.error('usage: to-script.mjs <in.jsonl> [out.script.json]'); process.exit(2); }
  const input = readFileSync(inPath, 'utf8');
  const steps = [];
  let exitCode = 0;
  let lineNo = 0;
  for (const line of input.split('\n')) {
    lineNo += 1;
    if (line.trim() === '') continue;
    let evt;
    try { evt = JSON.parse(line); }
    catch (e) { console.error(`第 ${lineNo} 行非合法 JSON：${e.message}`); process.exit(1); }
    steps.push({ emit: evt });
    if (evt && evt.type === 'result') {
      const bad = evt.is_error === true || (evt.subtype && evt.subtype !== 'success');
      exitCode = bad ? 1 : 0;
    }
  }
  steps.push({ exit: exitCode });
  const script = { v: 1, steps };
  const text = JSON.stringify(script, null, 2) + '\n';
  if (outPath) writeFileSync(outPath, text);
  else process.stdout.write(text);
  process.stderr.write(`[to-script] ${inPath} → ${steps.length} step(s), exit=${exitCode}\n`);
}

main();
