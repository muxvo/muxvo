/**
 * File Watcher Scopes
 *
 * Defines the three watch scope types for file monitoring.
 */

export interface WatchScope {
  type: 'project-files' | 'session-jsonl' | 'claude-resources';
  description: string;
}

export function getWatchScopes(): WatchScope[] {
  return [
    {
      type: 'project-files',
      description: '项目文件 -- 监听终端 cwd 目录下的文件变化',
    },
    {
      type: 'session-jsonl',
      description: '会话 JSONL -- 监听 Claude Code 会话文件变化',
    },
    {
      type: 'claude-resources',
      description: 'Claude 资源 -- 监听 ~/.claude/ 目录下的配置和资源',
    },
  ];
}
