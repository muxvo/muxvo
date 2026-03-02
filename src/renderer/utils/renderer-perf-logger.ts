/**
 * Renderer Performance Logger
 *
 * Tracks renderer-side metrics and sends periodic reports to main process
 * for writing to ~/.muxvo/logs/perf.log.
 *
 * Metrics tracked:
 * - FPS (requestAnimationFrame count per second)
 * - Event counters: resizeObserver, fitCalls, ipcOutput, termWrite
 * - Reports every 10 seconds (always, not just anomalies, for diagnostics)
 */

const REPORT_INTERVAL_MS = 10_000;

const counters: Record<string, number> = {};
let frameCount = 0;
let lastFrameTime = 0;
let fps = 0;
let rafId = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let started = false;

function measureFps(now: number): void {
  frameCount++;
  if (now - lastFrameTime >= 1000) {
    fps = frameCount;
    frameCount = 0;
    lastFrameTime = now;
  }
  rafId = requestAnimationFrame(measureFps);
}

function sendReport(): void {
  const entries = Object.entries(counters)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');

  const message = `fps=${fps} ${entries}`.trim();

  // Send to main process for file logging
  try {
    (window as any).api?.perf?.log?.(message);
  } catch {
    // preload not available (e.g. tests)
  }

  // Also console.log for DevTools visibility
  console.log(`[MUXVO:renderer-perf] ${message}`);

  // Reset counters
  for (const key of Object.keys(counters)) {
    counters[key] = 0;
  }
}

/** Increment a named counter. Call from hot paths. */
export function trackRenderer(event: string): void {
  counters[event] = (counters[event] || 0) + 1;
}

/** Start the renderer perf logger. Call once at app startup. */
export function startRendererPerfLogger(): void {
  if (started) return;
  started = true;

  // Initialize counters
  counters['resizeObs'] = 0;
  counters['fitCall'] = 0;
  counters['ipcOutput'] = 0;
  counters['termWrite'] = 0;
  counters['reactRender'] = 0;

  // Start FPS measurement
  lastFrameTime = performance.now();
  rafId = requestAnimationFrame(measureFps);

  // Periodic report
  timer = setInterval(sendReport, REPORT_INTERVAL_MS);
}

/** Stop the renderer perf logger. */
export function stopRendererPerfLogger(): void {
  if (!started) return;
  started = false;
  cancelAnimationFrame(rafId);
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
