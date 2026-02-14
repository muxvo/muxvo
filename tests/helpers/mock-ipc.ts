/**
 * Electron IPC Mock 工具
 *
 * 模拟 Electron 的 ipcMain / ipcRenderer 通信。
 * 当源代码就绪后，替换为真实的 IPC 测试工具。
 *
 * IPC 域（共 10 个）：
 * - terminal:*     终端管理
 * - fs:*           文件系统
 * - chat:*         聊天历史
 * - config:*       配置管理
 * - app:*          应用生命周期
 * - marketplace:*  Skill 市场
 * - score:*        AI 评分
 * - showcase:*     展示页
 * - auth:*         用户认证
 * - analytics:*    数据分析
 */

// --- Types ---

export interface IpcMessage {
  channel: string;
  args: unknown[];
}

export interface IpcResponse {
  success: boolean;
  data?: unknown;
  error?: { code: string; message: string };
}

// --- Mock IPC Handler ---

type IpcHandler = (event: unknown, ...args: unknown[]) => Promise<IpcResponse> | IpcResponse;

const handlers = new Map<string, IpcHandler>();
const pushListeners = new Map<string, Set<(...args: unknown[]) => void>>();
const sentMessages: IpcMessage[] = [];

/** Register a handler for an IPC channel (simulates ipcMain.handle) */
export function handleIpc(channel: string, handler: IpcHandler): void {
  handlers.set(channel, handler);
}

/** Invoke an IPC channel (simulates ipcRenderer.invoke) */
export async function invokeIpc(channel: string, ...args: unknown[]): Promise<IpcResponse> {
  sentMessages.push({ channel, args });
  const handler = handlers.get(channel);
  if (!handler) {
    return { success: false, error: { code: 'NO_HANDLER', message: `No handler for ${channel}` } };
  }
  return handler(null, ...args);
}

/** Register a push listener (simulates ipcRenderer.on) */
export function onIpcPush(channel: string, listener: (...args: unknown[]) => void): void {
  if (!pushListeners.has(channel)) {
    pushListeners.set(channel, new Set());
  }
  pushListeners.get(channel)!.add(listener);
}

/** Emit a push event (simulates ipcMain sending to renderer) */
export function emitIpcPush(channel: string, ...args: unknown[]): void {
  const listeners = pushListeners.get(channel);
  if (listeners) {
    listeners.forEach((fn) => fn(...args));
  }
}

/** Get all sent messages (for assertions) */
export function getSentMessages(): IpcMessage[] {
  return [...sentMessages];
}

/** Reset all mocks */
export function resetIpcMocks(): void {
  handlers.clear();
  pushListeners.clear();
  sentMessages.length = 0;
}
