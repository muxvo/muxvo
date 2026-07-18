# 行为规格：终端输入（按键编码 / IME / 粘贴 / 选区 / 鼠标 / 滚轮 / 焦点）

> **本规格无 legacy 结构可提炼**——老 app 输入经浏览器 xterm.js（病根）。权威：vt C API 头文件
> （`~/Library/Caches/muxvo-build/artifacts/include/ghostty/vt/{key.h,paste.h,selection.h,mouse.h,focus.h,formatter.h}`，
> 2026-07-02 核验符号名）+ 设计底稿 `m3-design-annex-A-term-core.md` §3.5/§3.6/§4。少量 legacy 行为锚点亲验并标注
> 「不继承原因」。**只落行为，不抄结构**。状态：**v1-frozen**（2026-07-02 检查点⑨通过；不安全粘贴确认已裁决默认开）。裁决点 ★=用户 ☆=独立 agent。
> target：`MuxvoTermRender`（TerminalSurfaceView 输入端）+ `MuxvoTerm`（编码在会话 queue）。

## 0. 事件流向与红线

- 视图（main）捕获 NSEvent → **async hop 会话 queue** → encoder → PTY write。人键入**直达 PTY、零桥参与**（桥 v1-frozen §8：`terminal:write → native`）。
- **Cmd 快捷键在 `performKeyEquivalent` 层截留给 app**（copy / paste / 字号 / Cmd+F 搜索开关），**绝不进 PTY**（§8）。
- 控制面走结构化通道纪律（核心原则二）：本规格全部是「人眼交互」输入，不涉及编排控制面。

## 1. 按键编码（keyDown → 字节）

| 环节 | 用 vt C API | 自己写 |
|---|---|---|
| 编码 | `ghostty_key_encoder_new/encode/free`（含 Kitty 协议 / modifyOtherKeys / application modes）；`ghostty_key_encoder_setopt` + **`ghostty_key_encoder_setopt_from_terminal`**（每击同步终端模式，如 `GHOSTTY_KEY_ENCODER_OPT_CURSOR_KEY_APPLICATION`）+ `MACOS_OPTION_AS_ALT` 设置项 | macOS `virtualKeyCode → GhosttyKey` 映射表（~100 项）；`NSEvent → GhosttyKeyEvent` 装配（mods / consumed_mods / utf8 / unshifted codepoint 用 **UCKeyTranslate**） |

- **不继承**：legacy 首次输出注入 `bindkey '\e[H' beginning-of-line` 等（manager.ts:225-232）是 xterm.js 的 Home/End workaround；ghostty key encoder 直接产 Home/End 编码，**删除该注入**（terminal-session.md §1.2）。
- 键入自动回底：写 PTY 前若 `VIEWPORT_ACTIVE==false` 先 scroll BOTTOM（terminal-rendering.md §5）。

## 2. IME（NSTextInputClient 最小实现）

- TerminalSurfaceView 实现 `NSTextInputClient`：
  - `setMarkedText` → 存视图侧 preedit → 光标 cell 处画**下划线 overlay**（单行截断）；期间 `ghostty_key_event_set_composing(true)` **抑制转义编码**。
  - `insertText` → 清 preedit → UTF-8 **直写 PTY**。
  - `firstRect(forCharacterRange:)` → 返回光标 cell 屏幕矩形（**候选窗定位**）。
- **不做**：inline 候选、重排、marked range 富样式。
- 复合窗口下 first responder 交接 / 候选窗定位由检查点⑨ spike S3 做实（计划 §二）。

## 3. 粘贴

- `ghostty_paste_is_safe`（判是否含换行 / 结束序列等不安全内容）+ `ghostty_paste_encode`（bracketed = 查 mode 2004）。
- Cmd+V 路由：`performKeyEquivalent` 截 → 取 NSPasteboard 文本 → paste_is_safe 判定。
- **不安全粘贴（含换行 / 结束序列）默认弹确认框——已裁决（⑨）：默认开**（防误粘贴多行命令直接执行，可在设置关闭），见 m3-adjudications.md B 区②。

## 4. 选区与复制

- 用 vt `GHOSTTY_SELECTION_GESTURE_*` 状态机（press / drag / release / autoscroll / deep-press）。gesture 调用须与 terminal 变更**串行 → 全在会话 queue 上执行**。
- **双击词选 / 三击行选内建（已核实，非自写）**：selection.h 有 `GHOSTTY_SELECTION_GESTURE_BEHAVIOR_{CELL,WORD,LINE,OUTPUT}` + `GHOSTTY_SELECTION_GESTURE_DATA_CLICK_COUNT` —— 词/行选由 click_count 驱动 behavior，**无需自写词边界**（附件 A §7 遗留问题①在此**核销**：内建，不走 grid_ref 兜底）。
- release 得到 GhosttySelection 快照经 `GHOSTTY_TERMINAL_OPT_SELECTION` 装回 terminal → render state 的 `GHOSTTY_RENDER_STATE_ROW_DATA_SELECTION` 每行给选中区间 → 快照带行区间（terminal-rendering.md §2）→ 视图画反色。
- **复制**：Cmd+C → formatter 导出选区 plain text（实现时核对 `formatter.h` selection 选项字段名；**兜底 = `GHOSTTY_TERMINAL_DATA_SELECTION` grid_ref 遍历拼 UTF-8**，附件 A §7 遗留问题②仍留实现期核对）→ NSPasteboard。
- ★ **「选中即自动复制」默认关**，留设置。
- 输出滚动时选区存续由 vt tracked grid ref 语义管；视图只管重绘。
- ☆ **Shift+Click 扩展选区（DOGFOOD_M3_17，2026-07-06，独立 agent + 本单）**：Shift+左键按下（scrollbar 拇指命中之后、§5 Shift 旁通之内）不清旧选区，扩展为「固定端→点击格」：固定端 = 活选区逻辑 start（方向保持端，`GHOSTTY_TERMINAL_DATA_SELECTION.start`），无选区回退 gesture 活 anchor（`GHOSTTY_SELECTION_GESTURE_DATA_ANCHOR`），皆无 → 退化普通 press。点选区前 → REVERSE 选区（**不过 `ghostty_terminal_selection_ordered` 归一化**——方向即「start 固定」语义载体；导出/反色天然正确）；点中间 → 收缩为 start..click（xterm.js 6.0.0 incremental 惯例：`SelectionService.ts:478-479` `e.shiftKey?_handleIncrementalClick`、`:523-527` 有 selectionStart 时只移 selectionEnd 到点击点、start 固定，非最近端收缩）。extend 按下**不入 gesture 多击序列**（连 shift+click 不升 WORD/LINE）并 `ghostty_selection_gesture_reset` 挂起序列；其后拖动以 `DATA_SELECTION.start` 为固定端持续更新 end（含 autoscroll tick 同路，tick 期读 NO_VALUE 则 no-op 防御），抬起结束序列（不喂 gesture release——gesture 未见对应 press）。**anchor 存续实证**（SelectionControllerTests ④）：gesture `DATA_ANCHOR` 在单击 release 后**仍存续** → 取值链②足够，**备胎 C（SelectionController 自管 tracked ref）不启用**。CC tracking 活跃时经 §5 旁通同语义；预览视图（sidebarPreview）经共享会话同路作用、零特判。

## 5. 鼠标上报

- `GHOSTTY_MOUSE_*` encoder（tracking 活跃且**未按 Shift** 时编码进 PTY）：查 `GHOSTTY_TERMINAL_DATA_MOUSE_TRACKING` 是否活跃。
- 自己写：NSEvent 坐标 → cell 换算；**Shift 旁通**（按住 Shift 强制走选区而非上报，终端惯例）。
- Shift 旁通落点：旁通后的按下走 §4 ☆ Shift+Click 扩展选区（DOGFOOD_M3_17），非普通清选区 press。

## 6. 滚轮

- 无鼠标追踪 / 按 Shift → `ghostty_terminal_scroll_viewport`（terminal-rendering.md §5）；行增量累积（像素↔行换算）。
- ☆ **alt screen 滚轮转箭头键**（推荐做）：alt screen（`GHOSTTY_TERMINAL_DATA_ACTIVE_SCREEN` == alternate）下滚轮转 Up/Down 箭头键编码——CC / TUI（less/vim）场景刚需。
- scrollbar 拇指拖拽（可见时右缘 12pt 命中带 → `.toOffset` 绝对定位）走渲染侧视图序列，命中判定**先于**鼠标上报（vt tracking 活跃时拇指点击不被上报吃掉）——全语义（命中区/grabOffset/反算/淡出抑制/轨道不做/预览一致）详见 terminal-rendering.md §5 ☆（DOGFOOD_M3_11）。

## 7. 焦点

- `ghostty_focus_encode`（mode 1004）：`becomeFirstResponder` / window key 挂钩驱动焦点上报。
- 失焦时光标画 hollow（terminal-rendering.md §4.3）。
- ☆ **焦点跟随点击 + 点击洞区同步 tile 选中（DOGFOOD_M3_06，2026-07-03，独立 agent + 本单）**：点击洞区（穿透落下层 surface）→ surface `mouseDown` 首做 `window.makeFirstResponder(self)` 令焦点跟随点中的 tile。此前全产品零 makeFirstResponder，焦点永停初始位——多 tile 并排时普通键入与 Cmd+V 粘贴恒歪进先建 tile（用户报点右 tile 粘到左的病根之一）。同一 `mouseDown` 经 `onUserClick(session.id)` native 直报同步 tile 选中（grid→tileClick / sidebarPreview→sidebarSelect，与 web 动作同路，见 term-grid.md §3.3）。配套：`resignFirstResponder` 时 `inputContext?.discardMarkedText()` + 清 preedit（组字中被夺焦 markedText 残留加固，点 web 同触发）。

## 8. Cmd 快捷键截留清单（performKeyEquivalent，绝不进 PTY）

| 快捷键 | 动作 | 备注 |
|---|---|---|
| Cmd+C | 复制选区（§4） | 有选区才截；无选区放行（部分 TUI 需 Cmd+C？—— macOS 惯例 Cmd+C=复制，Ctrl+C 才是中断，放行 Ctrl+C 进 PTY） |
| Cmd+V | 粘贴（§3） | 走 paste_is_safe |
| Cmd+`+` / `-` / `0` | 字号 in/out/reset | 渲染参数；渲染原生。**两路归一**（DOGFOOD_M3_05）：web 起源走 term.command zoom；native 键位走「显示」菜单——surface performKeyEquivalent 对字号键 `return false` 放行给菜单系统，两路都汇入 `TerminalService.applyZoom → UIStateProjection.zoom`（单一状态源） |
| Cmd+F | 搜索条开关 | native 截获 → 驱动 web 显示搜索条（桥草案 §ui.state searchBar；搜索执行 terminal-search-bar.md 批 5 扩段） |
| Cmd+N | 新建终端（菜单直建） | ☆ DOGFOOD_M3_20（2026-07-07 用户新增）：**surface 不自截**——CommandKeyInterception 表无 N，surface 对 Cmd+N `return false`，落 NSMenu「文件→新建终端」performKeyEquivalent → `AppMenuCommands.newTerminal` → `TerminalService.createTerminalFromMenu`（与 FAB / term.command create 同链 `projection.createTerminal(cwd:nil)`）。**行为变化**：裸 Cmd+N 原会进 PTY（多数 shell 无绑定=无操作），现被文件菜单截走恒新建。满员时菜单项经 `validateMenuItem` 置灰（与 FAB disabled 对齐）。legacy 无此菜单已核实。 |

- 其余 Cmd 组合（Cmd+W 关闭 tile 等）由 app 菜单 / 窗口层处理，不在本清单。
- ☆ **Cmd 截留焦点守卫（DOGFOOD_M3_06，2026-07-03，独立 agent + 本单）**：`performKeyEquivalent` 仅当**该 surface 为 `window.firstResponder`** 才截留本清单动作；非焦点一律 `return false` 放行（交回 WKWebView，web 输入框自吞 Cmd+V/C → 再回菜单系统，zoom 键不变）。因 AppKit keyEquivalent 按**视图树 DFS 首答制**——多 surface 下先入树的 surface 先被问到，若不查自身是否 first responder 就 intercept，Cmd+V/C/F 恒被先建 tile 抢走（甚至吸走 web 重命名/搜索输入框的 Cmd+V）。守卫必须置于 `performCommandKey` **之前**（interceptPaste 判定即副作用：控制器就地取剪贴板 paste 进 attach 绑死的自身会话）。`window==nil`（未接线 / 独立视图）返 false，与放行一致。

> ☆ **⌘+/-/0 面板缩放路由（dogfood-r3 问题5，2026-07-10）**：菜单 onZoom 改经 `TerminalService.applyZoomRouted`
> 单一路由——**终端网格为主视图**（panelMode==terminal 且无 web overlay 上报）→ `applyZoom` 缩终端字号（上述
> 现状完全不变，含 filePanel 侧栏挂着时）；**全页面板在前**（panelMode 非 terminal，或 web 上报 skills/mcp/
> hooks/plugins/settings overlay（source="panel"）/ file tabs 视图（source="fileTabs"）开着）→ `applyPanelZoom`
> 缩 web 面板。panelZoom 全局单值 ±0.1 阶梯 clamp [0.6,2.0]、⌘0 复位 1.0，持久化 config 根级 `panelZoom`，
> 经 `ui.state.panelZoom`（optional，==1.0 省略保 fixture/golden 字节冻结）下发 → web main.tsx 写
> `--panel-zoom` → panel-zoom.css 以 CSS `zoom` 应用（全部规则挂 `.muxvo-live` 前缀，截图零像素影响）。
> 选 CSS zoom 非 pageZoom：标准化 zoom 下 gBCR 返回缩放后视口坐标 → layoutReport 洞链路（详情 live 洞/
> file tabs 终端洞）自愈、native 4 个坐标换算点零改动；pageZoom 则 viewportMatches 守卫拒收全部洞上报。
> overlay 上报走 ui.action 新变体 `panelOverlayReport{source,active}`（组件卸载 cleanup 发 false +
> setPanelMode 切换 native 防御清空双兜底）；web term.command zoom 路径不变（其发送方只在网格形态）。
> 测试：PanelZoomTests（路由矩阵/阶梯/持久化/字节冻结守卫）+ e2e item40（网格回归/taskCenter 缩放/
> overlay 路由+网格洞零漂移/file tabs 洞 CSS zoom 自愈承重墙——若红退路 = rect 上报处乘 Element.currentCSSZoom）。
>
> ☆ **字号缩放全链落地（DOGFOOD_M3_05 裁决，2026-07-03，独立 agent）**：
> - **键位双绑**：用户实际按 **Cmd+=（不带 shift）**，惯例菜单显示 ⌘+。「放大」项 keyEquivalent `+`（可见，对应 Cmd+Shift+=）+ 隐藏 companion keyEquivalent `=`（截获裸 Cmd+=）——隐藏项键位仍参与 `NSMenu.performKeyEquivalent` 匹配（Terminal.app/Safari 技法，已用独立探针 + 单测 R1 实证 4 键位全命中）。缩小 `-`、实际大小 `0` 各单项。
> - **持久化**：zoom 后写回 `config.terminal.fontSize`（落盘，重启保留）。依据 = legacy 三方对照实况：老 Electron 版 Cmd+=/− 是**全局 webFrame 缩放**、持久化为 `config.json` 的 `zoomLevel`（PRD REQ-ONBOARD_PREFS-014「松手约 0.5 秒保存」），重启复原。新架构无 webFrame，zoom 即 fontSize，故映射为持久化 `terminal.fontSize`（单维度收敛）。
> - **复位语义**：单维度模型下 `Cmd+0` 复位到本会话启动时的字号（`projection.initialFontSize = loaded.terminal.fontSize`）。会话内恒回启动值；跨重启因字号已持久化，复位锚点即上次持久值——是单维度模型对 legacy「zoom 持久化」的自然推论，非发明。

## 9. M3 spec 桶断言映射（本规格承接部分）

| spec ID | 承接节 | 断言要点 | owner |
|---|---|---|---|
| TERM_L1_02 write | §0/§1 | `session.write("ls\n")` 后 PTY 回读含回显（真 PTY 集成）；负向：桥无终端写消息 | swift |
| TERM_L1_05 output（负向） | §0 | `BridgeMessageType` 全枚举**无任何终端输出消息**（病根不回潮）+ 原生摄入合同 | swift |
| （IME） | §2 | 直调 NSTextInputClient：setMarkedText→overlay 模型态；insertText→假会话记录 PTY 写入 | swift |
| （选区/复制） | §4 | gesture press→drag→release → 行区间正确；Cmd+C 导出文本==期望 | swift |

> TERM_L1_03（resize）落 terminal-session.md §4。鼠标/滚轮/焦点无独立 legacy spec，纳入渲染/输入集成测与 dogfood 人工巡检（计划 §十二）。

## 修订记录

- **2026-07-06（DOGFOOD_M3_17）**：用户反馈「先选中一处、滚到别处按住 Shift 点击，希望选区扩展为锚点到点击整段」（终端/编辑器行业惯例，长 scrollback 回看刚需）。定性 = **行为对等缺口**（非违背）：此前 Shift+左键落进普通清选区 press，远处单击 gesture 返 NO_VALUE → 清旧选区。三方对照：legacy muxvo 用 xterm.js 6.0.0，`SelectionService.ts:478-479` `e.shiftKey?_handleIncrementalClick`、`:523-527` 有 `selectionStart` 时只把 `selectionEnd` 移到点击点（start 固定），无 selectionStart 时 no-op——即「固定端→点击格」。独立设计 agent 裁定单一规则：固定端 = 逻辑 start（方向保持端），点后 FORWARD / 点前 REVERSE（不归一化，方向即语义载体）/ 点中间收缩为 start..click（非最近端收缩）。改动点：§4 追加 ☆ Shift+Click 扩展选区 + §5 交叉引用；`SelectionController.extendPressOnQueue`/`fixedStartRef`/`extendDragActive`、`TerminalSession.selectionPress(shiftExtend:)`、`TerminalSurfaceView.mouseDown` 传 `.shift`。anchor 存续实证（单测 ④）：gesture `DATA_ANCHOR` 单击 release 后存续，备胎 C 未启用。v1-frozen 主体不变，本条为增补留痕（教训：绝不静默改冻结 spec）。
