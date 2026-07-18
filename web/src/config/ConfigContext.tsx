/**
 * 配置上下文（M6 批1）：live 模式下持 ConfigSnapshot（偏好快照），封装 set 乐观更新 +
 * 响应校正，并把 config.request / app.request / data.event 收发原语下放给配置面板（A3）。
 *
 * golden 铁律：本 Provider 仅经 main.tsx 的 live（bridge≠null）分支挂载。截图/浏览器直开
 * （bridge=null）→ api=null、snapshot 恒 null → useConfig()/useConfigApi() 返回 null →
 * 消费方（LiveChrome、面板 live 包装）全 inert，DOM/像素零差异。
 *
 * 分两 context：快照变化只重渲 useConfig() 消费者；只用收发原语的面板走 useConfigApi()，
 * api 跨快照更新恒稳定（仅 bridge 由 null→api 时变一次）。
 */

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { BridgeApi } from '../bridge/client';
import type {
  AppRequest,
  AppResponse,
  ConfigRequest,
  ConfigResponse,
  ConfigSnapshot,
  DataEvent,
  PrefsPatch,
} from '../bridge/gen/protocol';

/** 配置收发 API（面板经 useConfigApi() 取；null = 截图/无桥模式）。 */
export interface ConfigApi {
  /**
   * 偏好写入：乐观本地合并（UI 立即反映）→ 发 config.request{set} → 用响应快照校正
   * （native 可能 clamp / 规范化）；rejected 则重拉 get 回滚到权威态。
   */
  set(patch: PrefsPatch): Promise<void>;
  /** config.request 透传（面板自用：listResources/readResource/mcpServers/plugins/getSettings…）。 */
  request(req: ConfigRequest): Promise<ConfigResponse>;
  /** app.request 透传（selectDirectory…）。 */
  sendAppRequest(req: AppRequest): Promise<AppResponse>;
  /** data.event 订阅（configResourcesChanged…）：返回退订函数。 */
  subscribeDataEvent(handler: (event: DataEvent) => void): () => void;
  /** 当前 app 版本（hello 留存，auto-update.md §0）；未回/无桥 = null。 */
  getAppVersion(): string | null;
}

const ConfigSnapshotContext = createContext<ConfigSnapshot | null>(null);
const ConfigApiContext = createContext<ConfigApi | null>(null);

/** 偏好快照（null = 截图/无桥模式或首帧未到）。 */
export function useConfig(): ConfigSnapshot | null {
  return useContext(ConfigSnapshotContext);
}

/** 配置收发 API（null = 截图/无桥模式 → 消费方 inert）。 */
export function useConfigApi(): ConfigApi | null {
  return useContext(ConfigApiContext);
}

export function ConfigProvider({
  bridge,
  children,
}: {
  bridge: BridgeApi | null;
  children: ReactNode;
}): JSX.Element {
  const [snapshot, setSnapshot] = useState<ConfigSnapshot | null>(null);

  // bridge 就绪（hello 后 api 可用）→ 拉一次快照。bridge=null → 永不拉，snapshot 恒 null（golden 安全）。
  useEffect(() => {
    if (!bridge) return;
    let cancelled = false;
    void bridge
      .sendConfigRequest({ kind: 'get' })
      .then((resp) => {
        if (!cancelled && resp.kind === 'snapshot') setSnapshot(resp.config);
      })
      .catch(() => {
        /* 传输/协议错误：静默，保持 null（面板自有空态） */
      });
    return () => {
      cancelled = true;
    };
  }, [bridge]);

  const api = useMemo<ConfigApi | null>(() => {
    if (!bridge) return null;
    return {
      set: (patch: PrefsPatch): Promise<void> => {
        // 乐观：先本地合并让控件即时反映；set 响应回权威快照后覆盖校正。
        setSnapshot((prev) => (prev ? { ...prev, ...patch } : prev));
        // 主题乐观同帧翻 data-theme（B1，对齐 legacy handleToggleTheme 瞬时语义）：UI chrome
        // CSS 变量同帧重算，不等桥往返；ui.state 回推（main.tsx onState）会再写同值，幂等。
        // 校正/回滚：snapshot 响应与 rejected/传输错的 get 回滚均连带把 data-theme 拉回权威值。
        if (patch.theme) document.documentElement.setAttribute('data-theme', patch.theme);
        const rollback = () =>
          void bridge
            .sendConfigRequest({ kind: 'get' })
            .then((r) => {
              if (r.kind === 'snapshot') {
                setSnapshot(r.config);
                if (patch.theme) document.documentElement.setAttribute('data-theme', r.config.theme);
              }
            })
            .catch(() => {});
        return bridge
          .sendConfigRequest({ kind: 'set', patch })
          .then((resp) => {
            if (resp.kind === 'snapshot') {
              setSnapshot(resp.config);
              // native 可能规范化 theme（clamp/兜底）→ 以权威值校正乐观帧
              if (patch.theme) document.documentElement.setAttribute('data-theme', resp.config.theme);
            } else if (resp.kind === 'rejected') {
              // 拒绝 → 乐观值可能与 native 不符，重拉 get 回滚到权威态
              rollback();
            }
          })
          .catch(() => {
            /* 协议错误：同样重拉 get 校正 */
            rollback();
          });
      },
      request: (req: ConfigRequest) => bridge.sendConfigRequest(req),
      sendAppRequest: (req: AppRequest) => bridge.sendAppRequest(req),
      // data.event 订阅经 bridge（BridgeApi 方法，非模块级自由函数）→ ConfigContext 只 import type client.ts
      // （类型擦除），不把 client.ts 拖进 TermGrid→ConfigContext 截图静态链（M6B1-WEB-1）。
      subscribeDataEvent: (handler: (event: DataEvent) => void) => bridge.subscribeDataEvent(handler),
      getAppVersion: () => bridge.getAppVersion(),
    };
  }, [bridge]);

  return (
    <ConfigApiContext.Provider value={api}>
      <ConfigSnapshotContext.Provider value={snapshot}>{children}</ConfigSnapshotContext.Provider>
    </ConfigApiContext.Provider>
  );
}
