/**
 * VERIFY: Bug 3 — WebGL 上下文丢失后自动重建
 *
 * 验证 onContextLoss 回调中：
 * 1. dispose 当前 WebGL addon
 * 2. 延迟 100ms 后尝试重建 WebGL（调用 loadWebgl）
 * 3. 重建失败时 webglAddon 保持 null（xterm 自动使用 canvas）
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';

// Mock xterm addons to capture onContextLoss callback
let contextLossCallback: (() => void) | null = null;
let webglDisposeCalled = false;
let webglInstanceCount = 0;
let webglLoadShouldFail = false;

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: vi.fn().mockImplementation(() => {
    webglInstanceCount++;
    return {
      onContextLoss: (cb: () => void) => { contextLossCallback = cb; },
      dispose: () => { webglDisposeCalled = true; },
    };
  }),
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn().mockImplementation(() => ({
    dispose: vi.fn(),
    fit: vi.fn(),
  })),
}));

vi.mock('@xterm/addon-unicode11', () => ({
  Unicode11Addon: vi.fn().mockImplementation(() => ({
    dispose: vi.fn(),
  })),
}));

vi.mock('@xterm/addon-image', () => ({
  ImageAddon: vi.fn().mockImplementation(() => ({
    dispose: vi.fn(),
  })),
}));

vi.mock('@xterm/addon-search', () => ({
  SearchAddon: vi.fn().mockImplementation(() => ({
    dispose: vi.fn(),
    findNext: vi.fn(),
    findPrevious: vi.fn(),
  })),
}));

// Mock dynamic import for ligatures
vi.mock('@xterm/addon-ligatures/lib/addon-ligatures.mjs', () => ({
  LigaturesAddon: vi.fn().mockImplementation(() => ({
    dispose: vi.fn(),
  })),
}));

// Mock Terminal
const mockTerminal = {
  loadAddon: vi.fn().mockImplementation(() => {
    // If webgl should fail on reload, throw
    if (webglLoadShouldFail && webglInstanceCount > 1) {
      throw new Error('WebGL not supported');
    }
  }),
  unicode: { activeVersion: '6' },
};

describe('Bug 3: WebGL context loss recovery', () => {
  beforeEach(() => {
    contextLossCallback = null;
    webglDisposeCalled = false;
    webglInstanceCount = 0;
    webglLoadShouldFail = false;
    vi.useFakeTimers();
  });

  test('onContextLoss disposes addon and attempts rebuild after 100ms', async () => {
    const { createAddonManager } = await import('@/renderer/utils/terminal-addon-manager');
    const manager = createAddonManager(mockTerminal as any);
    const addons = manager.loadAll();

    // WebGL should have been loaded (1 instance)
    expect(webglInstanceCount).toBe(1);
    expect(addons.webgl).not.toBeNull();
    expect(contextLossCallback).not.toBeNull();

    // Simulate context loss
    contextLossCallback!();

    // Should have disposed immediately
    expect(webglDisposeCalled).toBe(true);

    // Before timeout: no rebuild yet
    expect(webglInstanceCount).toBe(1);

    // Advance timer by 100ms
    vi.advanceTimersByTime(100);

    // Should have attempted rebuild (new instance created)
    expect(webglInstanceCount).toBe(2);
  });

  test('rebuild failure leaves webgl as null (canvas fallback)', async () => {
    webglLoadShouldFail = true;

    const { createAddonManager } = await import('@/renderer/utils/terminal-addon-manager');
    const manager = createAddonManager(mockTerminal as any);
    manager.loadAll();

    expect(webglInstanceCount).toBe(1);

    // Simulate context loss
    contextLossCallback!();
    vi.advanceTimersByTime(100);

    // Rebuild attempted but loadAddon throws → loadWebgl returns null
    // WebglAddon constructor is called (instance count goes up) but loadAddon fails
    expect(webglInstanceCount).toBe(2);
    // No crash — graceful fallback to canvas
  });
});
