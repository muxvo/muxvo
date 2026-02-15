/**
 * Temp file manager - manages temporary image files with 24h auto-cleanup
 */

const CLEANUP_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

interface FileEntry {
  terminalId: string;
  filePath: string;
  createdAt: number;
}

interface CleanupTerminalResult {
  deletedCount: number;
  deletedPaths: string[];
  skippedReason?: string;
}

interface CleanupExpiredResult {
  deletedCount: number;
  deletedPaths: string[];
  keptCount: number;
}

export function createTempFileManager() {
  const files: FileEntry[] = [];
  const activeTerminals = new Set<string>();

  return {
    registerFile(
      terminalId: string,
      filePath: string,
      opts?: { createdAt: number },
    ): void {
      files.push({
        terminalId,
        filePath,
        createdAt: opts?.createdAt ?? Date.now(),
      });
    },

    getFilesForTerminal(terminalId: string): FileEntry[] {
      return files.filter((f) => f.terminalId === terminalId);
    },

    markTerminalActive(terminalId: string): void {
      activeTerminals.add(terminalId);
    },

    async cleanupTerminal(terminalId: string): Promise<CleanupTerminalResult> {
      // Protect active terminals
      if (activeTerminals.has(terminalId)) {
        return {
          deletedCount: 0,
          deletedPaths: [],
          skippedReason: 'terminal_active',
        };
      }

      const toDelete = files.filter((f) => f.terminalId === terminalId);
      const deletedPaths = toDelete.map((f) => f.filePath);

      // Remove from files array
      for (let i = files.length - 1; i >= 0; i--) {
        if (files[i].terminalId === terminalId) {
          files.splice(i, 1);
        }
      }

      return {
        deletedCount: deletedPaths.length,
        deletedPaths,
      };
    },

    async cleanupExpired(now: number): Promise<CleanupExpiredResult> {
      const threshold = now - CLEANUP_THRESHOLD_MS;
      const deletedPaths: string[] = [];
      let keptCount = 0;

      for (let i = files.length - 1; i >= 0; i--) {
        if (files[i].createdAt < threshold) {
          deletedPaths.push(files[i].filePath);
          files.splice(i, 1);
        } else {
          keptCount++;
        }
      }

      return {
        deletedCount: deletedPaths.length,
        deletedPaths,
        keptCount,
      };
    },
  };
}
