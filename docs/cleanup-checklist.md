# 旧代码删除清单

## 文件: src/shared/types/chat.types.ts
- 行号 22-23: `sessionId?: string` — HistoryEntry 的 sessionId 标记为可选（`?`），注释说明 "optional for backward compatibility with older entries"。应改为必选字段 `sessionId: string`，删除可选标记和兼容性注释。

## 文件: src/main/services/chat-dual-source.ts
- 行号 127-128: `const entries = (parsed.entries as HistoryEntry[]).filter(e => e.sessionId);` — CC 主源读取后过滤无 sessionId 的旧格式条目。sessionId 必选后此 filter 应删除。
- 行号 139-140: `const entries = (parsed.entries as HistoryEntry[]).filter(e => e.sessionId);` — mirror 回退源读取后同样的兼容性过滤。sessionId 必选后此 filter 应删除。

## 文件: src/main/ipc/chat-handlers.ts
- 行号 53: `const projectHash = params.projectHash || 'default';` — getSession 中 projectHash 使用 `'default'` 作为 fallback。应将 projectHash 改为必传参数，删除 `|| 'default'` fallback。
- 行号 51: `async getSession(params: { sessionId: string; projectHash?: string })` — projectHash 参数标记为可选（`?`），应改为必选。
- 行号 79: `sessionId: e.sessionId || '',` — search 方法中对 sessionId 的空字符串 fallback，sessionId 必选后应直接使用 `e.sessionId`。
- 行号 91: `const projectHash = params.projectHash || 'default';` — export 方法中同样的 `'default'` fallback，应删除。
- 行号 86: `async export(params: { sessionId: string; format: string; projectHash?: string })` — projectHash 参数标记为可选，应改为必选。
- 行号 145: `ipcMain.handle(IPC_CHANNELS.CHAT.GET_SESSION, async (_event, params: { sessionId: string; projectHash?: string })` — registerChatHandlers 中 projectHash 也标记为可选，应同步改为必选。

## 文件: src/renderer/components/chat/ProjectList.tsx
- 行号 43-85: `useEffect` 中独立调用 `window.api.chat.getHistory()` — ProjectList 组件自行调用 getHistory() 获取数据并在本地进行分组处理。这属于独立调用逻辑，应改为从父组件/store 接收已加载的数据，避免重复请求。
- 行号 56: `projectMap.get(session.project)!.add(session.sessionId);` — 此处直接使用 `session.sessionId`，但类型定义中 sessionId 为可选，存在类型安全隐患（在 sessionId 改为必选后此问题自动消除）。

## 文件: src/renderer/stores/chat-panel.ts
- 行号 18-21: 硬编码 mock session 数据 `allSessions` — 两条固定的测试 session 数据，应删除并替换为从 IPC 获取的真实数据。
- 行号 23-25: 硬编码 mock 搜索结果 `mockSearchResults` — 固定的模拟搜索结果，应删除并替换为调用 `window.api.chat.search()` 的真实逻辑。
- 行号 47: `get totalSessionCount() { return allSessions.length; }` — 依赖硬编码数据的 getter，需改为使用真实数据源。
- 行号 49-54: `get filteredSessions()` — 基于硬编码 `allSessions` 做过滤，需改为使用真实数据源。
- 行号 79-91: `async search(query: string)` — search 方法使用模拟逻辑（检查魔术字符串 `'xyznonexistent999'`），应替换为调用真实 IPC search API。

## 文件: src/preload/index.ts
- 行号 114-115: `getSession: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.CHAT.GET_SESSION, { sessionId })` — getSession 只传 sessionId，不传 projectHash。应修改为同时传递 projectHash 参数：`getSession: (sessionId: string, projectHash: string) => ipcRenderer.invoke(IPC_CHANNELS.CHAT.GET_SESSION, { sessionId, projectHash })`。
- 行号 128-129: `export: (sessionId: string, format: string) => ipcRenderer.invoke(IPC_CHANNELS.CHAT.EXPORT, { sessionId, format })` — export 也未传递 projectHash，应添加 projectHash 参数。
