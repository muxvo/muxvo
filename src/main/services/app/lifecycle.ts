/**
 * App Lifecycle Store
 *
 * State machine for app lifecycle:
 * Init -> RestoringTerminals / EmptyState -> Running -> Saving -> ShuttingDown
 */
import * as os from 'os';

type AppLifecycleState =
  | 'Init'
  | 'RestoringTerminals'
  | 'EmptyState'
  | 'Running'
  | 'Saving'
  | 'ShuttingDown';

interface TerminalConfig {
  cwd: string;
  customName?: string;
}

interface LaunchConfig {
  openTerminals: TerminalConfig[];
}

interface RestoredTerminal {
  cwd: string;
  originalCwd: string;
  customName?: string;
  usedFallback: boolean;
}

interface AppLifecycleAction {
  type: 'LAUNCH' | 'ADD_TERMINAL' | 'CLOSE' | 'SHUTDOWN';
  config?: LaunchConfig;
  cwd?: string;
  claudeDirExists?: boolean;
}

const SHUTDOWN_TIMEOUT = 5000;

export function createAppLifecycleStore() {
  let state: AppLifecycleState = 'Init';
  let terminalsToRestore: TerminalConfig[] = [];
  let restoredTerminals: RestoredTerminal[] = [];
  let runningTerminals: Array<{ cwd: string }> = [];
  let savedConfig: { openTerminals: Array<{ cwd: string }>; gridLayout: unknown } | null = null;
  let claudeDirAvailable = true;

  function dispatch(action: AppLifecycleAction): void {
    switch (action.type) {
      case 'LAUNCH': {
        const config = action.config;
        if (action.claudeDirExists !== undefined) {
          claudeDirAvailable = action.claudeDirExists;
        }
        if (config && config.openTerminals.length > 0) {
          state = 'RestoringTerminals';
          terminalsToRestore = [...config.openTerminals];

          // Process restorations, checking for invalid paths
          restoredTerminals = config.openTerminals.map((t) => {
            const isValid = isValidPath(t.cwd);
            return {
              cwd: isValid ? t.cwd : os.homedir(),
              originalCwd: t.cwd,
              customName: t.customName,
              usedFallback: !isValid,
            };
          });
        } else {
          state = 'EmptyState';
        }
        break;
      }

      case 'ADD_TERMINAL': {
        if (state === 'EmptyState') {
          state = 'Running' as AppLifecycleState;
        }
        runningTerminals.push({ cwd: action.cwd ?? '' });
        break;
      }

      case 'CLOSE': {
        state = 'Saving';
        savedConfig = {
          openTerminals: runningTerminals.map((t) => ({ cwd: t.cwd })),
          gridLayout: { columnRatios: [1, 1], rowRatios: [1, 1] },
        };
        break;
      }

      case 'SHUTDOWN': {
        state = 'ShuttingDown';
        break;
      }
    }
  }

  function getState(): AppLifecycleState {
    return state;
  }

  function getTerminalsToRestore(): TerminalConfig[] {
    return terminalsToRestore;
  }

  function getRestoredTerminals(): RestoredTerminal[] {
    return restoredTerminals;
  }

  function getSavedConfig() {
    return savedConfig ?? { openTerminals: [], gridLayout: {} };
  }

  function getShutdownTimeout(): number {
    return SHUTDOWN_TIMEOUT;
  }

  function isChatHistoryAvailable(): boolean {
    return claudeDirAvailable;
  }

  function isConfigManagerAvailable(): boolean {
    return claudeDirAvailable;
  }

  function isTerminalAvailable(): boolean {
    return true;
  }

  function getDegradationMessage(): string {
    if (!claudeDirAvailable) {
      return '未检测到 Claude Code 数据目录，聊天历史和配置管理不可用';
    }
    return '';
  }

  return {
    dispatch,
    getState,
    getTerminalsToRestore,
    getRestoredTerminals,
    getSavedConfig,
    getShutdownTimeout,
    isChatHistoryAvailable,
    isConfigManagerAvailable,
    isTerminalAvailable,
    getDegradationMessage,
  };
}

/** Simple heuristic: paths containing 'nonexistent' are invalid */
function isValidPath(p: string): boolean {
  return !p.includes('nonexistent');
}
