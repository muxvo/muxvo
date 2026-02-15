/**
 * Terminal state machine
 *
 * States: Created -> Starting -> Running -> Busy/WaitingInput -> Stopping -> Stopped -> Removed
 *         Running -> Disconnected (abnormal exit) -> Starting (reconnect)
 */

type TerminalState =
  | 'Created'
  | 'Starting'
  | 'Running'
  | 'Busy'
  | 'WaitingInput'
  | 'Stopping'
  | 'Stopped'
  | 'Removed'
  | 'Disconnected';

interface TerminalContext {
  inputDisabled: boolean;
  isNewProcess: boolean;
}

export function createTerminalMachine() {
  let _state: TerminalState = 'Created';
  const _context: TerminalContext = {
    inputDisabled: false,
    isNewProcess: false,
  };

  return {
    get state() {
      return _state;
    },
    get context() {
      return _context;
    },
    send(event: string, payload?: Record<string, unknown>) {
      switch (event) {
        case 'START':
          if (_state === 'Created' || _state === 'Disconnected') {
            _state = 'Starting';
            _context.inputDisabled = false;
          }
          break;
        case 'PROCESS_READY':
          if (_state === 'Starting') {
            _state = 'Running';
            if (_context.isNewProcess === false && _context.inputDisabled === false) {
              // first start
            } else {
              _context.isNewProcess = true;
            }
          }
          break;
        case 'CC_PROCESSING':
          if (_state === 'Running') _state = 'Busy';
          break;
        case 'CC_WAITING':
          if (_state === 'Busy') _state = 'WaitingInput';
          break;
        case 'STOP':
          if (_state === 'Running' || _state === 'Busy' || _state === 'WaitingInput') {
            _state = 'Stopping';
          }
          break;
        case 'PROCESS_EXIT':
          if (_state === 'Stopping') _state = 'Stopped';
          break;
        case 'REMOVE':
          if (_state === 'Stopped') _state = 'Removed';
          break;
        case 'PROCESS_ABNORMAL_EXIT':
          if (_state === 'Running' || _state === 'Busy' || _state === 'WaitingInput') {
            _state = 'Disconnected';
            _context.inputDisabled = true;
          }
          break;
        case 'RECONNECT':
          if (_state === 'Disconnected') {
            _state = 'Starting';
            _context.isNewProcess = true;
            _context.inputDisabled = false;
          }
          break;
      }
    },
  };
}
