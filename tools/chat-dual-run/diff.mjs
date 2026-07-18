// 双跑对照 diff（chat-data.md §8.2 归一化 → 逐字节比）。零依赖 node ESM。
//
// 两侧（legacy reader dump / 新版 muxvo-chat-dump）各自输出四类型 legacy 字段名 JSON 数组；
// 本工具对两侧**对称**施加 §8.2 归一化后规范序列化再比：
//   1. 排序：projects 按 projectHash；sessions/search 按 (projectHash, sessionId)；
//      messages（session）保文件序不排序（投影顺序即红线）。
//   2. mtime floor 到整数毫秒（lastActivity / lastModified）。
//   3. 孤代理码元 → U+FFFD（§4.2 按码元截断可能切断代理对）。
//   4. 值为 null/undefined 的可选键省略（对齐 JSON.stringify 丢 undefined）。
//   5. source 必填（两侧恒有，不省略）。
//   规范序列化 = 递归排序对象键，两侧同一算法 → 逐字节比。
//
// CLI：node diff.mjs <kind> <legacyPath> <newPath>   kind ∈ projects|sessions|session|search
// 退出：零差异 exit 0；有差异 exit 1 + 首异定位到 stderr。
// 也可 import { diffRecords } 复用。

import { readFileSync } from 'node:fs';

const MTIME_KEYS = new Set(['lastActivity', 'lastModified']);

/** 孤代理码元 → U+FFFD（配对代理保留）。 */
export function fixSurrogates(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (n >= 0xdc00 && n <= 0xdfff) { out += s[i] + s[i + 1]; i++; }
      else out += '�';
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      out += '�';
    } else {
      out += s[i];
    }
  }
  return out;
}

/** 递归归一：字符串修孤代理、丢 null/undefined 键（数组元素不丢）。 */
function normalizeValue(v) {
  if (v === null || v === undefined) return v;
  if (typeof v === 'string') return fixSurrogates(v);
  if (Array.isArray(v)) return v.map(normalizeValue);
  if (typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) {
      const nv = v[k];
      if (nv === null || nv === undefined) continue; // §8.2 规则4：nil 键省略
      out[k] = normalizeValue(nv);
    }
    return out;
  }
  return v;
}

/** 记录级归一：值归一 + mtime floor。 */
function normalizeRecord(rec) {
  const r = normalizeValue(rec);
  for (const k of MTIME_KEYS) {
    if (k in r && typeof r[k] === 'number') r[k] = Math.floor(r[k]);
  }
  return r;
}

/** 规范序列化：递归排序对象键（数组保序）。两侧同算法 → 可逐字节比。 */
export function canonical(v) {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (typeof v === 'object') {
    const keys = Object.keys(v).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}

function sortKey(kind, rec) {
  if (kind === 'projects') return String(rec.projectHash ?? '');
  return String(rec.projectHash ?? '') + '\u0000' + String(rec.sessionId ?? '');
}

/** 归一 + 排序（messages 不排序）。 */
function prepare(kind, arr) {
  const normalized = arr.map(normalizeRecord);
  if (kind === 'session') return normalized; // 保文件序
  return normalized
    .map((rec, i) => ({ rec, i, key: sortKey(kind, rec) }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.i - b.i))
    .map((x) => x.rec);
}

function firstCharDiff(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return n;
}

/**
 * 对照两侧记录数组。返回 { equal, report }。
 */
export function diffRecords(kind, legacy, fresh) {
  const L = prepare(kind, legacy);
  const R = prepare(kind, fresh);
  const lines = [];

  if (L.length !== R.length) {
    lines.push(`记录数不一致：legacy=${L.length} new=${R.length}`);
    if (kind !== 'session') {
      const lKeys = new Set(L.map((r) => sortKey(kind, r)));
      const rKeys = new Set(R.map((r) => sortKey(kind, r)));
      const onlyL = [...lKeys].filter((k) => !rKeys.has(k)).slice(0, 10);
      const onlyR = [...rKeys].filter((k) => !lKeys.has(k)).slice(0, 10);
      if (onlyL.length) lines.push(`  仅 legacy 有（前 10）：${onlyL.map((k) => k.replace(/\x00/g, '/')).join(', ')}`);
      if (onlyR.length) lines.push(`  仅 new 有（前 10）：${onlyR.map((k) => k.replace(/\x00/g, '/')).join(', ')}`);
    }
  }

  const n = Math.min(L.length, R.length);
  let firstMismatch = -1;
  for (let i = 0; i < n; i++) {
    const cl = canonical(L[i]);
    const cr = canonical(R[i]);
    if (cl !== cr) {
      firstMismatch = i;
      const off = firstCharDiff(cl, cr);
      const key = kind === 'session' ? `#${i}` : sortKey(kind, L[i]).replace(/\x00/g, '/');
      lines.push(`首个不一致记录 [${key}]（索引 ${i}，首异字符偏移 ${off}）：`);
      lines.push(`  legacy: ${clip(cl, off)}`);
      lines.push(`  new   : ${clip(cr, off)}`);
      break;
    }
  }

  const equal = L.length === R.length && firstMismatch === -1;
  return { equal, report: lines.join('\n'), legacyCount: L.length, newCount: R.length };
}

/** 截取以首异偏移为中心的窗口，便于人眼定位。 */
function clip(s, off) {
  const start = Math.max(0, off - 40);
  const end = Math.min(s.length, off + 80);
  return (start > 0 ? '…' : '') + s.slice(start, end) + (end < s.length ? '…' : '');
}

// ---- CLI ----
function isMain() {
  return import.meta.url === `file://${process.argv[1]}`;
}

if (isMain()) {
  const [kind, legacyPath, newPath] = process.argv.slice(2);
  const kinds = ['projects', 'sessions', 'session', 'search'];
  if (!kinds.includes(kind) || !legacyPath || !newPath) {
    process.stderr.write('用法：node diff.mjs <projects|sessions|session|search> <legacyPath> <newPath>\n');
    process.exit(2);
  }
  const legacy = JSON.parse(readFileSync(legacyPath, 'utf8'));
  const fresh = JSON.parse(readFileSync(newPath, 'utf8'));
  const { equal, report } = diffRecords(kind, legacy, fresh);
  if (equal) {
    process.stdout.write(`OK ${kind}: ${legacy.length} 条逐字段一致\n`);
    process.exit(0);
  } else {
    process.stderr.write(`DIFF ${kind}:\n${report}\n`);
    process.exit(1);
  }
}
