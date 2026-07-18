/**
 * 终端内搜索条屏（specs/behavior/terminal-search-bar.md）：
 * terminal-grid 底图 + 目标 tile 内容区右上角搜索条（open-空输入态，input 聚焦）。
 * 挂载几何：量 .tile-terminal rect → body 下 fixed 同矩形包裹层 + relative 满幅内衬
 * （= 生产 xterm 包裹层等价几何，golden 侧同款）。
 */

import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { TerminalScreen } from '../TerminalScreen';
import { baseFixture, useTileElementRect } from './base';
import './popovers.css';

export function SearchBarScreen({ fx }: { fx: any }): JSX.Element {
  const base = baseFixture(fx);
  const hostRef = useRef<HTMLDivElement>(null);
  const tileIndex = base.terminals.findIndex((t) => t.id === fx.searchBar?.terminalId);
  const rect = useTileElementRect(hostRef, tileIndex, '.tile-terminal');

  return (
    <div ref={hostRef} style={{ width: '100%', height: '100%' }}>
      <TerminalScreen fx={base} />
      {rect &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              top: rect.top,
              left: rect.left,
              width: rect.width,
              height: rect.height,
              pointerEvents: 'none',
            }}
          >
            <div style={{ position: 'relative', width: '100%', height: '100%' }}>
              <div className="terminal-search-bar">
                <form onSubmit={(e) => e.preventDefault()}>
                  <input type="text" defaultValue="" placeholder="Search..." autoFocus />
                </form>
                <button title="Previous (Shift+Enter)">&#9650;</button>
                <button title="Next (Enter)">&#9660;</button>
                <button title="Close (Esc)">&#10005;</button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
