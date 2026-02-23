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

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { MarkdownPreview } from '@/renderer/components/markdown/MarkdownPreview';
import { useI18n } from '@/renderer/i18n';
import type { SessionMessage, AssistantContentBlock } from '@/shared/types/chat.types';
import './SessionDetail.css';

interface SessionDetailProps {
  messages: SessionMessage[];
  loading?: boolean;
}

interface ToolCallBlockProps {
  name?: string;
  input?: unknown;
}

function ToolCallBlock({ name, input }: ToolCallBlockProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="tool-call-block"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="tool-call-block__header">
        <span className="tool-call-block__icon">{expanded ? '▼' : '▶'}</span>
        <span className="tool-call-block__label">{t('chat.toolCall')}{name ? `: ${name}` : ''}</span>
      </div>
      {expanded && (
        <pre className="tool-call-block__content">
          {typeof input === 'string' ? input : JSON.stringify(input, null, 2)}
        </pre>
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
    <div
      className="tool-result-block"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="tool-result-block__header">
        <span className="tool-result-block__icon">{expanded ? '▼' : '▶'}</span>
        <span className="tool-result-block__label">{t('chat.toolResult')}</span>
      </div>
      {expanded && (
        <pre className="tool-result-block__content">
          {typeof content === 'string' ? content : JSON.stringify(content, null, 2)}
        </pre>
      )}
    </div>
  );
}

function renderContentBlock(block: AssistantContentBlock, index: number) {
  switch (block.type) {
    case 'text':
      return <MarkdownPreview key={index} content={block.text || ''} />;
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
}

const MessageBubble = React.memo(function MessageBubble({ message }: MessageBubbleProps) {
  const { t } = useI18n();
  const isUser = message.type === 'user';
  const isSystem = message.type === 'system';

  const bubbleClass = isUser
    ? 'message-bubble--user'
    : isSystem
      ? 'message-bubble--system'
      : 'message-bubble--assistant';

  return (
    <div className={`message-bubble ${bubbleClass}`}>
      <div className="message-bubble__label">
        {isUser ? t('chat.you') : isSystem ? t('chat.system') : t('chat.claude')}
      </div>

      <div className="message-bubble__content">
        {isUser || isSystem ? (
          <div className="message-bubble__text">{message.content as string}</div>
        ) : (
          Array.isArray(message.content)
            ? (message.content as AssistantContentBlock[]).map((block, i) => renderContentBlock(block, i))
            : <MarkdownPreview content={String(message.content)} />
        )}
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

export function SessionDetail({ messages, loading }: SessionDetailProps) {
  const { t } = useI18n();
  const [visibleCount, setVisibleCount] = useState(MESSAGE_PAGE_SIZE);
  const [firstItemIndex, setFirstItemIndex] = useState(FIRST_ITEM_INDEX);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const virtuosoRef = useRef<VirtuosoHandle>(null);

  // Reset visible count when a different session is selected
  const messageKey = messages.length > 0 ? messages[0].uuid : '';
  useEffect(() => {
    setVisibleCount(MESSAGE_PAGE_SIZE);
    setFirstItemIndex(FIRST_ITEM_INDEX);
    setLoadingOlder(false);
  }, [messageKey]);

  // Auto-scroll to bottom when messages change (new session or real-time update)
  useEffect(() => {
    if (messages.length > 0) {
      // Small delay to let Virtuoso mount
      setTimeout(() => {
        virtuosoRef.current?.scrollToIndex({ index: 'LAST', behavior: 'auto' });
      }, 50);
    }
  }, [messages]);

  // Show the LAST N messages (most recent), with "load earlier" at top
  const startIndex = Math.max(0, messages.length - visibleCount);
  const visibleMessages = messages.slice(startIndex);
  const hasEarlier = startIndex > 0;

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
      <Virtuoso
        ref={virtuosoRef}
        data={visibleMessages}
        firstItemIndex={firstItemIndex}
        startReached={handleStartReached}
        initialTopMostItemIndex={visibleMessages.length - 1}
        components={{ Header }}
        itemContent={(_index, message) => <MessageBubble key={message.uuid} message={message} />}
        followOutput="auto"
        style={{ height: '100%' }}
        overscan={200}
      />
    </div>
  );
}
