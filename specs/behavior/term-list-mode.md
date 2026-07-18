# 行为规格：终端列表模式（批B 新增 2026-07-11；协议 v26）

> 纯新功能、无老 app 参照（dogfood 需求：小屏下平铺挤成多列不好用——改「左侧终端列表 240px +
> 右侧选中终端真详情」的紧凑形态）。UI 形态经用户拍板。与 term-grid.md 的 Tiling/Focused 并列为
> **视图模式三态**，仅新增 List 一态与其进出，既有两态语义逐字节不变。

## 0. 数据形状（复用既有，零协议新增字段）

- 协议 `ViewMode` enum 由 `["Tiling","Focused"]` 扩为 `["Tiling","Focused","List"]`（v26，唯一改动）。
- **action/UIState 字段零新增**：模式切换走原生菜单闭包（非桥消息）；左栏行点击复用 `tileClick`、
  收起行点击复用 `restoreTile`；详情=选中终端 = `selectedId`；无洞/尺寸门语义复用 term-grid.md §10.3/§11.4。
- 收起集（`minimized`）、`selectedId`/`focusedId`/`activeSidebarId` 语义与既有一致，仅进出 List 时按下文调整。

## 1. 三模式定义与进出

| 模式 | 形态 | 进入 | 退出 |
|---|---|---|---|
| Tiling | N 格平铺网格（term-grid §1） | 初始态 / restoreTiling / 从 List ⌘⇧L | ⌘⇧L 进 List、双击/最大化进 Focused |
| Focused | 主格 75% + 右 sidebar 25%（term-grid §2） | 双击 tile / maximizeTile（含 List 详情最大化） | restoreTiling（「回到平铺」）**恒回 Tiling** |
| List | 左终端列表 240px + 右选中终端真详情（本规格） | 菜单「显示 → 列表模式」⌘⇧L（自 Tiling/Focused 皆可） | ⌘⇧L 回 Tiling、详情最大化进 Focused |

- **⌘⇧L 是 List↔Tiling 二态 toggle**：List 态按 ⌘⇧L 回 Tiling（selectedId 保持，切回平铺后仍高亮该 tile）；
  非 List 态（Tiling/Focused）按 ⌘⇧L 进 List。
- **restoreTiling 恒回 Tiling、不记忆来路**（冻结此简单语义）：List 详情最大化进 Focused、再点「回到平铺」
  落 Tiling（而非回 List）。
- 菜单项「列表模式」= View 菜单内 ⌘⇧L，原生菜单动作、非桥消息（**菜单路径**零协议 action 改动）。

### 1.1 左下角幽灵钮（dogfood 追加 2026-07-12，用户九选一定方案 2）

除 ⌘⇧L 菜单快捷键外，网格区**左下角**常驻一枚幽灵切换钮（与右下角既有 ⊕ FAB 对角），供鼠标一键切换：

- **双向同位**：Tiling 显示 ☰（ListIcon，点击 → 切列表）；List **同位置**显示 ▦（GridIcon，点击 → 切回平铺）——
  两态同坐标，肌肉记忆一致。**Focused 不显示**（聚焦自带「回到平铺」钮，避免语义重叠）。
- **低调样式**（低频操作按钮要安静，用户口径）：26×26px 圆角 6px，平时 **text-primary @ opacity 0.55**、
  无底色融入背景（回修 2026-07-12：初版 text-secondary @ 0.35 真机深底不可见）；悬停 opacity 1 + 深底 chip；
  transition .15s。
- **过桥动作**：钮点击发 `toggleListMode`（新增 UIAction 变体，协议 **v30**，`fields: []`）→ native handleAction
  路由到与菜单同一 `projection.toggleListMode()`（List↔Tiling 二态）。这是本追加**唯一**协议改动（菜单路径仍走原生闭包）。
- **live-only**：仅 live 桥模式渲染（照 tile-minimize-btn 先例，`useLiveInteractions()` 非空才挂）；截图/纯展示零渲染 →
  golden 全量零 diff。钮浮在终端洞之上，照 FAB 先例挂 `data-hit-island`（命中岛，否则点击穿透下层 Metal 终端）。
- title 属性「切换到列表模式」/「切换到平铺模式」照写（WKWebView 不渲原生 tooltip——低频钮可接受无 hover 提示，
  title 供 e2e/单测锚点）。

## 2. 进 List 的选中缺省链与状态清理

进 List 时：
- `focusedId = nil`、`activeSidebarId = nil`（List 无 Focused 语义）。
- `selectedId = selectedId ?? focusedId ?? 首个非收起 id`（**缺省选中链**）：已有选中则保持；否则取焦点终端；
  再否则取 order 中首个非收起终端。全空 / 全收起 → `selectedId = nil`（空态，§6）。

## 3. 左栏（终端列表，240px 固定）

- 宽 **240px 固定**（v1 不可拖），自带不透明背景（照收起边栏 `.min-rail` 先例，透明洞不穿透列表区）。
- **非收起终端**按 order 渲列表行（`MiniTermCard` 的 `listRow` 变体：状态点 + 标题，复用 §11.2 卡结构；
  **无末行摘要**——对抗 MINOR-1 勘误 2026-07-11：`lastLine` 冻结为仅收起终端携带（§11.2 采样口径），
  可见项的实时内容属右侧详情区职责，行保持单行紧凑）；
  选中行左边框 accent 高亮（`selectedId === 行 id`）；点行 → 发 `tileClick{terminalId}`（复用既有选中 reducer）。
- **收起终端**入左栏底部「已收起」分组（灰显小标题 + 卡列表）；点收起卡 → 发 `restoreTile{terminalId}`
  （reducer 恢复出收起集 + 选中一步到位，§11.3 语义）。
- FAB 保留（照 term-grid FAB，可建新终端）。

## 4. 右详情（选中终端真交互）

- 右详情 = 选中终端的**完整 TermTile**（洞 `role=grid`、完整 header 全按钮可用、真终端可交互——非只读预览）。
- **恰一个洞**（`.tile-term-hole` 恰 1）：仅选中终端渲洞，其余非选中终端**不渲**（无洞、无 layoutReport）。
- **非选中 PTY 冻结**：非选中终端 surface detach、冻结最后合法宽、PTY 后台照跑（同 Focused 预览 §10.3 语义）；
  切换选中 → 旧详情 detach、新详情 attach。

## 5. 关闭选中顺延

- List 态关闭**选中终端** → 选中顺延 order 中该项之后**首个非收起 id**（无则 nil）；关闭非选中项不改选中。
- Tiling/Focused 关闭语义不变（现状 selectedId 清空）——顺延仅在 List 态生效。

## 6. 空态

- List 态无选中终端（全空 / 全收起 / 顺延到 nil）→ 右详情区渲空态占位文案；左栏「已收起」分组仍可点恢复。

## 7. 尺寸门泛化（引 term-grid.md §11.4）

- List 态**非选中的非收起终端**不渲洞 → 无 layoutReport → `hasReceivedResize=false`；从未选中者切为选中 /
  resume 注入前须先有真实尺寸，否则按 spawn 默认 80×24 烧写 scrollback（登记⑩）。
- 解：`ensureBackgroundSized()` 目标集从「收起终端」泛化为「收起终端 ∪ List 态非选中后台终端」——把首个已收
  真实 resize 的可见会话（优先 selected）的 cols/rows 拷贝给未定尺寸的后台会话（幂等；机制同 §11.4 第 2 层心跳拷贝）。

## 8. 案例池（spec-coverage 强制，TG_LIST_* 族）

| 用例名 | 断言 |
| --- | --- |
| `TG_LIST_toggle_menu` | toggleListMode：非 List→List（清 focused/activeSidebar）、List→Tiling（selectedId 保持）二态切换 |
| `TG_LIST_toggle_button` | 左下角幽灵钮（§1.1）：Tiling 渲 ☰ 发 toggleListMode、List 渲 ▦ 发同一动作、Focused 不渲、live-only（截图 fixture 不渲）、挂 data-hit-island；native handleAction(.toggleListMode) 路由到 projection.toggleListMode |
| `TG_LIST_default_selection` | 进 List 缺省选中链 selectedId ?? focusedId ?? 首个非收起 id；全收起 → nil |
| `TG_LIST_row_click_selects` | 左栏行单击发 tileClick，选中该终端（详情随之切换） |
| `TG_LIST_single_hole` | List 态恰一个洞（.tile-term-hole 恰 1）= 选中终端；非选中零洞 |
| `TG_LIST_detail_interactive` | 右详情 = 完整 TermTile（role=grid、完整 header），非只读 |
| `TG_LIST_minimized_section` | 收起终端入左栏「已收起」分组，点卡发 restoreTile（恢复 + 选中） |
| `TG_LIST_close_selected_advances` | 关闭选中终端 → 选中顺延 order 之后首个非收起 id；无则 nil |
| `TG_LIST_back_to_tiling_holes_restore` | List→Tiling 切回后 N 个非收起终端洞全部重现（洞数守恒） |
| `TG_LIST_maximize_from_detail` | 详情最大化进 Focused（focusedId=该终端）；restoreTiling 恒回 Tiling 不回 List |
| `TG_LIST_never_selected_size_gate` | List 态非选中未 sized 终端 → ensureBackgroundSized 后 hasReceivedResize=true 且 cols=选中终端 cols |
| `TG_LIST_empty_state` | List 态无选中（全空/全收起）→ 右详情空态占位；左栏收起分组仍可恢复 |
