/**
 * MenuBar — 36px top bar with drag region, title, and tab navigation
 * DEV-PLAN A1: 菜单栏 36px
 * DEV-PLAN B2: 聚焦模式下显示「返回平铺」按钮
 *
 * On macOS with hiddenInset titleBarStyle, the top area serves as
 * a drag region for window movement. Traffic light buttons are
 * positioned by the OS.
 */

import { usePanelContext } from '@/renderer/contexts/PanelContext';
import { useTerminalDispatch } from '@/renderer/contexts/TerminalContext';
import { useI18n } from '@/renderer/i18n';
import { AuthButton } from '@/renderer/components/auth/AuthButton';
import { UpdateProgress } from './UpdateProgress';
import { trackEvent } from '@/renderer/hooks/useAnalytics';
import { ANALYTICS_EVENTS } from '@/shared/constants/analytics-events';
import { getTerminalSizeCache } from '@/renderer/utils/terminal-size-cache';
import './MenuBar.css';

type TabId = 'terminals' | 'skills' | 'mcp' | 'hooks' | 'plugins' | 'chat';

interface Props {
  viewMode?: 'Tiling' | 'Focused';
  onBackToTiling?: () => void;
  terminalCount?: number;
}

export function MenuBar({ viewMode = 'Tiling', onBackToTiling, terminalCount = 0 }: Props): JSX.Element {
  const { state, dispatch } = usePanelContext();
  const terminalDispatch = useTerminalDispatch();
  const { t, locale, setLocale } = useI18n();

  const chatOpen = state.chatHistory.open;
  const skillsOpen = state.skillsPanel.open;
  const mcpOpen = state.mcpPanel.open;
  const hooksOpen = state.hooksPanel.open;
  const pluginsOpen = state.pluginsPanel.open;

  function getActiveTab(): TabId {
    if (skillsOpen) return 'skills';
    if (mcpOpen) return 'mcp';
    if (hooksOpen) return 'hooks';
    if (pluginsOpen) return 'plugins';
    if (chatOpen) return 'chat';
    return 'terminals';
  }

  const activeTab = getActiveTab();

  /** Close all overlay panels */
  function closeAllPanels() {
    if (chatOpen) dispatch({ type: 'CLOSE_CHAT_HISTORY' });
    if (skillsOpen) dispatch({ type: 'CLOSE_SKILLS_PANEL' });
    if (mcpOpen) dispatch({ type: 'CLOSE_MCP_PANEL' });
    if (hooksOpen) dispatch({ type: 'CLOSE_HOOKS_PANEL' });
    if (pluginsOpen) dispatch({ type: 'CLOSE_PLUGINS_PANEL' });
  }

  function handleTabClick(tab: TabId) {
    if (tab === 'terminals') {
      closeAllPanels();
      return;
    }

    if (tab === 'skills') {
      closeAllPanels();
      if (!skillsOpen) {
        trackEvent(ANALYTICS_EVENTS.SCREEN.VIEW, { name: 'skills' });
        dispatch({ type: 'OPEN_SKILLS_PANEL' });
      }
      return;
    }

    if (tab === 'mcp') {
      closeAllPanels();
      if (!mcpOpen) {
        trackEvent(ANALYTICS_EVENTS.SCREEN.VIEW, { name: 'mcp' });
        dispatch({ type: 'OPEN_MCP_PANEL' });
      }
      return;
    }

    if (tab === 'hooks') {
      closeAllPanels();
      if (!hooksOpen) {
        trackEvent(ANALYTICS_EVENTS.SCREEN.VIEW, { name: 'hooks' });
        dispatch({ type: 'OPEN_HOOKS_PANEL' });
      }
      return;
    }

    if (tab === 'plugins') {
      closeAllPanels();
      if (!pluginsOpen) {
        trackEvent(ANALYTICS_EVENTS.SCREEN.VIEW, { name: 'plugins' });
        dispatch({ type: 'OPEN_PLUGINS_PANEL' });
      }
      return;
    }

    if (tab === 'chat') {
      closeAllPanels();
      if (!chatOpen) {
        trackEvent(ANALYTICS_EVENTS.SCREEN.VIEW, { name: 'chat' });
        trackEvent(ANALYTICS_EVENTS.CHAT.OPEN);
        dispatch({ type: 'OPEN_CHAT_HISTORY' });
      }
    }
  }

  async function handleHelp() {
    const home = window.api.app.getHomePath();
    const { cols, rows } = getTerminalSizeCache();
    const result = await window.api.terminal.create(home, cols, rows);
    if (!result?.success || !result.data) return;
    const newId = result.data.id;
    terminalDispatch({ type: 'ADD_TERMINAL', entry: { id: newId, state: 'Running', cwd: home } });
    terminalDispatch({ type: 'SET_SELECTED', id: newId });
    closeAllPanels();
    const guidePath = `${home}/.muxvo/guide.md`;
    setTimeout(() => {
      window.api.terminal.write(
        newId,
        `claude "请读取 ${guidePath} 这份 Muxvo 操作指南，然后等待我的问题。我会问你关于 Muxvo 的使用方法，请基于文档内容回答。"\n`
      );
    }, 500);
  }

  return (
    <header className="menu-bar">
      <div className="menu-bar__drag-region" />

      <span className="menu-bar__title">Muxvo</span>

      <nav className="menu-bar__tabs">
        <button
          className={`menu-bar__tab${activeTab === 'terminals' ? ' menu-bar__tab--active' : ''}`}
          onClick={() => handleTabClick('terminals')}
        >
          {t('menu.terminal')}{terminalCount > 0 && <span className="menu-bar__badge">{terminalCount}</span>}
        </button>
        <button
          className={`menu-bar__tab${activeTab === 'skills' ? ' menu-bar__tab--active' : ''}`}
          onClick={() => handleTabClick('skills')}
        >
          Skills
        </button>
        <button
          className={`menu-bar__tab${activeTab === 'mcp' ? ' menu-bar__tab--active' : ''}`}
          onClick={() => handleTabClick('mcp')}
        >
          MCP
        </button>
        <button
          className={`menu-bar__tab${activeTab === 'hooks' ? ' menu-bar__tab--active' : ''}`}
          onClick={() => handleTabClick('hooks')}
        >
          Hooks
        </button>
        <button
          className={`menu-bar__tab${activeTab === 'plugins' ? ' menu-bar__tab--active' : ''}`}
          onClick={() => handleTabClick('plugins')}
        >
          Plugins
        </button>
        <button
          className={`menu-bar__tab${activeTab === 'chat' ? ' menu-bar__tab--active' : ''}`}
          onClick={() => handleTabClick('chat')}
        >
          {t('menu.chatHistory')}
        </button>
      </nav>

      <div className="menu-bar__right-group">
        <UpdateProgress />
        <AuthButton />
        <button
          className="menu-bar__icon-btn"
          onClick={handleHelp}
          title={t('menu.help')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </button>
        <button
          className="menu-bar__icon-btn"
          onClick={() => {
            trackEvent(ANALYTICS_EVENTS.SCREEN.VIEW, { name: 'settings' });
            dispatch({ type: 'OPEN_SETTINGS' });
          }}
          title={t('settings.title')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>
    </header>
  );
}
