/**
 * 登录态上下文（右上角批 B5；login-modal.md / user-dropdown.md）：
 * - 挂载即 `app.request authStatus` 拉一次（启动恢复后的权威登录态）；
 * - 订阅 data.event `authStatusChanged` / `authSessionExpired` 跟拍推送（OAuth 轮询成功、
 *   登出、刷新失败降级等全走此通道——legacy onStatusChange/onSessionExpired 对齐）。
 * golden 铁律：仅经 LiveRoot（bridge≠null）挂载；截图路径不可达。
 */

import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { BridgeApi } from '../bridge/client';
import type { AuthView } from '../bridge/gen/protocol';

export interface AuthState {
  /** null = 尚未取到首个权威态（按未登录渲染）。 */
  auth: AuthView | null;
  /** 会话过期一次性信号计数（消费方 useEffect 依赖它弹「登录已过期」提示）。 */
  sessionExpiredCount: number;
}

const AuthStateContext = createContext<AuthState>({ auth: null, sessionExpiredCount: 0 });

export function useAuth(): AuthState {
  return useContext(AuthStateContext);
}

export function AuthProvider({
  bridge,
  children,
}: {
  bridge: BridgeApi;
  children: ReactNode;
}): JSX.Element {
  const [state, setState] = useState<AuthState>({ auth: null, sessionExpiredCount: 0 });

  useEffect(() => {
    let cancelled = false;
    // 主动拉一次（native 启动 tryRestoreSession 已跑完/在跑，双保险：推送错过也能收敛）。
    void bridge
      .sendAppRequest({ kind: 'authStatus' })
      .then((resp) => {
        if (!cancelled && resp.kind === 'authState') {
          setState((s) => ({ ...s, auth: resp.auth }));
        }
      })
      .catch(() => {
        /* AUTH_UNAVAILABLE/传输错：保持 null（未登录渲染） */
      });
    const unsubscribe = bridge.subscribeDataEvent((event) => {
      if (event.kind === 'authStatusChanged') {
        setState((s) => ({ ...s, auth: event.auth }));
      } else if (event.kind === 'authSessionExpired') {
        setState((s) => ({
          auth: { loggedIn: false },
          sessionExpiredCount: s.sessionExpiredCount + 1,
        }));
      }
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [bridge]);

  return <AuthStateContext.Provider value={state}>{children}</AuthStateContext.Provider>;
}
