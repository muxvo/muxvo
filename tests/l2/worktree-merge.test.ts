/**
 * VERIFY: Worktree projects merge into parent project
 *
 * Bug: getParentProjectHash() searched for '-.worktrees-' (with literal dot)
 * but encodeProjectHash() replaces '.' with '-', so the actual hash contains
 * '--worktrees-' (double dash). Detection never matched.
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { join } from 'path';
import { promises as fsp } from 'fs';

// We test through the public API of createChatProjectReader
// by creating a temp directory structure that mimics ~/.claude/projects/
describe('VERIFY: Worktree project merging', () => {
  let tmpDir: string;
  const parentHash = '-Users-rl-projects-muxvo';
  const worktreeHash = '-Users-rl-projects-muxvo--worktrees-wt-1';
  const worktreeHash2 = '-Users-rl-projects-muxvo--worktrees-worktree-10';

  beforeEach(async () => {
    // Create temp directory structure
    tmpDir = join('/tmp', `auto-verify-wt-${Date.now()}`);
    const projectsDir = join(tmpDir, 'projects');

    // Parent project with 1 session
    const parentDir = join(projectsDir, parentHash);
    await fsp.mkdir(parentDir, { recursive: true });
    await fsp.writeFile(
      join(parentDir, 'aaaa-1111.jsonl'),
      JSON.stringify({ type: 'summary', cwd: '/Users/rl/projects/muxvo' }) + '\n' +
      JSON.stringify({ type: 'user', message: { content: 'hello from main' } }) + '\n'
    );

    // Worktree 1 with 1 session
    const wt1Dir = join(projectsDir, worktreeHash);
    await fsp.mkdir(wt1Dir, { recursive: true });
    await fsp.writeFile(
      join(wt1Dir, 'bbbb-2222.jsonl'),
      JSON.stringify({ type: 'summary', cwd: '/Users/rl/projects/muxvo/.worktrees/wt-1' }) + '\n' +
      JSON.stringify({ type: 'user', message: { content: 'hello from wt-1' } }) + '\n'
    );

    // Worktree 2 with 1 session
    const wt2Dir = join(projectsDir, worktreeHash2);
    await fsp.mkdir(wt2Dir, { recursive: true });
    await fsp.writeFile(
      join(wt2Dir, 'cccc-3333.jsonl'),
      JSON.stringify({ type: 'summary', cwd: '/Users/rl/projects/muxvo/.worktrees/worktree-10' }) + '\n' +
      JSON.stringify({ type: 'user', message: { content: 'hello from worktree-10' } }) + '\n'
    );
  });

  test('worktree projects are merged into parent, not shown separately', async () => {
    const { createChatProjectReader } = await import(
      '@/main/services/chat-dual-source'
    );
    const reader = createChatProjectReader({
      ccBasePath: tmpDir,
    });

    const projects = await reader.getProjects();

    // Should have only 1 project (parent), not 3
    const muxvoProjects = projects.filter(p => p.projectHash === parentHash);
    expect(muxvoProjects).toHaveLength(1);

    // Worktree hashes should NOT appear as separate projects
    const wtProjects = projects.filter(
      p => p.projectHash === worktreeHash || p.projectHash === worktreeHash2
    );
    expect(wtProjects).toHaveLength(0);

    // Parent should have merged session count: 1 (parent) + 1 (wt-1) + 1 (worktree-10)
    expect(muxvoProjects[0].sessionCount).toBe(3);
  });

  test('sessions from worktrees have worktreeLabel set', async () => {
    const { createChatProjectReader } = await import(
      '@/main/services/chat-dual-source'
    );
    const reader = createChatProjectReader({
      ccBasePath: tmpDir,
    });

    // First call getProjects to build worktreeMap
    await reader.getProjects();

    const sessions = await reader.getSessionsForProject(parentHash, 50);

    // Should have 3 sessions total
    expect(sessions).toHaveLength(3);

    // Find worktree sessions
    const wt1Session = sessions.find(s => s.sessionId === 'bbbb-2222');
    const wt10Session = sessions.find(s => s.sessionId === 'cccc-3333');
    const mainSession = sessions.find(s => s.sessionId === 'aaaa-1111');

    expect(wt1Session).toBeDefined();
    expect(wt1Session!.worktreeLabel).toBe('wt-1');

    expect(wt10Session).toBeDefined();
    expect(wt10Session!.worktreeLabel).toBe('worktree-10');

    // Main session should NOT have worktreeLabel
    expect(mainSession).toBeDefined();
    expect(mainSession!.worktreeLabel).toBeUndefined();
  });

  test('getAllRecentSessions remaps worktree projectHash to parent', async () => {
    const { createChatProjectReader } = await import(
      '@/main/services/chat-dual-source'
    );
    const reader = createChatProjectReader({
      ccBasePath: tmpDir,
    });

    const sessions = await reader.getAllRecentSessions(50);

    // All sessions should have the parent projectHash, not worktree hashes
    for (const s of sessions) {
      expect(s.projectHash).toBe(parentHash);
    }

    // Worktree sessions should have labels
    const wt1 = sessions.find(s => s.sessionId === 'bbbb-2222');
    expect(wt1?.worktreeLabel).toBe('wt-1');

    const wt10 = sessions.find(s => s.sessionId === 'cccc-3333');
    expect(wt10?.worktreeLabel).toBe('worktree-10');
  });
});
