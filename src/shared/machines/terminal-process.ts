type TerminalState =
  | 'Created'
  | 'Starting'
  | 'Running'
  | 'Busy'
  | 'WaitingInput'
  | 'Stopping'
  | 'Stopped'
  | 'Disconnected'
  | 'Failed'
  | 'Removed';

type TerminalEvent =
  | 'SPAWN'
  | 'SPAWN_SUCCESS'
  | 'SPAWN_FAILURE'
  | 'PROCESS_START'
  | 'PROCESS_DONE'
  | 'WAIT_INPUT'
  | 'USER_INPUT'
  | 'CLOSE'
  | 'EXIT_NORMAL'
  | 'EXIT_ABNORMAL'
  | 'TIMEOUT'
  | 'RECONNECT'
  | 'REMOVE';

const transitions: Record<string, Partial<Record<string, TerminalState>>> = {
  Created: { SPAWN: 'Starting' },
  Starting: { SPAWN_SUCCESS: 'Running', SPAWN_FAILURE: 'Failed' },
  Running: {
    PROCESS_START: 'Busy',
    WAIT_INPUT: 'WaitingInput',
    CLOSE: 'Stopping',
    EXIT_ABNORMAL: 'Disconnected',
  },
  Busy: { PROCESS_DONE: 'Running' },
  WaitingInput: { USER_INPUT: 'Running' },
  Stopping: { EXIT_NORMAL: 'Stopped', TIMEOUT: 'Disconnected' },
  Stopped: { REMOVE: 'Removed' },
  Disconnected: { RECONNECT: 'Starting', REMOVE: 'Removed' },
  Failed: { REMOVE: 'Removed' },
  Removed: {},
};

export function createTerminalMachine() {
  let state: TerminalState = 'Created';

  function send(event: string | { type: string; [key: string]: unknown }) {
    const eventType = typeof event === 'string' ? event : event.type;
    const next = transitions[state]?.[eventType];
    if (next) {
      state = next;
    }
  }

  return {
    get state() {
      return state;
    },
    send,
  };
}
