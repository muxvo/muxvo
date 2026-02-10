# Muxvo 开发方案 V1.0

> 基于 PRD V2.0 产出 | 2026-02-10

---

## 目录

- [Part I — 技术架构设计](#part-i--技术架构设计)
- [Part II — V1 开发计划](#part-ii--v1-开发计划)
- [Part III — V2 开发计划](#part-iii--v2-开发计划)
- [排期汇总](#排期汇总)

---

# Part I — 技术架构设计

## 1. Electron 进程架构

### Main Process 职责

| 职责域 | 具体职责 |
|--------|---------|
| 窗口管理 | BrowserWindow 创建/销毁、窗口位置/尺寸持久化、窗口关闭前保存状态 |
| PTY 进程管理 | 通过 node-pty 创建/销毁伪终端、管理所有终端子进程生命周期、应用退出时终止所有子进程 |
| 文件系统操作 | chokidar 文件监听（CC 数据目录、项目目录、Muxvo 数据目录）、读取/写入 Muxvo 本地配置、读取 CC 数据文件（history.jsonl、session JSONL、plans、settings 等） |
| 前台进程检测 | 通过 tcgetpgrp() 获取 PTY 前台进程组 ID、macOS 上通过 ps 获取进程名、判断 shell/AI CLI/其他程序 |
| 安全存储 | Electron safeStorage 加密 token（V2-P2 GitHub OAuth） |
| 包管理 | Skill/Hook 下载、解压、安装到 ~/.claude/ 目录、本地注册表更新 |
| 聊天历史同步 | CC session 文件增量镜像到 Muxvo 数据目录 |
| 搜索索引 | 全文搜索索引构建与查询 |
| 网络请求（V2） | 聚合源 API 请求（GitHub API、SkillsMP 等） |
| 系统菜单 | 原生菜单栏、快捷键注册 |

### Renderer Process 职责

| 职责域 | 具体职责 |
|--------|---------|
| 终端渲染 | xterm.js 实例管理、终端输出渲染、Alternate Screen Buffer 检测 |
| 富编辑器 | contenteditable div（V1）/ CodeMirror 6（升级）、图片粘贴处理、多行协议适配 |
| Grid 布局 | CSS Grid 动态计算行列、拖拽排序、边框拖拽调整比例 |
| 视图切换 | 平铺/聚焦/三栏临时视图/文件面板 状态管理 |
| 配置管理器 UI | Skills/Hooks/Plans/Tasks/Settings/CLAUDE.md/Memory/MCP 浏览与编辑 |
| 聊天历史浏览器 | 会话列表、搜索、Session 详情渲染 |
| Skill 聚合浏览器 | 多源聚合展示、搜索、包详情、安装触发 |
| Markdown 渲染 | markdown-it + highlight.js/Shiki、预览/编辑双模式 |
| Showcase 预览 | 展示页预览/编辑（V2-P2） |

### Preload Script 职责

| 职责 | 说明 |
|------|------|
| IPC 桥接 | 通过 contextBridge.exposeInMainWorld 暴露类型安全的 API |
| 安全隔离 | contextIsolation: true, nodeIntegration: false |
| API 分组 | 按功能域暴露：terminal、file、config、chat、marketplace、score、showcase |

### 进程间通信模型

```
Renderer  ──invoke──>  Main (请求-响应模式，用于命令操作)
Renderer  <──on────    Main (事件推送模式，用于实时数据流)
Renderer  ──send───>   Main (单向消息，用于不需要返回值的操作)
```

- **invoke/handle**：用于需要返回值的操作（读取配置、获取文件内容、搜索等）
- **send/on**：用于单向通知（PTY 写入、窗口操作等）
- **Main→Renderer 推送**：用于实时事件（终端输出、文件变更、进程状态变化等）

---

## 2. IPC 通信协议

### 2.1 终端管理域 (terminal:*)

| Channel | 方向 | 参数类型 | 返回值类型 | 说明 |
|---------|------|---------|-----------|------|
| `terminal:create` | R→M | `{ cwd: string }` | `{ id: string, pid: number }` | 创建新终端（spawn shell） |
| `terminal:write` | R→M (send) | `{ id: string, data: string }` | void | 向 PTY 写入数据 |
| `terminal:resize` | R→M (send) | `{ id: string, cols: number, rows: number }` | void | 调整 PTY 尺寸 |
| `terminal:close` | R→M | `{ id: string, force?: boolean }` | `{ success: boolean }` | 关闭终端（先 SIGINT，超时后 SIGKILL） |
| `terminal:output` | M→R | `{ id: string, data: string }` | - | PTY 输出数据流推送 |
| `terminal:state-change` | M→R | `{ id: string, state: TerminalState, processName?: string }` | - | 终端状态变更推送 |
| `terminal:exit` | M→R | `{ id: string, code: number }` | - | 进程退出事件 |
| `terminal:get-foreground-process` | R→M | `{ id: string }` | `{ name: string, pid: number }` | 获取前台进程信息 |
| `terminal:list` | R→M | `void` | `TerminalInfo[]` | 获取所有终端信息 |

### 2.2 文件系统域 (fs:*)

| Channel | 方向 | 参数类型 | 返回值类型 | 说明 |
|---------|------|---------|-----------|------|
| `fs:read-dir` | R→M | `{ path: string }` | `FileEntry[]` | 读取目录内容 |
| `fs:read-file` | R→M | `{ path: string }` | `{ content: string, encoding: string }` | 读取文件内容 |
| `fs:write-file` | R→M | `{ path: string, content: string }` | `{ success: boolean }` | 写入文件（仅限可编辑的配置文件） |
| `fs:watch-start` | R→M | `{ id: string, paths: string[] }` | `{ success: boolean }` | 启动文件监听 |
| `fs:watch-stop` | R→M | `{ id: string }` | void | 停止文件监听 |
| `fs:change` | M→R | `{ path: string, event: 'add'\|'change'\|'unlink', isNew?: boolean }` | - | 文件变更事件推送 |
| `fs:select-directory` | R→M | void | `{ path: string } \| null` | 打开系统目录选择对话框 |
| `fs:write-temp-image` | R→M | `{ imageData: string, format: 'png'\|'jpg' }` | `{ path: string }` | 将图片写入临时文件（富编辑器粘贴图片用） |
| `fs:write-clipboard-image` | R→M | `{ imagePath: string }` | `{ success: boolean }` | 将图片写入系统剪贴板（RE2 剪贴板模拟用） |

### 2.3 聊天历史域 (chat:*)

| Channel | 方向 | 参数类型 | 返回值类型 | 说明 |
|---------|------|---------|-----------|------|
| `chat:get-history` | R→M | `{ limit?: number, offset?: number }` | `HistoryEntry[]` | 获取历史列表（从 history.jsonl） |
| `chat:get-session` | R→M | `{ projectId: string, sessionId: string }` | `SessionMessage[]` | 获取 session 完整对话 |
| `chat:search` | R→M | `{ query: string }` | `SearchResult[]` | 全文搜索聊天记录 |
| `chat:session-update` | M→R | `{ projectId: string, sessionId: string }` | - | Session 文件更新推送 |
| `chat:sync-status` | M→R | `{ status: 'syncing'\|'idle'\|'error' }` | - | 镜像同步状态推送 |
| `chat:export` | R→M | `{ projectIds?: string[], format: 'markdown'\|'json', dateRange?: { start: string, end: string } }` | `{ outputPath: string }` | 导出聊天历史 |

### 2.4 配置管理域 (config:*)

| Channel | 方向 | 参数类型 | 返回值类型 | 说明 |
|---------|------|---------|-----------|------|
| `config:get-resources` | R→M | `{ type: 'skills'\|'hooks'\|'plans'\|'tasks'\|'mcp'\|'plugins' }` | `Resource[]` | 获取资源列表 |
| `config:get-resource-content` | R→M | `{ type: string, name: string }` | `{ content: string }` | 获取资源内容 |
| `config:get-settings` | R→M | void | `CCSettings` | 读取 CC settings.json |
| `config:save-settings` | R→M | `{ settings: Partial<CCSettings> }` | `{ success: boolean }` | 写入 CC settings.json |
| `config:get-claude-md` | R→M | `{ scope: 'global'\|'project', projectPath?: string }` | `{ content: string }` | 读取 CLAUDE.md |
| `config:save-claude-md` | R→M | `{ scope: string, content: string, projectPath?: string }` | `{ success: boolean }` | 写入 CLAUDE.md |
| `config:get-memory` | R→M | `{ projectPath: string }` | `{ content: string }` | 读取 MEMORY.md |
| `config:resource-change` | M→R | `{ type: string, event: string, name: string }` | - | 资源文件变更推送 |

### 2.5 应用状态域 (app:*)

| Channel | 方向 | 参数类型 | 返回值类型 | 说明 |
|---------|------|---------|-----------|------|
| `app:get-config` | R→M | void | `MuxvoConfig` | 读取 Muxvo 本地配置 |
| `app:save-config` | R→M | `Partial<MuxvoConfig>` | `{ success: boolean }` | 保存 Muxvo 本地配置 |
| `app:get-preferences` | R→M | void | `UserPreferences` | 读取用户偏好 |
| `app:save-preferences` | R→M | `Partial<UserPreferences>` | `{ success: boolean }` | 保存用户偏好 |

### 2.6 包管理域 (marketplace:*)

| Channel | 方向 | 参数类型 | 返回值类型 | 说明 |
|---------|------|---------|-----------|------|
| `marketplace:fetch-sources` | R→M | `{ sources?: string[] }` | `AggregatedPackage[]` | 聚合多源获取包列表 |
| `marketplace:search` | R→M | `{ query: string, source?: string }` | `AggregatedPackage[]` | 搜索包 |
| `marketplace:install` | R→M | `{ name: string, source: string, type: 'skill'\|'hook' }` | `{ success: boolean }` | 安装包 |
| `marketplace:uninstall` | R→M | `{ name: string }` | `{ success: boolean }` | 卸载包 |
| `marketplace:get-installed` | R→M | void | `InstalledPackage[]` | 获取已安装列表 |
| `marketplace:install-progress` | M→R | `{ name: string, progress: number, status: string }` | - | 安装进度推送 |
| `marketplace:check-updates` | R→M | void | `UpdateInfo[]` | 检查更新 |

### 2.7 AI 评分域 (score:*) — V2-P1

| Channel | 方向 | 参数类型 | 返回值类型 | 说明 |
|---------|------|---------|-----------|------|
| `score:run` | R→M | `{ skillDirName: string }` | `SkillScore` | 触发 AI 评分 |
| `score:get-cached` | R→M | `{ skillDirName: string }` | `SkillScore \| null` | 获取缓存评分 |
| `score:progress` | M→R | `{ skillDirName: string, status: string }` | - | 评分进度推送 |

### 2.8 Showcase 域 (showcase:*) — V2-P2

| Channel | 方向 | 参数类型 | 返回值类型 | 说明 |
|---------|------|---------|-----------|------|
| `showcase:generate` | R→M | `{ skillDirName: string, template: string }` | `ShowcaseConfig` | 生成展示页 |
| `showcase:publish` | R→M | `{ skillDirName: string }` | `{ url: string }` | 发布到 GitHub Pages |
| `showcase:unpublish` | R→M | `{ skillDirName: string }` | `{ success: boolean }` | 下线展示页 |

### 2.9 认证域 (auth:*) — V2-P2

| Channel | 方向 | 参数类型 | 返回值类型 | 说明 |
|---------|------|---------|-----------|------|
| `auth:login-github` | R→M | void | `{ username: string, token: string }` | GitHub OAuth PKCE 登录 |
| `auth:logout` | R→M | void | `{ success: boolean }` | 登出 |
| `auth:get-status` | R→M | void | `{ loggedIn: boolean, username?: string }` | 获取认证状态 |

### 2.10 数据埋点域 (analytics:*)

| Channel | 方向 | 参数类型 | 返回值类型 | 说明 |
|---------|------|---------|-----------|------|
| `analytics:track` | R→M (send) | `{ event: string, params?: Record<string, any> }` | void | 记录埋点事件 |
| `analytics:get-summary` | R→M | `{ startDate: string, endDate: string }` | `DailySummary[]` | 获取每日摘要 |
| `analytics:clear` | R→M | void | `{ success: boolean }` | 清除所有埋点数据 |

---

## 3. 前端框架与状态管理

### 推荐：React + Zustand

**选择 React 的理由：**

1. **xterm.js 生态**：xterm.js 社区中 React 封装最成熟（xterm-react 等），终端渲染是 Muxvo 最核心的功能
2. **Electron + React 是主流组合**：VS Code（Monaco）、Hyper Terminal、Warp 等同类终端/开发工具均采用此组合，社区方案丰富
3. **CodeMirror 6 兼容**：CodeMirror 6 框架无关，但 @uiw/react-codemirror 封装质量高，与富编辑器升级路径一致
4. **状态机库支持**：XState（React 绑定最成熟）可用于管理 PRD 定义的 18 个状态机

**选择 Zustand 的理由：**

1. **轻量**：bundle 体积极小（~1KB），不拖慢 Electron 渲染进程启动
2. **无 Provider 包裹**：不需要像 Redux/Jotai 那样在组件树顶层注入 Provider，适合 Electron 单窗口架构
3. **Subscribe 模式**：支持 subscribe 订阅 store 变更，天然适合从 Main Process 推送事件更新 store
4. **Slice 模式**：支持将 store 按功能域拆分为独立 slice，与 PRD 的模块划分吻合
5. **Immer 中间件**：支持不可变状态更新，配合 devtools 中间件方便调试

**状态分层策略：**

```
┌─────────────────────────────────────────────┐
│  XState 状态机（有限状态 + 转换规则）         │
│  - 应用生命周期、终端进程状态、视图模式        │
│  - 文件面板、三栏视图、编辑器模式等            │
│  用途：管理 PRD 6.x 中定义的 18 个状态机      │
├─────────────────────────────────────────────┤
│  Zustand Store（全局业务数据）                │
│  - terminals: 终端列表与状态                  │
│  - chatHistory: 聊天历史数据                  │
│  - config: CC 配置资源                        │
│  - marketplace: 包列表与安装状态              │
│  - layout: Grid 布局、窗口尺寸               │
│  - preferences: 用户偏好                     │
├─────────────────────────────────────────────┤
│  React Local State（组件级临时状态）           │
│  - 输入框内容、hover 状态、动画状态           │
│  - 拖拽中间态、resize 中间态                  │
└─────────────────────────────────────────────┘
```

**XState + Zustand 协作模式：**
- XState machine 作为状态转换引擎，定义合法状态和转换规则
- 状态变更后将当前状态同步写入 Zustand store（UI 组件从 store 读取）
- Zustand store 是 UI 的唯一数据源，XState 是状态转换的唯一控制者

---

## 4. 模块拆分

### 4.1 终端管理模块 (terminal)

| 项目 | 说明 |
|------|------|
| 职责 | PTY 进程创建/销毁/通信、终端状态管理（6.2 状态机）、前台进程检测（tcgetpgrp）、xterm.js 渲染、Grid 布局计算、拖拽排序、边框调整、同目录归组、cwd 切换（6.7 状态机） |
| 对外接口 | `createTerminal(cwd)`, `closeTerminal(id)`, `writeToTerminal(id, data)`, `getTerminalState(id)`, `getForegroundProcess(id)`, `getTerminals()` |
| 依赖模块 | layout（Grid 布局数据）、config（读取 Muxvo 配置恢复终端列表） |

### 4.2 富编辑器模块 (rich-editor)

| 项目 | 说明 |
|------|------|
| 职责 | 富文本编辑器渲染（contenteditable / CodeMirror 6）、图片粘贴处理、多行协议转换（CC 用 \x1b\r、bash 直接发送）、Alternate Screen Buffer 检测（编辑器/原始终端模式切换，6.13 状态机）、Ctrl+C/Z/D 穿透 |
| 对外接口 | `RichEditorComponent`, `getEditorContent(id)`, `clearEditor(id)`, `setEditorMode(id, 'rich' \| 'raw')` |
| 依赖模块 | terminal（PTY 写入、前台进程类型判断） |

### 4.3 聊天历史模块 (chat-history)

| 项目 | 说明 |
|------|------|
| 职责 | 读取 CC history.jsonl 和 session JSONL、增量镜像同步到 Muxvo 数据目录、全文搜索索引构建与查询、会话列表与详情展示（6.10 状态机） |
| 对外接口 | `getHistory(options)`, `getSession(projectId, sessionId)`, `search(query)`, `getSyncStatus()` |
| 依赖模块 | file-watcher（session 文件变更通知） |

### 4.4 文件浏览模块 (file-browser)

| 项目 | 说明 |
|------|------|
| 职责 | 项目文件目录读取与展示、文件面板滑入/滑出（6.5 状态机）、三栏临时视图（6.6 状态机）、Markdown 渲染（预览/编辑双模式）、代码高亮、NEW 标记管理 |
| 对外接口 | `FilePanelComponent`, `TempViewComponent`, `readDirectory(path)`, `readFileContent(path)` |
| 依赖模块 | terminal（获取终端 cwd、同目录终端列表）、file-watcher（新文件/变更通知） |

### 4.5 配置管理模块 (config-manager)

| 项目 | 说明 |
|------|------|
| 职责 | CC 资源浏览（Skills/Hooks/Plans/Tasks/Settings/CLAUDE.md/Memory/MCP）、Settings 和 CLAUDE.md 编辑保存、配置管理器面板（6.11 状态机） |
| 对外接口 | `ConfigPanelComponent`, `getResources(type)`, `getResourceContent(type, name)`, `saveSettings(data)`, `saveClaudeMd(scope, content)` |
| 依赖模块 | file-watcher（资源文件变更通知） |

### 4.6 文件监听模块 (file-watcher)

| 项目 | 说明 |
|------|------|
| 职责 | chokidar 统一管理所有文件监听（6.12 状态机）、监听范围包括：终端 cwd 目录、CC 数据目录（sessions/plans/skills）、Muxvo 数据目录、临时文件过滤（.DS_Store/.swp 等）、错误重试（3s 间隔，最多 3 次） |
| 对外接口 | `watchPath(id, paths)`, `unwatchPath(id)`, `onFileChange(callback)`, `getWatchStatus()` |
| 依赖模块 | 无（底层服务模块，被其他模块依赖） |

### 4.7 Skill 浏览器模块 (skill-browser)

| 项目 | 说明 |
|------|------|
| 职责 | 多源聚合浏览（6 个来源）、搜索与过滤、包详情展示、安装/卸载触发（6.14 + 6.15 状态机）、Hook 安全审查对话框 |
| 对外接口 | `SkillBrowserComponent`, `fetchAggregatedPackages()`, `searchPackages(query)`, `installPackage(name, source)`, `uninstallPackage(name)` |
| 依赖模块 | config-manager（本地已安装 Skills 列表）、file-watcher（安装后目录变更刷新） |

### 4.8 AI 评分模块 (ai-scorer) — V2-P1

| 项目 | 说明 |
|------|------|
| 职责 | 触发 CC 运行 muxvo-skill-scorer Skill、6 维度评分结果解析与缓存（6.16 状态机）、评分结果展示（雷达图）、内容 hash 缓存策略 |
| 对外接口 | `runScore(skillDirName)`, `getCachedScore(skillDirName)`, `ScoreCardComponent` |
| 依赖模块 | terminal（向 CC 终端发送评分命令）、config-manager（读取 Skill 内容） |

### 4.9 Showcase 模块 (showcase) — V2-P2

| 项目 | 说明 |
|------|------|
| 职责 | 展示页生成（合并评分 + SKILL.md）、模板选择与自定义、预览/编辑面板（6.18 状态机）、GitHub Pages 发布、分享面板 |
| 对外接口 | `generateShowcase(skillDirName, template)`, `publishShowcase(skillDirName)`, `ShowcasePreviewComponent` |
| 依赖模块 | ai-scorer（评分数据）、auth（GitHub token）、config-manager（Skill 内容） |

### 4.10 认证模块 (auth) — V2-P2

| 项目 | 说明 |
|------|------|
| 职责 | GitHub OAuth PKCE 流程（6.17 状态机）、Token 存储（Electron safeStorage → macOS Keychain）、Token 刷新与过期处理 |
| 对外接口 | `login()`, `logout()`, `getAuthStatus()`, `getToken()` |
| 依赖模块 | 无（独立认证服务） |

### 4.11 布局模块 (layout)

| 项目 | 说明 |
|------|------|
| 职责 | 视图模式管理（6.3 状态机：Tiling/Focused/FilePanel/TempView）、Grid 行列计算、columnRatios/rowRatios 持久化、Esc 键优先级处理、窗口尺寸保存恢复 |
| 对外接口 | `LayoutComponent`, `getViewMode()`, `setViewMode(mode)`, `getGridLayout()`, `updateGridRatios(ratios)` |
| 依赖模块 | terminal（终端数量决定 Grid 行列） |

### 4.12 数据埋点模块 (analytics)

| 项目 | 说明 |
|------|------|
| 职责 | 本地埋点事件采集、analytics.json 存储、每日摘要聚合、数据保留策略（明细 90 天/摘要 1 年）、使用统计面板 UI |
| 对外接口 | `trackEvent(name, params)`, `getDailySummary(dateRange)`, `clearAnalytics()`, `AnalyticsPanelComponent` |
| 依赖模块 | 无（被各功能模块调用） |

---

## 5. 项目目录结构

```
muxvo/
├── package.json
├── electron-builder.yml         # 打包配置
├── tsconfig.json
├── vite.config.ts               # Vite 构建配置（Renderer）
│
├── src/
│   ├── main/                    # Main Process
│   │   ├── index.ts             # 入口：BrowserWindow 创建、IPC 注册
│   │   ├── ipc/                 # IPC Handler 按域分组
│   │   │   ├── terminal.ipc.ts
│   │   │   ├── fs.ipc.ts
│   │   │   ├── chat.ipc.ts
│   │   │   ├── config.ipc.ts
│   │   │   ├── app.ipc.ts
│   │   │   ├── marketplace.ipc.ts
│   │   │   ├── score.ipc.ts      # V2-P1
│   │   │   ├── showcase.ipc.ts   # V2-P2
│   │   │   ├── auth.ipc.ts       # V2-P2
│   │   │   └── analytics.ipc.ts
│   │   ├── services/            # Main 侧业务服务
│   │   │   ├── pty-manager.ts    # node-pty 进程管理
│   │   │   ├── file-watcher.ts   # chokidar 文件监听
│   │   │   ├── chat-sync.ts      # 聊天历史增量同步
│   │   │   ├── search-index.ts   # 全文搜索索引
│   │   │   ├── process-detector.ts  # 前台进程检测 (tcgetpgrp)
│   │   │   ├── package-installer.ts # 包下载/安装/卸载
│   │   │   ├── aggregator.ts     # 多源聚合请求 (V2)
│   │   │   ├── auth-service.ts   # GitHub OAuth (V2-P2)
│   │   │   └── analytics.ts       # 埋点事件采集与存储
│   │   └── utils/
│   │       ├── cc-data-reader.ts # CC 数据文件解析
│   │       ├── config-store.ts   # Muxvo 本地配置读写
│   │       └── paths.ts          # 路径常量（CC 目录、Muxvo 数据目录）
│   │
│   ├── preload/                 # Preload Script
│   │   └── index.ts             # contextBridge API 暴露
│   │
│   ├── renderer/                # Renderer Process (React)
│   │   ├── index.html
│   │   ├── main.tsx             # React 入口
│   │   ├── App.tsx
│   │   │
│   │   ├── stores/              # Zustand Store (按域拆分 slice)
│   │   │   ├── index.ts          # 合并所有 slice
│   │   │   ├── terminal.store.ts
│   │   │   ├── layout.store.ts
│   │   │   ├── chat.store.ts
│   │   │   ├── config.store.ts
│   │   │   ├── marketplace.store.ts
│   │   │   ├── preferences.store.ts
│   │   │   ├── score.store.ts     # V2-P1
│   │   │   ├── showcase.store.ts  # V2-P2
│   │   │   └── analytics.store.ts
│   │   │
│   │   ├── machines/            # XState 状态机定义
│   │   │   ├── app-lifecycle.machine.ts     # 6.1
│   │   │   ├── terminal-process.machine.ts  # 6.2
│   │   │   ├── view-mode.machine.ts         # 6.3
│   │   │   ├── tile-interaction.machine.ts  # 6.4
│   │   │   ├── file-panel.machine.ts        # 6.5
│   │   │   ├── temp-view.machine.ts         # 6.6
│   │   │   ├── cwd-switch.machine.ts        # 6.7
│   │   │   ├── custom-name.machine.ts       # 6.8
│   │   │   ├── grid-resize.machine.ts       # 6.9
│   │   │   ├── chat-panel.machine.ts        # 6.10
│   │   │   ├── config-panel.machine.ts      # 6.11
│   │   │   ├── file-watcher.machine.ts      # 6.12
│   │   │   ├── rich-editor.machine.ts       # 6.13
│   │   │   ├── skill-browser.machine.ts     # 6.14
│   │   │   ├── package-install.machine.ts   # 6.15
│   │   │   ├── ai-score.machine.ts          # 6.16
│   │   │   ├── auth.machine.ts              # 6.17
│   │   │   └── showcase.machine.ts          # 6.18
│   │   │
│   │   ├── components/          # React 组件
│   │   │   ├── terminal/
│   │   │   │   ├── TerminalGrid.tsx
│   │   │   │   ├── TerminalTile.tsx
│   │   │   │   ├── TerminalHeader.tsx
│   │   │   │   ├── XTermRenderer.tsx
│   │   │   │   ├── RichEditor.tsx
│   │   │   │   ├── FocusedView.tsx
│   │   │   │   └── CwdSwitcher.tsx
│   │   │   ├── file-browser/
│   │   │   │   ├── FilePanel.tsx
│   │   │   │   ├── TempView.tsx
│   │   │   │   ├── FileTree.tsx
│   │   │   │   └── MarkdownPreview.tsx
│   │   │   ├── chat-history/
│   │   │   │   ├── ChatPanel.tsx
│   │   │   │   ├── SessionList.tsx
│   │   │   │   └── SessionDetail.tsx
│   │   │   ├── config-manager/
│   │   │   │   ├── ConfigPanel.tsx
│   │   │   │   ├── ResourceList.tsx
│   │   │   │   ├── ResourcePreview.tsx
│   │   │   │   └── SettingsEditor.tsx
│   │   │   ├── skill-browser/
│   │   │   │   ├── SkillBrowser.tsx
│   │   │   │   ├── PackageCard.tsx
│   │   │   │   ├── PackageDetail.tsx
│   │   │   │   └── SecurityReview.tsx
│   │   │   ├── showcase/          # V2-P2
│   │   │   │   ├── ScoreCard.tsx
│   │   │   │   ├── ShowcasePreview.tsx
│   │   │   │   └── SharePanel.tsx
│   │   │   ├── layout/
│   │   │   │   ├── MenuBar.tsx
│   │   │   │   ├── BottomBar.tsx
│   │   │   │   └── EscHandler.tsx
│   │   │   └── shared/
│   │   │       ├── SearchInput.tsx
│   │   │       └── StatusDot.tsx
│   │   │
│   │   ├── hooks/               # React Hooks
│   │   │   ├── useTerminal.ts
│   │   │   ├── useIPC.ts         # IPC 通信封装
│   │   │   ├── useMachine.ts     # XState hook 封装
│   │   │   └── useFileWatcher.ts
│   │   │
│   │   └── styles/
│   │       ├── variables.css     # CSS 变量（主题色、间距等）
│   │       ├── global.css
│   │       └── themes/
│   │           └── dark.css
│   │
│   └── shared/                  # Main/Renderer 共享
│       ├── types/               # TypeScript 类型定义
│       │   ├── terminal.types.ts
│       │   ├── chat.types.ts
│       │   ├── config.types.ts
│       │   ├── marketplace.types.ts
│       │   ├── score.types.ts
│       │   ├── showcase.types.ts
│       │   ├── ipc.types.ts      # IPC channel 名称与参数类型
│       │   └── analytics.types.ts
│       └── constants/
│           ├── channels.ts       # IPC channel 名称常量
│           └── paths.ts          # CC/Muxvo 数据路径常量
│
├── resources/                   # 静态资源
│   └── icons/
└── tests/
    ├── main/
    └── renderer/
```

---

## 6. 数据流架构

```mermaid
flowchart TD
    subgraph CC_Files["CC 原始文件（只读）"]
        HJ["~/.claude/history.jsonl"]
        SJ["~/.claude/projects/{id}/{session}.jsonl"]
        PL["~/.claude/plans/*.md"]
        SK["~/.claude/skills/*/"]
        HK["~/.claude/hooks/"]
        ST["~/.claude/settings.json"]
        CM["~/.claude/CLAUDE.md"]
        MM["~/.claude/projects/{id}/memory/MEMORY.md"]
        MC["~/.claude/mcp.json"]
    end

    subgraph Main_Process["Main Process"]
        CK["chokidar 文件监听服务"]
        DR["CC 数据读取器"]
        CS["聊天历史同步服务"]
        SI["搜索索引服务"]
        PM["PTY 管理器"]
        PD["前台进程检测器"]
        PI["包安装器"]
        AG["多源聚合器 (V2)"]
    end

    subgraph Muxvo_Data["Muxvo 本地数据"]
        CF["config.json<br/>（终端列表/布局）"]
        PF["preferences.json<br/>（主题/字体）"]
        MK["marketplace.json<br/>（安装注册表）"]
        CH["chat-history/<br/>（聊天镜像）"]
        SS["skill-scores/<br/>（评分缓存）"]
        SC["showcases/<br/>（展示页配置）"]
    end

    subgraph IPC["IPC Bridge (Preload)"]
        IP["contextBridge API"]
    end

    subgraph Renderer["Renderer Process"]
        subgraph Stores["Zustand Stores"]
            TS["terminal.store"]
            LS["layout.store"]
            CS2["chat.store"]
            CFS["config.store"]
            MS["marketplace.store"]
            PS["preferences.store"]
        end

        subgraph Machines["XState 状态机"]
            SM["18 个状态机<br/>（控制状态转换）"]
        end

        subgraph UI["React UI 组件"]
            TG["TerminalGrid"]
            FP["FilePanel"]
            CP["ChatPanel"]
            CFG["ConfigPanel"]
            SB["SkillBrowser"]
        end
    end

    %% CC 文件 → chokidar
    HJ & SJ & PL & SK & HK & ST & CM & MM & MC --> CK

    %% chokidar → 数据处理
    CK -->|"文件变更事件"| DR
    CK -->|"session 更新"| CS
    CS -->|"增量镜像"| CH
    DR -->|"解析数据"| SI

    %% PTY 数据流
    PM -->|"stdout 数据"| IP
    PD -->|"进程状态"| IP

    %% Muxvo 本地数据
    CF & PF & MK --> DR

    %% Main → IPC → Renderer
    DR -->|"IPC 推送事件"| IP
    CS -->|"同步状态"| IP
    PM -->|"终端输出/状态"| IP
    AG -->|"聚合包数据"| IP

    IP -->|"更新 store"| Stores
    SM -->|"状态写入"| Stores
    Stores -->|"驱动渲染"| UI

    %% Renderer → IPC → Main
    UI -->|"用户操作"| IP
    IP -->|"IPC 请求"| PM
    IP -->|"IPC 请求"| DR
    IP -->|"IPC 请求"| PI
```

---

## 7. 跨模块依赖关系图

```mermaid
graph TD
    subgraph Core["核心层（V1 必须）"]
        FW["file-watcher<br/>文件监听"]
        TM["terminal<br/>终端管理"]
        RE["rich-editor<br/>富编辑器"]
        LY["layout<br/>布局管理"]
    end

    subgraph Features["功能层（V1 功能）"]
        FB["file-browser<br/>文件浏览"]
        CH2["chat-history<br/>聊天历史"]
        CM2["config-manager<br/>配置管理"]
    end

    subgraph V2_P0["V2-P0 层"]
        SB2["skill-browser<br/>Skill 浏览器"]
    end

    subgraph V2_P1["V2-P1 层"]
        AS["ai-scorer<br/>AI 评分"]
    end

    subgraph V2_P2["V2-P2 层"]
        AU["auth<br/>认证"]
        SC2["showcase<br/>展示页"]
    end

    %% 核心层依赖
    RE -->|"PTY 写入<br/>前台进程检测"| TM
    TM -->|"终端数量"| LY

    %% 功能层依赖
    FB -->|"终端 cwd"| TM
    FB -->|"文件变更"| FW
    CH2 -->|"session 变更"| FW
    CM2 -->|"资源变更"| FW

    %% V2-P0 依赖
    SB2 -->|"本地 Skills"| CM2
    SB2 -->|"目录变更"| FW

    %% V2-P1 依赖
    AS -->|"发送评分命令"| TM
    AS -->|"Skill 内容"| CM2

    %% V2-P2 依赖
    SC2 -->|"评分数据"| AS
    SC2 -->|"GitHub Token"| AU
    SC2 -->|"Skill 内容"| CM2

    style FW fill:#4a9eff,color:#fff
    style TM fill:#4a9eff,color:#fff
    style RE fill:#4a9eff,color:#fff
    style LY fill:#4a9eff,color:#fff
    style FB fill:#66bb6a,color:#fff
    style CH2 fill:#66bb6a,color:#fff
    style CM2 fill:#66bb6a,color:#fff
    style SB2 fill:#ffa726,color:#fff
    style AS fill:#ef5350,color:#fff
    style AU fill:#ab47bc,color:#fff
    style SC2 fill:#ab47bc,color:#fff
```

**依赖关系说明：**

- **file-watcher** 是最底层模块，无任何依赖，被 5 个模块依赖
- **terminal** 是核心模块，被 rich-editor、file-browser、ai-scorer、layout 依赖
- **config-manager** 是资源中枢，被 skill-browser、ai-scorer、showcase 依赖
- **auth** 是独立模块，仅被 showcase 依赖，V2-P2 才启用
- 所有 V2 模块都可以独立开关，不影响 V1 核心功能

**构建顺序：**

V1: file-watcher → terminal + layout → rich-editor → file-browser + chat-history + config-manager

V2 增量: skill-browser → ai-scorer → auth + showcase

---

# Part II — V1 开发计划

## 8. V1 开发阶段划分

### V1-P0（核心 MVP）— 6-7 周

功能 A（全屏平铺终端管理）+ B（聚焦模式）+ D（聊天历史浏览器）+ G（Markdown 预览）+ I（双段式命名）

这五个功能构成最小可用产品：用户可以管理多个终端、浏览聊天记录、预览文件。

### V1-P1（体验完善）— 5-6 周

功能 C（拖拽排序+边框调整）+ E（全文搜索）+ H（文件浏览器+三栏视图）+ J（~/.claude/ 浏览器）+ M（同目录自动归组）+ RE1（富编辑器基础版）

### V1-P2（进阶功能）— 4-5 周

功能 F（时间线视图）+ K（Plans/Skills/Hooks/Tasks 分类查看）+ L（Settings/CLAUDE.md 编辑）+ RE2（富编辑器完善版）

**V1 合计：15-18 周（1 个全栈开发者）**

---

## 9. V1 功能任务拆分

### 功能 A — 全屏平铺终端管理（V1-P0，10 天）

| 任务 | 涉及层 | 前置依赖 | 工期 |
|------|--------|----------|------|
| A1: Electron 应用骨架搭建（主窗口、菜单栏 36px、底部控制栏） | Main + Renderer | 无 | 2天 |
| A2: node-pty 集成 — spawn shell 进程、stdin/stdout 通信 | Main | A1 | 2天 |
| A3: xterm.js 集成 — 终端输出渲染、滚动缓冲区（10000行/1000行策略） | Renderer | A2 | 2天 |
| A4: CSS Grid 动态布局（1=全屏，2=对半，3=三等分，4=2x2，5=上3下2居中 grid-column offset，6=3x2，7+=ceil(sqrt(n))列） | Renderer | A1 | 2天 |
| A5: 终端进程生命周期管理（状态机 + 状态点颜色/动画映射 + 关闭确认对话框） | Main + Renderer | A2 | 1.5天 |
| A6: config.json 持久化（终端列表、Grid 布局保存/恢复） | Main + 数据层 | A4 | 0.5天 |

**A5 补充说明**：关闭终端时如有前台进程正在运行，弹出确认对话框"当前终端有进程正在运行，确定关闭？"，用户确认后执行 SIGINT → 超时 SIGKILL 流程。

### 功能 B — 聚焦模式（V1-P0，3 天）

| 任务 | 涉及层 | 前置依赖 | 工期 |
|------|--------|----------|------|
| B1: 双击 tile 进入聚焦模式（左侧 75% 放大 + 右侧栏缩小排列） | Renderer | A4 | 1.5天 |
| B2: 聚焦模式交互（点击右侧栏切换聚焦、Esc 返回平铺） | Renderer | B1 | 1天 |
| B3: 3D 视觉效果（hover 倾斜 ±4°、光泽层、聚焦动画、状态点呼吸脉冲、背景渐变光斑、入场动画） | Renderer | B1 | 1.5天 |

### 功能 I — 双段式命名（V1-P0，3 天）

| 任务 | 涉及层 | 前置依赖 | 工期 |
|------|--------|----------|------|
| I1: Tile Header 组件（状态点 + cwd 路径 + 自定义名称 + 按钮） | Renderer | A4 | 0.5天 |
| I2: cwd 点击切换目录（QuickAccess 弹窗 + 文件夹浏览器） | Renderer + Main | A2 | 1天 |
| I3: tcgetpgrp() 前台进程检测 + 分支处理 | Main | A2, I2 | 1天 |
| I4: 自定义名称编辑 | Renderer | I1 | 0.5天 |

### 功能 D — 聊天历史浏览器（V1-P0，8 天）

| 任务 | 涉及层 | 前置依赖 | 工期 |
|------|--------|----------|------|
| D1: JSONL 解析器（流式逐行读取、格式错误跳过、不完整末尾行忽略、CC 格式兼容性处理） | 数据层 | 无 | 1天 |
| D2: 双源读取逻辑（CC 原始文件优先 → Muxvo 镜像兜底） | 数据层 | D1 | 0.5天 |
| D3: 聊天历史同步模块（启动全量扫描 + 运行中增量同步） | Main + 数据层 | D1 | 2天 |
| D4: 三栏邮件客户端布局（项目列表 220px/min180px + 会话列表 340px/min280px + 详情 flex/min400px，窗口不足时左栏收起为60px图标模式） | Renderer | D1 | 1.5天 |
| D5: 左栏项目列表 | Renderer | D4 | 0.5天 |
| D6: 中栏会话卡片（标题+时间+预览+标签，按时间倒序） | Renderer | D4 | 0.5天 |
| D7: 右栏会话详情（气泡式消息渲染、Markdown 渲染、工具调用折叠、代码块高亮） | Renderer | D4 | 1.5天 |
| D8: 三栏联动交互 | Renderer | D5, D6, D7 | 0.5天 |

**D1 格式兼容性说明**：CC 作为活跃产品，JSONL/JSON 格式可能随版本变更。D1 解析器需使用宽松模式——未知字段忽略、缺失字段使用默认值；格式不兼容时功能降级而非崩溃。详见 11.9 节。

### 功能 G — Markdown 预览（V1-P0，3 天）

| 任务 | 涉及层 | 前置依赖 | 工期 |
|------|--------|----------|------|
| G1: Markdown 渲染引擎（markdown-it/marked + CommonMark + GFM + 暗色主题配色 + 排版参数） | Renderer | 无 | 1.5天 |
| G2: 代码块语法高亮 | Renderer | G1 | 0.5天 |
| G3: 预览/编辑双模式（Cmd+/ 切换、Cmd+S 保存） | Renderer + Main | G1 | 1天 |

### 功能 C — 拖拽排序 + 边框调整（V1-P1，4 天）

| 任务 | 涉及层 | 前置依赖 | 工期 |
|------|--------|----------|------|
| C1: HTML5 Drag and Drop 排序 | Renderer | A4 | 2天 |
| C2: 边框拖拽调整大小（columnRatios/rowRatios 持续更新、双击重置等分） | Renderer | A4 | 2天 |

### 功能 E — 全文搜索（V1-P1，6 天）

| 任务 | 涉及层 | 前置依赖 | 工期 |
|------|--------|----------|------|
| E1: 倒排索引构建（Web Worker 后台执行、渐进式可用、超时保护） | 数据层 | D1 | 2.5天 |
| E2: 索引持久化与增量更新 | 数据层 | E1 | 1天 |
| E3: 搜索 UI（300ms 去抖、结果列表 + 关键词高亮、快捷键） | Renderer | E1, D4 | 1.5天 |
| E4: 索引构建进度 UI | Renderer | E1 | 1天 |

### 功能 H — 文件浏览器 + 三栏临时视图（V1-P1，6 天）

| 任务 | 涉及层 | 前置依赖 | 工期 |
|------|--------|----------|------|
| H1: 文件面板组件（右侧滑出 320px、文件树、NEW 徽章） | Renderer | A4 | 1.5天 |
| H2: chokidar 文件监听 | Main | A2 | 1天 |
| H3: 三栏全屏临时视图布局 | Renderer | H1, G1 | 1.5天 |
| H4: 三栏交互（拖拽调整宽度、Esc 关闭） | Renderer | H3 | 1天 |
| H5: 文件内容渲染（Markdown/JSON/代码） | Renderer | G1, H3 | 1天 |

### 功能 J — ~/.claude/ 可视化浏览器（V1-P1，3 天）

| 任务 | 涉及层 | 前置依赖 | 工期 |
|------|--------|----------|------|
| J1: 分类卡片列表 | Renderer | 无 | 1天 |
| J2: 资源列表与预览 | Renderer + Main | J1, G1 | 1.5天 |
| J3: chokidar 监听 ~/.claude/ 自动刷新 | Main | J2 | 0.5天 |

### 功能 M — 同目录终端自动归组（V1-P1，2 天）

| 任务 | 涉及层 | 前置依赖 | 工期 |
|------|--------|----------|------|
| M1: 归组逻辑 | Renderer + Main | A4, I3 | 1.5天 |
| M2: 归组动画 | Renderer | M1 | 0.5天 |

### 功能 RE1 — 富编辑器覆盖层基础（V1-P1，8 天）

| 任务 | 涉及层 | 前置依赖 | 工期 |
|------|--------|----------|------|
| RE1-1: contenteditable 编辑器组件 | Renderer | A4 | 1.5天 |
| RE1-2: xterm.js 键盘断开 | Renderer | A3 | 0.5天 |
| RE1-3: 文本→PTY 转发（CC 多行协议 \x1b\r + shell 直接发送） | Main | A2, I3 | 2天 |
| RE1-4: 按键穿透规则（Ctrl+C/Z/D 穿透到终端） | Renderer + Main | RE1-1, RE1-2 | 0.5天 |
| RE1-5: 图片粘贴处理（Clipboard API → 临时文件 → 编辑器预览 → 路径插入） | Renderer + Main | RE1-1 | 1.5天 |
| RE1-6: 手动模式切换快捷键 | Renderer | RE1-1, RE1-2 | 0.5天 |
| RE1-7: 编辑器工具栏 UI | Renderer | RE1-1 | 0.5天 |
| RE1-8: 临时文件清理 | Main | RE1-5 | 0.5天 |

### 功能 F — 会话时间线视图（V1-P2，3 天）

| 任务 | 涉及层 | 前置依赖 | 工期 |
|------|--------|----------|------|
| F1: 时间线布局（纵轴按天分组、不同项目不同颜色） | Renderer | D4 | 2天 |
| F2: 三栏/时间线视图切换 | Renderer | F1 | 1天 |

### 功能 K — Plans/Skills/Hooks/Tasks 分类查看（V1-P2，4 天）

| 任务 | 涉及层 | 前置依赖 | 工期 |
|------|--------|----------|------|
| K1: Skills 列表（搜索 + Markdown 预览） | Renderer + Main | J2, G1 | 1天 |
| K2: Plans 列表 | Renderer + Main | J2, G1 | 1天 |
| K3: Hooks 列表（脚本只读预览） | Renderer + Main | J2 | 0.5天 |
| K4: Tasks 列表（JSON 格式化） | Renderer + Main | J2 | 0.5天 |
| K5: Memory/MCP 只读浏览 | Renderer + Main | J2 | 1天 |

### 功能 L — Settings/CLAUDE.md 编辑（V1-P2，3 天）

| 任务 | 涉及层 | 前置依赖 | 工期 |
|------|--------|----------|------|
| L1: Settings.json 可视化编辑器 | Renderer + Main | J2 | 1.5天 |
| L2: CLAUDE.md 编辑器 | Renderer + Main | J2, G3 | 1天 |
| L3: 编辑权限控制 | Renderer | L1, L2 | 0.5天 |

### 功能 RE2 — 富编辑器完善（V1-P2，5 天）

| 任务 | 涉及层 | 前置依赖 | 工期 |
|------|--------|----------|------|
| RE2-1: Alternate Screen Buffer 自动检测 | Renderer | RE1-2 | 1.5天 |
| RE2-2: 进程名检测 fallback | Main | I3, RE2-1 | 1天 |
| RE2-3: 图片剪贴板模拟 | Main | RE1-5 | 1.5天 |
| RE2-4: 各 AI CLI 工具多行协议适配 | Main | RE1-3 | 1天 |

### 通用/基础设施任务（贯穿全周期，15.5 天）

| 任务 | 涉及层 | 前置依赖 | 工期 |
|------|--------|----------|------|
| X1: 首次使用引导流程 | Renderer + Main | A1 | 1.5天 |
| X2: 快捷键系统 | Renderer | A4 | 1天 |
| X3: 聊天历史导出 | Main + Renderer | D4 | 1.5天 |
| X4: 缺省态实现（终端/聊天历史/文件浏览/配置管理/Skill浏览器，约20个场景，含文案/图标/操作按钮） | Renderer | 各功能完成后 | 2.5天 |
| X5: 异常处理框架 | Main + Renderer | 各功能完成后 | 2天 |
| X6: Electron 自动更新与签名 | Main | A1 | 2天 |
| X7: 数据埋点框架 | Main + Renderer | A1 | 3天 |
| X8: 使用统计面板 | Renderer | X7, D4 | 2天 |

**X5 说明**：建立统一的异常处理和错误提示框架，覆盖 PRD 11.1 定义的 32 条异常场景。包括：错误提示组件（Toast/Dialog）、重试机制（自动重试 + 手动重试按钮）、降级策略（功能不可用时显示友好提示而非崩溃）。各功能模块关键异常处理需求：
- **A（终端管理）**：PTY spawn 失败重试、shell 异常退出恢复
- **D（聊天历史）**：JSONL 解析失败跳过、同步中断恢复
- **H（文件浏览）**：目录权限不足降级提示、chokidar 监听失败重试
- **RE（富编辑器）**：图片粘贴失败 fallback 文本路径、临时文件清理异常静默处理
- **E（全文搜索）**：索引构建超时保护、搜索无结果友好提示

---

## 10. V1 功能依赖关系

```mermaid
graph TD
    A1[A1: Electron 骨架] --> A2[A2: node-pty]
    A1 --> A4[A4: CSS Grid]
    A2 --> A3[A3: xterm.js]
    A2 --> A5[A5: 进程生命周期]
    A4 --> A6[A6: config 持久化]

    A4 --> B1[B: 聚焦模式]
    A4 --> I1[I: 双段式命名]
    A2 --> I3[I3: tcgetpgrp 进程检测]

    D1[D1: JSONL 解析器] --> D2[D2: 双源读取]
    D1 --> D3[D3: 同步模块]
    D1 --> D4[D4: 三栏布局]
    D4 --> D5[D5: 项目列表]
    D4 --> D6[D6: 会话列表]
    D4 --> D7[D7: 会话详情]

    G1[G1: Markdown 引擎] --> G2[G2: 代码高亮]
    G1 --> G3[G3: 预览/编辑模式]

    A4 --> C1[C: 拖拽排序]
    A4 --> C2[C: 边框调整]

    D1 --> E1[E1: 倒排索引]
    E1 --> E2[E2: 索引持久化]
    E1 --> E3[E3: 搜索 UI]

    A4 --> H1[H1: 文件面板]
    A2 --> H2[H2: 文件监听]
    H1 --> H3[H3: 三栏视图]
    G1 --> H3
    G1 --> H5[H5: 文件渲染]

    J1[J1: 分类卡片] --> J2[J2: 资源列表]
    G1 --> J2

    A4 --> M1[M: 自动归组]
    I3 --> M1

    A3 --> RE1_2[RE1-2: xterm 键盘断开]
    A4 --> RE1_1[RE1-1: contenteditable]
    I3 --> RE1_3[RE1-3: 文本→PTY 转发]
    RE1_2 --> RE2_1[RE2-1: ASB 自动检测]
    RE1_5[RE1-5: 图片粘贴] --> RE2_3[RE2-3: 剪贴板模拟]
    RE1_3 --> RE2_4[RE2-4: 多工具协议适配]

    D4 --> F1[F: 时间线视图]
    J2 --> K[K: 分类查看]
    J2 --> L[L: 编辑功能]
    G3 --> L

    style A1 fill:#ff6b6b
    style A2 fill:#ff6b6b
    style A3 fill:#ff6b6b
    style A4 fill:#ff6b6b
    style D1 fill:#ff6b6b
    style G1 fill:#ff6b6b
```

**图例**：红色 = 关键路径节点

**开发顺序建议**：

1. A1 → A2/A4 并行 → A3/A5/A6
2. D1（可与 A 并行）→ D2/D3/D4
3. G1（可与 A/D 并行）→ G2/G3
4. I（依赖 A2/A4）→ B（依赖 A4）
5. P1 功能按 RE1 → H → C → E → J → M 顺序
6. P2 功能按 K → L → F → RE2 顺序

---

## 11. V1 核心技术难点及解决方案

### 11.1 node-pty 多终端管理

**难点**：多 shell 子进程生命周期管理、tcgetpgrp 跨平台前台进程检测、应用关闭时优雅终止。

**方案**：
- `TerminalManager` 类统一管理所有 pty 实例，维护进程状态机
- 监听 `exit` 事件处理异常退出，提供重连机制
- macOS 通过 `tcgetpgrp(fd)` + `ps -p {pid} -o comm=` 获取前台进程名
- 关闭窗口：先序列化状态 → 逐个 SIGTERM → 5s 超时 SIGKILL → app.quit()
- 最大终端数限制 20
- WaitingInput 状态检测：分析终端输出中的选项列表模式（如 "? Select an option:"、数字选项列表），或检测 CC 输出的特定提示符模式
- 内存监控：每 60 秒通过 `process.memoryUsage()` 检查，超过 2GB 时菜单栏显示黄色警告图标

### 11.2 xterm.js 集成

**难点**：富编辑器模式下 xterm.js 只渲染不接收键盘、ASB 信号检测、滚动缓冲区管理。

**方案**：
- `attachCustomKeyEventHandler` 返回 `false` 拦截键盘（编辑器模式）
- 监听 CSI 序列 `\x1b[?1049h` / `\x1b[?1049l` 检测 ASB
- `IBufferNamespace` 的 `bufferChange` 事件触发模式切换
- ResizeObserver + `terminal.fit()` 适配 Grid 尺寸
- 图片懒加载：Skill 浏览器中用户头像使用 IntersectionObserver 延迟加载

### 11.3 富编辑器覆盖层

**难点**：contenteditable 纯文本提取、CC 多行协议编码、图片粘贴处理。

**方案**：
- 编辑器 `innerText` 按 `\n` 分割；CC 协议各行间 `\x1b\r`，末行 `\r`；Shell 直接发送 `\n`
- 图片：Clipboard API → `/tmp/muxvo-images/{uuid}.png` → CC 场景写入剪贴板发 `\x16`，fallback 插路径
- 模式切换：ASB 信号 → 进程名检测 → 手动快捷键兜底

### 11.4 JSONL 解析性能

**难点**：大文件流式读取、并发读写安全、增量更新。

**方案**：
- `readline` 逐行流式读取
- 忽略不以 `\n` 结尾的末尾行、解析失败静默跳过、变化事件后延迟 200ms
- 记录字节偏移，增量读取
- >100MB 仅索引最近 6 个月

### 11.5 全文搜索索引

**难点**：倒排索引构建性能、不阻塞 UI、渐进式可用。

**方案**：
- Web Worker 中执行，`postMessage` 通信
- 单文件 30s / 总计 5min 超时保护
- 渐进式：每个文件索引完成即可搜索
- 索引持久化到 `search-index/`，chokidar 监听增量更新

### 11.6 CSS Grid 动态布局

**难点**：终端数量变化自动计算行列、拖拽排序位置计算、边框实时调整。

**方案**：
- 布局算法：`cols = n <= 3 ? n : Math.ceil(Math.sqrt(n))`，5 终端特殊处理（上 3 下 2 居中）
- HTML5 DnD API + grid cell 位置计算
- mousedown/move/up 实时更新 `grid-template-columns`
- 布局切换：CSS transition + grid-template-areas 变化
- **5 终端布局 CSS 实现**：`grid-template-columns: repeat(6, 1fr); grid-template-rows: 1fr 1fr;` 上层 3 个各占 `grid-column: span 2`，下层 2 个各占 `span 2` 并使用 `grid-column: 2 / span 2` 和 `grid-column: 4 / span 2` 实现居中对齐（即下层偏移 1 列起始位置）

### 11.7 聊天历史镜像同步

**难点**：全量扫描 + 增量同步切换、mtime 精度问题。

**方案**：
- 后台线程全量扫描 `~/.claude/projects/`，对比 sync-state.json 的 mtime（秒级精度）
- 项目目录用路径 SHA-256 前 16 位 hex 作为目录名
- 仅同步不删除，文件锁定时跳过下次重试

### 11.8 node-pty 原生模块编译

**风险**：node-pty 是 C++ 原生模块，需与 Electron 的 Node.js 版本 ABI 兼容。Apple Silicon (arm64) + Intel (x86_64) 双架构需分别编译。

**方案**：
- 使用 `electron-rebuild` 确保 node-pty 编译适配 Electron 内置 Node.js 版本
- CI/CD 中分别在 arm64 和 x86_64 环境编译验证
- 锁定 Electron + node-pty 版本组合，更新时先在 CI 验证编译
- fallback：如 node-pty 编译失败，考虑 node-pty-prebuilt-multiarch 预编译包

### 11.9 CC 数据格式兼容性

**风险**：CC 作为活跃产品，JSONL 和 JSON 文件格式可能随版本变更。

**方案**：
- JSONL 解析器使用宽松模式：未知字段忽略、缺失字段使用默认值
- 在 `cc-data-reader.ts` 中维护格式版本检测逻辑
- 格式不兼容时功能降级而非崩溃，显示提示"CC 数据格式已更新，部分功能可能受限"
- 跟踪 CC 版本更新日志，提前适配

### 11.10 Electron 应用自动更新

**方案**：
- 使用 `electron-updater` + GitHub Releases 实现自动更新
- 更新检测：启动时 + 每 24 小时检查
- 更新流程：检测到新版本 → 后台下载 → 提示用户重启安装
- 使用 `autoUpdater.checkForUpdatesAndNotify()` 非强制更新
- macOS: Apple Developer ID 签名 + notarization（通过 `electron-builder` 配置 `afterSign` hook）
- Windows: 可选 EV Code Signing（后续有需要时配置）
- electron-builder.yml 中配置签名参数

---

## 12. V1 测试策略

### 12.1 单元测试（Vitest）

| 模块 | 测试重点 | 预估用例数 |
|------|----------|-----------|
| JSONL 解析器 | 正常解析、格式错误跳过、不完整行、空文件、大文件 | ~15 |
| Grid 布局算法 | 1-20 终端行列计算、5 终端特殊布局 | ~10 |
| 终端状态机 | 所有状态转换、异常处理 | ~20 |
| 进程检测 | shell 检测、AI 工具检测、未知进程 | ~8 |
| 聊天历史同步 | mtime 比较、去重、增量同步 | ~12 |
| 富编辑器文本转发 | CC 多行协议、shell 直接发送、图片路径 | ~10 |
| Markdown 渲染 | 各格式、GFM 扩展、暗色主题 | ~15 |
| 搜索索引 | 构建、增量更新、大文件保护 | ~10 |
| 文件路径 hash | SHA-256 截取、反查 | ~5 |

**总计约 ~105 个单元测试用例**

### 12.2 集成测试

| 场景 | 测试内容 |
|------|----------|
| 终端完整生命周期 | spawn → 交互 → 关闭 → 状态清理 |
| 聊天历史端到端 | JSONL 读取 → 解析 → 三栏联动展示 |
| 文件监听链路 | chokidar 触发 → 数据更新 → UI 刷新 |
| 同步模块端到端 | CC 文件变化 → 镜像同步 → 双源切换 |
| 富编辑器→PTY | 编辑器输入 → 前台进程检测 → 协议编码 → pty.write → xterm 输出 |
| 布局持久化 | 调整布局 → 关闭 → 重启 → 布局恢复 |

### 12.3 E2E 测试（Playwright）

| 流程 | 步骤 |
|------|------|
| 核心工作流 | 启动 → 新建终端 → 双击聚焦 → Esc 返回 → 关闭终端 |
| 文件浏览 | 点击文件按钮 → 面板滑出 → 点击文件 → 三栏视图 → Esc 返回 |
| 聊天历史 | 打开历史 → 选项目 → 选会话 → 查看详情 → 搜索 → 导出 |
| 配置管理 | 打开配置 → 浏览 Skills → 查看 Settings → 编辑 CLAUDE.md → 保存 |
| 富编辑器 | 输入文本 → 粘贴图片 → 发送 → 验证终端输出 |

### 12.4 V2 测试策略

#### 单元测试（新增）

| 模块 | 测试重点 | 预估用例数 |
|------|----------|-----------|
| 多源聚合引擎 | 并行请求、去重、降级、缓存 | ~15 |
| 安装引擎 | 下载、解压、注册表更新、卸载 | ~10 |
| 安全检查引擎 | API Key/路径/敏感文件正则匹配 | ~12 |
| AI 评分缓存 | 内容 hash、promptVersion 失效、缓存命中 | ~8 |
| 展示页 HTML 生成 | 模板渲染、OG meta 注入、SVG 雷达图 | ~10 |
| OAuth PKCE | code_verifier 生成、token 交换、存储 | ~8 |

#### 集成测试（新增）

| 场景 | 测试内容 |
|------|----------|
| 聚合浏览端到端 | 多源请求 → 聚合 → 搜索 → 展示 |
| 安装完整流程 | 点击安装 → 下载 → 解压 → 注册 → 列表刷新 |
| AI 评分端到端 | 触发评分 → CC 运行 → 文件监听 → 结果渲染 |
| 展示页发布 | 生成 → 预览 → OAuth → GitHub Pages → 链接 |

#### E2E 测试（新增）

| 流程 | 步骤 |
|------|------|
| Skill 发现安装 | 打开浏览器 → 搜索 → 查看详情 → 安装 → 验证已安装 |
| AI 评分展示 | 选中 Skill → 评分 → 查看雷达图 → 保存 PNG |
| 展示页发布 | 评分 → 生成展示页 → 编辑 → 发布 → 分享 |

---

## 13. V1 里程碑定义

### Milestone 1：终端核心（Week 1-3）

**交付物**：Electron 骨架 + node-pty + xterm.js + CSS Grid + 状态机 + 持久化 + 引导流程

**验收标准**：
- 可新建最多 20 个终端，布局自动适应
- 关闭重启后终端在相同目录恢复
- 状态点颜色正确反映进程状态

### Milestone 2：交互增强（Week 4-5）

**交付物**：聚焦模式 + 双段式命名 + tcgetpgrp + 3D 效果 + 快捷键

**验收标准**：
- 双击聚焦、Esc 返回、右栏切换
- cwd 切换：shell 直接 cd，AI 工具弹确认
- 所有快捷键正常工作

### Milestone 3：聊天历史（Week 5-7）

**交付物**：JSONL 解析 + 同步 + 三栏布局 + Markdown 渲染 + 导出

**验收标准**：
- 正确展示 CC 聊天历史，新会话实时同步
- 三栏联动流畅
- Markdown 渲染完整，暗色主题正确

### Milestone 4：文件浏览（Week 7-8）

**交付物**：Markdown 预览/编辑 + 文件面板 + 三栏临时视图 + NEW 标记

**验收标准**：
- 面板滑出/收回流畅
- 三栏宽度可拖拽
- CC 新文件自动标记 NEW

### Milestone 5：P1 体验完善（Week 9-12）

**交付物**：拖拽排序 + 全文搜索 + ~/.claude/ 浏览器 + 自动归组 + 富编辑器基础版 + 缺省态

**验收标准**：
- 拖拽排序流畅，全文搜索跨项目检索
- 索引构建不阻塞 UI
- 富编辑器可正常输入/发送，图片可粘贴

### Milestone 6：P2 进阶功能（Week 13-17）

**交付物**：时间线视图 + 分类查看 + 编辑功能 + 富编辑器完善 + 性能优化

**验收标准**：
- vim/htop 时自动切换原始模式，退出后恢复
- Settings/CLAUDE.md 可编辑保存
- 内存 < 2GB（20 终端场景）
- E2E 全部通过

---

# Part III — V2 开发计划

## 14. V2 开发阶段划分

### V2-P0：聚合浏览 + 安装基础 — 3-4 周

**包含功能**：Skill 聚合浏览器(N2) + 一键安装(O) + Hook 安全审查(U)

| 周次 | 任务 | 交付物 |
|------|------|--------|
| W1 | 聚合源 API 对接 + 数据格式统一 | 多源数据适配器 |
| W2 | 聚合浏览器 UI（左侧筛选 + 卡片列表 + 详情页） | 浏览器完整界面 |
| W3 | 安装引擎 + Hook 安全审查对话框 + 本地注册表 | 安装/卸载/审查功能 |
| W4 | 更新检测基础 + 联调测试 + Bug 修复 | V2-P0 可发布版本 |

### V2-P1：AI 评分 — 2-3 周

**包含功能**：AI Skill 评分(SR) + 更新检测(T)

| 周次 | 任务 | 交付物 |
|------|------|--------|
| W1 | muxvo-skill-scorer Skill 开发 + 通信机制 | 评分 Skill + 文件监听 |
| W2 | 评分卡 UI（雷达图 + 等级 + 称号）+ 更新检测完善 | 评分卡组件 + 更新流程 |
| W3 | 评分缓存/一致性 + 评分卡导出(PNG/剪贴板) + 测试 | V2-P1 可发布版本 |

### V2-P2：展示页 + 发布分享 — 5-6 周

**包含功能**：展示页(SS) + 发布分享(P2) + 富编辑器高级(RE3) + GitHub OAuth

| 周次 | 任务 | 交付物 |
|------|------|--------|
| W1 | GitHub OAuth PKCE 登录 | 认证模块 |
| W2 | 展示页模板系统 + HTML 生成引擎 | 2-3 套模板 + 生成器 |
| W3 | 展示页编辑/预览 UI + OG Card 生成 | 编辑面板 + 社交预览图 |
| W4 | GitHub Pages 自动发布 + showcase-index 索引 | 发布流程 |
| W5 | 分享面板 + 微信分享图 + Deep Link 注册 | 分享功能 |
| W6 | 富编辑器高级(RE3) + muxvo-publisher Plugin + 联调 | V2-P2 可发布版本 |

### V2-P3：社区平台 — 8-10 周（概要）

**包含功能**：Showcase 社区平台(SC)

- 后端服务搭建（用户系统、展示页存储、排行榜）
- Feed 流浏览 + 搜索 + 点赞/评论
- 评分排行榜（周榜/月榜）+ 百分位排名
- 个人主页（@username）
- 启动条件：月活 >1000、展示页月生成 >100、外部链接月点击 >500

---

## 15. V2 功能任务拆分

### N2 — Skill 聚合浏览器（~11 天）

| # | 任务 | 涉及层 | 前置依赖 | 预估 |
|---|------|--------|---------|------|
| N2-1 | 定义聚合源统一数据模型（UnifiedPackage 接口，支持 @username/package-name namespace 格式） | Domain | 无 | 0.5d |
| N2-2 | Anthropic 官方数据源适配器 | Service | N2-1 | 1d |
| N2-3 | SkillsMP 数据源适配器 | Service | N2-1 | 1d |
| N2-4 | GitHub 搜索数据源适配器 | Service | N2-1 | 1d |
| N2-5 | 42plugin 数据源适配器（需先验证 API 可用性） | Service | N2-1 | 1d |
| N2-6 | Muxvo 商城数据源适配器 | Service | N2-1 | 0.5d |
| N2-7 | 本地已安装数据源 | Service | N2-1 | 0.5d |
| N2-8 | 聚合引擎：并行请求 + 去重 + 缓存 + 降级 | Service | N2-2~7 | 2d |
| N2-9 | 浏览器全屏覆盖层 UI | UI/Renderer | N2-8 | 2d |
| N2-10 | 包详情页面板 | UI/Renderer | N2-9 | 1d |
| N2-11 | 搜索功能（300ms 去抖 + 跨源搜索） | UI/Service | N2-9 | 0.5d |

### O — 一键安装（~5 天）

| # | 任务 | 涉及层 | 前置依赖 | 预估 |
|---|------|--------|---------|------|
| O-1 | 下载引擎（多源下载 + 进度回调） | Main | N2-1 | 1d |
| O-2 | 包解压 + 文件放置 | Main | O-1 | 0.5d |
| O-3 | 本地注册表 marketplace.json | Main | 无 | 1d |
| O-4 | 安装状态机 UI | UI/Renderer | O-1,O-2,O-3 | 1d |
| O-5 | 卸载功能 | Main/UI | O-3 | 0.5d |
| O-6 | chokidar 目录监听 → 列表刷新 | Main | V1 配置管理器 | 0.5d |

### U — Hook 安全审查（~2.5 天）

| # | 任务 | 涉及层 | 前置依赖 | 预估 |
|---|------|--------|---------|------|
| U-1 | 安全审查对话框 UI | UI/Renderer | 无 | 1d |
| U-2 | Hook 源码解析 | Service | O-2 | 0.5d |
| U-3 | 风险关键词高亮引擎 | UI | 无 | 0.5d |
| U-4 | Hook 安装确认流程 | Main | O-2, U-1 | 0.5d |

### SR — AI Skill 评分（~9 天）

| # | 任务 | 涉及层 | 前置依赖 | 预估 |
|---|------|--------|---------|------|
| SR-1 | muxvo-skill-scorer Skill 开发（Prompt + 6 维度 + JSON） | CC Skill | 无 | 2d |
| SR-2 | Prompt Injection 防护 | CC Skill | SR-1 | 0.5d |
| SR-3 | 评分触发机制（检测 CC 终端 → 发送指令） | Main | V1 终端管理, SR-1 | 1d |
| SR-4 | 文件监听通信（chokidar 监听 skill-scores/） | Main | SR-1 | 0.5d |
| SR-5 | 评分缓存 + 内容 hash + promptVersion 失效 | Service | SR-4 | 0.5d |
| SR-6 | 评分卡 UI（六维度雷达图 + 总分 + 等级 + 称号） | UI/Renderer | SR-4 | 2d |
| SR-7 | 评分详情面板（各维度理由 + 改进建议） | UI/Renderer | SR-6 | 0.5d |
| SR-8 | 评分卡导出（PNG / 剪贴板） | UI/Renderer | SR-6 | 1d |
| SR-9 | 评分重试机制（最多 3 次 + 手动重试） | Service/UI | SR-3 | 0.5d |

### T — 更新检测（~3 天）

| # | 任务 | 涉及层 | 前置依赖 | 预估 |
|---|------|--------|---------|------|
| T-1 | 更新检测引擎（遍历注册表 → 查询最新版本 → 语义版本比较） | Service | O-3, N2-8 | 1d |
| T-2 | 定时触发（启动 + 每 6 小时） | Main | T-1 | 0.5d |
| T-3 | 更新提示 UI（红色徽章 + amber 标记） | UI/Renderer | T-1 | 0.5d |
| T-4 | 单个/批量更新操作 | Main/Service | O-1, T-1 | 1d |

### SS — Skill Showcase 展示页（~10.5 天）

| # | 任务 | 涉及层 | 前置依赖 | 预估 |
|---|------|--------|---------|------|
| SS-1 | SKILL.md 解析器（YAML frontmatter + Markdown body） | Service | 无 | 1d |
| SS-2 | 展示页模板系统（2-3 套主题） | Template | 无 | 3d |
| SS-3 | HTML 生成引擎（合并评分 + SKILL.md → 静态 HTML + DOMPurify XSS 防护 + 图片白名单域名） | Service | SS-1, SS-2, SR | 2d |
| SS-4 | 展示页编辑/预览 UI | UI/Renderer | SS-3 | 2d |
| SS-5 | OG Card 图片生成（1200x630px） | Main | SR-6 | 1d |
| SS-6 | 微信分享图生成（750x1334px） | Main | SR-6 | 1d |
| SS-7 | 安装按钮 JS（deep link + 3 秒超时降级） | Template | 无 | 0.5d |

### P2 — Skill 发布/分享（~11.5 天）

| # | 任务 | 涉及层 | 前置依赖 | 预估 |
|---|------|--------|---------|------|
| P2-1 | GitHub OAuth PKCE（code_verifier/challenge + 本地 HTTP + 回调） | Main | 无 | 2d |
| P2-2 | Deep Link 协议注册（muxvo:// macOS/Windows/Linux） | Main | 无 | 1d |
| P2-3 | Token 安全存储（Electron safeStorage） | Main | P2-1 | 0.5d |
| P2-4 | 发布前安全检查引擎 | Service | 无 | 1d |
| P2-5 | GitHub Pages 自动发布 | Service | P2-1, SS-3 | 2d |
| P2-6 | showcase-index 索引仓库更新 | Service | P2-5 | 0.5d |
| P2-7 | 分享面板 UI（多平台分享 + 徽章） | UI/Renderer | P2-5 | 1.5d |
| P2-8 | muxvo-publisher CC Plugin 开发 | CC Plugin | P2-4, P2-5, SR-1 | 2d |
| P2-9 | Token 传递机制（临时文件 + 权限 600） | Main/Plugin | P2-3, P2-8 | 0.5d |
| P2-10 | 发布草稿管理 | Service/UI | P2-5 | 0.5d |

### RE3 — 富编辑器高级（~3 天）

| # | 任务 | 涉及层 | 前置依赖 | 预估 |
|---|------|--------|---------|------|
| RE3-1 | 斜杠命令自动补全 | UI/Renderer | V1 RE1/RE2 | 1d |
| RE3-2 | 输入历史（上箭头召回） | UI/Renderer | V1 RE1/RE2 | 0.5d |
| RE3-3 | 文件拖拽支持 | UI/Renderer | V1 RE1/RE2 | 0.5d |
| RE3-4 | 代码块语法高亮 | UI/Renderer | V1 RE1/RE2 | 1d |

---

## 16. V2 特有技术难点及方案

### 16.1 多源 API 聚合

**方案**：
- `IDataSourceAdapter` 接口 + 每源一个适配器
- 统一模型 `UnifiedPackage`：{ id, name, displayName, description, type, source, sourceUrl, author, tags, latestVersion, updatedAt }
- `Promise.allSettled` 并行请求，已成功源立即渲染，失败的标注"暂不可用"
- 内存缓存（TTL 30 分钟）+ 磁盘缓存（TTL 1 小时）
- 跨源去重：`name + source` 为唯一键
- 降级：连续 3 次失败后递增重试（30s→60s→120s）
- README 渲染缓存：已查看的包详情页渲染结果缓存到内存（LRU 缓存，最多 50 条）

### 16.2 GitHub OAuth PKCE（Electron）

**方案**：
1. 生成 `code_verifier`（128 字符）→ `code_challenge = base64url(SHA256(code_verifier))`
2. 启动本地 HTTP 服务器（随机端口 `localhost:{port}/callback`）
3. 打开系统浏览器跳转 GitHub OAuth 授权页
4. 本地服务器接收回调 → `code + code_verifier` 交换 `access_token`
5. `electron.safeStorage.encryptString()` 加密存储
6. 备用：`muxvo://` deep link 作为回调 URL

### 16.3 AI 评分 CC Skill 通信（文件监听模式）

**方案**：
1. Muxvo 向 CC 终端 pty 写入评分指令
2. muxvo-skill-scorer 执行后写 JSON 到 `~/Library/Application Support/Muxvo/skill-scores/{skill-dir-name}.json`
3. chokidar 监听 → 读取 → 渲染评分卡
4. 超时 60 秒 → 提示失败并允许重试
5. 写入用临时文件 + rename 避免读取不完整数据

### 16.4 展示页 HTML 生成

**方案**：EJS 模板引擎，每套模板 = EJS + CSS。CSS 内联到 HTML，雷达图 SVG 内联，OG meta 自动注入。

### 16.5 雷达图渲染

**方案**：纯 SVG 手绘（path 计算六边形 + 数据多边形），无需第三方库。PNG 导出用 Electron `nativeImage`。不选 ECharts（体积 ~800KB 太大）或 Canvas（不能内联到静态 HTML）。

### 16.6 OG Card / 微信分享图生成

**方案**：隐藏 `BrowserWindow` 渲染 HTML 模板 → `webContents.capturePage()` 截图。OG Card 1200x630px，微信分享图 750x1334px（含 QR 码，用 `qrcode` npm 包）。完全本地生成，不依赖外部服务。

### 16.7 Deep Link 协议注册

- **macOS**：`Info.plist` 的 `CFBundleURLTypes` + `app.setAsDefaultProtocolClient('muxvo')` + `app.on('open-url')`
- **Windows**：NSIS installer 写注册表 + `app.on('second-instance')`
- **Linux**：`.desktop` 文件 + `xdg-mime`
- URL 格式：`muxvo://install/{source}/{skill-name}`

### 16.8 GitHub Pages 自动发布

API 调用序列：
1. `GET /user` → 用户名
2. `GET /repos/{username}/muxvo-skills` → 检查仓库
3. 不存在 → `POST /user/repos` 创建
4. `PUT /repos/.../contents/{skill-name}/index.html` → 提交 HTML
5. `POST /repos/.../pages` → 启用 Pages
6. 轮询 Pages 部署状态
7. 返回 `https://{username}.github.io/muxvo-skills/{skill-name}`

### 16.9 Token 传递（Muxvo → muxvo-publisher）

**方案**：临时文件。Muxvo 解密 Token → 写入 `~/.muxvo-token-{uuid}`（权限 600）→ muxvo-publisher 读取 → Muxvo 5 秒后删除。

### 16.10 安全检查引擎

正则扫描引擎逐行匹配：API Key (`sk-*`, `ghp_*`, `AKIA*`, `xoxb-*`)、密钥文件 (`-----BEGIN PRIVATE KEY-----`)、硬编码路径 (`/Users/*/`, `C:\\Users\\`)、敏感文件 (`.env`, `.pem`)。返回 `{ passed, issues: [{ type, line, column, snippet, severity }] }`。

---

## 17. V2 与 V1 的集成点

### 需要扩展的 V1 模块

| V1 模块 | 扩展内容 |
|---------|---------|
| 终端管理 | 新增"向 CC 终端写入指令"能力 + CC 终端运行状态检测 |
| 配置管理器(J) | Skills 列表新增「AI 评分」「发布到商城」按钮 + 「更新可用」徽章 |
| 菜单栏 | 新增 [Skills] 按钮 + 红色数字徽章 |
| 富编辑器(RE1/RE2) | 扩展为 RE3 |
| chokidar 文件监听 | 新增 skill-scores/ 目录监听 |

### V1 架构预留扩展点

| 扩展点 | 位置 | 说明 |
|--------|------|------|
| IPC 通道命名空间 | Main | 预留 `skill-browser:*`、`skill-score:*`、`skill-publish:*` |
| 覆盖层容器 | Renderer | 确保覆盖层可叠加 |
| Pty 写入 API | Main | 暴露「向指定终端写入文本」的 IPC 接口 |
| 终端状态查询 | Main | 暴露"是否运行中 + 是否空闲"的查询接口 |
| 应用级设置 | Config | 预留 marketplace 相关配置项 |

### 新增 IPC 接口

> **命名规则**：与第 2 节 IPC 通信协议保持一致，按功能域划分命名空间。评分相关使用 `score:*`、展示页/发布相关使用 `showcase:*`、认证相关使用 `auth:*`，仅包管理/安装相关保留 `marketplace:*`。

```typescript
// Main → Renderer
'marketplace:packages-loaded'   // 聚合数据加载完成（marketplace 域）
'marketplace:install-progress'  // 安装进度（marketplace 域）
'score:result'                  // 评分结果（score 域，对应 2.7）
'showcase:publish-result'       // 发布结果（showcase 域，对应 2.8）
'marketplace:update-available'  // 更新可用通知（marketplace 域）

// Renderer → Main
'marketplace:load-packages'     // 加载聚合数据（marketplace 域）
'marketplace:install-package'   // 安装包（marketplace 域）
'marketplace:uninstall-package' // 卸载包（marketplace 域）
'score:run'                     // 触发评分（score 域，对应 2.7）
'showcase:publish'              // 发布 Skill（showcase 域，对应 2.8）
'marketplace:check-updates'     // 检查更新（marketplace 域）
'auth:login-github'             // GitHub OAuth 登录（auth 域，对应 2.9）
'auth:logout'                   // 登出（auth 域，对应 2.9）

// 终端管理扩展
'terminal:write-to-pty'         // 向指定终端写入文本
'terminal:get-status'           // 查询终端运行状态
```

---

## 18. 外部依赖风险评估

| 依赖 | 风险等级 | 影响范围 | 缓解措施 |
|------|---------|---------|---------|
| Anthropic 官方 Skills 仓库 | 中 | N2 聚合源 | GitHub API 读取 + 30 分钟缓存 + 不可用时降级隐藏 |
| SkillsMP API | 中 | N2 聚合源 | 优先公开 API，降级网页数据提取 |
| 42plugin API | **高** | N2 聚合源 | 可选源，不可用直接移除，V2-P0 前优先验证 |
| GitHub API Rate Limit | 中高 | N2/P2/索引 | 磁盘缓存 + OAuth Token 提升额度 + ETag conditional request |
| CC Plugin 系统 | **高** | SR 评分/P2 发布 | 文件监听通信（不依赖 CC API）+ 纯文本 Prompt + 定期跟踪 CC 版本 |
| GitHub OAuth PKCE | 低 | P2 发布 | GitHub 已支持，提前创建 OAuth App 测试 |

---

## 19. V2 Go/No-Go 验证清单

### V2-P0 启动前提

| # | 条件 | 验证方式 |
|---|------|---------|
| 1 | V1 PMF 验证通过（200+ 活跃用户） | 用户统计 + 反馈 |
| 2 | "Skills 发现困难"被确认为真实痛点 | V1 用户反馈 |
| 3 | 至少 3 个聚合源 API 验证可用 | 手动 API 测试 |
| 4 | V1 终端管理 + 配置管理器稳定 | Bug 率 |

### V2-P1 启动前提

| # | 条件 | 验证方式 |
|---|------|---------|
| 1 | V2-P0 上线且稳定 | Bug 率 + 反馈 |
| 2 | muxvo-skill-scorer Prompt 模板确定 | 内部评测 |
| 3 | 评分一致性通过（偏差 < 5 分） | 自动化测试 |
| 4 | 文件监听通信验证通过 | 端到端测试 |

### V2-P2 启动前提

| # | 条件 | 验证方式 |
|---|------|---------|
| 1 | V2-P1 AI 评分内测完成 | 内测数据 |
| 2 | **关键指标**：内测 20-30 人中评分卡分享率 >= 15% | 内测统计 |
| 3 | 展示页模板视觉设计完成 | 设计稿评审 |
| 4 | GitHub OAuth PKCE 端到端验证通过 | 技术 PoC |
| 5 | GitHub Pages 自动发布验证通过 | 技术 PoC |

### V2-P3 启动前提

| # | 条件 | 验证方式 |
|---|------|---------|
| 1 | 月活 > 1,000 | 用户统计 |
| 2 | 展示页月生成 > 100 | 产品统计 |
| 3 | 外部链接月点击 > 500 | Analytics |

---

# 排期汇总

| 阶段 | 预估工期 | 核心交付 | 关键风险 |
|------|---------|---------|---------|
| **V1-P0** | 6-7 周 | 终端管理 + 聚焦 + 聊天历史 + Markdown + 命名 | node-pty 集成、JSONL 性能 |
| **V1-P1** | 5-6 周 | 拖拽排序 + 搜索 + 文件浏览 + 配置浏览 + 富编辑器基础 | 搜索索引性能、富编辑器↔PTY |
| **V1-P2** | 4-5 周 | 时间线 + 分类查看 + 编辑 + 富编辑器完善 | ASB 检测、多工具协议 |
| **V1 合计** | **15-18 周** | | |
| **V2-P0** | 3-4 周 | 聚合浏览器 + 安装 + 审查 | 聚合源 API 可用性 |
| **V2-P1** | 2-3 周 | AI 评分 + 更新检测 | CC Skill 通信 + 评分一致性 |
| **V2-P2** | 5-6 周 | 展示页 + 发布 + 分享 | GitHub OAuth PKCE + Pages 发布 |
| **V2-P3** | 8-10 周 | 社区平台 | 用户增长门槛 |
| **V2 合计** | **18-23 周** | | |
| **总计** | **33-41 周** | | |

> 以上工期假设 1 个全栈开发者。V2 依赖 V1 基础设施稳定运行。建议在 V2-P0 开发前完成所有待确认项的技术 PoC。

> **跨平台适配说明**：以上工期基于 macOS 单平台开发。Windows/Linux 适配（路径映射、tcgetpgrp 替代方案、快捷键映射、Electron 打包配置）预估额外需要 2-3 周，建议在 V1-P2 完成后安排。
