/**
 * Terminal CD Strategy
 *
 * Decision tree for directory changes based on foreground process state.
 * PRD 6.7: shell -> direct cd, AI tool -> confirm dialog.
 */

interface CdStrategyInput {
  foregroundProcess: string;
  shellList: readonly string[] | string[];
  targetPath?: string;
}

interface CdAction {
  type: string;
  path?: string;
}

interface DirectStrategy {
  type: 'direct';
  command: string;
}

interface ConfirmStrategy {
  type: 'confirm';
  message: string;
  onConfirm: () => CdAction[];
  onCancel: () => CdAction[];
}

type CdStrategy = DirectStrategy | ConfirmStrategy;

export function getCdStrategy(input: CdStrategyInput): CdStrategy {
  const { foregroundProcess, shellList, targetPath } = input;
  const isShell = (shellList as string[]).includes(foregroundProcess);

  if (isShell) {
    return {
      type: 'direct',
      command: `cd ${targetPath ?? '/'}`,
    };
  }

  return {
    type: 'confirm',
    message: `${foregroundProcess} 正在运行，是否退出并切换目录？`,
    onConfirm() {
      return [
        { type: 'SIGINT' },
        { type: 'WAIT_SHELL' },
        { type: 'CD', path: targetPath },
      ];
    },
    onCancel() {
      return [];
    },
  };
}

export function getCdChainActions(path: string): CdAction[] {
  return [
    { type: 'UPDATE_CWD', path },
    { type: 'CHECK_AUTO_GROUP' },
    { type: 'UPDATE_FILE_BUTTON' },
  ];
}
