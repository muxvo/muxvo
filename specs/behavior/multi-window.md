# 行为规格：多窗口多网格（批C/D，V1.1 增强）

> 纯新功能、**无老 app 参照**（老版单窗口）——按核心原则一「先与用户共写行为规格再实现」落笔。
> §1-§2 架构定案由 Plan agent 复核现有代码（SessionRegistry / UIStateProjection / TerminalService /
> OrchAssembly / 任务中心 liveHole / ConfigStore）转写；**11 项用户裁决 2026-07-11 全部拍板**，逐项在对应
> 条款标注「用户裁决 2026-07-11」。V1 落地铁律 = **每窗完整功能、无主副之分**。
>
> 协议零新槽零新字段（每窗独立 hello / ui.state 流天然隔离，§7），**web 侧零必改**。本规格约束 native 壳
> （AppKit 窗口层 + Swift 装配）与持久化 schema；web 面板逻辑一律沿用现有单窗实现。
>
> 接缝来源：M4b 规格按「N 个宿主窗口、V1 实现 N=1」落笔（docs/REBUILD-PLAN.md V1.1 增强台账，
> 2026-07-07 发轨4）；本规格兑现 N>1，并按台账重裁终端上限（§3）。

## §0 定位与出界

### 0.1 V1 落地面

- **对等窗口**：每个 Muxvo 窗口是一套完整 UI——自己的网格 / 收起边栏 / 列表模式 / 文件面板 / 搜索栏 /
  面板视图（聊天历史 / Skills / MCP / Hooks / Plugins / 任务中心）。**无「主窗 vs 副窗」之分**，任一窗
  可关可留、可独立崩溃恢复。
- **共享会话池**：所有窗口的终端会话共用**唯一** SessionRegistry（§2）；「哪个终端显示在哪个窗」纯属
  各窗视图投影，会话本体不绑窗口。
- **共享编排域**：指挥台 / worker / 任务中心跨窗只有一份编排状态（§7），推送 fan-out 到全窗。

### 0.2 明确出界（V1 不做，归后续里程碑）

- **跨窗移动终端**：把 A 窗的终端拖到 B 窗——V1 出界（会话归属只随各窗投影，无「迁移」原语）。
- **跨窗 tab / 跨窗列表拖拽**：列表模式（批B）的行拖拽不跨窗。
- **每窗独立字号 / 独立主题**：字号、panelZoom、主题、showHiddenFiles **全局单值**（§5），一窗改全窗同步。
- **多指挥台**：指挥台全局唯一（§7、裁决⑤）；不支持每窗一个指挥台。
- **每窗独立编排推送选择性订阅**：V1 全窗同流（§7）。

## §1 窗口生命周期

> WindowManager（新装配件）持全部窗口上下文 `contexts`（每项 = 一套 WKWebView + 桥 + 瘦身
> TerminalService + UIStateProjection，§2）。`activeContext` 解析链（§6.1）：keyWindow → 最近活跃
> （last-active）→ 首窗兜底。

### 1.1 新建窗口

- 入口 =**菜单「文件 → 新建窗口」，快捷键 ⌥⌘N**（用户裁决 2026-07-11 ①；与「新建终端 ⌘N」/
  「新建指挥台 ⌘⇧N」区分）。
- 新窗**默认 1 个终端**，cwd = 全局 `config.defaultTerminalCwd`（缺省→native homePath）
  （用户裁决 2026-07-11 ④；与 FAB / ⌘N 新建同链 `createTerminal(cwd:)`）。
- 新窗 frame = **级联偏移**：以当前 activeContext 窗 frame 为基，向右下偏移 **25px**（WindowManager 自管，
  §4.4）；无既有窗时用持久化首窗 frame 或默认 1400×900。
- 新窗标题按 §6.3 编号规则命名。

### 1.2 关闭窗口（红叉分流，用户裁决 2026-07-11 ②）

判据 = 「是否最后一窗」× 「本窗是否有活终端」：

| 场景 | 行为 |
| --- | --- |
| **非最后一窗 + 本窗零终端** | 直接关窗，无对话框 |
| **非最后一窗 + 本窗有活终端** | 弹**原生确认对话框**（AppKit `NSAlert`，非 web 层 CloseConfirmDialog）；确认→**收割本窗全部会话**（逐一 terminate，registry 移除）+ 关窗；取消→不关 |
| **最后一窗（红叉或 ⌘Q）** | 走**既有退出确认漏斗**（quitConfirm，terminal-session.md 现有整机退出语义），不是单窗收割 |

- 关窗**删除该窗持久化分组**（`config.windows[]` 对应 entry 移除），**不复活**（用户裁决 2026-07-11 ③）——
  下次启动不再重建该窗。收割的会话既已 terminate，`terminal-active-sessions.json` 对应断点随之清理。
- **isShuttingDown 门**：整机 terminate 期（⌘Q / 最后一窗）逐窗析构会触发各窗 close 回调；该回调**不得**
  误删 `config.windows[]` 分组（否则退出即清空持久化、下次冷启无窗可恢复）。close 回调在 `isShuttingDown`
  为真时**只析构不改持久化**（用户主动关单窗才删分组）。

### 1.3 崩溃 / 冷启恢复（多窗还原）

- 启动读 `config.windows[]`（§4）：**逐 entry 建窗**、还原各窗 frame、按 entry.openTerminals 建终端占位。
- **恢复顺序铁律**：先逐窗建视图占位 + 聚合**全窗** openTerminals 求并集，**join 后跑一次** `hub.restoreSessions`
  （SessionHub 全局恢复层，§2；避免每窗各跑一次恢复层撞 registry / 断点文件）。
- 恢复为收起态的终端（§批A minimized）仍按 term-grid.md §11.4 尺寸门处理，逐窗投影各自还原本窗收起集。
- 旧扁平 config（无 windows[]）→ 合成单窗恢复（§4.2 迁移）。

## §2 会话归属模型

> 核心张力：编排域（OrchAssembly）与任务中心 liveHole **硬依赖单一 registry**（跨窗 resume 同一 worker
> 会话必须命中同一池）。故 registry 全局唯一，**windowId 不加在会话上**。

### 2.1 全局唯一 SessionRegistry

- 所有窗共享**一个** SessionRegistry：会话创建 / 查找 / terminate / wait 族 / hook socket 均走它。
- **会话不带 windowId**：运行时「归属哪个窗」= 各窗 `UIStateProjection.order` 是否含该 SessionID；
  持久化「归属哪个窗」= `config.windows[].openTerminals` 分组（§4）。二者是投影/持久化两个面，会话本体中立。

### 2.2 每窗一份 UIStateProjection

- 每窗一份 `UIStateProjection`（每窗 bus 单播天然隔离）。**snapshot 零加字段**——现有 fixture / golden JSON
  逐字节冻结（批A minimizedIds / 批B viewMode=List 等窗内态**自动按窗隔离**，无需协议改动）。
- 窗内投影成员 = 本窗可见 + 本窗收起终端；`order` / `focusedId` / `selectedId` / `minimizedIds` /
  `viewMode` / `searchBar` / `filePanel` / `panelMode` 全部窗内私有（§5 清单）。

### 2.3 TerminalService 纵向劈开（SessionHub + 瘦身 TerminalService）

- **SessionHub（新，全局单件）** 收全局件：registry / wait 族 / hook socket / 锚点 store / 恢复层
  （restoreSessions）/ GitStatusCache / DockBadge 聚合 / 心跳泵 / 全局字号 / chat 注入。
- **瘦身 TerminalService（每窗一份）** 留窗内件：projection / searchBar / filePanel / panelMode /
  quitConfirm / handleAction / mapSnapshot / persist（本窗分组）。
- **任务中心跨窗 liveHole 合法**：任意窗打开任务中心 resume 某 worker，经全局 registry 命中同一会话——
  即使该 worker 的可见 tile 在别的窗（或无可见 tile，仅占全局池）。这是单 registry 的直接收益，非缺陷。

## §3 上限两级

> 上限重裁（V1.1 台账兑现）：单窗上限沿用 M3 冻结值 **20**（RegistryPolicy）；新增**全局上限 40**。
> 内存实测每终端边际 ~2.4MB，40 无性能障碍，纯产品裁决。

### 3.1 两级判据（分层拦截）

- **每窗 20**：在 **projection 层先拦**（UIStateProjection 入维序前）。满员拒绝返**冻结文案，一字不动**：
  `已达最大终端数，请关闭不用的终端`（RegistryPolicy `maxReachedMessage`，**TERM_L2_83 oracle，逐字，禁改**）。
- **全局 40**：在 **registry 层后拦**（SessionRegistry 创建时）。满员拒绝文案（用户裁决 2026-07-11 ⑧）：
  `已达全局最大终端数（40），请关闭不用的终端或窗口`。
- 拦截顺序 = 先 projection（本窗 20）后 registry（全局 40）：本窗未满但全局已满时，落到 registry 层报全局文案。

### 3.2 maxReached 快照口径

- `snapshot.maxReached` = **本窗满（≥20）∨ 全局满（≥40）**。任一成立即置真——本窗 FAB / 菜单「新建终端」
  按 term-grid.md §5 / terminal-input.md §8 既有规则置灰 disabled（按窗独立判：A 窗满而 B 窗空则只 A 窗置灰，
  除非全局已 40 则全窗置灰）。

### 3.3 worker / 接管会话不占窗名额

- 编排 worker 会话、轻接管会话**只占全局 40 池，不占任何窗的 20 名额**（它们无窗内可见 tile、不入任何
  `UIStateProjection.order`）。故「全局 40」是含 worker 的硬顶，「每窗 20」只数本窗可见 + 本窗收起的人用终端。

## §4 持久化（schema v2）

### 4.1 schema v2 形状

`MuxvoConfig` 新增 `windows: [WindowEntry]`：

```
WindowEntry {
  windowId: String          // 稳定窗 id（生成即固定，不因关窗重排）
  frame?: {x,y,width,height} // 窗几何（WindowManager 自管，§4.4）
  openTerminals: [OpenTerminal]  // 本窗终端分组（现有 {id?,cwd,customName?,minimized?,cols?,rows?}）
  gridLayout?: GridLayout        // 本窗网格列/行比（用户裁决 2026-07-11 ⑪，每窗独立）
}
```

- 顶层旧字段 `openTerminals` / `gridLayout` / `window` **保留作首窗镜像**（§4.3 双写降级），不删——旧读者
  （回滚构建）仍能读到首窗内容。全局偏好（theme / fontSize / panelZoom / defaultTerminalCwd 等）仍在顶层
  单值（§5），**不进 windows[]**。

### 4.2 迁移（decode 缺席 → 合成单窗）

- decode 时 `windows` 缺席（旧扁平 config）→ **合成单窗**：`windows = [WindowEntry{windowId: 新生成,
  frame: 顶层 window, openTerminals: 顶层 openTerminals, gridLayout: 顶层 gridLayout}]`。
- 迁移**零丢失**：旧 config 的终端分组、命名、收起态、网格比全部落进合成的首窗 entry。旧 config 无
  windowId → 迁移时生成。

### 4.3 写侧双写降级兼容

- 写 config 时：`windows[]` 为权威；**同时把首窗（windows[0]）的 openTerminals / gridLayout / frame
  镜像回顶层** `openTerminals` / `gridLayout` / `window`。
- 目的：dogfood 期若回退到单窗构建，仍从顶层读到一套可用状态（首窗），不致空白启动。多窗信息（非首窗）
  在回退构建下暂丢——属可接受降级（用户重新开窗即可）。

### 4.4 frame 自管 + 旧 autosave 迁移

- **弃用 `setFrameAutosaveName`**：多窗下 AppKit autosave 按名持久化会串窗 / 竞态。改由 **WindowManager
  自管** frame：窗 move/resize → 防抖写回对应 `WindowEntry.frame`；建窗时读 entry.frame 还原。
- **级联偏移 25px**：新建窗以 activeContext 窗 frame 为基向右下偏移 25px（§1.1），避免叠窗。
- **首窗一次性迁移旧 autosave 键**：首次以 schema v2 启动时，若存在旧 `setFrameAutosaveName` 记录且
  首窗 entry 无 frame → 一次性读旧 autosave 键填入首窗 frame，之后不再读旧键。

## §5 全局 vs 窗内状态清单

> 划线原则：**「设备级偏好」全局**（一次设定作用全窗）；**「视图/焦点态」窗内**（各窗独立操作）。

### 5.1 全局态（SessionHub / 顶层 config 单值，所有窗同步）

| 态 | 载体 | 备注 |
| --- | --- | --- |
| 终端字号 | `config.terminal.fontSize` | 用户裁决 2026-07-11 ⑦：全局单值，一窗 ⌘+/-/0 改，全窗同步、持久化单值 |
| panelZoom（面板缩放） | `config.panelZoom` | 用户裁决 2026-07-11 ⑦：同上，全窗同步单值 |
| theme（主题） | `config.theme` / `terminal.themeName` | 全局，一窗切换全窗跟随 |
| showHiddenFiles | `config.showHiddenFiles` | 全局单值 |
| defaultTerminalCwd / dockBadge / language / chatArchiveEnabled | 顶层 config | 设备级偏好，全局 |
| Dock badge（等待计数） | SessionHub 聚合 | **全局聚合 Σ**：所有窗 waiting 终端总数（§5.3） |

### 5.2 窗内态（各窗 UIStateProjection / TerminalService 私有）

| 态 | 备注 |
| --- | --- |
| panelMode（终端/聊天/设置/任务中心…） | 各窗独立当前面板 |
| viewMode（Tiling/Focused/List） | 批B 列表模式按窗隔离 |
| minimizedIds（收起集） | 批A 收起边栏按窗隔离 |
| searchBar / filePanel | 各窗独立开合 |
| 焦点 / selectedId / focusedId / activeSidebarId | 各窗独立 |
| 网格列/行比（gridLayout） | 各窗独立，持久化进本窗分组（用户裁决 2026-07-11 ⑪） |
| waitingNotification 浮卡 | **窗内计数**：本窗 waiting 终端触发本窗浮卡（wait-detector.md 现有语义按窗独立） |

### 5.3 waiting 计数双口径（防混淆）

- **Dock badge = 全局聚合**：SessionHub 汇总所有窗所有 waiting 终端（含 worker），一个 Dock 图标一个数。
- **窗内浮卡 = 本窗计数**：term-grid.md §5「N 个终端等待输入」浮卡只数本窗 waiting、只在本窗非终端覆盖层
  显示（各窗 projection 独立驱动）。两口径并存不冲突（Dock 是设备级、浮卡是窗级提醒）。

## §6 菜单与快捷键路由

### 6.1 keyWindow 解析 + 兜底链

- 菜单命令 / 全局快捷键的目标窗 = **activeContext**：`NSApp.keyWindow` 对应 context → 无（如焦点在
  面板 modal / 无 keyWindow）则取**最近活跃**（last-active，WindowManager 记录）→ 再无则**首窗兜底**。
- 解析为纯函数（可单测）：给定 keyWindow id + last-active id + contexts 列表 → 目标 context。

### 6.2 逐键位归属表

| 键位 | 目标 | 说明 |
| --- | --- | --- |
| **新建窗口 ⌥⌘N** | WindowManager（全局） | 裁决① |
| 新建终端 ⌘N | activeContext | 在当前活跃窗网格建终端（term-grid.md §5 直建链） |
| 新建指挥台 ⌘⇧N | 全局唯一指挥台（§7、裁决⑤） | 已开→聚焦其所在窗 + selectTile；未开→开在触发窗网格 |
| 关闭窗口 ⌘W / 红叉 | 触发窗 | §1.2 分流 |
| 退出 ⌘Q | 全局（quitConfirm 只弹当前活跃窗，裁决⑩） | §6.4 |
| 字号 ⌘+/-/0 | 全局（§5.1） | 一窗触发全窗同步 |
| 面板缩放 ⌘⇧+/-/0 | 全局（§5.1） | 同上 |
| 其余面板/终端内操作 | activeContext | 各窗本地 |

### 6.3 窗口标题编号（用户裁决 2026-07-11 ⑨）

- 首窗标题 = **`Muxvo`**；后续窗 = **`Muxvo — 2`** / `Muxvo — 3` …
- **编号固定**：编号随 windowId 建窗序**一次性分配、不因关窗重排**（关掉「Muxvo — 2」后，新窗是
  「Muxvo — 4」而非补 2；避免用户记忆的窗号漂移）。

### 6.4 quitConfirm 只弹当前活跃窗（用户裁决 2026-07-11 ⑩）

- ⌘Q / 最后一窗触发的退出确认漏斗（quitConfirm）**只在当前 activeContext 窗弹一次**，不在每窗各弹一份。
  确认后走整机 terminate（§1.2 isShuttingDown 门）。

## §7 编排域适配

> OrchAssembly / 任务中心 liveHole 单 registry 依赖（§2）→ 编排状态全局一份，推送 fan-out 全窗。

### 7.1 指挥台全局唯一（用户裁决 2026-07-11 ⑤）

- 指挥台（console）全局至多一个：`⌘⇧N` 未开时→**开在触发窗网格**；已开时再按→**聚焦其所在窗
  （makeKeyAndOrderFront）+ selectTile**（滚到并选中指挥台 tile），不新建第二个。
- console-scoped PID 锚 token / console-home 所有权（M4b）不变——它们本就全局单例，天然适配多窗。

### 7.2 summon 路由（用户裁决 2026-07-11 ⑥）

- worker summon 通知（TUI 弹窗升级人类场景，需呼出窗口）点击 → **最近活跃窗（last-active）激活 +
  打开任务中心 + requestSelect 该 worker**。不新开窗、不猜测「worker 原属窗」（V1 worker 无窗归属）。

### 7.3 推送 fan-out（两窗同流同 seq）

- 编排推送（`data.event` / `orch.state` / `orch.transcript`）由 WindowManager **broadcast 逐窗 bus**
  fan-out：每个 context 的桥各收一份同内容、同 seq。
- **V1 幂等接受**：两窗同开任务中心看同一 worker → 各自渲染同流同 seq，属幂等重复渲染（非错误）。
  选择性订阅（只推「看着的窗」）归后续里程碑（§0.2）。

## §8 案例池（MW_* — C1 待接 → C2-D1 逐阶段实装销账，**D1 全量入闸**）

> **销账已毕（2026-07-11 D1）**：17 条 MW_* 全部实装、全部进 §8.1 **`| 用例名 | 断言 |`** 强制表，
> `check.mjs` 的 `multi-window §8` 池恒启用（1:1 兜底闸）。原 C1 阶段用 `待接用例名`（≠`用例名`）表头令
> 提取器天然不收、coverage 保持绿的过渡机制已完成使命——§8.2 待接表随 D1 清空并删除（下无「待接」段）。

### 8.1 全量实装（强制 1:1，spec-coverage 入闸）

> **2026-07-11 D1 收官：17 条 MW_* 全量入闸**（原 §8.2「待接用例名」表清空并删除；`check.mjs`
> `BEHAVIOR_POOLS` 的 multi-window §8 恒启用）。分阶段来源：批C C2「共享层抽取」（hub 广播半 / 每窗投影
> 隔离 / 纯函数路由，不依赖真开第二 NSWindow）+ C3「多窗开关/菜单路由/上限两级/关窗分流」（真开第二
> NSWindow 验完整竖切）+ C4「持久化 schema v2 + 迁移 + frame 自管」（两窗写盘往返还原 + 旧扁平合成单窗
> 迁移 + 关窗删分组，裁决③）+ **D1「编排域适配」（summon 落最近活跃窗 / 指挥台全局唯一 / 推送 fan-out
> 逐窗 bus / minimized·viewMode 按窗隔离；e2e item47 装配级双窗竖切）**。

| 用例名 | 断言 |
| --- | --- |
| MW_uistate_isolated_per_window | 同一 SessionHub 下两窗 TerminalService 的 UIStateProjection 独立：A 窗 createTerminal/selectTile 不入 B 窗快照（noteStateChange 的 order.contains 守卫丢外来 id；snapshot 零加字段） |
| MW_menu_routes_key_window | WindowManager.resolveActiveContext 纯函数：keyWindow 命中优先 → last-active 命中 → 首窗兜底 → 空 contexts 返 nil（§6.1） |
| MW_font_zoom_global | 一窗 ⌘+/-/0 经 hub.applyGlobalZoom 广播半：逐窗投影步进字号 + onFontSizeChanged 渲染广播 + 单值持久化 config.terminal.fontSize（裁决⑦，全窗同步半在 C3 接真第二窗） |
| MW_new_window_full_clone | ⌥⌘N 建的新窗是完整 UI（独立 service/composite/webView+bus、独立 NSWindow、共享全局 registry），默认 1 终端于 defaultTerminalCwd（裁决①④） |
| MW_per_window_cap20_frozen_message | 本窗满 20 → projection 层拒绝，文案逐字 = `已达最大终端数，请关闭不用的终端`（TERM_L2_83 oracle）；他窗独立仍可建（每窗上限隔离） |
| MW_global_cap40_message | 全局满 40 → registry 层拒绝，文案 = `已达全局最大终端数（40），请关闭不用的终端或窗口`（裁决⑧） |
| MW_maxreached_per_window_gray | snapshot.maxReached=本窗满∨全局满；FAB/新建终端菜单按窗独立置灰（全局满则全窗置灰） |
| MW_close_nonlast_keeps_others | 非最后一窗关闭：有活终端弹原生确认→收割本窗会话，其余窗与其会话不受影响、registry 全局池计数正确（裁决②） |
| MW_last_window_close_quit_funnel | 最后一窗红叉/⌘Q 走既有退出确认漏斗，非单窗收割（裁决②⑩） |
| MW_quit_persist_no_clobber | 关非最后一窗后顶层镜像反映存活首窗终端（收割窗删分组不 clobber 首窗，§4；C4 起 schema v2 windows[] 分组 + §4.3 首窗镜像回顶层） |
| MW_persist_restore_two_windows | 两窗各自终端分组 + 编号 + frame 写回 windows[]，重启（新装配读同一 config.json）逐窗还原、聚合全窗 join 求并集后跑一次 hub.planRestore（schema v2，§1.3 铁律，C4） |
| MW_legacy_config_migration | 旧扁平 config（无 windows[]）→ windowsForRestore 合成单窗，终端/命名/收起/网格比零丢失 + 双写镜像回顶层（§4.2/§4.3，C4） |
| MW_close_deletes_entry | 主动关非最后一窗 → 删该窗 config.windows 分组（裁决③不复活，下次冷启不重建）；isShuttingDown 期（⌘Q/最后一窗 terminate）逐窗析构不删分组（§1.2 门） |
| MW_push_fanout_all_windows | orch.state/transcript/data.event 经 WindowManager.broadcast fan-out 逐窗 bus，两窗同流同 seq（幂等接受，§7.3）——单测读两窗 bus queue 各入队一份、payload 逐字节等；e2e item47 装配级双窗竖切 |
| MW_summon_routes_active_window | summon 通知点击 → 最近活跃窗（activeContext）激活（makeKeyAndOrderFront）+ 开任务中心 + requestSelect（裁决⑥，§7.2）；其余窗零扰动 |
| MW_console_singleton | 指挥台全局唯一：未开开在触发窗（activeContext 网格）、已开则聚焦其所在窗（makeKeyAndOrderFront）+ selectTile 不重开第二台（裁决⑤，§7.1） |
| MW_minimized_viewmode_scoped | minimizedIds（批A）与 viewMode=List（批B）按窗隔离，A 窗收起/列表态不入 B 窗快照（§2.2/§5.2 各窗私有 projection） |
