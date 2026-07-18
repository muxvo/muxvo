/**
 * Worktree 浮层 live 组件（specs/behavior/worktree-popover.md §4，v9）。
 * 状态机 loading→ready/error（worktreeStatus 一发合并 legacy detect+preCheck+list）；渲染共享
 * WorktreePopoverView（复刻屏零感知）。
 *
 * 行点击/创建：term.command create{cwd} → await created → ui.action renameSubmit{name:branch} → 关浮层，
 * **全链不发 close**（★用户裁决 2026-07-06：只新开不关旧主终端，回归断言点）。
 * merged ✕：worktreeRemove → 成功重发 worktreeStatus 刷列表（不关浮层）。
 * onFsRequest/onTermRequest 存 ref（桥线缆每快照换引用）；请求令牌丢弃迟到应答（重开竞态防线）。
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type {
  FsRequest,
  FsResponse,
  TermCommandRequest,
  TermCommandResponse,
  UIAction,
  WorktreeEntry,
} from '../../bridge/gen/protocol';
import type { Fixture } from '../../fixture/types';
import { clampToViewport, tileElsById } from '../popover/base';
import { WorktreePopoverView } from '../popover/WorktreePopoverView';

const POPOVER_WIDTH = 280;
const POPOVER_HEIGHT = 200;

/** 量取 terminalId 对应 tile 内 `.tile-worktree-btn` rect（tileElsById 按 ID 锚定，勿用下标；
 *  live 下无 host 包裹，整窗即 host）。命中多个（Focused sidebar 复渲同终端）时取 rect 宽度 > 0
 *  的那个（jsdom gBCR 恒 0 → 回落首个）。 */
function useTileBtnRect(terminalId: string): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    let cancelled = false;
    const measure = (): void => {
      if (cancelled) return;
      const els = tileElsById(terminalId)
        .map((tile) => tile.querySelector('.tile-worktree-btn'))
        .filter((el): el is Element => el !== null);
      if (els.length > 0) {
        const rects = els.map((el) => el.getBoundingClientRect());
        setRect(rects.find((r) => r.width > 0) ?? rects[0]);
      } else {
        requestAnimationFrame(measure);
      }
    };
    requestAnimationFrame(measure);
    return () => {
      cancelled = true;
    };
  }, [terminalId]);
  return rect;
}

export function LiveWorktreePopover({
  terminalId,
  fx,
  onFsRequest,
  onTermRequest,
  onAction,
  onClose,
}: {
  terminalId: string;
  fx: Fixture;
  onFsRequest?: (req: FsRequest) => Promise<FsResponse>;
  onTermRequest?: (req: TermCommandRequest) => Promise<TermCommandResponse>;
  onAction: (action: UIAction) => void;
  onClose: () => void;
}): JSX.Element | null {
  const terminal = fx.terminals.find((t) => t.id === terminalId);
  const cwd = terminal?.cwd ?? '';
  const rect = useTileBtnRect(terminalId);

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [worktrees, setWorktrees] = useState<WorktreeEntry[]>([]);
  const [warning, setWarning] = useState<{ sizeMB: number } | null>(null);
  const [repoPath, setRepoPath] = useState('');
  const [creating, setCreating] = useState(false);

  const onFsRef = useRef(onFsRequest);
  onFsRef.current = onFsRequest;
  const onTermRef = useRef(onTermRequest);
  onTermRef.current = onTermRequest;
  const tokenRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const loadStatus = (): void => {
    const token = ++tokenRef.current;
    setStatus('loading');
    const fn = onFsRef.current;
    if (!fn) {
      setStatus('error');
      setErrorMessage('内部错误：文件桥未接线');
      return;
    }
    void fn({ kind: 'worktreeStatus', cwd })
      .then((resp: FsResponse) => {
        if (token !== tokenRef.current) return; // 迟到应答丢弃
        if (resp.kind === 'worktreeStatus') {
          if (!resp.isRepo) {
            setStatus('error');
            setErrorMessage('Not a git repository');
            return;
          }
          setRepoPath(resp.repoPath ?? cwd);
          setWorktrees(resp.worktrees ?? []);
          setWarning(resp.warning ?? null);
          setStatus('ready');
        } else if (resp.kind === 'rejected') {
          setStatus('error');
          setErrorMessage(resp.message);
        }
      })
      .catch(() => {
        if (token === tokenRef.current) {
          setStatus('error');
          setErrorMessage('worktree 状态获取失败');
        }
      });
  };

  // 打开链路一次往返（cwd 稳定 → 只发一次）
  useEffect(() => {
    loadStatus();
    containerRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd]);

  /** 在给定 cwd 开新终端并命名为 branch → 关浮层（全链不发 close）。 */
  const openTerminalAt = (path: string, branch: string): void => {
    const fn = onTermRef.current;
    if (!fn) {
      setCreating(false);
      setStatus('error');
      setErrorMessage('内部错误：终端桥未接线');
      return;
    }
    void fn({ kind: 'create', cwd: path })
      .then((resp: TermCommandResponse) => {
        if (resp.kind === 'created') {
          onAction({ kind: 'renameSubmit', terminalId: resp.terminalId, name: branch });
          onClose();
        } else if (resp.kind === 'rejected') {
          setCreating(false); // worktree 建成但终端 spawn 失败：解禁创建按钮（对抗验收 MINOR-2）
          setStatus('error');
          setErrorMessage(resp.message);
        } else {
          setCreating(false); // 未知应答态兜底：不静默吞，暴露为可见错误
          setStatus('error');
          setErrorMessage('创建终端失败（未知响应）');
        }
      })
      .catch(() => {
        setCreating(false);
        setStatus('error');
        setErrorMessage('创建终端失败（桥接异常）');
      });
  };

  // §5：有自定义名的 worktree 再开终端，新 tile 直接叫自定义名（renameSubmit 会回写映射，闭环自洽）。
  const onItemClick = (wt: WorktreeEntry): void =>
    openTerminalAt(wt.path, wt.customName ?? wt.branch);

  const onCreate = (): void => {
    const fn = onFsRef.current;
    if (!fn) {
      setStatus('error');
      setErrorMessage('内部错误：文件桥未接线');
      return;
    }
    setCreating(true);
    void fn({ kind: 'worktreeCreate', repoPath })
      .then((resp: FsResponse) => {
        if (resp.kind === 'worktreeCreated') {
          openTerminalAt(resp.worktreePath, resp.branch);
        } else if (resp.kind === 'rejected') {
          setCreating(false);
          setStatus('error');
          setErrorMessage(resp.message); // timeout/大仓特化文案 native 已拼好
        }
      })
      .catch(() => {
        setCreating(false);
        setStatus('error');
        setErrorMessage('创建 worktree 失败（桥接异常）');
      });
  };

  const onDelete = (wt: WorktreeEntry): void => {
    const fn = onFsRef.current;
    if (!fn) return;
    void fn({ kind: 'worktreeRemove', worktreePath: wt.path })
      .then((resp: FsResponse) => {
        if (resp.kind === 'worktreeRemoved') loadStatus(); // 重发刷列表，不关浮层
        else if (resp.kind === 'rejected') {
          setStatus('error');
          setErrorMessage(resp.message);
        }
      })
      .catch(() => {
        setStatus('error');
        setErrorMessage('删除 worktree 失败（桥接异常）');
      });
  };

  if (!terminal || !rect) return null;
  const pos = clampToViewport(
    { top: rect.bottom + 4, left: rect.left },
    POPOVER_WIDTH,
    POPOVER_HEIGHT,
  );

  return createPortal(
    <WorktreePopoverView
      worktrees={worktrees}
      warning={warning}
      terminalCwd={cwd}
      pos={pos}
      status={status}
      errorMessage={errorMessage}
      creating={creating}
      onCreate={onCreate}
      onItemClick={onItemClick}
      onDelete={onDelete}
      onOverlayMouseDown={onClose}
      containerRef={containerRef}
    />,
    document.body,
  );
}
