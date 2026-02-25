/**
 * MCP Server Configuration Types
 * Used by McpPanel and useMcpConfig hook
 */

/** MCP server transport type */
export type McpServerType = 'stdio' | 'http' | 'sse';

/** Config source scope */
export type McpConfigScope = 'global' | 'project' | 'desktop' | 'codex' | 'gemini' | 'codex-project' | 'gemini-project';

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
  // Gemini-specific
  /** HTTP URL for Gemini MCP server */
  httpUrl?: string;
  /** Working directory */
  cwd?: string;
  /** Connection timeout in seconds */
  timeout?: number;
  /** Trust this server */
  trust?: boolean;
  /** Include only these tools */
  includeTools?: string[];
  /** Exclude these tools */
  excludeTools?: string[];
  // Codex-specific
  /** Whether server is enabled */
  enabled?: boolean;
  /** Whether server is required */
  required?: boolean;
  /** Enabled tools list */
  enabledTools?: string[];
  /** Disabled tools list */
  disabledTools?: string[];
  /** Startup timeout in seconds */
  startupTimeoutSec?: number;
  /** Tool execution timeout in seconds */
  toolTimeoutSec?: number;
}
