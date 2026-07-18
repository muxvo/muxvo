/**
 * 终端 Tile 网格（spec §1/§2/§5）：
 * - Tiling：N≤3 单 Grid；N≥4 外层 flex column + 每行独立 Grid（行内等分）
 * - Focused：CSS overlay 不卸载任何 tile —— focused tile 绝对定位铺 75%，
 *   其余 0×0 隐藏；右侧 25% sidebar（compact tile，每屏最多 3 个可滚动）
 * - ResizeHandle（透明，Focused 隐藏）、FAB、空状态
 *
 * M3 批5③：bridge 模式接拖拽重排 + 分隔条拖动（交互全 web 本地，drop/释放才过桥）。
 * 截图/纯展示（onAction 未传）时交互 hook 全 inert，比例/顺序/拖拽态均回落 fixture，
 * DOM/像素与 M2 逐字节一致（草案 §6 六道闸）。
 */

import type { CSSProperties, DragEvent as ReactDragEvent } from 'react';
import type { TermCommandRequest, UIAction } from '../bridge/gen/protocol';
import type { Fixture, TerminalFixture } from '../fixture/types';
import { rowDistribution, splitRows, handlePositions } from './layout';
import { cumulativePercents, ratiosForShape, toFrTemplate } from './gridInteractions';
import { useGridInteractions } from './useGridInteractions';
import { TermTile } from '../tile/TermTile';
import { MinimizedRail } from './MinimizedRail';
import { TermListLayout } from './TermListLayout';
import { ViewToggleGhost } from './ViewToggleGhost';
import { useLiveInteractions } from '../screen/live/LiveInteractions';
import { DragIsland } from '../screen/live/DragIsland';
import { useConfig } from '../config/ConfigContext';

const MAX_SIDEBAR_VISIBLE = 3;
const EMPTY_HINT = '暂无终端，点击 + 新建';
const ALL_MINIMIZED_HINT = '全部终端已收起';

export function TermGrid({
  fx,
  onAction,
  onTermCommand,
}: {
  fx: Fixture;
  onAction?: (action: UIAction) => void;
  onTermCommand?: (req: TermCommandRequest) => void;
}): JSX.Element {
  // 交互 hook 必须无条件先于任何 early-return 调用（hooks 规则）。onAction 未传 → 全 inert。
  const gi = useGridInteractions(fx, onAction);
  // live 持久化 gridLayout 回读（M6 批1）：截图/无桥模式无 ConfigProvider → null → 回落均分（golden 安全）。
  const cfg = useConfig();

  // 列表模式（term-list-mode.md，批B）：早返左终端列表 + 右选中终端真详情布局。**置于 Focused/Tiling
  // 分支之前、且不改动既有路径一个字节**（List 值不在任何既有 fixture → golden 94 张零 diff）。上方
  // hooks（gi/cfg）已无条件先于本返回执行，React hooks 规则不破。
  if (fx.viewMode === 'List') {
    return <TermListLayout fx={fx} onAction={onAction} onTermCommand={onTermCommand} />;
  }

  // 本地乐观顺序（drop 后、快照回流前）；否则用 fixture 顺序。缺 id / 数目不符 → 回落，防瞬时空洞。
  const byId = new Map(fx.terminals.map((t) => [t.id, t] as const));
  const terminals: TerminalFixture[] =
    gi.order && gi.order.length === fx.terminals.length && gi.order.every((id) => byId.has(id))
      ? gi.order.map((id) => byId.get(id)!)
      : fx.terminals;

  // 收起二分（term-grid §11）：收起终端不进网格（不渲洞、不占布局），仅入左侧缩略边栏；order 保序
  // （收起不动 order，filter 保相对序）。**无收起时 visible ≡ terminals（同序同元素）→ 渲染路径逐字节不变**。
  const minimized = terminals.filter((t) => !!t.minimized);
  const visible = terminals.filter((t) => !t.minimized);

  // 有效拖拽态：本地态优先（bridge 拖拽中），否则 fixture（截图 F5 静态态）。
  const effDragging = gi.draggingId ?? fx.dragging;
  const effDragOver = gi.dragOverId ?? fx.dragOver;

  // FAB 新建：cwd 缺省 → native 用 homePath（草案 §2；DOGFOOD_M3_04 起 FAB 直建，无目录选择浮层）
  const onCreate = onTermCommand ? () => onTermCommand({ kind: 'create' }) : undefined;

  // 边栏包裹：有收起 → 外层 .term-shell（flex row）= [边栏 + 既有网格容器]；无收起 → body 原样返回
  //（golden 91 张字节冻结的关键：不加任何包裹层/不改现有分支）。
  const withRail = (body: JSX.Element): JSX.Element =>
    minimized.length === 0 ? (
      body
    ) : (
      <div className="term-shell">
        <MinimizedRail
          fx={fx}
          minimized={minimized}
          onAction={onAction}
          onTermCommand={onTermCommand}
          initialCollapsed={fx.minRailCollapsed}
        />
        <div className="term-shell__main">{body}</div>
      </div>
    );

  // 可见为空：无收起 = 原空态（字节不变）；有收起 = 网格区提示态「全部终端已收起」+ FAB 照常 + 边栏。
  if (visible.length === 0) {
    return withRail(
      <div className="terminal-grid__empty">
        {minimized.length === 0 ? EMPTY_HINT : ALL_MINIMIZED_HINT}
        <Fab disabled={fx.maxReached} onCreate={onCreate} />
        <ViewToggleGhost fx={fx} onAction={onAction} />
      </div>,
    );
  }

  const isFocusedMode = fx.viewMode === 'Focused' && !!fx.focusedId;
  const dist = rowDistribution(visible.length);
  const rows = splitRows(visible, dist);
  const nonFocused = isFocusedMode ? visible.filter((t) => t.id !== fx.focusedId) : [];

  // 列/行比例来源优先级：① 本地拖拽覆盖（gi，bridge 拖过分隔条）② live 持久化 gridLayout 种子
  // （ConfigContext，仅无拖拽覆盖时）③ 均分。cfg=null（截图/无桥）→ 无种子 → 回落均分，字符串与
  // M2 逐字节相同（golden 安全）。种子仅覆盖无歧义形状：列比限单行且列数匹配、行比限多行且行数匹配
  //（多行的单一 columnRatios 逐行映射有歧义 → 回落均分，记报告遗留）。
  const seedCols = (rowIdx: number, count: number): number[] | null =>
    cfg && dist.length === 1 && rowIdx === 0 && cfg.gridLayout.columnRatios.length === count
      ? cfg.gridLayout.columnRatios
      : null;
  const seedRows = (): number[] | null =>
    cfg && rows.length > 1 && cfg.gridLayout.rowRatios.length === rows.length
      ? cfg.gridLayout.rowRatios
      : null;
  // 本地拖拽态同样过形状守卫（ratiosForShape）：形状与比例长度不符（收起/恢复瞬时窗或陈旧态）
  // → 回落均分，杜绝 flex 和<1 的尾部死区（§10.3，2026-07-17 真机回修）。
  const effCols = (rowIdx: number, count: number): number[] | null =>
    ratiosForShape(gi.colRatios[rowIdx] ?? null, count) ?? seedCols(rowIdx, count);
  const effRows = (): number[] | null => ratiosForShape(gi.rowRatios, rows.length) ?? seedRows();
  const colTemplate = (rowIdx: number, count: number): string => {
    const r = effCols(rowIdx, count);
    return r ? toFrTemplate(r) : new Array(count).fill('1fr').join(' ');
  };
  const colPositions = (rowIdx: number, count: number): number[] => {
    const r = effCols(rowIdx, count);
    return r ? cumulativePercents(r) : handlePositions(count);
  };
  const rowFlex = (rowIdx: number): number => {
    const r = effRows();
    return r ? r[rowIdx] : 1;
  };
  const rowPositions = (): number[] => {
    const r = effRows();
    return r ? cumulativePercents(r) : handlePositions(rows.length);
  };

  const cellStyle = (t: TerminalFixture, colIdx: number): CSSProperties => {
    if (isFocusedMode) {
      return t.id === fx.focusedId
        ? {
            position: 'absolute',
            top: 0,
            left: 0,
            right: nonFocused.length > 0 ? '25%' : 0,
            bottom: 0,
            zIndex: 10,
            overflow: 'hidden',
          }
        : { position: 'absolute', width: 0, height: 0, overflow: 'hidden', opacity: 0, pointerEvents: 'none' };
    }
    return { gridColumn: `${colIdx + 1}`, minWidth: 0, minHeight: 0, height: '100%', overflow: 'hidden' };
  };

  // cell 包裹层拖拽接线（header 已 draggable，dragstart 冒泡至此；onAction 未传时 gi handler 早退、DOM 无序列化差异）
  const cellDragProps = (t: TerminalFixture) => ({
    onDragStart: (e: ReactDragEvent<HTMLDivElement>) => gi.onTileDragStart(t.id, e),
    onDragEnter: () => gi.onTileDragEnter(t.id),
    onDragEnd: gi.onTileDragEnd,
  });

  const renderTile = (t: TerminalFixture): JSX.Element => {
    const isFocused = isFocusedMode && t.id === fx.focusedId;
    const dragState = t.id === effDragging ? 'dragging' : t.id === effDragOver ? 'drag-over' : 'none';
    return (
      <TermTile
        terminal={t}
        fx={fx}
        focused={isFocused}
        compact={isFocusedMode && !isFocused}
        selected={!isFocusedMode && t.id === fx.selectedId}
        dragState={!isFocusedMode ? dragState : 'none'}
        onAction={onAction}
        onTermCommand={onTermCommand}
      />
    );
  };

  const ghost = gi.ghost && (
    <div className="tile-drag-ghost" style={{ left: gi.ghost.x, top: gi.ghost.y }}>
      {gi.ghost.label}
    </div>
  );


  // H1 主修（reorder bug）：拖拽期挂全窗 DragIsland（data-hit-island）→ useLayoutReport 上报为岛 →
  // native HoleStore「洞内且在岛内 → 不穿透」→ PassthroughWebView.hitTest 返 webView → AppKit 拖拽
  // 目的地路由命中 WKWebView → dragover/drop 稳定到达 web（否则光标横穿洞区时事件被 hitTest 抠给
  // 下层 Metal 终端，dragover/drop 进不来，reorder 永不触发）。仅 bridge 拖拽中挂载（draggingId 仅
  // onAction 存在时置位），截图/纯展示恒 null → 不挂载 → golden 逐字节零影响。文件拖入终端复用同一
  // 机制（LiveFilePanel 亦挂 DragIsland）。
  const dragIsland = gi.draggingId ? <DragIsland /> : null;

  // 单行（N≤3）：一个 Grid
  if (dist.length === 1) {
    return withRail(
      <div
        className="terminal-grid"
        onDragOver={gi.onContainerDragOver}
        onDrop={gi.onContainerDrop}
        style={{
          display: 'grid',
          gridTemplateColumns: colTemplate(0, visible.length),
          gridTemplateRows: '1fr',
          gap: '6px',
          padding: 0,
          width: '100%',
          height: '100%',
          position: 'relative',
        }}
      >
        {visible.map((t, i) => (
          <div key={t.id} style={cellStyle(t, i)} {...cellDragProps(t)}>
            {renderTile(t)}
          </div>
        ))}
        {!isFocusedMode &&
          visible.length > 1 &&
          colPositions(0, visible.length).map((pct, i) => (
            <div
              key={`col-0-${i}`}
              className="resize-handle resize-handle--col"
              style={{ left: `${pct}%` }}
              onMouseDown={(e) => gi.onColResizeStart(0, i, e)}
              onDoubleClick={() => gi.onColResizeReset(0)}
            />
          ))}
        <Sidebar fx={fx} nonFocused={nonFocused} visible={isFocusedMode} onAction={onAction} onTermCommand={onTermCommand} />
        <Fab disabled={fx.maxReached} onCreate={onCreate} />
        <ViewToggleGhost fx={fx} onAction={onAction} />
        {ghost}
        {dragIsland}
      </div>
    );
  }

  // 多行（N≥4）：外层 flex column + 每行独立 Grid
  return withRail(
    <div
      className="terminal-grid"
      onDragOver={gi.onContainerDragOver}
      onDrop={gi.onContainerDrop}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        width: '100%',
        height: '100%',
        position: 'relative',
      }}
    >
      {rows.map((rowTerminals, rowIdx) => (
        <div
          key={`row-${rowIdx}`}
          style={{
            display: 'grid',
            gridTemplateColumns: colTemplate(rowIdx, rowTerminals.length),
            gap: '6px',
            flex: rowFlex(rowIdx),
            // Focused 模式下设 static：绝对定位的 cell 相对外层容器解析
            position: isFocusedMode ? 'static' : 'relative',
            minHeight: 0,
          }}
        >
          {rowTerminals.map((t, colIdx) => (
            <div key={t.id} style={cellStyle(t, colIdx)} {...cellDragProps(t)}>
              {renderTile(t)}
            </div>
          ))}
          {!isFocusedMode &&
            rowTerminals.length > 1 &&
            colPositions(rowIdx, rowTerminals.length).map((pct, i) => (
              <div
                key={`col-${rowIdx}-${i}`}
                className="resize-handle resize-handle--col"
                style={{ left: `${pct}%` }}
                onMouseDown={(e) => gi.onColResizeStart(rowIdx, i, e)}
                onDoubleClick={() => gi.onColResizeReset(rowIdx)}
              />
            ))}
        </div>
      ))}
      {!isFocusedMode &&
        rowPositions().map((pct, i) => (
          <div
            key={`row-${i}`}
            className="resize-handle resize-handle--row"
            style={{ top: `${pct}%` }}
            onMouseDown={(e) => gi.onRowResizeStart(i, e)}
            onDoubleClick={gi.onRowResizeReset}
          />
        ))}
      <Sidebar fx={fx} nonFocused={nonFocused} visible={isFocusedMode} />
      <Fab disabled={fx.maxReached} />
      <ViewToggleGhost fx={fx} onAction={onAction} />
      {ghost}
      {dragIsland}
    </div>
  );
}

/** Focused 模式右侧 sidebar（spec §2） */
function Sidebar({
  fx,
  nonFocused,
  visible,
  onAction,
  onTermCommand,
}: {
  fx: Fixture;
  nonFocused: TerminalFixture[];
  visible: boolean;
  onAction?: (action: UIAction) => void;
  onTermCommand?: (req: TermCommandRequest) => void;
}): JSX.Element | null {
  if (!visible || nonFocused.length === 0) return null;
  const visibleCount = Math.min(nonFocused.length, MAX_SIDEBAR_VISIBLE);

  return (
    <div
      style={{
        position: 'absolute',
        right: 0,
        width: '25%',
        top: 0,
        bottom: 0,
        overflowY: 'auto',
        zIndex: 11,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {nonFocused.map((t) => {
        const isActivated = fx.activeSidebarId === t.id;
        return (
          <div
            key={t.id}
            className={isActivated ? 'sidebar-tile--active' : undefined}
            style={{
              height: `${100 / visibleCount}%`,
              minHeight: '150px',
              flexShrink: 0,
              position: 'relative',
              borderLeft: isActivated ? '2px solid var(--accent)' : '1px solid var(--border)',
              overflow: 'hidden',
            }}
          >
            <TermTile
              terminal={t}
              fx={fx}
              compact
              showSidebarSwitch
              role="sidebarPreview"
              onAction={onAction}
              onTermCommand={onTermCommand}
            />
            {/* 智能 overlay：未激活半透明罩，激活后透明（spec §2）；未激活点击 = sidebarSelect（激活该预览） */}
            <div
              onClick={
                onAction && !isActivated
                  ? () => onAction({ kind: 'sidebarSelect', terminalId: t.id })
                  : undefined
              }
              style={{
                position: 'absolute',
                inset: 0,
                zIndex: 1,
                pointerEvents: 'auto',
                cursor: isActivated ? 'text' : 'default',
                background: isActivated ? 'transparent' : 'rgba(0,0,0,0.03)',
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

/** FAB：新建终端（spec §5）。live 模式 → requestCreate 直建（无目录选择浮层，DOGFOOD_M3_04）；否则回落 onCreate（截图/纯展示 = undefined 不挂）。 */
// data-hit-island：FAB 浮在终端洞上，穿透岛采集器（useLayoutReport）据此上报 role="island"，
// 令 native 从穿透区抠掉本按钮区（否则点击被下层终端吞掉，dogfood P0）。data-* 不改渲染像素，golden 不变。
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
