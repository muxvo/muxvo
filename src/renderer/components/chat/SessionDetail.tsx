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

import React, { useState } from 'react';
import { MarkdownPreview } from '@/renderer/components/markdown/MarkdownPreview';
import type { SessionMessage } from '@/shared/types/chat.types';
import './SessionDetail.css';

interface SessionDetailProps {
  messages: SessionMessage[];
  loading?: boolean;
}

interface ToolCallBlockProps {
  content: string;
}

function ToolCallBlock({ content }: ToolCallBlockProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="tool-call-block"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="tool-call-block__header">
        <span className="tool-call-block__icon">{expanded ? '▼' : '▶'}</span>
        <span className="tool-call-block__label">Tool Call</span>
      </div>
      {expanded && (
        <pre className="tool-call-block__content">
          {content}
        </pre>
      )}
    </div>
  );
}

interface ToolResultBlockProps {
  content: string;
}

function ToolResultBlock({ content }: ToolResultBlockProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="tool-result-block"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="tool-result-block__header">
        <span className="tool-result-block__icon">{expanded ? '▼' : '▶'}</span>
        <span className="tool-result-block__label">Tool Result</span>
      </div>
      {expanded && (
        <pre className="tool-result-block__content">
          {content}
        </pre>
      )}
    </div>
  );
}

interface MessageBubbleProps {
  message: SessionMessage;
}

function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.type === 'user';
  const isAssistant = message.type === 'assistant';

  // Simple detection for tool calls/results (placeholder for now)
  const hasToolCall = message.message.content.includes('[Tool Call]');
  const hasToolResult = message.message.content.includes('[Tool Result]');

  return (
    <div className={`message-bubble ${isUser ? 'message-bubble--user' : 'message-bubble--assistant'}`}>
      <div className="message-bubble__label">
        {isUser ? 'YOU' : 'CLAUDE'}
      </div>

      <div className="message-bubble__content">
        {hasToolCall && (
          <ToolCallBlock content={message.message.content} />
        )}
        {hasToolResult && (
          <ToolResultBlock content={message.message.content} />
        )}
        {!hasToolCall && !hasToolResult && (
          <>
            {isAssistant ? (
              <MarkdownPreview content={message.message.content} />
            ) : (
              <div className="message-bubble__text">
                {message.message.content}
              </div>
            )}
          </>
        )}
      </div>

      <div className="message-bubble__meta">
        {new Date(message.timestamp).toLocaleTimeString()}
      </div>
    </div>
  );
}

const MESSAGE_PAGE_SIZE = 50;

export function SessionDetail({ messages, loading }: SessionDetailProps) {
  const [visibleCount, setVisibleCount] = useState(MESSAGE_PAGE_SIZE);

  // Reset visible count when messages change (new session selected)
  const messageKey = messages.length > 0 ? messages[0].messageId : '';
  React.useEffect(() => { setVisibleCount(MESSAGE_PAGE_SIZE); }, [messageKey]);

  if (loading) {
    return (
      <div className="session-detail">
        <div className="session-detail__loading">加载中...</div>
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

  const visibleMessages = messages.slice(0, visibleCount);
  const hasMore = messages.length > visibleCount;

  return (
    <div className="session-detail">
      <div className="session-detail__messages">
        {visibleMessages.map((message) => (
          <MessageBubble key={message.messageId} message={message} />
        ))}
        {hasMore && (
          <button
            className="session-detail__load-more"
            onClick={() => setVisibleCount(prev => prev + MESSAGE_PAGE_SIZE)}
          >
            加载更多消息 ({messages.length - visibleCount} 条)
          </button>
        )}
      </div>
    </div>
  );
}
