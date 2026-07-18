/**
 * 工作目录选择浮层屏（specs/behavior/cwd-picker.md）：
 * terminal-grid 底图 + 锚在目标 tile 的 .tile-cwd 下方（rect.bottom+4 / rect.left）的
 * 320px 浮层（portal 到 body，含全屏透明 overlay）。
 */

import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { TerminalScreen } from '../TerminalScreen';
import { baseFixture, clampToViewport, useTileElementRect } from './base';
import './popovers.css';

const PICKER_WIDTH = 320;
const PICKER_HEIGHT = 280; // 估高（legacy 同值，仅用于下溢翻转）

const QUICK_PATH_LABELS = ['~ (Home)', '~/Desktop', '~/Documents'];

export function CwdPickerScreen({ fx }: { fx: any }): JSX.Element {
  const base = baseFixture(fx);
  const hostRef = useRef<HTMLDivElement>(null);
  const tileIndex = base.terminals.findIndex((t) => t.id === fx.cwdPicker?.terminalId);
  const currentCwd = base.terminals[tileIndex]?.cwd ?? '';
  const rect = useTileElementRect(hostRef, tileIndex, '.tile-cwd');

  const pos = rect
    ? clampToViewport({ top: rect.bottom + 4, left: rect.left }, PICKER_WIDTH, PICKER_HEIGHT)
    : null;

  return (
    <div ref={hostRef} style={{ width: '100%', height: '100%' }}>
      <TerminalScreen fx={base} />
      {pos &&
        createPortal(
          <div className="cwd-picker-portal-overlay">
            <div className="cwd-picker" style={{ top: pos.top, left: pos.left }}>
              <div className="cwd-picker-header">切换工作目录</div>
              <div className="cwd-picker-current">
                当前: <span className="cwd-picker-current-path">{currentCwd}</span>
              </div>
              <div className="cwd-picker-quick">
                <div className="cwd-picker-section-title">快捷路径</div>
                {QUICK_PATH_LABELS.map((label) => (
                  <button key={label} className="cwd-picker-item">
                    {label}
                  </button>
                ))}
              </div>
              <div className="cwd-picker-browse">
                <button className="cwd-picker-browse-btn">浏览...</button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
