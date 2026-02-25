/**
 * Muxvo — Root Application Component
 * DEV-PLAN A1: 主窗口布局（菜单栏 36px + 内容区 + 底部控制栏）
 * DEV-PLAN A4: Terminal grid integration
 * DEV-PLAN A5: Terminal lifecycle (max 20, close confirm)
 * DEV-PLAN B1/B2: Focus mode with Esc exit + sidebar switching
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { MenuBar } from './components/layout/MenuBar';
import { FloatingControls } from './components/layout/FloatingControls';
import { TerminalGrid } from './components/terminal/TerminalGrid';
import { CloseConfirmDialog } from './components/terminal/CloseConfirmDialog';
import { ChatHistoryPanel } from './components/chat/ChatHistoryPanel';
import { SkillsPanel } from './components/skill/SkillsPanel';
import { McpPanel } from './components/mcp/McpPanel';
import { HooksPanel } from './components/hook/HooksPanel';
import { PluginPanel } from './components/plugin/PluginPanel';
import { FilePanel } from './components/file/FilePanel';
import { FileTempView } from './components/file/FileTempView';
import { TourOverlay } from './components/tour/TourOverlay';
import { UpdateNotification } from './components/app/UpdateNotification';
import { LoginModal } from './components/auth/LoginModal';
import { SettingsModal } from './components/settings/SettingsModal';
import { PanelProvider, usePanelContext } from './contexts/PanelContext';
import { AuthProvider } from './contexts/AuthContext';
import { I18nProvider, useI18n, type Locale } from './i18n';
import { mapExtToFileType, toLocalFileUrl } from './utils/file-tree';
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
  const [terminalOrder, setTerminalOrder] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<'Tiling' | 'Focused'>('Tiling');
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [terminalNames, setTerminalNames] = useState<Record<string, string>>({});
  const [closeConfirm, setCloseConfirm] = useState<CloseConfirmState>({
    open: false,
    terminalId: '',
    processName: '',
  });
  const [initialLocale, setInitialLocale] = useState<Locale>('zh');
  const [uiTheme, setUiTheme] = useState<'dark' | 'light'>('light');

  useEffect(() => {
    // Apply default light theme immediately
    document.documentElement.setAttribute('data-theme', 'light');

    window.api.app.getPreferences().then((result: any) => {
      if (result?.success && result.data?.language) {
        setInitialLocale(result.data.language as Locale);
      }
    }).catch(() => {});
    // Load theme from config (override default if user previously chose dark)
    window.api.app.getConfig().then((result: any) => {
      if (result?.data?.theme === 'dark') {
        setUiTheme('dark');
        document.documentElement.setAttribute('data-theme', 'dark');
      }
    }).catch(() => {});
  }, []);

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
        setTerminalOrder(entries.map((e) => e.id));
      }
    });

    // Listen for terminal exits to remove from grid
    const unsubExit = window.api.terminal.onExit((event) => {
      setTerminals((prev) => prev.filter((t) => t.id !== event.id));
      setTerminalOrder((prev) => prev.filter((id) => id !== event.id));
      setTerminalNames((prev) => { const next = { ...prev }; delete next[event.id]; return next; });
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
      setTerminalOrder(entries.map((e) => e.id));
    });

    // Listen for cwd changes (OSC 7 detection from main process)
    const unsubCwd = window.api.terminal.onCwdChange?.((event) => {
      setTerminals((prev) =>
        prev.map((t) => (t.id === event.id ? { ...t, cwd: event.cwd } : t))
      );
    });

    return () => {
      unsubExit();
      unsubState();
      unsubListUpdated?.();
      unsubCwd?.();
    };
  }, []);

  const addTerminal = useCallback(async () => {
    const home = window.api.app.getHomePath();
    const result = await window.api.terminal.create(home);
    if (result?.success && result.data) {
      setTerminals((prev) => [...prev, { id: result.data.id, state: 'Running', cwd: home }]);
      setTerminalOrder((prev) => [...prev, result.data.id]);
      // setSelectedId(result.data.id); // TEMPORARILY REMOVED FOR RED PHASE
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
    setTerminalOrder((prev) => prev.filter((tid) => tid !== id));
    setTerminalNames((prev) => { const next = { ...prev }; delete next[id]; return next; });
  }, []);

  const handleCloseConfirm = useCallback(async () => {
    const { terminalId } = closeConfirm;
    setCloseConfirm({ open: false, terminalId: '', processName: '' });
    await window.api.terminal.close(terminalId, true);
    setTerminals((prev) => prev.filter((t) => t.id !== terminalId));
    setTerminalOrder((prev) => prev.filter((tid) => tid !== terminalId));
    setTerminalNames((prev) => { const next = { ...prev }; delete next[terminalId]; return next; });
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

  const handleReorder = useCallback((newOrder: string[]) => {
    setTerminalOrder(newOrder);
  }, []);

  // Ref to access latest terminals without adding to callback deps
  const terminalsRef = useRef(terminals);
  terminalsRef.current = terminals;

  const handleRename = useCallback((id: string, name: string) => {
    setTerminalNames((prev) => {
      if (!name) {
        const next = { ...prev };
        delete next[id];
        return next;
      }
      return { ...prev, [id]: name };
    });

    // Propagate name to chat session associated with this terminal's cwd
    const terminal = terminalsRef.current.find(t => t.id === id);
    if (terminal?.cwd) {
      window.api.chat.setSessionName(terminal.cwd, name || '').catch(() => {});
    }
  }, []);

  const handleToggleTheme = useCallback(() => {
    setUiTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      // Persist to config and update terminal theme
      window.api.app.getConfig().then((result: any) => {
        const terminalThemeName = next === 'light' ? 'light' : 'dark';
        const terminal = { ...result?.data?.terminal, themeName: terminalThemeName };
        window.api.app.saveConfig({ ...result?.data, theme: next, terminal });
      }).catch(() => {});
      // Notify all XTermRenderer instances to update theme
      window.dispatchEvent(new CustomEvent('muxvo:theme-change', { detail: { theme: next } }));
      return next;
    });
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

  // Sort terminals by terminalOrder
  const orderedTerminals = (terminalOrder.length > 0
    ? terminalOrder
        .map((id) => terminals.find((t) => t.id === id))
        .filter((t): t is TerminalEntry => t !== undefined)
    : terminals
  ).map((t) => ({ ...t, customName: terminalNames[t.id] }));

  return (
    <I18nProvider initialLocale={initialLocale}>
      <AuthProvider>
        <PanelProvider>
          <AppContent
            terminals={orderedTerminals}
            viewMode={viewMode}
            focusedId={focusedId}
            selectedId={selectedId}
            maxReached={maxReached}
            closeConfirm={closeConfirm}
            uiTheme={uiTheme}
            onDoubleClick={handleDoubleClick}
            onSidebarClick={handleSidebarClick}
            onClick={handleTileClick}
            onBackToTiling={handleBackToTiling}
            onAddTerminal={addTerminal}
            onClose={removeTerminal}
            onCloseConfirm={handleCloseConfirm}
            onCloseCancel={handleCloseCancel}
            onReorder={handleReorder}
            onRename={handleRename}
            onToggleTheme={handleToggleTheme}
            terminalNames={terminalNames}
          />
        </PanelProvider>
      </AuthProvider>
    </I18nProvider>
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
  uiTheme,
  onDoubleClick,
  onSidebarClick,
  onClick,
  onBackToTiling,
  onAddTerminal,
  onClose,
  onCloseConfirm,
  onCloseCancel,
  onReorder,
  onRename,
  onToggleTheme,
  terminalNames,
}: {
  terminals: (TerminalEntry & { customName?: string })[];
  viewMode: 'Tiling' | 'Focused';
  focusedId: string | null;
  selectedId: string | null;
  maxReached: boolean;
  closeConfirm: CloseConfirmState;
  uiTheme: 'dark' | 'light';
  onDoubleClick: (id: string) => void;
  onSidebarClick: (id: string) => void;
  onClick: (id: string) => void;
  onBackToTiling: () => void;
  onAddTerminal: () => void;
  onClose: (id: string) => void;
  onCloseConfirm: () => void;
  onCloseCancel: () => void;
  onReorder: (newOrder: string[]) => void;
  onRename: (id: string, name: string) => void;
  onToggleTheme: () => void;
  terminalNames: Record<string, string>;
}): JSX.Element {
  const { state, dispatch } = usePanelContext();
  const { t } = useI18n();

  // Wrap onAddTerminal to close all panels first (switch back to terminal tab)
  const handleAddTerminal = useCallback(async () => {
    dispatch({ type: 'CLOSE_ALL' });
    await onAddTerminal();
  }, [dispatch, onAddTerminal]);

  // File content loading for FileTempView
  const [fileContent, setFileContent] = useState('');
  const [fileType, setFileType] = useState<'markdown' | 'code' | 'text' | 'image'>('text');

  useEffect(() => {
    if (!state.tempView.active || !state.tempView.contentKey) return;
    const filePath = state.tempView.contentKey;
    const ext = (filePath.split('.').pop() || '').toLowerCase();
    const detectedType = mapExtToFileType(ext);
    setFileType(detectedType);
    setFileContent('');

    if (detectedType === 'image') {
      // Use custom local-file:// protocol to serve image directly
      setFileContent(toLocalFileUrl(filePath));
    } else {
      window.api.fs.readFile(filePath).then((result: { success: boolean; data?: { content: string } }) => {
        if (result?.success && result.data) {
          setFileContent(result.data.content);
        }
      }).catch(() => {});
    }
  }, [state.tempView.active, state.tempView.contentKey]);

  // Compute FilePanel projectCwd from filePanel.terminalId
  const filePanelCwd = state.filePanel.terminalId !== null
    ? terminals.find(t => t.id === state.filePanel.terminalId)?.cwd || '/'
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
          onReorder={onReorder}
          onRename={onRename}
          onAddTerminal={handleAddTerminal}
          maxReached={maxReached}
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
          {t('app.backToTiling')}
        </button>
      )}

      {/* FloatingControls removed — add button moved to MenuBar */}

      {/* Chat history overlay (mail-client 3-column view) */}
      {state.chatHistory.open && (
        <div className="chat-history-overlay">
          <ChatHistoryPanel />
        </div>
      )}

      {/* Skills panel overlay (three-column: skill list | file tree | editor) */}
      {state.skillsPanel.open && (
        <div className="skills-panel-overlay">
          <SkillsPanel />
        </div>
      )}

      {/* MCP panel overlay (two-column: server list | detail/form) */}
      {state.mcpPanel.open && (
        <div className="mcp-panel-overlay">
          <McpPanel />
        </div>
      )}

      {/* Hooks panel overlay (two-column: hook list | detail/form) */}
      {state.hooksPanel.open && (
        <div className="hooks-panel-overlay">
          <HooksPanel />
        </div>
      )}

      {/* Plugins panel overlay (two-column: plugin list | detail) */}
      {state.pluginsPanel.open && (
        <div className="plugins-panel-overlay">
          <PluginPanel />
        </div>
      )}

      {/* File panel (right slide-out) */}
      {state.filePanel.open && (
        <FilePanel
          projectCwd={filePanelCwd}
          onClose={() => dispatch({ type: 'CLOSE_FILE_PANEL' })}
          onOpenFile={(filePath, ext) => {
            const tid = state.filePanel.terminalId || '';
            dispatch({ type: 'CLOSE_FILE_PANEL' });
            dispatch({ type: 'OPEN_TEMP_VIEW', contentKey: filePath, projectCwd: filePanelCwd, terminalId: tid });
          }}
        />
      )}

      {/* File temp view (three-column: file tree | content | terminal sidebar) */}
      {state.tempView.active && state.tempView.contentKey && (
        <FileTempView
          projectCwd={state.tempView.projectCwd || '/'}
          filePath={state.tempView.contentKey}
          content={fileContent}
          fileType={fileType}
          terminals={terminals}
          sourceTerminalId={state.tempView.terminalId || ''}
          onClose={() => dispatch({ type: 'CLOSE_TEMP_VIEW' })}
          onSelectFile={(newFilePath, ext) => {
            dispatch({ type: 'OPEN_TEMP_VIEW', contentKey: newFilePath, projectCwd: state.tempView.projectCwd || '/', terminalId: state.tempView.terminalId || '' });
          }}
          onSelectTerminal={(id) => {
            dispatch({ type: 'CLOSE_TEMP_VIEW' });
            onDoubleClick(id);
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

      <TourOverlay
        terminalCount={terminals.length}
        terminalOrder={terminals.map(t => t.id)}
        viewMode={viewMode}
        terminalNames={terminalNames}
      />

      <SettingsModal uiTheme={uiTheme} onToggleTheme={onToggleTheme} />
      <LoginModal />
      <UpdateNotification />
    </div>
  );
}
