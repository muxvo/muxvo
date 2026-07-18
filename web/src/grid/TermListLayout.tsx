/**
 * 终端列表模式布局（term-list-mode.md，批B）：flex row = 左终端列表 240px + 右选中终端**真详情**。
 * 小屏适用（平铺挤成多列不好用时经 ⌘⇧L 切入）。
 *
 * - 左栏 `.term-list__nav`（240px 固定、自带不透明背景照 .min-rail 先例）：非收起终端按 order 渲
 *   `MiniTermCard variant='listRow'`（点行 → tileClick 选中）；收起终端入底部「已收起」分组（点卡 →
 *   restoreTile 恢复+选中）。FAB 保留（照 TermGrid 现有 FAB）。
 * - 右详情 `.term-list__detail`（无自有背景——详情内 .tile 由 live-transparent F1 打穿）：选中终端渲
 *   **完整 TermTile**（洞 role=grid、完整 header、真交互）；无选中 → 空态占位。
 *
 * golden 铁律：本组件仅在 fx.viewMode==='List' 时经 TermGrid 早返渲染（List 值不在任何既有 fixture）→
 * 既有 Tiling/Focused 路径与 golden 94 张零触达。截图/纯展示（onAction 未传）交互 inert，同源渲染。
 */

import type { TermCommandRequest, UIAction } from '../bridge/gen/protocol';
import type { Fixture } from '../fixture/types';
import { TermTile } from '../tile/TermTile';
import { MiniTermCard } from '../tile/MiniTermCard';
import { useLiveInteractions } from '../screen/live/LiveInteractions';
import { ViewToggleGhost } from './ViewToggleGhost';

const EMPTY_DETAIL_HINT = '选择左侧终端查看详情';

export function TermListLayout({
  fx,
  onAction,
  onTermCommand,
}: {
  fx: Fixture;
  onAction?: (action: UIAction) => void;
  onTermCommand?: (req: TermCommandRequest) => void;
}): JSX.Element {
  const visible = fx.terminals.filter((t) => !t.minimized);
  const minimized = fx.terminals.filter((t) => !!t.minimized);
  // 详情 = 选中的非收起终端；缺席（全空/全收起/顺延到 nil）→ 空态占位（term-list-mode.md §6）。
  const selected = visible.find((t) => t.id === fx.selectedId) ?? null;

  const onCreate = onTermCommand ? () => onTermCommand({ kind: 'create' }) : undefined;

  return (
    <div className="term-list">
      <div className="term-list__nav">
        <div className="term-list__rows">
          {visible.map((t) => (
            <MiniTermCard
              key={t.id}
              terminal={t}
              variant="listRow"
              selected={fx.selectedId === t.id}
              onClick={onAction ? () => onAction({ kind: 'tileClick', terminalId: t.id }) : undefined}
            />
          ))}
        </div>
        {minimized.length > 0 && (
          <div className="term-list__section">
            <div className="term-list__section-label">已收起</div>
            {minimized.map((t) => (
              <MiniTermCard
                key={t.id}
                terminal={t}
                variant="listRow"
                onClick={
                  onAction ? () => onAction({ kind: 'restoreTile', terminalId: t.id }) : undefined
                }
              />
            ))}
          </div>
        )}
      </div>
      <div className="term-list__detail">
        {selected ? (
          <TermTile
            terminal={selected}
            fx={fx}
            role="grid"
            onAction={onAction}
            onTermCommand={onTermCommand}
          />
        ) : (
          <div className="term-list__empty">{EMPTY_DETAIL_HINT}</div>
        )}
      </div>
      <Fab disabled={fx.maxReached} onCreate={onCreate} />
      <ViewToggleGhost fx={fx} onAction={onAction} />
    </div>
  );
}

/** FAB：新建终端（照 TermGrid 现有 FAB）。live 模式 → requestCreate 直建；否则回落 onCreate（截图/纯展示=undefined 不挂）。
 *  data-hit-island：FAB 浮在详情洞上，穿透岛采集器据此上报 role="island"（否则点击被下层终端吞）。 */
function Fab({ disabled, onCreate }: { disabled: boolean; onCreate?: () => void }): JSX.Element {
  const live = useLiveInteractions();
  const onClick = live ? () => live.requestCreate() : onCreate;
  return (
    <button
      className="terminal-grid__fab"
      data-hit-island=""
      disabled={disabled}
      title="新建终端"
      onClick={onClick}
    >
      +
    </button>
  );
}
