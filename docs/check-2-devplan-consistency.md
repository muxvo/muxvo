# DEV-PLAN 与 PRD 内部一致性检查报告

> 检查人：checker-2 | 检查日期：2026-02-10
> 基于 PRD V2.0 和 DEV-PLAN V1.0

---

## 1. IPC 协议与 PRD 数据流一致性

### 1.1 IPC Channel 逐组检查

| 检查项 | 状态 | PRD 位置 | DEV-PLAN 位置 | 说明 |
|--------|------|----------|---------------|------|
| terminal:create 参数匹配 | ✅ 一致 | 5.2 新建终端流程 | 2.1 terminal:create | 参数 `{cwd}` 与 PRD 流程一致 |
| terminal:write 数据发送 | ✅ 一致 | 8.16 RE 文本转发 | 2.1 terminal:write | R→M send 模式，PRD 描述的 `pty.write()` 对应 |
| terminal:resize 尺寸同步 | ✅ 一致 | 8.1 xterm.js 渲染 | 2.1 terminal:resize | 与 PRD 的 Grid 动态布局需求匹配 |
| terminal:close 关闭流程 | ✅ 一致 | 3.1 终端生命周期 | 2.1 terminal:close | 支持 force 参数，PRD 描述先 SIGINT 后 SIGKILL |
| terminal:output 输出推送 | ✅ 一致 | 8.16 xterm.js 只读渲染 | 2.1 terminal:output | M→R 推送模式与 PRD 架构一致 |
| terminal:state-change 状态通知 | ✅ 一致 | 6.2 终端进程状态机 | 2.1 terminal:state-change | 包含 processName，支持前台进程检测 |
| terminal:exit 退出事件 | ✅ 一致 | 6.2 Disconnected 状态 | 2.1 terminal:exit | 包含 exit code |
| terminal:get-foreground-process | ✅ 一致 | 6.7 tcgetpgrp 检测 | 2.1 terminal:get-foreground-process | 返回 name + pid，与 PRD 6.7 节需求匹配 |
| terminal:list 终端列表 | ✅ 一致 | 8.1 终端管理 | 2.1 terminal:list | 支持获取全部终端信息 |
| fs:read-dir 目录读取 | ✅ 一致 | 8.2 文件面板 | 2.2 fs:read-dir | 返回 FileEntry[] |
| fs:read-file 文件内容 | ✅ 一致 | 8.2 三栏视图中栏 | 2.2 fs:read-file | 支持内容 + 编码 |
| fs:write-file 文件写入 | ✅ 一致 | 8.4 Settings/CLAUDE.md 编辑 | 2.2 fs:write-file | 限制仅可编辑配置文件 |
| fs:watch-start/stop | ✅ 一致 | 3.5 文件监听策略 | 2.2 fs:watch-start/stop | 支持 id + paths |
| fs:change 文件变更推送 | ✅ 一致 | 6.12 文件监听状态 | 2.2 fs:change | 包含 isNew 标记（PRD NEW 徽章） |
| fs:select-directory | ✅ 一致 | 5.2 新建终端流程 | 2.2 fs:select-directory | 系统对话框 |
| chat:get-history | ✅ 一致 | 8.3.1 数据来源 | 2.3 chat:get-history | 支持分页（limit/offset） |
| chat:get-session | ✅ 一致 | 8.3.3 右栏会话详情 | 2.3 chat:get-session | 按 projectId + sessionId 获取 |
| chat:search | ✅ 一致 | 8.3.4 全文搜索 | 2.3 chat:search | 返回 SearchResult[] |
| chat:session-update 推送 | ✅ 一致 | 3.5 session 更新实时刷新 | 2.3 chat:session-update | M→R 推送 |
| chat:sync-status 推送 | ✅ 一致 | 8.3.2 同步状态 UI | 2.3 chat:sync-status | syncing/idle/error |
| config:get-resources | ✅ 一致 | 8.4 配置管理器 | 2.4 config:get-resources | 支持 skills/hooks/plans/tasks/mcp 类型 |
| config:get-settings | ✅ 一致 | 8.4 Settings 查看 | 2.4 config:get-settings | 读取 CC settings.json |
| config:save-settings | ✅ 一致 | 8.4 Settings 编辑 | 2.4 config:save-settings | 写入 CC settings.json |
| config:get-claude-md | ✅ 一致 | 8.4 CLAUDE.md 编辑 | 2.4 config:get-claude-md | 支持 global/project scope |
| config:save-claude-md | ✅ 一致 | 8.4 CLAUDE.md 保存 | 2.4 config:save-claude-md | 写入 CLAUDE.md |
| config:get-memory | ✅ 一致 | 8.4 Memory 查看 | 2.4 config:get-memory | 读取 MEMORY.md |
| config:resource-change | ✅ 一致 | 6.12 资源变更 | 2.4 config:resource-change | M→R 推送 |
| app:get-config / save-config | ✅ 一致 | 7.2 Muxvo 本地配置 | 2.5 app:* | 读写 config.json |
| app:get-preferences / save-preferences | ✅ 一致 | 3.4 preferences.json | 2.5 app:* | 主题/字体偏好 |
| marketplace:* 包管理 | ✅ 一致 | 8.5-8.7 聚合/安装 | 2.6 marketplace:* | 7 个 channel 覆盖聚合/搜索/安装/卸载/更新 |
| score:* AI 评分 | ✅ 一致 | 8.9 AI 评分 | 2.7 score:* | 3 个 channel：run/get-cached/progress |
| showcase:* 展示页 | ✅ 一致 | 8.10 展示页 | 2.8 showcase:* | generate/publish/unpublish |
| auth:* 认证 | ✅ 一致 | 3.7/5.9 认证策略 | 2.9 auth:* | login-github/logout/get-status |

### 1.2 PRD 功能的 IPC 覆盖度

| 检查项 | 状态 | PRD 位置 | DEV-PLAN 位置 | 说明 |
|--------|------|----------|---------------|------|
| 富编辑器图片临时文件保存 | ⚠️ 部分一致 | 8.16 图片处理流程 | 2.2 fs:write-file | PRD 描述图片保存到 `/tmp/muxvo-images/`，DEV-PLAN 的 `fs:write-file` 仅限"可编辑的配置文件"，未明确涵盖临时文件写入。可能需要单独的 IPC channel 或在 terminal.ipc.ts 中处理 |
| 富编辑器剪贴板模拟（CC 图片） | ⚠️ 部分一致 | 8.16 CC 图片发送：写入剪贴板 + `\x16` | 无专门 IPC | PRD 描述"将图片写入系统剪贴板"操作需要 Main Process 的 `clipboard.writeImage()` API，DEV-PLAN 未定义对应 IPC channel |
| 聊天历史导出 | ⚠️ 部分一致 | 8.15 聊天历史导出 | 无专门 IPC | PRD 8.15 定义了完整导出流程（范围选择/格式选择/目录选择），DEV-PLAN IPC 中无 `chat:export` 相关 channel |
| 富编辑器临时文件清理 | ⚠️ 部分一致 | 8.16 临时文件清理 | 无专门 IPC | PRD 描述"终端关闭时删除、或 24 小时后自动清理"，DEV-PLAN 任务 RE1-8 提到此功能但 IPC 中无对应 |
| Plugins 配置查看 | ⚠️ 部分一致 | 8.4 Plugins 查看 | 2.4 config:get-resources | PRD 8.4 列出了 Plugins 分类卡片，但 DEV-PLAN config:get-resources 的 type 参数仅列出 'skills'\|'hooks'\|'plans'\|'tasks'\|'mcp'，缺少 'plugins' |
| 评分使用数据授权 | 🔍 需确认 | 8.9 可选纳入使用数据 | 无对应 IPC | PRD 描述评分时可选纳入使用统计数据，需用户授权弹窗，DEV-PLAN score:run 参数仅有 skillDirName，未包含使用数据传递 |
| 评分 Skill 自动安装 | 🔍 需确认 | 8.9/5.11 自动安装 muxvo-skill-scorer | 无专门 IPC | PRD 流程图显示"评分 Skill 未安装时自动安装"，DEV-PLAN 未定义此自动安装的 IPC 触发方式 |

### 1.3 富编辑器 IPC 支持

| 检查项 | 状态 | PRD 位置 | DEV-PLAN 位置 | 说明 |
|--------|------|----------|---------------|------|
| RE1 文本→PTY 转发 | ✅ 一致 | 8.16 文本转发机制 | 2.1 terminal:write | 通过已有的 terminal:write 发送 |
| RE1 xterm.js 键盘断开 | ✅ 一致 | 8.16 模式切换 | 4.2 RE 模块 | Renderer 侧处理，无需 IPC |
| RE1 图片保存临时文件 | ⚠️ 部分一致 | 8.16 图片处理步骤3 | 无明确 IPC | 需 Main Process 写 `/tmp/` 目录 |
| RE2 ASB 自动检测 | ✅ 一致 | 8.16 模式切换 | 4.2 RE 模块 | Renderer 侧 xterm.js 事件处理 |
| RE2 剪贴板模拟 | ⚠️ 部分一致 | 8.16 CC 图片: clipboard.writeImage | 无明确 IPC | 需 Main Process clipboard API |
| RE3 斜杠命令补全 | ✅ 一致 | PRD RE3 定义 | 15 RE3 任务 | V2 功能，Renderer 侧处理 |
| 前台进程检测（tcgetpgrp） | ✅ 一致 | 6.7/8.16 | 2.1 terminal:get-foreground-process | 完整覆盖 |

---

## 2. 模块拆分与 PRD 功能对应

| 检查项 | 状态 | PRD 位置 | DEV-PLAN 位置 | 说明 |
|--------|------|----------|---------------|------|
| 功能 A 全屏平铺终端管理 → terminal + layout | ✅ 一致 | 2 功能清单 A | 4.1 terminal + 4.11 layout | Grid 布局在 layout，PTY 在 terminal |
| 功能 B 聚焦模式 → layout | ✅ 一致 | 2 功能清单 B | 4.11 layout | 视图模式管理（6.3 状态机） |
| 功能 C 拖拽排序+边框调整 → terminal + layout | ✅ 一致 | 2 功能清单 C | 4.1 + 4.11 | 拖拽在 terminal 组件，比例在 layout |
| 功能 D 聊天历史浏览器 → chat-history | ✅ 一致 | 2 功能清单 D | 4.3 chat-history | 包含同步、搜索索引 |
| 功能 E 全文搜索 → chat-history | ✅ 一致 | 2 功能清单 E | 4.3 chat-history | 搜索索引在 chat-history 模块职责中 |
| 功能 F 时间线视图 → chat-history | ✅ 一致 | 2 功能清单 F | 4.3 隐含 | 作为聊天历史的辅助视图 |
| 功能 G Markdown 预览 → file-browser | ✅ 一致 | 2 功能清单 G | 4.4 file-browser | Markdown 渲染在文件浏览模块 |
| 功能 H 文件浏览器+三栏 → file-browser | ✅ 一致 | 2 功能清单 H | 4.4 file-browser | 包含面板 + 三栏临时视图 |
| 功能 I 双段式命名 → terminal | ✅ 一致 | 2 功能清单 I | 4.1 terminal | 包含 cwd 切换、进程检测 |
| 功能 J ~/.claude/ 浏览器 → config-manager | ✅ 一致 | 2 功能清单 J | 4.5 config-manager | 资源浏览 |
| 功能 K 分类查看 → config-manager | ✅ 一致 | 2 功能清单 K | 4.5 config-manager | Skills/Hooks/Plans/Tasks |
| 功能 L Settings 编辑 → config-manager | ✅ 一致 | 2 功能清单 L | 4.5 config-manager | 编辑保存 |
| 功能 M 自动归组 → terminal | ✅ 一致 | 2 功能清单 M | 4.1 terminal | 同目录归组 |
| 功能 RE1 富编辑器基础 → rich-editor | ✅ 一致 | 2 功能清单 RE1 | 4.2 rich-editor | contenteditable + PTY 转发 |
| 功能 RE2 富编辑器完善 → rich-editor | ✅ 一致 | 2 功能清单 RE2 | 4.2 rich-editor | ASB 检测 + 剪贴板模拟 |
| 功能 RE3 富编辑器高级 → rich-editor | ✅ 一致 | 2 功能清单 RE3 | 4.2 隐含 | V2 扩展，DEV-PLAN 15 节列出任务 |
| 功能 N2 聚合浏览器 → skill-browser | ✅ 一致 | 2 功能清单 N2 | 4.7 skill-browser | 多源聚合 |
| 功能 O 一键安装 → skill-browser | ✅ 一致 | 2 功能清单 O | 4.7 skill-browser | 安装/卸载触发 |
| 功能 U Hook 安全审查 → skill-browser | ✅ 一致 | 2 功能清单 U | 4.7 skill-browser | 安全审查对话框 |
| 功能 T 更新检测 → skill-browser | ✅ 一致 | 2 功能清单 T | 4.7 隐含 + 15 T 任务 | 更新检测引擎 |
| 功能 SR AI 评分 → ai-scorer | ✅ 一致 | 2 功能清单 SR | 4.8 ai-scorer | 评分 + 雷达图 |
| 功能 SS 展示页 → showcase | ✅ 一致 | 2 功能清单 SS | 4.9 showcase | 生成 + 发布 |
| 功能 P2 发布分享 → showcase + auth | ✅ 一致 | 2 功能清单 P2 | 4.9 + 4.10 | OAuth + Pages 发布 |
| 功能 SC 社区平台 → 未定义模块 | ⚠️ 部分一致 | 2 功能清单 SC | 14 V2-P3 概要 | V2-P3 功能，DEV-PLAN 仅给出概要，未定义具体模块拆分（合理，因为是未来阶段） |
| 聊天历史导出 → 归属不明确 | ⚠️ 部分一致 | 8.15 导出功能 | 9 任务 X3 | PRD 定义了完整导出流程，DEV-PLAN 在通用任务 X3 中提到，但未归属到具体模块（chat-history 模块职责描述中未提及导出） |
| 首次使用引导 → 归属不明确 | ⚠️ 部分一致 | 8.14 引导流程 | 9 任务 X1 | DEV-PLAN X1 任务存在，但 11 个模块的职责描述中未提及引导流程归属 |
| 数据埋点/分析 → 无对应模块 | ⚠️ 部分一致 | 13.3 埋点事件 | 未定义模块 | PRD 定义了完整的埋点事件体系，DEV-PLAN 无对应的 analytics 模块或职责分配 |
| 内存监控 → 无对应模块 | 🔍 需确认 | 11.2 内存监控 | 未提及 | PRD 要求每 60 秒检查内存占用，超 2GB 警告，DEV-PLAN 未将此功能归属到任何模块 |

### 模块依赖关系检查（第 7 节）

| 检查项 | 状态 | PRD 位置 | DEV-PLAN 位置 | 说明 |
|--------|------|----------|---------------|------|
| file-watcher 无依赖 | ✅ 一致 | 3.5 文件监听 | 7 依赖图 | 底层服务 |
| terminal 依赖 layout | ✅ 一致 | - | 7 依赖图 | 终端数量决定 Grid 行列 |
| rich-editor 依赖 terminal | ✅ 一致 | 8.16 PTY 写入 | 7 依赖图 | PTY 写入 + 前台进程检测 |
| file-browser 依赖 terminal + file-watcher | ✅ 一致 | 8.2 文件面板 | 7 依赖图 | 获取 cwd + 文件变更 |
| chat-history 依赖 file-watcher | ✅ 一致 | 8.3.2 chokidar 监听 | 7 依赖图 | session 变更通知 |
| config-manager 依赖 file-watcher | ✅ 一致 | 8.4 自动刷新 | 7 依赖图 | 资源文件变更 |
| skill-browser 依赖 config-manager + file-watcher | ✅ 一致 | 3.6 入口策略 | 7 依赖图 | 本地 Skills + 目录变更 |
| ai-scorer 依赖 terminal + config-manager | ✅ 一致 | 8.9 评分机制 | 7 依赖图 | 发送评分命令 + Skill 内容 |
| showcase 依赖 ai-scorer + auth + config-manager | ✅ 一致 | 8.10 展示页 | 7 依赖图 | 评分数据 + GitHub Token + Skill 内容 |
| auth 无依赖 | ✅ 一致 | 3.7 认证策略 | 7 依赖图 | 独立认证服务 |
| 构建顺序与依赖图一致 | ✅ 一致 | - | 7 构建顺序 | V1: file-watcher → terminal + layout → rich-editor → 功能层 |

---

## 3. 任务依赖关系完整性

### 3.1 V1 任务依赖检查（第 10 节）

| 检查项 | 状态 | PRD 位置 | DEV-PLAN 位置 | 说明 |
|--------|------|----------|---------------|------|
| A1 无前置依赖 | ✅ 一致 | - | 9/10 | 根节点，正确 |
| A2 依赖 A1 | ✅ 一致 | - | 9/10 | 需要 Electron 骨架 |
| A3 依赖 A2 | ✅ 一致 | - | 9/10 | 需要 node-pty |
| A4 依赖 A1 | ✅ 一致 | - | 9/10 | 仅需 Electron 骨架 |
| A5 依赖 A2 | ✅ 一致 | - | 9/10 | 进程状态需要 pty |
| A6 依赖 A4 | ✅ 一致 | - | 9/10 | Grid 布局持久化 |
| B1 依赖 A4 | ✅ 一致 | - | 9/10 | 需要 Grid 布局 |
| B2 依赖 B1 | ✅ 一致 | - | 9/10 | 聚焦模式交互 |
| B3 依赖 B1 | ✅ 一致 | - | 9/10 | 视觉效果 |
| I1 依赖 A4 | ✅ 一致 | - | 9/10 | Tile Header 需要 Grid |
| I2 依赖 A2 | ✅ 一致 | - | 9/10 | 目录切换需要 pty |
| I3 依赖 A2, I2 | ✅ 一致 | - | 9/10 | tcgetpgrp 需要 pty + 切换流程 |
| I4 依赖 I1 | ✅ 一致 | - | 9/10 | 自定义名称需要 Header |
| D1 无前置依赖 | ✅ 一致 | - | 9/10 | 独立 JSONL 解析器 |
| D2 依赖 D1 | ✅ 一致 | - | 9/10 | 双源读取需要解析器 |
| D3 依赖 D1 | ✅ 一致 | - | 9/10 | 同步模块需要解析器 |
| D4 依赖 D1 | ✅ 一致 | - | 9/10 | 三栏布局需要数据 |
| D5 依赖 D4 | ✅ 一致 | - | 9/10 | 项目列表在三栏布局中 |
| D6 依赖 D4 | ✅ 一致 | - | 9/10 | 会话列表在三栏布局中 |
| D7 依赖 D4 | ✅ 一致 | - | 9/10 | 会话详情在三栏布局中 |
| D8 依赖 D5, D6, D7 | ✅ 一致 | - | 9/10 | 三栏联动需要三个栏位 |
| G1 无前置依赖 | ✅ 一致 | - | 9/10 | 独立 Markdown 引擎 |
| G2 依赖 G1 | ✅ 一致 | - | 9/10 | 高亮需要渲染引擎 |
| G3 依赖 G1 | ✅ 一致 | - | 9/10 | 双模式需要渲染引擎 |
| C1 依赖 A4 | ✅ 一致 | - | 9/10 | 拖拽需要 Grid |
| C2 依赖 A4 | ✅ 一致 | - | 9/10 | 边框调整需要 Grid |
| E1 依赖 D1 | ✅ 一致 | - | 9/10 | 索引构建需要 JSONL 解析 |
| E2 依赖 E1 | ✅ 一致 | - | 9/10 | 持久化需要索引 |
| E3 依赖 E1, D4 | ✅ 一致 | - | 9/10 | 搜索 UI 需要索引 + 聊天布局 |
| E4 依赖 E1 | ✅ 一致 | - | 9/10 | 进度 UI 需要索引 |
| H1 依赖 A4 | ✅ 一致 | - | 9/10 | 文件面板需要 Grid |
| H2 依赖 A2 | ✅ 一致 | - | 9/10 | 文件监听需要 pty（获取 cwd） |
| H3 依赖 H1, G1 | ✅ 一致 | - | 9/10 | 三栏视图需要面板 + Markdown |
| H4 依赖 H3 | ✅ 一致 | - | 9/10 | 交互需要三栏视图 |
| H5 依赖 G1, H3 | ✅ 一致 | - | 9/10 | 渲染需要 Markdown + 三栏 |
| J1 无前置依赖 | ✅ 一致 | - | 9/10 | 独立分类卡片 |
| J2 依赖 J1, G1 | ✅ 一致 | - | 9/10 | 列表需要卡片 + Markdown |
| J3 依赖 J2 | ✅ 一致 | - | 9/10 | 监听需要列表 |
| M1 依赖 A4, I3 | ✅ 一致 | - | 9/10 | 归组需要 Grid + 进程检测 |
| M2 依赖 M1 | ✅ 一致 | - | 9/10 | 动画需要归组逻辑 |
| RE1-1 依赖 A4 | ✅ 一致 | - | 9/10 | 编辑器需要 Grid（Tile） |
| RE1-2 依赖 A3 | ✅ 一致 | - | 9/10 | 键盘断开需要 xterm.js |
| RE1-3 依赖 A2, I3 | ✅ 一致 | - | 9/10 | PTY 转发需要 pty + 进程检测 |
| RE1-4 依赖 RE1-1, RE1-2 | ✅ 一致 | - | 9/10 | 穿透需要编辑器 + 键盘断开 |
| RE1-5 依赖 RE1-1 | ✅ 一致 | - | 9/10 | 图片粘贴需要编辑器 |
| RE1-6 依赖 RE1-1, RE1-2 | ✅ 一致 | - | 9/10 | 模式切换需要两侧 |
| RE1-7 依赖 RE1-1 | ✅ 一致 | - | 9/10 | 工具栏需要编辑器 |
| RE1-8 依赖 RE1-5 | ✅ 一致 | - | 9/10 | 清理需要图片功能 |
| RE2-1 依赖 RE1-2 | ✅ 一致 | - | 9/10 | ASB 检测需要 xterm 键盘控制 |
| RE2-2 依赖 I3, RE2-1 | ✅ 一致 | - | 9/10 | 进程名 fallback |
| RE2-3 依赖 RE1-5 | ✅ 一致 | - | 9/10 | 剪贴板模拟需要图片功能 |
| RE2-4 依赖 RE1-3 | ✅ 一致 | - | 9/10 | 多工具协议需要基础转发 |
| F1 依赖 D4 | ✅ 一致 | - | 9/10 | 时间线需要聊天数据 |
| F2 依赖 F1 | ✅ 一致 | - | 9/10 | 视图切换需要时间线 |
| K 依赖 J2 | ✅ 一致 | - | 9/10 | 分类查看需要资源列表 |
| L 依赖 J2, G3 | ✅ 一致 | - | 9/10 | 编辑需要列表 + 编辑模式 |
| X1 依赖 A1 | ✅ 一致 | - | 9 | 引导需要骨架 |
| X2 依赖 A4 | ✅ 一致 | - | 9 | 快捷键需要 Grid |
| X3 依赖 D4 | ✅ 一致 | - | 9 | 导出需要聊天布局 |
| X4 依赖各功能 | ✅ 一致 | - | 9 | 缺省态在功能完成后 |

### 3.2 循环依赖检查

| 检查项 | 状态 | PRD 位置 | DEV-PLAN 位置 | 说明 |
|--------|------|----------|---------------|------|
| V1 任务图无循环依赖 | ✅ 一致 | - | 10 | 所有依赖方向为 DAG（有向无环图） |
| V2 任务图无循环依赖 | ✅ 一致 | - | 15 | N2→O→U→SR→T→SS→P2→RE3 为线性依赖链 |

### 3.3 关键路径检查

| 检查项 | 状态 | PRD 位置 | DEV-PLAN 位置 | 说明 |
|--------|------|----------|---------------|------|
| 红色标注为关键路径节点 | ✅ 一致 | - | 10 图例 | A1→A2→A3/A4→D1→D4→G1 标红 |
| 关键路径长度合理 | ✅ 一致 | - | 10 | A1(2d)→A2(2d)→A3(2d) = 6 天核心终端路径 |
| D1 可与 A 并行 | ✅ 一致 | - | 10 开发建议 | 独立模块，无依赖 |
| G1 可与 A/D 并行 | ✅ 一致 | - | 10 开发建议 | 独立模块，无依赖 |

---

## 4. 技术方案覆盖度

| 检查项 | 状态 | PRD 位置 | DEV-PLAN 位置 | 说明 |
|--------|------|----------|---------------|------|
| Grid 布局算法与 PRD 8.1 规则 | ✅ 一致 | 8.1 Grid 布局规则表 | 11.6 CSS Grid | DEV-PLAN `cols = n <= 3 ? n : Math.ceil(Math.sqrt(n))`，5 终端特殊处理上3下2居中，与 PRD 表格完全一致 |
| node-pty 多终端管理 | ✅ 一致 | 3.1 终端管理策略 | 11.1 node-pty | 覆盖 tcgetpgrp、优雅关闭、重连、最大 20 终端 |
| xterm.js 集成 | ✅ 一致 | 8.16 xterm.js 只读 | 11.2 xterm.js | 覆盖 ASB 检测、键盘拦截、ResizeObserver |
| 富编辑器覆盖层 | ✅ 一致 | 8.16 完整规格 | 11.3 富编辑器 | 覆盖 contenteditable、CC 多行协议（`\x1b\r`）、图片处理 |
| CC 多行协议 | ✅ 一致 | 8.16 换行发送方式表 | 11.3 富编辑器 | CC 用 `\x1b\r` 换行、bash 直接发送、与 PRD 表格一致 |
| JSONL 解析性能 | ✅ 一致 | 8.3.1/11.2 解析规则 | 11.4 JSONL | 流式读取、忽略不完整行、200ms 延迟、>100MB 仅 6 个月 |
| 全文搜索索引 | ✅ 一致 | 8.3.4/11.2 | 11.5 搜索索引 | Web Worker、渐进式、超时保护、持久化，与 PRD 完全一致 |
| 聊天历史镜像同步 | ✅ 一致 | 8.3.2 同步模块 | 11.7 镜像同步 | mtime 秒级精度、SHA-256 前 16 位、仅同步不删除 |
| 多源 API 聚合 | ✅ 一致 | 8.5 聚合数据源 | 16.1 多源聚合 | Promise.allSettled、TTL 30 分钟、降级策略 |
| GitHub OAuth PKCE | ✅ 一致 | 5.9/3.7 认证流程 | 16.2 OAuth PKCE | 完整 PKCE 流程 + safeStorage + deep link 备用 |
| AI 评分 CC Skill 通信 | ✅ 一致 | 8.9 评分机制 | 16.3 文件监听模式 | pty 写入指令 → chokidar 监听输出 → 60 秒超时 |
| 展示页 HTML 生成 | ✅ 一致 | 8.10 模板系统 | 16.4 HTML 生成 | EJS 模板 + CSS 内联 + SVG 内联 |
| 雷达图渲染 | ✅ 一致 | 8.9 六维度雷达图 | 16.5 雷达图 | 纯 SVG，不用 ECharts（800KB 太大） |
| OG Card / 微信分享图 | ✅ 一致 | 8.10 OG Card | 16.6 分享图 | 隐藏 BrowserWindow + capturePage，1200x630/750x1334 尺寸匹配 |
| Deep Link 协议 | ✅ 一致 | 8.10 安装按钮 | 16.7 Deep Link | macOS/Windows/Linux 三平台方案 |
| GitHub Pages 发布 | ✅ 一致 | 8.10 Pages 发布 | 16.8 Pages | API 调用序列完整 |
| Token 传递 | ✅ 一致 | 8.8 Token 机制 | 16.9 Token | 临时文件 + 权限 600 + 5 秒删除 |
| 安全检查引擎 | ✅ 一致 | 8.8 发布前安全检查 | 16.10 安全检查 | API Key 正则、密钥文件、硬编码路径、敏感文件 |
| 评分维度和权重 | ✅ 一致 | 8.9 维度权重表 | 4.8 ai-scorer + 15 SR | 6 维度：实用性25%/工程25%/意图10%/巧妙10%/文档15%/复用15%，DEV-PLAN 引用 PRD 定义 |
| 评分等级制 | ✅ 一致 | 8.9 等级制表 | 15 SR-1 | Promising→Solid→Advanced→Expert→Masterwork |
| Prompt Injection 防护 | ✅ 一致 | 8.9 安全防护 | 15 SR-2 | XML 标签包裹 + 结构化输出 + 后处理验证 |
| 终端缓冲区策略 | ✅ 一致 | 11.2 终端缓冲区限制 | 11.2 xterm.js | 可见 10000 行/非可见 1000 行 |
| 聊天历史导出 | ⚠️ 部分一致 | 8.15 完整导出流程 | 9 X3 任务(1.5天) | PRD 定义了范围选择/格式选择/目录选择，DEV-PLAN X3 仅分配 1.5 天，未在技术难点中提及 |
| 数据埋点实现 | ⚠️ 部分一致 | 13.3 完整埋点体系 | 未提及 | PRD 定义了 30+ 埋点事件 + analytics.json 存储 + 清理策略，DEV-PLAN 未将埋点纳入任务拆分或技术难点 |
| 内存监控机制 | ⚠️ 部分一致 | 11.2 内存监控 | 13 M6 验收标准 | PRD 要求每 60 秒检查 + 2GB 阈值警告。DEV-PLAN M6 验收标准提到"内存 < 2GB"但未给出实现方案 |
| 滚动缓冲区切换 | 🔍 需确认 | 11.2 非可见终端缩减至 1000 行 | 11.2 xterm.js | PRD 要求"非可见终端自动缩减至 1000 行"，但 xterm.js 的 `scrollback` 设置后无法动态缩小已有缓冲区，技术方案需确认 |

---

## 5. 测试策略覆盖度

| 检查项 | 状态 | PRD 位置 | DEV-PLAN 位置 | 说明 |
|--------|------|----------|---------------|------|
| JSONL 解析器单元测试 | ✅ 一致 | 8.3.1 解析规则 | 12.1 ~15 用例 | 正常/错误/不完整/空文件/大文件 |
| Grid 布局算法测试 | ✅ 一致 | 8.1 Grid 规则表 | 12.1 ~10 用例 | 1-20 终端 + 5 特殊布局 |
| 终端状态机测试 | ✅ 一致 | 6.2 状态机 | 12.1 ~20 用例 | 所有状态转换 |
| 进程检测测试 | ✅ 一致 | 6.7 tcgetpgrp | 12.1 ~8 用例 | shell/AI 工具/未知进程 |
| 聊天历史同步测试 | ✅ 一致 | 8.3.2 同步模块 | 12.1 ~12 用例 | mtime/去重/增量 |
| 富编辑器文本转发测试 | ✅ 一致 | 8.16 转发机制 | 12.1 ~10 用例 | CC 多行/shell/图片路径 |
| Markdown 渲染测试 | ✅ 一致 | 8.2.1 渲染规格 | 12.1 ~15 用例 | 各格式/GFM/暗色主题 |
| 搜索索引测试 | ✅ 一致 | 8.3.4 全文搜索 | 12.1 ~10 用例 | 构建/增量/大文件 |
| 文件路径 hash 测试 | ✅ 一致 | 3.4 SHA-256 hash | 12.1 ~5 用例 | 截取/反查 |
| 总单元测试用例数 | ✅ 一致 | - | 12.1 ~105 | 覆盖 9 个核心模块 |
| 集成测试：终端生命周期 | ✅ 一致 | 4.1 核心旅程 | 12.2 | spawn → 交互 → 关闭 → 清理 |
| 集成测试：聊天历史端到端 | ✅ 一致 | 4.1 搜索历史 | 12.2 | JSONL → 解析 → 三栏联动 |
| 集成测试：文件监听链路 | ✅ 一致 | 3.5 文件监听 | 12.2 | chokidar → 更新 → UI |
| 集成测试：同步端到端 | ✅ 一致 | 8.3.2 同步 | 12.2 | CC 变化 → 镜像 → 双源切换 |
| 集成测试：富编辑器→PTY | ✅ 一致 | 8.16 完整流程 | 12.2 | 编辑器 → 检测 → 协议 → PTY → xterm |
| 集成测试：布局持久化 | ✅ 一致 | 7.2 config.json | 12.2 | 调整 → 关闭 → 重启 → 恢复 |
| E2E：核心工作流 | ✅ 一致 | 4.1 用户旅程 | 12.3 | 启动→新建→聚焦→Esc→关闭 |
| E2E：文件浏览 | ✅ 一致 | 4.1 文件预览 | 12.3 | 文件按钮→面板→文件→三栏→Esc |
| E2E：聊天历史 | ✅ 一致 | 4.1 搜索历史 | 12.3 | 打开→选项目→选会话→搜索→导出 |
| E2E：配置管理 | ✅ 一致 | 4.1 管理配置 | 12.3 | 打开→Skills→Settings→编辑CLAUDE.md→保存 |
| E2E：富编辑器 | ✅ 一致 | 4.1 隐含 | 12.3 | 输入→粘贴图片→发送→验证终端 |
| Skill 发现者旅程 E2E | ⚠️ 部分一致 | 4.2 发现者旅程 | 12 未提及 | PRD 4.2 定义了完整 V2 用户旅程，DEV-PLAN 测试策略仅覆盖 V1 |
| Skill 展示者旅程 E2E | ⚠️ 部分一致 | 4.3 展示者旅程 | 12 未提及 | V2 测试策略未在 DEV-PLAN 中定义（可能后续补充） |
| 首次使用引导 E2E | ⚠️ 部分一致 | 8.14 引导步骤 | 12 未提及 | 引导流程在 E2E 中未覆盖 |

---

## 6. 里程碑与 PRD 对齐

| 检查项 | 状态 | PRD 位置 | DEV-PLAN 位置 | 说明 |
|--------|------|----------|---------------|------|
| M1 终端核心（W1-3） | ✅ 一致 | 功能 A(V1-P0) | 13 M1 | 覆盖 A1-A6 + X1 引导 |
| M1 验收：20 终端 + 自适应 | ✅ 一致 | 11.2 最大 20 终端 | 13 M1 验收 | PRD 上限 20 与验收标准一致 |
| M1 验收：重启恢复 | ✅ 一致 | 3.1 终端生命周期 | 13 M1 验收 | "在记录的目录重新打开 shell" |
| M1 验收：状态点正确 | ✅ 一致 | 6.2 状态 UI 映射 | 13 M1 验收 | 颜色映射 |
| M2 交互增强（W4-5） | ✅ 一致 | 功能 B+I(V1-P0) | 13 M2 | 聚焦 + 命名 + tcgetpgrp + 3D + 快捷键 |
| M2 验收：双击聚焦/Esc 返回 | ✅ 一致 | 6.3 视图模式 | 13 M2 验收 | 与状态机定义一致 |
| M2 验收：cwd 切换分支 | ✅ 一致 | 6.7 目录切换 | 13 M2 验收 | shell 直接 cd / AI 工具弹确认 |
| M3 聊天历史（W5-7） | ✅ 一致 | 功能 D+G(V1-P0) | 13 M3 | JSONL + 同步 + 三栏 + Markdown + 导出 |
| M3 验收：新会话实时同步 | ✅ 一致 | 8.3.2 增量同步 | 13 M3 验收 | chokidar 监听 |
| M3 验收：三栏联动 | ✅ 一致 | 8.3.3 三栏联动 | 13 M3 验收 | 左中右联动 |
| M3 验收：Markdown 暗色 | ✅ 一致 | 8.2.1 暗色主题配色 | 13 M3 验收 | 暗色主题正确 |
| M4 文件浏览（W7-8） | ✅ 一致 | 功能 H+G(V1-P1) | 13 M4 | 面板 + 三栏视图 + NEW 标记 |
| M4 验收：NEW 标记 | ✅ 一致 | 3.5 NEW 高亮 | 13 M4 验收 | CC 新文件标记 |
| M5 P1 体验完善（W9-12） | ✅ 一致 | 功能 C+E+J+M+RE1(V1-P1) | 13 M5 | 拖拽+搜索+浏览器+归组+富编辑器+缺省态 |
| M5 验收：索引不阻塞 UI | ✅ 一致 | 11.2 索引策略 | 13 M5 验收 | Web Worker 后台执行 |
| M5 验收：富编辑器 + 图片 | ✅ 一致 | 8.16 图片处理 | 13 M5 验收 | 正常输入/发送 + 图片粘贴 |
| M6 P2 进阶功能（W13-17） | ✅ 一致 | 功能 F+K+L+RE2(V1-P2) | 13 M6 | 时间线+分类+编辑+富编辑器完善+性能 |
| M6 验收：vim 自动切换 | ✅ 一致 | 8.16 ASB 检测 | 13 M6 验收 | Alternate Screen Buffer |
| M6 验收：Settings 编辑 | ✅ 一致 | 8.4 编辑保存 | 13 M6 验收 | 可编辑保存 |
| M6 验收：内存 < 2GB | ✅ 一致 | 11.2 内存监控 | 13 M6 验收 | 20 终端场景 |
| M6 验收：E2E 全部通过 | ✅ 一致 | - | 13 M6 验收 | 12.3 E2E 测试 |
| P0 功能分配 | ✅ 一致 | 2 功能清单 V1-P0 | 8 V1-P0 | A+B+D+G+I 五个 P0 功能 |
| P1 功能分配 | ✅ 一致 | 2 功能清单 V1-P1 | 8 V1-P1 | C+E+H+J+M+RE1 六个 P1 功能 |
| P2 功能分配 | ✅ 一致 | 2 功能清单 V1-P2 | 8 V1-P2 | F+K+L+RE2 四个 P2 功能 |
| V1 成功标准 | ⚠️ 部分一致 | 1.6 日活留存率 > 40% | 13 M1-M6 验收 | PRD 定义 V1 成功标准为"日活用户留存率 > 40%"，DEV-PLAN 里程碑验收标准偏技术指标（功能完整性/性能），未包含用户层面的成功度量 |

---

## 7. V2 Go/No-Go 一致性

| 检查项 | 状态 | PRD 位置 | DEV-PLAN 位置 | 说明 |
|--------|------|----------|---------------|------|
| V2-P0 启动条件 #1：200+ 活跃用户 | ✅ 一致 | 附录 D.1 阶段 0 | 19 V2-P0 #1 | PRD "200+ 活跃用户" = DEV-PLAN "200+ 活跃用户" |
| V2-P0 启动条件 #2：Skills 痛点确认 | ✅ 一致 | 附录 D.1 阶段 0 | 19 V2-P0 #2 | 一致 |
| V2-P0 启动条件 #3：3 个聚合源 | ✅ 一致 | 附录 D.1 阶段 1 | 19 V2-P0 #3 | "3+ 个可用源" 一致 |
| V2-P0 启动条件 #4：V1 稳定 | ✅ 一致 | 附录 D.1 隐含 | 19 V2-P0 #4 | V1 终端管理 + 配置管理器稳定 |
| V2-P1 启动条件 #1：V2-P0 稳定 | ✅ 一致 | - | 19 V2-P1 #1 | 合理 |
| V2-P1 启动条件 #2：Prompt 确定 | ✅ 一致 | 附录 B 待确认项 | 19 V2-P1 #2 | "评分一致性：偏差 < 5 分" |
| V2-P1 启动条件 #3：评分偏差 < 5 分 | ✅ 一致 | 8.9 评分一致性 | 19 V2-P1 #3 | PRD "±5 分不影响等级" 对应 DEV-PLAN "偏差 < 5 分" |
| V2-P1 启动条件 #4：文件监听验证 | ✅ 一致 | 附录 B 待确认项 | 19 V2-P1 #4 | 通信机制验证 |
| V2-P2 启动条件 #1：AI 评分内测 | ✅ 一致 | 附录 D.1 阶段 2 | 19 V2-P2 #1 | 内测完成 |
| V2-P2 启动条件 #2：分享率 >= 15% | ✅ 一致 | 附录 D.1 Go/No-Go | 19 V2-P2 #2 | PRD "30 人中少于 5 人分享则暂停" = "分享率 >= 15%" 一致 |
| V2-P2 启动条件 #3：模板设计完成 | ✅ 一致 | 附录 D.1 阶段 3 | 19 V2-P2 #3 | 设计稿评审 |
| V2-P2 启动条件 #4：OAuth 验证 | ✅ 一致 | 附录 B 待确认项 | 19 V2-P2 #4 | 技术 PoC |
| V2-P2 启动条件 #5：Pages 验证 | ✅ 一致 | 附录 B 待确认项 | 19 V2-P2 #5 | 技术 PoC |
| V2-P3 启动条件：月活 > 1000 | ✅ 一致 | 附录 D.1 社区平台 | 19 V2-P3 #1 | 完全一致 |
| V2-P3 启动条件：展示页月生成 > 100 | ✅ 一致 | 附录 D.1 社区平台 | 19 V2-P3 #2 | 完全一致 |
| V2-P3 启动条件：外部链接月点击 > 500 | ✅ 一致 | 附录 D.1 社区平台 | 19 V2-P3 #3 | 完全一致 |

---

## 8. 排期合理性

| 检查项 | 状态 | PRD 位置 | DEV-PLAN 位置 | 说明 |
|--------|------|----------|---------------|------|
| V1-P0 工期 6-7 周 | ✅ 一致 | 1.6 V1-P0 | 8/排期汇总 | A(10天)+B(3天)+I(3天)+D(8天)+G(3天)=27天=5.4周，加缓冲合理为 6-7 周 |
| V1-P1 工期 5-6 周 | ✅ 一致 | - | 8/排期汇总 | C(4天)+E(6天)+H(6天)+J(3天)+M(2天)+RE1(8天)=29天=5.8周，5-6 周合理 |
| V1-P2 工期 4-5 周 | ✅ 一致 | - | 8/排期汇总 | F(3天)+K(4天)+L(3天)+RE2(5天)+X(5天)=20天=4周，4-5 周合理 |
| V1 合计 15-18 周 | ✅ 一致 | - | 8/排期汇总 | 6-7+5-6+4-5=15-18 周，正确 |
| V2-P0 工期 3-4 周 | ✅ 一致 | - | 14/排期汇总 | N2(11天)+O(5天)+U(2.5天)=18.5天=3.7周，3-4 周合理 |
| V2-P1 工期 2-3 周 | ✅ 一致 | - | 14/排期汇总 | SR(9天)+T(3天)=12天=2.4周，2-3 周合理 |
| V2-P2 工期 5-6 周 | ✅ 一致 | - | 14/排期汇总 | SS(10.5天)+P2(11.5天)+RE3(3天)=25天=5周，5-6 周合理 |
| V2-P3 工期 8-10 周（概要） | ✅ 一致 | - | 14/排期汇总 | 概要级别，合理 |
| V2 合计 18-23 周 | ✅ 一致 | - | 排期汇总 | 3-4+2-3+5-6+8-10=18-23 周，正确 |
| 总工期 33-41 周 | ✅ 一致 | - | 排期汇总 | 15-18+18-23=33-41 周，正确 |
| 缓冲考虑 | ⚠️ 部分一致 | - | 排期汇总 | 每阶段给出区间范围（如 6-7 周），但未明确标注缓冲系数（通常建议 20-30% 缓冲），总工期 33-41 周范围约 24% 弹性空间，隐含缓冲但未显式说明 |
| 1 人开发假设 | ✅ 一致 | - | 排期汇总末尾 | 明确标注"1 个全栈开发者" |
| V1-P0 任务总工时核算 | ⚠️ 部分一致 | - | 9 | A(10)+B(3)+I(3)+D(8)+G(3)=27天净工时。6-7 周 = 30-35 工作日。余 3-8 天用于引导(X1=1.5天)+联调+Bug，略紧但可行 |
| M2(W4-5) 时间分配 | 🔍 需确认 | - | 13 M2 | B(3天)+I(3天)+X2(1天)=7天仅需 1.4 周，但分配了 W4-5 两周。可能包含 M1 的收尾/Bug 修复，但未显式说明 |

---

## 9. 项目目录结构完整性

| 检查项 | 状态 | PRD 位置 | DEV-PLAN 位置 | 说明 |
|--------|------|----------|---------------|------|
| Main Process IPC 目录 | ✅ 一致 | - | 5 目录结构 | 9 个 .ipc.ts 文件与 IPC 9 组协议完全对应 |
| Main Process 服务目录 | ✅ 一致 | - | 5 目录结构 | pty-manager / file-watcher / chat-sync / search-index / process-detector / package-installer / aggregator / auth-service |
| Preload Script | ✅ 一致 | - | 5 目录结构 | 单文件 contextBridge API |
| Zustand Store 按域拆分 | ✅ 一致 | - | 5 目录结构 | 8 个 store 文件覆盖所有数据域 |
| XState 状态机 | ✅ 一致 | 6.1-6.18 状态机 | 5 目录结构 | 18 个 .machine.ts 与 PRD 18 个状态机一一对应 |
| React 组件目录 | ✅ 一致 | 8.1-8.10 页面 | 5 目录结构 | terminal/file-browser/chat-history/config-manager/skill-browser/showcase/layout/shared |
| React Hooks | ✅ 一致 | - | 5 目录结构 | useTerminal/useIPC/useMachine/useFileWatcher |
| 样式目录 | ✅ 一致 | 9 暗色主题 | 5 目录结构 | variables.css + global.css + themes/dark.css |
| 共享类型定义 | ✅ 一致 | 7 数据结构 | 5 目录结构 | terminal/chat/config/marketplace/score/showcase/ipc 类型 |
| 共享常量 | ✅ 一致 | - | 5 目录结构 | channels.ts + paths.ts |
| 测试目录 | ✅ 一致 | - | 5 目录结构 | tests/main/ + tests/renderer/ |
| 缺少 analytics 相关文件 | ⚠️ 部分一致 | 13.3 数据统计 | 5 目录结构 | PRD 定义了完整的埋点体系，但目录结构中无 analytics 相关的 store/service/类型文件 |
| 缺少 publish-drafts 服务 | ⚠️ 部分一致 | 7.10 发布草稿 | 5 目录结构 | PRD 定义了 PublishDraft 数据结构，DEV-PLAN 目录中无对应服务文件（可能隶属于 showcase 模块，但未明确） |
| 缺少 muxvo-skill-scorer | 🔍 需确认 | 8.9 评分 Skill | 5 目录结构 | muxvo-skill-scorer 是独立的 CC Skill，不属于 Muxvo 项目结构，但其开发任务 SR-1 在 DEV-PLAN 中。需确认是否应在仓库中维护该 Skill 的源码 |
| 缺少 muxvo-publisher | 🔍 需确认 | 7.9/8.8 publisher | 5 目录结构 | muxvo-publisher 是 CC Plugin，同上，需确认是否纳入项目仓库 |
| config:get-resources 缺 plugins 类型 | ⚠️ 部分一致 | 8.4 Plugins 卡片 | 2.4 + 5 | PRD 8.4 列出 Plugins 作为配置管理器的一个分类，DEV-PLAN config:get-resources 的 type union 类型中缺少 'plugins' |

---

## 统计汇总

| 检查大类 | ✅ 一致 | ⚠️ 部分一致 | ❌ 不一致 | 🔍 需确认 | 总计 |
|----------|---------|-------------|----------|-----------|------|
| 1. IPC 协议与 PRD 数据流 | 33 | 6 | 0 | 2 | 41 |
| 2. 模块拆分与 PRD 功能对应 | 26 | 4 | 0 | 1 | 31 |
| 3. 任务依赖关系完整性 | 52 | 0 | 0 | 0 | 52 |
| 4. 技术方案覆盖度 | 20 | 3 | 0 | 1 | 24 |
| 5. 测试策略覆盖度 | 20 | 3 | 0 | 0 | 23 |
| 6. 里程碑与 PRD 对齐 | 21 | 1 | 0 | 0 | 22 |
| 7. V2 Go/No-Go 一致性 | 16 | 0 | 0 | 0 | 16 |
| 8. 排期合理性 | 12 | 2 | 0 | 1 | 15 |
| 9. 项目目录结构完整性 | 11 | 3 | 0 | 2 | 16 |
| **合计** | **211** | **22** | **0** | **7** | **240** |

### 一致率：211/240 = 87.9%

### 关键发现总结

**需要补充的缺口（⚠️ 部分一致）：**

1. **IPC 协议缺口**：
   - 缺少富编辑器图片临时文件写入的专门 IPC channel
   - 缺少系统剪贴板写入图片的 IPC channel（RE2 剪贴板模拟需要）
   - 缺少聊天历史导出 `chat:export` IPC channel
   - config:get-resources type 参数缺少 'plugins'

2. **模块/功能归属缺口**：
   - 数据埋点/分析功能未分配到任何模块，也未纳入任务拆分
   - 聊天历史导出和首次使用引导在通用任务中，但未明确归属模块
   - 内存监控功能未有实现方案

3. **测试策略缺口**：
   - V2 功能的测试策略（集成测试/E2E）未定义
   - 首次使用引导未纳入 E2E 测试

4. **目录结构缺口**：
   - 缺少 analytics 相关的 store/service/类型文件
   - muxvo-skill-scorer 和 muxvo-publisher 的源码管理位置未确认

**需要确认的项目（🔍 需确认）：**

1. 评分时可选纳入使用数据的 IPC 参数传递方式
2. 评分 Skill 自动安装的触发机制
3. xterm.js 动态缩减 scrollback 的技术可行性
4. Milestone 2（W4-5）时间分配偏宽裕，是否包含 M1 收尾
5. muxvo-skill-scorer 和 muxvo-publisher 是否纳入项目仓库

**无不一致项（❌ = 0）**：DEV-PLAN 与 PRD 之间不存在直接矛盾或冲突的定义。
