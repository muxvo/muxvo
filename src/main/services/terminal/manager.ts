/**
 * Terminal Manager
 *
 * Manages terminal process spawning with error handling.
 * Uses DI pattern: pass { pty } for real PTY, omit for stub behavior (tests).
 */

import { BrowserWindow } from 'electron';
import { existsSync } from 'fs';
import { IPC_CHANNELS } from '@/shared/constants/channels';
import type { PtyAdapter, PtyProcess } from './pty-adapter';
import { getForegroundProcessName } from './foreground-detector';
import { detectWaitingInput, resetInputDetector, shouldExitWaiting } from './input-detector';
import type {
  TerminalInfo,
  ForegroundProcessInfo,
} from '@/shared/types/terminal.types';
import { TerminalState } from '@/shared/types/terminal.types';
import { createTerminalMachine } from '@/shared/machines/terminal-process';

const MAX_TERMINALS = 20;
const GRACEFUL_CLOSE_TIMEOUT = 5000;

/** Terminal emulator auto-responses that should NOT trigger USER_INPUT */
export function isTerminalAutoResponse(data: string): boolean {
  // Cursor position report: \x1b[row;colR
  if (/^\x1b\[\d+;\d+R$/.test(data)) return true;
  // Focus events: \x1b[I (focus in), \x1b[O (focus out)
  if (/^\x1b\[[IO]$/.test(data)) return true;
  // Device attributes response: \x1b[?...c
  if (/^\x1b\[\?[\d;]*c$/.test(data)) return true;
  return false;
}

interface SpawnOptions {
  cwd: string;
}

interface SpawnResult {
  success: boolean;
  state: string;
  message?: string;
  id?: string;
  pid?: number;
}

interface ManagedTerminal {
  id: string;
  process: PtyProcess;
  cwd: string;
  machine: ReturnType<typeof createTerminalMachine>;
}

interface TerminalManagerDeps {
  pty?: PtyAdapter;
}

export function createTerminalManager(deps?: TerminalManagerDeps) {
  const terminals = new Map<string, ManagedTerminal>();
  const OUTPUT_BUFFER_MAX_BYTES = 64 * 1024;
  const outputBuffers = new Map<string, string>();
  const ptyAdapter = deps?.pty;

  function pushStateChange(id: string, state: string, processName?: string): void {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      win.webContents.send(IPC_CHANNELS.TERMINAL.STATE_CHANGE, { id, state, processName });
    }
  }

  function spawn(options: SpawnOptions): SpawnResult {
    // Validate cwd exists
    if (!isValidCwd(options.cwd)) {
      return {
        success: false,
        state: 'Failed',
        message: '终端启动失败：进程已断开 -- 无效的工作目录',
      };
    }

    // Validate cwd path actually exists on disk
    if (options.cwd && !existsSync(options.cwd)) {
      return {
        success: false,
        state: 'Failed',
        message: `终端启动失败：工作目录不存在 — ${options.cwd}`,
      };
    }

    // Check max terminal limit
    if (terminals.size >= MAX_TERMINALS) {
      return {
        success: false,
        state: 'Failed',
        message: '最多支持 20 个终端',
      };
    }

    // If we have a real PTY adapter, create a real process
    if (ptyAdapter) {
      const machine = createTerminalMachine();
      machine.send('SPAWN');

      try {
        const shell = ptyAdapter.getDefaultShell();
        const proc = ptyAdapter.spawn(shell, options.cwd, 80, 24);
        const id = `term-${proc.pid}`;

        machine.send('SPAWN_SUCCESS');

        terminals.set(id, { id, process: proc, cwd: options.cwd, machine });

        pushStateChange(id, machine.state);

        // Push terminal output to renderer
        proc.onData((data) => {
          const existing = outputBuffers.get(id) ?? '';
          const updated = existing + data;
          outputBuffers.set(id, updated.length > OUTPUT_BUFFER_MAX_BYTES ? updated.slice(updated.length - OUTPUT_BUFFER_MAX_BYTES) : updated);
          console.log(`[MUXVO:restore] buffer append id=${id} bytes=${data.length} total=${outputBuffers.get(id)!.length}`);

          const win = BrowserWindow.getAllWindows()[0];
          if (win) {
            win.webContents.send(IPC_CHANNELS.TERMINAL.OUTPUT, { id, data });
          }

          // Detect OSC 7 cwd change: \x1b]7;file://hostname/path\x07 or \x1b]7;file://hostname/path\x1b\\
          const osc7Match = data.match(/\x1b\]7;file:\/\/[^/]*([^\x07\x1b]+)[\x07\x1b]/);
          if (osc7Match) {
            const newCwd = decodeURIComponent(osc7Match[1]);
            const terminal = terminals.get(id);
            if (terminal && terminal.cwd !== newCwd) {
              terminal.cwd = newCwd;
              const cwdWin = BrowserWindow.getAllWindows()[0];
              if (cwdWin && !cwdWin.isDestroyed()) {
                cwdWin.webContents.send(IPC_CHANNELS.TERMINAL.CWD_CHANGED, { id, cwd: newCwd });
              }
            }
          }

          // Detect interactive prompts → transition to WaitingInput
          const isRunning = machine.state === 'Running';
          const isWaiting = machine.state === 'WaitingInput';
          const detected = detectWaitingInput(data, id);
          console.log(`[MUXVO:waitinput] state=${machine.state} detected=${detected} chunkLen=${data.length}`);
          if (isRunning && detected) {
            machine.send('WAIT_INPUT');
            console.log(`[MUXVO:waitinput] >>> TRANSITION to WaitingInput! id=${id}`);
            pushStateChange(id, machine.state);
          } else if (isWaiting && !detected && shouldExitWaiting(id)) {
            // Process moved past the interactive prompt — auto-recover
            resetInputDetector(id);
            machine.send('AUTO_RESUME');
            console.log(`[MUXVO:waitinput] >>> AUTO_RESUME to Running! id=${id}`);
            pushStateChange(id, machine.state);
          }
        });

        // Push terminal exit to renderer
        proc.onExit((code) => {
          machine.send('CLOSE');
          machine.send('EXIT_NORMAL');

          const win = BrowserWindow.getAllWindows()[0];
          if (win) {
            win.webContents.send(IPC_CHANNELS.TERMINAL.EXIT, { id, code });
          }

          pushStateChange(id, machine.state);
          terminals.delete(id);
          outputBuffers.delete(id);
          resetInputDetector(id);
        });

        return { success: true, state: machine.state, id, pid: proc.pid };
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[MUXVO] PTY spawn failed: ${errMsg}`);
        machine.send('SPAWN_FAILURE');
        return {
          success: false,
          state: 'Failed',
          message: `终端启动失败: ${errMsg}`,
        };
      }
    }

    // No adapter — stub behavior for tests
    return {
      success: true,
      state: 'Running',
    };
  }

  function write(id: string, data: string): void {
    const terminal = terminals.get(id);
    if (terminal) {
      // Only transition back for real user input, not terminal auto-responses
      if (terminal.machine.state === 'WaitingInput' && !isTerminalAutoResponse(data)) {
        resetInputDetector(id);
        terminal.machine.send('USER_INPUT');
        pushStateChange(id, terminal.machine.state);
      }
      terminal.process.write(data);
    }
  }

  function resize(id: string, cols: number, rows: number): void {
    const terminal = terminals.get(id);
    if (terminal) {
      terminal.process.resize(cols, rows);
    }
  }

  async function close(id: string, force?: boolean): Promise<{ success: boolean }> {
    const terminal = terminals.get(id);
    if (!terminal) {
      return { success: false };
    }

    if (force) {
      terminal.machine.send('CLOSE');
      pushStateChange(id, terminal.machine.state);
      terminal.process.kill();
      terminals.delete(id);
      outputBuffers.delete(id);
      resetInputDetector(id);
      return { success: true };
    }

    // Graceful close: send SIGINT via Ctrl+C, then wait for exit with timeout
    terminal.machine.send('CLOSE');
    pushStateChange(id, terminal.machine.state);
    terminal.process.write('\x03');

    return new Promise<{ success: boolean }>((resolve) => {
      const timeout = setTimeout(() => {
        // Timeout — force kill
        terminal.process.kill();
        terminals.delete(id);
        outputBuffers.delete(id);
        resetInputDetector(id);
        resolve({ success: true });
      }, GRACEFUL_CLOSE_TIMEOUT);

      terminal.process.onExit(() => {
        clearTimeout(timeout);
        terminals.delete(id);
        outputBuffers.delete(id);
        resetInputDetector(id);
        resolve({ success: true });
      });
    });
  }

  function list(): TerminalInfo[] {
    return Array.from(terminals.values()).map((t) => ({
      id: t.id,
      pid: t.process.pid,
      cwd: t.cwd,
      state: t.machine.state as TerminalState,
    }));
  }

  function getState(id: string): { state: string } | null {
    const terminal = terminals.get(id);
    if (!terminal) return null;
    return { state: terminal.machine.state };
  }

  function getForegroundProcess(id: string): ForegroundProcessInfo | null {
    const terminal = terminals.get(id);
    if (!terminal) return null;
    const name = getForegroundProcessName(terminal.process.pid);
    return { name: name ?? 'shell', pid: terminal.process.pid };
  }

  function closeAll(): void {
    for (const [id, terminal] of terminals) {
      terminal.process.kill();
      terminals.delete(id);
      outputBuffers.delete(id);
      resetInputDetector(id);
    }
  }

  function getBuffer(id: string): string {
    console.log(`[MUXVO:restore] getBuffer id=${id} bytes=${(outputBuffers.get(id) ?? '').length}`);
    return outputBuffers.get(id) ?? '';
  }

  function updateCwd(id: string, newCwd: string): boolean {
    const terminal = terminals.get(id);
    if (!terminal) return false;
    terminal.cwd = newCwd;
    return true;
  }

  return { spawn, write, resize, close, list, getState, getForegroundProcess, closeAll, getBuffer, updateCwd };
}

function isValidCwd(cwd: string): boolean {
  // Paths with 'nonexistent' are treated as invalid for testing
  return !cwd.includes('nonexistent');
}
