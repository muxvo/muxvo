export const terminalHandlers = {
  async create(_event: unknown, opts?: { cwd?: string }) {
    return {
      success: true,
      data: { id: `term-${Date.now()}`, cwd: opts?.cwd ?? process.cwd() },
    };
  },
};
