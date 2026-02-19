/**
 * D4: ChatHistoryPanel — 三栏容器
 * D8: 三栏联动交互（项目筛选 → 会话列表 → 详情 + 排序选项）
 *
 * 布局结构:
 * - 左栏 (220px, min 180px): ProjectList
 * - 中栏 (340px, min 280px): SessionList
 * - 右栏 (flex, min 400px): SessionDetail
 */

import React, { useState, useEffect, useCallback } from 'react';
import { ProjectList } from './ProjectList';
import { SessionList } from './SessionList';
import { SessionDetail } from './SessionDetail';
import type { SessionSummary, SessionMessage } from '@/shared/types/chat.types';
import './ChatHistoryPanel.css';

export type SortMode = 'time' | 'project';

export function ChatHistoryPanel() {
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [allSessions, setAllSessions] = useState<SessionSummary[]>([]);
  const [filteredSessions, setFilteredSessions] = useState<SessionSummary[]>([]);
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>('time');

  // Fetch all history on mount
  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const result = await window.api.chat.getHistory();
        setAllSessions(result?.sessions || []);
      } catch (error) {
        console.error('Failed to fetch chat history:', error);
        setAllSessions([]);
      }
    };
    fetchHistory();
  }, []);

  // D8: Filter by project + apply sort
  useEffect(() => {
    let list = selectedProject
      ? allSessions.filter((s: SessionSummary) => s.project === selectedProject)
      : allSessions;

    if (sortMode === 'project') {
      list = [...list].sort((a, b) => a.project.localeCompare(b.project) || b.timestamp - a.timestamp);
    }
    // 'time' sort is handled inside SessionList (default)

    setFilteredSessions(list);
    // Clear session selection when project changes
  }, [selectedProject, allSessions, sortMode]);

  const handleSelectProject = useCallback((project: string | null) => {
    setSelectedProject(project);
    setSelectedSessionId(null);
    setMessages([]);
  }, []);

  // Fetch session detail when selected session changes
  useEffect(() => {
    if (!selectedSessionId) {
      setMessages([]);
      return;
    }

    const fetchSession = async () => {
      const session = allSessions.find(s => s.sessionId === selectedSessionId);
      if (!session) {
        setMessages([]);
        return;
      }
      setLoading(true);
      try {
        const result = await window.api.chat.getSession(selectedSessionId, session.projectHash);
        setMessages(result?.messages || []);
      } catch (error) {
        console.error('Failed to fetch session:', error);
        setMessages([]);
      } finally {
        setLoading(false);
      }
    };

    fetchSession();
  }, [selectedSessionId, allSessions]);

  // Listen for real-time session updates
  useEffect(() => {
    const unsub = window.api.chat.onSessionUpdate?.((data: { sessionId: string }) => {
      // Refresh if the updated session is currently selected
      if (data.sessionId === selectedSessionId) {
        const session = allSessions.find(s => s.sessionId === data.sessionId);
        if (session) {
          window.api.chat.getSession(data.sessionId, session.projectHash).then((result: { messages?: SessionMessage[] }) => {
            setMessages(result?.messages || []);
          });
        }
      }
    });
    return () => unsub?.();
  }, [selectedSessionId, allSessions]);

  return (
    <div className="chat-history-panel">
      <div className="chat-history-panel__left">
        <ProjectList
          sessions={allSessions}
          onSelectProject={handleSelectProject}
          selectedProject={selectedProject}
        />
      </div>

      <div className="chat-history-panel__middle">
        <SessionList
          sessions={filteredSessions}
          selectedId={selectedSessionId}
          onSelect={setSelectedSessionId}
          sortMode={sortMode}
          onSortChange={setSortMode}
        />
      </div>

      <div className="chat-history-panel__right">
        <SessionDetail
          messages={messages}
          loading={loading}
        />
      </div>
    </div>
  );
}
