/**
 * Update Scheduler
 *
 * Configures the 6-hour polling interval for marketplace update checks.
 */

type CheckCallback = (timestamp: number) => void;

export interface UpdateScheduler {
  intervalMs: number;
  checkOnStartup: boolean;
  onCheck(callback: CheckCallback): void;
  start(startTime: number): void;
  tick(elapsed: number): void;
  reset(): void;
}

export function createUpdateScheduler(): UpdateScheduler {
  const INTERVAL = 6 * 60 * 60 * 1000; // 6 hours
  let callback: CheckCallback | null = null;
  let startTime = 0;
  let lastCheckAt = 0;
  let started = false;

  return {
    intervalMs: INTERVAL,
    checkOnStartup: true,

    onCheck(cb: CheckCallback) {
      callback = cb;
    },

    start(time: number) {
      startTime = time;
      lastCheckAt = time;
      started = true;
      if (callback) {
        callback(time);
      }
    },

    tick(elapsed: number) {
      if (!started) return;
      const currentTime = startTime + elapsed;
      while (currentTime - lastCheckAt >= INTERVAL) {
        lastCheckAt += INTERVAL;
        if (callback) {
          callback(lastCheckAt);
        }
      }
    },

    reset() {
      started = false;
      lastCheckAt = 0;
      startTime = 0;
    },
  };
}
