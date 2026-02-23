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
import { useI18n } from '@/renderer/i18n';
import './MenuBar.css';

type TabId = 'terminals' | 'skills' | 'mcp' | 'hooks' | 'chat';

interface Props {
  viewMode?: 'Tiling' | 'Focused';
  onBackToTiling?: () => void;
  terminalCount?: number;
  onAddTerminal?: () => void;
  maxReached?: boolean;
}

export function MenuBar({ viewMode = 'Tiling', onBackToTiling, terminalCount = 0, onAddTerminal, maxReached }: Props): JSX.Element {
  const { state, dispatch } = usePanelContext();
  const { t, locale, setLocale } = useI18n();

  const chatOpen = state.chatHistory.open;
  const skillsOpen = state.skillsPanel.open;
  const mcpOpen = state.mcpPanel.open;
  const hooksOpen = state.hooksPanel.open;

  function getActiveTab(): TabId {
    if (skillsOpen) return 'skills';
    if (mcpOpen) return 'mcp';
    if (hooksOpen) return 'hooks';
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
  }

  function handleTabClick(tab: TabId) {
    if (tab === 'terminals') {
      closeAllPanels();
      return;
    }

    if (tab === 'skills') {
      closeAllPanels();
      if (!skillsOpen) dispatch({ type: 'OPEN_SKILLS_PANEL' });
      return;
    }

    if (tab === 'mcp') {
      closeAllPanels();
      if (!mcpOpen) dispatch({ type: 'OPEN_MCP_PANEL' });
      return;
    }

    if (tab === 'hooks') {
      closeAllPanels();
      if (!hooksOpen) dispatch({ type: 'OPEN_HOOKS_PANEL' });
      return;
    }

    if (tab === 'chat') {
      closeAllPanels();
      if (!chatOpen) dispatch({ type: 'OPEN_CHAT_HISTORY' });
    }
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
          className={`menu-bar__tab${activeTab === 'chat' ? ' menu-bar__tab--active' : ''}`}
          onClick={() => handleTabClick('chat')}
        >
          {t('menu.chatHistory')}
        </button>
      </nav>

      {viewMode === 'Focused' && onBackToTiling && (
        <button className="menu-bar__back-btn" onClick={onBackToTiling}>
          {t('menu.backToTiling')}
        </button>
      )}

      <button
        className="menu-bar__lang-btn"
        onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}
      >
        {locale === 'zh' ? 'EN' : '中'}
      </button>

      <button
        className="menu-bar__add-btn"
        onClick={onAddTerminal}
        disabled={maxReached}
        title={t('menu.newTerminal')}
      >
        +
      </button>
    </header>
  );
}
