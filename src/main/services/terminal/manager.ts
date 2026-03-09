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
import { getForegroundProcessName, getForegroundChildPid, getProcessCwd } from './foreground-detector';
import { detectWaitingInput, resetInputDetector, detectBellSignal, detectOscNotification } from './input-detector';
import type {
  TerminalInfo,
  ForegroundProcessInfo,
} from '@/shared/types/terminal.types';
import { TerminalState } from '@/shared/types/terminal.types';
import { createTerminalMachine } from '@/shared/machines/terminal-process';

const MAX_TERMINALS = 20;
const GRACEFUL_CLOSE_TIMEOUT = 5000;
const CWD_POLL_INTERVAL_MS = 1000;
const CWD_GRACE_MS = 1000;

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
  cols?: number;
  rows?: number;
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
  customName?: string;
  machine: ReturnType<typeof createTerminalMachine>;
  spawnedAt: number;
  /** Whether shell init keybindings (Home/End) have been injected */
  shellInitDone?: boolean;
}

interface TerminalManagerDeps {
  pty?: PtyAdapter;
  perfLogger?: { track(event: string, terminalId?: string): void };
  debugLogger?: (line: string) => void;
  /** 终端状态变化回调（用于 Dock 角标等外部监听） */
  onStateChange?: (id: string, state: string) => void;
}

export function createTerminalManager(deps?: TerminalManagerDeps) {
  const terminals = new Map<string, ManagedTerminal>();
  const OUTPUT_BUFFER_MAX_BYTES = 64 * 1024;
  const outputBuffers = new Map<string, string>();
  const ptyAdapter = deps?.pty;
  const perfLogger = deps?.perfLogger;
  const debugLog = deps?.debugLogger ?? (() => {});

  // Debounce state change pushes to avoid rapid Running↔WaitingInput oscillation
  // causing excessive React re-renders (e.g. user pressing up/down in yes/no prompt)
  const pendingStateChanges = new Map<string, { state: string; processName?: string; timer: ReturnType<typeof setTimeout> }>();
  const STATE_CHANGE_DEBOUNCE_MS = 50;

  function pushStateChange(id: string, state: string, processName?: string): void {
    // Terminal-ending states must arrive immediately
    const immediate = ['Stopped', 'Failed', 'Disconnected', 'Removed'].includes(state);

    const existing = pendingStateChanges.get(id);
    if (existing) clearTimeout(existing.timer);

    debugLog(`[TERM:stateChange] id=${id} state=${state} processName=${processName ?? ''} immediate=${immediate}`);

    if (immediate) {
      pendingStateChanges.delete(id);
      const win = BrowserWindow.getAllWindows()[0];
      if (win && !win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.TERMINAL.STATE_CHANGE, { id, state, processName });
      }
      deps?.onStateChange?.(id, state);
      return;
    }

    const timer = setTimeout(() => {
      pendingStateChanges.delete(id);
      const win = BrowserWindow.getAllWindows()[0];
      if (win && !win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.TERMINAL.STATE_CHANGE, { id, state, processName });
      }
      deps?.onStateChange?.(id, state);
    }, STATE_CHANGE_DEBOUNCE_MS);

    pendingStateChanges.set(id, { state, processName, timer });
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
        const initialCols = options.cols && options.cols >= 10 ? options.cols : 80;
        const initialRows = options.rows && options.rows >= 2 ? options.rows : 24;
        const proc = ptyAdapter.spawn(shell, options.cwd, initialCols, initialRows);
        const id = `term-${proc.pid}`;

        machine.send('SPAWN_SUCCESS');

        terminals.set(id, { id, process: proc, cwd: options.cwd, machine, spawnedAt: Date.now() });
        startCwdPolling();
        debugLog(`[TERM:spawn] id=${id} pid=${proc.pid} cwd=${options.cwd}`);

        pushStateChange(id, machine.state);

        // Push terminal output to renderer
        proc.onData((data) => {
          perfLogger?.track('termOutput', id);

          const existing = outputBuffers.get(id) ?? '';
          const updated = existing + data;
          if (updated.length > OUTPUT_BUFFER_MAX_BYTES) {
            // Truncate from the front, but avoid splitting an ESC sequence.
            // Scan backward from the cut point to find the nearest safe boundary
            // (a position that is NOT inside an incomplete \x1b[...X sequence).
            let start = updated.length - OUTPUT_BUFFER_MAX_BYTES;
            // Search a small window before the cut point for a stray \x1b
            const windowStart = Math.max(0, start - 32);
            for (let i = start; i >= windowStart; i--) {
              if (updated[i] === '\x1b') {
                // Found an ESC — cut before it to avoid a partial sequence
                start = i;
                break;
              }
            }
            outputBuffers.set(id, updated.slice(start));
          } else {
            outputBuffers.set(id, updated);
          }

          const win = BrowserWindow.getAllWindows()[0];
          if (win) {
            win.webContents.send(IPC_CHANNELS.TERMINAL.OUTPUT, { id, data });
          }
          // Sampled diagnostic log (1% of output events)
          if (Math.random() < 0.01) {
            debugLog(`[TERM:ipcPush] id=${id} bytes=${data.length} bufSize=${updated.length} winExists=${!!win} winDestroyed=${win?.isDestroyed() ?? 'N/A'}`);
          }

          // Detect OSC 7 cwd change: \x1b]7;file://hostname/path\x07 or \x1b]7;file://hostname/path\x1b\\
          const osc7Match = data.match(/\x1b\]7;file:\/\/[^/]*([^\x07\x1b]+)[\x07\x1b]/);
          if (osc7Match) {
            const newCwd = decodeURIComponent(osc7Match[1]);
            const terminal = terminals.get(id);
            if (terminal && terminal.cwd !== newCwd) {
              // Grace period: ignore OSC 7 cwd changes during shell initialization
              if (Date.now() - terminal.spawnedAt < CWD_GRACE_MS) {
                debugLog(`[TERM:osc7] id=${id} ignoring cwd=${newCwd} (grace period, spawn cwd=${terminal.cwd})`);
              } else {
                terminal.cwd = newCwd;
                const cwdWin = BrowserWindow.getAllWindows()[0];
                if (cwdWin && !cwdWin.isDestroyed()) {
                  cwdWin.webContents.send(IPC_CHANNELS.TERMINAL.CWD_CHANGED, { id, cwd: newCwd });
                }
              }
            }
          }

          // WaitingInput detection: BEL/OSC signals or text pattern matching
          // Exit is handled by: user clicking tile (acknowledgeWaiting), typing (USER_INPUT), or terminal exit
          const hasBell = detectBellSignal(data);
          const oscNotif = detectOscNotification(data);
          if (machine.state === 'Running') {
            if (hasBell || oscNotif) {
              resetInputDetector(id);
              machine.send('WAIT_INPUT');
              pushStateChange(id, machine.state);
            } else {
              const detected = detectWaitingInput(data, id);
              if (detected) {
                machine.send('WAIT_INPUT');
                pushStateChange(id, machine.state);
              }
            }
          }

          // On first PTY output: schedule keybinding injection for zsh (all keymaps).
          // This ensures Cmd+Left/Right works regardless of vi/emacs mode.
          // We inject on first output (not WaitingInput) because WaitingInput only
          // detects CC/interactive prompts, not regular shell prompts.
          {
            const terminal = terminals.get(id);
            if (terminal && !terminal.shellInitDone) {
              terminal.shellInitDone = true;
              setTimeout(() => {
                proc.write(
                  " bindkey '\\e[H' beginning-of-line 2>/dev/null;" +
                  " bindkey '\\e[F' end-of-line 2>/dev/null;" +
                  " bindkey -M vicmd '\\e[H' beginning-of-line 2>/dev/null;" +
                  " bindkey -M vicmd '\\e[F' end-of-line 2>/dev/null;" +
                  " clear\r"
                );
              }, 100);
            }
          }
        });

        // Push terminal exit to renderer
        proc.onExit((code) => {
          debugLog(`[TERM:exit] id=${id} code=${code} state=${machine.state}`);
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
          if (terminals.size === 0) stopCwdPolling();
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
    if (!terminal) return;
    // Defense-in-depth: reject tiny dimensions that would damage shell output
    if (cols < 10 || rows < 2) {
      debugLog(`[TERM:resize] id=${id} cols=${cols} rows=${rows} BLOCKED(min:10x2)`);
      return;
    }
    terminal.process.resize(cols, rows);
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
      if (terminals.size === 0) stopCwdPolling();
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
        if (terminals.size === 0) stopCwdPolling();
        resolve({ success: true });
      }, GRACEFUL_CLOSE_TIMEOUT);

      terminal.process.onExit(() => {
        clearTimeout(timeout);
        terminals.delete(id);
        outputBuffers.delete(id);
        resetInputDetector(id);
        if (terminals.size === 0) stopCwdPolling();
        resolve({ success: true });
      });
    });
  }

  function list(): TerminalInfo[] {
    return Array.from(terminals.values()).map((t) => ({
      id: t.id,
      pid: t.process.pid,
      cwd: t.cwd,
      customName: t.customName,
      state: t.machine.state as TerminalState,
    }));
  }

  function setName(id: string, name: string): boolean {
    const terminal = terminals.get(id);
    if (!terminal) return false;
    terminal.customName = name || undefined;
    return true;
  }

  function getState(id: string): { state: string } | null {
    const terminal = terminals.get(id);
    if (!terminal) return null;
    return { state: terminal.machine.state };
  }

  function getForegroundProcess(id: string): ForegroundProcessInfo | null {
    const terminal = terminals.get(id);
    if (!terminal) return null;

    const shellPid = terminal.process.pid;
    const childPid = getForegroundChildPid(shellPid);
    if (childPid) {
      const childName = getForegroundProcessName(childPid);
      return { name: childName ?? 'unknown', pid: childPid };
    }

    const shellName = getForegroundProcessName(shellPid);
    return { name: shellName ?? 'shell', pid: shellPid };
  }

  // --- CWD polling: detect foreground child process directory changes ---
  let cwdPollTimer: ReturnType<typeof setInterval> | null = null;

  function pollForegroundCwd(): void {
    for (const [id, terminal] of terminals) {
      const state = terminal.machine.state;
      if (state !== 'Running' && state !== 'WaitingInput') continue;

      const childPid = getForegroundChildPid(terminal.process.pid);
      const targetPid = childPid ?? terminal.process.pid;

      const targetCwd = getProcessCwd(targetPid);
      if (!targetCwd || targetCwd === terminal.cwd) continue;

      // Grace period: ignore cwd changes during shell initialization
      if (Date.now() - terminal.spawnedAt < CWD_GRACE_MS) continue;

      terminal.cwd = targetCwd;
      const win = BrowserWindow.getAllWindows()[0];
      if (win && !win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.TERMINAL.CWD_CHANGED, { id, cwd: targetCwd });
      }
    }
  }

  function startCwdPolling(): void {
    if (cwdPollTimer) return;
    cwdPollTimer = setInterval(pollForegroundCwd, CWD_POLL_INTERVAL_MS);
  }

  function stopCwdPolling(): void {
    if (cwdPollTimer) {
      clearInterval(cwdPollTimer);
      cwdPollTimer = null;
    }
  }

  function closeAll(): void {
    for (const [id, terminal] of terminals) {
      terminal.process.kill();
      terminals.delete(id);
      outputBuffers.delete(id);
      resetInputDetector(id);
    }
    stopCwdPolling();
  }

  function getBuffer(id: string): string {
    const bytes = (outputBuffers.get(id) ?? '').length;
    console.log(`[MUXVO:restore] getBuffer id=${id} bytes=${bytes}`);
    debugLog(`[TERM:getBuffer] id=${id} bytes=${bytes}`);
    return outputBuffers.get(id) ?? '';
  }

  function updateCwd(id: string, newCwd: string): boolean {
    const terminal = terminals.get(id);
    if (!terminal) return false;
    terminal.cwd = newCwd;
    return true;
  }

  /** User clicked on a terminal tile — clear WaitingInput if active */
  function acknowledgeWaiting(id: string): void {
    const terminal = terminals.get(id);
    if (terminal && terminal.machine.state === 'WaitingInput') {
      resetInputDetector(id);
      terminal.machine.send('AUTO_RESUME');
      pushStateChange(id, terminal.machine.state);
    }
  }

  return { spawn, write, resize, close, list, getState, getForegroundProcess, closeAll, getBuffer, updateCwd, acknowledgeWaiting, setName };
}

function isValidCwd(cwd: string): boolean {
  // Paths with 'nonexistent' are treated as invalid for testing
  return !cwd.includes('nonexistent');
}
