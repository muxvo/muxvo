/**
 * File Viewer Layout
 *
 * Computes left panel layout based on terminal count.
 */

export interface LeftPanelLayout {
  display: string;
  visible: number;
  overflow: string;
}

export function getLeftPanelLayout(terminalCount: number): LeftPanelLayout {
  if (terminalCount <= 3) {
    return {
      display: `${terminalCount} terminals equally split`,
      visible: terminalCount,
      overflow: 'none',
    };
  }

  return {
    display: `${terminalCount} terminals, 3 visible`,
    visible: 3,
    overflow: 'scrollable',
  };
}
