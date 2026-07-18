// legacy 侧 dump（双跑对照基线）——tsx 直跑 muxvo-legacy 的 createChatProjectReader /
// createCodexChatReader，命令面与 muxvo-chat-dump 一一对应，stdout 纯 JSON 数组。
//
// 运行（cwd 须为 muxvo-legacy，使 tsconfig `@/` alias 生效）：
//   cd <muxvo-legacy> && node_modules/.bin/tsx <此文件> --cc-base <dir> [flags] <cmd>
// MUXVO_LEGACY_ROOT 可覆盖 legacy 根（默认本机路径）。每次新进程 = 无 5 分钟缓存（§2.4）。
//
// 目录约定（与 muxvo-chat-dump 对齐，见 DumpArgs.swift）：
//   --cc-base    = CC 项目目录（basename 须为 `projects`；legacy ccBasePath = dirname 后 join 还原）。
//   --codex-base = Codex sessions 目录（basename 须为 `sessions`；legacy codexBasePath = dirname）。
//   --mirror     = 镜像/归档扁平根 → legacy archivePath（直接用，可选）。
//
// 命令：index | projects | sessions (--project <hash>|--all) [--limit N]
//       | session --project <hash> --session <id> [--limit N] | search --query <q>
// index 非 diff 面（性能记录），输出 {command,...} 单对象；其余输出四类型数组。

import { basename, dirname, join } from 'node:path';

const KEEP_ALL = 1_000_000;

function parseArgs(argv) {
  const a = { limit: undefined, project: undefined, session: undefined, query: undefined, all: false, positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    const next = () => {
      i++;
      if (i >= argv.length) throw new Error(`${t} 缺参数`);
      return argv[i];
    };
    switch (t) {
      case '--cc-base': a.ccBase = next(); break;
      case '--codex-base': a.codexBase = next(); break;
      case '--mirror': a.mirror = next(); break;
      case '--db': next(); break; // legacy 无 db，忽略
      case '--limit': a.limit = parseInt(next(), 10); break;
      case '--project': a.project = next(); break;
      case '--session': a.session = next(); break;
      case '--query': a.query = next(); break;
      case '--all': a.all = true; break;
      default:
        if (t.startsWith('--')) throw new Error(`未知参数：${t}`);
        a.positional.push(t);
    }
  }
  return a;
}

function sourceMode(a) {
  if (a.ccBase && a.codexBase) return 'aggregate';
  if (a.codexBase && !a.ccBase) return 'codex';
  return 'cc';
}

async function loadFactories(a) {
  const legacyRoot = process.env.MUXVO_LEGACY_ROOT
    || '/Users/rl/Nutstore_Files/my_nutstore/520-program/muxvo-legacy';
  const svc = join(legacyRoot, 'src/main/services');
  const out = {};
  if (a.ccBase) {
    if (basename(a.ccBase) !== 'projects') {
      throw new Error(`--cc-base basename 须为 'projects'（legacy join 语义），得到：${a.ccBase}`);
    }
    const mod = await import(join(svc, 'chat-dual-source.ts'));
    out.cc = mod.createChatProjectReader({ ccBasePath: dirname(a.ccBase), archivePath: a.mirror });
  }
  if (a.codexBase) {
    if (basename(a.codexBase) !== 'sessions') {
      throw new Error(`--codex-base basename 须为 'sessions'（legacy join 语义），得到：${a.codexBase}`);
    }
    const mod = await import(join(svc, 'codex-chat-source.ts'));
    out.codex = mod.createCodexChatReader({ codexBasePath: dirname(a.codexBase) });
  }
  return out;
}

// ---- §5.4 聚合（与 Swift Aggregate 同规则）----
function aggProjects(cc, codex) {
  const order = [];
  const map = new Map();
  for (const p of [...cc, ...codex]) {
    const cur = map.get(p.projectHash);
    if (cur) {
      cur.sessionCount += p.sessionCount;
      cur.totalSize = (cur.totalSize || 0) + (p.totalSize || 0);
      cur.lastActivity = Math.max(cur.lastActivity, p.lastActivity);
    } else {
      map.set(p.projectHash, { ...p });
      order.push(p.projectHash);
    }
  }
  return order.map((h) => map.get(h)).sort((x, y) => y.lastActivity - x.lastActivity);
}
function aggSessions(cc, codex, limit) {
  const seen = new Set();
  const flat = [];
  for (const s of [...cc, ...codex]) {
    if (seen.has(s.sessionId)) continue;
    seen.add(s.sessionId);
    flat.push(s);
  }
  flat.sort((a, b) => b.lastModified - a.lastModified);
  return flat.slice(0, limit);
}
function aggSearch(cc, codex) {
  return [...cc, ...codex].slice(0, 500);
}

function out(records) {
  process.stdout.write(JSON.stringify(records) + '\n');
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const cmd = a.positional[0];
  if (!cmd) throw new Error('缺子命令');
  if (!a.ccBase && !a.codexBase) throw new Error('至少给 --cc-base 或 --codex-base');
  const mode = sourceMode(a);
  const { cc, codex } = await loadFactories(a);

  switch (cmd) {
    case 'index': {
      const start = Date.now();
      let projectCount = 0, sessionCount = 0;
      if (cc) {
        projectCount += (await cc.getProjects()).length;
        sessionCount += (await cc.getAllRecentSessions(KEEP_ALL)).length;
      }
      if (codex) {
        projectCount += (await codex.getProjects()).length;
        sessionCount += (await codex.getAllRecentSessions(KEEP_ALL)).length;
      }
      out({ command: 'index', sourceMode: mode, projectCount, sessionCount, elapsedMs: Date.now() - start });
      return;
    }
    case 'projects': {
      if (mode === 'cc') return out(await cc.getProjects());
      if (mode === 'codex') return out(await codex.getProjects());
      return out(aggProjects(await cc.getProjects(), await codex.getProjects()));
    }
    case 'sessions': {
      const limit = a.limit ?? KEEP_ALL;
      if (a.all) {
        if (mode === 'cc') return out(await cc.getAllRecentSessions(limit));
        if (mode === 'codex') return out(await codex.getAllRecentSessions(limit));
        return out(aggSessions(await cc.getAllRecentSessions(limit), await codex.getAllRecentSessions(limit), limit));
      }
      if (!a.project) throw new Error('sessions 需 --project <hash> 或 --all');
      if (mode === 'cc') {
        await cc.getProjects(); // 填 worktreeMap（§1.3 会话回查依赖）
        return out(await cc.getSessionsForProject(a.project, limit));
      }
      if (mode === 'codex') return out(await codex.getSessionsForProject(a.project, limit));
      await cc.getProjects();
      const ccS = await cc.getSessionsForProject(a.project, limit);
      const cxS = await codex.getSessionsForProject(a.project, limit);
      return out(aggSessions(ccS, cxS, limit));
    }
    case 'session': {
      if (!a.project || !a.session) throw new Error('session 需 --project 与 --session');
      const opts = a.limit !== undefined ? { limit: a.limit } : undefined;
      if (mode === 'cc') {
        await cc.getProjects();
        return out(await cc.readSession(a.project, a.session, opts));
      }
      if (mode === 'codex') return out(await codex.readSession(a.project, a.session, opts));
      await cc.getProjects();
      const ccM = await cc.readSession(a.project, a.session, opts);
      const cxM = await codex.readSession(a.project, a.session, opts);
      return out(ccM.length ? ccM : cxM);
    }
    case 'search': {
      if (!a.query) throw new Error('search 需 --query <q>');
      if (mode === 'cc') return out(await cc.search(a.query));
      if (mode === 'codex') return out(await codex.search(a.query));
      return out(aggSearch(await cc.search(a.query), await codex.search(a.query)));
    }
    default:
      throw new Error(`未知命令：${cmd}`);
  }
}

main().catch((e) => {
  process.stderr.write(`legacy-dump: ${e?.stack || e}\n`);
  process.exit(1);
});
