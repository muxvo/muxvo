/**
 * Muxvo — Root Application Component
 * DEV-PLAN A1: 主窗口布局（菜单栏 36px + 内容区 + 底部控制栏）
 * DEV-PLAN A4: Terminal grid integration
 * DEV-PLAN A5: Terminal lifecycle (max 20, close confirm)
 * DEV-PLAN B1/B2: Focus mode with Esc exit + sidebar switching
 */

import { useState, useEffect, useCallback } from 'react';
import { MenuBar } from './components/layout/MenuBar';
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
import { WaitingInputNotification } from './components/terminal/WaitingInputNotification';
import { LoginModal } from './components/auth/LoginModal';
import { SettingsModal } from './components/settings/SettingsModal';
import { PanelProvider, usePanelContext } from './contexts/PanelContext';
import { TerminalProvider, useTerminalState, useOrderedTerminals, useTerminalActions } from './contexts/TerminalContext';
import { AuthProvider } from './contexts/AuthContext';
import { I18nProvider, useI18n, type Locale } from './i18n';
import { mapExtToFileType, toLocalFileUrl } from './utils/file-tree';
import { trackEvent } from './hooks/useAnalytics';
import { useGlobalZoom } from './hooks/useGlobalZoom';
import { ANALYTICS_EVENTS } from '@/shared/constants/analytics-events';
import type { ChatSource } from '@/shared/types/chat.types';
import './App.css';

export function App(): JSX.Element {
  const [initialLocale, setInitialLocale] = useState<Locale>('zh');
  const [uiTheme, setUiTheme] = useState<'dark' | 'light'>('dark');
  useGlobalZoom();

  useEffect(() => {
    // Apply default dark theme immediately
    document.documentElement.setAttribute('data-theme', 'dark');

    window.api.app.getPreferences().then((result: any) => {
      if (result?.success && result.data?.language) {
        setInitialLocale(result.data.language as Locale);
      }
    }).catch(() => {});
    // Load theme from config (override default if user previously chose light)
    window.api.app.getConfig().then((result: any) => {
      if (result?.data?.theme === 'light') {
        setUiTheme('light');
        document.documentElement.setAttribute('data-theme', 'light');
      }
    }).catch(() => {});
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
      trackEvent(ANALYTICS_EVENTS.THEME.SWITCH, { to: next });
      return next;
    });
  }, []);

  return (
    <I18nProvider initialLocale={initialLocale}>
      <AuthProvider>
        <TerminalProvider>
          <PanelProvider>
            <AppContent
              uiTheme={uiTheme}
              onToggleTheme={handleToggleTheme}
            />
          </PanelProvider>
        </TerminalProvider>
      </AuthProvider>
    </I18nProvider>
  );
}

/** Inner component to access PanelContext + TerminalContext */
function AppContent({
  uiTheme,
  onToggleTheme,
}: {
  uiTheme: 'dark' | 'light';
  onToggleTheme: () => void;
}): JSX.Element {
  const { state, dispatch } = usePanelContext();
  const { t } = useI18n();

  const terminalState = useTerminalState();
  const terminals = useOrderedTerminals();
  const actions = useTerminalActions();

  // Auto-start tour on first launch (tourCompleted not set)
  useEffect(() => {
    window.api.app.getPreferences().then((result: any) => {
      if (result?.success && !result.data?.tourCompleted) {
        setTimeout(() => dispatch({ type: 'START_TOUR' }), 1500);
      }
    }).catch(() => {});
  }, [dispatch]);

  // Wrap addTerminal to close all panels first (switch back to terminal tab)
  const handleAddTerminal = useCallback(async () => {
    dispatch({ type: 'CLOSE_ALL' });
    await actions.addTerminal();
  }, [dispatch, actions.addTerminal]);

  // Wrap handleResumeSession to close all panels first
  const handleResumeSession = useCallback(async (info: { sessionId: string; cwd: string; source: ChatSource }) => {
    dispatch({ type: 'CLOSE_ALL' });
    await actions.handleResumeSession(info);
  }, [dispatch, actions.handleResumeSession]);

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
      <MenuBar viewMode={terminalState.viewMode} onBackToTiling={actions.handleBackToTiling} terminalCount={terminals.length} />
      <main className="app-content">
        <TerminalGrid
          terminals={terminals}
          viewMode={terminalState.viewMode}
          focusedId={terminalState.focusedId}
          selectedId={terminalState.selectedId}
          chatSidebarTerminalId={state.terminalChat.open ? state.terminalChat.terminalId : null}
          onCloseChatSidebar={() => dispatch({ type: 'CLOSE_TERMINAL_CHAT' })}
          onDoubleClick={actions.handleDoubleClick}
          onSidebarClick={actions.handleSidebarClick}
          onClick={actions.handleTileClick}
          onClose={actions.removeTerminal}
          onReorder={actions.handleReorder}
          onRename={actions.handleRename}
          onAddTerminal={handleAddTerminal}
          maxReached={actions.maxReached}
        />
      </main>

      {/* "回到平铺" centered floating button (visible in Focused mode) */}
      {terminalState.viewMode === 'Focused' && (
        <button className="grid-return-btn" onClick={actions.handleBackToTiling}>
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
          <ChatHistoryPanel onResumeSession={handleResumeSession} />
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
            actions.handleDoubleClick(id);
          }}
          onCloseTerminal={actions.removeTerminal}
        />
      )}

      <CloseConfirmDialog
        open={terminalState.closeConfirm.open}
        terminalId={terminalState.closeConfirm.terminalId}
        processName={terminalState.closeConfirm.processName}
        onConfirm={actions.handleCloseConfirm}
        onCancel={actions.handleCloseCancel}
      />

      <TourOverlay
        terminalCount={terminals.length}
        viewMode={terminalState.viewMode}
        terminalNames={terminalState.terminalNames}
      />

      <SettingsModal uiTheme={uiTheme} onToggleTheme={onToggleTheme} />
      <LoginModal />
      <WaitingInputNotification
        waitingCount={terminals.filter(t => t.state === 'WaitingInput').length}
        overlayActive={
          state.chatHistory.open || state.skillsPanel.open || state.mcpPanel.open ||
          state.hooksPanel.open || state.pluginsPanel.open ||
          state.filePanel.open || state.tempView.active
        }
        onSwitchToTerminals={() => dispatch({ type: 'CLOSE_ALL' })}
      />
    </div>
  );
}
