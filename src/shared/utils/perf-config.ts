/**
 * Performance Configuration
 *
 * Central performance config with all thresholds and limits
 * referenced by perf-thresholds.spec.json and boundaries.spec.json.
 */

export interface PerformanceConfig {
  // Memory monitoring
  memoryCheckInterval: number;
  memoryWarningThreshold: number;

  // Terminal buffer limits
  focusedTerminalBufferLines: number;
  hiddenTerminalBufferLines: number;
  bufferDiscardReversible: boolean;

  // Search debounce
  searchDebounceTime: number;

  // Marketplace pagination
  discoveryPageSize: number;

  // Terminal limits
  maxTerminalCount: number;

  // Cache expiry
  hotListCacheExpiry: number;

  // Update check interval
  updateCheckInterval: number;

  // Threshold parameters from boundaries.spec.json
  processStopTimeout: number;
  stoppingDisconnectTimeout: number;
  downloadAutoRetryCount: number;
  publishTimeout: number;

  // Dynamic key access
  [key: string]: unknown;
}

export function getPerformanceConfig(): PerformanceConfig {
  return {
    // Memory monitoring (PRD 11.2)
    memoryCheckInterval: 60000,
    memoryWarningThreshold: 2 * 1024 * 1024 * 1024, // 2GB

    // Terminal buffer limits (PRD 11.2)
    focusedTerminalBufferLines: 10000,
    hiddenTerminalBufferLines: 1000,
    bufferDiscardReversible: false,

    // Search debounce (PRD 11.2)
    searchDebounceTime: 300,

    // Marketplace pagination
    discoveryPageSize: 20,

    // Terminal limits
    maxTerminalCount: 20,

    // Cache expiry (1 hour)
    hotListCacheExpiry: 3600000,

    // Update check interval (6 hours)
    updateCheckInterval: 6 * 3600 * 1000,

    // Threshold parameters from boundaries.spec.json
    processStopTimeout: 5000,
    stoppingDisconnectTimeout: 5000,
    downloadAutoRetryCount: 1,
    publishTimeout: 30000,
  };
}
