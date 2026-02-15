export async function getPerformanceMetrics() {
  const memUsage = process.memoryUsage();
  return {
    memoryUsageMB: Math.round(memUsage.heapUsed / (1024 * 1024)),
    terminalCount: 0,
    bufferLines: {
      focused: 0,
      background: [] as number[],
    },
  };
}
