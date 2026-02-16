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
import { MenuDropdown } from './MenuDropdown';
import './MenuBar.css';

type TabId = 'terminals' | 'skills' | 'mcp' | 'chat';

interface Props {
  viewMode?: 'Tiling' | 'Focused';
  onBackToTiling?: () => void;
}

export function MenuBar({ viewMode = 'Tiling', onBackToTiling }: Props): JSX.Element {
  const { state, dispatch } = usePanelContext();

  const activeDropdown = state.menuDropdown.open ? state.menuDropdown.type : null;
  const chatOpen = state.chatHistory.open;

  function getActiveTab(): TabId {
    if (activeDropdown === 'skills') return 'skills';
    if (activeDropdown === 'mcp') return 'mcp';
    if (chatOpen) return 'chat';
    return 'terminals';
  }

  const activeTab = getActiveTab();

  function handleTabClick(tab: TabId) {
    if (tab === 'terminals') {
      // Close any open dropdown/panel, back to terminal grid
      if (activeDropdown) dispatch({ type: 'TOGGLE_MENU_DROPDOWN', dropdownType: activeDropdown });
      if (chatOpen) dispatch({ type: 'CLOSE_CHAT_HISTORY' });
      return;
    }

    if (tab === 'skills' || tab === 'mcp') {
      if (chatOpen) dispatch({ type: 'CLOSE_CHAT_HISTORY' });
      dispatch({ type: 'TOGGLE_MENU_DROPDOWN', dropdownType: tab });
      return;
    }

    if (tab === 'chat') {
      if (activeDropdown) dispatch({ type: 'TOGGLE_MENU_DROPDOWN', dropdownType: activeDropdown });
      if (chatOpen) {
        dispatch({ type: 'CLOSE_CHAT_HISTORY' });
      } else {
        dispatch({ type: 'OPEN_CHAT_HISTORY' });
      }
    }
  }

  function handleDropdownClose() {
    if (activeDropdown) {
      dispatch({ type: 'TOGGLE_MENU_DROPDOWN', dropdownType: activeDropdown });
    }
  }

  return (
    <>
      <header className="menu-bar">
        <div className="menu-bar__drag-region" />

        <span className="menu-bar__title">Muxvo</span>

        <nav className="menu-bar__tabs">
          <button
            className={`menu-bar__tab${activeTab === 'terminals' ? ' menu-bar__tab--active' : ''}`}
            onClick={() => handleTabClick('terminals')}
          >
            Terminals
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
            className={`menu-bar__tab${activeTab === 'chat' ? ' menu-bar__tab--active' : ''}`}
            onClick={() => handleTabClick('chat')}
          >
            Chat
          </button>
        </nav>

        {viewMode === 'Focused' && onBackToTiling && (
          <button className="menu-bar__back-btn" onClick={onBackToTiling}>
            ← Tiling
          </button>
        )}
      </header>

      {activeDropdown && (
        <MenuDropdown type={activeDropdown} onClose={handleDropdownClose} />
      )}
    </>
  );
}
