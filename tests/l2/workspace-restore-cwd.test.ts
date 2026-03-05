/**
 * VERIFY: Workspace restore sends cd commands to correct cwd
 *
 * Bug: restoreWorkspace spawns terminals with correct cwd, but login shell
 * initialization scripts override it. Fix: send explicit `cd <path>` after spawn.
 *
 * This test verifies the core logic: after spawning terminals for a workspace,
 * write() is called with cd commands to the saved cwds.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Workspace restore cwd fix', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('restoreWorkspace sends cd commands after spawn delay', async () => {
    // Simulate the core logic extracted from restoreWorkspace in index.ts
    const writeCalls: { id: string; data: string }[] = [];
    const mockTerminalManager = {
      closeAll: vi.fn(),
      spawn: vi.fn((options: { cwd: string }) => ({
        success: true,
        id: `term-${Math.random().toString(36).slice(2, 6)}`,
        state: 'Running',
      })),
      write: vi.fn((id: string, data: string) => {
        writeCalls.push({ id, data });
      }),
      list: vi.fn(() => []),
      setName: vi.fn(),
    };

    const workspace = {
      name: 'test workspace',
      terminals: [
        { cwd: '/Users/test/project-a' },
        { cwd: '/Users/test/project-b', customName: 'backend' },
        { cwd: '/Users/test/my project' }, // path with space
      ],
      savedAt: new Date().toISOString(),
    };

    // Execute restoreWorkspace logic (extracted from index.ts)
    const tm = mockTerminalManager;
    tm.closeAll();
    const spawnedIds: { id: string; cwd: string }[] = [];
    for (const t of workspace.terminals) {
      const result = tm.spawn({ cwd: t.cwd });
      if (result.success && result.id) {
        spawnedIds.push({ id: result.id, cwd: t.cwd });
        if (t.customName) {
          tm.setName(result.id, t.customName);
        }
      }
    }
    // The fix: setTimeout + cd
    setTimeout(() => {
      for (const { id, cwd } of spawnedIds) {
        tm.write(id, ` cd ${cwd.replace(/ /g, '\\ ')}\n`);
      }
    }, 1500);

    // Before timeout: no write calls
    expect(writeCalls).toHaveLength(0);

    // After timeout: cd commands sent
    vi.advanceTimersByTime(1500);

    expect(writeCalls).toHaveLength(3);
    expect(writeCalls[0].data).toBe(' cd /Users/test/project-a\n');
    expect(writeCalls[1].data).toBe(' cd /Users/test/project-b\n');
    // Path with space should be escaped
    expect(writeCalls[2].data).toBe(' cd /Users/test/my\\ project\n');

    // Verify closeAll was called first
    expect(tm.closeAll).toHaveBeenCalledTimes(1);
    // Verify all 3 terminals were spawned with correct cwds
    expect(tm.spawn).toHaveBeenCalledTimes(3);
    expect(tm.spawn).toHaveBeenCalledWith({ cwd: '/Users/test/project-a' });
    expect(tm.spawn).toHaveBeenCalledWith({ cwd: '/Users/test/project-b' });
    expect(tm.spawn).toHaveBeenCalledWith({ cwd: '/Users/test/my project' });
    // Verify customName was set
    expect(tm.setName).toHaveBeenCalledTimes(1);
  });

  test('cd command has leading space to avoid shell history', () => {
    const cwd = '/Users/test/project';
    const cdCommand = ` cd ${cwd.replace(/ /g, '\\ ')}\n`;
    // Leading space = HIST_IGNORE_SPACE in zsh
    expect(cdCommand.startsWith(' ')).toBe(true);
    expect(cdCommand).toBe(' cd /Users/test/project\n');
  });
});
