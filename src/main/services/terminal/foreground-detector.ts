/**
 * Foreground process detector for terminal sessions.
 * Uses system commands to detect what process is running in a terminal.
 */
import { execFileSync } from 'child_process';

export function getForegroundProcessName(pid: number): string | null {
  try {
    const name = execFileSync('ps', ['-p', String(pid), '-o', 'comm='], {
      encoding: 'utf-8',
      timeout: 2000,
    }).trim();
    return name || null;
  } catch {
    return null;
  }
}

/**
 * Get the PID of the foreground child process of a shell.
 * Returns the last (most recently forked) child PID, which is typically the foreground process.
 * Returns null if no children exist (shell is idle at prompt).
 */
export function getForegroundChildPid(shellPid: number): number | null {
  try {
    const output = execFileSync('pgrep', ['-P', String(shellPid)], {
      encoding: 'utf-8',
      timeout: 2000,
    }).trim();
    if (!output) return null;
    const pids = output.split('\n').map(Number).filter(Boolean);
    return pids.length > 0 ? pids[pids.length - 1] : null;
  } catch {
    return null;
  }
}

/**
 * Get the current working directory of a process via lsof.
 * Works on both macOS and Linux.
 */
export function getProcessCwd(pid: number): string | null {
  try {
    const output = execFileSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], {
      encoding: 'utf-8',
      timeout: 2000,
    });
    const match = output.match(/^n(.+)$/m);
    return match ? match[1] : null;
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
