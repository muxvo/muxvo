#!/usr/bin/env node
// secret-scan 门（契约录制防漂移锚 fake-cli.md §4 锚1 的「过一道 secret-scan 门」）。
// 对整目录（默认 fixtures/）扫密钥模式 + home 路径残留 + 真实用户名残留。
// 命中即**非零退出**并打印命中处（file:line 命中类别 + 片段）；零命中才算录制完成。
// 录制流水线末尾（record.sh）自动跑一遍。复用 open-source-audit 思路。
//
// 用法：node scan.mjs [dir_or_file ...]   # 缺省扫本目录 fixtures/

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INIT_INVENTORY_FIELDS } from './redact.mjs';

function currentUser() {
  return process.env.USER || process.env.LOGNAME || process.env.USERNAME || '';
}
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function buildPatterns(user) {
  const pats = [
    { name: 'home_path_users', re: /\/Users\/(?!REDACTED\b)[^/"\\\s]+/g },
    { name: 'home_path_home',  re: /\/home\/(?!REDACTED\b)[^/"\\\s]+/g },
    { name: 'dashified_users', re: /-Users-(?!REDACTED\b)[A-Za-z0-9._]+-/g },
    { name: 'anthropic_key', re: /\bsk-ant-(?!REDACTED\b)[A-Za-z0-9_-]{8,}/g },
    { name: 'generic_sk_key', re: /\bsk-[A-Za-z0-9_-]{20,}/g },
    { name: 'aws_akid', re: /\b(AKIA|ASIA)[0-9A-Z]{12,}\b/g },
    { name: 'github_token', re: /\b(ghp|gho|ghs|ghr|ghu)_[A-Za-z0-9]{20,}\b/g },
    { name: 'github_pat', re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
    { name: 'google_key', re: /\bAIza[0-9A-Za-z_-]{20,}\b/g },
    { name: 'slack_token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g },
    { name: 'bearer', re: /Bearer\s+(?!REDACTED\b)[A-Za-z0-9._-]{8,}/g },
    { name: 'private_key_block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
    { name: 'kv_secret', re: /"(authorization|password|passwd|secret|api[_-]?key|access[_-]?key|client_secret|refresh_token|private_key)"\s*:\s*"(?!REDACTED)[^"]+"/gi },
    // env 值样式（与 redact.mjs env_secret 对齐——守「redact 有的 scan 必有」不变式）。
    // 负向前瞻排除 REDACTED sentinel：redact 把值替成 KEY=REDACTED，scan 不得再命中它。
    { name: 'env_secret', re: /(?<=^|[\s;:'"(])[A-Z][A-Z0-9_]*(?:SECRET|TOKEN|KEY|PASSWORD|PASSWD|CREDENTIAL)[A-Z0-9_]*=(?!REDACTED\b)[^\s"']+/g },
  ];
  if (user && user !== 'REDACTED') {
    const D = "[\\s\"'`:=,(){}\\[\\]]";
    pats.push({ name: 'username', re: new RegExp(`(?<=^|${D})${escapeRe(user)}(?=$|${D})`, 'g') });
  }
  return pats;
}

// 结构级门：recorded fixture 的 system/init 清单字段必须已置空（redact 的镜像断言）。
// 覆盖 .jsonl（逐行事件）与 .script.json（steps[].emit 包裹的事件）两形态。
function initHits(file, text) {
  const hits = [];
  const check = (obj, ref) => {
    if (obj && obj.type === 'system' && obj.subtype === 'init') {
      for (const f of INIT_INVENTORY_FIELDS) {
        if (Array.isArray(obj[f]) && obj[f].length > 0) {
          hits.push({ file, line: ref, pat: 'init_metadata_leak', snippet: `init.${f}[${obj[f].length}]` });
        }
      }
    }
  };
  if (file.endsWith('.jsonl')) {
    text.split('\n').forEach((l, i) => { if (l.trim()) { try { check(JSON.parse(l), i + 1); } catch { /* 非 JSON 行交给正则扫 */ } } });
  } else if (file.endsWith('.json')) {
    try {
      const j = JSON.parse(text);
      if (j && Array.isArray(j.steps)) j.steps.forEach((s, i) => { if (s && s.emit) check(s.emit, `step${i}`); });
    } catch { /* 非法 script 交给正则扫 */ }
  }
  return hits;
}

function walk(p, acc) {
  const st = statSync(p);
  if (st.isDirectory()) {
    for (const e of readdirSync(p)) walk(join(p, e), acc);
  } else if (/\.(jsonl|json|txt)$/.test(p)) {
    acc.push(p);
  }
  return acc;
}

function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const targets = process.argv.slice(2);
  const roots = targets.length ? targets : [join(here, 'fixtures')];
  const user = currentUser();
  const pats = buildPatterns(user);

  const files = [];
  for (const r of roots) { try { walk(r, files); } catch { /* 目录不存在忽略 */ } }

  const hits = [];
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    text.split('\n').forEach((line, i) => {
      for (const { name, re } of pats) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(line)) !== null) {
          hits.push({ file: f, line: i + 1, pat: name, snippet: m[0].slice(0, 60) });
          if (m.index === re.lastIndex) re.lastIndex += 1; // 防零宽死循环
        }
      }
    });
    hits.push(...initHits(f, text));
  }

  if (hits.length) {
    console.error(`SCAN FAIL: ${hits.length} hit(s) across ${files.length} file(s):`);
    for (const h of hits) console.error(`  ${h.file}:${h.line} [${h.pat}] ${h.snippet}`);
    process.exit(1);
  }
  console.log(`scan clean: ${files.length} file(s), 0 hit(s) (user=${user || '?'})`);
}

main();
