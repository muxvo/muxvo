/**
 * 网格交互 hook（M3 批5③）：tile 拖拽重排 + 分隔条拖动。**仅 bridge 模式启用**——
 * onAction 未传（截图 / 纯展示）时全部 handler 早退、无 document 监听、无本地态覆盖，
 * 渲染路径与 M2 逐字节一致（草案 §6 六道闸；截图模式桥零执行 ⇒ 天然零 reorder/gridResize）。
 *
 * 交互过程视觉全 web 本地（草案 §3.2/§3.3）：拖拽用 HTML5 DnD（header 已 draggable），
 * drop 时一次性发 reorder{order}（方案 B）并本地乐观按新序渲染，快照回流后以其为准；
 * 分隔条用 pointer（mousedown→document mousemove/mouseup），释放时发 gridResize。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from 'react';
import type { UIAction } from '../bridge/gen/protocol';
import type { Fixture } from '../fixture/types';
import { rowDistribution } from './layout';
import {
  buildGridResizePayload,
  equalFractions,
  planReorder,
  redistribute,
} from './gridInteractions';

export interface GridGhost {
  label: string;
  x: number;
  y: number;
}

export interface GridInteractions {
  active: boolean;
  /** 本地乐观顺序（ids）；null = 用快照顺序 */
  order: string[] | null;
  draggingId: string | null;
  dragOverId: string | null;
  ghost: GridGhost | null;
  /** rowIdx → 列比（和为 1）；缺省 = 均分（1fr） */
  colRatios: Record<number, number[]>;
  /** 行高比（和为 1）；null = 均分（flex:1） */
  rowRatios: number[] | null;
  // 拖拽（cell 包裹层接线）
  onTileDragStart(id: string, e: ReactDragEvent<HTMLElement>): void;
  onTileDragEnter(id: string): void;
  onTileDragEnd(): void;
  // 拖拽（网格根接线）
  onContainerDragOver(e: ReactDragEvent<HTMLElement>): void;
  onContainerDrop(e: ReactDragEvent<HTMLElement>): void;
  // 分隔条
  onColResizeStart(rowIdx: number, boundaryIdx: number, e: ReactMouseEvent<HTMLElement>): void;
  onColResizeReset(rowIdx: number): void;
  onRowResizeStart(boundaryIdx: number, e: ReactMouseEvent<HTMLElement>): void;
  onRowResizeReset(): void;
}

function ghostLabel(cwd: string, customName?: string): string {
  if (customName && customName.trim()) return customName;
  const seg = cwd.split('/').filter(Boolean).pop();
  return seg || cwd || 'terminal';
}

// ⚠️ setDragImage 禁用令（2026-07-07 真机 DIAG 实锤，S:1 O:0 X:1 = 会话秒死）：WKWebView 对
// **游离元素**（未插入文档、无渲染盒）的 setDragImage 无法截取拖影快照 → 整个拖拽会话立即取消
// （dragstart 紧跟 dragend、全程无 dragover）。空 new Image() 与 detached canvas 同罪；jsdom 里
// setDragImage 是 no-op 故单测测不出。**不设自定义拖影**（接受原生拖影 = 被拖元素半透明快照），
// 自绘 ghost 标签照常并存。若未来要隐藏原生拖影，唯一安全路径 = 文档内视口外定位的真实元素。

// H3a 兜底（reorder bug 三假设之一）：光标只穿洞区（.tile-term-hole 大面积）进入目标 tile 时，
// dragenter 未在 cell 包裹层触发 → dragOverRef 恒 null → drop 静默 no-op。drop 落点按几何反查命中的
// tile（洞元素携 data-term-id；其余元素向上找最近 [data-term-id]），排除拖拽源自身。elementsFromPoint
// 天然跳过 pointer-events:none 元素（如全窗 DragIsland），故不会误命中岛。
function tileIdAtPoint(x: number, y: number, exclude: string | null): string | null {
  if (typeof document === 'undefined' || typeof document.elementsFromPoint !== 'function') return null;
  for (const el of document.elementsFromPoint(x, y)) {
    const host = (el as HTMLElement).closest?.('[data-term-id]') as HTMLElement | null;
    const id = host?.dataset.termId;
    if (id && id !== exclude) return id;
  }
  return null;
}

export function useGridInteractions(
  fx: Fixture,
  onAction?: (action: UIAction) => void,
): GridInteractions {
  const active = !!onAction;

  const [order, setOrder] = useState<string[] | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [ghost, setGhost] = useState<GridGhost | null>(null);
  const [colRatios, setColRatios] = useState<Record<number, number[]>>({});
  const [rowRatios, setRowRatios] = useState<number[] | null>(null);

  // emit 时读最新比例（state 异步，mouseup 闭包会拿到陈旧值）→ 用 ref 兜底
  const colRatiosRef = useRef<Record<number, number[]>>({});
  const rowRatiosRef = useRef<number[] | null>(null);
  const draggingRef = useRef<string | null>(null);
  const dragOverRef = useRef<string | null>(null);
  const ghostRaf = useRef(0);
  const ghostXY = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  draggingRef.current = draggingId;
  dragOverRef.current = dragOverId;

  // 形状按**可见（未收起）**终端算——收起项不进网格（term-grid §11.1），交互层与渲染层同一形状源。
  // 按总数算会在有收起时把行比播种成多余行数（flex 和<1 → 底部死区，2026-07-17 真机回修，§10.3）。
  const visibleCount = fx.terminals.filter((t) => !t.minimized).length;
  const dist = rowDistribution(visibleCount);
  const rowCount = dist.length;
  const row0Cols = dist[0] ?? 0;

  // 新快照到达 → 清乐观顺序（native 为权威，草案 §3.2）
  useEffect(() => {
    setOrder(null);
  }, [fx]);

  // 网格形状变化（**可见**终端数变——开/关终端与收起/恢复皆是）→ 比例重建为均分（spec §1.3/§10.3）
  useEffect(() => {
    colRatiosRef.current = {};
    rowRatiosRef.current = null;
    setColRatios({});
    setRowRatios(null);
  }, [visibleCount]);

  const clearDrag = useCallback(() => {
    setDraggingId(null);
    setDragOverId(null);
    setGhost(null);
    if (ghostRaf.current) {
      cancelAnimationFrame(ghostRaf.current);
      ghostRaf.current = 0;
    }
  }, []);

  const onTileDragStart = useCallback(
    (id: string, e: ReactDragEvent<HTMLElement>) => {
      if (!onAction) return;
      const t = fx.terminals.find((x) => x.id === id);
      setDraggingId(id);
      setGhost({ label: ghostLabel(t?.cwd ?? '', t?.customName), x: e.clientX, y: e.clientY });
      try {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', id);
        // 不调 setDragImage（见模块级禁用令：WKWebView 对游离元素快照失败=杀会话）——原生拖影保留。
      } catch {
        /* dataTransfer 异常不致命 */
      }
    },
    [onAction, fx],
  );

  const onTileDragEnter = useCallback(
    (id: string) => {
      if (!onAction || !draggingRef.current || id === draggingRef.current) return;
      setDragOverId(id);
    },
    [onAction],
  );

  const onContainerDragOver = useCallback(
    (e: ReactDragEvent<HTMLElement>) => {
      if (!onAction || !draggingRef.current) return;
      e.preventDefault(); // 允许 drop
      e.dataTransfer.dropEffect = 'move';
      ghostXY.current = { x: e.clientX, y: e.clientY };
      if (!ghostRaf.current) {
        ghostRaf.current = requestAnimationFrame(() => {
          ghostRaf.current = 0;
          setGhost((g) => (g ? { ...g, x: ghostXY.current.x, y: ghostXY.current.y } : g));
        });
      }
    },
    [onAction],
  );

  const onContainerDrop = useCallback(
    (e: ReactDragEvent<HTMLElement>) => {
      if (!onAction || !draggingRef.current) return;
      e.preventDefault();
      const ids = order ?? fx.terminals.map((t) => t.id);
      // dragenter 已落 → 用之；否则 H3a 兜底按 drop 落点几何反查目标 tile（光标只穿洞区的路径）
      const overId = dragOverRef.current ?? tileIdAtPoint(e.clientX, e.clientY, draggingRef.current);
      const next = planReorder(ids, draggingRef.current, overId);
      if (next) {
        onAction({ kind: 'reorder', order: next });
        setOrder(next); // 乐观：不等快照回流（防闪烁），快照到达后 effect 清除以其为准
      }
      clearDrag();
    },
    [onAction, order, fx, clearDrag],
  );

  const onTileDragEnd = useCallback(() => {
    // Esc / 拖出网格取消：dragend 恒触发（drop 未发生 → 不发 reorder）
    if (!onAction) return;
    clearDrag();
  }, [onAction, clearDrag]);

  const emitGridResize = useCallback(() => {
    if (!onAction) return;
    onAction({
      kind: 'gridResize',
      ...buildGridResizePayload(colRatiosRef.current, rowRatiosRef.current, rowCount, row0Cols),
    });
  }, [onAction, rowCount, row0Cols]);

  const onColResizeStart = useCallback(
    (rowIdx: number, boundaryIdx: number, e: ReactMouseEvent<HTMLElement>) => {
      if (!onAction) return;
      e.preventDefault();
      const rowEl = e.currentTarget.parentElement;
      const width = rowEl?.getBoundingClientRect().width ?? 0;
      if (width <= 0) return;
      const cols = dist[rowIdx] ?? 0;
      const start = colRatiosRef.current[rowIdx] ?? equalFractions(cols);
      const startX = e.clientX;
      const move = (ev: MouseEvent) => {
        const delta = (ev.clientX - startX) / width;
        const nextRow = redistribute(start, boundaryIdx, delta);
        colRatiosRef.current = { ...colRatiosRef.current, [rowIdx]: nextRow };
        setColRatios(colRatiosRef.current);
      };
      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        emitGridResize();
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    },
    [onAction, dist, emitGridResize],
  );

  const onColResizeReset = useCallback(
    (rowIdx: number) => {
      if (!onAction) return;
      const { [rowIdx]: _drop, ...rest } = colRatiosRef.current;
      colRatiosRef.current = rest;
      setColRatios(rest);
      emitGridResize();
    },
    [onAction, emitGridResize],
  );

  const onRowResizeStart = useCallback(
    (boundaryIdx: number, e: ReactMouseEvent<HTMLElement>) => {
      if (!onAction) return;
      e.preventDefault();
      const containerEl = e.currentTarget.parentElement;
      const height = containerEl?.getBoundingClientRect().height ?? 0;
      if (height <= 0) return;
      const start = rowRatiosRef.current ?? equalFractions(rowCount);
      const startY = e.clientY;
      const move = (ev: MouseEvent) => {
        const delta = (ev.clientY - startY) / height;
        const nextRows = redistribute(start, boundaryIdx, delta);
        rowRatiosRef.current = nextRows;
        setRowRatios(nextRows);
      };
      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        emitGridResize();
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    },
    [onAction, rowCount, emitGridResize],
  );

  const onRowResizeReset = useCallback(() => {
    if (!onAction) return;
    rowRatiosRef.current = null;
    setRowRatios(null);
    emitGridResize();
  }, [onAction, emitGridResize]);

  return {
    active,
    order,
    draggingId,
    dragOverId,
    ghost,
    colRatios,
    rowRatios,
    onTileDragStart,
    onTileDragEnter,
    onTileDragEnd,
    onContainerDragOver,
    onContainerDrop,
    onColResizeStart,
    onColResizeReset,
    onRowResizeStart,
    onRowResizeReset,
  };
}
