/**
 * Hook Configuration Types
 * Used by HooksPanel and useHookConfig hook
 */

/** All supported hook event names from Claude Code */
export type HookEventName =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'PermissionRequest'
  | 'SessionStart'
  | 'SessionEnd'
  | 'UserPromptSubmit'
  | 'Stop'
  | 'SubagentStart'
  | 'SubagentStop'
  | 'TeammateIdle'
  | 'TaskCompleted'
  | 'Notification'
  | 'ConfigChange'
  | 'PreCompact';

/** Hook handler type */
export type HookHandlerType = 'command' | 'prompt' | 'agent';

/** Config source scope */
export type HookConfigScope = 'global' | 'project' | 'project-local';

/** A single hook handler definition */
export interface HookHandler {
  type: HookHandlerType;
  command: string;
  timeout?: number;
  async?: boolean;
  statusMessage?: string;
  once?: boolean;
}

/** A matcher group containing one or more handlers */
export interface HookMatcherGroup {
  matcher?: string;
  hooks: HookHandler[];
}

/** Flattened hook entry for UI display (one row per handler) */
export interface HookEntry {
  /** Unique ID for UI key (event:matcher:index) */
  id: string;
  /** Event that triggers this hook */
  event: HookEventName;
  /** Optional tool/pattern matcher */
  matcher?: string;
  /** The handler definition */
  handler: HookHandler;
  /** Config source scope */
  scope: HookConfigScope;
  /** Path to the config file */
  configPath: string;
}
