#!/usr/bin/env node
// spec-runner — legacy spec 1:1 归属强制器（零依赖 node ESM）
//
// 用法: node tools/spec-runner/run.mjs        退出码: 0=绿 1=违规 2=内部错误
//
// 输入:
//   specs/legacy/{l1,l2}/*.spec.json   老 app 行为 oracle（字节冻结，md5 见 CHECKSUMS）
//   specs/legacy/CHECKSUMS             12 文件 md5 固化
//   specs/legacy/status.json           overlay：每 ID 归属 implemented/todo/not-applicable
// 扫描宇宙:
//   swift = app/Tests/**/*.swift       Swift Testing @Test("ID: ...")；.disabled = todo 占位
//   web   = web/{src,tests}/**/*.{test,spec}.{ts,tsx,js,jsx,mts,cts}
//           vitest test('ID: ...') / test.todo / test.each('$id…) JSON 注入
//           （注入机制移植自 muxvo-legacy tests/scripts/verify-coverage.ts，并修复其
//             两处缺陷：重复检测死代码 → id→[locations] 列表收集；无防伪 → E_FORGED_ID）
//
// 裁决顺序（先全局后逐项，避免双报矛盾）:
//   1 E_SCHEMA / E_SPEC_INTEGRITY（任一出现即止步，输入不可信）
//   2 E_SET_MISMATCH   spec 全集 ↔ overlay 全集双向相等
//   3 E_FORGED_ID      任何形式的 ID 形状测试名 ∉ spec 全集（含 .disabled/@Suite，堵绕行）
//   4 E_DUPLICATE_TEST occurrences(id) > 1（含占位、含跨宇宙 1+1）
//   5 E_INJECTION_PARTIAL  被 test.each 注入的 spec 文件必须全量 implemented+owner=web
//   6 逐 ID: implemented → 恰 1 处 active 且宇宙==owner（E_IMPLEMENTED_NO_TEST/E_WRONG_UNIVERSE）
//            todo → 0 active（允许至多 1 个占位）（E_TODO_HAS_TEST）
//            not-applicable → 任何形式 0 处（E_NA_HAS_TEST）

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SPEC_DIR = join(ROOT, 'specs', 'legacy');

// ID 形状（移植老 verify-coverage.ts，176 个真实 ID 实测 100% 锚定全匹配）。
// `_L\d+_` 后须紧跟 [0-9A-Z]（数字或大写）：legacy ID 层号后恒为用例号数字（TERM_L2_56/PERF_L2_01）
// 或大写标记（CHAT_L1_T07），176 个全满足；而 M4a 自主等级测试名（PA_L0_ignores_whitelist、
// PA_L2_supervisor_route——L0-L3 后接小写描述）不满足 → 不被误判为伪造 legacy ID（E_FORGED_ID 修，波2 尾巴）。
const ID_FULL_RE = /^[A-Z][A-Z0-9]+_L\d+_[0-9A-Z][A-Za-z0-9_]*$/;
const ID_PREFIX_RE = /^([A-Z][A-Z0-9]+_L\d+_[0-9A-Z][A-Za-z0-9_]*)/;

const MILESTONE_RE = /^M[1-7]$/;
const OWNERS = new Set(['swift', 'web']);
const STATUSES = new Set(['implemented', 'todo', 'not-applicable']);

const violations = [];
const violate = (code, msg) => violations.push({ code, msg });

// ---------- 通用 ----------

const SKIP_DIRS = new Set(['node_modules', '.git', '.build', 'dist', 'build', 'vendor']);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (st.isFile()) out.push(p);
  }
  return out;
}

const lineAt = (src, idx) => src.slice(0, idx).split('\n').length;

// ---------- 1. spec 加载与完整性 ----------

function loadSpecs() {
  const checksumsPath = join(SPEC_DIR, 'CHECKSUMS');
  if (!existsSync(checksumsPath)) { violate('E_SPEC_INTEGRITY', 'specs/legacy/CHECKSUMS 不存在'); return { specIds: new Map(), fileCount: 0 }; }
  const listed = new Map(); // rel -> md5
  for (const line of readFileSync(checksumsPath, 'utf8').trim().split('\n')) {
    const m = line.match(/^([0-9a-f]{32})\s+(\S+)$/);
    if (!m) { violate('E_SPEC_INTEGRITY', `CHECKSUMS 行格式非法: ${line}`); continue; }
    listed.set(m[2], m[1]);
  }
  const actual = [];
  for (const sub of ['l1', 'l2']) {
    const d = join(SPEC_DIR, sub);
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d).sort()) if (f.endsWith('.spec.json')) actual.push(`${sub}/${f}`);
  }
  for (const rel of actual) if (!listed.has(rel)) violate('E_SPEC_INTEGRITY', `spec 文件未在 CHECKSUMS 登记: ${rel}`);
  for (const rel of listed.keys()) if (!actual.includes(rel)) violate('E_SPEC_INTEGRITY', `CHECKSUMS 登记的文件不存在: ${rel}`);

  const specIds = new Map(); // id -> 来源 rel
  for (const rel of actual) {
    if (!listed.has(rel)) continue;
    const buf = readFileSync(join(SPEC_DIR, rel));
    const md5 = createHash('md5').update(buf).digest('hex');
    if (md5 !== listed.get(rel)) { violate('E_SPEC_INTEGRITY', `${rel} md5=${md5} 与 CHECKSUMS 不符（原文件永不改）`); continue; }
    let spec;
    try { spec = JSON.parse(buf.toString('utf8')); }
    catch (e) { violate('E_SPEC_INTEGRITY', `${rel} JSON 解析失败: ${e.message}`); continue; }
    if (!Array.isArray(spec.cases)) { violate('E_SPEC_INTEGRITY', `${rel} 缺 cases 数组`); continue; }
    if (spec.totalCases !== spec.cases.length) violate('E_SPEC_INTEGRITY', `${rel} totalCases=${spec.totalCases} 与实际 cases ${spec.cases.length} 不符`);
    for (const c of spec.cases) {
      if (typeof c.id !== 'string' || !ID_FULL_RE.test(c.id)) { violate('E_SPEC_INTEGRITY', `${rel} 含非法 ID 形状: ${JSON.stringify(c.id)}`); continue; }
      if (specIds.has(c.id)) violate('E_SPEC_INTEGRITY', `spec ID 重复: ${c.id}（${specIds.get(c.id)} 与 ${rel}）`);
      else specIds.set(c.id, rel);
    }
  }
  return { specIds, fileCount: actual.length };
}

// ---------- 2. overlay 加载与 schema ----------

const REQUIRED = { implemented: 'owner', todo: 'milestone', 'not-applicable': 'reason' };

function loadOverlay() {
  const p = join(SPEC_DIR, 'status.json');
  if (!existsSync(p)) { violate('E_SCHEMA', 'specs/legacy/status.json 不存在'); return { byId: new Map(), source: {} }; }
  let doc;
  try { doc = JSON.parse(readFileSync(p, 'utf8')); }
  catch (e) { violate('E_SCHEMA', `status.json JSON 解析失败: ${e.message}`); return { byId: new Map(), source: {} }; }
  for (const k of Object.keys(doc)) if (k !== 'source' && k !== 'entries') violate('E_SCHEMA', `status.json 顶层未知字段: ${k}`);
  const src = doc.source ?? {};
  for (const k of ['repo', 'commit', 'totalCases']) if (!(k in src)) violate('E_SCHEMA', `status.json source 缺字段: ${k}`);
  if (!Array.isArray(doc.entries)) { violate('E_SCHEMA', 'status.json entries 必须是数组'); return { byId: new Map(), source: src }; }

  const byId = new Map();
  doc.entries.forEach((e, i) => {
    const where = `entries[${i}]${e && e.id ? ` (${e.id})` : ''}`;
    if (typeof e !== 'object' || e === null) { violate('E_SCHEMA', `${where} 非对象`); return; }
    if (typeof e.id !== 'string' || !e.id) { violate('E_SCHEMA', `${where} 缺 id`); return; }
    if (byId.has(e.id)) { violate('E_SCHEMA', `overlay ID 重复: ${e.id}`); return; }
    if (!STATUSES.has(e.status)) { violate('E_SCHEMA', `${where} status 非法: ${JSON.stringify(e.status)}`); return; }
    const req = REQUIRED[e.status];
    for (const k of Object.keys(e)) {
      if (!['id', 'status', 'note', req].includes(k)) violate('E_SCHEMA', `${where} status=${e.status} 不允许字段: ${k}`);
    }
    if (e.status === 'implemented' && !OWNERS.has(e.owner)) violate('E_SCHEMA', `${where} implemented 必填 owner∈{swift,web}，得到: ${JSON.stringify(e.owner)}`);
    if (e.status === 'todo' && !(typeof e.milestone === 'string' && MILESTONE_RE.test(e.milestone))) violate('E_SCHEMA', `${where} todo 必填 milestone∈{M1..M7}，得到: ${JSON.stringify(e.milestone)}`);
    if (e.status === 'not-applicable' && !(typeof e.reason === 'string' && e.reason.trim())) violate('E_SCHEMA', `${where} not-applicable 必填非空 reason`);
    byId.set(e.id, e);
  });
  return { byId, source: src };
}

// ---------- 3. Swift 宇宙扫描 ----------

// 读 Swift 字符串字面量（含 #raw#、"""多行、\" 转义、\(...) 插值内括号）。
// 返回 {value, end}；start 处不是字符串则返回 null。
function readSwiftString(src, start) {
  let k = start, hashes = 0;
  while (src[k] === '#') { hashes++; k++; }
  if (src[k] !== '"') return null;
  const triple = src.startsWith('"""', k);
  const open = triple ? '"""' : '"';
  k += open.length;
  const closer = open + '#'.repeat(hashes);
  let value = '';
  while (k < src.length) {
    if (src[k] === '\\' && hashes === 0) {
      const nxt = src[k + 1];
      if (nxt === '(') { // 插值：按括号配对跳过，内嵌字符串递归消费
        let d = 1, m = k + 2;
        while (m < src.length && d > 0) {
          const lit = (src[m] === '"' || src[m] === '#') ? readSwiftString(src, m) : null;
          if (lit) { m = lit.end; continue; }
          if (src[m] === '(') d++;
          else if (src[m] === ')') d--;
          m++;
        }
        value += '\u0000'; // 插值占位：含插值的显示名不可能是合法 spec ID
        k = m; continue;
      }
      value += nxt ?? ''; k += 2; continue;
    }
    if (src.startsWith(closer, k)) return { value, end: k + closer.length };
    value += src[k]; k++;
  }
  return { value, end: k }; // 未闭合：容忍（编译器自会报错）
}

function skipWsComments(src, k) {
  while (k < src.length) {
    const ch = src[k];
    if (/\s/.test(ch)) { k++; continue; }
    if (ch === '/' && src[k + 1] === '/') { const e = src.indexOf('\n', k); k = e === -1 ? src.length : e; continue; }
    if (ch === '/' && src[k + 1] === '*') { const e = src.indexOf('*/', k + 2); k = e === -1 ? src.length : e + 2; continue; }
    break;
  }
  return k;
}

// 解析一个 .swift 文件里的全部 @Test/@Suite 属性（多行安全、字符串/注释安全）
function parseSwift(src) {
  const found = []; // {attr:'Test'|'Suite', name:string|null, disabled, line}
  let noName = 0, i = 0;
  while (i < src.length) {
    const idxT = src.indexOf('@Test', i);
    const idxS = src.indexOf('@Suite', i);
    if (idxT === -1 && idxS === -1) break;
    let idx, attr;
    if (idxT !== -1 && (idxS === -1 || idxT < idxS)) { idx = idxT; attr = 'Test'; }
    else { idx = idxS; attr = 'Suite'; }
    let j = idx + 1 + attr.length;
    if (src[j] && /[A-Za-z0-9_]/.test(src[j])) { i = j; continue; } // @Testable 等
    j = skipWsComments(src, j);
    if (src[j] !== '(') { // 无显示名（@Test func foo()）
      if (attr === 'Test') noName++;
      i = j; continue;
    }
    let depth = 0, k = j, name = null, disabled = false;
    while (k < src.length) {
      const ch = src[k];
      if (ch === '/' && src[k + 1] === '/') { const e = src.indexOf('\n', k); k = e === -1 ? src.length : e; continue; }
      if (ch === '/' && src[k + 1] === '*') { const e = src.indexOf('*/', k + 2); k = e === -1 ? src.length : e + 2; continue; }
      if (ch === '"' || ch === '#') {
        const lit = readSwiftString(src, k);
        if (lit) { if (name === null) name = lit.value; k = lit.end; continue; }
      }
      if (ch === '.' && src.startsWith('.disabled', k) && !/[A-Za-z0-9_]/.test(src[k + 9] ?? '')) { disabled = true; k += 9; continue; }
      if (ch === '(') { depth++; k++; continue; }
      if (ch === ')') { depth--; k++; if (depth === 0) break; continue; }
      k++;
    }
    found.push({ attr, name, disabled, line: lineAt(src, idx) });
    i = k;
  }
  return { found, noName };
}

// ---------- 主流程 ----------

function main() {
  const { specIds, fileCount } = loadSpecs();
  const { byId: overlay, source } = loadOverlay();
  if (violations.length) return report(null);

  // 扫描收集：occurrences = id -> [{universe, kind, loc}]，kind ∈ active|todo-marker|injected
  const occurrences = new Map();
  const idShapedNames = []; // 防伪面：含 @Suite 与所有占位
  const addOcc = (id, universe, kind, loc) => {
    if (!occurrences.has(id)) occurrences.set(id, []);
    occurrences.get(id).push({ universe, kind, loc });
  };
  const addName = (display, universe, kind, loc, isSuite = false) => {
    const m = typeof display === 'string' ? display.match(ID_PREFIX_RE) : null;
    if (!m) return;
    idShapedNames.push({ id: m[1], loc });
    if (!isSuite) addOcc(m[1], universe, kind, loc);
  };

  // swift 宇宙
  const stats = { swiftFiles: 0, swiftTests: 0, swiftIdNamed: 0, swiftDisabled: 0, swiftNoName: 0, swiftSuites: 0, webFiles: 0 };
  const swiftRoot = join(ROOT, 'app', 'Tests');
  if (existsSync(swiftRoot)) {
    for (const p of walk(swiftRoot)) {
      if (!p.endsWith('.swift')) continue;
      stats.swiftFiles++;
      const src = readFileSync(p, 'utf8');
      const rel = relative(ROOT, p);
      const { found, noName } = parseSwift(src);
      stats.swiftNoName += noName;
      for (const f of found) {
        if (f.attr === 'Suite') { stats.swiftSuites++; addName(f.name, 'swift', 'suite', `${rel}:${f.line}`, true); continue; }
        stats.swiftTests++;
        if (f.disabled) stats.swiftDisabled++;
        if (typeof f.name === 'string' && ID_PREFIX_RE.test(f.name)) stats.swiftIdNamed++;
        addName(f.name, 'swift', f.disabled ? 'todo-marker' : 'active', `${rel}:${f.line}`);
      }
      stats.swiftTests += noName;
    }
  }

  // web 宇宙（移植老 verify-coverage 三正则 + test.each JSON 注入）
  const injectedSpecs = []; // {testFile, ids:[...]}
  const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx|js|jsx|mts|cts)$/;
  for (const root of [join(ROOT, 'web', 'src'), join(ROOT, 'web', 'tests')]) {
    if (!existsSync(root)) continue;
    for (const p of walk(root)) {
      if (!TEST_FILE_RE.test(p)) continue;
      const rel = relative(ROOT, p);
      if (rel.startsWith('specs/') || rel.startsWith(join('tools', 'spec-runner'))) continue; // 双保险
      stats.webFiles++;
      const src = readFileSync(p, 'utf8');
      for (const m of src.matchAll(/test\.todo\s*\(\s*['"`]([^'"`]+)['"`]/g))
        addName(m[1], 'web', 'todo-marker', `${rel}:${lineAt(src, m.index)}`);
      for (const m of src.matchAll(/(?<!\.todo\s*)\btest\s*\(\s*['"`]([^'"`]+)['"`]/g))
        addName(m[1], 'web', 'active', `${rel}:${lineAt(src, m.index)}`);
      // test.each 注入：宽检测（老机制 [^)]* 跨不过嵌套括号，这里宁可误报逼显式归属）
      if (/test\.each\s*\(/.test(src) && /['"`]\$id/.test(src)) {
        const imports = [...src.matchAll(/import\s+(?:[\w$]+|\*\s+as\s+[\w$]+)\s+from\s+['"]([^'"]+\.spec\.json)['"]/g)].map(m => m[1]);
        if (imports.length === 0) violate('E_INJECTION_PARTIAL', `${rel}: 检测到 test.each('$id…) 注入但无 .spec.json import 可解析`);
        for (const sp of imports) {
          const abs = resolve(dirname(p), sp);
          if (!existsSync(abs)) { violate('E_INJECTION_PARTIAL', `${rel}: spec import 不存在: ${sp}`); continue; }
          let spec;
          try { spec = JSON.parse(readFileSync(abs, 'utf8')); }
          catch (e) { violate('E_INJECTION_PARTIAL', `${rel}: spec import 解析失败 ${sp}: ${e.message}`); continue; }
          const ids = (spec.cases ?? []).map(c => c.id).filter(id => typeof id === 'string');
          injectedSpecs.push({ testFile: rel, ids });
          for (const id of ids) {
            idShapedNames.push({ id, loc: `${rel} (test.each←${sp})` });
            addOcc(id, 'web', 'injected', `${rel} (test.each←${sp})`);
          }
        }
      }
    }
  }

  // 2. 双向集合相等
  for (const id of specIds.keys()) if (!overlay.has(id)) violate('E_SET_MISMATCH', `spec ID 缺归属（overlay 没有）: ${id}`);
  for (const id of overlay.keys()) if (!specIds.has(id)) violate('E_SET_MISMATCH', `overlay ID 不在 spec 全集: ${id}`);

  // 3. 防伪
  for (const n of idShapedNames) if (!specIds.has(n.id)) violate('E_FORGED_ID', `测试名伪造 spec-ID 形状但不在 spec 全集: ${n.id} @ ${n.loc}`);

  // 4. 全局唯一性
  const dupIds = new Set();
  for (const [id, occs] of occurrences) {
    if (occs.length > 1) {
      dupIds.add(id);
      violate('E_DUPLICATE_TEST', `同 ID 出现在 ${occs.length} 处: ${id} → ${occs.map(o => `[${o.universe}/${o.kind}] ${o.loc}`).join('; ')}`);
    }
  }

  // 5. 注入约束
  for (const inj of injectedSpecs) {
    const bad = inj.ids.filter(id => { const e = overlay.get(id); return !(e && e.status === 'implemented' && e.owner === 'web'); });
    if (bad.length) violate('E_INJECTION_PARTIAL', `${inj.testFile}: test.each 注入要求被注入 spec 全量 implemented+owner=web，不满足的 ID（${bad.length}）: ${bad.slice(0, 5).join(', ')}${bad.length > 5 ? ' …' : ''}`);
  }

  // 6. 逐 ID 按 status 裁决（重复者已在 4 报过，跳过避免双报）
  const tally = { implemented: 0, todo: 0, 'not-applicable': 0 };
  const todoByMs = {};
  for (const [id, e] of overlay) {
    if (!specIds.has(id)) continue;
    tally[e.status]++;
    if (e.status === 'todo') todoByMs[e.milestone] = (todoByMs[e.milestone] ?? 0) + 1;
    if (dupIds.has(id)) continue;
    const occs = occurrences.get(id) ?? [];
    const one = occs[0];
    if (e.status === 'implemented') {
      if (occs.length === 0) violate('E_IMPLEMENTED_NO_TEST', `${id} 标 implemented(${e.owner}) 但无任何测试`);
      else if (one.kind === 'todo-marker') violate('E_IMPLEMENTED_NO_TEST', `${id} 标 implemented(${e.owner}) 但唯一测试是占位（${one.kind}）@ ${one.loc}`);
      else if (one.universe !== e.owner) violate('E_WRONG_UNIVERSE', `${id} owner=${e.owner} 但测试在 ${one.universe} 宇宙 @ ${one.loc}`);
    } else if (e.status === 'todo') {
      if (one && one.kind !== 'todo-marker') violate('E_TODO_HAS_TEST', `${id} 标 todo(${e.milestone}) 但存在 ${one.kind} 测试 @ ${one.loc}`);
    } else { // not-applicable
      if (one) violate('E_NA_HAS_TEST', `${id} 标 not-applicable 但存在测试（${one.kind}）@ ${one.loc}`);
    }
  }

  return report({ specIds, overlay, source, fileCount, stats, tally, todoByMs });
}

function report(ctx) {
  console.log('spec-runner — legacy spec 1:1 归属检查');
  if (ctx) {
    const { specIds, overlay, source, fileCount, stats, tally, todoByMs } = ctx;
    const bucketSum = tally.implemented + tally.todo + tally['not-applicable'];
    console.log(`  spec 文件: ${fileCount}（md5 全部与 CHECKSUMS 一致）`);
    console.log(`  四方一致: spec ${specIds.size} | overlay ${overlay.size} | 桶合计 ${bucketSum} | source.totalCases ${source.totalCases}`);
    if (!(specIds.size === overlay.size && overlay.size === bucketSum && bucketSum === source.totalCases))
      violate('E_SET_MISMATCH', `四方计数不一致: spec=${specIds.size} overlay=${overlay.size} 桶=${bucketSum} totalCases=${source.totalCases}`);
    console.log(`  归属: implemented ${tally.implemented} / todo ${tally.todo} / not-applicable ${tally['not-applicable']} — ${bucketSum}/${source.totalCases} attributed`);
    const ms = Object.keys(todoByMs).sort().map(k => `${k} ${todoByMs[k]}`).join(', ');
    console.log(`  todo by milestone: ${ms || '(无)'}`);
    console.log(`  swift 宇宙: ${stats.swiftFiles} 文件 / @Test ${stats.swiftTests}（ID 命名 ${stats.swiftIdNamed}, disabled ${stats.swiftDisabled}, 无显示名 ${stats.swiftNoName}）/ @Suite ${stats.swiftSuites}`);
    console.log(`  web 宇宙: ${stats.webFiles} 测试文件`);
  }
  if (violations.length) {
    console.log('');
    for (const v of violations) console.log(`  ${v.code} ${v.msg}`);
    console.log(`\nRED — ${violations.length} violation(s)`);
    process.exitCode = 1;
  } else {
    console.log('\nGREEN');
    process.exitCode = 0;
  }
}

try { main(); }
catch (e) { console.error('INTERNAL_ERROR:', e?.stack ?? String(e)); process.exitCode = 2; }
