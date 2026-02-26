/**
 * VERIFY: Chat title uses sessionCustomTitles (sessionId → customName)
 *
 * Verifies:
 * 1. setSessionName finds the most recent session and stores by sessionId in config.sessionCustomTitles
 * 2. setSessionName returns { success: false } when no sessions exist for that CWD
 * 3. getSessions applies customTitle from sessionCustomTitles by matching sessionId
 * 4. Clearing customName removes the entry from sessionCustomTitles
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
      return [];
    },
    getAllRecentSessions: async () => [{
      sessionId: 'session-abc',
      projectHash: '-Users-test-my-project',
      title: 'Default title from first message',
      startedAt: '2024-01-01T00:00:00Z',
      lastModified: 1700000000000,
      fileSize: 100,
    }],
    readSession: async () => [],
    search: async () => [],
  })),
}));

describe('VERIFY: chat title uses sessionCustomTitles', () => {
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

  test('setSessionName stores customName by sessionId (not projectHash)', async () => {
    const { createChatHandlers } = await import('@/main/ipc/chat-handlers');
    const handlers = createChatHandlers();

    const result = await handlers.setSessionName({
      cwd: '/Users/test/my-project',
      customName: 'My Custom Title',
    });

    // Must succeed and return sessionId
    expect(result.success).toBe(true);
    expect((result as any).sessionId).toBe('session-abc');

    // Verify config.sessionCustomTitles was written (not projectNames)
    const configPath = join(tempDir, 'config.json');
    const saved = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(saved.sessionCustomTitles).toBeDefined();
    expect(saved.sessionCustomTitles['session-abc']).toBe('My Custom Title');
    expect(saved.projectNames).toBeUndefined();
  });

  test('setSessionName fails when no sessions exist for that CWD', async () => {
    const { createChatHandlers } = await import('@/main/ipc/chat-handlers');
    const handlers = createChatHandlers();

    // Use a path that the mock reader returns NO sessions for
    const result = await handlers.setSessionName({
      cwd: '/nonexistent/fake/project/12345',
      customName: 'Should Fail',
    });

    // No sessions → cannot determine sessionId → returns false
    expect(result.success).toBe(false);
  });

  test('getSessions applies customTitle from sessionCustomTitles by sessionId', async () => {
    const { createChatHandlers } = await import('@/main/ipc/chat-handlers');
    const handlers = createChatHandlers();

    // Step 1: Set a custom name (will apply to session-abc)
    await handlers.setSessionName({
      cwd: '/Users/test/my-project',
      customName: 'Renamed Session',
    });

    // Step 2: Get sessions — customTitle should be applied to session-abc only
    const { sessions } = await handlers.getSessions({ projectHash: '-Users-test-my-project' });

    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions[0].customTitle).toBe('Renamed Session');
    // Original title still preserved
    expect(sessions[0].title).toBe('Default title from first message');
  });

  test('clearing customName removes it from sessionCustomTitles', async () => {
    const { createChatHandlers } = await import('@/main/ipc/chat-handlers');
    const handlers = createChatHandlers();

    // Set then clear
    await handlers.setSessionName({ cwd: '/Users/test/my-project', customName: 'Temp Name' });
    await handlers.setSessionName({ cwd: '/Users/test/my-project', customName: '' });

    // getSessions should NOT have customTitle
    const { sessions } = await handlers.getSessions({ projectHash: '-Users-test-my-project' });
    expect(sessions[0].customTitle).toBeUndefined();
  });
});
