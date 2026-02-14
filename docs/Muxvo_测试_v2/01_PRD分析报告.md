# Muxvo PRD 分析报告（测试用例生成用）

## 分析信息
- PRD 版本：V2.0（3064 行）
- DEV-PLAN 版本：V1.0（1358 行）
- 分析日期：2026-02-14
- 分析依据：prd-to-test-1-analyze Skill + 特殊规则识别指南 v1.0
- 参考文档：`docs/Muxvo_PRD分析报告.md`（已有分析报告）

---

## 一、PRD 完整性检查

| 检查项 | 状态 | 备注 |
|--------|------|------|
| API 定义 | ⚠️ | Electron 桌面应用，无 REST API。IPC 通信协议在 DEV-PLAN 2.1-2.10 节定义（10 个域 50+ 通道）。PRD 侧描述功能行为和数据格式 |
| 数据模型 | ✅ | PRD 第 7 节定义了 10 种数据结构（CC 数据 7.1、配置 7.2、包 7.3、评价 7.4、注册表 7.5、归档格式 7.6、评分结果 7.7、展示页配置 7.8、Publisher 7.9、发布草稿 7.10） |
| 业务规则 | ✅ | 第 8 节详细说明了 16 个功能模块的完整规格；第 3 节定义 11 条核心策略 |
| 错误处理 | ✅ | 11.1 节定义了 30+ 种异常场景及处理方式 |
| 状态定义 | ✅ | 第 6 节定义了 18 个状态机（6.1-6.18），覆盖应用、终端、视图、面板、安装、评分、认证、展示页等 |
| 性能策略 | ✅ | 11.2 节定义了 15 项性能策略 |
| 缺省态 | ✅ | 11.3 节定义了 20+ 种空状态文案和交互 |
| 快捷键 | ✅ | 第 10 节定义了 11 个核心快捷键 |
| 数据埋点 | ✅ | 13.3 节定义了 30+ 个埋点事件 |

**结论**：PRD 非常完备。主要注意点是该项目为 **Electron 桌面应用**，测试重点是：
1. **状态机转换**（18 个状态机的正确性和边界）
2. **UI 交互**（视图切换、拖拽、快捷键、Esc 优先级）
3. **文件系统操作**（CC 数据读取、镜像同步、JSONL 解析、文件监听）
4. **IPC 通信**（Main<->Renderer 进程间通信的 50+ 通道）
5. **富编辑器覆盖层**（模式切换、文本转发、图片处理、按键穿透）

---

## 二、功能清单摘要

### V1 — 终端工作台（15 个功能）

| 编号 | 功能 | 描述 | 优先级 | 测试模块 | 预计用例数 |
|------|------|------|--------|----------|------------|
| A | 全屏平铺式终端管理 | Grid 布局自适应数量（1=全屏，2=对半，4=四宫格...），智能行列计算 | V1-P0 | TERM | 18 |
| B | 聚焦模式 | 双击放大左侧 75%，右侧栏最多 3 个可滚动，Esc 返回 | V1-P0 | TERM | 12 |
| D | 聊天历史浏览器 | 三栏邮件风格，读取 CC JSONL，双源读取+镜像同步 | V1-P0 | CHAT | 22 |
| G | 内置 Markdown 预览 | 三栏中栏渲染，支持 CommonMark+GFM，预览/编辑双模式 | V1-P0 | FILE | 12 |
| I | 双段式命名 | cwd 路径+自定义名称，`~/path . 名称`，cwd 可点击切换 | V1-P0 | TERM | 10 |
| C | 终端拖拽排序+边框调整 | HTML5 DnD 排序，tile 间隙拖拽调整行列比例，双击重置 | V1-P1 | TERM | 14 |
| E | 全文搜索 | 跨项目跨会话搜索，倒排索引+持久化+增量更新 | V1-P1 | CHAT | 14 |
| H | 文件浏览器+三栏临时视图 | 右侧 320px 滑出面板+全屏三栏（终端/内容/目录） | V1-P1 | FILE | 16 |
| J | ~/.claude/ 可视化浏览器 | 分类卡片列表，8 种资源类型浏览 | V1-P1 | CONFIG | 10 |
| M | 同目录终端自动归组 | 新建/切换目录后自动排列到同目录终端旁边 | V1-P1 | TERM | 8 |
| RE1 | 富编辑器覆盖层（基础） | contenteditable 编辑器、文本 PTY 转发、CC 多行协议、图片粘贴、手动模式切换 | V1-P1 | EDITOR | 20 |
| F | 会话时间线视图 | 按天分组纵轴时间线，不同项目颜色标识 | V1-P2 | CHAT | 6 |
| K | Plans/Skills/Hooks/Tasks 分类查看 | 按类型分类展示 CC 资源，支持搜索和预览 | V1-P2 | CONFIG | 8 |
| L | Settings/CLAUDE.md 查看与编辑 | 直接编辑并保存 settings.json 和 CLAUDE.md | V1-P2 | CONFIG | 8 |
| RE2 | 富编辑器覆盖层（完善） | 自动模式检测（ASB+进程名）、图片剪贴板模拟、各工具协议适配 | V1-P2 | EDITOR | 14 |

### V2 — Skill Showcase 平台（9 个功能）

| 编号 | 功能 | 描述 | 优先级 | 测试模块 | 预计用例数 |
|------|------|------|--------|----------|------------|
| N2 | Skill 聚合浏览器 | 6 个来源聚合，左侧边栏筛选+排序，异步加载各源 | V2-P0 | BROWSER | 16 |
| O | 一键安装 | Skill 直接安装+Hook 安全审查后安装，卸载/注册表管理 | V2-P0 | INSTALL | 14 |
| U | Hook 安全审查 | 安全审查对话框，源码展示+风险关键词高亮 | V2-P0 | SECURITY | 10 |
| T | 更新检测与推送 | 启动+6h 轮询检测，徽章提示，单个/批量更新 | V2-P1 | INSTALL | 10 |
| SR | AI Skill 评分 | CC Skill 模式评分，6 维度+等级制，缓存+一致性保障，防注入 | V2-P1 | SCORE | 18 |
| RE3 | 富编辑器覆盖层（高级） | 斜杠命令自动补全、输入历史、文件拖拽、代码块高亮 | V2-P2 | EDITOR | 10 |
| SS | Skill Showcase 展示页 | AI 评分+SKILL.md 自动生成展示页，2-3 套模板，OG Card | V2-P2 | SHOWCASE | 14 |
| P2 | Skill 发布/分享 | 安全检查+详情填写+GitHub Pages 发布+分享面板（7 渠道） | V2-P2 | PUBLISH | 18 |
| SC | Showcase 社区平台 | Feed 流/点赞/评论/排行榜/个人主页 | V2-P3 | COMMUNITY | 12 |

### 跨功能模块

| 模块 | 描述 | 预计用例数 |
|------|------|------------|
| APP | 应用生命周期（启动/恢复/保存/关闭、配置持久化） | 12 |
| DATA | 数据同步（聊天历史镜像、JSONL 解析、文件监听、索引构建） | 14 |
| ONBOARD | 首次使用引导（4 步+跳过机制） | 8 |
| PERF | 性能策略（缓冲区限制、虚拟滚动、去抖、分页、内存监控） | 12 |
| ERROR | 异常处理（降级、重试、提示、30+ 场景） | 16 |
| AUTH | 认证授权（GitHub OAuth PKCE，V2-P2） | 8 |

**总计预估**：约 **354 个测试用例**

---

## 三、测试分层适配说明

> 本项目为 Electron 桌面应用，与 Web API 后端项目的测试分层有差异。适配如下：

| 层级 | 原定义 | 适配为 Muxvo 的含义 | 测试实现方式 |
|------|--------|-------------------|-------------|
| L1 契约层 | API 格式+默认值 | IPC 通道消息格式+数据结构默认值+文件格式解析+快捷键绑定 | Jest/Vitest 单元测试 |
| L2 规则层 | 业务规则+边界值 | 状态机转换规则+性能边界+上限值+特殊规则+Esc 优先级+Grid 布局算法 | Jest/Vitest + Electron 测试工具 |
| L3 场景层 | 用户旅程+多日场景 | 完整用户操作流程（启动->操作->关闭）、跨功能交互、多终端协同 | Playwright/Spectron E2E |

---

## 四、状态机图

PRD 第 6 节定义了 18 个状态机，以下提取测试价值最高的关键状态机，包含完整转换条件：

### 4.1 应用生命周期（6.1）

```
[*] -> Launching -> Restoring -> {RestoringTerminals | EmptyState} -> Running -> Saving -> ShuttingDown -> [*]
```

**关键转换条件**：
| 源状态 | 目标状态 | 触发条件 | 系统动作 |
|--------|---------|----------|----------|
| Launching | Restoring | 应用窗口创建完毕 | 读取 config.json |
| Restoring | RestoringTerminals | `config.openTerminals.length > 0` | 在记录的 cwd 逐个重新启动新 shell 进程（非恢复旧进程） |
| Restoring | EmptyState | `config.openTerminals.length === 0` | 显示空 Grid + 引导提示 |
| Running | Saving | 窗口 close 事件 | 序列化当前 Grid 布局、列宽比例、终端列表 |
| ShuttingDown | [*] | 所有子进程 exit 事件 | `app.quit()` |

**测试要点**：
- 有上次会话 vs 无上次会话的分支
- 恢复时 cwd 目录不存在的异常处理
- 关闭时子进程未退出的超时处理
- 终端重启后是空白 shell，不恢复旧输出

### 4.2 终端进程生命周期（6.2）

```
[*] -> Created -> Starting -> {Running | Failed}
Running -> {Busy | WaitingInput | Stopping | Disconnected}
Busy -> Running
WaitingInput -> Running
Stopping -> {Stopped | Disconnected}
Disconnected -> {Starting | Removed}
Stopped -> Removed -> [*]
Failed -> Removed -> [*]
```

**状态 UI 映射**（关键验证点）：
| 状态 | 状态点颜色 | 动画 | 输入栏 |
|------|-----------|------|--------|
| Created | 灰色 | 无 | 禁用 |
| Starting | 黄色 | 闪烁 | 禁用，显示"启动中..." |
| Running | 绿色 | 呼吸脉冲 | 可用 |
| Busy | 绿色 | 快速脉冲 | 显示"处理中..." |
| WaitingInput | 琥珀色 | 呼吸脉冲 | 可用+选项 |
| Stopping | 灰色 | 闪烁 | 禁用，显示"正在关闭..." |
| Stopped | 灰色 | 无 | 禁用 |
| Disconnected | 红色 | 无 | 禁用，显示"已断开" |
| Failed | 红色 | 无 | 禁用 |

**测试要点**：
- 每种状态的 UI 映射正确性
- spawn 失败（路径不存在/权限不足）-> Failed
- 进程异常退出（exit code != 0）-> Disconnected
- 超时未退出（5s timeout）-> Disconnected
- 重新连接流程

### 4.3 视图模式（6.3）

```
[*] -> Tiling <-> Focused（双击/Esc）
Tiling -> FilePanel -> TempView
Focused -> FilePanel -> TempView
TempView -> Tiling（Esc）
```

**Esc 键优先级（7 级，仅 UI 层焦点时生效）**：
1. 安全审查对话框
2. 文件夹选择器
3. Skill 浏览器
4. 三栏临时视图
5. 文件面板
6. 聚焦模式
7. 平铺模式（无操作）

**测试要点**：
- Esc 在终端内焦点时直接透传，不截获
- 7 级优先级每级正确关闭
- 从不同模式进入 FilePanel 后按 Esc 返回正确的模式
- 双击 vs 单击的区分（单击仅选中高亮边框）

### 4.4 终端 Tile 交互状态（6.4）

```
Default <-> Hover（mouseenter/mouseleave）
Default/Hover -> Selected（click）
Selected -> Focused（dblclick）
Default/Hover/Selected -> Dragging -> Default
Default -> DragOver -> Default
```

**CSS 样式映射**：
| 状态 | border | opacity | transform | 额外效果 |
|------|--------|---------|-----------|---------|
| Default | var(--border) | 1 | none | - |
| Hover | var(--border) | 1 | rotateX/Y(+-4deg) | 光泽反射层 |
| Selected | var(--accent) | 1 | none | amber 边框 glow |
| Dragging | var(--border) | 0.4 | none | 半透明 |
| DragOver | var(--accent) | 1 | none | box-shadow: accent-glow |

### 4.5 富编辑器覆盖层（6.13）

```
[*] -> RichEditor（默认）
RichEditor 内部: Idle -> Composing -> {ImageAttaching -> Composing | Sending -> Idle}
RichEditor <-> RawTerminal（ASB 信号/手动切换）
```

**模式切换触发**：
- 进入 RawTerminal: `\x1b[?1049h` 或手动快捷键
- 恢复 RichEditor: `\x1b[?1049l` 或手动快捷键

**按键穿透规则**：
| 按键 | 行为 |
|------|------|
| Ctrl+C | 穿透到终端（中断进程） |
| Ctrl+Z | 穿透到终端（挂起进程） |
| Ctrl+D | 穿透到终端（EOF） |
| Enter/Cmd+Enter | 编辑器发送 |
| Shift+Enter | 编辑器换行 |
| 其他按键 | 编辑器输入 |

### 4.6 包安装状态（6.15）

```
[*] -> NotInstalled -> Downloading -> {SecurityReview(Hook) | Installing(Skill)}
SecurityReview -> {Installing | NotInstalled(取消)}
Installing -> {Installed | InstallFailed}
Installed -> {UpdateAvailable | Uninstalling}
UpdateAvailable -> {Downloading | Uninstalling}
Uninstalling -> NotInstalled
```

**状态 UI 映射**：
| 状态 | 按钮文案 | 按钮样式 |
|------|---------|---------|
| NotInstalled | 安装 | amber 实心按钮 |
| Downloading | 下载中... | 灰色禁用+进度条 |
| Installing | 安装中... | 灰色禁用+旋转图标 |
| Installed | 已安装 | 绿色描边按钮，hover 显示"卸载" |
| UpdateAvailable | 更新到 x.y.z | amber 描边按钮+徽章 |
| InstallFailed | 重试安装 | 红色描边按钮 |

### 4.7 AI 评分状态（6.16）

```
[*] -> NotScored -> Scoring -> {Scored | ScoreFailed}
ScoreFailed -> {Scoring(重试) | NotScored(取消)}
Scored -> {Scoring(内容变更) | GeneratingShowcase}
```

### 4.8 Showcase 展示页生命周期（6.18）

```
[*] -> NotGenerated -> Generating -> {Previewing | GenerateFailed}
Previewing <-> Editing
Previewing -> Publishing -> {Published | PublishFailed}
Published -> {Updating -> Published | Unpublished}
Unpublished -> {Publishing | NotGenerated}
```

### 4.9 其他重要状态机

| 状态机 | PRD 位置 | 关键测试点 |
|--------|---------|-----------|
| 文件面板（6.5） | Closed->Opening->Open->Closing->Closed | 300ms 过渡动画、切换另一个终端的文件面板 |
| 三栏临时视图（6.6） | Hidden->Active(Preview/Edit)->Exiting->Hidden | 左右栏宽度持久化、编辑未保存提示 |
| 目录切换（6.7） | 按前台进程类型分支：shell 直接 cd / AI 工具先退出再 cd | tcgetpgrp() 前台进程检测 |
| 自定义名称（6.8） | DisplayEmpty->Editing->DisplayNamed/DisplayEmpty | Esc 取消恢复原值 |
| Grid 边框调整（6.9） | Idle->DetectingGap->ColResize/RowResize->Dragging | 仅平铺模式生效，双击重置 |
| 聊天历史面板（6.10） | Closed->Loading->Ready(EmptySearch/Searching/Results)->SessionDetail | 300ms 去抖搜索 |
| 配置管理器（6.11） | Closed->CategoryList->ResourcePreview | 8 种资源类型，Settings/CLAUDE.md 可编辑 |
| 文件监听（6.12） | Inactive->Watching->WatchError | 3s interval, max 3 retries |
| Skill 聚合浏览器（6.14） | Closed->Loading->{Ready/PartialReady/LoadError} | 部分源失败时的降级处理 |
| 用户认证（6.17） | LoggedOut->Authorizing->LoggedIn | Token 过期/取消处理 |

---

## 五、Grid 布局算法规则

| 终端数 | 布局 |
|--------|------|
| 1 | 1x1 全屏 |
| 2 | 2x1 左右对半 |
| 3 | 3x1 三等分 |
| 4 | 2x2 四宫格 |
| 5 | 上 3 下 2（下行居中） |
| 6 | 3x2 六宫格 |
| 7+ | ceil(sqrt(n)) 列，自动计算 |

**测试要点**：每种终端数量对应的行列计算正确性。

---

## 六、IPC 通信协议摘要

DEV-PLAN 定义了 10 个 IPC 域，共 50+ 通道：

| 域 | 通道数 | 关键通道 |
|----|--------|---------|
| terminal:* | 10 | create, write, resize, close, output(push), state-change(push), exit(push) |
| fs:* | 9 | read-dir, read-file, write-file, watch-start/stop, change(push), select-directory, write-temp-image, write-clipboard-image |
| chat:* | 6 | get-history, get-session, search, session-update(push), sync-status(push), export |
| config:* | 8 | get-resources, get-resource-content, get/save-settings, get/save-claude-md, get-memory, resource-change(push) |
| app:* | 6 | get/save-config, get/save-preferences, memory-warning(push), detect-cli-tools |
| marketplace:* | 9 | fetch-sources, search, install, uninstall, get-installed, install-progress(push), check-updates, packages-loaded(push), update-available(push) |
| score:* | 4 | run, check-scorer, get-cached, progress(push), result(push) |
| showcase:* | 4 | generate, publish, unpublish, publish-result(push) |
| auth:* | 3 | login-github, logout, get-status |
| analytics:* | 3 | track, get-summary, clear |

**统一错误响应格式**：`{ code: string, message: string, details?: any }`

---

## 七、关键业务规则提取

### 7.1 聊天历史双源读取规则
- CC 原始文件存在且可读 -> 读 CC
- CC 原始文件不存在/不可读 -> 自动切换到 Muxvo 镜像副本
- 用户无感知切换

### 7.2 聊天历史同步规则
- 按 sessionId 去重
- 用文件 mtime 判断是否更新（秒级精度：`Math.floor(mtimeMs / 1000)`）
- **仅同步不删除**：CC 侧删了文件，Muxvo 镜像保留
- 后台执行，不阻塞 UI

### 7.3 JSONL 解析规则
- 每行独立 JSON，逐行流式读取
- 格式错误的行：跳过，继续解析（静默处理）
- 忽略不以 `\n` 结尾的末尾行（可能是写入中的不完整 JSON）
- chokidar 检测到文件变化后延迟 200ms 再读取

### 7.4 富编辑器文本转发规则
| 前台进程 | 换行发送方式 | 提交方式 |
|----------|-------------|---------|
| Claude Code | `\x1b\r`（ESC+CR）分隔各行 | 最后一行后发 `\r` |
| bash/zsh/fish | 直接发送整段文本 | `\n` |
| Codex/Gemini CLI | 待适配 | 待适配 |

### 7.5 图片发送规则
| 前台工具 | 图片发送方式 |
|----------|-------------|
| Claude Code | 写入系统剪贴板 -> 发 `\x16`（Ctrl+V）-> 触发 CC 原生图片粘贴 |
| CC（fallback） | 插入文件路径作为文本 |
| Gemini CLI/Codex | 插入文件路径作为文本 |
| Shell | 插入文件路径作为文本 |

### 7.6 AI 评分规则
- 评分维度：实用性 25% + 工程质量 25% + 意图清晰度 10% + 设计巧妙度 10% + 文档完善度 15% + 可复用性 15%
- 等级制：0-39 Promising, 40-59 Solid, 60-79 Advanced, 80-94 Expert, 95-100 Masterwork
- 缓存与内容 hash 绑定，内容未变返回缓存
- temperature=0 保证一致性
- promptVersion 变更时旧缓存失效
- 后处理验证：总分 = 各维度加权平均（容差 +-2），否则标记异常重新评分
- 安全防护：XML 标签包裹 SKILL.md 内容，结构化输出约束

### 7.7 发布安全检查规则
| 检查项 | 命中处理 |
|--------|---------|
| API Key/Token（sk-xxx、ghp_xxx 等） | **阻止发布**，标红行号 |
| 硬编码路径（/Users/xxx/） | 警告，用户确认后继续 |
| 敏感文件（.env、credentials.json、私钥） | **阻止发布** |
| 文件大小（Skill>1MB / Plugin>10MB） | 警告，建议精简 |

### 7.8 目录切换规则
| 前台进程 | 判定方式 | 切换行为 |
|---------|----------|----------|
| shell（bash/zsh/fish） | 进程名匹配已知 shell 列表 | 直接发送 `cd <path>\n` |
| AI CLI 工具/其他 | 进程名不在 shell 列表 | 确认对话框->SIGINT->等待回 shell->cd |

### 7.9 三栏临时视图尺寸规则
| 栏位 | 默认宽度 | 最小宽度 | 最大宽度 |
|------|---------|---------|---------|
| 左栏（终端） | 250px | 150px | 500px |
| 中栏（内容） | flex:1 | 自适应 | 自适应 |
| 右栏（目录） | 280px | 150px | 500px |

### 7.10 聊天历史三栏布局约束
- 左栏最小宽度 180px
- 中栏最小宽度 280px
- 右栏最小宽度 400px
- 窗口宽度不足时左栏可收起为图标模式（60px）

---

## 八、附录 H：特殊规则识别记录

### 扫描执行信息
- 扫描日期：2026-02-14
- PRD 版本：V2.0
- 扫描依据：特殊规则识别指南 v1.0

### 识别结果

| 规则类型 | PRD 位置 | 原文摘录 | 生成用例建议 | 状态 |
|----------|---------|----------|------------|------|
| 部分更新规则 | 3.4/L1817 | "仅同步，不删除（CC 侧删了文件，Muxvo 镜像保留）" | DATA_L2_01_sync_no_delete | 待生成 |
| 部分更新规则 | 6.9/L985 | "仅平铺模式生效，聚焦模式下不触发" | TERM_L2_01_resize_only_tiling | 待生成 |
| 部分更新规则 | 6.3/L737 | "仅在 Muxvo UI 层有焦点时生效" Esc 键 | TERM_L2_02_esc_only_ui_focus | 待生成 |
| 多时间点规则 | 8.11/L2277 | "每 6 小时自动检测一次" 更新检测 | INSTALL_L2_01_update_check_interval | 待生成 |
| 多时间点规则 | 11.2/L2688 | "chokidar 检测到文件变化后延迟 200ms 再读取" | DATA_L2_02_jsonl_read_delay | 待生成 |
| 多时间点规则 | 6.10/L1005 | "300ms 去抖" 搜索输入 | CHAT_L2_01_search_debounce_300ms | 待生成 |
| 多时间点规则 | 8.16/L2436 | "临时文件清理：终端关闭时删除、或 24 小时后自动清理" | EDITOR_L2_01_temp_image_cleanup | 待生成 |
| 多时间点规则 | 13.3/L2942 | "明细事件保留最近 90 天...每日摘要保留最近 1 年" | APP_L2_01_analytics_retention | 待生成 |
| 多时间点规则 | 6.5/L801 | "transition done 300ms" 文件面板过渡 | FILE_L2_01_panel_transition_300ms | 待生成 |
| 多时间点规则 | 11.2/L2693 | "每 60 秒检查 Electron 进程内存占用" | PERF_L2_01_memory_check_60s | 待生成 |
| 多时间点规则 | 6.14/L1162 | "300ms 去抖" Skill 浏览器搜索 | BROWSER_L2_01_search_debounce_300ms | 待生成 |
| 多时间点规则 | 6.12/L1091 | "自动重试 (3s interval, max 3 retries)" 文件监听 | DATA_L2_03_watch_retry_3s_max3 | 待生成 |
| 累积上限规则 | 功能 B/L111 | "最多显示 3 个，可滚动" 聚焦模式右侧栏 | TERM_L2_03_focus_sidebar_max3 | 待生成 |
| 累积上限规则 | 11.2/L2692 | "上限 20 个终端" | TERM_L2_04_max_terminal_20 | 待生成 |
| 累积上限规则 | 11.2/L2691 | "聚焦终端 10000 行...非可见 1000 行；不恢复已丢弃的行" | TERM_L2_05_buffer_limit | 待生成 |
| 累积上限规则 | 5.11/L624 | "最多重试 3 次" AI 评分 | SCORE_L2_01_max_retry_3 | 待生成 |
| 累积上限规则 | 8.8/L2056 | "截图/GIF，最多 5 张" 发布详情 | PUBLISH_L2_01_max_screenshots_5 | 待生成 |
| 累积上限规则 | 8.3.4/L1879 | "单个 JSONL > 100MB 时，仅索引最近 6 个月" | CHAT_L2_02_large_file_protection | 待生成 |
| 累积上限规则 | 11.1/L2674 | "单张 <= 5MB 和格式限制（PNG/JPG/GIF）" | SHOWCASE_L2_01_image_size_limit | 待生成 |
| 累积上限规则 | 8.2/L865-869 | 三栏尺寸规则：左栏 min150 max500，右栏 min150 max500 | FILE_L2_02_column_width_limits | 待生成 |
| 累积上限规则 | 8.3.3/L1839 | 聊天三栏：左min180 中min280 右min400，窗口不足时左栏收起60px | CHAT_L2_03_layout_min_widths | 待生成 |
| 累积上限规则 | 8.8/L2045 | Skill > 1MB 警告 / Plugin > 10MB 警告 | PUBLISH_L2_02_file_size_warning | 待生成 |
| 累积上限规则 | 11.2/L2701 | "单个文件索引超过 30 秒则跳过。总构建超过 5 分钟则暂停" | CHAT_L2_04_index_timeout | 待生成 |
| 累积上限规则 | 11.2/L2693 | "超过 2GB 时在菜单栏显示黄色警告图标" 内存上限 | PERF_L2_02_memory_warning_2gb | 待生成 |
| 状态锁定规则 | 8.14/L2346 | "引导完成或跳过后，标记 onboardingCompleted: true，不再触发" | ONBOARD_L2_01_completed_no_retrigger | 待生成 |
| 默认值规则 | 7.2 | 窗口 1400x900，fontSize 14，theme dark | APP_L2_02_default_config | 待生成 |
| 默认值规则 | 6.13/L1114 | "终端启动（默认）RichEditor" | EDITOR_L2_02_default_mode | 待生成 |
| 默认值规则 | 6.14/L1161 | "默认展示（按来源优先排序）" | BROWSER_L2_02_default_sort | 待生成 |
| 默认值规则 | 8.2.1/L1720 | "渲染预览（默认）" Markdown 文件 | FILE_L2_03_default_preview_mode | 待生成 |
| 默认值规则 | 8.3.3/L1842 | "「全部项目」选项（默认选中）" | CHAT_L2_05_default_all_projects | 待生成 |
| 默认值规则 | 8.8/L2067 | "首次发布创建商城页面，版本 1.0.0" | PUBLISH_L2_03_initial_version | 待生成 |
| 默认值规则 | 8.14/L2332 | "onboardingCompleted 为 false" 首次启动触发引导 | ONBOARD_L2_02_default_trigger | 待生成 |
| 默认值规则 | 8.9/L2165 | "默认使用 CC 当前配置的模型" 评分模型 | SCORE_L2_02_default_model | 待生成 |
| 默认值规则 | 6.8/L937 | "新建终端（无自定义名称）" 显示灰色斜体"命名..." | TERM_L2_06_default_name_placeholder | 待生成 |
| 默认值规则 | 7.2/L1355 | columnRatios [1,1], rowRatios [1,1] 等分 | TERM_L2_07_default_grid_ratios | 待生成 |
| 默认值规则 | 6.6/L865 | 左栏默认 250px，右栏默认 280px | FILE_L2_04_default_column_widths | 待生成 |
| 默认值规则 | 8.16/L2455 | Enter/Cmd+Enter 发送，Shift+Enter 换行（可配置） | EDITOR_L2_03_default_send_key | 待生成 |
| 默认值规则 | 6.4/L778 | Tile 默认状态 border=var(--border), opacity=1 | TERM_L2_08_default_tile_style | 待生成 |
| 并发安全规则 | 11.2/L2688 | "AI CLI 工具可能正在写入 JSONL...忽略不以\\n结尾的末尾行...延迟 200ms" | DATA_L2_04_concurrent_jsonl_read | 待生成 |
| 并发安全规则 | 11.1/L2666 | "本地文件已修改，覆盖还是保留本地版本？" 版本冲突 | INSTALL_L2_02_version_conflict | 待生成 |
| 并发安全规则 | 11.1/L2677 | "商城中已有同名 Skill，请更换名称" 名称冲突 | PUBLISH_L2_04_name_conflict | 待生成 |
| 并发安全规则 | 11.1/L2669 | "同步过程中 CC 文件被锁定...跳过该文件，下次同步时重试" | DATA_L2_05_sync_file_locked | 待生成 |

### 扫描统计

| 规则类型 | 扫描关键词 | 命中数 | 生成用例建议数 |
|----------|------------|--------|---------------|
| 部分更新规则 | "保持不变"、"仅更新"、"仅同步"、"仅...生效" | 3 | 3 |
| 多时间点规则 | "每日"、"刷新"、"延迟"、"300ms"、"200ms"、"6小时"、"24小时"、"60秒"、"90天" | 8 | 8 |
| 条件互斥规则 | "不可叠加"、"互斥"、"只能选择" | 0 | 0 |
| 累积上限规则 | "上限"、"最多"、"不超过"、"最大"、"最小"、"限制" | 12 | 12 |
| 状态锁定规则 | "永久"、"不可逆"、"一旦...就"、"不再" | 1 | 1 |
| 默认值规则 | "默认"、"初始"、"首次"、"新建时" | 12 | 12 |
| 循环周期规则 | "循环"、"周期"、"每隔" | 0 | 0 |
| 并发安全规则 | "并发"、"冲突"、"同时"、"被锁定"、"正在写入" | 4 | 4 |

**总计**：40 条特殊规则 -> 40 个专项用例建议

---

## 九、优先级分配

| 优先级 | 含义 | 适用范围 | 预计用例数 |
|--------|------|---------|------------|
| P0 | 核心流程 | 终端管理(A/B/I)、聊天历史(D)、文件预览(G)、富编辑器基础(RE1)、应用启动/关闭、数据同步 | ~100 |
| P1 | 重要功能 | 搜索(E)、三栏视图(H)、配置管理(J)、拖拽排序(C)、归组(M)、安装(O)、聚合浏览(N2)、Hook审查(U)、AI评分(SR)、更新检测(T) | ~140 |
| P2 | 场景测试 | 时间线(F)、分类查看(K/L)、RE2/RE3、展示页(SS)、发布(P2)、社区(SC)、性能、异常处理 | ~114 |

---

## 十、用例编号规范（适配 Muxvo）

**统一格式**：`{模块}_{层级}_{序号}_{简述}`

| 模块代码 | 含义 | 对应功能 |
|---------|------|---------|
| TERM | 终端管理 | A/B/C/I/M |
| EDITOR | 富编辑器覆盖层 | RE1/RE2/RE3 |
| CHAT | 聊天历史 | D/E/F |
| FILE | 文件浏览 | G/H |
| CONFIG | 配置管理 | J/K/L |
| BROWSER | Skill 聚合浏览器 | N2 |
| INSTALL | 安装/卸载/更新 | O/T |
| SECURITY | Hook 安全审查 | U |
| SCORE | AI 评分 | SR |
| SHOWCASE | 展示页 | SS |
| PUBLISH | 发布/分享 | P2 |
| COMMUNITY | 社区平台 | SC |
| APP | 应用生命周期 | 启动/关闭/配置 |
| DATA | 数据同步/存储 | 镜像/监听/索引 |
| ONBOARD | 首次引导 | 8.14 |
| PERF | 性能策略 | 11.2 |
| ERROR | 异常处理 | 11.1 |
| AUTH | 认证授权 | V2-P2 |

**示例**：
| 编号 | 含义 |
|------|------|
| `TERM_L1_01_grid_layout` | 终端管理-L1 契约-Grid 布局规则 |
| `EDITOR_L2_03_mode_switch` | 富编辑器-L2 规则-模式切换 |
| `CHAT_L3_01_full_search_journey` | 聊天历史-L3 场景-完整搜索旅程 |

---

## 十一、待澄清问题

| 序号 | 问题 | PRD 位置 | 状态 |
|------|------|---------|------|
| 1 | Esc 优先级中"Skill 浏览器"优先于"三栏临时视图"，但两者不太可能同时打开，是否存在同时打开的场景？ | 6.3/L737 | 参考已有报告：按 PRD 定义执行 |
| 2 | 终端缓冲区从 10000 行缩减至 1000 行的具体时机是？ | 11.2/L2691 | 参考已有报告：延迟/空闲时执行 |
| 3 | 聚合浏览器部分源加载失败时，PartialReady->Ready 的"失败源重试成功"是自动还是手动？ | 6.14/L1171 | 参考已有报告：自动重试 1 次 |
| 4 | Ctrl+C 穿透到终端时，编辑器内正在编写的内容是否保留？ | 8.16/L2452 | 参考已有报告：保留内容，不清空 |
| 5 | 搜索索引"暂停后下次启动继续"是断点续传还是重新开始？ | 11.2/L2701 | 参考已有报告：断点续传 |
| 6 | "启动时数据清理"（analytics 90 天清理）是否阻塞启动？ | 13.3/L2944 | 参考已有报告：后台执行 |
| 7 | mtime 比较精度为"秒级"，同一秒内修改的两个文件如何处理？ | 8.3.2/L1816 | 待确认 |
| 8 | 评分 Skill 的 promptVersion 存储在哪里？如何检测变更？ | 8.9/L2146 | 待确认 |
| 9 | 展示页"GitHub Pages 需要 1-2 分钟生效"，是轮询检查还是一次性检查？ | 11.3/L2740 | 待确认 |

---

## 十二、特殊规则识别完成确认

- [x] 已使用 Read 工具读取 `特殊规则识别指南.md`
- [x] 已对 PRD 进行 8 次扫描（每种规则类型一次）
- [x] 每种规则类型都记录了扫描结果（命中/未命中）
- [x] 所有命中的规则都有对应用例规划
- [x] 已输出"附录 H：特殊规则识别记录"
- [x] 已列出待澄清问题
- [x] 缺失内容已标记（待确认项 #7-9）

---

## 下一步

输出文件：`docs/Muxvo_测试_v2/01_PRD分析报告.md`

下一步：运行 `/prd-to-test-2-generate` 生成测试用例
