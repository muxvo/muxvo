/**
 * VERIFY: search() 返回的 projectHash 应归一化为 parent hash
 *
 * Bug: search() 用 dir.name 原始值作为 projectHash，worktree 目录名
 * (如 -Users-rl-proj--worktrees-wt-5) 不会归一化到 parent hash，
 * 导致前端 projectFilteredResults 过滤掉所有结果，会话列表显示"无匹配会话"。
 */
import { describe, test, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('VERIFY-search-worktree-hash', () => {
  test('search() should normalize worktree projectHash to parent hash', async () => {
    // Setup: create a temp dir structure simulating worktree project
    const base = mkdtempSync(join(tmpdir(), 'chat-search-wt-'));
    const projectsDir = join(base, 'projects');

    // Worktree directory name (contains --worktrees- marker)
    const worktreeHash = '-Users-rl-proj--worktrees-wt-5';
    const parentHash = '-Users-rl-proj';
    const worktreePath = join(projectsDir, worktreeHash);
    mkdirSync(worktreePath, { recursive: true });

    // Write a session JSONL file with searchable content
    const sessionId = 'test-session-001';
    const jsonlContent = JSON.stringify({
      type: 'user',
      message: { content: '请帮我保存这个文件' },
      timestamp: '2026-03-09T10:00:00Z',
    });
    writeFileSync(join(worktreePath, `${sessionId}.jsonl`), jsonlContent + '\n');

    // Import and create reader
    const { createChatProjectReader } = await import('@/main/services/chat-dual-source');
    const reader = createChatProjectReader({ ccBasePath: base });

    // Search for the content
    const results = await reader.search('保存');

    // Should find the session
    expect(results.length).toBeGreaterThanOrEqual(1);

    // The projectHash should be the PARENT hash, not the worktree hash
    const match = results.find(r => r.sessionId === sessionId);
    expect(match).toBeDefined();
    expect(match!.projectHash).toBe(parentHash);
    // Must NOT be the raw worktree hash
    expect(match!.projectHash).not.toContain('--worktrees-');
  });
});
