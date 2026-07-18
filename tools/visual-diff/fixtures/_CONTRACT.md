# Fixture 契约（探针 3 视觉回归唯一数据源）

老 app golden 页（muxvo-legacy `fixture.html`）与新 web 复刻页（muxvo/web `?screenshot=1`）
共用本目录 fixture。capture 脚本读 JSON → 解析 contentKey/调色板 → 注入页面。

## 页面契约（两侧一致）

```ts
window.__loadFixture(fx: ResolvedFixture): void   // 渲染该场景（可重复调用）
window.__fixtureReady: boolean                    // 字体加载 + 双 rAF 后置 true
```

页面自身负责：按 `fx.theme` 设 `data-theme`；禁动画/过渡/光标
（`*{animation:none!important;transition:none!important;caret-color:transparent!important}`）。
窗口固定 1440×900 @2x，由 capture 脚本控制。

## 文件组织（M2 任务3 起多文件化）

- `fixtures.json`：terminal-grid 屏。M0 的 15 个对象**原样冻结**（解析结果经 byte-diff=0 验证）；
  网格屏新增 fixture 也落此文件（直到 1500 行黄线再拆）。
- `screens/<screen>.json`：每屏一文件（JSON 数组），按文件名升序聚合在 fixtures.json 之后。
- id 全局唯一由 `resolve-fixtures.mjs` 强制（重复即 throw）。

## 多屏公共信封（M2 起；缺省 `screen: "terminal-grid"` = 原 schema 不变）

```jsonc
{
  "id": "fx-chat-empty",
  "desc": "聊天历史空态",
  "theme": "dark",                  // dark | light
  "screen": "chat-history",         // 屏 id（kebab-case）；缺省 terminal-grid
  "panel": { "open": ["SETTINGS"] },// 可选：golden 侧 fixture host 对 PanelProvider dispatch 的打开动作
  "hover": { "selector": ".x", "index": 0 }, // 可选：两侧对称 page.hover（capture 执行）
  "base": { "terminals": [ /* 同 terminal-grid 的 terminals 项 */ ] }, // 可选：复合屏底图
  /* …按屏 payload，键名与数据形状在各屏接入时登记于下方「按屏 payload 登记」… */
}
```

**确定性铁律**（新屏 fixture 一律遵守）：时间一律固定绝对 ISO 字符串/固定 epoch（capture 两侧冻结时钟）；
禁随机量、禁网络 URL；头像/图片一律 data-URI；文案写死不走运行时 i18n 推断。

### 按屏 payload 登记

（各批次接入时在此逐屏登记键名与数据形状）

B1 popover 屏共同约定：`base` 含 terminal-grid 全量屏级字段
（homePath/viewMode/focusedId/selectedId/activeSidebarId/maxReached/dragging/dragOver/editing/
waitingNotification/terminals），golden 侧 fixture-main 摊平进 `__MUXVO_FIXTURE_DATA__`；
浮层打开方式：cwd/worktree 为 golden 侧 JS click 生产入口（`.tile-cwd` / `.tile-worktree-btn`），
搜索条为 fixture-only 受控挂载（生产挂载点在 xterm 包裹层，fixture DOM 不含）；
`__fixtureReady` 在浮层就位后才置位（terminal-search-bar→`.terminal-search-bar`、
cwd-picker→`.cwd-picker`、worktree-popover→`.worktree-popover__list`）。

```jsonc
// terminal-search-bar（B1）：搜索条挂在哪个 tile 的内容区（query 恒空串）
{ "screen": "terminal-search-bar", "searchBar": { "terminalId": "t1" } }

// cwd-picker（B1）：浮层归属 tile；currentCwd = 该终端 cwd（原样全路径）
{ "screen": "cwd-picker", "cwdPicker": { "terminalId": "t1" } }

// worktree-popover（B1）：detectRepo/preCheck/list 三个 stub 的确定性答案
{
  "screen": "worktree-popover",
  "worktree": {
    "terminalId": "t1",                 // 浮层归属 tile（terminalCwd 取其 cwd）
    "repoPath": "/Users/rl/dev/muxvo",  // detectRepo 结果（约定 = 该 tile 的 cwd）
    "warning": null,                    // preCheck 大仓警告：null | { sizeMB, message }
    "worktrees": [                      // list 结果（WorktreeInfo[]）
      { "path": "...", "branch": "main", "isMain": true, "isMerged": false }
    ]
  }
}
```

B2 modal 簇共同约定：单组件挂载（screens.json 裁决#4）——**无 base 底图**，modal 直接盖在
body 底色（--bg-primary）上；golden 侧由 fixture host 在真实 Provider 树内 dispatch 打开动作
（信封 `panel.open` → PanelContext `OPEN_*`；login 走 AuthContext `OPEN_LOGIN_MODAL`），
组件内部 state（login mode / ws 行内编辑 / whats-new 展开）经 FixtureDriver JS click 生产路径抵达；
web 侧纯 props 直接渲染终态。信封新增可选 `locale`（'zh'|'en'，缺省 zh）——golden 侧
I18nProvider initialLocale 从此读，web 侧屏组件按 locale 取屏级文案表。
`__fixtureReady` 以目标终态元素把关（settings：update 非 null→`.settings-modal[data-fx-scrolled]`、
否则 timed→`.settings-modal__badge-sub-row`；login form→`.login-modal__email-form`、
ws 编辑→`.ws-manager__name-input[data-fx-ready]`（web 侧无驱动链，即 `.ws-manager__name-input`）、
whats-new 展开→`.whats-new__older-content`、close-confirm→`.close-confirm-dialog`）。
settings 滚动约定：update 非 null 时帮助区（下载按钮）在 80vh 折叠线下，两侧均把
`.settings-modal` 滚到底（scrollTop=scrollHeight）后才置 ready——golden 侧驱动器先等 timed
子行（config 落地 = 内容高度终值）再滚；web 侧组件 fonts.ready 后滚。
版本号确定性：`appVersion` 与 legacy package.json **锁死 "0.5.0"**（golden 侧实际渲染来自
`__APP_VERSION__` 编译期 define，legacy 已冻结不会漂移；web 侧渲染 fixture 值）。

```jsonc
// settings-modal（B2）：config = legacy getConfig 替身答案；update 非 null = onUpdateAvailable
// 订阅即同步回调 → 'available' 态（下载按钮）
{
  "screen": "settings-modal",
  "locale": "en",                       // 可选；set-en 哨兵用
  "panel": { "open": ["SETTINGS"] },
  "settings": {
    "appVersion": "0.5.0",
    "config": {
      "startupTerminalCount": 1,        // 1..20（1 → − disabled）
      "doubleClickToFocus": false,
      "dockBadgeMode": "realtime",      // off | realtime | timed（timed → interval 子行）
      "dockBadgeIntervalMin": 1,
      "defaultTerminalCwd": ""          // '' = 未设 → placeholder
    },
    "update": null                      // null | { "version": "0.6.0" }
  }
}

// login-modal（B2）：mode=login 由 golden 侧两连点（邮箱按钮 → 条款同意）真实路径抵达
{ "screen": "login-modal", "login": { "mode": "buttons" } }  // 'buttons' | 'login'

// workspace-manager-modal（B2）：workspaces = getConfig.savedWorkspaces 替身答案；
// editing 非 null = 第 index 行行内编辑中（golden 侧 click+原生 setter 注 value，f7 先例）
{
  "screen": "workspace-manager-modal",
  "panel": { "open": ["WORKSPACE_MANAGER"] },
  "workspace": {
    "workspaces": [
      { "name": "...", "savedAt": "2026-05-01T10:00:00.000Z" /* 仅作 key */, "terminals": [{ "cwd": "..." }] /* 仅 length 渲染 */ }
    ],
    "editing": { "index": 1, "value": "..." }   // null = 纯列表
  }
}

// whats-new-modal（B2）：entries = getReleaseNotes 替身答案（ReleaseEntry[] 裸数组）；
// current = version === appVersion 的条目；expanded 中的历史版本号 golden 侧点 toggle 展开
{
  "screen": "whats-new-modal",
  "panel": { "open": ["WHATS_NEW"] },
  "whatsNew": {
    "appVersion": "0.5.0",
    "entries": [{ "version": "0.5.0", "date": "2026-05-20", "sections": { "Added": ["..."] } }],
    "expanded": ["0.4.0"]
  }
}

// close-confirm-dialog（B2）：纯 props 直挂；processName 携带但 legacy 实况不渲染（spec §1）
{ "screen": "close-confirm-dialog", "closeConfirm": { "terminalId": "t1", "processName": "claude" } }
```

B3 chrome + 配置面板簇共同约定：
- menu-bar/user-dropdown 屏带 `base` 底图（terminalCount 数据源；与生产同构 .app > MenuBar +
  app-content 网格）；auth 非 null = 登录态（auth.getStatus 替身答案，头像一律 data-URI）；
  update 非 null = UpdateProgress 冻结态（onUpdateDownloading/onUpdateError 订阅即同步回调）；
  user-dropdown 屏 = menu-bar + golden 侧 JS click `.user-dropdown__trigger` 打开。
  ⚠️ legacy MenuBar 实况无「返回平铺」钮与语言切换器（specs/behavior/menu-bar.md 头注）。
- 四面板屏挂生产 overlay 容器（.{skills,mcp,hooks,plugins}-panel-overlay，top 36px）；
  数据单一来源：golden 侧 fixture.html 替身按 payload 反拼 IPC 答案
  （skills→config.getResources/getResourceContent + fs.readFile/readDir(files/dirs 字典)；
  mcp→fs.readFile 按 scope 反拼 ~/.claude.json 等三路径；hooks→config.getSettings；
  plugins→installed_plugins.json/manifest/readDir 反拼 + error 态 reject 定值 Error）；
  选中/表单态 golden 侧 FixtureDriver 走生产 click 路径，web 侧直渲终态。
- `__fixtureReady` 终态把关：menu-bar→update 非 null `.update-progress`、auth 非 null
  `.user-dropdown__trigger`、否则 `.menu-bar`；user-dropdown→`.user-dropdown__menu`；
  skills→dirty `.skills-panel__editor-dirty` / selected `.markdown-wysiwyg .tiptap h1` /
  空态 `.skill-list__empty`；mcp→form `.mcp-panel__form` 否则 `.mcp-panel__detail`；
  hooks→form `.hooks-panel__form` 否则 `.hooks-panel__detail`；plugins→error
  `.plugin-panel__empty` 否则 `.plugin-panel__detail`。

```jsonc
// menu-bar（B3）：base 必填；auth/update 见上
{
  "screen": "menu-bar",
  "base": { /* terminal-grid 全量屏级字段 */ },
  "auth": null,                       // null | { username, email?, provider, avatarDataUri }
  "update": null                      // null | { state:'downloading', percent, transferred, total, bytesPerSecond } | { state:'error' }
}

// user-dropdown（B3）：= menu-bar + 下拉 open（golden 侧 click trigger）；auth 必非 null
{ "screen": "user-dropdown", "base": { /* 同上 */ }, "auth": { /* 同上 */ }, "update": null }

// skills-panel（B3）：items.desc 与 SKILL.md frontmatter 双登记（golden 自 frontmatter 解析、
// web 直读 desc）；选中 skill 的 SKILL.md 不带 frontmatter（wysiwyg 会渲染 YAML 杂讯）
{
  "screen": "skills-panel",
  "homePath": "/Users/rl",
  "skills": {
    "items": [{ "name": "...", "path": "...", "source": "claude|codex|gemini|shared", "level": "system|project", "desc": "..." }],
    "selected": "<path>|null", "sourceMode": false, "dirty": false, "dirtyValue": "（dirty 时编辑区终值，须 ≠ 原文件内容）"
  },
  "files": { "<abs path>": "content" },          // config.getResourceContent + fs.readFile 共用
  "dirs": { "<abs path>": [{ "name": "...", "isDirectory": true }] }  // fs.readDir；条目序 = legacy 排序后显示序（文件夹优先+字母序）
}

// mcp-panel（B3）：servers 由替身按 scope 反拼配置文件（global→~/.claude.json、
// desktop→…/claude_desktop_config.json、gemini→~/.gemini/settings.json）；configPath 必须与之一致
{
  "screen": "mcp-panel",
  "homePath": "/Users/rl",
  "mcp": { "servers": [{ "name": "...", "type": "stdio|http|sse", "scope": "global|desktop|gemini", "command": "...", "args": [], "env": {}, "url": "...", "headers": {}, "configPath": "..." }],
           "selected": "<name>|null", "form": false }
}

// hooks-panel（B3）：settings 即 config.getSettings 替身答案；selectedId='global:<event>:<gi>:<hi>'
// （展平序 = 事件插入序 → 组序 → 处理器序，两侧同构）
{
  "screen": "hooks-panel",
  "homePath": "/Users/rl",
  "hooks": { "settings": { "hooks": { "<Event>": [{ "matcher": "可选", "hooks": [{ "type": "command|prompt|agent", "command": "...", "timeout": 5000, "async": true, "statusMessage": "...", "once": true }] }] } },
             "selectedId": "global:PreToolUse:0:0", "form": false }
}

// plugins-panel（B3）：items 由替身反拼 installed_plugins.json/manifest/contents 目录；
// error 非 null → 替身对 installed_plugins.json reject new Error(error)，渲染 `Error: <error>`
{
  "screen": "plugins-panel",
  "homePath": "/Users/rl",
  "plugins": { "error": null,
               "items": [{ "id": "name@marketplace", "name": "...", "marketplace": "...", "version": "...", "scope": "user", "installPath": "...", "enabled": true, "installedAt": "ISO（取 UTC 正午防时区跨日；渲染 toLocaleDateString 两侧同浏览器一致）", "lastUpdated": "ISO", "manifest": { "description": "...", "author": { "name": "..." } }, "contents": { "commands": [], "skills": [], "hooks": [], "agents": [] } }],
               "selectedId": "<id>|null" }
}
```

B4 file 簇共同约定：
- file-panel 屏带 `base` 网格底图（面板 320px 右滑出，余幅露网格）；树数据单一来源 =
  `dirs` 字典（fs.readDir 替身，**size 透传**给尺寸徽记）；隐藏文件开关/三栏列宽走
  `fileConfig`（getConfig 替身合并进答案）；展开态 golden 侧 FixtureDriver 按名点 folder 行
  （生产 click 路径，childName 为推进闸），web 侧由 dirs+expandFolders 静态扁平化
  （排序/过滤与 legacy mapIpcEntries 同构：文件夹优先 + localeCompare + 点头过滤）。
  ⚠️ NEW 徽标不可达（FilePanel.mapIpcEntries 不产出 isNew，specs/behavior/file-panel.md §0）。
- file-temp-view 屏单组件满幅自盖（top 36px 露 body 底色）；`base.terminals` 仅供右栏
  TerminalSidebar 的终端内容（sourceTerminalId 过滤，恒 ≤1 tile）；content/fileType 直灌
  props（App.tsx:198-230 编排等价）。hard-substitute：image 的 content 为 data-URI（生产
  local-file:// 协议裸页无效，同 DOM 同 CSS）；pdf 喂非法字节走 `.pdf-preview--error`
  确定性 DOM（toolbar+canvas 依赖成功解析，canvas 栅格非确定性，不进像素对比）。
  ftv-sheet 双登记：`ftv.content`（base64 xlsx，golden SheetJS 解析）与 `sheet`
  （web 静态 DOM 数据源）须一致。
- `__fixtureReady` 终态把关：file-panel→`.file-panel__content[data-fx-ready]`（driver 末步打标，
  web 侧渲染即带）；file-temp-view→unsaved `.unsaved-prompt-dialog` / dirty
  `.file-temp-view__dirty-dot` / markdown `.markdown-wysiwyg .tiptap h1` / image
  `.file-temp-view__image img[data-fx-loaded]`（img 解码后打标）/ spreadsheet
  `.spreadsheet-view__table` / pdf `.pdf-preview--error` / code|text `.file-temp-view__editor`。

```jsonc
// file-panel（B4）
{
  "screen": "file-panel",
  "base": { /* terminal-grid 全量屏级字段 */ },
  "fileConfig": { "showHiddenFiles": true },
  "filePanel": {
    "projectCwd": "/Users/rl/dev/muxvo",
    "expandFolders": [{ "name": "src", "childName": "main.ts" }]   // 依序点开；childName=展开后必现子项
  },
  "dirs": { "<abs path>": [{ "name": "...", "isDirectory": true, "size": 1184 /* 可选，文件徽记 */ }] }
}

// file-temp-view（B4）
{
  "screen": "file-temp-view",
  "base": { "terminals": [{ "id": "t1", /* … */ }] },   // 右栏内容源（sourceTerminalId 过滤）
  "fileConfig": { "ftvLeftWidth": 250, "ftvRightWidth": 280 },
  "dirs": { /* 左栏树（根列表即可，打开文件在根 → 无自动展开） */ },
  "ftv": {
    "projectCwd": "/Users/rl/dev/muxvo",
    "filePath": "/Users/rl/dev/muxvo/README.md",
    "fileType": "markdown",            // markdown|code|text|image|spreadsheet|pdf
    "content": "…",                    // md/code/text=utf8；spreadsheet=base64 xlsx；image=data-URI；pdf=文件路径
    "sourceTerminalId": "t1",
    "sourceMode": false,               // 可选：golden 点 mode 钮抵达
    "dirtyValue": "…",                 // 可选：source 模式原生 setter 注值置 dirty（须 ≠ content）
    "unsaved": false                   // 可选：dirty 后点返回钮 → UnsavedPromptDialog
  },
  "sheet": { "sheetNames": ["..."], "activeSheet": 0, "cells": [["…"]] },  // 仅 spreadsheet：web 静态 DOM 数据源
  "files": { "<pdf abs path>": "<base64>" }   // 仅 pdf：fs.readFile 替身答案（非法字节 → error 终态）
}
```

B5 chat 簇共同约定：
- chat-history 屏单组件挂载（裁决#4，无 base 底图）：生产 `.chat-history-overlay` 容器
  （top 36px 露 body 底色）+ 三栏面板。数据单一来源 = `chat` payload，golden 侧
  fixture.html `window.api.chat.*` 替身按 payload 反拼 IPC 答案（getProjects/getSessions/
  getSession/search/getArchiveEnabled）；**时间字段一律 ISO 字符串**，替身/web 侧
  `Date.parse` 转 ms（确定性铁律）；卡片「今天/昨天/MM-DD」文案依 capture 冻结时钟
  （epoch 2026-06-01T12:00:00Z）+ 本机时区两侧对称渲染。
- 共享数据字典：`chat.projects/sessions/messages` 可写 `"@<key>"` 引用
  `fixtures/chat-data.json` 顶层条目（resolve-fixtures.mjs deref，多 fixture 单一来源
  防手抄漂移；仅 chat payload 生效，既有屏零影响）。
- banner 显隐 = 生产同一 localStorage 开关（golden 宿主挂载前种子化；`banner:false`
  = 预 dismissed）；golden 只截静态 archiveNotice 变体，归档进行中 {synced}/{total}
  变体 dom-assert（两变体互斥，screens.json note）。
- 选中会话（`selected`）golden 侧按 lastModified 倒序下标 click 生产卡片；工具块展开
  （`expandToolCall`）以「全部气泡已渲染」为推进闸后点 header；搜索（`search.query`）
  原生 setter 注入 input（300ms 防抖后 `search.results` 替身答案落地）；detail 骨架屏
  （`detailPending:true`）= getSession 永不 resolve 冻结。web 侧全部直渲终态。
- `__fixtureReady` 终态把关：golden 侧一律等 driver 末步打的**逐 fixture 唯一戳记**
  `.chat-history-panel[data-fx-chat-ready="<fx.id>"]`（末步以终态条件——skeleton/
  result-count/气泡数+工具块——连续 30 帧稳定为闸）。两条实测教训：① __loadFixture 的
  ready 轮询先于 React 提交，通用类名会命中上一 fixture 残留 DOM（search-hit→search-empty
  均有 result-count，截到中间态）；② react-virtuoso 偶发整列空渲染（双跑 byte 抓到一次），
  不稳不打标 → capture 超时红，绝不静默截空图。web 侧静态渲染无此两竞态，按内容取终态
  元素：detailPending→`.session-detail__skeleton`、search→`.search-input-wrap__result-count`、
  expandToolCall→`.tool-call-block__content`、selected→`.session-detail__resume-bar`、
  空列表→`.session-list__empty`、否则 `.chat-history-panel`。
- 消息 markdown 走 markdown-it+hljs 链路（specs/behavior/chat-history.md §5）：fixture
  文本限定可静态复刻子集（段落/行内 code/strong/紧列表/```bash 注释行）；detail 消息
  总高按「展开前不溢出」设计（virtuoso 初始位与静态渲染同为顶端对齐）。

```jsonc
// chat-history（B5）
{
  "screen": "chat-history",
  "chat": {
    "banner": true,                    // false = 预 dismissed（localStorage 种子）
    "archiveEnabled": true,            // 开关文案（缺省 true）
    "selected": "s1-pty-fix",          // null = 不选中（detail 空态）
    "detailPending": false,            // true → getSession 冻结 → detail 骨架屏
    "expandToolCall": true,            // 首个 tool-call 展开（生产 click 路径）
    "search": null,                    // | { "query": "...", "results": [{ projectHash, sessionId, snippet, timestamp }] }
    "projects": "@chat-projects",      // | ProjectInfo[]（totalSize 字节数；lastActivity ISO）
    "sessions": "@chat-sessions",      // | SessionSummary[]（lastModified ISO；fileSize 字节数）
    "messages": "@chat-messages"       // | SessionMessage[]（getSession 答案；timestamp ISO）
  }
}
```

B6 引导簇共同约定：
- welcome-overlay 屏单组件挂载（screens.json 裁决#4，无 base 底图）：overlay 直接盖 body
  底色；golden 侧 PanelProvider 内 dispatch `SHOW_WELCOME`（生产 action），web 侧纯静态直渲。
  零 payload（文案/布局全静态，specs/behavior/welcome-overlay.md）；首启判定实况走
  app.getPreferences IPC 而非 localStorage（该 spec §0），替身 B2 已有 stub 零扩面。
- tour-overlay 屏 = **M2 唯一复合宿主特例**（授权出处：specs/screens.json adjudications
  **#4**「唯 tour-overlay 一屏在 B6 做复合宿主特例（grid+menubar）」）：driver.js spotlight
  按真实 DOM rect 挖孔，单组件挂载无锚可锚。两侧宿主 = menu-bar 屏同构（.app > MenuBar +
  app-content > 网格底图，auth/update 均无）+ tour 层；`base` 必填（terminal-grid 全量
  屏级字段）。渲染引擎 driver.js **两侧同版本 1.4.0**（挖孔 path/气泡定位数学同库同源，
  web 侧依赖经 npmmirror 安装）；golden 侧 fonts.ready 后 dispatch `START_TOUR`（生产
  action）→ drive() 落步 1（代表 step 裁决：specs/behavior/tour-overlay.md §4——步 1 是
  唯一零模拟推进、锚点几何固定、遮罩完整的形态），web 侧同时机同配置直接驱动 driver.js。
- `__fixtureReady` 终态把关：welcome→`.welcome-overlay__card`；tour→两侧一律等
  「`.driver-popover` rect + `.driver-overlay path[d]` 连续 30 帧不变」后在宿主 .app 打的
  **逐 fixture 唯一戳记** `.app[data-fx-tour-ready="<fx.id>"]`（B5 两教训直接沿用：唯一
  戳记 stale-proof + 不稳不打标 → capture 超时红，绝不截 driver 异步定位/animate 循环
  的中间态）。

```jsonc
// welcome-overlay（B6）：零 payload
{ "id": "wel-card", "theme": "dark", "screen": "welcome-overlay" }

// tour-overlay（B6）：base 必填；无 tour payload——固定渲染步 1（见上，裁决记录在
// specs/behavior/tour-overlay.md §4；其余 3 步 dom-assert）
{ "screen": "tour-overlay", "base": { /* terminal-grid 全量屏级字段 */ } }
```

M4a 批4 task-center（orch 新屏，无 legacy 对照）共同约定：
- 单组件挂载（裁决#4 无 base 底图）：任务中心屏 `position: fixed; inset: 0` 满幅自盖。数据单一来源 =
  `orch` payload（= orch.state snapshot 形状，protocol.json 权威：TaskView/InboxItem/AccountView/RecoveryBanner），
  另加 fixture 信封字段 `now`（相对时间冻结基准，确定性铁律）、`detail`（详情区 = orch.query/transcript 拉取形状：
  events[EventRow]/transcript[TranscriptLine]/audit[AuditRow]/transcriptFull?{lines[TranscriptFullLine],nextCursor?,truncated?}
  ——完整交互视图数据，★A5 r6）、`selectedTaskId`（详情归属）、`formOpen`（录入表单展开）、`detailFullOpen`（完整交互视图初始展开）。
  web 侧纯 props 直渲终态、零 mock IPC；桥推送 live 侧由 main.tsx 装配 orch 投影为同形。
- **确定性**：一切时间字段（updatedAtMs/finishedAtMs/resetsAtMs/ts）为固定 epoch ms；`now` 固定（1751716800000）。
- **SEC-06**：一切 worker 派生串（title/inputFields 值/policyBasis/summary/transcript content）经 React 默认转义、
  绝无 dangerouslySetInnerHTML；转写纯文本不解释 ANSI/markdown。
- `__fixtureReady` 终态把关：`.task-center[data-fx-ready]`（组件渲染即带该标记，无异步 driver/virtuoso 竞态）。
- golden 权威 = ★A5 用户肉眼巡检冻结（波4a），非老 app 截图；授权清单 = `specs/screens.json` 新 `orchScreens` 段。

```jsonc
// task-center（M4a 批4）：orch = orch.state snapshot 形状；detail/selectedTaskId/formOpen/now 为信封扩展
{
  "id": "tc-list-states",
  "theme": "dark",
  "screen": "task-center",
  "now": 1751716800000,                    // 相对时间冻结基准（epoch ms）
  "selectedTaskId": "t-detail",            // 可选：详情区归属任务
  "formOpen": false,                       // 可选：录入表单展开态
  "orch": {
    "tasks": [ /* TaskView[]：taskId/title/state(9 态)/needsHumanConfirm/waitClass?/harness?/
                  pipelineId?/pipelineSeq?/pipelineRound?/pipelineTotal?/accountId?/resetsAtMs?/updatedAtMs/finishedAtMs? */ ],
    "inboxItems": [ /* InboxItem[]：inboxItemId/taskId/kind(toolApproval|budgetTopup|wallClock|
                       completionConfirm|pipelineContinue|iterationExhausted)/title/repoPath?/autonomyLevel/
                       toolName?/inputFields?[KeyValue]/policyBasis?/turnsUsed?/budgetTurns?/elapsedMs?/
                       deadlineMs?/resultSummary?/evidenceRef?/pipelineRound? */ ],
    "accounts": [ /* AccountView[]：accountId/harnessKind/type（凭据 0 上 web，SEC-06） */ ],
    "recovery": { "interruptedCount": 2, "needsConfirmTaskIds": ["t-r2"] },  // 可选：崩溃恢复横幅
    "policyBanner": { "failsafeActive": true, "rulesetSource": "corrupt" }   // 可选：策略失效横幅（⑥ r5，persistent 不可关）
  },
  "detail": {                              // 可选：详情区（选中任务）
    "taskId": "t-detail",
    "events": [ /* EventRow[]：seq/ts/kind/actor/summary?（时间线按 seq 升序） */ ],
    "transcript": [ /* TranscriptLine[]：ts/kind(text|tool)/content（实时转写，纯文本渲染） */ ],
    "audit": [ /* AuditRow[]：seq/ts/category/decision/taskId?/basis?[KeyValue] */ ],
    "transcriptFull": {                    // 可选：完整交互视图（★A5 r6，需 detailFullOpen=true 方展开）
      "truncated": true,                   // 尾截断（波2A 终裁：append-only 落盘只能停写尾部）：留存首窗、后续更晚内容被丢弃 →
                                           //   尾部横幅「后续输出因日志上限被截断」。仅末页出现，与 nextCursor 互斥
      // "nextCursor": "off-8192",         // 非末页携此：前向分页续接（字节 offset）→「加载更多」；缺=到达当前落盘末尾
      "lines": [ /* TranscriptFullLine[]：ts(恒 0，渲染按数组序勿依赖 ts)/kind(assistantText|toolUse|toolResult|result|rateLimit|unknown)/
                    content?/toolName?/toolInput?[KeyValue]/status?/numTurns?/resetsAtMs?/raw?（按 kind 取，全 textContent 转义） */ ]
    }
  },
  "detailFullOpen": true                   // 可选：完整交互视图初始展开（golden 用；live 由「查看完整交互」入口点开）
}
```

## Fixture JSON Schema（terminal-grid 屏，`fixtures.json` 数组中）

```jsonc
{
  "id": "f1",
  "desc": "N=4 五态齐全",
  "theme": "dark",              // dark | light
  "homePath": "/Users/rl",      // cwd 缩短规则的 home 前缀
  "viewMode": "Tiling",         // Tiling | Focused
  "focusedId": null,
  "selectedId": null,
  "activeSidebarId": null,
  "maxReached": false,
  "dragging": null,             // 终端 id：加 .dragging（瞬时态）
  "dragOver": null,             // 终端 id：加 .drag-over
  "editing": null,              // { "id": "...", "value": "..." } 命名编辑中
  "waitingNotification": null,  // { "count": 2 } 右下浮卡
  "terminals": [
    {
      "id": "t1",
      "state": "Running",       // 10 态枚举之一；UI 仅区分 Running/WaitingInput/其余
      "cwd": "/Users/rl/dev/muxvo",
      "customName": "api-server",  // 可省
      "isGitRepo": true,           // 控制 worktree 按钮显隐
      "worktreeRegistered": true,  // cwd 含 /.worktrees/ 时 badge 是否保留（老 app 异步校验的注入值）
      "contentKey": "cc-codegen"   // 终端内容块，见 content-blocks.json
    }
  ]
}
```

## ResolvedFixture（capture 注入页面前的解析结果）

- `contentKey` → `content: Line[]`，`Line = Segment[]`，`Segment = { t: string, hex: string }`
- hex 由 `term-palette.json` 按 theme 解析（页面不做任何调色板查表）
- 附 `palette: { background, foreground }`（终端内容区底色与默认前景）
- 空行（`[]`）渲染为单个空格（保行高）

## 终端内容区静态样式（两侧必须一致）

- 容器：铺满 `.tile-terminal`，background = 调色板 `background`，padding 8px，overflow hidden
- 文本：`'JetBrains Mono','SF Mono',Menlo,Monaco,'Cascadia Code','Courier New',monospace`
  14px / line-height 1.4，`white-space: pre`，逐行 div，段内 span 上色
- 默认前景 = 调色板 `foreground`

## 编辑态（f7）的两侧实现

- 新 web：依 fixture 直接渲染 Editing 态（input 值 = editing.value，autofocus）
- 老 app：capture 脚本点击该 tile 命名占位 → 键入 editing.value 后截图
- 两侧 caret 均已透明，焦点样式仅 border-bottom amber（一致）

## 拖拽瞬时态（f5）的两侧实现

- 新 web：依 fixture 渲染 `.dragging` / `.drag-over` class
- 老 app：capture 脚本对对应序号 `.tile` `classList.add(...)`（与组件内部行为等价）

## 截图清单（15 张）

f1 / f2-n1 / f2-n3 / f2-n5 / f2-n7 / f2-n9 / f3(N=12) / f3b(N=11, lastRow 不满) /
f4(Focused) / f5(拖拽) / f6a(空态) / f6b(maxReached) / f7(worktree+编辑) / f8(浮卡) / f9(light)

注：spec §8 F3 标 N=12，但 N=12 末行恰好填满，补 f3b(N=11) 实测 lastRowCentered（末行 3 个等分整行宽）。
