/**
 * MenuBar — 36px top bar with drag region and window controls
 * DEV-PLAN A1: 菜单栏 36px
 *
 * On macOS with hiddenInset titleBarStyle, the top area serves as
 * a drag region for window movement. Traffic light buttons are
 * positioned by the OS.
 */

import './MenuBar.css';

export function MenuBar(): JSX.Element {
  return (
    <header className="menu-bar">
      <div className="menu-bar-drag-region" />
      <span className="menu-bar-title">Muxvo</span>
    </header>
  );
}
