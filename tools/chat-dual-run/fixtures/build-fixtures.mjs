// 合成语料生成器（chat-data.md §7 案例池端到端面）。零依赖 node ESM。
//
// 用法：node build-fixtures.mjs <targetRoot>
// 产出：
//   <root>/claude/projects/<hash>/<sid>.jsonl   （CC 源，basename 须 'projects'）
//   <root>/mirror/<hash>/<sid>.jsonl            （镜像/归档扁平根）
//   <root>/codex/sessions/YYYY/MM/DD/<rollout>.jsonl + <root>/codex/.codex-global-state.json
//
// 覆盖：四大陷阱（空 title 丢弃 / 纯 tool_result user 丢弃 / sidechain 不过滤 / summary 忽略）
//   + teammate 拆分（含协议块丢弃）+ image + queue-operation(system/user) + isMeta/isCompact/cd/bindkey
//   + 坏行跳过 + 中文/大小写/emoji + worktree(父存在归并 / 父缺失 remap) + mirror(archiveOnly + 补集
//   + Math.max) + Codex(目录/工具/output 保真/thread-title/跨源同 projectHash)。
//
// mtime 显式 settimes（先写文件 → 设文件 mtime → 最后设目录 mtime，避免写文件反刷目录 mtime）。
// 两侧读同一批文件，mtime 天然一致；显式设置只为确定性 + 触发 max/排序逻辑。

import { mkdirSync, writeFileSync, utimesSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';

const root = process.argv[2];
if (!root) {
  process.stderr.write('用法：node build-fixtures.mjs <targetRoot>\n');
  process.exit(2);
}
rmSync(root, { recursive: true, force: true });

const TS = '2026-07-06T10:00:00.000Z';
const base = Date.UTC(2026, 6, 6, 10, 0, 0) / 1000; // 秒
const dirMtimes = [];
const fileMtimes = [];

function jl(obj) { return JSON.stringify(obj); }

/** 写一个 session .jsonl（lines = 对象数组或原始字符串），记录文件 mtime。 */
function writeSession(dir, sid, lines, mtimeSec) {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${sid}.jsonl`);
  const body = lines.map((l) => (typeof l === 'string' ? l : jl(l))).join('\n') + '\n';
  writeFileSync(path, body, 'utf8');
  fileMtimes.push([path, mtimeSec]);
}
function setDirMtime(dir, mtimeSec) { dirMtimes.push([dir, mtimeSec]); }

// 常用记录构造
function ccUser(sid, cwd, content, extra = {}) {
  return { type: 'user', uuid: `${sid}-u-${extra.n ?? 0}`, sessionId: sid, cwd, gitBranch: 'main', timestamp: extra.ts ?? TS, message: { role: 'user', content }, ...omit(extra, ['n', 'ts']) };
}
function ccAssistant(sid, cwd, blocks, n = 0) {
  return { type: 'assistant', uuid: `${sid}-a-${n}`, sessionId: sid, cwd, gitBranch: 'main', timestamp: TS, message: { role: 'assistant', content: blocks } };
}
function queueOp(sid, cwd, content, n = 0) {
  return { type: 'queue-operation', uuid: `${sid}-q-${n}`, sessionId: sid, cwd, timestamp: TS, content };
}
function omit(o, keys) { const r = { ...o }; for (const k of keys) delete r[k]; return r; }

// ============ CC 源 ============
const ccProjects = join(root, 'claude', 'projects');

// --- P1：普通项目 -Users-alice-proj1（cwd=/Users/alice/proj1）---
const H1 = '-Users-alice-proj1';
const cwd1 = '/Users/alice/proj1';
const p1 = join(ccProjects, H1);

// s1：基础 + 中文/emoji/大小写搜索面；首条内部消息（system-reminder）→ startedAt 取它、title 跳过
writeSession(p1, 's1-normal', [
  ccUser('s1-normal', cwd1, '<system-reminder>boot</system-reminder>', { n: 0, ts: '2026-07-06T09:59:59.000Z' }),
  ccUser('s1-normal', cwd1, 'Hello WORLD 你好 Café 🚀 rocket', { n: 1 }),
  ccAssistant('s1-normal', cwd1, [{ type: 'text', text: 'Hi there, world!' }], 0),
], base + 10);

// s3：纯 tool_result user 丢弃（陷阱②）+ 坏行跳过
writeSession(p1, 's3-toolresult', [
  ccUser('s3-toolresult', cwd1, 'Run the tests please', { n: 0 }),
  '{ this is a bad json line',
  ccUser('s3-toolresult', cwd1, [{ type: 'tool_result', tool_use_id: 't1', content: 'exit 0' }], { n: 1 }),
  ccAssistant('s3-toolresult', cwd1, [{ type: 'text', text: 'All tests pass' }], 0),
], base + 30);

// s4：sidechain 不过滤（陷阱③）
writeSession(p1, 's4-sidechain', [
  ccUser('s4-sidechain', cwd1, 'Spawn a subagent', { n: 0 }),
  ccUser('s4-sidechain', cwd1, 'subagent reporting in', { n: 1, isSidechain: true }),
  ccAssistant('s4-sidechain', cwd1, [{ type: 'text', text: 'done' }], 0),
], base + 40);

// s5：summary / file-history-snapshot 忽略（陷阱④）
writeSession(p1, 's5-summary', [
  ccUser('s5-summary', cwd1, 'Summarize the work', { n: 0 }),
  { type: 'summary', summary: 'prior context', leafUuid: 'x' },
  { type: 'file-history-snapshot', snapshot: {} },
  ccAssistant('s5-summary', cwd1, [{ type: 'text', text: 'summary body' }], 0),
], base + 50);

// s6：teammate 拆分（真块保留 + 协议块丢弃）
writeSession(p1, 's6-teammate', [
  ccUser('s6-teammate', cwd1, 'Coordinate the team', { n: 0 }),
  ccUser('s6-teammate', cwd1,
    '<teammate-message id=w1>Hello from worker one</teammate-message><teammate-message id=w2>{"type":"idle_notification"}</teammate-message>',
    { n: 1 }),
], base + 60);

// s7：image 块保留
writeSession(p1, 's7-image', [
  ccUser('s7-image', cwd1, 'Look at this screenshot', { n: 0 }),
  ccUser('s7-image', cwd1, [
    { type: 'text', text: 'see below' },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0AAA' } },
  ], { n: 1 }),
], base + 70);

// s8：queue-operation system vs user
writeSession(p1, 's8-queueop', [
  ccUser('s8-queueop', cwd1, 'Queue check', { n: 0 }),
  queueOp('s8-queueop', cwd1, '<task-notification>build finished</task-notification>', 0),
  queueOp('s8-queueop', cwd1, 'please pause here', 1),
], base + 80);

// s9：isMeta / isCompactSummary / cd / bindkey → system 重标
writeSession(p1, 's9-system', [
  ccUser('s9-system', cwd1, 'System markers test', { n: 0 }),
  ccUser('s9-system', cwd1, 'meta payload', { n: 1, isMeta: true }),
  ccUser('s9-system', cwd1, 'compacted history', { n: 2, isCompactSummary: true }),
  ccUser('s9-system', cwd1, 'cd /Users/alice/proj1 && clear', { n: 3 }),
  ccUser('s9-system', cwd1, 'bindkey -e', { n: 4 }),
], base + 90);

// s2-empty：无非内部 user 消息 → title 空 → 从 sessions 列表丢弃（陷阱①）
writeSession(p1, 's2-empty-title', [
  ccUser('s2-empty-title', cwd1, '<system-reminder>only internal</system-reminder>', { n: 0 }),
  ccUser('s2-empty-title', cwd1, '<command-message>/foo</command-message>', { n: 1 }),
], base + 20);

setDirMtime(p1, base + 90);

// --- P2 worktree：父存在归并 ---
const H2 = '-Users-alice-proj2';
const cwd2 = '/Users/alice/proj2';
const p2 = join(ccProjects, H2);
writeSession(p2, 's-parent', [ccUser('s-parent', cwd2, 'Parent repo session', { n: 0 })], base + 100);
setDirMtime(p2, base + 100);

const H2wt = '-Users-alice-proj2--worktrees-wt-1';
const cwd2wt = '/Users/alice/proj2/.worktrees/wt-1';
const p2wt = join(ccProjects, H2wt);
writeSession(p2wt, 's-wt-a', [ccUser('s-wt-a', cwd2wt, 'Worktree session A', { n: 0 })], base + 110);
writeSession(p2wt, 's-wt-b', [ccUser('s-wt-b', cwd2wt, 'Worktree session B', { n: 0 })], base + 120);
setDirMtime(p2wt, base + 120); // > 父 → 父 lastActivity 取此 max

// --- P3 worktree：父缺失 remap ---
const H3wt = '-Users-alice-proj3--worktrees-worktree-10';
const cwd3wt = '/Users/alice/proj3/.worktrees/worktree-10';
const p3wt = join(ccProjects, H3wt);
writeSession(p3wt, 's-orphan-wt', [ccUser('s-orphan-wt', cwd3wt, 'Orphan worktree session', { n: 0 })], base + 130);
setDirMtime(p3wt, base + 130);

// ============ 镜像/归档 ============
const mirror = join(root, 'mirror');
// P1 镜像：一个与 CC 重复的 session（CC 优先，非 archiveOnly）+ 一个 archive 独有 session
const m1 = join(mirror, H1);
writeSession(m1, 's1-normal', [ // 与 CC 同键 → CC 优先，镜像被忽略
  ccUser('s1-normal', cwd1, 'STALE mirror copy', { n: 0 }),
], base + 5);
writeSession(m1, 's-arch-only', [ // 镜像独有 → archiveOnly:true
  ccUser('s-arch-only', cwd1, 'Archived only session', { n: 0 }),
], base + 6);
setDirMtime(m1, base + 6);
// 镜像独有项目
const Hm = '-Users-alice-mirror-only';
const cwdm = '/Users/alice/mirror-only';
const mOnly = join(mirror, Hm);
writeSession(mOnly, 's-m1', [ccUser('s-m1', cwdm, 'Mirror-only project session', { n: 0 })], base + 7);
setDirMtime(mOnly, base + 7);

// ============ Codex 源 ============
const codexSessions = join(root, 'codex', 'sessions', '2026', '07', '06');
mkdirSync(codexSessions, { recursive: true });

function codexMeta(id, cwd) { return { type: 'session_meta', timestamp: TS, payload: { id, cwd, timestamp: TS } }; }
function codexUser(msg) { return { type: 'event_msg', timestamp: TS, payload: { type: 'user_message', message: msg } }; }
function codexAgent(msg) { return { type: 'event_msg', timestamp: TS, payload: { type: 'agent_message', message: msg } }; }
function codexFuncCall(name, args, callId) { const p = { type: 'function_call', name, arguments: args }; if (callId !== undefined) p.call_id = callId; return { type: 'response_item', timestamp: TS, payload: p }; }
function codexFuncOut(output, callId) { return { type: 'response_item', timestamp: TS, payload: { type: 'function_call_output', output, call_id: callId } }; }
function codexCustomCall(name, input, callId) { return { type: 'response_item', timestamp: TS, payload: { type: 'custom_tool_call', name, input, call_id: callId } }; }
function codexCustomOut(output, callId) { return { type: 'response_item', timestamp: TS, payload: { type: 'custom_tool_call_output', output, call_id: callId } }; }

// cx1：cwd 与 CC P1 同（跨源同 projectHash） + 完整工具链
const cxid1 = 'aaaaaaaa-bbbb-cccc-dddd-000000000001';
writeSession(codexSessions, `rollout-2026-07-06T10-00-00-${cxid1}`, [
  codexMeta(cxid1, cwd1),
  codexUser('codex hello 你好 world'),
  codexAgent('agent reply'),
  codexFuncCall('Bash', { cmd: 'ls -la' }, 'call_1'),
  codexFuncOut('total 0\nfile.txt', 'call_1'),
  { type: 'event_msg', timestamp: TS, payload: { type: 'agent_reasoning', text: 'thinking' } }, // skip
  { type: 'response_item', timestamp: TS, payload: { type: 'token_count', input: 5 } }, // skip
], base + 200);

// cx2：同 cwd（count/totalSize 累加）
const cxid2 = 'aaaaaaaa-bbbb-cccc-dddd-000000000002';
writeSession(codexSessions, `rollout-2026-07-06T10-00-01-${cxid2}`, [
  codexMeta(cxid2, cwd1),
  codexUser('second codex session'),
], base + 210);

// cx3：不同 cwd + custom_tool + output 保真（数组/对象）+ 无 call_id 工具
const cxid3 = 'aaaaaaaa-bbbb-cccc-dddd-000000000003';
const cwdCx = '/Users/alice/proj-codex';
writeSession(codexSessions, `rollout-2026-07-06T10-00-02-${cxid3}`, [
  codexMeta(cxid3, cwdCx),
  codexUser('custom tool session'),
  codexCustomCall('search', { pattern: 'foo', opts: { deep: true } }, 'call_x'),
  codexCustomOut(['line1', 'line2'], 'call_x'), // output 数组保真
  codexFuncCall('NoId', { a: 1 }, undefined), // 无 call_id → uuid codex-{sid}-tool-{i}
], base + 220);

// codex 全局状态：给 cx2 一个 thread-title
writeFileSync(
  join(root, 'codex', '.codex-global-state.json'),
  JSON.stringify({ 'thread-titles': { titles: { [cxid2]: 'Titled Codex Thread' } } }),
  'utf8');

// ============ 施加 mtime（文件先、目录后）============
for (const [p, s] of fileMtimes) utimesSync(p, s, s);
// codex 目录 mtime 无关（Codex lastActivity 用文件 mtime），仅设 CC/mirror 目录
for (const [d, s] of dirMtimes) utimesSync(d, s, s);

process.stdout.write(`fixtures 生成于 ${root}\n`);
process.stdout.write(`  CC:     ${ccProjects}\n`);
process.stdout.write(`  mirror: ${mirror}\n`);
process.stdout.write(`  codex:  ${join(root, 'codex', 'sessions')}\n`);
