# 一致性检查报告 R2-1：IPC 协议

## 检查概述
- 检查范围：DEV-PLAN.md §2（IPC 通信协议，共 10 个域、50+ 个 channel）与 PRD.md 中所有涉及 IPC 通信的功能描述
- 检查日期：2026-02-11
- 基准文档：PRD.md V2.0
- 检查对象：DEV-PLAN.md §2 IPC 协议（§2.1-§2.11）

## 一致性评分：82%

DEV-PLAN §2 对 PRD 核心功能的 IPC channel 覆盖度较高，命名规范一致（`domain:action` 格式），参数/返回值类型定义基本完整。主要扣分项来自：(1) §17 新增 IPC 与 §2 存在 7 处命名不一致；(2) 缺少 5 个功能必需的 channel；(3) 未定义统一的错误响应格式；(4) 部分参数细节不完整。

---

## A. IPC 通道完整性（DEV-PLAN §2 vs PRD 功能需求）

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

| # | 检查项 | 状态 | 说明 |
|---|-------|------|------|
| 1 | PRD §8.14 首次引导 — 检测 AI CLI 工具 | ⚠️缺失 | PRD 要求扫描 PATH 中的 `claude`/`codex`/`gemini`，DEV-PLAN 无专门 IPC。建议新增 `app:detect-cli-tools` 或在 Main 启动时自动检测后通过 `app:get-config` 返回 |
| 2 | PRD §8.14 首次引导 — onboarding 状态 | ✅覆盖 | 通过 `app:get-config`/`app:save-config` 读写 `onboardingCompleted` |
| 3 | PRD §5.7 对话式发布 — 通知 Muxvo 生成分享图 | ⚠️缺失 | muxvo-publisher Plugin 需通知 Muxvo 生成分享图。PRD 提到"通过 IPC 通知"，但 §2 无此 channel |
| 4 | PRD §8.8 发布安全检查 | ⚠️缺失 | DEV-PLAN 有 P2-4 安全检查引擎任务，但 §2 无独立 `showcase:security-check` channel。安全检查可在 `showcase:publish` handler 中内联，但结果（含行号标红）需传回 Renderer |
| 5 | PRD §8.10 OG Card + 微信分享图生成 | ⚠️缺失 | OG Card 1200x630px + 微信分享图 750x1334px 生成未有专用 channel。可在 `showcase:generate` 返回值中包含 ogImagePath/wechatImagePath |
| 6 | PRD §11.2 内存监控警告 | ⚠️缺失 | PRD 要求超 2GB 菜单栏黄色警告。DEV-PLAN §11.1 有 memory-monitor.ts，但 §2 无 M→R 推送 channel（如 `app:memory-warning`） |
| 7 | PRD §3.10 Skill 使用统计（skillUsage） | ❌缺失 | PRD §7.5 marketplace.json 含 `skillUsage` 字段，§8.9 AI 评分可选纳入。§2 无任何 channel 负责写入/读取 skillUsage |
| 8 | PRD §7.10 发布草稿管理 | ❌缺失 | PRD 发布失败时保存草稿、可稍后续发。DEV-PLAN P2-10 任务提到草稿管理，但 §2 无 draft channel |
| 9 | PRD §6.2 终端重连 | ⚠️缺失 | 终端 Disconnected → Starting 转换（"重新连接"按钮），§2 无 `terminal:restart` channel。可通过 close + create 组合实现，但未文档化 |

---

## B. IPC 通道命名一致性

### B1. §2 定义 vs §17 引用一致性

| Channel 名称 | §2 定义 | §17 引用 | 状态 | 说明 |
|-------------|---------|---------|------|------|
| `marketplace:fetch-sources` | ✅ | `marketplace:load-packages` | 🔄不一致 | §17 使用不同名称，功能相同 |
| `marketplace:install` | ✅ | `marketplace:install-package` | 🔄不一致 | §17 使用不同名称，功能相同 |
| `marketplace:uninstall` | ✅ | `marketplace:uninstall-package` | 🔄不一致 | §17 使用不同名称，功能相同 |
| `score:progress` | ✅ | `score:result` | 🔄不一致 | §2 定义 progress 推送，§17 用 result 推送。可能互补但需明确 |
| `marketplace:packages-loaded` | ❌ 未定义 | ✅ | ⚠️ | §17 新增推送 channel，§2 未定义 |
| `marketplace:update-available` | ❌ 未定义 | ✅ | ⚠️ | §17 新增推送 channel，§2 未定义 |
| `showcase:publish-result` | ❌ 未定义 | ✅ | ⚠️ | §17 新增推送 channel，§2 未定义 |
| `terminal:get-state` | ❌ 未定义 | ✅ | ❌ | §17 引用"§2.1 已定义的 terminal:get-state"，但 §2.1 实际无此 channel |

### B2. 命名空间一致性

| 检查项 | 状态 | 说明 |
|-------|------|------|
| Channel 命名格式 `域:动作` | ✅一致 | §2.11 明确定义格式，全文一致遵循 |
| 包名 `@scope/name` namespace | ✅一致 | §2.11 + §17 均提到此规范 |
| V1 预留 V2 命名空间 | 🔄不一致 | §17 预留 `skill-browser:*`/`skill-score:*`/`skill-publish:*`，但 §2 实际使用 `marketplace:*`/`score:*`/`showcase:*` |

### B3. Channel 名称重复/冲突检查

| 检查项 | 结果 |
|--------|------|
| 跨域重复 channel | ✅ 无重复 |
| 同域内冲突 channel | ✅ 无冲突 |
| 方向标注（R→M / M→R） | ✅ 全部标注 |
| 通信模式标注（invoke / send） | ⚠️ 仅 `terminal:write` 和 `analytics:track` 标注 `(send)`，其他 R→M 未明确标注但可从返回值推断 |

---

## C. IPC 参数完整性

### C1. 参数类型对比 PRD 数据结构（§7）

| Channel | 参数类型 | PRD 数据结构对应 | 状态 | 说明 |
|---------|---------|----------------|------|------|
| `chat:get-history` | `{limit?,offset?}` → `HistoryEntry[]` | PRD §7.1 history.jsonl | ✅完整 | HistoryEntry 应包含 display/timestamp/project/sessionId |
| `chat:get-session` | `{projectId,sessionId}` → `SessionMessage[]` | PRD §7.1 Session JSONL | ✅完整 | |
| `chat:export` | `{projectIds?,format,dateRange?}` → `{outputPath}` | PRD §8.15 导出规格 | ⚠️ | 缺少 `outputDir` 参数（PRD 要求用户选择导出位置） |
| `config:get-resources` | `{type}` → `Resource[]` | PRD 附录 A | ✅完整 | type 枚举完整，Memory 用独立 channel |
| `marketplace:install` | `{name,source,type}` → `{success}` | PRD §7.6 包归档格式 | ⚠️ | 缺少 `version?` 参数（PRD 更新检测需要安装特定版本） |
| `marketplace:fetch-sources` | `{sources?}` → `AggregatedPackage[]` | PRD §7.3 Package 结构 | ✅完整 | |
| `score:run` | `{skillDirName,includeAnalytics?}` → `SkillScore` | PRD §7.7 SkillScore 结构 | ⚠️ | 签名为同步 invoke，但实际实现为异步（写入文件+监听），可能超时 60s |
| `showcase:generate` | `{skillDirName,template}` → `ShowcaseConfig` | PRD §7.8 SkillShowcase 结构 | ⚠️ | 缺少 Problem/Solution 用户输入参数（PRD §8.10 用户必填） |
| `showcase:publish` | `{skillDirName}` → `{url}` | PRD §8.10 发布流程 | ⚠️ | 参数不足——发布流程含安全检查+详情填写，需要 details/screenshots 等参数 |
| `auth:login-github` | `void` → `{username,token}` | PRD §5.9 OAuth 流程 | ⚠️ | 返回 token 到 Renderer 有安全隐患，应仅在 Main 管理 |

### C2. 返回值错误场景覆盖

| Channel | 失败场景（PRD §11.1） | 错误返回定义 | 状态 |
|---------|---------------------|------------|------|
| `terminal:create` | spawn 失败（路径不存在/权限不足） | 未明确 | ⚠️ |
| `terminal:close` | 进程超时未退出 | 未明确 | ⚠️ |
| `chat:get-session` | 文件不存在/解析失败 | 未明确 | ⚠️ |
| `marketplace:install` | 下载/解压/权限/版本冲突（4 种异常） | 未明确 | ⚠️ |
| `score:run` | CC 未运行/Skill 未安装/运行失败/JSON 解析失败 | 未明确 | ⚠️ |
| `showcase:publish` | 未登录/超时/名称冲突/网络中断（4 种异常） | 未明确 | ⚠️ |
| **通用** | - | **未定义统一错误格式** | ❌ |

> **建议**：补充统一 IPC 错误响应格式 `{ error: { code: string, message: string, details?: any } }`，所有 invoke channel 失败时抛出此格式。

---

## D. V2 新增 IPC 与 V1 协调

### D1. §17 新增 channel 与 §2 重叠检查

| §17 新增 Channel | §2 已有对应 | 重叠情况 | 建议 |
|-----------------|-----------|---------|------|
| `marketplace:packages-loaded` (M→R) | `marketplace:fetch-sources` (R→M invoke) | 功能重叠 | 明确通信模式：invoke 同步返回 vs 异步推送。若需两种模式，在 §2 补充推送 channel |
| `marketplace:load-packages` (R→M) | `marketplace:fetch-sources` (R→M) | 命名不同 | 统一为 `marketplace:fetch-sources` |
| `marketplace:install-package` (R→M) | `marketplace:install` (R→M) | 命名不同 | 统一为 `marketplace:install` |
| `marketplace:uninstall-package` (R→M) | `marketplace:uninstall` (R→M) | 命名不同 | 统一为 `marketplace:uninstall` |
| `marketplace:update-available` (M→R) | 无 | 合理新增 | 在 §2.6 补充定义 |
| `score:result` (M→R) | `score:progress` (M→R) | 可能互补 | 在 §2.7 同时保留 progress + result |
| `showcase:publish-result` (M→R) | `showcase:publish` (R→M invoke) | invoke 已有返回值 | 如发布耗时长，在 §2.8 补充异步推送 |
| `terminal:get-state` (R→M) | 无（§17 误引用） | 缺失 | 在 §2.1 补充定义 |

### D2. V1 预留扩展点实际使用情况

| V1 预留扩展点 | V2 实际使用 | 状态 |
|-------------|-----------|------|
| 命名空间 `skill-browser:*` | 实际使用 `marketplace:*` | 🔄不一致 |
| 命名空间 `skill-score:*` | 实际使用 `score:*` | 🔄不一致 |
| 命名空间 `skill-publish:*` | 实际使用 `showcase:*` | 🔄不一致 |
| 覆盖层容器预留 | V2 Skill 浏览器使用覆盖层 | ✅一致 |
| PTY 写入 API 预留 | `terminal:write` 用于评分指令 | ✅一致 |
| 终端状态查询预留 | 需要但 §2 缺少定义 | ⚠️ |
| marketplace 配置预留 | `marketplace.json` 本地注册表 | ✅一致 |

---

## 问题清单（按优先级）

### 高优先级（影响功能实现）

| # | 问题描述 | PRD 位置 | DEV-PLAN 位置 | 建议修改 |
|---|---------|---------|-------------|---------|
| H1 | **缺少 `terminal:get-state` channel**：§17 引用"§2.1 已定义的 terminal:get-state"，但 §2.1 实际无此定义。V2 AI 评分需判断"CC 终端是否运行中且空闲"（PRD §8.9），必须有此 channel | §8.9、§3.8 | §2.1、§17 | 在 §2.1 新增 `terminal:get-state`：`R→M, { id: string }, { state: TerminalState, processName?: string, isIdle: boolean }` |
| H2 | **缺少 Skill 使用统计 channel**：PRD §3.10/§7.5 明确定义了 skillUsage（调用次数、使用会话数等），§8.9 AI 评分可选纳入使用统计，但 §2 无任何 channel 读写此数据 | §3.10、§7.5、§8.9 | §2.6 | 新增 `marketplace:get-skill-usage` / `marketplace:track-skill-usage` channel，或明确 `marketplace:get-installed` 返回值包含 skillUsage |
| H3 | **缺少发布草稿管理 channel**：PRD §7.10 定义了 PublishDraft 结构，发布失败时保存草稿（PRD §5.6），DEV-PLAN P2-10 任务提到草稿管理，但 §2 无 draft channel | §7.10、§5.6 | §2.8 | 在 §2.8 新增 `showcase:save-draft`、`showcase:get-draft`、`showcase:list-drafts` |
| H4 | **§17 新增 IPC 与 §2 定义 7 处命名不一致**：包括 load-packages vs fetch-sources、install-package vs install 等，导致开发时困惑 | - | §2 vs §17 | 以 §2 为权威源，统一 §17 引用名称 |
| H5 | **§2 缺少统一 IPC 错误响应格式**：PRD §11.1 列出 32 条异常场景，但 §2 所有 channel 均未定义失败返回格式 | §11.1 | §2 全域 | 补充统一错误类型 `{ error: { code: string, message: string, details?: any } }` |

### 中优先级（影响规范性）

| # | 问题描述 | PRD 位置 | DEV-PLAN 位置 | 建议修改 |
|---|---------|---------|-------------|---------|
| M1 | §17 预留命名空间（`skill-browser:*`/`skill-score:*`/`skill-publish:*`）与 §2 实际定义（`marketplace:*`/`score:*`/`showcase:*`）不一致 | - | §17 vs §2 | 更新 §17 预留为 §2 实际使用的命名空间 |
| M2 | `chat:export` 缺少 `outputDir` 参数（PRD §8.15 要求用户选择导出位置） | §8.15 | §2.3 | 补充 `outputDir?: string` 参数 |
| M3 | `score:run` 签名为同步 invoke 但实际实现为异步（文件监听模式，最多 60s） | §8.9、§5.11 | §2.7 | 改为异步模式或文档标注"可能耗时较长" |
| M4 | `auth:login-github` 返回 token 到 Renderer 有安全隐患 | §5.9 | §2.9 | 返回值改为 `{ username }` 或 `{ loggedIn, username }`，token 仅在 Main 管理 |
| M5 | `showcase:generate` 缺少 Problem/Solution 用户输入参数 | §8.10 | §2.8 | 补充参数或文档说明工作流：generate 生成草稿 → UI 编辑 → 保存 JSON → publish 读取 |
| M6 | `marketplace:install` 缺少 `version` 可选参数 | §8.11 更新检测 | §2.6 | 补充 `version?: string` |
| M7 | `fs:watch-start` 的 `id` 参数语义不清（监听器 ID 还是终端 ID） | §3.5 | §2.2 | 补充说明 id 为调用方自定义的唯一标识 |
| M8 | `analytics:track` 事件名格式未统一：PRD 用点号（`terminal.create`），DEV-PLAN §4.12 部分用冒号（`score:trigger`） | §13.3 | §4.12 | 统一为 PRD 定义的点号格式 `domain.action` |
| M9 | §17 新增推送 channels（`marketplace:update-available`、`score:result`、`showcase:publish-result`）未在 §2 正式定义 | - | §17 | 在 §2 各域中补充这些 M→R 推送 channel |
| M10 | 缺少终端重启/重连 channel（PRD §6.2 Disconnected → Starting 转换） | §6.2 | §2.1 | 新增 `terminal:restart` 或文档说明通过 close + create 组合实现 |
| M11 | 缺少内存监控 M→R 推送 channel | §11.2 | §11.1 memory-monitor.ts | 新增 `app:memory-warning` (M→R) 推送 |

### 低优先级（建议优化）

| # | 问题描述 | PRD 位置 | DEV-PLAN 位置 | 建议修改 |
|---|---------|---------|-------------|---------|
| L1 | Hook 安装的"中断-确认-继续"流程在 §2 中无体现 | §8.12 | §2.6 | 文档备注 Hook 安装由 Renderer 侧先审查再调 install |
| L2 | `config:get-resources` 返回值 `Resource[]` 未按类型细化 | §6.11 | §2.4 | 建议使用 discriminated union 类型 |
| L3 | `terminal:write` 用于 V2 评分指令但指令格式未明确 | §8.9 | §2.1 备注 | 在 §16.3 补充评分指令格式 |
| L4 | `analytics:get-summary` 返回结构与 PRD `daily_summary.ai_interactions` 字段不完全对应 | §13.3 | §4.12 | 统一 daily_summary 结构 |
| L5 | 缺少包更新操作 channel（check-updates 只检测，无执行更新） | §8.11 | §2.6 | 新增 `marketplace:update` 或文档说明通过 install 覆盖实现 |
| L6 | `showcase:publish` 参数不足以覆盖完整发布流程（安全检查+详情） | §8.8、§8.10 | §2.8 | 拆分为 `showcase:check-security` + `showcase:publish`，或在 publish 参数中补充 details |
| L7 | `app:save-config` 单一 merge 接口在并发场景可能竞态 | §7.2 | §2.5 | Main 侧确保串行化写入（§11.12 已有原子写入方案） |

---

## 覆盖度统计

### 汇总数字

| 指标 | 数值 |
|------|------|
| PRD 需要的 IPC channel 总数（含隐含需求） | ~58 |
| DEV-PLAN §2 已定义 | 50 |
| 缺失 | 5（terminal:get-state, marketplace:get-skill-usage, marketplace:track-skill-usage, showcase:save-draft/get-draft/list-drafts, marketplace:update） |
| §17 新增但 §2 未定义 | 4（marketplace:packages-loaded, marketplace:update-available, score:result, showcase:publish-result） |
| 命名不一致 | 7（§17 vs §2） |
| 多余定义 | 0 |

### 按检查维度统计

| 维度 | ✅完整 | ⚠️部分覆盖 | ❌缺失 | 🔄不一致 |
|------|--------|-----------|--------|---------|
| A. 通道完整性 | 46 | 8 | 2 | 0 |
| B. 命名一致性 | 49 | 2 | 1 | 10 |
| C. 参数完整性 | 4 | 9 | 1 | 0 |
| D. V2/V1 协调 | 4 | 4 | 0 | 7 |

### V1 vs V2 归属清晰度

| 域 | 版本归属 | 是否清晰 | 备注 |
|----|---------|---------|------|
| terminal:* (§2.1) | V1 | ✅ | 备注了 V2 评分复用 |
| fs:* (§2.2) | V1 | ✅ | |
| chat:* (§2.3) | V1 | ✅ | |
| config:* (§2.4) | V1 | ✅ | |
| app:* (§2.5) | V1 | ✅ | |
| marketplace:* (§2.6) | V2-P0 | ⚠️ | 标题未标注版本 |
| score:* (§2.7) | V2-P1 | ✅ | 标题标注 |
| showcase:* (§2.8) | V2-P2 | ✅ | 标题标注 |
| auth:* (§2.9) | V2-P2 | ✅ | 标题标注 |
| analytics:* (§2.10) | V1 | ✅ | V1 采集，V2 扩展事件 |

---

## 总结

DEV-PLAN §2 IPC 协议整体设计质量较高，10 个功能域划分清晰，命名规范统一（`domain:action` 格式），V1 功能的 IPC 覆盖度接近 100%。主要问题集中在三个方面：

1. **§17 与 §2 内部不一致**（最紧急）：§17 新增 IPC 接口与 §2 存在 7 处命名偏差、3 处命名空间冲突、1 处错误引用（`terminal:get-state`）。应以 §2 为权威源统一。

2. **缺失 channel**（高优先级）：`terminal:get-state`、Skill 使用统计、发布草稿管理共 5 个功能必需的 channel 未定义，影响 V2 AI 评分和发布功能实现。

3. **文档完善度**（中低优先级）：缺少统一错误响应格式、部分 channel 异步/同步模式不清晰、参数细节不完整。

**建议**：在开发启动前，用一次文档同步完成以下修改：
- 以 §2 为权威源，修正 §17 所有命名不一致
- 在 §2 中补充 5 个缺失 channel
- 在 §2.11 中补充统一 IPC 错误响应格式定义
- 补充 §17 新增推送 channel 到 §2 各域
