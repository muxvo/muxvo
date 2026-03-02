/**
 * VERIFY: CLOSE_ALL preserves tour state + tour step detection flow
 *
 * Root cause: handleAddTerminal dispatches CLOSE_ALL which resets tour.active to false.
 * Fix: CLOSE_ALL now preserves tour state: { ...initialState, tour: state.tour }
 */

import { describe, test, expect } from 'vitest';
import { panelReducer, initialState } from '@/renderer/contexts/PanelContext';

describe('VERIFY: CLOSE_ALL preserves tour state', () => {
  test('CLOSE_ALL does NOT deactivate tour when tour is active', () => {
    // Start tour
    let state = panelReducer(initialState, { type: 'START_TOUR' });
    expect(state.tour.active).toBe(true);
    expect(state.tour.welcomeVisible).toBe(false);

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
    expect(state.tour.welcomeVisible).toBe(false);
  });

  test('CLOSE_ALL preserves welcome state', () => {
    let state = panelReducer(initialState, { type: 'SHOW_WELCOME' });
    expect(state.tour.welcomeVisible).toBe(true);

    state = panelReducer(state, { type: 'CLOSE_ALL' });
    expect(state.tour.welcomeVisible).toBe(true);
    expect(state.tour.active).toBe(false);
  });

  test('COMPLETE_TOUR still works after CLOSE_ALL', () => {
    let state = panelReducer(initialState, { type: 'START_TOUR' });
    state = panelReducer(state, { type: 'CLOSE_ALL' });
    expect(state.tour.active).toBe(true); // preserved

    state = panelReducer(state, { type: 'COMPLETE_TOUR' });
    expect(state.tour.active).toBe(false); // correctly completed
    expect(state.tour.welcomeVisible).toBe(false);
  });
});

describe('VERIFY: Welcome → Tour state transitions', () => {
  test('SHOW_WELCOME sets welcomeVisible and resets other panels', () => {
    let state = panelReducer(initialState, { type: 'OPEN_CHAT_HISTORY' });
    state = panelReducer(state, { type: 'SHOW_WELCOME' });
    expect(state.tour.welcomeVisible).toBe(true);
    expect(state.tour.active).toBe(false);
    expect(state.chatHistory.open).toBe(false);
  });

  test('DISMISS_WELCOME hides welcome without starting tour', () => {
    let state = panelReducer(initialState, { type: 'SHOW_WELCOME' });
    state = panelReducer(state, { type: 'DISMISS_WELCOME' });
    expect(state.tour.welcomeVisible).toBe(false);
    expect(state.tour.active).toBe(false);
  });

  test('START_TOUR from welcome hides welcome and activates tour', () => {
    let state = panelReducer(initialState, { type: 'SHOW_WELCOME' });
    state = panelReducer(state, { type: 'START_TOUR' });
    expect(state.tour.welcomeVisible).toBe(false);
    expect(state.tour.active).toBe(true);
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

  test('drag-reorder step is removed (4 steps total)', async () => {
    const { TOUR_STEPS } = await import('@/renderer/features/tour/steps');
    expect(TOUR_STEPS.length).toBe(4);
    expect(TOUR_STEPS.map(s => s.id)).toEqual([
      'create-terminal',
      'focus-terminal',
      'rename-terminal',
      'open-files',
    ]);
  });
});
