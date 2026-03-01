/**
 * TerminalChatSidebar — 终端聊天历史侧边栏
 *
 * 显示当前终端 cwd 对应项目的最新聊天会话，支持实时更新。
 * 复用 SessionDetail 组件渲染聊天内容。
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { SessionDetail } from '../chat/SessionDetail';
import { useI18n } from '@/renderer/i18n';
import type { SessionSummary, SessionMessage } from '@/shared/types/chat.types';
import './TerminalChatSidebar.css';

/** Encode cwd to projectHash (same logic as main/ipc/chat-handlers.ts) */
function encodeProjectHash(cwd: string): string {
  if (!cwd) return '';
  return cwd.replace(/[^a-zA-Z0-9-]/g, '-');
}

interface Props {
  terminalId: string;
  cwd: string;
  onClose: () => void;
}

export function TerminalChatSidebar({ terminalId, cwd, onClose }: Props): JSX.Element {
  const { t } = useI18n();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [sessionsLoading, setSessionsLoading] = useState(true);

  const projectHash = useMemo(() => encodeProjectHash(cwd), [cwd]);

  // Fetch sessions when cwd changes
  useEffect(() => {
    if (!projectHash) {
      setSessions([]);
      setSelectedSessionId(null);
      setSessionsLoading(false);
      return;
    }
    setSessionsLoading(true);
    window.api.chat.getSessions(projectHash)
      .then((result: { sessions?: SessionSummary[] }) => {
        const list = result?.sessions || [];
        setSessions(list);
        // Auto-select most recent session
        if (list.length > 0) {
          setSelectedSessionId(list[0].sessionId);
        } else {
          setSelectedSessionId(null);
        }
      })
      .catch(() => {
        setSessions([]);
        setSelectedSessionId(null);
      })
      .finally(() => setSessionsLoading(false));
  }, [projectHash]);

  // Fetch messages when selected session changes
  useEffect(() => {
    if (!selectedSessionId || !projectHash) {
      setMessages([]);
      return;
    }
    setLoading(true);
    window.api.chat.getSession(projectHash, selectedSessionId)
      .then((result: { messages?: SessionMessage[] }) => setMessages(result?.messages || []))
      .catch(() => setMessages([]))
      .finally(() => setLoading(false));
  }, [selectedSessionId, projectHash]);

  // Listen for real-time session updates
  useEffect(() => {
    const unsub = window.api.chat.onSessionUpdate?.((data: { projectHash: string; sessionId: string }) => {
      if (data.projectHash === projectHash && data.sessionId === selectedSessionId) {
        window.api.chat.getSession(data.projectHash, data.sessionId)
          .then((result: { messages?: SessionMessage[] }) => setMessages(result?.messages || []))
          .catch(() => {});
      }
    });
    return () => { unsub?.(); };
  }, [projectHash, selectedSessionId]);

  const handleSessionChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedSessionId(e.target.value || null);
  }, []);

  const handleClose = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onClose();
  }, [onClose]);

  return (
    <div className="terminal-chat-sidebar">
      {/* Header: session selector + close button */}
      <div className="terminal-chat-sidebar__header">
        <select
          className="terminal-chat-sidebar__select"
          value={selectedSessionId || ''}
          onChange={handleSessionChange}
          disabled={sessionsLoading || sessions.length === 0}
        >
          {sessions.length === 0 && (
            <option value="">{sessionsLoading ? '...' : t('chat.noSessions' as any)}</option>
          )}
          {sessions.map((s) => (
            <option key={s.sessionId} value={s.sessionId}>
              {s.customTitle || s.title || s.sessionId.slice(0, 8)}
            </option>
          ))}
        </select>

        <button className="terminal-chat-sidebar__close" onClick={handleClose}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Chat content: reuse SessionDetail */}
      <div className="terminal-chat-sidebar__content">
        {sessions.length === 0 && !sessionsLoading ? (
          <div className="terminal-chat-sidebar__empty">
            {t('chat.selectSession' as any)}
          </div>
        ) : (
          <SessionDetail
            messages={messages}
            loading={loading}
          />
        )}
      </div>
    </div>
  );
}
