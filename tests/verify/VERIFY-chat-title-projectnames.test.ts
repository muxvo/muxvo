/**
 * VERIFY: Chat title uses sessionCustomTitles only
 *
 * Verifies:
 * 1. setSessionName (sessionId mode) stores sessionCustomTitles by sessionId
 * 2. setSessionName (CWD fallback) finds most recent session and stores sessionCustomTitles
 * 3. setSessionName (CWD fallback) returns failure when no sessions exist
 * 4. getSessions applies customTitle from sessionCustomTitles
 * 5. Clearing customName via sessionId removes sessionCustomTitles entry
 * 6. Clearing customName via CWD removes sessionCustomTitles for that session
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

describe('VERIFY: chat title uses sessionCustomTitles only', () => {
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

  test('setSessionName (sessionId mode) stores sessionCustomTitles by sessionId', async () => {
    const { createChatHandlers } = await import('@/main/ipc/chat-handlers');
    const handlers = createChatHandlers();

    const result = await handlers.setSessionName({
      sessionId: 'session-xyz',
      customName: 'Direct Rename',
    });

    expect(result.success).toBe(true);
    expect(result.sessionId).toBe('session-xyz');

    const configPath = join(tempDir, 'config.json');
    const saved = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(saved.sessionCustomTitles['session-xyz']).toBe('Direct Rename');
    // No projectCustomTitles should exist
    expect(saved.projectCustomTitles).toBeUndefined();
  });

  test('setSessionName (CWD fallback) finds most recent session and stores sessionCustomTitles', async () => {
    const { createChatHandlers } = await import('@/main/ipc/chat-handlers');
    const handlers = createChatHandlers();

    const result = await handlers.setSessionName({
      cwd: '/Users/test/my-project',
      customName: 'My Custom Title',
    });

    expect(result.success).toBe(true);
    expect(result.sessionId).toBe('session-abc');

    const configPath = join(tempDir, 'config.json');
    const saved = JSON.parse(readFileSync(configPath, 'utf-8'));
    // Session-level title stored
    expect(saved.sessionCustomTitles['session-abc']).toBe('My Custom Title');
    // No projectCustomTitles
    expect(saved.projectCustomTitles).toBeUndefined();
  });

  test('setSessionName (CWD fallback) returns failure when no sessions exist', async () => {
    const { createChatHandlers } = await import('@/main/ipc/chat-handlers');
    const handlers = createChatHandlers();

    const result = await handlers.setSessionName({
      cwd: '/nonexistent/fake/project/12345',
      customName: 'No Sessions Here',
    });

    // Should fail — no sessions found for this project
    expect(result.success).toBe(false);
  });

  test('getSessions applies customTitle from sessionCustomTitles', async () => {
    const { createChatHandlers } = await import('@/main/ipc/chat-handlers');
    const handlers = createChatHandlers();

    // Set name via sessionId mode
    await handlers.setSessionName({
      sessionId: 'session-abc',
      customName: 'Renamed Session',
    });

    const { sessions } = await handlers.getSessions({ projectHash: '-Users-test-my-project' });

    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions[0].customTitle).toBe('Renamed Session');
    expect(sessions[0].title).toBe('Default title from first message');
  });

  test('clearing customName via sessionId removes sessionCustomTitles entry', async () => {
    const { createChatHandlers } = await import('@/main/ipc/chat-handlers');
    const handlers = createChatHandlers();

    // Set a name first
    await handlers.setSessionName({ sessionId: 'session-abc', customName: 'Temp Name' });

    // Verify it's set
    let configPath = join(tempDir, 'config.json');
    let saved = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(saved.sessionCustomTitles['session-abc']).toBe('Temp Name');

    // Clear the name
    await handlers.setSessionName({ sessionId: 'session-abc', customName: '' });

    saved = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(saved.sessionCustomTitles['session-abc']).toBeUndefined();
  });

  test('clearing customName via CWD removes sessionCustomTitles for that session', async () => {
    const { createChatHandlers } = await import('@/main/ipc/chat-handlers');
    const handlers = createChatHandlers();

    // Set a name via CWD
    await handlers.setSessionName({ cwd: '/Users/test/my-project', customName: 'CWD Name' });

    let configPath = join(tempDir, 'config.json');
    let saved = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(saved.sessionCustomTitles['session-abc']).toBe('CWD Name');

    // Clear via CWD
    await handlers.setSessionName({ cwd: '/Users/test/my-project', customName: '' });

    saved = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(saved.sessionCustomTitles['session-abc']).toBeUndefined();
  });
});
