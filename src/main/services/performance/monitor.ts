/**
 * Performance Monitor
 *
 * Memory warning threshold check.
 */

const MEMORY_WARNING_THRESHOLD = 2 * 1024 * 1024 * 1024; // 2GB

export function shouldShowMemoryWarning(currentMemoryBytes: number): boolean {
  return currentMemoryBytes > MEMORY_WARNING_THRESHOLD;
}
