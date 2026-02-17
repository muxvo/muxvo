/**
 * Config IPC Handlers
 *
 * Handles config:get-resources, config:get-resource-content, config:get-settings,
 * config:get-claude-md, config:save-settings, config:save-claude-md IPC channels.
 */

import { ipcMain } from 'electron';
import { homedir } from 'os';
import { join, resolve, extname } from 'path';
import { readdir, readFile, writeFile, rename, stat, mkdir } from 'fs/promises';
import { IPC_CHANNELS } from '@/shared/constants/channels';
import type { ResourceType, Resource, ClaudeMdScope } from '@/shared/types/config.types';

const CLAUDE_DIR = join(homedir(), '.claude');

/** ResourceType → directory/file mapping under ~/.claude/ */
const RESOURCE_TYPE_MAP: Record<ResourceType, { path: string; isFile: boolean }> = {
  skills: { path: join(CLAUDE_DIR, 'skills'), isFile: false },
  hooks: { path: join(CLAUDE_DIR, 'hooks'), isFile: false },
  plans: { path: join(CLAUDE_DIR, 'plans'), isFile: false },
  tasks: { path: join(CLAUDE_DIR, 'tasks'), isFile: false },
  plugins: { path: join(CLAUDE_DIR, 'plugins'), isFile: false },
  mcp: { path: join(CLAUDE_DIR, 'mcp.json'), isFile: true },
};

/** Files to exclude when scanning resource directories */
const EXCLUDED_FILES = new Set([
  'node_modules',
  'package.json',
  'package-lock.json',
  '.DS_Store',
]);

/** Infer format from file extension */
function inferFormat(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const formatMap: Record<string, string> = {
    '.json': 'json',
    '.md': 'markdown',
    '.ts': 'typescript',
    '.js': 'javascript',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.toml': 'toml',
    '.txt': 'text',
  };
  return formatMap[ext] || 'text';
}

export function createConfigHandlers() {
  return {
    /**
     * P0: Scan ~/.claude/ for resources of specified types
     */
    async getResources(params?: { types?: ResourceType[] }): Promise<{ resources: Resource[] }> {
      const types = params?.types || (Object.keys(RESOURCE_TYPE_MAP) as ResourceType[]);
      const resources: Resource[] = [];

      for (const type of types) {
        const mapping = RESOURCE_TYPE_MAP[type];
        if (!mapping) continue;

        if (mapping.isFile) {
          // Single file resource (e.g., mcp.json)
          try {
            const fileStat = await stat(mapping.path);
            resources.push({
              name: mapping.path.split('/').pop()!,
              type,
              path: mapping.path,
              updatedAt: fileStat.mtime.toISOString(),
            });
          } catch {
            // File doesn't exist, skip
          }
        } else {
          // Directory resource
          try {
            const entries = await readdir(mapping.path, { withFileTypes: true });
            for (const entry of entries) {
              if (EXCLUDED_FILES.has(entry.name)) continue;
              const entryPath = join(mapping.path, entry.name);
              try {
                const entryStat = await stat(entryPath);
                resources.push({
                  name: entry.name,
                  type,
                  path: entryPath,
                  updatedAt: entryStat.mtime.toISOString(),
                });
              } catch {
                // Skip entries we can't stat
              }
            }
          } catch {
            // Directory doesn't exist, skip
          }
        }
      }

      return { resources };
    },

    /**
     * P0: Read file content, path must be under ~/.claude/
     */
    async getResourceContent(params: { path: string }): Promise<{ content: string; format: string }> {
      const resolvedPath = resolve(params.path);

      // Security: ensure path is within ~/.claude/
      if (!resolvedPath.startsWith(CLAUDE_DIR)) {
        throw new Error(`Access denied: path must be within ${CLAUDE_DIR}`);
      }

      const content = await readFile(resolvedPath, 'utf-8');
      const format = inferFormat(resolvedPath);
      return { content, format };
    },

    /**
     * P0: Read ~/.claude/settings.json
     */
    async getSettings(): Promise<{ settings: Record<string, unknown> }> {
      const settingsPath = join(CLAUDE_DIR, 'settings.json');
      try {
        const raw = await readFile(settingsPath, 'utf-8');
        return { settings: JSON.parse(raw) };
      } catch {
        return { settings: {} };
      }
    },

    /**
     * P0: Read global or project CLAUDE.md
     */
    async getClaudeMd(params: { scope: ClaudeMdScope; projectPath?: string }): Promise<{ content: string }> {
      let filePath: string;
      if (params.scope === 'global') {
        filePath = join(CLAUDE_DIR, 'CLAUDE.md');
      } else {
        if (!params.projectPath) {
          throw new Error('projectPath is required for project scope');
        }
        filePath = join(params.projectPath, 'CLAUDE.md');
      }

      try {
        const content = await readFile(filePath, 'utf-8');
        return { content };
      } catch {
        return { content: '' };
      }
    },

    /**
     * P1: Atomic write to ~/.claude/settings.json
     */
    async saveSettings(params: { settings: Record<string, unknown> }): Promise<{ success: boolean }> {
      const settingsPath = join(CLAUDE_DIR, 'settings.json');
      const tmpPath = settingsPath + '.tmp';

      // Ensure ~/.claude/ directory exists
      await mkdir(CLAUDE_DIR, { recursive: true });

      const data = JSON.stringify(params.settings, null, 2);
      await writeFile(tmpPath, data, 'utf-8');
      await rename(tmpPath, settingsPath);

      return { success: true };
    },

    /**
     * P1: Atomic write to CLAUDE.md (global or project)
     */
    async saveClaudeMd(params: { scope: ClaudeMdScope; projectPath?: string; content: string }): Promise<{ success: boolean }> {
      let filePath: string;
      if (params.scope === 'global') {
        filePath = join(CLAUDE_DIR, 'CLAUDE.md');
      } else {
        if (!params.projectPath) {
          throw new Error('projectPath is required for project scope');
        }
        filePath = join(params.projectPath, 'CLAUDE.md');
      }

      const tmpPath = filePath + '.tmp';

      // Ensure parent directory exists
      const parentDir = filePath.substring(0, filePath.lastIndexOf('/'));
      await mkdir(parentDir, { recursive: true });

      await writeFile(tmpPath, params.content, 'utf-8');
      await rename(tmpPath, filePath);

      return { success: true };
    },
  };
}

// Legacy export for tests
export const configHandlers = createConfigHandlers();

/**
 * Register config IPC handlers with ipcMain.
 */
export function registerConfigHandlers(): void {
  const handlers = createConfigHandlers();

  ipcMain.handle(IPC_CHANNELS.CONFIG.GET_RESOURCES, async (_event, params?: { types?: ResourceType[] }) => {
    return handlers.getResources(params);
  });

  ipcMain.handle(IPC_CHANNELS.CONFIG.GET_RESOURCE_CONTENT, async (_event, params: { path: string }) => {
    return handlers.getResourceContent(params);
  });

  ipcMain.handle(IPC_CHANNELS.CONFIG.GET_SETTINGS, async () => {
    return handlers.getSettings();
  });

  ipcMain.handle(IPC_CHANNELS.CONFIG.GET_CLAUDE_MD, async (_event, params: { scope: ClaudeMdScope; projectPath?: string }) => {
    return handlers.getClaudeMd(params);
  });

  ipcMain.handle(IPC_CHANNELS.CONFIG.SAVE_SETTINGS, async (_event, params: { settings: Record<string, unknown> }) => {
    return handlers.saveSettings(params);
  });

  ipcMain.handle(IPC_CHANNELS.CONFIG.SAVE_CLAUDE_MD, async (_event, params: { scope: ClaudeMdScope; projectPath?: string; content: string }) => {
    return handlers.saveClaudeMd(params);
  });
}
