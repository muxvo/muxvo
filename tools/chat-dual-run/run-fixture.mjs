// 合成语料双跑对照 runner（chat-data.md §8）——同一 fixture 树喂两侧（legacy-dump / muxvo-chat-dump）
// 全命令 + 固定 query 集，逐命令 diff。**必须全部 diff=0**（决定性验收，可重复）。
//
// 环境：
//   CHAT_DUMP_BIN     muxvo-chat-dump 可执行路径（run-fixture.sh 构建后注入）
//   MUXVO_LEGACY_ROOT legacy 根（默认本机路径，legacy-dump.mts 消费）
//   FIXTURE_ROOT      fixture 生成目录（默认临时目录）
//
// 退出：全绿 0；任一 diff≠0 或执行错 → 1。

import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { diffRecords } from './diff.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const legacyRoot = process.env.MUXVO_LEGACY_ROOT
  || '/Users/rl/Nutstore_Files/my_nutstore/520-program/muxvo-legacy';
const dumpBin = process.env.CHAT_DUMP_BIN;
if (!dumpBin) { process.stderr.write('缺 CHAT_DUMP_BIN 环境变量\n'); process.exit(2); }

const root = process.env.FIXTURE_ROOT || mkdtempSync(join(tmpdir(), 'chat-dual-fixture-'));
const EXEC_OPTS = { maxBuffer: 512 * 1024 * 1024, encoding: 'utf8' };

// 1) 生成 fixtures
execFileSync('node', [join(here, 'fixtures', 'build-fixtures.mjs'), root], { stdio: 'inherit' });

const ccBase = join(root, 'claude', 'projects');
const mirror = join(root, 'mirror');
const codexBase = join(root, 'codex', 'sessions');

const QUERIES = ['world', '你好', '🚀', 'tests', 'subagent', 'worker', 'Hello', 'pause here', 'nonexistent-zzz'];

// 三源模式的 base flags
const MODES = {
  cc: ['--cc-base', ccBase, '--mirror', mirror],
  codex: ['--codex-base', codexBase],
  aggregate: ['--cc-base', ccBase, '--mirror', mirror, '--codex-base', codexBase],
};

// CHAT_DUMP_READER=chatstore → 新版 dump 切 ChatStore 后端（legacy 侧不加，仅对照新版读者）。
const READER_ARGS = process.env.CHAT_DUMP_READER ? ['--reader', process.env.CHAT_DUMP_READER] : [];
function runNew(args) {
  return execFileSync(dumpBin, [...args, ...READER_ARGS], EXEC_OPTS);
}
function runLegacy(args) {
  return execFileSync(join(legacyRoot, 'node_modules/.bin/tsx'),
    [join(here, 'legacy-dump.mts'), ...args], { ...EXEC_OPTS, cwd: legacyRoot });
}

let pass = 0, fail = 0;
const failures = [];

function check(kind, label, args) {
  let legacyRaw, newRaw;
  try {
    legacyRaw = runLegacy(args);
    newRaw = runNew(args);
  } catch (e) {
    fail++;
    failures.push(`[EXEC-ERR] ${label}: ${e.stderr || e.message}`);
    return;
  }
  let legacy, fresh;
  try {
    legacy = JSON.parse(legacyRaw);
    fresh = JSON.parse(newRaw);
  } catch (e) {
    fail++;
    failures.push(`[PARSE-ERR] ${label}: ${e.message}`);
    return;
  }
  const { equal, report, legacyCount } = diffRecords(kind, legacy, fresh);
  if (equal) {
    pass++;
    process.stdout.write(`  OK  ${label} (${legacyCount})\n`);
  } else {
    fail++;
    failures.push(`[DIFF] ${label}:\n${indent(report)}`);
    process.stdout.write(`  ✗   ${label}\n`);
  }
}
function indent(s) { return s.split('\n').map((l) => '      ' + l).join('\n'); }

for (const [mode, baseArgs] of Object.entries(MODES)) {
  process.stdout.write(`\n== 模式 ${mode} ==\n`);
  check('projects', `${mode}/projects`, [...baseArgs, 'projects']);
  check('sessions', `${mode}/sessions --all`, [...baseArgs, 'sessions', '--all']);

  // 逐项目 sessions（项目 hash 取自 new-dump projects）
  const projects = JSON.parse(runNew([...baseArgs, 'projects']));
  for (const p of projects) {
    check('sessions', `${mode}/sessions --project ${p.projectHash}`,
      [...baseArgs, 'sessions', '--project', p.projectHash]);
  }

  // 逐会话 session detail（(hash, sid) 取自 new-dump sessions --all）
  const sessions = JSON.parse(runNew([...baseArgs, 'sessions', '--all']));
  for (const s of sessions) {
    check('session', `${mode}/session ${s.projectHash}/${s.sessionId}`,
      [...baseArgs, 'session', '--project', s.projectHash, '--session', s.sessionId]);
  }

  // 搜索
  for (const q of QUERIES) {
    check('search', `${mode}/search "${q}"`, [...baseArgs, 'search', '--query', q]);
  }
}

process.stdout.write(`\n==== 结果：${pass} 绿 / ${fail} 红 ====\n`);
if (fail > 0) {
  process.stdout.write('\n失败明细：\n' + failures.join('\n') + '\n');
  process.exit(1);
}
process.stdout.write('fixture 档全绿 diff=0 ✅\n');
