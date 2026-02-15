/**
 * Focus mode manager for terminal tiling/focused view.
 */

interface FocusModeOpts {
  terminals: string[];
  viewMode: string;
  gridLayout?: {
    cols: number;
    rows: number;
    columnRatios?: number[];
    [key: string]: unknown;
  };
}

interface FocusModeManager {
  viewMode: string;
  focusedTerminal: string;
  selectedTerminal: string;
  layout: { mainWidthPercent: number };
  sidebarTerminals: string[];
  sidebarVisibleCount: number;
  sidebarScrollable: boolean;
  gridLayout: {
    cols: number;
    rows: number;
    columnRatios?: number[];
    [key: string]: unknown;
  };
  doubleClick(terminalId: string): void;
  singleClick(terminalId: string): void;
  clickSidebar(terminalId: string): void;
  handleEsc(opts: { terminalFocused: boolean }): void;
}

export function createFocusModeManager(opts: FocusModeOpts): FocusModeManager {
  const savedGridLayout = opts.gridLayout
    ? { ...opts.gridLayout, columnRatios: opts.gridLayout.columnRatios ? [...opts.gridLayout.columnRatios] : undefined }
    : { cols: 0, rows: 0 };

  const manager: FocusModeManager = {
    viewMode: opts.viewMode,
    focusedTerminal: '',
    selectedTerminal: '',
    layout: { mainWidthPercent: 75 },
    sidebarTerminals: [],
    sidebarVisibleCount: 0,
    sidebarScrollable: false,
    gridLayout: savedGridLayout,

    doubleClick(terminalId: string) {
      manager.viewMode = 'Focused';
      manager.focusedTerminal = terminalId;
      manager.sidebarTerminals = opts.terminals.filter((t) => t !== terminalId);
      const sidebarCount = manager.sidebarTerminals.length;
      manager.sidebarVisibleCount = Math.min(sidebarCount, 3);
      manager.sidebarScrollable = sidebarCount > 3;
    },

    singleClick(terminalId: string) {
      manager.selectedTerminal = terminalId;
    },

    clickSidebar(terminalId: string) {
      if (manager.viewMode !== 'Focused') return;
      const prevFocused = manager.focusedTerminal;
      manager.focusedTerminal = terminalId;
      // Rebuild sidebar: all terminals except the newly focused one
      manager.sidebarTerminals = opts.terminals.filter((t) => t !== terminalId);
      // Ensure previous focused is in sidebar
      if (prevFocused && !manager.sidebarTerminals.includes(prevFocused)) {
        manager.sidebarTerminals.push(prevFocused);
      }
    },

    handleEsc(escOpts: { terminalFocused: boolean }) {
      if (escOpts.terminalFocused) return;
      if (manager.viewMode === 'Focused') {
        manager.viewMode = 'Tiling';
        // Restore grid layout
        if (opts.gridLayout) {
          manager.gridLayout = {
            ...opts.gridLayout,
            columnRatios: opts.gridLayout.columnRatios ? [...opts.gridLayout.columnRatios] : undefined,
          };
        }
      }
    },
  };

  return manager;
}
