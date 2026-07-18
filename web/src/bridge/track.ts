// 埋点便捷入口（analytics.md §4）：web 面板 L4 事件经 app.telemetry 桥送 native AnalyticsTracker。
// 动态 import client（不构成截图静态图的静态边）；无桥（截图 fixture/浏览器直开）静默 no-op——
// 截图隔离铁律不破，调用方零判断。fire-and-forget：埋点绝不影响 UI 行为。
export function track(metric: string, params?: Record<string, string>, value?: number): void {
  void import('./client')
    .then(({ currentBridge }) => {
      const bridge = currentBridge();
      if (!bridge) return;
      bridge.sendTelemetry({
        metric,
        ...(value !== undefined ? { value } : {}),
        ...(params && Object.keys(params).length > 0
          ? { params: Object.entries(params).map(([key, v]) => ({ key, value: v })) }
          : {}),
      });
    })
    .catch(() => {});
}
