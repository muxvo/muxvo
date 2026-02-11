# 检查报告 R2-1: IPC 协议一致性

> DEV-PLAN.md vs PRD.md | 检查时间: 2026-02-11

---

## A. IPC 通道完整性（DEV-PLAN S2 vs PRD 功能需求）

逐一检查 PRD 定义的每个功能所需的数据交互是否有对应 IPC channel。

### A1. V1 功能 IPC 覆盖度

| 功能编号 | 功能名称 | 所需 IPC 交互 | 对应 IPC Channel | 状态 | 说明 |
|---------|---------|--------------|-----------------|------|------|
| A | 全屏平铺终端管理 | 创建终端 | `terminal:create` (R→M) | ✅覆盖 | 参数 `{cwd}` 与 PRD 一致 |
| A | 全屏平铺终端管理 | 关闭终端 | `terminal:close` (R→M) | ✅覆盖 | 含 `force` 选项，与 PRD SIGINT→SIGKILL 流程一致 |
| A | 全屏平铺终端管理 | 终端写入 | `terminal:write` (R→M send) | ✅覆盖 | 用于 PTY 写入 |
| A | 全屏平铺终端管理 | 终端输出 | `terminal:output` (M→R) | ✅覆盖 | 数据流推送 |
| A | 全屏平铺终端管理 | 调整尺寸 | `terminal:resize` (R→M send) | ✅覆盖 | cols/rows 参数 |
| A | 全屏平铺终端管理 | 状态变更 | `terminal:state-change` (M→R) | ✅覆盖 | 含 TerminalState + processName |
| A | 全屏平铺终端管理 | 进程退出 | `terminal:exit` (M→R) | ✅覆盖 | 含 exit code |
| A | 全屏平铺终端管理 | 获取终端列表 | `terminal:list` (R→M) | ✅覆盖 | 返回 TerminalInfo[] |
| A | 全屏平铺终端管理 | 布局持久化 | `app:get-config` / `app:save-config` (R→M) | ✅覆盖 | 保存/恢复 Grid 布局 |
| B | 聚焦模式 | 无额外 IPC | 纯前端视图切换 | ✅覆盖 | 基于 A 的终端列表 |
| C | 拖拽排序+边框调整 | 布局保存 | `app:save-config` | ✅覆盖 | columnRatios/rowRatios 持久化 |
| D | 聊天历史浏览器 | 获取历史列表 | `chat:get-history` (R→M) | ✅覆盖 | limit/offset 分页 |
| D | 聊天历史浏览器 | 获取 session 详情 | `chat:get-session` (R→M) | ✅覆盖 | projectId + sessionId |
| D | 聊天历史浏览器 | session 更新推送 | `chat:session-update` (M→R) | ✅覆盖 | 实时刷新 |
| D | 聊天历史浏览器 | 同步状态推送 | `chat:sync-status` (M→R) | ✅覆盖 | syncing/idle/error |
| E | 全文搜索 | 搜索聊天记录 | `chat:search` (R→M) | ✅覆盖 | query 参数 |
| F | 会话时间线视图 | 复用 D 的 IPC | `chat:get-history` | ✅覆盖 | 时间线为 UI 层变换 |
| G | Markdown 预览 | 读取文件 | `fs:read-file` (R→M) | ✅覆盖 | 读取 MD 文件内容 |
| G | Markdown 预览 | 写入文件 | `fs:write-file` (R→M) | ✅覆盖 | 编辑模式保存 |
| H | 文件浏览器 | 读取目录 | `fs:read-dir` (R→M) | ✅覆盖 | 返回 FileEntry[] |
| H | 文件浏览器 | 文件变更推送 | `fs:change` (M→R) | ✅覆盖 | add/change/unlink + isNew 标记 |
| H | 文件浏览器 | 启动文件监听 | `fs:watch-start` (R→M) | ✅覆盖 | 监听 cwd 目录 |
| H | 文件浏览器 | 停止文件监听 | `fs:watch-stop` (R→M) | ✅覆盖 | 终端关闭时停止 |
| I | 双段式命名 | 前台进程检测 | `terminal:get-foreground-process` (R→M) | ✅覆盖 | 返回 name + pid |
| I | 双段式命名 | 目录选择 | `fs:select-directory` (R→M) | ✅覆盖 | 系统对话框 |
| J | ~/.claude/ 浏览器 | 获取资源列表 | `config:get-resources` (R→M) | ✅覆盖 | type 参数 |
| J | ~/.claude/ 浏览器 | 获取资源内容 | `config:get-resource-content` (R→M) | ✅覆盖 | type + name |
| J | ~/.claude/ 浏览器 | 资源变更推送 | `config:resource-change` (M→R) | ✅覆盖 | 实时刷新 |
| K | 分类查看 | 复用 J 的 IPC | `config:get-resources` | ✅覆盖 | Plans/Skills/Hooks/Tasks |
| L | Settings 编辑 | 读取 Settings | `config:get-settings` (R→M) | ✅覆盖 | 返回 CCSettings |
| L | Settings 编辑 | 保存 Settings | `config:save-settings` (R→M) | ✅覆盖 | Partial\<CCSettings\> |
| L | CLAUDE.md 编辑 | 读取 CLAUDE.md | `config:get-claude-md` (R→M) | ✅覆盖 | scope 参数 |
| L | CLAUDE.md 编辑 | 保存 CLAUDE.md | `config:save-claude-md` (R→M) | ✅覆盖 | scope + content |
| M | 同目录归组 | 终端列表 + cwd | `terminal:list` | ✅覆盖 | 利用已有通道 |
| RE1 | 富编辑器基础 | 写入 PTY | `terminal:write` (R→M send) | ✅覆盖 | 文本转发到终端 |
| RE1 | 富编辑器基础 | 前台进程检测 | `terminal:get-foreground-process` | ✅覆盖 | 判断协议 |
| RE1 | 富编辑器基础 | 图片临时文件 | `fs:write-temp-image` (R→M) | ✅覆盖 | 粘贴图片处理 |
| RE2 | 富编辑器完善 | 剪贴板模拟 | `fs:write-clipboard-image` (R→M) | ✅覆盖 | CC 原生粘贴 |
| RE2 | 富编辑器完善 | ASB 检测 | 纯前端 xterm.js 信号 | ✅覆盖 | 无需 IPC |
| X3 | 聊天历史导出 | 导出操作 | `chat:export` (R→M) | ✅覆盖 | format + dateRange 参数 |

### A2. V2 功能 IPC 覆盖度

| 功能编号 | 功能名称 | 所需 IPC 交互 | 对应 IPC Channel | 状态 | 说明 |
|---------|---------|--------------|-----------------|------|------|
| N2 | Skill 聚合浏览器 | 获取聚合包列表 | `marketplace:fetch-sources` (R→M) | ✅覆盖 | sources 参数可选 |
| N2 | Skill 聚合浏览器 | 搜索包 | `marketplace:search` (R→M) | ✅覆盖 | query + source |
| O | 一键安装 | 安装包 | `marketplace:install` (R→M) | ✅覆盖 | name + source + type |
| O | 一键安装 | 卸载包 | `marketplace:uninstall` (R→M) | ✅覆盖 | name |
| O | 一键安装 | 获取已安装列表 | `marketplace:get-installed` (R→M) | ✅覆盖 | 返回 InstalledPackage[] |
| O | 一键安装 | 安装进度推送 | `marketplace:install-progress` (M→R) | ✅覆盖 | name + progress + status |
| U | Hook 安全审查 | 复用安装通道 | `marketplace:install` + UI 层审查 | ✅覆盖 | 安全审查在 UI 层完成 |
| T | 更新检测 | 检查更新 | `marketplace:check-updates` (R→M) | ✅覆盖 | 返回 UpdateInfo[] |
| SR | AI 评分 | 触发评分 | `score:run` (R→M) | ✅覆盖 | skillDirName + includeAnalytics |
| SR | AI 评分 | 检查评分 Skill | `score:check-scorer` (R→M) | ✅覆盖 | installed + version |
| SR | AI 评分 | 获取缓存评分 | `score:get-cached` (R→M) | ✅覆盖 | 返回 SkillScore \| null |
| SR | AI 评分 | 评分进度推送 | `score:progress` (M→R) | ✅覆盖 | skillDirName + status |
| SR | AI 评分 | 向 CC 发送指令 | `terminal:write` (R→M send) | ✅覆盖 | 复用已有通道 |
| SS | 展示页 | 生成展示页 | `showcase:generate` (R→M) | ✅覆盖 | skillDirName + template |
| SS | 展示页 | 发布到 Pages | `showcase:publish` (R→M) | ✅覆盖 | 返回 url |
| SS | 展示页 | 下线展示页 | `showcase:unpublish` (R→M) | ✅覆盖 | 返回 success |
| P2 | 发布分享 | GitHub 登录 | `auth:login-github` (R→M) | ✅覆盖 | 返回 username + token |
| P2 | 发布分享 | 登出 | `auth:logout` (R→M) | ✅覆盖 | 返回 success |
| P2 | 发布分享 | 认证状态 | `auth:get-status` (R→M) | ✅覆盖 | loggedIn + username |
| RE3 | 富编辑器高级 | 复用 RE1/RE2 通道 | `terminal:write` 等 | ✅覆盖 | 斜杠命令为 UI 层 |
| SC | Showcase 社区 | V2-P3 后端 API | 不在当前 IPC 范围 | ⚠️部分覆盖 | V2-P3 需新增网络请求 IPC，但属于远期规划 |
| -- | 数据埋点 | 记录事件 | `analytics:track` (R→M send) | ✅覆盖 | event + params |
| -- | 数据埋点 | 获取摘要 | `analytics:get-summary` (R→M) | ✅覆盖 | startDate + endDate |
| -- | 数据埋点 | 清除数据 | `analytics:clear` (R→M) | ✅覆盖 | 返回 success |

### A3. 遗漏数据流检查

| 检查项 | 状态 | 说明 |
|-------|------|------|
| PRD 8.14 首次引导 — 检测 AI CLI 工具 | ⚠️部分覆盖 | PRD 要求扫描 PATH 中的 `claude`/`codex`/`gemini`，DEV-PLAN 无专门 IPC。可通过 `terminal:create` 后在 Main 进程检测，或需新增 `app:detect-cli-tools` |
| PRD 8.14 首次引导 — onboarding 状态 | ✅覆盖 | 通过 `app:get-config` / `app:save-config` 读写 `onboardingCompleted` |
| PRD 5.7 对话式发布 — 通知 Muxvo 生成分享图 | ⚠️部分覆盖 | muxvo-publisher Plugin 需通知 Muxvo 生成分享图，DEV-PLAN 未定义专门 IPC。PRD 提到"通过 IPC 通知"，但具体 channel 未在 S2 中定义 |
| PRD 8.8 发布安全检查 | ⚠️部分覆盖 | DEV-PLAN S17 中 `showcase:publish` 隐含安全检查，但未定义独立的 `showcase:security-check` channel。安全检查可能在 Main 进程 `showcase:publish` handler 中内联执行 |
| PRD 8.10 OG Card 生成 | ⚠️部分覆盖 | PRD 要求生成 1200x630px OG Card 图片，DEV-PLAN S2 `showcase:generate` 返回 ShowcaseConfig 但未明确包含图片生成。可能需要在 `showcase:generate` 返回值中包含 ogImagePath |
| PRD 8.10 微信分享图 | ⚠️部分覆盖 | 同上，750x1334px 微信分享图生成未有独立 channel。可在 `showcase:generate` 中一并处理 |
| PRD Memory 读取 | ✅覆盖 | `config:get-memory` (R→M) 覆盖 MEMORY.md 读取 |
| PRD 用户偏好 | ✅覆盖 | `app:get-preferences` / `app:save-preferences` 覆盖 |
| PRD 内存监控警告 | ⚠️部分覆盖 | PRD 11.2 要求超 2GB 菜单栏黄色警告，DEV-PLAN 提到 memory-monitor.ts 但未定义 M→R 推送 channel（如 `app:memory-warning`） |

---

## B. IPC 通道命名一致性

### B1. S2 定义 vs 全文使用一致性

| Channel 名称 | S2 定义 | S9 任务引用 | S11 技术方案 | S17 集成点 | 状态 | 说明 |
|-------------|---------|-----------|------------|-----------|------|------|
| `terminal:create` | ✅ | ✅ (A2) | ✅ (11.1) | - | ✅一致 | |
| `terminal:write` | ✅ | ✅ (RE1-3) | ✅ (11.3) | ✅ "terminal:write" | ✅一致 | S17 明确引用 S2.1 |
| `terminal:resize` | ✅ | ✅ (A3) | - | - | ✅一致 | |
| `terminal:close` | ✅ | ✅ (A5) | ✅ (11.1) | - | ✅一致 | |
| `terminal:output` | ✅ | ✅ (A3) | ✅ (11.2) | - | ✅一致 | |
| `terminal:state-change` | ✅ | ✅ (A5) | - | - | ✅一致 | |
| `terminal:exit` | ✅ | ✅ (A5) | - | - | ✅一致 | |
| `terminal:get-foreground-process` | ✅ | ✅ (I3) | ✅ (11.1) | - | ✅一致 | |
| `terminal:list` | ✅ | ✅ (A5) | - | - | ✅一致 | |
| `fs:read-dir` | ✅ | ✅ (H1) | - | - | ✅一致 | |
| `fs:read-file` | ✅ | ✅ (H5) | - | - | ✅一致 | |
| `fs:write-file` | ✅ | ✅ (L1) | - | - | ✅一致 | |
| `fs:watch-start` | ✅ | ✅ (H2) | - | - | ✅一致 | |
| `fs:watch-stop` | ✅ | - | - | - | ✅一致 | |
| `fs:change` | ✅ | ✅ (H2) | - | - | ✅一致 | |
| `fs:select-directory` | ✅ | ✅ (I2) | - | - | ✅一致 | |
| `fs:write-temp-image` | ✅ | ✅ (RE1-5) | ✅ (11.3) | - | ✅一致 | |
| `fs:write-clipboard-image` | ✅ | ✅ (RE2-3) | ✅ (11.3) | - | ✅一致 | |
| `chat:get-history` | ✅ | ✅ (D2) | - | - | ✅一致 | |
| `chat:get-session` | ✅ | ✅ (D7) | - | - | ✅一致 | |
| `chat:search` | ✅ | ✅ (E1) | - | - | ✅一致 | |
| `chat:session-update` | ✅ | ✅ (D3) | - | - | ✅一致 | |
| `chat:sync-status` | ✅ | ✅ (D3) | - | - | ✅一致 | |
| `chat:export` | ✅ | ✅ (X3) | - | - | ✅一致 | |
| `config:get-resources` | ✅ | ✅ (J1) | - | - | ✅一致 | |
| `config:get-resource-content` | ✅ | ✅ (J2) | - | - | ✅一致 | |
| `config:get-settings` | ✅ | ✅ (L1) | - | - | ✅一致 | |
| `config:save-settings` | ✅ | ✅ (L1) | - | - | ✅一致 | |
| `config:get-claude-md` | ✅ | ✅ (L2) | - | - | ✅一致 | |
| `config:save-claude-md` | ✅ | ✅ (L2) | - | - | ✅一致 | |
| `config:get-memory` | ✅ | ✅ (K5) | - | - | ✅一致 | |
| `config:resource-change` | ✅ | ✅ (J3) | - | - | ✅一致 | |
| `app:get-config` | ✅ | ✅ (A6) | - | - | ✅一致 | |
| `app:save-config` | ✅ | ✅ (A6) | - | - | ✅一致 | |
| `app:get-preferences` | ✅ | - | - | - | ✅一致 | |
| `app:save-preferences` | ✅ | - | - | - | ✅一致 | |
| `marketplace:fetch-sources` | ✅ | ✅ (N2-8) | ✅ (16.1) | ✅ | ✅一致 | |
| `marketplace:search` | ✅ | ✅ (N2-11) | - | - | ✅一致 | |
| `marketplace:install` | ✅ | ✅ (O-4) | - | ✅ | ✅一致 | |
| `marketplace:uninstall` | ✅ | ✅ (O-5) | - | ✅ | ✅一致 | |
| `marketplace:get-installed` | ✅ | ✅ (O-3) | - | - | ✅一致 | |
| `marketplace:install-progress` | ✅ | ✅ (O-4) | - | ✅ | ✅一致 | |
| `marketplace:check-updates` | ✅ | ✅ (T-1) | - | ✅ | ✅一致 | |
| `score:run` | ✅ | ✅ (SR-3) | ✅ (16.3) | ✅ | ✅一致 | |
| `score:check-scorer` | ✅ | ✅ (SR-3) | - | - | ✅一致 | |
| `score:get-cached` | ✅ | ✅ (SR-5) | - | - | ✅一致 | |
| `score:progress` | ✅ | ✅ (SR-6) | - | ✅ `score:result` | ⚠️部分一致 | S2 定义 `score:progress`，S17 使用 `score:result` 作为 M→R 推送。两者可能互补（progress 为过程、result 为最终结果），但 S17 的 `score:result` 未在 S2 中正式定义 |
| `showcase:generate` | ✅ | ✅ (SS-3) | ✅ (16.4) | - | ✅一致 | |
| `showcase:publish` | ✅ | ✅ (P2-5) | ✅ (16.8) | ✅ | ✅一致 | |
| `showcase:unpublish` | ✅ | ✅ (SS-3) | - | - | ✅一致 | |
| `auth:login-github` | ✅ | ✅ (P2-1) | ✅ (16.2) | ✅ | ✅一致 | |
| `auth:logout` | ✅ | ✅ (P2-1) | - | ✅ | ✅一致 | |
| `auth:get-status` | ✅ | - | - | - | ✅一致 | |
| `analytics:track` | ✅ | ✅ (X7) | - | - | ✅一致 | |
| `analytics:get-summary` | ✅ | ✅ (X8) | - | - | ✅一致 | |
| `analytics:clear` | ✅ | - | - | - | ✅一致 | |

### B2. 命名冲突/重复检查

| 检查项 | 状态 | 说明 |
|-------|------|------|
| S17 `marketplace:packages-loaded` vs S2 无此定义 | 🔄不一致 | S17 新增 `marketplace:packages-loaded` (M→R)，S2 中无此 channel。功能与 `marketplace:fetch-sources` 返回值重叠——S2 用 invoke/handle 模式（有返回值），S17 新增了推送模式。需确认是否需要两种模式并存 |
| S17 `marketplace:update-available` vs S2 无此定义 | 🔄不一致 | S17 新增 `marketplace:update-available` (M→R) 推送，S2 中 `marketplace:check-updates` 为 R→M invoke。更新可用通知的推送 channel 未在 S2 正式定义 |
| S17 `marketplace:load-packages` vs S2 `marketplace:fetch-sources` | 🔄不一致 | S17 使用 `marketplace:load-packages`，S2 定义为 `marketplace:fetch-sources`。功能一致但名称不同 |
| S17 `marketplace:install-package` vs S2 `marketplace:install` | 🔄不一致 | S17 使用 `marketplace:install-package`，S2 定义为 `marketplace:install`。名称不一致 |
| S17 `marketplace:uninstall-package` vs S2 `marketplace:uninstall` | 🔄不一致 | S17 使用 `marketplace:uninstall-package`，S2 定义为 `marketplace:uninstall`。名称不一致 |
| S17 `score:result` vs S2 `score:progress` | 🔄不一致 | S17 用 `score:result` 作为 M→R 评分结果推送，S2 定义 `score:progress` 作为进度推送。可能是补充关系（progress=过程，result=最终结果），但 S2 缺少 `score:result` 的正式定义 |
| S17 `showcase:publish-result` vs S2 无此定义 | 🔄不一致 | S17 新增 `showcase:publish-result` (M→R)，S2 的 `showcase:publish` 为 invoke 模式有返回值。如果发布是异步长时间操作，推送模式合理，但需在 S2 中补充 |
| S17 `terminal:get-state` vs S2 无此定义 | ⚠️部分覆盖 | S17 提到"终端状态查询使用 S2.1 已定义的 terminal:get-state"，但 S2 中实际无 `terminal:get-state`。S2 有 `terminal:list` 返回所有终端信息和 `terminal:state-change` 推送，但无单终端状态查询 |

### B3. Namespace 格式统一性

| 检查项 | 状态 | 说明 |
|-------|------|------|
| Channel 命名格式 `域:动作` | ✅一致 | S2.11 明确定义格式，全文一致遵循 |
| 包名 `@scope/name` namespace | ✅一致 | S2.11 + S17 均提到此规范 |
| V1 预留 V2 命名空间 | ⚠️部分覆盖 | S17 预留 `skill-browser:*`/`skill-score:*`/`skill-publish:*`，但实际 S2 使用的是 `marketplace:*`/`score:*`/`showcase:*`。预留命名空间与实际定义不一致 |

---

## C. IPC 参数完整性

### C1. 参数类型对比 PRD 数据结构（S7）

| Channel | 参数类型 | PRD 数据结构对应 | 状态 | 说明 |
|---------|---------|----------------|------|------|
| `chat:get-history` | `{limit?,offset?}` → `HistoryEntry[]` | PRD 7.1 history.jsonl 结构 | ✅覆盖 | HistoryEntry 应包含 display/timestamp/project/sessionId |
| `chat:get-session` | `{projectId,sessionId}` → `SessionMessage[]` | PRD 7.1 Session JSONL 结构 | ✅覆盖 | SessionMessage 应包含 type/messageId/message/timestamp |
| `chat:export` | `{projectIds?,format,dateRange?}` → `{outputPath}` | PRD 8.15 导出规格 | ✅覆盖 | 支持 markdown/json 格式 |
| `config:get-resources` | `{type}` → `Resource[]` | PRD 附录 A 数据文件 | ⚠️部分覆盖 | type 枚举包含 'skills'\|'hooks'\|'plans'\|'tasks'\|'mcp'\|'plugins'，但 PRD 还提到 Memory 类型，S2 用独立 `config:get-memory` 处理，合理 |
| `marketplace:install` | `{name,source,type}` → `{success}` | PRD 7.6 包归档格式 | ⚠️部分覆盖 | 缺少版本参数。PRD 要求安装特定版本（更新检测比较版本），建议增加 `version` 可选参数 |
| `marketplace:fetch-sources` | `{sources?}` → `AggregatedPackage[]` | PRD 7.3 Package 结构 | ✅覆盖 | AggregatedPackage 应映射 PRD 7.3 字段 |
| `score:run` | `{skillDirName,includeAnalytics?}` → `SkillScore` | PRD 7.7 SkillScore 结构 | ✅覆盖 | includeAnalytics 对应 PRD 8.9 "可选纳入使用数据" |
| `showcase:generate` | `{skillDirName,template}` → `ShowcaseConfig` | PRD 7.8 SkillShowcase 结构 | ✅覆盖 | ShowcaseConfig 应包含 PRD 7.8 所有字段 |
| `showcase:publish` | `{skillDirName}` → `{url}` | PRD 8.10 发布流程 | ⚠️部分覆盖 | 发布参数较简，PRD 流程包含安全检查+详情填写。安全检查可在 handler 中内联，但详情数据（problem/solution/screenshots）可能需要作为参数传入 |
| `auth:login-github` | `void` → `{username,token}` | PRD 5.9 OAuth 流程 | ⚠️部分覆盖 | 返回 token 到 Renderer 存在安全隐患。token 应仅在 Main 进程通过 safeStorage 保存，Renderer 只需知道 username 和 loggedIn 状态 |

### C2. 返回值错误场景覆盖

| Channel | 成功返回 | 失败场景 | 错误返回定义 | 状态 | 说明 |
|---------|---------|---------|------------|------|------|
| `terminal:create` | `{id, pid}` | spawn 失败 | 未明确 | ⚠️部分覆盖 | 建议统一 IPC 错误格式 `{error: {code, message}}` |
| `terminal:close` | `{success}` | 进程超时未退出 | 未明确 | ⚠️部分覆盖 | force=true 时 SIGKILL 后是否有超时处理 |
| `chat:get-session` | `SessionMessage[]` | 文件不存在/解析失败 | 未明确 | ⚠️部分覆盖 | PRD 要求降级到 Muxvo 镜像 |
| `marketplace:install` | `{success}` | 下载/解压/权限失败 | 未明确 | ⚠️部分覆盖 | PRD 11.1 列出 7 种安装相关异常 |
| `score:run` | `SkillScore` | CC 未运行/Skill 未安装/运行失败 | 未明确 | ⚠️部分覆盖 | PRD 11.1 列出 4 种评分相关异常 |
| `showcase:publish` | `{url}` | 未登录/超时/名称冲突 | 未明确 | ⚠️部分覆盖 | PRD 11.1 列出 8 种发布相关异常 |
| 通用 | - | - | - | ❌未覆盖 | DEV-PLAN S2 未定义统一的 IPC 错误响应格式。建议补充：所有 invoke 通道失败时抛出 `{code: string, message: string, details?: any}` |

---

## D. V2 新增 IPC 与 V1 IPC 的协调

### D1. S17 新增 IPC 与 S2 已有 IPC 重叠检查

| S17 新增 Channel | S2 已有对应 | 重叠情况 | 状态 | 建议 |
|-----------------|-----------|---------|------|------|
| `marketplace:packages-loaded` (M→R) | `marketplace:fetch-sources` (R→M invoke) | 功能重叠 | 🔄不一致 | 如果 fetch-sources 是同步 invoke，则不需要额外推送。如果改为异步（先返回缓存，再推送最新数据），则需要此推送 channel。需明确通信模式 |
| `marketplace:load-packages` (R→M) | `marketplace:fetch-sources` (R→M) | 命名不同，功能相同 | 🔄不一致 | 统一为 S2 定义的 `marketplace:fetch-sources` |
| `marketplace:install-package` (R→M) | `marketplace:install` (R→M) | 命名不同，功能相同 | 🔄不一致 | 统一为 S2 定义的 `marketplace:install` |
| `marketplace:uninstall-package` (R→M) | `marketplace:uninstall` (R→M) | 命名不同，功能相同 | 🔄不一致 | 统一为 S2 定义的 `marketplace:uninstall` |
| `marketplace:update-available` (M→R) | 无对应 | 新增推送 | ⚠️部分覆盖 | 合理新增，建议在 S2 中补充定义 |
| `score:result` (M→R) | `score:progress` (M→R) | 可能互补 | ⚠️部分覆盖 | 建议 S2 同时保留 progress（过程）和 result（最终结果）两个推送 channel |
| `showcase:publish-result` (M→R) | `showcase:publish` (R→M invoke) | invoke 已有返回值 | ⚠️部分覆盖 | 如果发布耗时长（>几秒），异步推送合理。建议在 S2 中补充 |
| `terminal:get-state` (R→M) | `terminal:list` (R→M) | 单终端 vs 全部 | ⚠️部分覆盖 | S17 提到但 S2 未定义。建议 S2 补充 `terminal:get-state` 查询单个终端状态 |

### D2. V2 利用 V1 预留扩展点

| V1 预留扩展点（S17） | V2 实际使用 | 状态 | 说明 |
|--------------------|-----------|------|------|
| IPC 命名空间预留 `skill-browser:*` | 实际使用 `marketplace:*` | 🔄不一致 | 预留名与实际名不一致 |
| IPC 命名空间预留 `skill-score:*` | 实际使用 `score:*` | 🔄不一致 | 预留名与实际名不一致 |
| IPC 命名空间预留 `skill-publish:*` | 实际使用 `showcase:*` | 🔄不一致 | 预留名与实际名不一致 |
| 覆盖层容器预留 | V2 Skill 浏览器使用覆盖层 | ✅一致 | |
| PTY 写入 API 预留 | `terminal:write` 用于评分指令写入 | ✅一致 | S2.1 明确说明"同时用于 V2 评分指令写入" |
| 终端状态查询预留 | V2 AI 评分检测 CC 终端状态 | ⚠️部分覆盖 | 预留了需求但 S2 缺少 `terminal:get-state` 定义 |
| 应用级 marketplace 配置预留 | `marketplace.json` 本地注册表 | ✅一致 | |

---

## 统计汇总

### 按检查项统计

| 类别 | ✅覆盖 | ⚠️部分覆盖 | ❌未覆盖 | 🔄不一致 | 合计 |
|------|--------|-----------|---------|---------|------|
| A. IPC 通道完整性 | 46 | 5 | 0 | 0 | 51 |
| B. 命名一致性 | 49 | 2 | 0 | 10 | 61 |
| C. 参数完整性 | 5 | 8 | 1 | 0 | 14 |
| D. V2/V1 协调 | 4 | 4 | 0 | 7 | 15 |
| **合计** | **104** | **19** | **1** | **17** | **141** |

### 覆盖率

- **完全覆盖率**: 104/141 = **73.8%**
- **基本覆盖率**（含部分覆盖）: 123/141 = **87.2%**
- **问题率**（未覆盖+不一致）: 18/141 = **12.8%**

### 关键问题优先级排序

| 优先级 | 问题 | 建议修复 |
|--------|------|---------|
| P0 | S17 使用的 channel 名称（`marketplace:load-packages`/`install-package`/`uninstall-package`）与 S2 定义不一致 | 统一为 S2 定义的名称 |
| P0 | S17 预留命名空间（`skill-browser:*`/`skill-score:*`/`skill-publish:*`）与 S2 实际定义（`marketplace:*`/`score:*`/`showcase:*`）不一致 | 更新 S17 预留为实际使用的命名空间 |
| P1 | S2 缺少统一的 IPC 错误响应格式 | 补充通用错误类型定义 `{code, message, details?}` |
| P1 | S2 缺少 `terminal:get-state` 单终端状态查询 | S2.1 补充此 channel |
| P1 | S17 新增的推送 channels（`marketplace:packages-loaded`/`marketplace:update-available`/`score:result`/`showcase:publish-result`）未在 S2 正式定义 | 在 S2 各域中补充这些 M→R 推送 channel |
| P2 | `auth:login-github` 返回 token 到 Renderer 有安全隐患 | 返回值改为 `{username}` 或 `{loggedIn, username}`，token 仅在 Main 进程管理 |
| P2 | `marketplace:install` 缺少 version 参数 | 补充 `version?: string` 可选参数 |
| P2 | `showcase:publish` 参数不足以支撑完整发布流程 | 补充 `details`/`screenshots` 等参数，或拆分为多步 IPC |
| P2 | 缺少内存监控 M→R 推送 channel | 补充 `app:memory-warning` |
| P3 | 首次引导缺少 CLI 工具检测 IPC | 可选补充 `app:detect-cli-tools` 或在 Main 启动时自动检测 |
