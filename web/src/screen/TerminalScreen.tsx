/**
 * 终端网格屏（探针 3 复刻屏）：网格 + 全局浮层。
 * 纯展示：一个 Fixture 完全决定一帧画面。M3 起接桥线缆（onAction/onTermCommand）：
 * 未传时（截图/纯展示）连监听都不挂，DOM/像素零差异（草案 §6 六道闸）。
 */

import type {
  FsRequest,
  FsResponse,
  TermCommandRequest,
  TermCommandResponse,
  UIAction,
} from '../bridge/gen/protocol';
import type { Fixture } from '../fixture/types';
import { TermGrid } from '../grid/TermGrid';
import { useLayoutReport } from '../grid/useLayoutReport';
import { LiveInteractionLayer } from './live/LiveInteractions';
import { LiveSearchBar } from './search/LiveSearchBar';
import { WaitingCard } from './WaitingCard';

export function TerminalScreen({
  fx,
  onAction,
  onTermCommand,
  onFsRequest,
  onTermRequest,
}: {
  fx: Fixture;
  onAction?: (action: UIAction) => void;
  onTermCommand?: (req: TermCommandRequest) => void;
  /** M6 批A：fs.request（worktree/文件树/右键菜单）+ term.command 带响应版；未传不影响 live 挂载判据。 */
  onFsRequest?: (req: FsRequest) => Promise<FsResponse>;
  onTermRequest?: (req: TermCommandRequest) => Promise<TermCommandResponse>;
}): JSX.Element {
  // 洞元素几何上报（真状态源才有洞；截图无 onAction 零发送）
  useLayoutReport(fx, onAction);

  const content = (
    <div
      style={{
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <TermGrid fx={fx} onAction={onAction} onTermCommand={onTermCommand} />
      {/* 浮卡仅在**截图/纯展示**（onAction 缺席）时随 fixture 直渲，保 golden f8（终端屏+浮卡组合）
          字节冻结。live 模式（onAction 在）终端屏**不显示**——浮卡改由非终端覆盖层的 LiveWaitingCard
          托管（DOGFOOD_M3_18：legacy WaitingInputNotification.tsx L74 overlayActive 门控 + 用户裁决
          2026-07-07；终端屏常驻浮卡遮挡 FAB 是现场缺陷）。 */}
      {!onAction && fx.waitingNotification && (
        <WaitingCard count={fx.waitingNotification.count} />
      )}
      {fx.searchBar && onAction && <LiveSearchBar fx={fx} onAction={onAction} />}
    </div>
  );

  // live 模式（桥接线）才挂交互中间态层（FAB 直建/关闭确认/重命名三态）；
  // 截图/纯展示无 onAction/onTermCommand → 不挂 provider → 深层新交互全 inert（golden 零差异）。
  if (onAction && onTermCommand) {
    return (
      <LiveInteractionLayer
        fx={fx}
        onAction={onAction}
        onTermCommand={onTermCommand}
        onFsRequest={onFsRequest}
        onTermRequest={onTermRequest}
      >
        {content}
      </LiveInteractionLayer>
    );
  }
  return content;
}
