/**
 * D6: SessionList — 中栏会话卡片列表
 *
 * 功能:
 * - 每张卡片: 标题 + 时间 + 预览(2行截断) + 标签 + 消息数
 * - 时间格式: "HH:MM" / "yesterday" / "MM-DD"
 * - 标签: 关键词匹配 title 字段 → feat/fix/refactor/plan
 * - 按 lastModified 倒序
 */

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import type { SessionSummary, ProjectInfo } from '@/shared/types/chat.types';
import { useI18n } from '@/renderer/i18n';
import { SearchInput } from '@/renderer/components/SearchInput';
import './SessionList.css';

const PAGE_SIZE = 50;

/** Escape special regex characters */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Highlight matching query text with <mark> */
function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const parts = text.split(new RegExp(`(${escapeRegex(query)})`, 'gi'));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase()
          ? <mark key={i} className="search-highlight">{part}</mark>
          : part
      )}
    </>
  );
}

interface SessionListProps {
  sessions: SessionSummary[];
  selectedId: string | null;
  onSelect: (sessionId: string) => void;
  onSessionContextMenu?: (session: SessionSummary, x: number, y: number) => void;
  projects?: ProjectInfo[];
  showProjectName?: boolean;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  searching?: boolean;
  /** sessionId → snippet for full-text search matches */
  searchSnippets?: Map<string, string>;
}

/**
 * Format timestamp: 24h with date context
 * 今天 14:30 / 昨天 09:15 / 02-18 22:00
 */
function formatTime(timestamp: number): string {
  const now = new Date();
  const date = new Date(timestamp);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const time = `${hours}:${minutes}`;

  if (dateOnly.getTime() === today.getTime()) {
    return `今天 ${time}`;
  } else if (dateOnly.getTime() === yesterday.getTime()) {
    return `昨天 ${time}`;
  } else {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${month}-${day} ${time}`;
  }
}

/**
 * Format file size to human-readable string
 * e.g. 512B, 2.3KB, 1.5MB
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace(/\.0$/, '')}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')}MB`;
}

/**
 * Extract tags from title text based on keywords
 */
function extractTags(title: string): Array<{ label: string; color: string }> {
  const tags: Array<{ label: string; color: string }> = [];
  const lowerTitle = title.toLowerCase();

  if (lowerTitle.includes('feat') || lowerTitle.includes('feature')) {
    tags.push({ label: 'feat', color: 'var(--success)' });
  }
  if (lowerTitle.includes('fix') || lowerTitle.includes('bug')) {
    tags.push({ label: 'fix', color: 'var(--error)' });
  }
  if (lowerTitle.includes('refactor')) {
    tags.push({ label: 'refactor', color: 'var(--info)' });
  }
  if (lowerTitle.includes('plan')) {
    tags.push({ label: 'plan', color: 'var(--purple)' });
  }

  return tags;
}

/** Invisible sentinel that triggers loading more when scrolled into view */
function LoadMoreSentinel({ onVisible }: { onVisible: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useCallback(onVisible, [onVisible]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) cb(); },
      { rootMargin: '200px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [cb]);

  return <div ref={ref} style={{ height: 1 }} />;
}

export function SessionList({ sessions, selectedId, onSelect, onSessionContextMenu, projects, showProjectName, searchQuery = '', onSearchChange, searching, searchSnippets }: SessionListProps) {
  const { t } = useI18n();
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Build projectHash → displayName lookup for "all projects" view
  const projectNameMap = useMemo(() => {
    if (!showProjectName || !projects) return null;
    const map = new Map<string, string>();
    for (const p of projects) {
      map.set(p.projectHash, p.displayName);
    }
    return map;
  }, [showProjectName, projects]);

  // Reset visible count when sessions change (e.g. project filter)
  const sessionKey = useMemo(() => sessions.map(s => s.sessionId).join(','), [sessions]);
  useMemo(() => { setVisibleCount(PAGE_SIZE); }, [sessionKey]);

  // Sort by lastModified descending (default)
  const sortedSessions = useMemo(() => {
    return [...sessions].sort((a, b) => b.lastModified - a.lastModified);
  }, [sessions]);

  const visibleSessions = sortedSessions.slice(0, visibleCount);
  const hasMore = sortedSessions.length > visibleCount;

  if (sortedSessions.length === 0) {
    return (
      <div className="session-list">
        <div className="session-list__header">
          <span>{t('chat.sessions')}</span>
        </div>
        {onSearchChange && (
          <SearchInput
            value={searchQuery}
            onChange={onSearchChange}
            placeholder="搜索会话..."
          />
        )}
        <div className="session-list__empty">
          {searchQuery ? '无匹配会话' : t('chat.noSessions')}
        </div>
      </div>
    );
  }

  return (
    <div className="session-list">
      <div className="session-list__header">
        <span>{t('chat.sessionsCount', { count: sortedSessions.length })}</span>
        {searching && <span className="session-list__searching-indicator" />}
      </div>

      {onSearchChange && (
        <SearchInput
          value={searchQuery}
          onChange={onSearchChange}
          placeholder="搜索会话..."
        />
      )}

      {visibleSessions.map((session) => {
        const displayTitle = session.customTitle || session.title;
        const title = displayTitle.slice(0, 50);
        const preview = session.title.slice(0, 100);
        const time = formatTime(session.lastModified);
        const tags = extractTags(session.title);
        const isSelected = session.sessionId === selectedId;
        const snippet = searchSnippets?.get(session.sessionId);

        return (
          <div
            key={session.sessionId}
            className={`session-card ${isSelected ? 'session-card--selected' : ''}`}
            onClick={() => onSelect(session.sessionId)}
            onContextMenu={(e) => {
              e.preventDefault();
              onSessionContextMenu?.(session, e.clientX, e.clientY);
            }}
          >
            <div className="session-card__header">
              <span className="session-card__title" title={session.title}>
                {searchQuery ? <HighlightText text={title} query={searchQuery} /> : title}
              </span>
              <span className="session-card__time">{time}</span>
            </div>

            <div className="session-card__preview">
              {searchQuery ? <HighlightText text={preview} query={searchQuery} /> : preview}
            </div>

            {snippet && (
              <div className="session-card__snippet">
                <span className="session-card__snippet-icon">🔍</span>
                <span className="session-card__snippet-text">
                  <HighlightText text={snippet} query={searchQuery} />
                </span>
              </div>
            )}

            <div className="session-card__footer">
              <div className="session-card__tags">
                {session.source === 'codex' && (
                  <span className="session-card__source-badge session-card__source-badge--cx">CX</span>
                )}
                {session.source === 'claude-code' && (
                  <span className="session-card__source-badge session-card__source-badge--cc">CC</span>
                )}
                {session.source === 'gemini' && (
                  <span className="session-card__source-badge session-card__source-badge--gm">GM</span>
                )}
                {projectNameMap && session.projectHash && (
                  <span className="session-card__project-badge">
                    {projectNameMap.get(session.projectHash) || ''}
                  </span>
                )}
                {tags.map((tag) => (
                  <span
                    key={tag.label}
                    className="session-card__tag"
                    style={{ background: tag.color }}
                  >
                    {tag.label}
                  </span>
                ))}
              </div>
              <span className="session-card__count">{formatFileSize(session.fileSize)}</span>
            </div>
          </div>
        );
      })}

      {hasMore && (
        <LoadMoreSentinel onVisible={() => setVisibleCount(prev => prev + PAGE_SIZE)} />
      )}
    </div>
  );
}
