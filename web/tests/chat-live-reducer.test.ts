// chat-history live 状态机纯 reducer + 发射面（chat-history.md §7.3/§7.4/§7.7）。node 环境直测。
// 断言面 = 真实工件 useChatData.ts 的 chatReducer / actions.ts（ChatHistoryLive 消费的同一逻辑）。
import { describe, expect, test } from 'vitest';
import type { ChatMessageView, ChatSessionView } from '../src/bridge/gen/protocol';
import {
  chatReducer,
  deriveSearchStateOnResults,
  initialChatState,
  type ChatDataState,
} from '../src/screen/chat/live/useChatData';
import { chatCloseAction, chatJumpAction, chatResumeAction, sourceToCamel } from '../src/screen/chat/live/actions';

function sess(sessionId: string, lastModifiedMs = 1000, extra: Partial<ChatSessionView> = {}): ChatSessionView {
  return { sessionId, projectHash: 'ph', title: sessionId, startedAtMs: 0, lastModifiedMs, fileSize: 0, ...extra };
}
function msg(uuid: string): ChatMessageView {
  return { uuid, sessionId: 's1', role: 'user', tsMs: 0, text: uuid };
}
function withSessions(sessions: ChatSessionView[], patch: Partial<ChatDataState> = {}): ChatDataState {
  return { ...initialChatState, sessions, ...patch };
}

describe('搜索状态机四态（§7.4，对齐 CHAT_L1_10~13_search）', () => {
  test('EmptySearch --输入非空--> Searching（内容匹配即挂 spinner）', () => {
    const r = chatReducer(initialChatState, { t: 'searchInput', query: 'foo' });
    expect(r.searchState).toBe('Searching');
    expect(r.query).toBe('foo');
  });
  test('Searching --后端有结果--> HasResults', () => {
    let s = chatReducer(initialChatState, { t: 'searchInput', query: 'foo' });
    s = chatReducer(s, { t: 'searchLoaded', results: [{ projectHash: 'p', sessionId: 's', snippet: 'x', tsMs: 1 }] });
    expect(s.searchState).toBe('HasResults');
    expect(s.searchResults).toHaveLength(1);
  });
  test('Searching --后端无结果--> NoResults', () => {
    let s = chatReducer(initialChatState, { t: 'searchInput', query: 'foo' });
    s = chatReducer(s, { t: 'searchLoaded', results: [] });
    expect(s.searchState).toBe('NoResults');
  });
  test('HasResults --改词--> Searching', () => {
    let s = chatReducer(initialChatState, { t: 'searchInput', query: 'foo' });
    s = chatReducer(s, { t: 'searchLoaded', results: [{ projectHash: 'p', sessionId: 's', snippet: 'x', tsMs: 1 }] });
    s = chatReducer(s, { t: 'searchInput', query: 'foobar' });
    expect(s.searchState).toBe('Searching');
  });
  test('HasResults/NoResults --清空/×--> EmptySearch（清结果）', () => {
    let s = chatReducer(initialChatState, { t: 'searchInput', query: 'foo' });
    s = chatReducer(s, { t: 'searchLoaded', results: [{ projectHash: 'p', sessionId: 's', snippet: 'x', tsMs: 1 }] });
    s = chatReducer(s, { t: 'searchInput', query: '' });
    expect(s.searchState).toBe('EmptySearch');
    expect(s.searchResults).toEqual([]);
    expect(s.query).toBe('');
  });
  test('query 已清空后陈旧 searchLoaded 被丢弃（防覆盖 EmptySearch）', () => {
    const s = chatReducer({ ...initialChatState, query: '', searchState: 'EmptySearch' }, {
      t: 'searchLoaded',
      results: [{ projectHash: 'p', sessionId: 's', snippet: 'x', tsMs: 1 }],
    });
    expect(s.searchState).toBe('EmptySearch');
  });
  test('deriveSearchStateOnResults 纯派生', () => {
    expect(deriveSearchStateOnResults([])).toBe('NoResults');
    expect(deriveSearchStateOnResults([{ projectHash: 'p', sessionId: 's', snippet: 'x', tsMs: 1 }])).toBe('HasResults');
  });
});

describe('浏览状态（§7 / CHAT_L1_16/17/19）', () => {
  test('选项目：设 projectFilter + 清右栏（selection/messages）', () => {
    const start = withSessions([sess('a')], {
      selection: { sessionId: 'a', projectHash: 'ph' },
      messages: [msg('m1')],
      messagesHasEarlier: true,
    });
    const s = chatReducer(start, { t: 'selectProject', projectHash: 'ph2' });
    expect(s.selectedProjectHash).toBe('ph2');
    expect(s.selection).toBeNull();
    expect(s.messages).toEqual([]);
    expect(s.messagesHasEarlier).toBe(false);
  });
  test('全部项目：projectHash=null', () => {
    const s = chatReducer({ ...initialChatState, selectedProjectHash: 'ph' }, { t: 'selectProject', projectHash: null });
    expect(s.selectedProjectHash).toBeNull();
  });
  test('单击卡片：selection=sessionId(+projectHash)', () => {
    const s = chatReducer(initialChatState, { t: 'selectSession', sessionId: 's9', projectHash: 'phX' });
    expect(s.selection).toEqual({ sessionId: 's9', projectHash: 'phX' });
  });
  test('返回：清 selection 但保持 projectFilter（不清项目筛选）', () => {
    const start = withSessions([sess('a')], {
      selectedProjectHash: 'ph-keep',
      selection: { sessionId: 'a', projectHash: 'ph-keep' },
      messages: [msg('m1')],
    });
    const s = chatReducer(start, { t: 'clearSelection' });
    expect(s.selection).toBeNull();
    expect(s.messages).toEqual([]);
    expect(s.selectedProjectHash).toBe('ph-keep'); // 筛选不变
  });
});

describe('sessions keyset 向下分页（§7.3：nextCursor 缺席=到头，非「批<50」）', () => {
  test('sessionsLoaded：nextCursor 存在 → 保存游标', () => {
    const s = chatReducer(initialChatState, { t: 'sessionsLoaded', sessions: [sess('a')], nextCursor: 'C1' });
    expect(s.sessions.map((x) => x.sessionId)).toEqual(['a']);
    expect(s.sessionsNextCursor).toBe('C1');
    expect(s.sessionsLoading).toBe(false);
  });
  test('sessionsLoaded：nextCursor 缺席 → 到头（null）', () => {
    const s = chatReducer(initialChatState, { t: 'sessionsLoaded', sessions: [sess('a')] });
    expect(s.sessionsNextCursor).toBeNull();
  });
  test('sessionsAppended：追加 + 按 sessionId dedup；nextCursor 缺席=到头', () => {
    const start = withSessions([sess('a'), sess('b')], { sessionsNextCursor: 'C1', sessionsLoadingMore: true });
    const s = chatReducer(start, { t: 'sessionsAppended', sessions: [sess('b'), sess('c')] });
    expect(s.sessions.map((x) => x.sessionId)).toEqual(['a', 'b', 'c']); // b 去重不重复
    expect(s.sessionsNextCursor).toBeNull();
    expect(s.sessionsLoadingMore).toBe(false);
  });
});

describe('messages keyset 向上分页 + 推送去重（§7.3/§7.2）', () => {
  test('messagesLoaded：prevCursor 存在 → hasEarlier=true', () => {
    const s = chatReducer(initialChatState, { t: 'messagesLoaded', messages: [msg('m1')], prevCursor: 'B1' });
    expect(s.messages.map((m) => m.uuid)).toEqual(['m1']);
    expect(s.messagesPrevCursor).toBe('B1');
    expect(s.messagesHasEarlier).toBe(true);
  });
  test('messagesLoaded：prevCursor 缺席 → hasEarlier=false（到头，渲染「已加载全部」）', () => {
    const s = chatReducer(initialChatState, { t: 'messagesLoaded', messages: [msg('m1')] });
    expect(s.messagesHasEarlier).toBe(false);
  });
  test('messagesPrepended：更早消息 prepend 到头 + 按 uuid dedup', () => {
    const start = { ...initialChatState, messages: [msg('m2'), msg('m3')], messagesHasEarlier: true, messagesPrevCursor: 'B1' };
    const s = chatReducer(start, { t: 'messagesPrepended', messages: [msg('m0'), msg('m1'), msg('m2')], prevCursor: undefined });
    expect(s.messages.map((m) => m.uuid)).toEqual(['m0', 'm1', 'm2', 'm3']); // m2 去重；顺序在前
    expect(s.messagesHasEarlier).toBe(false); // prevCursor 缺席=到头
  });
  test('sessionAppendReload：重取尾部按 uuid dedup 只追加新 uuid（§7.2）', () => {
    const start = { ...initialChatState, messages: [msg('m1'), msg('m2')] };
    const s = chatReducer(start, { t: 'sessionAppendReload', messages: [msg('m1'), msg('m2'), msg('m3')] });
    expect(s.messages.map((m) => m.uuid)).toEqual(['m1', 'm2', 'm3']); // 只追加 m3
  });
  test('sessionAppendReload：无新 uuid → messages 引用不变（幂等）', () => {
    const start = { ...initialChatState, messages: [msg('m1')] };
    const s = chatReducer(start, { t: 'sessionAppendReload', messages: [msg('m1')] });
    expect(s.messages).toBe(start.messages);
  });
});

describe('sessionCardTouch（§7.2：非当前会话 bump 排序）', () => {
  test('命中会话：lastModifiedMs bump 到本地时刻（更大者）', () => {
    const start = withSessions([sess('a', 1000), sess('b', 2000)]);
    const s = chatReducer(start, { t: 'sessionCardTouch', sessionId: 'a', nowMs: 9999 });
    expect(s.sessions.find((x) => x.sessionId === 'a')?.lastModifiedMs).toBe(9999);
  });
  test('未加载会话：no-op（引用不变）', () => {
    const start = withSessions([sess('a')]);
    const s = chatReducer(start, { t: 'sessionCardTouch', sessionId: 'zzz', nowMs: 9999 });
    expect(s).toBe(start);
  });
});

describe('syncStatus（§7.5）', () => {
  test('翻牌同步条态 + lastSyncMs', () => {
    const s = chatReducer(initialChatState, { t: 'syncStatus', status: 'error', lastSyncMs: 42 });
    expect(s.syncStatus).toBe('error');
    expect(s.lastSyncMs).toBe(42);
  });
});

// ── 问题3a：同步完成回取协调（stale 染色 / 边沿 bump / sessionsRefreshed top-merge） ──
describe('问题3a stale 染色（首扫期加载视为陈旧）', () => {
  const syncing: Partial<ChatDataState> = { syncStatus: 'syncing' };
  test('syncing 期 projectsLoaded → projectsStale=true；idle 期 → false', () => {
    const a = chatReducer({ ...initialChatState, ...syncing }, { t: 'projectsLoaded', projects: [], ccDetected: true });
    expect(a.projectsStale).toBe(true);
    const b = chatReducer(initialChatState, { t: 'projectsLoaded', projects: [], ccDetected: true });
    expect(b.projectsStale).toBe(false);
  });
  test('syncing 期 sessionsLoaded → sessionsStale=true；idle 期全替换清 false', () => {
    const a = chatReducer({ ...initialChatState, ...syncing }, { t: 'sessionsLoaded', sessions: [sess('a')] });
    expect(a.sessionsStale).toBe(true);
    const b = chatReducer({ ...initialChatState, sessionsStale: true }, { t: 'sessionsLoaded', sessions: [sess('a')] });
    expect(b.sessionsStale).toBe(false); // idle 期新鲜替换清标
  });
  test('syncing 期 sessionsAppended → 升级 stale=true；idle 期保持既有', () => {
    const a = chatReducer(withSessions([sess('a')], syncing), { t: 'sessionsAppended', sessions: [sess('b')] });
    expect(a.sessionsStale).toBe(true);
    const b = chatReducer(withSessions([sess('a')], { sessionsStale: false }), { t: 'sessionsAppended', sessions: [sess('b')] });
    expect(b.sessionsStale).toBe(false);
  });
});

describe('问题3a 边沿回取（syncing→idle 才 bump refetchEpoch）', () => {
  test('边沿 + 有陈旧标 → refetchEpoch+1 且清两标', () => {
    const start: ChatDataState = { ...initialChatState, syncStatus: 'syncing', sessionsStale: true, projectsStale: true, sessions: [sess('a')] };
    const s = chatReducer(start, { t: 'syncStatus', status: 'idle', lastSyncMs: 1 });
    expect(s.refetchEpoch).toBe(1);
    expect(s.projectsStale).toBe(false);
    expect(s.sessionsStale).toBe(false);
  });
  test('边沿 + 首扫期空列表（无陈旧标但 sessions 空）→ 仍 bump（补空会话）', () => {
    const start: ChatDataState = { ...initialChatState, syncStatus: 'syncing', sessions: [] };
    const s = chatReducer(start, { t: 'syncStatus', status: 'idle', lastSyncMs: 1 });
    expect(s.refetchEpoch).toBe(1);
  });
  test('边沿 + 无陈旧标 + 列表非空 → 不 bump', () => {
    const start: ChatDataState = { ...initialChatState, syncStatus: 'syncing', sessions: [sess('a')] };
    const s = chatReducer(start, { t: 'syncStatus', status: 'idle', lastSyncMs: 1 });
    expect(s.refetchEpoch).toBe(0);
  });
  test('稳态 idle→idle 裸帧 → 永不 bump（防循环回取）', () => {
    const start: ChatDataState = { ...initialChatState, syncStatus: 'idle', sessionsStale: true, sessions: [] };
    const s = chatReducer(start, { t: 'syncStatus', status: 'idle', lastSyncMs: 2 });
    expect(s.refetchEpoch).toBe(0);
  });
});

describe('问题3a sessionsRefreshed（首页回取 top-merge）', () => {
  test('已知 sessionId 就地更新 + 未知追加尾部 + sessionsNextCursor 不动', () => {
    const start = withSessions([sess('a', 1000, { title: '旧A' }), sess('b', 2000)], { sessionsNextCursor: 'C1' });
    const s = chatReducer(start, {
      t: 'sessionsRefreshed',
      sessions: [sess('a', 1500, { title: '新A' }), sess('c', 3000)],
    });
    expect(s.sessions.map((x) => x.sessionId)).toEqual(['a', 'b', 'c']); // a 就地、b 保留、c 追加
    expect(s.sessions.find((x) => x.sessionId === 'a')?.title).toBe('新A'); // 已知就地更新
    expect(s.sessionsNextCursor).toBe('C1'); // 游标不动
  });
  test('全为已知 → 无追加，仅就地更新', () => {
    const start = withSessions([sess('a', 1000, { title: '旧' })]);
    const s = chatReducer(start, { t: 'sessionsRefreshed', sessions: [sess('a', 1000, { title: '新' })] });
    expect(s.sessions).toHaveLength(1);
    expect(s.sessions[0].title).toBe('新');
  });
});

describe('发射面纯函数（§7.6/§7.7；native 半批3 已落，此处只测 web 发射）', () => {
  test('chatCloseAction → {kind:chatClose}', () => {
    expect(chatCloseAction()).toEqual({ kind: 'chatClose' });
  });
  test('chatJumpAction：携 sessionId + cwd（cwd 缺席则 undefined → native closeOnly）', () => {
    expect(chatJumpAction({ sessionId: 's1', cwd: '/c' })).toEqual({
      kind: 'chatJumpToTerminal',
      sessionId: 's1',
      cwd: '/c',
    });
    expect(chatJumpAction({ sessionId: 's1' })).toEqual({ kind: 'chatJumpToTerminal', sessionId: 's1', cwd: undefined });
  });
  test('sourceToCamel：kebab claude-code → camel claudeCode；codex 恒等；缺席→claudeCode', () => {
    expect(sourceToCamel('claude-code')).toBe('claudeCode');
    expect(sourceToCamel('claudeCode')).toBe('claudeCode');
    expect(sourceToCamel('codex')).toBe('codex');
    expect(sourceToCamel(undefined)).toBe('claudeCode');
  });
  test('chatResumeAction：source 回传 camel（kebab→camel）', () => {
    expect(
      chatResumeAction({ sessionId: 's1', cwd: '/c', source: 'claude-code', customTitle: 'T' }),
    ).toEqual({ kind: 'chatResume', sessionId: 's1', cwd: '/c', source: 'claudeCode', customTitle: 'T' });
    expect(chatResumeAction({ sessionId: 's2', cwd: '/c', source: 'codex' })).toEqual({
      kind: 'chatResume',
      sessionId: 's2',
      cwd: '/c',
      source: 'codex',
      customTitle: undefined,
    });
  });
});

// ── W13：右键菜单乐观本地态（sessionTitlePatched / sessionRemoved） ──
describe('W13 sessionTitlePatched（右键重命名乐观改 customTitle）', () => {
  test('命中卡片 → 改 customTitle', () => {
    const s = withSessions([sess('s1'), sess('s2')]);
    const r = chatReducer(s, { t: 'sessionTitlePatched', sessionId: 's2', customTitle: '新标题' });
    expect(r.sessions.find((x) => x.sessionId === 's2')?.customTitle).toBe('新标题');
    expect(r.sessions.find((x) => x.sessionId === 's1')?.customTitle).toBeUndefined();
  });
  test('customTitle undefined（清标题）→ 落 undefined，显示回落原 title', () => {
    const s = withSessions([sess('s1', 1000, { customTitle: '旧' })]);
    const r = chatReducer(s, { t: 'sessionTitlePatched', sessionId: 's1', customTitle: undefined });
    expect(r.sessions[0].customTitle).toBeUndefined();
  });
  test('未加载会话 → 忽略（同引用返回）', () => {
    const s = withSessions([sess('s1')]);
    const r = chatReducer(s, { t: 'sessionTitlePatched', sessionId: 'nope', customTitle: 'x' });
    expect(r).toBe(s);
  });
});

describe('W13 sessionRemoved（右键删除乐观移除卡片）', () => {
  test('删当前右栏会话 → 移除卡片 + 清右栏（selection/messages 归零）', () => {
    const s = withSessions([sess('s1'), sess('s2')], {
      selection: { sessionId: 's1', projectHash: 'ph' },
      messages: [msg('m1')],
      messagesPrevCursor: 'c',
      messagesHasEarlier: true,
    });
    const r = chatReducer(s, { t: 'sessionRemoved', sessionId: 's1' });
    expect(r.sessions.map((x) => x.sessionId)).toEqual(['s2']);
    expect(r.selection).toBeNull();
    expect(r.messages).toEqual([]);
    expect(r.messagesHasEarlier).toBe(false);
  });
  test('删非当前会话 → 只移除卡片，右栏 selection 保持', () => {
    const s = withSessions([sess('s1'), sess('s2')], {
      selection: { sessionId: 's1', projectHash: 'ph' },
      messages: [msg('m1')],
    });
    const r = chatReducer(s, { t: 'sessionRemoved', sessionId: 's2' });
    expect(r.sessions.map((x) => x.sessionId)).toEqual(['s1']);
    expect(r.selection).toEqual({ sessionId: 's1', projectHash: 'ph' });
    expect(r.messages).toEqual([msg('m1')]);
  });
  test('未加载且非选中 → 忽略（同引用返回）', () => {
    const s = withSessions([sess('s1')]);
    const r = chatReducer(s, { t: 'sessionRemoved', sessionId: 'nope' });
    expect(r).toBe(s);
  });
});

// ── W5：归档进度帧消费（syncStatus 携 synced/total） ──
describe('W5 syncStatus 进度（synced/total → syncProgress）', () => {
  test('进度帧 → syncProgress 更新', () => {
    const r = chatReducer(initialChatState, {
      t: 'syncStatus',
      status: 'syncing',
      lastSyncMs: null,
      synced: 2,
      total: 5,
    });
    expect(r.syncProgress).toEqual({ synced: 2, total: 5 });
    expect(r.syncStatus).toBe('syncing');
  });
  test('裸帧（无 synced/total）→ 保留上一帧进度（末帧 hold 期显示需要）', () => {
    let s = chatReducer(initialChatState, { t: 'syncStatus', status: 'syncing', lastSyncMs: null, synced: 5, total: 5 });
    s = chatReducer(s, { t: 'syncStatus', status: 'idle', lastSyncMs: 123 });
    expect(s.syncProgress).toEqual({ synced: 5, total: 5 });
    expect(s.syncStatus).toBe('idle');
    expect(s.lastSyncMs).toBe(123);
  });
});
