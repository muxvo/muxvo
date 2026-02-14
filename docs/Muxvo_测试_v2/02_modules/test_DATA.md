# DATA 模块测试用例（数据同步）

## 模块信息
- 覆盖功能：聊天历史镜像同步、JSONL 解析、文件监听、索引构建
- 对应 PRD 章节：6.12（文件监听状态机）、8.3.2（聊天历史同步）、11.2（性能策略/并发读取安全）、11.1（异常处理）
- 预计用例数：14

---

## 1. 状态机图

### 1.1 文件监听状态机（6.12）

> **来源**：PRD 第 6.12 节

```
                           终端创建
  ┌──────────┐  监听 cwd 目录  ┌──────────┐
  │ Inactive ├────────────────>│ Watching │<──────────────┐
  └──────────┘                 └────┬─────┘               │
       ^                            │                     │
       │                            │ fs.watch 错误       │
       │                            │ (权限/路径不存在)    │
       │                            v                     │
       │                       ┌────────────┐   3s 后重试  │
       │                       │ WatchError ├─────────────┘
       │                       └─────┬──────┘  (max 3 次)
       │                             │
       │     终端关闭                 │ 重试失败(3次)
       │     停止监听                 │ 停止监听
       └─────────────────────────────┘

  Watching 自循环:
  ├── 新文件创建 ──> UI 标记 NEW
  ├── 文件修改   ──> UI 刷新
  └── 文件删除   ──> UI 移除
```

### 转换路径覆盖表

| 路径编号 | 起始状态 | 触发条件 | 目标状态 | 测试用例 |
|---------|---------|---------|---------|---------|
| T1 | Inactive | 终端创建 -> 监听 cwd | Watching | DATA_L1_01_start_watch |
| T2 | Watching | 新文件创建 | Watching(UI 标记 NEW) | DATA_L1_02_file_create |
| T3 | Watching | 文件修改 | Watching(UI 刷新) | DATA_L1_03_file_modify |
| T4 | Watching | 文件删除 | Watching(UI 移除) | DATA_L1_04_file_delete |
| T5 | Watching | fs.watch 错误 | WatchError | DATA_L2_03_watch_retry_3s_max3 |
| T6 | WatchError | 3s 后重试成功 | Watching | DATA_L2_03_watch_retry_3s_max3 |
| T7 | WatchError | 重试失败（已达 3 次） | Inactive | DATA_L2_08_retry_exhausted |
| T8 | Watching | 终端关闭 | Inactive | DATA_L1_05_stop_watch |

✅ 8/8 路径已覆盖

---

## 2. L1 契约层测试

### 2.1 同步状态推送格式

| 编号 | 优先级 | 用例名称 | 前置条件 | 操作 | 期望结果 | 计算过程 |
|------|--------|---------|---------|------|---------|---------|
| DATA_L1_01_start_watch | P0 | 文件监听启动 | 终端刚创建 | 终端创建完成 | 开始监听该终端 cwd 目录文件变化；状态 Inactive->Watching | T1 路径；使用 chokidar 监听 |
| DATA_L1_02_file_create | P0 | 新文件创建通知 | Watching 状态 | 在 cwd 下创建新文件 | UI 标记 NEW 标识；推送 `fs:change` 事件 type="add" | T2 路径 |
| DATA_L1_03_file_modify | P0 | 文件修改通知 | Watching 状态 | 修改 cwd 下的文件 | UI 刷新文件列表；推送 `fs:change` 事件 type="change" | T3 路径 |
| DATA_L1_04_file_delete | P0 | 文件删除通知 | Watching 状态 | 删除 cwd 下的文件 | UI 移除该文件条目；推送 `fs:change` 事件 type="unlink" | T4 路径 |
| DATA_L1_05_stop_watch | P0 | 停止监听 | Watching 状态 | 关闭终端 | 停止监听该目录；状态 Watching->Inactive | T8 路径 |

### 2.2 镜像文件存储格式

| 编号 | 优先级 | 用例名称 | 前置条件 | 操作 | 期望结果 | 计算过程 |
|------|--------|---------|---------|------|---------|---------|
| DATA_L1_06_mirror_structure | P0 | 镜像目录结构 | 首次同步完成 | 检查 Muxvo 数据目录 | 目录结构: `chat-history/sync-state.json` + `projects/{project-hash}/project-info.json` + `sessions/{session-id}.jsonl` + `history-index.jsonl` | PRD 3.4: Muxvo 数据目录结构 |
| DATA_L1_07_sync_state_format | P1 | sync-state.json 格式 | 同步执行后 | 读取 sync-state.json | 包含每个项目的最后同步时间和文件 mtime | PRD 8.3.2: "同步状态记录在 sync-state.json" |

---

## 3. L2 规则层测试

### 3.1 同步规则

| 编号 | 优先级 | 用例名称 | 初始状态 | 操作 | 期望结果 | 计算过程 |
|------|--------|---------|---------|------|---------|---------|
| DATA_L2_01_sync_no_delete | P0 | 仅同步不删除 | CC 有 session A/B/C，镜像已同步 A/B/C | CC 侧删除 session B | 镜像中 session B 仍然保留；不随 CC 删除而删除 | PRD 8.3.2/L1817: "仅同步，不删除（CC 侧删了文件，Muxvo 镜像保留）" |
| DATA_L2_06_sync_startup | P0 | 启动时全量扫描 | 应用重新启动 | 启动完成 | 全量扫描 CC 与 Muxvo 镜像，补全缺失的 session | PRD 8.3.2: "Muxvo 启动时：全量扫描" |
| DATA_L2_07_sync_incremental | P0 | 运行中增量同步 | 应用运行中 | CC 新建一个 session | chokidar 检测到变化；增量同步新 session 到镜像 | PRD 8.3.2: "运行中：chokidar 监听...增量同步" |
| DATA_L2_09_sync_background | P1 | 同步不阻塞 UI | 大量文件需要同步 | 启动同步 | 同步在后台执行；UI 保持响应；面板底部显示同步进度 | PRD 8.3.2: "同步为后台任务，不阻塞 UI" |

### 3.2 JSONL 并发读取安全

| 编号 | 优先级 | 用例名称 | 初始状态 | 操作 | 期望结果 | 计算过程 |
|------|--------|---------|---------|------|---------|---------|
| DATA_L2_02_jsonl_read_delay | P0 | 文件变化后延迟 200ms 读取 | chokidar 检测到 JSONL 文件变化 | 等待 | 延迟 200ms 后再读取文件，避免读到写入一半的数据 | PRD 11.2/L2688: "chokidar 检测到文件变化后延迟 200ms 再读取" |
| DATA_L2_04_concurrent_jsonl_read | P0 | 并发读取时忽略不完整行 | AI CLI 工具正在写入 JSONL 文件 | Muxvo 同时读取该文件 | 忽略不以 `\n` 结尾的末尾行；解析失败的行静默跳过；正常行正确解析 | PRD 11.2/L2688: "(1)忽略不以\\n结尾的末尾行 (2)解析失败静默跳过 (3)延迟200ms" |

### 3.3 文件监听重试

| 编号 | 优先级 | 用例名称 | 初始状态 | 操作 | 期望结果 | 计算过程 |
|------|--------|---------|---------|------|---------|---------|
| DATA_L2_03_watch_retry_3s_max3 | P0 | 监听错误 3s 重试最多 3 次 | Watching 状态 | fs.watch 发生错误（如权限变更） | 进入 WatchError；3 秒后自动重试；最多重试 3 次 | PRD 6.12/L1091: "自动重试 (3s interval, max 3 retries)"。重试时间线: 0s 错误 -> 3s 第1次 -> 6s 第2次 -> 9s 第3次 -> 失败 |
| DATA_L2_08_retry_exhausted | P1 | 重试用尽后停止 | WatchError 状态，已重试 3 次均失败 | 第 3 次重试失败 | 状态 WatchError->Inactive；停止监听该目录 | T7 路径：3 次重试后不再重试 |
| DATA_L2_10_retry_success | P1 | 重试成功恢复监听 | WatchError 状态，第 1 次重试 | 3s 后重试成功 | 状态 WatchError->Watching；恢复正常监听 | T6 路径：重试成功即恢复 |

### 3.4 同步冲突处理

| 编号 | 优先级 | 用例名称 | 初始状态 | 操作 | 期望结果 | 计算过程 |
|------|--------|---------|---------|------|---------|---------|
| DATA_L2_05_sync_file_locked | P0 | 文件被锁定时跳过 | 同步进行中 | CC 文件被其他进程锁定 | 跳过该文件，无错误提示（静默重试）；下次同步时重试 | PRD 11.1/L2669: "同步过程中 CC 文件被锁定...跳过该文件，下次同步时重试" |
| DATA_L2_11_mirror_permission | P1 | 镜像目录权限不足 | Muxvo 数据目录权限被修改 | 尝试同步写入 | 降级为纯只读模式（仅读 CC 原始文件，不同步）；显示"无法写入数据目录，历史备份已暂停" | PRD 11.1/L2668: 降级处理 |

### 3.5 监听范围

| 编号 | 优先级 | 用例名称 | 初始状态 | 操作 | 期望结果 | 计算过程 |
|------|--------|---------|---------|------|---------|---------|
| DATA_L2_12_watch_scope | P1 | 三类监听范围 | 应用启动，终端创建 | 检查监听范围 | 监听 3 类: (1) 项目文件目录变化 (2) session JSONL 文件更新 (3) `~/.claude/` 资源变化 | PRD 6.12 note: "使用 chokidar 监听" + 三类范围 |

---

## 4. 用例统计

| 层级 | 用例数 |
|------|--------|
| L1 契约层 | 7 |
| L2 规则层 | 12 |
| **总计** | **19** |

> 注：实际用例数（19）超出原预估（14）是因为状态机路径覆盖分析和异常处理场景识别了更多必要的测试点。

### 优先级分布

| 优先级 | 用例数 |
|--------|--------|
| P0 | 12 |
| P1 | 6 |
| P2 | 1 |

### 特殊规则覆盖确认（附录 H）

| 规则编号 | 规则描述 | 对应用例 | 状态 |
|---------|---------|---------|------|
| DATA_L2_01_sync_no_delete | 仅同步不删除 | DATA_L2_01_sync_no_delete | ✅ 已覆盖 |
| DATA_L2_02_jsonl_read_delay | 200ms 延迟读取 | DATA_L2_02_jsonl_read_delay | ✅ 已覆盖 |
| DATA_L2_03_watch_retry_3s_max3 | 3s 重试最多 3 次 | DATA_L2_03_watch_retry_3s_max3 | ✅ 已覆盖 |
| DATA_L2_04_concurrent_jsonl_read | 并发读取安全 | DATA_L2_04_concurrent_jsonl_read | ✅ 已覆盖 |
| DATA_L2_05_sync_file_locked | 文件锁定跳过 | DATA_L2_05_sync_file_locked | ✅ 已覆盖 |
