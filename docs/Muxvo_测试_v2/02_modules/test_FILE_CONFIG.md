# FILE + CONFIG 模块测试用例

## 模块信息
- 覆盖功能：G（内置 Markdown 预览）/ H（文件浏览器+三栏临时视图）/ J（~/.claude/ 可视化浏览器）/ K（分类查看）/ L（Settings/CLAUDE.md 编辑）
- 对应 PRD 章节：6.5（文件面板）、6.6（三栏临时视图）、6.7（目录切换）、6.11（配置管理器）、8.2（Markdown预览）、8.4（配置管理器）
- 预计用例数：54

---

## 1. 状态机图

### 1.1 文件面板状态机（6.5）

> **来源**：PRD 第 6.5 节

```
  ┌────────┐  click file btn  ┌─────────┐  300ms done  ┌──────┐
  │ Closed ├─────────────────>│ Opening ├────────────>│ Open │
  └────────┘                  └─────────┘             └──┬───┘
       ^                                                  │
       │                              ┌───────────────────┤
       │                              │                   │
       │  300ms done  ┌─────────┐    Esc/外部点击    click another
       └──────────────┤ Closing │<────┘            file btn
                      └─────────┘                     │
                                                      v
                                              Open(切换项目)

       Open ──click file item──> TransitionToTempView ──> Closed(面板关闭,三栏打开)
```

### 转换路径覆盖表

| 路径编号 | 起始状态 | 触发条件 | 目标状态 | 测试用例 |
|---------|---------|---------|---------|---------|
| T1 | Closed | 点击终端 tile「文件」按钮 | Opening | FILE_L1_01_open_panel |
| T2 | Opening | transition done 300ms | Open | FILE_L1_01_open_panel |
| T3 | Open | 点击另一个终端的「文件」按钮 | Open(切换) | FILE_L1_02_switch_terminal |
| T4 | Open | 点击目录中的文件 | TransitionToTempView | FILE_L1_03_open_file |
| T5 | Open | Esc / 点击外部 / 点击 ✕ | Closing | FILE_L1_04_close_panel |
| T6 | Closing | transition done 300ms | Closed | FILE_L1_04_close_panel |

✅ 6/6 路径已覆盖

### 1.2 三栏临时视图状态机（6.6）

> **来源**：PRD 第 6.6 节

```
  ┌────────┐  从文件面板点击文件  ┌──────────┐  三栏渲染完成  ┌────────┐
  │ Hidden ├────────────────────>│ Entering ├──────────────>│ Active │
  └────────┘                    └──────────┘               └───┬────┘
       ^                                                       │
       │           ┌──────────┐                                │
       └───────────┤ Exiting  │<── Esc / 点击 ✕ ──────────────┘
       Grid恢复    └──────────┘

  Active 内部子状态：
  ┌─────────────────────────────────────────────────────┐
  │  PreviewMode <──────⌘/────────> EditMode            │
  │       │                           │                 │
  │  点击右栏另一文件               ⌘S 保存              │
  │       v                           v                 │
  │  UpdatingContent──>ContentLoaded  Saving──>Editing  │
  │                                                     │
  │  EditMode中有未保存修改时 ⌘/:                         │
  │  UnsavedPrompt ──保存/放弃──> PreviewMode            │
  │  UnsavedPrompt ──取消──> Editing                    │
  │                                                     │
  │  PreviewMode中可拖拽左右resize handle调整宽度          │
  └─────────────────────────────────────────────────────┘
```

### 转换路径覆盖表

| 路径编号 | 起始状态 | 触发条件 | 目标状态 | 测试用例 |
|---------|---------|---------|---------|---------|
| T1 | Hidden | 从文件面板点击文件 | Entering | FILE_L1_03_open_file |
| T2 | Entering | Grid 隐藏，三栏渲染完成 | Active(PreviewMode) | FILE_L1_03_open_file |
| T3 | PreviewMode | 点击右栏另一个文件 | UpdatingContent | FILE_L1_05_switch_file |
| T4 | UpdatingContent | 中栏内容更新完成 | ContentLoaded | FILE_L1_05_switch_file |
| T5 | PreviewMode | ⌘/ | EditMode | FILE_L1_06_toggle_edit |
| T6 | EditMode | ⌘/（无未保存修改） | PreviewMode | FILE_L1_06_toggle_edit |
| T7 | EditMode | ⌘/（有未保存修改） | UnsavedPrompt | FILE_L2_09_unsaved_prompt |
| T8 | UnsavedPrompt | 用户选择保存或放弃 | PreviewMode | FILE_L2_09_unsaved_prompt |
| T9 | UnsavedPrompt | 用户取消 | Editing | FILE_L2_09_unsaved_prompt |
| T10 | EditMode | ⌘S | Saving | FILE_L1_07_save_file |
| T11 | Saving | 保存完成 | Editing | FILE_L1_07_save_file |
| T12 | Active | Esc / 点击 ✕ | Exiting | FILE_L1_08_close_tempview |
| T13 | Exiting | Grid 恢复显示 | Hidden | FILE_L1_08_close_tempview |
| T14 | PreviewMode | 拖拽左侧 resize handle | ResizingLeft | FILE_L2_07_resize_left |
| T15 | ResizingLeft | mouseup（宽度持久化） | PreviewMode | FILE_L2_07_resize_left |
| T16 | PreviewMode | 拖拽右侧 resize handle | ResizingRight | FILE_L2_08_resize_right |
| T17 | ResizingRight | mouseup（宽度持久化） | PreviewMode | FILE_L2_08_resize_right |

✅ 17/17 路径已覆盖

### 1.3 配置管理器状态机（6.11）

> **来源**：PRD 第 6.11 节

```
  ┌────────┐  点击「配置」按钮  ┌──────────────┐
  │ Closed ├──────────────────>│ CategoryList │
  └────────┘                   └──────┬───────┘
       ^                              │
       │  Esc/关闭                    │
       └──────────────────────────────┤
                                      │
       CategoryList 内部子状态：       │
  ┌───────────────────────────────────┴───────────────────┐
  │  Overview（分类卡片）                                   │
  │    ├── 点击 Skills  ──> SkillsList  ──点击──> Preview  │
  │    ├── 点击 Hooks   ──> HooksList   ──点击──> Preview  │
  │    ├── 点击 Plans   ──> PlansList   ──点击──> Preview  │
  │    ├── 点击 Tasks   ──> TasksList   ──点击──> Preview  │
  │    ├── 点击 Settings ──> SettingsView ──修改──>         │
  │    │                     SettingsEditing ──保存──>      │
  │    │                     SettingsView                   │
  │    ├── 点击 CLAUDE.md ──> ClaudeMdView ──修改──>        │
  │    │                      ClaudeMdEditing ──保存──>     │
  │    │                      ClaudeMdView                  │
  │    ├── 点击 Memory  ──> MemoryView                     │
  │    └── 点击 MCP     ──> McpView                        │
  │                                                        │
  │  Preview ──返回──> 对应 XxxList                         │
  └────────────────────────────────────────────────────────┘
```

### 转换路径覆盖表

| 路径编号 | 起始状态 | 触发条件 | 目标状态 | 测试用例 |
|---------|---------|---------|---------|---------|
| T1 | Closed | 点击「配置」按钮 | CategoryList(Overview) | CONFIG_L1_01_open_config |
| T2 | Overview | 点击 Skills 卡片 | SkillsList | CONFIG_L1_02_browse_skills |
| T3 | Overview | 点击 Hooks 卡片 | HooksList | CONFIG_L1_03_browse_hooks |
| T4 | Overview | 点击 Plans 卡片 | PlansList | CONFIG_L1_04_browse_plans |
| T5 | Overview | 点击 Tasks 卡片 | TasksList | CONFIG_L1_05_browse_tasks |
| T6 | Overview | 点击 Settings 卡片 | SettingsView | CONFIG_L1_06_view_settings |
| T7 | Overview | 点击 CLAUDE.md 卡片 | ClaudeMdView | CONFIG_L1_07_view_claudemd |
| T8 | Overview | 点击 Memory 卡片 | MemoryView | CONFIG_L1_08_view_memory |
| T9 | Overview | 点击 MCP 卡片 | McpView | CONFIG_L1_09_view_mcp |
| T10 | SkillsList | 点击某个 skill | ResourcePreview | CONFIG_L1_10_preview_resource |
| T11 | ResourcePreview | 返回列表 | SkillsList | CONFIG_L1_10_preview_resource |
| T12 | SettingsView | 用户修改设置 | SettingsEditing | CONFIG_L1_11_edit_settings |
| T13 | SettingsEditing | 保存成功 | SettingsView | CONFIG_L1_11_edit_settings |
| T14 | ClaudeMdView | 用户修改内容 | ClaudeMdEditing | CONFIG_L1_12_edit_claudemd |
| T15 | ClaudeMdEditing | 保存成功 | ClaudeMdView | CONFIG_L1_12_edit_claudemd |
| T16 | CategoryList | Esc / 点击关闭 | Closed | CONFIG_L1_13_close_config |

✅ 16/16 路径已覆盖

---

## 2. FILE L1 契约层测试

### 2.1 IPC 通道格式验证

| 编号 | 优先级 | 用例名称 | 前置条件 | 操作 | 期望结果 | 计算过程 |
|------|--------|---------|---------|------|---------|---------|
| FILE_L1_01_read_dir | P0 | fs:read-dir IPC 格式 | 终端已创建，cwd 目录存在 | 调用 `fs:read-dir({ path })` | 返回 `{ entries: Array<{name, type, size, mtime}> }` | IPC 通道名 = "fs:read-dir"，返回目录条目列表 |
| FILE_L1_02_read_file | P0 | fs:read-file IPC 格式 | 文件路径有效 | 调用 `fs:read-file({ path })` | 返回 `{ content: string, encoding: string }` | 返回文件内容及编码 |
| FILE_L1_03_write_file | P0 | fs:write-file IPC 格式 | 文件路径有效，有写入权限 | 调用 `fs:write-file({ path, content })` | 返回 `{ success: true }` | 写入文件内容 |
| FILE_L1_04_watch_start | P1 | fs:watch-start IPC 格式 | 目录路径有效 | 调用 `fs:watch-start({ path })` | 返回 `{ watchId: string }` | 开始监听目录变化 |
| FILE_L1_05_watch_stop | P1 | fs:watch-stop IPC 格式 | 已有活动的 watchId | 调用 `fs:watch-stop({ watchId })` | 返回 `{ success: true }` | 停止监听 |
| FILE_L1_06_change_push | P1 | fs:change 推送格式 | 监听已激活，文件发生变化 | 监听 `fs:change` 推送 | 推送 `{ watchId, type: "add"|"change"|"unlink", path }` | push 类型通道 |
| FILE_L1_07_select_dir | P1 | fs:select-directory IPC 格式 | 应用已启动 | 调用 `fs:select-directory` | 返回 `{ path: string }` 或 `{ cancelled: true }` | 打开系统目录选择器 |

### 2.2 默认值与初始状态

| 编号 | 优先级 | 用例名称 | 前置条件 | 操作 | 期望结果 | 计算过程 |
|------|--------|---------|---------|------|---------|---------|
| FILE_L1_08_default_preview | P0 | Markdown 默认预览模式 | 打开 .md 文件 | 进入三栏临时视图 | 中栏默认为渲染预览模式，非编辑模式 | PRD 8.2.1/L1720: "渲染预览（默认）" |
| FILE_L1_09_default_column_widths | P0 | 三栏默认宽度 | 首次打开三栏临时视图 | 观察布局 | 左栏 250px，中栏 flex:1，右栏 280px | PRD 6.6/L865: "左栏默认 250px，右栏默认 280px" |
| FILE_L1_10_left_terminal_display | P1 | 左栏终端显示规则 | 同目录有 2 个终端 | 打开三栏视图 | 左栏显示 2 个终端，等分两份 | PRD 6.6: 2 个终端等分两份 |
| FILE_L1_11_left_terminal_scroll | P1 | 左栏终端 4+ 滚动 | 同目录有 5 个终端 | 打开三栏视图 | 显示 3 个（等分），其余滚动查看 | PRD 6.6: "4+: 显示 3 个（等分），其余滚动查看" |
| FILE_L1_12_panel_animation | P1 | 文件面板滑入动画 | 面板关闭 | 点击文件按钮 | 面板从右侧滑入 translateX(100%)->translateX(0) | PRD 6.5 转换说明 |
| FILE_L1_13_empty_dir | P2 | 空目录缺省态 | 终端 cwd 为空目录 | 打开文件面板 | 显示"此目录为空" + 文件夹图标 | PRD 11.3 缺省态 |
| FILE_L1_14_no_permission | P2 | 无权限读取 | 目录权限不足 | 打开文件面板 | 显示"无法读取此目录，请检查权限" + 锁图标 | PRD 11.3 缺省态 |

### 2.3 三栏临时视图交互

| 编号 | 优先级 | 用例名称 | 前置条件 | 操作 | 期望结果 | 计算过程 |
|------|--------|---------|---------|------|---------|---------|
| FILE_L1_15_open_tempview | P0 | 打开三栏临时视图 | 文件面板 Open 状态 | 点击目录中的文件 | 面板关闭，三栏视图打开；Grid 隐藏 | T4 路径 |
| FILE_L1_16_switch_file | P0 | 切换查看文件 | 三栏 PreviewMode | 点击右栏另一个文件 | 中栏内容更新为新文件 | T3->T4 路径 |
| FILE_L1_17_toggle_edit | P0 | 切换编辑/预览模式 | 三栏 PreviewMode | 按 ⌘/ | 切换到 EditMode | T5 路径 |
| FILE_L1_18_save_file | P0 | ⌘S 保存文件 | EditMode，有修改 | 按 ⌘S | 文件保存成功；状态 Saving->Editing | T10->T11 路径 |
| FILE_L1_19_close_tempview | P0 | 关闭三栏临时视图 | Active 状态 | 按 Esc 或 点击 ✕ | 三栏关闭；Grid 恢复显示 | T12->T13 路径 |
| FILE_L1_20_switch_terminal | P1 | 切换另一终端文件面板 | 文件面板 Open，显示终端 A 的文件 | 点击终端 B 的文件按钮 | 面板内容切换为终端 B 的目录，无动画 | PRD 6.5: "切换项目内容，无动画" |

---

## 3. FILE L2 规则层测试

### 3.1 文件面板过渡动画

| 编号 | 优先级 | 用例名称 | 初始状态 | 操作 | 期望结果 | 计算过程 |
|------|--------|---------|---------|------|---------|---------|
| FILE_L2_01_panel_transition_300ms | P0 | 面板过渡 300ms | Closed 状态 | 点击文件按钮 | Opening->Open 过渡耗时 300ms；同理 Closing->Closed 耗时 300ms | PRD 6.5/L801: "transition done 300ms" |
| FILE_L2_02_close_transition | P0 | 关闭面板过渡 | Open 状态 | 按 Esc | translateX(0)->translateX(100%)，300ms 过渡 | PRD 6.5 转换说明 |

### 3.2 三栏尺寸规则

| 编号 | 优先级 | 用例名称 | 初始状态 | 操作 | 期望结果 | 计算过程 |
|------|--------|---------|---------|------|---------|---------|
| FILE_L2_03_column_min_width | P0 | 最小宽度约束 | 三栏 Active 状态 | 拖拽 resize handle 缩小左栏 | 左栏不小于 150px | PRD 6.6/L865-869: "左栏 min150, 右栏 min150" |
| FILE_L2_04_column_max_width | P0 | 最大宽度约束 | 三栏 Active 状态 | 拖拽 resize handle 放大左栏 | 左栏不超过 500px | PRD 6.6/L865-869: "左栏 max500, 右栏 max500" |
| FILE_L2_05_right_min_width | P0 | 右栏最小宽度 | 三栏 Active 状态 | 拖拽右侧 handle 缩小右栏 | 右栏不小于 150px | min=150px |
| FILE_L2_06_right_max_width | P0 | 右栏最大宽度 | 三栏 Active 状态 | 拖拽右侧 handle 放大右栏 | 右栏不超过 500px | max=500px |
| FILE_L2_07_resize_persist | P1 | 宽度持久化 | 拖拽左栏到 300px | mouseup -> 关闭三栏 -> 重新打开 | 左栏宽度恢复为 300px | PRD 6.6: "mouseup（宽度持久化）" |
| FILE_L2_08_default_widths | P1 | 默认宽度值 | 首次打开三栏，无持久化数据 | 打开三栏 | 左栏 250px，右栏 280px | PRD config: ftvLeftWidth=250, ftvRightWidth=280 |

### 3.3 编辑模式规则

| 编号 | 优先级 | 用例名称 | 初始状态 | 操作 | 期望结果 | 计算过程 |
|------|--------|---------|---------|------|---------|---------|
| FILE_L2_09_unsaved_prompt | P0 | 编辑未保存提示 | EditMode，有未保存修改 | 按 ⌘/ 切换模式 | 弹出 UnsavedPrompt：保存/放弃/取消 | PRD 6.6: "⌘/ 且有未保存修改 -> UnsavedPrompt" |
| FILE_L2_10_unsaved_save | P0 | 选择保存后切换 | UnsavedPrompt | 选择「保存」 | 文件保存成功；切换到 PreviewMode | T8 路径 |
| FILE_L2_11_unsaved_discard | P0 | 选择放弃后切换 | UnsavedPrompt | 选择「放弃」 | 放弃修改；切换到 PreviewMode | T8 路径 |
| FILE_L2_12_unsaved_cancel | P1 | 选择取消继续编辑 | UnsavedPrompt | 选择「取消」 | 关闭提示；继续 Editing 状态 | T9 路径 |
| FILE_L2_13_md_preview_render | P0 | Markdown 渲染 | 打开 .md 文件 | PreviewMode | 支持 CommonMark+GFM 渲染；代码块有语法高亮 | PRD 8.2: "支持 CommonMark+GFM" |

### 3.4 目录切换规则（6.7 决策树式）

> **来源**：PRD 第 6.7 节

```
点击 cwd 路径 / 快捷路径 / 文件夹选择器
        │
        v
  检查前台进程 (tcgetpgrp)
  ├── 进程名 ∈ shell列表(bash/zsh/fish) ──> 直接发送 cd <path>\n
  └── 进程名 ∉ shell列表(claude/codex/python等) ──> 确认对话框
        ├── 用户确认退出 ──> SIGINT ──> 等待回 shell ──> cd
        └── 用户取消 ──> 关闭对话框，不操作
```

| 编号 | 优先级 | 用例名称 | 初始状态 | 操作 | 期望结果 | 计算过程 |
|------|--------|---------|---------|------|---------|---------|
| FILE_L2_14_cd_shell_direct | P0 | shell 状态直接 cd | 前台进程为 bash | 点击快捷路径切换目录 | 直接发送 `cd <path>\n`，cwd 更新 | 进程名 ∈ shell 列表 -> 直接 cd |
| FILE_L2_15_cd_ai_confirm | P0 | AI 工具需确认 | 前台进程为 claude | 点击快捷路径 | 弹出确认框"当前正在运行 claude，需要退出后才能切换目录" | 进程名 ∉ shell 列表 -> 确认对话框 |
| FILE_L2_16_cd_confirm_ok | P0 | 确认退出后 cd | 确认对话框已显示 | 点击「确认退出」 | 发送 SIGINT -> 等待回 shell -> 发送 cd 命令 | 用户确认 -> 退出 -> cd |
| FILE_L2_17_cd_confirm_cancel | P1 | 取消退出 | 确认对话框已显示 | 点击「取消」 | 关闭对话框，不切换目录 | 用户取消 -> 无操作 |
| FILE_L2_18_cd_chain_actions | P1 | 目录切换连锁动作 | shell 状态，成功 cd | cd 完成 | 终端 header cwd 更新 + 检查自动归组 + 文件按钮指向新目录 | PRD 6.7: 三个连锁动作 |

### 3.5 Markdown 预览/编辑双模式

| 编号 | 优先级 | 用例名称 | 初始状态 | 操作 | 期望结果 | 计算过程 |
|------|--------|---------|---------|------|---------|---------|
| FILE_L2_19_default_preview | P0 | 默认预览模式 | 打开 .md 文件 | 进入三栏 | 中栏为渲染预览模式 | PRD 8.2.1/L1720 默认值 |
| FILE_L2_20_edit_toggle | P0 | ⌘/ 切换模式 | PreviewMode | 按 ⌘/ | 切换到 EditMode；再按 ⌘/ 回到 PreviewMode | 双向切换 |

---

## 4. CONFIG L1 契约层测试

### 4.1 IPC 通道格式验证

| 编号 | 优先级 | 用例名称 | 前置条件 | 操作 | 期望结果 | 计算过程 |
|------|--------|---------|---------|------|---------|---------|
| CONFIG_L1_01_get_resources | P0 | config:get-resources IPC 格式 | 应用已启动 | 调用 `config:get-resources({ type: "skills" })` | 返回 `{ resources: Array<{name, path, type}> }` | 按类型获取资源列表 |
| CONFIG_L1_02_get_resource_content | P0 | config:get-resource-content IPC 格式 | 已知资源路径 | 调用 `config:get-resource-content({ path })` | 返回 `{ content: string, format: "md"|"json"|"sh" }` | 获取单个资源内容 |
| CONFIG_L1_03_get_settings | P0 | config:get-settings IPC 格式 | settings.json 存在 | 调用 `config:get-settings` | 返回 `{ settings: object }` | 获取 settings.json 完整内容 |
| CONFIG_L1_04_save_settings | P0 | config:save-settings IPC 格式 | 有编辑权限 | 调用 `config:save-settings({ settings })` | 返回 `{ success: true }` | 写入 settings.json |
| CONFIG_L1_05_get_claudemd | P0 | config:get-claude-md IPC 格式 | CLAUDE.md 存在 | 调用 `config:get-claude-md` | 返回 `{ content: string }` | 获取 CLAUDE.md 内容 |
| CONFIG_L1_06_save_claudemd | P0 | config:save-claude-md IPC 格式 | 有编辑权限 | 调用 `config:save-claude-md({ content })` | 返回 `{ success: true }` | 写入 CLAUDE.md |
| CONFIG_L1_07_get_memory | P1 | config:get-memory IPC 格式 | 项目存在 MEMORY.md | 调用 `config:get-memory({ projectId })` | 返回 `{ content: string }` | 获取项目记忆内容 |
| CONFIG_L1_08_resource_change_push | P1 | config:resource-change 推送格式 | 监听已激活 | ~/.claude/ 下文件变化 | 推送 `{ type: "skills"|"hooks"|..., action: "add"|"change"|"unlink", path }` | push 类型通道 |

### 4.2 默认值与初始状态

| 编号 | 优先级 | 用例名称 | 前置条件 | 操作 | 期望结果 | 计算过程 |
|------|--------|---------|---------|------|---------|---------|
| CONFIG_L1_09_overview_cards | P0 | 分类卡片显示 | 打开配置管理器 | 观察 Overview | 显示 8 种资源类型卡片（Skills/Hooks/Plans/Tasks/Settings/CLAUDE.md/Memory/MCP），每个卡片显示资源数量 | PRD 6.11 Overview 子状态 |
| CONFIG_L1_10_resource_permissions | P0 | 资源操作权限 | 打开配置管理器 | 检查各类资源 | Skills/Hooks/Plans/Tasks/Memory/MCP 只读；Settings/CLAUDE.md 可编辑 | PRD 6.11 资源类型与操作权限表 |

### 4.3 资源浏览与编辑

| 编号 | 优先级 | 用例名称 | 前置条件 | 操作 | 期望结果 | 计算过程 |
|------|--------|---------|---------|------|---------|---------|
| CONFIG_L1_11_browse_skills | P1 | 浏览 Skills 列表 | 有多个 Skills | 点击 Skills 卡片 | 展开 Skills 列表；支持搜索 | PRD 6.11: Skills 可查看+搜索 |
| CONFIG_L1_12_preview_skill | P1 | 预览 Skill 内容 | Skills 列表已展开 | 点击某个 Skill | 显示 SKILL.md 的 Markdown 渲染内容 | T10->T11 路径 |
| CONFIG_L1_13_edit_settings | P0 | 编辑 Settings | SettingsView 状态 | 修改 JSON 值 | 进入 SettingsEditing；保存后写入 settings.json | T12->T13 路径 |
| CONFIG_L1_14_edit_claudemd | P0 | 编辑 CLAUDE.md | ClaudeMdView 状态 | 修改 Markdown 内容 | 进入 ClaudeMdEditing；保存后写入 CLAUDE.md | T14->T15 路径 |
| CONFIG_L1_15_close_config | P0 | 关闭配置管理器 | CategoryList 状态 | 按 Esc 或 点击关闭 | 返回 Closed 状态 | T16 路径 |
| CONFIG_L1_16_empty_skills | P2 | 无 Skills 缺省态 | `~/.claude/skills/` 为空 | 打开 Skills 卡片 | 显示"还没有 Skills，可以在终端中使用 claude code 自动创建" | PRD 11.3 缺省态 |
| CONFIG_L1_17_empty_hooks | P2 | 无 Hooks 缺省态 | 无 hook 配置 | 打开 Hooks 卡片 | 显示"还没有配置 Hooks" | PRD 11.3 缺省态 |
| CONFIG_L1_18_settings_read_fail | P2 | Settings 读取失败 | settings.json 损坏 | 打开 Settings | 显示"无法读取 settings.json" + 警告图标 + [重试] | PRD 11.3 缺省态 |

---

## 5. CONFIG L2 规则层测试

### 5.1 8 种资源类型浏览

| 编号 | 优先级 | 用例名称 | 初始状态 | 操作 | 期望结果 | 计算过程 |
|------|--------|---------|---------|------|---------|---------|
| CONFIG_L2_01_skills_search | P1 | Skills 搜索功能 | Skills 列表有多个资源 | 输入搜索词 | 按名称筛选匹配的 Skills | PRD 6.11: Skills 支持搜索 |
| CONFIG_L2_02_plans_search | P1 | Plans 搜索功能 | Plans 列表有多个资源 | 输入搜索词 | 按名称筛选匹配的 Plans | PRD 6.11: Plans 支持搜索 |
| CONFIG_L2_03_tasks_search | P1 | Tasks 搜索功能 | Tasks 列表有多个任务 | 输入搜索词 | 按名称/状态筛选匹配的 Tasks | PRD 6.11: Tasks 支持搜索 |
| CONFIG_L2_04_memory_search | P1 | Memory 搜索功能 | 多个项目有 MEMORY.md | 输入搜索词 | 按项目名称筛选 | PRD 6.11: Memory 支持搜索 |
| CONFIG_L2_05_hooks_readonly | P0 | Hooks 只读 | 打开 Hooks 列表 | 尝试编辑 | 无编辑入口；仅可查看源码 | PRD 6.11: Hooks 只读 |
| CONFIG_L2_06_mcp_readonly | P1 | MCP 只读 | 打开 MCP 卡片 | 观察 | 仅展示 mcp.json 内容；无编辑入口 | PRD 6.11: MCP 只读 |

### 5.2 Settings 编辑规则

| 编号 | 优先级 | 用例名称 | 初始状态 | 操作 | 期望结果 | 计算过程 |
|------|--------|---------|---------|------|---------|---------|
| CONFIG_L2_07_settings_save | P0 | Settings 保存写入 | 修改了 settings.json 某字段 | 保存 | 直接写入 `~/.claude/settings.json` | PRD 6.11: "直接写入 settings.json" |
| CONFIG_L2_08_claudemd_save | P0 | CLAUDE.md 保存写入 | 修改了 CLAUDE.md 内容 | 保存 | 直接写入 `~/.claude/CLAUDE.md` | PRD 6.11: "直接写入 CLAUDE.md" |

### 5.3 虚拟滚动

| 编号 | 优先级 | 用例名称 | 初始状态 | 操作 | 期望结果 | 计算过程 |
|------|--------|---------|---------|------|---------|---------|
| CONFIG_L2_09_virtual_scroll | P1 | 长列表虚拟滚动 | Plans 列表有 129 个 | 滚动列表 | 使用虚拟滚动渲染，DOM 仅渲染可见区域 | PRD 11.2: "长列表（如 129 个 Plans）使用虚拟滚动渲染" |

---

## 6. 用例统计

### FILE 模块

| 层级 | 用例数 |
|------|--------|
| L1 契约层 | 20 |
| L2 规则层 | 20 |
| FILE 小计 | 40 |

### CONFIG 模块

| 层级 | 用例数 |
|------|--------|
| L1 契约层 | 18 |
| L2 规则层 | 9 |
| CONFIG 小计 | 27 |

### 合计

| 项目 | 数量 |
|------|------|
| FILE 用例 | 40 |
| CONFIG 用例 | 27 |
| **总计** | **67** |

> 注：实际用例数（67）超出原预估（54）是因为状态机路径覆盖分析后识别了更多必要的测试点。

### 优先级分布

| 优先级 | 用例数 |
|--------|--------|
| P0 | 34 |
| P1 | 24 |
| P2 | 9 |
