/**
 * D4: ChatHistoryPanel — 三栏容器
 * D8: 三栏联动交互（项目筛选 → 会话列表 → 详情 + 排序选项）
 *
 * 布局结构:
 * - 左栏 (220px, min 180px): ProjectList
 * - 中栏 (340px, min 280px): SessionList
 * - 右栏 (flex, min 400px): SessionDetail
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { ProjectList } from './ProjectList';
import { SessionList } from './SessionList';
import { SessionDetail } from './SessionDetail';
import type { SessionDetailHandle } from './SessionDetail';
import { useI18n } from '@/renderer/i18n';
import type { ProjectInfo, SessionSummary, SessionMessage, SearchResult, ChatSource } from '@/shared/types/chat.types';
import { trackEvent, trackError } from '@/renderer/hooks/useAnalytics';
import { ANALYTICS_EVENTS } from '@/shared/constants/analytics-events';
import './ChatHistoryPanel.css';


/** Isolated banner component — progress updates only re-render this subtree */
function ArchiveBanner({ onDismiss }: { onDismiss: () => void }) {
  const { t } = useI18n();
  const [archiveEnabled, setArchiveEnabled] = useState(true);
  const [archiveProgress, setArchiveProgress] = useState<{ synced: number; total: number } | null>(null);

  useEffect(() => {
    const chatApi = window.api.chat as any;
    if (chatApi.getArchiveEnabled) {
      chatApi.getArchiveEnabled().then((v: boolean) => setArchiveEnabled(v)).catch(() => {});
    }
  }, []);

  useEffect(() => {
    const chatApi = window.api.chat as any;
    if (!chatApi.onArchiveProgress) return;
    const unsub = chatApi.onArchiveProgress((data: { synced: number; total: number }) => {
      if (data.synced >= data.total) {
        setTimeout(() => setArchiveProgress(null), 2000);
      }
      setArchiveProgress(data);
    });
    return () => { unsub?.(); };
  }, []);

  const handleToggle = useCallback(() => {
    const next = !archiveEnabled;
    setArchiveEnabled(next);
    const chatApi = window.api.chat as any;
    if (chatApi.setArchiveEnabled) {
      chatApi.setArchiveEnabled(next).catch(() => {});
    }
  }, [archiveEnabled]);

  return (
    <div className="chat-archive-banner">
      <span className="chat-archive-banner__text">
        {archiveProgress && archiveProgress.total > 0
          ? t('chat.archiving' as any, { synced: archiveProgress.synced, total: archiveProgress.total })
          : t('chat.archiveNotice' as any)}
      </span>
      <div className="chat-archive-banner__actions">
        <label className="chat-archive-toggle">
          <input
            type="checkbox"
            checked={archiveEnabled}
            onChange={handleToggle}
          />
          <span>{archiveEnabled ? t('chat.archiveOn' as any) : t('chat.archiveOff' as any)}</span>
        </label>
        <button className="chat-archive-banner__close" onClick={onDismiss}>
          &times;
        </button>
      </div>
    </div>
  );
}

interface ChatHistoryPanelProps {
  onResumeSession?: (info: { sessionId: string; cwd: string; source: ChatSource; customTitle?: string }) => void;
}

export function ChatHistoryPanel(props: ChatHistoryPanelProps) {
  const { t } = useI18n();
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [selectedProjectHash, setSelectedProjectHash] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(
    () => localStorage.getItem('muxvo-archive-notice-dismissed') === 'true'
  );

  // Search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Match navigation (bridged from SessionDetail to SearchInput)
  const detailRef = useRef<SessionDetailHandle>(null);
  const [matchInfo, setMatchInfo] = useState({ current: 0, total: 0 });
  const handleMatchInfoChange = useCallback((current: number, total: number) => {
    setMatchInfo({ current, total });
  }, []);

  // Debounced full-text search via backend
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);

    if (!searchQuery.trim()) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    searchTimerRef.current = setTimeout(() => {
      window.api.chat.search(searchQuery.trim())
        .then((result: { results?: SearchResult[] }) => {
          const results = result?.results || [];
          setSearchResults(results);
          trackEvent(ANALYTICS_EVENTS.CHAT.SEARCH, { query_length: searchQuery.trim().length, result_count: results.length });
        })
        .catch((err) => { trackError('ipc', { channel: 'chat:search', message: String(err) }); console.error('[chat:search]', err); setSearchResults([]); })
        .finally(() => setSearching(false));
    }, 300);

    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [searchQuery]);

  // Filter search results by current project (no-op for "all projects")
  const projectFilteredResults = useMemo(() => {
    if (!selectedProjectHash) return searchResults;
    return searchResults.filter(r => r.projectHash === selectedProjectHash);
  }, [searchResults, selectedProjectHash]);

  // Snippet lookup: sessionId → snippet text
  const searchSnippets = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of projectFilteredResults) {
      map.set(r.sessionId, r.snippet);
    }
    return map;
  }, [projectFilteredResults]);

  // Title matches: instant client-side filtering (independent of backend results)
  const titleMatchedSessions = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return sessions.filter(s =>
      s.title.toLowerCase().includes(q)
      || (s.customTitle && s.customTitle.toLowerCase().includes(q))
    );
  }, [sessions, searchQuery]);

  // Content matches: from backend searchResults, excluding sessions already in title matches
  const contentMatchedSessions = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const titleIds = new Set(titleMatchedSessions.map(s => s.sessionId));
    const result: SessionSummary[] = [];
    const seen = new Set<string>();

    for (const r of projectFilteredResults) {
      if (titleIds.has(r.sessionId) || seen.has(r.sessionId)) continue;
      seen.add(r.sessionId);
      // Use loaded session data if available, otherwise create placeholder
      const loaded = sessions.find(s => s.sessionId === r.sessionId);
      if (loaded) {
        result.push(loaded);
      } else {
        const cleanSnippet = r.snippet.replace(/\s+/g, ' ').trim();
        result.push({
          sessionId: r.sessionId,
          projectHash: r.projectHash,
          title: cleanSnippet.slice(0, 60) || r.sessionId.slice(0, 8),
          startedAt: r.timestamp,
          lastModified: r.timestamp ? new Date(r.timestamp).getTime() : 0,
          fileSize: -1,
          source: 'claude-code',
        });
      }
    }

    return result;
  }, [searchQuery, titleMatchedSessions, sessions, projectFilteredResults]);

  // Combined for backward compat (e.g. sessionResultCount)
  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return sessions;
    return [...titleMatchedSessions, ...contentMatchedSessions];
  }, [searchQuery, sessions, titleMatchedSessions, contentMatchedSessions]);

  const sessionResultCount = searchQuery.trim()
    ? (searching ? undefined : filteredSessions.length)
    : 0;

  const handleDismissBanner = useCallback(() => {
    localStorage.setItem('muxvo-archive-notice-dismissed', 'true');
    setBannerDismissed(true);
  }, []);

  // Fetch projects on mount
  useEffect(() => {
    setProjectsLoading(true);
    window.api.chat.getProjects().then((result: { projects?: ProjectInfo[] }) => {
      setProjects(result?.projects || []);
    }).catch((err) => { trackError('ipc', { channel: 'chat:getProjects', message: String(err) }); setProjects([]); })
    .finally(() => setProjectsLoading(false));
  }, []);

  // Fetch sessions after projects are loaded (progressive disclosure)
  useEffect(() => {
    if (projectsLoading) return;
    setSessionsLoading(true);
    const hash = selectedProjectHash || '__all__';
    window.api.chat.getSessions(hash).then((result: { sessions?: SessionSummary[] }) => {
      setSessions(result?.sessions || []);
    }).catch((err) => { trackError('ipc', { channel: 'chat:getSessions', message: String(err) }); setSessions([]); })
    .finally(() => setSessionsLoading(false));
  }, [selectedProjectHash, projectsLoading]);

  const handleSelectProject = useCallback((projectHash: string | null) => {
    setSelectedProjectHash(projectHash);
    setSelectedSessionId(null);
    setMessages([]);
  }, []);

  // Use refs to access sessions/searchResults without adding as useEffect dependency
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const searchResultsRef = useRef(searchResults);
  searchResultsRef.current = searchResults;

  // Fetch session detail — only re-run when selectedSessionId changes
  useEffect(() => {
    if (!selectedSessionId) {
      setMessages([]);
      return;
    }
    // Look up projectHash from loaded sessions first, then search results
    let projectHash = sessionsRef.current.find(s => s.sessionId === selectedSessionId)?.projectHash;
    if (!projectHash) {
      projectHash = searchResultsRef.current.find(r => r.sessionId === selectedSessionId)?.projectHash;
    }
    if (!projectHash) return;

    setLoading(true);
    window.api.chat.getSession(projectHash, selectedSessionId)
      .then((result: { messages?: SessionMessage[] }) => setMessages(result?.messages || []))
      .catch((err) => { trackError('ipc', { channel: 'chat:getSession', message: String(err) }); setMessages([]); })
      .finally(() => setLoading(false));
  }, [selectedSessionId]);

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

  // Right-click context menu on session cards
  const handleSessionContextMenu = useCallback(async (session: SessionSummary, x: number, y: number) => {
    const chatApi = window.api.chat as any;
    if (!chatApi.showSessionMenu) return;
    const action = await chatApi.showSessionMenu(x, y);
    if (action === 'rename') {
      setRenamingSessionId(session.sessionId);
    } else if (action === 'export') {
      try {
        const result = await window.api.chat.export(session.projectHash, session.sessionId, 'markdown', session.customTitle || session.title) as { outputPath?: string };
        if (result?.outputPath) {
          trackEvent(ANALYTICS_EVENTS.CHAT.EXPORT, { format: 'markdown' });
          const chatApi = window.api.chat as any;
          chatApi.revealFile?.(result.outputPath);
        }
      } catch { /* ignore */ }
    } else if (action === 'delete') {
      if (!window.confirm(t('chat.deleteConfirm' as any))) return;
      try {
        await chatApi.deleteSession(session.projectHash, session.sessionId);
        // Refresh session list
        setSessions(prev => prev.filter(s => s.sessionId !== session.sessionId));
        if (selectedSessionId === session.sessionId) {
          setSelectedSessionId(null);
          setMessages([]);
        }
      } catch { /* ignore */ }
    }
  }, [t, selectedSessionId]);

  const handleRenameConfirm = useCallback(async (sessionId: string, newName: string) => {
    setRenamingSessionId(null);
    try {
      await window.api.chat.setSessionName('', newName, sessionId);
      setSessions(prev => prev.map(s =>
        s.sessionId === sessionId
          ? { ...s, customTitle: newName || undefined }
          : s
      ));
    } catch { /* ignore */ }
  }, []);

  const handleRenameCancel = useCallback(() => {
    setRenamingSessionId(null);
  }, []);

  return (
    <div className="chat-history-panel">
      {!bannerDismissed && (
        <ArchiveBanner onDismiss={handleDismissBanner} />
      )}
      <div className="chat-history-panel__columns">
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
            sessions={filteredSessions}
            titleMatchedSessions={titleMatchedSessions}
            contentMatchedSessions={contentMatchedSessions}
            selectedId={selectedSessionId}
            onSelect={setSelectedSessionId}
            onSessionContextMenu={handleSessionContextMenu}
            renamingSessionId={renamingSessionId}
            onRenameConfirm={handleRenameConfirm}
            onRenameCancel={handleRenameCancel}
            projects={projects}
            showProjectName={selectedProjectHash === null}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            searching={searching}
            searchSnippets={searchSnippets}
            sessionResultCount={sessionResultCount}
            matchCurrent={matchInfo.current}
            matchTotal={matchInfo.total}
            onPrevMatch={() => detailRef.current?.goToPrevMatch()}
            onNextMatch={() => detailRef.current?.goToNextMatch()}
          />
        )}
      </div>

      <div className="chat-history-panel__right">
        <SessionDetail
          ref={detailRef}
          messages={messages}
          loading={loading}
          searchQuery={searchQuery}
          onMatchInfoChange={handleMatchInfoChange}
          canResume={(() => {
            const sel = sessions.find(s => s.sessionId === selectedSessionId);
            if (!sel) return false;
            const source = sel.source || 'claude-code';
            if (source !== 'claude-code' && source !== 'codex') return false;
            // Need either session-level cwd or loaded messages with cwd
            const hasCwd = sel.cwd || messages.some(m => m.cwd);
            if (!hasCwd && (messages.length === 0 || loading)) return false;
            return !!hasCwd;
          })()}
          onResumeSession={async () => {
            const sel = sessions.find(s => s.sessionId === selectedSessionId);
            if (!sel) return;

            // Archive-only session: 先恢复 .jsonl 到 CC 目录
            if (sel.archiveOnly) {
              try {
                const result = await (window.api.chat as any).restoreSession(sel.projectHash, sel.sessionId);
                if (!result?.success) {
                  console.error('[resume-chat] restore failed:', result);
                  return;
                }
                console.log('[resume-chat] session restored from archive:', { sessionId: sel.sessionId, restored: result.restored });
              } catch (err) {
                console.error('[resume-chat] restore error:', err);
                return;
              }
            }

            const proj = projects.find(p => p.projectHash === sel.projectHash);
            // Priority: session summary cwd > message cwd > project displayPath
            const msgCwd = messages.find(m => m.cwd)?.cwd;
            const cwd = sel.cwd || msgCwd || proj?.displayPath;

            console.log('[resume-chat] cwd resolution:', {
              sessionId: sel.sessionId,
              projectHash: sel.projectHash,
              selCwd: sel.cwd,
              msgCwd,
              displayPath: proj?.displayPath,
              finalCwd: cwd,
            });

            if (!cwd) {
              console.error('[resume-chat] No cwd found, cannot resume');
              return;
            }
            trackEvent(ANALYTICS_EVENTS.CHAT.RESUME, { source: sel.source || 'claude-code' });
            props.onResumeSession?.({
              sessionId: sel.sessionId,
              cwd,
              source: sel.source || 'claude-code',
              customTitle: sel.customTitle,
            });
          }}
        />
      </div>
      </div>
    </div>
  );
}
