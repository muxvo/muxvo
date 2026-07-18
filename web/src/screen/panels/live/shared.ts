/**
 * live 面板共享设施（LiveChrome 挂载的四配置面板复用）。
 * golden 铁律：这些 hook 只在 live 面板组件内使用，live 面板只经 LiveChrome（bridge≠null）渲染；
 * 截图/浏览器直开无 LiveChrome → 不挂 → 零执行。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConfigApi } from '../../../config/ConfigContext';

/**
 * 打开时拉取 + 订阅 data.event(configResourcesChanged) 重拉。
 * api=null（无桥）→ 不拉、保持 initial（inert）。fetcher 内部把协议响应映射为屏 fixture 形状。
 */
export function useConfigData<T>(
  api: ConfigApi | null,
  fetcher: (api: ConfigApi) => Promise<T>,
  initial: T,
): [T, () => void] {
  const [data, setData] = useState<T>(initial);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const reload = useCallback(() => {
    if (!api) return;
    void fetcherRef.current(api).then(setData).catch(() => {
      /* 协议/传输错误：保持上一份数据（面板自有空态） */
    });
  }, [api]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (!api) return undefined;
    return api.subscribeDataEvent((e) => {
      if (e.kind === 'configResourcesChanged') reload();
    });
  }, [api, reload]);

  return [data, reload];
}
