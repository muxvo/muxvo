/**
 * Chat Archive Manager
 *
 * Archives Claude Code chat sessions from ~/.claude/projects/ to ~/.muxvo/chat-archive/.
 * - Full scan on startup: compares mtime, copies new/updated JSONL files
 * - Incremental archive: copies individual files on session-update events
 */

import { readdir, stat, copyFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { homedir } from 'os';

const CC_PROJECTS_DIR = join(homedir(), '.claude', 'projects');
const ARCHIVE_DIR = join(homedir(), '.muxvo', 'chat-archive');

export function createChatArchiveManager() {
  let running = false;

  /**
   * Full scan: walk CC projects directory, compare mtime, copy changed JSONL files.
   */
  async function fullScan(): Promise<{ synced: number; skipped: number }> {
    let synced = 0;
    let skipped = 0;

    async function scanDir(ccDir: string, archiveDir: string): Promise<void> {
      try {
        const entries = await readdir(ccDir, { withFileTypes: true });

        for (const entry of entries) {
          const ccPath = join(ccDir, entry.name);
          const archivePath = join(archiveDir, entry.name);

          if (entry.isDirectory()) {
            await scanDir(ccPath, archivePath);
          } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
            try {
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
                synced++;
              } else {
                skipped++;
              }
            } catch {
              // Skip files that fail to stat or copy
            }
          }
        }
      } catch {
        // Skip directories that fail to read
      }
    }

    await scanDir(CC_PROJECTS_DIR, ARCHIVE_DIR);
    return { synced, skipped };
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
    async start(): Promise<void> {
      if (running) return;
      running = true;
      await fullScan();
    },

    stop(): void {
      running = false;
    },

    /**
     * Called when chat watcher detects a session update.
     */
    onSessionUpdate(projectHash: string, sessionId: string): void {
      if (!running) return;
      archiveSession(projectHash, sessionId);
    },
  };
}
