/**
 * Config Manager Permissions
 *
 * Defines which resource types are read-only vs editable.
 */

export interface ResourcePermissions {
  readOnly: string[];
  editable: string[];
}

export function getResourcePermissions(): ResourcePermissions {
  return {
    readOnly: ['Skills', 'Hooks', 'Plans', 'Tasks', 'Memory', 'MCP'],
    editable: ['Settings', 'CLAUDE.md'],
  };
}
