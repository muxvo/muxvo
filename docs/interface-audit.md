# Muxvo 前后端接口对接审计报告

> 审计时间: 2026-02-17
> 审计范围: src/renderer/ (前端) ↔ src/main/ (后端) ↔ src/preload/ (桥接)
> 数据来源: channels.ts (59 channel), preload/index.ts (26 桥接), main/ (16 handler), renderer/ (18 唯一前端调用)

---

## 一、对接状态总览

| 域 | Channel 定义 | Handler 实现 | Preload 桥接 | 前端调用 | 状态 |
|----|-------------|-------------|-------------|---------|------|
| TERMINAL | 12 | 9 | 13 (含1硬编码) | 12 | ⚠️ 部分（缺 LIST_UPDATED channel 定义） |
| FS | 9 | 1 | 3 | 2 | ⚠️ 部分（大量未实现） |
| CHAT | 6 | 4 | 4 | 3 | ⚠️ 部分（事件推送缺失） |
| CONFIG | 8 | 0 | 0 | 0 | ❌ 全域未实现 |
| APP | 6 | 2 | 7 (含1本地) | 1 | ⚠️ 部分（多个 handler 缺失） |
| MARKETPLACE | 8 | 0 | 0 | 0 | ❌ 全域未实现 |
| SCORE | 5 | 0 | 0 | 0 | ❌ 全域未实现 |
| SHOWCASE | 4 | 0 | 0 | 0 | ❌ 全域未实现 |
| AUTH | 3 | 0 | 0 | 0 | ❌ 全域未实现 |
| ANALYTICS | 3 | 0 | 0 | 0 | ❌ 全域未实现 |
| **合计** | **59 (+1硬编码)** | **16** | **26** | **18** | |

---

## 二、完整对接的接口（前端 ↔ preload ↔ handler 三层全通）

### 2.1 terminal 域（10 个完整对接）

| # | 前端调用 | Preload 桥接 | Channel | Handler | 参数匹配 |
|---|---------|-------------|---------|---------|---------|
| 1 | `terminal.list()` | `invoke(TERMINAL.LIST)` | `terminal:list` | handle (terminal-handlers:51) | ✅ 无参 |
| 2 | `terminal.create(cwd)` | `invoke(TERMINAL.CREATE, {cwd})` | `terminal:create` | handle (terminal-handlers:24) | ✅ `{cwd: string}` |
| 3 | `terminal.close(id, force?)` | `invoke(TERMINAL.CLOSE, {id, force})` | `terminal:close` | handle (terminal-handlers:44) | ✅ `{id, force?}` |
| 4 | `terminal.write(id, data)` | `send(TERMINAL.WRITE, {id, data})` | `terminal:write` | on (terminal-handlers:34) | ✅ `{id, data}` |
| 5 | `terminal.resize(id, cols, rows)` | `send(TERMINAL.RESIZE, {id, cols, rows})` | `terminal:resize` | on (terminal-handlers:39) | ✅ `{id, cols, rows}` |
| 6 | `terminal.getBuffer(id)` | `invoke(TERMINAL.GET_BUFFER, {id})` | `terminal:get-buffer` | handle (terminal-handlers:74) | ✅ `{id}` |
| 7 | `terminal.getForegroundProcess(id)` | `invoke(TERMINAL.GET_FOREGROUND_PROCESS, {id})` | `terminal:get-foreground-process` | handle (terminal-handlers:65) | ✅ `{id}` |
| 8 | `terminal.updateCwd(id, path)` | `invoke(TERMINAL.UPDATE_CWD, {id, cwd})` | `terminal:update-cwd` | handle (terminal-handlers:80) | ✅ `{id, cwd}` |
| 9 | `terminal.onOutput(cb)` | `on(TERMINAL.OUTPUT)` | `terminal:output` | 事件推送 (manager.ts:103) | ✅ `{id, data}` |
| 10 | `terminal.onStateChange(cb)` | `on(TERMINAL.STATE_CHANGE)` | `terminal:state-change` | 事件推送 (manager.ts:55) | ✅ `{id, state, processName?}` |

### 2.2 terminal 域 — 事件通道（2 个完整对接）

| # | 前端调用 | Preload 桥接 | Channel | 事件推送 | 参数匹配 |
|---|---------|-------------|---------|---------|---------|
| 11 | `terminal.onExit(cb)` | `on(TERMINAL.EXIT)` | `terminal:exit` | manager.ts:120 | ✅ `{id, code}` |
| 12 | `terminal.onListUpdated(cb)` | `on('terminal:list-updated')` 硬编码 | 硬编码(无常量) | index.ts:148 | ✅ `Array<{id, state}>` |

### 2.3 fs 域（1 个完整对接）

| # | 前端调用 | Preload 桥接 | Channel | Handler | 参数匹配 |
|---|---------|-------------|---------|---------|---------|
| 13 | `fs.selectDirectory()` | `invoke(FS.SELECT_DIRECTORY)` | `fs:select-directory` | handle (index.ts:115) | ✅ 无参 |

### 2.4 chat 域（2 个完整对接）

| # | 前端调用 | Preload 桥接 | Channel | Handler | 参数匹配 |
|---|---------|-------------|---------|---------|---------|
| 14 | `chat.getHistory()` | `invoke(CHAT.GET_HISTORY, params?)` | `chat:get-history` | handle (chat-handlers:96) | ✅ `params?` |
| 15 | `chat.getSession(sessionId)` | `invoke(CHAT.GET_SESSION, {sessionId})` | `chat:get-session` | handle (chat-handlers:100) | ✅ `{sessionId}` |

### 2.5 app 域（1 个完整对接 — 本地调用）

| # | 前端调用 | Preload 桥接 | Channel | Handler | 参数匹配 |
|---|---------|-------------|---------|---------|---------|
| 16 | `app.getHomePath()` | 本地 `process.env.HOME` | 无 IPC | 无需 handler | ✅ 本地调用 |

**完整对接合计: 16 个前端调用全部三层贯通**

---

## 三、前端调用但后端未实现（后端缺口）

### 3.1 fs 域

| # | 前端调用 | Preload | Handler | 优先级 | 说明 |
|---|---------|---------|---------|-------|------|
| 1 | `fs.readDir(path)` | ❌ 未桥接 | ❌ 未注册 | **P1** | FilePanel.tsx:56 调用，但 preload 未暴露 `readDir` 方法，channels.ts 定义了 `fs:read-dir` 但全链路未接通。当前有 mock 数据兜底，不影响启动但文件面板始终显示 mock。 |

> **分析**: 前端代码通过 `(window as any).api?.fs?.readDir` 做了防御性调用（可选链 + 类型断言），当 `readDir` 不存在时静默回退到 mock 数据。这是已知的待实现功能，非 bug。

### 3.2 chat 域

| # | 前端调用 | Preload | Handler | 优先级 | 说明 |
|---|---------|---------|---------|-------|------|
| 2 | `chat.onSessionUpdate(cb)` | ✅ 已桥接 (preload:96-99) | ❌ Main 端无推送 | **P2** | ChatHistoryPanel.tsx:89 监听会话更新事件。preload 已桥接监听 `chat:session-update`，但 main 进程没有任何地方 send 此事件。实时刷新不工作，但手动刷新可用。 |

**后端缺口合计: 2 个**

---

## 四、后端已实现但前端未调用（前端缺口）

### 4.1 有 Handler + Preload 但前端未使用

| # | API 方法 | Handler | Preload | 是否需要前端补充 | 说明 |
|---|---------|---------|---------|----------------|------|
| 1 | `terminal.getState(id)` | handle (terminal-handlers:56) | invoke (preload:32-33) | 可选 | 获取单个终端状态，当前前端通过 onStateChange 事件监听实现。可作为补充查询手段。 |
| 2 | `app.getConfig()` | handle (index.ts:105) | invoke (preload:62-63) | 可选 | 读取应用配置。当前前端未直接使用，配置由 main 进程内部管理。 |
| 3 | `app.saveConfig(config)` | handle (index.ts:109) | invoke (preload:64-65) | 可选 | 保存应用配置。同上。 |
| 4 | `chat.search(query)` | handle (chat-handlers:104) | ❌ 未桥接 | 需先补桥接 | Handler 已实现（返回空结果占位），但 preload 未暴露。等搜索功能开发时一起补。 |
| 5 | `chat.export(sessionId, format)` | handle (chat-handlers:108) | ❌ 未桥接 | 需先补桥接 | Handler 已实现（返回占位路径），但 preload 未暴露。等导出功能开发时一起补。 |

### 4.2 有 Preload 但无 Handler 也无前端调用

| # | API 方法 | Handler | Preload | 说明 |
|---|---------|---------|---------|------|
| 6 | `app.getPreferences()` | ❌ 未注册 | invoke (preload:66-67) | preload 桥接了但 main 未注册 handler，前端也未调用。属于预留接口。 |
| 7 | `app.savePreferences(prefs)` | ❌ 未注册 | invoke (preload:68-69) | 同上 |
| 8 | `app.detectCliTools()` | ❌ 未注册 | invoke (preload:70-71) | 同上，用于检测 Claude Code/Codex/Gemini CLI 是否安装 |
| 9 | `fs.readFile(path)` | ❌ 未注册 | invoke (preload:84-85) | preload 桥接了 `fs:read-file`，但无 handler 也无前端调用 |
| 10 | `fs.writeFile(path, content)` | ❌ 未注册 | invoke (preload:86-87) | preload 桥接了 `fs:write-file`，但无 handler 也无前端调用 |

### 4.3 有 Preload 监听但 Main 无推送也无前端调用

| # | API 方法 | 推送端 | Preload | 说明 |
|---|---------|--------|---------|------|
| 11 | `app.onMemoryWarning(cb)` | ❌ 无推送 | on (preload:73-77) | preload 桥接了监听 `app:memory-warning`，但 main 未实现推送逻辑 |
| 12 | `chat.onSyncStatus(cb)` | ❌ 无推送 | on (preload:101-104) | preload 桥接了监听 `chat:sync-status`，但 main 未实现推送逻辑 |

**前端缺口合计: 12 个**（5 个有 handler、7 个仅 preload 占位）

---

## 五、Channel 已定义但全链路未实现

以下 channel 在 `channels.ts` 中已定义，但 handler、preload、前端均未实现。

### 5.1 FS 域（5 个，V1-P1 功能）

| Channel | 常量 | 版本 | 说明 |
|---------|------|------|------|
| `fs:read-dir` | FS.READ_DIR | V1-P1 | 前端有调用但 preload 未桥接、handler 未注册 — 见第三节 |
| `fs:watch-start` | FS.WATCH_START | V1-P1 | 文件监听启动 |
| `fs:watch-stop` | FS.WATCH_STOP | V1-P1 | 文件监听停止 |
| `fs:change` | FS.CHANGE | V1-P1 | 文件变更事件（Main→Renderer） |
| `fs:write-temp-image` | FS.WRITE_TEMP_IMAGE | V1-P1 | 临时图片写入 |
| `fs:write-clipboard-image` | FS.WRITE_CLIPBOARD_IMAGE | V1-P1 | 剪贴板图片写入 |

### 5.2 CONFIG 域（8 个，V1-P0 功能）

| Channel | 常量 | 版本 | 说明 |
|---------|------|------|------|
| `config:get-resources` | CONFIG.GET_RESOURCES | V1-P0 | 资源列表获取 |
| `config:get-resource-content` | CONFIG.GET_RESOURCE_CONTENT | V1-P0 | 资源内容读取 |
| `config:get-settings` | CONFIG.GET_SETTINGS | V1-P0 | 设置读取 |
| `config:save-settings` | CONFIG.SAVE_SETTINGS | V1-P0 | 设置保存 |
| `config:get-claude-md` | CONFIG.GET_CLAUDE_MD | V1-P0 | CLAUDE.md 读取 |
| `config:save-claude-md` | CONFIG.SAVE_CLAUDE_MD | V1-P0 | CLAUDE.md 保存 |
| `config:get-memory` | CONFIG.GET_MEMORY | V1-P0 | Memory 读取 |
| `config:resource-change` | CONFIG.RESOURCE_CHANGE | V1-P0 | 资源变更事件 |

### 5.3 MARKETPLACE 域（8 个，V2 功能）

| Channel | 常量 | 版本 | 说明 |
|---------|------|------|------|
| `marketplace:fetch-sources` | MARKETPLACE.FETCH_SOURCES | V2 | 数据源拉取 |
| `marketplace:search` | MARKETPLACE.SEARCH | V2 | 搜索 |
| `marketplace:install` | MARKETPLACE.INSTALL | V2 | 安装 |
| `marketplace:uninstall` | MARKETPLACE.UNINSTALL | V2 | 卸载 |
| `marketplace:get-installed` | MARKETPLACE.GET_INSTALLED | V2 | 已安装列表 |
| `marketplace:install-progress` | MARKETPLACE.INSTALL_PROGRESS | V2 | 安装进度事件 |
| `marketplace:check-updates` | MARKETPLACE.CHECK_UPDATES | V2 | 检查更新 |
| `marketplace:packages-loaded` | MARKETPLACE.PACKAGES_LOADED | V2 | 包加载完成事件 |
| `marketplace:update-available` | MARKETPLACE.UPDATE_AVAILABLE | V2 | 可用更新事件 |

### 5.4 SCORE 域（5 个，V2 功能）

| Channel | 常量 | 版本 | 说明 |
|---------|------|------|------|
| `score:run` | SCORE.RUN | V2 | 运行评分 |
| `score:check-scorer` | SCORE.CHECK_SCORER | V2 | 检查评分器 |
| `score:get-cached` | SCORE.GET_CACHED | V2 | 获取缓存评分 |
| `score:progress` | SCORE.PROGRESS | V2 | 评分进度事件 |
| `score:result` | SCORE.RESULT | V2 | 评分结果事件 |

### 5.5 SHOWCASE 域（4 个，V2 功能）

| Channel | 常量 | 版本 | 说明 |
|---------|------|------|------|
| `showcase:generate` | SHOWCASE.GENERATE | V2 | 生成展示卡 |
| `showcase:publish` | SHOWCASE.PUBLISH | V2 | 发布 |
| `showcase:unpublish` | SHOWCASE.UNPUBLISH | V2 | 取消发布 |
| `showcase:publish-result` | SHOWCASE.PUBLISH_RESULT | V2 | 发布结果事件 |

### 5.6 AUTH 域（3 个，V2 功能）

| Channel | 常量 | 版本 | 说明 |
|---------|------|------|------|
| `auth:login-github` | AUTH.LOGIN_GITHUB | V2 | GitHub 登录 |
| `auth:logout` | AUTH.LOGOUT | V2 | 登出 |
| `auth:get-status` | AUTH.GET_STATUS | V2 | 登录状态查询 |

### 5.7 ANALYTICS 域（3 个，V2 功能）

| Channel | 常量 | 版本 | 说明 |
|---------|------|------|------|
| `analytics:track` | ANALYTICS.TRACK | V2 | 事件追踪 |
| `analytics:get-summary` | ANALYTICS.GET_SUMMARY | V2 | 统计摘要 |
| `analytics:clear` | ANALYTICS.CLEAR | V2 | 清除统计 |

**全链路未实现合计: 42 个 channel**（FS 5 + CONFIG 8 + MARKETPLACE 9 + SCORE 5 + SHOWCASE 4 + AUTH 3 + ANALYTICS 3 + APP/CHAT 部分 5）

---

## 六、类型不匹配或异常发现

### 6.1 硬编码 channel 名

| 问题 | 位置 | 详情 |
|------|------|------|
| `terminal:list-updated` 硬编码 | preload/index.ts:55, main/index.ts:148 | 该 channel 在 `channels.ts` 中**没有定义**常量。preload 和 main 都使用字符串字面量 `'terminal:list-updated'`。应在 `IPC_CHANNELS.TERMINAL` 中新增 `LIST_UPDATED: 'terminal:list-updated'` 并替换硬编码。 |

### 6.2 前端 readDir 调用与 preload 不匹配

| 问题 | 位置 | 详情 |
|------|------|------|
| 前端调用 `window.api.fs.readDir()` | FilePanel.tsx:56 | preload 中 fs 域只暴露了 `selectDirectory`、`readFile`、`writeFile` 三个方法，**没有 `readDir`**。前端通过 `(window as any).api?.fs?.readDir` 可选链调用做了防御，运行时不会报错但功能不可用。 |

### 6.3 chat.search / chat.export handler 与 preload 断层

| 问题 | 位置 | 详情 |
|------|------|------|
| handler 已注册但 preload 未暴露 | chat-handlers.ts:104,108 / preload/index.ts:91-106 | `chat:search` 和 `chat:export` 在 main 端注册了 handler，但 preload 的 chat 域只桥接了 `getHistory`、`getSession`、`onSessionUpdate`、`onSyncStatus` 四个方法。前端无法调用 search/export。 |

### 6.4 事件推送缺失

| 事件 Channel | Preload 监听 | Main 推送 | 问题 |
|-------------|-------------|----------|------|
| `chat:session-update` | ✅ preload:98 | ❌ 无推送代码 | 前端 ChatHistoryPanel.tsx:89 注册了监听，但不会收到任何事件 |
| `chat:sync-status` | ✅ preload:103 | ❌ 无推送代码 | preload 桥接了但无推送端 |
| `app:memory-warning` | ✅ preload:75 | ❌ 无推送代码 | preload 桥接了但无推送端 |

### 6.5 非 IPC 工具文件

| 文件 | 说明 |
|------|------|
| `src/main/services/chat/text-forward.ts` | 纯函数工具，不注册 IPC handler |
| `src/main/services/chat/image-handler.ts` | 纯函数工具，不注册 IPC handler |

---

## 七、补充建议

按优先级排列需要补充的接口：

### P0 — 核心功能缺口（影响用户体验）

1. **补充 `terminal:list-updated` 到 channels.ts**
   - 在 `IPC_CHANNELS.TERMINAL` 中新增 `LIST_UPDATED: 'terminal:list-updated'`
   - 替换 `src/preload/index.ts:55` 和 `src/main/index.ts:148` 中的硬编码字符串
   - 工作量：小（~15 分钟）

2. **实现 `fs:read-dir` 全链路**
   - 新增 handler 注册（读取目录内容）
   - 在 preload fs 域添加 `readDir(path)` → `invoke(FS.READ_DIR, {path})`
   - FilePanel 已有前端调用代码，接通即可
   - 工作量：中（~1 小时）

### P1 — 功能增强（部分功能受限）

3. **在 preload 补充 `chat.search` 和 `chat.export` 桥接**
   - Handler 已存在，只需在 preload/index.ts chat 域添加两个 invoke 方法
   - 工作量：小（~15 分钟）

4. **实现 `chat:session-update` 事件推送**
   - 在 chat-sync 服务中检测到新消息时 send `chat:session-update` 事件
   - 前端监听代码已就绪
   - 工作量：中（~1 小时）

5. **补充 `app:get-preferences` / `app:save-preferences` handler**
   - preload 已桥接，需在 main/index.ts 注册 handler
   - 工作量：中（~1 小时）

6. **补充 `app:detect-cli-tools` handler**
   - 检测系统中已安装的 AI CLI 工具（claude, codex, gemini）
   - 工作量：中（~1 小时）

### P2 — 可延后（V1-P1 或 V2 功能）

7. **FS 域剩余接口**（watch-start/stop, change, write-temp-image, write-clipboard-image）— V1-P1 文件监听和图片处理功能
8. **CONFIG 域全部 8 个接口** — V1-P0 配置管理面板功能
9. **fs:read-file / fs:write-file handler** — preload 已桥接，handler 待实现
10. **app:memory-warning 推送** — 内存监控功能
11. **chat:sync-status 推送** — 聊天同步状态功能

### V2 — 后续版本

12. **MARKETPLACE 域** 全部 9 个接口 — Skill 市场功能
13. **SCORE 域** 全部 5 个接口 — AI 评分功能
14. **SHOWCASE 域** 全部 4 个接口 — 展示卡发布功能
15. **AUTH 域** 全部 3 个接口 — GitHub 认证功能
16. **ANALYTICS 域** 全部 3 个接口 — 使用分析功能

---

## 附录：接口实现进度统计

| 指标 | 数量 | 百分比 |
|------|------|-------|
| Channel 定义（含硬编码） | 60 | 100% |
| Handler 已注册 | 16 | 27% |
| Preload 已桥接 | 26 | 43% |
| 前端有调用 | 18 | 30% |
| **三层完整贯通** | **16** | **27%** |
| 全链路未实现 | 42 | 70% |

> 注: 16 个完整贯通接口覆盖了当前 V1-P0 核心功能（终端管理 + 聊天浏览 + 基础文件操作），项目处于 MVP 阶段，核心路径可用。
