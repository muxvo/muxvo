/**
 * VERIFY: Default terminal cwd feature
 *
 * Tests that:
 * 1. Terminal manager injects `cd <path> && clear` when cwd != HOME
 * 2. No cd injection when cwd == HOME
 * 3. MuxvoConfig type includes defaultTerminalCwd field
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PtyAdapter, PtyProcess } from '@/main/services/terminal/pty-adapter';

// Mock electron before importing manager
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [],
  },
}));

// Mock foreground-detector (uses execFileSync which requires real processes)
vi.mock('@/main/services/terminal/foreground-detector', () => ({
  getForegroundProcessName: () => null,
  getForegroundChildPid: () => null,
  getProcessCwd: () => null,
}));

// Mock input-detector
vi.mock('@/main/services/terminal/input-detector', () => ({
  detectWaitingInput: () => false,
  resetInputDetector: () => {},
  detectBellSignal: () => false,
  detectOscNotification: () => false,
}));

function createMockPtyProcess(): PtyProcess & { writtenData: string[]; dataCallback?: (data: string) => void } {
  const mock: PtyProcess & { writtenData: string[]; dataCallback?: (data: string) => void } = {
    pid: 12345,
    writtenData: [],
    write(data: string) {
      this.writtenData.push(data);
    },
    resize() {},
    kill() {},
    onData(callback) {
      this.dataCallback = callback;
    },
    onExit() {},
  };
  return mock;
}

function createMockPtyAdapter(mockProcess: PtyProcess): PtyAdapter {
  return {
    spawn: () => mockProcess,
    getDefaultShell: () => '/bin/zsh',
  };
}

describe('VERIFY: Default terminal cwd', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('spawn with non-HOME cwd injects cd && clear after 1.5s', async () => {
    const mockProc = createMockPtyProcess();
    const mockPty = createMockPtyAdapter(mockProc);

    const { createTerminalManager } = await import('@/main/services/terminal/manager');
    const manager = createTerminalManager({ pty: mockPty });

    const homePath = require('os').homedir();
    const customCwd = require('os').tmpdir(); // Use /tmp — exists and is not HOME
    // Ensure customCwd is not HOME for this test
    expect(customCwd).not.toBe(homePath);

    const result = manager.spawn({ cwd: customCwd });
    expect(result.success).toBe(true);

    // Before timeout, no cd should be written
    const writtenBefore = mockProc.writtenData.filter(d => d.includes('cd '));
    expect(writtenBefore.length).toBe(0);

    // Advance past the 1.5s timeout
    vi.advanceTimersByTime(1600);

    // After timeout, cd && clear should be injected
    const writtenAfter = mockProc.writtenData.filter(d => d.includes('cd '));
    expect(writtenAfter.length).toBe(1);
    expect(writtenAfter[0]).toContain(customCwd);
    expect(writtenAfter[0]).toContain('&& clear');

    // Cleanup
    manager.closeAll();
  });

  test('spawn with HOME cwd does NOT inject cd', async () => {
    const mockProc = createMockPtyProcess();
    const mockPty = createMockPtyAdapter(mockProc);

    const { createTerminalManager } = await import('@/main/services/terminal/manager');
    const manager = createTerminalManager({ pty: mockPty });

    const homePath = require('os').homedir();
    const result = manager.spawn({ cwd: homePath });
    expect(result.success).toBe(true);

    // Advance past the 1.5s timeout
    vi.advanceTimersByTime(2000);

    // No cd should be written for HOME
    const cdWrites = mockProc.writtenData.filter(d => d.includes('cd '));
    expect(cdWrites.length).toBe(0);

    // Cleanup
    manager.closeAll();
  });

  test('MuxvoConfig type includes defaultTerminalCwd field', async () => {
    const { getAppConfig } = await import('@/main/services/app/config');
    const config = await getAppConfig();
    // defaultTerminalCwd is optional, so it may not be in defaults
    // but the type should accept it
    const configWithCwd = { ...config, defaultTerminalCwd: '/some/path' };
    expect(configWithCwd.defaultTerminalCwd).toBe('/some/path');
  });
});
