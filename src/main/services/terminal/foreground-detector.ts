/**
 * Foreground process detector for terminal sessions.
 * Uses system commands to detect what process is running in a terminal.
 */
import { execSync } from 'child_process';

export function getForegroundProcessName(pid: number): string | null {
  try {
    const name = execSync(`ps -p ${pid} -o comm=`, { encoding: 'utf-8' }).trim();
    return name || null;
  } catch {
    return null;
  }
}

export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
