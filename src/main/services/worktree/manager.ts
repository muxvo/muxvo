/**
 * Worktree Manager — Git worktree CLI wrapper for parallel development.
 *
 * Factory pattern: createWorktreeManager() → method object.
 * All git operations use child_process.execFile (no libgit2).
 * Designed for direct reuse by future MCP tool handlers.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, appendFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { WorktreeInfo } from '@/shared/types/worktree.types';

const execFileAsync = promisify(execFile);

/** Run a git command in a given directory */
async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, timeout: 15_000 });
  return stdout.trim();
}

/** Parse `git worktree list --porcelain` output into WorktreeInfo[] */
function parseWorktreeList(output: string, repoPath: string): WorktreeInfo[] {
  const worktrees: WorktreeInfo[] = [];
  const blocks = output.split('\n\n').filter(Boolean);

  for (const block of blocks) {
    const lines = block.split('\n');
    let path = '';
    let branch = '';
    let isDetached = false;

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        path = line.slice('worktree '.length);
      } else if (line.startsWith('branch ')) {
        // branch refs/heads/main → main
        branch = line.slice('branch '.length).replace('refs/heads/', '');
      } else if (line === 'detached') {
        isDetached = true;
        branch = '(detached)';
      }
    }

    if (path) {
      worktrees.push({
        path,
        branch: branch || '(unknown)',
        isMain: path === repoPath,
        isMerged: false,
      });
    }
  }

  return worktrees;
}

/** Ensure .worktrees/ is in .gitignore */
async function ensureGitignore(repoPath: string): Promise<void> {
  const gitignorePath = join(repoPath, '.gitignore');
  const entry = '.worktrees/';

  try {
    await access(gitignorePath);
    const content = await readFile(gitignorePath, 'utf-8');
    if (content.includes(entry)) return;
    // Append with newline safety
    const prefix = content.endsWith('\n') ? '' : '\n';
    await appendFile(gitignorePath, `${prefix}${entry}\n`);
  } catch {
    // .gitignore doesn't exist — create it
    await appendFile(gitignorePath, `${entry}\n`);
  }
}

/** Find the next available worktree number */
function nextWorktreeNumber(worktrees: WorktreeInfo[]): number {
  const existing = worktrees
    .map((wt) => wt.branch)
    .filter((b) => /^worktree-\d+$/.test(b))
    .map((b) => parseInt(b.replace('worktree-', ''), 10));

  if (existing.length === 0) return 1;
  return Math.max(...existing) + 1;
}

export function createWorktreeManager() {
  return {
    /**
     * Detect if a path is inside a git repository.
     * Returns the repo root path and current branch if found.
     */
    async detectRepo(
      path: string
    ): Promise<{ isRepo: boolean; repoPath?: string; branch?: string }> {
      try {
        let repoPath = await git(path, ['rev-parse', '--show-toplevel']);
        // --show-toplevel from a worktree returns the worktree root, not the main repo.
        // Use --git-common-dir to resolve the actual main repo path.
        try {
          const gitCommonDir = await git(path, ['rev-parse', '--git-common-dir']);
          const { resolve } = await import('node:path');
          const absGitDir = resolve(path, gitCommonDir);
          const mainRepo = resolve(absGitDir, '..');
          if (mainRepo !== repoPath) {
            repoPath = mainRepo;
          }
        } catch { /* fallback to --show-toplevel result */ }
        let branch: string | undefined;
        try {
          branch = await git(path, ['rev-parse', '--abbrev-ref', 'HEAD']);
        } catch { /* no commits yet — branch unknown */ }
        return { isRepo: true, repoPath, branch };
      } catch {
        return { isRepo: false };
      }
    },

    /**
     * List all worktrees for a repository.
     */
    async list(repoPath: string): Promise<WorktreeInfo[]> {
      try {
        const output = await git(repoPath, ['worktree', 'list', '--porcelain']);
        const worktrees = parseWorktreeList(output, repoPath);

        // Detect which branches have been merged into main
        const mainWt = worktrees.find(wt => wt.isMain);
        if (mainWt) {
          try {
            const merged = await git(repoPath, ['branch', '--merged', mainWt.branch]);
            const mergedBranches = merged.split('\n')
              .map(b => b.replace(/^[*+]?\s+/, '').trim())
              .filter(Boolean);
            for (const wt of worktrees) {
              wt.isMerged = !wt.isMain && mergedBranches.includes(wt.branch);
            }
          } catch { /* ignore — e.g. no commits */ }
        }

        return worktrees;
      } catch {
        return [];
      }
    },

    /**
     * Create a new worktree with auto-incremented naming.
     * Returns the new worktree path and branch name.
     */
    async create(
      repoPath: string
    ): Promise<{ worktreePath: string; branch: string }> {
      // Ensure .worktrees/ is gitignored
      await ensureGitignore(repoPath);

      // Determine next number
      const existing = await this.list(repoPath);
      const num = nextWorktreeNumber(existing);
      const branch = `worktree-${num}`;
      const worktreePath = join(repoPath, '.worktrees', branch);

      // Create the worktree
      await git(repoPath, ['worktree', 'add', '-b', branch, worktreePath]);

      return { worktreePath, branch };
    },

    /**
     * Remove a worktree and its branch.
     * @param force — remove even if there are uncommitted changes
     */
    async remove(worktreePath: string, force?: boolean): Promise<void> {
      // Find the repo root from the worktree
      const repoPath = await git(worktreePath, ['rev-parse', '--show-toplevel']);
      // The worktree's own toplevel is the worktree dir itself.
      // We need the main repo — use commondir.
      let mainRepo: string;
      try {
        const gitDir = await git(worktreePath, [
          'rev-parse',
          '--git-common-dir',
        ]);
        // git-common-dir returns relative or absolute path to the main .git
        const { resolve } = await import('node:path');
        const absGitDir = resolve(worktreePath, gitDir);
        // Main repo is the parent of .git
        mainRepo = resolve(absGitDir, '..');
      } catch {
        mainRepo = repoPath;
      }

      // Get the branch name before removing
      let branch: string | null = null;
      try {
        branch = await git(worktreePath, [
          'rev-parse',
          '--abbrev-ref',
          'HEAD',
        ]);
      } catch {
        // ignore
      }

      // Remove the worktree
      const args = ['worktree', 'remove', worktreePath];
      if (force) args.push('--force');
      await git(mainRepo, args);

      // Delete the branch (only auto-created worktree-N branches)
      if (branch && /^worktree-\d+$/.test(branch)) {
        try {
          await git(mainRepo, ['branch', '-D', branch]);
        } catch {
          // Branch may already be deleted or merged — ignore
        }
      }
    },
  };
}

export type WorktreeManager = ReturnType<typeof createWorktreeManager>;
