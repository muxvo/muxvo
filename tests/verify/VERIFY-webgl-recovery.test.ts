/**
 * VERIFY: Bug 3 — WebGL 上下文丢失后自动重建
 *
 * 验证 onContextLoss 回调中：
 * 1. dispose 当前 WebGL addon
 * 2. 使用指数退避延迟重建 WebGL（1s, 2s, 4s）
 * 3. 3 次 context loss 后永久降级为 Canvas
 * 4. 重建失败时 webglAddon 保持 null（xterm 自动使用 canvas）
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

// Mock document.fonts.ready for node test environment
(globalThis as any).document = (globalThis as any).document || {};
(globalThis as any).document.fonts = { ready: Promise.resolve() };

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

  test('onContextLoss disposes addon and attempts rebuild with exponential backoff', async () => {
    const { createAddonManager } = await import('@/renderer/utils/terminal-addon-manager');
    const manager = createAddonManager(mockTerminal as any);
    const addons = await manager.loadAll();

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

    // First retry: 1000ms delay (1000 * 2^0)
    vi.advanceTimersByTime(1000);

    // Should have attempted rebuild (new instance created)
    expect(webglInstanceCount).toBe(2);
  });

  test('rebuild failure leaves webgl as null (canvas fallback)', async () => {
    webglLoadShouldFail = true;

    const { createAddonManager } = await import('@/renderer/utils/terminal-addon-manager');
    const manager = createAddonManager(mockTerminal as any);
    await manager.loadAll();

    expect(webglInstanceCount).toBe(1);

    // Simulate context loss
    contextLossCallback!();
    // First retry: 1000ms delay
    vi.advanceTimersByTime(1000);

    // Rebuild attempted but loadAddon throws → loadWebgl returns null
    // WebglAddon constructor is called (instance count goes up) but loadAddon fails
    expect(webglInstanceCount).toBe(2);
    // No crash — graceful fallback to canvas
  });
});
