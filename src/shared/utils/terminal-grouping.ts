export function createTerminalGroupManager() {
  const order: string[] = [];
  const cwdMap = new Map<string, string>(); // id -> cwd

  function findGroupInsertIndex(cwd: string, excludeId?: string): number {
    // Find the last terminal with the same cwd
    let lastIndex = -1;
    for (let i = 0; i < order.length; i++) {
      if (order[i] !== excludeId && cwdMap.get(order[i]) === cwd) {
        lastIndex = i;
      }
    }
    return lastIndex;
  }

  return {
    addTerminal(opts: { id: string; cwd: string }) {
      cwdMap.set(opts.id, opts.cwd);

      const groupIndex = findGroupInsertIndex(opts.cwd, opts.id);
      if (groupIndex >= 0) {
        // Insert right after the last terminal with same cwd
        order.splice(groupIndex + 1, 0, opts.id);
      } else {
        // No group found, append to end
        order.push(opts.id);
      }

      return { index: order.indexOf(opts.id) };
    },

    updateCwd(id: string, newCwd: string) {
      cwdMap.set(id, newCwd);

      // Remove from current position
      const currentIndex = order.indexOf(id);
      if (currentIndex >= 0) {
        order.splice(currentIndex, 1);
      }

      // Re-insert near group
      const groupIndex = findGroupInsertIndex(newCwd, id);
      if (groupIndex >= 0) {
        order.splice(groupIndex + 1, 0, id);
      } else {
        order.push(id);
      }
    },

    getOrder(): string[] {
      return [...order];
    },
  };
}
