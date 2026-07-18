/**
 * What's New 打开意图（auto-update.md §7）：设置面板「查看更新内容」链接 → LiveChrome 常驻挂载的
 * WhatsNewModalLive 打开同一弹窗（不触碰 lastSeenVersion）。live 模式弹窗实例唯一 → 模块级单监听即可；
 * 无监听（截图/无桥）时调用为 no-op（golden 零感知）。
 */

type Listener = () => void;

let listener: Listener | null = null;

/** 手动打开 What's New（设置面板链接）。 */
export function openWhatsNew(): void {
  listener?.();
}

/** WhatsNewModalLive 挂载时注册；返回退订（卸载清理，StrictMode 双 effect 幂等）。 */
export function onOpenWhatsNew(next: Listener): () => void {
  listener = next;
  return () => {
    if (listener === next) listener = null;
  };
}
