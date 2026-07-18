// 真数据双跑对照（chat-data.md §8）——对本机真实 CC（~/.claude/projects，只读）+ Codex
// （~/.codex/sessions）语料跑 per-source 对照，报告落 logs 目录。首轮预期有残差，逐条定位归类。
//
// ⚠️ 只读：绝不传 --mirror、绝不写 CC/Codex 源。runbook：跑时暂停活跃 CC 会话（否则文件在
// legacy/new 两次读之间被追加 → 伪差异，归「legacy 侧不确定性」残差）。
//
// 采样：projects / sessions --all 全量对照；session detail 采样（worktree 全收 + 最大 N + 均匀铺
// N）；search 固定 query 集。perf：index 全量首扫耗时 + search 全扫耗时 + 语料体积。
//
// 环境：CHAT_DUMP_BIN（必填）；MUXVO_LEGACY_ROOT；CC_BASE（默认 ~/.claude/projects）；
//   CODEX_BASE（默认 ~/.codex/sessions）；OUT_DIR（报告目录，默认 logs/chat-dual-run-<stamp>）；
//   SAMPLE_N（每源采样会话数，默认 25）。

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, statSync, existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { diffRecords } from './diff.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const legacyRoot = process.env.MUXVO_LEGACY_ROOT
  || '/Users/rl/Nutstore_Files/my_nutstore/520-program/muxvo-legacy';
const dumpBin = process.env.CHAT_DUMP_BIN;
if (!dumpBin) { process.stderr.write('缺 CHAT_DUMP_BIN\n'); process.exit(2); }

const ccBase = process.env.CC_BASE || join(homedir(), '.claude', 'projects');
const codexBase = process.env.CODEX_BASE || join(homedir(), '.codex', 'sessions');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = process.env.OUT_DIR || join(homedir(), 'Library/Caches/muxvo-build/logs', `chat-dual-run-${stamp}`);
const sampleN = parseInt(process.env.SAMPLE_N || '25', 10);
mkdirSync(outDir, { recursive: true });

const EXEC = { maxBuffer: 1024 * 1024 * 1024, encoding: 'utf8' };
// CHAT_DUMP_READER=chatstore → 新版 dump 切 ChatStore 后端（legacy 侧不加）。
// CHAT_DUMP_DB → 持久 chat.db 跨命令复用（首命令全量 reconcile，后续 mtime 增量跳过）。
const READER_ARGS = [];
if (process.env.CHAT_DUMP_READER) READER_ARGS.push('--reader', process.env.CHAT_DUMP_READER);
if (process.env.CHAT_DUMP_DB) READER_ARGS.push('--db', process.env.CHAT_DUMP_DB);
const runNew = (args) => execFileSync(dumpBin, [...args, ...READER_ARGS], EXEC);
const runLegacy = (args) => execFileSync(join(legacyRoot, 'node_modules/.bin/tsx'),
  [join(here, 'legacy-dump.mts'), ...args], { ...EXEC, cwd: legacyRoot });

const results = [];
const perf = {};

function timed(fn) { const t = Date.now(); const v = fn(); return [v, Date.now() - t]; }

function check(kind, label, args) {
  let legacy, fresh, legMs = 0, newMs = 0;
  try {
    let raw;
    [raw, legMs] = timed(() => runLegacy(args)); legacy = JSON.parse(raw);
    [raw, newMs] = timed(() => runNew(args)); fresh = JSON.parse(raw);
  } catch (e) {
    results.push({ label, kind, error: String(e.stderr || e.message).slice(0, 400) });
    process.stdout.write(`  ERR ${label}\n`);
    return null;
  }
  const d = diffRecords(kind, legacy, fresh);
  results.push({ label, kind, equal: d.equal, legacyCount: d.legacyCount, newCount: d.newCount,
    report: d.equal ? '' : d.report.slice(0, 2000), legMs, newMs });
  process.stdout.write(`  ${d.equal ? 'OK ' : '✗  '}${label} (L=${d.legacyCount} N=${d.newCount}) legacy=${legMs}ms new=${newMs}ms\n`);
  return { legacy, fresh, d };
}

// 目录体积统计
function dirBytes(dir) {
  let bytes = 0, files = 0;
  const walk = (d) => {
    let ents; try { ents = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.jsonl')) { try { bytes += statSync(p).size; files++; } catch {} }
    }
  };
  walk(dir);
  return { bytes, files };
}

const QUERIES = ['error', 'function', '你好', 'muxvo', 'sessionId', 'zznonexistentzz'];

function sampleSessions(sessions) {
  const wt = sessions.filter((s) => s.worktreeLabel).slice(0, 5);
  const bySize = [...sessions].sort((a, b) => (b.fileSize || 0) - (a.fileSize || 0)).slice(0, 10);
  const spread = [];
  const step = Math.max(1, Math.floor(sessions.length / sampleN));
  for (let i = 0; i < sessions.length && spread.length < sampleN; i += step) spread.push(sessions[i]);
  const seen = new Set();
  const out = [];
  for (const s of [...wt, ...bySize, ...spread]) {
    const k = s.projectHash + '/' + s.sessionId;
    if (seen.has(k)) continue; seen.add(k); out.push(s);
    if (out.length >= sampleN + 15) break;
  }
  return out;
}

function runMode(mode, baseArgs, base) {
  process.stdout.write(`\n== 真数据模式 ${mode} ==\n`);
  perf[mode] = { corpus: dirBytes(base) };
  // index 全量首扫耗时（新侧）
  const [idxRaw, idxMs] = timed(() => runNew([...baseArgs, 'index']));
  perf[mode].indexNewMs = idxMs;
  perf[mode].index = JSON.parse(idxRaw);

  check('projects', `${mode}/projects`, [...baseArgs, 'projects']);
  const sAll = check('sessions', `${mode}/sessions --all`, [...baseArgs, 'sessions', '--all']);
  perf[mode].sessionsAllNewMs = results[results.length - 1]?.newMs;

  if (sAll) {
    const sample = sampleSessions(sAll.fresh);
    process.stdout.write(`  [采样 ${sample.length} 会话做 detail 对照]\n`);
    for (const s of sample) {
      check('session', `${mode}/session ${s.projectHash.slice(0, 24)}…/${s.sessionId.slice(0, 12)}…`,
        [...baseArgs, 'session', '--project', s.projectHash, '--session', s.sessionId]);
    }
  }
  perf[mode].searchMs = {};
  for (const q of QUERIES) {
    const r = check('search', `${mode}/search "${q}"`, [...baseArgs, 'search', '--query', q]);
    perf[mode].searchMs[q] = results[results.length - 1]?.newMs;
  }
}

// ---- 执行 ----
if (existsSync(ccBase)) runMode('cc', ['--cc-base', ccBase], ccBase);
else process.stdout.write(`(跳过 cc：${ccBase} 不存在)\n`);
if (existsSync(codexBase)) runMode('codex', ['--codex-base', codexBase], codexBase);
else process.stdout.write(`(跳过 codex：${codexBase} 不存在)\n`);

// ---- 汇总 ----
const total = results.length;
const green = results.filter((r) => r.equal).length;
const red = results.filter((r) => r.equal === false).length;
const errs = results.filter((r) => r.error).length;

const summary = { stamp, ccBase, codexBase, sampleN, total, green, red, errs, perf, results };
writeFileSync(join(outDir, 'report.json'), JSON.stringify(summary, null, 2));

const lines = [];
lines.push(`# 真数据双跑对照 ${stamp}`);
lines.push(`CC=${ccBase}  Codex=${codexBase}  采样/源=${sampleN}`);
lines.push(`结果：${green} 绿 / ${red} 红 / ${errs} 错（共 ${total} 命令）`);
lines.push('');
for (const [mode, p] of Object.entries(perf)) {
  lines.push(`## 模式 ${mode} 性能`);
  lines.push(`- 语料：${p.corpus.files} 文件 / ${(p.corpus.bytes / 1e6).toFixed(1)} MB`);
  lines.push(`- index 全量首扫（新侧）：${p.indexNewMs} ms（projects=${p.index?.projectCount} sessions=${p.index?.sessionCount}）`);
  lines.push(`- sessions --all（新侧）：${p.sessionsAllNewMs} ms`);
  lines.push(`- search 全扫（新侧, ms）：${Object.entries(p.searchMs).map(([q, m]) => `${q}=${m}`).join(' ')}`);
  lines.push('');
}
const bad = results.filter((r) => r.equal === false || r.error);
lines.push(`## 残差清单（${bad.length} 条）`);
if (!bad.length) lines.push('（无残差，全绿）');
for (const b of bad) {
  lines.push(`### ${b.label}`);
  if (b.error) lines.push('```\n' + b.error + '\n```');
  else lines.push(`L=${b.legacyCount} N=${b.newCount}\n\`\`\`\n${b.report}\n\`\`\``);
}
writeFileSync(join(outDir, 'report.md'), lines.join('\n'));

process.stdout.write(`\n==== 真数据：${green} 绿 / ${red} 红 / ${errs} 错（共 ${total}）====\n报告：${outDir}\n`);
process.exit(red + errs > 0 ? 1 : 0);
