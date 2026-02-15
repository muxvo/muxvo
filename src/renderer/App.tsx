/**
 * Muxvo — Root Application Component
 * DEV-PLAN A1: 主窗口布局（菜单栏 36px + 内容区 + 底部控制栏）
 */

import { MenuBar } from './components/layout/MenuBar';
import { BottomBar } from './components/layout/BottomBar';
import './App.css';

export function App(): JSX.Element {
  return (
    <div className="app">
      <MenuBar />
      <main className="app-content">
        {/* A4: TerminalGrid will be mounted here */}
      </main>
      <BottomBar />
    </div>
  );
}
