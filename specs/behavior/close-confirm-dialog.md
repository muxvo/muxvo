# 行为规格：关闭确认对话框（CloseConfirmDialog，终端版代表作）

> 提炼自老 app 实际代码（components/terminal/CloseConfirmDialog.tsx 38 行 + CloseConfirmDialog.css 65 行；
> 视觉同构的整 app 版 components/app/AppCloseConfirmDialog.tsx 48 行，2026-06-12 读取），
> **只记行为不抄结构**。新实现是纯展示组件 + fixture props；确认/取消动作走桥，复刻屏不实现。

## 0. 数据形状（fixture 驱动）

```
closeConfirm { terminalId: string, processName: string }
```

## 1. 行为

- 挂载：App.tsx:346-352 始终挂载，open = TerminalContext.closeConfirm.open；!open → null（:19）
- 关闭路径：backdrop 点击 / 取消 → onCancel；确定 → onConfirm（杀进程并关终端）
- **processName 是 props 但当前 legacy 版本不渲染**（:17 解构后未用于 JSX；文案固定
  `t('close.confirm')`「确定关闭此终端？」）——screens.json 状态名「带 processName」按 legacy
  实况落地为：fixture 携带 processName、画面无差异；「无 processName」视觉同图 → dom-assert
- 整 app 版（AppCloseConfirmDialog，terminalCount 文案）视觉同构 → dom-assert
- **note（DOGFOOD_M3_09，2026-07-04）**：backdrop 点外 = 取消（保留，legacy 实况 + REQ-TERM_LIFECYCLE-011「点对话框外部→等同取消」）；**确认后一步到位**——native 收 `term.command close` 后进程退出到终态即自动移除 tile（terminal-session.md §3.2 步骤5），不再留死 tile 让用户误以为没关掉。关闭中（Stopping）期间 tile 上的 ✕ **禁用**（term-grid.md §3.5），连点 ✕ 第二下不再落 backdrop 弹窗一闪即关（「点了没反应」连点陷阱消解）。

## 2. DOM 结构与样式（CloseConfirmDialog.css）

`.close-confirm-overlay > .close-confirm-dialog > [.close-confirm-message] [.close-confirm-actions]`

- `.close-confirm-overlay`：fixed inset 0、bg **rgba(0,0,0,.6)（无 blur）**、flex 居中、**z-index 1000**
  （高于 modal 簇的 500）
- `.close-confirm-dialog`：bg `var(--bg-card, #1e2430)`、border 1px rgba(255,255,255,.12)、圆角 12px、
  padding `32px 40px`、**min-width 400px / max-width 480px**、
  投影 `0 20px 60px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.06)`
- `.close-confirm-message`：15px `var(--text-primary)`、line-height 1.5、居中、mb 24px
- `.close-confirm-actions`：flex 居中 gap 12px；按钮 padding `8px 24px` 圆角 6px 13px 500、
  border 1px `var(--border-color)`（**两侧主题表均未定义 --border-color、无 fallback →
  该声明 invalid → border-color 落初始值 currentColor**，按此实况复刻）
  - `.close-confirm-cancel`：透明底、字 `var(--text-secondary)`，文案「取消」
  - `.close-confirm-ok`：bg `var(--accent, #e8a748)`、字 `var(--bg-deep, #0d1117)`、
    border-color transparent，文案「确定」

## 3. golden 与 dom-assert

- `cc-dialog`：终端关闭代表作（fixture 带 processName="claude"，见 §1 实况说明）
- dom-assert（后续批落 vitest，本批仅记录）：无 processName 同构；AppCloseConfirmDialog
  （`.app-close-overlay`，terminalCount 文案变体）

## 4. 整 app 退出确认（AppCloseConfirmDialog 对等，☆ DOGFOOD_M3_19，2026-07-07 用户新增）

> 提炼自 legacy `src/renderer/components/app/AppCloseConfirmDialog.tsx`（48 行）+ `src/main/index.ts:202-218,720-731`（Cmd+Q 与红叉都拦），2026-07-07 亲验。与 §1-§3 终端关闭版**视觉同构、语义不同**：整 app 退出（非单终端）。dom-assert 落 `web/tests/quit-confirm-live.dom-assert.test.ts`。

- **触发（native 唯一漏斗）**：`AppDelegate.applicationShouldTerminate`——Cmd+Q 与红叉（经 `applicationShouldTerminateAfterLastWindowClosed=true` 汇入同一漏斗，勿另拦 windowShouldClose）都拦。启动完好时置 `quitConfirm{terminalCount}` 待决态 + 推 `ui.state.quitConfirm` + `return .terminateLater`，**不 beginShutdown**（等 web 确认）。
- **两态文案**（`quitConfirmMessage(terminalCount)`）：`terminalCount>0` →「当前有 N 个终端正在运行，退出后将全部终止。」；`==0` →「确定要退出 Muxvo 吗？」（对齐 legacy）。
- **DOM**（复用 §2 `.close-confirm-*` 视觉体，遮罩用 legacy 类名 `.app-close-overlay`）：`.app-close-overlay[data-hit-island] > .close-confirm-dialog > .close-confirm-title「退出 Muxvo」+ .close-confirm-message（两态）+ .close-confirm-actions[.close-confirm-cancel「取消」 .close-confirm-ok「退出」]`。遮罩挂 `data-hit-island`（弹窗期点击全归 web、native 不 detach surface；否则取消钮点击穿透下层 Metal 终端，dogfood P0）。
- **取消路径**：点「取消」/ 点遮罩（backdrop）/ **Esc**（document keydown，挂卸随对话框生命周期）→ `ui.action.cancelQuit` → `TerminalService.cancelQuit`（清待决 + 重推 `ui.state`（quitConfirm 清、web 撤下）+ `NSApp.reply(false)` app 存活）。弹窗体 `stopPropagation`（点对话框内部不触发遮罩取消）。
- **确认路径**：点「退出」→ `ui.action.confirmQuit` → `TerminalService.confirmQuit`（清待决 + 触发 `onConfirmed` = `beginShutdown(reason:.userQuit)` 走**既有优雅关停序**：pty-close-all + wal-checkpoint + graceful flag，见 terminal-session.md §7.1；完成回 `NSApp.reply(true)`）。
- **幂等**：待决期间重复 quit（Cmd+Q 连按 / 红叉）经 `requestQuitConfirm` 幂等——保持首回调、绝不覆盖（**AppKit terminateLater 单 reply 铁律**，双 reply 会崩）。
- **白名单（启动失败直退）**：`AppDelegate.shouldDeferQuitForConfirm(coordinatorIsNoop:hasService:windowVisible:)` = `!coordinatorIsNoop && hasService && windowVisible`——Noop coordinator（启动失败路径 `applicationDidFinishLaunching` catch 里 `NSApp.terminate`）、service 未就位（极早期）、或主窗口不可见（确认卡无处渲染）时不能等确认 → 直退。
- ☆ **红叉 = 窗口级先拦（DOGFOOD_M3_21，2026-07-07，用户真机实锤回修）**：红叉不走 last-window-closed 汇入（该路径窗口**先关**、确认卡无处渲染，app 卡 `.terminateLater` 成僵尸持 instance.lock、重启不能）——`WindowCloseInterceptor.windowShouldClose` **拒关并 `NSApp.terminate`**，与 ⌘Q 汇入同一漏斗、窗口在场弹卡（legacy `mainWindow.on('close') preventDefault` 对等，index.ts:202-218）。取消 → 窗口保持打开。配套防僵尸兜底 = 白名单判据新增 `windowVisible` 轴（上一条）。e2e item8 步骤(0) 红叉直证。
- **薄 UI overlay 态**：`quitConfirmPending` 留在 `TerminalService`（照 searchBar/panelMode 手法，不入 projection）；`mapSnapshot` 每 push 恒读落 `ui.state.quitConfirm`（nullable，照 searchBar 形状）。截图/纯展示模式无 `LiveInteractionLayer`（`TerminalScreen` 门控）→ 整 app 版仅 live 出现，fixture 不含 → golden 静态路径零变。

## 修订记录

- 2026-07-07（DOGFOOD_M3_19）：新增 §4 整 app 退出确认（AppCloseConfirmDialog 对等）。冻结正文 §0-§3（终端关闭版）不改。
- 2026-07-07（DOGFOOD_M3_21）：§4 红叉改窗口级先拦（windowShouldClose 拒关转发）+ 白名单增 windowVisible 防僵尸轴——_19 的红叉「先关后问」缺陷用户真机实锤（Muxvo2.2 僵尸持锁）。冻结正文不改。
