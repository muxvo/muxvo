/**
 * chat-history live 状态机核心（chat-history.md §7）。**wire 形状**的四域状态
 * （projects/sessions/messages/search）+ keyset 分页 + 搜索去抖状态机 + data.event 推送消费。
 * wire→screen 换算在 `ChatHistoryLive`（本 hook 只持 wire，不换算）。
 *
 * 纯逻辑（reducer / deriveSearchState / dedup 游标）导出可 node 直测；hook 只把 reducer 接上
 * 桥收发原语（`sendChatRequest`/`subscribeDataEvent` 由调用方注入 → 测试注假）。
 *
 * 搜索状态机（§7.4，对齐 chat.spec.json CHAT_L1_10~13_search）：
 *   EmptySearch --(输入非空)--> Searching        // 内容匹配节即挂 spinner（§7.4）
 *   Searching --(后端有结果)--> HasResults
 *   Searching --(后端无结果)--> NoResults
 *   HasResults/NoResults --(改词)--> Searching
 *   HasResults/NoResults --(清空/×)--> EmptySearch
 * 去抖 300ms（§6/§7.4）：仅**最后一次输入后 300ms** 发一次后端 search；期间态即 Searching。
 *
 * 分页游标（§7.3，keyset 非 offset）：
 *   sessions（中栏，向下）：触底带 `nextCursor` 追加；**终止 = `nextCursor` 缺席**（不可用「批<50→到头」）。
 *   messages（右栏，向上）：触顶带 `prevCursor` 反向向上 prepend；**终止 = `prevCursor` 缺席**（hasEarlier=false）。
 *
 * 推送（§7.2）：`chatSessionUpdate` 命中当前会话 → 重取投影尾部按 uuid dedup 只追加新 uuid；否则更新中栏
 * 卡片排序（裸信号无 lastModified → 以本地时刻近似 bump）。`chatSyncStatus` → 同步条态翻牌。
 */

import { useEffect, useReducer, useRef } from 'react';
import type {
  ChatMessageView,
  ChatProjectView,
  ChatRequest,
  ChatResponse,
  ChatSearchHit,
  ChatSessionView,
  ChatSyncStatus,
  DataEvent,
} from '../../../bridge/gen/protocol';

/**
 * 搜索去抖窗（ms）：仅最后一次输入后 300ms 发一次 search（§6/§7.4，PERF_L2_05）。
 * **独立于终端搜索的 SEARCH_DEBOUNCE_MS=150**（searchBarLogic.ts）——聊天搜索固定 300，勿复用终端常量。
 */
export const CHAT_SEARCH_DEBOUNCE_MS = 300;

/**
 * 未知 sessionId 推送触发的首页回取去抖窗（ms，问题3a）：外部续写一个尚未在列表里的新会话时，
 * 800ms trailing 去抖把一串推送合并成一次首页回取（配合 in-flight 单飞，杜绝回取风暴）。
 */
export const CHAT_UNKNOWN_REFETCH_DEBOUNCE_MS = 800;

export type SearchState = 'EmptySearch' | 'Searching' | 'HasResults' | 'NoResults';

/** 当前选中会话（sessionId + 其 projectHash，供 messages 请求；「全部项目」视图卡片各带自己的 projectHash）。 */
export interface ChatSelection {
  sessionId: string;
  projectHash: string;
}

export interface ChatDataState {
  // 左栏：项目
  projects: ChatProjectView[];
  ccDetected: boolean;
  projectsLoading: boolean;
  selectedProjectHash: string | null; // null = 全部项目（wire 侧省略 projectHash → native __all__）

  // 中栏：会话（keyset 向下分页）
  sessions: ChatSessionView[];
  sessionsLoading: boolean;
  sessionsLoadingMore: boolean;
  sessionsNextCursor: string | null; // null = 到头（nextCursor 缺席）

  // 右栏：会话详情消息（keyset 向上分页）
  selection: ChatSelection | null;
  messages: ChatMessageView[];
  messagesLoading: boolean; // 首屏取数中（detailPending）
  messagesLoadingMore: boolean;
  messagesPrevCursor: string | null; // 向上游标；null = 到头
  messagesHasEarlier: boolean; // prevCursor 存在（顶部可继续上翻）

  // 搜索
  query: string;
  searchState: SearchState;
  searchResults: ChatSearchHit[];

  // 同步条
  syncStatus: ChatSyncStatus;
  lastSyncMs: number | null;
  // 归档进度（W5，v17 chatSyncStatus 携 synced/total）：首扫中 banner 显「正在归档 synced/total」。
  // 无进度帧则 null（老口径同步条不受影响）；末帧到达后保留最后一帧，供完成 hold 过渡显示。
  syncProgress: { synced: number; total: number } | null;

  // 同步完成回取协调（问题3a：冷首开索引未就绪期加载到的 projects/sessions 视为「陈旧」，
  // 待 syncing→idle 边沿一次性回取补齐）。projectsStale/sessionsStale=首扫期加载的脏标；
  // refetchEpoch 单调递增，作 projects/sessions effect 的回取触发信号（bump 一次 = 回取一轮）。
  projectsStale: boolean;
  sessionsStale: boolean;
  refetchEpoch: number;
}

export const initialChatState: ChatDataState = {
  projects: [],
  ccDetected: false,
  projectsLoading: false,
  selectedProjectHash: null,

  sessions: [],
  sessionsLoading: false,
  sessionsLoadingMore: false,
  sessionsNextCursor: null,

  selection: null,
  messages: [],
  messagesLoading: false,
  messagesLoadingMore: false,
  messagesPrevCursor: null,
  messagesHasEarlier: false,

  query: '',
  searchState: 'EmptySearch',
  searchResults: [],

  syncStatus: 'idle',
  lastSyncMs: null,
  syncProgress: null,

  projectsStale: false,
  sessionsStale: false,
  refetchEpoch: 0,
};

export type ChatDataAction =
  | { t: 'projectsLoading' }
  | { t: 'projectsLoaded'; projects: ChatProjectView[]; ccDetected: boolean }
  | { t: 'selectProject'; projectHash: string | null }
  | { t: 'sessionsLoading' }
  | { t: 'sessionsLoaded'; sessions: ChatSessionView[]; nextCursor?: string }
  | { t: 'sessionsLoadingMore' }
  | { t: 'sessionsAppended'; sessions: ChatSessionView[]; nextCursor?: string }
  // 问题3a：同步完成/未知会话推送触发的首页回取 top-merge——已知 sessionId 就地更新、未知追加尾部、
  // **sessionsNextCursor 不动**（只刷首页，不重置分页游标；不闪骨架）。
  | { t: 'sessionsRefreshed'; sessions: ChatSessionView[] }
  | { t: 'selectSession'; sessionId: string; projectHash: string }
  | { t: 'clearSelection' }
  | { t: 'messagesLoading' }
  | { t: 'messagesLoaded'; messages: ChatMessageView[]; prevCursor?: string }
  | { t: 'messagesLoadingMore' }
  | { t: 'messagesLoadMoreDone' } // 分页/全量请求陈旧丢弃或失败 → 仅复位 loadingMore（不动 messages），防 W10 spinner 永转
  | { t: 'messagesPrepended'; messages: ChatMessageView[]; prevCursor?: string }
  | { t: 'sessionAppendReload'; messages: ChatMessageView[] }
  | { t: 'sessionCardTouch'; sessionId: string; nowMs: number }
  | { t: 'searchInput'; query: string }
  | { t: 'searchLoaded'; results: ChatSearchHit[] }
  | { t: 'syncStatus'; status: ChatSyncStatus; lastSyncMs: number | null; synced?: number; total?: number }
  // W13：右键菜单重命名/删除的乐观本地态（C 棒 UI 消费；重命名的 native 权威推送经 chatTitleUpdate 收敛，
  // 删除经既有 chatSessionUpdate 收敛）。
  | { t: 'sessionTitlePatched'; sessionId: string; customTitle?: string }
  | { t: 'sessionRemoved'; sessionId: string };

/** 追加去重（保序）：incoming 里 key 未见过的才追加到尾部（session-append 重取只追加新 uuid，§7.2）。 */
function appendUnique<T>(existing: T[], incoming: T[], keyOf: (t: T) => string): T[] {
  const seen = new Set(existing.map(keyOf));
  const add = incoming.filter((x) => !seen.has(keyOf(x)));
  return add.length ? [...existing, ...add] : existing;
}

/** 前置去重（保序）：向上补更早消息时把未见过的 prepend 到头部（§7.3 messages 反向 keyset）。 */
function prependUnique<T>(existing: T[], incoming: T[], keyOf: (t: T) => string): T[] {
  const seen = new Set(existing.map(keyOf));
  const add = incoming.filter((x) => !seen.has(keyOf(x)));
  return add.length ? [...add, ...existing] : existing;
}

/** 搜索四态派生（后端结果到达时用）：非空 query 且有结果 → HasResults，否则 NoResults。 */
export function deriveSearchStateOnResults(results: ChatSearchHit[]): SearchState {
  return results.length > 0 ? 'HasResults' : 'NoResults';
}

/** 会话选择相等（sessionId + projectHash）：分页/全量异步响应落 reducer 前校验目标未漂移（陈旧守卫）。 */
export function sameSelection(a: ChatSelection | null, b: ChatSelection): boolean {
  return a != null && a.sessionId === b.sessionId && a.projectHash === b.projectHash;
}

export function chatReducer(s: ChatDataState, a: ChatDataAction): ChatDataState {
  switch (a.t) {
    case 'projectsLoading':
      return { ...s, projectsLoading: true };
    case 'projectsLoaded':
      // 首扫期（syncing）加载到的项目视为陈旧（索引未就绪，可能缺项）→ 待边沿回取；idle 期加载即新鲜。
      return {
        ...s,
        projects: a.projects,
        ccDetected: a.ccDetected,
        projectsLoading: false,
        projectsStale: s.syncStatus === 'syncing',
      };

    case 'selectProject':
      // CHAT_L1_16：切项目筛选 → 右栏清空（§7 rightPanel clears）；会话由 effect 重取（sessionsLoading）。
      return {
        ...s,
        selectedProjectHash: a.projectHash,
        selection: null,
        messages: [],
        messagesPrevCursor: null,
        messagesHasEarlier: false,
      };

    case 'sessionsLoading':
      return { ...s, sessionsLoading: true };
    case 'sessionsLoaded':
      // 全量替换（挂载/切项目/空列表回取）：首扫期加载染 sessionsStale，idle 期即新鲜。
      return {
        ...s,
        sessions: a.sessions,
        sessionsNextCursor: a.nextCursor ?? null,
        sessionsLoading: false,
        sessionsLoadingMore: false,
        sessionsStale: s.syncStatus === 'syncing',
      };
    case 'sessionsLoadingMore':
      return { ...s, sessionsLoadingMore: true };
    case 'sessionsAppended':
      // §7.3：终止 = nextCursor 缺席；不可用「批<50→到头」。dedup by sessionId 防并发追加重复。
      // 首扫期追加的分页也染陈旧（升级 stale=true）；idle 期追加保持既有 stale。
      return {
        ...s,
        sessions: appendUnique(s.sessions, a.sessions, (x) => x.sessionId),
        sessionsNextCursor: a.nextCursor ?? null,
        sessionsLoadingMore: false,
        sessionsStale: s.syncStatus === 'syncing' ? true : s.sessionsStale,
      };
    case 'sessionsRefreshed': {
      // 问题3a：同步完成/未知会话推送触发的首页回取——top-merge。已知 sessionId 就地替换（保序），
      // 未知的追加到尾部，**sessionsNextCursor 不动**（回取只刷首页，不重置向下分页游标）。
      const byId = new Map(a.sessions.map((x) => [x.sessionId, x]));
      const merged = s.sessions.map((x) => byId.get(x.sessionId) ?? x);
      const known = new Set(s.sessions.map((x) => x.sessionId));
      const appended = a.sessions.filter((x) => !known.has(x.sessionId));
      return { ...s, sessions: appended.length ? [...merged, ...appended] : merged };
    }

    case 'selectSession':
      // CHAT_L1_17/T07：单击卡片 → 选中；messages 由 effect 取首屏（最近 50）。
      return { ...s, selection: { sessionId: a.sessionId, projectHash: a.projectHash } };
    case 'clearSelection':
      // T08 返回列表：清右栏；**selectedProjectHash 不动**（CHAT_L1_19 保持项目筛选）。
      return {
        ...s,
        selection: null,
        messages: [],
        messagesPrevCursor: null,
        messagesHasEarlier: false,
      };

    case 'messagesLoading':
      return { ...s, messagesLoading: true, messages: [] };
    case 'messagesLoaded':
      return {
        ...s,
        messages: a.messages,
        messagesLoading: false,
        messagesLoadingMore: false,
        messagesPrevCursor: a.prevCursor ?? null,
        messagesHasEarlier: a.prevCursor != null,
      };
    case 'messagesLoadingMore':
      return { ...s, messagesLoadingMore: true };
    case 'messagesLoadMoreDone':
      return { ...s, messagesLoadingMore: false };
    case 'messagesPrepended':
      // §7.3：向上补更早 50，prevCursor 缺席 = 到头（hasEarlier=false → 顶部渲染「已加载全部」）。
      return {
        ...s,
        messages: prependUnique(s.messages, a.messages, (x) => x.uuid),
        messagesPrevCursor: a.prevCursor ?? null,
        messagesHasEarlier: a.prevCursor != null,
        messagesLoadingMore: false,
      };
    case 'sessionAppendReload':
      // §7.2：当前会话被续写 → 重取尾部，按 uuid dedup 只追加新 uuid（不重复已渲染）。
      return { ...s, messages: appendUnique(s.messages, a.messages, (x) => x.uuid) };

    case 'sessionCardTouch': {
      // §7.2：非当前会话被续写 → 只 bump 该卡片 lastModified 让中栏重排（裸信号无 lastModified，近似取本地时刻）。
      const idx = s.sessions.findIndex((x) => x.sessionId === a.sessionId);
      if (idx < 0) return s; // 未加载的会话：忽略（下次全量加载自然出现）
      const sessions = s.sessions.slice();
      sessions[idx] = { ...sessions[idx], lastModifiedMs: Math.max(sessions[idx].lastModifiedMs, a.nowMs) };
      return { ...s, sessions };
    }

    case 'searchInput':
      // 清空/× → EmptySearch，恢复全量会话（保持当前项目筛选，§7.4）；非空 → 立即 Searching（内容匹配挂 spinner）。
      return a.query === ''
        ? { ...s, query: '', searchState: 'EmptySearch', searchResults: [] }
        : { ...s, query: a.query, searchState: 'Searching' };
    case 'searchLoaded':
      // 后端结果到（去抖 fire 后）。query 已清空则丢弃陈旧响应（hook 亦按 query 比对守卫）。
      if (s.query === '') return s;
      return { ...s, searchResults: a.results, searchState: deriveSearchStateOnResults(a.results) };

    case 'syncStatus': {
      // 进度帧（synced/total 皆在）→ 更新进度；无进度字段的裸帧 → 保留上一帧（末帧 hold 期显示需要，W5）。
      const syncProgress =
        a.synced != null && a.total != null ? { synced: a.synced, total: a.total } : s.syncProgress;
      // 问题3a 防风暴：**严格 syncing→idle 边沿**才评估回取（稳态 idle→idle 裸帧不触发，防循环回取）。
      // 有陈旧标 或 首扫期空列表加载（冷首开索引未就绪 → 会话为空）→ bump refetchEpoch 一轮并清陈旧标。
      const edge = a.status === 'idle' && s.syncStatus === 'syncing';
      const needRefetch =
        edge && (s.projectsStale || s.sessionsStale || (s.sessions.length === 0 && !s.sessionsLoading));
      return {
        ...s,
        syncStatus: a.status,
        lastSyncMs: a.lastSyncMs,
        syncProgress,
        ...(needRefetch
          ? { refetchEpoch: s.refetchEpoch + 1, projectsStale: false, sessionsStale: false }
          : {}),
      };
    }

    case 'sessionTitlePatched': {
      // W13：右键重命名乐观改本卡 customTitle（native 权威推送随后经 chatTitleUpdate 收敛，W8 强绑定）。未加载则忽略。
      const idx = s.sessions.findIndex((x) => x.sessionId === a.sessionId);
      if (idx < 0) return s;
      const sessions = s.sessions.slice();
      sessions[idx] = { ...sessions[idx], customTitle: a.customTitle };
      return { ...s, sessions };
    }
    case 'sessionRemoved': {
      // W13：右键删除乐观移除卡片；若正是当前右栏会话则清右栏（selection/messages 归零）。
      // 对抗回修（minor 幽灵卡）：同步剔除 searchResults 中该 sid 的命中——否则搜索态删除内容匹配卡后，
      // 占位卡仍以 search hit 留在列表（点开 → session rejected(NOT_FOUND) 被静默吞、右栏骨架挂起）。
      const sessions = s.sessions.filter((x) => x.sessionId !== a.sessionId);
      const searchResults = s.searchResults.filter((h) => h.sessionId !== a.sessionId);
      const clearRight = s.selection?.sessionId === a.sessionId;
      // 卡片/命中/选中均不涉及该 sid → 原样返回（含占位卡场景：sessions 无该 sid 但 searchResults 有）。
      if (sessions.length === s.sessions.length && searchResults.length === s.searchResults.length && !clearRight) {
        return s;
      }
      return {
        ...s,
        sessions,
        searchResults,
        ...(clearRight
          ? { selection: null, messages: [], messagesPrevCursor: null, messagesHasEarlier: false }
          : {}),
      };
    }
  }
}

// ── hook ──

export interface UseChatDataDeps {
  sendChatRequest(req: ChatRequest): Promise<ChatResponse>;
  subscribeDataEvent(handler: (event: DataEvent) => void): () => void;
}

export interface ChatDataApi {
  state: ChatDataState;
  searchState: SearchState;
  /** 左栏点项目（null = 全部项目）：CHAT_L1_16 过滤会话 + 清右栏。 */
  selectProject(projectHash: string | null): void;
  /** 中栏单击卡片：CHAT_L1_17/T07 载详情（projectHash 来自该卡片会话/搜索命中）。 */
  selectSession(sessionId: string, projectHash: string): void;
  /** 详情返回列表：T08，保持项目筛选（CHAT_L1_19）。 */
  backToList(): void;
  /** 搜索输入（含清空）：内部去抖 300ms，只最后一次发一次。 */
  setQuery(query: string): void;
  /** 中栏触底：keyset 向下追加下一批（nextCursor 缺席则空操作）。 */
  loadMoreSessions(): void;
  /** 右栏触顶：keyset 向上补更早（prevCursor 缺席/到头则空操作）。 */
  loadEarlierMessages(): void;
  /** 一次性全量加载当前会话消息（W7 搜索跨全历史定位 / W10 回到顶部）：session all:true → 全量替换、hasEarlier=false。 */
  loadAllMessages(): void;
  /** W13 右键重命名：乐观改本卡 customTitle（C 棒菜单消费；undefined = 清标题回落原 title）。 */
  patchSessionTitle(sessionId: string, customTitle?: string): void;
  /** W13 右键删除：乐观移除卡片 + 若为当前右栏会话则清右栏（C 棒菜单消费）。 */
  removeSession(sessionId: string): void;
}

export function useChatData(deps: UseChatDataDeps): ChatDataApi {
  const { sendChatRequest, subscribeDataEvent } = deps;
  const [state, dispatch] = useReducer(chatReducer, initialChatState);

  // 异步回调/订阅里读最新值：避免陈旧闭包（query 守卫 / 推送定向）。
  const queryRef = useRef(state.query);
  queryRef.current = state.query;
  const selectionRef = useRef(state.selection);
  selectionRef.current = state.selection;
  // 问题3a：订阅里判「未知 sessionId」+ 回取读当前项目筛选，均需最新值（避免陈旧闭包）。
  const sessionsRef = useRef(state.sessions);
  sessionsRef.current = state.sessions;
  const selectedProjectHashRef = useRef(state.selectedProjectHash);
  selectedProjectHashRef.current = state.selectedProjectHash;
  // sessions effect 回取判别：epoch 变 = 同步完成回取（列表非空则 top-merge、不闪骨架）；否则挂载/切项目全量替换。
  const prevEpochRef = useRef(state.refetchEpoch);
  // 未知会话推送回取：去抖定时器 + in-flight 单飞旗（防风暴）。
  const unknownRefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unknownRefetchInFlightRef = useRef(false);

  // 项目：挂载即载（ccDetected 供 noCC 判定）；refetchEpoch bump 时同步完成回取（全替换无害——
  // 项目骨架仅在 projects 空时显，回取时非空不闪；projectsLoaded 幂等替换）。
  useEffect(() => {
    let alive = true;
    dispatch({ t: 'projectsLoading' });
    void sendChatRequest({ kind: 'projects' })
      .then((r) => {
        if (alive && r.kind === 'projects') {
          dispatch({ t: 'projectsLoaded', projects: r.projects, ccDetected: r.ccDetected });
        }
      })
      .catch(() => {
        // §7.3 错误态：中栏占位不弹红框；此处静默（projectsLoading 落回由后续加载/空态承接）。
      });
    return () => {
      alive = false;
    };
  }, [sendChatRequest, state.refetchEpoch]);

  // 会话：项目筛选变化即重取（含挂载 null=全部项目）；替换列表 + 复位向下游标。
  // 问题3a 回取路径（epoch 变且列表非空）：不派 sessionsLoading（不闪骨架）、响应走 sessionsRefreshed
  // top-merge（不重置向下游标）；挂载/切项目/空列表回取仍走 sessionsLoading + sessionsLoaded 全替换。
  useEffect(() => {
    let alive = true;
    const isRefetch = prevEpochRef.current !== state.refetchEpoch;
    prevEpochRef.current = state.refetchEpoch;
    const mergeInPlace = isRefetch && sessionsRef.current.length > 0;
    if (!mergeInPlace) dispatch({ t: 'sessionsLoading' });
    const req: ChatRequest =
      state.selectedProjectHash != null
        ? { kind: 'sessions', projectHash: state.selectedProjectHash }
        : { kind: 'sessions' };
    void sendChatRequest(req)
      .then((r) => {
        if (alive && r.kind === 'sessions') {
          if (mergeInPlace) {
            dispatch({ t: 'sessionsRefreshed', sessions: r.sessions });
          } else {
            dispatch({ t: 'sessionsLoaded', sessions: r.sessions, nextCursor: r.nextCursor });
          }
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [sendChatRequest, state.selectedProjectHash, state.refetchEpoch]);

  // 消息：选中会话即取首屏（最近 50）。selection 变即重拉（含切换会话）。
  useEffect(() => {
    const sel = state.selection;
    if (!sel) return;
    let alive = true;
    dispatch({ t: 'messagesLoading' });
    void sendChatRequest({ kind: 'session', projectHash: sel.projectHash, sessionId: sel.sessionId })
      .then((r) => {
        if (alive && r.kind === 'messages') {
          dispatch({ t: 'messagesLoaded', messages: r.messages, prevCursor: r.prevCursor });
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [sendChatRequest, state.selection]);

  // 搜索去抖：query 变即重排 300ms 定时器（clear 前一个）→ 只最后一次输入后发一次。
  useEffect(() => {
    if (state.query === '') return; // EmptySearch：不发请求
    const q = state.query;
    const handle = setTimeout(() => {
      void sendChatRequest({ kind: 'search', query: q })
        .then((r) => {
          // query 已改则丢弃陈旧响应（防「fo」结果覆盖「foo」态）。
          if (r.kind === 'search' && queryRef.current === q) {
            dispatch({ t: 'searchLoaded', results: r.results });
          }
        })
        .catch(() => {});
    }, CHAT_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [sendChatRequest, state.query]);

  // data.event 推送订阅（§7.2）：chatSessionUpdate 定向重取 / 卡片 bump / 未知会话首页回取；chatSyncStatus 翻同步条。
  useEffect(() => {
    // 问题3a：未知 sessionId 推送 → 800ms trailing 去抖 + in-flight 单飞回取当前视图首页（带项目筛选、
    // 无 cursor），响应 top-merge 进列表（防风暴：一串推送合并一次、在飞时不再叠发）。
    const scheduleUnknownRefetch = (): void => {
      if (unknownRefetchTimerRef.current !== null) clearTimeout(unknownRefetchTimerRef.current);
      unknownRefetchTimerRef.current = setTimeout(() => {
        unknownRefetchTimerRef.current = null;
        if (unknownRefetchInFlightRef.current) return; // 单飞：在飞的回取已会带回最新首页
        unknownRefetchInFlightRef.current = true;
        const ph = selectedProjectHashRef.current;
        const req: ChatRequest = ph != null ? { kind: 'sessions', projectHash: ph } : { kind: 'sessions' };
        void sendChatRequest(req)
          .then((r) => {
            if (r.kind === 'sessions') dispatch({ t: 'sessionsRefreshed', sessions: r.sessions });
          })
          .catch(() => {})
          .finally(() => {
            unknownRefetchInFlightRef.current = false;
          });
      }, CHAT_UNKNOWN_REFETCH_DEBOUNCE_MS);
    };

    const unsub = subscribeDataEvent((e: DataEvent) => {
      if (e.kind === 'chatSyncStatus') {
        // synced/total（v17）→ 进度 banner（W5）；缺席则裸帧只翻状态/时刻。
        dispatch({ t: 'syncStatus', status: e.status, lastSyncMs: e.lastSyncMs ?? null, synced: e.synced, total: e.total });
        return;
      }
      if (e.kind === 'chatTitleUpdate') {
        // W8 强绑定推送（终端重命名正向链/首绑补写/聊天卡 setTitle 的 native 权威收敛）：定向 patch 本卡
        // customTitle（title 缺席 = 已清除，回落原 title）。未加载 sid 由 reducer 忽略（后续回取经 wire
        // 叠加兜底）。保活面板（问题3b 不卸载）标题即时跟随，无需重挂载。
        dispatch({ t: 'sessionTitlePatched', sessionId: e.sessionId, customTitle: e.title });
        return;
      }
      if (e.kind === 'chatSessionUpdate') {
        const sel = selectionRef.current;
        if (sel && sel.sessionId === e.sessionId) {
          // 正是当前右栏会话：据裸信号重取投影，dedup 追加新 uuid（不携增量帧，§7.2）。
          void sendChatRequest({ kind: 'session', projectHash: e.projectHash, sessionId: e.sessionId })
            .then((r) => {
              if (r.kind === 'messages') dispatch({ t: 'sessionAppendReload', messages: r.messages });
            })
            .catch(() => {});
        } else if (sessionsRef.current.some((x) => x.sessionId === e.sessionId)) {
          // 已知非当前会话：只 bump 中栏卡片排序，不打断右栏（§7.2）。
          dispatch({ t: 'sessionCardTouch', sessionId: e.sessionId, nowMs: Date.now() });
        } else {
          // 未知会话（列表里查无，如新建会话首次续写）：去抖回取首页补进列表（问题3a）。
          scheduleUnknownRefetch();
        }
      }
      // configResourcesChanged（M6）：非本面关注，忽略。
    });
    return () => {
      unsub();
      if (unknownRefetchTimerRef.current !== null) {
        clearTimeout(unknownRefetchTimerRef.current);
        unknownRefetchTimerRef.current = null;
      }
    };
  }, [sendChatRequest, subscribeDataEvent]);

  return {
    state,
    searchState: state.searchState,
    selectProject: (projectHash) => dispatch({ t: 'selectProject', projectHash }),
    selectSession: (sessionId, projectHash) => dispatch({ t: 'selectSession', sessionId, projectHash }),
    backToList: () => dispatch({ t: 'clearSelection' }),
    setQuery: (query) => dispatch({ t: 'searchInput', query }),
    loadMoreSessions: () => {
      if (state.sessionsLoadingMore || state.sessionsNextCursor == null) return;
      const cursor = state.sessionsNextCursor;
      dispatch({ t: 'sessionsLoadingMore' });
      const req: ChatRequest =
        state.selectedProjectHash != null
          ? { kind: 'sessions', projectHash: state.selectedProjectHash, cursor }
          : { kind: 'sessions', cursor };
      void sendChatRequest(req)
        .then((r) => {
          if (r.kind === 'sessions') {
            dispatch({ t: 'sessionsAppended', sessions: r.sessions, nextCursor: r.nextCursor });
          }
        })
        .catch(() => {});
    },
    loadEarlierMessages: () => {
      const sel = state.selection;
      if (!sel || state.messagesLoadingMore || !state.messagesHasEarlier || state.messagesPrevCursor == null) {
        return;
      }
      const before = state.messagesPrevCursor;
      dispatch({ t: 'messagesLoadingMore' });
      void sendChatRequest({ kind: 'session', projectHash: sel.projectHash, sessionId: sel.sessionId, before })
        .then((r) => {
          // 陈旧守卫（对抗回修 M-3 同族）：响应期间已换卡 → 丢弃，别把旧会话更早消息 prepend 进新详情。
          if (!sameSelection(selectionRef.current, sel)) return;
          if (r.kind === 'messages') {
            dispatch({ t: 'messagesPrepended', messages: r.messages, prevCursor: r.prevCursor });
          } else {
            dispatch({ t: 'messagesLoadMoreDone' }); // rejected 等 → 复位 loadingMore（分页守卫不永锁）
          }
        })
        .catch(() => {
          if (sameSelection(selectionRef.current, sel)) dispatch({ t: 'messagesLoadMoreDone' });
        });
    },
    loadAllMessages: () => {
      const sel = state.selection;
      // 用 loadingMore（非 loading）→ 详情不闪骨架；session all:true 返回无 prevCursor → messagesLoaded 令 hasEarlier=false。
      if (!sel || state.messagesLoadingMore) return;
      dispatch({ t: 'messagesLoadingMore' });
      void sendChatRequest({ kind: 'session', projectHash: sel.projectHash, sessionId: sel.sessionId, all: true })
        .then((r) => {
          // 陈旧守卫（对抗回修 M-3）：快速换卡时 A 会话 all:true 慢响应不得灌进 B 详情。
          if (!sameSelection(selectionRef.current, sel)) return;
          if (r.kind === 'messages') {
            dispatch({ t: 'messagesLoaded', messages: r.messages, prevCursor: r.prevCursor });
          } else {
            dispatch({ t: 'messagesLoadMoreDone' }); // rejected 等 → 复位 spinner（W10 pending 不永转）
          }
        })
        .catch(() => {
          if (sameSelection(selectionRef.current, sel)) dispatch({ t: 'messagesLoadMoreDone' });
        });
    },
    patchSessionTitle: (sessionId, customTitle) => dispatch({ t: 'sessionTitlePatched', sessionId, customTitle }),
    removeSession: (sessionId) => dispatch({ t: 'sessionRemoved', sessionId }),
  };
}
