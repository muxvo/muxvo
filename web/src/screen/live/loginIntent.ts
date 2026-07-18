/**
 * 登录弹窗打开意图信箱（右上角批 B5；tourIntent 同族）：聊天历史 chrome（独立 React 树）点登录
 * icon → chatClose 回终端 + requestLoginOpen() → LiveChrome 订阅方开 LoginModalLive。
 */

type Listener = () => void;

let listener: Listener | null = null;
let pending = false;

export function subscribeLoginOpen(fn: Listener): () => void {
  listener = fn;
  if (pending) {
    pending = false;
    fn();
  }
  return () => {
    if (listener === fn) listener = null;
  };
}

export function requestLoginOpen(): void {
  if (listener) listener();
  else pending = true;
}
