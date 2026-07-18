/**
 * 终端收起·左侧缩略边栏（term-grid §11.2/§11.3；dogfood 反馈②③ 改版 2026-07-11）。
 *
 * - 从收起集（order 相对序）渲 MiniTermCard；**空列表返回 null**（golden 守卫：无收起 = DOM 与旧渲染逐字节一致）。
 * - **默认折叠**为 28px 细条（本地 useState 初值 true，不过桥、不持久化；dogfood 反馈②：收起后不应
 *   默认占 180px）：细条 = **逐收起终端一个点**（order 相对序、统一淡灰无状态色——
 *   二轮修订：收起=不关注，状态不展示；悬停自绘 tooltip=终端名，WKWebView 无原生 title tooltip，
 *   dogfood 反馈③+真机定因）。**点圆点 = restoreTile 直接恢复该终端；展开唯一入口 = 细条顶部
 *   展开钮（ExpandIcon »）**（dogfood 反馈 2026-07-13：原「点细条任意处展开」退役）。展开态顶部折叠钮收回。
 * - 卡片单击 → restoreTile；右键 → 自定义弹出菜单（恢复/关闭），菜单挂 data-hit-island（浮层=岛约定，
 *   防点击穿透到洞）；关闭复用现有关闭链路（活会话 requestClose 确认对话框、死会话 term.command close 直移除）。
 * - 底部「全部恢复」→ restoreAllMinimized。
 *
 * golden 铁律：本组件由 fx 收起集数据驱动（截图/live 同渲）；截图态 onAction/live 缺席 → 恢复/关闭/右键全 inert。
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TermCommandRequest, UIAction } from '../bridge/gen/protocol';
import type { Fixture, TerminalFixture } from '../fixture/types';
import { MiniTermCard, cardTitle } from '../tile/MiniTermCard';
import { CollapseIcon, ExpandIcon } from '../tile/icons';
import { useLiveInteractions } from '../screen/live/LiveInteractions';

export function MinimizedRail({
  fx,
  minimized,
  onAction,
  onTermCommand,
  initialCollapsed = true,
}: {
  fx: Fixture;
  minimized: TerminalFixture[];
  onAction?: (action: UIAction) => void;
  onTermCommand?: (req: TermCommandRequest) => void;
  /** fixture 截图初始折叠态种子（rail 折叠是 web 本地态，不过桥；仅 golden 用）。默认 true（§11.2 默认折叠）。 */
  initialCollapsed?: boolean;
}): JSX.Element | null {
  const live = useLiveInteractions();
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [menuFor, setMenuFor] = useState<{ id: string; x: number; y: number } | null>(null);
  // 折叠细条点的悬停 tooltip（自绘：WKWebView 不渲染原生 title tooltip——dogfood 真机定因 2026-07-11）。
  const [hoverDot, setHoverDot] = useState<{ title: string; y: number } | null>(null);

  // 空列表守卫（golden 守卫）：无收起终端不渲染任何 DOM。
  if (minimized.length === 0) return null;

  // 关闭复用现有链路（TileHeader 关闭钮同款）：死会话 term.command close 直移除、活会话 requestClose 确认对话框。
  const closeFromRail = (t: TerminalFixture): void => {
    const removable =
      t.state === 'Stopped' || t.state === 'Disconnected' || t.state === 'Failed';
    if (removable && onTermCommand) onTermCommand({ kind: 'close', terminalId: t.id });
    else if (live) live.requestClose(t.id);
  };

  if (collapsed) {
    return (
      <div className="min-rail min-rail--collapsed">
        {/* 展开唯一入口 = 顶部展开钮（dogfood 反馈 2026-07-13：圆点=直接恢复该终端，细条背景
            不再响应点击——原「点细条任意处展开」退役）。 */}
        <button
          className="min-rail__expand-btn"
          title="展开收起列表"
          onClick={() => setCollapsed(false)}
        >
          <ExpandIcon />
        </button>
        {/* 逐收起终端一个点（dogfood 反馈③+二轮修订）：**统一淡灰不带状态色**（用户裁决：收起 =
            不想关注，绿点刺眼且状态无需展示）；悬停出自绘 tooltip=终端名（WKWebView 无原生 title）；
            单击 = restoreTile 直接恢复（截图态 onAction 缺席 → inert）。点击即清 tooltip——点恢复后
            dot 卸载不触发 mouseleave，不清会留悬挂 tooltip。 */}
        {minimized.map((t) => (
          <span
            key={t.id}
            className="min-rail__dot"
            data-term-id={t.id}
            data-term-title={cardTitle(t)}
            onClick={
              onAction
                ? () => {
                    setHoverDot(null);
                    onAction({ kind: 'restoreTile', terminalId: t.id });
                  }
                : undefined
            }
            onMouseEnter={(e) =>
              setHoverDot({ title: cardTitle(t), y: e.currentTarget.getBoundingClientRect().top })
            }
            onMouseLeave={() => setHoverDot(null)}
          />
        ))}
        {hoverDot &&
          createPortal(
            <div className="min-rail__tooltip" style={{ top: hoverDot.y - 3 }}>
              {hoverDot.title}
            </div>,
            document.body,
          )}
      </div>
    );
  }

  return (
    <div className="min-rail">
      <div className="min-rail__header">
        <button className="min-rail__collapse-btn" title="折叠" onClick={() => setCollapsed(true)}>
          <CollapseIcon />
        </button>
      </div>
      <div className="min-rail__list">
        {minimized.map((t) => (
          <MiniTermCard
            key={t.id}
            terminal={t}
            variant="rail"
            selected={fx.selectedId === t.id}
            onClick={
              onAction ? () => onAction({ kind: 'restoreTile', terminalId: t.id }) : undefined
            }
            onContextMenu={
              onAction
                ? (e) => {
                    e.preventDefault();
                    setMenuFor({ id: t.id, x: e.clientX, y: e.clientY });
                  }
                : undefined
            }
            // 行内关闭钮（dogfood 反馈 2026-07-13：列表页直接关，免逐个恢复再关）：与右键「关闭」
            // 同走 closeFromRail；门控 = 关闭能力在场（onTermCommand 死会话 / live 活会话确认框），
            // 截图态双缺席不渲 → golden DOM 零动。
            onClose={onTermCommand || live ? () => closeFromRail(t) : undefined}
          />
        ))}
      </div>
      <div className="min-rail__footer">
        <button
          className="min-rail__restore-all"
          onClick={onAction ? () => onAction({ kind: 'restoreAllMinimized' }) : undefined}
        >
          全部恢复
        </button>
      </div>
      {menuFor && (
        <RailContextMenu
          x={menuFor.x}
          y={menuFor.y}
          onRestore={() => {
            onAction?.({ kind: 'restoreTile', terminalId: menuFor.id });
            setMenuFor(null);
          }}
          onClose={() => {
            const t = minimized.find((x) => x.id === menuFor.id);
            if (t) closeFromRail(t);
            setMenuFor(null);
          }}
          onDismiss={() => setMenuFor(null)}
        />
      )}
    </div>
  );
}

/** 右键弹出菜单（恢复/关闭）：portal 到 body，data-hit-island = 浮层岛约定（native 从穿透区抠掉，
 *  防点击落进下层 Metal 终端）。document 捕获 mousedown 点外 / Esc 关闭。 */
function RailContextMenu({
  x,
  y,
  onRestore,
  onClose,
  onDismiss,
}: {
  x: number;
  y: number;
  onRestore: () => void;
  onClose: () => void;
  onDismiss: () => void;
}): JSX.Element {
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      const menu = document.querySelector('.min-rail__menu');
      if (menu && e.target instanceof Node && menu.contains(e.target)) return;
      onDismiss();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onDismiss();
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [onDismiss]);

  return createPortal(
    <div className="min-rail__menu" data-hit-island="" style={{ left: x, top: y }}>
      <button className="min-rail__menu-item" onClick={onRestore}>
        恢复
      </button>
      <button className="min-rail__menu-item" onClick={onClose}>
        关闭
      </button>
    </div>,
    document.body,
  );
}
