/**
 * TerminalContext — Centralized terminal state management
 * Decouples terminal lifecycle logic from App.tsx
 *
 * Follows the same reducer + dispatch-only context pattern as PanelContext.
 */

import {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  type Dispatch,
  type ReactNode,
} from 'react';
import { trackEvent, trackError } from '../hooks/useAnalytics';
import { ANALYTICS_EVENTS } from '@/shared/constants/analytics-events';
import { termLog } from '../utils/term-debug-logger';
import { getTerminalSizeCache } from '../utils/terminal-size-cache';
import type { ChatSource } from '@/shared/types/chat.types';

// ── State Shape ──

const MAX_TERMINALS = 20;

export interface TerminalEntry {
  id: string;
  state: string;
  cwd: string;
}

export interface CloseConfirmState {
  open: boolean;
  terminalId: string;
  processName: string;
}

export interface TerminalState {
  terminals: TerminalEntry[];
  terminalOrder: string[];
  viewMode: 'Tiling' | 'Focused';
  focusedId: string | null;
  selectedId: string | null;
  activeSidebarId: string | null;
  terminalNames: Record<string, string>;
  closeConfirm: CloseConfirmState;
}

export const initialTerminalState: TerminalState = {
  terminals: [],
  terminalOrder: [],
  viewMode: 'Tiling',
  focusedId: null,
  selectedId: null,
  activeSidebarId: null,
  terminalNames: {},
  closeConfirm: { open: false, terminalId: '', processName: '' },
};

// ── Actions ──

type TerminalAction =
  | { type: 'SET_TERMINALS'; entries: TerminalEntry[] }
  | { type: 'ADD_TERMINAL'; entry: TerminalEntry }
  | { type: 'REMOVE_TERMINAL'; id: string }
  | { type: 'UPDATE_STATE'; id: string; state: string }
  | { type: 'UPDATE_CWD'; id: string; cwd: string }
  | { type: 'RENAME'; id: string; name: string }
  | { type: 'REORDER'; newOrder: string[] }
  | { type: 'SET_VIEW_MODE'; mode: 'Tiling' | 'Focused' }
  | { type: 'SET_FOCUSED'; id: string | null }
  | { type: 'SET_SELECTED'; id: string | null }
  | { type: 'SET_ACTIVE_SIDEBAR'; id: string | null }
  | { type: 'OPEN_CLOSE_CONFIRM'; terminalId: string; processName: string }
  | { type: 'CLOSE_CLOSE_CONFIRM' };

// ── Reducer ──

export function terminalReducer(state: TerminalState, action: TerminalAction): TerminalState {
  switch (action.type) {
    case 'SET_TERMINALS':
      return {
        ...state,
        terminals: action.entries,
        terminalOrder: action.entries.map((e) => e.id),
      };

    case 'ADD_TERMINAL':
      return {
        ...state,
        terminals: [...state.terminals, action.entry],
        terminalOrder: [...state.terminalOrder, action.entry.id],
      };

    case 'REMOVE_TERMINAL': {
      const names = { ...state.terminalNames };
      delete names[action.id];
      return {
        ...state,
        terminals: state.terminals.filter((t) => t.id !== action.id),
        terminalOrder: state.terminalOrder.filter((id) => id !== action.id),
        terminalNames: names,
        focusedId: state.focusedId === action.id ? null : state.focusedId,
        selectedId: state.selectedId === action.id ? null : state.selectedId,
        viewMode: state.focusedId === action.id ? 'Tiling' : state.viewMode,
      };
    }

    case 'UPDATE_STATE': {
      const target = state.terminals.find((t) => t.id === action.id);
      if (target && target.state === action.state) return state; // Same state — skip re-render
      return {
        ...state,
        terminals: state.terminals.map((t) =>
          t.id === action.id ? { ...t, state: action.state } : t
        ),
      };
    }

    case 'UPDATE_CWD':
      return {
        ...state,
        terminals: state.terminals.map((t) =>
          t.id === action.id ? { ...t, cwd: action.cwd } : t
        ),
      };

    case 'RENAME': {
      const names = { ...state.terminalNames };
      if (!action.name) {
        delete names[action.id];
      } else {
        names[action.id] = action.name;
      }
      return { ...state, terminalNames: names };
    }

    case 'REORDER':
      return { ...state, terminalOrder: action.newOrder };

    case 'SET_VIEW_MODE':
      return {
        ...state,
        viewMode: action.mode,
        activeSidebarId: action.mode === 'Tiling' ? null : state.activeSidebarId,
      };

    case 'SET_FOCUSED':
      return { ...state, focusedId: action.id, activeSidebarId: null };

    case 'SET_SELECTED':
      return { ...state, selectedId: action.id };

    case 'SET_ACTIVE_SIDEBAR':
      return { ...state, activeSidebarId: action.id };

    case 'OPEN_CLOSE_CONFIRM':
      return {
        ...state,
        closeConfirm: { open: true, terminalId: action.terminalId, processName: action.processName },
      };

    case 'CLOSE_CLOSE_CONFIRM':
      return {
        ...state,
        closeConfirm: { open: false, terminalId: '', processName: '' },
      };

    default:
      return state;
  }
}

// ── Contexts ──

const TerminalStateContext = createContext<TerminalState | null>(null);
const TerminalDispatchContext = createContext<Dispatch<TerminalAction> | null>(null);

// ── Provider ──

export function TerminalProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, dispatch] = useReducer(terminalReducer, initialTerminalState);

  // Load existing terminals on mount
  useEffect(() => {
    window.api.terminal.list().then((result: { success: boolean; data?: any[] }) => {
      if (result?.success && result.data) {
        const entries = result.data.map((info: any) => ({
          id: info.id,
          state: info.state,
          cwd: info.cwd || '/',
        }));
        dispatch({ type: 'SET_TERMINALS', entries });
        // Restore custom names from main process
        for (const info of result.data) {
          if (info.customName) {
            dispatch({ type: 'RENAME', id: info.id, name: info.customName });
          }
        }
      }
    });
  }, []);

  // Subscribe to IPC events
  useEffect(() => {
    const unsubExit = window.api.terminal.onExit((event) => {
      dispatch({ type: 'REMOVE_TERMINAL', id: event.id });
    });

    const unsubState = window.api.terminal.onStateChange((event) => {
      dispatch({ type: 'UPDATE_STATE', id: event.id, state: event.state });
    });

    const unsubListUpdated = window.api.terminal.onListUpdated?.((list: any[]) => {
      const entries = list.map((info: any) => ({
        id: info.id,
        state: info.state,
        cwd: info.cwd || '/',
      }));
      dispatch({ type: 'SET_TERMINALS', entries });
      // Restore custom names from main process
      for (const info of list) {
        if (info.customName) {
          dispatch({ type: 'RENAME', id: info.id, name: info.customName });
        }
      }
    });

    const unsubCwd = window.api.terminal.onCwdChange?.((event) => {
      dispatch({ type: 'UPDATE_CWD', id: event.id, cwd: event.cwd });
    });

    return () => {
      unsubExit();
      unsubState();
      unsubListUpdated?.();
      unsubCwd?.();
    };
  }, []);

  // Clear focused state if the focused terminal is removed
  useEffect(() => {
    if (state.focusedId && !state.terminals.find((t) => t.id === state.focusedId)) {
      dispatch({ type: 'SET_VIEW_MODE', mode: 'Tiling' });
      dispatch({ type: 'SET_FOCUSED', id: null });
    }
    if (state.selectedId && !state.terminals.find((t) => t.id === state.selectedId)) {
      dispatch({ type: 'SET_SELECTED', id: null });
    }
  }, [state.terminals, state.focusedId, state.selectedId]);

  // Esc key exits focused mode (only when focus is NOT inside a terminal)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape' && state.viewMode === 'Focused') {
        const active = document.activeElement;
        const isInTerminal = active?.closest('.xterm') !== null;
        if (!isInTerminal) {
          dispatch({ type: 'SET_VIEW_MODE', mode: 'Tiling' });
          dispatch({ type: 'SET_FOCUSED', id: null });
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state.viewMode]);

  return (
    <TerminalDispatchContext.Provider value={dispatch}>
      <TerminalStateContext.Provider value={state}>
        {children}
      </TerminalStateContext.Provider>
    </TerminalDispatchContext.Provider>
  );
}

// ── Hooks ──

export function useTerminalState(): TerminalState {
  const state = useContext(TerminalStateContext);
  if (!state) {
    throw new Error('useTerminalState must be used within a TerminalProvider');
  }
  return state;
}

export function useTerminalDispatch(): Dispatch<TerminalAction> {
  const dispatch = useContext(TerminalDispatchContext);
  if (!dispatch) {
    throw new Error('useTerminalDispatch must be used within a TerminalProvider');
  }
  return dispatch;
}

/** Derived data: ordered terminals with custom names merged */
export function useOrderedTerminals(): (TerminalEntry & { customName?: string })[] {
  const state = useTerminalState();
  return useMemo(() => {
    return (state.terminalOrder.length > 0
      ? state.terminalOrder
          .map((id) => state.terminals.find((t) => t.id === id))
          .filter((t): t is TerminalEntry => t !== undefined)
      : state.terminals
    ).map((t) => ({ ...t, customName: state.terminalNames[t.id] }));
  }, [state.terminals, state.terminalOrder, state.terminalNames]);
}

/** Async terminal actions that combine IPC calls with dispatch */
export function useTerminalActions() {
  const dispatch = useTerminalDispatch();
  const stateRef = useRef<TerminalState>(initialTerminalState);

  // Keep ref in sync — used by handleRename to access terminal cwd without
  // adding state to callback deps
  const state = useTerminalState();
  stateRef.current = state;

  // Double-click-to-focus setting (default: false)
  const doubleClickToFocusRef = useRef(false);
  useEffect(() => {
    const loadConfig = () => {
      window.api.app.getConfig().then((result: any) => {
        doubleClickToFocusRef.current = result?.data?.doubleClickToFocus === true;
      }).catch(() => {});
    };
    loadConfig();
    window.addEventListener('muxvo:config-changed', loadConfig);
    return () => window.removeEventListener('muxvo:config-changed', loadConfig);
  }, []);

  const addTerminal = useCallback(async (cwd?: string) => {
    const home = window.api.app.getHomePath();
    const targetCwd = cwd ?? home;
    const { cols, rows } = getTerminalSizeCache();
    const result = await window.api.terminal.create(targetCwd, cols, rows);
    if (result?.success && result.data) {
      dispatch({ type: 'ADD_TERMINAL', entry: { id: result.data.id, state: 'Running', cwd: targetCwd } });
      dispatch({ type: 'SET_SELECTED', id: result.data.id });
      trackEvent(ANALYTICS_EVENTS.TERMINAL.CREATE, { cwd: targetCwd });
    } else {
      trackError('terminal', { type: 'spawn_fail' });
    }
  }, [dispatch]);

  // Cmd+T / Ctrl+T: create new terminal
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && e.key === 't') {
        e.preventDefault();
        if (state.terminals.length < MAX_TERMINALS) {
          addTerminal();
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state.terminals.length, addTerminal]);

  const removeTerminal = useCallback(async (id: string) => {
    const fgResult = await window.api.terminal.getForegroundProcess(id);
    if (fgResult?.success && fgResult.data && fgResult.data.name !== 'shell') {
      dispatch({ type: 'OPEN_CLOSE_CONFIRM', terminalId: id, processName: fgResult.data.name });
      return;
    }
    await window.api.terminal.close(id);
    trackEvent(ANALYTICS_EVENTS.TERMINAL.CLOSE, { had_process: false });
    dispatch({ type: 'REMOVE_TERMINAL', id });
  }, [dispatch]);

  const handleCloseConfirm = useCallback(async () => {
    const { terminalId } = stateRef.current.closeConfirm;
    dispatch({ type: 'CLOSE_CLOSE_CONFIRM' });
    await window.api.terminal.close(terminalId, true);
    trackEvent(ANALYTICS_EVENTS.TERMINAL.CLOSE, { had_process: true });
    dispatch({ type: 'REMOVE_TERMINAL', id: terminalId });
  }, [dispatch]);

  const handleCloseCancel = useCallback(() => {
    dispatch({ type: 'CLOSE_CLOSE_CONFIRM' });
  }, [dispatch]);

  const handleDoubleClick = useCallback((id: string) => {
    if (!doubleClickToFocusRef.current) return;
    termLog('dblClick', `id=${id} terminals=[${stateRef.current.terminals.map(t => t.id.slice(0, 8)).join(',')}] prevMode=${stateRef.current.viewMode} prevFocused=${stateRef.current.focusedId}`);
    dispatch({ type: 'SET_VIEW_MODE', mode: 'Focused' });
    dispatch({ type: 'SET_FOCUSED', id });
  }, [dispatch]);

  const handleFocusTerminal = useCallback((id: string) => {
    dispatch({ type: 'SET_VIEW_MODE', mode: 'Focused' });
    dispatch({ type: 'SET_FOCUSED', id });
  }, [dispatch]);

  const handleBackToTiling = useCallback(() => {
    termLog('backToTiling', `prevFocusedId=${stateRef.current.focusedId} terminals=[${stateRef.current.terminals.map(t => t.id.slice(0, 8)).join(',')}]`);
    dispatch({ type: 'SET_VIEW_MODE', mode: 'Tiling' });
    dispatch({ type: 'SET_FOCUSED', id: null });
  }, [dispatch]);

  const handleSidebarClick = useCallback((id: string) => {
    termLog('sidebarClick', `newFocusId=${id} prevFocusId=${stateRef.current.focusedId} activeSidebar=${stateRef.current.activeSidebarId}`);
    dispatch({ type: 'SET_FOCUSED', id });
    const terminal = stateRef.current.terminals.find((t) => t.id === id);
    if (terminal?.state === 'WaitingInput') {
      window.api.terminal.acknowledgeWaiting(id);
    }
  }, [dispatch]);

  const handleSidebarActivate = useCallback((id: string) => {
    termLog('sidebarActivate', `id=${id} prevActiveSidebar=${stateRef.current.activeSidebarId}`);
    dispatch({ type: 'SET_ACTIVE_SIDEBAR', id });
    window.dispatchEvent(new CustomEvent('muxvo:terminal-focus', { detail: id }));
    const terminal = stateRef.current.terminals.find((t) => t.id === id);
    if (terminal?.state === 'WaitingInput') {
      window.api.terminal.acknowledgeWaiting(id);
    }
  }, [dispatch]);

  const handleSidebarDeactivate = useCallback(() => {
    dispatch({ type: 'SET_ACTIVE_SIDEBAR', id: null });
  }, [dispatch]);

  const handleTileClick = useCallback((id: string) => {
    dispatch({ type: 'SET_SELECTED', id });
    // Clear WaitingInput badge when user clicks on the terminal tile
    const terminal = stateRef.current.terminals.find((t) => t.id === id);
    if (terminal?.state === 'WaitingInput') {
      window.api.terminal.acknowledgeWaiting(id);
    }
  }, [dispatch]);

  const handleReorder = useCallback((newOrder: string[]) => {
    dispatch({ type: 'REORDER', newOrder });
  }, [dispatch]);

  const handleRename = useCallback((id: string, name: string) => {
    dispatch({ type: 'RENAME', id, name });

    // Persist custom name in main process terminal manager (for crash recovery)
    window.api.terminal.setName(id, name || '').catch(() => {});

    // Propagate name to chat session associated with this terminal's cwd
    const terminal = stateRef.current.terminals.find((t) => t.id === id);
    if (terminal?.cwd) {
      window.api.chat.setSessionName(terminal.cwd, name || '').catch(() => {});
    }

    // If terminal is in a worktree, sync rename to git branch
    if (name && terminal?.cwd?.includes('/.worktrees/')) {
      window.api.worktree.rename(terminal.cwd, name).then((r: any) => {
        if (!r?.success) console.error('[worktree-rename] failed:', r?.error);
      }).catch((e: any) => console.error('[worktree-rename] error:', e));
    }
  }, [dispatch]);

  const handleResumeSession = useCallback(async (info: { sessionId: string; cwd: string; source: ChatSource; customTitle?: string }) => {
    console.log('[resume-chat] creating terminal:', { cwd: info.cwd, sessionId: info.sessionId, source: info.source, customTitle: info.customTitle });
    const { cols: cachedCols, rows: cachedRows } = getTerminalSizeCache();
    const result = await window.api.terminal.create(info.cwd, cachedCols, cachedRows);
    if (!result?.success || !result.data) {
      console.error('[resume-chat] terminal creation failed:', result);
      window.alert(`\u65E0\u6CD5\u521B\u5EFA\u7EC8\u7AEF\uFF1A${(result as any)?.error || '\u672A\u77E5\u9519\u8BEF'}\n\u76EE\u5F55: ${info.cwd}`);
      return;
    }
    const newId = result.data.id;
    dispatch({ type: 'ADD_TERMINAL', entry: { id: newId, state: 'Running', cwd: info.cwd } });
    dispatch({ type: 'SET_SELECTED', id: newId });

    // Restore custom name from chat session
    if (info.customTitle) {
      dispatch({ type: 'RENAME', id: newId, name: info.customTitle });
      window.api.terminal.setName(newId, info.customTitle).catch(() => {});
    }

    setTimeout(() => {
      const escapedCwd = info.cwd.replace(/([ ()&|;<>$`"'\\])/g, '\\$1');
      const resumeCmd = info.source === 'codex'
        ? `codex resume ${info.sessionId}`
        : `claude --resume ${info.sessionId}`;
      window.api.terminal.write(newId, `cd ${escapedCwd} && ${resumeCmd}\n`);
    }, 500);
  }, [dispatch]);

  return {
    addTerminal,
    removeTerminal,
    handleCloseConfirm,
    handleCloseCancel,
    handleDoubleClick,
    handleFocusTerminal,
    handleBackToTiling,
    handleSidebarClick,
    handleSidebarActivate,
    handleSidebarDeactivate,
    handleTileClick,
    handleReorder,
    handleRename,
    handleResumeSession,
    maxReached: state.terminals.length >= MAX_TERMINALS,
  };
}
