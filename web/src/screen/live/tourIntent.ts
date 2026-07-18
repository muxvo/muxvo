/**
 * 导览启动意图信箱（右上角批 B4；panelIntent 同族）：设置面板「新手引导」按钮 → 关面板 100ms 后
 * requestTourStart()（legacy SettingsModal.tsx:114 handleRestartTour 对齐：跳过欢迎卡、不重置
 * tourCompleted）→ LiveOnboarding 订阅方直接进 driver 导览。
 * 订阅式（非 mount 消费式）：LiveChrome/LiveOnboarding 在设置面板关闭时已挂载，mount 消费收不到。
 */

type Listener = () => void;

let listener: Listener | null = null;
let pending = false;

/** LiveOnboarding 挂载时注册；返回退订。挂载前已有 pending 请求 → 注册即触发（时序缝兜底）。 */
export function subscribeTourStart(fn: Listener): () => void {
  listener = fn;
  if (pending) {
    pending = false;
    fn();
  }
  return () => {
    if (listener === fn) listener = null;
  };
}

/** 请求启动导览（跳过欢迎卡）。无订阅方时挂起，订阅即触发。 */
export function requestTourStart(): void {
  if (listener) listener();
  else pending = true;
}
