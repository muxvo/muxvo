/**
 * Conflict Detector
 *
 * Detects local modifications to installed packages by comparing hashes.
 */

interface HashComparison {
  installedHash: string;
  currentHash: string;
}

interface ConflictResult {
  conflict: boolean;
  message: string;
}

export function detectLocalModification(params: HashComparison): ConflictResult {
  const conflict = params.installedHash !== params.currentHash;
  return {
    conflict,
    message: conflict
      ? '本地已修改，更新将覆盖您的更改'
      : '无冲突',
  };
}
