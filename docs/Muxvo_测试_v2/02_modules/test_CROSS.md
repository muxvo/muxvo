# 跨功能模块测试用例（APP + ONBOARD + PERF + ERROR）

## 模块信息

| 项目 | 说明 |
|------|------|
| 覆盖功能 | 应用生命周期、首次使用引导、性能策略、异常处理 |
| PRD 位置 | 6.1、7.2、8.14、11.1、11.2、13.3 |
| 测试层级 | L1（IPC 契约/数据格式）、L2（规则/状态机/边界） |
| 用例总数 | 48 |

---

## 一、APP 模块（应用生命周期）

### 1.1 状态机

```
                    用户启动 Muxvo
[*] ──> Launching ──────────────> Restoring
                                     │
                              ┌──────┴──────┐
                              │             │
                              v             v
                     RestoringTerminals  EmptyState
                     (有上次会话)       (无上次会话)
                              │             │
                              │ 重新打开 shell │ 用户创建第一个终端
                              v             v
                           Running <────────┘
                              │
                              │ 用户关闭窗口
                              v
                           Saving
                              │
                              │ 布局/配置已保存
                              v
                         ShuttingDown
                              │
                              │ 所有子进程已终止
                              v
                            [*]
```

### 1.2 状态机转换路径覆盖表

| # | 转换路径 | 触发条件 | 覆盖用例 |
|---|---------|----------|----------|
| 1 | [*] -> Launching | 用户启动 Muxvo | APP_L1_01 |
| 2 | Launching -> Restoring | 应用窗口创建完毕 | APP_L1_01 |
| 3 | Restoring -> RestoringTerminals | config.openTerminals.length > 0 | APP_L2_03 |
| 4 | Restoring -> EmptyState | config.openTerminals.length === 0 | APP_L2_04 |
| 5 | RestoringTerminals -> Running | 在记录的 cwd 重新打开 shell | APP_L2_03 |
| 6 | EmptyState -> Running | 用户创建第一个终端 | APP_L2_04 |
| 7 | Running -> Saving | 窗口 close 事件 | APP_L2_05 |
| 8 | Saving -> ShuttingDown | 布局/配置已保存 | APP_L2_05 |
| 9 | ShuttingDown -> [*] | 所有子进程 exit 事件 | APP_L2_06 |

**覆盖率：9/9 路径 ✅**

### 1.3 默认配置值验证表

| 配置项 | 默认值 | PRD 位置 | 覆盖用例 |
|--------|--------|---------|----------|
| window.width | 1400 | 7.2 | APP_L2_02 |
| window.height | 900 | 7.2 | APP_L2_02 |
| fontSize | 14 | 7.2 | APP_L2_02 |
| theme | "dark" | 7.2 | APP_L2_02 |
| gridLayout.columnRatios | [1, 1] | 7.2 | APP_L2_02 |
| gridLayout.rowRatios | [1, 1] | 7.2 | APP_L2_02 |
| ftvLeftWidth | 250 | 7.2 | APP_L2_02 |
| ftvRightWidth | 280 | 7.2 | APP_L2_02 |

### 1.4 L1 契约层测试

| 编号 | 用例名 | 输入 | 预期输出 | 优先级 |
|------|--------|------|----------|--------|
| APP_L1_01_get_config | app:get-config IPC 格式验证 | 调用 `app:get-config` | 返回完整 config 结构：`{ window: { width, height, x, y }, openTerminals: [], gridLayout: { columnRatios, rowRatios }, ftvLeftWidth, ftvRightWidth, theme, fontSize }` | P0 |
| APP_L1_02_save_config | app:save-config IPC 格式验证 | 调用 `app:save-config` 传入配置对象 | 返回 `{ success: boolean }`，config.json 文件已更新 | P0 |
| APP_L1_03_get_preferences | app:get-preferences IPC 格式验证 | 调用 `app:get-preferences` | 返回用户偏好设置 | P1 |
| APP_L1_04_save_preferences | app:save-preferences IPC 格式验证 | 调用 `app:save-preferences` 传入偏好对象 | 返回 `{ success: boolean }` | P1 |
| APP_L1_05_memory_warning_push | app:memory-warning push 事件格式 | 内存超过阈值时监听 `app:memory-warning` | 收到 `{ currentMemoryMB: number, threshold: number, message: string }` | P1 |

### 1.5 L2 规则层测试

| 编号 | 用例名 | 前置条件 | 操作步骤 | 预期结果 | 计算过程/验证方式 | 优先级 |
|------|--------|---------|----------|----------|-----------------|--------|
| APP_L2_01_analytics_retention | 数据保留策略验证 | analytics.json 中有超过 90 天的明细事件 | 1. 启动 Muxvo（触发清理） | 明细事件（events 数组）超过 90 天的条目被清理；每日摘要（daily_summary）保留最近 1 年 | 清理时机：app.launch 时执行。events: 90天; daily_summary: 365天 | P2 |
| APP_L2_02_default_config | 首次启动默认配置值 | config.json 不存在（首次启动） | 1. 启动 Muxvo | 创建 config.json，默认值：window 1400x900, fontSize 14, theme dark, columnRatios [1,1], rowRatios [1,1], ftvLeftWidth 250, ftvRightWidth 280 | 验证 8 个默认值（见 1.3 表） | P0 |
| APP_L2_03_restore_with_session | 有上次会话的启动恢复 | config.json 存在，openTerminals 包含 2 个终端记录 | 1. 启动 Muxvo | Restoring -> RestoringTerminals：在记录的 cwd 逐个重新启动新 shell 进程（非恢复旧进程），终端是空白 shell，不恢复旧输出 | openTerminals.length(2) > 0 -> RestoringTerminals 分支 | P0 |
| APP_L2_04_restore_without_session | 无上次会话的启动 | config.json 存在但 openTerminals 为空数组 | 1. 启动 Muxvo | Restoring -> EmptyState：显示空 Grid + 引导提示"按 Cmd+T 新建终端，开始工作" | openTerminals.length(0) === 0 -> EmptyState 分支 | P0 |
| APP_L2_05_save_on_close | 关闭时保存配置 | 应用运行中，有 3 个终端打开 | 1. 点击关闭窗口 | Running -> Saving：序列化当前 Grid 布局、列宽比例、终端列表到 config.json | 保存内容：openTerminals[3] + gridLayout + 窗口位置 | P0 |
| APP_L2_06_shutdown_subprocess | 关闭时子进程退出处理 | 有 3 个终端子进程运行中 | 1. 关闭应用 | ShuttingDown：等待所有子进程 exit 事件后调用 `app.quit()`；超时未退出则强制终止 | 正常：子进程全部 exit -> quit。超时：5s 后强制终止 | P0 |
| APP_L2_07_restore_cwd_missing | 恢复时 cwd 目录不存在 | config.json 中记录的 cwd 路径已被删除 | 1. 启动 Muxvo | 该终端跳过或使用 home 目录替代，显示提示，其他终端正常恢复 | cwd 不存在 -> 异常处理（降级或提示） | P1 |

---

## 二、ONBOARD 模块（首次使用引导）

### 2.1 引导步骤表

| 步骤 | 内容 | 用户操作 | 覆盖用例 |
|------|------|----------|----------|
| 1 | 欢迎页：产品简介 | 点击"开始" | ONBOARD_L2_03 |
| 2 | 检测 AI CLI 工具（claude/codex/gemini） | 自动检测，显示已安装工具列表 | ONBOARD_L2_04 |
| 3 | 创建第一个终端：选择项目目录 | 选择目录 | ONBOARD_L2_05 |
| 4 | 快捷键提示：Cmd+T/双击/Cmd+F/Esc | 点击"知道了"关闭 | ONBOARD_L2_06 |

### 2.2 L1 契约层测试

| 编号 | 用例名 | 输入 | 预期输出 | 优先级 |
|------|--------|------|----------|--------|
| ONBOARD_L1_01_step_format | 引导步骤数据格式 | 读取引导配置 | 返回 `{ steps: Array<{ id: number, title: string, content: string, action: string }>, currentStep: number, completed: boolean }` | P1 |
| ONBOARD_L1_02_cli_detection | CLI 工具检测格式 | 步骤 2 自动检测 | 返回 `{ detectedTools: Array<{ name: string, path: string, version?: string }> }`，扫描 PATH 中的 claude/codex/gemini | P1 |

### 2.3 L2 规则层测试

| 编号 | 用例名 | 前置条件 | 操作步骤 | 预期结果 | 计算过程/验证方式 | 优先级 |
|------|--------|---------|----------|----------|-----------------|--------|
| ONBOARD_L2_01_completed_no_retrigger | 引导完成后不再触发（状态锁定） | 首次引导已完成，onboardingCompleted: true | 1. 再次启动 Muxvo | 不显示引导流程，直接进入正常启动 | onboardingCompleted === true -> 跳过引导 | P0 |
| ONBOARD_L2_02_default_trigger | 首次启动触发引导 | config.json 不存在或 onboardingCompleted 为 false | 1. 启动 Muxvo | 显示引导流程，从步骤 1 开始 | !config 或 config.onboardingCompleted === false -> 触发 | P0 |
| ONBOARD_L2_03_step_1_welcome | 步骤 1 欢迎页 | 引导流程已触发 | 1. 查看欢迎页 2. 点击"开始" | 显示产品简介，点击后进入步骤 2 | step 1 -> step 2 | P1 |
| ONBOARD_L2_04_step_2_detect | 步骤 2 CLI 检测（无工具） | PATH 中无 claude/codex/gemini | 1. 等待检测完成 | 提示"Muxvo 也可以作为普通终端使用" | detectedTools.length === 0 -> 普通终端提示 | P1 |
| ONBOARD_L2_05_step_3_directory | 步骤 3 创建首个终端 | 步骤 2 完成 | 1. 选择一个项目目录 | 在选定目录创建第一个终端 | 引导用户选择 cwd | P1 |
| ONBOARD_L2_06_step_4_shortcuts | 步骤 4 快捷键提示 | 步骤 3 完成 | 1. 查看快捷键 overlay 2. 点击"知道了" | 显示 Cmd+T(新建)/双击(聚焦)/Cmd+F(搜索)/Esc(返回)，点击后关闭 overlay，引导完成 | 完成后标记 onboardingCompleted: true | P0 |
| ONBOARD_L2_07_skip | 跳过引导 | 引导流程中任意步骤 | 1. 点击"跳过" | 跳过后续步骤，直接进入空白主界面，标记 onboardingCompleted: true | 跳过也标记完成，不再触发 | P1 |
| ONBOARD_L2_08_skip_marks_complete | 跳过后再启动不触发 | 上次引导被跳过 | 1. 重新启动 Muxvo | 不再显示引导流程 | 跳过时已设 onboardingCompleted: true | P1 |

---

## 三、PERF 模块（性能策略）

### 3.1 关键性能参数表

| 参数 | 值 | PRD 位置 | 覆盖用例 |
|------|-----|---------|----------|
| 内存检查间隔 | 60 秒 | 11.2/L2693 | PERF_L2_01 |
| 内存警告阈值 | 2GB | 11.2/L2693 | PERF_L2_02 |
| 聚焦终端缓冲区 | 10000 行 | 11.2/L2691 | PERF_L2_03 |
| 非可见终端缓冲区 | 1000 行 | 11.2/L2691 | PERF_L2_03 |
| 搜索去抖 | 300ms | 11.2/L2694 | PERF_L2_05 |
| 市场列表分页 | 每页 20 条 | 11.2/L2695 | PERF_L2_06 |
| 最大终端数 | 20 | 11.2/L2692 | PERF_L2_07 |
| 热门列表缓存 | 1 小时 | 11.2/L2696 | PERF_L2_08 |

### 3.2 L1 契约层测试

| 编号 | 用例名 | 输入 | 预期输出 | 优先级 |
|------|--------|------|----------|--------|
| PERF_L1_01_memory_metrics | 性能指标数据格式 | 查询当前性能数据 | 返回 `{ memoryUsageMB: number, terminalCount: number, bufferLines: { focused: number, background: number[] } }` | P1 |
| PERF_L1_02_memory_warning_format | 内存警告 push 事件格式 | 内存超过阈值 | 收到 `{ currentMemoryMB: number, threshold: 2048, message: "内存占用较高，建议关闭部分终端" }` | P1 |

### 3.3 L2 规则层测试

| 编号 | 用例名 | 前置条件 | 操作步骤 | 预期结果 | 计算过程/验证方式 | 优先级 |
|------|--------|---------|----------|----------|-----------------|--------|
| PERF_L2_01_memory_check_60s | 内存检查间隔 60 秒 | 应用运行中 | 1. 监控内存检查调用频率 | 每 60 秒检查一次 Electron 进程内存占用 | interval = 60 * 1000 ms = 60000ms | P1 |
| PERF_L2_02_memory_warning_2gb | 内存超 2GB 警告 | 内存占用接近 2GB | 1. 模拟内存占用达到 2.1GB | 菜单栏显示黄色警告图标，hover 提示"内存占用较高，建议关闭部分终端" | currentMemory(2.1GB) > threshold(2GB) -> 显示警告 | P1 |
| PERF_L2_03_buffer_limit | 终端缓冲区限制 | 聚焦终端输出大量内容 | 1. 聚焦终端输出超过 10000 行 2. 切换到另一个终端 | 聚焦终端保留 10000 行；切换后原终端缩减至 1000 行；重新聚焦时不恢复已丢弃的行 | 聚焦: maxLines=10000; 非可见: maxLines=1000; 不恢复丢弃行 | P1 |
| PERF_L2_04_virtual_scroll | 虚拟滚动 | 加载 129 个 Plans 的列表 | 1. 打开配置管理器 Plans 列表 | 使用虚拟滚动渲染，仅渲染可视区域内的 DOM 节点 | 列表项数(129) >> 可视区域(~20) -> 虚拟滚动 | P1 |
| PERF_L2_05_search_debounce | 搜索 300ms 去抖 | 搜索面板已打开 | 1. 快速连续输入字符（间隔 100ms） | 仅在最后一次输入后 300ms 发起搜索请求 | debounceTime = 300ms | P1 |
| PERF_L2_06_pagination | 市场列表分页加载 | 市场包列表超过 20 条 | 1. 打开市场列表 2. 滚动到底部 | 初始加载 20 条，滚动到底部加载下一页 20 条 | pageSize = 20; 无限滚动加载 | P2 |
| PERF_L2_07_max_terminal_20 | 最大终端数 20 限制 | 已打开 20 个终端 | 1. 点击"+ 新建终端" | 按钮变灰不可点击，提示"已达最大终端数，请关闭不用的终端" | count(terminals) >= 20 -> 禁用新建按钮 | P1 |
| PERF_L2_08_cache_hot_list | 热门列表缓存 1 小时 | 市场浏览器已打开 | 1. 查看热门列表 2. 关闭浏览器 3. 60 分钟内重新打开 | 第二次打开直接使用缓存数据，不重新请求 | cacheExpiry = 3600 * 1000 ms = 1h | P2 |
| PERF_L2_09_image_lazy_load | 用户头像懒加载 | 包列表有多个包，每个包有作者头像 | 1. 滚动列表 | 仅可见区域的头像才加载，不可见区域的头像不预加载 | IntersectionObserver 或类似机制 | P2 |
| PERF_L2_10_buffer_no_restore | 缓冲区丢弃行不恢复 | 非可见终端已缩减至 1000 行（丢弃了 9000 行） | 1. 重新聚焦该终端 | 缓冲区仍为 1000 行，不恢复已丢弃的 9000 行 | 设计原则：丢弃不可逆，不恢复 | P1 |

---

## 四、ERROR 模块（异常处理）

### 4.1 异常处理分类决策树

```
异常发生
    │
    ├── 可恢复（自动处理）
    │       ├── 下载失败 -> 自动重试 1 次
    │       ├── JSONL 解析错误行 -> 跳过，继续解析
    │       ├── CC 文件被锁定 -> 跳过，下次同步重试
    │       ├── 聚合源部分失败 -> 降级显示可用源
    │       └── CC 聊天记录被清理 -> 自动切换镜像副本
    │
    ├── 需用户操作（提示+按钮）
    │       ├── 进程崩溃 -> "点击重新启动"
    │       ├── 文件读取失败 -> "检查文件权限"
    │       ├── 网络不可用 -> "检查网络" + 离线模式
    │       ├── 安装路径无权限 -> "检查目录权限"
    │       ├── 评分失败（3次） -> "检查网络后重试"
    │       └── 发布安全检查不通过 -> "移除敏感信息"
    │
    └── 阻止操作
            ├── API Key/Token 检测 -> 阻止发布
            ├── 敏感文件检测 -> 阻止发布
            └── 包完整性校验失败 -> 拒绝安装
```

### 4.2 L1 契约层测试

| 编号 | 用例名 | 输入 | 预期输出 | 优先级 |
|------|--------|------|----------|--------|
| ERROR_L1_01_error_format | 统一错误响应格式验证 | 触发任意 IPC 错误 | 返回 `{ code: string, message: string, details?: any }`，code 为机器可读标识，message 为人类可读描述 | P0 |
| ERROR_L1_02_error_codes | 错误码枚举验证 | 列举所有错误码 | 错误码应包含：SPAWN_FAILED, FILE_READ_ERROR, NETWORK_ERROR, INSTALL_FAILED, SCORE_FAILED, AUTH_FAILED, PUBLISH_BLOCKED 等 | P1 |

### 4.3 L2 规则层测试

| 编号 | 用例名 | 前置条件 | 操作步骤 | 预期结果 | 计算过程/验证方式 | 优先级 |
|------|--------|---------|----------|----------|-----------------|--------|
| ERROR_L2_01_spawn_fail | 终端 spawn 失败 | 无效的 cwd 路径 | 1. 新建终端指定不存在的目录 | 状态变为 Failed（红色状态点），提示"进程已断开，点击重新启动 shell"，提供重启按钮 | spawn error -> Failed 状态 | P0 |
| ERROR_L2_02_file_read_fail | 文件读取失败 | 文件权限不足 | 1. 尝试读取无权限的文件 | 显示"无法读取文件，请检查文件权限"，不崩溃 | fs.readFile error -> 提示 | P1 |
| ERROR_L2_03_network_offline | 网络不可用 | 断开网络连接 | 1. 打开 Skill 浏览器 | 显示"无法连接聚合源，请检查网络"；仅展示本地已安装数据（离线模式） | 网络不可用 -> 离线降级 | P0 |
| ERROR_L2_04_install_fail_permission | 安装路径无权限 | `~/.claude/skills/` 无写入权限 | 1. 尝试安装 Skill | 提示"无法写入 ~/.claude/skills/，请检查目录权限" | writeFile error -> 权限提示 | P1 |
| ERROR_L2_05_download_auto_retry | 下载失败自动重试 | 网络不稳定 | 1. 点击安装 2. 首次下载超时 | 自动重试 1 次；成功则继续安装；仍失败则提示"下载失败，请稍后重试" | 重试次数：1 次 | P1 |
| ERROR_L2_06_jsonl_parse_error | JSONL 解析错误行处理 | 某行 JSONL 格式损坏 | 1. 打开聊天历史 | 跳过错误行，继续解析后续行，静默处理不提示用户 | 错误行 -> skip; 下一行 -> 继续解析 | P1 |
| ERROR_L2_07_claude_dir_missing | ~/.claude/ 目录不存在 | 未安装 Claude Code | 1. 启动 Muxvo | 功能降级：聊天历史和配置管理不可用，终端管理正常。提示"未检测到 Claude Code 数据目录" | ~/.claude/ 不存在 -> 部分功能降级 | P0 |
| ERROR_L2_08_score_fail_3_retry | 评分失败最多重试 3 次 | CC 终端运行中 | 1. 触发评分 2. 连续 3 次 API 失败 | 重试 3 次后显示最终错误"评分失败，请检查网络连接后重试" + 手动重试按钮 | retry count: 1->2->3->final error | P1 |
| ERROR_L2_09_score_json_parse | 评分结果 JSON 解析失败 | 评分 Skill 输出格式异常 | 1. 评分 Skill 返回非法 JSON | 自动重新评分 1 次；仍失败则提示"评分结果格式异常，已自动重试" | JSON.parse error -> 重试 1 次 | P1 |
| ERROR_L2_10_cc_not_running | CC 终端未运行时评分 | 无 CC 终端在运行 | 1. 点击"AI 评分" | 提示"请先启动一个 Claude Code 终端" | CC 终端检测失败 -> 阻止评分 | P1 |
| ERROR_L2_11_disk_full | 磁盘空间不足 | 磁盘空间接近用完 | 1. 尝试安装新包 | 提示"磁盘空间不足，建议清理旧的 debug 日志" | diskSpace.free < threshold -> 提示 | P2 |
| ERROR_L2_12_integrity_fail | 包完整性校验失败 | 下载的包文件损坏 | 1. 安装校验不通过的包 | 拒绝安装，提示"文件校验失败，请重新下载" | hash(file) !== expected -> 阻止安装 | P1 |
| ERROR_L2_13_publish_timeout | GitHub Pages 发布超时 | 发布展示页过程中 | 1. 发布请求 30 秒无响应 | 超时后提示重试，保存草稿到本地 | timeout = 30s -> 保存草稿 + 重试提示 | P2 |
| ERROR_L2_14_rate_limit | GitHub API rate limit | 频繁调用 GitHub API | 1. 触发 rate limit | 提示"GitHub API 配额已用完，请稍后再试"，显示配额重置时间 | HTTP 429 -> 显示重置时间 | P2 |

---

## 五、用例统计

| 模块 | L1 用例数 | L2 用例数 | 合计 |
|------|----------|----------|------|
| APP | 5 | 7 | 12 |
| ONBOARD | 2 | 8 | 10 |
| PERF | 2 | 10 | 12 |
| ERROR | 2 | 14 | 16 |
| **总计** | **11** | **39** | **50** |

> 注：实际为 50 个用例，ONBOARD 比计划多 2 个（增加了跳过后确认不再触发、步骤格式化用例），ERROR 减少 2 个（合并了类似场景）。

### 优先级分布

| 优先级 | 数量 | 占比 |
|--------|------|------|
| P0 | 10 | 20% |
| P1 | 29 | 58% |
| P2 | 11 | 22% |

### 特殊规则覆盖确认

| 规则编号 | 规则描述 | 覆盖用例 | 状态 |
|---------|----------|----------|------|
| APP_L2_01_analytics_retention | 明细 90 天 + 摘要 1 年保留 | APP_L2_01 | ✅ |
| APP_L2_02_default_config | 窗口 1400x900, fontSize 14, theme dark | APP_L2_02 | ✅ |
| ONBOARD_L2_01_completed_no_retrigger | 完成后标记 true 不再触发 | ONBOARD_L2_01 | ✅ |
| ONBOARD_L2_02_default_trigger | onboardingCompleted=false 时触发 | ONBOARD_L2_02 | ✅ |
| PERF_L2_01_memory_check_60s | 每 60 秒检查内存 | PERF_L2_01 | ✅ |
| PERF_L2_02_memory_warning_2gb | 超 2GB 显示黄色警告 | PERF_L2_02 | ✅ |
