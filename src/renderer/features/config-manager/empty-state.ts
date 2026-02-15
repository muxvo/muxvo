/**
 * Config Manager Empty State
 *
 * Provides empty state messages for different resource types.
 */

const emptyMessages: Record<string, string> = {
  skills: '还没有 Skills，可以在终端中使用 claude code 自动创建',
  hooks: '还没有配置 Hooks',
  plans: '还没有创建 Plans',
  tasks: '还没有 Tasks',
  memory: '还没有项目记忆',
  mcp: '还没有配置 MCP',
};

export function getEmptyStateMessage(type: string): string {
  return emptyMessages[type] ?? `还没有 ${type}`;
}
