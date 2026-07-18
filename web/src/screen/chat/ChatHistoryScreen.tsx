/**
 * 聊天历史三栏屏（specs/behavior/chat-history.md）。
 *
 * 双路径（签名恒为 `{ fx: any }`，与注册表/截图约定一致）：
 *  - **golden/截图/vitest 路径**：`fx.live` 天然 undefined → DOM 逐节点与 §0~§6 静态复刻一致
 *    （6 张 chat golden 逐字节冻结）；消息 markdown 走 chat-md-static；无任何 live-only 节点。
 *  - **M5 live 路径**：live 容器（chat/live/ChatHistoryLive）把 `ChatHistoryLive` bundle 挂 `fx.live`
 *    （接线契约见 chat/live/screen-contract.ts），屏读 `fx.live` 接交互 + 渲染 live-only UI（同步条 §7.5 /
 *    noCC 空态 §7.6 / 分页哨兵 §7.3 / 搜索四态 §7.4 / 逐块工具展开）。事件回调不进 SSR HTML、不改截图像素，
 *    live-only 可见节点一律 gate 在 `live` 之后。live 消息 markdown 经**动态 import** chat-md-live 真渲染
 *    （截图 bundle 零感知：静态路径不 import）。
 *
 * 三栏宽度走 chat.css（220/340/flex:1，CHAT_L1_09）；卡片时间依 capture 冻结时钟；user 气泡右对齐 #3b82f6、
 * assistant 左对齐 bg-elevated（CHAT_L1_11）；空态实渲染文案「暂无会话记录」（CHAT_L1_15，Tier-B 见 §0）。
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { renderChatMarkdown } from './chat-md-static';
import { classifySystemMessage, SystemFoldBlock, ThinkingBlock, UnknownBlock } from './chat-detail-blocks';
import type { ChatHistoryLive } from './live/screen-contract';
import { clampIdx, enumerateMatches, matchKey } from './live/matchNav';
import '../panels/panels.css'; // .source-badge / .search-input-wrap 共享段
import './chat.css';

// ── payload 形状（tools/visual-diff/fixtures/_CONTRACT.md B5 段；live 侧 convert.ts 产同构形） ──

interface ChatProject {
  projectHash: string;
  displayPath: string;
  displayName: string;
  sessionCount: number;
  totalSize: number;
  lastActivity: string;
  source?: string;
}

interface ChatSession {
  sessionId: string;
  projectHash: string;
  title: string;
  startedAt: string;
  lastModified: string | number; // fixture ISO；占位卡合成后为 ms
  fileSize: number;
  source?: string;
  customTitle?: string;
  cwd?: string;
  worktreeLabel?: string;
}

interface ChatContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'image' | 'thinking' | 'unknown';
  text?: string;
  name?: string;
  input?: unknown;
  content?: unknown;
}

interface ChatMessage {
  uuid: string;
  type: 'user' | 'assistant' | 'system';
  sessionId: string;
  cwd: string;
  timestamp: string;
  content: string | ChatContentBlock[];
}

interface ChatPayload {
  banner: boolean;
  archiveEnabled?: boolean;
  selected: string | null;
  /** dogfood-r5 W-B：左栏当前选中项目 hash（null/缺省=全部项目）。live 透传 reducer 的 selectedProjectHash 令
   *  高亮跟随（保活后不回落全部项目）；fixture/golden 缺省 undefined → 「全部项目」恒选中，静态 DOM 字节不变。 */
  selectedProjectHash?: string | null;
  detailPending?: boolean;
  expandToolCall?: boolean;
  search?: { query: string; results: { projectHash: string; sessionId: string; snippet: string; timestamp: string }[] } | null;
  projects: ChatProject[];
  sessions: ChatSession[];
  messages: ChatMessage[];
}

/**
 * 屏消费的 live bundle = `ChatHistoryLive`（screen-contract.ts 单一真相，字段漂移由 tsc 兜）。
 * 含 §2/§3 初始加载骨架旗标（projectsLoading?/sessionsLoading?）与 §7.6 noCC「了解 Claude Code」钮
 * 回调（onLearnMore?）——均可选，容器缺省不 populate 时优雅降级（不渲染骨架 / 钮无 onClick）。
 */
type LiveBundle = ChatHistoryLive;

/** W6：可选 `highlight`（搜索 query）——live 渲染器（chat-md-live）据此包 `<mark class="search-highlight">`；
 *  静态渲染器（chat-md-static）签名只用 text，JS 忽略多余实参 → golden 路径零变化。 */
type MarkdownRenderer = (text: string, highlight?: string) => ReactNode;

// ── 纯函数（legacy 同构，specs/behavior/chat-history.md §2/§3） ──

/** ProjectList.tsx:22-29 同构：projectHash → 固定 hsl 圆点色 */
export function hashColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 65%, 55%)`;
}

/** ProjectList.tsx:31-36 同构（1024 进制，一位小数去 .0，含 GB 档） */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace(/\.0$/, '')}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1).replace(/\.0$/, '')}GB`;
}

/** SessionList.tsx:79-83 同构（卡片 fileSize，无 GB 档） */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace(/\.0$/, '')}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')}MB`;
}

/** SessionList.tsx:52-73 同构：今天 HH:MM / 昨天 HH:MM / MM-DD HH:MM（本地时区，24h 补零）。
 *  now 可注入供测试；组件内缺省 new Date()（capture 冻结时钟钉死）。 */
export function formatTime(timestamp: number, now: Date = new Date()): string {
  const date = new Date(timestamp);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const time = `${hours}:${minutes}`;

  if (dateOnly.getTime() === today.getTime()) return `今天 ${time}`;
  if (dateOnly.getTime() === yesterday.getTime()) return `昨天 ${time}`;
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}-${day} ${time}`;
}

/** 同步条 HH:MM（本地时区补零，CHAT_L1_13 §7.5） */
function formatHHMM(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** SessionList.tsx:88-106 同构：title 关键词 → 彩 tag。--info/--purple web theme 无此 var，
 *  取 legacy 计算值字面量（#60a5fa/#a78bfa，panels.css 先例） */
export function extractTags(title: string): { label: string; color: string }[] {
  const tags: { label: string; color: string }[] = [];
  const lower = title.toLowerCase();
  if (lower.includes('feat') || lower.includes('feature')) tags.push({ label: 'feat', color: 'var(--success)' });
  if (lower.includes('fix') || lower.includes('bug')) tags.push({ label: 'fix', color: 'var(--error)' });
  if (lower.includes('refactor')) tags.push({ label: 'refactor', color: '#60a5fa' });
  if (lower.includes('plan')) tags.push({ label: 'plan', color: '#a78bfa' });
  return tags;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** SearchInput.tsx HighlightText 同构：命中片段包 mark.search-highlight */
function Highlight({ text, query }: { text: string; query: string }): JSX.Element {
  if (!query) return <>{text}</>;
  const parts = text.split(new RegExp(`(${escapeRegex(query)})`, 'gi'));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <mark key={i} className="search-highlight">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

const lastModifiedMs = (s: ChatSession): number =>
  typeof s.lastModified === 'number' ? s.lastModified : Date.parse(s.lastModified);

// ── 内联重命名输入（W8，live-only：SessionCard 在 renaming 时以此替换 title span）──

/** 预填 customTitle||title、autoFocus+全选、Enter/blur 提交、Esc 取消、空串=清除回默认。doneRef 防 Enter+blur 双提交。 */
function RenameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit(value: string): void;
  onCancel(): void;
}): JSX.Element {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef(false);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  const commit = (): void => {
    if (doneRef.current) return;
    doneRef.current = true;
    onCommit(value);
  };
  const cancel = (): void => {
    if (doneRef.current) return;
    doneRef.current = true;
    onCancel();
  };
  return (
    <input
      ref={inputRef}
      className="session-card__rename-input"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation(); // 不冒泡到容器 Esc（防面板关闭）
          cancel();
        }
      }}
      onBlur={commit}
    />
  );
}

// ── 中栏卡片 ──

function SessionCard({
  session,
  selected,
  query,
  snippet,
  projectName,
  onSelect,
  onJump,
  onContextMenu,
  renaming,
  onRenameCommit,
  onRenameCancel,
}: {
  session: ChatSession;
  selected: boolean;
  query: string;
  snippet?: string;
  projectName?: string;
  onSelect?: () => void;
  onJump?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  renaming?: boolean;
  onRenameCommit?: (title: string) => void;
  onRenameCancel?: () => void;
}): JSX.Element {
  const displayTitle = session.customTitle || session.title;
  const wtPrefix = session.worktreeLabel ? `[${session.worktreeLabel}] ` : '';
  const title = (wtPrefix + displayTitle).slice(0, 50);
  const rawPreview = session.title.slice(0, 100);
  const preview =
    query && snippet && !rawPreview.toLowerCase().includes(query.toLowerCase())
      ? snippet.slice(0, 100)
      : rawPreview;
  const time = formatTime(lastModifiedMs(session));
  const tags = extractTags(session.title);

  return (
    <div
      className={`session-card ${selected ? 'session-card--selected' : ''}`}
      onClick={onSelect}
      onDoubleClick={onJump}
      onContextMenu={onContextMenu}
    >
      <div className="session-card__header">
        {renaming && onRenameCommit && onRenameCancel ? (
          <RenameInput
            initial={session.customTitle || session.title}
            onCommit={onRenameCommit}
            onCancel={onRenameCancel}
          />
        ) : (
          <span className="session-card__title" title={session.title}>
            {query ? <Highlight text={title} query={query} /> : title}
          </span>
        )}
        <span className="session-card__time">{time}</span>
      </div>

      <div className="session-card__preview">
        {query ? <Highlight text={preview} query={query} /> : preview}
      </div>

      <div className="session-card__footer">
        <div className="session-card__tags">
          {session.source === 'codex' && <span className="source-badge source-badge--cx">CX</span>}
          {session.source === 'claude-code' && <span className="source-badge source-badge--cc">CC</span>}
          {session.source === 'gemini' && <span className="source-badge source-badge--gm">GM</span>}
          {projectName != null && (
            <span className="session-card__project-badge">{projectName}</span>
          )}
          {tags.map((tag) => (
            <span key={tag.label} className="session-card__tag" style={{ background: tag.color }}>
              {tag.label}
            </span>
          ))}
        </div>
        <span className="session-card__count">
          {session.fileSize > 0 ? formatFileSize(session.fileSize) : ''}
        </span>
      </div>
    </div>
  );
}

// ── 右栏消息 ──

function ToolCallBlock({
  name,
  input,
  expanded,
  onToggle,
  render,
}: {
  name?: string;
  input?: unknown;
  expanded: boolean;
  onToggle?: () => void;
  render: MarkdownRenderer;
}): JSX.Element {
  return (
    <div className="tool-call-block">
      <div className="tool-call-block__header" onClick={onToggle}>
        <span className="tool-call-block__icon">{expanded ? '▼' : '▶'}</span>
        <span className="tool-call-block__label">Tool Call{name ? `: ${name}` : ''}</span>
      </div>
      {expanded && (
        <div className="tool-call-block__content">
          {typeof input === 'object' && input !== null && !Array.isArray(input) ? (
            Object.entries(input as Record<string, unknown>).map(([key, val]) => (
              <div key={key} className="tool-call-block__field">
                <div className="tool-call-block__field-key">{key}</div>
                {typeof val === 'string' ? (
                  <div className="markdown-preview">{render(val)}</div>
                ) : (
                  <pre className="tool-call-block__field-val">{JSON.stringify(val, null, 2)}</pre>
                )}
              </div>
            ))
          ) : typeof input === 'string' ? (
            <div className="markdown-preview">{render(input)}</div>
          ) : (
            <pre className="tool-call-block__content">{JSON.stringify(input, null, 2)}</pre>
          )}
        </div>
      )}
    </div>
  );
}

function renderBlock(
  block: ChatContentBlock,
  index: number,
  opts: { expanded: boolean; onToggle?: () => void; render: MarkdownRenderer; highlight?: string },
): ReactNode {
  switch (block.type) {
    case 'text':
      // 仅 text 块传 highlight（工具块调 render 不传 → 无 mark，保 DOM mark 数=枚举命中数，W6）。
      return (
        <div key={index} className="markdown-preview">
          {opts.render(block.text || '', opts.highlight)}
        </div>
      );
    case 'tool_use':
      return (
        <ToolCallBlock
          key={index}
          name={block.name}
          input={block.input}
          expanded={opts.expanded}
          onToggle={opts.onToggle}
          render={opts.render}
        />
      );
    case 'tool_result':
      return (
        <div key={index} className="tool-result-block">
          <div className="tool-result-block__header" onClick={opts.onToggle}>
            <span className="tool-result-block__icon">{opts.expanded ? '▼' : '▶'}</span>
            <span className="tool-result-block__label">Tool Result</span>
          </div>
          {opts.expanded && (
            <div className="tool-result-block__content">
              {typeof block.content === 'string' ? (
                <div className="markdown-preview">{opts.render(block.content)}</div>
              ) : (
                <pre className="tool-result-block__field-val">{JSON.stringify(block.content, null, 2)}</pre>
              )}
            </div>
          )}
        </div>
      );
    case 'image':
      // §4：image → `.image-block img`（data-URI，max-height 400）。convert.ts 把 wire dataUri 落 block.content。
      // golden 无 image 样本（fixture 零 image 块）→ 此支纯 live 路径，对既有 6 张 chat golden 零影响。
      return typeof block.content === 'string' && block.content ? (
        <div key={index} className="image-block">
          <img src={block.content} alt="" />
        </div>
      ) : null;
    case 'thinking':
      // 问题4：思考块折叠（展开体走 markdown）。thinking 不入搜索文本口径（enumerateMatches 只计 text 块）
      // → render 不传 highlight，保「DOM mark 数=枚举命中数」不变量（W6）。
      return (
        <ThinkingBlock
          key={index}
          text={block.text || ''}
          expanded={opts.expanded}
          onToggle={opts.onToggle}
          render={opts.render}
        />
      );
    case 'unknown':
      // 问题4 根因2：未知块占位（展开体 <pre> 原文，不再裸 dump 进正文）。name=块类型、content=原文 JSON。
      return (
        <UnknownBlock
          key={index}
          name={block.name || 'unknown'}
          raw={typeof block.content === 'string' ? block.content : ''}
          expanded={opts.expanded}
          onToggle={opts.onToggle}
        />
      );
    default:
      return null;
  }
}

function MessageBubble({
  message,
  index,
  expandToolCall,
  isLive,
  render,
  highlight,
}: {
  message: ChatMessage;
  /** 在渲染 messages 数组中的下标（W6 命中导航按 data-msg-idx 定位；仅 live 落属性）。 */
  index: number;
  expandToolCall: boolean;
  isLive: boolean;
  render: MarkdownRenderer;
  /** W6 搜索 query（live&&search 时非空）：字符串正文经 Highlight、text 块经 render 高亮；工具块不高亮。 */
  highlight?: string;
}): JSX.Element {
  const isUser = message.type === 'user';
  const isSystem = message.type === 'system';
  const bubbleClass = isUser
    ? 'message-bubble--user'
    : isSystem
      ? 'message-bubble--system'
      : 'message-bubble--assistant';
  const label = isUser
    ? 'YOU'
    : isSystem
      ? 'SYSTEM'
      : message.uuid.startsWith('codex-')
        ? 'CODEX'
        : message.uuid.startsWith('gemini-')
          ? 'GEMINI'
          : 'CLAUDE';
  const blocks = Array.isArray(message.content) ? message.content : null;
  const firstToolUseIdx = blocks ? blocks.findIndex((b) => b.type === 'tool_use') : -1;

  // live 时工具块展开走 per-block 本地态（默认全折叠，§4；A4-1 明确逐块展开由屏本地态管理）；
  // 无 live 维持 expandToolCall 语义（golden 路径原样：仅首个 tool_use 按 fixture flag 展开）。
  const [expandedMap, setExpandedMap] = useState<Record<number, boolean>>({});
  const isExpanded = (i: number, type: ChatContentBlock['type']): boolean =>
    isLive ? !!expandedMap[i] : expandToolCall && type === 'tool_use' && i === firstToolUseIdx;
  const toggle = (i: number): void => setExpandedMap((prev) => ({ ...prev, [i]: !prev[i] }));

  // 问题4：live 的 system 字符串消息 → 折叠壳（转写降噪）。消息级独立展开态（初值 = 分类默认态：
  // 队友消息默认展开、其余噪声折叠）；搜索命中该条正文时强制展开，保「DOM mark 数=枚举命中数」不变量（W6）。
  // 静态/golden 路径（isLive=false）不进此分支，system 仍逐字节渲 .message-bubble__text（冻结不变）。
  const systemFold = isLive && isSystem && typeof message.content === 'string';
  const classified = systemFold ? classifySystemMessage(message.content as string) : null;
  const [sysExpanded, setSysExpanded] = useState(classified?.defaultExpanded ?? false);
  const searchForced =
    systemFold && !!highlight && (message.content as string).toLowerCase().includes(highlight.toLowerCase());

  const stringContent = message.content as string;
  return (
    <div className={`message-bubble ${bubbleClass}`} data-msg-idx={isLive ? index : undefined}>
      {/* 折叠壳自带 SYSTEM 头，不再重复外层 label（避免双 SYSTEM）。 */}
      {!systemFold && <div className="message-bubble__label">{label}</div>}
      <div className="message-bubble__content">
        {systemFold ? (
          <SystemFoldBlock
            content={stringContent}
            label={classified!.label}
            expanded={sysExpanded || searchForced}
            onToggle={() => setSysExpanded((e) => !e)}
            highlight={highlight}
          />
        ) : blocks ? (
          blocks.map((b, i) =>
            renderBlock(b, i, {
              expanded: isExpanded(i, b.type),
              onToggle:
                isLive && (b.type === 'tool_use' || b.type === 'tool_result' || b.type === 'thinking' || b.type === 'unknown')
                  ? () => toggle(i)
                  : undefined,
              render,
              highlight,
            }),
          )
        ) : (
          <div className="message-bubble__text">
            {highlight ? <Highlight text={stringContent} query={highlight} /> : stringContent}
          </div>
        )}
      </div>
      <div className="message-bubble__meta">{new Date(message.timestamp).toLocaleTimeString()}</div>
    </div>
  );
}

function DetailSkeleton(): JSX.Element {
  return (
    <div className="session-detail__skeleton">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className={`skeleton-bubble ${i % 2 === 0 ? 'skeleton-bubble--right' : 'skeleton-bubble--left'}`}>
          <div className="skeleton-bubble__label" />
          <div className="skeleton-bubble__content" />
          <div className="skeleton-bubble__meta" />
        </div>
      ))}
    </div>
  );
}

// ── live-only 增量组件（缺省 live 时一律不渲染 → golden 无感） ──

/** 左栏项目加载骨架（§2，projectsLoading 且空） */
function ProjectsSkeleton(): JSX.Element {
  return (
    <div className="panel-skeleton panel-skeleton--projects">
      <div className="panel-skeleton__header" />
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="panel-skeleton__row">
          <div className="panel-skeleton__dot" />
          <div className="panel-skeleton__text" />
          <div className="panel-skeleton__badge" />
        </div>
      ))}
    </div>
  );
}

/** 骨架卡（§3，中栏会话加载 + 搜索内容匹配 searching 共用形） */
function SkeletonCard(): JSX.Element {
  return (
    <div className="panel-skeleton__card">
      <div className="panel-skeleton__card-title" />
      <div className="panel-skeleton__card-preview" />
      <div className="panel-skeleton__card-footer" />
    </div>
  );
}

/** 中栏会话加载骨架（§3，sessionsLoading 且空）：8 张骨架卡 */
function SessionsSkeleton(): JSX.Element {
  return (
    <div className="panel-skeleton panel-skeleton--sessions">
      {Array.from({ length: 8 }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

/** 同步条（§7.5，CHAT_L1_13 翻牌）：面板底部新增 DOM，不动既有列。W5：syncing 段附归档进度（synced/total）。 */
function SyncBar({
  status,
  lastSyncMs,
  progress,
}: {
  status: ChatHistoryLive['syncStatus'];
  lastSyncMs: number | null;
  progress?: { synced: number; total: number } | null;
}): JSX.Element {
  const text =
    status === 'syncing'
      ? progress
        ? `Muxvo 镜像 · 正在归档 ${progress.synced}/${progress.total}…`
        : 'Muxvo 镜像 · 同步中…'
      : status === 'error'
        ? 'Muxvo 镜像 · 同步暂停'
        : `Muxvo 镜像 · 最后同步 ${lastSyncMs != null ? formatHHMM(lastSyncMs) : '--:--'}`;
  return (
    <div className={`chat-history__sync-bar chat-history__sync-bar--${status}`}>
      {status === 'syncing' && <span className="chat-history__sync-spinner" aria-hidden="true" />}
      <span className="chat-history__sync-text">{text}</span>
    </div>
  );
}

/** noCC 空态气泡图标（§7.6 / CHAT_L1_14「dialog bubble」） */
function ChatBubbleIcon(): JSX.Element {
  return (
    <svg
      className="chat-nocc__icon"
      width="40"
      height="40"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v8A1.5 1.5 0 0 1 18.5 15H9l-4 4V5.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** noCC 空态（§7.6 / CHAT_L1_14）：CC + Codex 双缺 */
function NoCCEmptyState({ onLearnMore }: { onLearnMore?: () => void }): JSX.Element {
  return (
    <div className="chat-nocc">
      <ChatBubbleIcon />
      <div className="chat-nocc__text">未检测到 Claude Code 聊天记录，请先安装并使用 Claude Code。</div>
      <button className="chat-nocc__btn" onClick={onLearnMore}>
        了解 Claude Code
      </button>
    </div>
  );
}

/** SessionDetail.tsx:463-467 逐字复刻的 resume 图标 */
function ResumeIcon(): JSX.Element {
  return (
    <svg className="session-detail__resume-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M2 2.5C2 1.67 2 1.25 2.17 1.05C2.32 0.88 2.54 0.79 2.76 0.82C3.02 0.85 3.31 1.15 3.9 1.74L7.1 4.94C7.55 5.39 7.77 5.62 7.85 5.88C7.93 6.11 7.93 6.36 7.85 6.59C7.77 6.85 7.55 7.08 7.1 7.53L3.9 10.73C3.31 11.32 3.02 11.62 2.76 11.65C2.54 11.68 2.32 11.59 2.17 11.42C2 11.22 2 10.8 2 9.97V2.5Z" fill="currentColor" />
      <path d="M9 2.5C9 1.67 9 1.25 9.17 1.05C9.32 0.88 9.54 0.79 9.76 0.82C10.02 0.85 10.31 1.15 10.9 1.74L14.1 4.94C14.55 5.39 14.77 5.62 14.85 5.88C14.93 6.11 14.93 6.36 14.85 6.59C14.77 6.85 14.55 7.08 14.1 7.53L10.9 10.73C10.31 11.32 10.02 11.62 9.76 11.65C9.54 11.68 9.32 11.59 9.17 11.42C9 11.22 9 10.8 9 9.97V2.5Z" fill="currentColor" />
      <rect x="2" y="13" width="12" height="2" rx="1" fill="currentColor" />
    </svg>
  );
}

// ── 右栏滚动行为（§7.2 auto-scroll / §7.3 prepend 补偿；**仅 live 路径**挂载） ──

/** 视口距底 ≤ 此像素视为「贴底」——尾部追加时才自动滚底（§7.2 上翻保护阈值）。 */
const BOTTOM_THRESHOLD_PX = 32;

/**
 * 右栏消息列表滚动控制器（chat-history.md §7.2/§7.3）：返回 null、零 DOM，只对 `scrollerRef` 指向的
 * `.session-detail__scroller` 做命令式滚动。**gate 在 isLive**——golden/截图/SSR 路径不挂载本组件
 * （既有 6 张 chat golden 与静态 registry 零感知，亦不触 react-dom/server 的 useLayoutEffect 告警）。
 *
 * 三类消息数组变化（按 uuid 头尾+长度判别，与 useChatData 的 append/prepend dedup 同源）：
 *  - **初次载入 / 切会话**（prevLen 0 或 selected 变）：贴底显示最新（REQ-CHAT_BROWSE-018 首屏最近 50）。
 *  - **§7.3 向上 prepend 更早消息**（首 uuid 变、尾 uuid 不变、变长）：scrollTop += 上方新增高度，锚点不跳。
 *  - **§7.2 尾部追加**（尾 uuid 变、首 uuid 不变、变长；REQ-CHAT_BROWSE-029）：**贴底才**自动滚底；
 *    用户正上翻阅历史（非贴底）→ 追加但不拉底（异常分支）。
 * 「上方新增高度」= 本次 scrollHeight − 上次 scrollHeight（prepend/哨兵→已加载全部 的高度增减均在锚点之上，
 * 差值恰为锚点位移量）；贴底态由 scroll 监听在用户滚动时更新（内容追加本身不触发 scroll 事件）。
 */
function MessageScrollController({
  scrollerRef,
  messages,
  selected,
  suppressBottom,
}: {
  scrollerRef: React.RefObject<HTMLDivElement>;
  messages: ChatMessage[];
  selected: string | null;
  /** W6/R1.8：搜索且有命中时抑制「切会话/追加→贴底」，由 MatchNavController 定位首命中；prepend 补偿仍生效。 */
  suppressBottom: boolean;
}): null {
  const atBottomRef = useRef(true);
  const prevFirstRef = useRef<string | null>(null);
  const prevLastRef = useRef<string | null>(null);
  const prevLenRef = useRef(0);
  const prevSelectedRef = useRef<string | null>(null);
  const prevScrollHeightRef = useRef(0);

  // 用户滚动时更新「贴底」态（passive）；内容追加不触发 scroll，故此值保留追加前的最后一次用户意图。
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = (): void => {
      atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_THRESHOLD_PX;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [scrollerRef]);

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;

    const curFirst = messages.length ? messages[0].uuid : null;
    const curLast = messages.length ? messages[messages.length - 1].uuid : null;
    const curLen = messages.length;
    const selChanged = selected !== prevSelectedRef.current;
    const prevFirst = prevFirstRef.current;
    const prevLast = prevLastRef.current;
    const prevLen = prevLenRef.current;
    const prevScrollHeight = prevScrollHeightRef.current;

    if (curLen === 0) {
      // 无消息（scroller 通常不渲染）：仅同步 refs。
    } else if (selChanged || prevLen === 0) {
      // 初次载入 / 切会话：贴底显示最新（搜索有命中时抑制——由 MatchNavController 定位首命中，R1.8）。
      if (!suppressBottom) {
        el.scrollTop = el.scrollHeight;
        atBottomRef.current = true;
      }
    } else if (curLen > prevLen && curFirst !== prevFirst && curLast === prevLast) {
      // §7.3 prepend 补偿：视口锚点保持不跳（搜索全量加载亦走此支，锚点不动 → 命中定位/回顶另行接管）。
      el.scrollTop = el.scrollTop + (el.scrollHeight - prevScrollHeight);
    } else if (curLen > prevLen && curLast !== prevLast && curFirst === prevFirst) {
      // §7.2 尾部追加：贴底才自动滚底；上翻阅历史不打断（搜索有命中时不打断命中定位）。
      if (!suppressBottom && atBottomRef.current) el.scrollTop = el.scrollHeight;
    }

    prevFirstRef.current = curFirst;
    prevLastRef.current = curLast;
    prevLenRef.current = curLen;
    prevSelectedRef.current = selected;
    prevScrollHeightRef.current = el.scrollHeight;
  });

  return null;
}

/**
 * W6 命中导航控制器（legacy SessionDetail.tsx:334-372 同构）：返回 null、零 DOM，只做命令式高亮切换 + 滚动。
 * **gate 在 isLive**（golden/SSR 不挂载）。currentMatchIdx 变（或 matches 变）：
 *  1. 清全部旧 `mark.search-highlight--active`；
 *  2. 定位 `[data-msg-idx=match.msgIdx]` 气泡内第 `nthInMsg` 个 `mark.search-highlight` → 加 active + scrollIntoView(center)；
 *  3. 快路径未命中（消息/mark 尚未渲染）→ rAF 轮询 ≤5 次重试（R1.10）。
 * currentMatchIdx=0 的重置由 Screen 侧 matchKey 变化 effect 承担（R1.19）。
 */
function MatchNavController({
  scrollerRef,
  navKey,
  targetMsgIdx,
  targetNth,
}: {
  scrollerRef: React.RefObject<HTMLDivElement>;
  /** 命中会话+查询组合键（matchKey）：变即重定位。 */
  navKey: string;
  /** 当前命中所在气泡 data-msg-idx（无命中 = -1）。 */
  targetMsgIdx: number;
  /** 该气泡内第几个 mark（无命中 = -1）。 */
  targetNth: number;
}): null {
  // **依赖为稳定标量（navKey + 目标坐标）**——只在命中真变（导航 ▲▼/Enter、换词、换会话、全量重排命中位置）时
  // 清高亮 + scrollIntoView（对抗回修 M-4）。matches 数组每父渲染换新身份（Live 层 messageToScreen 重映射）
  // 不再触发滚动：非导航重渲染（右键开菜单 setMenu / 推送 bump 卡片 / banner hold 翻转 / 归档进度帧）不再把
  // 视口拽回命中。active 类由 React 跨无关重渲染自然保留（className/__html prop 未变→DOM 不重写），无需每渲染重加。
  useEffect(() => {
    const scroller = scrollerRef.current;
    const scope: ParentNode = scroller ?? document;
    scope.querySelectorAll('mark.search-highlight--active').forEach((el) => el.classList.remove('search-highlight--active'));

    if (targetMsgIdx < 0) return;

    const activateAndScroll = (): boolean => {
      const bubble = scope.querySelector(`[data-msg-idx="${targetMsgIdx}"]`);
      if (!bubble) return false;
      const target = bubble.querySelectorAll('mark.search-highlight')[targetNth] as HTMLElement | undefined;
      if (!target) return false;
      target.classList.add('search-highlight--active');
      target.scrollIntoView({ block: 'center', behavior: 'auto' });
      return true;
    };

    if (activateAndScroll()) return;
    // 慢路径：目标 mark 尚未在 DOM（异步 markdown 渲染 / 刚全量加载）→ rAF 轮询重试。
    let retries = 5;
    let raf = requestAnimationFrame(function poll() {
      if (activateAndScroll()) return;
      if (--retries > 0) raf = requestAnimationFrame(poll);
    });
    return () => cancelAnimationFrame(raf);
  }, [scrollerRef, navKey, targetMsgIdx, targetNth]);

  return null;
}

/**
 * W10 回到顶部浮钮（R4.1，live-only）：滚动区 scrollTop > 2×clientHeight 时淡入。点击：
 *  - hasEarlier=false（含搜索态已全量）→ 直接 scrollTop=0；
 *  - hasEarlier=true → onLoadAllMessages() + pending，全量渲染（hasEarlier 落 false）后置顶，等待期显 spinner。
 * 不做逐段懒加载（哨兵连环触发滚动跳动）。
 */
function BackToTopControl({
  scrollerRef,
  hasEarlier,
  onLoadAllMessages,
  messagesLen,
  loadingMore,
}: {
  scrollerRef: React.RefObject<HTMLDivElement>;
  hasEarlier: boolean;
  onLoadAllMessages?: () => void;
  messagesLen: number;
  loadingMore?: boolean;
}): JSX.Element | null {
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);
  // V-2（批3 裁决顺修）：全量请求被 rejected → loadingMore true→false 边沿而 hasEarlier 未落 false →
  // 复位本地 pending（spinner 不永转，且防换卡后误触一次置顶）。成功路径 hasEarlier 落 false 走下方效果。
  const wasLoadingRef = useRef(false);
  useEffect(() => {
    if (wasLoadingRef.current && !loadingMore && pending && hasEarlier) setPending(false);
    wasLoadingRef.current = !!loadingMore;
  }, [loadingMore, pending, hasEarlier]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = (): void => setVisible(el.scrollTop > 2 * el.clientHeight);
    el.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener('scroll', onScroll);
  }, [scrollerRef, messagesLen]);

  // 全量加载完成（hasEarlier 落 false）后置顶并落 pending。
  useEffect(() => {
    if (!pending || hasEarlier) return;
    const el = scrollerRef.current;
    if (el) el.scrollTop = 0;
    setPending(false);
    setVisible(false);
  }, [pending, hasEarlier, messagesLen, scrollerRef]);

  if (!visible && !pending) return null;

  const onClick = (): void => {
    const el = scrollerRef.current;
    if (hasEarlier && onLoadAllMessages) {
      setPending(true);
      onLoadAllMessages();
    } else if (el) {
      el.scrollTop = 0;
      setVisible(false);
    }
  };

  return (
    <button
      className={`session-detail__back-to-top${pending ? ' session-detail__back-to-top--busy' : ''}`}
      onClick={onClick}
      title="回到顶部"
      aria-label="回到顶部"
      disabled={pending}
    >
      {pending ? <span className="chat-mini-spinner" aria-hidden="true" /> : '↑'}
    </button>
  );
}

// ── 屏组件 ──

export function ChatHistoryScreen({ fx }: { fx: any }): JSX.Element {
  const c: ChatPayload = fx.chat;
  const live: LiveBundle | undefined = fx.live;
  const isLive = !!live;
  const query = c.search?.query?.trim() ?? '';
  const isSearch = query !== '';
  // §7.4 searching：live 且 searchState==='Searching' → 内容匹配节挂 spinner + 骨架卡（golden 无此态）。
  const searching = isLive && live!.searchState === 'Searching';

  // ── live markdown 真渲染（动态 import chat-md-live；静态路径不 import → 截图 bundle 零感知） ──
  const [liveRender, setLiveRender] = useState<MarkdownRenderer | null>(null);
  useEffect(() => {
    if (!isLive) return;
    let cancelled = false;
    void import('./chat-md-live').then((m) => {
      if (!cancelled) setLiveRender(() => m.renderChatMarkdownLive);
    });
    return () => {
      cancelled = true;
    };
  }, [isLive]);
  const render: MarkdownRenderer = isLive && liveRender ? liveRender : renderChatMarkdown;

  // 项目名映射（「全部项目」视图恒显项目徽记，ChatHistoryPanel showProjectName 同构）
  const projectNameMap = new Map(c.projects.map((p) => [p.projectHash, p.displayName]));
  const totalSize = c.projects.reduce((sum, p) => sum + (p.totalSize || 0), 0);

  const sortedSessions = [...c.sessions].sort((a, b) => lastModifiedMs(b) - lastModifiedMs(a));

  // 搜索态派生（ChatHistoryPanel.tsx:144-198 同构）
  const snippets = new Map((c.search?.results ?? []).map((r) => [r.sessionId, r.snippet]));
  const titleMatched = isSearch
    ? sortedSessions.filter(
        (s) =>
          s.title.toLowerCase().includes(query.toLowerCase()) ||
          (s.customTitle && s.customTitle.toLowerCase().includes(query.toLowerCase())),
      )
    : [];
  const titleIds = new Set(titleMatched.map((s) => s.sessionId));
  const contentMatched: ChatSession[] = [];
  if (isSearch) {
    const seen = new Set<string>();
    for (const r of c.search!.results) {
      if (titleIds.has(r.sessionId) || seen.has(r.sessionId)) continue;
      seen.add(r.sessionId);
      const loaded = c.sessions.find((s) => s.sessionId === r.sessionId);
      if (loaded) {
        contentMatched.push(loaded);
      } else {
        const cleanSnippet = r.snippet.replace(/\s+/g, ' ').trim();
        contentMatched.push({
          sessionId: r.sessionId,
          projectHash: r.projectHash,
          title: cleanSnippet.slice(0, 60) || r.sessionId.slice(0, 8),
          startedAt: r.timestamp,
          lastModified: r.timestamp ? Date.parse(r.timestamp) : 0,
          fileSize: -1,
          source: 'claude-code',
        });
      }
    }
    contentMatched.sort((a, b) => lastModifiedMs(b) - lastModifiedMs(a));
  }
  const totalCount = titleMatched.length + contentMatched.length;

  // 右栏派生。canResume：live 用 bundle（含 !archiveOnly，§7.7）；无 live 走 §4 静态判据（golden 同构）。
  // sel 兜底（缺陷3）：内容匹配占位卡未并入 c.sessions（本地 contentMatched 合成），c.sessions 查不到时
  // 退回 contentMatched 命中 → 占位卡可点开右栏详情。golden 安全：搜索屏 selected 恒 null（兜底不触发），
  // 非搜索屏 contentMatched 恒空且 c.sessions 命中（?? 短路）→ 既有 6 张 chat golden 零像素影响。
  const sel = c.selected
    ? (c.sessions.find((s) => s.sessionId === c.selected) ??
        contentMatched.find((s) => s.sessionId === c.selected))
    : undefined;
  const detailPending = !!c.detailPending;
  const messages = sel && !detailPending ? c.messages : [];
  const selSource = sel?.source || 'claude-code';
  const canResume = isLive
    ? live!.canResume
    : !!sel &&
      (selSource === 'claude-code' || selSource === 'codex') &&
      messages.length > 0 &&
      !!(sel.cwd || messages.some((m) => m.cwd));

  const noCC = isLive && !!live!.noCC;
  const hasEarlier = isLive && live!.hasEarlierMessages;
  const projectsLoading = isLive && !!live!.projectsLoading;
  const sessionsLoading = isLive && !!live!.sessionsLoading;
  // 问题3a：live 索引首扫中（syncStatus==='syncing'）——空态不再误报「暂无会话记录」，改显骨架+建索引提示；
  // 静态/golden 路径 live 缺席 → indexing 恒 false，「暂无会话记录」冻结分支不受影响。
  const indexing = isLive && live!.syncStatus === 'syncing';
  const showSessionsSentinel = isLive && !isSearch && sortedSessions.length > 0;

  // ── W6 搜索命中导航（右栏内容匹配；live-only 生效，静态/golden 恒空态零 DOM）──
  const matches = useMemo(
    () => (isLive && isSearch ? enumerateMatches(messages, query) : []),
    [isLive, isSearch, messages, query],
  );
  const [currentMatchIdx, setCurrentMatchIdx] = useState(0);
  // matchKey（选中会话 + query）变 → idx 归 0（R1.19）。渲染期守卫式归零（React「据 props 调整 state」定式，避免多一帧 stale）。
  const navKey = matchKey(c.selected, query);
  const prevNavKeyRef = useRef(navKey);
  if (prevNavKeyRef.current !== navKey) {
    prevNavKeyRef.current = navKey;
    setCurrentMatchIdx(0);
  }
  const navActive = isLive && isSearch && !!sel;
  const navTotal = matches.length;
  const navCur = navTotal > 0 ? clampIdx(currentMatchIdx, navTotal) + 1 : 0; // R1.12：total>0?idx+1:0
  // 当前命中坐标（无命中 = -1/-1）：作为 MatchNavController 稳定标量依赖（M-4：非导航重渲染不重滚）。
  const curMatch = navTotal > 0 ? matches[clampIdx(currentMatchIdx, navTotal)] : null;
  const targetMsgIdx = curMatch ? curMatch.msgIdx : -1;
  const targetNth = curMatch ? curMatch.nthInMsg : -1;
  const goPrevMatch = (): void => setCurrentMatchIdx((p) => clampIdx(p - 1, matches.length));
  const goNextMatch = (): void => setCurrentMatchIdx((p) => clampIdx(p + 1, matches.length));
  const highlight = isLive && isSearch ? query : undefined; // text 块/字符串正文高亮口径（工具块不传）
  const suppressBottom = navActive && navTotal > 0; // 搜索有命中 → 抑制切会话贴底，由 MatchNavController 定位（R1.8）

  // ── live-only 触底/触顶哨兵观察者（无 live 时早退；SSR/截图路径不跑 effect） ──
  const cardsRef = useRef<HTMLDivElement>(null);
  const sessionsSentinelRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const earlierSentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onLoad = live?.onLoadMoreSessions;
    const root = cardsRef.current;
    const sentinel = sessionsSentinelRef.current;
    if (!onLoad || !root || !sentinel) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) onLoad();
      },
      { root },
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [live?.onLoadMoreSessions, showSessionsSentinel, sortedSessions.length]);

  useEffect(() => {
    const onLoad = live?.onLoadEarlierMessages;
    const root = scrollerRef.current;
    const sentinel = earlierSentinelRef.current;
    if (!onLoad || !root || !sentinel) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) onLoad();
      },
      { root },
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [live?.onLoadEarlierMessages, hasEarlier, c.selected, messages.length]);

  const renderCard = (s: ChatSession): JSX.Element => (
    <SessionCard
      key={s.sessionId}
      session={s}
      selected={s.sessionId === c.selected}
      query={query}
      snippet={snippets.get(s.sessionId)}
      projectName={s.projectHash ? projectNameMap.get(s.projectHash) || '' : undefined}
      onSelect={live ? () => live.onSelectSession(s.sessionId, s.projectHash) : undefined}
      onJump={live ? () => live.onDoubleClickSession(s.sessionId, s.projectHash) : undefined}
      onContextMenu={
        live?.onContextMenu
          ? (e) => {
              e.preventDefault();
              live.onContextMenu!(s.sessionId, s.projectHash, e.clientX, e.clientY);
            }
          : undefined
      }
      renaming={isLive && live!.renamingSessionId === s.sessionId}
      onRenameCommit={live ? (title) => live.onRenameCommit?.(s.sessionId, title) : undefined}
      onRenameCancel={live?.onRenameCancel}
    />
  );

  const searchInput = (
    <div className="search-input-wrap">
      <input
        type="text"
        className="search-input-wrap__input"
        placeholder="搜索会话..."
        value={c.search?.query ?? ''}
        readOnly={!isLive}
        onChange={live ? (e) => live.onSearchInput(e.target.value) : undefined}
        onKeyDown={
          navActive
            ? (e) => {
                // W6：详情打开的搜索态下 Enter=下一处 / Shift+Enter=上一处（R1.3）。
                if (e.key !== 'Enter') return;
                e.preventDefault();
                if (e.shiftKey) goPrevMatch();
                else goNextMatch();
              }
            : undefined
        }
        style={isSearch ? { paddingRight: 110 } : undefined}
      />
      {/* 详情打开的搜索态 → {cur}/{total} + ▲▼（R1.4/1.13）替换「{n} 个结果」徽记；否则显结果数。 */}
      {isSearch && !searching && !navActive && (
        <span className="search-input-wrap__result-count">{totalCount} 个结果</span>
      )}
      {navActive && (
        <div className="search-input-wrap__nav">
          <span className="search-input-wrap__nav-count">
            {navCur}/{navTotal}
          </span>
          <button
            className="search-input-wrap__nav-btn"
            title="上一处 (Shift+Enter)"
            onClick={goPrevMatch}
            disabled={!navTotal || navCur <= 1}
          >
            &#9650;
          </button>
          <button
            className="search-input-wrap__nav-btn"
            title="下一处 (Enter)"
            onClick={goNextMatch}
            disabled={!navTotal || navCur >= navTotal}
          >
            &#9660;
          </button>
        </div>
      )}
      {isSearch && (
        <button
          className="search-input-wrap__clear search-input-wrap__clear--with-nav"
          onClick={live ? () => live.onSearchInput('') : undefined}
        >
          ×
        </button>
      )}
    </div>
  );

  return (
    <div className="chat-history-overlay">
      <div className="chat-history-panel">
        {c.banner && (
          <div className="chat-archive-banner">
            <span className="chat-archive-banner__text">
              {live?.bannerText ?? (
                <>
                  Claude Code 本地聊天记录在未参与模型训练时仅保留约 30
                  天（参与训练时为 5 年），Muxvo 已自动归档到 ~/.muxvo/chat-archive/
                  永久保留。所有数据仅保存在你的本地电脑，不会上传到任何服务器。
                </>
              )}
            </span>
            <div className="chat-archive-banner__actions">
              <label className="chat-archive-toggle">
                {/* R7.3 归档开关：有 onToggleArchive（live+configApi）才可切换；否则 readOnly（golden 静态路径
                    live 缺席、或 live 无 configApi 时——同既往字节，onChange=undefined 不入 DOM、无受控告警）。 */}
                <input
                  type="checkbox"
                  checked={c.archiveEnabled !== false}
                  readOnly={!live?.onToggleArchive}
                  onChange={live?.onToggleArchive}
                />
                <span>{c.archiveEnabled !== false ? '自动归档：开启' : '自动归档：关闭'}</span>
              </label>
              <button className="chat-archive-banner__close" onClick={live?.onDismissBanner}>
                ×
              </button>
            </div>
          </div>
        )}
        <div className="chat-history-panel__columns">
          {/* 左栏：项目列表 */}
          <div className="chat-history-panel__left">
            <div className="project-list">
              <div className="project-list__header">项目</div>
              {projectsLoading && c.projects.length === 0 ? (
                <ProjectsSkeleton />
              ) : (
                <>
                  <div
                    className={`project-list__item${
                      (c.selectedProjectHash ?? null) === null ? ' project-list__item--selected' : ''
                    }`}
                    onClick={live ? () => live.onSelectProject(null) : undefined}
                  >
                    <span className="project-list__dot" style={{ background: 'var(--accent)' }} />
                    <span className="project-list__name">全部项目</span>
                    <span className="project-list__count">{formatSize(totalSize)}</span>
                  </div>
                  {c.projects.map((p) => (
                    <div
                      key={p.projectHash}
                      className={`project-list__item${
                        c.selectedProjectHash === p.projectHash ? ' project-list__item--selected' : ''
                      }`}
                      onClick={live ? () => live.onSelectProject(p.projectHash) : undefined}
                    >
                      <span className="project-list__dot" style={{ background: hashColor(p.projectHash) }} />
                      <span className="project-list__name" title={p.displayPath}>
                        {p.displayName}
                      </span>
                      <span className="project-list__count">{formatSize(p.totalSize || 0)}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>

          {/* 中栏：会话列表（普通 / 搜索 / 空 / noCC / 骨架 多态） */}
          <div className="chat-history-panel__middle">
            <div className="session-list">
              <div className="session-list__header">
                <span>
                  {isSearch
                    ? searching
                      ? '会话'
                      : `会话 (${totalCount})`
                    : sortedSessions.length === 0
                      ? '会话'
                      : `会话 (${sortedSessions.length})`}
                </span>
              </div>
              {searchInput}
              <div className="session-list__cards" ref={cardsRef}>
                {noCC ? (
                  <NoCCEmptyState onLearnMore={live?.onLearnMore} />
                ) : isSearch ? (
                  <>
                    {titleMatched.length > 0 && (
                      <>
                        <div className="session-list__section-header">
                          标题匹配 ({titleMatched.length})
                        </div>
                        {titleMatched.map(renderCard)}
                      </>
                    )}
                    {searching ? (
                      <>
                        <div className="session-list__section-header">
                          搜索会话内容...
                          <span className="session-list__search-spinner" aria-hidden="true" />
                        </div>
                        {[0, 1, 2].map((i) => (
                          <SkeletonCard key={i} />
                        ))}
                      </>
                    ) : (
                      <>
                        {contentMatched.length > 0 && (
                          <>
                            <div className="session-list__section-header">
                              内容匹配 ({contentMatched.length})
                            </div>
                            {contentMatched.map(renderCard)}
                          </>
                        )}
                        {totalCount === 0 &&
                          (indexing ? (
                            // 索引首扫中「无匹配」多为索引未就绪，改显建索引提示（问题3a，同门）。
                            <div className="session-list__sync-hint">正在建立索引…</div>
                          ) : (
                            <div className="session-list__empty">无匹配会话</div>
                          ))}
                      </>
                    )}
                  </>
                ) : (sessionsLoading || indexing) && sortedSessions.length === 0 ? (
                  <>
                    {/* live-only：索引首扫中先给「建立索引」提示，避免冷首开空列表误报（问题3a）。
                        indexing 恒 false 于静态路径 → golden 不可达此行。 */}
                    {indexing && <div className="session-list__sync-hint">正在建立索引…</div>}
                    <SessionsSkeleton />
                  </>
                ) : sortedSessions.length === 0 ? (
                  <div className="session-list__empty">暂无会话记录</div>
                ) : (
                  <>
                    {sortedSessions.map(renderCard)}
                    {showSessionsSentinel && (
                      <div className="session-list__load-sentinel" ref={sessionsSentinelRef} aria-hidden="true">
                        {live!.sessionsLoadingMore && <span className="chat-mini-spinner" aria-hidden="true" />}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          {/* 右栏：会话详情 */}
          <div className="chat-history-panel__right">
            <div className="session-detail">
              {detailPending ? (
                <DetailSkeleton />
              ) : !sel || messages.length === 0 ? (
                <div className="session-detail__empty">选择一个会话查看详情</div>
              ) : (
                <>
                  {/* live 路径附「复制为 Markdown」钮（W11）；静态路径 isLive=false → 与原 resume-bar 逐字节等价。 */}
                  {(canResume || (isLive && !!sel && messages.length > 0)) && (
                    <div className="session-detail__resume-bar">
                      {canResume && (
                        <button className="session-detail__resume-btn" onClick={live?.onResume}>
                          <ResumeIcon />
                          继续聊天
                        </button>
                      )}
                      {isLive && !!sel && messages.length > 0 && (
                        <button className="session-detail__copy-md-btn" onClick={live?.onCopyMarkdown}>
                          复制为 Markdown
                        </button>
                      )}
                    </div>
                  )}
                  <div className="session-detail__scroller" ref={scrollerRef}>
                    {hasEarlier ? (
                      <div className="session-detail__load-sentinel" ref={earlierSentinelRef} aria-hidden="true">
                        {live!.messagesLoadingMore && <span className="chat-mini-spinner" aria-hidden="true" />}
                      </div>
                    ) : (
                      <div className="session-detail__all-loaded">— 已加载全部 —</div>
                    )}
                    {messages.map((m, i) => (
                      <MessageBubble
                        key={m.uuid}
                        message={m}
                        index={i}
                        expandToolCall={!!c.expandToolCall}
                        isLive={isLive}
                        render={render}
                        highlight={highlight}
                      />
                    ))}
                  </div>
                  {/* §7.2/§7.3 右栏滚动行为：仅 live 挂载（返回 null，golden/SSR 零感知） */}
                  {isLive && (
                    <MessageScrollController
                      scrollerRef={scrollerRef}
                      messages={messages}
                      selected={c.selected}
                      suppressBottom={suppressBottom}
                    />
                  )}
                  {/* W6 命中导航 + W10 回到顶部：均 live-only（golden/SSR 零感知）。 */}
                  {isLive && (
                    <MatchNavController
                      scrollerRef={scrollerRef}
                      navKey={navKey}
                      targetMsgIdx={targetMsgIdx}
                      targetNth={targetNth}
                    />
                  )}
                  {isLive && (
                    <BackToTopControl
                      scrollerRef={scrollerRef}
                      hasEarlier={hasEarlier}
                      onLoadAllMessages={live?.onLoadAllMessages}
                      messagesLen={messages.length}
                      loadingMore={live?.messagesLoadingMore}
                    />
                  )}
                </>
              )}
            </div>
          </div>
        </div>
        {isLive && <SyncBar status={live!.syncStatus} lastSyncMs={live!.lastSyncMs} progress={live!.syncProgress} />}
      </div>
    </div>
  );
}
