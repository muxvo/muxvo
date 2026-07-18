# 行为规格：终端 Tile 网格（探针 3 复刻屏）

> 提炼自老 app 实际代码（TerminalGrid/TerminalTile/TileHeader/TileEffects.css/grid-layout.ts/grid-resize.ts，
> 2026-06-10 读取），**只记行为不抄结构**。新实现是纯展示组件 + fixture props，不接任何后端。
> 注：老代码角色是「行为说明书」；像素细节以「老 app 注入 fixture 的 golden 截图」为最终权威，本文用于指导新实现的结构与状态覆盖。

## 0. 数据形状（fixture 驱动）

每个终端 tile 由以下数据完全决定（脱后端）：

```
TerminalFixture {
  id: string
  state: 状态枚举（下表）
  cwd: string            // 显示前要做缩短处理（§4.3）
  customName?: string    // 自定义名
}
屏幕级：viewMode: Tiling|Focused, focusedId?, selectedId?, activeSidebarId?, maxReached?, theme: dark|light
```

后端状态枚举共 10 个：Created/Starting/Running/Busy/WaitingInput/Stopping/Stopped/Disconnected/Failed/Removed。
**UI 只区分 3 类**（状态点映射，§3.1）：WaitingInput → 红、Running → 绿、其余一律灰（idle）。

「五态」答案（计划遗留问题，以代码为准）：tile 的视觉态全集 = 状态点 3 态（running/waiting/idle）
× 装饰态 2 种（selected/focused），fixture 屏必须覆盖：**Running、WaitingInput、Idle、Selected、Focused** 五种组合，
外加瞬时态（dragging/drag-over，§3.4）。

## 1. 网格布局（Tiling 模式）

### 1.1 行列分布（按终端数 N 硬编码 + 通用算法）

| N | 行×列 | 分布 distribution | 特殊 |
|---|---|---|---|
| 1 | 1×1 | [1] | |
| 2 | 1×2 | [2] | |
| 3 | 1×3 | [3] | |
| 4 | 2×2 | [2,2] | |
| 5 | 2 行 | [3,2] | 6 列网格：首行 3 个各占 2 列、次行 2 个各占 3 列（即两行都铺满，宽度不同） |
| 6 | 2×3 | [3,3] | |
| 7 | 2 行 | [4,3] | 12 列网格：首行 4 个各占 3 列、次行 3 个各占 4 列 |
| 8 | 2×4 | [4,4] | |
| 9 | 3×3 | [3,3,3] | |
| ≥10 | cols=⌈√N⌉，rows=⌈N/cols⌉ | 逐行填满 cols，余数进末行 | 末行不满时 lastRowCentered（末行各 tile 等分整行宽并居中） |

### 1.2 容器结构与间距

- 单行（N≤3）：一个 CSS Grid，`gridTemplateColumns` 按列比例 `Xfr` 拼接，gap 6px，padding 0
- 多行（N≥4）：外层 flex column（gap 6px），每行一个独立 Grid（行高 = flex 比例 rowRatios[i]），**每行列宽比例独立**
- 注意：5/7 的"各占 X 列"在比例化后等价于"该行 3 或 2 等份"——实现按每行独立 fr 比例即可，不必复刻 12 列 span 技巧

### 1.3 列/行拖拽调宽（ResizeHandle）

- 把手：透明 8px 宽条（列）/高条（行），absolute 定位在相邻两格交界（按累计比例换算成 %，translate -50% 居中）
- hover：amber 辉光底（rgba(232,167,72,0.3)）；按住拖动中：实心 amber；光标 col-resize / row-resize
- 拖动语义：只重分相邻两格的比例之和，任一格比例下限 0.1（不能拖没）
- **双击把手：该行所有列（或所有行）比例重置为均分**
- Focused 模式下所有把手隐藏、拖拽禁用
- 比例不持久化（会话内存态；网格形状变化即重建为均分）

## 2. Focused 模式（双击 tile 或点最大化按钮进入）

> 视图模式三态：Tiling（本文 §1）/ Focused（本节）/ **List（批B 新增，见 `term-list-mode.md`——⌘⇧L 切换，
> 左终端列表 + 右选中终端真详情，小屏适用）**。

- **双击进入的门控（settings-dogfood 批，PAR-13 消费端；本批前仅设置项无消费者）**：仅
  `doubleClickToFocus` 偏好开启（默认关）时，双击终端**洞区**（native surface `mouseDown clickCount==2`；
  shift+双击排除——新版 shift+click=扩选手势 DOGFOOD_M3_17）→ 经 `surfaceDoubleClickAction` 纯函数映射
  `maximizeTile` 走与 web 同 handleAction 路进 Focused。开关关闭 = 双击只作词选（零行为变化）。
  Focused 下再双击 = 幂等重进（legacy TerminalContext.tsx:393 非 toggle 语义）；词选与聚焦**并行不互斥**
  （legacy xterm 词选 + DOM dblclick 同发语义；vt mouse-tracking 活跃时同样可用——legacy DOM dblclick
  不受 tracking 抑制）。开关值事件时实时读 config（改设置即时生效，无需广播）。已知边界：TileHeader
  （web 面，轨2 冻结）不接双击；sidebar 双击互换（§2 sidebar tile 激活态条款）仍属未实现项，不受本开关
  门控、不混入本链（sidebarPreview → nil）。点最大化按钮进入不受开关影响。

### 2.1 双击聚焦案例池（spec-coverage 强制，TG_dblclick_* 族）

| 用例名 | 断言 |
| --- | --- |
| `TG_dblclick_gated_off` | 开关关：映射 nil、viewMode 不变（默认关=零行为变化回归锚） |
| `TG_dblclick_focus` | 开关开：grid 双击 → maximizeTile → viewMode=Focused 且 focusedId=目标 |
| `TG_dblclick_focused_idempotent` | Focused 下重双击 → 幂等重进（非 toggle，legacy 对齐） |

- **CSS overlay 实现，不卸载任何 tile**（保终端内容存活）：focused tile 绝对定位铺 top/left/bottom，right=25%（无其他终端时 right=0）、zIndex 10；其余 tile 绝对定位 0×0 隐藏（opacity 0, pointerEvents none）
- 右侧 sidebar（width 25%，zIndex 11，纵向 flex 可滚动）：每个非 focused 终端一个 compact tile，**每屏最多显示 3 个**（高度 = 100/min(n,3)%，minHeight 150px），多于 3 个滚动
- sidebar tile 激活态（activeSidebarId）：左边框 2px amber（未激活 1px 普通边框）；覆盖一层智能 overlay——未激活时半透明罩（rgba(0,0,0,0.03)）点击=激活；已激活时罩透明、光标 text、点击=聚焦该终端输入、滚轮转发滚动、双击=与 focused 互换
- sidebar 空白处 / focused tile 点击 → 取消 sidebar 激活
- focused tile 的 header：最大化按钮替换为「回到平铺」按钮（四宫格图标）

## 3. Tile 视觉态

### 3.1 状态点（header 左端 6×6 圆点）

| 态 | 颜色 | 动效 |
|---|---|---|
| running | var(--success) #4ade80 | 呼吸辉光 statusPulse 2s 循环（box-shadow 6px↔12px+24px） |
| waiting | #ef4444 | 同款呼吸 1s 循环（更急促） |
| idle（其余全部） | var(--text-muted) | 无 |

### 3.2 WaitingInput 附加视觉

- header 右侧红色圆形 badge，白字 **"1"**（18×18，badgePulse 1.5s 透明度 1↔0.6，红辉光）
- tile 整体红边呼吸（borderGlow 2.5s：border rgba(239,68,68,.7)↔1 + outline 3px rgba(239,68,68,.2)↔.5，outline-offset 2px）
- **组合规则**：waiting 同时 selected/focused 时，保留 amber 边框、只呼吸红色 outline（outlineGlow）
- header 底边线染红 rgba(239,68,68,0.2)

### 3.3 selected / focused / 基础

- 基础 tile：bg var(--bg-card)、圆角 10px、边框 2px var(--border)、双层投影；hover 投影加深
- selected（Tiling 模式当前选中）：边框 var(--accent)，tile-name 文字变 amber
- focused：边框 var(--border-focus)，大投影 + amber 微辉光，tile-name amber
- 入场动画 tileEnter 0.6s（上移 40px+缩 0.95 淡入），按 tile 序号 stagger 50ms；compact tile 无入场动画；动画结束后移除（避免压住 waiting 边框动画）
- ☆ **洞区 native 点击直报（DOGFOOD_M3_06，2026-07-03，独立 agent + 本单）**：洞区（穿透落下层 surface）的点击不经 web，native surface `mouseDown` 直报同步选中态——`grid`→`tileClick`、`sidebarPreview`→`sidebarSelect`，与 web chrome 点击的 tileClick/sidebarSelect 同路（wait-detector 的 acknowledge 隐含免费获得；selectSidebar 幂等）。sidebar 两态（未激活点击=激活、已激活点击=聚焦该终端输入，§2「sidebar tile 激活态」）由「F1 焦点跟随点击（terminal-input.md §7）+ role→action 映射」合起来全覆盖：激活态由映射的 sidebarSelect 管，聚焦输入由 F1 makeFirstResponder 管。role→action 为纯函数（可单测），不加防抖（防抖会吞重复点击的 acknowledge 清红）。双击直报同链（settings-dogfood 批，§2.1）：`mouseDown clickCount==2`（shift 除外）加发 `onUserDoubleClick` → `surfaceDoubleClickAction(role, enabled)` 纯函数映射（`doubleClickToFocus` 开 ∧ `grid` → `maximizeTile`；关/`sidebarPreview`/`island` → nil），与词选并行、置于 tryReportMouse 之前（tracking 活跃不抑制，legacy DOM dblclick 对齐）。

### 3.4 拖拽重排（仅 Tiling，拖 header 触发）

- header 是拖拽柄（cursor grab/grabbing）；focused/compact 模式禁用
- 拖起的 tile：opacity 0.4；悬停目标 tile：amber 边框 + amber 环（!important 压过 waiting 红）
- 放下语义（★2026-07-07 用户实测裁决修订，原「插到目标之前 dropBefore」废弃）：**方向感知插入**
  ——向右拖（源在目标左）插到目标之后、向左拖插到目标之前，拖拽物恒落在目标位置。纯 dropBefore
  对向右拖差一位（[A,B] 拖 A 到 B 原地不动、三 tile 拖 A 到 C 只能落第 2 位），真机实测反直觉
- 文件拖入（Files 类型）不走重排逻辑，留给终端内容区（显示虚线 amber 文件投放 overlay）

### 3.5 关闭中 / 死 tile 视觉（☆ 2026-07-04，DOGFOOD_M3_09，**仅 live 模式**）

> 门控铁律：以下全部 **`!!live` 门控**（TerminalScreen 收到 onAction && onTermCommand 才挂 LiveInteractionLayer）。截图 / 纯展示（fixtures.json 含大量 Stopped tile）**零新增**——不加 overlay、不加 badge、✕ 不 disabled，golden 逐字节不变。

- **关闭中（Stopping，用户主动关闭 ~2s 窗口）**：tile 内容区上覆 `.tile-closing-overlay`（暗罩 + 「关闭中…」文案 + `data-hit-island` 空值属性=浮层岛约定，垂死终端不吃点击；洞 rect 仍在 → surface 不 detach、画面连续）；`.tile--stopping .tile-header` 淡化；✕ 按钮 `disabled`（`.tile-close-btn--disabled`，onClose=undefined）防「Stopping 期二次点 ✕ 又弹确认」连点陷阱。
- **死 tile（Stopped/Disconnected/Failed，仅自退路径可达——用户关闭已单帧移除，terminal-session.md §3.2 步骤5）**：header 加 `.tile-dead-badge`「已停止」标签（补足此前「死 tile 视觉几乎不变、用户以为没关掉」的观感缺口）；✕ = 一键 REMOVE 跳确认（现有行为，§4.1 关闭钮据终端态翻转）。
- 状态点（`.tile-status`）映射不变（Stopping / 终态均落灰 idle 点，§3.1）；本节只增 overlay / badge / disabled 三类新 class，不改既有声明。

## 4. Tile Header（左→右）

`[状态点] [worktree badge?] [cwd · 名称区] [waiting badge?] [按钮组]`，
padding 6px 10px，bg var(--bg-primary)，底边线 var(--border)，gap 8px

### 4.1 按钮组

- 完整模式：`[worktree 按钮(仅 git 仓库)] [文件按钮(folder 图标, amber)] [最大化按钮 | 回到平铺按钮(focused 时)] [收起按钮(仅 live，§11.2)] [关闭按钮]`
- compact 模式（sidebar）：`[切换为主屏按钮(maximize 图标)] [关闭按钮]`
- 样式要点：最大化/回到平铺 = amber 底块（rgba(232,167,72,.15) + 同色边框）；worktree=绿色 icon；文件=amber icon；关闭=灰 X hover 提亮；全部 svg 线性图标（见老 CSS 尺寸）

#### 4.1.1 按钮悬停 tooltip（自绘，dogfood-r6 反馈② 2026-07-12）

- 工程定因（勿绕）：**WKWebView 不渲染 HTML 原生 `title` tooltip**（批A 折叠点条 tooltip 已定因、真机取证）——用户「图标不知干嘛」的诉求必须**自绘**。先例 = MinimizedRail `.min-rail__tooltip`（portal + fixed + `pointer-events:none`）。
- 组件 = `HoverTip`（`web/src/tile/HoverTip.tsx`，**cloneElement 注入事件、零 DOM 包裹层** → 既有按钮 class/结构逐字节不变，golden 安全）；按钮**保留 `title` 属性**作测试锚（jsdom 可断言；真机只见自绘气泡）。
- 行为（r6-fix 真机否决回修 2026-07-12，取证档 r6-fix-evidence.md）：mouseenter 后**延迟 160ms** 才出现（快速扫过不闪；原 450ms 大于小图标间移动的自然停留 → 快扫永不出泡=「时灵时不灵」、出泡 ~526ms=「很慢」，真机被否决）；**mousemove 补武装（自愈）**：WKWebView+穿透洞环境 mouseenter 可能被吞（洞区→按钮跨界），悬停期间任意一次 move 若未定时且未显示即补 arm（已定时不重置——抖动光标也能到点）；mouseleave / mousedown 即收；气泡在按钮**下方居中**（贴视口边缘水平夹紧、下方放不下翻到上方）；`pointer-events:none` 不截击。样式照 `.min-rail__tooltip`（12px 字号、`--bg-elevated` 底、`--border` 边、`--shadow-elevated`）。
- 文案表（title 属性 == 气泡文案；接 TileHeader 全部按钮 + 左下角视图切换幽灵钮 ViewToggleGhost）：

  | 按钮 | 文案 |
  | --- | --- |
  | worktree ⑂ | `Worktree`（现 title 沿用） |
  | 文件 ▤ | `文件`（现 title 沿用） |
  | 最大化 ⤢ | `放大此终端` |
  | 回到平铺 ▦（focused 时） | `回到平铺`（现 title 沿用） |
  | 收起 ▁（仅 live） | `收起到左侧边栏` |
  | 关闭 ✕ | `关闭终端` |
  | compact·切换为主屏 ⤢ | `切换为主屏` |
  | 视图切换幽灵钮 ☰/▦ | `切换到列表模式` / `切换到平铺模式`（现 title 沿用） |

- hover-only + 160ms 延迟 + portal 浮层（`pointer-events:none`）→ fixture/golden 天然零影响（截图态不 hover、不入 hit-island）。

##### 案例池（spec-coverage 强制，TG_HDR_* 族）

| 用例名 | 断言 |
| --- | --- |
| `TG_HDR_hover_tooltips` | 按钮悬停 160ms 后出自绘气泡=对应文案；离开即收；快速扫过（<160ms 离开）不出；mousemove 自愈（无 enter 只有 move 也出泡）且 move 不重置在跑定时器；title 属性保留作锚 |

### 4.2 worktree badge

- 条件：cwd 含 `/.worktrees/`（或名称匹配 `项目/worktree-N`）→ 绿色小 badge（分支图标 + 项目名，rgba(166,227,161,.15) 底）
- 真实 app 还会异步校验 worktree 是否注册；**复刻屏 fixture 直接给定 badge 显隐，不复刻校验**

### 4.3 cwd 显示规则（shortenPath）

- home 前缀替换为 `~`；超过 3 段时压缩为 `首段/…/末段`（保末级目录完整）
- 青色可点击样式（hover 下划线 + var(--cyan)），等宽字体 11px，溢出省略号
- 点击弹 CwdPicker（弹层不在复刻屏范围）

### 4.4 命名三态（cwd 后接 `·` 分隔）

- 未命名：斜体灰色占位文案（i18n："点击命名"类），点击进入编辑
- 已命名：等宽 12px 600 字重亮色文本，点击进入编辑
- 编辑中：透明底输入框，amber 底边线 + amber 光标，宽 100px；Enter 确认 / Esc 取消 / blur 确认
  - ☆（DOGFOOD_M3_15 实现注记，2026-07-04）洞穿透架构下 DOM blur 不可靠（洞区点击 WKWebView 收
    不到事件、native 抢焦无回传）——「blur 确认」实现 = 编辑期全窗透明岛（.rename-blur-guard，
    pointer-events:none，native 拦回洞区点击）+ document 捕获 mousedown 点外提交 + onBlur 兜底
    提交，语义与本条及 legacy（useNaming BLUR=commit）一致。
- compact 模式只显示「已命名」态，不显示占位/编辑

## 5. 网格级元素

- **FAB**（新建终端）：absolute 右下 20px，40×40 圆角 12px，amber 渐变（135°, #e8a748→#d4943a），深色 "+"，辉光投影；hover 放大 1.08；maxReached 时 disabled（opacity .35）；空状态（N=0）也显示，居中提示文案旁
  > 注（DOGFOOD_M3_04 三方对照裁决，2026-07-03）：点击 = **直接** `create`（cwd 缺省→native homePath；
  > `defaultTerminalCwd` 偏好归 M6 设置面板），**不弹目录选择**。cwd-picker 屏是 M2 复刻的「切换已有终端目录」
  > 浮层（入口 = 点 tile 头部 cwd 文本，§4.3），非新建入口；PRD.md「点 + 弹目录选择器」描述过时，最低权威，
  > 以 legacy 实况与 REQ-TERM_LIFECYCLE-003（无偏好时新终端落主目录）/-006（+ 点击立刻出现新终端）为准。
  > ☆ 修订（DOGFOOD_M3_20，2026-07-07 用户新增）：**菜单「文件 → 新建终端 ⌘N」与 FAB 同链直建**——同经 `TerminalService.createTerminalFromMenu`（内部 `projection.createTerminal(cwd:nil)` + `installUserWriteHook`，与 FAB 的 term.command create 归一，照 applyZoom 两路先例）。满员（maxReached）时菜单项经 `validateMenuItem` 置灰、FAB disabled，语义对齐。legacy 无此菜单已核实（老 app 仅 FAB 新建）。见 terminal-input.md §8 Cmd+N 行。
- **空状态**：居中灰色 13px 提示文案（i18n）+ FAB
- **WaitingInputNotification**：fixed 右下 16px 浮卡（bg-elevated + 红边 rgba(239,68,68,.4) + 红辉光投影），红点(脉冲) + "N 个终端等待输入" + ✕ 可关闭；**仅当存在 waiting 终端且用户在非终端覆盖层（聊天/设置等）时显示**——复刻屏 fixture 直接控制显隐
  > ☆ 修订（DOGFOOD_M3_18，2026-07-07 用户裁决）：**终端屏（裸网格）绝不显示浮卡**——现场缺陷是重写版把浮卡常驻终端屏，遮挡右下 FAB「+」。legacy 铁证 `src/renderer/components/terminal/WaitingInputNotification.tsx` L74 `if (waitingCount===0 || !overlayActive || dismissed) return null;`：浮卡**只在非终端覆盖层**显示（那里看不到 tile 红点，浮卡是唯一屏内提醒），点卡片正文 `onSwitchToTerminals`（legacy `dispatch(CLOSE_ALL)`）跳回终端屏，✕ 单独清红（stopPropagation 不触发跳回）。
  > overlayActive 精确集（legacy L367-371）= 聊天历史 / Skills / MCP / Hooks / Plugins / 文件面板 / 临时文件查看 —— **不含 settings**（settings 是 modal 非 tile 视图）；重写新增 **任务中心**（用户裁决扩入「一切非终端 tile 视图」）。
  > 实现门控（live-only，保 golden f8 字节冻结）：截图/纯展示（`onAction` 缺席）仍随 fixture 直渲浮卡于终端屏（golden `existing:f8` 是终端屏+浮卡组合，字节冻结）；**live 模式**（`onAction` 在）终端屏由 `TerminalScreen` 的 `!onAction` 门控挡掉，浮卡改由 `LiveWaitingCard` 挂于各非终端覆盖层（配置面板 = `LiveChrome` panel≠settings；聊天历史/任务中心 = `main.tsx` 对应 panelMode 分支）。跳回终端各挂载方注入：配置面板 `setPanel(null)` / 聊天历史 `chatClose` / 任务中心 `exitTaskCenter`（新 UIAction，native 半 `setPanelMode(.terminal)`）。见 wait-detector.md §8。

## 6. 主题 token（复刻必须用变量，不硬编码）

dark（默认）：bg-primary #0a0e14 / bg-card #0d1117 / bg-elevated #161b22 / border #1e2530 /
border-focus #e8a74855 / text-primary #d4d4d8 / text-secondary #71717a / text-muted #3f3f46 /
accent #e8a748 / success #4ade80 / cyan #22d3ee / error #f87171 /
font-mono "JetBrains Mono, SF Mono, Menlo…" / font-sans 系统栈（含 PingFang SC）

light 主题存在（[data-theme="light"]，accent 变 #c87d1a、bg-card #ffffff 等），按钮/badge/FAB 均有 light 变体——
fixture 矩阵需含至少一张 light 全景。

## 7. 终端内容区

- tile 内容区（header 之下 flex:1 区域）在老 app 里是 xterm canvas；复刻屏用**固定文本块**模拟（等宽字体、深色底、与 golden 注入同一段确定性 ANSI 渲染结果的静态 HTML）
- 视觉回归对文本区按计划放宽（像素感知阈值），布局包围盒仍须 ≤1px

## 8. fixture 矩阵（截图清单，探针 3 验收用）

| # | 场景 | 关键覆盖 |
|---|---|---|
| F1 | N=4（2×2），五态齐全：Running/Waiting/Idle/Selected + 1 个含 customName | 状态点 3 态、waiting badge+红边、selected、命名两态 |
| F2 | N=1 / N=3 / N=5 / N=7 / N=9 各一张 | 布局表全部特例（含 5/7 不等宽行、3 单行） |
| F3 | N=12 | ≥10 通用算法 + lastRowCentered |
| F4 | Focused 模式：1 主 + 5 sidebar（1 个激活态） | 75/25、sidebar 上限 3 可滚动、激活左边框、回到平铺按钮、compact header |
| F5 | 拖拽中：1 dragging + 1 drag-over | 瞬时态样式 |
| F6 | 空状态 + FAB；另一张 maxReached disabled FAB | 空态/FAB 两态 |
| F7 | worktree badge + 编辑中命名输入框 | badge、编辑态 |
| F8 | WaitingInputNotification 浮卡 | 全局浮层 |
| F9 | light 主题全景（F1 同布局） | 主题切换 |

固定条件：窗口 1440×900@2x、禁动画（动画统一 0s 或注入 prefers-reduced-motion 处理）、固定 fixture 数据。

## 9. 明确不在复刻屏范围

CwdPicker / WorktreePopover / CloseConfirmDialog 弹层、TerminalSearchBar、真实 xterm 渲染、
worktree 注册异步校验、i18n 切换（fixture 固定中文）、拖拽过程动画帧。

## 10. M3 拖拽/分隔条交互（新增，批5③）

> §3.4/§1.3 已定「静态视觉态」（M2 复刻 golden 冻结：dragging opacity 0.4、drag-over amber 环、
> 把手 hover/active 辉光）。本段只补 **M3 起 bridge 模式下的交互过程**，既有静态样式与 golden 一字不动。
> 桥形状见 `docs/m3/m3-bridge-v2-draft.md` §3.2（reorder 方案 B）/§3.3（gridResize）。

### 10.1 启用门控（golden 保全）

- **仅 bridge 模式启用**：web 收到 `onAction` 才挂交互；截图 / 纯展示（`?screenshot=1` / 无桥宿主）
  下交互层全 inert——不挂 document 监听、不发任何 action、顺序/比例/拖拽态一律回落 fixture 字段。
- 静止态（无拖拽、无分隔条改动）DOM 与 M2 逐字节一致：列模板默认 `1fr`、把手位置默认均分、
  拖拽态取 `fx.dragging`/`fx.dragOver`（截图 F5 由 fixture 驱动，交互层零覆盖）。
- 事件监听不进序列化 DOM；新增可见元素仅 **ghost**（§10.2），且仅 bridge 拖拽进行时挂载 → 截图永不渲染。

### 10.2 拖拽重排（仅 Tiling）

- **拖柄 = header**（沿用 §3.4 `draggable`，HTML5 DnD）；compact/focused 不可拖。
- 起拖：拖起 tile 本地置 dragging（opacity 0.4，复用 M2 class）；隐藏原生拖影，改挂 **ghost**——
  `position:fixed` 跟随光标的浮块（新 class `.tile-drag-ghost`），显示该终端显示名（customName 或 cwd 末段）。
- 悬停：进入目标 tile → 该 tile 置 drag-over（amber 环，复用 M2 class）。
- 放下（drop-before，§3.4）：计算「dragged 插到目标之前」的新顺序 → 一次性 `sendAction(reorder{order})`
  （方案 B，全过程视觉本地、native 只拿最终顺序）→ **本地立即按新序乐观渲染**（不等快照回流，防闪烁）；
  快照到达后以其为准（native 为权威顺序源）。
- 取消：Esc / 拖出网格 / 落回自身 / 顺序未变 → 不发 reorder，本地态复原。
- 文件拖入（Files 类型）与本重排正交（重排走 pointer 起于 header 的 DnD；文件投放归内容区，§3.4）。

### 10.3 分隔条拖动（列/行比例）

- 拖动（pointer：把手 mousedown → document mousemove/mouseup）：本地实时改**相邻两格**比例，
  二者之和守恒、各格下限 0.1（§1.3）；每行列比独立、行高比独立。
- 双击把手：该行列比（或全行高比）重置为均分（§1.3）。
- **释放才发** `sendAction(gridResize{columnRatios, rowRatios})`（与 reorder「drop 才发」、editing「提交才发」同范式）。
- 网格形状变化 → 比例重建为均分（§1.3「会话内存态」）。形状 = **可见（未收起）**终端集的行列分布：
  开/关终端与**收起/恢复（§11，总数不变亦算）**均属形状变化；交互层行列数、把手播种、gridResize 载荷
  一律按可见数计（收起项不进网格，§11.1）。长度与当前形状不符的比例覆盖（本地态与持久化种子同律）
  一律回落均分——行比长度多于实际行数会令 flex-grow 总和 <1、网格尾部留死区（2026-07-17 真机回修：
  9 终端收起 3，行比按总数播成 3 份 ⅓ 套在 2 行上 → 窗口底部 ⅓ 空黑）。
- 拖动期间洞几何经 `layoutReport`（草案 §3.1，ResizeObserver+rAF 合帧 ≤60Hz、diff 才发）连续上报，
  原生 surface 随洞矩形同步。
  - ☆（DOGFOOD_M3_12 增补，2026-07-04）**surface frame 同步不变（逐帧即时）**；**PTY 网格重排为有界
    节流**——原生视图层 settle（trailing 80ms + maxWait 150ms）使拖动期重排 ≥~5.7Hz（提交间隔 ≤~175ms，对抗验收修正口径）、松手后 80ms 内
    精确终值。「实时重排」（PRD REQ-TERM_GRID-011）语义 = 有界延迟而非逐帧：逐帧 TIOCSWINSZ 会让
    前台程序（CC）每帧全量重绘、把中间宽度的硬换行烧进 scrollback（不可逆），legacy 因 xterm.js fit
    同步逐帧同有此烧毁面，本设计刻意收敛 ~9-10×。全语义见 terminal-rendering.md §1.2 ☆。
  - ☆（DOGFOOD_M3_13 增补，2026-07-04）**预览冻结语义显式化**：聚焦形态下非聚焦终端的 grid surface
    被摘除、PTY 网格**冻结在最后一次合法提交宽（= 其平铺宽）**——与 legacy suppressResize 冻结语义
    等价；恢复平铺经新 surface settle 重定。激活预览可键入（§2）而 PTY 保持冻结宽 = 刻意行为：预览
    内运行的程序按平铺宽折行，回平铺显示即对齐。冻结值曾可能是错误值（错误视口首帧烧写）——已由
    terminal-rendering.md §1.2 ☆（首帧收编/真值对账/视口守卫）根治，冻结恒为合法值。
  - ☆（m3-layout-r5 增补，2026-07-07）**「实时重排」语义第三次演化 + 网格下限钳制**：①上二条的
    maxWait 有界节流**退役**——一切连续几何流（分隔条、窗口边 live-resize、布局动画）一律 settle-only、
    松手（报文静默 80ms）一次到位（用户裁决；PRD REQ-TERM_GRID-011 原文只管辖竖向分隔条拖动、从不
    覆盖窗口 resize，_16 以其豁免窗口拖拽系错挂——五轮考证）。②**网格下限钳制（F6，用户拍板 A 案）**：
    tile 目标网格低于下限的轴钳到下限、不再更低——下限本体 = **680×396pt 物理排版空间**（一块「纸」，= 80×24 @ 默认 Menlo14；F8 勘误 2026-07-08：F6 初版固定格数隐含 cell 不变假设，字号放大后 80 格物理膨胀超出 tile 致右侧裁切不 reflow——活体案例六；格数下限随当前 cell 度量换算：字大排得少下限宽松、字小排得多 CC 更宽松；默认字号逐点不变。v1 常量，配置位后续里程碑）；小 tile 显示该
    「下限尺寸终端」的裁切窗口——列锚左，**行向光标跟随钳制、贴底优先**（F6b 勘误，2026-07-07 下午
    活体案例四：初版「恒锚底」把新 spawn shell 顶部的提示符裁出视图 → 用户新建第 4/5/6 个终端全黑；
    正确语义 = 可见窗口必须含光标行：offset = clamp((cursor.y+1)×cellH − viewH, 0, maxOff)，空会话
    锚顶、满屏锚底、光标出 viewport（回看）锚底）；被动 sidebarPreview 本地账
    不钳（真实几何供选区第二职责）。动机：八宫格把 CC 压到 29×19 长驻流式（活体案例二/三）= Ink 帧
    高于视口每次重绘烧一份，钳制后该 regime 消失；对终端内程序零耦合（纯几何）。残余地板明示接受：
    每静止期每会话 ≤1 次已应用 resize、单次仍可能烧一份轻残影（活动帧自愈），预算由风暴哨兵与
    e2e item29（原 18，合并窗口改号）断言（含新 tile 锚顶回归哨）。
  - ☆（m3-r7 增补，2026-07-09）**网格下限钳制第二次勘误：宽度轴退役（用户裁决 O1a）**：上条 ② 的
    680pt「纸宽」定谳为六轮未根治「终端文字右侧遮挡」P0 的恒态主因——一切 <680pt 的 tile（三列平铺
    默认字号 472pt/tile 实测）恒按 80 列排版、左锚 GPU 右裁 25 列（31%），且变窄方向永不 reflow
    （提交列钉死下限，392pt 时右裁加深至 42%）；真机日志 crossover 恰卡 680pt（665pt 钳 52 列 /
    694pt 跟随 53 列，用户字号 cellPx=26），红档+标尺像素证据见 m3-r7-red-e2e-item39.md。裁决后
    语义：**列恒随 bounds 真实容量**（窄 tile 完整 reflow 全可见），误拖极窄由 <10×2 退化防御兜底；
    **高度下限 396pt 保留**（F6b 光标跟随裁切、Ink 上擦预算语义均不变，F8「随字号换算」保留在高度轴）。
    上条 ② 的动机场景（八宫格压扁 CC）行向防护不受影响；宽向「29 列」类窄排版改为如实 reflow——
    活体案例二的烧录面由 settle 80ms + F7 输出静默门两道防线管辖（瞬态），持久窄布局属用户主动
    选择的形态、如实排版。常绿锚=e2e item39 + 单测 A10（断言形态一律「cols×cellW ≤ 视图像素宽」
    视觉根因条件，禁 cols≥80 结构断言——该断言形态正是六轮把右裁条件判绿的盲区）。

### 10.4 持久化与偏差记录

- **有意增强**：gridResize 释放时 native 持久化到 `config.gridLayout{columnRatios,rowRatios}`
  （草案 §3.3；legacy §1.3「比例不持久化」——本设计持久化，dogfood 期可回退）。
- **协议一维 vs 多行列比**：`gridResize` 载荷的 `columnRatios` 为一维；多行网格「每行列比独立」（§1.2）
  无法完整映射 → 取**第 0 行**列比为代表入持久化，其余行列比为会话内视觉态、不入持久化。
  单行网格（N≤3，dogfood 主形态）完整无损。`config.gridLayout` 回读复原属会话恢复路径，本批未接（见 M3 报告）。

## 11. 终端收起（左侧缩略边栏，批A 新增 2026-07-11；协议 v24）

> 纯新功能、无老 app 参照（dogfood 需求：CC 任务完成但暂不处理的终端「收起」——不占网格、
> PTY 后台照跑、随时找回）。UI 形态 = 用户从 9 方案 HTML 对比稿选定的「方案3·左侧缩略边栏」。

### 11.1 状态模型与协议

- 收起集为**投影态**：`TerminalSnapshot` 增 optional `minimized?: bool`（未收起**缺席**，既有
  fixture/golden JSON 字节冻结）与 `lastLine?: string`（**仅收起终端携带**，≤120 字符）。UIState 零新增
  （边栏折叠态是 web 本地态，不过桥、不持久化，重启回展开）。
- `ui.action` 增三变体：`minimizeTile{terminalId}` / `restoreTile{terminalId}` / `restoreAllMinimized{}`。
- **order 保序**：收起不动 order，仅置集合标志——恢复回原槽位。`reorder` 对收起槽位锁定
  （可见子序列置换、收起 id 钉原槽；无收起时与旧实现逐位等价）。
- 持久化：`config.openTerminals[].minimized?`（缺席=false 旧 config 兼容；未收起省略不膨胀）。
  重启恢复时收起态还原（恢复为收起 = 不建洞；末位 entry 若收起，选中回落首个可见项）。

### 11.2 收起入口与边栏形态

- 入口 = TileHeader 按钮组「收起」按钮（**「聚焦（最大化）」与「关闭」之间**——用户指定 2026-07-11；
  **仅 live 模式渲染**——fixture 屏不渲，golden 91 张零动，照 tile-dead-badge 先例）。图标 =
  **靠下横杠 ▁**（macOS 最小化语义；原对角收拢 ⤡ 因与聚焦 ⤢ 混淆被否 2026-07-12）。compact header
  （Focused sidebar 预览）不加。
- 边栏：网格容器左侧固定 **180px**（v1 不可拖），**空时不渲染**（无收起终端 = DOM 与旧渲染逐字节一致）。
  **默认折叠**为 **28px 细条**（dogfood 反馈② 2026-07-11：收起后不默认占 180px；
  折叠态为 web 本地态不过桥不持久化）：细条 = **逐收起终端一个点**（order 相对序、**统一淡灰
  `--text-muted`、不带状态色**——二轮修订用户裁决：收起 = 不想关注，状态不展示、绿点刺眼被否；
  **悬停自绘 tooltip = 终端名称**——customName||cwd 末段；工程注记：WKWebView 不渲染原生 title
  tooltip（真机定因），须 JS 浮层 portal + pointer-events:none）。**点圆点 = restoreTile 直接恢复
  该终端（不展开）；展开唯一入口 = 细条顶部展开钮（» ExpandIcon，CollapseIcon 镜像）**——dogfood
  反馈 2026-07-13 改版：原「点细条任意处展开」退役、细条背景不再响应点击（截图态 onAction 缺席
  圆点 inert）；展开态顶部折叠钮（« CollapseIcon）收回。展开钮与折叠钮为**同款常显芯片皮肤**（中性灰半透明底
  +muted 描边+主文字色，图标保持 12px 原大小——dogfood 反馈 2026-07-13 二/三轮：原透明底次级色
  近乎隐形，唯一展开入口必须一眼可见、镜像成对按钮颜色同步、只提亮不放大；细条底=--bg-elevated
  同色系故不可用主题底色作芯片底）。
- mini 卡（自上而下按 order 相对序）：状态点（映射沿 §3.1 三色）+ 标题（customName || cwd 末段，§4.3/§4.4
  同规则）+ 末行输出摘要（`lastLine` 单行截断，灰色小字）。
- `lastLine` 采样：native 心跳 **1Hz** 读该会话已物化渲染帧（`currentFrame`，只读不可变快照、不触 C API），
  自底向上取首条非空行、截 120 字符。内容盲原则豁免：量级 = 收起数 × 1Hz，仅入快照供人眼、零解析零决策。

### 11.3 恢复语义与交互矩阵

- 单击 mini 卡 = `restoreTile`：恢复回网格原槽 + **选中** + 隐含 wait acknowledge（与 tileClick 同型）。
- 卡右键菜单：恢复 / 关闭（关闭复用 term.command close 全链：活会话确认对话框、死会话直移除）。
- **卡行内关闭钮（悬停浮现 ×，dogfood 反馈 2026-07-13：列表页直接关终端，免逐个恢复再关）**：
  展开态 mini 卡标题行右侧，整卡悬停浮现（CSS display:none → :hover 显示，默认零几何盒）；
  点击与右键「关闭」同走 close 全链（活会话确认对话框、死会话直移除），stopPropagation 不触发
  卡片单击恢复；门控 = 关闭能力在场（onTermCommand/live 任一），截图态双缺席不渲 → golden DOM 零动。
- 边栏底部「全部恢复」= `restoreAllMinimized`（不改选中/焦点）。
- 交互矩阵：收起 **focused 主格** = 先回 Tiling 再收起（与 dropTerminal 焦点处理同型）；Focused 中收起
  sidebar 预览终端允许（预览高亮回落主格）；`maximizeTile(已收起 id)` 防御 = 先恢复再聚焦（native 收口）；
  收起终端死亡/等待留边栏、状态点跟随（waiting 计数照常入浮卡/dock 徽标）；收起选中项清 selectedId。
- 全部终端收起 → 网格区出提示态（「全部终端已收起」+ FAB 照常可建新终端）。
- **收起仍占 20 上限**（§6.1 语义不变；边栏徽标即计数提示）。

#### 收起飞行动画（dogfood-r6 反馈① 2026-07-12）

诉求：用户第一次点收起不知道终端「去哪了」，需要一个动态效果指向左（上）角收纳位。

- 设计（**幽灵框飞行**）：终端内容是 native Metal 直渲、web 拿不到像素，故动画主体 = **tile 的边框轮廓**。点收起按钮时 web 先取该 tile 的 `getBoundingClientRect` → **立即照常发 `minimizeTile`（不延迟真实收起，动画纯装饰不阻塞语义）** → 同时在 `document.body` 挂一个「幽灵框」`div`（`fixed` 定位、初始 = tile rect、圆角、半透明 accent 边框 + 极淡底、`pointer-events:none`）。
- 飞行（r6-fix 真机否决回修 2026-07-12）：**逐帧轮询等收纳点落位**（`.min-rail__dot[data-term-id="<id>"]` 系React 渲染+桥回程后才落 DOM，取证 B2 流式负载下显著迟到）至多 240ms——落位则飞真点（缩到 12×12 圆），超时/查不到（List 模式无点条）回退左上固定点；起飞前强制提交初始几何作 transition 基线；`transition ~380ms cubic-bezier(0.4,0,0.2,1)`，同时 `opacity 1→0`。
- 清理（r6-fix 真机否决回修）：`transitionend` 或 **起飞时刻起算 FLY_MS+250ms** 兜底移除——原「append 起算 500ms」在流式负载下截杀飞行尾段/整段（取证 B2：起飞被拖至 122ms+、500ms 硬杀线正好吞掉尾段），真机「完全看不见」由此。另有起飞前 1500ms 防泄漏兜底（rAF 全程缺席如窗口隐藏）。皮肤提亮：实心 accent 边框+微光（原 30% muted 在深底不可辨，幽灵钮提亮同款定因）。
- 无障碍：`prefers-reduced-motion: reduce` 时**不做动画**（直接跳过，只发 `minimizeTile`）。
- 实现 = `web/src/grid/minimizeFlyGhost.ts` 纯函数 `flyToRail(fromRect, terminalId)`，TileHeader 收起按钮 onClick 调用。`pointer-events:none` 不截击、无 `data-term-hole` 属性天然不进 layoutReport 洞清单。List 模式详情区收起按钮同挂（左栏「已收起」分组无点条 → 走固定点回退）。live-only（收起按钮 live 门控）→ 不入任何 golden。

### 11.4 保活与尺寸门（工程约束）

- 收起终端**不渲洞** → layoutReport 缺席其 rect → native surface detach（PTY 照跑、冻结最后合法宽，
  同 §10.3 Focused 预览语义）；恢复 → 洞重现 → 按 SessionID 重建 surface re-attach。
- **尺寸门（登记⑩延伸）**：重启恢复为收起态的终端永不进网格 → 无 layoutReport → `hasReceivedResize=false`
  → resume 注入 5s 超时按 spawn 默认 80×24 回放烧 scrollback。双层解：
  1. **持久化尺寸先行**（对抗回修 MINOR-1，2026-07-11）：`openTerminals[].cols/rows?`（加性 optional）——
     收起终端写回时带当刻会话尺寸；重启恢复为收起态且带尺寸 → **立即 resize 到持久化尺寸**（注入器
     直接过门，不等任何可见源）。覆盖「全部终端收起后重启」的持久无源场景（对抗验收发现：该场景下
     心跳拷贝永无源、5s 超时烧写不自愈）。尺寸为收起时刻快照（其后窗口变化不追新），恢复进网格后
     真洞 resize 收敛——近似值远优于 80×24。
  2. **心跳拷贝兜底**：`ensureBackgroundSized()` 把首个已收真实 resize 的可见会话（优先 selected）的
     cols/rows 拷贝给 `minimized && !hasReceivedResize` 会话（幂等；覆盖无持久化尺寸的旧 config 收起项）。
  极端兜底（两层皆无源：旧 config 无尺寸 + 窗口从未显示）仍走注入器 5s 超时，不劣于现状。

### 11.5 案例池（spec-coverage 强制，TG_MIN_* 族）

| 用例名 | 断言 |
| --- | --- |
| `TG_MIN_minimize_leaves_grid` | minimizeTile 后该 tile 不在网格渲染、快照 minimized=true |
| `TG_MIN_restore_returns_original_slot` | 恢复回 order 原槽位（保序）+ 恢复即选中 |
| `TG_MIN_restore_all` | restoreAllMinimized 清空收起集，不改选中/焦点 |
| `TG_MIN_rail_hidden_when_empty` | 无收起终端时边栏不渲染，DOM 与旧渲染一致（golden 守卫） |
| `TG_MIN_rail_collapsed_dots` | 折叠细条（默认态）= 逐收起终端一个淡灰点（无状态色）+ 悬停自绘 tooltip=终端名；顶部展开钮（» ExpandIcon）展开 |
| `TG_MIN_rail_dot_direct_restore` | 折叠细条点圆点 → restoreTile 直接恢复该终端（不展开）；细条背景点击不展开（展开唯一入口=顶部展开钮，2026-07-13 反馈改版） |
| `TG_MIN_rail_dot_inert_screenshot` | 截图态（无 onAction）点圆点 inert——不恢复不展开（golden 契约隔离） |
| `TG_MIN_reorder_preserves_minimized_slots` | 可见 tile 重排不改收起终端槽位 |
| `TG_MIN_minimize_focused_exits_focus` | 收起 focused 主格 → 回 Tiling 再收起（focusedId/activeSidebarId 清） |
| `TG_MIN_maximize_unminimizes` | maximizeTile(已收起 id) 先恢复再聚焦 |
| `TG_MIN_close_from_rail` | mini 卡关闭走 close 全链（活会话 pendingUserClose / 死会话直移除） |
| `TG_MIN_card_hover_close` | 展开卡行内关闭钮（悬停浮现 ×）：死会话点 × → close 直移除、活会话 → requestClose 确认对话框；stopPropagation 不触发恢复；截图态不渲（golden DOM 零动） |
| `TG_MIN_persist_roundtrip` | openTerminals[].minimized 写回/恢复往返（旧 config 缺席=false） |
| `TG_MIN_restore_size_gate` | 重启恢复的收起终端注入前获真实尺寸（主格拷贝），sizeReady=true 落地 |
| `TG_MIN_lastline_only_minimized` | lastLine 仅收起终端携带、非收起缺席（payload 冻结） |
| `TG_MIN_all_minimized_empty_hint` | 全收起 → 网格区提示态 + FAB 可用 |
| `TG_MIN_no_hole_for_minimized` | 收起终端零洞（layoutReport 无其 rect → surface detach、PTY 存活） |
| `TG_MIN_waiting_ack_on_restore` | restoreTile 隐含 wait acknowledge（与 tileClick 同型） |
| `TG_MIN_fly_ghost` | 点「收起」在 body 挂 `.min-fly-ghost` 幽灵框（携 data-term-id、`pointer-events:none`、不入洞清单）、**起飞后飞满 380ms 不被截杀**（cleanup 起飞起算）、动画后移除；`prefers-reduced-motion:reduce` 不产生（纯装饰不阻塞真实收起） |
| `TG_MIN_resize_visible_shape` | 有收起时拖行分隔条按**可见**形状播种（§10.3）：9 总收 3 → 播种 2 行、gridResize 载荷 rowRatios 长度 2、行 flex-grow 总和=1（无底部死区） |
| `TG_MIN_shape_change_resets_ratios` | 收起/恢复改变可见数（总数不变）→ 本地列/行比例重建均分、把手数随当前形状（§10.3 形状=可见集） |
