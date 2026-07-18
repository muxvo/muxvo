/**
 * 文件拖拽期全窗透明岛（RenameBlurGuard 同款）：唯一职责 = 挂 data-hit-island 让 native 把洞区
 * 拖拽事件拦回 web（HoleStore「洞内且不在岛内才穿透」），否则拖过 Metal 洞区时 native hit-test
 * 抠走 dragover，路径拖不到终端 tile。`pointer-events:none` 使它 DOM 侧不挡任何元素（dragover
 * 直穿到下层 tile 靶）。portal 挂卸式 → useLayoutReport MutationObserver 自动重上报岛。
 * 拖拽本就是独占手势，拖拽期 island 化整窗对终端无碍。
 */
import { createPortal } from 'react-dom';

export function DragIsland(): JSX.Element {
  return createPortal(
    <div
      className="drag-island"
      data-hit-island=""
      style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9998 }}
    />,
    document.body,
  );
}
