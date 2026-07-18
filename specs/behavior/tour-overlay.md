# 行为规格：新手引导 spotlight（TourOverlay + driver.js）

> 提炼自老 app 实际代码（components/tour/TourOverlay.tsx 201 行 + TourOverlay.css 139 行 +
> features/tour/steps.ts 68 行 + PanelContext.tsx:160-163，2026-07-02 读取），**只记行为不抄结构**。
> 渲染引擎 = **driver.js@1.4.0（MIT，legacy package.json ^1.4.0 实装 1.4.0）**：spotlight 遮罩
> （SVG 挖孔 path）、气泡定位、箭头全由该库 JS 计算——新旧两侧用同一版本库渲染即像素同源，
> 挖孔/定位数学不属本仓库代码，不手抄。

## 0. 实况修正

- `steps.ts` 的 `needsTerminal` 字段**零消费**（TourOverlay 全文无读点）——四步永远全量
  进 driver.setSteps，不按终端数过滤。
- i18n `tour.step2a.*` / `tour.step2b.*` / `tour.noTerminal.*` 为**死键**（zh.ts 定义但
  TOUR_STEPS 无对应步、全仓无其他消费）——引导实际只有 4 步，无「移动终端/调整大小」步。
- steps ≥2 的推进依赖真实用户动作（终端数增加/viewMode 翻转/命名落地，各 +500ms
  ADVANCE_DELAY 定时器），且步 1→2 推进时生产代码把 `.driver-overlay` 置 display:none
  （TourOverlay.tsx:94-95）——即**只有步 1 具备完整 spotlight 遮罩形态**。

## 1. 步骤数据（steps.ts，数据驱动；dom-assert 数据源）

四步依序（side 全 'bottom'、interactive 全 true、showButtons 全 `['close']`）：

| # | id | 锚点 selector | 标题（zh） | 描述（zh） | actionType |
|---|----|----|----|----|----|
| 1 | create-terminal | `.terminal-grid__fab` | 新建终端 | 点击 + 按钮，创建你的第一个终端吧！ | create-terminal |
| 2 | focus-terminal | `.tile-max-btn` | 聚焦终端 | 试试点击这个蓝色按钮，把终端最大化为聚焦模式！ | focus |
| 3 | rename-terminal | `.tile-name-clickable` | 重命名终端 | 点击这里为终端起个名字，方便在多个终端间快速识别。 | rename |
| 4 | open-files | `.tile-file-btn` | 打开文件 | 点击"文件"按钮，打开当前目录的文件浏览器！ | open-file |

> **§1 修订（发布阻断回修 fix/welcome-overlay-island 2026-07-14）**：步 3 selector `.tile-custom-name--placeholder, .tile-custom-name` → **`.tile-name-clickable`**——高亮**实际可点元素**（`onClick→beginRename` 所在层，`TileHeader.tsx`）而非内层小 span placeholder。driver spotlight 按 selector+stagePadding(8) 挖洞，高亮内层小 span 致洞覆盖到可点区之外 → 用户点洞边缘落非可点区、不进编辑态卡第三步（真机命中不稳定，jsdom 无布局测不出）。clickable 单选择器同覆盖未命名 placeholder 与已命名 custom-name 两态。同批另修：完成 toast 缺失 CSS（`tour.css` 补 `.tour-complete-toast`，legacy 漏移植致 toast 创建但不可见）、欢迎卡命中层塌 0 高度（`WelcomeOverlayLive` 命中层改 fixed 全屏，见 welcome-overlay.md）。

## 2. driver.js 配置（TourOverlay.tsx:160-185，视觉相关逐项）

- `showProgress: true`、`progressText: '{{current}} / {{total}}'`（步 1 渲染 `1 / 4`）
- `animate: true`（首步 from==to，逐帧重绘同一几何——静止；步间过渡 400ms 不进 golden）
- `overlayColor: 'rgba(6, 8, 12, 0.85)'`（+ driver.js 默认 overlayOpacity 0.7 叠乘）
- `stagePadding: 8`、`stageRadius: 10`（挖孔 = 锚点 rect 外扩 8px、圆角 10px）
- `popoverClass: 'tour-popover'`（step 级同值）；`popoverOffset` 走默认 10
- 按钮文案 next/prev/done = `下一步`/`上一步`/`完成`（showButtons=['close'] 时导航钮不渲染，
  仅右上 × 常在）；`allowClose: true`、`overlayClickBehavior: () => {}`（遮罩点击无操作）
- step 级 `disableActiveInteraction: !interactive` → 四步全 false
- 行为回调（onHighlighted 记步 / onCloseClick→completeTour(true) / onDestroyed→COMPLETE_TOUR）
  与自动推进（ADVANCE_DELAY 500ms + hasNextStep/moveNext + 完成 toast `tour-complete-toast`
  3s）均为交互行为，不进 golden。

## 3. 气泡与高亮样式（TourOverlay.css 覆盖 driver.css，逐值）

- `.tour-popover.driver-popover`：bg `var(--bg-elevated)`、border 1px `var(--border)`、
  radius 10px、shadow `var(--shadow-dialog)`、字色 `var(--text-primary)`、`var(--font-sans)`、
  max-width **340px**（driver.css 基座：padding 15px、min-width 250px、z-index 1000000000、fixed）
- `-title`：`var(--accent)` 14px 700；`-description`：`var(--text-secondary)` 13px/1.6
- 导航钮（本批不可见，四步均 close-only）：bg `var(--accent-glow)`、字 `var(--accent)`、
  border 1px `rgba(232,167,72,.3)`、radius 6px、12px 600、padding `5px 16px`；prev 变体透明底
- `-progress-text`：`var(--text-muted)` 11px；`-close-btn`：`var(--text-secondary)`
  （driver.css 基座 32×28 右上角）
- `-arrow`：border-color `var(--bg-elevated)`（四个 side 变体各自补对应方向色）
- 游戏化高亮 `.driver-active .driver-active-element`：`filter: brightness(1.15)` +
  outline `2px solid rgba(232,167,72,.6)` offset 3px + radius 8px；tour-pulse 呼吸
  box-shadow 动画 1.8s 无限循环（截图侧禁动画 → 仅静态 brightness+outline 入图）
- driver.css 附带全局规则 `:not(body):has(>.driver-active-element){overflow:hidden!important}`
  与 body `driver-active driver-fade` 类（两侧同库同 CSS，自然对称）

## 4. 代表 step 裁决（golden `tour-step`）

**步 1（create-terminal，锚 `.terminal-grid__fab`）**，依据「锚点在复合宿主中最稳定可复现」：

1. `drive()` 原生落在步 1——零模拟推进；步 ≥2 须伪造生产状态迁移 + 500ms 定时器链
   （非确定性），且推进后遮罩被生产代码隐藏（§0），spotlight 形态残缺。
2. FAB 几何最稳：absolute bottom 20px / right 20px 固定 40×40（TileEffects.css:526），
   与 tile 数量/布局/hover 无关；步 2-4 锚点位于 tile header 内，随网格布局浮动。
3. 步 1 是唯一「完整遮罩 + 挖孔 + 气泡」代表形态（§0 第 3 条）。

## 5. 复合宿主特例（screens.json adjudications **#4 授权**）

driver.js 按真实 DOM rect 挖孔，单组件挂载无锚点可锚——tour-overlay 是 M2 唯一授权的
复合宿主（grid+menubar）屏：两侧宿主 = menu-bar 屏同构（.app > MenuBar + app-content >
网格底图，auth=null/update=null）+ tour 层。golden 侧 fonts.ready 后 dispatch `START_TOUR`
（生产 action：置 tour.active，TourOverlay 主 effect 建 driver 并 drive()）；web 侧同一时机
以相同配置直接驱动 driver.js（同库同版本）。

ready 戳记（B5 先例）：气泡/挖孔由 driver.js 异步定位 + animate 循环 400ms——两侧一律以
「`.driver-popover` rect + `.driver-overlay path[d]` 连续 30 帧不变」为闸，稳定后在宿主
`.app` 打逐 fixture 唯一戳记 `data-fx-tour-ready="<fx.id>"`，不稳不打标（capture 超时红，
绝不截中间态）。

## 6. golden 与 dom-assert

- `tour-step`（dark）：Tiling 2 终端底图 + 步 1 spotlight（FAB 挖孔 + 气泡「新建终端」+
  `1 / 4` + ×）。
- 其余 steps → dom-assert（screens.json）：断言步数=4、id/锚点/文案/side/showButtons 与 §1
  逐条一致，且各锚点 selector 在 web 复合宿主实渲染中实存（步 3 取 placeholder 分支）。
- specCases 为空（screens.json），纯 golden 批，无 spec 翻牌。

## 7. live 推进契约（右上角批 B4，2026-07-13）

golden `TourOverlayScreen` 零触碰；live 驱动 = `TourOverlayLive`（仅 LiveOnboarding/bridge 路径挂载）：

- **推进信号源 = ui.state 回推**（fx 四字段，`tour-live-logic.shouldAdvance` 纯函数）：
  create-terminal=终端数>启动基线 / focus-terminal=viewMode==Focused / rename-terminal=任一终端非空
  customName（空白不算）/ open-files=filePanel 非空（末步=完成）。各步命中后 **+500ms ADVANCE_DELAY**
  再 moveNext（legacy 定时器同窗；500ms 窗内条件回退则不推进）。
- **步 1→2 推进后 `.driver-overlay` 置 display:none**（§0 实况对齐——步 2+ 无遮罩，用户看清网格操作）。
- **×/ESC = 跳过**（allowClose；onCloseClick/onDestroyed 双钩兜底幂等收口）；完成非跳过 →
  `.tour-complete-toast` +`--visible` 过渡显形 3s（文案=legacy `tour.complete`）。
- **洞区穿透**：drive/每步 highlight 后给 `.driver-overlay`/`.driver-popover` 补挂 `data-hit-island`
  （useLayoutReport MutationObserver 自动重上报，浮层=岛约定）——native 把遮罩区从终端穿透区抠掉。
- **设置重放**：设置「新手引导」→ 关面板 100ms 后 `tourIntent.requestTourStart()` → 直接进导览
  （跳过欢迎卡、**不重置 tourCompleted**，legacy handleRestartTour 对齐）。
- driver 驱动/挖孔/定位归真机 dogfood 走查；vitest 以 driver mock 把守编排状态机与写点。

### 7.1 案例池（spec-coverage 强制 1:1）

| 用例名 | 断言 |
| --- | --- |
| TOUR_advance_matrix | 四步推进条件矩阵（满足/不满足两态 + 未知步恒否 + 500ms 常量） |
| TOUR_replay_from_settings | 重放信箱 → 跳过欢迎卡直接 drive + 不写 tourCompleted |
| TOUR_replay_delegate | 设置帮助区行0 → onClose + 100ms 后投信箱；行1 检查更新仍 inert |
