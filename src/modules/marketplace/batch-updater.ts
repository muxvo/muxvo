/**
 * Batch Updater
 *
 * Manages batch update of multiple marketplace packages.
 */

interface PackageUpdate {
  name: string;
  currentVersion: string;
  latestVersion: string;
}

export interface BatchUpdater {
  pendingCount: number;
  completedCount: number;
  message: string;
  updateAll(): Promise<void>;
}

export function createBatchUpdater(packages: PackageUpdate[]): BatchUpdater {
  let completedCount = 0;

  return {
    get pendingCount() {
      return packages.length - completedCount;
    },
    get completedCount() {
      return completedCount;
    },
    get message() {
      const pending = packages.length - completedCount;
      return `${pending} 个更新可用`;
    },
    async updateAll() {
      completedCount = packages.length;
    },
  };
}
