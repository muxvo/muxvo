# Muxvo PRD 分析报告

## 分析信息
- PRD 版本：V2.0
- 分析日期：2026-02-14
- PRD 文件：`PRD.md`（3064 行）
- 分析依据：prd-to-test-1-analyze Skill + 特殊规则识别指南 v1.0

---

## 一、PRD 完整性检查

| 检查项 | 状态 | 备注 |
|--------|------|------|
| API 定义 | ⚠️ | 桌面 Electron 应用，无 REST API。IPC 协议在 DEV-PLAN 中定义（10个域 50+ 通道），PRD 仅描述功能行为 |
| 数据模型 | ✅ | 第7节定义了9种数据结构（CC数据、配置、包、评价、注册表、评分、展示页等） |
| 业务规则 | ✅ | 第8节详细说明了16个功能模块的交互规则 |
| 错误处理 | ✅ | 11.1节定义了30+种异常场景及处理方式 |
| 状态定义 | ✅ | 第6节定义了18个状态机（应用、终端、视图、面板、安装、评分等） |
| 性能策略 | ✅ | 11.2节定义了15项性能策略 |
| 缺省态 | ✅ | 11.3节定义了20+种空状态文案 |

**结论**：PRD 非常完备。主要注意点是该项目为 Electron 桌面应用，测试重点是 **状态机转换**、**UI 交互**、**文件系统操作**、**IPC 通信**，而非传统的 API 契约测试。

---

## 二、功能清单摘要

### V1 — 终端工作台（17个功能）

| 功能 | 描述 | 优先级 | 测试模块 | 预计用例数 |
|------|------|--------|----------|------------|
| A | 全屏平铺式终端管理 | V1-P0 | TERM | 15 |
| B | 聚焦模式 | V1-P0 | TERM | 10 |
| D | 聊天历史浏览器 | V1-P0 | CHAT | 20 |
| G | 内置 Markdown 预览 | V1-P0 | FILE | 10 |
| I | 双段式命名 | V1-P0 | TERM | 8 |
| C | 终端拖拽排序 + 边框调整 | V1-P1 | TERM | 12 |
| E | 全文搜索 | V1-P1 | CHAT | 12 |
| H | 文件浏览器 + 三栏临时视图 | V1-P1 | FILE | 15 |
| J | ~/.claude/ 可视化浏览器 | V1-P1 | CONFIG | 10 |
| M | 同目录终端自动归组 | V1-P1 | TERM | 6 |
| RE1 | 富编辑器覆盖层（基础） | V1-P1 | EDITOR | 18 |
| F | 会话时间线视图 | V1-P2 | CHAT | 6 |
| K | Plans/Skills/Hooks/Tasks 分类查看 | V1-P2 | CONFIG | 8 |
| L | Settings/CLAUDE.md 查看与编辑 | V1-P2 | CONFIG | 8 |
| RE2 | 富编辑器覆盖层（完善） | V1-P2 | EDITOR | 12 |

### V2 — Skill Showcase 平台（9个功能）

| 功能 | 描述 | 优先级 | 测试模块 | 预计用例数 |
|------|------|--------|----------|------------|
| N2 | Skill 聚合浏览器 | V2-P0 | BROWSER | 15 |
| O | 一键安装 | V2-P0 | INSTALL | 12 |
| U | Hook 安全审查 | V2-P0 | SECURITY | 8 |
| T | 更新检测与推送 | V2-P1 | INSTALL | 8 |
| SR | AI Skill 评分 | V2-P1 | SCORE | 15 |
| RE3 | 富编辑器覆盖层（高级） | V2-P2 | EDITOR | 8 |
| SS | Skill Showcase 展示页 | V2-P2 | SHOWCASE | 12 |
| P2 | Skill 发布/分享 | V2-P2 | PUBLISH | 15 |
| SC | Showcase 社区平台 | V2-P3 | COMMUNITY | 10 |

### 跨功能模块

| 模块 | 描述 | 预计用例数 |
|------|------|------------|
| APP | 应用生命周期（启动/关闭/配置恢复） | 10 |
| DATA | 数据同步（聊天历史镜像、文件监听） | 12 |
| ONBOARD | 首次使用引导 | 6 |
| PERF | 性能策略（缓冲区限制、虚拟滚动、去抖等） | 10 |
| ERROR | 异常处理（降级、重试、提示） | 15 |

**总计预估**：约 **310 个测试用例**

---

## 三、状态机图

PRD 第6节定义了18个状态机，以下提取测试价值最高的关键状态机：

### 3.1 应用生命周期（6.1）

```
[*] → Launching → Restoring → {RestoringTerminals | EmptyState} → Running → Saving → ShuttingDown → [*]
```

**关键转换条件**：
- Restoring → RestoringTerminals: `config.openTerminals.length > 0`
- Restoring → EmptyState: `config.openTerminals.length === 0`
- Running → Saving: 窗口 close 事件
- ShuttingDown → [*]: 所有子进程 exit

### 3.2 终端进程生命周期（6.2）

```
[*] → Created → Starting → {Running | Failed}
Running → {Busy | WaitingInput | Stopping | Disconnected}
Busy → Running
WaitingInput → Running
Stopping → {Stopped | Disconnected}
Disconnected → {Starting | Removed}
Stopped → Removed → [*]
```

**关键状态 UI 映射**：
| 状态 | 状态点颜色 | 动画 | 输入栏 |
|------|-----------|------|--------|
| Starting | 黄色 | 闪烁 | 禁用 |
| Running | 绿色 | 呼吸脉冲 | 可用 |
| Busy | 绿色 | 快速脉冲 | 显示"处理中..." |
| WaitingInput | 琥珀色 | 呼吸脉冲 | 可用+选项 |
| Disconnected | 红色 | 无 | 禁用 |

### 3.3 视图模式（6.3）

```
[*] → Tiling ←→ Focused（双击/Esc）
Tiling → FilePanel → TempView
Focused → FilePanel → TempView
TempView → Tiling（Esc）
```

**Esc 键优先级（7级，仅 UI 层焦点时生效）**：
1. 安全审查对话框 → 2. 文件夹选择器 → 3. Skill 浏览器 → 4. 三栏临时视图 → 5. 文件面板 → 6. 聚焦模式 → 7. 平铺模式（无操作）

### 3.4 富编辑器覆盖层（6.13）

```
[*] → RichEditor（默认）
RichEditor 内部: Idle → Composing → {ImageAttaching → Composing | Sending → Idle}
RichEditor ←→ RawTerminal（Alternate Screen Buffer 信号 / 手动切换）
```

**模式切换触发**：
- 进入 RawTerminal: `\x1b[?1049h` 或手动快捷键
- 恢复 RichEditor: `\x1b[?1049l` 或手动快捷键

### 3.5 包安装状态（6.15）

```
[*] → NotInstalled → Downloading → {SecurityReview(Hook) | Installing(Skill)}
SecurityReview → {Installing | NotInstalled(取消)}
Installing → {Installed | InstallFailed}
Installed → {UpdateAvailable | Uninstalling}
UpdateAvailable → {Downloading | Uninstalling}
Uninstalling → NotInstalled
```

### 3.6 AI 评分状态（6.16）

```
[*] → NotScored → Scoring → {Scored | ScoreFailed}
ScoreFailed → {Scoring(重试) | NotScored(取消)}
Scored → {Scoring(内容变更) | GeneratingShowcase}
```

### 3.7 Showcase 展示页生命周期（6.18）

```
[*] → NotGenerated → Generating → {Previewing | GenerateFailed}
Previewing ←→ Editing
Previewing → Publishing → {Published | PublishFailed}
Published → {Updating → Published | Unpublished}
Unpublished → {Publishing | NotGenerated}
```

---

## 四、附录 H：特殊规则识别记录

### 扫描执行信息
- 扫描日期：2026-02-14
- PRD 版本：V2.0
- 扫描依据：特殊规则识别指南 v1.0

### 识别结果

| 规则类型 | PRD 位置 | 原文摘录 | 生成用例建议 | 状态 |
|----------|---------|----------|------------|------|
| 部分更新规则 | 3.4节 L1817 | "仅同步，不删除（CC 侧删了文件，Muxvo 镜像保留）" | DATA_L2_01_sync_no_delete | 📝 待生成 |
| 部分更新规则 | 6.9节 L985 | "仅平铺模式生效，聚焦模式下不触发" | TERM_L2_02_resize_only_tiling | 📝 待生成 |
| 多时间点规则 | 8.11节 L2277 | "每 6 小时自动检测一次" 更新检测 | INSTALL_L2_01_update_check_interval | 📝 待生成 |
| 多时间点规则 | 11.2节 L2688 | "chokidar 检测到文件变化后延迟 200ms 再读取" | DATA_L2_02_jsonl_read_delay | 📝 待生成 |
| 多时间点规则 | 6.10节 L1005 | "300ms 去抖" 搜索输入 | CHAT_L2_01_search_debounce | 📝 待生成 |
| 多时间点规则 | 8.16节 L2436 | "临时文件清理：终端关闭时删除、或 24 小时后自动清理" | EDITOR_L2_01_temp_image_cleanup | 📝 待生成 |
| 多时间点规则 | 13.3节 L2942 | "明细事件保留最近 90 天...每日摘要保留最近 1 年" | APP_L2_01_analytics_retention | 📝 待生成 |
| 累积上限规则 | 功能B L111 | "最多显示3个，可滚动" 聚焦模式右侧栏 | TERM_L2_03_focus_sidebar_max3 | 📝 待生成 |
| 累积上限规则 | 11.2节 L2692 | "上限 20 个终端" | TERM_L2_04_max_terminal_20 | 📝 待生成 |
| 累积上限规则 | 11.2节 L2691 | "聚焦终端 10000 行...非可见 1000 行；不恢复已丢弃的行" | TERM_L2_05_buffer_limit | 📝 待生成 |
| 累积上限规则 | 5.11节 L624 | "最多重试 3 次" AI 评分 | SCORE_L2_01_max_retry_3 | 📝 待生成 |
| 累积上限规则 | 8.8节 L2056 | "截图/GIF，最多 5 张" 发布详情 | PUBLISH_L2_01_max_screenshots_5 | 📝 待生成 |
| 累积上限规则 | 8.3.4节 L1879 | "单个 JSONL > 100MB 时，仅索引最近 6 个月" | CHAT_L2_02_large_file_protection | 📝 待生成 |
| 累积上限规则 | 11.1节 L2674 | "单张 ≤ 5MB 和格式限制（PNG/JPG/GIF）" | SHOWCASE_L2_01_image_size_limit | 📝 待生成 |
| 累积上限规则 | 8.2节 L865-869 | 三栏尺寸规则：左栏 min150 max500，右栏 min150 max500 | FILE_L2_01_column_width_limits | 📝 待生成 |
| 默认值规则 | 7.2节 | 窗口 1400x900，fontSize 14，theme dark | APP_L2_02_default_config | 📝 待生成 |
| 默认值规则 | 6.13节 L1114 | "终端启动（默认）RichEditor" | EDITOR_L2_02_default_mode | 📝 待生成 |
| 默认值规则 | 6.14节 L1161 | "默认展示（按来源优先排序）" | BROWSER_L2_01_default_sort | 📝 待生成 |
| 默认值规则 | 8.2.1节 L1720 | "渲染预览（默认）" Markdown 文件 | FILE_L2_02_default_preview_mode | 📝 待生成 |
| 默认值规则 | 8.3.3节 L1842 | "「全部项目」选项（默认选中）" | CHAT_L2_03_default_all_projects | 📝 待生成 |
| 默认值规则 | 8.8节 L2067 | "首次发布创建商城页面，版本 1.0.0" | PUBLISH_L2_02_initial_version | 📝 待生成 |
| 默认值规则 | 8.14节 L2332 | "onboardingCompleted 为 false" 首次启动触发引导 | ONBOARD_L2_01_default_trigger | 📝 待生成 |
| 默认值规则 | 8.9节 L2165 | "默认使用 CC 当前配置的模型" 评分模型 | SCORE_L2_02_default_model | 📝 待生成 |
| 并发安全规则 | 11.2节 L2688 | "AI CLI 工具可能正在写入 JSONL...忽略不以\\n结尾的末尾行...延迟200ms" | DATA_L2_03_concurrent_jsonl_read | 📝 待生成 |
| 并发安全规则 | 11.1节 L2666 | "本地文件已修改，覆盖还是保留本地版本？" 版本冲突 | INSTALL_L2_02_version_conflict | 📝 待生成 |
| 并发安全规则 | 11.1节 L2677 | "商城中已有同名 Skill，请更换名称" 名称冲突 | PUBLISH_L2_03_name_conflict | 📝 待生成 |
| 并发安全规则 | 11.1节 L2669 | "同步过程中 CC 文件被锁定...跳过该文件，下次同步时重试" | DATA_L2_04_sync_file_locked | 📝 待生成 |

### 扫描统计

| 规则类型 | 扫描关键词 | 命中数 | 生成用例建议数 |
|----------|------------|--------|---------------|
| 部分更新规则 | "保持不变"、"仅更新"等 | 2 | 2 |
| 多时间点规则 | "每日"、"刷新"、"延迟"等 | 5 | 5 |
| 条件互斥规则 | "不可叠加"、"互斥"等 | 0 | 0 |
| 累积上限规则 | "上限"、"最多"、"不超过"等 | 8 | 8 |
| 状态锁定规则 | "永久"、"不可逆"、"一旦"等 | 0 | 0 |
| 默认值规则 | "默认"、"初始"、"首次"等 | 8 | 8 |
| 循环周期规则 | "循环"、"周期"、"每隔"等 | 0 | 0 |
| 并发安全规则 | "并发"、"冲突"、"同时"等 | 4 | 4 |

**总计**：27 条特殊规则 → 27 个专项用例建议

---

## 五、测试分层适配说明

> 本项目为 Electron 桌面应用，与 Web API 后端项目的测试分层有差异。适配如下：

| 层级 | 原定义 | 适配为 Muxvo 的含义 | 测试实现方式 |
|------|--------|-------------------|-------------|
| L1 契约层 | API 格式 + 默认值 | IPC 通道消息格式 + 数据结构默认值 + 文件格式解析 | Jest/Vitest 单元测试 |
| L2 规则层 | 业务规则 + 边界值 | 状态机转换规则 + 性能边界 + 上限值 + 特殊规则 | Jest/Vitest + Electron 测试工具 |
| L3 场景层 | 用户旅程 + 多日场景 | 完整用户操作流程（启动→操作→关闭）、跨功能交互 | Playwright/Spectron E2E |

---

## 六、优先级分配

| 优先级 | 含义 | 适用范围 | 预计用例数 |
|--------|------|---------|------------|
| P0 | 核心流程 | 终端管理(A/B/I)、聊天历史(D)、文件预览(G)、富编辑器(RE1)、应用启动/关闭 | ~80 |
| P1 | 重要功能 | 搜索(E)、三栏视图(H)、配置管理(J)、拖拽排序(C)、归组(M)、安装(O)、聚合浏览(N2)、Hook审查(U)、AI评分(SR) | ~130 |
| P2 | 场景测试 | 时间线(F)、分类查看(K/L)、RE2/RE3、更新检测(T)、展示页(SS)、发布(P2)、社区(SC)、性能、异常处理 | ~100 |

---

## 七、待澄清问题（已全部确认）

| 序号 | 问题 | 确认结论 |
|------|------|---------|
| 1 | L1 契约层测试依据 | ✅ **两者结合**：PRD 行为 + DEV-PLAN IPC 定义共同作为测试依据 |
| 2 | 终端缓冲区缩减时机 | ✅ **延迟/空闲时执行**：标记后在空闲时缩减，避免阻塞 UI |
| 3 | 聚合浏览器失败源重试 | ✅ **自动重试1次**：后台自动重试1次，仍失败则标记不可用 |
| 4 | Ctrl+C 穿透时编辑器内容 | ✅ **不清空，保留内容**：Ctrl+C 只穿透中断进程，编辑器内容保留 |
| 5 | 搜索索引暂停后恢复方式 | ✅ **断点续传**：记录已索引文件列表，下次启动只处理未索引部分 |
| 6 | 启动时数据清理是否阻塞 | ✅ **后台执行**：清理任务在后台执行，不阻塞应用启动 |

---

## 八、用例编号规范（适配 Muxvo）

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

**示例**：
| 编号 | 含义 |
|------|------|
| `TERM_L1_01_grid_layout` | 终端管理-L1契约-Grid布局规则 |
| `EDITOR_L2_03_mode_switch` | 富编辑器-L2规则-模式切换 |
| `CHAT_L3_01_full_search_journey` | 聊天历史-L3场景-完整搜索旅程 |

---

## 下一步

✅ PRD 分析完成

输出文件：`docs/Muxvo_PRD分析报告.md`

下一步：运行 `/prd-to-test-2-generate` 生成测试用例
