/**
 * MCP Server Configuration Types
 * Used by McpPanel and useMcpConfig hook
 */

/** MCP server transport type */
export type McpServerType = 'stdio' | 'http' | 'sse';

/** Config source scope */
export type McpConfigScope = 'global' | 'project' | 'desktop';

/** MCP server configuration entry */
export interface McpServerConfig {
  /** Server name (key in mcpServers object) */
  name: string;
  /** Transport type */
  type: McpServerType;
  /** Config source scope */
  scope: McpConfigScope;
  /** Command for stdio type */
  command?: string;
  /** Arguments for stdio type */
  args?: string[];
  /** Environment variables */
  env?: Record<string, string>;
  /** URL for http/sse type */
  url?: string;
  /** HTTP headers for http/sse type */
  headers?: Record<string, string>;
  /** Path to the config file this entry came from */
  configPath?: string;
}
