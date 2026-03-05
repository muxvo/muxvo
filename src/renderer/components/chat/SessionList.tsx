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
import { SearchInput, HighlightText } from '@/renderer/components/SearchInput';
import './SessionList.css';

const PAGE_SIZE = 50;

interface SessionListProps {
  sessions: SessionSummary[];
  titleMatchedSessions?: SessionSummary[];
  contentMatchedSessions?: SessionSummary[];
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
  /** Match navigation props (bridged from SessionDetail) */
  matchCurrent?: number;
  matchTotal?: number;
  onPrevMatch?: () => void;
  onNextMatch?: () => void;
  /** Number of matching sessions for search result count display */
  sessionResultCount?: number;
  /** Session ID currently being renamed (null = no rename in progress) */
  renamingSessionId?: string | null;
  /** Called when rename is confirmed with the new name (trimmed). Empty string = clear custom title. */
  onRenameConfirm?: (sessionId: string, newName: string) => void;
  /** Called when rename is cancelled */
  onRenameCancel?: () => void;
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

export function SessionList({ sessions, titleMatchedSessions, contentMatchedSessions, selectedId, onSelect, onSessionContextMenu, projects, showProjectName, searchQuery = '', onSearchChange, searching, searchSnippets, matchCurrent, matchTotal, onPrevMatch, onNextMatch, sessionResultCount, renamingSessionId, onRenameConfirm, onRenameCancel }: SessionListProps) {
  const { t } = useI18n();
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Inline rename state
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  // Initialize rename input when entering rename mode
  useEffect(() => {
    if (renamingSessionId) {
      const session = sessions.find(s => s.sessionId === renamingSessionId);
      if (session) {
        setRenameValue(session.customTitle || session.title);
      }
      setTimeout(() => renameInputRef.current?.select(), 0);
    }
  }, [renamingSessionId, sessions]);

  const handleRenameKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (renamingSessionId) onRenameConfirm?.(renamingSessionId, renameValue.trim());
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onRenameCancel?.();
    }
  }, [renamingSessionId, renameValue, onRenameConfirm, onRenameCancel]);

  const handleRenameBlur = useCallback(() => {
    if (renamingSessionId) {
      onRenameConfirm?.(renamingSessionId, renameValue.trim());
    }
  }, [renamingSessionId, renameValue, onRenameConfirm]);

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

  const isSearchMode = !!searchQuery.trim();

  // Search-mode sorted arrays (always computed to satisfy hooks rules)
  const titleSorted = useMemo(() => {
    return [...(titleMatchedSessions || [])].sort((a, b) => b.lastModified - a.lastModified);
  }, [titleMatchedSessions]);
  const contentSorted = useMemo(() => {
    return [...(contentMatchedSessions || [])].sort((a, b) => b.lastModified - a.lastModified);
  }, [contentMatchedSessions]);

  /** Render a single session card */
  const renderCard = (session: SessionSummary) => {
    const isRenaming = session.sessionId === renamingSessionId;
    const displayTitle = session.customTitle || session.title;
    const wtPrefix = session.worktreeLabel ? `[${session.worktreeLabel}] ` : '';
    const title = (wtPrefix + displayTitle).slice(0, 50);
    const snippet = searchSnippets?.get(session.sessionId);
    const rawPreview = session.title.slice(0, 100);
    const preview = searchQuery && snippet && !rawPreview.toLowerCase().includes(searchQuery.toLowerCase())
      ? snippet.slice(0, 100)
      : rawPreview;
    const time = formatTime(session.lastModified);
    const tags = extractTags(session.title);
    const isSelected = session.sessionId === selectedId;

    return (
      <div
        key={session.sessionId}
        className={`session-card ${isSelected ? 'session-card--selected' : ''}`}
        onClick={() => { if (!isRenaming) onSelect(session.sessionId); }}
        onContextMenu={(e) => {
          e.preventDefault();
          if (!isRenaming) onSessionContextMenu?.(session, e.clientX, e.clientY);
        }}
      >
        <div className="session-card__header">
          {isRenaming ? (
            <input
              ref={renameInputRef}
              type="text"
              className="session-card__rename-input"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={handleRenameKeyDown}
              onBlur={handleRenameBlur}
              autoFocus
            />
          ) : (
            <span className="session-card__title" title={session.title}>
              {searchQuery ? <HighlightText text={title} query={searchQuery} /> : title}
            </span>
          )}
          <span className="session-card__time">{time}</span>
        </div>

        <div className="session-card__preview">
          {searchQuery ? <HighlightText text={preview} query={searchQuery} /> : preview}
        </div>

        <div className="session-card__footer">
          <div className="session-card__tags">
            {session.source === 'codex' && (
              <span className="source-badge source-badge--cx">CX</span>
            )}
            {session.source === 'claude-code' && (
              <span className="source-badge source-badge--cc">CC</span>
            )}
            {session.source === 'gemini' && (
              <span className="source-badge source-badge--gm">GM</span>
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
          <span className="session-card__count">{session.fileSize > 0 ? formatFileSize(session.fileSize) : ''}</span>
        </div>
      </div>
    );
  };

  // Search input shared between all render paths
  const searchInputEl = onSearchChange && (
    <SearchInput
      value={searchQuery}
      onChange={onSearchChange}
      placeholder="搜索会话..."
      {...(selectedId
        ? { matchCurrent, matchTotal, onPrevMatch, onNextMatch }
        : { resultCount: sessionResultCount }
      )}
    />
  );

  // ── Search mode: split into title matches + content matches ──
  if (isSearchMode) {
    const totalCount = titleSorted.length + contentSorted.length;
    const noResults = !searching && totalCount === 0;

    return (
      <div className="session-list">
        <div className="session-list__header">
          <span>
            {searching
              ? t('chat.sessions')
              : t('chat.sessionsCount', { count: totalCount })}
          </span>
        </div>

        {searchInputEl}

        <div className="session-list__cards">
          {/* Title matches section — instant, hide when empty */}
          {titleSorted.length > 0 && (
            <>
              <div className="session-list__section-header">
                标题匹配 ({titleSorted.length})
              </div>
              {titleSorted.map(renderCard)}
            </>
          )}

          {/* Content matches section — skeleton while searching, cards when done */}
          {searching && (
            <>
              <div className="session-list__section-header session-list__section-header--loading">
                <span>搜索会话内容...</span>
                <span className="session-list__searching-indicator" />
              </div>
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={`skel-${i}`} className="session-list__skeleton-card">
                  <div className="session-list__skeleton-title" />
                  <div className="session-list__skeleton-preview" />
                  <div className="session-list__skeleton-footer" />
                </div>
              ))}
            </>
          )}

          {!searching && contentSorted.length > 0 && (
            <>
              <div className="session-list__section-header">
                内容匹配 ({contentSorted.length})
              </div>
              {contentSorted.map(renderCard)}
            </>
          )}

          {/* No results at all */}
          {noResults && (
            <div className="session-list__empty">无匹配会话</div>
          )}
        </div>
      </div>
    );
  }

  // ── Normal mode (no search) ──
  if (sortedSessions.length === 0) {
    return (
      <div className="session-list">
        <div className="session-list__header">
          <span>{t('chat.sessions')}</span>
        </div>
        {searchInputEl}
        <div className="session-list__cards">
          <div className="session-list__empty">{t('chat.noSessions')}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="session-list">
      <div className="session-list__header">
        <span>{t('chat.sessionsCount', { count: sortedSessions.length })}</span>
      </div>

      {searchInputEl}

      <div className="session-list__cards">
      {visibleSessions.map(renderCard)}

      {hasMore && (
        <LoadMoreSentinel onVisible={() => setVisibleCount(prev => prev + PAGE_SIZE)} />
      )}
      </div>
    </div>
  );
}
