/**
 * File Viewer Empty State
 *
 * Provides empty state configuration for different scenarios.
 */

export interface EmptyStateConfig {
  message: string;
  icon: string;
}

const emptyStates: Record<string, EmptyStateConfig> = {
  empty: {
    message: '此目录为空',
    icon: 'folder',
  },
  permissionDenied: {
    message: '无法读取此目录，请检查权限',
    icon: 'lock',
  },
};

export function getEmptyStateConfig(type: string): EmptyStateConfig {
  return emptyStates[type] ?? { message: '', icon: '' };
}
