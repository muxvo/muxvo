/**
 * Disk Space Checker
 *
 * Validates available disk space against requirements.
 */

interface DiskSpaceOptions {
  requiredMB: number;
  availableMB: number;
}

interface DiskSpaceResult {
  sufficient: boolean;
  message: string;
}

export function checkDiskSpace(options: DiskSpaceOptions): DiskSpaceResult {
  const sufficient = options.availableMB >= options.requiredMB;

  return {
    sufficient,
    message: sufficient
      ? '磁盘空间充足'
      : `磁盘空间不足：需要 ${options.requiredMB}MB，仅剩 ${options.availableMB}MB`,
  };
}
