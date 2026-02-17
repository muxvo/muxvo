# Muxvo 全链路实现路线图

> 生成时间: 2026-02-17
> 基于接口审计报告 (docs/interface-audit.md) 的深度分析

## 总览

### 统计数据

| 指标 | 数值 |
|------|------|
| Channel 总数 | 60（59 定义 + 1 硬编码） |
| 已贯通 | 16 |
| 待实现 | 44 |
| P0（阻塞当前功能） | 6 个 |
| P1（增强功能） | 10 个 |
| P2（未来版本） | 28 个 |
| 总预估工作量 | ~78h |

### 优先级分布

| 优先级 | Channel 数 | 涉及域 | 工作量 |
|--------|-----------|--------|--------|
| P0 | 6 | Terminal(1), FS(1), Config(4) | ~4.75h |
| P1 | 10 | FS(2), APP(3), Chat(2), Config(2), Auth(1 类型修复) | ~6.25h |
| P2 | 28 | FS(4), APP(1), Chat(2), Config(2), Auth(3), Analytics(3), Marketplace(9), Score(5), Showcase(4) | ~67h |

---

## 一、P0 — 阻塞当前功能（立即修复）

### 1.1 terminal:list-updated 常量补全

- **域**: Terminal
- **当前状态**: 功能正常但硬编码字符串，未在 channels.ts 中定义常量
- **链路**: channel ❌(硬编码) → handler ✅(index.ts:148) → preload ✅(硬编码) → 前端 ✅
- **实现方案**:
  1. 修改 `src/shared/constants/channels.ts`: 在 TERMINAL 对象添加 `LIST_UPDATED: 'terminal:list-updated'`
  2. 修改 `src/main/index.ts:148`: 替换硬编码为 `IPC_CHANNELS.TERMINAL.LIST_UPDATED`
  3. 修改 `src/preload/index.ts:55-56`: 替换两处硬编码
- **依赖**: 无
- **工作量**: 15min

### 1.2 fs:read-dir 全链路实现

- **域**: FS
- **当前状态**: channel 已定义但 handler、preload 均缺失。FilePanel 使用 mock 数据降级
- **链路**: channel ✅ → handler ❌ → preload ❌ → 前端 ✅(防御性调用)
- **实现方案**:
  1. 新建或在 `src/main/index.ts` 中注册 `fs:read-dir` handler，使用 `fs.promises.readdir` + `withFileTypes`
  2. 修改 `src/preload/index.ts`: 在 fs 域添加 `readDir` 桥接
  3. 前端无需修改 — FilePanel.tsx 已有调用代码，接通即自动工作
- **依赖**: 无
- **工作量**: 1h

### 1.3 config:get-resources 全链路实现

- **域**: Config
- **当前状态**: 全链路未实现。MenuDropdown 使用硬编码 demo 数据
- **链路**: channel ✅ → handler ❌ → preload ❌ → 前端 ❌(demo 数据)
- **实现方案**:
  1. 新建 `src/main/ipc/config-handlers.ts`，实现资源扫描逻辑：
     - 映射资源类型到 `~/.claude/` 下对应目录（skills, hooks, plans, tasks, plugins, mcp.json）
     - 过滤 node_modules、package.json 等非资源文件
  2. 在 `src/preload/index.ts` 新增 config 域，暴露 `getResources` 方法
  3. 在 `src/main/index.ts` 注册 handler
  4. 前端替换 MenuDropdown.tsx 的 demo 数据
- **依赖**: 无
- **工作量**: 2h

### 1.4 config:get-resource-content 全链路实现

- **域**: Config
- **当前状态**: 全链路未实现
- **链路**: channel ✅ → handler ❌ → preload ❌ → 前端 ❌
- **实现方案**:
  1. 在 config-handlers.ts 中注册 handler，读取指定路径文件内容
  2. **安全要点**: 必须校验 path 在 `~/.claude/` 范围内，防止路径遍历攻击
  3. preload 添加 `getResourceContent` 桥接
- **依赖**: config:get-resources (1.3) 提供路径
- **工作量**: 30min

### 1.5 config:get-settings 全链路实现

- **域**: Config
- **当前状态**: 全链路未实现。config-manager store 使用 mock 数据
- **链路**: channel ✅ → handler ❌ → preload ❌ → 前端 ❌(mock)
- **实现方案**:
  1. 在 config-handlers.ts 中注册 handler，读取 `~/.claude/settings.json`
  2. 文件不存在时返回空对象
  3. preload 添加 `getSettings` 桥接
- **依赖**: 无
- **工作量**: 30min

### 1.6 config:get-claude-md 全链路实现

- **域**: Config
- **当前状态**: 全链路未实现。store 有 ClaudeMdView 状态但无 IPC 调用
- **链路**: channel ✅ → handler ❌ → preload ❌ → 前端 ❌
- **实现方案**:
  1. 在 config-handlers.ts 中注册 handler:
     - scope=global → 读取 `~/.claude/CLAUDE.md`
     - scope=project → 读取 `{projectPath}/CLAUDE.md`
  2. preload 添加 `getClaudeMd` 桥接
- **依赖**: 无
- **工作量**: 30min

> **P0 总工作量: ~4.75h**

---

## 二、P1 — 增强功能（近期实现）

### 2.1 app:get-preferences handler 注册

- **域**: APP
- **当前状态**: preload 已桥接，服务层 `preferences.ts` 已实现，仅差 handler 注册
- **链路**: channel ✅ → handler ❌ → preload ✅ → 前端 ❌(未调用)
- **实现方案**: 在 `src/main/index.ts` 中注册 `ipcMain.handle`，调用已有的 `getPreferences()` 服务
- **依赖**: 无
- **工作量**: 15min

### 2.2 app:save-preferences handler 注册

- **域**: APP
- **当前状态**: preload 已桥接，服务层已实现(stub)，差 handler 注册
- **链路**: channel ✅ → handler ❌ → preload ✅ → 前端 ❌(未调用)
- **实现方案**: 在 `src/main/index.ts` 中注册 handler，调用 `savePreferences()`。后续需实现持久化
- **依赖**: 无
- **工作量**: 15min（handler 注册）+ 后续 1h（持久化实现）

### 2.3 app:detect-cli-tools handler 注册

- **域**: APP
- **当前状态**: preload 已桥接，服务层 `cli-detection.ts` 已实现(stub)，差 handler 注册
- **链路**: channel ✅ → handler ❌ → preload ✅ → 前端 ❌(未调用)
- **实现方案**:
  1. 在 `src/main/index.ts` 注册 handler
  2. **注意类型不匹配**: 服务返回 `{ detectedTools: Array }` 格式，类型定义为 `{ claude: boolean; codex: boolean; gemini: boolean }`，handler 需做格式转换
  3. 后续需完善真正的 `which` 命令检测
- **依赖**: 无
- **工作量**: 20min（handler 注册 + 格式转换）+ 后续 1h（真正检测实现）

### 2.4 fs:read-file handler 注册

- **域**: FS
- **当前状态**: preload 已桥接，但 handler 未注册。前端暂未调用
- **链路**: channel ✅ → handler ❌ → preload ✅ → 前端 ❌
- **实现方案**:
  1. 注册 handler，使用 `fs.promises.readFile` 读取文件
  2. 可集成 `src/main/services/fs/safe-ops.ts` 的权限校验逻辑
- **依赖**: 无
- **工作量**: 30min

### 2.5 fs:write-file handler 注册

- **域**: FS
- **当前状态**: preload 已桥接，但 handler 未注册
- **链路**: channel ✅ → handler ❌ → preload ✅ → 前端 ❌
- **实现方案**:
  1. 注册 handler，使用 `fs.promises.writeFile`
  2. **安全要点**: 需限制可写路径范围，防止任意文件写入
- **依赖**: 需安全策略设计
- **工作量**: 45min

### 2.6 chat:search preload 桥接 + handler 实现

- **域**: Chat
- **当前状态**: handler 已注册但为占位实现（返回空结果），preload 未桥接
- **链路**: channel ✅ → handler ✅(占位) → preload ❌ → 前端 ❌
- **实现方案**:
  1. preload 添加 `search` 桥接
  2. handler 实现真正搜索: 读取 `~/.claude/history.jsonl`，对 display 字段做 substring match
  3. 前端暂不需要，等搜索 UI 开发时一起做
- **依赖**: 无
- **工作量**: 1.5h

### 2.7 chat:session-update 推送实现

- **域**: Chat
- **当前状态**: preload 已桥接 + 前端已监听，但主进程无推送逻辑
- **链路**: channel ✅ → 推送端 ❌ → preload ✅ → 前端 ✅
- **实现方案**:
  1. 新建 `src/main/services/chat-watcher.ts`
  2. 使用 Node.js 原生 `fs.watch` 递归监听 `~/.claude/projects/` 目录（macOS 支持 recursive）
  3. 检测到 `.jsonl` 文件变更时，解析路径提取 projectHash 和 sessionId
  4. 通过 `webContents.send(CHAT.SESSION_UPDATE, { projectId, sessionId })` 推送
  5. 在 `src/main/index.ts` 中启动 watcher
- **依赖**: 无额外依赖
- **工作量**: 1.5h

### 2.8 config:save-settings 全链路实现

- **域**: Config
- **当前状态**: 全链路未实现。store SAVE_SETTINGS action 已定义但无 IPC 调用
- **链路**: channel ✅ → handler ❌ → preload ❌ → 前端 ❌
- **实现方案**:
  1. 在 config-handlers.ts 注册 handler，使用原子写入（tmp + rename）
  2. 写入前与现有内容合并，避免丢失字段
  3. preload 添加 `saveSettings` 桥接
- **依赖**: config:get-settings (1.5) 应先实现
- **工作量**: 30min

### 2.9 config:save-claude-md 全链路实现

- **域**: Config
- **当前状态**: 全链路未实现
- **链路**: channel ✅ → handler ❌ → preload ❌ → 前端 ❌
- **实现方案**:
  1. 在 config-handlers.ts 注册 handler，使用原子写入
  2. scope=global 写入 `~/.claude/CLAUDE.md`，scope=project 写入 `{projectPath}/CLAUDE.md`
  3. preload 添加 `saveClaudeMd` 桥接
- **依赖**: config:get-claude-md (1.6) 应先实现
- **工作量**: 30min

### 2.10 auth.types.ts 与 github-oauth.ts 类型冲突修复

- **域**: Auth（跨域异常）
- **当前状态**: 两处 `AuthStatus` 接口定义不一致 — auth.types.ts 为扁平结构，github-oauth.ts 为嵌套结构
- **实现方案**:
  1. 以测试 spec (AUTH_L1_01~03) 为准，更新 `src/shared/types/auth.types.ts` 为嵌套结构
  2. 修改 `src/modules/auth/github-oauth.ts`，删除重复定义，改为 import 统一类型
- **依赖**: 无，可立即修复
- **工作量**: 15min

> **P1 总工作量: ~6.25h**（不含后续深度实现的额外工作）

---

## 三、P2 — 未来版本

### 3.1 FS 域 — 文件监听与图片处理

#### 3.1.1 fs:watch-start + fs:watch-stop + fs:change（联合实现）

- **当前状态**: channel 已定义，全链路未实现。file-watcher 状态机和 scopes 已就绪
- **链路**: channel ✅ → handler ❌ → preload ❌ → 前端 ❌
- **实现方案**:
  1. 新建 `src/main/services/file-watcher/watcher.ts`，基于 chokidar 或 fs.watch 实现实际监听
  2. 注册 watch-start/watch-stop handler，维护 `id→watcher` 映射
  3. 文件变更时通过 `webContents.send(FS.CHANGE, event)` 推送
  4. preload 添加 `watchStart`、`watchStop`、`onFileChange` 桥接
  5. 前端 FilePanel 订阅 `fs:change` 事件刷新文件列表
- **已有基础设施**: `file-watcher/store.ts` 状态机、`file-watcher/scopes.ts` 监听范围定义
- **依赖**: 需决定使用 chokidar 还是 Node.js 内置 fs.watch
- **工作量**: 3h

#### 3.1.2 fs:write-temp-image

- **当前状态**: channel 已定义，全链路未实现。temp-file-manager 服务已就绪
- **链路**: channel ✅ → handler ❌ → preload ❌ → 前端 ❌
- **实现方案**: handler 解码 base64 → 写入 `os.tmpdir()/muxvo/` → 通过 temp-file-manager 注册 → 返回文件路径
- **已有基础设施**: `temp-file-manager.ts` 提供 `registerFile`、`cleanupExpired` 方法
- **工作量**: 1.5h

#### 3.1.3 fs:write-clipboard-image

- **当前状态**: channel 已定义，全链路未实现
- **链路**: channel ✅ → handler ❌ → preload ❌ → 前端 ❌
- **实现方案**: handler 读取图片 → 通过终端 write 发送路径或 clipboard API
- **依赖**: 需与终端 write 功能协同设计
- **工作量**: 1.5h

### 3.2 APP 域 — 内存监控

#### 3.2.1 app:memory-warning 推送实现

- **当前状态**: preload 已桥接，memory-monitor 服务已实现，缺少 Main 进程定时检查和推送
- **链路**: channel ✅ → 推送端 ❌ → preload ✅ → 前端 ❌
- **实现方案**:
  1. 在 `app.whenReady()` 中启动 30s 定时器，调用 `memMonitor.checkMemory()`
  2. 超阈值时推送 `APP.MEMORY_WARNING` 事件
  3. **注意**: 需统一 preload callback 参数类型为 `MemoryWarningEvent`（当前 preload 为 `{ usage }` 而类型定义为 `{ usageMB, threshold }`）
- **已有基础设施**: `memory-monitor.ts` 提供 `checkMemory()` 和 `getThreshold()`
- **工作量**: 45min

### 3.3 Chat 域 — 导出与同步状态

#### 3.3.1 chat:export

- **当前状态**: handler 已注册(占位)，preload 未桥接
- **链路**: channel ✅ → handler ✅(占位) → preload ❌ → 前端 ❌
- **实现方案**: 实现真正导出逻辑（读取 session JSONL → 转换为 markdown/json → 保存文件）
- **依赖**: chat-dual-source.ts 的 `readSession()` 读取 session 数据
- **工作量**: 2h

#### 3.3.2 chat:sync-status 推送实现

- **当前状态**: preload 已桥接，前端未使用，主进程无推送逻辑
- **链路**: channel ✅ → 推送端 ❌ → preload ✅ → 前端 ❌
- **实现方案**: 在 chat-watcher 中，同步开始/结束/出错时推送状态
- **依赖**: chat:session-update 的 watcher 实现 (2.7)
- **工作量**: 30min

### 3.4 Config 域 — Memory 与资源变更监听

#### 3.4.1 config:get-memory

- **当前状态**: 全链路未实现。store 有 MemoryView 状态但无 IPC
- **链路**: channel ✅ → handler ❌ → preload ❌ → 前端 ❌
- **实现方案**: 读取 `~/.claude/projects/{projectHash}/memory/MEMORY.md`
- **注意**: 当前接口定义无参数，但 memory 是项目级的，需要修改接口增加 `projectPath` 参数
- **依赖**: 需要项目路径到 projectHash 的映射逻辑
- **工作量**: 1h

#### 3.4.2 config:resource-change 事件推送

- **当前状态**: 全链路未实现
- **链路**: channel ✅ → 推送端 ❌ → preload ❌ → 前端 ❌
- **实现方案**:
  1. 新建 `src/main/services/config-watcher.ts`，监听 skills/hooks/plugins 目录变更
  2. 文件变更时推送 `CONFIG.RESOURCE_CHANGE` 事件
  3. 可与 chat-watcher 共享 watcher 模式
- **工作量**: 1.5h

### 3.5 Auth 域（3 个 channel）

#### 3.5.1 auth:login-github — GitHub OAuth 登录

- **当前状态**: 状态机和 token-storage 已实现，OAuth 骨架已有但返回 `{success:false}`
- **链路**: channel ✅ → handler ❌ → preload ❌ → 前端 ❌
- **实现方案**:
  1. 新建 `src/main/services/auth/github-auth.ts`: 实现 GitHub OAuth PKCE 流程
     - 使用 `shell.openExternal()` 打开授权 URL
     - 注册 `muxvo://auth/callback` deep link handler
     - 用 auth code 换取 access token
     - 调用 GitHub API `/user` 获取用户信息
     - 用 `safeStorage.encryptString()` 安全存储 token
  2. 新建 `src/main/ipc/auth-handlers.ts`: 注册 3 个 handler
  3. 更新 `src/preload/index.ts`: 添加 auth 域桥接
  4. 更新 `src/main/index.ts`: 注册 handlers + deep link
- **已有基础设施**: `auth-machine.ts` 状态机、`token-storage.ts` 存储、`github-oauth.ts` 骨架
- **依赖**: GitHub OAuth App（client_id + client_secret）、Electron deep link、safeStorage API
- **工作量**: ~8h（含 OAuth 流程 + 安全存储 + deep link）

#### 3.5.2 auth:logout + auth:get-status

- 随 login-github 一起实现
- **工作量**: 含在 auth:login-github 工作量中

### 3.6 Analytics 域（3 个 channel）

#### 3.6.1 analytics:track + get-summary + clear（联合实现）

- **当前状态**: 全域仅有 `retention.ts` 保留策略实现
- **链路**: channel ✅ → handler ❌ → preload ❌ → 前端 ❌
- **实现方案**:
  1. 新建 `src/main/services/analytics/tracker.ts`: JSONL 按天存储事件
  2. 新建 `src/main/ipc/analytics-handlers.ts`: 3 个 handler
  3. 更新 preload 添加 analytics 域
  4. 启动时调用 `runRetention()` 清理过期数据
- **已有基础设施**: `retention.ts`（events 90天, summary 365天）
- **依赖**: 数据存储目录 `app.getPath('userData')/analytics/`
- **工作量**: ~5h

### 3.7 Marketplace 域（9 个 channel）

#### 3.7.1 marketplace:fetch-sources

- **当前状态**: 类型定义和 14 个 module 层逻辑已就绪，IPC 链路完全未接通
- **链路**: channel ✅ → handler ❌ → preload ❌ → 前端 ❌
- **实现方案**:
  1. 新建 `src/main/ipc/marketplace-handlers.ts`
  2. handler 调用 `fetchSources()` from aggregator.ts → 按 `getDefaultSortOrder()` 排序
  3. preload 新增 marketplace 域
- **已有基础设施**: `aggregator.ts`（6 个源聚合）、`sort-strategy.ts`（排序）、`validators.ts`（校验）
- **工作量**: 2h

#### 3.7.2 marketplace:search

- handler 从已加载包列表模糊匹配 name/displayName/description/tags
- **依赖**: fetch-sources 先完成
- **工作量**: 2h

#### 3.7.3 marketplace:install + install-progress（联合实现）

- 编排: 下载 → 校验 → hook 安全审查 → 安装 → 注册表更新 → 级联通知
- **已有基础设施**: `downloader.ts`（带重试）、`installer.ts`、`integrity-checker.ts`、`post-install.ts`
- **工作量**: 5h

#### 3.7.4 marketplace:get-installed

- 扫描 `~/.claude/skills/` 和 `~/.claude/hooks/` + 读取 registry
- **已有基础设施**: `registry.ts`
- **工作量**: 2h

#### 3.7.5 marketplace:uninstall

- 调用 `uninstallPackage()` → 删除文件 + 清理注册表
- **已有基础设施**: `uninstaller.ts`
- **工作量**: 2h

#### 3.7.6 marketplace:check-updates + update-available + packages-loaded

- 对比已安装列表与远程最新版本
- **已有基础设施**: `update-scheduler.ts`（6h 轮询）、`batch-updater.ts`
- **依赖**: fetch-sources + get-installed
- **工作量**: 4h

### 3.8 Score 域（5 个 channel）

#### 3.8.1 score:check-scorer

- 检查 CC CLI 是否安装 + 当前是否有活跃 CC 终端
- **依赖**: terminal 域 manager
- **工作量**: 2h

#### 3.8.2 score:run + progress + result（联合实现）

- 编排: CC 检查 → 缓存检查 → 调用 CC 执行评分 prompt → 解析 → 计算加权分 → 等级映射 → 缓存
- **已有基础设施**: `score/manager.ts`（API + retry）、`runner.ts`、`calculator.ts`、`grade-mapper.ts`、`cache.ts`
- **依赖**: 需要运行中的 CC 终端
- **工作量**: 6h

#### 3.8.3 score:get-cached

- 查询本地缓存评分 + contentHash 有效性校验
- **已有基础设施**: `cache.ts`（getCachedScore + checkCacheValidity）
- **工作量**: 2h

### 3.9 Showcase 域（4 个 channel）

#### 3.9.1 showcase:generate

- 编排: 读取 skill → 查询评分 → 生成草稿 → 选择模板 → 保存配置
- **已有基础设施**: `generator.ts`、`score-showcase-bridge.ts`、`og-card.ts`、`image-validator.ts`
- **依赖**: score 缓存（可选）
- **工作量**: 5h

#### 3.9.2 showcase:publish + publish-result（联合实现）

- 编排: 安全扫描 → 检查 GitHub 登录 → 发布流程 → GitHub Pages 部署
- **已有基础设施**: `publish-flow.ts`、`github-pages.ts`、`security-scanner.ts`（三重扫描）
- **依赖**: **auth 域**（GitHub 登录状态和 token）— 最大依赖
- **工作量**: 6h

#### 3.9.3 showcase:unpublish

- 从 GitHub Pages 移除页面 + 更新本地配置
- **依赖**: auth 域（GitHub token）
- **工作量**: 2h

---

## 四、跨域异常修复清单

### 4.1 硬编码问题

| # | 位置 | 问题 | 修复方案 | 优先级 |
|---|------|------|---------|--------|
| 1 | `src/main/index.ts:148` + `src/preload/index.ts:55-56` | `terminal:list-updated` 使用字符串字面量而非常量 | 在 channels.ts 新增 `LIST_UPDATED`，替换两处硬编码 | P0 |

### 4.2 类型冲突

| # | 位置 | 问题 | 修复方案 | 优先级 |
|---|------|------|---------|--------|
| 1 | `auth.types.ts` vs `github-oauth.ts` | `AuthStatus` 接口定义不一致（扁平 vs 嵌套） | 以测试 spec 为准统一为嵌套结构 | P1 |
| 2 | `preload/index.ts:74` vs `config.types.ts:87` | `onMemoryWarning` callback 参数 `{ usage }` 与类型定义 `{ usageMB, threshold }` 不匹配 | 修改 preload callback 参数类型 | P2 |
| 3 | `cli-detection.ts` 返回值 vs `CLIToolsDetection` | 服务返回 `{ detectedTools: Array }` 格式，类型定义为 `{ claude: boolean; codex: boolean; gemini: boolean }` | handler 中做格式转换 | P1 |

### 4.3 其他检查结果

- 除 `terminal:list-updated` 外，**未发现其他硬编码 channel 名**
- 所有 preload channel 引用均通过 `IPC_CHANNELS` 常量，拼写一致
- Terminal 域 12 个 channel 的类型在 handler、preload、前端三层**完全匹配**

---

## 五、实施建议

### 推荐实施批次

| 批次 | 内容 | Channel 数 | 工作量 | 前置条件 |
|------|------|-----------|--------|----------|
| Batch 1 | P0 全部（terminal 常量修复 + fs:read-dir + config 4 个读取接口） | 6 | ~5h | 无 |
| Batch 2 | P1 APP 注册 + FS handler（get-preferences, save-preferences, detect-cli-tools, read-file, write-file） | 5 | ~2h | Batch 1 |
| Batch 3 | P1 Chat + Config 写入（chat:search, chat:session-update, config:save-settings, config:save-claude-md, auth 类型修复） | 5 | ~4.25h | Batch 1 |
| Batch 4 | P2 FS 监听 + APP 内存 + Chat 导出（watch-start/stop/change, write-temp-image, write-clipboard-image, memory-warning, chat:export, sync-status） | 8 | ~10.75h | Batch 1 |
| Batch 5 | P2 Auth 全域（login-github, logout, get-status）+ Config 剩余（get-memory, resource-change） | 5 | ~10.5h | GitHub OAuth App 注册 |
| Batch 6 | P2 Marketplace + Score（9 + 5 channel） | 14 | ~27h | Batch 5 (score 需 terminal) |
| Batch 7 | P2 Showcase + Analytics（4 + 3 channel） | 7 | ~18h | Batch 5 (auth) + Batch 6 (score) |

### 新建文件清单

| 文件路径 | 说明 |
|----------|------|
| `src/main/ipc/config-handlers.ts` | Config 域 IPC handler（资源扫描、设置读写、CLAUDE.md 读写） |
| `src/main/ipc/auth-handlers.ts` | Auth 域 3 个 IPC handler |
| `src/main/ipc/analytics-handlers.ts` | Analytics 域 3 个 IPC handler |
| `src/main/ipc/marketplace-handlers.ts` | Marketplace 域 IPC handler |
| `src/main/ipc/score-handlers.ts` | Score 域 IPC handler |
| `src/main/ipc/showcase-handlers.ts` | Showcase 域 IPC handler |
| `src/main/services/auth/github-auth.ts` | GitHub OAuth 服务（PKCE 流程、token 交换） |
| `src/main/services/analytics/tracker.ts` | 事件追踪服务（JSONL 存储、汇总查询） |
| `src/main/services/chat-watcher.ts` | Chat session 文件变更监听 |
| `src/main/services/config-watcher.ts` | Config 资源文件变更监听 |
| `src/main/services/file-watcher/watcher.ts` | 通用文件监听实现（chokidar/fs.watch） |

### 修改文件清单

| 文件路径 | 改动摘要 |
|----------|---------|
| `src/shared/constants/channels.ts` | TERMINAL 域新增 `LIST_UPDATED` 常量 |
| `src/shared/types/auth.types.ts` | 更新 `AuthLoginResponse` 和 `AuthStatus` 为嵌套结构 |
| `src/modules/auth/github-oauth.ts` | 删除重复 `AuthStatus` 接口，改为 import 统一类型 |
| `src/preload/index.ts` | 新增 config/auth/analytics/marketplace/score/showcase 六个域桥接；修复 terminal:list-updated 硬编码 |
| `src/main/index.ts` | 注册所有新 handler；启动 chat-watcher/config-watcher；修复 terminal:list-updated 硬编码 |
| `src/renderer/features/marketplace/store.ts` | 扩展 dispatch 支持 IPC 调用（替代离线模式） |
| `src/renderer/components/file/FilePanel.tsx` | 无需修改（fs:read-dir 接通后自动工作） |

### 依赖关系图

```
无依赖 ──────────────────────────────────────────────────────
  │
  ├── P0: terminal:list-updated 常量补全
  ├── P0: fs:read-dir 全链路
  ├── P0: config:get-resources → config:get-resource-content
  ├── P0: config:get-settings → P1: config:save-settings
  ├── P0: config:get-claude-md → P1: config:save-claude-md
  ├── P1: app:get-preferences / save-preferences / detect-cli-tools
  ├── P1: fs:read-file / write-file
  └── P1: chat:search

chat-watcher ────────────────────────────────────────────────
  │
  ├── P1: chat:session-update 推送
  └── P2: chat:sync-status 推送

GitHub OAuth App ────────────────────────────────────────────
  │
  └── P2: auth 全域 (login-github, logout, get-status)
           │
           ├── P2: showcase:publish ← 强依赖 auth token
           └── P2: showcase:unpublish ← 依赖 auth token

terminal 域 (已完整) ────────────────────────────────────────
  │
  └── P2: score:check-scorer → score:run
           │
           └── P2: showcase:generate (可选依赖 score 缓存)

marketplace 内部依赖 ────────────────────────────────────────
  │
  ├── marketplace:fetch-sources
  │    ├── marketplace:search
  │    └── marketplace:packages-loaded (事件)
  │
  ├── marketplace:get-installed
  │    └── marketplace:check-updates → marketplace:update-available (事件)
  │
  └── marketplace:install → marketplace:install-progress (事件)
       marketplace:uninstall

showcase 完整链路 ───────────────────────────────────────────

  score:run → showcase:generate → showcase:publish → showcase:unpublish
              (需 score 缓存)     (需 auth token)    (需 auth token)
```

### 安全要点汇总

1. **路径安全**: config:get-resource-content、config:save-claude-md、fs:write-file 等涉及文件路径的接口必须做路径校验，防止路径遍历攻击
2. **Hook 安全审查**: marketplace:install 安装 hook 类型时需触发 SecurityReview 状态
3. **Showcase 安全扫描**: showcase:publish 前需执行三重扫描（secrets + sensitive files + hardcoded paths）
4. **Token 安全存储**: auth 域使用 `electron.safeStorage` 加密存储 GitHub token
5. **原子写入**: 所有配置文件写入（settings.json、CLAUDE.md）使用 tmp + rename 模式

### 已有基础设施复用清单

| 文件 | 提供能力 | 服务于 |
|------|---------|--------|
| `src/main/services/fs/safe-ops.ts` | 带权限校验的文件读取 | fs:read-file handler |
| `src/main/services/file-watcher/store.ts` | 文件监听状态机 | fs:watch-start/stop handler |
| `src/main/services/file-watcher/scopes.ts` | 三种监听 scope 定义 | fs:watch-start handler |
| `src/main/services/temp-file-manager.ts` | 临时文件管理 + 24h 清理 | fs:write-temp-image handler |
| `src/main/services/app/preferences.ts` | 偏好读写（stub） | app:get/save-preferences handler |
| `src/main/services/onboard/cli-detection.ts` | CLI 工具检测（stub） | app:detect-cli-tools handler |
| `src/main/services/perf/memory-monitor.ts` | 内存阈值检测 | app:memory-warning 推送 |
| `src/main/services/analytics/retention.ts` | 事件保留策略（90/365 天） | analytics:track handler |
| `src/modules/auth/auth-machine.ts` | Auth 状态机 | auth 全域 |
| `src/modules/auth/token-storage.ts` | Token 安全存储（safeStorage 标记） | auth 全域 |
| `src/modules/auth/github-oauth.ts` | OAuth 骨架 | auth:login-github handler |
| `src/modules/marketplace/aggregator.ts` | 6 源聚合 | marketplace:fetch-sources |
| `src/modules/marketplace/downloader.ts` | 下载器（带重试） | marketplace:install |
| `src/modules/marketplace/uninstaller.ts` | 卸载逻辑 | marketplace:uninstall |
| `src/modules/marketplace/registry.ts` | 安装注册表 | marketplace:get-installed |
| `src/modules/marketplace/update-scheduler.ts` | 6h 轮询 | marketplace:check-updates |
| `src/modules/score/manager.ts` | 评分管理（API + retry） | score:run |
| `src/modules/score/cache.ts` | 评分缓存 | score:get-cached |
| `src/modules/score/calculator.ts` | 加权计算 | score:run |
| `src/modules/score/grade-mapper.ts` | 等级映射（5 级） | score:run |
| `src/modules/showcase/generator.ts` | 展示页生成 | showcase:generate |
| `src/modules/publish/publish-flow.ts` | 发布编排 | showcase:publish |
| `src/modules/publish/github-pages.ts` | GitHub Pages 部署 | showcase:publish |
| `src/modules/publish/security-scanner.ts` | 三重安全扫描 | showcase:publish |
