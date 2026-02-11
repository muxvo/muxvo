# 一致性检查报告 R2-5：缺省态、埋点、快捷键与细节

## 检查概述
- 检查范围：PRD V2.0 中缺省态（§11.3）、埋点事件（§13.3）、快捷键（§10）、UI 规格、数据结构（§7）、目录结构（§5）等细节与 DEV-PLAN V1.0 的一致性
- 检查日期：2026-02-11
- 基准文档：PRD.md V2.0（~3065 行）
- 对比文档：DEV-PLAN.md V1.0（~1714 行）

## 一致性评分：78%

---

## 缺省态检查

### PRD §11.3 缺省态场景 vs DEV-PLAN X4 任务覆盖

DEV-PLAN 在 X4 任务中明确列出了缺省态实现（约 20 个场景，2.5 天），并逐一列出了场景清单（第 952-959 行）。

### 逐项检查表

| # | 缺省态场景 | PRD 位置 | DEV-PLAN 对应 | 覆盖状态 | UI 方案 | 备注 |
|---|-----------|---------|-------------|---------|--------|------|
| 1 | 无打开的终端（首次使用后） | §11.3 | X4 终端区域 | 完全覆盖 | 文案+图标+按钮 | 文案"按 Cmd+T 新建终端"+[新建终端]按钮 |
| 2 | 终端已全部关闭 | §11.3 | X4 终端区域 | 完全覆盖 | 文案+按钮 | [新建终端]+[恢复上次布局] |
| 3 | 无聊天历史（未检测到 CC） | §11.3 | X4 聊天历史 | 完全覆盖 | 文案+图标+按钮 | 对话气泡图标+[了解 Claude Code] |
| 4 | 无聊天历史（CC 已安装但无记录） | §11.3 | X4 聊天历史 | 完全覆盖 | 文案+图标 | 无操作按钮 |
| 5 | 聊天搜索无结果 | §11.3 | X4 聊天历史 | 完全覆盖 | 文案+图标+按钮 | 搜索图标+[清除搜索] |
| 6 | 搜索索引构建中 | §11.3 | X4 聊天历史 | 完全覆盖 | 进度条 | 显示百分比进度 |
| 7 | 空目录 | §11.3 | X4 文件浏览 | 完全覆盖 | 文案+图标 | 文件夹图标 |
| 8 | 文件加载中 | §11.3 | X4 文件浏览 | 完全覆盖 | 动画 | 旋转图标 |
| 9 | 无权限读取 | §11.3 | X4 文件浏览 | 完全覆盖 | 文案+图标 | 锁图标 |
| 10 | 无 Plans | §11.3 | X4 配置管理 | 完全覆盖 | 文案+图标 | 文档图标 |
| 11 | 无 Skills | §11.3 | X4 配置管理 | 完全覆盖 | 文案+图标 | 闪电图标 |
| 12 | 无 Hooks | §11.3 | X4 配置管理 | 完全覆盖 | 文案+图标 | 钩子图标 |
| 13 | Settings 读取失败 | §11.3 | X4 配置管理 | 完全覆盖 | 文案+图标+按钮 | 警告图标+[重试] |
| 14 | 聚合浏览器首次打开（V2） | §11.3 | X4 Skill 浏览器 | 完全覆盖 | 文案+图标+按钮 | 搜索图标+[浏览 Skills] |
| 15 | Skill 搜索无结果（V2） | §11.3 | X4 Skill 浏览器 | 完全覆盖 | 文案+图标+按钮 | 搜索图标+[清除搜索] |
| 16 | 无已安装的社区包（V2） | §11.3 | X4 Skill 浏览器 | 完全覆盖 | 文案+图标+按钮 | 闪电图标+[浏览 Skills] |
| 17 | 聚合源全部不可用（V2） | §11.3 | X4 Skill 浏览器 | 完全覆盖 | 文案+图标+按钮 | 断网图标+[重试] |
| 18 | 无本地 Skill（Showcase） | §11.3 | X4 Showcase | 完全覆盖 | 文案+链接 | [如何创建 Skill] |
| 19 | SKILL.md 解析失败（Showcase） | §11.3 | X4 Showcase | 完全覆盖 | 文案+按钮 | [手动填写] |
| 20 | 未进行 AI 评分（Showcase） | §11.3 | X4 Showcase | 完全覆盖 | 文案+按钮 | [立即评分] |
| 21 | GitHub OAuth 未登录（Showcase） | §11.3 | X4 Showcase | 完全覆盖 | 文案+按钮 | [登录 GitHub]/[导出 HTML] |
| 22 | GitHub Pages 发布失败（Showcase） | §11.3 | X4 Showcase | 完全覆盖 | 文案+按钮 | [重试]/[导出 HTML] |
| 23 | 展示页 CDN 未生效（Showcase） | §11.3 | X4 Showcase | 完全覆盖 | 文案+按钮 | [刷新检查] |

### 缺省态小结

- PRD 列出 23 个缺省态场景（含 Showcase 6 个），DEV-PLAN X4 任务全部覆盖
- DEV-PLAN 第 952-959 行逐一列出了所有场景，文案/图标/操作按钮方案与 PRD 一致
- 工期 2.5 天，覆盖约 20 个 V1 场景 + V2 场景标记为 V2 阶段实现
- **评分：100%** -- 完全覆盖

---

## 埋点事件检查

### V1 事件检查表

PRD §13.3 定义的 V1 事件 vs DEV-PLAN X7/X8 任务中的事件分类：

| # | 事件名称 | 事件分类 | PRD 位置 | DEV-PLAN 对应 | 参数完整 | 备注 |
|---|---------|---------|---------|-------------|---------|------|
| **终端管理事件** | | | | | | |
| 1 | `terminal.create` | 终端操作 | §13.3 | X7 终端事件 `terminal.create` | 部分差异 | PRD 参数 `{cwd, timestamp}`；DEV-PLAN 参数 `{cwd}`（timestamp 为通用字段可省略） |
| 2 | `terminal.close` | 终端操作 | §13.3 | X7 终端事件 `terminal.close` | 差异 | PRD 参数 `{cwd, duration_seconds, had_foreground_process}`；DEV-PLAN 未列参数细节 |
| 3 | `terminal.focus` | 终端操作 | §13.3 | X7 终端事件 `terminal.focus` | 差异 | PRD 参数 `{terminal_index}`；DEV-PLAN 未列参数细节 |
| 4 | `terminal.cwd_switch` | 终端操作 | §13.3 | X7 终端事件（映射不明确） | 问题 | PRD 有 `terminal.cwd_switch`；DEV-PLAN 无此事件，但有 `terminal.process_detect` |
| 5 | `terminal.drag_reorder` | 终端操作 | §13.3 | X7 终端事件 `terminal.layout_change` | 命名差异 | PRD 为 `drag_reorder`，DEV-PLAN 为 `layout_change`（含义更广） |
| 6 | `terminal.resize_border` | 终端操作 | §13.3 | X7 终端事件（映射不明确） | 问题 | PRD 有此事件；DEV-PLAN 未单独列出，可能归入 `layout_change` |
| **面板事件** | | | | | | |
| 7 | `panel.file_open` | 面板操作 | §13.3 | X7 面板事件 `panel.file_open` | 差异 | PRD 参数 `{cwd}`；DEV-PLAN 无参数细节 |
| 8 | `panel.file_preview` | 面板操作 | §13.3 | X7 面板事件（未列出） | 缺失 | PRD 有 `panel.file_preview`；DEV-PLAN 面板事件改为 open/close 配对，无 preview |
| 9 | `panel.history_open` | 面板操作 | §13.3 | X7 面板事件 `panel.history_open` | 一致 | |
| 10 | `panel.history_search` | 面板操作 | §13.3 | X7 面板事件（未列出） | 缺失 | PRD 有此事件及参数 `{query_length, result_count}` |
| 11 | `panel.history_export` | 面板操作 | §13.3 | X7 面板事件（未列出） | 缺失 | PRD 有此事件及参数 |
| 12 | `panel.config_open` | 面板操作 | §13.3 | X7 面板事件 `panel.config_open` | 一致 | |
| 13 | `panel.config_category` | 面板操作 | §13.3 | X7 面板事件（未列出） | 缺失 | PRD 有此事件，参数 `{category}` |
| 14 | `panel.skill_browser_open` | 面板操作 | §13.3 | X7 面板事件 `panel.skill_browser_open` | 一致 | |
| **富编辑器事件** | | | | | | |
| 15 | `editor.activate` | 富编辑器 | §13.3 | X7 富编辑器事件 `editor.activate` | 差异 | PRD 参数 `{terminal_index}`；DEV-PLAN 无参数细节 |
| 16 | `editor.image_paste` | 富编辑器 | §13.3 | X7 富编辑器事件 `editor.paste_image` | 命名差异 | PRD 为 `image_paste`，DEV-PLAN 为 `paste_image` |
| 17 | `editor.multiline_send` | 富编辑器 | §13.3 | X7 富编辑器事件 `editor.send` | 命名差异 | PRD 为 `multiline_send`（含 line_count/char_count），DEV-PLAN 为 `send`（更通用） |
| 18 | `editor.fallback_to_terminal` | 富编辑器 | §13.3 | X7 富编辑器事件 `editor.mode_switch` | 合并差异 | PRD 分为 fallback_to_terminal 和 return_from_terminal 两个事件 |
| 19 | `editor.return_from_terminal` | 富编辑器 | §13.3 | X7 富编辑器事件 `editor.mode_switch` | 合并差异 | DEV-PLAN 将两个方向合并为一个 `mode_switch` 事件 |
| **生命周期事件** | | | | | | |
| 20 | `app.launch` | 生命周期 | §13.3 | X7 生命周期事件 `app.launch` | 差异 | PRD 参数 `{terminal_count_restored, version, platform}`；DEV-PLAN 无参数细节 |
| 21 | `app.quit` | 生命周期 | §13.3 | X7 生命周期事件 `app.quit` | 差异 | PRD 参数 `{session_duration_minutes, terminal_count}`；DEV-PLAN 无参数细节 |
| 22 | `app.onboarding_complete` | 生命周期 | §13.3 | X7 生命周期事件（未列出） | 缺失 | PRD 有此事件及参数 `{skipped}`；DEV-PLAN 替换为 `app.window_resize` |

### V1 事件差异分析

**PRD 定义 22 个 V1 事件，DEV-PLAN 定义 22 个 V1 事件，但存在以下不一致：**

| 差异类型 | 数量 | 具体事件 |
|---------|------|---------|
| 事件缺失（PRD 有，DEV-PLAN 无） | 5 | `terminal.cwd_switch`, `panel.file_preview`, `panel.history_search`, `panel.history_export`, `panel.config_category` |
| 事件多出（DEV-PLAN 有，PRD 无） | 4 | `terminal.process_detect`, `terminal.rename`, `panel.file_close`, `panel.history_close`, `panel.config_close`, `panel.skill_browser_close`, `app.window_resize` |
| 命名差异 | 3 | `drag_reorder`→`layout_change`, `image_paste`→`paste_image`, `multiline_send`→`send` |
| 事件合并 | 1 | `fallback_to_terminal`+`return_from_terminal` → `mode_switch` |
| 参数缺失 | 多处 | DEV-PLAN 大多数事件未列出携带参数的细节 |

**说明**：DEV-PLAN 将面板事件扩展为 open/close 配对（共 8 个），而 PRD 中部分面板事件仅有 open 或特定操作事件。DEV-PLAN 的数量（22 个）与 PRD 一致，但具体事件有替换。

### V2 事件检查表

| # | 事件名称 | 事件分类 | PRD 位置 | DEV-PLAN 对应 | 参数完整 | 备注 |
|---|---------|---------|---------|-------------|---------|------|
| **Skill 发现/安装事件** | | | | | | |
| 1 | `skill.search` | Skill 发现 | §13.3 | N2-11 埋点 + X7 V2 事件 | 一致 | 参数 `{query, result_count, sources_searched}` |
| 2 | `skill.detail_view` | Skill 发现 | §13.3 | N2-10 埋点 + X7 V2 事件 | 一致 | 参数 `{package_name, source}` |
| 3 | `skill.install` | Skill 发现 | §13.3 | O-4 埋点 + X7 V2 事件 | 一致 | 参数 `{package_name, type, source}` |
| 4 | `skill.uninstall` | Skill 发现 | §13.3 | O-5 埋点 + X7 V2 事件 | 一致 | 参数 `{package_name}` |
| **AI 评分事件** | | | | | | |
| 5 | `score.generate` | AI 评分 | §13.3 | SR-3 埋点 + X7 V2 事件 | 一致 | 参数 `{skill_name, cached}` |
| 6 | `score.result` | AI 评分 | §13.3 | SR-6 埋点 + X7 V2 事件 | 一致 | 参数 `{skill_name, total_score, grade, duration_ms}` |
| 7 | `score.fail` | AI 评分 | §13.3 | SR-6 埋点 + X7 V2 事件 | 一致 | 参数 `{skill_name, error_type}` |
| 8 | `score.save_image` | AI 评分 | §13.3 | SR-8 埋点 + X7 V2 事件 | 一致 | 参数 `{skill_name}` |
| 9 | `score.copy_image` | AI 评分 | §13.3 | SR-8 埋点 + X7 V2 事件 | 一致 | 参数 `{skill_name}` |
| **Showcase 事件** | | | | | | |
| 10 | `showcase.generate` | Showcase | §13.3 | SS-3 埋点 + X7 V2 事件 | 一致 | |
| 11 | `showcase.template_switch` | Showcase | §13.3 | SS-2 埋点 + X7 V2 事件 | 一致 | |
| 12 | `showcase.screenshot_add` | Showcase | §13.3 | SS-4 埋点 + X7 V2 事件 | 一致 | |
| 13 | `showcase.publish` | Showcase | §13.3 | P2-5 埋点 + X7 V2 事件 | 一致 | |
| 14 | `showcase.publish_fail` | Showcase | §13.3 | X7 V2 事件（未在 V2 事件清单中） | 缺失 | PRD 有此事件，DEV-PLAN V2 事件清单中无 |
| 15 | `showcase.share_link_copy` | Showcase | §13.3 | P2-7 埋点 + X7 V2 事件 | 一致 | |
| 16 | `showcase.update` | Showcase | §13.3 | X7 V2 事件 `showcase.update` | 问题 | PRD 有但 DEV-PLAN V2 事件列表中无此事件 |

### V2 事件差异分析

| 差异类型 | 具体事件 | 说明 |
|---------|---------|------|
| PRD 有 DEV-PLAN 无 | `showcase.publish_fail`, `showcase.update` | DEV-PLAN V2 事件清单（第 969-972 行）仅列 16 个事件，但实际缺少这 2 个 |
| DEV-PLAN 多出 | 各任务中的额外埋点（如 `score:scorer-install`, `score:trigger`, `showcase:parse`, `showcase:og-generate`, `showcase:share-image-generate`, `showcase:security-check` 等） | DEV-PLAN 在各个 V2 任务中标注了额外的细粒度埋点，超出 PRD 定义范围 |
| 生命周期事件缺失 | `app.onboarding_complete` | PRD 有此事件，DEV-PLAN 替换为 `app.window_resize` |

### 数据存储方案评估

| 检查项 | PRD 定义 | DEV-PLAN 实现 | 一致性 |
|--------|---------|-------------|--------|
| 存储文件 | `analytics.json` | `analytics.json` | 一致 |
| 存储路径 | `~/Library/Application Support/Muxvo/analytics.json` | 同上 + 跨平台说明 | 一致（DEV-PLAN 更详细） |
| 数据结构 version | 1 | 1 | 一致 |
| events 数组 | `{ event, timestamp, params }` | `{ name, params, timestamp }` | 字段命名差异：PRD `event` vs DEV-PLAN `name` |
| daily_summary | 含 `terminals_created`, `sessions_duration_minutes`, `searches`, `panels_opened`, `ai_interactions` | 含 `date`, `event_counts`, `active_minutes` | 结构差异较大 |
| 明细保留 | 90 天 | 90 天 | 一致 |
| 摘要保留 | 1 年 | 1 年 | 一致 |
| 清理时机 | 每次 `app.launch` | 每次 `app.launch` | 一致 |
| 用户清除入口 | Settings 中可查看/清除 | Settings 中可查看/清除 | 一致 |

**daily_summary 结构差异详述：**

PRD 定义了较丰富的摘要字段：
```json
{
  "terminals_created": 5,
  "sessions_duration_minutes": 180,
  "searches": 3,
  "panels_opened": { "file": 8, "history": 2, "config": 1 },
  "ai_interactions": { "total_responses": 45, "acceptance_rate": 0.73, ... }
}
```

DEV-PLAN 简化为通用结构：
```json
{
  "date": "2026-02-08",
  "event_counts": { "terminal.create": 5, "editor.send": 12 },
  "active_minutes": 180
}
```

DEV-PLAN 的通用结构更灵活（按事件名计数），但丢失了 PRD 中 `ai_interactions` 相关的高级统计字段（如 acceptance_rate、friction_points）。

### 埋点小结

- V1 事件总数一致（22 个），但有 5 个事件缺失 + 多个命名差异 + 参数细节普遍缺失
- V2 事件主体覆盖良好，各任务中标注了具体埋点，但有 2 个事件在总清单中缺失
- analytics.json 存储方案基本一致，但 events 字段命名和 daily_summary 结构有差异
- **评分：65%** -- 事件列表有明显不一致，参数定义不完整

---

## 快捷键检查

### PRD §10 快捷键 vs DEV-PLAN 快捷键映射表

DEV-PLAN 在第 238-254 行完整复制了 PRD 的快捷键映射表，并扩展了 Windows/Linux 对应键。

### 逐项检查表

| # | 快捷键 | 功能 | PRD 位置 | DEV-PLAN 对应 | macOS | Win/Linux | 备注 |
|---|-------|------|---------|-------------|-------|-----------|------|
| 1 | `Cmd+T` | 新建终端 | §10 | §3 快捷键映射表 | `Cmd+T` | `Ctrl+T` | 完全一致 |
| 2 | `Cmd+W` | 关闭当前终端 | §10 | §3 快捷键映射表 | `Cmd+W` | `Ctrl+W` | 完全一致 |
| 3 | `Cmd+1~9` | 聚焦第 N 个终端 | §10 | §3 快捷键映射表 | `Cmd+1~9` | `Ctrl+1~9` | 完全一致 |
| 4 | `Cmd+[` / `Cmd+]` | 切换到上/下一个终端 | §10 | §3 快捷键映射表 | `Cmd+[/]` | `Ctrl+[/]` | 完全一致 |
| 5 | `Esc` | 返回平铺/关闭面板/关闭临时视图 | §10 | §3 快捷键映射表 | `Esc` | `Esc` | 完全一致 |
| 6 | `Cmd+F` | 搜索（上下文感知） | §10 | §3 快捷键映射表 | `Cmd+F` | `Ctrl+F` | 完全一致 |
| 7 | `Cmd+E` | 切换文件面板 | §10 | §3 快捷键映射表 | `Cmd+E` | `Ctrl+E` | 完全一致 |
| 8 | `Cmd+Shift+M` | 打开/关闭 Skill 浏览器 | §10 | §3 快捷键映射表 | `Cmd+Shift+M` | `Ctrl+Shift+M` | 完全一致 |
| 9 | `Cmd+/` | 切换 Markdown 预览/编辑模式 | §10 | §3 快捷键映射表 | `Cmd+/` | `Ctrl+/` | 完全一致 |
| 10 | `Cmd+S` | 保存编辑中的文件 | §10 | §3 快捷键映射表 | `Cmd+S` | `Ctrl+S` | 完全一致 |
| 11 | `/` | Skill 浏览器内聚焦搜索框 | §10 | §3 快捷键映射表 | `/` | `/` | 完全一致 |

### 额外快捷键（PRD 其他章节定义，DEV-PLAN 涉及）

| # | 快捷键 | 功能 | PRD 位置 | DEV-PLAN 对应 | 一致性 |
|---|-------|------|---------|-------------|--------|
| 12 | `Shift+Enter` | 富编辑器换行 | §8.16 | RE1-1 组件 | 一致 |
| 13 | `Enter` / `Cmd+Enter` | 富编辑器发送 | §8.16 | RE1-1 组件 | 一致（可配置） |
| 14 | `Ctrl+C/Z/D` | 穿透到终端 | §8.16 | RE1-4 任务 | 一致 |
| 15 | `Cmd+Shift+E` | 手动编辑器/终端模式切换 | §8.16（隐含） | RE2-2 任务 | DEV-PLAN 明确定义了此快捷键 |

### 平台差异考虑

| 检查项 | 状态 | 说明 |
|--------|------|------|
| macOS vs Windows/Linux 修饰键映射 | 已覆盖 | DEV-PLAN §3 快捷键映射表明确列出双平台对应 |
| PRD 附录 E 跨平台映射规则 | 已引用 | DEV-PLAN 引用"Cmd → Ctrl"替换规则 |
| 快捷键实现任务 | 已规划 | X2 任务专门负责快捷键系统（1 天工期） |

### 快捷键冲突检测

| 检查项 | 状态 | 说明 |
|--------|------|------|
| 终端内 Esc 透传规则 | 已说明 | DEV-PLAN 第 254 行："Esc 仅在 Muxvo UI 层有焦点时生效，终端内 Esc 直接透传给 PTY" |
| Esc 优先级规则（PRD §6.3） | 已引用 | 7 级优先级规则与 PRD 一致 |
| 潜在冲突：`Cmd+[/]` | 未提及 | 可能与浏览器前进/后退冲突，Electron 环境下需显式拦截 |
| 潜在冲突：`Cmd+W` | 未提及 | 标准的关闭窗口快捷键，需确保只关闭终端而非整个窗口 |
| 冲突检测方案 | 无方案 | DEV-PLAN 未提及快捷键冲突检测或自定义快捷键能力 |

### 快捷键小结

- PRD §10 定义的 11 个快捷键在 DEV-PLAN 中完全覆盖，平台差异已处理
- DEV-PLAN 额外明确了 `Cmd+Shift+E`（模式切换）快捷键
- Esc 键焦点规则和透传行为完整一致
- 缺少快捷键冲突检测方案（低优先级）
- **评分：95%** -- 几乎完全一致，仅缺少冲突检测方案

---

## 其他细节检查

### UI 规格

| 检查项 | PRD 定义 | DEV-PLAN 对应 | 一致性 |
|--------|---------|-------------|--------|
| **菜单栏高度** | 36px（§8.1） | A1 任务"菜单栏 36px" | 一致 |
| **文件面板宽度** | 320px（§8.2） | H1 任务"右侧滑出 320px" | 一致 |
| **三栏视图左栏** | 默认 250px，min 150px，max 500px（§6.6） | 模块 4.4 和 H3 任务 | 一致 |
| **三栏视图右栏** | 默认 280px，min 150px，max 500px（§6.6） | 模块 4.4 和 H3 任务 | 一致 |
| **聊天历史左栏** | 220px，min 180px（§8.3.3） | D4 任务"220px/min180px" | 一致 |
| **聊天历史中栏** | 340px，min 280px（§8.3.3） | D4 任务"340px/min280px" | 一致 |
| **聊天历史右栏** | flex，min 400px（§8.3.3） | D4 任务"flex/min400px" | 一致 |
| **聚焦模式比例** | ~75% 宽度（§8.1） | B1 任务"左侧 75% 放大" | 一致 |
| **Grid 布局规则** | 1=全屏，2=对半，3=三等分，4=2x2，5=上3下2，6=3x2，7+=ceil(sqrt(n))（§8.1） | A4 任务完整列出 | 一致 |
| **5 终端 CSS 实现** | 上3下2居中（§8.1） | §11.6 给出具体 CSS Grid 实现方案 | DEV-PLAN 更详细 |
| **Markdown 暗色配色** | §8.2.1 详细色值表 | 模块 4.4 完整引用所有色值 | 完全一致 |
| **Markdown 排版参数** | 基础字号 15px，行高 1.8 等（§8.2.1） | 模块 4.4 完整引用 | 完全一致 |
| **Tile 状态点颜色** | 绿/灰/红/黄/琥珀色（§6.2） | A5 任务"状态点颜色/动画映射" | 一致（引用 PRD） |
| **Tile Hover 效果** | 3D 倾斜 ±4°+光泽层（§6.4） | B3 任务"hover 倾斜 ±4°" | 一致 |
| **状态点动画** | 呼吸脉冲（§6.2） | B3 任务"状态点呼吸脉冲" | 一致 |
| **Skill 浏览器左边栏** | 200px（§8.5） | 未明确标注 | 缺失 |
| **滚动缓冲区** | 可见 10000 行/非可见 1000 行（§11.2） | §3 "scrollback buffer 动态缩减" | 一致 |
| **最大终端数** | 20 个（§11.2） | §11.1 "最大终端数限制 20" | 一致 |
| **动画参数** | 未定义具体 timing | B3 任务"hover transform 200ms ease-out，光泽层 linear-gradient 45deg，状态点脉冲 2s infinite，tile 入场 stagger 50ms delay" | DEV-PLAN 补充了 PRD 未定义的运动参数 |

### 数据结构检查（PRD §7 的 10 个）

| # | 数据结构 | PRD 位置 | DEV-PLAN 位置 | 覆盖情况 |
|---|---------|---------|-------------|---------|
| 1 | CC 现有数据结构（history.jsonl / session JSONL / task JSON） | §7.1 | D1 JSONL 解析器 + 类型定义 `shared/types/chat.types.ts` | 完全覆盖 |
| 2 | Muxvo 本地配置（config.json） | §7.2 | A6 任务 + `config-store.ts` | 完全覆盖 |
| 3 | 包（Package） | §7.3 | N2-1 "UnifiedPackage 接口" + `shared/types/marketplace.types.ts` | 完全覆盖 |
| 4 | 评价（Review） | §7.4 | 标注为 V2-P3 范围（第 374 行） | 延期覆盖（合理） |
| 5 | 本地注册表（marketplace.json） | §7.5 | O-3 任务 + `marketplace.json` | 完全覆盖 |
| 6 | 包归档格式（tar.gz） | §7.6 | O-1/O-2 下载+解压任务 | 完全覆盖 |
| 7 | AI 评分结果（SkillScore） | §7.7 | SR-4/SR-5 评分缓存 + `shared/types/score.types.ts` | 完全覆盖 |
| 8 | Showcase 展示页配置（SkillShowcase） | §7.8 | SS-3 + `shared/types/showcase.types.ts` | 完全覆盖 |
| 9 | muxvo-publisher Plugin 结构 | §7.9 | P2-8 任务 + 独立仓库 | 完全覆盖 |
| 10 | 发布草稿（PublishDraft） | §7.10 | P2-10 任务 + `shared/types/publish-draft.types.ts` + `publish-draft.store.ts` | 完全覆盖 |

### 目录结构一致性

对比 DEV-PLAN §5 项目目录结构与 §4 模块拆分 + V1/V2 任务拆分：

| 模块（§4） | 目录映射（§5） | 任务覆盖 | 一致性 |
|-----------|-------------|---------|--------|
| terminal（4.1） | `components/terminal/` (6 组件) + `services/pty-manager.ts` + `ipc/terminal.ipc.ts` + `stores/terminal.store.ts` + `machines/terminal-process.machine.ts` | A1-A7, B1-B3 | 完全一致 |
| rich-editor（4.2） | `components/terminal/RichEditor.tsx` + `machines/rich-editor.machine.ts` | RE1-1~RE1-8, RE2-1~RE2-4, RE3-1~RE3-4 | 完全一致 |
| chat-history（4.3） | `components/chat-history/` (3 组件) + `services/chat-sync.ts` + `services/search-index.ts` + `ipc/chat.ipc.ts` + `stores/chat.store.ts` | D1-D9, E1-E4 | 完全一致 |
| file-browser（4.4） | `components/file-browser/` (4 组件) + `ipc/fs.ipc.ts` + `machines/file-panel.machine.ts` + `machines/temp-view.machine.ts` | H1-H5, G1-G3 | 完全一致 |
| config-manager（4.5） | `components/config-manager/` (4 组件) + `ipc/config.ipc.ts` + `stores/config.store.ts` + `machines/config-panel.machine.ts` | J1-J3, K1-K5, L1-L3 | 完全一致 |
| file-watcher（4.6） | `services/file-watcher.ts` + `machines/file-watcher.machine.ts` | H2, J3, O-6 | 完全一致 |
| skill-browser（4.7） | `components/skill-browser/` (4 组件) + `services/aggregator.ts` + `ipc/marketplace.ipc.ts` + `stores/marketplace.store.ts` | N2-1~N2-11, O-1~O-6, U-1~U-4 | 完全一致 |
| ai-scorer（4.8） | `ipc/score.ipc.ts` + `stores/score.store.ts` + `machines/ai-score.machine.ts` | SR-1~SR-9 | 完全一致 |
| showcase（4.9） | `components/showcase/` (3 组件) + `ipc/showcase.ipc.ts` + `stores/showcase.store.ts` + `machines/showcase.machine.ts` | SS-1~SS-7, P2-1~P2-10 | 完全一致 |
| auth（4.10） | `services/auth-service.ts` + `ipc/auth.ipc.ts` + `machines/auth.machine.ts` | P2-1~P2-3 | 完全一致 |
| layout（4.11） | `components/layout/` (3 组件) + `components/onboarding/` (3 组件) + `stores/layout.store.ts` + `machines/view-mode.machine.ts` | A4, B1-B2, X1 | 完全一致 |
| analytics（4.12） | `services/analytics.ts` + `ipc/analytics.ipc.ts` + `stores/analytics.store.ts` | X7, X8 | 完全一致 |

**额外目录项：**

| 目录/文件 | 说明 | 在任务中的覆盖 |
|----------|------|-------------|
| `services/process-detector.ts` | 前台进程检测 | I3 任务 |
| `services/package-installer.ts` | 包下载安装 | O-1/O-2 任务 |
| `services/memory-monitor.ts` | 内存监控 | A5/X5 任务 |
| `components/plugins/` | Plugin 浏览 | 模块 4.5 提及 Plugins 浏览 |
| `components/onboarding/` | 首次引导 | X1 任务 |
| `shared/types/analytics.types.ts` | 埋点类型 | X7 任务 |
| `shared/types/publish-draft.types.ts` | 发布草稿类型 | P2-10 任务 |
| `stores/publish-draft.store.ts` | 发布草稿 Store | P2-10 任务 |
| `utils/cc-data-reader.ts` | CC 数据解析 | D1 任务 |
| `utils/paths.ts` | 路径常量 | 基础设施 |

### 目录结构小结

- 12 个模块（§4）与目录结构（§5）完全对应
- 每个模块的 IPC handler、Service、Store、Machine、Component 文件都有明确目录映射
- 所有 V2 增量模块（score/showcase/auth）有独立文件命名，可按阶段增量开发
- **评分：98%** -- 极度一致

---

## 问题清单

### 高优先级

| # | 问题 | 相关位置 | 影响 | 建议 |
|---|------|---------|------|------|
| H1 | V1 埋点事件名称不一致（5 个缺失 + 3 个命名差异） | PRD §13.3 vs DEV-PLAN X7 | 开发时无法确定以哪个文档为准，可能导致埋点实现与产品分析需求不匹配 | 统一事件名称列表，以 PRD 为准更新 DEV-PLAN，特别是 `terminal.cwd_switch`、`panel.file_preview`、`panel.history_search`、`panel.history_export`、`panel.config_category` |
| H2 | 埋点事件参数定义在 DEV-PLAN 中普遍缺失 | DEV-PLAN X7 | 开发时无法确定每个事件需要采集哪些参数，可能导致数据缺失 | 在 DEV-PLAN X7 任务中补充完整的事件参数定义，与 PRD §13.3 保持一致 |
| H3 | analytics.json 中 events 字段命名不一致（`event` vs `name`） | PRD §13.3 vs DEV-PLAN X7 | 数据存储格式不一致会导致读写逻辑混乱 | 统一为 PRD 的 `event` 字段名 |
| H4 | daily_summary 结构差异较大 | PRD §13.3 vs DEV-PLAN X7 | PRD 包含 `ai_interactions` 等高级统计，DEV-PLAN 简化为通用 `event_counts` | 确认是否需要 PRD 中的高级统计字段；如需要则更新 DEV-PLAN 结构 |

### 中优先级

| # | 问题 | 相关位置 | 影响 | 建议 |
|---|------|---------|------|------|
| M1 | V2 事件清单缺少 `showcase.publish_fail` 和 `showcase.update` | DEV-PLAN X7 V2 事件 | 发布失败和展示页更新行为无法追踪 | 在 V2 事件清单中补充这 2 个事件 |
| M2 | `app.onboarding_complete` 被替换为 `app.window_resize` | DEV-PLAN X7 生命周期事件 | 引导流程完成率无法追踪（PRD §8.14 需要此数据） | 恢复 `app.onboarding_complete` 事件，`app.window_resize` 可额外保留 |
| M3 | 富编辑器事件命名不一致（`image_paste` vs `paste_image`，`multiline_send` vs `send`） | PRD §13.3 vs DEV-PLAN X7 | 统计分析时需要额外映射 | 统一命名风格，建议以 PRD 为准 |
| M4 | Skill 浏览器左边栏宽度 200px 未在 DEV-PLAN 中标注 | PRD §8.5 | 开发时可能遗漏此 UI 规格 | 在 N2-9 任务说明中补充 |
| M5 | 快捷键冲突检测无方案 | PRD §10, DEV-PLAN X2 | `Cmd+W` 关闭终端 vs 关闭窗口、`Cmd+[/]` 与浏览器导航可能冲突 | 在 X2 快捷键系统任务中补充冲突检测说明 |

### 低优先级

| # | 问题 | 相关位置 | 影响 | 建议 |
|---|------|---------|------|------|
| L1 | DEV-PLAN 在 V2 任务中新增了 PRD 未定义的额外埋点（如 `score:scorer-install`, `showcase:parse` 等） | DEV-PLAN V2 任务 | 不是问题，但应反向同步到 PRD 以保持文档一致 | V2 开发前同步更新 PRD 的埋点事件表 |
| L2 | DEV-PLAN 补充了 PRD 缺失的动画运动参数 | DEV-PLAN B3 | 是有益补充，但应回写 PRD | 建议在 PRD 视觉效果章节中补充具体参数 |
| L3 | `Cmd+Shift+E`（编辑器模式切换）快捷键仅在 DEV-PLAN 中定义 | DEV-PLAN RE2-2 | PRD §10 快捷键表未收录此快捷键 | 建议将此快捷键补充到 PRD §10 |

---

## 总结

### 各维度评分

| 检查维度 | 评分 | 说明 |
|---------|------|------|
| 缺省态覆盖 | 100% | PRD 23 个场景全部在 DEV-PLAN X4 中覆盖，UI 方案完整 |
| 埋点事件一致性 | 65% | 事件总数基本对齐，但有 5 个 V1 事件缺失、多处命名差异、参数定义普遍缺失、存储结构有差异 |
| 快捷键一致性 | 95% | 11 个快捷键完全一致，平台差异已处理，仅缺少冲突检测方案 |
| UI 规格一致性 | 95% | 所有关键尺寸/颜色/字号参数一致，DEV-PLAN 还补充了动画运动参数 |
| 数据结构覆盖 | 98% | 10 个数据结构全部在 DEV-PLAN 中有实现说明或类型定义 |
| 目录结构一致性 | 98% | 12 个模块与目录完全对应，增量开发路径清晰 |
| **综合评分** | **78%** | 埋点事件是主要拉分项，其他维度均达到 95%+ |

### 关键发现

1. **缺省态是亮点**：DEV-PLAN 对 PRD 缺省态的覆盖堪称完美，23 个场景逐一对应，X4 任务工期合理（2.5 天）
2. **埋点事件是最大差距**：V1 事件列表存在 5 个缺失 + 3 个命名差异 + 1 个事件合并，参数定义普遍缺失。这是需要在开发前优先统一的问题
3. **快捷键非常一致**：DEV-PLAN 完整复制了 PRD 快捷键表，并补充了跨平台映射
4. **目录结构与模块拆分高度吻合**：12 个模块的文件组织清晰，类型定义文件覆盖完整
5. **DEV-PLAN 在多个方面做了有益补充**：动画运动参数、5 终端 CSS 实现方案、`Cmd+Shift+E` 快捷键等，建议反向同步到 PRD

### 优先修复建议

1. **立即修复**：统一 V1 埋点事件名称和参数定义（H1/H2，预计 0.5 天）
2. **开发前修复**：统一 analytics.json 数据存储格式（H3/H4，预计 0.5 天）
3. **V2 开发前**：补充 V2 缺失的 2 个事件、恢复 `app.onboarding_complete`（M1/M2，预计 0.5 天）
