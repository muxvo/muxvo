/**
 * Tile Header（spec §4）：[状态点] [worktree badge?] [cwd · 名称区] [waiting badge?] [按钮组]
 * 纯展示：命名三态/按钮组由 fixture 决定，无交互逻辑。
 */

import type { TermCommandRequest, UIAction } from '../bridge/gen/protocol';
import type { TerminalFixture } from '../fixture/types';
import { shortenPath, worktreeProject } from './path-display';
import { FolderIcon, MaximizeIcon, MinimizeIcon, BranchIcon, SmallBranchIcon, GridIcon, CloseIcon } from './icons';
import { useLiveInteractions } from '../screen/live/LiveInteractions';
import { flyToRail } from '../grid/minimizeFlyGhost';
import { HoverTip } from './HoverTip';
import { statusClass } from './status';

const NAME_PLACEHOLDER = '命名...';

interface Props {
  terminal: TerminalFixture;
  homePath: string;
  compact?: boolean;
  focused?: boolean;
  /** 编辑中输入框的值；null = 非编辑态 */
  editingValue?: string | null;
  /** sidebar compact 头部才有「切换为主屏」按钮 */
  showSidebarSwitch?: boolean;
  draggable?: boolean;
  /** 桥线缆（maximizeTile/restoreTiling/renameSubmit）。未传不挂监听——纯展示 DOM 零差异 */
  onAction?: (action: UIAction) => void;
  /** term.command 线缆（close #4）。未传不挂监听。 */
  onTermCommand?: (req: TermCommandRequest) => void;
}

// 状态三桶挪独立叶子模块 status.ts（断 FileTabBar→TileHeader→LiveInteractions import 环，
// 对抗验收 MINOR-1）；此处 re-export 保既有消费者（MiniTermCard 等）import 路径兼容。
export { statusClass, statusKind } from './status';

export function TileHeader({
  terminal,
  homePath,
  compact,
  focused,
  editingValue = null,
  showSidebarSwitch,
  draggable,
  onAction,
  onTermCommand,
}: Props): JSX.Element {
  const live = useLiveInteractions();
  const named = !!terminal.customName;
  // 终态 tile（Stopped/Disconnected/Failed）：关闭钮 = 移除，不再确认（尾批 item 4，照 legacy dead-tile
  // dismiss）——native 收 close 命令时据终端态改走 REMOVE。活会话仍走确认对话框。
  const removable =
    terminal.state === 'Stopped' ||
    terminal.state === 'Disconnected' ||
    terminal.state === 'Failed';
  // 关闭中（Stopping，用户主动关闭 ~2s 窗口，DOGFOOD_M3_09）：✕ 禁用防误点——消解「Stopping 期
  // 二次 ✕ 又弹确认 / 连点落 backdrop 一闪即关」连点陷阱。仅 live 模式判定（截图/纯展示恒 false）。
  const stopping = !!live && terminal.state === 'Stopping';
  // live 模式：活会话关闭走确认对话框（bridge 草案 §2.0 dogfood 基线「关闭含确认」），终态直接移除，
  // 关闭中禁用（onClose=undefined）；非 live（截图/纯展示）回落直接 close 或 inert。
  const onClose = live
    ? stopping
      ? undefined
      : removable && onTermCommand
        ? () => onTermCommand({ kind: 'close', terminalId: terminal.id })
        : () => live.requestClose(terminal.id)
    : onTermCommand
      ? () => onTermCommand({ kind: 'close', terminalId: terminal.id })
      : undefined;
  // 重命名三态：live 模式下单击名称区进编辑（spec term-grid §4.4「点击进入编辑」，DOGFOOD_M3_15）；
  // 编辑值/提交/取消由 context 持有（本地瞬时态，不过桥直到提交）。
  const liveEditing = !!live && live.editingId === terminal.id;
  const showEditingInput = liveEditing || editingValue !== null;
  const inputValue = liveEditing ? live!.editingValue : editingValue ?? '';
  const onMaximize = onAction
    ? () => onAction({ kind: 'maximizeTile', terminalId: terminal.id })
    : undefined;
  const onRestoreTiling = onAction ? () => onAction({ kind: 'restoreTiling' }) : undefined;
  const project =
    terminal.worktreeRegistered !== false
      ? worktreeProject(terminal.cwd, terminal.customName)
      : null;

  return (
    <div className="tile-header" draggable={draggable}>
      <span className={`tile-status ${statusClass(terminal.state)}`} />

      {project && (
        <span className="tile-worktree-badge">
          <SmallBranchIcon />
          {project}
        </span>
      )}

      <div className="tile-name">
        <span className="tile-cwd" title={shortenPath(terminal.cwd, homePath, false)}>
          {shortenPath(terminal.cwd, homePath)}
        </span>

        {compact ? (
          named && (
            <>
              <span className="tile-separator">·</span>
              <span className="tile-custom-name">{terminal.customName}</span>
            </>
          )
        ) : showEditingInput ? (
          <>
            <span className="tile-separator">·</span>
            <input
              type="text"
              className="tile-custom-name-input"
              value={inputValue}
              onChange={
                liveEditing ? (e) => live!.onEditingChange(e.target.value) : () => {}
              }
              onKeyDown={
                liveEditing
                  ? (e) => {
                      if (e.key === 'Enter') live!.submitRename();
                      else if (e.key === 'Escape') live!.cancelRename();
                    }
                  : onAction
                    ? (e) => {
                        if (e.key === 'Enter') {
                          onAction({
                            kind: 'renameSubmit',
                            terminalId: terminal.id,
                            name: (e.target as HTMLInputElement).value,
                          });
                        }
                      }
                    : undefined
              }
              onBlur={liveEditing ? () => live!.submitRename() : undefined}
              autoFocus
            />
          </>
        ) : (
          <span
            className="tile-name-clickable"
            onClick={
              live
                ? (e) => {
                    // stopPropagation：不冒泡到 TermTile 的 tileClick（单击进编辑不选中 tile，
                    // legacy useNaming 同型；DOGFOOD_M3_15）。
                    e.stopPropagation();
                    live.beginRename(terminal.id);
                  }
                : undefined
            }
          >
            <span className="tile-separator">·</span>
            {named ? (
              <span className="tile-custom-name">{terminal.customName}</span>
            ) : (
              <span className="tile-custom-name tile-custom-name--placeholder">
                {NAME_PLACEHOLDER}
              </span>
            )}
          </span>
        )}
      </div>

      {terminal.state === 'WaitingInput' && <span className="tile-waiting-badge">1</span>}

      {/* 死 tile「已停止」标签（DOGFOOD_M3_09，仅 live；自退路径可达——用户关闭已单帧移除）。
          补足此前「死 tile 视觉几乎不变、用户以为没关掉」的观感缺口。 */}
      {live && removable && <span className="tile-dead-badge">已停止</span>}

      {compact ? (
        <>
          {showSidebarSwitch && (
            <HoverTip label="切换为主屏">
              <button className="tile-max-btn" title="切换为主屏" onClick={onMaximize}>
                <MaximizeIcon />
              </button>
            </HoverTip>
          )}
          <HoverTip label="关闭终端">
            <button
              className={`tile-close-btn${stopping ? ' tile-close-btn--disabled' : ''}`}
              title="关闭终端"
              onClick={onClose}
              disabled={stopping}
            >
              <CloseIcon />
            </button>
          </HoverTip>
        </>
      ) : (
        <>
          {terminal.isGitRepo && (
            <HoverTip label="Worktree">
              <button
                className="tile-worktree-btn"
                title="Worktree"
                onClick={
                  live
                    ? (e) => {
                        // stopPropagation：不冒泡成 tileClick（选中 tile），rename 先例同款；legacy 亦 stopPropagation。
                        e.stopPropagation();
                        live.openWorktree(terminal.id);
                      }
                    : undefined
                }
              >
                <BranchIcon />
              </button>
            </HoverTip>
          )}
          <HoverTip label="文件">
            <button
              className="tile-file-btn"
              title="文件"
              onClick={
                live
                  ? (e) => {
                      e.stopPropagation();
                      live.openFilePanel(terminal.id);
                    }
                  : undefined
              }
              onContextMenu={
                live
                  ? (e) => {
                      // tile 头文件按钮右键（REQ-034）→ fileMenu(cwd, isDirectory=true)
                      e.preventDefault();
                      e.stopPropagation();
                      live.fileMenuForCwd(terminal.id, e.clientX, e.clientY);
                    }
                  : undefined
              }
            >
              <FolderIcon />
            </button>
          </HoverTip>
          {focused ? (
            <HoverTip label="回到平铺">
              <button className="tile-tiling-btn" title="回到平铺" onClick={onRestoreTiling}>
                <GridIcon />
              </button>
            </HoverTip>
          ) : (
            <HoverTip label="放大此终端">
              <button className="tile-max-btn" title="放大此终端" onClick={onMaximize}>
                <MaximizeIcon />
              </button>
            </HoverTip>
          )}
          {/* 收起（term-grid §11.2，仅 live 渲染——照 tile-dead-badge 先例，fixture 屏零渲染，
              golden 91 张零动）：位置=聚焦（最大化）右侧、关闭左侧（用户指定 2026-07-11）；
              图标 ▁（macOS 最小化语义）。stopPropagation 不冒泡成 tileClick；发 minimizeTile。
              飞行动画（dogfood-r6 反馈①）：先取该 tile rect → 幽灵框飞向左侧收纳点（纯装饰、
              不阻塞真实收起，reduced-motion 自动豁免，见 minimizeFlyGhost.ts）。 */}
          {live && (
            <HoverTip label="收起到左侧边栏">
              <button
                className="tile-minimize-btn"
                title="收起到左侧边栏"
                onClick={(e) => {
                  e.stopPropagation();
                  const tileEl = (e.currentTarget as HTMLElement).closest('.tile');
                  if (tileEl) flyToRail(tileEl.getBoundingClientRect(), terminal.id);
                  onAction?.({ kind: 'minimizeTile', terminalId: terminal.id });
                }}
              >
                <MinimizeIcon />
              </button>
            </HoverTip>
          )}
          <HoverTip label="关闭终端">
            <button
              className={`tile-close-btn${stopping ? ' tile-close-btn--disabled' : ''}`}
              title="关闭终端"
              onClick={onClose}
              disabled={stopping}
            >
              <CloseIcon />
            </button>
          </HoverTip>
        </>
      )}
    </div>
  );
}
