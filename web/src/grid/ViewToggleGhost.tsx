/**
 * 视图切换幽灵钮（列表模式 dogfood 追加 2026-07-12，用户九选一定方案 2·左下角幽灵钮）：
 * 网格区**左下角**，与右下角 FAB（新建终端）对角。低频操作按钮 = 安静低调（平时 opacity .35、
 * 无底色融入背景；悬停显形）。
 *
 * - Tiling：显示 ☰（ListIcon），点击 → 切列表；
 * - List：**同位置**显示 ▦（GridIcon），点击 → 切回平铺（两态同位，肌肉记忆一致）；
 * - Focused：不显示（聚焦有自己的「回到平铺」钮，term-list-mode.md §1）。
 *
 * live-only（照 tile-minimize-btn 先例 `live &&`，useLiveInteractions() 非空才渲）：截图/纯展示
 * 无 LiveInteractionLayer provider → 返回 null → golden 96 张零 diff。data-hit-island：钮浮在终端洞
 * 之上，须照 FAB 先例挂命中岛（useLayoutReport 据此上报 role="island"、native 从穿透区抠掉本钮区，
 * 否则点击穿透到下层 Metal 终端——M6 浮层教训 / dogfood P0）。发同一桥动作 toggleListMode（协议 v30）。
 */

import type { UIAction } from '../bridge/gen/protocol';
import type { Fixture } from '../fixture/types';
import { GridIcon, ListIcon } from '../tile/icons';
import { useLiveInteractions } from '../screen/live/LiveInteractions';
import { HoverTip } from '../tile/HoverTip';

export function ViewToggleGhost({
  fx,
  onAction,
}: {
  fx: Fixture;
  onAction?: (action: UIAction) => void;
}): JSX.Element | null {
  const live = useLiveInteractions();
  // live-only + Focused 不显示（两条门任一不满足即不渲）。
  if (!live || fx.viewMode === 'Focused') return null;
  const isList = fx.viewMode === 'List';
  const label = isList ? '切换到平铺模式' : '切换到列表模式';
  return (
    <HoverTip label={label}>
      <button
        className="view-toggle-ghost"
        data-hit-island=""
        title={label}
        onClick={() => onAction?.({ kind: 'toggleListMode' })}
      >
        {isList ? <GridIcon /> : <ListIcon />}
      </button>
    </HoverTip>
  );
}
