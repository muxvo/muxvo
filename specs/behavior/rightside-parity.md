# 验收台账：右上角按钮区 + 设置面板 legacy 交互对齐（右上角批，2026-07-13）

> **验收目标（用户原话）**：右上角三个按钮 + 设置面板内所有按钮的**全部交互**与老版一模一样；
> 与老版同名主题颜色一模一样（新增主题按现状）。本表 = 老版行为清单（三份调查报告提炼）逐条
> 对照新版落点与测试载体；「偏差」列显式登记全部有意偏离。状态 ✅=已实现且有测试把守。
> 案例名指向各 behavior spec 案例池（spec-coverage 1:1 机器闸）；e2e itemNN 见
> `scripts/app.sh e2e` 报告。

## 1. 右上角按钮区（menu-bar.md）

| ID | 老版行为 | legacy 依据 | 新版落点 | 测试载体 | 偏差 | 状态 |
|---|---|---|---|---|---|---|
| PAR-01 | 齿轮点击开设置浮层（先关其它覆盖面板） | MenuBar.tsx:191-203 | LiveChrome onSettingsClick（单 panel state 天然互斥） | vitest CONFIG_L1_09/15 + e2e item52① | — | ✅ |
| PAR-02 | 问号=新建终端（恒 home）+选中+关面板+注入 claude 读 guide.md | MenuBar.tsx:113-130 | helpOpen 一条龙（LiveChrome/ChatHistoryChrome 双接线；cwd 显式 home——对抗 MINOR-2 回修，不吃默认路径偏好） | MB_HELP_* ×4 + e2e item53 | 静默门+尺寸就绪门替代固定 500ms 盲延时（机制上位，效果一致） | ✅ |
| PAR-03 | 问号满 20 终端静默失效（无 disabled 视觉） | MenuBar.tsx:114 | openHelpSession maxReached guard（+createTerminalUnified 内层拒绝双保险） | MB_HELP_create_select（guard 行为）；上限本体由 MW_* 池把守 | — | ✅ |
| PAR-04 | 小人（未登录）点击开登录弹窗 | AuthButton.tsx | LiveChrome onLoginClick → LoginModalLive | e2e item54① | — | ✅ |
| PAR-05 | 小人（已登录）=头像，点击 toggle 下拉 | UserDropdown.tsx | MenuBar auth 态 + onUserToggle | e2e item54⑤ | — | ✅ |
| PAR-06 | 头像下拉：用户名/provider/登出；外点关闭 | UserDropdown.tsx | UserDropdown golden + LiveChrome dropdownOpen/mousedown 外点关 | e2e item54⑤（开合+登出）；外点关无自动化测试=真机走查项（对抗 MINOR-4 载体诚实化） | — | ✅ |
| PAR-07 | 登出=尽力服务端吊销+本地必登出 | AuthContext/auth-manager | AuthManager.logout | AUTH_logout_local_always | — | ✅ |
| PAR-08 | 按钮 hover 高亮（26×26/圆角6/title tooltip） | MenuBar.css:113-135 | menubar.css（golden 冻结） | menu-bar golden + visual-diff 96/96 | — | ✅ |
| PAR-09 | 更新进度环（下载中出现/绿勾/红叉/tooltip） | UpdateProgress.tsx | MenuBar UpdateProgress golden 件已备 | mb-upd-* golden/dom-assert | **live 接线归 feat/auto-update 在飞分支（M7）**，本批不接 | ⏸ 归属外 |
| PAR-10 | 菜单栏在聊天历史视图同样可用（问号/齿轮/登录） | legacy 单 MenuBar 全局 | ChatHistoryChrome 同套 handlers（信箱回终端） | vitest chat-r1-batch3 既有 + loginIntent/tourIntent 机制 | 新版双树实现（行为等价） | ✅ |

## 2. 设置面板（settings-modal.md）

| ID | 老版行为 | legacy 依据 | 新版落点 | 测试载体 | 偏差 | 状态 |
|---|---|---|---|---|---|---|
| PAR-11 | ESC/遮罩/✕ 三路关闭 | SettingsModal.tsx:44-51 | SettingsModalLive backdrop/close + LiveChrome Esc | vitest settings-live「✕ 关闭」+CONFIG_L1_15 | — | ✅ |
| PAR-12 | 启动终端数步进器 1-20，下次启动生效 | REQ-ONBOARD_PREFS-008 | set{startupTerminalCount}（越界钮 disabled） | vitest settings-live | — | ✅ |
| PAR-13 | 双击聚焦 开/关，立即生效 | REQ-009 | set{doubleClickToFocus}；消费端=洞区 native 双击→maximizeTile（term-grid.md §2.1，settings-dogfood 批补接——本批前仅设置项无消费者，真机 dogfood 2026-07-16 暴露） | vitest settings-live + TG_dblclick_* ×3 | shift+双击排除（新版 shift+click=扩选手势，legacy 无此约束） | ✅ |
| PAR-14 | 终端默认路径 浏览（系统选目录）/清除，立即 | REQ-010 | app.request selectDirectory + set{defaultTerminalCwd} | vitest settings-live | — | ✅ |
| PAR-15 | Dock 角标 关闭/实时/定时三段+定时间隔（仅 macOS；间隔可手输，blur/Enter 提交非法回 1） | REQ-011/012 | set{dockBadgeMode/dockBadgeIntervalMin}；手输框已接线（对抗 MAJOR-2 回修：M6 批1 预存 readOnly 死件）；渲染通道改自绘 contentView（macOS 26 badgeLabel 抑制规避，三态行为不变，wait-detector.md §8） | vitest settings-live（含手输 case）+ DockTileRendererTests | 默认 realtime（legacy 代码实况；PRD 说 off 系文档矛盾，取代码实况） | ✅ |
| PAR-16 | 主题切换立即全量生效（UI+终端同帧） | REQ-013 / App.tsx:81-96 | ConfigContext 乐观 data-theme + onPrefsChanged 双链 | TT_* ×9 + e2e item52 | 新版 5 选下拉取代亮暗 toggle（R1 用户裁决在先）；暗色族互切 UI chrome 不变属设计 | ✅ |
| PAR-17 | dark/light 主题颜色与老版逐值一致 | theme.css / terminal-themes.ts | 亲自 diff：UI CSS 变量逐值一致+终端 5 套色板逐键一致；B1 补 light --code-bg/--code-fg 缺口 | UIStatePaletteTests + MuxvoTermRenderTests ThemeTests 色表 | 新版 theme.css 无 --bg-grid-gap（legacy 死变量零消费）/--warning/--info/--purple（组件已内联同值）——等价达成 | ✅ |
| PAR-18 | 快捷键区只读展示 | SettingsModal.tsx | SettingsModalScreen 静态（golden 冻结） | settings-modal golden | 新版含 ⌘⇧L 等新增行（新功能如实展示） | ✅ |
| PAR-19 | 语言 中文/English 立即全界面重绘 | REQ-029 | set{language} → 全簇 locale 消费（对抗 MAJOR-1 回修：LoginModal/Tour/Welcome/MenuBar titles+tabs+登出 补 en 表，legacy en.ts 逐字） | vitest settings-live + AUTH_UI_locale_en | 配置四 tab（Skills/MCP/Hooks/Plugins）legacy 双语言均硬编码英文（对齐） | ✅ |
| PAR-20 | 帮助区「新手引导」重放：关面板 100ms 后进导览（跳欢迎卡不重置标记） | SettingsModal.tsx:114-117 | tourIntent 信箱 + LiveOnboarding | TOUR_replay_delegate + TOUR_replay_from_settings | — | ✅ |
| PAR-21 | 帮助区「检查更新」状态机 + 版本号 + What's New 链接 | SettingsModal.tsx:119-143 | —— | —— | **整链归 feat/auto-update 在飞分支**（用户拍板「更新归 M7 已在做」）：其分支已实装版本号真值/What's New live/五态状态机 | ⏸ 归属外 |
| PAR-22 | 每改一项即时落盘，无确认按钮 | SettingsModal 全 handler | ConfigContext.set 乐观+校正 | vitest settings-live 全 case | — | ✅ |

## 3. 首启欢迎与新手引导（welcome-overlay.md / tour-overlay.md）

| ID | 老版行为 | legacy 依据 | 新版落点 | 测试载体 | 偏差 | 状态 |
|---|---|---|---|---|---|---|
| PAR-23 | 首启（!tourCompleted）1.5s 后弹欢迎卡 | App.tsx:162-168 | LiveOnboarding WELCOME_DELAY_MS | WEL_first_launch_gate | — | ✅ |
| PAR-24 | 开始导览/跳过均立即置 tourCompleted（卡只出一次） | WelcomeOverlay.tsx | WelcomeOverlayLive 两钮 | WEL_start/skip_sets_completed | 埋点 ONBOARDING.COMPLETE 不做（analytics 通道 M7 后议） | ✅ |
| PAR-25 | 四步导览：建终端/聚焦/重命名/开文件，推进=真实动作+500ms | steps.ts/TourOverlay.tsx | TourOverlayLive + tour-live-logic | TOUR_advance_matrix | — | ✅ |
| PAR-26 | 步 1→2 后遮罩隐藏；×/ESC=跳过；完成 toast 3s | TourOverlay.tsx:94-95 | onHighlighted display:none + 双钩收口 + toast | TOUR_* + 真机走查 | driver.js 同库同版像素同源 | ✅ |
| PAR-27 | 升级首启 2s 弹 What's New（首装不弹） | App.tsx:171-184 | —— | —— | **归 feat/auto-update**（其 WhatsNewGate native 门+web 2s 已实装） | ⏸ 归属外 |

## 4. 登录（login-modal.md / user-dropdown.md）

| ID | 老版行为 | legacy 依据 | 新版落点 | 测试载体 | 偏差 | 状态 |
|---|---|---|---|---|---|---|
| PAR-28 | buttons 态三入口：GitHub/Google/账号密码 | LoginModal.tsx | LoginModalScreen golden + LoginModalLive | lg-buttons golden + item54② | — | ✅ |
| PAR-29 | 条款守卫：未同意先弹二层，同意并继续执行挂起动作；每开重置 | LoginModal.tsx:36-56 | termsAgreed ref + guardAction | AUTH_UI_terms_guard + item54② | — | ✅ |
| PAR-30 | 条款/隐私链接开系统浏览器（muxvo.com/terms /privacy） | LoginModal.tsx | openExternal（scheme 白名单） | ConfigRequestHandlerTests openExternal | — | ✅ |
| PAR-31 | OAuth：开系统浏览器+轮询交付；2 分钟超时「登录超时，请重试」 | auth-handlers.ts/AuthContext | AuthManager.loginOAuth + web OAUTH_TIMEOUT_MS | AUTH_oauth_poll_flow（native 轮询面）；web 2min 超时文案无自动化测试=真机走查项（对抗 MINOR-4 载体诚实化） | 深链不做（legacy 服务器实践不发深链重定向，轮询是唯一交付路径） | ✅ |
| PAR-32 | 密码登录：email 合法+密码非空才可提交；Enter 提交 | PasswordLoginForm | canSubmit + onKeyDown | AUTH_UI_mode_machine + item54③（点击提交面）；Enter 提交无自动化测试=真机走查项（对抗 MINOR-4 载体诚实化） | — | ✅ |
| PAR-33 | mode 机 back 规则：forgot→login，其余→buttons | LoginModal.tsx:93 | switchMode | AUTH_UI_mode_machine | — | ✅ |
| PAR-34 | 注册：6 位码（剥非数字）+密码≥8；60s 重发冷却 | RegisterForm | LoginModalLive registerReady/cooldown | AUTH_UI_cooldown | — | ✅ |
| PAR-35 | 忘记密码：重置成功不自动登录，显示提示+返回登录 | ForgotPasswordForm | resetSuccess 态 | AUTH_reset_no_autologin | — | ✅ |
| PAR-36 | 错误条 3s 自清 + 手动 ✕ 即清；错误文案中文 | LoginModal/AuthContext | error state + auth-strings.ts + __error-dismiss（对抗 MINOR-1 回修） | AUTH_UI_error_autoclear + AUTH_error_code_map + 错误条✕ vitest case | 文案经稳定码映射（逐条对齐 legacy ERROR_MESSAGE_MAP） | ✅ |
| PAR-37 | 登录成功自动关弹窗+头像上位 | AuthContext LOGIN_SUCCESS | auth.loggedIn effect | item54④ | — | ✅ |
| PAR-38 | 启动恢复登录态（存量 token→档案→refresh 兜底） | tryRestoreSession | AuthManager.tryRestoreSession | AUTH_restore_three_stage | — | ✅ |
| PAR-39 | token 持久化：明文+0600+原子写；损坏清除重登 | token-storage.ts | AuthTokenStore | AUTH_password_login_flow(0600) + AUTH_token_store_corrupt | 路径=分身数据根 auth-token.json（不继承 legacy userData/.auth-token；多分身隔离） | ✅ |
| PAR-40 | 12min 定时预刷新；刷新失败→过期登出 | auth-manager.ts | AuthManager refresh loop | AUTH_refresh_rotation + AUTH_refresh_expiry | — | ✅ |
| PAR-41 | 邮箱验证码登录（verify-email-code） | EmailLoginForm.tsx | 不做 | — | **legacy UI 不可达孤儿代码**（LoginModal 从未挂 EmailLoginForm），对齐范围=UI 可达交互 | ➖ 不适用 |

## 5. 全局偏差汇总（有意偏离，均已裁决/登记）

1. **帮助注入时机**：legacy 固定 500ms 盲延时 → 静默门+尺寸就绪门（机制上位替代，用户可见效果一致）。
2. **token 路径**：legacy `userData/.auth-token` → 新版 `<分身数据根>/auth-token.json`（多分身隔离铁律）；
   Keychain 升级挂账（ad-hoc 签名分身撞 Keychain 身份）。
3. **OAuth 深链**：不注册 muxvo:// scheme——legacy 服务器实践只走轮询（HTML 成功页），深链是死路径。
4. **更新族**（更新环 live/检查更新/What's New/版本号真值）：归 feat/auto-update 在飞分支（用户拍板）；
   合并后 PAR-09/21/27 由其闸口把守。
5. **主题选择器形态**：亮暗 toggle → 5 选下拉（2026-07-07 R1 用户裁决在先，非本批偏离）。
6. **首启默认主题**：legacy 实际生效 default=light（config.ts）vs 新版 default=dark（2026-07-07 M6 主题批
   分歧记录在案，terminal-theme.md 修订记录）——维持新版现状。
7. **analytics 埋点**（THEME.SWITCH/ONBOARDING.COMPLETE 等）：app.telemetry 通道 stub，全局不做（M7 后议）。
8. **注册/忘记表单形态**（对抗 MINOR-3 登记）：legacy 渐进披露（发码后才现验证码/密码/提交钮）+ 短密码
   红字提示 + Enter 未发码时=发码——新版全字段常显、无提示、Enter 恒提交；重发文案粘性已回修
   （codeSentOnce）。差异属表单编排非功能缺失，登记 V1.1 打磨债。
9. **测试进程挂起 sleep 自旋**（对抗 MINOR-5 登记）：MuxvoAuthTests 默认测试 sleep 的刷新档 50ms
   自旋至任务取消——仅测试进程内、进程退出即收，非生产路径。

## 6. 闸口档案（B6 收官；合并 main reconcile 后终版 2026-07-14）

- Swift 串行全量 **1768/1768 全绿 0 失败**（合并树终档）；分支自跑 1736/1736
- vitest 700/700 · tsc 零错 · codegen --check --selftest GREEN（**v34** reconcile 终版，14/15，10/11）
- spec-coverage：TT_9 + MB_HELP_4 + TOUR_3 + WEL_3 + AUTH_16 全池 1:1 绿
- 对抗验收：ACCEPT-with-必修（2 MAJOR / 8 MINOR，logs/topright-parity-adversarial.md）——
  MAJOR-1 i18n 全簇补 en / MAJOR-2 间隔手输接线 / MINOR-1/2/6/7/8+重发粘性 顺手回修；
  MINOR-3/5 登记（§5.8/§5.9）；MINOR-4 载体诚实化（PAR-06/31/32）
- visual-diff 96/96 PASS（全批零像素动、零重冻、无用户巡检项）
- e2e：**52 绿 2 红终局**——item51（auto-update）/52/53/54 四关全绿同场；红集=item17 焦点 flaky +
  item15 main 预存（均在册，logs/r6-fix-adversarial.md 定性档）；合并连带修 item51 defer nil 断线
- 合 main bd570eb（未 push）；dogfood=/Applications/muxvo测试7.app 同身份同数据根重刷（含本批+
  auto-update+min-rail 全量），指纹已验（MuxvoAuth 符号 235+guide/CHANGELOG 资产）
- Swift 串行全量档 + preflight 八步：见收官提交记录
