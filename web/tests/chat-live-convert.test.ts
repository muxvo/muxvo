// chat-history live wire→screen 换算（chat-history.md §7.1 映射表逐条）。node 环境纯函数直测。
// 断言面 = 真实工件 web/src/screen/chat/live/convert.ts（ChatHistoryLive 消费的同一换算）。
import { describe, expect, test } from 'vitest';
import type {
  ChatMessageView,
  ChatProjectView,
  ChatSearchHit,
  ChatSessionView,
} from '../src/bridge/gen/protocol';
import {
  blockToScreen,
  inferSourceFromMessages,
  messageToScreen,
  msToIso,
  parseJsonLenient,
  projectToScreen,
  searchHitToScreen,
  sessionToScreen,
  sourceToKebab,
  synthSessionFromSearchHit,
} from '../src/screen/chat/live/convert';

const MS = 1717243200000; // 2024-06-01T12:00:00.000Z（确定性）

describe('msToIso / sourceToKebab（§7.1 原子换算）', () => {
  test('int ms → ISO 串', () => {
    expect(msToIso(MS)).toBe(new Date(MS).toISOString());
  });
  test('claudeCode → kebab claude-code；codex 恒等；缺席 ⇒ claude-code（MINOR-1/3）', () => {
    expect(sourceToKebab('claudeCode')).toBe('claude-code');
    expect(sourceToKebab('codex')).toBe('codex');
    expect(sourceToKebab(undefined)).toBe('claude-code');
  });
});

describe('parseJsonLenient（§7.1 MINOR-2：inputJson JSON.parse 失败容错）', () => {
  test('合法 JSON → 解析对象', () => {
    expect(parseJsonLenient('{"a":1,"b":"x"}')).toEqual({ a: 1, b: 'x' });
  });
  test('畸形 JSON → 降级原字符串（不抛）', () => {
    expect(parseJsonLenient('{not json')).toBe('{not json');
    expect(() => parseJsonLenient('{not json')).not.toThrow();
  });
});

describe('projectToScreen（§7.1：无 source 字段；lastActivityMs → ISO）', () => {
  test('字段映射 + ms→ISO，且不产出 source', () => {
    const p: ChatProjectView = {
      projectHash: '-Users-rl-dev-muxvo',
      displayPath: '/Users/rl/dev/muxvo',
      displayName: 'muxvo',
      sessionCount: 12,
      totalSize: 4096,
      lastActivityMs: MS,
    };
    const out = projectToScreen(p);
    expect(out).toEqual({
      projectHash: '-Users-rl-dev-muxvo',
      displayPath: '/Users/rl/dev/muxvo',
      displayName: 'muxvo',
      sessionCount: 12,
      totalSize: 4096,
      lastActivity: new Date(MS).toISOString(),
    });
    expect('source' in out).toBe(false);
  });
});

describe('sessionToScreen（§7.1：source camel→kebab；*Ms→ISO；可选透传）', () => {
  test('claudeCode 会话 → claude-code + startedAt/lastModified ISO', () => {
    const s: ChatSessionView = {
      sessionId: 's1',
      projectHash: 'ph',
      title: 'fix pty',
      startedAtMs: MS,
      lastModifiedMs: MS + 1000,
      fileSize: 2048,
      source: 'claudeCode',
      customTitle: 'PTY 修复',
      cwd: '/Users/rl/dev/muxvo',
      worktreeLabel: 'wt',
      archiveOnly: true,
    };
    const out = sessionToScreen(s);
    expect(out.source).toBe('claude-code');
    expect(out.startedAt).toBe(new Date(MS).toISOString());
    expect(out.lastModified).toBe(new Date(MS + 1000).toISOString());
    expect(out.customTitle).toBe('PTY 修复');
    expect(out.cwd).toBe('/Users/rl/dev/muxvo');
    expect(out.worktreeLabel).toBe('wt');
  });
  test('source 缺席 ⇒ 默认 claude-code（MINOR-3）；codex 恒等', () => {
    const base: ChatSessionView = {
      sessionId: 's2',
      projectHash: 'ph',
      title: 't',
      startedAtMs: MS,
      lastModifiedMs: MS,
      fileSize: 0,
    };
    expect(sessionToScreen(base).source).toBe('claude-code');
    expect(sessionToScreen({ ...base, source: 'codex' }).source).toBe('codex');
  });
  test('问题5：空 title（native title_fallback 链也空）→ 兜底 (无标题)，非空原样', () => {
    const base: ChatSessionView = {
      sessionId: 's3',
      projectHash: 'ph',
      title: '',
      startedAtMs: MS,
      lastModifiedMs: MS,
      fileSize: 0,
    };
    expect(sessionToScreen(base).title).toBe('(无标题)');
    expect(sessionToScreen({ ...base, title: '真标题' }).title).toBe('真标题');
  });
});

describe('blockToScreen（§7.1：工具块 inputJson/resultJson 解析；kind→type）', () => {
  test('text 块', () => {
    expect(blockToScreen({ kind: 'text', text: 'hello' })).toEqual({ type: 'text', text: 'hello' });
  });
  test('toolUse：inputJson → 解析对象 input', () => {
    const out = blockToScreen({ kind: 'toolUse', name: 'Bash', inputJson: '{"command":"ls"}' });
    expect(out).toEqual({ type: 'tool_use', name: 'Bash', input: { command: 'ls' } });
  });
  test('toolUse：畸形 inputJson → 降级原字符串（不崩，MINOR-2）', () => {
    const out = blockToScreen({ kind: 'toolUse', name: 'X', inputJson: 'not-json{' });
    expect(out.type).toBe('tool_use');
    expect(out.input).toBe('not-json{');
  });
  test('toolResult：resultJson 解析；缺席 → content undefined', () => {
    expect(blockToScreen({ kind: 'toolResult', resultJson: '{"ok":true}' })).toEqual({
      type: 'tool_result',
      content: { ok: true },
    });
    expect(blockToScreen({ kind: 'toolResult' })).toEqual({ type: 'tool_result', content: undefined });
  });
  test('image：dataUri → content', () => {
    expect(blockToScreen({ kind: 'image', dataUri: 'data:image/png;base64,AAA' })).toEqual({
      type: 'image',
      content: 'data:image/png;base64,AAA',
    });
  });
  test('问题4 thinking：text → {type:thinking,text}', () => {
    expect(blockToScreen({ kind: 'thinking', text: '先分析再动手' })).toEqual({
      type: 'thinking',
      text: '先分析再动手',
    });
  });
  test('问题4 unknown：blockType→name、rawJson→content（原文不丢）', () => {
    expect(
      blockToScreen({ kind: 'unknown', blockType: 'redacted_thinking', rawJson: '{"type":"redacted_thinking"}' }),
    ).toEqual({ type: 'unknown', name: 'redacted_thinking', content: '{"type":"redacted_thinking"}' });
  });
});

describe('messageToScreen（§7.1：role→type；恰一 text|blocks→content；cwd 缺席→\'\'）', () => {
  const base = { uuid: 'u1', sessionId: 's1', tsMs: MS } as const;
  test('role→type 恒等；tsMs→timestamp ISO；system text→content 字符串（system 仍纯文本）', () => {
    const m: ChatMessageView = { ...base, role: 'system', text: '你好' };
    const out = messageToScreen(m);
    expect(out.type).toBe('system');
    expect(out.timestamp).toBe(new Date(MS).toISOString());
    expect(out.content).toBe('你好');
  });
  test('blocks 存在 → content=block[]（逐块换算）', () => {
    const m: ChatMessageView = {
      ...base,
      role: 'assistant',
      blocks: [
        { kind: 'text', text: 'a' },
        { kind: 'toolUse', name: 'Read', inputJson: '{"path":"/x"}' },
      ],
    };
    const out = messageToScreen(m);
    expect(Array.isArray(out.content)).toBe(true);
    expect(out.content).toEqual([
      { type: 'text', text: 'a' },
      { type: 'tool_use', name: 'Read', input: { path: '/x' } },
    ]);
  });
  test('cwd 缺席 ⇒ 空串；两皆缺 ⇒ content 空串（降级不崩）', () => {
    const m: ChatMessageView = { ...base, role: 'system' };
    const out = messageToScreen(m);
    expect(out.cwd).toBe('');
    expect(out.content).toBe('');
  });
  test('cwd 存在则透传', () => {
    expect(messageToScreen({ ...base, role: 'user', text: 't', cwd: '/c' }).cwd).toBe('/c');
  });
});

describe('searchHitToScreen（§7.1：tsMs→timestamp ISO）', () => {
  test('命中换算', () => {
    const h: ChatSearchHit = { projectHash: 'ph', sessionId: 's', snippet: 'foo', tsMs: MS };
    expect(searchHitToScreen(h)).toEqual({
      projectHash: 'ph',
      sessionId: 's',
      snippet: 'foo',
      timestamp: new Date(MS).toISOString(),
    });
  });
});

// ── 缺陷4：assistant 的 string 型消息包成 text 块走 MD 通道；user/system 保持纯文本 ──

describe('messageToScreen 缺陷4/问题4：assistant+user string→text 块（MD 通道）；system 保持 string', () => {
  const base = { uuid: 'u1', sessionId: 's1', tsMs: MS } as const;
  test('assistant + text（无 blocks）→ content 包成 [{type:text}]（走 blocks/MD 通道）', () => {
    const out = messageToScreen({ ...base, role: 'assistant', text: '**bold**' });
    expect(Array.isArray(out.content)).toBe(true);
    expect(out.content).toEqual([{ type: 'text', text: '**bold**' }]);
  });
  test('问题4：user + text → content 包成 [{type:text}]（user 也走 MD 通道）', () => {
    const out = messageToScreen({ ...base, role: 'user', text: '**bold**' });
    expect(Array.isArray(out.content)).toBe(true);
    expect(out.content).toEqual([{ type: 'text', text: '**bold**' }]);
  });
  test('system + text → content 保持字符串（纯文本，走 SystemFoldBlock 折叠壳不渲 MD）', () => {
    expect(messageToScreen({ ...base, role: 'system', text: '- note' }).content).toBe('- note');
  });
  test('assistant 已有 blocks → 优先级不变（blocks 分支先行，不受包裹逻辑影响）', () => {
    const out = messageToScreen({ ...base, role: 'assistant', blocks: [{ kind: 'text', text: 'a' }] });
    expect(out.content).toEqual([{ type: 'text', text: 'a' }]);
  });
});

// ── 缺陷3：内容匹配占位卡 → 最小 wire 会话（live 容器 selWire/canResume 判定） ──

describe('synthSessionFromSearchHit（缺陷3：内容匹配占位 → 最小 wire 会话）', () => {
  const hits: ChatSearchHit[] = [{ projectHash: 'ph', sessionId: 'sX', snippet: 'foo', tsMs: MS }];
  test('命中 → 最小对象（fileSize=-1；source/cwd/archiveOnly 未设 → canResume 靠消息 cwd）', () => {
    const out = synthSessionFromSearchHit(hits, 'sX');
    expect(out).toEqual({
      sessionId: 'sX',
      projectHash: 'ph',
      title: '',
      startedAtMs: MS,
      lastModifiedMs: MS,
      fileSize: -1,
    });
    expect(out && 'source' in out).toBe(false);
    expect(out && 'archiveOnly' in out).toBe(false);
    expect(out?.cwd).toBeUndefined();
  });
  test('未命中 → undefined（非搜索占位退回 undefined selWire）', () => {
    expect(synthSessionFromSearchHit(hits, 'nope')).toBeUndefined();
  });
});

// ── M-1：占位卡 source 未知 → 从已加载消息 uuid 前缀推断（codex- → codex），避免错注入 CC harness ──

describe('inferSourceFromMessages（M-1：uuid 前缀推断 source）', () => {
  const mk = (uuid: string): ChatMessageView => ({ uuid, sessionId: 's', role: 'user', tsMs: MS, text: 't' });
  test('任一消息 uuid 带 codex- 前缀 → codex', () => {
    expect(inferSourceFromMessages([mk('codex-sid-user-0'), mk('codex-sid-agent-1')])).toBe('codex');
  });
  test('工具消息 call_id 无前缀但同会话有 user/agent 带前缀条 → 仍 codex', () => {
    expect(inferSourceFromMessages([mk('call_abc123'), mk('codex-sid-user-0')])).toBe('codex');
  });
  test('无 codex- 前缀（CC 会话，uuid 是裸 UUID）→ undefined（调用方默认 claudeCode）', () => {
    expect(inferSourceFromMessages([mk('a1b2c3d4-e5f6-7890-abcd-ef1234567890')])).toBeUndefined();
  });
  test('空消息列表 → undefined', () => {
    expect(inferSourceFromMessages([])).toBeUndefined();
  });
});
