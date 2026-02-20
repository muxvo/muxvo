/**
 * FS IPC Handlers
 *
 * Handles fs:read-dir, fs:read-file, fs:write-file IPC channels.
 */

import { ipcMain, dialog } from 'electron';
import { promises as fsp } from 'fs';
import { join, resolve, normalize } from 'path';
import { homedir, tmpdir } from 'os';
import { IPC_CHANNELS } from '@/shared/constants/channels';
import type {
  FileEntry,
  ReadDirRequest,
  ReadFileRequest,
  WriteFileRequest,
} from '@/shared/types/fs.types';

/** Directories where writeFile is allowed */
const WRITABLE_ROOTS = [
  join(homedir(), '.muxvo'),
  join(homedir(), '.claude'),
  tmpdir(),
];

/**
 * Check whether `targetPath` falls under one of the allowed writable roots.
 * Uses resolve + normalize to prevent path-traversal attacks.
 */
function isWritablePath(targetPath: string): boolean {
  const resolved = normalize(resolve(targetPath));
  return WRITABLE_ROOTS.some((root) => resolved.startsWith(normalize(resolve(root))));
}

export function createFsHandlers() {
  return {
    async readDir(params: ReadDirRequest): Promise<Record<string, unknown>> {
      try {
        const entries = await fsp.readdir(params.path, { withFileTypes: true });
        const fileEntries: FileEntry[] = entries.map((entry) => ({
          name: entry.name,
          path: join(params.path, entry.name),
          isDirectory: entry.isDirectory(),
        }));
        return { success: true, data: fileEntries };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const code = (err as NodeJS.ErrnoException).code ?? 'FS_ERROR';
        return { success: false, error: { code, message } };
      }
    },

    async readFile(params: ReadFileRequest): Promise<Record<string, unknown>> {
      try {
        if (params.encoding === 'base64') {
          const buffer = await fsp.readFile(params.path);
          return { success: true, data: { content: buffer.toString('base64'), encoding: 'base64' } };
        }
        const content = await fsp.readFile(params.path, 'utf-8');
        return { success: true, data: { content, encoding: 'utf-8' } };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const code = (err as NodeJS.ErrnoException).code ?? 'FS_ERROR';
        return { success: false, error: { code, message } };
      }
    },

    async writeFile(params: WriteFileRequest): Promise<Record<string, unknown>> {
      const resolved = normalize(resolve(params.path));

      if (!isWritablePath(resolved)) {
        // Allow overwriting files that already exist on disk (editor save semantics)
        try {
          await fsp.access(resolved);
        } catch {
          return {
            success: false,
            error: { code: 'PERMISSION_DENIED', message: 'Path is outside writable directories and file does not exist' },
          };
        }
      }

      try {
        // Atomic write: write to tmp file then rename
        const tmpPath = `${resolved}.muxvo-tmp-${Date.now()}`;
        await fsp.writeFile(tmpPath, params.content, 'utf-8');
        await fsp.rename(tmpPath, resolved);
        return { success: true };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const code = (err as NodeJS.ErrnoException).code ?? 'FS_ERROR';
        return { success: false, error: { code, message } };
      }
    },

    async selectDirectory(params?: { defaultPath?: string }): Promise<Record<string, unknown>> {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        defaultPath: params?.defaultPath,
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { success: false };
      }
      return { success: true, data: result.filePaths[0] };
    },
  };
}

// Legacy export for tests
export const fsHandlers = createFsHandlers();

/**
 * Register FS IPC handlers with ipcMain.
 */
export function registerFsHandlers(): void {
  const handlers = createFsHandlers();

  ipcMain.handle(IPC_CHANNELS.FS.READ_DIR, async (_event, params: ReadDirRequest) => {
    return handlers.readDir(params);
  });

  ipcMain.handle(IPC_CHANNELS.FS.READ_FILE, async (_event, params: ReadFileRequest) => {
    return handlers.readFile(params);
  });

  ipcMain.handle(IPC_CHANNELS.FS.WRITE_FILE, async (_event, params: WriteFileRequest) => {
    return handlers.writeFile(params);
  });

  ipcMain.handle(IPC_CHANNELS.FS.SELECT_DIRECTORY, async (_event, params?: { defaultPath?: string }) => {
    return handlers.selectDirectory(params);
  });
}
