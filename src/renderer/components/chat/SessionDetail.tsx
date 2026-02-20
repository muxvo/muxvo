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

import React, { useState, useRef, useEffect } from 'react';
import { MarkdownPreview } from '@/renderer/components/markdown/MarkdownPreview';
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
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="tool-call-block"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="tool-call-block__header">
        <span className="tool-call-block__icon">{expanded ? '▼' : '▶'}</span>
        <span className="tool-call-block__label">Tool Call{name ? `: ${name}` : ''}</span>
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

function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.type === 'user';

  return (
    <div className={`message-bubble ${isUser ? 'message-bubble--user' : 'message-bubble--assistant'}`}>
      <div className="message-bubble__label">
        {isUser ? 'YOU' : 'CLAUDE'}
      </div>

      <div className="message-bubble__content">
        {isUser ? (
          <div className="message-bubble__text">
            {message.content as string}
          </div>
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
}

const MESSAGE_PAGE_SIZE = 50;

export function SessionDetail({ messages, loading }: SessionDetailProps) {
  const [visibleCount, setVisibleCount] = useState(MESSAGE_PAGE_SIZE);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Reset visible count when a different session is selected
  const messageKey = messages.length > 0 ? messages[0].uuid : '';
  useEffect(() => { setVisibleCount(MESSAGE_PAGE_SIZE); }, [messageKey]);

  // Auto-scroll to bottom when messages change (new session or real-time update)
  useEffect(() => {
    if (messages.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
    }
  }, [messages]);

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

  // Show the LAST N messages (most recent), with "load earlier" at top
  const startIndex = Math.max(0, messages.length - visibleCount);
  const visibleMessages = messages.slice(startIndex);
  const hasEarlier = startIndex > 0;

  return (
    <div className="session-detail" ref={containerRef}>
      <div className="session-detail__messages">
        {hasEarlier && (
          <button
            className="session-detail__load-more"
            onClick={() => setVisibleCount(prev => prev + MESSAGE_PAGE_SIZE)}
          >
            加载更早消息 ({startIndex} 条)
          </button>
        )}
        {visibleMessages.map((message) => (
          <MessageBubble key={message.uuid} message={message} />
        ))}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}
