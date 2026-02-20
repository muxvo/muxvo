/**
 * PanelContext — Centralized panel state management
 * Decouples panel open/close logic from App.tsx
 */

import { createContext, useContext, useReducer, type ReactNode } from 'react';

// ── State Shape ──

export interface PanelState {
  filePanel: { open: boolean; terminalId: string | null };
  tempView: { active: boolean; contentKey: string | null };
  chatHistory: { open: boolean };
  menuDropdown: { open: boolean; type: 'skills' | 'mcp' | null };
}

const initialState: PanelState = {
  filePanel: { open: false, terminalId: null },
  tempView: { active: false, contentKey: null },
  chatHistory: { open: false },
  menuDropdown: { open: false, type: null },
};

// ── Actions ──

type PanelAction =
  | { type: 'OPEN_FILE_PANEL'; terminalId: string }
  | { type: 'CLOSE_FILE_PANEL' }
  | { type: 'OPEN_TEMP_VIEW'; contentKey: string }
  | { type: 'CLOSE_TEMP_VIEW' }
  | { type: 'OPEN_CHAT_HISTORY' }
  | { type: 'CLOSE_CHAT_HISTORY' }
  | { type: 'TOGGLE_MENU_DROPDOWN'; dropdownType: 'skills' | 'mcp' }
  | { type: 'CLOSE_ALL' };

// ── Reducer ──

function panelReducer(state: PanelState, action: PanelAction): PanelState {
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
        tempView: { active: true, contentKey: action.contentKey },
      };
    case 'CLOSE_TEMP_VIEW':
      return {
        ...state,
        tempView: { active: false, contentKey: null },
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
    case 'CLOSE_ALL':
      return { ...initialState };
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

// ── Provider ──

export function PanelProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, dispatch] = useReducer(panelReducer, initialState);

  return (
    <PanelContext.Provider value={{ state, dispatch }}>
      {children}
    </PanelContext.Provider>
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
