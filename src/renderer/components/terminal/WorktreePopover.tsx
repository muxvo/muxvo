/**
 * WorktreePopover — Lightweight popover listing git worktrees for a terminal's repo.
 *
 * Shows:
 * - Current worktrees with branch names and status indicators
 * - "+ New Worktree" button to create a new worktree + terminal
 *
 * Follows CwdPicker portal pattern (createPortal → document.body).
 * Creates terminals directly via window.api + TerminalDispatch (no prop drilling).
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTerminalDispatch, useTerminalState } from '@/renderer/contexts/TerminalContext';
import type { WorktreeInfo } from '@/shared/types/worktree.types';
import './WorktreePopover.css';

interface Props {
  terminalCwd: string;
  open: boolean;
  anchorRect: { top: number; left: number } | null;
  onClose: () => void;
}

/** Shell-safe single-quote a path (handles spaces, special chars) */
function shellQuote(path: string): string {
  return `'${path.replace(/'/g, "'\\''")}'`;
}

/** Get cached terminal size (same helper used by TerminalContext) */
function getTerminalSizeCache(): { cols: number; rows: number } {
  try {
    const cached = sessionStorage.getItem('muxvo:termSize');
    if (cached) return JSON.parse(cached);
  } catch { /* ignore */ }
  return { cols: 80, rows: 24 };
}

export function WorktreePopover({
  terminalCwd,
  open,
  anchorRect,
  onClose,
}: Props) {
  const popupRef = useRef<HTMLDivElement>(null);
  const terminalState = useTerminalState();
  const terminalDispatch = useTerminalDispatch();
  const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([]);
  const [repoPath, setRepoPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Detect repo and load worktrees when opened
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const detectResult = await window.api.worktree.detectRepo(terminalCwd);
        if (cancelled) return;
        if (!detectResult.success || !detectResult.data?.isRepo) {
          setError('Not a git repository');
          setLoading(false);
          return;
        }
        const repo = detectResult.data.repoPath!;
        setRepoPath(repo);

        const listResult = await window.api.worktree.list(repo);
        if (cancelled) return;
        if (listResult.success && listResult.data) {
          setWorktrees(listResult.data);
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [open, terminalCwd]);

  // Esc to close
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  // Click outside to close
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    window.addEventListener('mousedown', handleClick);
    return () => window.removeEventListener('mousedown', handleClick);
  }, [open, onClose]);

  /** Create a terminal at the given cwd and sync with TerminalContext. Returns terminal ID. */
  const createTerminalAt = useCallback(async (cwd: string): Promise<string | null> => {
    const { cols, rows } = getTerminalSizeCache();
    const result = await window.api.terminal.create(cwd, cols, rows);
    if (result?.success && result.data) {
      terminalDispatch({
        type: 'ADD_TERMINAL',
        entry: { id: result.data.id, state: 'Running', cwd },
      });
      terminalDispatch({ type: 'SET_SELECTED', id: result.data.id });
      return result.data.id;
    }
    return null;
  }, [terminalDispatch]);

  const handleCreateWorktree = useCallback(async () => {
    if (!repoPath || creating) return;
    setCreating(true);
    setError(null);
    try {
      const result = await window.api.worktree.create(repoPath);
      if (result.success && result.data) {
        const terminalId = await createTerminalAt(result.data.worktreePath);
        if (terminalId) {
          // Shell --login sources .zshrc which may cd elsewhere.
          // After shell init, cd back to worktree dir and clear screen.
          const wtPath = result.data.worktreePath;
          setTimeout(() => {
            window.api.terminal.write(terminalId, `cd ${shellQuote(wtPath)} && clear\r`);
          }, 800);
        }

        // Close the main terminal (non-worktree terminal in the same repo)
        const mainTerminal = terminalState.terminals.find((t) => {
          const isInRepo = t.cwd === repoPath || t.cwd.startsWith(repoPath + '/');
          const isWorktree = t.cwd.includes('/.worktrees/');
          return isInRepo && !isWorktree;
        });
        if (mainTerminal) {
          window.api.terminal.close(mainTerminal.id);
          terminalDispatch({ type: 'REMOVE_TERMINAL', id: mainTerminal.id });
        }

        onClose();
        // Refresh list in background (for next open)
        const listResult = await window.api.worktree.list(repoPath);
        if (listResult.success && listResult.data) {
          setWorktrees(listResult.data);
        }
      } else {
        setError(result.error?.message || 'Failed to create worktree');
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setCreating(false);
    }
  }, [repoPath, creating, createTerminalAt, onClose, terminalState.terminals, terminalDispatch]);

  const handleDeleteWorktree = useCallback(async (wt: WorktreeInfo) => {
    if (!repoPath) return;
    setError(null);
    try {
      const result = await window.api.worktree.remove(wt.path, true);
      if (result.success) {
        // Refresh list
        const listResult = await window.api.worktree.list(repoPath);
        if (listResult.success && listResult.data) {
          setWorktrees(listResult.data);
        }
      } else {
        setError(result.error?.message || 'Failed to delete worktree');
      }
    } catch (e) {
      setError(String(e));
    }
  }, [repoPath]);

  const handleWorktreeClick = useCallback(async (wt: WorktreeInfo) => {
    const terminalId = await createTerminalAt(wt.path);
    if (terminalId) {
      setTimeout(() => {
        window.api.terminal.write(terminalId, `cd ${shellQuote(wt.path)} && clear\r`);
      }, 800);
    }
    onClose();
  }, [createTerminalAt, onClose]);

  if (!open || !anchorRect) return null;

  // Viewport boundary detection
  const popoverWidth = 280;
  const popoverHeight = 200;
  let top = anchorRect.top;
  let left = anchorRect.left;

  if (left + popoverWidth > window.innerWidth) {
    left = window.innerWidth - popoverWidth - 8;
  }
  if (left < 8) left = 8;
  if (top + popoverHeight > window.innerHeight) {
    top = anchorRect.top - popoverHeight - 8;
  }

  // Find which worktree the current terminal is in
  const currentWorktree = worktrees.find(
    (wt) => terminalCwd === wt.path || terminalCwd.startsWith(wt.path + '/')
  );

  return createPortal(
    <div className="worktree-popover-overlay" onClick={onClose}>
      <div
        className="worktree-popover"
        ref={popupRef}
        style={{ top, left }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="worktree-popover__header">Worktrees</div>

        {/* "+ New Worktree" at the top, always visible */}
        {!loading && !error && repoPath && (
          <>
            <button
              className="worktree-popover__create"
              onClick={handleCreateWorktree}
              disabled={creating}
            >
              {creating ? 'Creating...' : '+ New Worktree (from main)'}
            </button>
            <div className="worktree-popover__divider" />
          </>
        )}

        {loading && (
          <div className="worktree-popover__loading">Loading...</div>
        )}

        {error && (
          <div className="worktree-popover__error">{error}</div>
        )}

        {!loading && !error && (
          <div className="worktree-popover__list">
            {worktrees.map((wt) => {
              const isCurrent = currentWorktree?.path === wt.path;
              return (
                <button
                  key={wt.path}
                  className={`worktree-popover__item${isCurrent ? ' worktree-popover__item--current' : ''}`}
                  onClick={() => handleWorktreeClick(wt)}
                  title={wt.path}
                >
                  <span className={`worktree-popover__dot${wt.isMain ? ' worktree-popover__dot--main' : ''}`} />
                  <span className="worktree-popover__branch">{wt.branch}</span>
                  {isCurrent && <span className="worktree-popover__badge worktree-popover__badge--current">current</span>}
                  {wt.isMerged && !wt.isMain && (
                    <>
                      <span className="worktree-popover__badge worktree-popover__badge--merged">merged</span>
                      <span
                        className="worktree-popover__delete"
                        onClick={(e) => { e.stopPropagation(); handleDeleteWorktree(wt); }}
                        title="Delete worktree"
                        role="button"
                      >✕</span>
                    </>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
