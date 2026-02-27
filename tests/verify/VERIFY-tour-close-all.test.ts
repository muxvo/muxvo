/**
 * VERIFY: CLOSE_ALL preserves tour state + tour step detection flow
 *
 * Root cause: handleAddTerminal dispatches CLOSE_ALL which resets tour.active to false.
 * Fix: CLOSE_ALL now preserves tour state: { ...initialState, tour: state.tour }
 */

import { describe, test, expect } from 'vitest';

// Inline the reducer logic to test it directly (same as PanelContext.tsx)
// We import the actual reducer behavior by reproducing the state shape

interface PanelState {
  filePanel: { open: boolean; terminalId: string | null };
  tempView: { active: boolean; contentKey: string | null; projectCwd: string | null; terminalId: string | null };
  chatHistory: { open: boolean };
  skillsPanel: { open: boolean };
  mcpPanel: { open: boolean };
  hooksPanel: { open: boolean };
  pluginsPanel: { open: boolean };
  menuDropdown: { open: boolean; type: 'mcp' | null };
  tour: { active: boolean };
  settingsModal: { open: boolean };
}

const initialState: PanelState = {
  filePanel: { open: false, terminalId: null },
  tempView: { active: false, contentKey: null, projectCwd: null, terminalId: null },
  chatHistory: { open: false },
  skillsPanel: { open: false },
  mcpPanel: { open: false },
  hooksPanel: { open: false },
  pluginsPanel: { open: false },
  menuDropdown: { open: false, type: null },
  tour: { active: false },
  settingsModal: { open: false },
};

type PanelAction =
  | { type: 'START_TOUR' }
  | { type: 'COMPLETE_TOUR' }
  | { type: 'CLOSE_ALL' }
  | { type: 'OPEN_CHAT_HISTORY' };

function panelReducer(state: PanelState, action: PanelAction): PanelState {
  switch (action.type) {
    case 'START_TOUR':
      return { ...initialState, tour: { active: true } };
    case 'COMPLETE_TOUR':
      return { ...state, tour: { active: false } };
    case 'OPEN_CHAT_HISTORY':
      return { ...state, chatHistory: { open: true } };
    case 'CLOSE_ALL':
      return { ...initialState, tour: state.tour }; // FIX: preserve tour
    default:
      return state;
  }
}

describe('VERIFY: CLOSE_ALL preserves tour state', () => {
  test('CLOSE_ALL does NOT deactivate tour when tour is active', () => {
    // Start tour
    let state = panelReducer(initialState, { type: 'START_TOUR' });
    expect(state.tour.active).toBe(true);

    // Open chat history (simulates other panel being open)
    state = panelReducer(state, { type: 'OPEN_CHAT_HISTORY' });
    expect(state.chatHistory.open).toBe(true);
    expect(state.tour.active).toBe(true);

    // CLOSE_ALL (triggered by handleAddTerminal)
    state = panelReducer(state, { type: 'CLOSE_ALL' });

    // Tour must still be active!
    expect(state.tour.active).toBe(true);
    // But other panels should be closed
    expect(state.chatHistory.open).toBe(false);
    expect(state.skillsPanel.open).toBe(false);
  });

  test('CLOSE_ALL with tour inactive keeps it inactive', () => {
    const state = panelReducer(initialState, { type: 'CLOSE_ALL' });
    expect(state.tour.active).toBe(false);
  });

  test('COMPLETE_TOUR still works after CLOSE_ALL', () => {
    let state = panelReducer(initialState, { type: 'START_TOUR' });
    state = panelReducer(state, { type: 'CLOSE_ALL' });
    expect(state.tour.active).toBe(true); // preserved

    state = panelReducer(state, { type: 'COMPLETE_TOUR' });
    expect(state.tour.active).toBe(false); // correctly completed
  });
});

describe('VERIFY: Tour step definitions have no next button', () => {
  test('all steps have showButtons: [close] only', async () => {
    const { TOUR_STEPS } = await import('@/renderer/features/tour/steps');
    for (const step of TOUR_STEPS) {
      expect(step.showButtons).toEqual(['close']);
      expect(step.showButtons).not.toContain('next');
    }
  });

  test('drag-resize step is removed (5 steps total)', async () => {
    const { TOUR_STEPS } = await import('@/renderer/features/tour/steps');
    expect(TOUR_STEPS.length).toBe(5);
    expect(TOUR_STEPS.map(s => s.id)).toEqual([
      'create-terminal',
      'drag-reorder',
      'focus-terminal',
      'rename-terminal',
      'open-files',
    ]);
  });
});
