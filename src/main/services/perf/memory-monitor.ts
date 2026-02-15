/**
 * Memory monitor - monitors memory usage and warns at threshold
 *
 * Note: Uses module.exports for CJS require() compatibility in tests.
 * Vite's ESM interop handles this transparently for import() calls.
 */

function createMemoryMonitor(opts: { thresholdMB: number }) {
  const threshold = opts.thresholdMB;

  return {
    getThreshold(): number {
      return threshold;
    },

    checkMemory(): { exceeded: boolean; currentMB: number } {
      const memUsage = process.memoryUsage();
      const currentMB = Math.round(memUsage.heapUsed / (1024 * 1024));
      return {
        exceeded: currentMB > threshold,
        currentMB,
      };
    },
  };
}

module.exports = { createMemoryMonitor };
