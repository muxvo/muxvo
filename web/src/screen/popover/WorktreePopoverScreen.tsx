/**
 * Worktree 浮层屏（specs/behavior/worktree-popover.md）：
 * terminal-grid 底图 + 锚在目标 tile 的 .tile-worktree-btn 下方的 280px 浮层。
 * M6 批A 起 DOM 抽进 WorktreePopoverView（复刻屏与 live 组件共用）；本屏仅剩 baseFixture +
 * rect 量取 + 传参（status/creating/回调全不传 → View 走 ready 分支，DOM 逐字节不变）。
 */

import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { TerminalScreen } from '../TerminalScreen';
import { baseFixture, clampToViewport, useTileElementRect } from './base';
import { WorktreePopoverView, type WorktreeInfo } from './WorktreePopoverView';
import './popovers.css';

const POPOVER_WIDTH = 280;
const POPOVER_HEIGHT = 200; // 估高（legacy 同值，仅用于下溢翻转）

export function WorktreePopoverScreen({ fx }: { fx: any }): JSX.Element {
  const base = baseFixture(fx);
  const hostRef = useRef<HTMLDivElement>(null);
  const tileIndex = base.terminals.findIndex((t) => t.id === fx.worktree?.terminalId);
  const terminalCwd = base.terminals[tileIndex]?.cwd ?? '';
  const rect = useTileElementRect(hostRef, tileIndex, '.tile-worktree-btn');

  const worktrees: WorktreeInfo[] = fx.worktree?.worktrees ?? [];
  const warning: { sizeMB: number } | null = fx.worktree?.warning ?? null;

  const pos = rect
    ? clampToViewport({ top: rect.bottom + 4, left: rect.left }, POPOVER_WIDTH, POPOVER_HEIGHT)
    : null;

  return (
    <div ref={hostRef} style={{ width: '100%', height: '100%' }}>
      <TerminalScreen fx={base} />
      {pos &&
        createPortal(
          <WorktreePopoverView
            worktrees={worktrees}
            warning={warning}
            terminalCwd={terminalCwd}
            pos={pos}
          />,
          document.body,
        )}
    </div>
  );
}
