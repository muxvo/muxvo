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
      const proc = pty.spawn(shell, [], {
        cwd,
        cols,
        rows,
        name: 'xterm-256color',
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
