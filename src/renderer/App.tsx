/**
 * Muxvo — Root Application Component
 * DEV-PLAN A1: 主窗口布局（菜单栏 36px + 内容区 + 底部控制栏）
 * DEV-PLAN A4: Terminal grid integration
 * DEV-PLAN A5: Terminal lifecycle (max 20, close confirm)
 * DEV-PLAN B1/B2: Focus mode with Esc exit + sidebar switching
 */

import { useState, useEffect, useCallback } from 'react';
import { MenuBar } from './components/layout/MenuBar';
import { FloatingControls } from './components/layout/FloatingControls';
import { TerminalGrid } from './components/terminal/TerminalGrid';
import { CloseConfirmDialog } from './components/terminal/CloseConfirmDialog';
import { ChatHistoryPanel } from './components/chat/ChatHistoryPanel';
import { FilePanel } from './components/file/FilePanel';
import { PanelProvider, usePanelContext } from './contexts/PanelContext';
import './App.css';

const MAX_TERMINALS = 20;

interface TerminalEntry {
  id: string;
  state: string;
  cwd: string;
}

interface CloseConfirmState {
  open: boolean;
  terminalId: string;
  processName: string;
}

export function App(): JSX.Element {
  const [terminals, setTerminals] = useState<TerminalEntry[]>([]);
  const [viewMode, setViewMode] = useState<'Tiling' | 'Focused'>('Tiling');
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [closeConfirm, setCloseConfirm] = useState<CloseConfirmState>({
    open: false,
    terminalId: '',
    processName: '',
  });

  useEffect(() => {
    // Load existing terminals on mount
    window.api.terminal.list().then((result: { success: boolean; data?: any[] }) => {
      if (result?.success && result.data) {
        // Map TerminalInfo to TerminalEntry with cwd
        const entries = result.data.map((info: any) => ({
          id: info.id,
          state: info.state,
          cwd: info.cwd || '/',
        }));
        setTerminals(entries);
      }
    });

    // Listen for terminal exits to remove from grid
    const unsubExit = window.api.terminal.onExit((event) => {
      setTerminals((prev) => prev.filter((t) => t.id !== event.id));
    });

    // Listen for state changes to update terminal state
    const unsubState = window.api.terminal.onStateChange((event) => {
      setTerminals((prev) =>
        prev.map((t) => (t.id === event.id ? { ...t, state: event.state } : t))
      );
    });

    // Listen for restored terminal list (after app restart)
    const unsubListUpdated = window.api.terminal.onListUpdated?.((list: any[]) => {
      // Map list to TerminalEntry with cwd
      const entries = list.map((info: any) => ({
        id: info.id,
        state: info.state,
        cwd: info.cwd || '/',
      }));
      setTerminals(entries);
    });

    return () => {
      unsubExit();
      unsubState();
      unsubListUpdated?.();
    };
  }, []);

  const addTerminal = useCallback(async () => {
    const home = window.api.app.getHomePath();
    const result = await window.api.terminal.create(home);
    if (result?.success && result.data) {
      setTerminals((prev) => [...prev, { id: result.data.id, state: 'Running', cwd: home }]);
    }
  }, []);

  const removeTerminal = useCallback(async (id: string) => {
    // Check if there's a foreground process running
    const fgResult = await window.api.terminal.getForegroundProcess(id);
    if (fgResult?.success && fgResult.data && fgResult.data.name !== 'shell') {
      // Show confirmation dialog
      setCloseConfirm({ open: true, terminalId: id, processName: fgResult.data.name });
      return;
    }
    // No active process or just shell — close directly
    await window.api.terminal.close(id);
    setTerminals((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const handleCloseConfirm = useCallback(async () => {
    const { terminalId } = closeConfirm;
    setCloseConfirm({ open: false, terminalId: '', processName: '' });
    await window.api.terminal.close(terminalId, true);
    setTerminals((prev) => prev.filter((t) => t.id !== terminalId));
  }, [closeConfirm]);

  const handleCloseCancel = useCallback(() => {
    setCloseConfirm({ open: false, terminalId: '', processName: '' });
  }, []);

  const handleDoubleClick = useCallback((id: string) => {
    setViewMode('Focused');
    setFocusedId(id);
  }, []);

  const handleBackToTiling = useCallback(() => {
    setViewMode('Tiling');
    setFocusedId(null);
  }, []);

  const handleSidebarClick = useCallback((id: string) => {
    setFocusedId(id);
  }, []);

  const handleTileClick = useCallback((id: string) => {
    setSelectedId(id);
  }, []);

  const handleCwdChange = useCallback((id: string, newCwd: string) => {
    setTerminals((prev) =>
      prev.map((t) => (t.id === id ? { ...t, cwd: newCwd } : t))
    );
  }, []);

  // Esc key exits focused mode (only when focus is on UI, not inside terminal)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape' && viewMode === 'Focused') {
        // Only handle Esc if focus is NOT inside a terminal xterm element
        const active = document.activeElement;
        const isInTerminal = active?.closest('.xterm') !== null;
        if (!isInTerminal) {
          handleBackToTiling();
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [viewMode, handleBackToTiling]);

  // Clear focused state if the focused terminal is removed
  useEffect(() => {
    if (focusedId && !terminals.find((t) => t.id === focusedId)) {
      setViewMode('Tiling');
      setFocusedId(null);
    }
    if (selectedId && !terminals.find((t) => t.id === selectedId)) {
      setSelectedId(null);
    }
  }, [terminals, focusedId, selectedId]);

  const maxReached = terminals.length >= MAX_TERMINALS;

  return (
    <PanelProvider>
      <AppContent
        terminals={terminals}
        viewMode={viewMode}
        focusedId={focusedId}
        selectedId={selectedId}
        maxReached={maxReached}
        closeConfirm={closeConfirm}
        onDoubleClick={handleDoubleClick}
        onSidebarClick={handleSidebarClick}
        onClick={handleTileClick}
        onCwdChange={handleCwdChange}
        onBackToTiling={handleBackToTiling}
        onAddTerminal={addTerminal}
        onClose={removeTerminal}
        onCloseConfirm={handleCloseConfirm}
        onCloseCancel={handleCloseCancel}
      />
    </PanelProvider>
  );
}

/** Inner component to access PanelContext (must be child of PanelProvider) */
function AppContent({
  terminals,
  viewMode,
  focusedId,
  selectedId,
  maxReached,
  closeConfirm,
  onDoubleClick,
  onSidebarClick,
  onClick,
  onCwdChange,
  onBackToTiling,
  onAddTerminal,
  onClose,
  onCloseConfirm,
  onCloseCancel,
}: {
  terminals: TerminalEntry[];
  viewMode: 'Tiling' | 'Focused';
  focusedId: string | null;
  selectedId: string | null;
  maxReached: boolean;
  closeConfirm: CloseConfirmState;
  onDoubleClick: (id: string) => void;
  onSidebarClick: (id: string) => void;
  onClick: (id: string) => void;
  onCwdChange: (id: string, newCwd: string) => void;
  onBackToTiling: () => void;
  onAddTerminal: () => void;
  onClose: (id: string) => void;
  onCloseConfirm: () => void;
  onCloseCancel: () => void;
}): JSX.Element {
  const { state, dispatch } = usePanelContext();

  // Compute FilePanel projectCwd from filePanel.projectIndex
  const filePanelCwd = state.filePanel.projectIndex !== null
    ? terminals[state.filePanel.projectIndex]?.cwd || '/'
    : '/';

  return (
    <div className="app">
      <MenuBar viewMode={viewMode} onBackToTiling={onBackToTiling} terminalCount={terminals.length} />
      <main className="app-content">
        <TerminalGrid
          terminals={terminals}
          viewMode={viewMode}
          focusedId={focusedId}
          selectedId={selectedId}
          onDoubleClick={onDoubleClick}
          onSidebarClick={onSidebarClick}
          onClick={onClick}
          onClose={onClose}
          onCwdChange={onCwdChange}
        />
      </main>

      {/* "回到平铺" centered floating button (visible in Focused mode) */}
      {viewMode === 'Focused' && (
        <button className="grid-return-btn" onClick={onBackToTiling}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
          回到平铺
        </button>
      )}

      {/* Floating controls (prototype bottom pill bar) */}
      <FloatingControls
        terminalCount={terminals.length}
        onAddTerminal={onAddTerminal}
        maxReached={maxReached}
      />

      {/* Chat history overlay (mail-client 3-column view) */}
      {state.chatHistory.open && (
        <div className="chat-history-overlay">
          <ChatHistoryPanel />
        </div>
      )}

      {/* File panel (right slide-out) */}
      {state.filePanel.open && (
        <FilePanel
          projectCwd={filePanelCwd}
          onClose={() => dispatch({ type: 'CLOSE_FILE_PANEL' })}
          onOpenFile={(filePath, ext) => {
            // Open temp view with file (to be wired when tempView state is expanded)
            dispatch({ type: 'OPEN_TEMP_VIEW', contentKey: filePath });
          }}
        />
      )}

      <CloseConfirmDialog
        open={closeConfirm.open}
        terminalId={closeConfirm.terminalId}
        processName={closeConfirm.processName}
        onConfirm={onCloseConfirm}
        onCancel={onCloseCancel}
      />
    </div>
  );
}
