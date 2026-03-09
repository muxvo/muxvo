/**
 * VERIFY: WorktreePopover sets branch name as terminal customName
 *
 * Bug: When opening a worktree terminal from WorktreePopover, the terminal
 * showed as "unnamed" even if the branch had been renamed (e.g., wt-1 → feature-x).
 *
 * Fix: handleWorktreeClick and handleCreateWorktree now dispatch RENAME and
 * call terminal.setName after creating the terminal.
 *
 * Test approach: Read the source code and verify the dispatch + IPC calls
 * are present in both functions. This is a structural test, but appropriate
 * here because the fix is purely about adding missing function calls (not
 * about visual rendering or complex data flow).
 */
import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC_FILE = resolve(
  __dirname,
  '../../src/renderer/components/terminal/WorktreePopover.tsx'
);

describe('VERIFY: WorktreePopover auto-names terminals with branch name', () => {
  const source = readFileSync(SRC_FILE, 'utf-8');

  test('handleWorktreeClick dispatches RENAME with wt.branch', () => {
    // Extract handleWorktreeClick function body
    const fnMatch = source.match(
      /const handleWorktreeClick = useCallback\(async \(wt[\s\S]*?\n  \}, \[/
    );
    expect(fnMatch).not.toBeNull();
    const fnBody = fnMatch![0];

    // Must dispatch RENAME with wt.branch
    expect(fnBody).toContain("type: 'RENAME'");
    expect(fnBody).toContain('wt.branch');

    // Must persist via IPC
    expect(fnBody).toContain('terminal.setName');
  });

  test('handleWorktreeClick includes terminalDispatch in deps', () => {
    const depsMatch = source.match(
      /const handleWorktreeClick = useCallback\(async[\s\S]*?\}, \[([^\]]+)\]/
    );
    expect(depsMatch).not.toBeNull();
    expect(depsMatch![1]).toContain('terminalDispatch');
  });

  test('handleCreateWorktree dispatches RENAME with result.data.branch', () => {
    // Extract handleCreateWorktree function body
    const fnMatch = source.match(
      /const handleCreateWorktree = useCallback\(async[\s\S]*?\n  \}, \[/
    );
    expect(fnMatch).not.toBeNull();
    const fnBody = fnMatch![0];

    // Must dispatch RENAME with result.data.branch
    expect(fnBody).toContain("type: 'RENAME'");
    expect(fnBody).toContain('result.data.branch');

    // Must persist via IPC
    expect(fnBody).toContain('terminal.setName');
  });
});
