/** Git Worktree types for Muxvo parallel development */

export interface WorktreeInfo {
  /** Absolute path to the worktree directory */
  path: string;
  /** Git branch checked out in this worktree */
  branch: string;
  /** Whether this is the main/primary worktree */
  isMain: boolean;
}
