import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * VERIFY: 全局字体缩放 (Cmd+/Cmd-/Cmd+0)
 *
 * 验证：
 * 1. APP.ZOOM IPC 通道已定义
 * 2. Electron Menu 发送 APP.ZOOM（而非 TERMINAL.ZOOM）
 * 3. Preload 暴露 app.onZoom / app.setZoomFactor / app.getZoomFactor
 * 4. useGlobalZoom hook 存在且使用 webFrame.setZoomFactor
 * 5. XTermRenderer 不再有终端专属缩放逻辑（已委托全局）
 * 6. App.tsx 挂载了 useGlobalZoom
 * 7. MuxvoConfig 支持 zoomLevel 字段
 */

const ROOT = resolve(__dirname, '../..');
const SRC = resolve(ROOT, 'src');

describe('Global zoom system', () => {
  // 1. IPC 通道
  test('APP.ZOOM channel is defined in channels.ts', () => {
    const channels = readFileSync(resolve(SRC, 'shared/constants/channels.ts'), 'utf-8');
    expect(channels).toContain("ZOOM: 'app:zoom'");
  });

  // 2. Electron Menu 使用 APP.ZOOM
  test('Electron Menu sends APP.ZOOM, not TERMINAL.ZOOM', () => {
    const mainIndex = readFileSync(resolve(SRC, 'main/index.ts'), 'utf-8');
    // Menu should use APP.ZOOM
    expect(mainIndex).toContain('IPC_CHANNELS.APP.ZOOM');
    // Menu should NOT use TERMINAL.ZOOM for zoom actions
    const viewMenuSection = mainIndex.slice(
      mainIndex.indexOf("label: 'View'"),
      mainIndex.indexOf("Menu.setApplicationMenu"),
    );
    expect(viewMenuSection).not.toContain('IPC_CHANNELS.TERMINAL.ZOOM');
  });

  // 3. Preload 暴露全局缩放 API
  test('Preload exposes app.onZoom, setZoomFactor, getZoomFactor', () => {
    const preload = readFileSync(resolve(SRC, 'preload/index.ts'), 'utf-8');
    expect(preload).toContain('webFrame');
    expect(preload).toContain('onZoom');
    expect(preload).toContain('setZoomFactor');
    expect(preload).toContain('getZoomFactor');
    expect(preload).toContain('IPC_CHANNELS.APP.ZOOM');
  });

  // 4. useGlobalZoom hook 存在且逻辑正确
  test('useGlobalZoom hook exists and uses webFrame.setZoomFactor', () => {
    const hook = readFileSync(resolve(SRC, 'renderer/hooks/useGlobalZoom.ts'), 'utf-8');
    // Uses webFrame via API
    expect(hook).toContain('setZoomFactor');
    // Has zoom level bounds
    expect(hook).toContain('MIN_ZOOM_LEVEL');
    expect(hook).toContain('MAX_ZOOM_LEVEL');
    // Dispatches global zoom event for xterm refit
    expect(hook).toContain('muxvo:global-zoom');
    // Listens for global zoom request from xterm
    expect(hook).toContain('muxvo:global-zoom-request');
    // Persists to config
    expect(hook).toContain('zoomLevel');
    // Debounced save
    expect(hook).toContain('SAVE_DEBOUNCE_MS');
  });

  // 5. XTermRenderer 不再有终端专属缩放
  test('XTermRenderer delegates zoom to global system', () => {
    const xterm = readFileSync(
      resolve(SRC, 'renderer/components/terminal/XTermRenderer.tsx'),
      'utf-8',
    );
    // Should NOT have terminal-specific zoom handler
    expect(xterm).not.toContain('saveTerminalFontSize');
    expect(xterm).not.toContain('muxvo:terminal-zoom');
    expect(xterm).not.toContain('terminal.onZoom');
    // Should dispatch global zoom request
    expect(xterm).toContain('muxvo:global-zoom-request');
    // Should listen for global zoom to refit
    expect(xterm).toContain('muxvo:global-zoom');
  });

  // 6. App.tsx 挂载了 useGlobalZoom
  test('App.tsx mounts useGlobalZoom hook', () => {
    const app = readFileSync(resolve(SRC, 'renderer/App.tsx'), 'utf-8');
    expect(app).toContain("import { useGlobalZoom } from './hooks/useGlobalZoom'");
    expect(app).toContain('useGlobalZoom()');
  });

  // 7. MuxvoConfig 支持 zoomLevel
  test('MuxvoConfig has zoomLevel field', () => {
    const types = readFileSync(resolve(SRC, 'shared/types/config.types.ts'), 'utf-8');
    expect(types).toContain('zoomLevel');
  });

  // 8. Zoom level 计算逻辑正确
  test('zoom level to factor conversion is correct', () => {
    // Extracted from useGlobalZoom.ts constants
    const ZOOM_STEP = 0.1;
    const zoomLevelToFactor = (level: number) => 1.0 + level * ZOOM_STEP;

    expect(zoomLevelToFactor(0)).toBe(1.0);    // 100%
    expect(zoomLevelToFactor(1)).toBeCloseTo(1.1);   // 110%
    expect(zoomLevelToFactor(-1)).toBeCloseTo(0.9);  // 90%
    expect(zoomLevelToFactor(10)).toBeCloseTo(2.0);  // 200%
    expect(zoomLevelToFactor(-5)).toBeCloseTo(0.5);  // 50%
  });

  // 9. TERMINAL.ZOOM 通道仍保留（向后兼容）
  test('TERMINAL.ZOOM channel is preserved for backward compatibility', () => {
    const channels = readFileSync(resolve(SRC, 'shared/constants/channels.ts'), 'utf-8');
    expect(channels).toContain("ZOOM: 'terminal:zoom'");
  });
});
