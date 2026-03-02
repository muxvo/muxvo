/**
 * PanelContext — Centralized panel state management
 * Decouples panel open/close logic from App.tsx
 */

import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from 'react';

// ── State Shape ──

export interface PanelState {
  filePanel: { open: boolean; terminalId: string | null };
  tempView: { active: boolean; contentKey: string | null; projectCwd: string | null; terminalId: string | null };
  chatHistory: { open: boolean };
  skillsPanel: { open: boolean };
  mcpPanel: { open: boolean };
  hooksPanel: { open: boolean };
  pluginsPanel: { open: boolean };
  menuDropdown: { open: boolean; type: 'mcp' | null };
  tour: { active: boolean; welcomeVisible: boolean };
  settingsModal: { open: boolean };
}

export const initialState: PanelState = {
  filePanel: { open: false, terminalId: null },
  tempView: { active: false, contentKey: null, projectCwd: null, terminalId: null },
  chatHistory: { open: false },
  skillsPanel: { open: false },
  mcpPanel: { open: false },
  hooksPanel: { open: false },
  pluginsPanel: { open: false },
  menuDropdown: { open: false, type: null },
  tour: { active: false, welcomeVisible: false },
  settingsModal: { open: false },
};

// ── Actions ──

type PanelAction =
  | { type: 'OPEN_FILE_PANEL'; terminalId: string }
  | { type: 'CLOSE_FILE_PANEL' }
  | { type: 'OPEN_TEMP_VIEW'; contentKey: string; projectCwd: string; terminalId: string }
  | { type: 'CLOSE_TEMP_VIEW' }
  | { type: 'OPEN_CHAT_HISTORY' }
  | { type: 'CLOSE_CHAT_HISTORY' }
  | { type: 'OPEN_SKILLS_PANEL' }
  | { type: 'CLOSE_SKILLS_PANEL' }
  | { type: 'OPEN_MCP_PANEL' }
  | { type: 'CLOSE_MCP_PANEL' }
  | { type: 'OPEN_HOOKS_PANEL' }
  | { type: 'CLOSE_HOOKS_PANEL' }
  | { type: 'OPEN_PLUGINS_PANEL' }
  | { type: 'CLOSE_PLUGINS_PANEL' }
  | { type: 'TOGGLE_MENU_DROPDOWN'; dropdownType: 'mcp' }
  | { type: 'SHOW_WELCOME' }
  | { type: 'DISMISS_WELCOME' }
  | { type: 'START_TOUR' }
  | { type: 'COMPLETE_TOUR' }
  | { type: 'OPEN_SETTINGS' }
  | { type: 'CLOSE_SETTINGS' }
  | { type: 'CLOSE_ALL' };

// ── Reducer ──

export function panelReducer(state: PanelState, action: PanelAction): PanelState {
  console.log(`[GLYPH:panel] ${Date.now()} action=${action.type}`);
  switch (action.type) {
    case 'OPEN_FILE_PANEL':
      return {
        ...state,
        filePanel: { open: true, terminalId: action.terminalId },
      };
    case 'CLOSE_FILE_PANEL':
      return {
        ...state,
        filePanel: { open: false, terminalId: null },
      };
    case 'OPEN_TEMP_VIEW':
      return {
        ...state,
        tempView: { active: true, contentKey: action.contentKey, projectCwd: action.projectCwd, terminalId: action.terminalId },
      };
    case 'CLOSE_TEMP_VIEW':
      return {
        ...state,
        tempView: { active: false, contentKey: null, projectCwd: null, terminalId: null },
      };
    case 'OPEN_CHAT_HISTORY':
      return {
        ...state,
        chatHistory: { open: true },
      };
    case 'CLOSE_CHAT_HISTORY':
      return {
        ...state,
        chatHistory: { open: false },
      };
    case 'OPEN_SKILLS_PANEL':
      return {
        ...state,
        skillsPanel: { open: true },
      };
    case 'CLOSE_SKILLS_PANEL':
      return {
        ...state,
        skillsPanel: { open: false },
      };
    case 'OPEN_MCP_PANEL':
      return {
        ...state,
        mcpPanel: { open: true },
      };
    case 'CLOSE_MCP_PANEL':
      return {
        ...state,
        mcpPanel: { open: false },
      };
    case 'OPEN_HOOKS_PANEL':
      return {
        ...state,
        hooksPanel: { open: true },
      };
    case 'CLOSE_HOOKS_PANEL':
      return {
        ...state,
        hooksPanel: { open: false },
      };
    case 'OPEN_PLUGINS_PANEL':
      return {
        ...state,
        pluginsPanel: { open: true },
      };
    case 'CLOSE_PLUGINS_PANEL':
      return {
        ...state,
        pluginsPanel: { open: false },
      };
    case 'TOGGLE_MENU_DROPDOWN': {
      const isOpen =
        state.menuDropdown.open && state.menuDropdown.type === action.dropdownType;
      return {
        ...state,
        menuDropdown: isOpen
          ? { open: false, type: null }
          : { open: true, type: action.dropdownType },
      };
    }
    case 'SHOW_WELCOME':
      return { ...initialState, tour: { active: false, welcomeVisible: true } };
    case 'DISMISS_WELCOME':
      return { ...state, tour: { active: false, welcomeVisible: false } };
    case 'START_TOUR':
      return { ...initialState, tour: { active: true, welcomeVisible: false } };
    case 'COMPLETE_TOUR':
      return { ...state, tour: { active: false, welcomeVisible: false } };
    case 'OPEN_SETTINGS':
      return { ...initialState, settingsModal: { open: true } };
    case 'CLOSE_SETTINGS':
      return { ...state, settingsModal: { open: false } };
    case 'CLOSE_ALL':
      return { ...initialState, tour: state.tour };
    default:
      return state;
  }
}

// ── Context ──

interface PanelContextValue {
  state: PanelState;
  dispatch: React.Dispatch<PanelAction>;
}

const PanelContext = createContext<PanelContextValue | null>(null);

// Separate context for dispatch only — dispatch reference from useReducer is
// guaranteed stable, so components subscribing to this context will never
// re-render due to state changes. This prevents React.memo bypass when a
// component only needs dispatch (e.g. TerminalTile).
const PanelDispatchContext = createContext<Dispatch<PanelAction> | null>(null);

// ── Provider ──

export function PanelProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, dispatch] = useReducer(panelReducer, initialState);

  return (
    <PanelDispatchContext.Provider value={dispatch}>
      <PanelContext.Provider value={{ state, dispatch }}>
        {children}
      </PanelContext.Provider>
    </PanelDispatchContext.Provider>
  );
}

// ── Hook ──

export function usePanelContext(): PanelContextValue {
  const ctx = useContext(PanelContext);
  if (!ctx) {
    throw new Error('usePanelContext must be used within a PanelProvider');
  }
  return ctx;
}

/** Use only dispatch without subscribing to state — avoids re-renders on state changes */
export function usePanelDispatch(): Dispatch<PanelAction> {
  const dispatch = useContext(PanelDispatchContext);
  if (!dispatch) {
    throw new Error('usePanelDispatch must be used within a PanelProvider');
  }
  return dispatch;
}
