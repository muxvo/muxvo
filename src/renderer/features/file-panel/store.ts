/**
 * File Panel Store
 *
 * State machine for the file panel: Closed <-> Open, with terminal switching
 * and temp view transition support.
 */

type FilePanelState = 'Closed' | 'Open';

interface TransitionInfo {
  from: string;
  to: string;
  duration: number;
}

interface FilePanelAction {
  type: string;
  terminalId?: string;
  fileId?: string;
}

export function createFilePanelStore() {
  let state: FilePanelState = 'Closed';
  let currentTerminal: string | null = null;
  let tempViewActive = false;
  let animating = false;
  let lastTransition: TransitionInfo = { from: '', to: '', duration: 0 };

  function dispatch(action: FilePanelAction) {
    switch (action.type) {
      case 'OPEN': {
        if (state === 'Closed') {
          state = 'Open';
          lastTransition = {
            from: 'translateX(100%)',
            to: 'translateX(0)',
            duration: 300,
          };
          animating = true;
        }
        if (action.terminalId) {
          currentTerminal = action.terminalId;
        }
        break;
      }
      case 'CLOSE': {
        if (state === 'Open') {
          lastTransition = {
            from: 'translateX(0)',
            to: 'translateX(100%)',
            duration: 300,
          };
          state = 'Closed';
          animating = false;
        }
        break;
      }
      case 'SWITCH': {
        if (action.terminalId) {
          currentTerminal = action.terminalId;
          animating = false;
        }
        break;
      }
      case 'OPEN_FILE': {
        // Opening a file closes the panel and activates temp view
        state = 'Closed';
        tempViewActive = true;
        animating = false;
        break;
      }
    }
  }

  return {
    getState(): FilePanelState {
      return state;
    },
    getCurrentTerminal(): string | null {
      return currentTerminal;
    },
    isTempViewActive(): boolean {
      return tempViewActive;
    },
    hasAnimation(): boolean {
      return animating;
    },
    getTransition(): TransitionInfo {
      return lastTransition;
    },
    dispatch,
  };
}
