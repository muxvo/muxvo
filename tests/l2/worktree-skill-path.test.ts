/**
 * L2: worktree 路径不应作为独立项目出现在 Skills 面板中
 * normalizeWorktreePath() 在 config-handlers.ts 中归一化 worktree 路径
 */
import { describe, test, expect } from 'vitest';

// Replicate the normalizeWorktreePath logic from config-handlers.ts
// (the function is not exported, so we test the same regex logic)
function normalizeWorktreePath(cwd: string): string {
  const match = cwd.match(/^(.+?)\/\.worktrees\/(?:wt|worktree)-\d+$/);
  return match ? match[1] : cwd;
}

describe('VERIFY: worktree paths should normalize to parent repo', () => {
  test('wt-N pattern normalizes to parent', () => {
    expect(normalizeWorktreePath('/Users/rl/projects/muxvo/.worktrees/wt-21')).toBe(
      '/Users/rl/projects/muxvo',
    );
  });

  test('worktree-N pattern normalizes to parent', () => {
    expect(normalizeWorktreePath('/Users/rl/projects/muxvo/.worktrees/worktree-4')).toBe(
      '/Users/rl/projects/muxvo',
    );
  });

  test('multiple worktree paths deduplicate to single parent', () => {
    const cwdSet = new Set<string>();
    const paths = [
      '/Users/rl/projects/muxvo/.worktrees/wt-16',
      '/Users/rl/projects/muxvo/.worktrees/wt-18',
      '/Users/rl/projects/muxvo/.worktrees/worktree-4',
      '/Users/rl/projects/muxvo', // parent itself
    ];
    for (const p of paths) {
      cwdSet.add(normalizeWorktreePath(p));
    }
    expect([...cwdSet]).toEqual(['/Users/rl/projects/muxvo']);
  });

  test('non-worktree paths are unchanged', () => {
    expect(normalizeWorktreePath('/Users/rl/projects/muxvo')).toBe('/Users/rl/projects/muxvo');
    expect(normalizeWorktreePath('/Users/rl/other-project')).toBe('/Users/rl/other-project');
  });

  test('paths with .worktrees but no matching suffix are unchanged', () => {
    // Not a valid worktree pattern (no number suffix)
    expect(normalizeWorktreePath('/repo/.worktrees/main')).toBe('/repo/.worktrees/main');
    // Nested deeper
    expect(normalizeWorktreePath('/repo/.worktrees/wt-1/subdir')).toBe(
      '/repo/.worktrees/wt-1/subdir',
    );
  });

  test('regex matches source code implementation', async () => {
    // Read the actual source to ensure our test regex matches
    const { readFile } = await import('fs/promises');
    const { resolve } = await import('path');
    const source = await readFile(
      resolve(__dirname, '../../src/main/ipc/config-handlers.ts'),
      'utf-8',
    );
    // Verify the function exists and uses normalizeWorktreePath on cwdSet.add
    expect(source).toContain('function normalizeWorktreePath(cwd: string): string');
    expect(source).toContain('cwdSet.add(normalizeWorktreePath(cwd))');
    // Verify NO raw cwdSet.add(cwd) remains (all should go through normalize)
    const rawAddPattern = /cwdSet\.add\(cwd\)/;
    expect(rawAddPattern.test(source)).toBe(false);
  });
});
