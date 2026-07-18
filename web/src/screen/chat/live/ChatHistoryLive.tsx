/**
 * chat-history live 容器（chat-history.md §7）：把 useChatData 的 wire 状态经 §7.1 换算成屏消费的
 * `fx.chat`，并组装 live 接线 bundle 挂 `fx.live`，交给 ChatHistoryScreen 渲染。交互发射（Esc/双击/
 * 继续聊天/关闭）走 `ui.action`（fire-and-forget），面板关闭由 native 无条件执行（§7.7 native 半）。
 *
 * 仅 main.tsx 的 `bridge && panelMode==='chatHistory'` 分支经 React.lazy 挂载（截图/浏览器直开到不了这里）——
 * bridge 恒非空，`?screenshot=1` 铁律不破（本模块一行不进截图静态图）。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { BridgeApi } from '../../../bridge/client';
import type { ChatMessageView } from '../../../bridge/gen/protocol';
import type { Fixture } from '../../../fixture/types';
import { useConfig, useConfigApi } from '../../../config/ConfigContext';
import { ChatHistoryScreen } from '../ChatHistoryScreen';
import { track } from '../../../bridge/track';
import { chatCloseAction, chatResumeAction, pickDoubleClickAction } from './actions';
import { copyText } from './clipboard';
import { formatMessagesAsMarkdown } from './exportMd';
import { DeleteConfirmModal, SessionContextMenu } from './SessionContextMenu';
import {
  inferSourceFromMessages,
  messageToScreen,
  projectToScreen,
  searchHitToScreen,
  sessionToScreen,
  synthSessionFromSearchHit,
} from './convert';
import type { ChatHistoryLive as ChatHistoryLiveBundle } from './screen-contract';
import { useChatData } from './useChatData';
import './chat-live.css';

const ARCHIVE_DISMISS_KEY = 'muxvo-archive-notice-dismissed';

/**
 * §7.6 archive banner 的 **live 文案 prop**：dogfood-r5 PR-5 起指向**中心化共享归档库**（chat-data §6.5，
 * 所有 Muxvo 分身共用、CC 30 天清理后永不丢），不再是 per-分身数据根 `chat-history/`，更非冻结 golden
 * 文案里的 `~/.muxvo/chat-archive/`。golden 走屏内缺省（冻结）文案 → 字节不受影响。
 */
const LIVE_BANNER_TEXT =
  'Claude Code 本地聊天记录在未参与模型训练时仅保留约 30 天（参与训练时为 5 年），' +
  'Muxvo 已自动归档到共享归档库（所有 Muxvo 分身共用）永久保留。所有数据仅保存在你的本地电脑，不会上传到任何服务器。';

/** §7.6 noCC「了解 Claude Code」外链目标。 */
const CLAUDE_CODE_URL = 'https://www.anthropic.com/claude-code';

/** 单击=打开详情 vs 双击=聚焦/续聊 的防误触延迟（缺陷 W9）：单击选中延迟此毫秒，双击期内先撤销。 */
const SELECT_CLICK_DELAY_MS = 220;

/** W5 首扫归档完成后 banner 进度文案的过渡保持时长：完成瞬间不硬切静态长文案，保持进度 ~2s 再回落。 */
const ARCHIVE_DONE_HOLD_MS = 2000;

function readBannerDismissed(): boolean {
  try {
    return localStorage.getItem(ARCHIVE_DISMISS_KEY) === 'true';
  } catch {
    return false;
  }
}

export function ChatHistoryLive({
  fx,
  bridge,
  active = true,
}: {
  fx: Fixture;
  bridge: BridgeApi;
  /** 问题3b 保活：面板隐藏时 false——门控 Esc 监听 + 隐藏瞬间清瞬态 overlay。默认 true 兼容旧直挂调用方。 */
  active?: boolean;
}): JSX.Element {
  const deps = useMemo(
    () => ({ sendChatRequest: bridge.sendChatRequest, subscribeDataEvent: bridge.subscribeDataEvent }),
    [bridge],
  );
  const chat = useChatData(deps);
  const s = chat.state;

  const [bannerVisible, setBannerVisible] = useState<boolean>(() => !readBannerDismissed());

  // W5 归档进度 banner（§7.6 三段）：①首扫中（syncing 且 synced<total）→「正在归档 synced/total…」；
  // ②首扫完成后经 ARCHIVE_DONE_HOLD_MS 过渡再回静态长文案；③× 关闭走既有 localStorage（bannerVisible=false
  // → 整条 banner 连同进度一并隐藏，legacy 一次性口径）。
  const prog = s.syncProgress;
  const scanning = s.syncStatus === 'syncing' && !!prog && prog.total > 0 && prog.synced < prog.total;
  const [holdDone, setHoldDone] = useState(false);
  const wasScanningRef = useRef(scanning);
  useEffect(() => {
    if (wasScanningRef.current && !scanning) {
      // 首扫刚完成：保持进度文案 hold 一段再回静态。
      setHoldDone(true);
      const timer = setTimeout(() => setHoldDone(false), ARCHIVE_DONE_HOLD_MS);
      wasScanningRef.current = scanning;
      return () => clearTimeout(timer);
    }
    wasScanningRef.current = scanning;
    return undefined;
  }, [scanning]);
  const showProgress = scanning || holdDone;
  const bannerText =
    showProgress && prog ? `正在归档 ${prog.synced}/${prog.total}...` : LIVE_BANNER_TEXT;

  // R7.3 归档开关（对抗 M-1）：banner checkbox 读 ConfigSnapshot.archiveEnabled + 切换发 PrefsPatch。
  // useConfig/useConfigApi 经 ChatHistoryChrome 的 ConfigProvider 供给；无 provider（旧测试直挂）时返回
  // null → archiveEnabled 默认 true、toggle inert（golden 安全，与 M6 配置面同款 null-safe 惯例）。
  // 乐观更新 + 写失败回滚由 ConfigApi.set 内建（rejected/传输错 → 重拉 get 校正）。
  const config = useConfig();
  const configApi = useConfigApi();
  const archiveEnabled = config?.archiveEnabled ?? true;
  const onToggleArchive = configApi
    ? (): void => {
        void configApi.set({ archiveEnabled: !archiveEnabled });
      }
    : undefined;

  // W8 右键菜单 / 内联重命名 / 删除确认（live-only 交互态；均由本容器渲染 overlay）。
  const [menu, setMenu] = useState<{ sessionId: string; projectHash: string; x: number; y: number } | null>(null);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ sessionId: string; projectHash: string } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // W8 删除：projectHash 取该会话真实值（批2 契约，错 hash 假成功且丢 title）；.deleted→removeSession；
  // rejected UNSUPPORTED_SOURCE（codex，用户拍板本批不支持）→ modal 内联提示。
  const confirmDelete = (): void => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleting(true);
    setDeleteError(null);
    void bridge
      .sendChatRequest({ kind: 'delete', projectHash: target.projectHash, sessionId: target.sessionId })
      .then((r) => {
        setDeleting(false);
        if (r.kind === 'deleted') {
          chat.removeSession(target.sessionId);
          setDeleteTarget(null);
        } else if (r.kind === 'rejected') {
          setDeleteError(
            r.code === 'UNSUPPORTED_SOURCE' ? 'Codex 会话暂不支持删除' : r.message || '删除失败',
          );
        }
      })
      .catch(() => {
        setDeleting(false);
        setDeleteError('删除失败');
      });
  };

  // W11 整段复制为 Markdown：hasEarlier 时先取全量（session all:true，不进 reducer）再格式化进剪贴板；失败降级已加载段。
  const copyMarkdown = async (): Promise<void> => {
    const sel = s.selection;
    if (!sel) return;
    const sess = s.sessions.find((x) => x.sessionId === sel.sessionId);
    const title = sess?.customTitle || sess?.title || '';
    let msgs: ChatMessageView[] = s.messages;
    if (s.messagesHasEarlier) {
      try {
        const r = await bridge.sendChatRequest({
          kind: 'session',
          projectHash: sel.projectHash,
          sessionId: sel.sessionId,
          all: true,
        });
        if (r.kind === 'messages') msgs = r.messages;
      } catch {
        /* 降级：用已加载段 */
      }
    }
    await copyText(formatMessagesAsMarkdown(title, msgs));
  };

  // Esc 关面板（§7.6 / CHAT_L1_14_close）→ chatClose（native 半 setPanelMode(.terminal) → 下拍 ui.state
  // 无 chatHistory → main.tsx 卸本容器）。!defaultPrevented：子级弹窗自拦时不误关。
  // 问题3b 保活：面板隐藏（active=false）时**不监听 Esc**——否则终端里按 Esc 会误发 chatClose（唯一真雷）。
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !e.defaultPrevented) bridge.sendAction(chatCloseAction());
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [bridge, active]);

  // 单/双击防误触（缺陷 W9）：单击选中延迟 SELECT_CLICK_DELAY_MS，双击先撤销 pending 单击再发射。
  const selectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // analytics.md L4 chat.searched：每次面板打开（本组件挂载期）只发一次。
  const searchTrackedRef = useRef(false);
  useEffect(
    () => () => {
      if (selectTimerRef.current !== null) clearTimeout(selectTimerRef.current);
    },
    [],
  );

  // 问题3b 保活：面板转入隐藏（active=false）时清瞬态 overlay/pending——避免复现时残留右键菜单/删除确认框/
  // 误触延迟单击。浏览态（选中/滚动/展开）不动，只清「一次性」交互层。
  useEffect(() => {
    if (active) {
      // 埋点对抗 M-1 回修：保活面板不卸载，chat.searched 的 per-open 语义靠 active 重开时复位——
      // 否则退化为「每 app 生命周期只发一次」（analytics.md L4「每次面板打开只发一次」被违背）。
      searchTrackedRef.current = false;
      return;
    }
    setMenu(null);
    setDeleteTarget(null);
    setDeleteError(null);
    if (selectTimerRef.current !== null) {
      clearTimeout(selectTimerRef.current);
      selectTimerRef.current = null;
    }
  }, [active]);

  // W7 搜索态全量加载（R1.7）：query 非空 + 已选会话 + 顶部仍可上翻 + 空闲 → 一次性全量拉取，令内容匹配可
  // 跨全历史定位/高亮/导航（W6）。loadAllMessages 后 hasEarlier 落 false → 条件自止（不重复发）。loadAll 用
  // 引用（每渲染更新）避 chat 对象身份漂移致 effect 空跑重发。
  const loadAllRef = useRef(chat.loadAllMessages);
  loadAllRef.current = chat.loadAllMessages;
  // V-1（批3 裁决顺修）：session 持续 rejected 时 loadMoreDone 复位 loadingMore → 条件复真 → 重试风暴。
  // 按 query+selection 记一次性尝试闩：同键只发一次（成功靠 hasEarlier 落 false 自止，失败不自动重试）；
  // 换卡/改词键变重臂自愈。
  const loadAllTriedRef = useRef('');
  useEffect(() => {
    if (s.query !== '' && s.selection && s.messagesHasEarlier && !s.messagesLoading && !s.messagesLoadingMore) {
      const key = `${s.query}\u0000${s.selection.sessionId}\u0000${s.selection.projectHash}`;
      if (loadAllTriedRef.current === key) return;
      loadAllTriedRef.current = key;
      loadAllRef.current();
    }
  }, [s.query, s.selection, s.messagesHasEarlier, s.messagesLoading, s.messagesLoadingMore]);

  // 选中会话的 wire 形（含 archiveOnly/source/cwd，供 canResume 与 resume 发射）。搜索内容匹配占位卡不在
  // s.sessions（缺陷3）→ 从 s.searchResults 命中合成最小 wire 会话（source/archiveOnly 未知按 undefined，
  // canResume 靠消息 cwd 判定）；非搜索占位则退回 undefined。
  const selWire = s.selection
    ? (s.sessions.find((x) => x.sessionId === s.selection!.sessionId) ??
        synthSessionFromSearchHit(s.searchResults, s.selection.sessionId))
    : undefined;
  const messagesLoaded = !s.messagesLoading && s.messages.length > 0;
  // resume cwd（W12 三级）：会话 cwd 优先，退回任一消息 cwd，再退回所属项目 displayPath（选中会话在
  // s.projects 命中的项目根）。三级全空 → '' → canResume=false 按钮不显。
  const resumeCwd = (selWire?.cwd && selWire.cwd.trim() !== '' ? selWire.cwd : undefined) ??
    s.messages.find((m) => m.cwd && m.cwd.trim() !== '')?.cwd ??
    s.projects.find((p) => p.projectHash === s.selection?.projectHash)?.displayPath ??
    '';
  // resume source（M-1）：会话已知 source 优先；搜索占位卡 source 未知 → 从已加载消息 uuid 前缀推断
  // （codex- → codex），避免 codex 会话续聊错注入 CC harness。canResume 已保证消息已加载。
  const resumeSource = selWire?.source ?? inferSourceFromMessages(s.messages);
  // §7.7 live canResume（W12：去掉 !archiveOnly 拦截——native 回填闸已上线，archiveOnly 会话 resume 时
  // native 自动回填、失败 NSAlert+跳注入；★批2 裁决：超30天会话「继续聊天」按钮必须由此可达，不只双击）：
  // source∈{cc,codex}（缺席默认 cc，皆可 resume）且 cwd 非空（三级解析）且消息已加载。
  const canResume = !!selWire && messagesLoaded && resumeCwd !== '';

  // §7.6 noCC：CC 根缺失（ccDetected=false）且无任何数据（Codex 亦缺 → projects/sessions 皆空）。
  // 加载中不判（避免首屏闪 noCC）；noProjects（ccDetected=true 但空）沿屏内既有「暂无会话记录」。
  const noCC =
    !s.projectsLoading &&
    !s.sessionsLoading &&
    !s.ccDetected &&
    s.projects.length === 0 &&
    s.sessions.length === 0;

  // wire → screen（§7.1 映射表全量走 convert.ts）。
  const chatPayload = {
    banner: bannerVisible,
    archiveEnabled, // R7.3：读 ConfigSnapshot.archiveEnabled（无 config 快照前默认 true）；toggle 见 live.onToggleArchive
    selected: s.selection?.sessionId ?? null,
    selectedProjectHash: s.selectedProjectHash, // dogfood-r5 W-B：左栏高亮跟随 reducer（保活后不回落全部项目）
    detailPending: s.messagesLoading,
    expandToolCall: false, // live 工具块逐块展开由屏本地态管理（fixture flag 仅服务 golden）
    search: s.query !== '' ? { query: s.query, results: s.searchResults.map(searchHitToScreen) } : null,
    projects: s.projects.map(projectToScreen),
    sessions: s.sessions.map(sessionToScreen),
    messages: s.messages.map(messageToScreen),
  };

  const live: ChatHistoryLiveBundle = {
    onSelectProject: chat.selectProject,
    // 单击选中延迟 SELECT_CLICK_DELAY_MS 落地（缺陷 W9 防误触）；双击期内 onDoubleClickSession 会撤销。
    onSelectSession: (sessionId, projectHash) => {
      if (selectTimerRef.current !== null) clearTimeout(selectTimerRef.current);
      selectTimerRef.current = setTimeout(() => {
        selectTimerRef.current = null;
        chat.selectSession(sessionId, projectHash);
      }, SELECT_CLICK_DELAY_MS);
    },
    onDoubleClickSession: (sessionId) => {
      // 撤销 pending 单击选中（防误触）。
      if (selectTimerRef.current !== null) {
        clearTimeout(selectTimerRef.current);
        selectTimerRef.current = null;
      }
      const hit =
        s.sessions.find((x) => x.sessionId === sessionId) ??
        synthSessionFromSearchHit(s.searchResults, sessionId);
      // 双击会话 cwd：会话 cwd 优先；若正是选中会话则退回任一已加载消息 cwd（与 onResume 同口径）。
      const isSelected = s.selection?.sessionId === sessionId;
      const dblCwd =
        (hit?.cwd && hit.cwd.trim() !== '' ? hit.cwd : undefined) ??
        (isSelected ? s.messages.find((m) => m.cwd && m.cwd.trim() !== '')?.cwd : undefined) ??
        '';
      // 双击若走 chatResume：占位卡 source 未知 → 选中会话则从已加载消息推断（M-1，与 onResume 同口径）。
      const dblSource = hit?.source ?? (isSelected ? inferSourceFromMessages(s.messages) : undefined);
      const dblAction = pickDoubleClickAction(
        { sessionId },
        { cwd: dblCwd, source: dblSource, customTitle: hit?.customTitle },
        fx.terminals,
      );
      bridge.sendAction(dblAction);
      if (dblAction.kind === 'chatResume') {
        track('chat.session_restored', dblSource ? { agent: dblSource } : {});
      }
    },
    onBack: chat.backToList,
    onSearchInput: (q: string) => {
      chat.setQuery(q);
      // analytics.md L4 chat.searched：每次面板打开只发一次（首个非空输入）。
      if (q.trim() !== '' && !searchTrackedRef.current) {
        searchTrackedRef.current = true;
        track('chat.searched');
      }
    },
    onLoadMoreSessions: chat.loadMoreSessions,
    onLoadEarlierMessages: chat.loadEarlierMessages,
    onLoadAllMessages: chat.loadAllMessages, // W10 回到顶部（hasEarlier 时）触发全量
    onResume: () => {
      if (!selWire) return;
      bridge.sendAction(
        chatResumeAction({
          sessionId: selWire.sessionId,
          cwd: resumeCwd,
          source: resumeSource, // M-1：占位卡 source 未知时从已加载消息推断（codex- → codex）
          customTitle: selWire.customTitle,
        }),
      );
      track('chat.session_restored', resumeSource ? { agent: resumeSource } : {});
    },
    onClose: () => bridge.sendAction(chatCloseAction()),
    onDismissBanner: () => {
      setBannerVisible(false);
      try {
        localStorage.setItem(ARCHIVE_DISMISS_KEY, 'true');
      } catch {
        /* localStorage 不可用：仅本会话隐藏 */
      }
    },
    onToggleArchive, // R7.3：banner「自动归档」checkbox 切换（configApi 缺席则 undefined → 屏内 readOnly inert）

    onLearnMore: () => {
      // native-gap：暂无「外开 URL」桥动作（AppRequest 仅 selectDirectory，UIAction 无 openExternal）。
      // best-effort window.open——WKWebView 未实装 createWebViewWith 时静默无效，浏览器直开可用。
      // 正解 = 后续批加 native 外开动作（NSWorkspace.open）+ 协议 kind，届时改走桥。
      window.open(CLAUDE_CODE_URL, '_blank', 'noopener,noreferrer');
    },
    projectsLoading: s.projectsLoading,
    sessionsLoading: s.sessionsLoading,
    searchState: chat.searchState,
    canResume,
    hasEarlierMessages: s.messagesHasEarlier,
    sessionsLoadingMore: s.sessionsLoadingMore,
    messagesLoadingMore: s.messagesLoadingMore,
    syncStatus: s.syncStatus,
    lastSyncMs: s.lastSyncMs,
    syncProgress: showProgress ? prog : null,
    noCC,
    bannerText,

    // W8 右键菜单 / 内联重命名接线（屏读这些渲染 live-only UI）。
    onContextMenu: (sessionId, projectHash, x, y) => setMenu({ sessionId, projectHash, x, y }),
    renamingSessionId,
    onRenameCommit: (sessionId, title) => {
      const sess = s.sessions.find((x) => x.sessionId === sessionId);
      const prev = sess?.customTitle;
      const trimmed = title.trim();
      // 乐观 patch（空串=清除回默认 → customTitle undefined）；rejected/异常回滚到 prev。
      chat.patchSessionTitle(sessionId, trimmed === '' ? undefined : trimmed);
      setRenamingSessionId(null);
      void bridge
        .sendChatRequest({ kind: 'setTitle', sessionId, title: trimmed })
        .then((r) => {
          if (r.kind === 'rejected') chat.patchSessionTitle(sessionId, prev);
        })
        .catch(() => chat.patchSessionTitle(sessionId, prev));
    },
    onRenameCancel: () => setRenamingSessionId(null),

    // W11 整段复制为 Markdown。
    onCopyMarkdown: () => {
      void copyMarkdown();
    },
  };

  // fx.live 挂 bundle（fx 边界 any）：屏内读 fx.live 接交互 + 渲染 live-only UI；静态路径 fx.live undefined。
  const fxOut = { id: fx.id, screen: 'chat-history', theme: (fx as { theme?: string }).theme, chat: chatPayload, live };
  return (
    <>
      <ChatHistoryScreen fx={fxOut} />
      {menu && (
        <SessionContextMenu
          x={menu.x}
          y={menu.y}
          onRename={() => {
            setRenamingSessionId(menu.sessionId);
            setMenu(null);
          }}
          onExport={() => {
            void bridge.sendChatRequest({
              kind: 'export',
              projectHash: menu.projectHash,
              sessionId: menu.sessionId,
              format: 'markdown',
            });
            track('chat.exported', { format: 'markdown' });
            setMenu(null); // native 带 reveal in Finder；静默关菜单
          }}
          onDelete={() => {
            setDeleteTarget({ sessionId: menu.sessionId, projectHash: menu.projectHash });
            setDeleteError(null);
            setMenu(null);
          }}
          onClose={() => setMenu(null)}
        />
      )}
      {deleteTarget && (
        <DeleteConfirmModal
          error={deleteError}
          busy={deleting}
          onConfirm={confirmDelete}
          onCancel={() => {
            setDeleteTarget(null);
            setDeleteError(null);
          }}
        />
      )}
    </>
  );
}
