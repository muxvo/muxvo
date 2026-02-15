/**
 * Memory monitor module
 */

const MEMORY_WARNING_THRESHOLD = 2 * 1024 * 1024 * 1024; // 2GB

export function createMemoryMonitor() {
  let _checkCount = 0;
  let _currentMemory = 0;
  let _warning = false;

  return {
    get checkCount() {
      return _checkCount;
    },
    get warning() {
      return _warning;
    },
    tick(elapsedMs: number) {
      // Each 60s tick triggers a check
      _checkCount = Math.floor(elapsedMs / 60000);
      _warning = _currentMemory >= MEMORY_WARNING_THRESHOLD;
    },
    setMemory(bytes: number) {
      _currentMemory = bytes;
      _warning = _currentMemory >= MEMORY_WARNING_THRESHOLD;
    },
  };
}
