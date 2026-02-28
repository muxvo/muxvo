/**
 * D7: SessionDetail — 右栏会话详情
 *
 * 功能:
 * - 用户消息: 右对齐, accent 背景, "YOU" 标签
 * - 助手消息: 左对齐, elevated 背景, "CLAUDE" 标签, Markdown 渲染
 * - 工具调用: 蓝色左边框, 默认折叠, 点击展开
 * - 工具结果: 绿色左边框, 默认折叠
 * - 代码块: 复制按钮
 */

import React, { useState, useRef, useEffect, useCallback, useMemo, useImperativeHandle, forwardRef } from 'react';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { MarkdownPreview } from '@/renderer/components/markdown/MarkdownPreview';
import { useI18n } from '@/renderer/i18n';
import type { SessionMessage, AssistantContentBlock } from '@/shared/types/chat.types';
import './SessionDetail.css';

export interface SessionDetailHandle {
  goToPrevMatch: () => void;
  goToNextMatch: () => void;
}

interface SessionDetailProps {
  messages: SessionMessage[];
  loading?: boolean;
  searchQuery?: string;
  onMatchInfoChange?: (current: number, total: number) => void;
  onResumeSession?: () => void;
  canResume?: boolean;
}

/** Escape special regex characters */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Highlight matching query text with <mark> */
function HighlightText({ text, query, active }: { text: string; query: string; active?: boolean }) {
  if (!query) return <>{text}</>;
  const parts = text.split(new RegExp(`(${escapeRegex(query)})`, 'gi'));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase()
          ? <mark key={i} className={`search-highlight${active ? ' search-highlight--active' : ''}`}>{part}</mark>
          : part
      )}
    </>
  );
}

interface ToolCallBlockProps {
  name?: string;
  input?: unknown;
}

/** Render tool input: string values as Markdown, others as JSON */
function ToolInputContent({ input }: { input: unknown }) {
  if (typeof input === 'string') {
    return <MarkdownPreview content={input} />;
  }
  if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
    const entries = Object.entries(input as Record<string, unknown>);
    return (
      <>
        {entries.map(([key, val]) => (
          <div key={key} className="tool-call-block__field">
            <div className="tool-call-block__field-key">{key}</div>
            {typeof val === 'string'
              ? <MarkdownPreview content={val} />
              : <pre className="tool-call-block__field-val">{JSON.stringify(val, null, 2)}</pre>
            }
          </div>
        ))}
      </>
    );
  }
  return <pre className="tool-call-block__content">{JSON.stringify(input, null, 2)}</pre>;
}

function ToolCallBlock({ name, input }: ToolCallBlockProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="tool-call-block">
      <div className="tool-call-block__header" onClick={() => setExpanded(!expanded)}>
        <span className="tool-call-block__icon">{expanded ? '▼' : '▶'}</span>
        <span className="tool-call-block__label">{t('chat.toolCall')}{name ? `: ${name}` : ''}</span>
      </div>
      {expanded && (
        <div className="tool-call-block__content">
          <ToolInputContent input={input} />
        </div>
      )}
    </div>
  );
}

interface ToolResultBlockProps {
  content?: unknown;
}

function ToolResultBlock({ content }: ToolResultBlockProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="tool-result-block">
      <div className="tool-result-block__header" onClick={() => setExpanded(!expanded)}>
        <span className="tool-result-block__icon">{expanded ? '▼' : '▶'}</span>
        <span className="tool-result-block__label">{t('chat.toolResult')}</span>
      </div>
      {expanded && (
        <div className="tool-result-block__content">
          <ToolInputContent input={content} />
        </div>
      )}
    </div>
  );
}

function ImageBlock({ source }: { source: AssistantContentBlock['source'] }) {
  if (!source?.data) return null;
  const src = `data:${source.media_type || 'image/png'};base64,${source.data}`;
  return (
    <div className="image-block">
      <img src={src} alt="" className="image-block__img" loading="lazy" />
    </div>
  );
}

function renderContentBlock(block: AssistantContentBlock, index: number, searchQuery?: string, isActiveMatch?: boolean) {
  switch (block.type) {
    case 'text':
      return <MarkdownPreview key={index} content={block.text || ''} searchQuery={searchQuery} isActiveMatch={isActiveMatch} />;
    case 'image':
      return <ImageBlock key={index} source={block.source} />;
    case 'tool_use':
      return <ToolCallBlock key={index} name={block.name} input={block.input} />;
    case 'tool_result':
      return <ToolResultBlock key={index} content={block.content} />;
    default:
      return null;
  }
}

interface MessageBubbleProps {
  message: SessionMessage;
  isActiveMatch?: boolean;
}

/** Extract plain text from message content for clipboard copy */
function extractMessageText(message: SessionMessage): string {
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.content)) {
    return (message.content as AssistantContentBlock[])
      .filter((b) => b.type === 'text')
      .map((b) => b.text || '')
      .join('\n\n');
  }
  return String(message.content);
}

const TEAMMATE_COLORS: Record<string, string> = {
  blue: '#60a5fa',
  yellow: '#facc15',
  orange: '#fb923c',
  green: '#34d399',
  purple: '#a855f7',
  red: '#f87171',
};

const MessageBubble = React.memo(function MessageBubble({ message, searchQuery, isActiveMatch }: MessageBubbleProps & { searchQuery?: string }) {
  const { t } = useI18n();
  const isUser = message.type === 'user';
  const isSystem = message.type === 'system';

  const teammateInfo = useMemo(() => {
    if (!isSystem || typeof message.content !== 'string') return null;
    const m = message.content.match(/<teammate-message\s+teammate_id="([^"]+)"(?:\s+color="([^"]+)")?/);
    return m ? { label: `CLAUDE: ${m[1]}`, color: m[2] || null } : null;
  }, [isSystem, message.content]);

  const isTeammate = teammateInfo !== null;

  const bubbleClass = isUser
    ? 'message-bubble--user'
    : isTeammate
      ? 'message-bubble--assistant'
      : isSystem
        ? 'message-bubble--system'
        : 'message-bubble--assistant';

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    // If no text is selected, auto-select the message content
    // so the native context menu "Copy" works on the whole message
    const selection = window.getSelection();
    if (!selection || selection.toString().trim() === '') {
      const contentEl = (e.currentTarget as HTMLElement).querySelector('.message-bubble__content');
      if (contentEl) {
        const range = document.createRange();
        range.selectNodeContents(contentEl);
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    }
    // Don't prevent default — let the native Electron context menu handle copy
  }, []);

  return (
    <div className={`message-bubble ${bubbleClass}`} onContextMenu={handleContextMenu}>
      <div className="message-bubble__label" style={teammateInfo?.color ? { color: TEAMMATE_COLORS[teammateInfo.color] || undefined } : undefined}>
        {isUser ? t('chat.you') : teammateInfo?.label || (isSystem ? t('chat.system') : message.uuid.startsWith('codex-') ? 'CODEX' : message.uuid.startsWith('gemini-') ? 'GEMINI' : t('chat.claude'))}
      </div>

      <div className="message-bubble__content">
        {Array.isArray(message.content)
          ? (message.content as AssistantContentBlock[]).map((block, i) => renderContentBlock(block, i, searchQuery, isActiveMatch))
          : isTeammate
            ? <MarkdownPreview content={
                (message.content as string)
                  .replace(/<teammate-message[^>]*>\n?/g, '')
                  .replace(/<\/teammate-message>\s*/g, '')
              } searchQuery={searchQuery} isActiveMatch={isActiveMatch} />
            : isUser || isSystem
              ? <div className="message-bubble__text">{searchQuery ? <HighlightText text={message.content as string} query={searchQuery} active={isActiveMatch} /> : message.content as string}</div>
              : <MarkdownPreview content={String(message.content)} searchQuery={searchQuery} isActiveMatch={isActiveMatch} />
        }
      </div>

      <div className="message-bubble__meta">
        {new Date(message.timestamp).toLocaleTimeString()}
      </div>
    </div>
  );
});

export function formatMessagesAsMarkdown(messages: SessionMessage[]): string {
  const parts: string[] = [];
  for (const msg of messages) {
    if (msg.type === 'system') continue;
    if (msg.type === 'user') {
      parts.push(`## You\n\n${msg.content as string}\n\n`);
    } else if (msg.type === 'assistant') {
      const blocks = Array.isArray(msg.content) ? msg.content as AssistantContentBlock[] : [];
      const textParts = blocks
        .filter((b) => b.type === 'text')
        .map((b) => b.text || '');
      if (textParts.length > 0) {
        parts.push(`## Claude\n\n${textParts.join('\n\n')}\n\n`);
      }
    }
  }
  return parts.join('').trimEnd();
}

const MESSAGE_PAGE_SIZE = 50;
const FIRST_ITEM_INDEX = 100000;

export const SessionDetail = forwardRef<SessionDetailHandle, SessionDetailProps>(function SessionDetail({ messages, loading, searchQuery, onMatchInfoChange, onResumeSession, canResume }, ref) {
  const { t } = useI18n();
  const [visibleCount, setVisibleCount] = useState(MESSAGE_PAGE_SIZE);
  const [firstItemIndex, setFirstItemIndex] = useState(FIRST_ITEM_INDEX);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [currentMatchIdx, setCurrentMatchIdx] = useState(0);
  const virtuosoRef = useRef<VirtuosoHandle>(null);

  // Reset when a different session is selected (key change remounts Virtuoso)
  const messageKey = messages.length > 0 ? messages[0].uuid : '';
  useEffect(() => {
    setVisibleCount(MESSAGE_PAGE_SIZE);
    setFirstItemIndex(FIRST_ITEM_INDEX);
    setLoadingOlder(false);
    setCurrentMatchIdx(0);
  }, [messageKey]);

  // When searching, expand visibleCount to load ALL messages so we can match across full history
  const isSearching = Boolean(searchQuery?.trim());
  useEffect(() => {
    if (isSearching && visibleCount < messages.length) {
      const needed = messages.length - visibleCount;
      setFirstItemIndex(prev => prev - needed);
      setVisibleCount(messages.length);
    }
  }, [isSearching, messages.length]);

  // Show the LAST N messages (most recent), with "load earlier" at top
  const startIndex = Math.max(0, messages.length - visibleCount);
  const visibleMessages = messages.slice(startIndex);
  const hasEarlier = startIndex > 0;

  // Compute match occurrences: each keyword occurrence across all visibleMessages
  interface MatchOccurrence { msgIdx: number; nthInMsg: number; }
  const matchOccurrences = useMemo((): MatchOccurrence[] => {
    if (!searchQuery?.trim()) return [];
    const q = searchQuery.toLowerCase();
    const results: MatchOccurrence[] = [];
    for (let i = 0; i < visibleMessages.length; i++) {
      const msg = visibleMessages[i];
      let text = '';
      if (typeof msg.content === 'string') {
        text = msg.content;
      } else if (Array.isArray(msg.content)) {
        text = (msg.content as Array<{ type: string; text?: string }>)
          .filter(b => b.type === 'text' && b.text)
          .map(b => b.text!)
          .join('\n');
      }
      const lower = text.toLowerCase();
      let pos = 0;
      let nth = 0;
      while ((pos = lower.indexOf(q, pos)) !== -1) {
        results.push({ msgIdx: i, nthInMsg: nth });
        nth++;
        pos += q.length;
      }
    }
    return results;
  }, [visibleMessages, searchQuery]);

  // Reset currentMatchIdx when search query or session changes
  const prevMatchKey = useRef('');
  useEffect(() => {
    const matchKey = `${messageKey}:${searchQuery}`;
    if (matchKey === prevMatchKey.current) return;
    prevMatchKey.current = matchKey;
    if (matchOccurrences.length > 0) {
      setCurrentMatchIdx(0);
    }
  }, [matchOccurrences, messageKey, searchQuery]);

  // Unified scroll effect: two-step positioning
  // Step 1: scrollToIndex brings the message into Virtuoso's rendered DOM
  // Step 2: scrollIntoView on the specific <mark> element for keyword-level precision
  useEffect(() => {
    if (!searchQuery?.trim() || matchOccurrences.length === 0) return;
    if (currentMatchIdx < 0 || currentMatchIdx >= matchOccurrences.length) return;
    const match = matchOccurrences[currentMatchIdx];
    const dataIndex = match.msgIdx;
    requestAnimationFrame(() => {
      virtuosoRef.current?.scrollToIndex({ index: dataIndex, align: 'center', behavior: 'auto' });
      // After Virtuoso renders the message, locate the exact keyword mark
      setTimeout(() => {
        const marks = document.querySelectorAll('mark.search-highlight--active');
        const target = marks[match.nthInMsg];
        if (target) {
          target.scrollIntoView({ block: 'center', behavior: 'auto' });
        }
      }, 80);
    });
  }, [currentMatchIdx, matchOccurrences, searchQuery]);

  // Auto-scroll to bottom on real-time updates (new messages appended) — only when NOT searching
  const prevMsgCount = useRef(messages.length);
  useEffect(() => {
    if (!isSearching && messages.length > prevMsgCount.current) {
      virtuosoRef.current?.scrollToIndex({ index: 'LAST', behavior: 'auto' });
    }
    prevMsgCount.current = messages.length;
  }, [messages.length, isSearching]);

  // Click handlers only update state — scroll is handled by the effect above
  const goToPrevMatch = useCallback(() => {
    setCurrentMatchIdx(prev => prev > 0 ? prev - 1 : prev);
  }, []);

  const goToNextMatch = useCallback(() => {
    setCurrentMatchIdx(prev =>
      prev < matchOccurrences.length - 1 ? prev + 1 : prev
    );
  }, [matchOccurrences.length]);

  // Expose nav actions to parent via ref
  useImperativeHandle(ref, () => ({
    goToPrevMatch,
    goToNextMatch,
  }), [goToPrevMatch, goToNextMatch]);

  // Report match info to parent
  useEffect(() => {
    onMatchInfoChange?.(matchOccurrences.length > 0 ? currentMatchIdx + 1 : 0, matchOccurrences.length);
  }, [currentMatchIdx, matchOccurrences.length, onMatchInfoChange]);

  const handleStartReached = useCallback(() => {
    if (!hasEarlier || loadingOlder) return;
    setLoadingOlder(true);
    setTimeout(() => {
      const increment = Math.min(MESSAGE_PAGE_SIZE, startIndex);
      setFirstItemIndex(prev => prev - increment);
      setVisibleCount(prev => prev + increment);
      setLoadingOlder(false);
    }, 300);
  }, [hasEarlier, loadingOlder, startIndex]);

  const Header = useCallback(() => {
    if (loadingOlder) {
      return (
        <div className="session-detail__loading-older">
          <span className="session-detail__spinner" />
        </div>
      );
    }
    if (!hasEarlier) {
      return (
        <div className="session-detail__all-loaded">
          — 已加载全部 —
        </div>
      );
    }
    return null;
  }, [loadingOlder, hasEarlier]);

  if (loading) {
    return (
      <div className="session-detail">
        <div className="session-detail__skeleton">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className={`skeleton-bubble ${i % 2 === 0 ? 'skeleton-bubble--right' : 'skeleton-bubble--left'}`}>
              <div className="skeleton-bubble__label" />
              <div className="skeleton-bubble__content" />
              <div className="skeleton-bubble__meta" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="session-detail">
        <div className="session-detail__empty">选择一个会话查看详情</div>
      </div>
    );
  }

  return (
    <div className="session-detail">
      {canResume && (
        <div className="session-detail__resume-bar">
          <button className="session-detail__resume-btn" onClick={() => onResumeSession?.()}>
            <svg className="session-detail__resume-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M2 2.5C2 1.67 2 1.25 2.17 1.05C2.32 0.88 2.54 0.79 2.76 0.82C3.02 0.85 3.31 1.15 3.9 1.74L7.1 4.94C7.55 5.39 7.77 5.62 7.85 5.88C7.93 6.11 7.93 6.36 7.85 6.59C7.77 6.85 7.55 7.08 7.1 7.53L3.9 10.73C3.31 11.32 3.02 11.62 2.76 11.65C2.54 11.68 2.32 11.59 2.17 11.42C2 11.22 2 10.8 2 9.97V2.5Z" fill="currentColor"/>
              <path d="M9 2.5C9 1.67 9 1.25 9.17 1.05C9.32 0.88 9.54 0.79 9.76 0.82C10.02 0.85 10.31 1.15 10.9 1.74L14.1 4.94C14.55 5.39 14.77 5.62 14.85 5.88C14.93 6.11 14.93 6.36 14.85 6.59C14.77 6.85 14.55 7.08 14.1 7.53L10.9 10.73C10.31 11.32 10.02 11.62 9.76 11.65C9.54 11.68 9.32 11.59 9.17 11.42C9 11.22 9 10.8 9 9.97V2.5Z" fill="currentColor"/>
              <rect x="2" y="13" width="12" height="2" rx="1" fill="currentColor"/>
            </svg>
            {t('chat.resumeSession')}
          </button>
        </div>
      )}
      <Virtuoso
        key={messageKey}
        ref={virtuosoRef}
        data={visibleMessages}
        firstItemIndex={firstItemIndex}
        startReached={handleStartReached}
        initialTopMostItemIndex={isSearching && matchOccurrences.length > 0 ? matchOccurrences[0].msgIdx : visibleMessages.length - 1}
        components={{ Header }}
        itemContent={(index, message) => {
          const msgIdx = index - firstItemIndex;
          const isActiveMatch = searchQuery && matchOccurrences[currentMatchIdx]?.msgIdx === msgIdx;
          return <MessageBubble key={message.uuid} message={message} searchQuery={searchQuery} isActiveMatch={!!isActiveMatch} />;
        }}
        followOutput={isSearching ? undefined : 'auto'}
        style={{ height: '100%' }}
        overscan={200}
      />
    </div>
  );
});
