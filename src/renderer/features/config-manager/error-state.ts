/**
 * Config Manager Error State
 *
 * Provides error state configuration for different failure scenarios.
 */

export interface ErrorState {
  message: string;
  icon: string;
  button: string;
}

const errorStates: Record<string, ErrorState> = {
  settings_read_failed: {
    message: '无法读取 settings.json',
    icon: 'warning',
    button: '[重试]',
  },
  claudemd_read_failed: {
    message: '无法读取 CLAUDE.md',
    icon: 'warning',
    button: '[重试]',
  },
};

export function getErrorState(errorType: string): ErrorState {
  return errorStates[errorType] ?? { message: '未知错误', icon: 'error', button: '[重试]' };
}
