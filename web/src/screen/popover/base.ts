/**
 * B1 popover 屏共用底座：多屏信封 → 底图 Fixture + 入口元素量取。
 * 锚点与生产同源（量真实渲染元素的 rect，fonts.ready 后取，消除字体替换抖动）；
 * 浮层永远纯 props 吃 fixture，不 mock IPC。
 */

import { useEffect, useState, type RefObject } from 'react';
import type { Fixture } from '../../fixture/types';

/** 多屏信封（_CONTRACT.md「多屏公共信封」）：base 字段 + 屏级公共字段拼成底图 Fixture */
export function baseFixture(fx: any): Fixture {
  return { ...fx.base, id: fx.id, theme: fx.theme, palette: fx.palette } as Fixture;
}

/**
 * 量取第 tileIndex 个 tile 内 selector 元素的 rect（fonts.ready 后 rAF 轮询直至出现）。
 * 返回 null = 尚未量到（浮层该帧不渲染；__fixtureReady 由 registry 的就位选择器把关）。
 * ⚠️ 下标索引仅 popover 屏 fixture（静态截图，无收起/重排）豁免；live 路径一律用
 * tileElsById 按 ID 锚定——下标在收起/重排下与 `.tile` DOM 集合错位（勿抄本函数）。
 */
export function useTileElementRect(
  hostRef: RefObject<HTMLDivElement>,
  tileIndex: number,
  selector: string,
): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    let cancelled = false;
    document.fonts.ready.then(() => {
      const measure = () => {
        if (cancelled) return;
        const el = hostRef.current?.querySelectorAll('.tile')[tileIndex]?.querySelector(selector);
        if (el) setRect(el.getBoundingClientRect());
        else requestAnimationFrame(measure);
      };
      requestAnimationFrame(measure);
    });
    return () => {
      cancelled = true;
    };
    // hostRef 是稳定 ref；tileIndex/selector 由 fixture 决定，fixture 变更时整屏以 key 重挂
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tileIndex, selector]);

  return rect;
}

/**
 * live 锚定：按 data-terminal-id 找该终端的 `.tile` 根元素（document 直查）。
 * 不按下标——收起终端（批A）不进 `.tile` DOM 集合、本地乐观重排会改 DOM 顺序，
 * `fx.terminals` 全量下标与之错位（浮层飘到别的 tile / 越界永不渲染）。
 * Focused 模式 sidebar 会复渲同终端 → 可能命中多个，调用方取 rect 宽度 > 0 的那个。
 * 用 dataset 比对而非属性选择器：免转义（CSS.escape 在 jsdom 无全局）。
 */
export function tileElsById(terminalId: string): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.tile')).filter(
    (el) => el.dataset.terminalId === terminalId,
  );
}

/** 浮层视口越界钳制（legacy CwdPicker.tsx:110-124 / WorktreePopover.tsx:227-237 同款） */
export function clampToViewport(
  anchor: { top: number; left: number },
  width: number,
  height: number,
): { top: number; left: number } {
  let { top, left } = anchor;
  if (left + width > window.innerWidth) left = window.innerWidth - width - 8;
  if (left < 8) left = 8;
  if (top + height > window.innerHeight) top = anchor.top - height - 8;
  return { top, left };
}
