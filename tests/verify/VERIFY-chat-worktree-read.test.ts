/**
 * VERIFY: Chat worktree session read + queue-operation classification
 *
 * Bug 1: readSession can't find worktree session files when given parent projectHash
 * Bug 2: queue-operation messages (user interruptions) classified as 'system' instead of 'user'
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('VERIFY: chat worktree read + queue-operation', () => {
  let tempDir: string;
  let projectsDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'muxvo-verify-'));
    projectsDir = join(tempDir, 'projects');
    mkdirSync(projectsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('Bug1: readSession finds session in worktree directory via parent hash', async () => {
    const { createChatProjectReader } = await import('@/main/services/chat-dual-source');

    const parentHash = '-Users-test-my-project';
    const wtHash = '-Users-test-my-project--worktrees-wt-1';
    const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

    // Create worktree directory with a session file (NOT in parent dir)
    const wtDir = join(projectsDir, wtHash);
    mkdirSync(wtDir, { recursive: true });
    const jsonlContent = [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'hello from worktree' }, uuid: 'u1', sessionId, timestamp: '2026-03-09T00:00:00Z', cwd: '/test' }),
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'hi back' }] }, uuid: 'u2', sessionId, timestamp: '2026-03-09T00:00:01Z', cwd: '/test' }),
    ].join('\n');
    writeFileSync(join(wtDir, `${sessionId}.jsonl`), jsonlContent);

    // Also create parent dir (empty, no session file there)
    mkdirSync(join(projectsDir, parentHash), { recursive: true });

    const reader = createChatProjectReader({ ccBasePath: tempDir });

    // First call getProjects to populate worktreeMap
    await reader.getProjects();

    // Now readSession with parent hash should find the file in worktree dir
    const messages = await reader.readSession(parentHash, sessionId);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0].type).toBe('user');
    expect(messages[0].content).toBe('hello from worktree');
  });

  test('Bug2: queue-operation messages are classified as user type', async () => {
    const { createChatProjectReader } = await import('@/main/services/chat-dual-source');

    const projectHash = '-Users-test-queueop';
    const sessionId = 'qqqqqqqq-1111-2222-3333-444444444444';

    mkdirSync(join(projectsDir, projectHash), { recursive: true });
    const jsonlContent = [
      JSON.stringify({ type: 'user', message: { role: 'user', content: '开始工作' }, uuid: 'u1', sessionId, timestamp: '2026-03-09T00:00:00Z', cwd: '/test' }),
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '好的，正在处理...' }] }, uuid: 'u2', sessionId, timestamp: '2026-03-09T00:00:01Z', cwd: '/test' }),
      JSON.stringify({ type: 'queue-operation', content: '但是咱们现在的对话又能正常显示了', uuid: 'u3', sessionId, timestamp: '2026-03-09T00:00:02Z', cwd: '/test' }),
    ].join('\n');
    writeFileSync(join(projectsDir, projectHash, `${sessionId}.jsonl`), jsonlContent);

    const reader = createChatProjectReader({ ccBasePath: tempDir });
    const messages = await reader.readSession(projectHash, sessionId);

    expect(messages).toHaveLength(3);
    // The queue-operation should be classified as 'user', not 'system'
    const queueMsg = messages[2];
    expect(queueMsg.type).toBe('user');
    expect(queueMsg.content).toBe('但是咱们现在的对话又能正常显示了');
  });
});
