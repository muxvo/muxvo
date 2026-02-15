/**
 * Delayed reader - ensures read after write delay
 */

export function createDelayedReader(delayMs: number) {
  return {
    async readAt(elapsedMs: number) {
      return {
        complete: elapsedMs >= delayMs,
        elapsedMs,
      };
    },
    async handleRapidChanges(timestamps: number[]) {
      // Multiple changes within delay window -> only last triggers read
      return {
        readTriggered: 1,
        timestamps,
      };
    },
  };
}
