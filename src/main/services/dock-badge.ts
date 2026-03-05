import { app, nativeImage } from 'electron';
import { join } from 'path';
import type { DockBadgeMode } from '@/shared/types/config.types';

interface DockBadgeDeps {
  listTerminals: () => Array<{ state: string }>;
  getConfig: () => { mode: DockBadgeMode; intervalMin: number };
}

export function createDockBadgeService(deps: DockBadgeDeps) {
  let timerHandle: ReturnType<typeof setInterval> | null = null;
  let originalIcon: Electron.NativeImage | null = null;
  let lastBadgeCount = 0;

  /** 获取原始图标（懒加载并缓存） */
  function getOriginalIcon(): Electron.NativeImage {
    if (!originalIcon) {
      // dev 模式用 build/icon.icns，打包后用 app 自带图标
      const iconPath = app.isPackaged
        ? join(process.resourcesPath, 'icon.icns')
        : join(app.getAppPath(), 'build', 'icon.icns');
      originalIcon = nativeImage.createFromPath(iconPath);
      console.log('[DOCK-BADGE] loaded icon from', iconPath, 'empty=', originalIcon.isEmpty());
    }
    return originalIcon;
  }

  /** 用 Canvas 在图标右上角绘制红色角标 */
  function createBadgeIcon(count: number): Electron.NativeImage {
    const icon = getOriginalIcon();
    const size = 128;
    const img = icon.resize({ width: size, height: size });
    const bitmap = img.toBitmap();

    // 创建 RGBA buffer 并绘制角标
    const buf = Buffer.from(bitmap);

    // 绘制红色圆形角标（右上角）
    const badgeRadius = count > 9 ? 22 : 18;
    const cx = size - badgeRadius - 4;
    const cy = badgeRadius + 4;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - cx;
        const dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= badgeRadius) {
          const idx = (y * size + x) * 4;
          if (dist > badgeRadius - 1.5) {
            // 边缘抗锯齿
            const alpha = Math.max(0, Math.min(1, badgeRadius - dist));
            buf[idx] = Math.round(239 * alpha + buf[idx] * (1 - alpha));     // R
            buf[idx + 1] = Math.round(68 * alpha + buf[idx + 1] * (1 - alpha));  // G
            buf[idx + 2] = Math.round(68 * alpha + buf[idx + 2] * (1 - alpha));  // B
            buf[idx + 3] = Math.max(buf[idx + 3], Math.round(255 * alpha));  // A
          } else {
            buf[idx] = 239;     // R - #ef4444
            buf[idx + 1] = 68;  // G
            buf[idx + 2] = 68;  // B
            buf[idx + 3] = 255; // A
          }
        }
      }
    }

    // 绘制白色数字（简单的像素字体）
    const text = count > 99 ? '99+' : String(count);
    drawWhiteText(buf, size, cx, cy, text);

    return nativeImage.createFromBuffer(buf, { width: size, height: size });
  }

  /** 简易像素字体绘制白色文字 */
  function drawWhiteText(buf: Buffer, size: number, cx: number, cy: number, text: string): void {
    // 使用 5x7 像素字体的数字定义
    const font: Record<string, number[]> = {
      '0': [0x7C, 0xC6, 0xCE, 0xD6, 0xE6, 0xC6, 0x7C],
      '1': [0x30, 0x70, 0x30, 0x30, 0x30, 0x30, 0xFC],
      '2': [0x78, 0xCC, 0x0C, 0x38, 0x60, 0xCC, 0xFC],
      '3': [0x78, 0xCC, 0x0C, 0x38, 0x0C, 0xCC, 0x78],
      '4': [0x1C, 0x3C, 0x6C, 0xCC, 0xFE, 0x0C, 0x0C],
      '5': [0xFC, 0xC0, 0xF8, 0x0C, 0x0C, 0xCC, 0x78],
      '6': [0x38, 0x60, 0xC0, 0xF8, 0xCC, 0xCC, 0x78],
      '7': [0xFC, 0xCC, 0x0C, 0x18, 0x30, 0x30, 0x30],
      '8': [0x78, 0xCC, 0xCC, 0x78, 0xCC, 0xCC, 0x78],
      '9': [0x78, 0xCC, 0xCC, 0x7C, 0x0C, 0x18, 0x70],
      '+': [0x00, 0x30, 0x30, 0xFC, 0x30, 0x30, 0x00],
    };

    const charWidth = 8;
    const charHeight = 7;
    const totalWidth = text.length * charWidth;
    const startX = cx - Math.floor(totalWidth / 2);
    const startY = cy - Math.floor(charHeight / 2);

    for (let ci = 0; ci < text.length; ci++) {
      const glyph = font[text[ci]];
      if (!glyph) continue;
      const ox = startX + ci * charWidth;
      for (let row = 0; row < charHeight; row++) {
        const bits = glyph[row];
        for (let col = 0; col < 8; col++) {
          if (bits & (0x80 >> col)) {
            const px = ox + col;
            const py = startY + row;
            if (px >= 0 && px < size && py >= 0 && py < size) {
              const idx = (py * size + px) * 4;
              buf[idx] = 255;     // R
              buf[idx + 1] = 255; // G
              buf[idx + 2] = 255; // B
              buf[idx + 3] = 255; // A
            }
          }
        }
      }
    }
  }

  function updateBadge(): void {
    if (process.platform !== 'darwin') return;
    const { mode } = deps.getConfig();
    if (mode === 'off') {
      clearBadge();
      return;
    }
    const terminals = deps.listTerminals();
    const count = terminals.filter((t) => t.state === 'WaitingInput').length;

    if (count === lastBadgeCount) return; // 避免重复设置
    lastBadgeCount = count;

    console.log(`[DOCK-BADGE] updateBadge: mode=${mode} waiting=${count}`);

    try {
      if (count > 0) {
        const badgeIcon = createBadgeIcon(count);
        app.dock.setIcon(badgeIcon);
      } else {
        // 恢复原始图标
        app.dock.setIcon(getOriginalIcon());
      }
    } catch (err) {
      console.error('[DOCK-BADGE] setIcon ERROR:', err);
    }
  }

  function clearBadge(): void {
    if (lastBadgeCount === 0) return;
    lastBadgeCount = 0;
    try {
      app.dock.setIcon(getOriginalIcon());
    } catch (err) {
      console.error('[DOCK-BADGE] clearBadge ERROR:', err);
    }
  }

  function onStateChange(): void {
    const { mode } = deps.getConfig();
    if (mode === 'realtime') {
      updateBadge();
    }
  }

  function startTimer(): void {
    stopTimer();
    const { mode, intervalMin } = deps.getConfig();
    if (mode !== 'timed') return;
    const ms = Math.max(1, Math.min(30, intervalMin)) * 60 * 1000;
    timerHandle = setInterval(updateBadge, ms);
  }

  function stopTimer(): void {
    if (timerHandle) {
      clearInterval(timerHandle);
      timerHandle = null;
    }
  }

  function reconfigure(): void {
    const { mode } = deps.getConfig();
    console.log(`[DOCK-BADGE] reconfigure: mode=${mode}`);
    stopTimer();
    lastBadgeCount = -1; // 强制刷新
    if (mode === 'off') {
      clearBadge();
    } else if (mode === 'timed') {
      startTimer();
      updateBadge();
    } else if (mode === 'realtime') {
      updateBadge();
    }
  }

  function dispose(): void {
    stopTimer();
    clearBadge();
  }

  return { onStateChange, reconfigure, dispose };
}
