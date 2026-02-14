# CHAT 模块测试用例（聊天历史）

## 模块信息
- 覆盖功能：D（聊天历史浏览器）/ E（全文搜索）/ F（会话时间线）
- 对应 PRD 章节：6.10（聊天历史面板状态机）、8.3（聊天历史浏览器）、11.2（性能策略）
- 预计用例数：42

---

## 1. 状态机图

### 1.1 聊天历史面板状态机（6.10）

> **来源**：PRD 第 6.10 节

```
                        ┌──────────────────────────────────────────────┐
                        │                                              │
  ┌────────┐  ⌘F/按钮  ┌─────────┐  加载完成  ┌───────┐              │
  │ Closed ├──────────>│ Loading ├──────────>│ Ready │              │
  └────────┘           └────┬────┘           └───┬───┘              │
       ^                    │                    │                   │
       │                    │ 读取失败           ├─ 输入搜索词(300ms) │
       │                ┌───v───┐               v                   │
       │                │ Error │          ┌──────────┐             │
       │                └───┬───┘          │Searching │             │
       │                    │              └─────┬────┘             │
       │               用户关闭        有结果│     │无结果            │
       │                    │       ┌────────v┐  ┌v───────────┐     │
       │                    │       │HasResult│  │ NoResults  │     │
       │                    │       └─────────┘  └────────────┘     │
       │                    │              │          │              │
       │                    │         清空搜索框  清空搜索框          │
       │                    │              └─────┬────┘              │
       │                    │                    v                   │
       │                    │              EmptySearch               │
       │                    │                                       │
       │              点击会话卡片                                    │
       │           ┌───────────────┐                                │
       │           │ SessionDetail │                                │
       │           └──────┬────────┘                                │
       │      返回列表│        │双击跳转终端                          │
       │              v        v                                    │
       │           Ready     Closed ────────────────────────────────┘
       │                       │
       └───────────────────────┘
```

### 转换路径覆盖表

| 路径编号 | 起始状态 | 触发条件 | 目标状态 | 测试用例 |
|---------|---------|---------|---------|---------|
| T1 | Closed | ⌘F / 点击「历史聊天」按钮 | Loading | CHAT_L1_01_open_panel |
| T2 | Loading | history.jsonl 索引加载完成 | Ready(EmptySearch) | CHAT_L1_01_open_panel |
| T3 | Loading | 文件读取失败 | Error | CHAT_L1_04_load_error |
| T4 | EmptySearch | 用户输入搜索词（300ms 去抖） | Searching | CHAT_L2_01_search_debounce_300ms |
| T5 | Searching | 找到匹配会话 | HasResults | CHAT_L1_10_search_has_results |
| T6 | Searching | 无匹配结果 | NoResults | CHAT_L1_11_search_no_results |
| T7 | HasResults | 修改搜索词 | Searching | CHAT_L1_12_modify_search |
| T8 | NoResults | 修改搜索词 | Searching | CHAT_L1_12_modify_search |
| T9 | HasResults | 清空搜索框 | EmptySearch | CHAT_L1_13_clear_search |
| T10 | NoResults | 清空搜索框 | EmptySearch | CHAT_L1_13_clear_search |
| T11 | Ready | 点击某条会话 | SessionDetail | CHAT_L1_07_view_session |
| T12 | SessionDetail | 点击「返回」 | Ready | CHAT_L1_08_back_to_list |
| T13 | SessionDetail | 双击会话 -> 跳转终端 | Closed | CHAT_L1_09_dblclick_jump |
| T14 | Ready | Esc / 点击关闭 | Closed | CHAT_L1_14_close_panel |
| T15 | Error | 用户关闭错误提示 | Closed | CHAT_L1_04_load_error |

✅ 15/15 路径已覆盖

---

## 2. L1 契约层测试

### 2.1 IPC 通道格式验证

| 编号 | 优先级 | 用例名称 | 前置条件 | 操作 | 期望结果 | 计算过程 |
|------|--------|---------|---------|------|---------|---------|
| CHAT_L1_01_open_panel | P0 | chat:get-history IPC 格式 | 应用已启动，聊天历史面板关闭 | 调用 `chat:get-history` | 返回 `{ sessions: Array<{display, timestamp, project, sessionId}> }`；状态 Closed->Loading->Ready | IPC 通道名 = "chat:get-history"，返回值为 session 摘要数组 |
| CHAT_L1_02_get_session | P0 | chat:get-session IPC 格式 | 已知有效 sessionId | 调用 `chat:get-session({ sessionId })` | 返回 `{ messages: Array<{type, message, timestamp, cwd}> }` | 传入 sessionId，返回该 session 的完整消息列表 |
| CHAT_L1_03_search | P0 | chat:search IPC 格式 | 搜索索引已建立 | 调用 `chat:search({ query: "test" })` | 返回 `{ results: Array<{sessionId, matches, context}> }` | query 为搜索关键词，返回匹配的 session 列表及上下文片段 |
| CHAT_L1_04_load_error | P1 | chat:get-history 错误响应 | CC 文件和镜像均不可用 | 调用 `chat:get-history` | 返回 `{ code: "FILE_NOT_FOUND", message: string }` 统一错误格式 | 符合 PRD 统一错误响应格式 `{ code, message, details? }` |
| CHAT_L1_05_export | P1 | chat:export IPC 格式 | 已选中某 session | 调用 `chat:export({ sessionId, format: "md" })` | 返回导出文件路径或数据 | 支持导出为 Markdown 格式 |
| CHAT_L1_06_session_update_push | P0 | chat:session-update 推送格式 | 后台同步检测到新 session | 监听 `chat:session-update` 推送 | 推送数据包含 `{ sessionId, action: "added"|"updated", data }` | push 类型通道，Renderer 被动接收 |
| CHAT_L1_07_sync_status_push | P1 | chat:sync-status 推送格式 | 后台同步执行中 | 监听 `chat:sync-status` 推送 | 推送数据包含 `{ status: "syncing"|"done"|"error", lastSync, progress? }` | push 类型通道，通知同步状态变化 |

### 2.2 默认值与初始状态

| 编号 | 优先级 | 用例名称 | 前置条件 | 操作 | 期望结果 | 计算过程 |
|------|--------|---------|---------|------|---------|---------|
| CHAT_L1_08_default_all_projects | P0 | 默认选中「全部项目」 | 首次打开聊天历史面板 | 打开面板 | 左栏「全部项目」选项默认选中高亮；中栏显示所有会话 | PRD 8.3.3/L1842: "「全部项目」选项（默认选中）" |
| CHAT_L1_09_layout_default | P0 | 三栏默认布局 | 首次打开聊天历史面板 | 观察布局 | 左栏 220px 项目列表；中栏 340px 会话卡片；右栏 flex 会话详情 | PRD 8.3.3 表格定义的默认宽度 |
| CHAT_L1_10_session_card_fields | P1 | 会话卡片默认字段 | 有正常会话数据 | 观察会话卡片 | 显示：标题、时间（今天HH:MM/昨天/MM-DD）、预览（2行截断）、标签、tool calls 数 | PRD 8.3.3 中栏会话卡片字段定义 |
| CHAT_L1_11_message_render | P1 | 会话详情消息渲染 | 选中某会话 | 查看右栏详情 | user 消息右侧气泡（accent 背景），assistant 消息左侧气泡（elevated 背景），代码块有语法高亮+复制按钮 | PRD 8.3.3 右栏渲染规则 |
| CHAT_L1_12_tool_call_fold | P1 | 工具调用默认折叠 | 会话详情含工具调用 | 查看右栏 | 工具调用蓝色左边框，默认折叠；工具结果绿色左边框，默认折叠；点击展开 | PRD 8.3.3 工具调用渲染规则 |
| CHAT_L1_13_sync_status_ui | P1 | 同步状态 UI 显示 | 面板已打开 | 观察面板底部 | 显示「Muxvo 镜像 · 最后同步 HH:MM」；同步中显示旋转图标 | PRD 8.3.2 同步状态 UI |
| CHAT_L1_14_empty_state_no_cc | P1 | 空状态 - 未检测到 CC | `~/.claude/` 目录不存在 | 打开聊天历史面板 | 显示"未检测到 Claude Code 聊天记录..."文案 + 对话气泡图标 + [了解 Claude Code] 按钮 | PRD 11.3 缺省态规范 |
| CHAT_L1_15_empty_state_no_history | P2 | 空状态 - CC 已装但无记录 | `~/.claude/` 存在但 history.jsonl 为空 | 打开面板 | 显示"还没有聊天记录..."文案 | PRD 11.3 缺省态规范 |

### 2.3 三栏联动交互

| 编号 | 优先级 | 用例名称 | 前置条件 | 操作 | 期望结果 | 计算过程 |
|------|--------|---------|---------|------|---------|---------|
| CHAT_L1_16_select_project | P0 | 选择项目过滤会话 | 有多个项目 | 左栏点击某项目 | 中栏仅显示该项目会话；右栏清空 | 左栏选择项目 -> 中栏过滤显示 |
| CHAT_L1_17_click_session | P0 | 点击会话加载详情 | 中栏有会话卡片 | 点击某会话卡片 | 右栏加载并显示完整对话（气泡式） | T11 路径覆盖 |
| CHAT_L1_18_dblclick_jump | P0 | 双击会话跳转终端 | 对应项目终端已打开 | 双击会话卡片 | 关闭聊天历史面板；跳转到对应终端 | T13 路径覆盖 |
| CHAT_L1_19_back_to_list | P1 | 从详情返回列表 | SessionDetail 状态 | 点击「返回」 | 回到 Ready 状态，保持之前的项目筛选 | T12 路径覆盖 |

---

## 3. L2 规则层测试

### 3.1 双源读取规则（决策树式）

> **来源**：PRD 8.3.1

```
CC 原始文件检查
├── 存在且可读 ──> 读取 CC 原始文件（主源）
│                   └── 读取成功 ──> 返回数据
│                   └── 读取失败 ──> 切换到镜像
└── 不存在或不可读 ──> 读取 Muxvo 镜像副本（备源）
                        └── 镜像存在 ──> 返回数据（用户无感知）
                        └── 镜像不存在 ──> Error 状态
```

| 编号 | 优先级 | 用例名称 | 初始状态 | 操作 | 期望结果 | 计算过程 |
|------|--------|---------|---------|------|---------|---------|
| CHAT_L2_06_primary_source | P0 | 主源读取成功 | CC `~/.claude/history.jsonl` 存在且可读 | 打开聊天历史 | 读取 CC 原始文件，数据正确显示 | 优先级逻辑：CC 存在 -> 读 CC |
| CHAT_L2_07_fallback_mirror | P0 | 自动切换到镜像 | CC 原始文件不存在（已被删除） | 打开聊天历史 | 自动切换读取 Muxvo 镜像；数据正常显示；用户无感知 | CC 不存在 -> 切换 Muxvo 镜像 |
| CHAT_L2_08_fallback_permission | P0 | 权限不足时切换 | CC 文件存在但权限不足（chmod 000） | 打开聊天历史 | 自动切换到镜像副本；不显示错误提示 | CC 不可读 -> 与不存在同处理 |
| CHAT_L2_09_both_unavailable | P1 | 主备源均不可用 | CC 文件不存在 + Muxvo 镜像不存在 | 打开聊天历史 | 进入 Error 状态；显示友好错误提示 | 双源均失败 -> Error |
| CHAT_L2_10_mirror_hint | P2 | 镜像数据提示 | 数据来自 Muxvo 镜像 | 查看面板 | 可选显示提示「部分历史记录来自本地备份」 | PRD 8.3.2 同步状态 UI |

### 3.2 JSONL 解析规则

| 编号 | 优先级 | 用例名称 | 初始状态 | 操作 | 期望结果 | 计算过程 |
|------|--------|---------|---------|------|---------|---------|
| CHAT_L2_11_skip_bad_line | P0 | 格式错误行跳过 | history.jsonl 中第 3、7 行为非法 JSON | 加载聊天历史 | 第 3、7 行被跳过；其余行正常解析 | PRD 8.3.1: "遇到格式错误的行：跳过该行，继续解析（静默处理）" |
| CHAT_L2_12_ignore_incomplete_tail | P0 | 忽略不完整末尾行 | history.jsonl 末尾行不以 `\n` 结尾（如 `{"display":"te`） | 加载聊天历史 | 忽略该末尾行；其余行正常解析 | PRD 11.2: "忽略不以 \\n 结尾的末尾行（可能是写入中的不完整 JSON）" |
| CHAT_L2_13_stream_parse | P1 | 逐行流式读取 | 大 session JSONL 文件（10MB） | 打开 session 详情 | 逐行流式读取，不一次性加载整个文件 | PRD 8.3.1: "每行独立 JSON，逐行流式读取" |
| CHAT_L2_14_unknown_fields | P1 | 未知字段兼容 | JSONL 行含 CC 新增的未知字段 | 加载聊天历史 | 未知字段忽略（向前兼容），已知字段正常解析 | PRD 3.3: "遇到未知字段：忽略（向前兼容）" |

### 3.3 搜索规则

| 编号 | 优先级 | 用例名称 | 初始状态 | 操作 | 期望结果 | 计算过程 |
|------|--------|---------|---------|------|---------|---------|
| CHAT_L2_01_search_debounce_300ms | P0 | 搜索 300ms 去抖 | 聊天历史面板 Ready 状态 | 连续快速输入"t""te""tes""test"（间隔<300ms） | 仅最后一次输入"test"触发搜索请求；前 3 次输入不触发 | PRD 6.10/L1005: "300ms 去抖"。输入间隔 < 300ms 时，每次输入重置 timer，仅最后一次超过 300ms 静止后触发 |
| CHAT_L2_15_search_index_build | P0 | 倒排索引构建 | 首次启动，无持久化索引 | 启动应用 | 后台 Web Worker 建立倒排索引；显示进度条"正在建立搜索索引... N%"；渐进式可用 | PRD 11.2/L2701: 后台构建，不阻塞 UI |
| CHAT_L2_16_search_index_persist | P1 | 索引持久化 | 索引已建立 | 关闭应用再重新打开 | 索引从 `search-index/` 加载，无需重建；搜索立即可用 | PRD 8.3.4: "索引存储在...（持久化，下次启动直接加载）" |
| CHAT_L2_17_search_incremental | P1 | 增量更新索引 | 索引已建立；新 session 写入 | chokidar 检测到 JSONL 变化 | 增量更新索引（仅索引新增内容），不重建全部 | PRD 8.3.4: "chokidar 监听 JSONL 文件变化，增量更新索引" |
| CHAT_L2_18_search_highlight | P1 | 搜索结果高亮 | 搜索词 "error" | 执行搜索 | 匹配关键词高亮显示；每条结果显示：上下文片段（前后各 50 字符）+ 项目 + 时间 | PRD 8.3.4 搜索交互规则 |
| CHAT_L2_19_search_empty_no_results | P2 | 搜索无结果文案 | 搜索索引已建立 | 输入无匹配的关键词 | 显示"没有找到匹配的记录，试试其他关键词" + 搜索图标 + [清除搜索] 按钮 | PRD 11.3 缺省态规范 |

### 3.4 大文件保护与索引超时

| 编号 | 优先级 | 用例名称 | 初始状态 | 操作 | 期望结果 | 计算过程 |
|------|--------|---------|---------|------|---------|---------|
| CHAT_L2_02_large_file_protection | P0 | 大文件保护 >100MB | 存在单个 session JSONL > 100MB | 建立搜索索引 | 该文件仅索引最近 6 个月的记录，不索引全部 | PRD 8.3.4/L1879: "单个 JSONL > 100MB 时，仅索引最近 6 个月"。阈值 = 100MB，策略 = 按 timestamp 过滤 |
| CHAT_L2_04_index_timeout | P0 | 索引超时保护 | 大量 JSONL 文件 | 建立搜索索引 | 单文件索引 >30s 则跳过该文件；总构建 >5min 则暂停，下次启动继续 | PRD 11.2/L2701: "单个文件索引超过 30 秒则跳过。总构建超过 5 分钟则暂停" |
| CHAT_L2_20_index_resume | P1 | 索引断点续传 | 上次索引构建因 5min 超时暂停 | 重新启动应用 | 从断点处继续构建索引，不从头开始 | 分析报告待确认 #5: 断点续传 |
| CHAT_L2_21_index_progress | P1 | 索引构建中搜索 | 索引正在构建（完成 50%） | 输入搜索词 | 已索引的文件可搜索；未索引的不可搜索；显示"索引构建中"提示 | PRD 11.2/L2701: "渐进式可用：已索引的文件立即可搜索" |

### 3.5 三栏布局约束

| 编号 | 优先级 | 用例名称 | 初始状态 | 操作 | 期望结果 | 计算过程 |
|------|--------|---------|---------|------|---------|---------|
| CHAT_L2_03_layout_min_widths | P0 | 三栏最小宽度约束 | 聊天历史面板已打开 | 拖拽缩小各栏宽度 | 左栏不小于 180px；中栏不小于 280px；右栏不小于 400px | PRD 8.3.3/L1839: "左栏最小宽度 180px，中栏最小宽度 280px，右栏最小宽度 400px" |
| CHAT_L2_22_layout_collapse | P0 | 窗口不足时左栏收起 | 窗口宽度缩小至无法容纳三栏最小值 | 缩小窗口 | 左栏收起为图标模式（60px） | PRD 8.3.3/L1839: "窗口宽度不足时，左栏可收起为图标模式（60px）"。阈值 = 180+280+400=860px |
| CHAT_L2_23_layout_restore | P1 | 窗口恢复时左栏展开 | 左栏已收起为 60px | 放大窗口宽度超过阈值 | 左栏恢复为正常宽度（220px） | 窗口宽度充足时恢复 |

### 3.6 mtime 同步规则

| 编号 | 优先级 | 用例名称 | 初始状态 | 操作 | 期望结果 | 计算过程 |
|------|--------|---------|---------|------|---------|---------|
| CHAT_L2_24_mtime_second_precision | P0 | mtime 秒级精度 | CC 文件 mtimeMs=1700000000123，镜像 mtimeMs=1700000000456 | 同步检查 | 两个 mtime 相等（`Math.floor(123/1000)==Math.floor(456/1000)==1700000000`），不触发同步 | PRD 8.3.2/L1816: "mtime 比较精度为秒级（`Math.floor(mtimeMs / 1000)`）" |
| CHAT_L2_25_mtime_different | P0 | mtime 不同触发同步 | CC mtimeMs=1700001000000，镜像 mtimeMs=1700000000000 | 同步检查 | `Math.floor(1700001000000/1000)=1700001000 != 1700000000`，触发同步覆盖镜像 | 秒级比较不同 -> 需要更新 |
| CHAT_L2_26_dedup_session_id | P1 | 按 sessionId 去重 | CC 有 session A、B，镜像已有 A | 同步 | 仅同步 B，不重复写入 A（除非 mtime 更新） | PRD 8.3.2: "按 sessionId 去重" |

### 3.7 特殊规则用例（附录 H）

| 编号 | 优先级 | 用例名称 | 初始状态 | 操作 | 期望结果 | 计算过程 |
|------|--------|---------|---------|------|---------|---------|
| CHAT_L2_05_default_all_projects | P0 | 默认选中全部项目 | 首次打开聊天历史面板 | 打开面板 | 「全部项目」默认选中；显示总会话数；中栏显示所有项目的会话 | PRD 8.3.3/L1842: "「全部项目」选项（默认选中），显示总会话数" |

### 3.8 性能策略

| 编号 | 优先级 | 用例名称 | 初始状态 | 操作 | 期望结果 | 计算过程 |
|------|--------|---------|---------|------|---------|---------|
| CHAT_L2_27_lazy_load | P1 | 延迟加载 | 应用已启动，未打开历史面板 | 检查内存/IO | 不预加载 history.jsonl；仅在打开面板时加载 | PRD 8.3.6: "仅在打开历史面板时加载 history.jsonl" |
| CHAT_L2_28_virtual_scroll | P1 | 虚拟滚动 | 会话列表 > 50 条 | 滚动会话列表 | 使用虚拟滚动渲染，DOM 中仅渲染可见区域 | PRD 8.3.6: "会话列表超过 50 条时使用虚拟滚动" |
| CHAT_L2_29_paged_detail | P1 | 分页加载详情 | 会话消息数 > 50 条 | 打开会话详情 | 首次加载 50 条消息；滚动到顶部加载更多 | PRD 8.3.6: "每次加载 50 条消息，滚动到顶部加载更多" |
| CHAT_L2_30_sync_throttle | P2 | 镜像同步节流 | 多个 JSONL 文件短时间内变化 | 触发同步 | 批量合并同步操作，避免频繁 IO | PRD 8.3.6: "批量文件变化时合并同步操作" |

### 3.9 快捷键

| 编号 | 优先级 | 用例名称 | 初始状态 | 操作 | 期望结果 | 计算过程 |
|------|--------|---------|---------|------|---------|---------|
| CHAT_L2_31_shortcut_open | P0 | ⌘F 打开搜索 | 聊天历史面板关闭 | 按 ⌘F | 打开聊天历史面板，焦点在搜索框 | PRD 8.3.4: "⌘F 打开搜索" |
| CHAT_L2_32_shortcut_esc | P0 | Esc 关闭面板 | 聊天历史面板已打开 | 按 Esc | 关闭面板，返回终端 | PRD 8.3.4: "Esc 关闭" |
| CHAT_L2_33_shortcut_arrows | P1 | 上下箭头切换结果 | 搜索有结果 | 按 ↑↓ | 切换选中的搜索结果 | PRD 8.3.4: "↑↓ 切换结果" |
| CHAT_L2_34_shortcut_enter | P1 | Enter 打开会话 | 搜索结果中选中某条 | 按 Enter | 打开该会话的详情 | PRD 8.3.4: "Enter 打开会话" |

---

## 4. 用例统计

| 层级 | 用例数 |
|------|--------|
| L1 契约层 | 19 |
| L2 规则层 | 23 |
| **总计** | **42** |

### 优先级分布

| 优先级 | 用例数 |
|--------|--------|
| P0 | 20 |
| P1 | 16 |
| P2 | 6 |
