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

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { MarkdownPreview } from '@/renderer/components/markdown/MarkdownPreview';
import { useI18n } from '@/renderer/i18n';
import type { SessionMessage, AssistantContentBlock } from '@/shared/types/chat.types';
import './SessionDetail.css';

interface SessionDetailProps {
  messages: SessionMessage[];
  loading?: boolean;
  searchQuery?: string;
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

function renderContentBlock(block: AssistantContentBlock, index: number) {
  switch (block.type) {
    case 'text':
      return <MarkdownPreview key={index} content={block.text || ''} />;
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
          ? (message.content as AssistantContentBlock[]).map((block, i) => renderContentBlock(block, i))
          : isTeammate
            ? <MarkdownPreview content={
                (message.content as string)
                  .replace(/<teammate-message[^>]*>\n?/g, '')
                  .replace(/<\/teammate-message>\s*/g, '')
              } />
            : isUser || isSystem
              ? <div className="message-bubble__text">{searchQuery ? <HighlightText text={message.content as string} query={searchQuery} active={isActiveMatch} /> : message.content as string}</div>
              : <MarkdownPreview content={String(message.content)} />
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

export function SessionDetail({ messages, loading, searchQuery }: SessionDetailProps) {
  const { t } = useI18n();
  const [visibleCount, setVisibleCount] = useState(MESSAGE_PAGE_SIZE);
  const [firstItemIndex, setFirstItemIndex] = useState(FIRST_ITEM_INDEX);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [currentMatchIdx, setCurrentMatchIdx] = useState(0);
  const virtuosoRef = useRef<VirtuosoHandle>(null);

  // Reset visible count when a different session is selected
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

  // Compute match indices: which visibleMessages contain the search query
  const matchIndices = useMemo(() => {
    if (!searchQuery?.trim()) return [];
    const q = searchQuery.toLowerCase();
    const indices: number[] = [];
    for (let i = 0; i < visibleMessages.length; i++) {
      const msg = visibleMessages[i];
      const text = typeof msg.content === 'string' ? msg.content : '';
      if (text.toLowerCase().includes(q)) {
        indices.push(i);
      }
    }
    return indices;
  }, [visibleMessages, searchQuery]);

  // Auto-scroll to first match when search query changes or session changes
  const prevMatchKey = useRef('');
  useEffect(() => {
    const matchKey = `${messageKey}:${searchQuery}`;
    if (matchKey === prevMatchKey.current) return;
    prevMatchKey.current = matchKey;

    if (matchIndices.length > 0) {
      setCurrentMatchIdx(0);
      setTimeout(() => {
        virtuosoRef.current?.scrollToIndex({ index: firstItemIndex + matchIndices[0], align: 'center', behavior: 'smooth' });
      }, 100);
    }
  }, [matchIndices, messageKey, searchQuery, firstItemIndex]);

  // Auto-scroll to bottom when messages change (new session or real-time update) — only when NOT searching
  useEffect(() => {
    if (messages.length > 0 && !isSearching) {
      setTimeout(() => {
        virtuosoRef.current?.scrollToIndex({ index: 'LAST', behavior: 'auto' });
      }, 50);
    }
  }, [messages, isSearching]);

  const goToPrevMatch = useCallback(() => {
    if (currentMatchIdx > 0) {
      const newIdx = currentMatchIdx - 1;
      setCurrentMatchIdx(newIdx);
      virtuosoRef.current?.scrollToIndex({ index: firstItemIndex + matchIndices[newIdx], align: 'center', behavior: 'smooth' });
    }
  }, [currentMatchIdx, matchIndices, firstItemIndex]);

  const goToNextMatch = useCallback(() => {
    if (currentMatchIdx < matchIndices.length - 1) {
      const newIdx = currentMatchIdx + 1;
      setCurrentMatchIdx(newIdx);
      virtuosoRef.current?.scrollToIndex({ index: firstItemIndex + matchIndices[newIdx], align: 'center', behavior: 'smooth' });
    }
  }, [currentMatchIdx, matchIndices, firstItemIndex]);

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
      {searchQuery && matchIndices.length > 0 && (
        <div className="session-detail__search-nav">
          <span className="session-detail__search-nav-count">
            {currentMatchIdx + 1} / {matchIndices.length}
          </span>
          <button onClick={goToPrevMatch} disabled={currentMatchIdx <= 0}>▲</button>
          <button onClick={goToNextMatch} disabled={currentMatchIdx >= matchIndices.length - 1}>▼</button>
        </div>
      )}
      <Virtuoso
        ref={virtuosoRef}
        data={visibleMessages}
        firstItemIndex={firstItemIndex}
        startReached={handleStartReached}
        initialTopMostItemIndex={visibleMessages.length - 1}
        components={{ Header }}
        itemContent={(index, message) => {
          const msgIdx = index - firstItemIndex;
          const isActiveMatch = searchQuery && matchIndices[currentMatchIdx] === msgIdx;
          return <MessageBubble key={message.uuid} message={message} searchQuery={searchQuery} isActiveMatch={!!isActiveMatch} />;
        }}
        followOutput={isSearching ? undefined : 'auto'}
        style={{ height: '100%' }}
        overscan={200}
      />
    </div>
  );
}
