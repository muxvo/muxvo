/**
 * VERIFY: Chat title uses projectNames (projectHash → customName)
 *
 * Verifies:
 * 1. setSessionName stores by projectHash in config.projectNames (not sessionId in sessionNames)
 * 2. setSessionName succeeds even when no CC session exists for that CWD
 * 3. getSessions applies customTitle from projectNames by matching projectHash
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

describe('VERIFY: chat title uses projectNames', () => {
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

  test('setSessionName stores customName by projectHash (not sessionId)', async () => {
    const { createChatHandlers } = await import('@/main/ipc/chat-handlers');
    const handlers = createChatHandlers();

    const result = await handlers.setSessionName({
      cwd: '/Users/test/my-project',
      customName: 'My Custom Title',
    });

    // Must succeed and return projectHash
    expect(result.success).toBe(true);
    expect((result as any).projectHash).toBe('-Users-test-my-project');

    // Verify config.projectNames was written (not sessionNames)
    const configPath = join(tempDir, 'config.json');
    const saved = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(saved.projectNames).toBeDefined();
    expect(saved.projectNames['-Users-test-my-project']).toBe('My Custom Title');
    expect(saved.sessionNames).toBeUndefined();
  });

  test('setSessionName succeeds even with no CC sessions for that CWD', async () => {
    const { createChatHandlers } = await import('@/main/ipc/chat-handlers');
    const handlers = createChatHandlers();

    // Use a path that the mock reader returns NO sessions for
    const result = await handlers.setSessionName({
      cwd: '/nonexistent/fake/project/12345',
      customName: 'Still Works',
    });

    // New logic: always succeeds, no session lookup needed
    expect(result.success).toBe(true);

    const configPath = join(tempDir, 'config.json');
    const saved = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(saved.projectNames['-nonexistent-fake-project-12345']).toBe('Still Works');
  });

  test('getSessions applies customTitle from projectNames by projectHash', async () => {
    const { createChatHandlers } = await import('@/main/ipc/chat-handlers');
    const handlers = createChatHandlers();

    // Step 1: Set a custom name for the project
    await handlers.setSessionName({
      cwd: '/Users/test/my-project',
      customName: 'Renamed Project',
    });

    // Step 2: Get sessions — customTitle should be applied
    const { sessions } = await handlers.getSessions({ projectHash: '-Users-test-my-project' });

    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions[0].customTitle).toBe('Renamed Project');
    // Original title still preserved
    expect(sessions[0].title).toBe('Default title from first message');
  });

  test('clearing customName removes it from projectNames', async () => {
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
