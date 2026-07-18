# 行为规格：首启欢迎全屏卡片（WelcomeOverlay）

> 提炼自老 app 实际代码（components/tour/WelcomeOverlay.tsx 56 行 + WelcomeOverlay.css 99 行 +
> App.tsx:162-168 + PanelContext.tsx:156-163，2026-07-02 读取），**只记行为不抄结构**。

## 0. 实况修正（任务描述 vs legacy 实码）

- 任务描述称本屏依赖「PanelContext 状态 + localStorage」——**实况无 localStorage**：
  首启判定走 `window.api.app.getPreferences()` IPC（electron-store），`tourCompleted`
  未置位时延迟 1500ms dispatch `SHOW_WELCOME`（App.tsx:163-168）；两个按钮点击时
  `savePreferences({ tourCompleted: true })`。fixture 替身已有 getPreferences/savePreferences
  stub（B2 落地），零扩面；golden 侧宿主直接 dispatch `SHOW_WELCOME`（生产 action）。

## 1. 显隐状态机（PanelContext.tour.welcomeVisible）

- 初始 `{ active: false, welcomeVisible: false }` → 组件返回 null
- `SHOW_WELCOME` → `{ ...initialState, tour: { active: false, welcomeVisible: true } }`
  （**重置全部面板状态**，欢迎页独占）
- 「开始导览」→ savePreferences({tourCompleted:true}) + `START_TOUR`
  （welcomeVisible→false、active→true，交接 tour-overlay.md）
- 「跳过，稍后再看」→ savePreferences + 埋点 ONBOARDING.COMPLETE{skipped:true} + `DISMISS_WELCOME`

## 2. 布局与样式（WelcomeOverlay.css 逐值）

`.welcome-overlay > .welcome-overlay__card > [__title][__desc][__actions > __start-btn + __skip-btn]`

- `.welcome-overlay`：fixed inset 0、z-index **600**、bg `rgba(6, 8, 12, 0.92)` +
  `backdrop-filter: blur(8px)`、flex 居中；入场 welcomeFadeIn 0.4s（截图侧禁动画，静止可截）
- `__card`：text-align center、max-width **420px**、padding `48px 40px`、bg `var(--bg-elevated)`、
  border 1px `var(--border)`、radius **16px**、shadow `var(--shadow-dialog)`；
  入场 welcomeCardIn 0.4s delay 0.1s both（同上禁用）
- `__title`：`欢迎使用 Muxvo`（t('welcome.title')）22px 700 `var(--accent)`、margin `0 0 12px`、
  `var(--font-sans)`
- `__desc`：`Muxvo 是为 AI CLI 工具打造的桌面工作台。\n接下来的快速导览将帮助你了解核心功能。`
  （t('welcome.desc')，`\n` 经 **white-space: pre-line** 换行）14px/1.7 `var(--text-secondary)`、
  margin `0 0 32px`
- `__actions`：flex column、gap 12px、align-items center
- `__start-btn`：`开始导览`；width **200px**、padding `10px 24px`、无边框、radius 8px、
  bg `var(--accent)`、字 `#000` 14px 700；hover：bg `var(--accent-hover)` +
  translateY(-1px) + shadow `0 4px 16px rgba(232,167,72,.3)`（hover 不进 golden）
- `__skip-btn`：`跳过，稍后再看`；无底无边框、字 `var(--text-muted)` 12px、padding `6px 12px`；
  hover 字 `var(--text-secondary)`

## 3. golden

- `wel-card`（dark）：单组件挂载（screens.json 裁决#4）——overlay 直接盖 body 底色
  （--bg-primary），无网格底图；golden 侧 PanelProvider 内 dispatch SHOW_WELCOME，
  web 侧纯静态直渲。ready 把关：`.welcome-overlay__card`。
- specCases 为空（screens.json），纯 golden 批，无 spec 翻牌。

## 4. live 接线（右上角批 B4，2026-07-13）

golden `WelcomeOverlayScreen` 零触碰；live = `WelcomeOverlayLive`（视觉复用 + 外包事件委托层 +
`data-hit-island` 全屏岛），编排在 `LiveOnboarding`（LiveChrome 内、ConfigProvider 之下）：

- **首启门**：config 快照首次就绪且 `tourCompleted==false` → **1.5s 后**出欢迎卡（legacy
  App.tsx:163-168）；快照后续更新不重弹（一次性判定）。`tourCompleted` 持久化走
  `config.request set{tourCompleted}`（PrefsPatch，v33）。
- **「开始导览」**= `set{tourCompleted:true}` + 关欢迎卡 + 进导览；**「跳过，稍后再看」**=
  仅 `set{tourCompleted:true}` + 关卡——两钮均立即置位，欢迎卡一生只出一次（legacy §1）。
- What's New 升级自动弹归 feat/auto-update（native whatsNewStatus 门）；首装 lastSeen 缺席不弹，
  与欢迎卡天然互斥（首装只见欢迎卡，legacy 同构）。

### 4.1 案例池（spec-coverage 强制 1:1）

| 用例名 | 断言 |
| --- | --- |
| WEL_first_launch_gate | tourCompleted=false → 1.5s 后出欢迎卡；=true → 永不出 |
| WEL_start_sets_completed | 开始导览 → set{tourCompleted:true} + 卡关 + drive 进导览 |
| WEL_skip_sets_completed | 跳过 → set{tourCompleted:true} + 卡关 + 不进导览 |
| WEL_legacy_user_exempt | 老版升级豁免（native 半，纯函数）：fresh+踪迹在场+未完成 三真 → 预置 true；非 fresh/已完成/无踪迹任一 → 不动 |

## 5. 老版用户豁免（native 半；用户拍板 2026-07-16）

- 新版首启（lifecycle verdict==freshInstall，数据根本次新建）时，检测**老版数据踪迹** `~/.muxvo`
 （env `MUXVO_LEGACY_TRACE_PATH` 覆盖，单测/反向验证缝）：在场 → ConfigModel 预置 `tourCompleted=true`
  原子落盘——老版 Electron 升级用户不当新人弹欢迎卡/导览。
- 仅 fresh 一次性：既有用户（非 fresh 重启）与已完成引导者不进此分支，任何既有状态不被覆盖；
  「重看导览」入口（§2）不受影响（其本就不重置 tourCompleted）。
- M7 迁移批连带：本条为迁移命题先行件（聊天归档迁移仍归 M7）。
