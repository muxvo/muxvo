/**
 * Terminal process state -> UI mapping.
 */

interface TerminalProcessUI {
  statusDotColor: string;
  statusDotAnimation: string;
  inputEnabled?: boolean;
  inputPlaceholder?: string;
  inputHasOptions?: boolean;
}

const uiMap: Record<string, TerminalProcessUI> = {
  Created: {
    statusDotColor: 'gray',
    statusDotAnimation: 'none',
    inputEnabled: false,
  },
  Starting: {
    statusDotColor: 'yellow',
    statusDotAnimation: 'blink',
    inputEnabled: false,
    inputPlaceholder: '启动中...',
  },
  Running: {
    statusDotColor: 'green',
    statusDotAnimation: 'breathPulse',
    inputEnabled: true,
  },
  Busy: {
    statusDotColor: 'green',
    statusDotAnimation: 'fastPulse',
    inputPlaceholder: '处理中...',
  },
  WaitingInput: {
    statusDotColor: 'amber',
    statusDotAnimation: 'breathPulse',
    inputEnabled: true,
    inputHasOptions: true,
  },
  Stopping: {
    statusDotColor: 'gray',
    statusDotAnimation: 'blink',
    inputEnabled: false,
    inputPlaceholder: '正在关闭...',
  },
  Stopped: {
    statusDotColor: 'gray',
    statusDotAnimation: 'none',
    inputEnabled: false,
  },
  Disconnected: {
    statusDotColor: 'red',
    statusDotAnimation: 'none',
    inputEnabled: false,
    inputPlaceholder: '已断开',
  },
  Failed: {
    statusDotColor: 'red',
    statusDotAnimation: 'none',
    inputEnabled: false,
  },
};

export function getTerminalProcessUI(state: string): TerminalProcessUI {
  return uiMap[state] ?? uiMap.Created;
}
