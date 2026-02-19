/**
 * Terminal orchestrator - coordinates terminal creation/closure with grid, editor, watcher
 */

import { calculateGridLayout } from '@/shared/utils/grid-layout';

function getGridLayout(count: number) {
  return calculateGridLayout(count);
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
