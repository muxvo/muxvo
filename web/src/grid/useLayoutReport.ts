/**
 * layoutReport 产生端（桥 v2 草案 §3.1）：观察 `.tile-term-hole` 洞元素几何，rAF 合帧（≤60Hz）后
 * 「diff 才发」`ui.action{layoutReport}`，`stateId` = 当前快照 id（native 据此丢弃陈旧上报）。
 *
 * - onAction 未传（截图 / 浏览器无桥宿主）→ 不挂任何监听、零发送。洞分支本就仅真状态源可达
 *   （content 缺席），截图模式 content 恒存在 ⇒ 无洞 ⇒ 天然零 layoutReport（草案 §3.1 / §6）。
 * - 坐标契约：getBoundingClientRect 的 CSS px ≡ AppKit point（native 只做 backing 对齐取整）。
 * - 空 rects（无洞）不主动上报，仅「有洞→无洞」过渡发一次空数组（= 全部停穿透，草案 §3.1）。
 * - 岛约定（DOGFOOD_M3_04）：盖在洞上的 live 浮层挂 data-hit-island，采集为 role="island" rect 令
 *   native 从穿透区抠掉。浮层 portal 挂卸走本地 state（非 fx 驱动），洞的 ResizeObserver 观察不到 →
 *   另挂 MutationObserver 观察 body 子树增删触发重上报（display:none 式隐藏不触发 childList，浮层须挂卸式）。
 */
import { useEffect, useRef } from 'react';
import type { TermRect, TermRectRole, UIAction } from '../bridge/gen/protocol';

/** 岛（web 交互元素）上报用的哨兵 terminalId：island 不建 surface，id 仅供 native 侧追溯。 */
export const ISLAND_TERMINAL_ID = '_island';

/**
 * DOMRect（或等价 {left,top,width,height}）+ 角色 → 上报 rect。
 * - grid/sidebarPreview：terminalId 透传元素 data-term-id。
 * - island：用哨兵 id（不建 surface，仅供 hitTest 从穿透区抠掉，见 native HoleStore）。
 * visible 由尺寸判定（0×0 = 不可见）。抽成纯函数以便无 DOM 单测载荷契约。
 */
export function toReportRect(
  r: { left: number; top: number; width: number; height: number },
  role: TermRectRole,
  termId?: string,
): TermRect {
  return {
    terminalId: role === 'island' ? ISLAND_TERMINAL_ID : termId ?? '',
    x: r.left,
    y: r.top,
    w: r.width,
    h: r.height,
    visible: r.width > 0 && r.height > 0,
    role,
  };
}

// fx 参数只消费快照 id（stateId 来源）：宽签名 { id } 令 task-center（r9 接管洞）与 terminal-grid
// 两屏共用同一采集端——Fixture 结构性子类型直接可传，行为零变。
export function useLayoutReport(fx: { id: string }, onAction?: (action: UIAction) => void): void {
  const lastKey = useRef<string>('');

  useEffect(() => {
    if (!onAction) return;
    let rafId = 0;
    let scheduled = false;

    const compute = (): void => {
      scheduled = false;
      const holeRects = Array.from(
        document.querySelectorAll<HTMLElement>('.tile-term-hole'),
      ).map((el) =>
        toReportRect(
          el.getBoundingClientRect(),
          el.dataset.termRole === 'sidebarPreview' ? 'sidebarPreview' : 'grid',
          el.dataset.termId,
        ),
      );
      // 岛（压在洞上的 web 交互元素，如 FAB）仅在有洞时上报：岛是从穿透区“抠掉”的，
      // 无洞则穿透判定恒不触发、岛无意义。截图模式（onAction 未传）本函数不挂载 ⇒ 零执行不变。
      const islandRects =
        holeRects.length > 0
          ? Array.from(document.querySelectorAll<HTMLElement>('[data-hit-island]')).map((el) =>
              toReportRect(el.getBoundingClientRect(), 'island'),
            )
          : [];
      const rects: TermRect[] = [...holeRects, ...islandRects];
      // 视口尺寸随报（DOGFOOD_M3_13 F5b）：native 据此拒收「陈旧/错误视口下测量」的报文
      // （H-window 类）。纳入 diff key——纯视口变化（洞 rect 恰好没变）也必须重发，
      // 否则 native 侧失配拒收后没有带对视口的后续报文。
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const key = JSON.stringify({ s: fx.id, v: [vw, vh], r: rects });
      if (key === lastKey.current) return;
      const prevHadRects = lastKey.current.includes('"terminalId"');
      lastKey.current = key;
      if (rects.length === 0 && !prevHadRects) return; // 从未有洞：不刷空报
      onAction({ kind: 'layoutReport', stateId: fx.id, rects, viewportW: vw, viewportH: vh });
    };

    const schedule = (): void => {
      if (scheduled) return;
      scheduled = true;
      rafId = requestAnimationFrame(compute);
    };

    schedule(); // 首帧
    const ro = new ResizeObserver(schedule);
    document.querySelectorAll('.tile-term-hole').forEach((el) => ro.observe(el));
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true); // sidebar 滚动等祖先滚动
    // portal 弹窗（关闭确认 backdrop / 搜索条 / 等待卡）挂卸走本地 state、非 fx 驱动，ResizeObserver
    // 观察不到 → MutationObserver 观察 body 子树增删补齐重上报。只开 childList（不开 attributes/
    // characterData）防 React 高频属性写打爆；rAF 合帧 +「diff 才发」+ compute 只读 DOM，无循环。
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, { childList: true, subtree: true });

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
    };
    // fx 变更（新快照）重挂：重新观察当帧洞集合并以新 stateId 上报
  }, [fx, onAction]);
}
