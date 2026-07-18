/**
 * cwd 显示规则（spec §4.3）+ worktree badge 判定（spec §4.2）
 */

/** home 前缀替换为 ~；超过 3 段压缩为 首段/…/末段（保末级目录完整） */
export function shortenPath(path: string, homePath: string, truncate = true): string {
  let short = path;
  if (homePath && homePath !== '/' && path.startsWith(homePath)) {
    short = '~' + path.slice(homePath.length);
  }
  if (truncate) {
    const parts = short.split('/');
    if (parts.length > 3) {
      return parts[0] + '/…/' + parts[parts.length - 1];
    }
  }
  return short;
}

/** cwd 含 /.worktrees/ → 取项目名；fallback：名称匹配 项目/worktree-N */
export function worktreeProject(cwd: string, customName?: string): string | null {
  const marker = '/.worktrees/';
  const idx = cwd.indexOf(marker);
  if (idx >= 0) {
    const projectName = cwd.substring(0, idx).split('/').pop() || '';
    if (projectName) return projectName;
  }
  if (customName) {
    const m = customName.match(/^(.+)\/(worktree-\d+)$/);
    if (m) return m[1];
  }
  return null;
}
