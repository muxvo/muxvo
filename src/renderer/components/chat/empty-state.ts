/**
 * Empty State Config
 *
 * Configuration for empty state displays in the chat panel.
 */

type EmptyStateType = 'noCC' | 'noHistory';

export function getEmptyStateConfig(type: EmptyStateType) {
  if (type === 'noCC') {
    return {
      message: '未检测到 Claude Code 聊天记录，请先安装并使用 Claude Code。',
      icon: 'dialog bubble' as const,
      button: {
        text: '了解 Claude Code',
        url: 'https://docs.anthropic.com/claude-code',
      },
    };
  }

  // noHistory
  return {
    message: '还没有聊天记录，开始使用 Claude Code 后这里会自动显示。',
    icon: 'empty-box' as const,
    button: {
      text: '开始使用',
      url: '',
    },
  };
}
