# 行为规格：终端配色（5 套内建主题 / 单选择器派生亮暗[R1] / 运行时重注 / colorScheme 应答）

> 提炼自老 app 实际代码（`muxvo-legacy/src/shared/constants/terminal-themes.ts` 5 套 ITheme + `App.tsx:82-95`
> `handleToggleTheme` 主题联动，2026-07-07 读取），**只记行为不抄结构**。REQ-016（legacy P1「多套终端
> 配色主题」）为老版**预留位、从未实装 UI**（老 app 仅亮/暗联动切 `dark`/`light` 两套，另 3 套定义了颜色
> 但无入口）——本批（M6 主题批 2.5-B）**首次落地**下拉选择 + 运行时重注 + 单选择器派生界面亮暗（R1，§4）。
> 权威色源 = `terminal-themes.ts` 逐键照录（5 套 × 21 键，§2）。裁决点 ★=用户裁决 ☆=独立 agent 裁决。
> target：`MuxvoTermRender`（`Theme.swift` 主题表/装配）+ `MuxvoTerm`（`TerminalSession` 运行时重注）+
> `MuxvoStorage`（`ConfigStore.TerminalSettings.themeName`）+ web（设置弹窗外观区下拉，settings-modal.md）。

## 0. 范围与权威

- **权威分层**（高→低）：跑起来的老 app 亮/暗联动实况 → `terminal-themes.ts`（5 套色值）→ 本规格裁决。
- **★ 用户裁决（2026-07-07；裁决 1/2 于同日 R1 巡检合并修订，见下方 ⚠）**：
  1. ~~一个亮/暗开关 = 界面 + 终端配色一起变（默认联动）~~ → **R1：外观区改单个「主题」5 选下拉，界面亮暗由
     所选值单向派生**（无独立亮暗开关，§4）。
  2. ~~终端配色下拉 5 套 + 显式选花样后切界面亮暗则粘住（智能跟随）~~ → **R1：跟随/粘住语义废止**，主题下拉是
     `terminalThemeName` 唯一入口、`theme` 派生（§4）。5 套名 `dark`/`light`/`monokai`/`dracula`/`solarized-dark` 不变。
  3. **全量亮色 golden**：23 簇每簇 ≥1 张亮色代表作（非逐态 ×2——此实现解释已获批准，见 screens.json）。**（R1 不改此条。）**
  - ⚠ **R1 合并（2026-07-07 用户巡检返工）**：用户觉得「界面亮暗」与「终端配色」两设置混乱 → 裁决 1/2 由两行合一行主题下拉、跟随/粘住废止取代。§4 为准。
- **默认 dark**（TERM_L1_10/L1_16、`ConfigStore.TerminalSettings` 缺省 `themeName=="dark"`）。
  - **偏差记录**（分歧，非冲突）：legacy 主进程 `DEFAULT_CONFIG` 曾取 `light`（`config.ts` §①，ConfigStore.swift:10 已注）——
    冻结 spec TERM_L1_16 定 `dark`，实现分歧**弃用 legacy 主进程缺省**，取 `dark`。已裁决（检查点⑨），勿再问。
- **红线**：换主题走**结构化配置通道**（`updatePrefs` → `ConfigStore` 落盘 → 会话重注），非「刮屏改色」；
  终端配色只服务人眼渲染，不参与编排控制面（核心原则二）。

## 1. 名字空间与持久化

- **5 套名**：`dark` / `light` / `monokai` / `dracula` / `solarized-dark`（顺序即下拉展示序、`TERMINAL_THEMES`
  键序，`terminal-themes.ts:129-135`）。
- **未知名回退 `dark`**（对等 `resolveTerminalTheme`：`TERMINAL_THEMES[name] ?? dark`，`terminal-themes.ts:138-140`）——
  持久化里读到过时/损坏名、或未来删主题后残留旧名，一律解析为 `dark`，不崩不空屏。
- **持久化字段** = `config.terminal.themeName`（`ConfigStore.TerminalSettings.themeName`，缺省 `"dark"`，
  ConfigStore.swift:61/66；`decodeIfPresent ?? "dark"`，:79——旧配置缺该键时取默认）。界面亮暗仍走信封级 `theme`
  字段（`dark`/`light`），二者关系见 §4。

## 2. 色值表（5 套 × 21 键，逐键照录自 terminal-themes.ts）

> 逐键照录，不改一位。solarized-dark 两处「重复值」系官方 Solarized 灰阶设计**非笔误**（见表下注）。

| 键（ANSI index） | dark | light | monokai | dracula | solarized-dark |
|---|---|---|---|---|---|
| background          | #1e1e1e | #ffffff | #272822 | #282a36 | #002b36 |
| foreground          | #cccccc | #383a42 | #f8f8f2 | #f8f8f2 | #839496 |
| cursor              | #ffffff | #526eff | #f8f8f0 | #f8f8f2 | #93a1a1 |
| cursorAccent        | #000000 | #ffffff | #272822 | #282a36 | #002b36 |
| selectionBackground | #264f78 | #bfceff | #49483e | #44475a | #073642 |
| black (0)           | #000000 | #383a42 | #272822 | #21222c | #073642 |
| red (1)             | #cd3131 | #e45649 | #f92672 | #ff5555 | #dc322f |
| green (2)           | #0dbc79 | #50a14f | #a6e22e | #50fa7b | #859900 |
| yellow (3)          | #e5e510 | #c18401 | #f4bf75 | #f1fa8c | #b58900 |
| blue (4)            | #2472c8 | #4078f2 | #66d9ef | #bd93f9 | #268bd2 |
| magenta (5)         | #bc3fbc | #a626a4 | #ae81ff | #ff79c6 | #d33682 |
| cyan (6)            | #11a8cd | #0184bc | #a1efe4 | #8be9fd | #2aa198 |
| white (7)           | #e5e5e5 | #a0a1a7 | #f8f8f2 | #f8f8f2 | #eee8d5 |
| brightBlack (8)     | #666666 | #4f525e | #75715e | #6272a4 | #586e75 |
| brightRed (9)       | #f14c4c | #e06c75 | #f92672 | #ff6e6e | #cb4b16 |
| brightGreen (10)    | #23d18b | #98c379 | #a6e22e | #69ff94 | #586e75 |
| brightYellow (11)   | #f5f543 | #e5c07b | #f4bf75 | #ffffa5 | #657b83 |
| brightBlue (12)     | #3b8eea | #61afef | #66d9ef | #d6acff | #839496 |
| brightMagenta (13)  | #d670d6 | #c678dd | #ae81ff | #ff92df | #6c71c4 |
| brightCyan (14)     | #29b8db | #56b6c2 | #a1efe4 | #a4ffff | #93a1a1 |
| brightWhite (15)    | #ffffff | #ffffff | #f9f8f5 | #ffffff | #fdf6e3 |

- **solarized-dark 官方灰阶设计注记**（非笔误，逐键照录）：`brightGreen(10)=#586e75` 与 `brightBlack(8)=#586e75`
  同值；`brightBlue(12)=#839496` 与 `foreground=#839496` 同值。Solarized 有意把「亮系」的绿/蓝映到基调灰
  （base01/base0），是配色本身的设计，实现/测试**不得**当笔误纠正。
- **dark 与 `Theme.swift` 现值一致自查**：`Theme.swift:63-66` `dark` 已按本表（bg `0x1E1E1E`/fg `0xCCCCCC`/
  cursor `0xFFFFFF`）+ `legacyDarkAnsi16`（:73-90）与本表 ANSI16 逐项一致。本批新增 light/monokai/dracula/
  solarized-dark 四表 = 实现批产物（本规格只定色值，不写产品代码）。

## 3. native 映射合同

| xterm ITheme 键 | native 注入 | 说明 |
|---|---|---|
| background | `GHOSTTY_TERMINAL_OPT_COLOR_BACKGROUND` | `&GhosttyColorRgb`，terminal 默认背景 |
| foreground | `GHOSTTY_TERMINAL_OPT_COLOR_FOREGROUND` | terminal 默认前景 |
| cursor | `GHOSTTY_TERMINAL_OPT_COLOR_CURSOR` | 默认光标色 |
| black..brightWhite（ANSI16） | `GHOSTTY_TERMINAL_OPT_COLOR_PALETTE` 的 `palette[0..15]` | 逐键映射 index 0..15 |

- **palette[16..255] 不随主题变**：16..231 = xterm 标准 6×6×6 色立方、232..255 = 24 级灰阶
  （`TermPalette.standard256`，Theme.swift:96-113）——legacy xterm ITheme **只含 ANSI16**，256 后半段
  由 xterm.js 自身按标准补齐、与主题无关，故四套新主题共享同一后 240 段（只换前 16 + fg/bg/cursor）。
- **cursorAccent 照录不注入**（偏差记录）：vt 无对应 option（光标下字符色由渲染端按对比自算或不消费），
  §2 表照录仅为「与色源 1:1 可核对」，native 装配**不消费** cursorAccent。
- **selectionBackground 照录不消费**（偏差记录 + 挂账）：选区/搜索 overlay 维持渲染端**硬编码**半透明色
  （`TerminalInstanceBuilder.swift:20-24` `selectionColor`/`searchMatchColor`/`searchCurrentColor`——
  vt `paint-under` 与本半透明 overlay 是不同管线，legacy xterm `selectionBackground` 是实心 paint-under，
  新架构是 blend overlay）。**选区/搜索主题化挂账批 3③**（terminal-rendering.md §2 域，本规格不解决）。
- **fg 默认色三方对账**（term-golden 授权关联，§8）：`0xcccccc` 三方一致（REBUILD-PLAN 批2③ 裁决值 +
  `terminal-themes.ts:11` `#cccccc` + `Theme.swift:64` `0xCCCCCC`）；`TerminalSession.swift:35`
  `defaultThemeForeground = 0xd0d0d0` 系**占位实现分歧**（该常量注释自述「占位、权威值批 3 取代」），
  本批统一为 `0xcccccc`——修正后 7 张 term-golden 授权重生成（§8 + tools/term-golden 授权登记）。

## 4. 单选择器派生（★ 用户裁决 2026-07-07 **R1 合并，废止跟随/粘住**）

> **前裁决（跟随/粘住：切界面亮暗时 `themeName∈{dark,light}` 跟随、花样粘住）已废止**——用户巡检觉得
> 「界面亮暗」与「终端配色」两个设置混乱。R1 合并为设置外观区**单个「主题」5 选下拉**（settings-modal.md §3.2）：
> 该下拉是 `terminalThemeName` 的**唯一入口**；界面亮暗字段 `theme` 由所选值**单向派生**，不再有独立亮暗 toggle。

| 所选主题（下拉值 → `terminalThemeName`） | 派生 `theme` | 依据 |
|---|---|---|
| `light` | `light` | 唯一浅色主题 → 界面 light |
| `dark` | `dark` | 深色 |
| `monokai` / `dracula` / `solarized-dark` | `dark` | 花样配色底色皆深色 → 配暗界面 |

- **派生规则** = `theme = (选中 === 'light') ? 'light' : 'dark'`。web `SettingsModalLive` onChange 一次 `set`
  **双字段同写** `{ theme, terminalThemeName }`；native `applyPatch` **单次落盘** `ConfigStore`、单次会话重注，
  无中间态闪帧（原子性同前，只是不再有联动计算）。
- **无跟随 / 无粘住**：界面亮暗不再独立可切，唯一改法是换主题下拉，`theme` 恒随之派生——故「切界面亮暗联动
  改终端配色」「花样配色粘住」「双字段消歧」四类场景**均不复存在**。**native 侧原「智能跟随」纯函数
  （`themeName∈{dark,light}` 判定跟随/粘住）随本裁决删除**（Swift agent 域：实现批同步删该纯函数 + 其单测 +
  e2e 粘住场景，改为「派生 theme」单测）。
- **§5 立即生效、§7 996 应答不变**：仍只读 `terminalThemeName` 现值，与派生出的 `theme` 无耦合读路径。

## 5. 立即生效（REQ-016）

- `themeName` 变更 → **所有已开会话**重注 4 option（`COLOR_{FOREGROUND,BACKGROUND,CURSOR,PALETTE}`）+
  **立即全量重绘**（`forceFull`，绕节流立即通道，terminal-rendering.md §1.2）。切换即刻可见，无需新开终端。
- **所有存活 surface 必须真正 present 一帧新色**（settings-dogfood 批，真机 dogfood 2026-07-16「切主题
  只有点击过的终端变色/连切时全体闪白」）：`forceFull` 只保证新快照发布 + `needsDisplay=true`，而
  isPaused+enableSetNeedsDisplay 驱动下 idle/非 key 面的 needsDisplay **不保证真正出帧**——未聚焦 tile
  留在旧色（点击聚焦经 resize 才被逼出新帧），未消费的上一主题快照还会在 relayout 逼帧时闪现（连切
  light→monokai 全体闪白= light 白底陈旧快照）。约定：视图层（TerminalSurfaceView 帧观察者投递）做
  **配色边沿检测 → 显式 draw()**，带 **≥16ms 合并窗**（对抗 MINOR-2 加固：恶意 OSC 10/11 高频交替不得
  迫成无 vsync 合并的 draw 风暴；用户级切换人手节奏 ≫16ms 恒即时）+ **尾沿 draw**（窗内后续边沿收敛与
  currentDrawable 瞬时不可得的丢帧兜底二合一，pending 单发无常驻 timer）；连续切换不得闪现上一主题帧；
  **不得引入逐帧常驻开销**（常规 feed 帧仅一次 TerminalColors 等值比较，显式 draw 只在配色边沿触发——
  OSC 10/11/4 覆盖同享此路径属正确行为）。
- **新建会话继承**当前 `themeName`（建会话时读 `ConfigStore` 装配默认色，Theme.swift `makeColorOptions`）。
- **glyph atlas 只换色不重建**：主题变更只改 fg/bg/palette（颜色是 per-cell 实例属性、mask-only atlas 存的是
  字形轮廓灰度），`GlyphCache` **不重建**（合同③ `fullRebuildCount==0` 不受主题切换影响，terminal-rendering.md §3）。
- **OSC 覆盖层保留**（注记）：程序用 OSC 10/11/12/4 覆盖过的色，重注默认色后**仍显覆盖值**（vt render state
  有效色 = 默认色叠 OSC 覆盖，渲染端只读有效色不自合成，terminal-rendering.md §4.2）。此时换主题「看似不生效」
  = **正确行为**（用户程序显式改过色，主题只改「默认」层）；清除 OSC 覆盖后回落新主题默认色。

### 5.1 全界面同帧切换（右上角批 B1，2026-07-13；legacy App.tsx:81-96 瞬时语义对齐）

- **ui.state `palette` 随 `terminal.themeName` 派生真值**：`mapSnapshot` 的 `palette.{background,foreground}`
  取 `TermTheme.named(themeName)` 的 bg/fg（`TermColorRGB.cssHex` 小写 `#rrggbb`），**禁止**按界面 `theme`
  二值硬编码——终端洞的 web 回退底色必须与 Metal 真实渲染色一致（修复前 monokai/dracula/solarized 恒拿
  通用暗色 `#1e1e1e`，暗色族互切「底色错拍」）。未知名回退 dark（§1 兜底同源）。
- **web 乐观同帧 `data-theme`**：设置下拉 onChange 的 `ConfigApi.set({theme,…})` 在发桥请求**同帧**执行
  `documentElement.setAttribute('data-theme', patch.theme)`——UI chrome CSS 变量同帧重算，不等
  `config.request→落盘→republishState→ui.state 回推`整个往返（修复前 UI 链慢终端 Metal 链半拍甚至数秒）。
  校正/回滚合同：set 响应 `snapshot` → 以权威 `config.theme` 复写 data-theme；`rejected`/传输错 → 重拉
  get 后连带回滚 data-theme。ui.state 回推（main.tsx onState）继续无条件写 data-theme（幂等，权威源不变）。
- **golden 零感知**：乐观路径仅存在于 live（bridge≠null）；截图模式 api=null 不可达。
- **原生兜底底随界面亮暗**（settings-dogfood 二轮，真机 dogfood「切亮色后 tile 格缝/非终端区全黑」）：
  web 整页透明，格缝/非终端区透出的是 native CompositeRoot 容器层与 host 层的兜底底色——原硬编码
  dark `#0a0e14`，亮色界面必须同步为 web 亮色 `--bg-primary #f0f0f3`（两态同源，`CompositeColors.backdrop`）。
  施加点两处：建窗初值（WindowManager，亮色主题下新窗不得先闪黑）+ `config.theme` 变更
  （AppDelegate.onPrefsChanged / e2e harness 镜像接线同款，`applyBackdropTheme` 幂等）。

## 6. 明确不做（挂账 / 无 API）

- **选区 / 搜索 overlay 主题化**：维持硬编码半透明色，**挂账批 3③**（§3；terminal-rendering.md §2 域）。
- **colorScheme 变更的 unsolicited 通知**：换主题不主动向 pty 推 colorScheme 变更通知——vt **无对应 API**
  （只有查询应答，§7），**挂账**。程序只能在下次 CSI ?996n 查询时取到新值。
- **cursorAccent**：照录不消费（§3），本批不实现光标下字符对比色。

## 7. colorScheme 应答（CSI ?996n）

- vt 经 `GHOSTTY_TERMINAL_OPT_COLOR_SCHEME`（terminal.h:512，回调 `GhosttyTerminalColorSchemeFn`）在收到
  **CSI ?996n 查询**时回调宿主取「当前色方案」。应答值映射：
  - `themeName == "light"` → `GHOSTTY_COLOR_SCHEME_LIGHT`（device.h:75，`TermColorScheme.light` rawValue 0）。
  - 其余（`dark`/`monokai`/`dracula`/`solarized-dark`）→ `GHOSTTY_COLOR_SCHEME_DARK`（device.h:76，rawValue 1）。
- 即：**只有 `light` 一套报 LIGHT**，四套深色（含三套花样）皆报 DARK——花样配色底色都是深色，向询问的程序
  （如自适应配色的 CLI）报 DARK 语义正确。
- 应答只读 `themeName` 现值，与派生出的界面 `theme` 字段解耦（以终端实际配色 `themeName` 为准）。

## 8. 验证清单

- **单测**（`MuxvoTermRenderTests` / `MuxvoStorageTests`）：
  - **named 回退**：`resolveTheme("monokai")`==monokai、`resolveTheme("bogus")`==dark、`resolveTheme("")`==dark。
  - **色值断言**：5 套 × 21 键逐键 == §2 表（照录回归，防实现打错一位）；含 solarized-dark 两「重复值」断言存续。
  - **派生规则枚举（R1）**：§4 表三行——`light`→`theme:light`、`dark`→`theme:dark`、三套花样→`theme:dark`；
    断言 web onChange 一次 `set` 双字段 `{theme, terminalThemeName}`、native `applyPatch` 单次落盘。
    （原「跟随/粘住矩阵」随 R1 废止，改为此派生断言。）
  - **applyTheme 后快照色断言**：会话注 monokai option → 快照 `colors.background`==#272822、`palette[1]`==#f92672；
    切 light → 快照 bg==#ffffff、fg==#383a42（`forceFull` 立即生效）。
  - **配色边沿显式 present**（`SurfaceThemePresentTests`，§5 出帧条款）：applyTheme 一次 → 恰一次显式
    present；连切两主题 → 两次（陈旧快照闪回归锚）；常规 feed 帧 → 零（防逐帧 draw 性能回归）。
  - **996 应答**：`themeName=="light"`→回调填 LIGHT；`dark`/`monokai`/`dracula`/`solarized-dark`→DARK。
- **e2e**（`scripts/app.sh e2e`）：换色三取证（下拉选 monokai → 已开会话即刻变色 + 新建会话继承 + 落盘持久）；
  派生场景（R1：选 `light` → 界面转 light；选 `dracula` → 界面 dark + 终端 dracula）。（原「粘住场景」随 R1 废止。）
- **golden**：全量亮色 golden 23 簇 ≥1 张（screens.json 登记 19 新 + 4 已有）；term-golden fg 默认色修正后
  7 张授权重生成（tools/term-golden 授权登记）。设置弹窗外观区**两行合并为单主题下拉（R1）** →
  set-default/set-update/set-en/set-light **4 张授权重截**（settings-modal.md §4）。

### 8.1 同帧切换案例池（§5.1，B1；spec-coverage 强制 1:1）

| 用例名 | 断言 |
| --- | --- |
| TT_palette_derived_monokai | themeName=monokai → ui.state palette == {#272822, #f8f8f2}（Theme.swift 真值，非 isDark 二值） |
| TT_palette_light_fg | themeName=light → palette.foreground == #383a42（修旧硬编码 #1e1e1e 偏差） |
| TT_palette_dark_frozen | themeName=dark → palette == {#1e1e1e, #cccccc}（与旧硬编码逐字节同值，回归保护） |
| TT_palette_unknown_fallback | 未知 themeName → palette 回退 dark 真值（§1 兜底同源） |
| TT_theme_optimistic_same_frame | web set({theme}) 桥响应未回，data-theme 已翻目标值（同帧） |
| TT_theme_snapshot_correct | set 响应 snapshot → data-theme 以权威 config.theme 复写校正 |
| TT_theme_rejected_rollback | set rejected → 重拉 get 后 data-theme 回滚权威值 |
| TT_theme_transport_rollback | set 传输错 → 同 rejected 回滚路径 |
| TT_theme_no_touch_without_theme | patch 不含 theme → 不碰 data-theme |
| TT_theme_edge_present_single | applyTheme 一次 → 恰一次配色边沿显式 present（§5 出帧条款，settings-dogfood 批） |
| TT_theme_edge_present_consecutive | 连切两主题 → 两次边沿 present（陈旧快照闪回归锚：light 白底帧不得滞留到 monokai 逼帧时弹出） |
| TT_theme_no_present_on_feed | 常规 feed 帧配色不变 → 零边沿 present（防逐帧显式 draw 常驻开销回归） |

## 修订记录

- **2026-07-07（M6 主题批 2.5-B 步1）**：REQ-016 legacy P1 预留位首次实装。★ 用户三裁决（联动开关 / 5 套下拉 +
  花样粘住 / 全量亮色 golden）。行为增强偏差留痕：legacy `App.tsx:82-95` 无条件覆盖 → 本批「智能跟随」
  （themeName∈{dark,light} 跟随、花样粘住、显式恒生效）；默认 dark 弃用 legacy 主进程 `light` 缺省（分歧记录）。
  cursorAccent/selectionBackground 照录不消费（偏差 + 挂账批 3③）；colorScheme unsolicited 通知无 vt API 挂账。
- **2026-07-07（R1 用户巡检返工）**：★ 裁决合并——「界面亮暗 toggle」与「终端配色下拉」两设置合成**单个「主题」
  5 选下拉**（用户觉两设置混乱）。**§4 跟随/粘住语义整节废止**，改「单选择器派生」（`theme` 由所选值单向派生：
  `light`→light，四套深色→dark）；§0 裁决 1/2 划删修订、§8 验证清单改派生断言。web 侧 SettingsModal 合并 +
  onChange 双字段同写 + 4 张 set-* golden 重截（本 agent）；**native 侧原智能跟随纯函数 + 其单测 + e2e 粘住场景
  待 Swift agent 删改为派生**（跨 agent 依赖，已知会 lead）。
- **2026-07-13（右上角批 B1，dogfood 反馈「切主题慢/只有终端先变色」）**：新增 §5.1 全界面同帧切换——
  ①ui.state palette 改随 `terminal.themeName` 派生 Theme.swift 真值（修 TerminalService 硬编码二值：花样主题
  终端洞回退底色错拍 + light 前景 #1e1e1e≠legacy #383a42）；②web `ConfigApi.set` 乐观同帧翻 `data-theme`
  （对齐 legacy App.tsx:81-96 瞬时语义，UI chrome 不再等桥往返）+ snapshot/rejected/传输错三路校正回滚合同；
  ③§8.1 TT_* 案例池 9 条入 spec-coverage 强制 1:1。连带：theme.css 亮色块补 `--code-bg/--code-fg`
  （legacy theme.css:108-109 原样，panels.css 行内代码亮色缺口）。
- **2026-07-16（settings-dogfood 批，真机 dogfood「切主题只有点击过的终端变色/切莫妮卡全体闪白」）**：
  §5 新增「所有存活 surface 必须真正 present 一帧新色」条款——B1 修了 chrome 同帧与 palette 真值，但
  暴露原生面重绘时机洞：`forceFull` 发布新快照后 idle/非 key 面的 `needsDisplay` 不实际出帧，点击聚焦
  经 resize 才逼出新帧；连切时未消费的上一主题快照（light 白底）被 relayout 逼帧弹出=「全体闪白」。
  修=TerminalSurfaceView 帧观察者投递内配色边沿检测 → 显式 draw()（terminal-rendering.md §1 注记）；
  §8 验证清单 + §8.1 池增 TT_theme_edge_present_single/consecutive、TT_theme_no_present_on_feed 三条
  （SurfaceThemePresentTests）。SessionHub 广播链/`lastAppliedTerminalThemeName` 守卫零动
  （registry.allSessions 含收起会话，恢复 attach 走 requestImmediateFrame 拿新色）。
