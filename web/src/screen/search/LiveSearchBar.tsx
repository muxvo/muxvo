/**
 * 终端内搜索条（真状态源路径，bridge v2 草案 §3 / terminal-search-bar.md）：
 * ui.state.searchBar 存在即显示，锚在目标 tile 内容区（`.tile-terminal`）右上角。
 * 输入 / 上一个 / 下一个 / 关闭 → ui.action 的 searchQuery/searchPrev/searchNext/searchClose
 * （fire-and-forget，native 执行搜索）。
 *
 * 与截图契约的隔离：仅在 `onAction` 存在（真桥宿主）且 `fx.searchBar` 非空时渲染。terminal-grid
 * golden 无 searchBar 字段、截图模式无 onAction ⇒ 永不渲染；`terminal-search-bar` golden 走独立的
 * SearchBarScreen（fixture 屏路径，本组件不参与）。两者正交（草案 §5）。
 */
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { UIAction } from '../../bridge/gen/protocol';
import type { Fixture } from '../../fixture/types';
import { makeQueryDebouncer, searchKeyAction, type QueryDebouncer } from './searchBarLogic';
import { tileElsById } from '../popover/base';
import '../popover/popovers.css';

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** 量取 terminalId 对应 tile 的 `.tile-terminal` rect（rAF 轮询直至出现）。生产 xterm 包裹层等价几何。
 *  tileElsById 按 ID 锚定，勿用下标（同 LiveWorktreePopover）；命中多个（Focused sidebar 复渲）时取
 *  宽度 > 0 的那个（jsdom gBCR 恒 0 → 回落首个）。 */
function useTileContentRect(terminalId: string | undefined): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null);
  useEffect(() => {
    if (!terminalId) {
      setRect(null);
      return;
    }
    let cancelled = false;
    const measure = (): void => {
      if (cancelled) return;
      const els = tileElsById(terminalId)
        .map((tile) => tile.querySelector('.tile-terminal'))
        .filter((el): el is Element => el !== null);
      if (els.length > 0) {
        const rects = els.map((el) => el.getBoundingClientRect());
        const r = rects.find((x) => x.width > 0) ?? rects[0];
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
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

export function LiveSearchBar({
  fx,
  onAction,
}: {
  fx: Fixture;
  onAction: (action: UIAction) => void;
}): JSX.Element | null {
  const terminalId = fx.searchBar?.terminalId;
  const rect = useTileContentRect(terminalId);

  // 最新 onAction / terminalId 走 ref，让防抖器只造一次（跨渲染稳定）却总派发到当前桥。
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;
  const terminalIdRef = useRef(terminalId);
  terminalIdRef.current = terminalId;
  const debouncerRef = useRef<QueryDebouncer | null>(null);
  if (debouncerRef.current === null) {
    debouncerRef.current = makeQueryDebouncer((query) => {
      const id = terminalIdRef.current;
      if (id) onActionRef.current({ kind: 'searchQuery', terminalId: id, query });
    });
  }
  const debouncer = debouncerRef.current;
  useEffect(() => () => debouncer.cancel(), [debouncer]); // 卸载丢弃待发

  if (!terminalId || !rect) return null;

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    const action = searchKeyAction(e.key, e.shiftKey);
    if (!action) return;
    e.preventDefault();
    if (action === 'searchClose') {
      debouncer.cancel();
      onAction({ kind: 'searchClose', terminalId });
      return;
    }
    // Enter / Shift+Enter：有未派发输入则先冲刷查询（跳首个命中即完成本次查找），否则导航当前命中。
    if (debouncer.flush()) return;
    onAction({ kind: action, terminalId });
  };

  return createPortal(
    <div
      style={{
        position: 'fixed',
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        pointerEvents: 'none',
      }}
    >
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        {/* data-hit-island：仅内层实体搜索条挂岛（穿透区抠掉，可点）。严禁挂外层 fixed 包裹层——
            它 pointerEvents:none 覆盖整块 tile 内容区，挂错层会把整个洞抠掉、搜索期终端全不穿透
            （DOGFOOD_M3_04 浮层岛约定）。 */}
        <div className="terminal-search-bar" data-hit-island="" style={{ pointerEvents: 'auto' }}>
          <form onSubmit={(e) => e.preventDefault()}>
            <input
              type="text"
              placeholder="Search..."
              autoFocus
              onChange={(e) => debouncer.schedule(e.target.value)}
              onKeyDown={onKeyDown}
            />
          </form>
          <button title="Previous (Shift+Enter)" onClick={() => onAction({ kind: 'searchPrev', terminalId })}>
            &#9650;
          </button>
          <button title="Next (Enter)" onClick={() => onAction({ kind: 'searchNext', terminalId })}>
            &#9660;
          </button>
          <button
            title="Close (Esc)"
            onClick={() => {
              debouncer.cancel();
              onAction({ kind: 'searchClose', terminalId });
            }}
          >
            &#10005;
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
