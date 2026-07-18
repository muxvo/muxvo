// 埋点便捷入口 track()（analytics.md §4；web/src/bridge/track.ts）：无桥静默 no-op / 有桥发
// TelemetryEvent（params → KeyValue[]，可选字段省略）。挂靠案例池 AN_bridge_telemetry_decode 的 web 半。
import { afterEach, describe, expect, it, vi } from 'vitest';

const currentBridgeMock = vi.fn();
vi.mock('../src/bridge/client', () => ({
  currentBridge: () => currentBridgeMock(),
}));

import { track } from '../src/bridge/track';

async function flushDynamicImport(): Promise<void> {
  // track() 内部动态 import + then 链：等 vitest 动态 import 全落定。
  await vi.dynamicImportSettled();
}

describe('bridge/track', () => {
  afterEach(() => {
    currentBridgeMock.mockReset();
  });

  it('无桥（截图/浏览器直开）→ 静默 no-op 不抛', async () => {
    currentBridgeMock.mockReturnValue(null);
    expect(() => track('skills.opened')).not.toThrow();
    await flushDynamicImport();
  });

  it('有桥 → sendTelemetry 收到 metric/value/params（KeyValue[] 编码）', async () => {
    const sendTelemetry = vi.fn();
    currentBridgeMock.mockReturnValue({ sendTelemetry });
    track('settings.theme_changed', { theme: 'dark' }, 1);
    await flushDynamicImport();
    expect(sendTelemetry).toHaveBeenCalledTimes(1);
    expect(sendTelemetry).toHaveBeenCalledWith({
      metric: 'settings.theme_changed',
      value: 1,
      params: [{ key: 'theme', value: 'dark' }],
    });
  });

  it('省参调用 → 可选字段不出现在 payload（服务端 schema additionalProperties 兼容）', async () => {
    const sendTelemetry = vi.fn();
    currentBridgeMock.mockReturnValue({ sendTelemetry });
    track('skills.opened');
    await flushDynamicImport();
    expect(sendTelemetry).toHaveBeenCalledTimes(1);
    expect(sendTelemetry).toHaveBeenCalledWith({ metric: 'skills.opened' });
  });
});
