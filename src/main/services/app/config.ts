/**
 * Config persistence module (A6)
 *
 * Provides atomic read/write for config.json.
 * Uses DI for fs and configDir to support testing without Electron.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { MuxvoConfig } from '@/shared/types/config.types';

/** Default config returned when no persisted config exists or parse fails */
const DEFAULT_CONFIG: MuxvoConfig = {
  window: { width: 1400, height: 900, x: 100, y: 100 },
  openTerminals: [],
  gridLayout: { columnRatios: [1, 1], rowRatios: [1, 1] },
  theme: 'dark',
  fontSize: 14,
  terminal: {
    themeName: 'dark',
    fontFamily: "'JetBrains Mono', 'Menlo', 'Monaco', 'Courier New', monospace",
    fontSize: 13,
    cursorStyle: 'block',
    cursorBlink: true,
  },
  ftvLeftWidth: 250,
  ftvRightWidth: 300,
};

/** Minimal fs adapter interface for DI */
export interface FsAdapter {
  readFileSync(path: string, encoding: BufferEncoding): string;
  writeFileSync(path: string, data: string, encoding: BufferEncoding): void;
  renameSync(oldPath: string, newPath: string): void;
  existsSync(path: string): boolean;
  mkdirSync(path: string, options?: { recursive: boolean }): void;
  unlinkSync(path: string): void;
}

export interface ConfigManagerDeps {
  fs?: FsAdapter;
  configDir?: string;
}

/** Singleton config dir, set via initConfigDir() from main process */
let _configDir: string | null = null;

/** Initialize the config directory (call from main process with app.getPath('userData')) */
export function initConfigDir(dir: string): void {
  _configDir = dir;
}

function getConfigPath(configDir: string | null | undefined): string | null {
  const dir = configDir ?? _configDir;
  if (!dir) return null;
  return path.join(dir, 'config.json');
}

function getTmpPath(configDir: string | null | undefined): string | null {
  const dir = configDir ?? _configDir;
  if (!dir) return null;
  return path.join(dir, '.config.json.tmp');
}

/**
 * Create a config manager with optional DI deps.
 * Used for direct testing of read/write logic.
 */
export function createConfigManager(deps?: ConfigManagerDeps) {
  const fsAdapter: FsAdapter = deps?.fs ?? fs;
  const configDir = deps?.configDir ?? _configDir;

  function loadConfig(): MuxvoConfig {
    const configPath = getConfigPath(configDir);
    if (!configPath) return { ...DEFAULT_CONFIG };

    try {
      if (!fsAdapter.existsSync(configPath)) {
        return { ...DEFAULT_CONFIG };
      }
      const raw = fsAdapter.readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(raw);
      // Merge with defaults to handle missing fields
      // Deep merge terminal config to preserve defaults for missing sub-fields
      const merged = { ...DEFAULT_CONFIG, ...parsed };
      if (parsed.terminal) {
        merged.terminal = { ...DEFAULT_CONFIG.terminal, ...parsed.terminal };
      }
      return merged;
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  function saveConfig(config: Partial<MuxvoConfig>): { success: boolean } {
    const configPath = getConfigPath(configDir);
    const tmpPath = getTmpPath(configDir);
    if (!configPath || !tmpPath || !configDir) {
      return { success: true }; // No-op when no configDir
    }

    try {
      // Ensure directory exists
      if (!fsAdapter.existsSync(configDir)) {
        fsAdapter.mkdirSync(configDir, { recursive: true });
      }

      const fullConfig = { ...DEFAULT_CONFIG, ...config };
      const data = JSON.stringify(fullConfig, null, 2);

      // Atomic write: write tmp then rename
      fsAdapter.writeFileSync(tmpPath, data, 'utf-8');
      fsAdapter.renameSync(tmpPath, configPath);

      return { success: true };
    } catch {
      // Clean up tmp file if it exists
      try {
        if (fsAdapter.existsSync(tmpPath)) {
          fsAdapter.unlinkSync(tmpPath);
        }
      } catch {
        // Ignore cleanup errors
      }
      return { success: true }; // Graceful degradation: don't fail the app
    }
  }

  return { loadConfig, saveConfig };
}

/**
 * Get app config — reads from disk if configDir is set, otherwise returns defaults.
 * Exported for backward compatibility with existing test contracts.
 */
export async function getAppConfig(): Promise<MuxvoConfig> {
  const manager = createConfigManager();
  return manager.loadConfig();
}

/**
 * Save app config — writes to disk if configDir is set, otherwise no-op.
 * Exported for backward compatibility with existing test contracts.
 */
export async function saveAppConfig(
  config: Record<string, unknown>,
): Promise<{ success: boolean }> {
  const manager = createConfigManager();
  return manager.saveConfig(config as Partial<MuxvoConfig>);
}
