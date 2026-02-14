# CONFIG 模块测试用例（配置管理）

> 对应功能：J（配置管理器）/ K（Settings 编辑）/ L（CLAUDE.md 编辑）
> 版本：V1.0 | 日期：2026-02-14
> PRD 参考：8.4 / 6.11

---

## 1. 状态机图

### 1.1 配置管理器主状态（6.11）

```
  ┌────────┐  打开配置  ┌──────────────┐
  │ Closed ├──────────>│ CategoryList │
  └────────┘           └──────┬───────┘
       ^                      │
       │          选择分类     │
       │       ┌──────────────┼──────────────────────────────┐
       │       │              │              │                │
       │       v              v              v                v
       │  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐
       │  │ Skills  │  │  Hooks   │  │  Plans   │  │   Tasks    │
       │  │  List   │  │  List    │  │  List    │  │   List     │
       │  └────┬────┘  └────┬─────┘  └────┬─────┘  └─────┬──────┘
       │       │             │             │              │
       │       │       ┌─────┼─────────────┼──────────────┘
       │       │       │     │             │
       │       v       v     v             v
       │  ┌────────────────────────────────────┐
       │  │        ResourcePreview             │
       │  │  (查看资源详情，返回所属列表)         │
       │  └────────────────────────────────────┘
       │
       │       ┌──────────────┼──────────────────────────────┐
       │       │              │              │                │
       │       v              v              v                v
       │  ┌──────────┐  ┌───────────┐  ┌──────────┐  ┌──────────┐
       │  │ Settings │  │ ClaudeMd  │  │ Memory   │  │   MCP    │
       │  │  View    │  │  View     │  │  View    │  │  View    │
       │  │ (可编辑) │  │ (可编辑)  │  │ (只读)   │  │ (只读)   │
       │  └──────────┘  └───────────┘  └──────────┘  └──────────┘
       │
       │            关闭/返回
       └──────────────────────────── CategoryList
```

### 1.2 Settings 编辑流程

```
  SettingsView ── 修改设置项 ──> SettingsView(已修改)
                                      │
                                 自动/手动保存
                                      │
                                      v
                              写入 settings.json
```

### 1.3 CLAUDE.md 编辑流程

```
  ClaudeMdView ── 进入编辑 ──> ClaudeMdView(编辑中)
                                      │
                                   ⌘S 保存
                                      │
                                      v
                              写入 CLAUDE.md 文件
```

---

## 2. 状态转换路径覆盖表

| # | 起始状态 | 触发条件 | 目标状态 | 覆盖用例 |
|---|---------|---------|---------|---------|
| T1 | Closed | 打开配置管理器 | CategoryList | CONFIG_L1_001 |
| T2 | CategoryList | 选择 Skills | SkillsList | CONFIG_L1_002 |
| T3 | CategoryList | 选择 Hooks | HooksList | CONFIG_L1_003 |
| T4 | CategoryList | 选择 Plans | PlansList | CONFIG_L1_004 |
| T5 | CategoryList | 选择 Tasks | TasksList | CONFIG_L1_005 |
| T6 | CategoryList | 选择 Settings | SettingsView | CONFIG_L1_006 |
| T7 | CategoryList | 选择 CLAUDE.md | ClaudeMdView | CONFIG_L1_007 |
| T8 | CategoryList | 选择 Memory | MemoryView | CONFIG_L1_008 |
| T9 | CategoryList | 选择 MCP | McpView | CONFIG_L1_009 |
| T10 | SkillsList | 点击某 Skill | ResourcePreview | CONFIG_L1_010 |
| T11 | ResourcePreview | 返回 | 对应列表(SkillsList) | CONFIG_L1_010 |
| T12 | HooksList | 点击某 Hook | ResourcePreview | CONFIG_L1_011 |
| T13 | PlansList | 点击某 Plan | ResourcePreview | CONFIG_L1_012 |
| T14 | TasksList | 点击某 Task | ResourcePreview | CONFIG_L1_013 |
| T15 | MemoryView | 点击某 Memory | ResourcePreview | CONFIG_L1_014 |
| T16 | SettingsView | 修改设置 | SettingsView(已更新) | CONFIG_L1_015 |
| T17 | ClaudeMdView | 编辑并保存 | ClaudeMdView(已保存) | CONFIG_L1_016 |
| T18 | 任意子视图 | 返回/关闭 | CategoryList / Closed | CONFIG_L1_017 |

---

## 3. L1 用例（功能验证）

### 3.1 配置管理器入口与导航

| 编号 | 优先级 | 用例名称 | 前置条件 | 操作 | 预期结果 |
|------|-------|---------|---------|------|---------|
| CONFIG_L1_001_打开管理器 | P0 | 打开配置管理器 | Muxvo 主界面 | 点击配置管理器入口 | 进入 CategoryList；显示 8 个分类入口 |
| CONFIG_L1_002_进入Skills | P0 | 进入 Skills 列表 | CategoryList 已显示 | 点击 Skills 分类 | 显示 Skills 列表；有搜索功能 |
| CONFIG_L1_003_进入Hooks | P1 | 进入 Hooks 列表 | CategoryList 已显示 | 点击 Hooks 分类 | 显示 Hooks 列表；无搜索框 |
| CONFIG_L1_004_进入Plans | P1 | 进入 Plans 列表 | CategoryList 已显示 | 点击 Plans 分类 | 显示 Plans 列表；有搜索功能 |
| CONFIG_L1_005_进入Tasks | P1 | 进入 Tasks 列表 | CategoryList 已显示 | 点击 Tasks 分类 | 显示 Tasks 列表；有搜索功能 |
| CONFIG_L1_006_进入Settings | P0 | 进入 Settings 视图 | CategoryList 已显示 | 点击 Settings 分类 | 显示设置项界面；可编辑 |
| CONFIG_L1_007_进入ClaudeMd | P0 | 进入 CLAUDE.md 视图 | CategoryList 已显示 | 点击 CLAUDE.md 分类 | 显示 CLAUDE.md 内容；可编辑 |
| CONFIG_L1_008_进入Memory | P1 | 进入 Memory 视图 | CategoryList 已显示 | 点击 Memory 分类 | 显示 Memory 内容；有搜索功能；只读 |
| CONFIG_L1_009_进入MCP | P1 | 进入 MCP 视图 | CategoryList 已显示 | 点击 MCP 分类 | 显示 MCP 配置信息；只读 |

### 3.2 资源预览与查看

| 编号 | 优先级 | 用例名称 | 前置条件 | 操作 | 预期结果 |
|------|-------|---------|---------|------|---------|
| CONFIG_L1_010_Skill预览 | P0 | 查看 Skill 详情 | SkillsList 有 Skill 条目 | 点击某 Skill | 进入 ResourcePreview；显示 Skill 详细内容；只读不可编辑 |
| CONFIG_L1_011_Hook预览 | P1 | 查看 Hook 详情 | HooksList 有 Hook 条目 | 点击某 Hook | 进入 ResourcePreview；显示 Hook 内容；只读 |
| CONFIG_L1_012_Plan预览 | P1 | 查看 Plan 详情 | PlansList 有 Plan 条目 | 点击某 Plan | 进入 ResourcePreview；显示 Plan 内容；只读 |
| CONFIG_L1_013_Task预览 | P1 | 查看 Task 详情 | TasksList 有 Task 条目 | 点击某 Task | 进入 ResourcePreview；显示 Task 内容；只读 |
| CONFIG_L1_014_Memory预览 | P1 | 查看 Memory 详情 | MemoryView 有 Memory 条目 | 点击某 Memory | 进入 ResourcePreview；显示 Memory 内容；只读 |

### 3.3 搜索功能（按权限表）

| 编号 | 优先级 | 用例名称 | 前置条件 | 操作 | 预期结果 |
|------|-------|---------|---------|------|---------|
| CONFIG_L1_018_Skills搜索 | P0 | Skills 列表搜索 | SkillsList 有多个条目 | 输入关键词搜索 | 过滤并显示匹配的 Skill |
| CONFIG_L1_019_Plans搜索 | P1 | Plans 列表搜索 | PlansList 有多个条目 | 输入关键词搜索 | 过滤并显示匹配的 Plan |
| CONFIG_L1_020_Tasks搜索 | P1 | Tasks 列表搜索 | TasksList 有多个条目 | 输入关键词搜索 | 过滤并显示匹配的 Task |
| CONFIG_L1_021_Memory搜索 | P1 | Memory 列表搜索 | MemoryView 有多个条目 | 输入关键词搜索 | 过滤并显示匹配的 Memory |

### 3.4 编辑功能

| 编号 | 优先级 | 用例名称 | 前置条件 | 操作 | 预期结果 |
|------|-------|---------|---------|------|---------|
| CONFIG_L1_015_Settings编辑 | P0 | 编辑 Settings 并保存 | SettingsView 已进入 | 修改某设置项的值 | 修改立即写入 settings.json；设置生效 |
| CONFIG_L1_016_ClaudeMd编辑 | P0 | 编辑 CLAUDE.md 并保存 | ClaudeMdView 已进入 | 修改内容后 ⌘S 保存 | 内容写入 CLAUDE.md 文件；保存成功提示 |

### 3.5 导航返回

| 编号 | 优先级 | 用例名称 | 前置条件 | 操作 | 预期结果 |
|------|-------|---------|---------|------|---------|
| CONFIG_L1_017_返回分类列表 | P0 | 从子视图返回分类列表 | 在任意子视图（如 SkillsList） | 点击返回/关闭按钮 | 返回 CategoryList |
| CONFIG_L1_022_Preview返回 | P0 | 从预览返回列表 | 在 ResourcePreview 中 | 点击返回 | 返回到对应的列表（如 SkillsList） |

---

## 4. L2 用例（场景与边界验证）

### 4.1 CONFIG_L2_001_只读权限验证

- **优先级**：P0
- **前置条件**：有 Skills / Hooks / Plans / Tasks / Memory / MCP 数据
- **测试步骤**：
  1. 进入 Skills 列表 → 点击查看某 Skill 详情
  2. 尝试修改 Skill 内容（键盘输入/右键粘贴）
  3. 进入 Hooks 列表 → 查看某 Hook 详情 → 尝试修改
  4. 进入 Plans 列表 → 查看某 Plan 详情 → 尝试修改
  5. 进入 Tasks 列表 → 查看某 Task 详情 → 尝试修改
  6. 进入 Memory 视图 → 查看某 Memory 详情 → 尝试修改
  7. 进入 MCP 视图 → 尝试修改
- **预期结果**：
  - 以上 6 种资源均不可编辑
  - 没有编辑按钮/输入框处于 disabled 状态
  - 键盘输入无效，右键无粘贴选项
  - 无任何修改入口暴露给用户

### 4.2 CONFIG_L2_002_可编辑权限验证

- **优先级**：P0
- **前置条件**：Settings 和 CLAUDE.md 有已有内容
- **测试步骤**：
  1. 进入 Settings → 观察界面，确认有编辑控件
  2. 修改某设置项值 → 保存
  3. 重新打开 Settings → 验证修改已持久化
  4. 进入 CLAUDE.md → 观察界面，确认有编辑区域
  5. 修改 CLAUDE.md 内容 → ⌘S 保存
  6. 通过命令行 `cat ~/.claude/CLAUDE.md` 验证文件已更新
- **预期结果**：
  - Settings：有编辑控件；修改后写入 settings.json；重启后生效
  - CLAUDE.md：有编辑区域；⌘S 保存后写入文件；外部可验证

### 4.3 CONFIG_L2_003_Settings保存持久化

- **优先级**：P0
- **前置条件**：Settings 中有可修改的设置项
- **测试步骤**：
  1. 打开 Settings，记录当前某设置项的值（如主题 = "dark"）
  2. 修改为新值（如主题 = "light"）
  3. 确认保存
  4. 关闭配置管理器
  5. 重新打开配置管理器，进入 Settings
  6. 验证设置项值
  7. 完全退出 Muxvo，重新启动
  8. 再次检查设置项值
- **预期结果**：
  - 步骤 5-6：值为 "light"（已持久化）
  - 步骤 7-8：值仍为 "light"（跨进程持久化到 settings.json）

### 4.4 CONFIG_L2_004_ClaudeMd编辑保存验证

- **优先级**：P0
- **前置条件**：~/.claude/CLAUDE.md 存在且有内容
- **测试步骤**：
  1. 打开配置管理器，进入 CLAUDE.md 视图
  2. 记录原始内容
  3. 在末尾追加一行 "# Test Line 20260214"
  4. 按 ⌘S 保存
  5. 关闭并重新打开 CLAUDE.md 视图
  6. 在终端中用 `cat` 查看文件内容
  7. 删除追加的行，再次保存
- **预期结果**：
  - 步骤 4：保存成功，有成功提示
  - 步骤 5：重新打开后能看到追加内容
  - 步骤 6：文件实际内容包含追加行
  - 步骤 7：恢复原状，文件内容正确

### 4.5 CONFIG_L2_005_搜索无结果边界

- **优先级**：P1
- **前置条件**：Skills / Plans / Tasks / Memory 列表有数据
- **测试步骤**：
  1. 在 Skills 搜索框输入完全不匹配的关键词 "xyzzy_notfound_999"
  2. 观察搜索结果
  3. 清空搜索框
  4. 在 Plans 搜索框输入同样的关键词
  5. 在 Tasks 搜索框输入同样的关键词
  6. 在 Memory 搜索框输入同样的关键词
- **预期结果**：
  - 各列表均显示空状态/无结果提示
  - 清空搜索后恢复显示全部数据
  - 无报错或异常

### 4.6 CONFIG_L2_006_无搜索功能分类验证

- **优先级**：P1
- **前置条件**：配置管理器已打开
- **测试步骤**：
  1. 进入 Hooks 视图，观察界面
  2. 进入 Settings 视图，观察界面
  3. 进入 CLAUDE.md 视图，观察界面
  4. 进入 MCP 视图，观察界面
- **预期结果**：
  - Hooks / Settings / CLAUDE.md / MCP 四个视图均无搜索框
  - 与权限表一致：搜索列标记为 "否" 的分类不展示搜索

### 4.7 CONFIG_L2_007_分类导航完整遍历

- **优先级**：P1
- **前置条件**：配置管理器已打开，所有分类有数据
- **测试步骤**：
  1. 依次进入 8 个分类：Skills → Hooks → Plans → Tasks → Settings → CLAUDE.md → Memory → MCP
  2. 每个分类进入后点击返回到 CategoryList
  3. 进入 Skills → 点击某 Skill 进入 ResourcePreview → 返回 SkillsList → 返回 CategoryList
  4. 进入 Plans → 点击某 Plan 进入 ResourcePreview → 返回 PlansList → 返回 CategoryList
  5. 快速连续切换分类（点击速度 < 200ms 间隔）
- **预期结果**：
  - 步骤 1-2：所有 8 个分类可正常进入和返回
  - 步骤 3-4：三级导航（分类列表 → 资源列表 → 资源预览）正常
  - 步骤 5：快速切换不卡顿、不闪烁、不出现中间状态残留

### 4.8 CONFIG_L2_008_空数据分类处理

- **优先级**：P1
- **前置条件**：某些分类无数据（如新安装环境没有 Skills）
- **测试步骤**：
  1. 进入 Skills 列表（无 Skill 数据）
  2. 进入 Plans 列表（无 Plan 数据）
  3. 进入 Tasks 列表（无 Task 数据）
  4. 进入 Memory 视图（无 Memory 数据）
  5. 进入 Hooks 列表（无 Hook 数据）
  6. 进入 MCP 视图（无 MCP 配置）
- **预期结果**：
  - 各列表显示友好的空状态提示
  - 不显示错误/异常
  - 搜索框仍然可见（对支持搜索的分类）
  - 返回按钮正常工作

### 4.9 CONFIG_L2_009_Settings编辑后立即生效

- **优先级**：P0
- **前置条件**：Settings 中有影响界面的设置（如字体大小、主题等）
- **测试步骤**：
  1. 打开 Settings
  2. 修改某个影响界面的设置项
  3. 保存
  4. 不重启 Muxvo，观察界面变化
  5. 在其他面板中验证设置是否生效
- **预期结果**：
  - 设置修改后立即生效（无需重启）
  - settings.json 文件已更新
  - 界面响应设置变化

### 4.10 CONFIG_L2_010_并发编辑冲突

- **优先级**：P1
- **前置条件**：CLAUDE.md 视图已打开
- **测试步骤**：
  1. 在 Muxvo 中开始编辑 CLAUDE.md
  2. 同时在外部编辑器中打开并修改 CLAUDE.md
  3. 外部编辑器保存
  4. 在 Muxvo 中尝试保存
  5. 观察 Muxvo 行为
- **预期结果**：
  - Muxvo 检测到文件外部变化
  - 保存时给出冲突提示（或自动处理）
  - 不会静默覆盖外部修改，也不会静默丢失本地修改

---

## 5. 权限矩阵交叉验证表

此表用于系统性验证每个资源的三项权限，确保与 PRD 权限表完全一致。

| 资源 | 查看(预期) | 查看(用例) | 搜索(预期) | 搜索(用例) | 编辑(预期) | 编辑(用例) |
|------|-----------|-----------|-----------|-----------|-----------|-----------|
| Skills | Yes | L1_010 | Yes | L1_018 | No | L2_001 |
| Hooks | Yes | L1_011 | No | L2_006 | No | L2_001 |
| Plans | Yes | L1_012 | Yes | L1_019 | No | L2_001 |
| Tasks | Yes | L1_013 | Yes | L1_020 | No | L2_001 |
| Settings | Yes | L1_006 | No | L2_006 | Yes | L1_015, L2_002 |
| CLAUDE.md | Yes | L1_007 | No | L2_006 | Yes | L1_016, L2_004 |
| Memory | Yes | L1_014 | Yes | L1_021 | No | L2_001 |
| MCP | Yes | L1_009 | No | L2_006 | No | L2_001 |

---

## 6. 用例统计

| 优先级 | L1 数量 | L2 数量 | 合计 |
|--------|--------|--------|------|
| P0     | 8      | 4      | 12   |
| P1     | 14     | 6      | 20   |
| P2     | 0      | 0      | 0    |
| **合计** | **22** | **10** | **32** |
