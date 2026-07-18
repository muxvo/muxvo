// M5 批4 spec 翻牌（web，A4-3）：聊天浏览/搜索状态机 + 跳转/关闭发射面（CHAT_L1_16/17/18/19 +
// T07/T08/T09 + 10~13_search + 14_close）。
// l1/chat 为混里程碑 spec 文件（M2/M5 混）→ 逐条 test('ID: ...')，**严禁 test.each 注入**（spec-runner 1:1）。
//
// 断言面 = 真实工件：A4-1 的 useChatData 纯 reducer（chatReducer/initialChatState/deriveSearchStateOnResults）
// + actions.ts 发射纯函数（chatJumpAction/chatCloseAction），node 环境直测（panelState.detailReducer /
// searchBarLogic 先例，仓库无 renderHook）。每条锚定冻结 spec JSON 的 state/expectedBehavior 后再验行为。
//
// 分工：CHAT_L1_18/T09 只测 **web 发射面**（ui.action.chatJumpToTerminal）；面板关闭 + cwd 前缀匹配/新建
// 是 native 半（M5 批3 已落，app/Tests/MuxvoAppCoreTests/ChatPanelRoutingTests.swift）。
import { expect, test } from 'vitest';
import chatSpec from '../../specs/legacy/l1/chat.spec.json';
import {
  chatReducer,
  deriveSearchStateOnResults,
  initialChatState,
  type ChatDataState,
} from '../src/screen/chat/live/useChatData';
import { chatCloseAction, chatJumpAction } from '../src/screen/chat/live/actions';
import type { ChatMessageView, ChatSearchHit } from '../src/bridge/gen/protocol';

type SpecCase = Record<string, any>;

function caseOf(id: string): SpecCase {
  const c = (chatSpec.cases as SpecCase[]).find((x) => x.id === id);
  if (!c) throw new Error(`spec case 不存在: ${id}`);
  return c;
}

const mkMsg = (over: Partial<ChatMessageView> = {}): ChatMessageView => ({
  uuid: 'u1',
  sessionId: 's1',
  role: 'user',
  tsMs: 0,
  ...over,
});
const mkHit = (over: Partial<ChatSearchHit> = {}): ChatSearchHit => ({
  projectHash: 'h1',
  sessionId: 's1',
  snippet: 'snip',
  tsMs: 0,
  ...over,
});

// ── 浏览状态机（CHAT_L1_16/17/19 + T07/T08/T09） ──

test('CHAT_L1_16: 选择项目过滤会话 -- 左栏点项目设 filter + 右栏清空', () => {
  const c = caseOf('CHAT_L1_16');
  // spec 锚定：中栏 getSessions(projectHash) 过滤 + 右栏清空
  expect(c.expectedBehavior.middlePanel).toContain('getSessions');
  expect(c.expectedBehavior.rightPanel).toBe('clears');

  // 前置：全部项目视图（filter=null）下已选中会话 + 载入消息
  const base: ChatDataState = {
    ...initialChatState,
    selectedProjectHash: null,
    selection: { sessionId: 's1', projectHash: 'h1' },
    messages: [mkMsg()],
    messagesPrevCursor: 'cur',
    messagesHasEarlier: true,
  };
  const next = chatReducer(base, { t: 'selectProject', projectHash: 'h1' });
  // 设项目筛选（中栏会话由 effect 据此重取 getSessions(h1)）
  expect(next.selectedProjectHash).toBe('h1');
  // 右栏清空
  expect(next.selection).toBeNull();
  expect(next.messages).toEqual([]);
  expect(next.messagesPrevCursor).toBeNull();
  expect(next.messagesHasEarlier).toBe(false);
});

test('CHAT_L1_17: 点击会话加载详情 -- 中栏点卡片选中会话（右栏取 getSession）', () => {
  const c = caseOf('CHAT_L1_17');
  expect(c.expectedBehavior.rightPanel).toContain('getSession');

  const next = chatReducer(initialChatState, { t: 'selectSession', sessionId: 's9', projectHash: 'h9' });
  // 选中会话 → selection 置位；messages 由 effect 取首屏 getSession(h9, s9)
  expect(next.selection).toEqual({ sessionId: 's9', projectHash: 'h9' });
});

test('CHAT_L1_18: 双击会话跳转终端 -- 发射 chatJumpToTerminal（web 发射面；面板关闭/跳转 native 半批3）', () => {
  const c = caseOf('CHAT_L1_18');
  expect(c.expectedBehavior.panel).toBe('closes');
  expect(c.expectedBehavior.terminal).toContain('jumps');

  // web 发射面：从会话推出 ui.action.chatJumpToTerminal（cwd 前缀匹配/新建/无条件关面板由 native 半决策）
  expect(chatJumpAction({ sessionId: 's1', cwd: '/Users/rl/dev/muxvo' })).toEqual({
    kind: 'chatJumpToTerminal',
    sessionId: 's1',
    cwd: '/Users/rl/dev/muxvo',
  });
  // cwd 缺席 → cwd undefined（native 决策 closeOnly，仅关面板）
  expect(chatJumpAction({ sessionId: 's2' })).toEqual({
    kind: 'chatJumpToTerminal',
    sessionId: 's2',
    cwd: undefined,
  });
});

test('CHAT_L1_19: 从详情返回列表 -- 返回保持项目筛选（selectedProjectHash 不变）', () => {
  const c = caseOf('CHAT_L1_19');
  expect(c.expectedBehavior.state).toBe('Ready');
  expect(c.expectedBehavior.filter).toContain('maintain');

  const base: ChatDataState = {
    ...initialChatState,
    selectedProjectHash: 'h-keep',
    selection: { sessionId: 's1', projectHash: 'h-keep' },
    messages: [mkMsg()],
  };
  const next = chatReducer(base, { t: 'clearSelection' });
  expect(next.selection).toBeNull();
  expect(next.messages).toEqual([]);
  // 关键：项目筛选保留（下次进入沿用）
  expect(next.selectedProjectHash).toBe('h-keep');
});

test('CHAT_L1_T07: 点击会话进入详情 -- Ready -> SessionDetail', () => {
  const c = caseOf('CHAT_L1_T07');
  expect(c.state).toBe('Ready -> SessionDetail');

  // Ready = selection 为空；单击卡片 → selection 置位（进入 SessionDetail 态）
  expect(initialChatState.selection).toBeNull();
  const detail = chatReducer(initialChatState, { t: 'selectSession', sessionId: 's1', projectHash: 'h1' });
  expect(detail.selection).toEqual({ sessionId: 's1', projectHash: 'h1' });
});

test('CHAT_L1_T08: 详情返回列表 -- SessionDetail -> Ready', () => {
  const c = caseOf('CHAT_L1_T08');
  expect(c.state).toBe('SessionDetail -> Ready');

  const detail: ChatDataState = {
    ...initialChatState,
    selection: { sessionId: 's1', projectHash: 'h1' },
    messages: [mkMsg()],
  };
  const ready = chatReducer(detail, { t: 'clearSelection' });
  // 回 Ready（列表态）：selection 清空
  expect(ready.selection).toBeNull();
});

test('CHAT_L1_T09: 双击会话跳转终端关闭面板 -- SessionDetail -> Closed', () => {
  const c = caseOf('CHAT_L1_T09');
  expect(c.state).toBe('SessionDetail -> Closed');

  // SessionDetail 态（右栏打开某会话）下双击 → 发射 chatJumpToTerminal（web 面）；关面板由 native 无条件执行
  expect(chatJumpAction({ sessionId: 's1', cwd: '/Users/rl/dev/x' })).toEqual({
    kind: 'chatJumpToTerminal',
    sessionId: 's1',
    cwd: '/Users/rl/dev/x',
  });
});

// ── 搜索四态状态机（CHAT_L1_10~13_search，§7.4） ──

test('CHAT_L1_10_search: 搜索有结果 -- Searching -> HasResults', () => {
  const c = caseOf('CHAT_L1_10_search');
  expect(c.state).toBe('Searching -> HasResults');

  const searching = chatReducer(initialChatState, { t: 'searchInput', query: 'foo' });
  expect(searching.searchState).toBe('Searching');
  expect(searching.query).toBe('foo');

  const hit = mkHit();
  const loaded = chatReducer(searching, { t: 'searchLoaded', results: [hit] });
  expect(loaded.searchState).toBe('HasResults');
  expect(loaded.searchResults).toEqual([hit]);
  // 纯派生一致
  expect(deriveSearchStateOnResults([hit])).toBe('HasResults');
});

test('CHAT_L1_11_search: 搜索无结果 -- Searching -> NoResults', () => {
  const c = caseOf('CHAT_L1_11_search');
  expect(c.state).toBe('Searching -> NoResults');

  const searching = chatReducer(initialChatState, { t: 'searchInput', query: 'zzz' });
  expect(searching.searchState).toBe('Searching');
  const loaded = chatReducer(searching, { t: 'searchLoaded', results: [] });
  expect(loaded.searchState).toBe('NoResults');
  expect(deriveSearchStateOnResults([])).toBe('NoResults');
});

test('CHAT_L1_12_search: 修改搜索词 -- HasResults/NoResults -> Searching', () => {
  const c = caseOf('CHAT_L1_12_search');
  expect(c.state).toBe('HasResults/NoResults -> Searching');

  const hasResults: ChatDataState = {
    ...initialChatState,
    query: 'foo',
    searchState: 'HasResults',
    searchResults: [mkHit()],
  };
  const back1 = chatReducer(hasResults, { t: 'searchInput', query: 'foob' });
  expect(back1.searchState).toBe('Searching');
  expect(back1.query).toBe('foob');

  const noResults: ChatDataState = { ...initialChatState, query: 'zzz', searchState: 'NoResults' };
  const back2 = chatReducer(noResults, { t: 'searchInput', query: 'zzy' });
  expect(back2.searchState).toBe('Searching');
});

test('CHAT_L1_13_search: 清空搜索框 -- HasResults/NoResults -> EmptySearch', () => {
  const c = caseOf('CHAT_L1_13_search');
  expect(c.state).toBe('HasResults/NoResults -> EmptySearch');

  const hasResults: ChatDataState = {
    ...initialChatState,
    query: 'foo',
    searchState: 'HasResults',
    searchResults: [mkHit()],
  };
  const cleared = chatReducer(hasResults, { t: 'searchInput', query: '' });
  expect(cleared.searchState).toBe('EmptySearch');
  expect(cleared.query).toBe('');
  expect(cleared.searchResults).toEqual([]); // 恢复全量会话（保持项目筛选，§7.4）
});

// ── 关闭发射面（CHAT_L1_14_close，§7.6） ──

test('CHAT_L1_14_close: 关闭面板 -- Esc/关闭 → chatClose 发射', () => {
  const c = caseOf('CHAT_L1_14_close');
  expect(c.state).toBe('Ready -> Closed');
  expect(c.action).toContain('Esc');

  // web 发射面：Esc/关闭钮 → ui.action.chatClose（native 半 setPanelMode(.terminal)）
  expect(chatCloseAction()).toEqual({ kind: 'chatClose' });
});
