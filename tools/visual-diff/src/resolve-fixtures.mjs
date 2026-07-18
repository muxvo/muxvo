/**
 * 解析 fixtures：contentKey → 着色后的 content 行；附 palette。
 * 数据源（M2 任务3 起多文件化，防单文件 2000 行红线）：
 *   fixtures.json          —— terminal-grid 屏（M0 的 15 个原样冻结，网格新 fixture 也落这里直到黄线）
 *   screens/<screen>.json  —— 每屏一文件，文件名升序聚合在 fixtures.json 之后
 * id 全局唯一在此强制（重复即 throw，capture/compare 起跑就红）。
 * 输出 ResolvedFixture[]（契约见 ../fixtures/_CONTRACT.md）。
 *
 * 等价保障：terminal-grid 分支与拆分前逐字一致，2026-06-12 用 15 个既有 fixture 的
 * resolveFixtures() 全量 JSON dump 做过拆分前后 byte-diff = 0 验证（M2 任务3）。
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '..', 'fixtures');
const screensDir = join(fixturesDir, 'screens');

const screenFixtures = existsSync(screensDir)
  ? readdirSync(screensDir)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .flatMap((f) => JSON.parse(readFileSync(join(screensDir, f), 'utf8')))
  : [];
const fixtures = [
  ...JSON.parse(readFileSync(join(fixturesDir, 'fixtures.json'), 'utf8')),
  ...screenFixtures,
];
{
  const seen = new Set();
  for (const fx of fixtures) {
    if (seen.has(fx.id)) throw new Error(`fixture id 重复: ${fx.id}`);
    seen.add(fx.id);
  }
}

const blocks = JSON.parse(readFileSync(join(fixturesDir, 'content-blocks.json'), 'utf8'));
const palettes = JSON.parse(readFileSync(join(fixturesDir, 'term-palette.json'), 'utf8'));

// B5 chat 簇共享数据字典（头注释预留的「按屏数据字典」接入）：chat payload 的
// projects/sessions/messages 可写 "@<key>" 引用 chat-data.json 顶层条目，
// 多 fixture 共享同一份数据，杜绝手抄漂移。仅 fx.chat 存在时生效，对既有屏零影响。
const chatDataPath = join(fixturesDir, 'chat-data.json');
const chatData = existsSync(chatDataPath) ? JSON.parse(readFileSync(chatDataPath, 'utf8')) : {};

function derefChat(chat, fxId) {
  const deref = (v, field) => {
    if (typeof v !== 'string') return v;
    if (!v.startsWith('@')) throw new Error(`chat.${field} 引用须以 @ 开头: ${v} (${fxId})`);
    const entry = chatData[v.slice(1)];
    if (!entry) throw new Error(`chat-data.json 缺条目: ${v.slice(1)} (${fxId}/chat.${field})`);
    return entry;
  };
  return {
    ...chat,
    projects: deref(chat.projects, 'projects'),
    sessions: deref(chat.sessions, 'sessions'),
    messages: deref(chat.messages, 'messages'),
  };
}

/** contentKey → 着色 content 行（terminal-grid 与各屏 base.terminals 共用同一管线） */
function resolveTerminals(terminals, palette, fxId) {
  return terminals.map((t) => {
    const lines = blocks[t.contentKey];
    if (!lines) throw new Error(`unknown contentKey: ${t.contentKey} (${fxId}/${t.id})`);
    const content = lines.map((segs) =>
      segs.map((s) => ({ t: s.t, hex: s.c ? palette[s.c] : palette.foreground })),
    );
    const { contentKey, ...rest } = t;
    return { ...rest, content };
  });
}

export function resolveFixtures(onlyIds = null) {
  return fixtures
    .filter((fx) => !onlyIds || onlyIds.includes(fx.id))
    .map((fx) => {
      const palette = palettes[fx.theme];
      if (!palette) throw new Error(`unknown theme: ${fx.theme} (${fx.id})`);
      if ((fx.screen ?? 'terminal-grid') === 'terminal-grid') {
        // terminal-grid 分支：与拆分前逐字一致（spread 顺序不动，解析结果字节级等价）
        const terminals = resolveTerminals(fx.terminals, palette, fx.id);
        return {
          ...fx,
          terminals,
          palette: { background: palette.background, foreground: palette.foreground },
        };
      }
      // 非网格屏通用信封：base.terminals（复合屏底图）复用同一着色管线，
      // 其余按屏 payload 原样透传；按屏数据字典（chat-data 等）随各批次按需接入此分支。
      const resolved = {
        ...fx,
        palette: { background: palette.background, foreground: palette.foreground },
      };
      if (fx.base?.terminals) {
        resolved.base = { ...fx.base, terminals: resolveTerminals(fx.base.terminals, palette, fx.id) };
      }
      if (fx.chat) {
        resolved.chat = derefChat(fx.chat, fx.id);
      }
      return resolved;
    });
}

export function allFixtureIds() {
  return fixtures.map((fx) => fx.id);
}
