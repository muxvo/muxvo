# 行为规格：设置弹窗（SettingsModal）

> 提炼自老 app 实际代码（components/settings/SettingsModal.tsx 403 行 + SettingsModal.css 386 行，
> 2026-06-12 读取），**只记行为不抄结构**。新实现是纯展示组件 + fixture props；
> 配置读写/检查更新走桥，复刻屏不实现。

## 0. 数据形状（fixture 驱动）

```
locale: 'zh' | 'en'          // 信封级字段（缺省 zh）；set-en 即 locale=en
settings {
  appVersion: string          // 与 legacy package.json 锁死 "0.5.0"（golden 侧来自 __APP_VERSION__ 编译期 define）
  config {                    // legacy 经 window.api.app.getConfig 异步读入（SettingsModal.tsx:24-37）
    startupTerminalCount      // clamp 1..20（:28）
    doubleClickToFocus        // boolean
    dockBadgeMode             // 'off' | 'realtime' | 'timed'（缺省 realtime，:32）
    dockBadgeIntervalMin      // number（缺省 1，timed 模式才渲染子行）
    defaultTerminalCwd        // '' = 未设 → 显示 placeholder 文案
    terminal.themeName        // ☆M6 主题批：终端配色名（缺省 'dark'；5 套 dark/light/monokai/dracula/solarized-dark，terminal-theme.md §1）
  }
  update: null | { version }  // 非 null = onUpdateAvailable 推送 → updateStatus 'available'
                              // feat/auto-update 加性注记 2026-07-13：live 接线扩三态
                              // | { status: 'checking' | 'up-to-date' | 'error' }（:381-394 复刻，
                              // 状态机与文案=auto-update.md §6/§10；fixture 屏仍只传 null/{version}
                              // → 现有 golden DOM 零动；三态 dom-assert 挂账（§5）由 UPD_settings_* 兑现）
  hooks?: null | {            // 加性注记 2026-07-16（wait-detector.md §7 单绑定入口，update 三态同款缝）：
    state: 'installed' | 'notInstalled' | 'drift' | 'foreignBound',
    reason?, pending?         // 缺席/null = 行不渲染 → golden fixture 不传 hooks，4 张 set-* 零动；
  }                           // disabled（禁装门分身）由 Live 层折算 null 不进屏；WD_panel_* 兑现
}
```

## 1. 打开/关闭

- 打开：PanelContext `OPEN_SETTINGS`（重置其他面板，PanelContext.tsx:164-165）；closed → null（:145）
- 关闭：backdrop 点击 / ✕ / ESC → `CLOSE_SETTINGS`（:39-51）

## 2. DOM 结构与样式（SettingsModal.css）

`.settings-modal__backdrop > .settings-modal > [__header] [__body > __section ×5]`

- `__backdrop`：fixed inset 0、z-index 500、bg rgba(0,0,0,.5)、backdrop-filter blur(4px)、flex 居中
- `.settings-modal`：**宽 420px**、max-width 90vw、**max-height 80vh 纵向滚动**、bg `var(--bg-elevated)`、
  border 1px `var(--border)`、圆角 12px、`var(--shadow-dialog)`（入场动画截图侧禁用）
- `__header`：flex 两端、padding `16px 20px 12px`、底边框 1px `var(--border)`
  - `__title`：齿轮 svg（18×18、`var(--accent)`）+ 文案，15px 600 `var(--text-primary)`，gap 8px
  - `__close`：「✕」18px、`var(--text-secondary)`、padding 4px、圆角 6px
- `__body`：padding `8px 20px 20px`；`__section` margin-top 16px；
  `__section-title`：11px 600 大写 letter-spacing .5px `var(--text-muted)` mb 10px
- `__row`：flex 两端居中、padding `8px 0`；左侧 `__label` 13px `var(--text-primary)` +
  `__desc` 11px `var(--text-secondary)` mt 2px

### 控件样式

- stepper（`__stepper`）：边框圆角 8px 容器 bg `var(--bg-card)`；`__stepper-btn` 32×30 −/＋
  （disabled opacity .3）；`__stepper-value` 宽 36 居中 13px 600 左右分隔线；
  timed 子行版本为 `__stepper-input`（min-width 36、text 输入、size=值长度）
- 双态 toggle（`__toggle-group`/`__toggle-btn`）：容器 bg `var(--bg-card)` 边框圆角 8px padding 2px gap 4px；
  按钮 `5px 14px` 12px 圆角 6px；active = bg `var(--accent)` 字 #000 600（light 主题字 #fff，css:383）
- badge 三档（`__badge-toggle`/`__badge-toggle-btn`）：同 toggle 但 gap 3px、按钮 `5px 11px` 11px
- timed 子行（`__badge-sub-row`）：padding `6px 0 0`；`__badge-sub-label` 11px `var(--text-muted)`
  前置 12×1px 横线（::before）；右侧 stepper + `__badge-sub-unit`（单位文案）
- cwd 行（`__cwd-controls`，max-width 60%）：`__cwd-path` 11px `var(--text-secondary)` max-width 160px
  **direction:rtl 省略**（长路径头部截断）+ `__tour-btn`「浏览」；已设路径时多一颗「清除」（:216-220）
- 按钮 `__tour-btn`：`6px 14px` 12px、边框 `var(--border)` 圆角 8px、bg `var(--bg-card)`
- 快捷键列表（`__shortcut-list`）：bg `var(--bg-card)` 边框圆角 8px；行 `8px 12px` 行间分隔线；
  `__kbd`：min-width 28、`2px 7px`、12px 500、bg `var(--bg-elevated)`、边框+`box-shadow 0 1px 0 var(--border)`、
  圆角 5px、font-family system-ui

## 3. 五个 section 的内容行为

1. **通用**：启动终端数 stepper（1..20，边界 disabled）/ 双击聚焦 启用|关闭 toggle（消费端=洞区
   native 双击→Focused，term-grid.md §2/§2.1，settings-dogfood 批补接）/
   终端默认路径（未设 → placeholder 文案；已设 → rtl 截断 + 清除钮；消费链=新建终端 spawn 落点
   + 抗 .zshrc 漂移 pin，worktree-popover.md §4 WT_PIN_*）/
   **仅 macOS**（`navigator.platform.startsWith('Mac')`，:112,:223）：Dock 角标三档 off|realtime|timed，
   timed 时追加「检查间隔」子行（stepper-input + 单位）；角标口径=可见等待数含静默弱信号
   （wait-detector.md §8 Dock badge 行，settings-dogfood 批）/
   **终端等待检测行（2026-07-16，wait-detector.md §7 单绑定显式启用入口；live-only，hooks 缺席不渲染；
   2026-07-17 用户面归一+停用批改版）**：
   mount 拉一次 `app.request hookStatus`（disabled=禁装门分身 → 折算 null 行不渲染，不广告已禁死功能）；
   右侧按 state 渲染——installed → desc「已启用」+ 按钮「停用」；notInstalled 与 **foreignBound 完全同构**
   （desc「检测终端何时在等你回复，并及时提醒你」+ 按钮「启用」——多实例/绑定概念不出用户可见面，
   wait-detector.md §7 用户面归一条款，2026-07-17 用户裁决；接管语境句只活在 native 授权 sheet）/
   drift →「重新启用」（desc 带漂移 reason）。按钮为独立类
   `.settings-modal__hook-btn`（外观同 `__tour-btn`；**独立类名避开 tour-btn 委托分支的 section/button
   序算术**）→ 点击按 state 分流：installed → `hookDisable`（无 sheet 直达，uninstall+opt-out 记档），
   其余 → `hookEnable`（native sheet 授权确认在缝内，响应即终态回填，取消=当前态原样）；pending 防重入
   +disabled。桥 v38（bridge-v1.md；hookDisable/hookAutoEnableNotice/hookNotice 同批 variant）；
   native 侧 = HookPanelHandling 缝（AppRequestHandler）。
   **首启自动启用一次性轻提示（wait-detector.md §7）**：LiveChrome 常驻挂 `HookEnabledNoticeLive`——
   mount 发一次 `hookAutoEnableNotice`（native 查询即消费清 pending），show=true → 底部居中 toast
   「已启用终端等待检测，可在设置中管理」4s 自动消隐卸载（`.hook-enabled-toast`，live-chrome.css，
   纯显示不拦点击）；show=false/无桥 → 零 DOM（golden 安全）。
2. **外观**：**单行「主题」5 选下拉**（★ 用户裁决 2026-07-07 **R1 合并**，取代前「亮暗 toggle + 终端配色下拉」
   两行裁决——用户觉得两个设置混乱）。5 选项 `dark`/`light`/`monokai`/`dracula`/`solarized-dark`（键序 =
   terminal-theme.md §1）；下拉当前值 = `config.terminalThemeName`（缺省 `dark`）。**界面亮暗由所选值单向派生**
   （选 `light`→界面 light，其余四套皆 dark 系配暗界面，terminal-theme.md §4 单选择器派生）——不再有独立亮暗
   toggle，`theme` 与 `terminalThemeName` 由本下拉一次 `set` 双字段同写。此为 legacy 无对照的新增 UI（legacy
   外观区仅亮暗 toggle）。控件 = `.settings-modal__select`（appearance:none 自绘 chevron，避系统 popup 非确定性）。
   **同帧生效（B1，2026-07-13）**：该 `set` 走 `ConfigApi` 乐观通道——`data-theme` 发请求同帧即翻（UI chrome
   CSS 变量同帧重算，对齐 legacy 瞬时语义），终端 Metal 侧经 onPrefsChanged 重注+forceFull；校正/回滚合同见
   terminal-theme.md §5.1（TT_theme_* 案例池）。
3. **快捷键**：固定 4 行 ⌘T / ⌘← / ⌘→ / 缩放（⌘+ ⌘- ⌘0 三连 kbd `__kbd-group` gap 4px）
4. **语言**：中文|English toggle（active = 当前 locale）
5. **帮助**：新手引导行（`__tour-btn`）+ 检查更新行——desc 含
   `当前版本 v{appVersion}` + `__whats-new-link`「查看更新内容」（`var(--accent)`，:367-374）；
   **新手引导已接线（右上角批 B4）**：行 0 按钮 → 关面板 + 100ms 后 `tourIntent.requestTourStart()`
   （legacy handleRestartTour 对齐，跳过欢迎卡不重置 tourCompleted；tour-overlay.md §7 /
   TOUR_replay_delegate）；检查更新（行 1）归 feat/auto-update 在飞分支；
   右侧按 updateStatus 渲染（:376-396）：
   - idle → `__tour-btn`「检查更新|Check」
   - available → `__tour-btn`「下载 v{version}|Download v{version}」
   - checking/up-to-date/error → 文案 span（error 色 #ff5f57 inline style）——**dom-assert，不出 golden**
   （此行文案是 locale === 'zh' 三元直写，不走 t()，SettingsModal.tsx:363-396）

## 4. golden 与 dom-assert

- `set-default`：zh / config 全默认（count=1 → − disabled、dblClick 关闭、badge=realtime、cwd 未设、
  **主题下拉 = 暗色**）/ update=null
- `set-update`：zh / count=4、dblClick 启用、badge=timed(interval 5)+子行、cwd 已设长路径（rtl 截断+清除钮）/
  update v0.6.0（下载按钮）
- `set-en`：en 代表作（i18n 溢出哨兵）/ badge=timed(interval 10 两位数)、cwd 未设（长 placeholder）、update v0.6.0
- `set-light`：**☆M6 主题批浅色代表作**（本簇亮色 golden，代表态 = 外观区主题下拉=亮色 的组合态，
  screens.json settings-modal 条目登记）
- dom-assert（后续批/M 收口落 vitest，本批仅记录）：updateStatus checking/up-to-date/error 三变体（:381-394）
- dom-assert（2026-07-16 单绑定批，已落 vitest settings-live.dom-assert.test.tsx；2026-07-17 首启启用 UX
  批改版+扩容）：终端等待检测行四态 `WD_panel_row_states`（foreignBound≡notInstalled 归一断言：同「启用」
  钮+同 desc+不含「实例/绑定」字眼；installed=已启用+「停用」钮）/ 启用委托 `WD_panel_enable_delegate`
  （响应 installed → 行转已启用+停用钮）/ foreignBound 仍发 enable `WD_panel_foreign_enable_delegate` /
  停用委托 `WD_panel_disable_delegate`（hookDisable→响应 notInstalled 行回「启用」）/ 禁装门不渲染
  `WD_panel_disabled_hidden` / golden 护栏 `WD_panel_golden_parity`（hooks 缺席 → 无
  `.settings-modal__hook-btn` DOM——4 张 set-* golden 字节不动的机器证明，与 preflight 步5 compare 双闸）
- dom-assert（2026-07-17，hook-notice.dom-assert.test.tsx）：轻提示 `WD_auto_enable_toast`（show=true →
  toast 文案+--visible+查询恰一次；4s+过渡后卸载零 DOM）/ `WD_auto_enable_toast_hidden`（show=false →
  零 DOM，查询仍发一次）

> **☆M6 主题批授权重截（2026-07-07，DOM 变更；R1 合并二次修订）**：外观 section 由「亮暗 toggle + 终端配色
> 下拉」两行 **R1 合并为单行主题下拉** → 四张 golden `set-default` / `set-update` / `set-en` / `set-light` 的
> DOM 结构变更，**授权修订重截**（screens.json 同步标注）。权威迁移 ★：原 golden 权威 = legacy 像素链（M2
> 沿袭），新 DOM 含 legacy 无对照的下拉行 → 重截版权威改为 **★ 用户肉眼冻结**（同 message-editor/orchScreens
> 无对照屏模型），巡检通过后进字节回归纪律。inspectionStatus 待 ★ 字段见 screens.json settings-modal 条目。

## 5. 文案（屏级文案表，zh/en 取 legacy locales/{zh,en}.ts settings.* 全量 + :363-396 直写三元）
