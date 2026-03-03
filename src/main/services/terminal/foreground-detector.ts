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
    return match ? decodeVisEncoding(match[1]) : null;
  } catch {
    return null;
  }
}

/**
 * Decode vis(3) \xNN escape sequences back to UTF-8 string.
 * macOS lsof encodes non-ASCII bytes (e.g. CJK characters) as \xNN sequences.
 * e.g. "019_\xe5\xa9\x9a\xe7\xa4\xbc" → "019_婚礼"
 */
export function decodeVisEncoding(str: string): string {
  if (!str.includes('\\x')) return str;

  const parts: Buffer[] = [];
  let i = 0;
  while (i < str.length) {
    if (str[i] === '\\' && str[i + 1] === 'x' && i + 3 < str.length) {
      const hex = str.substring(i + 2, i + 4);
      if (/^[0-9a-fA-F]{2}$/.test(hex)) {
        parts.push(Buffer.from([parseInt(hex, 16)]));
        i += 4;
        continue;
      }
    }
    parts.push(Buffer.from(str[i], 'utf-8'));
    i++;
  }
  return Buffer.concat(parts).toString('utf-8');
}

export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
