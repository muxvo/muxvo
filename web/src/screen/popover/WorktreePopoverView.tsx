/**
 * Worktree 浮层纯展示视图（M6 批A 抽取，golden 零像素）。
 * 复刻屏（WorktreePopoverScreen）与 live 组件（LiveWorktreePopover）共用同一份 DOM/CSS，
 * 视觉后续微调只改此一处（wt-list/wt-warning golden 守静态一份，live 份不漂移）。
 *
 * 排序/当前行判定（主置顶+倒序、path 降序长度前缀匹配，spec worktree-popover §3）随视图走。
 * 回调 props 全部可选：未传不挂监听（React 合成事件不产生 DOM 属性）；status/creating 缺省
 * 走 ready 分支 → 复刻屏 DOM 逐字节与抽取前一致。loading/error 走 `.worktree-popover__loading`/
 * `__error`（既有 CSS，复刻屏不传 status 即不可达）。
 */

import type { RefObject } from 'react';

export interface WorktreeInfo {
  path: string;
  branch: string;
  isMain: boolean;
  isMerged: boolean;
  /** F-D2：worktree 目录已被外部删除但 git 仍列出（stale 行）。缺省（复刻屏 fixture 不传）= DOM 零变。 */
  missing?: boolean;
  /** §5：用户给该 worktree 内 session 起的自定义名（持久绑定）。缺省（复刻屏 fixture 不传）= DOM 零变。 */
  customName?: string;
}

interface WorktreePopoverViewProps {
  worktrees: WorktreeInfo[];
  warning: { sizeMB: number } | null;
  /** 归属 tile 的 cwd（当前行判定用） */
  terminalCwd: string;
  pos: { top: number; left: number };
  /** 缺省（复刻屏）= ready，渲染列表；live 数据态机传 loading/error */
  status?: 'loading' | 'ready' | 'error';
  errorMessage?: string;
  creating?: boolean;
  onCreate?: () => void;
  onItemClick?: (wt: WorktreeInfo) => void;
  onDelete?: (wt: WorktreeInfo) => void;
  /** live：点浮层外 overlay 关闭；复刻屏不传（overlay 无 data-hit-island、无监听） */
  onOverlayMouseDown?: () => void;
  /** live：容器聚焦（Esc 落 web）；复刻屏不传 */
  containerRef?: RefObject<HTMLDivElement>;
}

export function WorktreePopoverView({
  worktrees,
  warning,
  terminalCwd,
  pos,
  status,
  errorMessage,
  creating,
  onCreate,
  onItemClick,
  onDelete,
  onOverlayMouseDown,
  containerRef,
}: WorktreePopoverViewProps): JSX.Element {
  // spec §3：主 worktree 置顶，其余按 list 序倒序
  const ordered = [
    ...worktrees.filter((wt) => wt.isMain),
    ...worktrees.filter((wt) => !wt.isMain).reverse(),
  ];
  // spec §3：path 降序长度优先匹配，防主仓前缀吞掉 .worktrees/ 子路径
  const currentWorktree = [...worktrees]
    .sort((a, b) => b.path.length - a.path.length)
    .find((wt) => terminalCwd === wt.path || terminalCwd.startsWith(wt.path + '/'));
  const mainBranch = worktrees.find((wt) => wt.isMain)?.branch || 'main';

  const isReady = status == null || status === 'ready';

  return (
    <div
      className="worktree-popover-overlay"
      data-hit-island={onOverlayMouseDown ? '' : undefined}
      // 仅 mousedown 直落 overlay 背景才关（spec §4）：浮层是本 overlay 的子元素，行/按钮的
      // mousedown 会冒泡至此——不加 target 门则浮层在 click 生成前已卸载，内部点击真机必死
      // （dogfood-r2#4 根因 A；裸 click 派发的测试测不出）。
      onMouseDown={
        onOverlayMouseDown
          ? (e) => {
              if (e.target === e.currentTarget) onOverlayMouseDown();
            }
          : undefined
      }
    >
      <div
        className="worktree-popover"
        style={{ top: pos.top, left: pos.left }}
        ref={containerRef}
        tabIndex={containerRef ? -1 : undefined}
      >
        <div className="worktree-popover__header">Worktrees</div>
        {status === 'loading' && <div className="worktree-popover__loading">Loading...</div>}
        {status === 'error' && <div className="worktree-popover__error">{errorMessage}</div>}
        {isReady && (
          <>
            {warning && (
              <div className="worktree-popover__warning">
                .git {warning.sizeMB} MB — 创建可能较慢，建议清理历史大文件
              </div>
            )}
            <button className="worktree-popover__create" onClick={onCreate} disabled={creating}>
              {creating
                ? warning
                  ? 'Creating…（大仓较慢，请稍候）'
                  : 'Creating…'
                : `+ New Worktree (from ${mainBranch})`}
            </button>
            <div className="worktree-popover__divider" />
            <div className="worktree-popover__list">
              {ordered.map((wt) => {
                const isCurrent = currentWorktree?.path === wt.path;
                return (
                  <button
                    key={wt.path}
                    className={`worktree-popover__item${isCurrent ? ' worktree-popover__item--current' : ''}${wt.missing ? ' worktree-popover__item--missing' : ''}`}
                    title={wt.path}
                    onClick={onItemClick ? () => onItemClick(wt) : undefined}
                  >
                    <span
                      className={`worktree-popover__dot${wt.isMain ? ' worktree-popover__dot--main' : ''}`}
                    />
                    <span className="worktree-popover__branch">
                      {wt.customName ?? wt.branch}
                      {wt.customName != null && (
                        <span className="worktree-popover__branch-code">{wt.branch}</span>
                      )}
                      {wt.missing && '（目录已删除）'}
                    </span>
                    {isCurrent && (
                      <span className="worktree-popover__badge worktree-popover__badge--current">
                        current
                      </span>
                    )}
                    {wt.isMerged && !wt.isMain && (
                      <>
                        <span className="worktree-popover__badge worktree-popover__badge--merged">
                          merged
                        </span>
                        <span
                          className="worktree-popover__delete"
                          title="Delete worktree"
                          role="button"
                          onClick={
                            onDelete
                              ? (e) => {
                                  e.stopPropagation();
                                  onDelete(wt);
                                }
                              : undefined
                          }
                        >
                          &#10005;
                        </span>
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
