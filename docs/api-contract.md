# Muxvo 前后端 API 接口文档

> 生成时间: 2026-02-17
> 数据来源: `src/shared/constants/channels.ts` + `src/preload/index.ts` + `src/shared/types/*.types.ts` + `src/main/ipc/*.ts` + `src/main/index.ts`

## 通用约定

### IPC 通信方向

| 标记 | 含义 | Electron API |
|------|------|-------------|
| **invoke** | 渲染进程 → 主进程（请求/响应） | `ipcRenderer.invoke` / `ipcMain.handle` |
| **send** | 渲染进程 → 主进程（单向发送） | `ipcRenderer.send` / `ipcMain.on` |
| **on** | 主进程 → 渲染进程（事件推送） | `webContents.send` / `ipcRenderer.on` |

### 统一响应格式

所有 `invoke` 类型接口的响应均遵循 `IPCResponse<T>` 包装：

```typescript
interface IPCError {
  code: string;      // 错误码，格式 "域.错误类型"（如 "terminal.spawn_failed"）
  message: string;   // 人类可读的错误描述
  details?: any;     // 可选附加信息
}

interface IPCResponse<T> {
  success: boolean;
  data?: T;
  error?: IPCError;
}
```

---

## 1. 终端管理 (terminal:\*)

### 1.1 invoke 接口（渲染进程 → 主进程）

| Channel | 前端 API | Request 类型 | Response 类型 |
|---------|----------|-------------|--------------|
| `terminal:create` | `window.api.terminal.create(cwd)` | `TerminalCreateRequest` | `IPCResponse<TerminalCreateResponse>` |
| `terminal:close` | `window.api.terminal.close(id, force?)` | `TerminalCloseRequest` | `IPCResponse<void>` |
| `terminal:list` | `window.api.terminal.list()` | 无 | `IPCResponse<TerminalInfo[]>` |
| `terminal:get-state` | `window.api.terminal.getState(id)` | `{ id: string }` | `IPCResponse<TerminalInfo>` |
| `terminal:get-foreground-process` | `window.api.terminal.getForegroundProcess(id)` | `{ id: string }` | `IPCResponse<ForegroundProcessInfo>` |
| `terminal:get-buffer` | `window.api.terminal.getBuffer(id)` | `{ id: string }` | `IPCResponse<string>` |
| `terminal:update-cwd` | `window.api.terminal.updateCwd(id, cwd)` | `{ id: string; cwd: string }` | `{ success: boolean }` |

### 1.2 send 接口（渲染进程 → 主进程，单向）

| Channel | 前端 API | Request 类型 |
|---------|----------|-------------|
| `terminal:write` | `window.api.terminal.write(id, data)` | `TerminalWriteRequest` |
| `terminal:resize` | `window.api.terminal.resize(id, cols, rows)` | `TerminalResizeRequest` |

### 1.3 on 事件（主进程 → 渲染进程推送）

| Channel | 前端 API | 事件数据类型 |
|---------|----------|-------------|
| `terminal:output` | `window.api.terminal.onOutput(cb)` | `TerminalOutputEvent` |
| `terminal:state-change` | `window.api.terminal.onStateChange(cb)` | `TerminalStateChangeEvent` |
| `terminal:exit` | `window.api.terminal.onExit(cb)` | `TerminalExitEvent` |
| `terminal:list-updated` | `window.api.terminal.onListUpdated(cb)` | `Array<{ id: string; state: string }>` |

### 1.4 类型定义

```typescript
enum TerminalState {
  Created = 'Created',
  Starting = 'Starting',
  Running = 'Running',
  Busy = 'Busy',
  WaitingInput = 'WaitingInput',
  Stopping = 'Stopping',
  Stopped = 'Stopped',
  Disconnected = 'Disconnected',
  Failed = 'Failed',
  Removed = 'Removed',
}

interface TerminalCreateRequest {
  cwd: string;
}

interface TerminalCreateResponse {
  id: string;
  pid: number;
}

interface TerminalWriteRequest {
  id: string;
  data: string;
}

interface TerminalResizeRequest {
  id: string;
  cols: number;
  rows: number;
}

interface TerminalCloseRequest {
  id: string;
  force?: boolean;
}

interface TerminalInfo {
  id: string;
  pid: number;
  cwd: string;
  state: TerminalState;
  processName?: string;
}

interface TerminalOutputEvent {
  id: string;
  data: string;
}

interface TerminalStateChangeEvent {
  id: string;
  state: TerminalState;
  processName?: string;
}

interface TerminalExitEvent {
  id: string;
  code: number;
}

interface ForegroundProcessInfo {
  name: string;
  pid: number;
}
```

---

## 2. 文件系统 (fs:\*)

### 2.1 invoke 接口（渲染进程 → 主进程）

| Channel | 前端 API | Request 类型 | Response 类型 |
|---------|----------|-------------|--------------|
| `fs:select-directory` | `window.api.fs.selectDirectory()` | 无 | `IPCResponse<string>` |
| `fs:read-file` | `window.api.fs.readFile(path)` | `ReadFileRequest` | `IPCResponse<ReadFileResponse>` |
| `fs:write-file` | `window.api.fs.writeFile(path, content)` | `WriteFileRequest` | `IPCResponse<void>` |
| `fs:read-dir` | *未在 preload 暴露* | `ReadDirRequest` | `IPCResponse<FileEntry[]>` |
| `fs:watch-start` | *未在 preload 暴露* | `WatchStartRequest` | `IPCResponse<void>` |
| `fs:watch-stop` | *未在 preload 暴露* | `WatchStopRequest` | `IPCResponse<void>` |
| `fs:write-temp-image` | *未在 preload 暴露* | `WriteTempImageRequest` | `IPCResponse<{ filePath: string }>` |
| `fs:write-clipboard-image` | *未在 preload 暴露* | `WriteClipboardImageRequest` | `IPCResponse<{ action: string; keySent: string }>` |

### 2.2 on 事件（主进程 → 渲染进程推送）

| Channel | 前端 API | 事件数据类型 |
|---------|----------|-------------|
| `fs:change` | *未在 preload 暴露* | `FileChangeEvent` |

### 2.3 类型定义

```typescript
interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  modifiedAt?: string;
}

interface ReadDirRequest {
  path: string;
}

interface ReadFileRequest {
  path: string;
}

interface ReadFileResponse {
  content: string;
  encoding: string;
}

interface WriteFileRequest {
  path: string;
  content: string;
}

interface WatchStartRequest {
  id: string;
  paths: string[];
}

interface WatchStopRequest {
  id: string;
}

interface FileChangeEvent {
  path: string;
  event: 'add' | 'change' | 'unlink';
  isNew?: boolean;
}

interface SelectDirectoryResult {
  path: string;
}

interface WriteTempImageRequest {
  imageData: string;
  format: 'png' | 'jpg';
}

interface WriteClipboardImageRequest {
  imagePath: string;
}
```

---

## 3. 聊天历史 (chat:\*)

### 3.1 invoke 接口（渲染进程 → 主进程）

| Channel | 前端 API | Request 类型 | Response 类型 |
|---------|----------|-------------|--------------|
| `chat:get-history` | `window.api.chat.getHistory(params?)` | `ChatHistoryRequest` | `{ sessions: HistoryEntry[], source?: string, fallback?: boolean, hint?: string, error?: IPCError }` |
| `chat:get-session` | `window.api.chat.getSession(sessionId)` | `{ sessionId: string; projectHash?: string }` | `{ messages: SessionMessage[], source?: string, fallback?: boolean, hint?: string, error?: IPCError }` |
| `chat:search` | *未在 preload 暴露* | `{ query: string }` | `{ results: SearchResult[] }` |
| `chat:export` | *未在 preload 暴露* | `ChatExportRequest` | `ChatExportResponse` |

### 3.2 on 事件（主进程 → 渲染进程推送）

| Channel | 前端 API | 事件数据类型 |
|---------|----------|-------------|
| `chat:session-update` | `window.api.chat.onSessionUpdate(cb)` | `ChatSessionUpdateEvent` |
| `chat:sync-status` | `window.api.chat.onSyncStatus(cb)` | `ChatSyncStatus` |

### 3.3 类型定义

```typescript
interface ChatHistoryRequest {
  limit?: number;
  offset?: number;
}

interface HistoryEntry {
  display: string;
  pastedContents?: Record<string, unknown>;
  timestamp: number;
  project: string;
  sessionId?: string;
}

interface SessionMessage {
  type: 'user' | 'assistant';
  messageId: string;
  sessionId: string;
  timestamp: string;
  cwd: string;
  gitBranch?: string;
  message: {
    role: 'user' | 'assistant';
    content: string;
  };
}

interface SearchResult {
  project: string;
  sessionId: string;
  snippet: string;
  timestamp: number;
}

interface ChatSessionUpdateEvent {
  projectId: string;
  sessionId: string;
}

type ChatSyncStatus = 'syncing' | 'idle' | 'error';

interface ChatExportRequest {
  projectIds?: string[];
  format: 'markdown' | 'json';
  dateRange?: {
    start: string;
    end: string;
  };
}

interface ChatExportResponse {
  outputPath: string;
}
```

---

## 4. 配置管理 (config:\*)

### 4.1 invoke 接口（渲染进程 → 主进程）

| Channel | 前端 API | Request 类型 | Response 类型 |
|---------|----------|-------------|--------------|
| `config:get-resources` | *未在 preload 暴露* | `{ type?: ResourceType }` | `IPCResponse<Resource[]>` |
| `config:get-resource-content` | *未在 preload 暴露* | `{ path: string }` | `IPCResponse<string>` |
| `config:get-settings` | *未在 preload 暴露* | 无 | `IPCResponse<CCSettings>` |
| `config:save-settings` | *未在 preload 暴露* | `CCSettings` | `IPCResponse<void>` |
| `config:get-claude-md` | *未在 preload 暴露* | `ClaudeMdRequest` | `IPCResponse<string>` |
| `config:save-claude-md` | *未在 preload 暴露* | `{ scope: ClaudeMdScope; content: string; projectPath?: string }` | `IPCResponse<void>` |
| `config:get-memory` | *未在 preload 暴露* | 无 | `IPCResponse<string>` |

### 4.2 on 事件（主进程 → 渲染进程推送）

| Channel | 前端 API | 事件数据类型 |
|---------|----------|-------------|
| `config:resource-change` | *未在 preload 暴露* | `ResourceChangeEvent` |

### 4.3 类型定义

```typescript
type ResourceType = 'skills' | 'hooks' | 'plans' | 'tasks' | 'mcp' | 'plugins';

interface Resource {
  name: string;
  type: ResourceType;
  path: string;
  updatedAt?: string;
}

interface CCSettings {
  [key: string]: unknown;
}

type ClaudeMdScope = 'global' | 'project';

interface ClaudeMdRequest {
  scope: ClaudeMdScope;
  projectPath?: string;
}

interface ResourceChangeEvent {
  type: string;
  event: string;
  name: string;
}
```

---

## 5. 应用管理 (app:\*)

### 5.1 invoke 接口（渲染进程 → 主进程）

| Channel | 前端 API | Request 类型 | Response 类型 |
|---------|----------|-------------|--------------|
| `app:get-config` | `window.api.app.getConfig()` | 无 | `IPCResponse<MuxvoConfig>` |
| `app:save-config` | `window.api.app.saveConfig(config)` | `Record<string, unknown>` | `IPCResponse<MuxvoConfig>` |
| `app:get-preferences` | `window.api.app.getPreferences()` | 无 | `IPCResponse<UserPreferences>` |
| `app:save-preferences` | `window.api.app.savePreferences(prefs)` | `Record<string, unknown>` | `IPCResponse<void>` |
| `app:detect-cli-tools` | `window.api.app.detectCliTools()` | 无 | `IPCResponse<CLIToolsDetection>` |

### 5.2 同步 API（非 IPC）

| 方法 | 前端 API | 返回值 |
|------|----------|--------|
| `getHomePath` | `window.api.app.getHomePath()` | `string`（`HOME` 或 `USERPROFILE` 环境变量值） |

### 5.3 on 事件（主进程 → 渲染进程推送）

| Channel | 前端 API | 事件数据类型 |
|---------|----------|-------------|
| `app:memory-warning` | `window.api.app.onMemoryWarning(cb)` | `MemoryWarningEvent` |

### 5.4 类型定义

```typescript
interface OpenTerminalConfig {
  cwd: string;
  customName?: string;
  active?: boolean;
}

interface GridLayout {
  columnRatios: number[];
  rowRatios: number[];
}

interface MuxvoConfig {
  window: {
    width: number;
    height: number;
    x: number;
    y: number;
  };
  openTerminals: OpenTerminalConfig[];
  gridLayout: GridLayout;
  ftvLeftWidth?: number;
  ftvRightWidth?: number;
  theme: string;
  fontSize: number;
}

interface UserPreferences {
  [key: string]: unknown;
}

interface MemoryWarningEvent {
  usageMB: number;
  threshold: number;
}

interface CLIToolsDetection {
  claude: boolean;
  codex: boolean;
  gemini: boolean;
}
```

---

## 6. 包市场 (marketplace:\*)

### 6.1 invoke 接口（渲染进程 → 主进程）

| Channel | 前端 API | Request 类型 | Response 类型 |
|---------|----------|-------------|--------------|
| `marketplace:fetch-sources` | *未在 preload 暴露* | 无 | `IPCResponse<AggregatedPackage[]>` |
| `marketplace:search` | *未在 preload 暴露* | `{ query: string; type?: PackageType }` | `IPCResponse<AggregatedPackage[]>` |
| `marketplace:install` | *未在 preload 暴露* | `InstallRequest` | `IPCResponse<InstalledPackage>` |
| `marketplace:uninstall` | *未在 preload 暴露* | `{ name: string }` | `IPCResponse<void>` |
| `marketplace:get-installed` | *未在 preload 暴露* | 无 | `IPCResponse<InstalledPackage[]>` |
| `marketplace:check-updates` | *未在 preload 暴露* | 无 | `IPCResponse<UpdateInfo[]>` |

### 6.2 on 事件（主进程 → 渲染进程推送）

| Channel | 前端 API | 事件数据类型 |
|---------|----------|-------------|
| `marketplace:install-progress` | *未在 preload 暴露* | `InstallProgressEvent` |
| `marketplace:packages-loaded` | *未在 preload 暴露* | `PackagesLoadedEvent` |
| `marketplace:update-available` | *未在 preload 暴露* | `UpdateAvailableEvent` |

### 6.3 类型定义

```typescript
type PackageType = 'skill' | 'hook';

interface PackageVersion {
  version: string;
  changelog?: string;
  publishedAt: string;
  fileSize?: number;
  fileList?: string[];
}

interface PackageAuthor {
  username: string;
  avatarUrl?: string;
  badges?: string[];
}

interface PackageStats {
  downloads?: number;
  weeklyDownloads?: number;
  avgRating?: number;
  reviewCount?: number;
  favoriteCount?: number;
}

interface AggregatedPackage {
  id: string;
  name: string;
  type: PackageType;
  displayName?: string;
  description?: string;
  readme?: string;
  author?: PackageAuthor;
  category?: string;
  tags?: string[];
  license?: string;
  stats?: PackageStats;
  latestVersion?: string;
  versions?: PackageVersion[];
  createdAt?: string;
  updatedAt?: string;
}

interface InstalledPackage {
  name: string;
  type: PackageType;
  version: string;
  packageId?: string;
  source: string;
  sourceUrl?: string;
  installedAt: string;
  updatedAt?: string;
}

interface UpdateInfo {
  name: string;
  currentVersion: string;
  latestVersion: string;
  changelog?: string;
}

interface InstallRequest {
  name: string;
  source: string;
  type: PackageType;
  version?: string;
}

interface InstallProgressEvent {
  name: string;
  progress: number;
  status: string;
}

interface PackagesLoadedEvent {
  packages: AggregatedPackage[];
  source: string;
}

interface UpdateAvailableEvent {
  packages: UpdateInfo[];
}
```

---

## 7. AI 评分 (score:\*)

### 7.1 invoke 接口（渲染进程 → 主进程）

| Channel | 前端 API | Request 类型 | Response 类型 |
|---------|----------|-------------|--------------|
| `score:run` | *未在 preload 暴露* | `ScoreRunRequest` | `IPCResponse<SkillScore>` |
| `score:check-scorer` | *未在 preload 暴露* | 无 | `IPCResponse<ScorerCheckResult>` |
| `score:get-cached` | *未在 preload 暴露* | `{ skillDirName: string }` | `IPCResponse<SkillScore>` |

### 7.2 on 事件（主进程 → 渲染进程推送）

| Channel | 前端 API | 事件数据类型 |
|---------|----------|-------------|
| `score:progress` | *未在 preload 暴露* | `ScoreProgressEvent` |
| `score:result` | *未在 preload 暴露* | `ScoreResultEvent` |

### 7.3 类型定义

```typescript
type ScoreDimension =
  | 'practicality'
  | 'engineering'
  | 'intentClarity'
  | 'designCleverness'
  | 'documentation'
  | 'reusability';

interface DimensionScore {
  score: number;
  reason: string;
}

type ScoreGrade =
  | 'Promising'     // 0-39
  | 'Solid'         // 40-59
  | 'Advanced'      // 60-79
  | 'Expert'        // 80-94
  | 'Masterwork';   // 95-100

interface SkillScore {
  version: number;
  skillDirName: string;
  contentHash: string;
  scores: Record<ScoreDimension, DimensionScore>;
  total: number;
  grade: ScoreGrade;
  title: string;
  suggestions: string[];
  scoredAt: string;
  apiModel?: string;
  promptVersion?: string;
}

interface ScoreRunRequest {
  skillDirName: string;
  includeAnalytics?: boolean;
}

interface ScorerCheckResult {
  installed: boolean;
  version?: string;
}

interface ScoreProgressEvent {
  skillDirName: string;
  status: string;
}

interface ScoreResultEvent {
  skillDirName: string;
  score: SkillScore;
}
```

---

## 8. Showcase 展示 (showcase:\*)

### 8.1 invoke 接口（渲染进程 → 主进程）

| Channel | 前端 API | Request 类型 | Response 类型 |
|---------|----------|-------------|--------------|
| `showcase:generate` | *未在 preload 暴露* | `ShowcaseGenerateRequest` | `IPCResponse<ShowcaseConfig>` |
| `showcase:publish` | *未在 preload 暴露* | `ShowcasePublishRequest` | `IPCResponse<ShowcasePublishResult>` |
| `showcase:unpublish` | *未在 preload 暴露* | `{ skillDirName: string }` | `IPCResponse<void>` |

### 8.2 on 事件（主进程 → 渲染进程推送）

| Channel | 前端 API | 事件数据类型 |
|---------|----------|-------------|
| `showcase:publish-result` | *未在 preload 暴露* | `ShowcasePublishResultEvent` |

### 8.3 类型定义

```typescript
type ShowcaseTemplate = 'developer-dark' | 'minimal-light' | 'vibrant';

interface ShowcaseHero {
  title: string;
  tagline: string;
}

interface ShowcaseProblemSolution {
  problem: string;
  solution: string;
}

interface ShowcaseFeature {
  icon: string;
  title: string;
  description: string;
}

interface ShowcaseDemo {
  type: string;
  url: string;
  caption?: string;
}

interface ShowcasePublishInfo {
  status: string;
  publishedAt?: string;
  url?: string;
  githubRepo?: string;
}

interface ShowcaseConfig {
  version: number;
  skillDirName: string;
  template: ShowcaseTemplate;
  hero: ShowcaseHero;
  problemSolution?: ShowcaseProblemSolution;
  features?: ShowcaseFeature[];
  demos?: ShowcaseDemo[];
  tags?: string[];
  scoreRef?: string;
  publish?: ShowcasePublishInfo;
  lastGeneratedAt?: string;
  lastEditedAt?: string;
}

interface ShowcaseGenerateRequest {
  skillDirName: string;
  template: string;
}

interface ShowcasePublishRequest {
  skillDirName: string;
  details?: {
    problem: string;
    solution: string;
    screenshots: string[];
  };
  securityChecked: boolean;
}

interface ShowcasePublishResult {
  url: string;
}

interface ShowcasePublishResultEvent {
  skillDirName: string;
  success: boolean;
  url?: string;
  error?: string;
}
```

---

## 9. 认证 (auth:\*)

### 9.1 invoke 接口（渲染进程 → 主进程）

| Channel | 前端 API | Request 类型 | Response 类型 |
|---------|----------|-------------|--------------|
| `auth:login-github` | *未在 preload 暴露* | 无 | `IPCResponse<AuthLoginResponse>` |
| `auth:logout` | *未在 preload 暴露* | 无 | `IPCResponse<void>` |
| `auth:get-status` | *未在 preload 暴露* | 无 | `IPCResponse<AuthStatus>` |

### 9.2 类型定义

```typescript
interface AuthLoginResponse {
  username: string;
  loggedIn: boolean;
}

interface AuthStatus {
  loggedIn: boolean;
  username?: string;
}
```

---

## 10. 数据埋点 (analytics:\*)

### 10.1 invoke 接口（渲染进程 → 主进程）

| Channel | 前端 API | Request 类型 | Response 类型 |
|---------|----------|-------------|--------------|
| `analytics:track` | *未在 preload 暴露* | `TrackEvent` | `IPCResponse<void>` |
| `analytics:get-summary` | *未在 preload 暴露* | `AnalyticsSummaryRequest` | `IPCResponse<DailySummary[]>` |
| `analytics:clear` | *未在 preload 暴露* | 无 | `IPCResponse<void>` |

### 10.2 类型定义

```typescript
interface TrackEvent {
  event: string;
  params?: Record<string, any>;
}

interface AnalyticsSummaryRequest {
  startDate: string;
  endDate: string;
}

interface DailySummary {
  date: string;
  totalEvents: number;
  eventCounts: Record<string, number>;
}
```

---

## 附录 A: Channel 汇总表

共 10 个域、45 个 Channel。

| 域 | Channel 数量 | 已在 preload 暴露 | Handler 已实现 |
|----|-------------|------------------|---------------|
| terminal | 12 | 12 | 12 |
| fs | 8 | 3 | 1 (`fs:select-directory`) |
| chat | 6 | 4 | 4 |
| config | 8 | 0 | 0 |
| app | 6 | 6 | 2 (`get-config`, `save-config`) |
| marketplace | 8 | 0 | 0 |
| score | 5 | 0 | 0 |
| showcase | 4 | 0 | 0 |
| auth | 3 | 0 | 0 |
| analytics | 3 | 0 | 0 |

### 已实现 Handler 明细

以下 handler 已在 `src/main/index.ts` 或 `src/main/ipc/*.ts` 中注册：

| Channel | 实现位置 |
|---------|---------|
| `terminal:create` | `src/main/ipc/terminal-handlers.ts` |
| `terminal:write` | `src/main/ipc/terminal-handlers.ts` |
| `terminal:resize` | `src/main/ipc/terminal-handlers.ts` |
| `terminal:close` | `src/main/ipc/terminal-handlers.ts` |
| `terminal:list` | `src/main/ipc/terminal-handlers.ts` |
| `terminal:get-state` | `src/main/ipc/terminal-handlers.ts` |
| `terminal:get-foreground-process` | `src/main/ipc/terminal-handlers.ts` |
| `terminal:get-buffer` | `src/main/ipc/terminal-handlers.ts` |
| `terminal:update-cwd` | `src/main/ipc/terminal-handlers.ts` |
| `chat:get-history` | `src/main/ipc/chat-handlers.ts` |
| `chat:get-session` | `src/main/ipc/chat-handlers.ts` |
| `chat:search` | `src/main/ipc/chat-handlers.ts` |
| `chat:export` | `src/main/ipc/chat-handlers.ts` |
| `app:get-config` | `src/main/index.ts` (内联) |
| `app:save-config` | `src/main/index.ts` (内联) |
| `fs:select-directory` | `src/main/index.ts` (内联) |

### 事件推送明细（主进程 → 渲染进程）

以下事件由主进程通过 `webContents.send()` 主动推送：

| Channel | 推送时机 |
|---------|---------|
| `terminal:output` | PTY 产生输出时 |
| `terminal:state-change` | 终端状态变更时 |
| `terminal:exit` | 终端进程退出时 |
| `terminal:list-updated` | 终端列表变更时（恢复终端后） |
| `app:memory-warning` | 内存使用超阈值时 |

## 附录 B: Preload 桥接 API 一览

渲染进程通过 `window.api` 访问以下 API：

```typescript
window.api.terminal.create(cwd: string): Promise<IPCResponse<TerminalCreateResponse>>
window.api.terminal.write(id: string, data: string): void
window.api.terminal.resize(id: string, cols: number, rows: number): void
window.api.terminal.close(id: string, force?: boolean): Promise<IPCResponse<void>>
window.api.terminal.list(): Promise<IPCResponse<TerminalInfo[]>>
window.api.terminal.getBuffer(id: string): Promise<IPCResponse<string>>
window.api.terminal.getState(id: string): Promise<IPCResponse<TerminalInfo>>
window.api.terminal.getForegroundProcess(id: string): Promise<IPCResponse<ForegroundProcessInfo>>
window.api.terminal.updateCwd(id: string, cwd: string): Promise<{ success: boolean }>
window.api.terminal.onOutput(cb): () => void
window.api.terminal.onStateChange(cb): () => void
window.api.terminal.onExit(cb): () => void
window.api.terminal.onListUpdated(cb): () => void

window.api.app.getConfig(): Promise<IPCResponse<MuxvoConfig>>
window.api.app.saveConfig(config): Promise<IPCResponse<MuxvoConfig>>
window.api.app.getPreferences(): Promise<IPCResponse<UserPreferences>>
window.api.app.savePreferences(prefs): Promise<IPCResponse<void>>
window.api.app.detectCliTools(): Promise<IPCResponse<CLIToolsDetection>>
window.api.app.getHomePath(): string
window.api.app.onMemoryWarning(cb): () => void

window.api.fs.selectDirectory(): Promise<IPCResponse<string>>
window.api.fs.readFile(path: string): Promise<IPCResponse<ReadFileResponse>>
window.api.fs.writeFile(path: string, content: string): Promise<IPCResponse<void>>

window.api.chat.getHistory(params?): Promise<{ sessions, source?, error? }>
window.api.chat.getSession(sessionId: string): Promise<{ messages, source?, error? }>
window.api.chat.onSessionUpdate(cb): () => void
window.api.chat.onSyncStatus(cb): () => void
```
