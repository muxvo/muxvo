/**
 * BottomBar — Bottom control bar for terminal management
 * DEV-PLAN A1: 底部控制栏
 *
 * Will show: terminal count, active terminal indicator, new terminal button
 * Full implementation comes with A2 (node-pty) and A4 (grid layout)
 */

import './BottomBar.css';

export function BottomBar(): JSX.Element {
  return (
    <footer className="bottom-bar">
      <span className="bottom-bar-info">No terminals</span>
    </footer>
  );
}
