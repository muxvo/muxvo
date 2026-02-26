/**
 * Analytics tracking 工具
 * - useAnalytics()  — React hook，300ms 防抖 + 安全调用
 * - trackEvent()    — 独立函数，用于非 React 场景
 * - trackError()    — 错误事件快捷函数
 */

import { useCallback, useRef } from 'react';
import { ANALYTICS_EVENTS } from '@/shared/constants/analytics-events';
import type { AnalyticsEventName } from '@/shared/constants/analytics-events';

/**
 * React hook — 用于组件内的埋点调用
 * 自动 300ms 防抖（同一事件名在 300ms 内不重复发送）
 */
export function useAnalytics() {
  const lastEventRef = useRef<Map<string, number>>(new Map());

  const track = useCallback(
    (event: AnalyticsEventName, params?: Record<string, unknown>) => {
      const now = Date.now();
      const lastTime = lastEventRef.current.get(event) || 0;
      if (now - lastTime < 300) return;
      lastEventRef.current.set(event, now);

      try {
        window.api?.analytics?.track(event, params);
      } catch {
        // 静默降级，不影响主功能
      }
    },
    [],
  );

  return { track };
}

/**
 * 独立函数 — 用于非 React 场景（事件处理器、工具函数等）
 * 无防抖，每次调用都发送
 */
export function trackEvent(
  event: AnalyticsEventName,
  params?: Record<string, unknown>,
): void {
  try {
    window.api?.analytics?.track(event, params);
  } catch {
    // 静默降级
  }
}

/**
 * 错误事件快捷函数 — 统一 error 事件格式
 */
export function trackError(
  type: 'ipc' | 'terminal' | 'action',
  detail: Record<string, unknown>,
): void {
  const eventMap = {
    ipc: ANALYTICS_EVENTS.ERROR.IPC,
    terminal: ANALYTICS_EVENTS.ERROR.TERMINAL,
    action: ANALYTICS_EVENTS.ERROR.ACTION,
  } as const;

  try {
    window.api?.analytics?.track(eventMap[type], detail);
  } catch {
    // 静默降级
  }
}
