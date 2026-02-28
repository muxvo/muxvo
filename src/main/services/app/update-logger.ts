/**
 * File-based logger for electron-updater.
 * Writes to {userData}/update.log with timestamps.
 * Rotates (truncates) on startup if > 1MB.
 */

import { appendFileSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { app } from 'electron';

const MAX_LOG_SIZE = 1024 * 1024; // 1MB

export function createUpdateLogger(): {
  error(message: any): void;
  warn(message: any): void;
  info(message: any): void;
  debug(message: any): void;
} {
  const logPath = join(app.getPath('userData'), 'update.log');

  // Rotate on startup: truncate if > 1MB
  try {
    if (statSync(logPath).size > MAX_LOG_SIZE) {
      writeFileSync(logPath, '', 'utf-8');
    }
  } catch {
    /* file doesn't exist yet */
  }

  function write(level: string, message: any): void {
    const ts = new Date().toISOString();
    const line = `[${ts}] [${level}] ${String(message)}\n`;
    try {
      appendFileSync(logPath, line, 'utf-8');
    } catch {
      /* ignore write failures */
    }
  }

  return {
    error: (msg: any) => write('ERROR', msg),
    warn: (msg: any) => write('WARN', msg),
    info: (msg: any) => write('INFO', msg),
    debug: (msg: any) => write('DEBUG', msg),
  };
}
