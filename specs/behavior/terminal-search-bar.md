# 行为规格：终端内搜索条（Cmd+F）

> 提炼自老 app 实际代码（components/terminal/TerminalSearchBar.tsx 57 行 +
> TileEffects.css:478-523，挂载点 XTermRenderer.tsx:748，2026-06-12 读取），**只记行为不抄结构**。
> 新实现是纯展示组件 + fixture props；搜索执行（findNext/findPrevious/clearDecorations）
> 走 xterm SearchAddon，属 M3+ 渲染域，复刻屏不实现。

## 0. 数据形状（fixture 驱动）

```
searchBar { terminalId: string }   // 搜索条挂在哪个 tile 的内容区；query 固定空串（open-空输入态）
```

## 1. 挂载与定位

- 生产挂载点：终端内容区包裹层（`position:relative`、铺满 `.tile-terminal`）的直接子元素
  （XTermRenderer.tsx:748）。`visible=false` 时整体不渲染（组件 return null）
- 定位：`position:absolute; top:4px; right:8px; z-index:20`（TileEffects.css:479-482）
  —— 即贴终端内容区右上角，不遮 header

## 2. DOM 结构与样式（TileEffects.css:478-523）

`div.terminal-search-bar > [ form > input ] [ ▲ button ] [ ▼ button ] [ ✕ button ]`

- 容器：flex 行、`gap 4px`、bg `var(--bg-card)`、`1px solid var(--border)` 边框、
  圆角 6px、padding `4px 8px`、投影 `0 2px 8px rgba(0,0,0,.3)`
- input：宽 180px、透明底、`1px solid var(--border)` 边框、圆角 4px、padding `3px 6px`、
  `var(--font-mono)` 12px、色 `var(--text-primary)`、outline none、placeholder "Search..."
  - **focus 态：边框变 `var(--accent)`**（打开即自动聚焦，截图态为 focus 态）
- 按钮 ×3：透明底、`1px solid var(--border)`、色 `var(--text-secondary)`、padding `2px 6px`、
  圆角 4px、11px、line-height 1；hover 提亮（bg-hover + text-primary）
- 按钮字符：`▲`(U+25B2 上一个) / `▼`(U+25BC 下一个) / `✕`(U+2715 关闭)

## 3. 状态行为

- 打开（生产 Cmd+F）：visible=true → 渲染 + input 自动 focus
- Esc：清除高亮并关闭；Enter：找下一个；Shift+Enter：找上一个；✕：清除高亮并关闭
- 匹配计数/无结果反馈：老版**没有**（input + 三按钮即全部 UI）——screens.json 该 state 走 dom-assert
- 复刻屏只出「open-空输入」一张 golden（fixture id `sb-open`）

## 4. fixture 页挂载方式（两侧）

- 老 fixture 页：XTermRenderer 在 fixture 模式整体替换为 FixtureTermContent（XTermRenderer.tsx:88），
  搜索条不在 fixture DOM —— **fixture-only 直接受控挂载**：fixture-main 量取目标 tile 的
  `.tile-terminal` rect，body 下挂 fixed 同矩形包裹层（内衬 relative 满幅层 = 生产包裹层等价几何），
  渲染真组件（searchAddon 注 noop 替身）
- 新 web：同一量取逻辑（fonts.ready 后量 `.tile-terminal` rect）+ 同名 class 渲染
  - live 路径（LiveSearchBar）目标 tile 定位按 terminalId（`.tile` 根 `data-terminal-id`，tileElsById）
    ——**不用下标**：收起/重排下 `.tile` DOM 集合与 `fx.terminals` 全量下标错位（fix/worktree-popover-
    anchor 加性注记 2026-07-13；fixture 屏静态路径仍下标、豁免见 popover/base.ts 头注）

## 5. M3 搜索执行行为（native 自实现，批5②）

> 复刻段（§0-§4）记 web 搜索条的**展示**；本段记 M3 起 native 侧的**搜索执行**。老 app 走 xterm
> SearchAddon，新架构无 xterm、libghostty-vt 亦无内建 search API（grid_ref.h 仅以「search state」举例
> tracked ref 用途，无检索函数）→ 自实现。web 侧展示行为与 §3 一致，仅把交互接到桥动作。

### 5.1 触发与显隐（native 权威）

- 打开：终端视图 Cmd+F（performKeyEquivalent 的 interceptSearch）→ 回调 app 层置
  `ui.state.searchBar { terminalId }` 并立即重推 → web 渲染搜索条并自动 focus（§3）。未接线的独立视图
  （测试）Cmd+F 放行给菜单系统。
- 关闭：Esc / ✕ → `searchClose` → native 清高亮 + 置 `searchBar=null` 重推 → web 卸载搜索条。
- 归属终端关闭时自动隐藏（防悬空引用）：push 时校验 terminalId 仍在终端列表，否则 searchBar 出 null。

### 5.2 匹配语义（会话 queue，与 vt feed 互斥）

- 检索域：整屏 SCREEN 坐标（scrollback + active），逐行经 grid_ref 取文本。
- 大小写不敏感：查询串与行文本均按 grapheme cluster 小写化后逐 cluster 比较。
- 子串、非重叠、左→右扫描；M3 **不做** regex / 全字匹配 / 高亮计数反馈。
- 宽字符（CJK）占 2 网格列（char 列 + SPACER_TAIL），命中列区间涵盖其占用的两列。
- 空查询 = 清高亮（搜索条仍开）。

### 5.3 命中列表与导航

- 命中按行升序、行内列升序排列，记当前命中下标 currentIndex（无命中 = nil）。
- 新查询（searchQuery）：当前命中选「viewport 顶端 SCREEN 行及之后的首个命中」，无则回列表首（环绕基准）。
- searchNext / searchPrev：环绕前进 / 后退当前下标。
- 导航后滚动使当前命中进入 viewport（已可见则不滚），落点近 viewport 中部。

### 5.4 高亮渲染（Metal 背景批，glyph 之下）

- 快照携 `searchHighlights [(viewport row, from, to, isCurrent)]`：RenderCoordinator 每帧按
  scrollbar.offset 把 SCREEN 绝对命中映射到 viewport 行，越界（滚出可见区）的命中不入帧。
- 全命中淡高亮、当前命中强高亮；overlay 绘在 glyph 之下，文本仍清晰可读。

### 5.5 桥动作（fire-and-forget，无响应）

- `searchQuery{terminalId,query}`（web 输入 debounce 后发）/ `searchNext`（Enter）/
  `searchPrev`（Shift+Enter）/ `searchClose`（Esc/✕）。native 执行不回 ui.action 响应，
  结果经下一帧快照的 searchHighlights + 滚动位置体现。
