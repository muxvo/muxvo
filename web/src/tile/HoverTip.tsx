/**
 * 自绘悬停 tooltip（dogfood-r6 反馈② 2026-07-12；r6-fix 真机否决回修 2026-07-12）：给 tile 头
 * 图标钮加「鼠标挪上去说明这是干什么」的气泡提示。
 *
 * 工程前提（定谳）：WKWebView **不渲染** HTML 原生 `title` tooltip（批A 点条 tooltip、真机定因）——
 * 必须自绘。先例 = MinimizedRail `.min-rail__tooltip`（portal + fixed + pointer-events:none）。
 *
 * 行为（r6-fix 取证后修订，取证档 r6-fix-evidence.md）：
 * - mouseenter 后**延迟 160ms** 才出现（快速扫过不闪）。原 450ms 真机被否决：大于用户在小图标间
 *   移动的自然停留 → 快扫永不出泡=「时灵时不灵」、出泡 ~526ms=「很慢」。
 * - **mousemove 补武装（自愈）**：WKWebView + 穿透洞环境下 mouseenter 可能被吞（洞区→按钮跨界）；
 *   悬停期间任何一次 mousemove 若发现未定时且未显示 → 补 arm。move 高频，已定时**不重置**（否则
 *   抖动光标永远到不了 160ms）。
 * - mouseleave / mousedown 即收。
 * - 气泡在按钮**下方居中**；贴视口边缘时水平夹紧、下方放不下则翻到上方。
 * - portal 到 body、`pointer-events:none`（不截击、不入 layoutReport 洞清单）。hover-only + 延迟
 *   → fixture/golden 天然零影响（截图态不 hover）。
 *
 * 用法（**cloneElement 注入事件、零 DOM 包裹层** → 既有按钮 class/结构逐字节不变，golden 安全）：
 *   <HoverTip label="关闭终端"><button className="tile-close-btn" onClick={…}>…</button></HoverTip>
 * 保留按钮原 `title` 属性作测试锚（jsdom 可断言；真机 WKWebView 不渲染它，只见本气泡）。
 */

import { cloneElement, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, ReactElement } from 'react';
import { createPortal } from 'react-dom';

const SHOW_DELAY_MS = 160;
const GAP = 6;
const MARGIN = 4;

interface Anchor {
  cx: number;
  below: number;
  above: number;
}

type HoverHandler = (e: ReactMouseEvent) => void;

function chain(orig: HoverHandler | undefined, next: HoverHandler): HoverHandler {
  return (e) => {
    if (orig) orig(e);
    next(e);
  };
}

export function HoverTip({
  label,
  children,
}: {
  label: string;
  children: ReactElement;
}): JSX.Element {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const shownRef = useRef(false);
  const timerRef = useRef(0);
  /** mousedown 后抑制自愈重现（点完按钮气泡不回弹），mouseenter/mouseleave 解除。 */
  const suppressedRef = useRef(false);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const arm = (e: ReactMouseEvent): void => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const a: Anchor = { cx: r.left + r.width / 2, below: r.bottom + GAP, above: r.top - GAP };
    clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = 0;
      shownRef.current = true;
      setAnchor(a);
    }, SHOW_DELAY_MS);
  };
  /** mouseenter：解除按下抑制 + 硬重武装（刷新 anchor rect）。 */
  const show: HoverHandler = (e) => {
    suppressedRef.current = false;
    arm(e);
  };
  /** mousemove：enter 被吞时的自愈面——未显示且未定时且未被按下抑制才补 arm，绝不重置在跑的定时器。 */
  const heal: HoverHandler = (e) => {
    if (shownRef.current || timerRef.current || suppressedRef.current) return;
    arm(e);
  };
  const dismiss = (): void => {
    clearTimeout(timerRef.current);
    timerRef.current = 0;
    shownRef.current = false;
    setAnchor(null);
  };
  /** mouseleave：收泡 + 解除按下抑制（下次进入从头计）。 */
  const hide: HoverHandler = () => {
    suppressedRef.current = false;
    dismiss();
  };
  /** mousedown：收泡 + 抑制自愈（悬停不动连点不回弹）。 */
  const pressHide: HoverHandler = () => {
    suppressedRef.current = true;
    dismiss();
  };

  const props = children.props as {
    onMouseEnter?: HoverHandler;
    onMouseMove?: HoverHandler;
    onMouseLeave?: HoverHandler;
    onMouseDown?: HoverHandler;
  };
  const merged = cloneElement(children, {
    onMouseEnter: chain(props.onMouseEnter, show),
    onMouseMove: chain(props.onMouseMove, heal),
    onMouseLeave: chain(props.onMouseLeave, hide),
    onMouseDown: chain(props.onMouseDown, pressHide),
  } as Partial<typeof props>);

  return (
    <>
      {merged}
      {anchor && createPortal(<HoverTipBubble anchor={anchor} label={label} />, document.body)}
    </>
  );
}

/** 气泡本体：初次按「下方居中」渲染，useLayoutEffect 量宽高后水平夹紧 / 垂直翻转。 */
function HoverTipBubble({ anchor, label }: { anchor: Anchor; label: string }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; flip: boolean }>({
    left: anchor.cx,
    top: anchor.below,
    flip: false,
  });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const b = el.getBoundingClientRect();
    const vw = window.innerWidth || 0;
    const vh = window.innerHeight || 0;
    const half = b.width / 2;
    let left = anchor.cx;
    if (left - half < MARGIN) left = MARGIN + half;
    if (vw && left + half > vw - MARGIN) left = vw - MARGIN - half;
    // 下方放不下（超出视口底）→ 翻到按钮上方。
    const flip = !!vh && anchor.below + b.height > vh - MARGIN;
    setPos({ left, top: flip ? anchor.above : anchor.below, flip });
  }, [anchor]);

  return (
    <div
      ref={ref}
      className="hover-tip"
      style={{
        left: pos.left,
        top: pos.top,
        transform: `translateX(-50%)${pos.flip ? ' translateY(-100%)' : ''}`,
      }}
    >
      {label}
    </div>
  );
}
