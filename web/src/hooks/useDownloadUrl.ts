import { useMemo } from 'react';

type MacArch = 'arm64' | 'x64' | 'unknown';

const DOWNLOAD_URLS = {
  arm64: 'https://muxvo.com/download/Muxvo-arm64.dmg',
  x64: 'https://muxvo.com/download/Muxvo-x64.dmg',
} as const;

function detectMacArch(): MacArch {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (gl) {
      const debugExt = (gl as WebGLRenderingContext).getExtension('WEBGL_debug_renderer_info');
      if (debugExt) {
        const renderer = (gl as WebGLRenderingContext).getParameter(debugExt.UNMASKED_RENDERER_WEBGL);
        if (typeof renderer === 'string') {
          if (renderer.includes('Apple M') || renderer.includes('Apple GPU')) return 'arm64';
          if (renderer.includes('Intel')) return 'x64';
        }
      }
    }
  } catch {
    // WebGL not available
  }
  return 'unknown';
}

export function useDownloadUrl() {
  const arch = useMemo(() => detectMacArch(), []);

  if (arch === 'x64') {
    return {
      url: DOWNLOAD_URLS.x64,
      arch: 'x64' as const,
      archLabel: 'Intel',
      altUrl: DOWNLOAD_URLS.arm64,
      altArch: 'arm64' as const,
      altLabel: 'Apple Silicon',
    };
  }

  return {
    url: DOWNLOAD_URLS.arm64,
    arch: (arch === 'unknown' ? 'unknown' : 'arm64') as MacArch,
    archLabel: 'Apple Silicon',
    altUrl: DOWNLOAD_URLS.x64,
    altArch: 'x64' as const,
    altLabel: 'Intel',
  };
}
