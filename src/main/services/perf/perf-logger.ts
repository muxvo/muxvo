/**
 * Performance Logger — lightweight event frequency monitor.
 *
 * Tracks event counts per sliding window. When any metric exceeds its threshold,
 * writes a warning line to ~/.muxvo/logs/perf.log (and console.warn).
 *
 * Normal operation: near-zero overhead (counter increments + periodic check).
 * Log file is only written to when anomalies are detected.
 * Auto-rotates at 500KB (truncates to last 200KB).
 */

import { appendFile, stat, readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

const LOG_DIR = join(homedir(), '.muxvo', 'logs');
const LOG_PATH = join(LOG_DIR, 'perf.log');
const MAX_LOG_BYTES = 500 * 1024;
const KEEP_LOG_BYTES = 200 * 1024;
const CHECK_INTERVAL_MS = 10_000; // Check every 10 seconds
const WINDOW_MS = 10_000; // 10-second sliding window

interface ThresholdConfig {
  /** Terminal output events per second */
  termOutput: number;
  /** IPC push events per second */
  ipcPush: number;
  /** Filesystem watcher events per second */
  fsWatch: number;
  /** RSS memory in MB */
  memoryMB: number;
}

const DEFAULT_THRESHOLDS: ThresholdConfig = {
  termOutput: 100,
  ipcPush: 30,
  fsWatch: 50,
  memoryMB: 500,
};

type EventType = 'termOutput' | 'ipcPush' | 'fsWatch';

interface EventEntry {
  ts: number;
  terminalId?: string;
}

export interface PerfLogger {
  /** Record an event occurrence. Call from hot paths — O(1) amortized. */
  track(event: EventType, terminalId?: string): void;
  /** Stop the periodic check timer. */
  dispose(): void;
}

export function createPerfLogger(thresholds?: Partial<ThresholdConfig>): PerfLogger {
  const config: ThresholdConfig = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const startTime = Date.now();

  // Per-event-type ring buffers (timestamps only, cheap to maintain)
  const buffers: Record<EventType, EventEntry[]> = {
    termOutput: [],
    ipcPush: [],
    fsWatch: [],
  };

  let logDirEnsured = false;

  async function ensureLogDir(): Promise<void> {
    if (logDirEnsured) return;
    try {
      await mkdir(LOG_DIR, { recursive: true });
      logDirEnsured = true;
    } catch { /* ignore */ }
  }

  async function rotateIfNeeded(): Promise<void> {
    try {
      const s = await stat(LOG_PATH);
      if (s.size > MAX_LOG_BYTES) {
        const content = await readFile(LOG_PATH, 'utf-8');
        const trimmed = content.slice(content.length - KEEP_LOG_BYTES);
        // Cut at first newline to avoid partial lines
        const firstNewline = trimmed.indexOf('\n');
        await writeFile(LOG_PATH, firstNewline >= 0 ? trimmed.slice(firstNewline + 1) : trimmed);
      }
    } catch { /* file may not exist yet */ }
  }

  async function writeLine(line: string): Promise<void> {
    await ensureLogDir();
    const timestamp = new Date().toISOString();
    const fullLine = `[${timestamp}] ${line}\n`;
    try {
      await appendFile(LOG_PATH, fullLine);
      console.warn('[MUXVO:perf]', line);
    } catch { /* ignore write errors */ }
  }

  function pruneOldEntries(entries: EventEntry[], now: number): void {
    const cutoff = now - WINDOW_MS;
    // Remove entries older than window (entries are in chronological order)
    while (entries.length > 0 && entries[0].ts < cutoff) {
      entries.shift();
    }
  }

  function getRate(entries: EventEntry[]): number {
    return entries.length / (WINDOW_MS / 1000);
  }

  // Find the terminal with most events in the window
  function getTopTerminal(entries: EventEntry[]): string | undefined {
    const counts = new Map<string, number>();
    for (const e of entries) {
      if (e.terminalId) {
        counts.set(e.terminalId, (counts.get(e.terminalId) || 0) + 1);
      }
    }
    let topId: string | undefined;
    let topCount = 0;
    for (const [id, count] of counts) {
      if (count > topCount) {
        topId = id;
        topCount = count;
      }
    }
    return topId;
  }

  async function periodicCheck(): Promise<void> {
    const now = Date.now();
    const warnings: string[] = [];

    for (const eventType of ['termOutput', 'ipcPush', 'fsWatch'] as EventType[]) {
      pruneOldEntries(buffers[eventType], now);
      const rate = getRate(buffers[eventType]);
      const threshold = config[eventType];
      if (rate > threshold) {
        const topTerminal = getTopTerminal(buffers[eventType]);
        const suffix = topTerminal ? ` | terminal=${topTerminal}` : '';
        warnings.push(`PERF_WARN ${eventType}/s=${Math.round(rate)} (threshold:${threshold})${suffix}`);
      }
    }

    // Memory check
    const memMB = Math.round(process.memoryUsage().rss / (1024 * 1024));
    if (memMB > config.memoryMB) {
      warnings.push(`PERF_WARN memoryMB=${memMB} (threshold:${config.memoryMB})`);
    }

    if (warnings.length > 0) {
      await rotateIfNeeded();
      // Add a snapshot line with context
      const uptimeS = Math.round((now - startTime) / 1000);
      warnings.push(`PERF_SNAP memoryMB=${memMB} uptime=${uptimeS}s`);
      for (const w of warnings) {
        await writeLine(w);
      }
    }
  }

  const timer = setInterval(() => {
    periodicCheck().catch(() => {});
  }, CHECK_INTERVAL_MS);

  return {
    track(event: EventType, terminalId?: string): void {
      buffers[event].push({ ts: Date.now(), terminalId });
    },
    dispose(): void {
      clearInterval(timer);
    },
  };
}
