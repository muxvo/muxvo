#!/usr/bin/env node
// SEC-15 脱敏器（契约录制防漂移锚，fake-cli.md §4 锚1）。
// 清洗**输出**非仅输入：无害 prompt 也可能让真 CC 把 home 路径 / 用户名 / env / 疑似密钥
// surface 进 stream-json stdout。本器逐行改写 .jsonl，把敏感片段替换为 REDACTED，
// **保持 JSON 合法性与事件形状**（只替换字符串值内的敏感子串，绝不引号/破坏转义），
// 并逐行 JSON.parse 自检（非法即炸，测试基建要炸得早）。
//
// 用法：
//   node redact.mjs <in.jsonl> [out.jsonl]      # 缺 out 则写 stdout
//   node redact.mjs < in.jsonl                  # stdin → stdout
// 统计（按类别计数 + total）打到 stderr：`[redact] file=… total=N cat=…`
// 可复用：其它脚本 `import { redactText } from './redact.mjs'`。

import { readFileSync, writeFileSync } from 'node:fs';

// 当前用户名（用于清洗 home 路径外残留的裸用户名）。
// launchd 极简环境常不注入 USER/LOGNAME → 从 HOME basename 兜底取用户名（SEC-15：非路径处裸用户名脱敏
// 不因缺 env 静默 no-op）。plist 侧另显式设 USER 作双保险；两者任一命中即可。
function currentUser() {
  const env = process.env.USER || process.env.LOGNAME || process.env.USERNAME;
  if (env) return env;
  const home = process.env.HOME || '';
  const base = home.replace(/\/+$/, '').split('/').pop() || '';
  return base && base !== 'REDACTED' ? base : '';
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// system/init 事件里的「本机环境清单」数组字段——逐字带出本机装了哪些 skills/agents/
// 第三方 mcp/slash 命令，是个人环境元数据，不该进拟入库 fixture。脱敏 = 内容置空数组
// （键保留、仍是数组 → JSON 形状与合法性不变；解析契约字段 session_id/model/cwd/
// apiKeySource 等一律不动）。scan.mjs import 同一常量，守「redact 有的 scan 必有」不变式。
// 例外：fixture 入库路径产物（fixtures/recorded/…）额外脱敏 uuid/session_id（见 scrubRecordIds / opts.redactIds）。
export const INIT_INVENTORY_FIELDS = ['tools', 'mcp_servers', 'slash_commands', 'agents', 'skills', 'plugins'];

// 就地把 system/init 事件的清单字段置空。返回被清空的字段数（供计数）。
export function scrubInitMetadata(obj) {
  let n = 0;
  if (obj && obj.type === 'system' && obj.subtype === 'init') {
    for (const f of INIT_INVENTORY_FIELDS) {
      if (Array.isArray(obj[f]) && obj[f].length > 0) { obj[f] = []; n += 1; }
    }
  }
  return n;
}

// 就地把每会话标识 uuid/session_id 替为 REDACTED-*（仅 fixture 入库路径产物启用，见 redactJsonl opts.redactIds）。
// 对齐手写 fixture 约定（JT_ratelimit_real_shape 用 "REDACTED-uuid"/"REDACTED-session"）；消费方
// JT_recorded_fixture_replay 为 parse-only 无值断言。诊断流（logs/nightly，不入 git）**不启用**——那里 session_id
// 仍作解析契约字段保留。返回被替换的字段数（供计数）。
export function scrubRecordIds(obj) {
  let n = 0;
  if (obj && typeof obj === 'object') {
    if (typeof obj.uuid === 'string' && obj.uuid !== 'REDACTED-uuid') { obj.uuid = 'REDACTED-uuid'; n += 1; }
    if (typeof obj.session_id === 'string' && obj.session_id !== 'REDACTED-session') { obj.session_id = 'REDACTED-session'; n += 1; }
  }
  return n;
}

// 规则表（有序；每条 {cat, re, repl}）。repl 为函数以支持捕获组 + 计数。
// 冻结面：脱敏是「安全方向」——宁可多替换，不可漏（漏 = secret 进 git）。
function buildRules(user) {
  const rules = [
    // —— home / 绝对路径（SEC-15 首要对象）——
    { cat: 'home_path_users', re: /\/Users\/(?!REDACTED\b)[^/"\\\s]+/g, repl: () => '/Users/REDACTED' },
    { cat: 'home_path_home',  re: /\/home\/(?!REDACTED\b)[^/"\\\s]+/g,  repl: () => '/home/REDACTED' },
    // 备份 dashified 工程目录（CC 私有约定：/Users/<u>/… → -Users-<u>-…）
    { cat: 'dashified_users', re: /-Users-(?!REDACTED\b)[A-Za-z0-9._]+-/g, repl: () => '-Users-REDACTED-' },

    // —— 密钥模式（\b / 安全边界保护 base64 签名不误伤）——
    { cat: 'anthropic_key', re: /\bsk-ant-[A-Za-z0-9_-]{8,}/g, repl: () => 'sk-ant-REDACTED' },
    { cat: 'generic_sk_key', re: /\bsk-[A-Za-z0-9_-]{20,}/g, repl: () => 'sk-REDACTED' },
    { cat: 'aws_akid', re: /\b(AKIA|ASIA)[0-9A-Z]{12,}\b/g, repl: (_m, p) => p + '-REDACTED' },
    { cat: 'github_token', re: /\b(ghp|gho|ghs|ghr|ghu)_[A-Za-z0-9]{20,}\b/g, repl: (_m, p) => p + '_REDACTED' },
    { cat: 'github_pat', re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, repl: () => 'github_pat_REDACTED' },
    { cat: 'google_key', re: /\bAIza[0-9A-Za-z_-]{20,}\b/g, repl: () => 'AIza-REDACTED' },
    { cat: 'slack_token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, repl: () => 'xoxb-REDACTED' },
    { cat: 'bearer', re: /Bearer\s+(?!REDACTED\b)[A-Za-z0-9._-]{8,}/g, repl: () => 'Bearer REDACTED' },
    // sentinel 去 BEGIN/END 标记：否则 scan 的 private_key_block 模式会复命中已脱敏输出（FP）。
    { cat: 'private_key_block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, repl: () => '[PRIVATE KEY REDACTED]' },

    // —— JSON 键值敏感字段（值替 REDACTED，键/分隔符原样保 JSON 合法）——
    { cat: 'kv_secret', re: /"(authorization|password|passwd|secret|api[_-]?key|access[_-]?key|client_secret|refresh_token|private_key)"(\s*:\s*)"(?!REDACTED)[^"]*"/gi, repl: (_m, k, sep) => '"' + k + '"' + sep + '"REDACTED"' },

    // —— env 值样式（KEY=VALUE，仅敏感命名 + 文本边界，防 base64 padding 误伤）——
    { cat: 'env_secret', re: /(?<=^|[\s;:'"(])([A-Z][A-Z0-9_]*(?:SECRET|TOKEN|KEY|PASSWORD|PASSWD|CREDENTIAL)[A-Z0-9_]*)=([^\s"']+)/g, repl: (_m, k) => k + '=REDACTED' },
  ];

  // 裸用户名残留（home 路径已被上面吃掉；此条兜底非路径处的用户名）。
  // 用「安全定界符」lookaround 而非 \b：避免误伤 base64 签名里的 `+xx/`（+ / 非安全定界符），
  // 也不碰路径（已 REDACTED）。任意长度用户名均安全。
  if (user && user !== 'REDACTED') {
    const D = "[\\s\"'`:=,(){}\\[\\]]";
    rules.push({
      cat: 'username',
      re: new RegExp(`(?<=^|${D})(${escapeRe(user)})(?=$|${D})`, 'g'),
      repl: () => 'REDACTED',
    });
  }
  return rules;
}

export function redactText(text, user = currentUser()) {
  const rules = buildRules(user);
  const counts = {};
  let total = 0;
  let out = text;
  for (const { cat, re, repl } of rules) {
    out = out.replace(re, (...args) => {
      counts[cat] = (counts[cat] || 0) + 1;
      total += 1;
      return typeof repl === 'function' ? repl(...args) : repl;
    });
  }
  return { out, counts, total };
}

// 逐行脱敏 + JSON 合法性自检。返回 {text, counts, total, lines}。
// opts.redactIds：fixture 入库路径产物置真，额外脱敏 uuid/session_id（见 scrubRecordIds）。
export function redactJsonl(input, user = currentUser(), opts = {}) {
  const { redactIds = false } = opts;
  const hadTrailingNl = /\n$/.test(input);
  const lines = input.split('\n');
  const merged = {};
  let total = 0;
  const outLines = [];
  let lineNo = 0;
  for (const line of lines) {
    lineNo += 1;
    if (line === '') { outLines.push(line); continue; }
    const { out, counts, total: t } = redactText(line, user);
    // 自检：脱敏后仍须是合法 JSON（后续解析测试要吃它）。
    let obj;
    try {
      obj = JSON.parse(out);
    } catch (e) {
      throw new Error(`redact 后第 ${lineNo} 行非合法 JSON：${e.message}\n  ${out.slice(0, 200)}`);
    }
    // 结构级：system/init 环境清单字段置空（键保留、仍是数组，JSON 合法性不变）；
    // fixture 入库时另脱敏每会话标识 uuid/session_id。任一命中即以 obj 重新序列化。
    let outLine = out;
    const nInit = scrubInitMetadata(obj);
    const nIds = redactIds ? scrubRecordIds(obj) : 0;
    if (nInit > 0 || nIds > 0) {
      outLine = JSON.stringify(obj);
      if (nInit > 0) { merged.init_metadata = (merged.init_metadata || 0) + nInit; total += nInit; }
      if (nIds > 0) { merged.record_ids = (merged.record_ids || 0) + nIds; total += nIds; }
    }
    for (const [k, v] of Object.entries(counts)) merged[k] = (merged[k] || 0) + v;
    total += t;
    outLines.push(outLine);
  }
  let text = outLines.join('\n');
  if (hadTrailingNl && !text.endsWith('\n')) text += '\n';
  return { text, counts: merged, total, lines: lineNo };
}

function main() {
  const [inPath, outPath] = process.argv.slice(2);
  const input = inPath ? readFileSync(inPath, 'utf8') : readFileSync(0, 'utf8');
  // fixture 入库产物（fixtures/recorded/…）额外脱敏 uuid/session_id → 后续录制不复发真实每会话标识；
  // 诊断流（logs/nightly，不入 git）不触发，session_id 仍作解析契约字段保留。
  const redactIds = /fixtures[/\\]recorded[/\\]/.test(outPath || '');
  const { text, counts, total } = redactJsonl(input, undefined, { redactIds });
  if (outPath) writeFileSync(outPath, text);
  else process.stdout.write(text);
  const catStr = Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' ') || '(none)';
  process.stderr.write(`[redact] file=${inPath || '<stdin>'} total=${total} ${catStr}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
