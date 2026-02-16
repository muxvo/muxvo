/**
 * D6: SessionList — 中栏会话卡片列表
 *
 * 功能:
 * - 每张卡片: 标题 + 时间 + 预览(2行截断) + 标签 + 工具调用计数
 * - 时间格式: "HH:MM" / "yesterday" / "MM-DD"
 * - 标签: 关键词匹配 display 字段 → feat/fix/refactor/plan
 * - 按 timestamp 倒序
 */

import React, { useState, useMemo } from 'react';
import type { HistoryEntry } from '@/shared/types/chat.types';
import type { SortMode } from './ChatHistoryPanel';
import './SessionList.css';

const PAGE_SIZE = 50;

interface SessionListProps {
  sessions: HistoryEntry[];
  selectedId: string | null;
  onSelect: (sessionId: string) => void;
  sortMode?: SortMode;
  onSortChange?: (mode: SortMode) => void;
}

/**
 * Format timestamp to relative time
 */
function formatTime(timestamp: number): string {
  const now = new Date();
  const date = new Date(timestamp);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (dateOnly.getTime() === today.getTime()) {
    // Today: show time
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  } else if (dateOnly.getTime() === yesterday.getTime()) {
    return 'yesterday';
  } else {
    // Other: show MM-DD
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${month}-${day}`;
  }
}

/**
 * Extract tags from display text based on keywords
 */
function extractTags(display: string): Array<{ label: string; color: string }> {
  const tags: Array<{ label: string; color: string }> = [];
  const lowerDisplay = display.toLowerCase();

  if (lowerDisplay.includes('feat') || lowerDisplay.includes('feature')) {
    tags.push({ label: 'feat', color: '#4caf50' });
  }
  if (lowerDisplay.includes('fix') || lowerDisplay.includes('bug')) {
    tags.push({ label: 'fix', color: '#f44336' });
  }
  if (lowerDisplay.includes('refactor')) {
    tags.push({ label: 'refactor', color: '#2196f3' });
  }
  if (lowerDisplay.includes('plan')) {
    tags.push({ label: 'plan', color: '#9c27b0' });
  }

  return tags;
}

export function SessionList({ sessions, selectedId, onSelect, sortMode = 'time', onSortChange }: SessionListProps) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Reset visible count when sessions change (e.g. project filter)
  const sessionKey = useMemo(() => sessions.map(s => s.sessionId).join(','), [sessions]);
  useMemo(() => { setVisibleCount(PAGE_SIZE); }, [sessionKey]);

  // Sort by timestamp descending (default)
  const sortedSessions = useMemo(() => {
    return [...sessions].sort((a, b) => b.timestamp - a.timestamp);
  }, [sessions]);

  const visibleSessions = sortedSessions.slice(0, visibleCount);
  const hasMore = sortedSessions.length > visibleCount;

  if (sortedSessions.length === 0) {
    return (
      <div className="session-list">
        <div className="session-list__header">
          <span>会话</span>
          {onSortChange && (
            <div className="session-list__sort">
              <button
                className={`session-list__sort-btn ${sortMode === 'time' ? 'session-list__sort-btn--active' : ''}`}
                onClick={() => onSortChange('time')}
              >时间</button>
              <button
                className={`session-list__sort-btn ${sortMode === 'project' ? 'session-list__sort-btn--active' : ''}`}
                onClick={() => onSortChange('project')}
              >项目</button>
            </div>
          )}
        </div>
        <div className="session-list__empty">暂无会话记录</div>
      </div>
    );
  }

  return (
    <div className="session-list">
      <div className="session-list__header">
        <span>会话 ({sortedSessions.length})</span>
        {onSortChange && (
          <div className="session-list__sort">
            <button
              className={`session-list__sort-btn ${sortMode === 'time' ? 'session-list__sort-btn--active' : ''}`}
              onClick={() => onSortChange('time')}
            >时间</button>
            <button
              className={`session-list__sort-btn ${sortMode === 'project' ? 'session-list__sort-btn--active' : ''}`}
              onClick={() => onSortChange('project')}
            >项目</button>
          </div>
        )}
      </div>

      {visibleSessions.map((session) => {
        const title = session.display.slice(0, 50);
        const preview = session.display.slice(0, 100);
        const time = formatTime(session.timestamp);
        const tags = extractTags(session.display);
        const isSelected = session.sessionId === selectedId;

        return (
          <div
            key={session.sessionId}
            className={`session-card ${isSelected ? 'session-card--selected' : ''}`}
            onClick={() => onSelect(session.sessionId)}
          >
            <div className="session-card__header">
              <span className="session-card__title" title={session.display}>
                {title}
              </span>
              <span className="session-card__time">{time}</span>
            </div>

            <div className="session-card__preview">{preview}</div>

            <div className="session-card__footer">
              <div className="session-card__tags">
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
            </div>
          </div>
        );
      })}

      {hasMore && (
        <button
          className="session-list__load-more"
          onClick={() => setVisibleCount(prev => prev + PAGE_SIZE)}
        >
          加载更多 ({sortedSessions.length - visibleCount} 条)
        </button>
      )}
    </div>
  );
}
