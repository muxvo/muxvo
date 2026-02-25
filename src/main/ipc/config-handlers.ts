/**
 * Config IPC Handlers
 *
 * Handles config:get-resources, config:get-resource-content, config:get-settings,
 * config:get-claude-md, config:save-settings, config:save-claude-md IPC channels.
 */

import { ipcMain } from 'electron';
import { homedir } from 'os';
import { join, resolve, extname } from 'path';
import { readdir, readFile, writeFile, rename, stat, mkdir, open } from 'fs/promises';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { IPC_CHANNELS } from '@/shared/constants/channels';
import type { ResourceType, Resource, ClaudeMdScope, ContextMdTool } from '@/shared/types/config.types';

const CLAUDE_DIR = join(homedir(), '.claude');
const CODEX_DIR = join(homedir(), '.codex');
const GEMINI_DIR = join(homedir(), '.gemini');

/** Allowed config directories for resource content access */
const ALLOWED_CONFIG_DIRS = [CLAUDE_DIR, CODEX_DIR, GEMINI_DIR];

/** ResourceType → directory/file mapping (supports multiple paths per type) */
const RESOURCE_TYPE_MAP: Record<ResourceType, { paths: string[]; isFile: boolean }> = {
  skills: { paths: [join(CLAUDE_DIR, 'skills'), join(CODEX_DIR, 'skills'), join(GEMINI_DIR, 'skills')], isFile: false },
  hooks: { paths: [join(CLAUDE_DIR, 'hooks')], isFile: false },
  plans: { paths: [join(CLAUDE_DIR, 'plans')], isFile: false },
  tasks: { paths: [join(CLAUDE_DIR, 'tasks')], isFile: false },
  plugins: { paths: [join(CLAUDE_DIR, 'plugins')], isFile: false },
  mcp: { paths: [join(CLAUDE_DIR, 'mcp.json'), join(CODEX_DIR, 'config.toml'), join(GEMINI_DIR, 'settings.json')], isFile: true },
};

/** Derive source tool from directory path */
function sourceFromPath(dirPath: string): string {
  if (dirPath.startsWith(CODEX_DIR)) return 'codex';
  if (dirPath.startsWith(GEMINI_DIR)) return 'gemini';
  return 'claude';
}

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

/** Cache for discovered project cwds (refreshed every 60s) */
let _projectCwdCache: string[] = [];
let _projectCwdCacheTime = 0;
const PROJECT_CWD_CACHE_TTL = 60_000;

/**
 * Extract real cwd from first JSONL file that has a 'cwd' field.
 * Reads at most 20 lines to find it.
 */
async function extractCwdFromProject(projectDir: string): Promise<string | null> {
  try {
    const files = await readdir(projectDir);
    const jsonl = files.find((f) => f.endsWith('.jsonl'));
    if (!jsonl) return null;

    const filePath = join(projectDir, jsonl);
    const rl = createInterface({
      input: createReadStream(filePath, { encoding: 'utf-8' }),
      crlfDelay: Infinity,
    });

    let lineCount = 0;
    for await (const line of rl) {
      if (++lineCount > 20) break;
      try {
        const obj = JSON.parse(line);
        if (obj.cwd) {
          rl.close();
          return obj.cwd;
        }
      } catch {
        // Skip malformed lines
      }
    }
    rl.close();
    return null;
  } catch {
    return null;
  }
}

/**
 * Extract cwd from a Codex session JSONL (type: "session_meta", payload.cwd).
 * Uses event-based approach to avoid stream cleanup issues with for-await + break.
 */
async function extractCwdFromCodexSession(filePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const stream = createReadStream(filePath, { encoding: 'utf-8' });
      const rl = createInterface({ input: stream, crlfDelay: Infinity });
      let lineCount = 0;
      let resolved = false;

      const done = (result: string | null) => {
        if (resolved) return;
        resolved = true;
        rl.close();
        stream.destroy();
        resolve(result);
      };

      rl.on('line', (line) => {
        if (++lineCount > 10) { done(null); return; }
        try {
          const obj = JSON.parse(line);
          if (obj.type === 'session_meta' && obj.payload?.cwd) {
            done(obj.payload.cwd);
          }
        } catch {
          // Skip malformed lines
        }
      });

      rl.on('close', () => done(null));
      rl.on('error', () => done(null));
      stream.on('error', () => done(null));
    } catch {
      resolve(null);
    }
  });
}

/**
 * Recursively find all .jsonl files under a directory.
 */
async function findJsonlFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...(await findJsonlFiles(fullPath)));
      } else if (entry.name.endsWith('.jsonl')) {
        results.push(fullPath);
      }
    }
  } catch {
    // Directory doesn't exist
  }
  return results;
}

/**
 * Extract cwd from a Gemini project temp directory.
 * Reads .project_root file which contains the full absolute path.
 */
async function extractCwdFromGeminiProject(projectDir: string): Promise<string | null> {
  const projectRootPath = join(projectDir, '.project_root');
  try {
    const cwd = (await readFile(projectRootPath, 'utf-8')).trim();
    if (cwd) return cwd;
  } catch {
    // .project_root doesn't exist
  }
  return null;
}

/**
 * Discover all known project cwds from ~/.claude/projects/, ~/.codex/sessions/, and ~/.gemini/tmp/
 */
async function discoverProjectCwds(): Promise<string[]> {
  const now = Date.now();
  if (_projectCwdCache.length > 0 && now - _projectCwdCacheTime < PROJECT_CWD_CACHE_TTL) {
    return _projectCwdCache;
  }

  const cwdSet = new Set<string>();

  // 1. CC projects: ~/.claude/projects/<hash>/<file>.jsonl → extract cwd
  const projectsDir = join(CLAUDE_DIR, 'projects');
  try {
    const entries = await readdir(projectsDir, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory()).map((e) => join(projectsDir, e.name));
    const ccCwds = await Promise.all(dirs.map((d) => extractCwdFromProject(d)));
    for (const cwd of ccCwds) {
      if (cwd) cwdSet.add(cwd);
    }
  } catch {
    // No CC projects
  }

  // 2. Codex sessions: ~/.codex/sessions/**/*.jsonl → extract payload.cwd
  const codexSessionsDir = join(CODEX_DIR, 'sessions');
  try {
    const jsonlFiles = await findJsonlFiles(codexSessionsDir);
    const cxCwds = await Promise.all(jsonlFiles.map((f) => extractCwdFromCodexSession(f)));
    for (const cwd of cxCwds) {
      if (cwd) cwdSet.add(cwd);
    }
  } catch {
    // No Codex sessions
  }

  // 3. Gemini sessions: ~/.gemini/tmp/<hash>/ → extract cwd from logs.json
  const geminiTmpDir = join(GEMINI_DIR, 'tmp');
  try {
    const entries = await readdir(geminiTmpDir, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory()).map((e) => join(geminiTmpDir, e.name));
    const gmCwds = await Promise.all(dirs.map((d) => extractCwdFromGeminiProject(d)));
    for (const cwd of gmCwds) {
      if (cwd) cwdSet.add(cwd);
    }
  } catch {
    // No Gemini sessions
  }

  const uniqueCwds = [...cwdSet];
  _projectCwdCache = uniqueCwds;
  _projectCwdCacheTime = now;
  return uniqueCwds;
}

export function createConfigHandlers() {
  return {
    /**
     * P0: Scan ~/.claude/ for resources of specified types
     * When projectPaths provided, also scan <projectPath>/.claude/skills/ and <projectPath>/.codex/skills/
     */
    async getResources(params?: { types?: ResourceType[]; projectPaths?: string[] }): Promise<{ resources: Resource[] }> {
      const types = params?.types || (Object.keys(RESOURCE_TYPE_MAP) as ResourceType[]);
      const projectPaths = params?.projectPaths || [];
      const resources: Resource[] = [];

      for (const type of types) {
        const mapping = RESOURCE_TYPE_MAP[type];
        if (!mapping) continue;

        // System-level scanning
        for (const dirPath of mapping.paths) {
          const source = sourceFromPath(dirPath);

          if (mapping.isFile) {
            // Single file resource (e.g., mcp.json)
            try {
              const fileStat = await stat(dirPath);
              resources.push({
                name: dirPath.split('/').pop()!,
                type,
                path: dirPath,
                updatedAt: fileStat.mtime.toISOString(),
                source,
                level: 'system',
              });
            } catch {
              // File doesn't exist, skip
            }
          } else {
            // Directory resource
            try {
              const entries = await readdir(dirPath, { withFileTypes: true });
              for (const entry of entries) {
                if (EXCLUDED_FILES.has(entry.name)) continue;
                const entryPath = join(dirPath, entry.name);
                try {
                  const entryStat = await stat(entryPath);
                  resources.push({
                    name: entry.name,
                    type,
                    path: entryPath,
                    updatedAt: entryStat.mtime.toISOString(),
                    source,
                    level: 'system',
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

        // Project-level scanning (skills only)
        if (type === 'skills') {
          // System-level dirs to skip (avoid double-counting)
          const systemDirSet = new Set(mapping.paths.map((p) => resolve(p)));

          // Auto-discover project cwds from ~/.claude/projects/ + ~/.codex/sessions/ + explicit
          const discoveredCwds = await discoverProjectCwds();
          const allProjectPaths = [...new Set([...discoveredCwds, ...projectPaths])];
          for (const projectPath of allProjectPaths) {
            const projectSkillDirs = [
              { dir: join(projectPath, '.claude', 'skills'), source: 'claude' },
              { dir: join(projectPath, '.codex', 'skills'), source: 'codex' },
              { dir: join(projectPath, '.gemini', 'skills'), source: 'gemini' },
              { dir: join(projectPath, 'skills'), source: 'shared' },
            ];
            for (const { dir: dirPath, source } of projectSkillDirs) {
              // Skip if overlaps with system-level path
              if (systemDirSet.has(resolve(dirPath))) continue;
              try {
                const entries = await readdir(dirPath, { withFileTypes: true });
                for (const entry of entries) {
                  if (EXCLUDED_FILES.has(entry.name)) continue;
                  // Skills: directories (containing SKILL.md) or standalone .md files
                  if (!entry.isDirectory() && !entry.name.endsWith('.md')) continue;
                  const entryPath = join(dirPath, entry.name);
                  try {
                    const entryStat = await stat(entryPath);
                    resources.push({
                      name: entry.name,
                      type,
                      path: entryPath,
                      updatedAt: entryStat.mtime.toISOString(),
                      source,
                      level: 'project',
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
        }
      }

      return { resources };
    },

    /**
     * P0: Read file content, path must be under ~/.claude/
     */
    async getResourceContent(params: { path: string }): Promise<{ content: string; format: string }> {
      const resolvedPath = resolve(params.path);

      // Security: ensure path is within allowed config directories or project-level skill dirs
      const inAllowedDir = ALLOWED_CONFIG_DIRS.some(dir => resolvedPath.startsWith(dir));
      const inProjectSkillDir = /\/\.(claude|codex|gemini)\/skills\//.test(resolvedPath) || /\/skills\/[^/]+\/SKILL\.md$/.test(resolvedPath);
      if (!inAllowedDir && !inProjectSkillDir) {
        throw new Error(`Access denied: path must be within allowed directories`);
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
     * P0: Read global or project CLAUDE.md / GEMINI.md
     * tool defaults to 'claude' (reads CLAUDE.md); 'gemini' reads GEMINI.md
     */
    async getClaudeMd(params: { scope: ClaudeMdScope; projectPath?: string; tool?: ContextMdTool }): Promise<{ content: string }> {
      const tool = params.tool || 'claude';
      const fileName = tool === 'gemini' ? 'GEMINI.md' : 'CLAUDE.md';
      const baseDir = tool === 'gemini' ? GEMINI_DIR : CLAUDE_DIR;

      let filePath: string;
      if (params.scope === 'global') {
        filePath = join(baseDir, fileName);
      } else {
        if (!params.projectPath) {
          throw new Error('projectPath is required for project scope');
        }
        filePath = join(params.projectPath, fileName);
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
     * P1: Atomic write to CLAUDE.md / GEMINI.md (global or project)
     */
    async saveClaudeMd(params: { scope: ClaudeMdScope; projectPath?: string; content: string; tool?: ContextMdTool }): Promise<{ success: boolean }> {
      const tool = params.tool || 'claude';
      const fileName = tool === 'gemini' ? 'GEMINI.md' : 'CLAUDE.md';
      const baseDir = tool === 'gemini' ? GEMINI_DIR : CLAUDE_DIR;

      let filePath: string;
      if (params.scope === 'global') {
        filePath = join(baseDir, fileName);
      } else {
        if (!params.projectPath) {
          throw new Error('projectPath is required for project scope');
        }
        filePath = join(params.projectPath, fileName);
      }

      const tmpPath = filePath + '.tmp';

      // Ensure parent directory exists
      const parentDir = filePath.substring(0, filePath.lastIndexOf('/'));
      await mkdir(parentDir, { recursive: true });

      await writeFile(tmpPath, params.content, 'utf-8');
      await rename(tmpPath, filePath);

      return { success: true };
    },

    /**
     * P2: Read project MEMORY.md
     */
    async getMemory(params: { projectHash: string }): Promise<{ content: string }> {
      const memoryPath = join(CLAUDE_DIR, 'projects', params.projectHash, 'memory', 'MEMORY.md');
      try {
        const content = await readFile(memoryPath, 'utf-8');
        return { content };
      } catch {
        return { content: '' };
      }
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

  ipcMain.handle(IPC_CHANNELS.CONFIG.GET_RESOURCES, async (_event, params?: { types?: ResourceType[]; projectPaths?: string[] }) => {
    return handlers.getResources(params);
  });

  ipcMain.handle(IPC_CHANNELS.CONFIG.GET_RESOURCE_CONTENT, async (_event, params: { path: string }) => {
    return handlers.getResourceContent(params);
  });

  ipcMain.handle(IPC_CHANNELS.CONFIG.GET_SETTINGS, async () => {
    return handlers.getSettings();
  });

  ipcMain.handle(IPC_CHANNELS.CONFIG.GET_CLAUDE_MD, async (_event, params: { scope: ClaudeMdScope; projectPath?: string; tool?: ContextMdTool }) => {
    return handlers.getClaudeMd(params);
  });

  ipcMain.handle(IPC_CHANNELS.CONFIG.SAVE_SETTINGS, async (_event, params: { settings: Record<string, unknown> }) => {
    return handlers.saveSettings(params);
  });

  ipcMain.handle(IPC_CHANNELS.CONFIG.SAVE_CLAUDE_MD, async (_event, params: { scope: ClaudeMdScope; projectPath?: string; content: string; tool?: ContextMdTool }) => {
    return handlers.saveClaudeMd(params);
  });

  ipcMain.handle(IPC_CHANNELS.CONFIG.GET_MEMORY, async (_event, params: { projectHash: string }) => {
    return handlers.getMemory(params);
  });
}
