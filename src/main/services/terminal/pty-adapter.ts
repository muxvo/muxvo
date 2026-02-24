/**
 * PTY Adapter — 封装 node-pty，提供依赖注入接口
 * 测试时可替换为 mock，生产时使用真实 node-pty
 */
import * as pty from 'node-pty';

export interface PtyProcess {
  pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(callback: (data: string) => void): void;
  onExit(callback: (exitCode: number) => void): void;
}

export interface PtyAdapter {
  spawn(shell: string, cwd: string, cols: number, rows: number): PtyProcess;
  getDefaultShell(): string;
}

export function createRealPtyAdapter(): PtyAdapter {
  return {
    spawn(shell, cwd, cols, rows) {
      // Clean env: remove CLAUDECODE to allow running Claude Code in spawned terminals
      const env = { ...process.env };
      delete env.CLAUDECODE;

      // macOS: ensure TERM_PROGRAM is set so zsh emits OSC 7 (cwd tracking)
      // In packaged mode, process.env lacks TERM_PROGRAM since app launches from Finder/Dock.
      // macOS's /etc/zshrc only sources /etc/zshrc_Apple_Terminal (which emits OSC 7)
      // when TERM_PROGRAM == 'Apple_Terminal'.
      if (process.platform === 'darwin' && !env.TERM_PROGRAM) {
        env.TERM_PROGRAM = 'Apple_Terminal';
      }

      // macOS: ensure LANG is UTF-8 for proper CJK character display in terminal.
      // Packaged apps launched from Finder/Dock may have LANG unset or 'C',
      // causing Chinese/Japanese/Korean characters in paths to display as \M-^Q0 etc.
      if (process.platform === 'darwin' && (!env.LANG || env.LANG === 'C' || env.LANG === 'POSIX')) {
        env.LANG = 'en_US.UTF-8';
      }

      // Use --login so shell loads /etc/zprofile (path_helper) and ~/.zprofile (nvm/fnm/volta/homebrew).
      // Without this, packaged apps launched from Finder have minimal PATH and can't find node.
      const proc = pty.spawn(shell, ['--login'], {
        cwd,
        cols,
        rows,
        name: 'xterm-256color',
        env,
      });
      return {
        pid: proc.pid,
        write: (data) => proc.write(data),
        resize: (c, r) => proc.resize(c, r),
        kill: () => proc.kill(),
        onData: (cb) => {
          proc.onData(cb);
        },
        onExit: (cb) => {
          proc.onExit(({ exitCode }) => cb(exitCode));
        },
      };
    },
    getDefaultShell() {
      return process.env.SHELL || '/bin/zsh';
    },
  };
}
