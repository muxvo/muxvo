/**
 * Muxvo — Preload Script
 * DEV-PLAN A1: contextBridge IPC 桥接
 *
 * Security model:
 *   contextIsolation: true
 *   nodeIntegration: false
 *
 * Exposes typed API groups to renderer via window.api
 * Each domain will be wired to real IPC handlers in subsequent tasks (A2, D1, G1, etc.)
 */

import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '@/shared/constants/channels';

/** Type-safe API exposed to renderer process */
const api = {
  // --- Terminal domain (A2 will wire real handlers) ---
  terminal: {
    create: (cwd: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.TERMINAL.CREATE, { cwd }),
    write: (id: string, data: string) =>
      ipcRenderer.send(IPC_CHANNELS.TERMINAL.WRITE, { id, data }),
    resize: (id: string, cols: number, rows: number) =>
      ipcRenderer.send(IPC_CHANNELS.TERMINAL.RESIZE, { id, cols, rows }),
    close: (id: string, force?: boolean) =>
      ipcRenderer.invoke(IPC_CHANNELS.TERMINAL.CLOSE, { id, force }),
    list: () =>
      ipcRenderer.invoke(IPC_CHANNELS.TERMINAL.LIST),
    getBuffer: (id: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.TERMINAL.GET_BUFFER, { id }),
    getState: (id: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.TERMINAL.GET_STATE, { id }),
    getForegroundProcess: (id: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.TERMINAL.GET_FOREGROUND_PROCESS, { id }),
    onOutput: (callback: (data: { id: string; data: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { id: string; data: string }) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.TERMINAL.OUTPUT, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.TERMINAL.OUTPUT, handler);
    },
    onStateChange: (callback: (data: { id: string; state: string; processName?: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { id: string; state: string; processName?: string }) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.TERMINAL.STATE_CHANGE, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.TERMINAL.STATE_CHANGE, handler);
    },
    onExit: (callback: (data: { id: string; code: number }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { id: string; code: number }) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.TERMINAL.EXIT, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.TERMINAL.EXIT, handler);
    },
    onListUpdated: (callback: (data: Array<{ id: string; state: string }>) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: Array<{ id: string; state: string }>) => callback(data);
      ipcRenderer.on('terminal:list-updated', handler);
      return () => ipcRenderer.removeListener('terminal:list-updated', handler);
    },
  },

  // --- App domain ---
  app: {
    getConfig: () =>
      ipcRenderer.invoke(IPC_CHANNELS.APP.GET_CONFIG),
    saveConfig: (config: Record<string, unknown>) =>
      ipcRenderer.invoke(IPC_CHANNELS.APP.SAVE_CONFIG, config),
    getPreferences: () =>
      ipcRenderer.invoke(IPC_CHANNELS.APP.GET_PREFERENCES),
    savePreferences: (prefs: Record<string, unknown>) =>
      ipcRenderer.invoke(IPC_CHANNELS.APP.SAVE_PREFERENCES, prefs),
    detectCliTools: () =>
      ipcRenderer.invoke(IPC_CHANNELS.APP.DETECT_CLI_TOOLS),
    onMemoryWarning: (callback: (data: { usage: number }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { usage: number }) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.APP.MEMORY_WARNING, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.APP.MEMORY_WARNING, handler);
    },
  },
};

contextBridge.exposeInMainWorld('api', api);

/** Export type for use in renderer */
export type MuxvoAPI = typeof api;
