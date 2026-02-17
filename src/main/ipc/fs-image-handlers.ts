/**
 * FS Image IPC Handlers
 *
 * Handles fs:write-temp-image and fs:write-clipboard-image IPC channels.
 */

import { ipcMain } from 'electron';
import { promises as fsp } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { IPC_CHANNELS } from '@/shared/constants/channels';
import type { WriteTempImageRequest, WriteClipboardImageRequest } from '@/shared/types/fs.types';

/** Simple UUID v4 generator */
function generateUuid(): string {
  const hex = '0123456789abcdef';
  let uuid = '';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      uuid += '-';
    } else if (i === 14) {
      uuid += '4';
    } else if (i === 19) {
      uuid += hex[(Math.random() * 4) | 8];
    } else {
      uuid += hex[(Math.random() * 16) | 0];
    }
  }
  return uuid;
}

const TEMP_IMAGE_DIR = join(tmpdir(), 'muxvo-images');

export function createFsImageHandlers() {
  return {
    async writeTempImage(params: WriteTempImageRequest): Promise<Record<string, unknown>> {
      try {
        // Ensure temp image directory exists
        await fsp.mkdir(TEMP_IMAGE_DIR, { recursive: true });

        // Decode base64 image data
        const buffer = Buffer.from(params.imageData, 'base64');
        const uuid = generateUuid();
        const filePath = join(TEMP_IMAGE_DIR, `${uuid}.${params.format}`);

        await fsp.writeFile(filePath, buffer);

        return { success: true, data: { filePath } };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { success: false, error: { code: 'WRITE_ERROR', message } };
      }
    },

    async writeClipboardImage(params: WriteClipboardImageRequest): Promise<Record<string, unknown>> {
      try {
        // Verify the image file exists
        await fsp.access(params.imagePath);

        // Return the path for the renderer to handle clipboard operations
        return { success: true, data: { filePath: params.imagePath } };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const code = (err as NodeJS.ErrnoException).code ?? 'FS_ERROR';
        return { success: false, error: { code, message } };
      }
    },
  };
}

export function registerFsImageHandlers(): void {
  const handlers = createFsImageHandlers();

  ipcMain.handle(IPC_CHANNELS.FS.WRITE_TEMP_IMAGE, async (_event, params: WriteTempImageRequest) => {
    return handlers.writeTempImage(params);
  });

  ipcMain.handle(IPC_CHANNELS.FS.WRITE_CLIPBOARD_IMAGE, async (_event, params: WriteClipboardImageRequest) => {
    return handlers.writeClipboardImage(params);
  });
}
