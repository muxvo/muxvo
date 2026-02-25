/**
 * Plugin Configuration Types
 * Used by PluginPanel and usePluginConfig hook
 */

/** Plugin install scope */
export type PluginScope = 'user' | 'project';

/** A single installed plugin installation record (from installed_plugins.json) */
export interface PluginInstallRecord {
  /** Install scope */
  scope: PluginScope;
  /** Absolute path on disk */
  installPath: string;
  /** Version string */
  version: string;
  /** ISO date of installation */
  installedAt: string;
  /** ISO date of last update */
  lastUpdated: string;
}

/** Plugin manifest from .claude-plugin/plugin.json */
export interface PluginManifest {
  /** Plugin short name */
  name: string;
  /** Plugin description */
  description?: string;
  /** Author information */
  author?: { name?: string; email?: string };
}

/** Bundled content summary of a plugin */
export interface PluginContents {
  /** Command names */
  commands: string[];
  /** Skill names */
  skills: string[];
  /** Hook names */
  hooks: string[];
  /** Agent names */
  agents: string[];
}

/** Flattened plugin entry for UI display */
export interface PluginEntry {
  /** Unique key: "name@marketplace" */
  id: string;
  /** Plugin short name */
  name: string;
  /** Marketplace source name */
  marketplace: string;
  /** Version string */
  version: string;
  /** Install scope */
  scope: PluginScope;
  /** Absolute path on disk */
  installPath: string;
  /** Whether enabled in settings.json */
  enabled: boolean;
  /** ISO date of installation */
  installedAt: string;
  /** ISO date of last update */
  lastUpdated: string;
  /** Manifest data (description, author) */
  manifest?: PluginManifest;
  /** Bundled content summary */
  contents?: PluginContents;
}
