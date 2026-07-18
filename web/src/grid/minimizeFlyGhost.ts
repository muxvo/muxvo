/**
 * 收起飞行动画（dogfood-r6 反馈① 2026-07-12；r6-fix 真机否决回修 2026-07-12）：点「收起」按钮时，
 * 一个「幽灵框」从被收起 tile 的位置飞向左侧缩略边栏的收纳点，让用户看见「这个终端收到左边去了」。
 *
 * 设计要点（终端内容是 native Metal 直渲、web 拿不到像素，故动画主体 = tile 的**边框轮廓**）：
 * - 纯装饰、**不阻塞真实收起**：调用方照常立即发 minimizeTile，本函数只在 body 上挂一个飞行 div。
 * - 幽灵框 = fixed 定位、初始铺满 tile rect、圆角 + accent 边框 + 微光淡底 + `pointer-events:none`
 *   （不截击、天然不入 layoutReport 洞清单）。
 * - `prefers-reduced-motion: reduce` → 直接跳过（无障碍纪律）。
 *
 * 生命周期（r6-fix 取证定谳，档 r6-fix-evidence.md）：原版「append 起算 500ms 超时移除」在真机被
 * 否决——流式负载下双 rAF 被重排风暴拖后（取证 B2：起飞 122ms、500ms 硬杀线正好截杀飞行尾段；
 * 更重负载整段不可见）。修订为三段：
 *   ① 等收纳点：逐帧轮询 `.min-rail__dot[data-term-id]`（React 渲染 + 桥回程后才落 DOM，取证
 *      B2 负载下 2.5s 未见）至多 DOT_WAIT_MS，落位则飞真点、超时飞左上固定回退点；
 *   ② 起飞时刻起算 cleanup（FLY_MS + POST_FLY_SLACK_MS），transitionend 先到先清——飞行永远
 *      完整播完，不再被 append 基准的定时器截杀；
 *   ③ 起飞前另有 PREFLIGHT_TIMEOUT_MS 防泄漏兜底（rAF 长期缺席如窗口隐藏，直接拆除）。
 */

const FLY_MS = 380;
const FLY_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';
/** 收纳点落位等待上限：桥回程 + React 渲染（空载 ~30ms 已落，负载可迟到；超时用回退点起飞）。 */
const DOT_WAIT_MS = 240;
/** 起飞后兜底：transitionend 失约（元素被隐藏等）时的移除线——从**起飞**时刻起算。 */
const POST_FLY_SLACK_MS = 250;
/** 起飞前兜底：rAF 全程缺席（窗口隐藏/后台）也不泄漏 DOM。 */
const PREFLIGHT_TIMEOUT_MS = 1500;
// 终点回退（查不到收纳点时）：左缘偏上，贴近折叠细条点区起点（2026-07-13 起细条顶部为展开钮、
// padding-top 6px，点区仍在 y≈40 邻域；真实落点恒用运行时 gBCR，此值仅超时回退）。
const FALLBACK_TARGET = { x: 10, y: 40 };
const DOT_SIZE = 12;

/** 起点矩形（DOMRect 或等价的四元组），仅取 left/top/width/height。 */
export interface FlyRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** 收纳点中心（属性选择器避免 id 转义问题：逐点比对 data-term-id）。查不到返回 null。 */
function railDotCenter(terminalId: string): { x: number; y: number } | null {
  const dots = document.querySelectorAll<HTMLElement>('.min-rail__dot');
  for (const dot of Array.from(dots)) {
    if (dot.getAttribute('data-term-id') === terminalId) {
      const r = dot.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
  }
  return null;
}

/**
 * 从 fromRect 飞一个幽灵框到 terminalId 对应的边栏收纳点。纯装饰、不返回、不抛错。
 * 调用方须**先取 rect、发 minimizeTile，再（或同时）调本函数**——本函数不做任何桥动作。
 */
export function flyToRail(fromRect: FlyRect, terminalId: string): void {
  if (typeof document === 'undefined') return;
  if (prefersReducedMotion()) return;

  const ghost = document.createElement('div');
  ghost.className = 'min-fly-ghost';
  ghost.setAttribute('data-term-id', terminalId);
  ghost.style.left = `${fromRect.left}px`;
  ghost.style.top = `${fromRect.top}px`;
  ghost.style.width = `${fromRect.width}px`;
  ghost.style.height = `${fromRect.height}px`;
  document.body.appendChild(ghost);

  let done = false;
  let timer = 0;
  const cleanup = (): void => {
    if (done) return;
    done = true;
    if (timer) clearTimeout(timer);
    ghost.removeEventListener('transitionend', cleanup);
    ghost.remove();
  };
  ghost.addEventListener('transitionend', cleanup);
  timer = window.setTimeout(cleanup, PREFLIGHT_TIMEOUT_MS);

  const takeOff = (target: { x: number; y: number }): void => {
    if (done) return;
    // cleanup 基准换到起飞时刻：飞行完整播完（transitionend 先到先清，此线只兜失约）。
    if (timer) clearTimeout(timer);
    timer = window.setTimeout(cleanup, FLY_MS + POST_FLY_SLACK_MS);
    // 强制提交初始几何作 transition 基线（首帧起飞时样式可能尚未经历过样式解析）。
    void ghost.getBoundingClientRect();
    ghost.style.transition = `all ${FLY_MS}ms ${FLY_EASING}`;
    ghost.style.left = `${target.x - DOT_SIZE / 2}px`;
    ghost.style.top = `${target.y - DOT_SIZE / 2}px`;
    ghost.style.width = `${DOT_SIZE}px`;
    ghost.style.height = `${DOT_SIZE}px`;
    ghost.style.borderRadius = '50%';
    ghost.style.opacity = '0';
  };

  // 逐帧等收纳点落位（rAF 缺席时 setTimeout 兜底），DOT_WAIT_MS 超时回退固定点。
  const nextFrame =
    typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (cb: FrameRequestCallback): number => window.setTimeout(() => cb(Date.now()), 16) as unknown as number;
  const startedAt = Date.now();
  const waitDot = (): void => {
    nextFrame(() => {
      if (done) return;
      const dot = railDotCenter(terminalId);
      if (dot) {
        takeOff(dot);
      } else if (Date.now() - startedAt >= DOT_WAIT_MS) {
        takeOff(FALLBACK_TARGET);
      } else {
        waitDot();
      }
    });
  };
  waitDot();
}
