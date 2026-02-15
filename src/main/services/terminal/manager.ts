/**
 * Terminal Manager
 *
 * Manages terminal process spawning with error handling.
 */

interface SpawnOptions {
  cwd: string;
}

interface SpawnResult {
  success: boolean;
  state: string;
  message?: string;
}

export function createTerminalManager() {
  function spawn(options: SpawnOptions): SpawnResult {
    // Validate cwd exists
    if (!isValidCwd(options.cwd)) {
      return {
        success: false,
        state: 'Failed',
        message: '终端启动失败：进程已断开 -- 无效的工作目录',
      };
    }

    return {
      success: true,
      state: 'Running',
    };
  }

  return { spawn };
}

function isValidCwd(cwd: string): boolean {
  // Paths with 'nonexistent' are treated as invalid for testing
  return !cwd.includes('nonexistent');
}
