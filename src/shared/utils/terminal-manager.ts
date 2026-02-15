const MAX_TERMINALS = 20;

export function createTerminalManager() {
  const terminals: Array<{ cwd: string }> = [];

  return {
    get count() {
      return terminals.length;
    },
    get canCreateNew() {
      return terminals.length < MAX_TERMINALS;
    },
    create(opts: { cwd: string }): { success: boolean; error?: string } {
      if (terminals.length >= MAX_TERMINALS) {
        return { success: false, error: '已达最大终端数' };
      }
      terminals.push({ cwd: opts.cwd });
      return { success: true };
    },
  };
}
