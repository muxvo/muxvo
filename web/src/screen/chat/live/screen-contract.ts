/**
 * ChatHistoryScreen 的 **live 接线契约**（chat-history.md §7）：容器（ChatHistoryLive）与屏（A4-2 的
 * ChatHistoryScreen）之间的 props 边界。**加性改造纪律**：`live` 缺席（截图/静态 registry 路径）时屏
 * 逐字节按 §0~§6 静态渲染（golden 不变）；`live` 存在（bridge 运行时）才接交互 + 渲染 live-only UI
 * （同步条 §7.5 / noCC 空态 §7.6 / 分页 §7.3）。
 *
 * 传递方式：容器把 `live` 挂在 `fx.live`（fx 边界是 `any`），屏内读 `const live: ChatHistoryLive | undefined
 * = fx.live`。故屏签名保持 `{ fx: any }` 不必改，静态路径 `fx.live` 天然 undefined。
 */

import type { ChatSyncStatus } from '../../../bridge/gen/protocol';
import type { SearchState } from './useChatData';

export interface ChatHistoryLive {
  // ── 交互（驱动 useChatData / 发射 ui.action）──
  /** 左栏点项目（null=全部项目）：CHAT_L1_16 过滤 + 清右栏。 */
  onSelectProject(projectHash: string | null): void;
  /** 中栏单击卡片：CHAT_L1_17/T07 载详情。projectHash 取该卡片会话/搜索命中的 hash。 */
  onSelectSession(sessionId: string, projectHash: string): void;
  /** 中栏双击卡片：CHAT_L1_18/T09 → chatJumpToTerminal + 关面板（native 无条件关）。 */
  onDoubleClickSession(sessionId: string, projectHash: string): void;
  /** 详情返回列表：CHAT_L1_19/T08，保持项目筛选。 */
  onBack(): void;
  /** 搜索输入（× 清空传 ''）：容器内部去抖 300ms。 */
  onSearchInput(query: string): void;
  /** 中栏触底哨兵：keyset 向下追加下一批（§7.3）。 */
  onLoadMoreSessions(): void;
  /** 右栏触顶哨兵：keyset 向上补更早（§7.3）。 */
  onLoadEarlierMessages(): void;
  /** W10 回到顶部（hasEarlier 时）/ W7 搜索全量：一次性全量加载当前会话消息（session all:true）。 */
  onLoadAllMessages?(): void;
  /** 右栏「继续聊天」：§7.7 → chatResume。 */
  onResume(): void;
  /** 关闭面板（关闭钮）：→ chatClose。Esc 由容器 document 监听兜底，屏无须重复接。 */
  onClose(): void;
  /** archive banner × 关闭：写 localStorage 并隐藏 banner。 */
  onDismissBanner(): void;
  /** R7.3 archive banner「自动归档」checkbox 切换：发 PrefsPatch{archiveEnabled}（缺席=无 configApi → 屏 readOnly inert）。 */
  onToggleArchive?(): void;
  /** §7.6 noCC 空态「了解 Claude Code」钮 onClick（best-effort 外开，见容器实现的 native-gap 注） */
  onLearnMore?(): void;

  // ── live 渲染态 ──
  /** 搜索四态（§7.4）：内容匹配节 spinner(Searching)/结果(HasResults)/空(NoResults)。 */
  searchState: SearchState;
  /** §2 左栏初始加载骨架旗标（projectsLoading 且空 → `.panel-skeleton`）。 */
  projectsLoading?: boolean;
  /** §3 中栏初始加载骨架旗标（sessionsLoading 且空 → 8 张骨架卡）。 */
  sessionsLoading?: boolean;
  /** §7.7 live canResume（含 `!archiveOnly`，比 §4 静态形多一条）：true 才显「继续聊天」。 */
  canResume: boolean;
  /** §7.3 右栏顶部：true=仍可上翻；false=渲染「— 已加载全部 —」。 */
  hasEarlierMessages: boolean;
  /** 中栏触底加载中（可选 spinner）。 */
  sessionsLoadingMore: boolean;
  /** 右栏触顶加载中（可选 spinner）。 */
  messagesLoadingMore: boolean;
  /** §7.5 同步条状态 + 最后同步时刻（ms，本地时区补零成 HH:MM）。 */
  syncStatus: ChatSyncStatus;
  lastSyncMs: number | null;
  /** W5 归档进度（首扫中/完成 hold 期非空）：同步条 syncing 段可附「synced/total」。null=无进度可显。 */
  syncProgress?: { synced: number; total: number } | null;
  /** §7.6 noCC 空态：CC + Codex 双缺 → 中栏渲染「未检测到 Claude Code 聊天记录…」。 */
  noCC: boolean;
  /** §7.6 archive banner 文案 prop（live 指向数据根 chat-history/，非冻结的 ~/.muxvo/chat-archive/）。 */
  bannerText: string;

  // ── W8 卡片右键菜单 / 内联重命名（均可选：静态路径不传 → 屏零 live-only 行为，golden 无感）──
  /** 卡片右键（onContextMenu）：容器据 clientX/Y 弹菜单。projectHash 取该卡真实值（删除契约铁律）。 */
  onContextMenu?(sessionId: string, projectHash: string, x: number, y: number): void;
  /** 正在内联重命名的会话 id（===某卡 → 该卡 title 位渲输入框）；null/缺席 = 无。 */
  renamingSessionId?: string | null;
  /** 内联重命名提交：title 空串 = 清除回默认（发 setTitle title:''）；容器乐观 patch + rejected 回滚。 */
  onRenameCommit?(sessionId: string, title: string): void;
  /** 内联重命名取消（Esc）：容器清 renamingSessionId。 */
  onRenameCancel?(): void;

  // ── W11 整段复制为 Markdown（详情头部 live-only 钮）──
  /** 「复制为 Markdown」：容器 hasEarlier 时先取全量再格式化进剪贴板，失败降级已加载段。 */
  onCopyMarkdown?(): void;
}
