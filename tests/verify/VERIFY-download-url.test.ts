/**
 * VERIFY: useDownloadUrl hook — 架构检测 + URL 映射逻辑
 *
 * 测试 detectMacArch() 的 WebGL renderer 解析和 useDownloadUrl() 的返回值映射
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---- Mock WebGL ----

function mockWebGL(renderer: string | null) {
  const getParameter = vi.fn().mockReturnValue(renderer);
  const getExtension = vi.fn().mockReturnValue(
    renderer !== null
      ? { UNMASKED_RENDERER_WEBGL: 0x9246 }
      : null
  );
  const glContext = { getParameter, getExtension };

  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    if (tag === 'canvas') {
      return {
        getContext: vi.fn().mockReturnValue(glContext),
      } as any;
    }
    return document.createElement.call(document, tag);
  });
}

function mockWebGLUnavailable() {
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    if (tag === 'canvas') {
      return {
        getContext: vi.fn().mockReturnValue(null),
      } as any;
    }
    return document.createElement.call(document, tag);
  });
}

// ---- Mock React useMemo (pass-through) ----
vi.mock('react', () => ({
  useMemo: (fn: () => any) => fn(),
}));

describe('VERIFY: useDownloadUrl', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('detectMacArch via useDownloadUrl', () => {
    it('detects Apple Silicon (Apple M1)', async () => {
      mockWebGL('Apple M1');
      const { useDownloadUrl } = await import('@/../../web/src/hooks/useDownloadUrl');
      const result = useDownloadUrl();
      expect(result.url).toBe('https://muxvo.com/download/Muxvo-arm64.dmg');
      expect(result.archLabel).toBe('Apple Silicon');
      expect(result.altUrl).toBe('https://muxvo.com/download/Muxvo-x64.dmg');
      expect(result.altLabel).toBe('Intel');
    });

    it('detects Apple Silicon (Apple M2 Pro)', async () => {
      mockWebGL('Apple M2 Pro');
      const { useDownloadUrl } = await import('@/../../web/src/hooks/useDownloadUrl');
      const result = useDownloadUrl();
      expect(result.url).toBe('https://muxvo.com/download/Muxvo-arm64.dmg');
      expect(result.arch).toBe('arm64');
    });

    it('detects Apple Silicon (Apple GPU)', async () => {
      mockWebGL('Apple GPU');
      const { useDownloadUrl } = await import('@/../../web/src/hooks/useDownloadUrl');
      const result = useDownloadUrl();
      expect(result.url).toBe('https://muxvo.com/download/Muxvo-arm64.dmg');
    });

    it('detects Intel Mac', async () => {
      mockWebGL('Intel(R) UHD Graphics 630');
      const { useDownloadUrl } = await import('@/../../web/src/hooks/useDownloadUrl');
      const result = useDownloadUrl();
      expect(result.url).toBe('https://muxvo.com/download/Muxvo-x64.dmg');
      expect(result.arch).toBe('x64');
      expect(result.archLabel).toBe('Intel');
      expect(result.altUrl).toBe('https://muxvo.com/download/Muxvo-arm64.dmg');
      expect(result.altLabel).toBe('Apple Silicon');
    });

    it('detects Intel Mac (Iris Plus)', async () => {
      mockWebGL('Intel(R) Iris(TM) Plus Graphics 655');
      const { useDownloadUrl } = await import('@/../../web/src/hooks/useDownloadUrl');
      const result = useDownloadUrl();
      expect(result.url).toBe('https://muxvo.com/download/Muxvo-x64.dmg');
      expect(result.arch).toBe('x64');
    });

    it('defaults to arm64 when WebGL unavailable', async () => {
      mockWebGLUnavailable();
      const { useDownloadUrl } = await import('@/../../web/src/hooks/useDownloadUrl');
      const result = useDownloadUrl();
      expect(result.url).toBe('https://muxvo.com/download/Muxvo-arm64.dmg');
      expect(result.arch).toBe('unknown');
      expect(result.archLabel).toBe('Apple Silicon');
    });

    it('defaults to arm64 when renderer is AMD (external GPU)', async () => {
      mockWebGL('AMD Radeon Pro 5500M');
      const { useDownloadUrl } = await import('@/../../web/src/hooks/useDownloadUrl');
      const result = useDownloadUrl();
      // AMD GPU 无法确定架构，默认 arm64
      expect(result.url).toBe('https://muxvo.com/download/Muxvo-arm64.dmg');
      expect(result.arch).toBe('unknown');
    });

    it('defaults to arm64 when WEBGL_debug_renderer_info unavailable', async () => {
      // Mock getExtension returning null
      const glContext = {
        getParameter: vi.fn(),
        getExtension: vi.fn().mockReturnValue(null),
      };
      vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        if (tag === 'canvas') {
          return { getContext: vi.fn().mockReturnValue(glContext) } as any;
        }
        return document.createElement.call(document, tag);
      });

      const { useDownloadUrl } = await import('@/../../web/src/hooks/useDownloadUrl');
      const result = useDownloadUrl();
      expect(result.url).toBe('https://muxvo.com/download/Muxvo-arm64.dmg');
    });
  });

  describe('URL constants', () => {
    it('arm64 URL points to Muxvo-arm64.dmg', async () => {
      mockWebGL('Apple M1');
      const { useDownloadUrl } = await import('@/../../web/src/hooks/useDownloadUrl');
      const result = useDownloadUrl();
      expect(result.url).toMatch(/Muxvo-arm64\.dmg$/);
    });

    it('x64 URL points to Muxvo-x64.dmg', async () => {
      mockWebGL('Intel(R) UHD Graphics 630');
      const { useDownloadUrl } = await import('@/../../web/src/hooks/useDownloadUrl');
      const result = useDownloadUrl();
      expect(result.url).toMatch(/Muxvo-x64\.dmg$/);
    });

    it('altUrl is always the opposite architecture', async () => {
      mockWebGL('Apple M1');
      const m1 = await import('@/../../web/src/hooks/useDownloadUrl');
      const r1 = m1.useDownloadUrl();
      expect(r1.altArch).toBe('x64');

      vi.restoreAllMocks();
      mockWebGL('Intel(R) UHD Graphics 630');
      const m2 = await import('@/../../web/src/hooks/useDownloadUrl');
      const r2 = m2.useDownloadUrl();
      expect(r2.altArch).toBe('arm64');
    });
  });
});
