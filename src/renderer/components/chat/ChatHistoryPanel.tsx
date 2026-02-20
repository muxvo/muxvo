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
import type { ProjectInfo, SessionSummary, SessionMessage } from '@/shared/types/chat.types';
import './ChatHistoryPanel.css';

export type SortMode = 'time' | 'project';

export function ChatHistoryPanel() {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [selectedProjectHash, setSelectedProjectHash] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>('time');
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [sessionsLoading, setSessionsLoading] = useState(true);

  // Fetch projects on mount
  useEffect(() => {
    setProjectsLoading(true);
    window.api.chat.getProjects().then((result: { projects?: ProjectInfo[] }) => {
      setProjects(result?.projects || []);
    }).catch(() => setProjects([]))
    .finally(() => setProjectsLoading(false));
  }, []);

  // Fetch sessions when project changes
  useEffect(() => {
    setSessionsLoading(true);
    const hash = selectedProjectHash || '__all__';
    window.api.chat.getSessions(hash).then((result: { sessions?: SessionSummary[] }) => {
      setSessions(result?.sessions || []);
    }).catch(() => setSessions([]))
    .finally(() => setSessionsLoading(false));
  }, [selectedProjectHash]);

  const handleSelectProject = useCallback((projectHash: string | null) => {
    setSelectedProjectHash(projectHash);
    setSelectedSessionId(null);
    setMessages([]);
  }, []);

  // Fetch session detail
  useEffect(() => {
    if (!selectedSessionId) {
      setMessages([]);
      return;
    }
    const session = sessions.find(s => s.sessionId === selectedSessionId);
    if (!session) return;

    setLoading(true);
    window.api.chat.getSession(session.projectHash, selectedSessionId)
      .then((result: { messages?: SessionMessage[] }) => setMessages(result?.messages || []))
      .catch(() => setMessages([]))
      .finally(() => setLoading(false));
  }, [selectedSessionId, sessions]);

  // Listen for real-time session updates — only refresh the active session
  // Projects and sessions lists rely on cache + initial fetch; no need to re-scan
  // 128K files on every CC write event.
  useEffect(() => {
    const unsub = window.api.chat.onSessionUpdate?.((data: { projectHash: string; sessionId: string }) => {
      // Only refresh messages if the updated session is currently selected
      if (data.sessionId === selectedSessionId) {
        window.api.chat.getSession(data.projectHash, data.sessionId)
          .then((result: { messages?: SessionMessage[] }) => setMessages(result?.messages || []))
          .catch(() => {});
      }
    });
    return () => { unsub?.(); };
  }, [selectedSessionId]);

  const totalSessionCount = projects.reduce((sum, p) => sum + p.sessionCount, 0);

  return (
    <div className="chat-history-panel">
      <div className="chat-history-panel__left">
        {projectsLoading && projects.length === 0 ? (
          <div className="panel-skeleton">
            <div className="panel-skeleton__header" />
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="panel-skeleton__item">
                <div className="panel-skeleton__dot" />
                <div className="panel-skeleton__text" />
                <div className="panel-skeleton__badge" />
              </div>
            ))}
          </div>
        ) : (
          <ProjectList
            projects={projects}
            selectedProjectHash={selectedProjectHash}
            onSelectProject={handleSelectProject}
            totalSessionCount={totalSessionCount}
          />
        )}
      </div>

      <div className="chat-history-panel__middle">
        {sessionsLoading && sessions.length === 0 ? (
          <div className="panel-skeleton">
            <div className="panel-skeleton__header" />
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="panel-skeleton__card">
                <div className="panel-skeleton__title" />
                <div className="panel-skeleton__preview" />
                <div className="panel-skeleton__footer" />
              </div>
            ))}
          </div>
        ) : (
          <SessionList
            sessions={sessions}
            selectedId={selectedSessionId}
            onSelect={setSelectedSessionId}
            sortMode={sortMode}
            onSortChange={setSortMode}
          />
        )}
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
