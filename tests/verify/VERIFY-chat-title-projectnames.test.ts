/**
 * VERIFY: Chat title uses sessionCustomTitles AND projectCustomTitles
 *
 * Verifies:
 * 1. setSessionName (CWD mode) stores both projectCustomTitles and sessionCustomTitles
 * 2. setSessionName (CWD mode) succeeds even when no sessions exist (stores project-level title)
 * 3. getSessions applies session-level customTitle by sessionId (priority)
 * 4. getSessions applies project-level customTitle to the most recent session when no session-level title
 * 5. Session-level title takes priority over project-level title
 * 6. Clearing customName via CWD only removes projectCustomTitles, keeps sessionCustomTitles
 * 7. setSessionName (sessionId mode) only updates sessionCustomTitles, not projectCustomTitles
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Mock Electron modules
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  Menu: { buildFromTemplate: vi.fn(), popup: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
  shell: { openPath: vi.fn() },
}));

// Mock chat readers — we don't need real filesystem scanning
vi.mock('@/main/services/chat-dual-source', () => ({
  createChatProjectReader: vi.fn(() => ({})),
}));
vi.mock('@/main/services/chat-archive', () => ({
  createChatArchiveManager: vi.fn(() => ({})),
}));
vi.mock('@/main/services/codex-chat-source', () => ({
  createCodexChatReader: vi.fn(() => { throw new Error('no codex'); }),
}));
vi.mock('@/main/services/gemini-chat-source', () => ({
  createGeminiChatReader: vi.fn(() => { throw new Error('no gemini'); }),
}));

// Mock multi-source reader to return controlled sessions
vi.mock('@/main/services/chat-multi-source', () => ({
  createChatMultiSource: vi.fn(() => ({
    getProjects: async () => [],
    getSessionsForProject: async (hash: string) => {
      if (hash === '-Users-test-my-project') {
        return [{
          sessionId: 'session-abc',
          projectHash: '-Users-test-my-project',
          title: 'Default title from first message',
          startedAt: '2024-01-01T00:00:00Z',
          lastModified: 1700000000000,
          fileSize: 100,
        }];
      }
      if (hash === '-Users-test-my-project--worktrees-wt-1') {
        return [{
          sessionId: 'session-wt1',
          projectHash: '-Users-test-my-project',
          title: 'Worktree session',
          startedAt: '2024-01-02T00:00:00Z',
          lastModified: 1700100000000,
          fileSize: 50,
        }];
      }
      return [];
    },
    getAllRecentSessions: async () => [
      {
        sessionId: 'session-new',
        projectHash: '-Users-test-my-project',
        title: 'Newest session without custom title',
        startedAt: '2024-01-03T00:00:00Z',
        lastModified: 1700200000000,
        fileSize: 80,
      },
      {
        sessionId: 'session-abc',
        projectHash: '-Users-test-my-project',
        title: 'Default title from first message',
        startedAt: '2024-01-01T00:00:00Z',
        lastModified: 1700000000000,
        fileSize: 100,
      },
    ],
    readSession: async () => [],
    search: async () => [],
  })),
}));

describe('VERIFY: chat title uses sessionCustomTitles + projectCustomTitles', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'muxvo-verify-'));
    // Point config manager to temp dir
    const { initConfigDir } = await import('@/main/services/app/config');
    initConfigDir(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('setSessionName (CWD) stores both projectCustomTitles and sessionCustomTitles', async () => {
    const { createChatHandlers } = await import('@/main/ipc/chat-handlers');
    const handlers = createChatHandlers();

    const result = await handlers.setSessionName({
      cwd: '/Users/test/my-project',
      customName: 'My Custom Title',
    });

    expect(result.success).toBe(true);

    const configPath = join(tempDir, 'config.json');
    const saved = JSON.parse(readFileSync(configPath, 'utf-8'));
    // Session-level title stored
    expect(saved.sessionCustomTitles['session-abc']).toBe('My Custom Title');
    // Project-level title also stored
    expect(saved.projectCustomTitles['-Users-test-my-project']).toBe('My Custom Title');
  });

  test('setSessionName (CWD) succeeds even when no sessions exist (stores project-level title)', async () => {
    const { createChatHandlers } = await import('@/main/ipc/chat-handlers');
    const handlers = createChatHandlers();

    const result = await handlers.setSessionName({
      cwd: '/nonexistent/fake/project/12345',
      customName: 'Project Title Without Sessions',
    });

    // Should succeed — project-level title is stored even without sessions
    expect(result.success).toBe(true);

    const configPath = join(tempDir, 'config.json');
    const saved = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(saved.projectCustomTitles['-nonexistent-fake-project-12345']).toBe('Project Title Without Sessions');
    // No session-level title (no sessions found)
    expect(saved.sessionCustomTitles).toEqual({});
  });

  test('getSessions applies session-level customTitle by sessionId', async () => {
    const { createChatHandlers } = await import('@/main/ipc/chat-handlers');
    const handlers = createChatHandlers();

    await handlers.setSessionName({
      cwd: '/Users/test/my-project',
      customName: 'Renamed Session',
    });

    const { sessions } = await handlers.getSessions({ projectHash: '-Users-test-my-project' });

    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions[0].customTitle).toBe('Renamed Session');
    expect(sessions[0].title).toBe('Default title from first message');
  });

  test('getSessions applies project-level title to latest session when no session-level title', async () => {
    const { createChatHandlers } = await import('@/main/ipc/chat-handlers');
    const handlers = createChatHandlers();

    // Manually write project-level title without session-level title
    const { createConfigManager } = await import('@/main/services/app/config');
    const cm = createConfigManager();
    cm.saveConfig({
      projectCustomTitles: { '-Users-test-my-project': 'Terminal Name' },
      sessionCustomTitles: {},
    });

    // getAllRecentSessions returns session-new (newer) and session-abc (older)
    const { sessions } = await handlers.getSessions({ projectHash: '__all__' });

    // The most recent session should get the project-level title
    const newest = sessions.find(s => s.sessionId === 'session-new');
    const older = sessions.find(s => s.sessionId === 'session-abc');
    expect(newest?.customTitle).toBe('Terminal Name');
    // Older session in same project should NOT get the title (only latest gets it)
    expect(older?.customTitle).toBeUndefined();
  });

  test('session-level title takes priority over project-level title', async () => {
    const { createChatHandlers } = await import('@/main/ipc/chat-handlers');
    const handlers = createChatHandlers();

    const { createConfigManager } = await import('@/main/services/app/config');
    const cm = createConfigManager();
    cm.saveConfig({
      projectCustomTitles: { '-Users-test-my-project': 'Project Level Name' },
      sessionCustomTitles: { 'session-new': 'Session Level Name' },
    });

    const { sessions } = await handlers.getSessions({ projectHash: '__all__' });

    const newest = sessions.find(s => s.sessionId === 'session-new');
    // Session-level wins
    expect(newest?.customTitle).toBe('Session Level Name');
  });

  test('clearing customName via CWD removes projectCustomTitles but keeps sessionCustomTitles', async () => {
    const { createChatHandlers } = await import('@/main/ipc/chat-handlers');
    const handlers = createChatHandlers();

    // Set a name first
    await handlers.setSessionName({ cwd: '/Users/test/my-project', customName: 'Temp Name' });

    // Clear the name
    await handlers.setSessionName({ cwd: '/Users/test/my-project', customName: '' });

    const configPath = join(tempDir, 'config.json');
    const saved = JSON.parse(readFileSync(configPath, 'utf-8'));

    // Project-level title should be cleared
    expect(saved.projectCustomTitles['-Users-test-my-project']).toBeUndefined();
    // Session-level title should be preserved (was set during the first call)
    expect(saved.sessionCustomTitles['session-abc']).toBe('Temp Name');
  });

  test('setSessionName (sessionId mode) only updates sessionCustomTitles', async () => {
    const { createChatHandlers } = await import('@/main/ipc/chat-handlers');
    const handlers = createChatHandlers();

    const result = await handlers.setSessionName({
      sessionId: 'session-xyz',
      customName: 'Direct Rename',
    });

    expect(result.success).toBe(true);

    const configPath = join(tempDir, 'config.json');
    const saved = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(saved.sessionCustomTitles['session-xyz']).toBe('Direct Rename');
    // No project-level title should be created
    expect(saved.projectCustomTitles).toEqual({});
  });

  test('worktree CWD stores project title under parent hash', async () => {
    const { createChatHandlers } = await import('@/main/ipc/chat-handlers');
    const handlers = createChatHandlers();

    const result = await handlers.setSessionName({
      cwd: '/Users/test/my-project/.worktrees/wt-1',
      customName: 'Worktree Task',
    });

    expect(result.success).toBe(true);

    const configPath = join(tempDir, 'config.json');
    const saved = JSON.parse(readFileSync(configPath, 'utf-8'));
    // Project-level title stored under PARENT hash (not worktree hash)
    expect(saved.projectCustomTitles['-Users-test-my-project']).toBe('Worktree Task');
    // Session-level title stored for the worktree session
    expect(saved.sessionCustomTitles['session-wt1']).toBe('Worktree Task');
  });
});
