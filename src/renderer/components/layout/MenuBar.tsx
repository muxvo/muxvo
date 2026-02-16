/**
 * MenuBar — 36px top bar with drag region and window controls
 * DEV-PLAN A1: 菜单栏 36px
 * DEV-PLAN B2: 聚焦模式下显示「返回平铺」按钮
 *
 * On macOS with hiddenInset titleBarStyle, the top area serves as
 * a drag region for window movement. Traffic light buttons are
 * positioned by the OS.
 */

import './MenuBar.css';

interface Props {
  viewMode?: 'Tiling' | 'Focused';
  onBackToTiling?: () => void;
}

export function MenuBar({ viewMode = 'Tiling', onBackToTiling }: Props): JSX.Element {
  return (
    <header className="menu-bar">
      <div className="menu-bar-drag-region" />
      {viewMode === 'Focused' && onBackToTiling && (
        <button className="menu-bar-back-btn" onClick={onBackToTiling}>
          ← Tiling
        </button>
      )}
      <span className="menu-bar-title">Muxvo</span>
    </header>
  );
}
