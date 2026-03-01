/**
 * Terminal Addon Manager Tests
 *
 * Covers: createAddonManager interface, WebGL silent fallback, Unicode11 activation
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';

// Mock xterm.js modules since they require a browser environment
vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn(),
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn().mockImplementation(() => ({
    dispose: vi.fn(),
  })),
}));

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: vi.fn().mockImplementation(() => ({
    onContextLoss: vi.fn(),
    dispose: vi.fn(),
  })),
}));

vi.mock('@xterm/addon-unicode11', () => ({
  Unicode11Addon: vi.fn().mockImplementation(() => ({
    dispose: vi.fn(),
  })),
}));

vi.mock('@xterm/addon-ligatures/lib/addon-ligatures.mjs', () => ({
  LigaturesAddon: vi.fn().mockImplementation(() => ({
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
    findNext: vi.fn().mockReturnValue(false),
    findPrevious: vi.fn().mockReturnValue(false),
    clearDecorations: vi.fn(),
    dispose: vi.fn(),
  })),
}));

// Mock document.fonts.ready for node test environment
(globalThis as any).document = (globalThis as any).document || {};
(globalThis as any).document.fonts = { ready: Promise.resolve() };

function createMockTerminal() {
  return {
    loadAddon: vi.fn(),
    unicode: {
      activeVersion: '',
    },
  };
}

describe('Terminal Addon Manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('TERM_ADDON_01: createAddonManager returns correct interface', async () => {
    const { createAddonManager } = await import(
      '@/renderer/utils/terminal-addon-manager'
    );
    const term = createMockTerminal();
    const manager = createAddonManager(term as any);

    expect(typeof manager.loadAll).toBe('function');
    expect(typeof manager.disposeAll).toBe('function');
    expect(typeof manager.releaseWebgl).toBe('function');
    expect(typeof manager.getFitAddon).toBe('function');
    expect(typeof manager.getSearchAddon).toBe('function');

    const addons = await manager.loadAll();
    expect(addons).toHaveProperty('fit');
    expect(addons).toHaveProperty('webgl');
    expect(addons).toHaveProperty('unicode11');
    expect(addons).toHaveProperty('ligatures');
    expect(addons).toHaveProperty('image');
    expect(addons).toHaveProperty('search');
  });

  test('TERM_ADDON_02: WebGL failure silently falls back', async () => {
    // Make WebglAddon constructor throw
    const webglMod = await import('@xterm/addon-webgl');
    (webglMod.WebglAddon as any).mockImplementationOnce(() => {
      throw new Error('WebGL not supported');
    });

    const { createAddonManager } = await import(
      '@/renderer/utils/terminal-addon-manager'
    );
    const term = createMockTerminal();
    const manager = createAddonManager(term as any);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const addons = await manager.loadAll();

    expect(addons.webgl).toBeNull();
    expect(addons.fit).toBeTruthy();
    expect(addons.unicode11).toBeTruthy();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('WebGL addon failed to load'),
      expect.any(Error),
    );

    warnSpy.mockRestore();
  });

  test('TERM_ADDON_03: Unicode11 sets activeVersion to 11', async () => {
    const { createAddonManager } = await import(
      '@/renderer/utils/terminal-addon-manager'
    );
    const term = createMockTerminal();
    const manager = createAddonManager(term as any);

    await manager.loadAll();

    expect(term.unicode.activeVersion).toBe('11');
  });
});
