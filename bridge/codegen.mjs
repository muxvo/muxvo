#!/usr/bin/env node
// bridge/codegen.mjs — 桥协议唯一来源的双侧类型生成器 + CI 检查。
// 权威规格：specs/bridge/bridge-v1.md（v1-frozen）§6 DSL 八项冻结清单 / §7 CI 五检查 + selftest 六用例。
//
// 协议来源（开源前置重构：核心/编排物理拆分，2026-07-18）：
//   · bridge/protocol.core.json —— 核心协议（公开仓；protocolVersion + core 类型 + 10 条非 orch 消息）
//   · bridge/protocol.orch.json —— 编排协议（护城河，私仓专属；orch-only 类型 + 4 条 orch 消息 +
//     `typeOrder` 全序清单，令合并后类型顺序与拆分前逐字一致 = 生成物字节不变）
//   两文件都在 = 私仓全量（14 消息/101 类型，与拆分前 protocol.json 等价）；只有 core = 公开仓核心
//   （10 消息/69 类型，无 orch）。合并见 loadProtocol/mergeProtocol；旧单文件 protocol.json 仍作降级降落。
//
// 用法：
//   node bridge/codegen.mjs                  生成两侧 Gen 文件（提交入库）：TS 单文件 + Swift 按消息域
//                                            多文件（并同步删除 Gen/ 内不在本次输出集的 *.swift）
//   node bridge/codegen.mjs --check          CI 检查：①总数≤15 ②非orch≤11且orch恰4全active
//                                            ③payload 命名类型 ④codegen 漂移（逐输出文件比对 +
//                                            Gen/ 目录外来 .swift 红灯）⑤protocolVersion 递增
//   node bridge/codegen.mjs --check --selftest  先跑九反例自检（红灯路径自验）再跑真检查
//
// Swift 输出分区（批4.6 拆分裁决 A 案，logs/m4a-batch4.6-protocol-split-adjudication.md）：
//   域 = 消息名首段（bridge/ui/term/orch/…）。每条非 null payload 消息从 payload 根类型做引用
//   可达闭包；类型恰属一域 → Gen/Protocol+<域首字母大写>.swift，属多域 → Gen/Protocol+Shared.swift
//   （死类型同归 Shared，W_DEAD_TYPE 兜底）；桥元数据（BridgeProtocol/BridgeDirection/BridgePattern/
//   BridgeStatus/BridgeMessageType）恒留 Gen/Protocol.swift。域序 = 消息插入序首现；
//   文件内类型序 = protocol.json 插入序。空桶不出文件。TS 侧维持单文件。
//
// 纪律：零 npm 依赖；输出确定性（无时间戳/随机量/文件系统序——readdir 后必 sort，
// 同输入字节级同输出——检查④的前提）。
// exit code：0 绿（warning 允许）/ 1 任一检查红或 selftest 失败 / 2 I/O、JSON 解析等基础设施错误。

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const BRIDGE_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(BRIDGE_DIR, '..');
const CORE_PATH = join(BRIDGE_DIR, 'protocol.core.json');
const ORCH_PATH = join(BRIDGE_DIR, 'protocol.orch.json');
const PROTOCOL_PATH = join(BRIDGE_DIR, 'protocol.json'); // 拆分前旧单文件（降级降落）
const SWIFT_GEN_DIR = join(ROOT, 'app', 'Sources', 'MuxvoBridge', 'Gen');
const TS_OUT = join(ROOT, 'web', 'src', 'bridge', 'gen', 'protocol.ts');

const PRIMITIVES = new Set(['string', 'int', 'double', 'bool']);
const DIRECTIONS = new Set(['webToNative', 'nativeToWeb']);
const PATTERNS = new Set(['request', 'push', 'event']);
const STATUSES = new Set(['active', 'stub', 'reserved']);
const TYPE_NAME_RE = /^[A-Z][A-Za-z0-9]*$/;
const ENUM_VALUE_RE = /^[A-Za-z][A-Za-z0-9]*$/;
const FIELD_NAME_RE = /^[a-z][A-Za-z0-9]*$/;
const MESSAGE_NAME_RE = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/;

// ---------- validate（纯函数；selftest 复用同一入口） ----------

function validate(protocol, opts = {}) {
  // hasOrch：orch 来源在场（私仓全量）→ orch 恰 4 全 active；缺省 true（旧单文件/selftest 全量基准）。
  //          false（公开仓仅核心）→ orch 恰 0。
  const hasOrch = opts.hasOrch ?? true;
  const errors = [];
  const warnings = [];
  const err = (code, msg) => errors.push({ code, msg });
  const warn = (code, msg) => warnings.push({ code, msg });

  if (!Number.isInteger(protocol.protocolVersion) || protocol.protocolVersion < 1) {
    err('E_SCHEMA', `protocolVersion 必须是 ≥1 的整数，得到 ${JSON.stringify(protocol.protocolVersion)}`);
  }
  if (!Array.isArray(protocol.messages)) {
    err('E_SCHEMA', 'messages 必须是数组');
    return { errors, warnings };
  }
  if (typeof protocol.types !== 'object' || protocol.types === null || Array.isArray(protocol.types)) {
    err('E_SCHEMA', 'types 必须是对象');
    return { errors, warnings };
  }
  const types = protocol.types;

  // --- 类型表结构 ---
  const typeNames = Object.keys(types);
  for (const name of typeNames) {
    if (!TYPE_NAME_RE.test(name)) err('E_SCHEMA', `类型名必须 PascalCase: ${name}`);
    const def = types[name];
    if (typeof def !== 'object' || def === null) { err('E_SCHEMA', `类型 ${name} 定义非对象`); continue; }
    switch (def.kind) {
      case 'record':
        validateFields(name, def.fields, err);
        break;
      case 'enum': {
        if (!Array.isArray(def.values) || def.values.length === 0) {
          err('E_SCHEMA', `enum ${name} 的 values 必须是非空数组`);
          break;
        }
        const seen = new Set();
        const caseSeen = new Map();
        for (const v of def.values) {
          if (typeof v !== 'string' || !ENUM_VALUE_RE.test(v)) {
            err('E_SCHEMA', `enum ${name} 的值必须是字母开头的字母数字串: ${JSON.stringify(v)}`);
            continue;
          }
          if (seen.has(v)) err('E_SCHEMA', `enum ${name} 值重复: ${v}`);
          seen.add(v);
          const caseName = lowerFirst(v);
          if (caseSeen.has(caseName) && caseSeen.get(caseName) !== v) {
            err('E_ENUM_CASE_COLLISION', `enum ${name} 的值 ${caseSeen.get(caseName)} 与 ${v} 小写化后撞名（Swift case ${caseName}）`);
          }
          caseSeen.set(caseName, v);
        }
        break;
      }
      case 'union': {
        if (!Array.isArray(def.variants) || def.variants.length === 0) {
          err('E_SCHEMA', `union ${name} 的 variants 必须是非空数组`);
          break;
        }
        const variantNames = new Set();
        for (const v of def.variants) {
          if (typeof v.name !== 'string' || !FIELD_NAME_RE.test(v.name)) {
            err('E_SCHEMA', `union ${name} 的 variant 名必须 camelCase: ${JSON.stringify(v.name)}`);
            continue;
          }
          if (variantNames.has(v.name)) {
            err('E_UNION_DUP_KIND', `union ${name} 的 variant kind 值重复: ${v.name}`);
          }
          variantNames.add(v.name);
          validateFields(`${name}.${v.name}`, v.fields, err, /* forbidKind */ true);
        }
        break;
      }
      case 'alias':
        validateTypeExpr(`alias ${name}`, def.type, err);
        break;
      default:
        err('E_SCHEMA', `类型 ${name} 的 kind 非法: ${JSON.stringify(def.kind)}（允许 record/enum/union/alias）`);
    }
  }

  function validateFields(where, fields, err, forbidKind = false) {
    if (!Array.isArray(fields)) { err('E_SCHEMA', `${where} 的 fields 必须是数组`); return; }
    const seen = new Set();
    for (const f of fields) {
      if (typeof f !== 'object' || f === null || typeof f.name !== 'string') {
        err('E_SCHEMA', `${where} 存在非法字段条目`);
        continue;
      }
      if (!FIELD_NAME_RE.test(f.name)) err('E_SCHEMA', `${where} 字段名必须 camelCase: ${f.name}`);
      if (forbidKind && f.name === 'kind') err('E_FIELD_KIND', `${where} 的 variant 字段禁用名 kind（判别字段由生成器硬编码）`);
      if (seen.has(f.name)) err('E_SCHEMA', `${where} 字段名重复: ${f.name}`);
      seen.add(f.name);
      for (const k of Object.keys(f)) {
        if (!['name', 'type', 'optional', 'nullable'].includes(k)) err('E_SCHEMA', `${where}.${f.name} 不允许字段属性: ${k}`);
      }
      if (f.optional !== undefined && typeof f.optional !== 'boolean') err('E_SCHEMA', `${where}.${f.name} optional 必须是布尔`);
      if (f.nullable !== undefined && typeof f.nullable !== 'boolean') err('E_SCHEMA', `${where}.${f.name} nullable 必须是布尔`);
      if (f.optional === true && f.nullable === true) {
        err('E_OPTIONAL_NULLABLE', `${where}.${f.name} 不允许同时 optional 与 nullable（八项清单无「可缺且可空」语义）`);
      }
      validateTypeExpr(`${where}.${f.name}`, f.type, err);
    }
  }

  function validateTypeExpr(where, expr, err) {
    if (typeof expr === 'string') {
      if (!PRIMITIVES.has(expr)) err('E_SCHEMA', `${where} 原始类型非法: ${expr}（允许 string/int/double/bool）`);
      return;
    }
    if (typeof expr !== 'object' || expr === null) { err('E_SCHEMA', `${where} 类型表达式非法`); return; }
    const keys = Object.keys(expr);
    if (keys.length !== 1) { err('E_SCHEMA', `${where} 类型表达式必须恰一个键（array 或 ref）`); return; }
    if (keys[0] === 'array') { validateTypeExpr(`${where}[]`, expr.array, err); return; }
    if (keys[0] === 'ref') {
      if (typeof expr.ref !== 'string' || !(expr.ref in types)) {
        err('E_REF_UNRESOLVED', `${where} 引用未定义类型: ${JSON.stringify(expr.ref)}`);
      }
      return;
    }
    err('E_SCHEMA', `${where} 类型表达式键非法: ${keys[0]}`);
  }

  // --- 消息台账 ---
  const msgNames = new Set();
  for (const m of protocol.messages) {
    if (typeof m !== 'object' || m === null || typeof m.name !== 'string') { err('E_SCHEMA', '存在非法消息条目'); continue; }
    const where = `消息 ${m.name}`;
    if (!MESSAGE_NAME_RE.test(m.name)) err('E_SCHEMA', `${where} 名字必须 domain.action 形（小写开头）`);
    if (msgNames.has(m.name)) err('E_SCHEMA', `消息名重复: ${m.name}`);
    msgNames.add(m.name);
    if (!DIRECTIONS.has(m.direction)) err('E_SCHEMA', `${where} direction 非法: ${JSON.stringify(m.direction)}`);
    if (!PATTERNS.has(m.pattern)) err('E_SCHEMA', `${where} pattern 非法: ${JSON.stringify(m.pattern)}`);
    if (!STATUSES.has(m.status)) err('E_SCHEMA', `${where} status 非法: ${JSON.stringify(m.status)}`);
    if (typeof m.milestone !== 'string' || !m.milestone) err('E_SCHEMA', `${where} milestone 必须是非空字符串`);
    for (const k of Object.keys(m)) {
      if (!['name', 'direction', 'pattern', 'status', 'milestone', 'payload'].includes(k)) err('E_SCHEMA', `${where} 不允许字段: ${k}`);
    }
    // 方向与模式一致性：request/event 必 webToNative；push 必 nativeToWeb
    if ((m.pattern === 'request' || m.pattern === 'event') && m.direction !== 'webToNative') {
      err('E_DIRECTION_PATTERN', `${where} pattern=${m.pattern} 必须 webToNative`);
    }
    if (m.pattern === 'push' && m.direction !== 'nativeToWeb') {
      err('E_DIRECTION_PATTERN', `${where} pattern=push 必须 nativeToWeb`);
    }
    // 检查③：payload 命名类型。stub/reserved 允许 null（schema 未定，激活时走台账评审）；
    // 非 null 的引用必须解析为 types 表中的 record 或 tagged union（枚举/数组/原始类型一律拒——「无字符串 payload」）。
    if (m.payload === null || m.payload === undefined) {
      if (m.status === 'active') err('E_PAYLOAD_NOT_NAMED', `${where} status=active 必须定义 payload`);
    } else if (typeof m.payload !== 'object') {
      err('E_PAYLOAD_NOT_NAMED', `${where} payload 必须是对象或 null`);
    } else {
      const expectKeys = m.pattern === 'request' ? ['req', 'resp'] : ['type'];
      const actualKeys = Object.keys(m.payload);
      if (actualKeys.length !== expectKeys.length || !expectKeys.every((k) => actualKeys.includes(k))) {
        err('E_SCHEMA', `${where} pattern=${m.pattern} 的 payload 键必须恰为 {${expectKeys.join(', ')}}`);
      }
      for (const k of expectKeys) {
        const refName = m.payload[k];
        if (typeof refName !== 'string' || !(refName in types) || !['record', 'union'].includes(types[refName]?.kind)) {
          err('E_PAYLOAD_NOT_NAMED', `${where} payload.${k} 必须引用 types 表中的命名 record/union，得到: ${JSON.stringify(refName)}`);
        }
      }
    }
  }

  // 检查①：总数 ≤ 15
  if (protocol.messages.length > 15) {
    const table = protocol.messages.map((m, i) => `  #${i + 1} ${m.name} (${m.status})`).join('\n');
    err('E_COUNT_TOTAL', `消息总数 ${protocol.messages.length} > 15（全生命周期预算）。全表：\n${table}`);
  }
  // 检查②：非 orch ≤ 11；orch 恰 4 且全 active（M4a 批4 波1b 已激活；激活前为 reserved 恰 4）
  const nonOrch = protocol.messages.filter((m) => typeof m.name === 'string' && !m.name.startsWith('orch.'));
  if (nonOrch.length > 11) {
    err('E_COUNT_NON_ORCH', `非 orch 域消息 ${nonOrch.length} > 11（4 条编排配额是硬约束）：\n${nonOrch.map((m) => `  ${m.name}`).join('\n')}`);
  }
  // orch. 前缀恰 4 条，且 M4a 激活后全部 status=active 且 payload 非 null（编排配额不变量）。
  // 批4 波1b 激活前为「reserved 恰 4」，激活后改写为「active 恰 4 + payload 已声明」。
  const orchMsgs = protocol.messages.filter((m) => typeof m.name === 'string' && m.name.startsWith('orch.'));
  if (!hasOrch) {
    // 公开仓仅核心：不得含任何 orch 消息（编排=护城河，物理剥离）。
    if (orchMsgs.length !== 0) {
      err('E_ORCH_ACTIVE', `公开仓核心（无 orch 来源）不应含 orch. 消息，得到 ${orchMsgs.length}`);
    }
  } else if (orchMsgs.length !== 4) {
    err('E_ORCH_ACTIVE', `orch. 前缀的消息必须恰为 4 条，得到 ${orchMsgs.length}`);
  } else {
    const notActive = orchMsgs.filter((m) => m.status !== 'active');
    if (notActive.length > 0) {
      err('E_ORCH_ACTIVE', `orch. 四条必须全部 status=active，违规：${notActive.map((m) => `${m.name}(${m.status})`).join(', ')}`);
    }
    const missingPayload = orchMsgs.filter((m) => m.payload === null || m.payload === undefined);
    if (missingPayload.length > 0) {
      err('E_ORCH_ACTIVE', `orch. 四条 active 必须声明 payload（非 null），缺失：${missingPayload.map((m) => m.name).join(', ')}`);
    }
  }

  // 用例④：类型循环引用——三色标记 DFS，一切环（含经 array 间接）一律拒绝；报错而非死循环。
  const adjacency = new Map();
  for (const name of typeNames) adjacency.set(name, collectRefs(types[name]));
  const color = new Map(); // undefined=白 1=灰 2=黑
  for (const start of typeNames) {
    if (color.get(start) === 2) continue;
    const stack = [{ node: start, edges: adjacency.get(start) ?? [], idx: 0 }];
    color.set(start, 1);
    const path = [start];
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      if (top.idx < top.edges.length) {
        const next = top.edges[top.idx++];
        if (!adjacency.has(next)) continue; // 未解析引用已由 E_REF_UNRESOLVED 报
        const c = color.get(next);
        if (c === 1) {
          err('E_TYPE_CYCLE', `类型循环引用: ${[...path.slice(path.indexOf(next)), next].join(' → ')}`);
          continue;
        }
        if (c === 2) continue;
        color.set(next, 1);
        path.push(next);
        stack.push({ node: next, edges: adjacency.get(next) ?? [], idx: 0 });
      } else {
        color.set(top.node, 2);
        path.pop();
        stack.pop();
      }
    }
  }

  // 用例⑤：死类型（从全部非 null payload 引用不可达）→ warning
  const reachable = new Set();
  const queue = [];
  for (const m of protocol.messages) {
    if (m && typeof m.payload === 'object' && m.payload !== null) {
      for (const v of Object.values(m.payload)) {
        if (typeof v === 'string' && v in types && !reachable.has(v)) { reachable.add(v); queue.push(v); }
      }
    }
  }
  while (queue.length > 0) {
    const n = queue.pop();
    for (const next of adjacency.get(n) ?? []) {
      if (next in types && !reachable.has(next)) { reachable.add(next); queue.push(next); }
    }
  }
  for (const name of typeNames) {
    if (!reachable.has(name)) warn('W_DEAD_TYPE', `类型 ${name} 未被任何消息 payload（直接或间接）引用`);
  }

  return { errors, warnings };
}

// 类型定义的直接引用表（validate 循环/死类型检查 + Swift 分区可达闭包共用）。
function collectRefs(def) {
  const refs = [];
  const walk = (expr) => {
    if (typeof expr !== 'object' || expr === null) return;
    if ('array' in expr) walk(expr.array);
    else if ('ref' in expr && typeof expr.ref === 'string') refs.push(expr.ref);
  };
  if (def?.kind === 'record') for (const f of def.fields ?? []) walk(f?.type);
  else if (def?.kind === 'union') for (const v of def.variants ?? []) for (const f of v?.fields ?? []) walk(f?.type);
  else if (def?.kind === 'alias') walk(def.type);
  return refs;
}

// ---------- 共用命名工具 ----------

function lowerFirst(s) {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function messageCaseName(name) {
  // bridge.hello → bridgeHello（按 . 切分驼峰拼接）
  const segments = name.split('.');
  return segments[0] + segments.slice(1).map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join('');
}

const SWIFT_KEYWORDS = new Set([
  'associatedtype', 'class', 'deinit', 'enum', 'extension', 'fileprivate', 'func', 'import', 'init',
  'inout', 'internal', 'let', 'open', 'operator', 'private', 'protocol', 'public', 'rethrows',
  'static', 'struct', 'subscript', 'typealias', 'var', 'break', 'case', 'continue', 'default',
  'defer', 'do', 'else', 'fallthrough', 'for', 'guard', 'if', 'in', 'repeat', 'return', 'switch',
  'where', 'while', 'as', 'catch', 'false', 'is', 'nil', 'super', 'self', 'Self', 'throw',
  'throws', 'true', 'try', 'Type', 'Protocol',
]);

function swiftIdent(name) {
  return SWIFT_KEYWORDS.has(name) ? `\`${name}\`` : name;
}

// ---------- Swift emitter ----------

function swiftTypeExpr(expr) {
  if (typeof expr === 'string') {
    return { string: 'String', int: 'Int', double: 'Double', bool: 'Bool' }[expr];
  }
  if ('array' in expr) return `[${swiftTypeExpr(expr.array)}]`;
  return expr.ref;
}

function swiftFieldType(f) {
  return swiftTypeExpr(f.type) + (f.optional || f.nullable ? '?' : '');
}

function swiftFieldDecodeExpr(f) {
  const base = swiftTypeExpr(f.type);
  const key = swiftIdent(f.name);
  if (f.optional) return `try c.decodeIfPresent(${base}.self, forKey: .${key})`;
  // nullable：decode(T?.self) 要求键存在（缺则 keyNotFound），值可为 null
  if (f.nullable) return `try c.decode(${base}?.self, forKey: .${key})`;
  return `try c.decode(${base}.self, forKey: .${key})`;
}

function emitSwiftFieldEncodeStmts(f, accessor, indent) {
  const key = swiftIdent(f.name);
  if (f.optional) return [`${indent}try c.encodeIfPresent(${accessor}, forKey: .${key})`];
  if (f.nullable) {
    // nullable：显式 if let / encodeNil（避开 keyed container 对 Optional 的历史歧义行为）
    return [
      `${indent}if let v = ${accessor} { try c.encode(v, forKey: .${key}) } else { try c.encodeNil(forKey: .${key}) }`,
    ];
  }
  return [`${indent}try c.encode(${accessor}, forKey: .${key})`];
}

function emitSwiftRecord(name, def) {
  const fields = def.fields;
  const L = [];
  L.push(`public struct ${name}: Codable, Equatable, Sendable {`);
  for (const f of fields) L.push(`    public var ${swiftIdent(f.name)}: ${swiftFieldType(f)}`);
  if (fields.length === 0) {
    L.push('    public init() {}');
    L.push('}');
    return L.join('\n');
  }
  L.push('');
  L.push('    private enum CodingKeys: String, CodingKey {');
  for (const f of fields) L.push(`        case ${swiftIdent(f.name)}`);
  L.push('    }');
  L.push('');
  // public 逐字段 init（合成 memberwise init 是 internal，跨模块构造不了）
  const params = fields.map((f) => `${swiftIdent(f.name)}: ${swiftFieldType(f)}${f.optional ? ' = nil' : ''}`);
  L.push(`    public init(`);
  params.forEach((p, i) => L.push(`        ${p}${i < params.length - 1 ? ',' : ''}`));
  L.push('    ) {');
  for (const f of fields) L.push(`        self.${swiftIdent(f.name)} = ${swiftIdent(f.name)}`);
  L.push('    }');
  L.push('');
  L.push('    public init(from decoder: any Decoder) throws {');
  L.push('        let c = try decoder.container(keyedBy: CodingKeys.self)');
  for (const f of fields) L.push(`        self.${swiftIdent(f.name)} = ${swiftFieldDecodeExpr(f)}`);
  L.push('    }');
  L.push('');
  L.push('    public func encode(to encoder: any Encoder) throws {');
  L.push('        var c = encoder.container(keyedBy: CodingKeys.self)');
  for (const f of fields) L.push(...emitSwiftFieldEncodeStmts(f, `self.${swiftIdent(f.name)}`, '        '));
  L.push('    }');
  L.push('}');
  return L.join('\n');
}

function emitSwiftUnion(name, def) {
  const L = [];
  L.push(`public enum ${name}: Codable, Equatable, Sendable {`);
  for (const v of def.variants) {
    if (v.fields.length === 0) L.push(`    case ${swiftIdent(v.name)}`);
    else L.push(`    case ${swiftIdent(v.name)}(${v.fields.map((f) => `${swiftIdent(f.name)}: ${swiftFieldType(f)}`).join(', ')})`);
  }
  L.push('');
  // CodingKeys = kind ∪ 全 variant 字段名（按出现序去重）
  const keyNames = ['kind'];
  for (const v of def.variants) for (const f of v.fields) if (!keyNames.includes(f.name)) keyNames.push(f.name);
  L.push('    private enum CodingKeys: String, CodingKey {');
  for (const k of keyNames) L.push(`        case ${swiftIdent(k)}`);
  L.push('    }');
  L.push('');
  L.push('    public init(from decoder: any Decoder) throws {');
  L.push('        let c = try decoder.container(keyedBy: CodingKeys.self)');
  L.push('        let kind = try c.decode(String.self, forKey: .kind)');
  L.push('        switch kind {');
  for (const v of def.variants) {
    L.push(`        case "${v.name}":`);
    if (v.fields.length === 0) {
      L.push(`            self = .${swiftIdent(v.name)}`);
    } else {
      const args = v.fields.map((f) => `${swiftIdent(f.name)}: ${swiftFieldDecodeExpr(f)}`).join(',\n                ');
      L.push(`            self = .${swiftIdent(v.name)}(`);
      L.push(`                ${args}`);
      L.push('            )');
    }
  }
  L.push('        default:');
  L.push('            throw DecodingError.dataCorruptedError(forKey: .kind, in: c, debugDescription: "unknown kind: \\(kind)")');
  L.push('        }');
  L.push('    }');
  L.push('');
  L.push('    public func encode(to encoder: any Encoder) throws {');
  L.push('        var c = encoder.container(keyedBy: CodingKeys.self)');
  L.push('        switch self {');
  for (const v of def.variants) {
    if (v.fields.length === 0) {
      L.push(`        case .${swiftIdent(v.name)}:`);
      L.push(`            try c.encode("${v.name}", forKey: .kind)`);
    } else {
      const bindings = v.fields.map((f) => `let ${swiftIdent(f.name)}`).join(', ');
      L.push(`        case .${swiftIdent(v.name)}(${bindings}):`);
      L.push(`            try c.encode("${v.name}", forKey: .kind)`);
      for (const f of v.fields) L.push(...emitSwiftFieldEncodeStmts(f, swiftIdent(f.name), '            '));
    }
  }
  L.push('        }');
  L.push('    }');
  L.push('}');
  return L.join('\n');
}

function emitSwiftEnum(name, def) {
  const L = [];
  L.push(`public enum ${name}: String, Codable, CaseIterable, Equatable, Sendable {`);
  for (const v of def.values) L.push(`    case ${swiftIdent(lowerFirst(v))} = "${v}"`);
  L.push('}');
  return L.join('\n');
}

// Swift 分区（拆分裁决 A 案 §3.1）：返回 { domainsOf: 类型名→可达消息域集合, domainOrder: 域插入序首现 }。
// 只有非 null payload 的消息贡献可达性（stub/reserved payload=null 不参与）。
function partitionSwiftTypes(protocol) {
  const types = protocol.types;
  const adjacency = new Map();
  for (const name of Object.keys(types)) adjacency.set(name, collectRefs(types[name]));
  const domainOrder = [];
  const domainsOf = new Map();
  for (const m of protocol.messages) {
    if (typeof m?.payload !== 'object' || m.payload === null) continue;
    const domain = m.name.split('.')[0];
    if (!domainOrder.includes(domain)) domainOrder.push(domain);
    const queue = Object.values(m.payload).filter((v) => typeof v === 'string' && v in types);
    while (queue.length > 0) {
      const n = queue.pop();
      let set = domainsOf.get(n);
      if (!set) { set = new Set(); domainsOf.set(n, set); }
      if (set.has(domain)) continue;
      set.add(domain);
      for (const next of adjacency.get(n) ?? []) if (next in types) queue.push(next);
    }
  }
  return { domainsOf, domainOrder };
}

function swiftDomainFileName(domain) {
  return `Protocol+${domain.charAt(0).toUpperCase()}${domain.slice(1)}.swift`;
}

// 返回 Map<文件名, 内容>（插入序即 canonical 序：Protocol.swift → 各域按消息插入序 → Shared）。
function emitSwiftFiles(protocol) {
  const header = (desc) =>
    [
      '// Generated by bridge/codegen.mjs from bridge/protocol.json. DO NOT EDIT.',
      '// 协议权威：specs/bridge/bridge-v1.md（v1-frozen）。改协议 = 改 bridge/protocol.json 后重新生成（CI 红区）。',
      `// ${desc}`,
    ].join('\n');

  const { domainsOf, domainOrder } = partitionSwiftTypes(protocol);
  const buckets = new Map();
  buckets.set('Protocol.swift', {
    desc: '本文件：桥元数据（BridgeProtocol/BridgeDirection/BridgePattern/BridgeStatus/BridgeMessageType）；分区规则见 bridge/codegen.mjs 头注释。',
    parts: [],
  });
  for (const d of domainOrder) {
    buckets.set(swiftDomainFileName(d), {
      desc: `本文件：${d} 消息域可达 payload 类型；分区规则见 bridge/codegen.mjs 头注释。`,
      parts: [],
    });
  }
  buckets.set('Protocol+Shared.swift', {
    desc: '本文件：多消息域共享 payload 类型（含死类型兜底）；分区规则见 bridge/codegen.mjs 头注释。',
    parts: [],
  });

  const meta = buckets.get('Protocol.swift');
  meta.parts.push(
    [
      'public enum BridgeProtocol {',
      `    public static let version = ${protocol.protocolVersion}`,
      '}',
      '',
      'public enum BridgeDirection: String, Codable, Equatable, Sendable {',
      '    case webToNative',
      '    case nativeToWeb',
      '}',
      '',
      'public enum BridgePattern: String, Codable, Equatable, Sendable {',
      '    case request',
      '    case push',
      '    case event',
      '}',
      '',
      'public enum BridgeStatus: String, Codable, Equatable, Sendable {',
      '    case active',
      '    case stub',
      '    case reserved',
      '}',
    ].join('\n'),
  );

  const mt = [];
  mt.push('public enum BridgeMessageType: String, CaseIterable, Codable, Equatable, Sendable {');
  for (const m of protocol.messages) mt.push(`    case ${messageCaseName(m.name)} = "${m.name}"`);
  for (const prop of ['direction', 'pattern', 'status']) {
    const typeName = { direction: 'BridgeDirection', pattern: 'BridgePattern', status: 'BridgeStatus' }[prop];
    mt.push('');
    mt.push(`    public var ${prop}: ${typeName} {`);
    mt.push('        switch self {');
    for (const m of protocol.messages) mt.push(`        case .${messageCaseName(m.name)}: return .${m[prop]}`);
    mt.push('        }');
    mt.push('    }');
  }
  mt.push('}');
  meta.parts.push(mt.join('\n'));

  for (const [name, def] of Object.entries(protocol.types)) {
    const domains = domainsOf.get(name);
    const file = domains?.size === 1 ? swiftDomainFileName([...domains][0]) : 'Protocol+Shared.swift';
    const bucket = buckets.get(file);
    if (def.kind === 'record') bucket.parts.push(emitSwiftRecord(name, def));
    else if (def.kind === 'union') bucket.parts.push(emitSwiftUnion(name, def));
    else if (def.kind === 'enum') bucket.parts.push(emitSwiftEnum(name, def));
    else if (def.kind === 'alias') bucket.parts.push(`public typealias ${name} = ${swiftTypeExpr(def.type)}`);
  }

  const files = new Map();
  for (const [file, { desc, parts }] of buckets) {
    if (parts.length === 0) continue; // 空桶不出文件（现无跨域共享类型 → 无 Shared 文件）
    files.set(file, [header(desc), ...parts].join('\n\n') + '\n');
  }
  return files;
}

// ---------- TS emitter ----------

function tsTypeExpr(expr) {
  if (typeof expr === 'string') {
    return { string: 'string', int: 'number', double: 'number', bool: 'boolean' }[expr];
  }
  if ('array' in expr) return `${tsTypeExpr(expr.array)}[]`; // 元素仅 ref/原始/数组，无内联 union，无需括号
  return expr.ref;
}

function tsFieldLine(f) {
  // optional = 键可缺（?）；nullable = 键必在值可空（| null）——两种语义，序列化形态不同
  if (f.optional) return `  ${f.name}?: ${tsTypeExpr(f.type)};`;
  if (f.nullable) return `  ${f.name}: ${tsTypeExpr(f.type)} | null;`;
  return `  ${f.name}: ${tsTypeExpr(f.type)};`;
}

function emitTs(protocol) {
  const parts = [];
  parts.push(
    [
      '// Generated by bridge/codegen.mjs from bridge/protocol.json. DO NOT EDIT.',
      '// 协议权威：specs/bridge/bridge-v1.md（v1-frozen）。改协议 = 改 bridge/protocol.json 后重新生成（CI 红区）。',
      '',
      `export const PROTOCOL_VERSION = ${protocol.protocolVersion};`,
    ].join('\n'),
  );

  for (const [name, def] of Object.entries(protocol.types)) {
    if (def.kind === 'enum') {
      parts.push(`export type ${name} = ${def.values.map((v) => `'${v}'`).join(' | ')};`);
    } else if (def.kind === 'record') {
      const L = [`export interface ${name} {`];
      for (const f of def.fields) L.push(tsFieldLine(f));
      L.push('}');
      parts.push(L.join('\n'));
    } else if (def.kind === 'union') {
      const variants = def.variants.map((v) => {
        const fields = v.fields.map((f) => ` ${tsFieldLine(f).trim()}`).join('');
        return `  | { kind: '${v.name}';${fields} }`;
      });
      parts.push(`export type ${name} =\n${variants.join('\n')};`);
    } else if (def.kind === 'alias') {
      parts.push(`export type ${name} = ${tsTypeExpr(def.type)};`);
    }
  }

  parts.push(
    `export type BridgeMessageType =\n${protocol.messages.map((m) => `  | '${m.name}'`).join('\n')};`,
  );
  parts.push(
    [
      'export interface BridgeMessageMeta {',
      "  direction: 'webToNative' | 'nativeToWeb';",
      "  pattern: 'request' | 'push' | 'event';",
      "  status: 'active' | 'stub' | 'reserved';",
      '}',
    ].join('\n'),
  );
  const metaLines = protocol.messages.map(
    (m) => `  '${m.name}': { direction: '${m.direction}', pattern: '${m.pattern}', status: '${m.status}' },`,
  );
  parts.push(`export const BRIDGE_MESSAGES: Record<BridgeMessageType, BridgeMessageMeta> = {\n${metaLines.join('\n')}\n};`);

  const active = protocol.messages.filter((m) => m.status === 'active');
  parts.push(`export const ACTIVE_MESSAGES = [${active.map((m) => `'${m.name}'`).join(', ')}] as const;`);

  const reqEntries = active
    .filter((m) => m.pattern === 'request')
    .map((m) => `  '${m.name}': { req: ${m.payload.req}; resp: ${m.payload.resp} };`);
  const pushEntries = active.filter((m) => m.pattern === 'push').map((m) => `  '${m.name}': ${m.payload.type};`);
  const eventEntries = active.filter((m) => m.pattern === 'event').map((m) => `  '${m.name}': ${m.payload.type};`);
  parts.push(`export interface BridgeRequestMap {\n${reqEntries.join('\n')}\n}`);
  parts.push(`export interface BridgePushMap {\n${pushEntries.join('\n')}\n}`);
  parts.push(`export interface BridgeEventMap {\n${eventEntries.join('\n')}\n}`);

  return parts.join('\n\n') + '\n';
}

// ---------- 检查④（漂移）与检查⑤（版本递增） ----------

function firstDiffLine(a, b) {
  const la = a.split('\n');
  const lb = b.split('\n');
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    if (la[i] !== lb[i]) return { line: i + 1, expected: la[i] ?? '<EOF>', actual: lb[i] ?? '<EOF>' };
  }
  return null;
}

function checkDrift(expectedSwiftFiles, expectedTs, errors) {
  const targets = [...expectedSwiftFiles].map(
    ([name, expected]) => [join(SWIFT_GEN_DIR, name), expected, `Gen/${name}`],
  );
  targets.push([TS_OUT, expectedTs, 'web/src/bridge/gen/protocol.ts']);
  for (const [path, expected, label] of targets) {
    if (!existsSync(path)) {
      errors.push({ code: 'E_DRIFT', msg: `${label} 不存在——先运行 node bridge/codegen.mjs 生成并提交` });
      continue;
    }
    const actual = readFileSync(path, 'utf8');
    if (actual !== expected) {
      const d = firstDiffLine(expected, actual);
      errors.push({
        code: 'E_DRIFT',
        msg: `${label} 与 protocol.json 重新生成结果不一致（首个差异在第 ${d.line} 行）。` +
          `严禁手改 Gen 文件；改协议请改 protocol.json 后重跑 node bridge/codegen.mjs`,
      });
    }
  }
  // Gen/ 目录同步检查：输出集之外的 .swift 一律红（防手放文件/旧单文件残留 → module 内重复符号）。
  if (existsSync(SWIFT_GEN_DIR)) {
    for (const f of readdirSync(SWIFT_GEN_DIR).sort()) {
      if (f.endsWith('.swift') && !expectedSwiftFiles.has(f)) {
        errors.push({
          code: 'E_DRIFT',
          msg: `Gen/${f} 不在 codegen 输出集内——Gen/ 目录只放生成物；删除该文件或改 protocol.json 后重跑 node bridge/codegen.mjs`,
        });
      }
    }
  }
}

function checkVersionBump(protocol, errors, warnings) {
  // 检查⑤：合并后协议相对 git HEAD 有 schema diff 但 protocolVersion 未递增 → 红。
  // 对未提交改动生效（preflight 主闸场景）。核心/编排拆分后比对「合并后规范化协议」而非单文件字节——
  // 拆分本身不改 schema（core+orch 合并 ≡ 旧 protocol.json），故拆分提交本身不触发（canonical 相等即放行）。
  try {
    execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { stdio: 'ignore' });
  } catch {
    warnings.push({ code: 'W_NO_GIT', msg: '非 git 环境或 git 不可用，跳过 protocolVersion 递增检查' });
    return;
  }
  let head;
  try {
    head = headMergedProtocol();
  } catch {
    warnings.push({ code: 'W_NO_GIT', msg: '重建 HEAD 协议失败，跳过 protocolVersion 递增检查' });
    return;
  }
  if (head === null) return; // HEAD 无任何协议来源 = 新文件，放行
  if (canonicalProtocol(head) === canonicalProtocol(protocol)) return; // schema 无改动
  const headVersion = head.protocolVersion;
  if (!(protocol.protocolVersion > headVersion)) {
    errors.push({
      code: 'E_VERSION_NOT_BUMPED',
      msg: `协议相对 HEAD 有改动但 protocolVersion 未递增（HEAD=${headVersion}，当前=${protocol.protocolVersion}）。` +
        '任何改动（含 payload schema 字段级变更）都必须递增 protocolVersion（bridge-v1.md §3）',
    });
  }
}

// ---------- selftest（九用例：内存构造反例过同一 validate，红灯路径每次自验） ----------

function runSelftest(base, hasOrch = true) {
  const mkStub = (name) => ({
    name, direction: 'webToNative', pattern: 'request', status: 'stub', milestone: 'M7', payload: null,
  });
  // needsOrch 用例依赖基准含 4 条 orch（私仓全量）；公开仓仅核心（hasOrch=false）时跳过。
  const cases = [
    {
      label: '① 16 条总数 → E_COUNT_TOTAL',
      expect: 'E_COUNT_TOTAL',
      mutate: (p) => { p.messages.push(mkStub('extra.one'), mkStub('extra.two')); },
    },
    {
      label: '② 12 条非编排 → E_COUNT_NON_ORCH',
      needsOrch: true,
      expect: 'E_COUNT_NON_ORCH',
      mutate: (p) => {
        const orch = p.messages.filter((m) => m.name.startsWith('orch.'));
        p.messages = p.messages.filter((m) => !m.name.startsWith('orch.'));
        p.messages.push(mkStub('extra.one'), mkStub('extra.two'), orch[0]); // 12 非 orch + 1 orch = 13 ≤ 15
      },
    },
    {
      label: '③ 裸 string payload → E_PAYLOAD_NOT_NAMED',
      expect: 'E_PAYLOAD_NOT_NAMED',
      mutate: (p) => { p.messages.find((m) => m.name === 'ui.action').payload = { type: 'string' }; },
    },
    {
      label: '④ 类型循环引用 → E_TYPE_CYCLE（报错而非死循环）',
      expect: 'E_TYPE_CYCLE',
      mutate: (p) => {
        p.types.CycleA = { kind: 'record', fields: [{ name: 'b', type: { ref: 'CycleB' } }] };
        p.types.CycleB = { kind: 'record', fields: [{ name: 'a', type: { ref: 'CycleA' } }] };
      },
    },
    {
      label: '⑤ 死类型 → W_DEAD_TYPE（警告不红）',
      expectWarning: 'W_DEAD_TYPE',
      mutate: (p) => {
        p.types.DeadOrphan = { kind: 'record', fields: [{ name: 'x', type: 'string' }] };
      },
    },
    {
      label: '⑥ union 分支 kind 值重复 → E_UNION_DUP_KIND',
      expect: 'E_UNION_DUP_KIND',
      mutate: (p) => { p.types.UIAction.variants.push({ name: 'tileClick', fields: [] }); },
    },
    {
      label: '⑦ orch 条数不对（5 条）→ E_ORCH_ACTIVE',
      needsOrch: true,
      expect: 'E_ORCH_ACTIVE',
      mutate: (p) => {
        p.messages.push({
          name: 'orch.extra', direction: 'webToNative', pattern: 'request',
          status: 'reserved', milestone: 'M7', payload: null,
        });
      },
    },
    {
      label: '⑧ orch 某条非 active → E_ORCH_ACTIVE',
      needsOrch: true,
      expect: 'E_ORCH_ACTIVE',
      mutate: (p) => { p.messages.find((m) => m.name === 'orch.command').status = 'reserved'; },
    },
    {
      label: '⑨ orch active 但 payload 缺失 → E_ORCH_ACTIVE',
      needsOrch: true,
      expect: 'E_ORCH_ACTIVE',
      mutate: (p) => { p.messages.find((m) => m.name === 'orch.state').payload = null; },
    },
  ];

  const baseResult = validate(base, { hasOrch });
  if (baseResult.errors.length > 0) {
    console.error('selftest 前提失败：合并后基准协议本身校验不绿');
    for (const e of baseResult.errors) console.error(`  [${e.code}] ${e.msg}`);
    return false;
  }

  let allPass = true;
  for (const c of cases) {
    if (c.needsOrch && !hasOrch) continue; // 公开仓仅核心：跳过依赖 orch 基准的反例
    const mutated = structuredClone(base);
    c.mutate(mutated);
    const { errors, warnings } = validate(mutated, { hasOrch });
    let pass;
    if (c.expectWarning) {
      pass = warnings.some((w) => w.code === c.expectWarning) && errors.length === 0;
    } else {
      pass = errors.some((e) => e.code === c.expect);
    }
    console.log(`  selftest ${pass ? 'PASS' : 'FAIL'}  ${c.label}`);
    if (!pass) {
      allPass = false;
      console.error(`    得到 errors=[${errors.map((e) => e.code).join(',')}] warnings=[${warnings.map((w) => w.code).join(',')}]`);
    }
  }
  return allPass;
}

// ---------- 协议来源加载与合并（核心/编排拆分） ----------

// 合并 core + orch → 与拆分前 protocol.json 逐字等价的协议对象。
//   messages：core（10 条非 orch）在前、orch（4 条）在后——拆分前 orch 恰在消息数组末尾，故拼接即复原序。
//   types：按 orch.typeOrder 全序清单重排（拆分前 orch-only 类型与 core 类型交错，简单拼接会乱序 →
//          生成物字节漂移）；清单缺失（或无 orch）时回落到 core→orch 拼接序。
function mergeProtocol(core, orch) {
  if (!orch) return core; // 公开仓：仅核心
  const messages = [...(core.messages ?? []), ...(orch.messages ?? [])];
  const combined = { ...(core.types ?? {}), ...(orch.types ?? {}) };
  const order = Array.isArray(orch.typeOrder) ? orch.typeOrder : Object.keys(combined);
  const types = {};
  for (const name of order) if (name in combined && !(name in types)) types[name] = combined[name];
  for (const name of Object.keys(combined)) if (!(name in types)) types[name] = combined[name]; // 兜底不丢类型
  return { protocolVersion: core.protocolVersion, types, messages };
}

// 读协议来源：优先 core(+orch) 拆分文件，回落旧单文件 protocol.json。
// 返回 { protocol（合并后）, hasOrch（orch 文件是否在场）}。typeOrder 清单完整性即时校验（不匹配 = 基建错，exit 2）。
function loadProtocol() {
  if (existsSync(CORE_PATH)) {
    const core = JSON.parse(readFileSync(CORE_PATH, 'utf8'));
    if (existsSync(ORCH_PATH)) {
      const orch = JSON.parse(readFileSync(ORCH_PATH, 'utf8'));
      assertTypeOrderComplete(core, orch);
      return { protocol: mergeProtocol(core, orch), hasOrch: true };
    }
    return { protocol: core, hasOrch: false };
  }
  const single = JSON.parse(readFileSync(PROTOCOL_PATH, 'utf8'));
  const hasOrch = (single.messages ?? []).some((m) => typeof m?.name === 'string' && m.name.startsWith('orch.'));
  return { protocol: single, hasOrch };
}

// typeOrder 必须恰为 core+orch 类型键的一个排列（防漏加/漏删类型时静默丢定义或乱序）。
function assertTypeOrderComplete(core, orch) {
  const union = new Set([...Object.keys(core.types ?? {}), ...Object.keys(orch.types ?? {})]);
  const manifest = Array.isArray(orch.typeOrder) ? orch.typeOrder : [];
  const manifestSet = new Set(manifest);
  const missing = [...union].filter((n) => !manifestSet.has(n));
  const extra = manifest.filter((n) => !union.has(n));
  if (manifest.length !== union.size || missing.length > 0 || extra.length > 0) {
    console.error('protocol.orch.json 的 typeOrder 清单与 core+orch 类型键不一致（合并会乱序/丢类型）：');
    if (missing.length) console.error(`  清单缺: ${missing.join(', ')}`);
    if (extra.length) console.error(`  清单多: ${extra.join(', ')}`);
    if (manifest.length !== union.size) console.error(`  长度 ${manifest.length} ≠ 类型数 ${union.size}`);
    process.exit(2);
  }
}

// 规范化序列化（版本递增检查用）：固定 {protocolVersion, types, messages} 顶层序，types 用合并序。
function canonicalProtocol(p) {
  return JSON.stringify({ protocolVersion: p.protocolVersion, types: p.types, messages: p.messages });
}

// 从 git HEAD 重建合并后协议（core+orch 优先，回落旧单文件）；HEAD 无任一来源 → null（新文件放行）。
function headMergedProtocol() {
  const show = (rel) => {
    try {
      execFileSync('git', ['-C', ROOT, 'cat-file', '-e', `HEAD:${rel}`], { stdio: 'ignore' });
    } catch { return null; }
    try { return execFileSync('git', ['-C', ROOT, 'show', `HEAD:${rel}`]); } catch { return null; }
  };
  const coreBuf = show('bridge/protocol.core.json');
  if (coreBuf) {
    const core = JSON.parse(coreBuf.toString('utf8'));
    const orchBuf = show('bridge/protocol.orch.json');
    const orch = orchBuf ? JSON.parse(orchBuf.toString('utf8')) : null;
    return mergeProtocol(core, orch);
  }
  const singleBuf = show('bridge/protocol.json');
  return singleBuf ? JSON.parse(singleBuf.toString('utf8')) : null;
}

// ---------- CLI ----------

function main() {
  const args = process.argv.slice(2);
  const isCheck = args.includes('--check') || args.includes('--selftest');
  const isSelftest = args.includes('--selftest');
  const unknown = args.filter((a) => !['--check', '--selftest'].includes(a));
  if (unknown.length > 0) {
    console.error(`未知参数: ${unknown.join(' ')}（支持 --check / --selftest）`);
    process.exit(2);
  }

  let protocol, hasOrch;
  try {
    ({ protocol, hasOrch } = loadProtocol());
  } catch (e) {
    console.error(`读取/解析桥协议来源（protocol.core.json/protocol.orch.json）失败: ${e.message}`);
    process.exit(2);
  }

  if (isSelftest) {
    console.log('codegen selftest（九反例红灯自验）：');
    if (!runSelftest(protocol, hasOrch)) {
      console.error('selftest 失败');
      process.exit(1);
    }
  }

  const { errors, warnings } = validate(protocol, { hasOrch });

  if (errors.length === 0 && isCheck) {
    const expectedSwiftFiles = emitSwiftFiles(protocol);
    const expectedTs = emitTs(protocol);
    checkDrift(expectedSwiftFiles, expectedTs, errors);
    checkVersionBump(protocol, errors, warnings);
  }

  for (const w of warnings) console.warn(`warning [${w.code}] ${w.msg}`);
  if (errors.length > 0) {
    for (const e of errors) console.error(`ERROR [${e.code}] ${e.msg}`);
    console.error(`\ncodegen ${isCheck ? '--check ' : ''}RED：${errors.length} 个错误`);
    process.exit(1);
  }

  if (isCheck) {
    console.log(`codegen --check GREEN：消息 ${protocol.messages.length}/15，` +
      `非 orch ${protocol.messages.filter((m) => !m.name.startsWith('orch.')).length}/11，` +
      `protocolVersion=${protocol.protocolVersion}，无漂移`);
    process.exit(0);
  }

  // 生成模式
  const swiftFiles = emitSwiftFiles(protocol);
  try {
    mkdirSync(SWIFT_GEN_DIR, { recursive: true });
    mkdirSync(dirname(TS_OUT), { recursive: true });
    for (const [name, content] of swiftFiles) writeFileSync(join(SWIFT_GEN_DIR, name), content);
    // Gen/ 目录同步：输出集之外的 *.swift 一律删除（旧单文件/手放文件残留会造成 module 内重复符号）。
    for (const f of readdirSync(SWIFT_GEN_DIR).sort()) {
      if (f.endsWith('.swift') && !swiftFiles.has(f)) {
        unlinkSync(join(SWIFT_GEN_DIR, f));
        console.log(`removed:   ${join(SWIFT_GEN_DIR, f)}（不在输出集）`);
      }
    }
    writeFileSync(TS_OUT, emitTs(protocol));
  } catch (e) {
    console.error(`写盘失败: ${e.message}`);
    process.exit(2);
  }
  for (const name of swiftFiles.keys()) console.log(`generated: ${join(SWIFT_GEN_DIR, name)}`);
  console.log(`generated: ${TS_OUT}`);
  process.exit(0);
}

main();
