# TERM 模块测试用例 — 终端管理

## 模块信息
- 覆盖功能：A（全屏平铺终端管理）/ B（聚焦模式）/ C（拖拽排序+边框调整）/ I（双段式命名）/ M（同目录自动归组）
- 对应 PRD 章节：6.2-6.4, 6.7-6.9, 8.1, 11.2
- 预计用例数：62 个
- 编号规范：`TERM_{层级}_{序号}_{简述}`

---

## L1 契约层测试

### 1.1 IPC 通道消息格式

| 编号 | 通道 | 操作 | 期望结果 | 计算过程 | 优先级 |
|------|------|------|----------|----------|--------|
| TERM_L1_01_ipc_create | terminal:create | 发送 `{ cwd: "~/project" }` | 返回 `{ terminalId: string, pid: number }` | IPC invoke 格式校验 | P0 |
| TERM_L1_02_ipc_write | terminal:write | 发送 `{ terminalId: "t1", data: "ls\n" }` | 返回 `{ success: true }` | IPC invoke 格式校验 | P0 |
| TERM_L1_03_ipc_resize | terminal:resize | 发送 `{ terminalId: "t1", cols: 80, rows: 24 }` | 返回 `{ success: true }` | IPC invoke 格式校验 | P1 |
| TERM_L1_04_ipc_close | terminal:close | 发送 `{ terminalId: "t1" }` | 返回 `{ success: true }` | IPC invoke 格式校验 | P0 |
| TERM_L1_05_ipc_output | terminal:output (push) | 终端产生输出 | Renderer 收到 `{ terminalId: string, data: string }` | push 通道格式校验 | P0 |
| TERM_L1_06_ipc_state_change | terminal:state-change (push) | 终端状态变更 | Renderer 收到 `{ terminalId: string, state: string }` | push 通道格式校验 | P0 |
| TERM_L1_07_ipc_exit | terminal:exit (push) | 终端进程退出 | Renderer 收到 `{ terminalId: string, exitCode: number }` | push 通道格式校验 | P0 |

### 1.2 默认配置值

| 编号 | 配置项 | 操作 | 期望结果 | 计算过程 | 优先级 |
|------|--------|------|----------|----------|--------|
| TERM_L1_08_default_window_size | 窗口尺寸 | 首次启动应用 | 窗口大小 1400x900 | config.json 默认值 | P1 |
| TERM_L1_09_default_font_size | 字体大小 | 首次启动应用 | fontSize = 14 | config.json 默认值 | P1 |
| TERM_L1_10_default_theme | 主题 | 首次启动应用 | theme = "dark" | config.json 默认值 | P1 |
| TERM_L1_11_default_column_ratios | 列比例 | 首次启动 2 个终端 | columnRatios = [1, 1]（等分） | config.json 默认值 | P1 |
| TERM_L1_12_default_row_ratios | 行比例 | 首次启动 4 个终端 | rowRatios = [1, 1]（等分） | config.json 默认值 | P1 |

### 1.3 Tile 默认样式

| 编号 | 样式属性 | 操作 | 期望结果 | 计算过程 | 优先级 |
|------|----------|------|----------|----------|--------|
| TERM_L1_13_default_tile_border | border | 终端处于 Default 状态 | border = `var(--border)` | CSS 默认状态映射 | P1 |
| TERM_L1_14_default_tile_opacity | opacity | 终端处于 Default 状态 | opacity = 1 | CSS 默认状态映射 | P1 |
| TERM_L1_15_default_name_placeholder | 名称占位符 | 新建终端（无自定义名称） | 显示灰色斜体"命名..."占位符 | 6.8 节默认状态 | P1 |

---

## L2 规则层测试

### 2.1 Grid 布局算法

> **来源**：PRD 8.1 节

| 编号 | 终端数 | 操作 | 期望结果 | 计算过程 | 优先级 |
|------|--------|------|----------|----------|--------|
| TERM_L2_01_grid_1 | 1 | 打开 1 个终端 | 1x1 全屏 | 单终端特殊处理 | P0 |
| TERM_L2_02_grid_2 | 2 | 打开 2 个终端 | 2x1 左右对半 | 2 <= 3, 横向排列 | P0 |
| TERM_L2_03_grid_3 | 3 | 打开 3 个终端 | 3x1 三等分 | 3 <= 3, 横向排列 | P0 |
| TERM_L2_04_grid_4 | 4 | 打开 4 个终端 | 2x2 四宫格 | sqrt(4)=2, 2 列 2 行 | P0 |
| TERM_L2_05_grid_5 | 5 | 打开 5 个终端 | 上 3 下 2（下行居中） | 特殊布局：上 3 下 2 | P0 |
| TERM_L2_06_grid_6 | 6 | 打开 6 个终端 | 3x2 六宫格 | ceil(sqrt(6))=3 列, 2 行 | P0 |
| TERM_L2_07_grid_7 | 7 | 打开 7 个终端 | 3 列, 3+3+1 分布 | ceil(sqrt(7))=3 列, 上 3 中 3 下 1 | P1 |
| TERM_L2_08_grid_9 | 9 | 打开 9 个终端 | 3x3 九宫格 | ceil(sqrt(9))=3 列, 3 行 | P1 |
| TERM_L2_09_grid_10 | 10 | 打开 10 个终端 | 4 列布局 | ceil(sqrt(10))=4 列 | P1 |
| TERM_L2_10_grid_16 | 16 | 打开 16 个终端 | 4x4 十六宫格 | ceil(sqrt(16))=4 列, 4 行 | P2 |
| TERM_L2_11_grid_20 | 20 | 打开 20 个终端（上限） | 5 列布局 | ceil(sqrt(20))=5 列, 上限测试 | P1 |

### 2.2 状态机：终端进程生命周期（6.2）

> **来源**：PRD 第 6.2 节

#### 状态机图

```
[*] ──创建──▶ [Created] ──spawn──▶ [Starting]
                                      │
                         ┌────────────┤
                         ▼            ▼
                     [Failed]    [Running] ◀──────────────────────┐
                         │          │  │  │  │                    │
                         │          │  │  │  └─▶ [WaitingInput] ──┘
                         │          │  │  └────▶ [Busy] ──────────┘
                         │          │  └──────▶ [Disconnected]
                         │          ▼               │      │
                         │     [Stopping]       Starting  Removed
                         │          │            (重连)     │
                         │          ▼                      ▼
                         │     [Stopped]                 [*]end
                         │          │
                         ▼          ▼
                     [Removed] ──▶ [*]end
```

#### 状态 UI 映射验证表

| 编号 | 状态 | 状态点颜色 | 动画 | 输入栏 | 优先级 |
|------|------|-----------|------|--------|--------|
| TERM_L2_12_ui_created | Created | 灰色 | 无 | 禁用 | P0 |
| TERM_L2_13_ui_starting | Starting | 黄色 | 闪烁 | 禁用，显示"启动中..." | P0 |
| TERM_L2_14_ui_running | Running | 绿色 | 呼吸脉冲 | 可用 | P0 |
| TERM_L2_15_ui_busy | Busy | 绿色 | 快速脉冲 | 显示"处理中..." | P0 |
| TERM_L2_16_ui_waiting | WaitingInput | 琥珀色 | 呼吸脉冲 | 可用+选项 | P0 |
| TERM_L2_17_ui_stopping | Stopping | 灰色 | 闪烁 | 禁用，显示"正在关闭..." | P1 |
| TERM_L2_18_ui_stopped | Stopped | 灰色 | 无 | 禁用 | P1 |
| TERM_L2_19_ui_disconnected | Disconnected | 红色 | 无 | 禁用，显示"已断开" | P0 |
| TERM_L2_20_ui_failed | Failed | 红色 | 无 | 禁用 | P0 |

#### 转换路径覆盖表

| 路径编号 | 起始状态 | 触发条件 | 目标状态 | 测试用例 | 优先级 |
|---------|---------|----------|---------|----------|--------|
| T1 | [*] | terminal:create | Created | TERM_L2_21_trans_init_created | P0 |
| T2 | Created | spawn 进程 | Starting | TERM_L2_22_trans_created_starting | P0 |
| T3 | Starting | spawn 成功 | Running | TERM_L2_23_trans_starting_running | P0 |
| T4 | Starting | spawn 失败（路径不存在/权限不足） | Failed | TERM_L2_24_trans_starting_failed | P0 |
| T5 | Running | 进程执行中 | Busy | TERM_L2_25_trans_running_busy | P1 |
| T6 | Busy | 进程执行完毕 | Running | TERM_L2_26_trans_busy_running | P1 |
| T7 | Running | 进程等待输入 | WaitingInput | TERM_L2_27_trans_running_waiting | P1 |
| T8 | WaitingInput | 用户输入 | Running | TERM_L2_28_trans_waiting_running | P1 |
| T9 | Running | 用户关闭终端 | Stopping | TERM_L2_29_trans_running_stopping | P0 |
| T10 | Stopping | 进程正常退出 | Stopped | TERM_L2_30_trans_stopping_stopped | P0 |
| T11 | Stopping | 进程超时未退出（5s） | Disconnected | TERM_L2_31_trans_stopping_disconnected | P1 |
| T12 | Running | 进程异常退出（exit code != 0） | Disconnected | TERM_L2_32_trans_running_disconnected | P0 |
| T13 | Disconnected | 用户点击重连 | Starting | TERM_L2_33_trans_disconnected_starting | P1 |
| T14 | Disconnected | 用户移除终端 | Removed | TERM_L2_34_trans_disconnected_removed | P1 |
| T15 | Stopped | 自动清理 | Removed | TERM_L2_35_trans_stopped_removed | P1 |
| T16 | Failed | 自动清理 | Removed | TERM_L2_36_trans_failed_removed | P1 |

✅ 16/16 路径已覆盖

### 2.3 状态机：视图模式（6.3）

> **来源**：PRD 第 6.3 节

#### 状态机图

```
[*] ──启动──▶ [Tiling] ◀──Esc(优先级6)──── [Focused]
                │  ▲              │  ▲          │
                │  │              │  │          │
           dblclick │         点击右侧栏      dblclick
                │  │         切换聚焦         │
                ▼  │              ▼            │
             [Focused] ──────────────────────[Focused]
                │                               │
                │ 点击文件按钮      点击文件按钮  │
                ▼                               ▼
             [FilePanel] ◀─────────────── [FilePanel]
                │
           点击文件
                ▼
             [TempView] ──Esc──▶ [Tiling]
```

#### 转换路径覆盖表

| 路径编号 | 起始状态 | 触发条件 | 目标状态 | 测试用例 | 优先级 |
|---------|---------|----------|---------|----------|--------|
| V1 | [*] | 应用启动 | Tiling | TERM_L2_37_view_init_tiling | P0 |
| V2 | Tiling | 双击终端 tile | Focused | TERM_L2_38_view_tiling_focused | P0 |
| V3 | Focused | Esc（UI 层焦点） | Tiling | TERM_L2_39_view_focused_tiling_esc | P0 |
| V4 | Focused | 点击"返回平铺" | Tiling | TERM_L2_40_view_focused_tiling_btn | P0 |
| V5 | Focused | 点击右侧栏终端 | Focused（切换目标） | TERM_L2_41_view_focused_switch | P1 |
| V6 | Tiling | 点击文件按钮 | FilePanel | TERM_L2_42_view_tiling_filepanel | P1 |
| V7 | Focused | 点击文件按钮 | FilePanel | TERM_L2_43_view_focused_filepanel | P1 |
| V8 | FilePanel | Esc / 点击外 / ✕ | Tiling（从 Tiling 进入） | TERM_L2_44_view_filepanel_tiling | P1 |
| V9 | FilePanel | Esc（从 Focused 进入） | Focused | TERM_L2_45_view_filepanel_focused | P1 |
| V10 | FilePanel | 点击文件 | TempView | TERM_L2_46_view_filepanel_tempview | P1 |
| V11 | TempView | Esc / ✕ | Tiling | TERM_L2_47_view_tempview_tiling | P1 |

✅ 11/11 路径已覆盖

### 2.4 Esc 键 7 级优先级

> **来源**：PRD 6.3 节 Esc 键优先级表

**前置条件**：焦点在 Muxvo UI 层（非终端内）

| 编号 | 优先级 | 当前状态 | Esc 行为 | 计算过程 | 优先级 |
|------|--------|---------|----------|----------|--------|
| TERM_L2_48_esc_p1_security | 1 | 安全审查对话框打开 | 关闭对话框（不安装） | 最高优先级覆盖 | P0 |
| TERM_L2_49_esc_p2_folder | 2 | 文件夹选择器打开 | 关闭文件夹选择器 | 优先级 2 覆盖 | P1 |
| TERM_L2_50_esc_p3_browser | 3 | Skill 浏览器打开 | 关闭 Skill 浏览器 | 优先级 3 覆盖 | P1 |
| TERM_L2_51_esc_p4_tempview | 4 | 三栏临时视图打开 | 关闭临时视图，返回平铺 | 优先级 4 覆盖 | P1 |
| TERM_L2_52_esc_p5_filepanel | 5 | 文件面板打开 | 关闭文件面板 | 优先级 5 覆盖 | P1 |
| TERM_L2_53_esc_p6_focused | 6 | 聚焦模式（焦点不在终端内） | 返回平铺模式 | 优先级 6 覆盖 | P0 |
| TERM_L2_54_esc_p7_tiling | 7 | 平铺模式 | 无操作 | 最低优先级，无动作 | P2 |
| TERM_L2_55_esc_terminal_passthrough | - | 焦点在终端内（任何模式） | Esc 直接透传到终端，不截获 | 核心原则：终端焦点时透传 | P0 |

### 2.5 状态机：Tile 交互状态（6.4）

> **来源**：PRD 第 6.4 节

#### 状态机图

```
              mouseenter                    click
[Default] ─────────────▶ [Hover] ──────────────▶ [Selected]
    ▲       ◀─────────────   ▲                       │
    │        mouseleave      │ click                  │ dblclick
    │                        │                        ▼
    │                        │                   [Focused]
    │                        │
    │  dragstart             │  dragstart
    ├────────▶ [Dragging] ──dragend──▶ [Default]
    │
    │  dragover(from other)
    └────────▶ [DragOver] ──dragleave/drop──▶ [Default]
```

#### CSS 样式映射验证表

| 编号 | 状态 | border | opacity | transform | 额外效果 | 优先级 |
|------|------|--------|---------|-----------|---------|--------|
| TERM_L2_56_css_default | Default | var(--border) | 1 | none | - | P1 |
| TERM_L2_57_css_hover | Hover | var(--border) | 1 | rotateX/Y(+-4deg) | 光泽反射层 | P1 |
| TERM_L2_58_css_selected | Selected | var(--accent) | 1 | none | amber 边框 glow | P1 |
| TERM_L2_59_css_dragging | Dragging | var(--border) | 0.4 | none | 半透明 | P1 |
| TERM_L2_60_css_dragover | DragOver | var(--accent) | 1 | none | box-shadow: accent-glow | P1 |

### 2.6 聚焦模式规则

> **来源**：PRD 8.1 节、功能 B

| 编号 | 初始状态 | 操作 | 期望结果 | 计算过程 | 优先级 |
|------|----------|------|----------|----------|--------|
| TERM_L2_61_focus_dblclick | Tiling, 3 个终端 | 双击终端 A | 终端 A 放大到左侧约 75% 宽度，B/C 缩小到右侧栏 | 双击触发聚焦 | P0 |
| TERM_L2_62_focus_single_click | Tiling, 3 个终端 | 单击终端 A | 仅选中高亮边框（amber），不进入聚焦 | 单击 ≠ 双击，防误触 | P0 |
| TERM_L2_63_focus_sidebar_max3 | Tiling, 6 个终端 | 双击终端 A | 右侧栏最多显示 3 个终端，其余可滚动 | max 3 个可见 + 滚动 | P0 |
| TERM_L2_64_focus_switch | Focused（A 聚焦） | 点击右侧栏终端 B | B 成为聚焦目标，A 移到右侧栏 | 切换聚焦目标 | P1 |
| TERM_L2_65_focus_esc_return | Focused | Esc（UI 层焦点） | 返回平铺模式，Grid 恢复 | Esc 优先级 6 | P0 |

### 2.7 双段式命名（6.8）

> **来源**：PRD 第 6.8 节

#### 状态机图

```
[*] ──新建终端──▶ [DisplayEmpty]
                      │
                 点击"命名..."
                      ▼
                  [Editing] ──Enter/blur(有内容)──▶ [DisplayNamed]
                      │  ▲                              │
                      │  │                         点击名称
                      │  └──────────────────────────────┘
                      │
                      ├──Enter/blur(空内容)──▶ [DisplayEmpty]
                      │
                      └──Esc──▶ [DisplayPrevious] ──(原值空)──▶ [DisplayEmpty]
                                                   ──(原值非空)──▶ [DisplayNamed]
```

#### 转换路径覆盖表

| 路径编号 | 起始状态 | 触发条件 | 目标状态 | 测试用例 | 优先级 |
|---------|---------|----------|---------|----------|--------|
| N1 | [*] | 新建终端 | DisplayEmpty | TERM_L2_66_name_init_empty | P0 |
| N2 | DisplayEmpty | 点击"命名..." | Editing | TERM_L2_67_name_empty_editing | P0 |
| N3 | Editing | Enter（有内容） | DisplayNamed | TERM_L2_68_name_editing_named_enter | P0 |
| N4 | Editing | blur（有内容） | DisplayNamed | TERM_L2_69_name_editing_named_blur | P1 |
| N5 | Editing | Enter（空内容） | DisplayEmpty | TERM_L2_70_name_editing_empty_enter | P1 |
| N6 | Editing | blur（空内容） | DisplayEmpty | TERM_L2_71_name_editing_empty_blur | P1 |
| N7 | Editing | Esc（原值空） | DisplayEmpty | TERM_L2_72_name_esc_restore_empty | P0 |
| N8 | Editing | Esc（原值非空） | DisplayNamed（恢复原值） | TERM_L2_73_name_esc_restore_named | P0 |
| N9 | DisplayNamed | 点击名称 | Editing | TERM_L2_74_name_named_editing | P1 |

✅ 9/9 路径已覆盖

### 2.8 Grid 边框调整（6.9）

> **来源**：PRD 第 6.9 节

#### 状态机图

```
[Idle] ──mousemove near gap──▶ [DetectingGap]
  ▲                                │       │
  │                          列间隙 │       │ 行间隙
  │                                ▼       ▼
  │                      [ColResizeCursor] [RowResizeCursor]
  │                           │      │         │      │
  │                    mousedown  dblclick  mousedown  dblclick
  │                           ▼      ▼         ▼      ▼
  │                    [DraggingCol] [ResetCol] [DraggingRow] [ResetRow]
  │                           │        │         │        │
  └───────────mouseup─────────┘        │         │        │
  └────────────────────────────────────┘─────────┘────────┘
```

| 编号 | 初始状态 | 操作 | 期望结果 | 计算过程 | 优先级 |
|------|----------|------|----------|----------|--------|
| TERM_L2_75_resize_col_drag | Idle, 2 列布局 | 鼠标移到列间隙 -> mousedown -> mousemove | 光标变 col-resize，列比例实时更新 | columnRatios 更新 | P1 |
| TERM_L2_76_resize_row_drag | Idle, 2x2 布局 | 鼠标移到行间隙 -> mousedown -> mousemove | 光标变 row-resize，行比例实时更新 | rowRatios 更新 | P1 |
| TERM_L2_77_resize_col_dblclick | ColResizeCursor | 双击列间隙 | 列比例重置为等分 [1,1] | 双击重置 | P1 |
| TERM_L2_78_resize_row_dblclick | RowResizeCursor | 双击行间隙 | 行比例重置为等分 [1,1] | 双击重置 | P1 |
| TERM_L2_79_resize_only_tiling | 聚焦模式 | 鼠标移到间隙区域 | 不触发边框调整，光标不变 | **特殊规则**：仅平铺模式生效 | P0 |

### 2.9 同目录终端自动归组

> **来源**：PRD 功能 M、8.1 节

| 编号 | 初始状态 | 操作 | 期望结果 | 计算过程 | 优先级 |
|------|----------|------|----------|----------|--------|
| TERM_L2_80_group_new_same_dir | 终端 A(~/proj), 终端 B(~/other) | 新建终端 C，cwd=~/proj | 终端 C 自动排列到终端 A 旁边 | 同目录归组算法 | P1 |
| TERM_L2_81_group_cd_same_dir | 终端 A(~/proj), 终端 B(~/other), 终端 C(~/third) | 终端 C 执行 cd ~/proj | 终端 C 移动到终端 A 旁边 | cd 触发归组 | P1 |
| TERM_L2_82_group_no_same_dir | 终端 A(~/proj) | 新建终端 B，cwd=~/other（无同目录） | 终端 B 正常追加到末尾，不触发移动 | 无同目录时不动 | P2 |

### 2.10 特殊规则用例（附录 H）

| 编号 | 规则类型 | 操作 | 期望结果 | 计算过程 | 优先级 |
|------|----------|------|----------|----------|--------|
| TERM_L2_83_max_terminal_20 | 累积上限 | 已打开 20 个终端，点击"+ 新建终端" | 按钮变灰，提示"已达最大终端数，请关闭不用的终端" | 上限 20 | P0 |
| TERM_L2_84_buffer_limit_focused | 累积上限 | 终端处于聚焦/可见状态 | 滚动缓冲区保留 10000 行 | 聚焦终端 10000 行 | P1 |
| TERM_L2_85_buffer_limit_hidden | 累积上限 | 终端处于非可见状态 | 滚动缓冲区自动缩减至 1000 行 | 非可见 1000 行 | P1 |
| TERM_L2_86_buffer_no_restore | 累积上限 | 非可见终端缓冲区已缩减，重新可见 | 不恢复已丢弃的行 | 不可逆缩减 | P1 |
| TERM_L2_87_default_grid_ratios | 默认值 | 首次启动，多终端 | columnRatios=[1,1], rowRatios=[1,1] 等分 | 默认等分 | P1 |
| TERM_L2_88_default_tile_style | 默认值 | Tile 处于 Default 状态 | border=var(--border), opacity=1 | CSS 默认映射 | P1 |

---

## 用例统计

- L1: 15 个
- L2: 47 个（含 11 个 Grid 布局 + 16 个终端进程状态机 + 11 个视图模式 + 8 个 Esc 优先级 + 5 个 Tile CSS + 5 个聚焦 + 9 个命名 + 5 个边框调整 + 3 个归组 + 6 个特殊规则）
  - 状态机路径覆盖：终端进程 16/16、视图模式 11/11、命名 9/9
- **总计: 62 个**

| 优先级 | 数量 |
|--------|------|
| P0 | 25 |
| P1 | 31 |
| P2 | 6 |
