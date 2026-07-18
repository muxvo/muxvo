# 行为规格：终端渲染（Metal 直渲 + 快照 + GlyphCache）

> **本规格无 legacy 结构可提炼**——老 app 用 xterm.js 在浏览器渲染，正是新版要根治的病根
> （桥 v1-frozen §1、ADR-001 §2）。权威来源：M0 三条架构合同（亲验 `app/Sources/MuxvoApp/TerminalAreaViewController.swift:3-9`
> + `app/Sources/MuxvoKit/MuxvoKit.swift:26-27`）+ 设计底稿 `m3-design-annex-A-term-core.md` §3 + vt C API 头文件
> （`~/Library/Caches/muxvo-build/artifacts/include/ghostty/vt/`，2026-07-02 核验常量名）。**只落行为/合同，不抄探针结构**。
> 状态：**v1-frozen**（2026-07-02 检查点⑨通过。spike S4 两个性能尾巴——帧 p99 18.74ms、input→pixel 草测 17.84ms——经用户睁眼确认不否决 C 案；检查点⑪ p99<16ms 硬线不放松）。裁决点 ★=用户裁决 ☆=独立 agent 裁决。
> target：`MuxvoTermRender`（TerminalSurfaceView / GlyphCache / FontConfig / Theme / TerminalSurfaceProviding 实现）。

## 0. M0 三条架构合同（逐字保留，本规格是其落实设计）

原文（TerminalAreaViewController.swift:3-9，M0「风险与发现」三条设计输入）：

1. **render state 归会话所有、多视图共读**——视图是无状态投影，attach 时从会话读 render state；绝不让多个视图各持 render state 同时 update 互抢 terminal dirty（`ghostty_render_state_update` 会消费 dirty 状态）。
2. **render state 更新由 dirty 驱动/节流**，不得在视图 draw 路径上与 PTY feed 同队列 sync 竞争（探针实测该竞争使 encode 最长等待 **15.4ms**）。
3. **glyph atlas 用多页 LRU**；探针的 2048² 单页装满整体重建**不得**带入正式实现。

接缝 = `MuxvoKit.TerminalSurfaceProviding`（MuxvoKit.swift:26-27「视图是无状态投影：attach 时从会话读 render state，绝不反向持有」）。M3 由 nil→真 provider。

## 1. 所有权与线程模型（合同①②的落实）

### 1.1 数据流图（抄附件 A §3.1）

```
PTY bytes ──(会话queue)──▶ vt_write ──标脏──▶ RenderCoordinator(会话queue, 节流)
    ──▶ ghostty_render_state_update(独占terminal, 同queue天然互斥)
    ──▶ 遍历 dirty 行构建/增量刷新 TerminalFrameSnapshot（不可变值 + generation++）
    ──▶ 原子指针发布 ──▶ 通知各视图 needsDisplay(main)
视图 draw ──▶ 只读最新 snapshot 指针（零锁、零 C 调用、零会话queue接触）──▶ encode ──▶ present
```

> ☆ needsDisplay 驱动的例外——**配色边沿显式 draw**（settings-dogfood 批，terminal-theme.md §5 出帧
> 条款）：isPaused+enableSetNeedsDisplay 下 idle/非 key 面的 needsDisplay 不保证真正出帧；视图在帧
> 投递回调内检测快照配色相对上次投递变化（主题切换 / OSC 10/11/4），变化即显式 `draw()` 一帧（main）。
> 常规 feed 帧仅多一次等值比较，无逐帧常驻开销。

- **唯一 updater** = 会话自己的 `RenderCoordinator`；`GhosttyRenderState` + row iterator + cells 缓冲全归 `TerminalSession`（vt 常量：`GHOSTTY_RENDER_STATE_DATA_ROW_ITERATOR` / `..._DIRTY`，`GHOSTTY_RENDER_STATE_DIRTY_{FALSE,PARTIAL,FULL}`）。dirty **只被消费一次**。
- 视图消费 update 后立即物化 **TerminalFrameSnapshot**（Swift 不可变值）；任意多视图（主视图 + focused sidebar 小预览）读同一份快照。**双视图问题从根消失**（探针 alwaysFullRebuild 绕法废弃）。
- 多物化一层的代价，换「row 数据在下次 update 后失效」这一 C API 生命周期约束对视图完全不可见。
- 行级 shaping 缓存从探针「视图内」上移到「快照构建器内」（按行内容 hash 缓存 shaping 结果），多视图共享成果。

### 1.2 节流（合同②）

- feed 只置脏标志；`RenderCoordinator` 以最小间隔 **~4ms** 合并调度 update+快照构建，全在会话 queue 上与 feed 串行；draw 路径读原子指针，**永不 sync 进会话 queue**（消除 15.4ms 竞争）。
- **立即通道**（跳过节流）：resize / 滚动 / 选区 / 焦点变化触发立即 update。
- `MTKView`：`isPaused=true + enableSetNeedsDisplay`，仅快照变化 / 光标闪烁相位 / 选区拖拽时重画。
- ☆（DOGFOOD_M3_12 增补，2026-07-04；**DOGFOOD_M3_13 同日修订**）**resize settle**：视图层网格
  提交经 `GridResizeSettler`（trailing 80ms + maxWait 150ms 混合）稳定后才调 `session.resize`；
  「立即通道的 resize」= settle 提交后的 resize。surface frame/视觉仍即时；网格提交在连续几何
  变化期有界延迟 ≤150ms。见文末修订记录。
  - ☆（M3_13）**首帧例外废除**：attach / refreshGlyphCacheForScale 度量重置**同经 settler**——
    「首帧直通」曾把错误视口首帧 rect（H-window 实录 333×569→31 列）无保护烧进 PTY。
    **唯一保留的立即提交 = updateFontSize（settled="zoom"）**：用户离散动作、bounds 为视图自身
    当刻真值（非上报几何，无陈旧视口可能）；被动预览收 zoom 广播只记本地账。settled 取证维度 =
    maxwait / trailing / zoom。
  - ☆（M3_13）**真值对账**：syncGridToBounds 早退与 settler.cancel 双条件 = 几何==lastGrid **且**
    lastGrid==session 真值（cols/rows）——只信视图私账曾把「外因烧窄」钉死成永久（唯一纠正入口被
    cols==lastGrid 早退挡住且 cancel 掉候选）；失配走提交路径自愈。
  - ☆（M3_13）**lastGrid 改义为本地几何账**：settle 候选挂起期即刻更新（选区列宽/autoscroll 边缘
    第二职责在 settle 窗内不瘸）；「是否已提交」由真值对账判定，不再由本账单独承担。
- ☆（DOGFOOD_M3_12 增补）**surface detach 契约**：宿主摘除 surface（layoutReport 缺席/visible=false/
  空 rects）**必须先调 `TerminalSurfaceView.detach()`（置 session=nil）再 removeFromSuperview**——
  否则被摘视图成僵尸：仍持会话引用，在字号广播/backing 变化/摘除瞬间的 viewDidMoveToWindow 链上以
  陈旧 bounds 驱动活会话 PTY resize（M3_12 取证实锤，烧窄段且卡死无纠正事件）。

## 2. TerminalFrameSnapshot 形状

不可变值类型，一次 update 物化一份，`generation` 单调 ++：

```
TerminalFrameSnapshot {
  generation: UInt64                      // 单调递增；bench 打点 & 断言用
  cols, rows: Int
  rows: [RowSnapshot]                     // 视口行（含 shaping 结果引用）
  cursor: { x, y: Int; style: .block|.bar|.underline|.blockHollow; visible: Bool; blinking: Bool; passwordInput: Bool }
  colors: { background, foreground: RGBA; cursor: RGBA?; palette: [RGBA;256] }   // 有效色，见 §4
  selectionRanges: [(row: Int, from: Int, to: Int)]  // 每行选中区间（vt ROW_DATA_SELECTION）
  scrollbar: { total, offset, len: Int }?  // viewport 非 active 或本次滚动过时才填（§5）
  viewportActive: Bool                     // GHOSTTY_TERMINAL_DATA_VIEWPORT_ACTIVE
}
RowSnapshot { cells: [Cell]; dirtyOnBuild: Bool }
Cell { grapheme: String; fg, bg: RGBA; styleFlags: OptionSet; selected: Bool }
```

- 字段直接映射 vt render state 数据键：cursor 从 `GHOSTTY_RENDER_STATE_DATA_CURSOR_{VISIBLE,VISUAL_STYLE,BLINKING,PASSWORD_INPUT,VIEWPORT_X,VIEWPORT_Y}` 读；行 cells 从 `GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_{RAW,STYLE,FG_COLOR,BG_COLOR,GRAPHEMES_UTF,SELECTED,HAS_STYLING}` 读；选区从 `GHOSTTY_RENDER_STATE_ROW_DATA_SELECTION` 读。
- 快照是**渲染的纯函数输入**：draw 只读它，不查 terminal。

## 3. GlyphCache（多页 LRU atlas，合同③）

- **页规格**：灰度 `R8 1024²×≤8 页`（常规字形），彩色 `RGBA8 1024²×≤4 页`（emoji）；页内 shelf packing。探针 2048² 单页方案作废（合同③禁）。
- **条目**：`glyphKey → (page, rect, 页世代号, lastUsedFrame)`。
- **淘汰单位 = 页**：全满且放不下时回收 `lastUsedFrame` 最老的整页、页世代号++（引用旧世代的行缓存自动失效重排），被驱逐字形按需重栅格。
- **硬约束（合同③验收）**：任何一帧内不得整体重建全 atlas；驱逐只在**帧边界**执行；暴露 `fullRebuildCount` / `pageEvictionCount` 计数器供测试断言（`fullRebuildCount==0`）。
- **归属**：app 级共享（按 字体描述符+字号+scale keyed）；sidebar 小预览用同一 atlas 走变换缩放绘制，**不另建小字号页**。
  - ☆ **预览恒被动（DOGFOOD_M3_10，2026-07-04，独立 agent + 本单）**：sidebarPreview 视图**永不驱动 `session.resize`**（`TerminalSurfaceView.drivesSessionResize`，host `applyLayout` 按 `role == .grid` 置位——grid 主视图 true、预览 false）。预览几何绝不改共享 PTY 网格：否则窄预览把 CC 压成窄列，硬换行（`\n`）烧进 scrollback **不可逆**（用户 2026-07-04 报「聚焦其一后，侧栏另一终端内容折成 6-8 字符窄条、恢复平铺仍窄」的根因——视图对 session 网格的所有权洞）。legacy 三方对照：compact/sidebar tile 传 `suppressResize=true`（`../muxvo-legacy` `TerminalTile.tsx:159`）→ `XTermRenderer.tsx:514` 直接 BLOCK winsize 推送，预览从不动 PTY；本合同是该语义的新版落实。**本句「走变换缩放绘制」暂缓**：本单先落「被动化 + 原尺寸左上裁剪」止血（零渲染改动），变换缩放正解（scale uniform + 指针映射除法 + golden 重生成）由后续单落地，届时撤销本暂缓注记；「同一 atlas 不另建小字号页」不变。

## 4. 主题 / 字号 / 光标默认值

### 4.1 FontConfig + 度量

- `FontConfig(family, size)`，默认 **14pt**（TERM_L1_09/L1_17）。cell 度量（advance/ascent/descent → cell px）喂 `ghostty_terminal_resize`（真实 cell px，供 XTWINOPS/图片协议）。

### 4.2 主题（Theme）

- fg/bg/cursor + 256 palette 经 `GHOSTTY_TERMINAL_OPT_COLOR_{FOREGROUND,BACKGROUND,CURSOR,PALETTE}` 设为 terminal 默认色；`GHOSTTY_TERMINAL_OPT_COLOR_SCHEME` 用 `GHOSTTY_COLOR_SCHEME_DARK`（默认，TERM_L1_10/L1_16）。
- **OSC 4/10/11/12 覆盖语义由 vt 处理**，渲染端只读 render state 的**有效色**（`GHOSTTY_RENDER_STATE_DATA_COLOR_{FOREGROUND,BACKGROUND,CURSOR,PALETTE}` + `..._COLOR_CURSOR_HAS_VALUE`），不自己合成。
- ☆ **M6 主题批**：默认色支持运行时重注（切 `terminal.themeName` → 所有已开会话重注 4 option + `forceFull` 立即重绘，terminal-theme.md §5）；注入机制 / 有效色读取管线不变（仍读 render state 有效色，OSC 覆盖层照旧保留）。

### 4.3 光标

- 样式/可见/闪烁全从 render state 读：`VISUAL_STYLE`（BLOCK/BAR/UNDERLINE/BLOCK_HOLLOW）、`VISIBLE`、`BLINKING`——DECSCUSR 天然生效。
- **闪烁**：视图侧 ~500ms 相位 timer，仅 focused 且 `BLINKING==true` 时翻转，键入即重置相位；失焦画 hollow block（`BLOCK_HOLLOW`）。
- **默认 block + blink**（TERM_L1_18 cursorStyle==.block / TERM_L1_19 cursorBlink==true）：从 settings 注入 `GHOSTTY_TERMINAL_OPT_DEFAULT_CURSOR_STYLE` = BLOCK、`GHOSTTY_TERMINAL_OPT_DEFAULT_CURSOR_BLINK` = true。
- **偏差发现①（澄清非冲突）**：vt 无「闪烁样式」枚举——闪烁是独立布尔 `..._CURSOR_BLINKING`，不是第 5 种 VISUAL_STYLE。快照据此分「样式」与「闪烁」两字段（§2），附件 A 措辞「block+blink」在此拆解。

### 4.4 默认值合同（承接 7 条默认 spec）

以下值为 `MuxvoTermCore` 默认配置常量，round-trip 断言落 `MuxvoTermCoreTests` / ConfigStore（批 1）：`fontSize==14`（TERM_L1_09/L1_17 两并存 key，legacy 形状）、`theme=="dark"`（TERM_L1_10）、`terminal.themeName=="dark"`（TERM_L1_16）、`cursorStyle==.block`（TERM_L1_18）、`cursorBlink==true`（TERM_L1_19）、`startupTerminalCount==1`（SETTINGS_L1_01）。本规格只定「这些默认如何注入 vt / 渲染」，存取形状断言归 terminal-session.md §9 + ConfigStore。

## 5. Scrollback 滚动 + scrollbar + 自动回底

- **滚轮**（无鼠标追踪 / 按住 Shift）→ 会话 queue `ghostty_terminal_scroll_viewport(GHOSTTY_SCROLL_VIEWPORT_DELTA, n)` → 立即 update；Cmd+Home/End → `..._TOP` / `..._BOTTOM`（滚轮/alt-screen 细节归 terminal-input.md §滚轮）。
- **键入自动回底**：写 PTY 前若 `GHOSTTY_TERMINAL_DATA_VIEWPORT_ACTIVE==false` 先 scroll `..._BOTTOM`（终端惯例）。
- **scrollbar**：快照构建时按需查 `GHOSTTY_TERMINAL_DATA_SCROLLBAR`（头文件警告开销大——**仅在 viewport 非 active 或本次有滚动**时查询）；overlay 自绘窄条，滚动/悬停显示、闲置淡出；离底显示「跳到底部」浮标。total/offset/len 来自 vt（数学一致性断言，§7）。
- ☆ **scrollbar 拇指可拖拽（DOGFOOD_M3_11，2026-07-04，独立 agent + 本单）**：拇指**可见时**（overlay `opacity>0`，即滚轮/悬停/离底显形后）鼠标可拖拽快速定位——行业惯例、长 scrollback 回看刚需（用户 2026-07-04 报「拇指拖不动、只能滚轮」）。此前 overlay 仅显示腿、拇指区点击落进焦点/上报/选区路径、拖它零效果。
  - **命中区**：拇指现场 frame（`ScrollbarGeometry.thumbFrame`，mouseDown 用 `bounds`+最新快照**重算**，不用 GPU draw 路径滞后的 `layer.frame`——后者仅 renderFrame 更新）横向右缘 `hitWidthPx=12pt` 带、纵向 `±hitSlopPx=4pt`（Fitts 容差）。`opacity==0`（不可见）**不命中**（不可见不可拖，悬停/滚轮即显形；淡出残影 0.25s 窗口保守可接受）。
  - **grabOffset**：mouseDown 记指针相对拇指顶的偏移（clamp 进 `[0,thumbH]` 防 slop 跳变），拖动全程维持抓点不跳。
  - **反算**：`ScrollbarGeometry.offsetForThumbDrag`（与 `thumbFrame` 逐字同式的 trackH/thumbH/travel，含 minThumb clamp 分支；`travel≤0→nil`；round、maxOffset clamp）把指针 y → 目标 offset；与正向 `thumbFrame` 往返误差 ≤0.5 行（≤1 行断言，§7）。
  - **定位（`.toOffset`）**：`session.scrollViewport(.toOffset(target))`——queue 内读 ghostty 真值 scrollbar → clamp → `≥maxOffset 贴 ..._BOTTOM`（viewportActive 恢复、跳底浮标自动收）/ `==0 贴 ..._TOP` / 否则 `..._DELTA(clamped−真值 offset)`。**原子**（读真值+算 delta+滚动同 queue 事务），消除「视图侧快照 offset 算 delta」的一帧竞态——CC 拖拽中持续输出场景每 drag 事件按最新快照绝对反算，无漂移积累、单帧陈旧下一事件自愈。
  - **不进上报/选区**：mouseDown 命中拇指 = 独立序列（`scrollbarDragging` 标志，与 `mouseConsumedByReporting` 互斥同款心智），插入点在**焦点跟随之后（`onUserClick` 照发，item3/DOGFOOD_M3_06 语义保留）、`tryReportMouse` 之前**（硬约束——CC vt tracking 活跃时拇指点击不得被上报吃掉）；drag/up 走拖拽分支，不起文本选区、不写 PTY。序列结束（mouseUp）后拇指区外新按下照旧走选区/上报。
  - **淡出抑制**：拖拽期显式 cancel `showScrollbar` 的 1.2s 淡出 work + `opacity=1`（离底逐帧续命，但「拖住不动无新帧」1.2s 仍会淡掉），mouseUp 重武装淡出。
  - **轨道点击不做**（明写防误读为遗漏）：overlay 只画拇指、轨道无视觉 affordance，点隐形轨道是惊吓行为——仅拇指命中带响应，轨道其余区域维持原语义（选区/上报）。
  - **预览一致性**：预览视图零特判自然成立——拖拽与滚轮/键入共享同一会话作用，预览小拇指拖拽同步驱动共享 viewport（`.toOffset` 走会话 queue，与 `drivesSessionResize` 无关，被动视图照样可拖）。
- scrollback 容量 = 10000（terminal-session.md §6.2；vt `GHOSTTY_TERMINAL_DATA_SCROLLBACK_ROWS` / `..._TOTAL_ROWS` 读回验证）。

## 6. 终端 golden 工具与授权制

- GPU 侧：Metal 离屏渲到 `MTLTexture` readback，做「终端 golden」本地工具（5-10 张：基础文本 / ANSI16 / truecolor / CJK+emoji 宽字符 / 选区 / 光标样式 / scrollback 中位）。
- 沿用「本机字节冻结、即截即 commit、不进 CI」纪律；**新授权清单 `specs/term-golden.json`**（终端真内容 golden 唯一授权，**不混用 `screens.json`**，screens.json 恒为 web 全窗 golden）。
- GPU 测试以 `MUXVO_GPU_TESTS=1` 门控，preflight 可选步。

## 7. 验收断言表（附件 A §3.7 全表，机器可验无 GUI）

全部走 `spawnShell:false` 隔离会话 + 快照检查：

| 项 | 断言 |
|---|---|
| 合同① | 双假视图 attach，feed 一次 → update 恰一次、两视图读到**同 generation 同内容** |
| 合同② | 突发 feed 10k 块 → update 次数 ≤ ⌈时长/4ms⌉+1；draw 线程读快照期间并发 feed 不崩不撕裂（**TSan** 跑） |
| 合同③ | 灌超单页容量的 CJK 字形集 → `fullRebuildCount==0`、早期字形仍可解析、`pageEvictionCount` 合理 |
| 滚动 | 24 行视口灌 100 行 → TOP 后快照首行==第 1 行；离底继续 feed → offset 不动、`VIEWPORT_ACTIVE==false`；scrollbar total/offset/len 数学一致 |
| 选区 | gesture press(0,0)→drag(5,0)→release → 行 0 区间 0...5；复制文本==期望（选区/复制细节 terminal-input.md） |
| 主题/光标 | 快照 bg==dark 主题色；OSC 11 覆盖后变、清除后回默认；DECSCUSR 3 → underline |
| IME | 直接调 NSTextInputClient 方法：setMarkedText → overlay 模型态；insertText → 假会话记录 PTY 写入（terminal-input.md §IME） |
| 预览被动（DOGFOOD_M3_10） | 双视图共享同一会话：grid 视图定宽网格后，sidebarPreview 视图（`drivesSessionResize=false`）attach + layout + updateFontSize 全程**不改** session cols/rows（`SurfacePassiveResizeTests` A/B）；host `applyLayout` 按 role 置位、聚焦往返网格复原（host 层 C + e2e item11） |
| scrollbar 拇指拖拽（DOGFOOD_M3_11） | 纯函数：`offsetForThumbDrag` 与 `thumbFrame` 往返 ≤1 行（4 组参数×offset×grabOffset，含 minThumb clamp/短内容/travel≈0）、边界 nil（total==len/travel==0）+ clamp（拖出轨道→0/maxOffset）、`dragHitRect` 含/排斥；视图（隔离会话+滚轮预热显形）：拇指按下→拖动→抬起不起选区（`hasSelection()==false`）不写 PTY、offset 向目标移动（到顶 0/到底 `viewportActive`）、vt tracking 开时拇指优先零上报、`opacity==0` 走选区、序列后拇指区外新按下选区路径复原、拖拽期淡出抑制（`scrollbarDraggingForTest`）；`.toOffset` 会话侧：中段定位 offset==目标、`≥maxOffset→viewportActive`（`ScrollSupportTests` + `ScrollbarDragTests` + `SelectionControllerTests`；e2e item7 扩拖拽段） |
| Shift+Click 扩展选区（DOGFOOD_M3_17） | 会话侧（`ShiftClickExtendControllerTests` 11 用例）：点选区后→copy==start..click（FORWARD）、点前→`selectionReversedForTest`==REVERSE+copy 终端序正确、点中间→收缩 start..click、**anchor 存续实证**（单击 release 后 shift-click→anchor..click；实测 `DATA_ANCHOR` 存续、备胎 C 未启用）、无锚首击→退化普通 press+后续 drag 起选、跨 scrollback（底部建选区→上滚→shift-click 顶行首→copy 跨页整段 hasPrefix "L0-"）、shift-click 后 drag→end 随动 start 不动+release 保留、extend 后普通 click 照清（位不泄漏）、500ms 内连击→仍 extend 不升 WORD、tracking 开 Shift 旁通→`encodeMouseReport`==nil+仍 extend、`clearSelection` 后防御退化；视图侧（`ShiftClickExtendTests` 红锚转绿）：建选区后 Shift+Click 别处→扩展锚点到点击整段（6 行）非清除；e2e item17（建选区→滚离→Shift+Click→扩展+Cmd+C 剪贴板直证） |

- **渲染无 GUI 验证三层**：快照层断言（本表，无 Metal）、GPU 离屏 readback（`MUXVO_GPU_TESTS=1` 门控本地跑）、终端 golden 工具（本地字节冻结，不进 CI）。测试组织：`MuxvoTermRenderTests`（带 vendor 链接 flags）。

## 8. bench_input_to_pixel（p99 < 16ms，与渲染重构同 PR 取证）

> 归本规格记录（宿主/链路/判据），实现落批 4 `muxvo-term-bench`。

- **宿主**：app/ 新 executable `muxvo-term-bench`（**不用 probe-cli**——须测产品渲染路径：会话 queue→快照→TerminalSurfaceView encode→present；起最小 AppKit app 真窗口 80×24）。
- **打点链路**：程序化注键 t0（直调视图输入路径，绕系统事件队列）→ key encode → PTY write → `/bin/cat` echo → PTY read → vt_write（echo 字节到达）→ update（记 generation g）→ 首个含 g 帧的 `commandBuffer.addCompletedHandler` 记 t1（另记 present 时刻作参考列）。
- **素材**：主判据场景 `/bin/cat`（echo 走行规程，确定性最高）；参考场景 `zsh -f` 提示符（只记不判红）。N=1000 击键、50ms 间距防合并。
- **判据**：p99 < 16ms 硬线；相对退步线 = p99 > max(16ms, 基线×1.25) 即红。基线落 `app/reports/bench_input_to_pixel-baseline.md`（机器/分辨率/字体/场景全记录）。
- **「同批取证」窗口**：渲染重构 commit 系列完成、push main 前，须完成并 commit：bench_input_to_pixel 基线 + 复跑 bench_vt_ingest 无退步 + probe-cli stress 三项（fanout/mem/scroll）无断档；对抗验收（检查点⑪）复跑后才 push。

## 修订记录

- **2026-07-04（DOGFOOD_M3_12）**：用户反馈「终端内容间歇性只占左半宽，同屏窄/宽段交替」。取证
  （log stream 抓 com.muxvo resize 流）实锤两根因：①**僵尸 surface**——宿主 detach 只
  removeFromSuperview 不调 view.detach()，被摘 grid surface 仍持会话引用，在字号广播/backing 变化时
  以陈旧 bounds 驱动活会话 resize（`vt=false pty=true` 日志铁证），值变化时 SIGWINCH 烧窄段且 PTY
  卡死（无纠正事件）；②resize 全链零节流——分隔条拖动/窗口 live resize/macOS 半屏平铺的逐帧几何流
  每帧 TIOCSWINSZ，CC 逐帧重绘放大烧毁面。修复 = detach 契约（§1.2 ☆）+ GridResizeSettler settle
  （§1.2 ☆；PRD REQ-TERM_GRID-011「实时重排」语义 = 有界延迟 ≥~5.7Hz（间隔 ≤~175ms）而非逐帧，见 term-grid.md §10.3 ☆）。
  已烧进 scrollback 的窄段硬换行不可恢复（vt reflow 只救软换行）。v1-frozen 主体不变，本条为增补留痕。
- **2026-07-04（DOGFOOD_M3_13）**：三修未根治后全新排查定谳根因链四件套：①**H-window 窗口坍缩
  （源头）**——`window.contentViewController = root` 按零 frame root 视图重设窗口、被 minSize 钳到
  1024×612 内容区，**每次冷启动窗口真实就是该尺寸**，web 首帧在此测量（用户 stty 28×31/28×72 =
  该视口下平铺/聚焦几何，51×136 = 手动拉大后真宽；W1 红锚实测 1024×612）；②首帧例外直通把错误
  视口 rect 无保护烧进 PTY；③无真值对账使外因烧窄被钉死永久；④聚焦 detach 冻结在错误值 +
  resume 重放放大。修复：MainWindowController 赋值后 setContentSize+center+frameAutosave（阶段0
  已发）；§1.2 ☆ 首帧例外废除/真值对账/lastGrid 改义（本条）；layoutReport 陈旧丢弃高水位闸 +
  viewportW/H 视口一致性拒收（协议 v4，桥草案 §3.1）；resize/commitGrid/报文日志 .notice 持久化 +
  窄化 .error（用户裁令「多加日志」——事发时间线不再丢）。e2e 曾因 harness 显式 setFrame(1440×900)
  把 H-window 挡在盲区（E2EScenario.swift:77 教训：装配必须与生产同路径）。v1-frozen 主体不变，
  本条为增补留痕。
- **2026-07-06（DOGFOOD_M3_17）**：用户反馈「先选中一处、滚到别处按住 Shift 点击，希望选区扩展为
  锚点到点击整段」。定性 = **行为对等缺口**（非违背）：此前 Shift+左键落进普通清选区 press。三方对照：
  legacy xterm.js 6.0.0 `SelectionService.ts:478-479/523-527`「有 selectionStart 时只移 selectionEnd
  到点击点、start 固定」= incremental 惯例。独立设计 agent 裁：固定端 = 逻辑 start（方向保持端），点后
  FORWARD / 点前 REVERSE（不归一化）/ 点中间收缩 start..click（非最近端）。改动点：§7 验收表加 Shift+Click
  扩展选区行；细节归 terminal-input.md §4 ☆（`SelectionController.extendPressOnQueue`/`fixedStartRef`/
  `extendDragActive`、`TerminalSession.selectionPress(shiftExtend:)`、`TerminalSurfaceView.mouseDown` 传
  `.shift`）。anchor 存续实证（单测 ④）：gesture `DATA_ANCHOR` 单击 release 后存续，备胎 C 未启用。
  v1-frozen 主体不变，本条为增补留痕。
- **2026-07-07（m3-layout-r5，第五轮）**：四轮修复全在位的 main 3482559 上用户再复现（多宽度交错重复
  +反色残骸块）；本轮从原始证据重推定谳四层：R-A 窗口拖拽 maxWait 豁免每 ~150ms 内联提交中间宽度
  （_16 引 PRD REQ-TERM_GRID-011 为据系**错挂**——原文只管辖竖向分隔条，五轮考证）；R-B 预览 attach
  先于角色置位的 2x2 候选竞态（恒被 <10×2 拒=噪声+脆弱契约）；R-C 失配自愈在 settle 在途逐帧重录
  （settle-only 无 maxWait 兜底 → ≥12.5Hz 同几何流可饿死提交）；R-D 地板=每次已应用 resize 命中活动
  Ink 帧必烧一份（行业固有，平铺 UX 放大一个量级）。§1.2 ☆ 语义变更（用户裁决 2026-07-07）：
  ①**maxWait 退役**——一切连续几何流（含窗口边 live-resize）settle-only，「松手一次到位」= 报文静默
  80ms 后 trailing 提交（GridResizeSettler 类保留 maxWait 库存不启用）；②**角色先于 attach**——
  drivesSessionResize 经 makeSurfaceView 参数在 attach 前定死，commitGrid 增角色守卫，退化 bounds
  （低于 <10×2 换算）不产生任何账/候选，flush 提交前按现时 bounds 复核（消 TOCTOU）；③**失配自愈收敛
  静止期**——settler 在途不重录不告警，静止期真失配（外因烧写）保留自愈；④**网格下限钳制（F6，用户
  拍板 A 案；F8 勘误 2026-07-08：下限本体改 680×396pt 物理排版空间——=80×24@默认 Menlo14 逐点
  一致；格数随当前 cell 度量换算 gridFloor(cellW:cellH:scale:)，字号放大下限自动宽松、中等 tile
  重新 reflow 全可见，根治活体案例六「放大字号右侧裁切不适配」）**——驱动路径目标低于下限的轴
  钳到下限，小 tile 显示下限终端的裁切窗口：列锚左，
  **行向光标跟随钳制、贴底优先（F6b 勘误，2026-07-07 下午活体案例四——初版恒锚底把新 spawn shell
  顶部提示符裁出视图 → 新建 tile 全黑；offset = clamp((cursor.y+1)×cellH − viewHpx, 0, maxOff)，
  空会话锚顶/满屏锚底/光标出 viewport 锚底）**；contentYOffsetPx 单源供绘制 MTLViewport 负原点/
  pointerHit/光标矩形三处，防钳制态坐标偏斜；被动预览不钳、锚点现状不动；⑤**预算不变式**——每几何
  静止期每会话 ≤1 次已应用 resize，风暴哨兵（1s>2 次
  已应用 → .error）+ 可疑窄化降级 .notice（五轮实证合法布局居多）+ resize/grid sync 日志补会话短 ID。
  残余地板明示接受：每手势 ≤1 份轻残影（活动帧自愈）。e2e item29（原 18 合并窗口改号；Ink 型负载×
  布局纪元烧录预算 + 下限断言 + 新 tile 锚顶回归哨，基线兼容源码跑红档）。⑥**输出静默门（F7，
  活体案例五 2026-07-07 晚）**：驱动视图的一切网格提交（trailing/zoom）前判「会话最近 PTY 输出
  距今 < 400ms（quietMs v1 常量）且目标尺寸会真变网格」→ 候选回炉 settler、按剩余静默量重挂
  timer，输出一停即落地终值——**流式中永不 reflow**（流式 Ink 活动帧=整条未完成消息，任何一次
  reflow 烧整帧：三次聚焦进出 × CC 流式长提示词 = 重复 3 份实录，预算合规仍烧）。从未输出过的
  会话（msSinceLastOutput=nil）恒放行（守恒）；同尺寸幂等提交不涉门；无 maxDefer 上限（有上限=
  到点照烧破功）；0 间隙程序（`yes` 类）网格滞留旧值直到停止=明示接受。纯字节流时间戳判据，
  零内容识别零 CC 耦合。v1-frozen 主体不变，本条为增补留痕。
- **2026-07-09（F-A dogfood-r1，第六轮定谳）**：⑥ 修订记录中 **zoom 自 F7 输出静默门辖域移出**。
  案由：静默门对 zoom 有致命反作用——CC 工作时 spinner 亚 400ms 持续重绘 → 门永不开 →
  `updateFontSize` 换新大 cell 后 `renderFrame` 以旧列数 × 新 cell 出帧，右侧越界 GPU 裁切（列锚左、
  无横向滚动），用户五轮投诉「放大字号右侧截断」的根因（F8 只修了空闲态 floor 换算，未解流式饿死）。
  但原 A7 契约「输出活跃期 zoom 同受静默门」本是 17:31「字号连击 6 连发」排版错乱实录的根治锚
  （连击逐步 reflow 活动 Ink 帧、每发烧一份），简单豁免门 = 回归该连击风暴。定版（兼顾截断与连击
  两历史投诉，2026-07-09 dogfood 裁决）：**zoom 字形每按即变不动；PTY resize 改走 `updateFontSize`
  层「zoom 专用短程尾沿 timer（末次按键后 zoomCommitTrailingMs=~200ms）+ `commitGrid(force:true)`
  绕静默门」**——单按右裁窗 ∞→~200ms（无感），连按只重挂 timer → 仅末次幸存回调提交 = 合并 ≤1 次
  resize（≤1 帧 Ink 烧写，17:31 连击风暴不回归）。`commitGrid` 加 `force` 形参、F7 门改 `if !force,…`；
  其余提交面（trailing/attach/layout）缺省 `force=false` 语义逐一不变。⑥ 正文「驱动视图的一切网格
  提交（trailing/zoom）前判静默门」中的 zoom 一支即由本条覆盖（zoom 现经尾沿 force 直落，不再回炉
  settler）；trailing 及其余提交仍全程受门。单测 A7（force 落地）/A7b（连击合并）红档→绿档，回归锚
  ZoomTests/GridFloorZoomTests/A8/item29 守恒（silent 会话 msSinceLastOutput=nil 恒放行不受影响；
  ZoomTests 立即提交断言随尾沿改经 flushZoomCommit 触发、意图不变）；e2e item37 流式中 zoom 收敛无
  右溢出。v1-frozen 主体不变，本条为增补留痕。
- **2026-07-09（m3-r7，第七轮定谳）**：④ 网格下限钳制**宽度轴退役（用户裁决 O1a）**。案由：680pt
  「纸宽」= 六轮未根治「终端文字右侧遮挡」P0 的恒态主因——`max(bounds, floor)` 使一切 <680pt tile
  恒按下限列数排版，renderFrame 视口撑到 cols×cellW 超 drawable → GPU 左锚右裁且变窄永不 reflow。
  判别性证据三路互证：①真机日志（用户 2026-07-09 17:24~17:42 自然使用，cellPx=26 下限 52 列）：
  三列 tile 603~661pt 全钳 52 列、472pt 时可见容量仅 36 列（裁 16 列/30%）、crossover 恰 680pt
  （665pt 钳 52/694pt 跟随 53）；②e2e 红档（默认字号，无流式）：三列 472pt 提交 80 列/容量 55（裁
  25 列/31%）、变窄 392pt 钉死 80（裁 42%）、两列 713pt 不钳 0 裁——精确解释用户「3 列必遮/2 列不遮
  /变窄完全不跟随」三条观察；③标尺像素证据（80 字符标尺 56 列处截断、F/G/H 标记不可见而 PTY dump
  完整）。F8 拍板语境（防小 tile 排版崩坏+字号放大 reflow）未推演三列恒裁代价，故带实测数据重新
  裁决=O1a。定版：**列恒 bounds 主导**（窄 tile 如实 reflow 全可见；误拖极窄由 <10×2 退化防御兜底
  ——tile 窄于 ~85pt@默认字号时换算退化、网格滞留旧值，右裁在该极端几何短暂重现直至拖回，属明示
  接受的防御边界）；
  **高度下限 396pt 原样保留**（F6b 光标跟随/Ink 上擦预算不变，「随字号换算」保留在高度轴）；瞬态
  挤压烧录由 settle 80ms+⑥ 输出静默门两道防线管辖（floor 对瞬态无增量保护——五~七轮考证）。已知
  代价明示（e2e-full2 取证 2026-07-09）：**极窄 tile（默认字号 <约 310pt / <约 36 列）中 Ink 型
  长行帧经换行可高于 24 行视口 → 流式中每帧顶部滚入 scrollback（Ink 固有，活体案例二 regime 的
  宽向分量）**——原宽度下限以「恒裁 31%+」为代价掩盖之，O1a 后如实暴露；用户主诉三列场景（472pt/
  55 列，帧 14 行）不在此 regime。item29 负载 body 相应缩短（帧恒 ≤24 行）以保「resize 机制烧录
  预算」闸的判别力（预算改绑已应用 resize 数不变式：残留 ≤已应用+2 且已应用 ≤10）。测试面：
  A4/GridFloorZoomTests/ClampedHitMapping 前提/item29 ①/item37 want 公式按新 as-built 改判留痕
  （item37 契约主体「流式中 zoom 收敛无右溢出」不变）；A5/A6/A7/A7b/A8 逐字不动守恒；新增绿锚=
  单测 A10 + e2e item39（断言一律「cols×cellW ≤ 视图像素宽」视觉根因形态，禁 cols≥80 结构断言）。
  红档→绿档：m3-r7-red-e2e-item39.md → m3-r7-green-e2e-item39.md。H2（⑥ 门推迟拖拽 trailing 至
  输出停顿）维持现状随本修复真机冒烟，体感不过关再议手势尾沿 force（独立 agent 终审）。
- **2026-07-10（T1'，第八轮）**：⑥ 输出静默门（F7）语义自「饿死门」改「**合并窗**」——上条预授权
  的「手势尾沿 force」落地（独立 agent 终审采 B 案：TSV 内部通用尾沿，弃「聚焦定点信号」A 案——
  聚焦期其余 surface 已 detach 销毁、restoreTiling 时无对象可武装，信号须穿 4 层带 TTL 爆炸半径
  反大）。案由：muxvo测试3 真机（6 终端 2×3 平铺）CC「Waiting for background agent」spinner
  亚 400ms **0 gap 持续分钟级**——⑥ 原假设「400ms < CC 典型停顿、静默窗数秒内必命中」被证伪；
  平铺→聚焦切换走 maximizeTile→layoutReport→surface.frame→syncGridToBounds→trailing 提交，全程
  受门且无 force（F-A 只豁免了字号 zoom 路径），提交被无限回炉 → PTY 永停平铺网格（drawable 已
  全窗而 grid 仍平铺 → 内容缩左上角、右/下全空；rows 变化小 cols 需大增 → 「行看着对、列卡窄」；
  输出停过 ≥400ms 的终端来回切即愈=门语义铁证）。定版：**门扣下 bounds 提交时武装 one-shot 尾沿
  force timer（boundsForceTrailingMs=~200ms，与 zoom 尾沿同构独立）：arm-if-not-armed（门重试
  间隔 max(80,400−idle) 可 <200ms，逐次重挂=force 被重试链无限推迟、复发饿死——头号实现纪律）、
  新几何候选 disarm 重来（下次门命中重新起算——「拖拽中不重排、稳定后一次到位」用户裁决不减力）、
  输出永不重置；到期以现时 bounds 复算（TOCTOU 同 flushZoomCommit）`commitGrid(settled:
  "trailing-force", force:true)` 绕门直落，落地收编 settler 候选**。效果：任何 bounds 变化（聚焦
  切换/拖拽松手/窗口 resize 结束）稳定后 ≤~(settle 80+force 200)ms 必落地，流式与否语义一致（非
  流式本就 settle ~80ms 提交）；上条 H2「松手后等输出停顿才重排」已知代价一并根治。已知代价改判：
  流式中每 bounds 手势 ≤1 份 Ink 帧残影烧 scrollback（=⑤ 既有明示地板、与字号 zoom 豁免同价——
  活体案例五的「零烧录」承诺对 0 gap 流不可兑现：不重排=永卡，重排一次=烧 1 帧，数学不可兼得；
  相比案例五当年逐帧成山守在每手势 ≤1 份）；`yes` 类 0 间隙程序自「滞留至停止」改「稳定即落」
  （该类程序本就最不怕 reflow）。静默会话（msSinceLastOutput=nil）恒放行且**永不武装** force
  timer（A8/A13 守恒，零额外延迟零行为变化）；settle 路径流式期恒扣语义不变（A6 逐字保持，仅注记
  「落地职责移交尾沿 force」）。测试面：单测 A11（流式中 force 落地）/A12（连变合并 ≤1 次+防重挂
  互锁）/A13（静默守恒）/A14（flap 撤销零提交）红档→绿档 t1-{red,green}-unit.log；R7H2 时间线
  取证按其预案改写为 T1' 契约（t1-bounds-force-timeline.md，批0 原档不覆盖）；e2e 新 item41
  （流式中 maximizeTile/restoreTiling 来回两轮收敛，断言恒视觉根因形态 cols=容量且 cols×cellW≤
  widthPx 且判定时刻 msSinceLastOutput<400；item37 姊妹项补聚焦路径锚测盲区）；A1-A10/R1-R10/
  T1-T4/Zoom/GridFloorZoom/item29/37/39 守恒。v1-frozen 主体不变，本条为增补留痕。
