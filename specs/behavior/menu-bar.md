# 行为规格：顶部菜单栏（MenuBar + UpdateProgress + AuthButton）

> 提炼自老 app 实际代码（components/layout/MenuBar.tsx 207 行 + MenuBar.css 135 行 +
> layout/UpdateProgress.tsx 121 行 + UpdateProgress.css 142 行 + auth/AuthButton.tsx 30 行，
> 2026-06-12 读取），**只记行为不抄结构**。
>
> ⚠️ 与 screens.json 状态描述的偏差（以 legacy 实渲染为准，golden=像素权威）：
> legacy MenuBar **不渲染**「返回平铺」按钮与语言切换器——`viewMode`/`onBackToTiling` props 与
> `useI18n().setLocale` 均被解构但 JSX 未使用（MenuBar.tsx:29-33,132-206 全文核对）；
> `.menu-bar__back-btn` 是 CSS 死规则（MenuBar.css:83 无 JSX 消费点）。语言切换实际在
> SettingsModal（:335-341）。故 mb-focused = Focused 底图 + 计数 badge + 登录态组合，无返回钮。

## 0. 数据形状（fixture 驱动）

```
screen: 'menu-bar'
base: { ...terminal-grid 全量屏级字段 }   // 底图；terminalCount = base.terminals.length
menuBar?: { activeTab }                   // 缺省 'terminals'（B3 golden 全为 terminals 激活）
auth: null | { username, email?, provider, avatarDataUri }  // null=未登录；avatar 一律 data-URI
update: null | { state:'downloading', percent, transferred, total, bytesPerSecond }
             | { state:'done', version }  // feat/auto-update 加性注记 2026-07-13：done 态入形状供 live
                                          // 接线（§4 状态机既有；绿对勾+气泡两行文案，fixture 屏不新增
                                          // golden——tooltip 不出 golden 既有约定，走 vitest dom-assert）
             | { state:'error' }          // null = UpdateProgress 不可见（idle）
```

## 1. 布局与样式（MenuBar.css）

`header.menu-bar > [__drag-region][__title][nav.__tabs ×6 tab][__right-group]`

- `.menu-bar`：高 `var(--menu-bar-height)`（36px）、flex 居中、bg `rgba(10,14,20,.7)` +
  `backdrop-filter blur(20px) saturate(180%)`（light: `rgba(240,240,243,.7)`）、
  底边框 1px `var(--border)`、padding `0 12px`、gap 2px、z-index 300、flex-shrink 0
- `__drag-region`：absolute inset 0（-webkit-app-region drag，截图无视觉）
- `__title`：「Muxvo」12px 500 `var(--text-secondary)`、margin-left **72px**（让位红绿灯）、mr 8px、z 1
- `__tabs`：flex gap 2px z 2；tab：padding `5px 14px`、圆角 5px、13px 600 `var(--text-secondary)`、
  bg transparent 无边框；active：bg `var(--accent-glow)`、字 `var(--accent)`
- 六 tab 文案：`终端`（t('menu.terminal')，+badge）/ `Skills` / `MCP` / `Hooks` / `Plugins` /
  `历史聊天`（t('menu.chatHistory')）——中间四个硬编码英文（MenuBar.tsx:149-167）
- `__badge`：terminalCount>0 才渲染（:143）；10px 700、bg `var(--accent-glow)` 字 `var(--accent)`、
  padding `0 5px`、圆角 8px、ml 6px
- `__right-group`：margin-left auto、flex gap 4px、z 2；子项顺序 **UpdateProgress → AuthButton →
  帮助钮 → 设置钮**（:177-204）
- `__icon-btn`：26×26、圆角 6px、`var(--text-secondary)`、svg 15×15；
  帮助=圆圈问号 svg、设置=齿轮 svg（与 settings-modal 同款 path）

## 2. activeTab 推导（MenuBar.tsx:41-48）

skills>mcp>hooks>plugins>chat 依面板 open 状态优先，否则 terminals。复刻屏由 fixture 直给。

## 3. AuthButton 两态（AuthButton.tsx）

- 未登录：`.menu-bar__icon-btn`（人形轮廓 svg：`M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2` +
  circle cx12 cy7 r4），title=t('auth.loginButton')
- 已登录：渲染 UserDropdown 闭合 trigger（见 user-dropdown.md）

## 4. UpdateProgress 状态机（UpdateProgress.tsx:10-68）

`idle | downloading | done | error`；idle → null 不可见（:57）。事件订阅即数据源：
onUpdateDownloading（→downloading+info）/ onUpdateDownloaded（→done，3s 后隐藏）/
onUpdateError（→error，3s 后隐藏）。golden 用 stub 订阅即同步回调冻结状态。

- 容器 `.update-progress`：26×26、圆角 6px、relative
- 环 `.update-progress__ring`：svg viewBox 0 0 24 24、absolute inset 1px、24×24；
  track 圆 r9 stroke `rgba(255,255,255,.06)`（light `rgba(0,0,0,.08)`）宽 2；
  fill 圆 r9 stroke `var(--accent)` 宽 2、linecap round、dasharray **56.55**、rotate(-90deg)；
  `strokeDashoffset = 56.55 × (1 − percent/100)`（downloading）/ 0（done）/ 56.55（error）
- 图标 `.update-progress__icon`：12×12 svg `var(--accent)`；downloading=下箭头（strokeWidth 2.5）、
  done=对勾（#28c840，环同色）、error=✕（#ff5f57，环同色）（strokeWidth 3）
- done/error 加 `--fade-out`（animation delay 2s——截图侧动画禁用，静止可截）
- tooltip（`__tooltip`，:96-118）：默认 display:none，:hover 才显——**dom-assert，不出 golden**；
  内容：标题（正在下载更新.../v{X} 下载完成/下载失败）+ downloading 时进度条（width=percent%）+
  `{transferred} / {total}` 与 `{bytesPerSecond}/s`（formatBytes：<1MB → KB 取整，否则 MB 一位小数）

## 5. golden 与 dom-assert

- `mb-focused`：Focused 底图（focused 终端+侧栏）+ badge=3 + 已登录 avatar + update=null
- `mb-upd-downloading`：Tiling 底图 + 未登录 + downloading percent=63（环 63%）
- `mb-upd-error`：Tiling 底图 + 未登录 + error（红 ✕、环空）
- dom-assert：六 tab 激活态互斥 / 未登录 icon 态 / tooltip 内容（大小+速度）；
  done 态 fade-out 计时器 = 动画中帧，跳过（screens.json 裁决）

## 6. 问号=帮助会话一条龙（右上角批 B3，2026-07-13；legacy MenuBar.tsx:113-130 行为对齐）

问号按钮**不是菜单也不是链接**：点击 = 开一个「可问答的帮助会话」。行为链（native 一条龙，
`ui.action helpOpen`）：

1. **web 侧**（LiveChrome / ChatHistoryChrome 均接线——legacy MenuBar 全局可用对齐）：先关当前
   覆盖面板 / chatClose 回终端（legacy `closeAllPanels()` 对齐），再发 `{kind:'helpOpen'}`。
2. **native 侧**（TerminalService.openHelpSession）：
   - 满上限 → **静默失效**（legacy 终端数 ≥20 直接 return 同语义；无 disabled 视觉）。
   - `createTerminalUnified(cwd:nil)`（默认 home）→ 建成即自动选中（projection 语义）。
   - `HelpGuideInjector`（SilenceGateInjector 第四个兄弟薄封装）注入
     `claude "请读取 <dataRoot>/guide.md 这份 Muxvo 操作指南，然后等待我的问题。我会问你关于 Muxvo 的使用方法，请基于文档内容回答。"`
     + 尾 CR。**偏差登记**：legacy 固定 500ms 盲延时 → 静默门（等 shell 提示符）+ 尺寸就绪门
     （登记⑩ 同源，防 80 列硬换行烧 scrollback），机制上位替代、用户可见效果一致。
     路径含双引号内元字符（`"` `$` `` ` `` `\`）或控制字节 → 拒注入（纵深防线）。
3. **guide.md 资产**：权威源 `docs/muxvo-guide.md`（新版行为撰写）；`GuideProvisioner` 启动时
   拷入 `<dataRoot>/guide.md` **每启覆盖**（legacy main 启动拷 ~/.muxvo/guide.md 同语义，新版落
   分身数据根）。源解析序：env `MUXVO_GUIDE_SOURCE`（dev，app.sh run 注入）→ bundle
   `Resources/muxvo-guide.md`（app.sh do_bundle cp）；均缺 → .notice 跳过不阻启动。

### 6.1 案例池（spec-coverage 强制 1:1）

| 用例名 | 断言 |
| --- | --- |
| MB_HELP_click_chain | web 点问号 → 先关覆盖面板 + 发 helpOpen（vitest live-chrome） |
| MB_HELP_payload_gate | 注入串 legacy 同形（claude+双引号提示词+尾 CR，含空格路径原样内嵌）；元字符/控制字节拒 |
| MB_HELP_create_select | handleAction(.helpOpen) → 终端 +1 且自动选中 |
| MB_HELP_full_chain | e2e item53 真机：点问号 → 建终端+选中 → 注入回显达 PTY |
