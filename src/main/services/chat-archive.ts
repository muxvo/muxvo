/**
 * Chat Archive Manager
 *
 * Archives Claude Code chat sessions from ~/.claude/projects/ to ~/.muxvo/chat-archive/.
 * - Full scan on startup: compares mtime, copies new/updated JSONL files
 * - Incremental archive: copies individual files on session-update events
 */

import { readdir, stat, copyFile, mkdir, readFile, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { homedir } from 'os';

const CC_PROJECTS_DIR = join(homedir(), '.claude', 'projects');
const ARCHIVE_DIR = join(homedir(), '.muxvo', 'chat-archive');
const CONFIG_PATH = join(homedir(), '.muxvo', 'chat-archive-config.json');

export function createChatArchiveManager() {
  let running = false;
  let enabled = true;

  async function readEnabled(): Promise<boolean> {
    try {
      const raw = await readFile(CONFIG_PATH, 'utf-8');
      const config = JSON.parse(raw);
      return config.enabled !== false;
    } catch {
      return true; // default enabled
    }
  }

  async function writeEnabled(value: boolean): Promise<void> {
    await mkdir(dirname(CONFIG_PATH), { recursive: true });
    await writeFile(CONFIG_PATH, JSON.stringify({ enabled: value }), 'utf-8');
  }

  /**
   * Collect all JSONL files that need syncing (mtime differs or missing in archive).
   */
  async function collectSyncTargets(): Promise<{ ccPath: string; archivePath: string }[]> {
    const targets: { ccPath: string; archivePath: string }[] = [];

    async function walk(ccDir: string, archiveDir: string): Promise<void> {
      try {
        const entries = await readdir(ccDir, { withFileTypes: true });
        for (const entry of entries) {
          const ccPath = join(ccDir, entry.name);
          const archPath = join(archiveDir, entry.name);
          if (entry.isDirectory()) {
            await walk(ccPath, archPath);
          } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
            try {
              const ccStats = await stat(ccPath);
              let archiveStats;
              try { archiveStats = await stat(archPath); } catch { archiveStats = null; }
              const ccMtime = Math.floor(ccStats.mtimeMs / 1000);
              const archMtime = archiveStats ? Math.floor(archiveStats.mtimeMs / 1000) : 0;
              if (ccMtime !== archMtime) {
                targets.push({ ccPath, archivePath: archPath });
              }
            } catch { /* skip */ }
          }
        }
      } catch { /* skip */ }
    }

    await walk(CC_PROJECTS_DIR, ARCHIVE_DIR);
    return targets;
  }

  /**
   * Full scan: compare mtime, copy changed JSONL files with progress callback.
   */
  async function fullScan(onProgress?: (synced: number, total: number) => void): Promise<{ synced: number; total: number }> {
    const targets = await collectSyncTargets();
    const total = targets.length;
    let synced = 0;

    if (total === 0) return { synced: 0, total: 0 };

    onProgress?.(0, total);

    for (const target of targets) {
      try {
        await mkdir(dirname(target.archivePath), { recursive: true });
        await copyFile(target.ccPath, target.archivePath);
        synced++;
        // Throttle progress: report every 50 files to avoid flooding
        if (synced % 50 === 0 || synced === total) {
          onProgress?.(synced, total);
        }
      } catch { /* skip */ }
    }

    // Final progress report
    onProgress?.(synced, total);
    return { synced, total };
  }

  /**
   * Incremental archive: copy a single session file triggered by chat watcher event.
   */
  async function archiveSession(projectHash: string, sessionId: string): Promise<boolean> {
    try {
      const ccPath = join(CC_PROJECTS_DIR, projectHash, `${sessionId}.jsonl`);
      const archivePath = join(ARCHIVE_DIR, projectHash, `${sessionId}.jsonl`);

      const ccStats = await stat(ccPath);
      let archiveStats;
      try {
        archiveStats = await stat(archivePath);
      } catch {
        archiveStats = null;
      }

      const ccMtimeSeconds = Math.floor(ccStats.mtimeMs / 1000);
      const archiveMtimeSeconds = archiveStats ? Math.floor(archiveStats.mtimeMs / 1000) : 0;

      if (ccMtimeSeconds !== archiveMtimeSeconds) {
        await mkdir(dirname(archivePath), { recursive: true });
        await copyFile(ccPath, archivePath);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  return {
    async start(onProgress?: (synced: number, total: number) => void): Promise<void> {
      if (running) return;
      running = true;
      enabled = await readEnabled();
      if (enabled) {
        await fullScan(onProgress);
      }
    },

    stop(): void {
      running = false;
    },

    /**
     * Called when chat watcher detects a session update.
     */
    onSessionUpdate(projectHash: string, sessionId: string): void {
      if (!running || !enabled) return;
      archiveSession(projectHash, sessionId);
    },

    async getEnabled(): Promise<boolean> {
      return readEnabled();
    },

    async setEnabled(value: boolean): Promise<void> {
      await writeEnabled(value);
      enabled = value;
      if (value && running) {
        await fullScan();
      }
    },
  };
}
