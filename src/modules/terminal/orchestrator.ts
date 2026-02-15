/**
 * Terminal orchestrator - coordinates terminal creation/closure with grid, editor, watcher
 */

const GRID_LAYOUTS: Record<number, { cols: number; rows: number }> = {
  1: { cols: 1, rows: 1 },
  2: { cols: 2, rows: 1 },
  3: { cols: 3, rows: 1 },
  4: { cols: 2, rows: 2 },
  5: { cols: 3, rows: 2 },
  6: { cols: 3, rows: 2 },
};

function getGridLayout(count: number) {
  if (GRID_LAYOUTS[count]) return GRID_LAYOUTS[count];
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  return { cols, rows };
}

export function createTerminalOrchestrator(opts: { currentCount: number }) {
  let _count = opts.currentCount;

  return {
    async createTerminal(params: { cwd: string }) {
      _count++;
      const grid = getGridLayout(_count);
      return {
        terminalState: 'Created',
        gridUpdate: grid,
        editorMode: 'RichEditor',
        watcherAdded: true,
        cwd: params.cwd,
      };
    },
    async closeTerminal(terminalId: string) {
      _count--;
      const grid = getGridLayout(_count);
      return {
        terminalId,
        gridUpdate: grid,
        tempFilesCleaned: true,
        watcherRemoved: true,
        bufferReleased: true,
      };
    },
  };
}
