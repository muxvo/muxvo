# chat-history（聊天历史三栏）行为规格

> 来源：muxvo-legacy `src/renderer/components/chat/ChatHistoryPanel.tsx(.css)` /
> `ProjectList.tsx(.css)` / `SessionList.tsx(.css)` / `SessionDetail.tsx(.css)` /
> `components/SearchInput.tsx(.css)` / `components/markdown/MarkdownPreview.tsx(.css)` /
> `MarkdownPreviewHighlight.css` / `features/file-viewer/markdown.ts` / `styles/theme.css`
> + App.tsx:273-278（overlay 挂载）+ i18n locales/zh.ts:25-50。行为说明书，不抄结构。

## 0. 实况要点（spec 与实渲染偏差）

- **CHAT_L1_15 文案**：spec 期望「还没有聊天记录...」为零消费 stub
  （chat/empty-state.ts `getEmptyStateConfig('noHistory')`，全仓 UI 零 import）。实渲染空态 =
  SessionList.tsx:360 `t('chat.noSessions')` → **「暂无会话记录」**（zh.ts:31）。
  检查点⑥已裁决 Tier-B：golden 与 vitest 断言以实渲染为准，偏差记 status.json note。
- **CHAT_L1_10 卡片字段**：spec fields 含 `toolCallCount`，为零消费 stub
  （session-card-config.ts）。实渲染卡片右下角是 **fileSize**（`session-card__count`，
  formatFileSize，SessionList.tsx:269），legacy 不渲染 tool calls 数；`timeFormat` spec 写
  `today:HH:MM / yesterday / MM-DD`，实渲染为「今天 HH:MM / 昨天 HH:MM / MM-DD HH:MM」
  （昨天与更早也带 HH:MM，SessionList.tsx:52-73）。断言以实渲染为准，偏差记 note。
- **CHAT_L1_11 codeBlock**：spec expectedUI 写 `syntax highlight + copy button`。高亮真实存在
  （markdown-it+hljs，见 §5）。**复制按钮：§0 早期结论「不存在」已被 W11 推翻（M5-R1 批3）**——live 渲染链
  （chat-md-live）现为每个代码块渲「复制」钮、详情头渲「复制为 Markdown」整段钮（见 §7.8 W11）。
  **仅 live 路径有**（chat-md-live 经 ChatHistoryLive 动态 import）；golden/静态路径走 chat-md-static，
  仍是纯 `<pre class="hljs">` 无钮（6 张 chat golden 逐字节不变）。故断言分双路径：静态 golden 无钮、live dom-assert 验钮。
- **CHAT_L1_13/14 stub-only**：sync-status.ts / empty-state.ts(noCC) 零消费，UI 不渲染
  同步状态条与 noCC 空态——检查点⑥已改派 M5（status.json note 已记），本批不涉。
- **布局 config stub 与实 CSS 一致**：chat-layout-config.ts（220/340/flex）与
  ChatHistoryPanel.css:73-93 实值一致（左 220px/min 180、中 340px/min 280、右 flex:1/min 400）
  ——CHAT_L1_09 无偏差，断言走 web chat.css 实工件。
- **右栏为 react-virtuoso 虚拟列表**：消息 ≤50 条全量渲染；顶部 Header 恒渲染
  「— 已加载全部 —」（`.session-detail__all-loaded`，hasEarlier=false 时）。web 复刻用
  普通滚动容器 + 同款 DOM（fixture 消息数少、不溢出，无滚动位置歧义）。
- **`.session-card__snippet*` 为死 CSS**：renderCard 不产出该结构；搜索 snippet 实际
  替换进 `.session-card__preview`（见 §3 preview 规则）。

## 1. 容器 / overlay / archive banner

- 挂载：App 层 `.chat-history-overlay`（App.css:19-27）：`position:fixed;
  top: var(--menu-bar-height=36px); left/right/bottom:0; z-index:180; background:var(--bg-deep)`。
- `.chat-history-panel`：flex column，height 100%，bg var(--bg-primary)，字色 var(--text-primary)。
  子结构 = [banner?] + `.chat-history-panel__columns`（flex，flex:1，min-height:0）。
- **Archive banner**（`.chat-archive-banner`）：显示条件 =
  `localStorage['muxvo-archive-notice-dismissed'] !== 'true'`。padding 8px 16px，
  bg rgba(96,165,250,.1)，border-bottom 1px var(--border)，12px var(--text-secondary)，gap 12px。
  - 文案两互斥变体：归档进行中（onArchiveProgress 推送且 total>0）→
    「正在归档 {synced}/{total}...」；否则静态长文案 `chat.archiveNotice`（zh.ts:41，
    「Claude Code 本地聊天记录在未参与模型训练时仅保留约 30 天（参与训练时为 5 年），
    Muxvo 已自动归档到 ~/.muxvo/chat-archive/ 永久保留。所有数据仅保存在你的本地电脑，
    不会上传到任何服务器。」）。golden 只取静态变体；进行中变体 dom-assert（screens.json note）。
  - 右侧 actions（gap 12px）：checkbox 开关 label「自动归档：开启/关闭」（初值 true，
    getArchiveEnabled 异步覆盖）+ 关闭钮 `×`（`.chat-archive-banner__close`，16px
    var(--text-muted)）→ 写 localStorage 后隐藏 banner。

## 2. 左栏 ProjectList（220px）

- `.chat-history-panel__left`：width 220px，min-width 180px，border-right 1px var(--border)，
  overflow-y auto。`.project-list` padding 8px 0。
- 头 `.project-list__header`：「项目」，padding 8px 16px，11px/600 uppercase
  var(--text-secondary)，letter-spacing .5px。
- 行 `.project-list__item`：flex，padding 8px 16px，gap 8px；hover var(--bg-hover)；
  选中 `--selected` = var(--accent-muted)。
- 首行恒为「全部项目」（默认选中，selectedProjectHash=null）：圆点色 var(--accent)，
  尾注 = Σ totalSize 的 formatSize。
- **选中高亮绑定（dogfood-r5 W-B）**：`--selected` 由 payload `selectedProjectHash` 决定——
  「全部项目」行选中 ⟺ `(selectedProjectHash ?? null) === null`，项目行选中 ⟺ `selectedProjectHash === projectHash`。
  live 透传容器 reducer 的 `selectedProjectHash`（选中随点击迁移、跨保活隐藏/重现保持，不回落全部项目）；
  **静态/golden 路径缺省 `selectedProjectHash=undefined` → 「全部项目」恒选中、项目行不选中，DOM 字节与既有
  golden 恒等（加性改造，golden 契约不变）**。
- 项目行：`.project-list__dot` 8×8 圆点，颜色 = hashColor(projectHash)：
  `hash = Σ charCodeAt(i) + ((hash<<5) - hash)`，`hue = |hash| % 360`，
  `hsl(hue, 65%, 55%)`（ProjectList.tsx:22-29，确定性纯函数）。
  `.project-list__name` 13px 单行省略 = displayName；`.project-list__count` 11px
  var(--text-secondary) = formatSize(totalSize)：<1024→`${B}B`；<1MiB→KB；<1GiB→MB；否则 GB，
  一位小数并去 `.0`（1024 进制）。
- 左栏加载骨架 `.panel-skeleton`（projectsLoading 且空）：header 条 60×14 + 5 行
  dot(8×8)+text(flex,12h)+badge(24×12)，bg var(--bg-hover)，skeleton-pulse 动画
  （截图禁动画 → 恒 opacity 1）。

## 3. 中栏 SessionList（340px）

- `.chat-history-panel__middle`：width 340px，min-width 280px，border-right，flex column，
  overflow hidden。`.session-list`：padding 8px 0，flex column，height 100%。
- 头 `.session-list__header`：11px/600 uppercase，padding 8px 16px；文案 =
  空列表/搜索中→「会话」；否则「会话 ({count})」（zh `chat.sessionsCount`；搜索模式 count =
  标题匹配+内容匹配之和）。
- 搜索框（共享 SearchInput，`.search-input-wrap`）：padding 8px 12px，border-bottom；
  input 12px，bg var(--bg-elevated)，placeholder「搜索会话...」。右侧徽记三态互斥：
  - 无 query：有值时 `×` 清除钮；
  - query 且未选中会话：搜索完成后 `.search-input-wrap__result-count`「{n} 个结果」
    （11px var(--text-secondary)，right 28px；n = 匹配会话数，searching 期间隐藏）+ `×`；
  - query 且已选中会话：匹配导航 `{current}/{total}` + ▲▼ 钮（右 32px）+ `×`
    （total 来自 SessionDetail 逐词命中数）。
  显示计数/导航时 input paddingRight 110。
- 卡片容器 `.session-list__cards`：flex:1，min-height 0，overflow-y auto，padding 8px 0
  （溢出即 5px 主题滚动条）。分页 50/页，滚动哨兵加载更多。
- **卡片**（`.session-card`）：padding 12px 16px，border-bottom 1px var(--border)；
  hover var(--bg-hover)；选中 `--selected` var(--accent-muted)。排序 lastModified 倒序。
  - header：标题 + 时间（baseline，gap 8，margin-bottom 6）。
    标题 = `([{worktreeLabel}] )? (customTitle || title)` 截 50 字符，13px/500 单行省略；
    搜索时经 HighlightText 打 `<mark class="search-highlight">`。
    时间 11px var(--text-secondary) = formatTime(lastModified)：同日→「今天 HH:MM」、
    昨日→「昨天 HH:MM」、更早→「MM-DD HH:MM」（24h 补零，本地时区）。
  - 预览 `.session-card__preview`：12px var(--text-secondary)，line-height 1.4，
    -webkit-line-clamp:2 截断。内容 = title 截 100；搜索时若 title 不含 query 且有
    snippet → snippet 截 100（内容命中卡）；搜索时过 HighlightText。
  - footer：左 tags 组（gap 4，wrap）+ 右 `.session-card__count` = fileSize>0 时
    formatFileSize（B/KB/MB，1024 进制去 .0）。
    - source badge（theme.css:120-138 共享）：claude-code→`CC`（rgba(218,119,86,.15)/
      rgb(218,119,86)）、codex→`CX`（绿）、gemini→`GM`（紫）。
    - 项目徽记 `.session-card__project-badge`（仅「全部项目」视图）：displayName，
      10px/500，bg rgba(255,255,255,.06)，max-width 100px 省略。
    - 关键词 tag `.session-card__tag`：title 小写含 feat/feature→`feat`(var(--success))、
      fix/bug→`fix`(var(--error))、refactor→`refactor`(var(--info) #60a5fa)、
      plan→`plan`(var(--purple) #a78bfa)；10px/500 白字 uppercase，2px 6px 圆角 3。
  - 重命名行内编辑 `.session-card__rename-input`（renamingSessionId 时替换标题）：
    透明底，border-bottom 1px var(--accent)——dom-assert，不出 golden。
- **搜索模式**（query 非空）分节：
  - 「标题匹配 (n)」节头 `.session-list__section-header`：6px 16px，11px/600，
    bg var(--bg-secondary→rgba(255,255,255,.02) fallback)，border-bottom；节内卡片 =
    title/customTitle 含 query（客户端即时）。
  - searching 中：节头「搜索会话内容...」+ 14px 旋转 spinner + 3 张骨架卡（截图禁动画）；
    完成后→「内容匹配 (n)」节 = 后端 results 去重（排除标题命中），未加载会话以
    snippet 造占位卡（title=snippet 压缩空白截 60，fileSize=-1 → 不显大小，时间取
    result.timestamp）。
  - 全空且非 searching → `.session-list__empty`「无匹配会话」（padding 32px 16px 居中
    13px var(--text-muted)）。
- **普通空态**：header「会话」+ 搜索框 + `.session-list__empty`「暂无会话记录」（§0 偏差）。
- 中栏加载骨架（sessionsLoading 且空）：`.panel-skeleton` 8 张卡（title 70%×14 /
  preview 90%×10 / footer 40%×10，圆角卡 bg var(--bg-hover)）。

## 4. 右栏 SessionDetail（flex:1）

- `.chat-history-panel__right`：flex:1，min-width 400px，overflow-y auto。
  `.session-detail`：height 100%，flex column，user-select text。
- **未选中空态** `.session-detail__empty`：居中 13px var(--text-muted)「选择一个会话查看详情」。
- **loading 骨架** `.session-detail__skeleton`：flex:1，padding 16px；6 个
  `.skeleton-bubble`（偶数右对齐/奇数左对齐）：label 40×10 + content 60%（右 45%）×48
  圆角 8 + meta 50×8，bg var(--bg-hover)，pulse 动画（截图禁动画）。
- **resume bar**（canResume：source ∈ {claude-code, codex} 且有 cwd 且消息已加载）：
  `.session-detail__resume-bar` 居中 flex，padding 8px 12px，bg var(--bg-elevated)，
  border-bottom；按钮 `.session-detail__resume-btn`：⏭ SVG(14×14) +「继续聊天」，
  6px 16px，bg var(--accent)，白字 13px/500，圆角 6。
- **消息列表**：Virtuoso（§0）——顶部 `.session-detail__all-loaded`「— 已加载全部 —」
  （8px 0 居中 11px var(--text-muted)）+ 逐条 MessageBubble；分页 50 条/searching 时全量。
- **MessageBubble**（`.message-bubble`，margin-bottom 16，flex column）：
  - user→`--user` 右对齐（align-items flex-end）；assistant→`--assistant` 左对齐；
    system→`--system` 居中（content max-width 85%，12px，opacity .7）；system 内容含
    `<teammate-message>` 标记时按 assistant 呈现、label=`CLAUDE: {id}`（teammate 色表）。
  - label（10px/600 uppercase var(--text-secondary)，margin-bottom 4）：user→`YOU`、
    assistant→`CLAUDE`（uuid 前缀 codex-→`CODEX`、gemini-→`GEMINI`）、system→`SYSTEM`。
  - content（max-width 75%，padding 12px 16px，圆角 8）：user bg **#3b82f6** 白字
    （light 主题 #2563eb；注意非 var(--accent)，是写死的蓝）；assistant bg var(--bg-elevated)
    字 var(--text-primary)。
  - user/system 字符串内容：`.message-bubble__text` 13px/1.5 pre-wrap（搜索时 HighlightText）。
  - assistant 内容 = content block 数组，按序渲染：text→MarkdownPreview（§5）、
    tool_use→ToolCallBlock、tool_result→ToolResultBlock、image→`.image-block img`
    （data-URI，max-height 400）。
  - **live 转写降噪增量（问题4，§7.10；均 live-only，静态/golden 本节措辞不变）**：block 数组另含
    thinking（折叠块）/unknown（占位块）两类型；system 字符串消息改渲折叠壳 `SystemFoldBlock`（非
    `.message-bubble__text`）；user 字符串消息经 convert 包成 text 块走 markdown（§5）。
  - meta（10px var(--text-muted)，margin-top 4）：`new Date(timestamp).toLocaleTimeString()`
    （浏览器 locale，两侧同浏览器一致）。
- **ToolCallBlock** `.tool-call-block`：border-left 3px var(--info) #60a5fa，
  bg rgba(96,165,250,.1)，padding 8px 12px，margin 8px 0，圆角 4。header（12px/500
  var(--info)，gap 8）：`▶/▼`（展开态图标 10px）+「Tool Call: {name}」（zh/en 同文案）。
  默认折叠；点 header 展开 `.tool-call-block__content`（margin-top 8，padding 8，
  bg var(--bg-primary)，12px）：input 为对象→逐 key 渲染 `.tool-call-block__field`
  （key 11px/600 mono var(--text-secondary) + 字符串值走 MarkdownPreview / 其余
  JSON pre）；字符串→整体 MarkdownPreview；其余→JSON pre。
- **ToolResultBlock** `.tool-result-block`：同构，border/字色 var(--success)，
  bg rgba(74,222,128,.1)，label「Tool Result」，默认折叠。
- **搜索高亮**：`mark.search-highlight`——列表/assistant/system 里 bg rgba(250,204,21,.35)
  字 #fef08a（light: .45/#92400e）；user 气泡内 bg #fde047 字 #1e3a5f；当前导航命中
  `--active` bg #f97316 白字（DOM effect 加类）。

## 5. markdown 渲染链路（消息如何变 DOM）

- **渲染核共享注记（dogfood-r3 问题7，2026-07-10）**：live 渲染核（markdown-it 单例配置/hljs 围栏/
  mermaid 双重惰性/任务列表后处理/复制钮注入）已抽至 `web/src/markdown/md-view.tsx` 与文件预览共享；
  `chat-md-live.tsx` 保留 chat 专属壳（`.markdown-live` 容器/搜索高亮 postprocess/memo 依赖
  [text, highlight]），**DOM 形状与类名零变化**。同批新增：两处 live 渲染均挂锚点点击拦截
  （linkify 产 `<a href>`，恒 preventDefault 防共享 WKWebView 主 frame 被导航；外链 best-effort
  window.open，native-gap 同 §7.9 onLearnMore 注记）。golden/静态路径（chat-md-static）不动。
- **问题4 转写降噪（§7.10）新增 live 消费面**：thinking 折叠块展开体走本渲染核；user 气泡字符串现也走
  markdown（缺陷4 从 assistant 扩到 user）；system 折叠壳展开体是**纯文本**（不经本渲染核，见 §7.10）。
- 链路：MarkdownPreview（React.memo）→ `getMarkdownRenderer()`（markdown-it，
  `{html:false, linkify:true, typographer:true}` + hljs highlight 回调）→
  `render(content)` → GFM 后处理（~~del~~/task list 正则）→ 搜索时 `highlightHtml`
  （仅文本节点注 `<mark class="search-highlight">`）→ `dangerouslySetInnerHTML` 注入
  `.markdown-preview` 容器。**与 file-temp-view 的 tiptap/wysiwyg 是两条链路、两种 DOM 形状**
  （如紧列表：markdown-it 出 `<li>text</li>`，tiptap 出 `<li><p>text</p></li>`）——
  web 复刻不得复用 md-static.tsx（tiptap 形状），需按 markdown-it 形状静态生成。
- 代码块：` ```lang ` → hljs 认识 lang 时
  `<pre class="hljs"><code>{token spans}</code></pre>`（不认识/无 lang → escapeHtml 纯文本）。
  fixture 取 bash 注释子集：`#` 行 → `<span class="hljs-comment">`，其余行纯文本
  （实测 legacy hljs 输出，web 静态复刻仅需覆盖此子集）。
- `.markdown-preview` 样式（MarkdownPreview.css）：**padding 24px 32px**、15px/1.8
  var(--font-sans)（bubble 内被 `.message-bubble--assistant .markdown-preview` 覆盖为 13px）；
  行内 code：bg var(--code-bg, rgba(248,165,194,.15)) 字 var(--code-fg,#f8a5c2)
  （dark 走 fallback 粉；light 走 theme.css:108 覆盖 rgba(200,125,26,.1)/#9a5b13），
  0.9em，2px 6px，圆角 4；pre：bubble 内 bg var(--bg-primary) 圆角 4 padding 12
  （SessionDetail.css:345 覆盖基线的 bg-elevated/8px/1em），margin 1em 0；
  pre code：bg none 字 var(--text-primary) 1em（覆盖 .hljs 的 #DCDCDC）；
  hljs token 色版：dark=VS2015（comment #57A64A italic）、
  light=GitHub（comment #6a737d，MarkdownPreviewHighlight.css）。

## 6. fixture/复刻约定（B5）

- golden 侧：单组件挂载（裁决#4）——`.chat-history-overlay` 宿主 + 真 ChatHistoryPanel；
  数据全走 fixture.html `window.api.chat.*` 替身（getProjects/getSessions/getSession/
  search 等，payload 反拼；ISO 时间戳在替身内 Date.parse 转 ms）；banner 显隐经
  localStorage 种子（生产同一开关，挂载前写入）；选中会话/展开工具块/搜索输入经
  FixtureDriver 生产 click/原生 setter 路径；骨架屏 = getSession 永不 resolve 冻结。
- web 侧：纯 props（fx.chat）静态渲染终态；三栏宽度走 chat.css（CHAT_L1_09 断言工件）；
  消息 markdown 按 §5 markdown-it 形状静态生成（chat-md-static，fixture 子集）；
  时间函数与 formatSize/hashColor/extractTags 同构复刻，卡片时间依赖 capture 冻结时钟
  （epoch 2026-06-01T12:00:00Z，本地时区渲染，两侧对称）。
- 确定性：无随机、无网络、无图片；骨架/spinner 动画被两侧禁动画样式钉死；
  搜索防抖 300ms 由 ready 终态选择器（result-count 徽记）把关。

---

# chat-history live 附录（M5）

> 状态：**draft-for-review**（冻结走批末独立裁决）。范围：§0~§6 是 legacy 三栏静态复刻（golden 字节冻结，
> **本附录一字不改**）；§7 起补 **M5 live 数据接线**——把三栏从 fixture 替身接到真实 native 数据面。
> 数据语义（发现/投影/搜索/镜像）见 `chat-data.md`；本附录只管 **UI ↔ 数据的 live 通道、状态机、分页、
> 空态/同步条翻牌、跳转/续聊**。协议线形（`chat.request` / `data.event`）由协议 v10 冻结（批0 合并窗口
> 与 M6 v9 撞号后改 v10 合入；data.event payload 类型名=`DataEvent`，chat 两分支并入其 union）；
> 本附录描述**可观测行为契约**，kind/event 名以 v10 落定为准，形状与本附录行为一致。
> **加性改造纪律**：§0~§6 的 golden 与 vitest 断言全部保留；live 接线是**新增**运行时路径，不动既有静态
> 复刻的 DOM 形状/文案/字节。

## §7 live 数据流

### 7.1 请求面 `chat.request`（web → native，七 kind）

> **协议 v17 补录（批2）**：早期表列「五 kind」已过时——v17 增 `delete` / `setTitle` 两 kind + 在 `session`
> 请求上加 `all?` 布尔标志（超30天回填续聊需一次读全量，见 §7.7）。现共 **七 wire kind**（下表 5 + delete + setTitle）。

| 行为角色（wire kind 见备注） | 作用 | 替代的 legacy IPC | 分页 |
|---|---|---|---|
| projects（wire=`projects`） | 列全部项目（含 mirror 合并、worktree 归父） | chat:get-projects | 无 |
| sessions（wire=`sessions`） | 列某项目 / `__all__` 的会话，倒序 | chat:get-sessions | keyset 触底 +50（§7.3） |
| messages（wire=`session`，resp 变体=`messages`） | 读某会话详情投影；`all?:true` = 一次读全量（回填续聊用，resp `prevCursor=nil`） | chat:get-session | 反向 keyset 向上 +50（§7.3）；`all` 时不分页 |
| search（wire=`search`） | 全文搜索（user/assistant text，§chat-data §4） | chat:search | 无（每 session 首命中） |
| export（wire=`export`） | 导出 Markdown / JSON（CHAT_L1_06） | chat:export | 无 |
| delete（wire=`delete`，resp 变体=`deleted`） | 硬删会话（CC 两处物理删 + DB CASCADE + 清 customTitle；codex → `rejected(UNSUPPORTED_SOURCE)`，用户拍板） | 原生右键菜单删除 | 无 |
| setTitle（wire=`setTitle`，resp 变体=`ok`） | 写会话 customTitle（空串 = 清除回默认 title）；native ChatCustomTitlesStore 持久化 + wire 层叠加。**W8 双向（用户拍板 2026-07-11）**：成功副作用反向同步——该 sid 正锚定在存活终端（多锚取 lastActiveTs 最大）→ tile customName 跟随（清除同步清）；无锚定 = 只改记录本身 | 原生右键菜单重命名 | 无 |

> 跳转/续聊**不走 chat.request**：双击跳转与「继续聊天」是 `ui.action` 的 `chatJumpToTerminal` /
> `chatResume` 分支（v10，fire-and-forget event），见 §7.7——legacy 双击未落地 + resume 按钮的行为归宿。

- 请求携 `requestId`，native 回同 requestId 的 response；错误 → 该栏进错误态（PRD M08 §7.3「错误态」：
  中栏「暂无会话记录」占位，不弹红框）。**只读**：chat.request 绝不写 CC/Codex 源。
- **wire 形状 = 协议 v10 view 类型（非 §8.1 dump 形）**：projects/sessions/messages/search 的 response
  payload 用 protocol.json v10 的 `ChatProjectView` / `ChatSessionView` / `ChatMessageView` / `ChatSearchHit`
  ——字段名以 protocol.json 为准，与 `chat-data.md §8.1` 的**双跑内部 dump 形（legacy 名）是两个不同面，不是
  同名同形**。v10 wire 名相对 §8.1 legacy 名的主要差异：`*Ms` 后缀（时间戳整数毫秒）、`role`（非 `type`）、
  消息体 `text?`+`blocks?` 拆分（非单一 `content`）、`ChatSource='claudeCode'|'codex'`（camel，非 kebab）、
  工具块 `inputJson`/`resultJson`/`dataUri`（原文串/形状全变）、`ChatProjectView` 无 `source` 字段、
  `ChatSessionView` 的 `archiveOnly`（批0 回修新增布尔字段，见 §7.7）。
- **批4 Live 适配器负责 wire→screen fixture 形状换算**（screen 侧 `ChatProject`/`ChatSession`/`ChatMessage`/
  `ChatContentBlock` 是 fixture 消费形、非 wire 形；换算在批4，不改 §0~§6 静态复刻）。换算映射表：

  | v10 wire（协议） | screen fixture（§0~§6 消费形） | 换算 |
  |---|---|---|
  | `startedAtMs`/`lastModifiedMs`/`lastActivityMs`/`tsMs`（int ms） | `startedAt`/`lastModified`/…（ISO 或 number） | ms → ISO 串或 number（screen 时间函数按 §5/§6 口径） |
  | `role`（user/assistant/system） | message `type` | 恒等（role → type） |
  | `text?` + `blocks?`（恰一存在） | `content`（string ∣ block[]） | text 有 → content=string；blocks 有 → content=block[]（「恰一」由批1 native 组装保证） |
  | `ChatSource='claudeCode'` | `source==='claude-code'`（kebab） | **`claudeCode` → `'claude-code'`**（codex 恒等，协议 MINOR-1） |
  | 工具块 `inputJson`（原文串） | `input`（已解析对象） | **`JSON.parse(inputJson) → input`**；原样透传字符串会退化为「JSON 的 markdown」而非 key/value 字段 → CHAT golden 回归风险（协议 MINOR-2） |
  | `ChatSessionView.source?` 缺席 | `source` | **缺席 ⇒ 默认 `'claude-code'`**（协议 MINOR-3，screen `:391` 已默认） |
  | `ChatMessageView.cwd?` 缺席 | `cwd`（screen 非可选） | 缺席 ⇒ `''`（空串） |
  | 块 `thinking{text}`（v22） | block `{type:'thinking', text}` | thinking 折叠块（展开体走 markdown）；native 只取 thinking 正文，signature 加密签名 wire 面丢弃（问题4，见 §7.10） |
  | 块 `unknown{blockType, rawJson}`（v22） | block `{type:'unknown', name:blockType, content:rawJson}` | 未知块占位（不再裸 dump 整块 JSON 进正文）；redacted_thinking 等无可读正文块落此，原文 JSON 展开体 `<pre>` 呈现（问题4 根因2，见 §7.10） |

  screen 按上表接线，**不按 §8.1 legacy 名**接线（§8.1 只服务双跑 dump diff，与 wire 是两个面）。

### 7.2 推送面 `data.event`（native → web，三推送）

| event（行为角色） | 触发 | 对应 legacy | UI 效果 |
|---|---|---|---|
| session-append | 当前打开会话被外部续写（watcher 500ms 去抖后，chat-data §6.1） | chat:session-update（CHAT_L1_07） | 右栏尾部追加新消息；用户未上翻则自动滚到底（REQ-CHAT_BROWSE-029） |
| sync-status | 镜像同步状态变化 | chat:sync-status（CHAT_L1_08） | 同步条文案/图标翻牌（§7.5） |
| title-update | customTitle 真变化（ChatCustomTitlesStore.onChange 单点：终端重命名正向链 / 首绑补写 / 聊天卡 setTitle，v26——与批A v25 撞号重编） | 无（legacy 无推送，靠重开面板） | 中栏该卡标题即时 patch（保活面板不重挂载也跟随，W8 强绑定） |

- **session-append 定向（v10 event = `chatSessionUpdate`，裸信号非增量帧）**：payload = 裸信号
  `{projectHash, sessionId}`，**不携带追加内容**（同 legacy `chat:session-update`）——UI 据信号**重取**
  messages 投影尾部，不是「事件带增量帧」。「session-append」是行为角色名，wire event 名以 v10
  `chatSessionUpdate` 为准（sync-status 同理 = v10 `chatSyncStatus`；两者均为 `DataEvent` union 分支，
  与 M6 的 `configResourcesChanged` 并存）。仅当**正是当前右栏打开的会话**才追加，
  否则只更新中栏该卡片的 lastModified/排序（不打断右栏）。重取走 messages 投影同一口径（chat-data §3），
  按 uuid 去重后**只追加新 uuid**（不重复已渲染）。
- **上翻保护**：用户正向上翻阅历史（滚动位置非底部）→ 追加但**不强制拉底**（REQ-029 异常分支）。
- **title-update 定向（v26 event = `chatTitleUpdate`，W8 强绑定）**：payload = `{sessionId, title?}`（title
  缺席 = 已清除，回落原 title）。web 定向 patch 中栏该卡 `customTitle`（同 W13 乐观 patch 的 reducer 口径）；
  未加载 sid 忽略（后续回取经 wire 叠加兜底）。推送源 = `ChatCustomTitlesStore.onChange`（**真变化才触发**，
  等值 no-op 不推——天然去重）；三写点（终端重命名正向链 / R2.5 首绑补写 / 聊天卡 setTitle）全收敛此单点。
- 面板关闭（§7.6）后**退订**三推送，native 停止对该会话的定向推送。
- **未知 sessionId 推送 → 去抖首页回取（dogfood-r4 问题3a）**：`chatSessionUpdate` 的 sessionId 既非当前右栏
  会话、又不在已加载中栏列表里（新建会话首次续写常态）——旧行为是 `sessionCardTouch` 静默 no-op（新会话永不
  上榜）。现改为：**800ms trailing 去抖 + in-flight 单飞**回取当前视图首页（带当前项目筛选、无 cursor），响应
  走 `sessionsRefreshed` **top-merge**（已知 sessionId 就地更新、未知追加尾部、**`sessionsNextCursor` 不动**）。
  防风暴三重：去抖把一串推送合并成一次、在飞回取不叠发、top-merge 不重置分页游标。已知 sessionId 保持
  `sessionCardTouch` bump 排序（不回取）。

## §7.3 分页游标契约（keyset，非 offset）

- **sessions（中栏，向下）**：首屏 50 条（lastModified 倒序）；滚动哨兵触底 → 带**末条游标**
  `(lastModified, sessionId)` 请求下一批。**终止 = `nextCursor` 缺席**（服务端判定，对齐协议 v10
  `{sessions[], nextCursor?}`，与本节 messages 侧 `prevCursor` 缺席对称）。**不可用「批 <50 → 到头」判终止**：
  页大小 50 是服务端常量，但空-title 会话丢弃（chat-data §2.2）发生在 slice(0,limit) **之后**——一页 keyset 取
  50 原始条、丢掉若干空 title → **中途页也可能返回 <50 却并非到头**，按「不足 50→到头」会静默截断会话列表（丢失
  后续几百条）。keyset 以 `(lastModified DESC, sessionId DESC)` 稳定分页，避免 offset 在并发追加时错位/重复。
- **messages（右栏，向上）**：首屏最近 50 条（REQ-CHAT_BROWSE-018）；滚到**顶部**哨兵 → 带**首条游标**
  反向请求更早 50（向上补）；返回的 `prevCursor` **缺席 = 到头** → 顶部渲染 `.session-detail__all-loaded`
  「— 已加载全部 —」（§4 既有 DOM，hasEarlier=false）。反向 keyset 以文件内序为准（投影顺序即红线，
  chat-data §8.2 消息不排序）。
- **游标不可跨源混用**：CC / Codex / mirror 的游标各自独立；聚合列表的游标 = 归并后 `(lastModified,
  sessionId)`（chat-data §5.4 聚合口径）。
- 分页**不改 golden**：fixture 消息数少不溢出（§0），静态复刻走全量渲染；分页只在 live 运行时生效。

## §7.4 搜索状态机（去抖 300ms）

四态（对齐 chat.spec.json CHAT_L1_10_search..13_search / T-search 系列）：

```
EmptySearch --(输入非空, 去抖 300ms 到时)--> Searching
Searching --(有结果)--> HasResults
Searching --(无结果)--> NoResults
HasResults/NoResults --(改词, 去抖 300ms)--> Searching
HasResults/NoResults --(清空/×)--> EmptySearch
```

- **去抖 300ms**：输入停止 300ms 才发 search（§6 既有防抖口径）；期间中栏「标题匹配」节即时客户端过滤
  （§3，title/customTitle 含 query），「内容匹配」节挂 spinner + 骨架卡（§3 searching 态）。
- **Searching → HasResults**：后端 results 到 → 「内容匹配 (n)」节渲染（去重排除标题命中，未加载会话以
  snippet 造占位卡，§3）；result-count 徽记「{n} 个结果」（§3，此徽记是 e2e/vitest 的 ready 终态选择器）。
- **Searching → NoResults**：标题匹配 + 内容匹配全空 → `.session-list__empty`「无匹配会话」（§3）。
- **清空**：× 或删空 query → 回 EmptySearch，中栏恢复全量会话列表（保持当前项目筛选）。
- **搜索面语义**（谁能被搜到）以 `chat-data §4.3` 为准（搜索面 ⊋ 被详情投影丢弃的 user 行 text）。

## §7.5 同步条（CHAT_L1_13 翻牌）

- **§0 记 CHAT_L1_13 为 legacy stub-only**（sync-status.ts 零消费，UI 不渲染同步条）——本批**翻牌真实现**。
  面板**底部**渲染 `.chat-history__sync-bar`（新增 DOM，不动既有列）：
  - idle → 「Muxvo 镜像 · 最后同步 HH:MM」（HH:MM = sync-status.lastSync 本地时区补零；文案对齐
    chat.spec.json CHAT_L1_13 `Muxvo 镜像 · 最后同步 HH:MM`）。
  - syncing → 旋转图标 + 「Muxvo 镜像 · 同步中…」（截图禁动画 → 恒态）。
  - error → 「Muxvo 镜像 · 同步暂停」（对齐 chat-data §6.4 readonly 降级，不弹红框）。
- 数据来自 `data.event` sync-status 推送（§7.2）；镜像落**数据根 `chat-history/`**（chat-data §6.2，严禁
  `~/.muxvo`）。lastSync 源 = `chat-history/sync-state.json.lastSync`（chat-data §6.3）。
- **golden 影响**：同步条是**新增**底栏，属新 golden——须走 `specs/screens.json` 授权新增截屏（即截即
  commit，不重生成既有 64 golden）；本批只定行为，golden 由后续接线批按流程补。
- **冷首开索引未就绪空态 + 同步完成回取（dogfood-r4 问题3a）**：首次开聊天历史时镜像索引可能仍在首扫
  （`syncStatus==='syncing'`），此刻 sessions 为空**不代表真无记录**——旧空态直接落「暂无会话记录」是误报。
  修正（均 **gate 在 isLive**，静态/golden 路径 live 缺席不可达，「暂无会话记录」冻结分支不变）：
  - **中栏空态**：`(sessionsLoading || syncStatus==='syncing') && 列表空` → 渲 `SessionsSkeleton` 骨架，
    骨架上方加一行 live-only 提示 `.session-list__sync-hint`「正在建立索引…」（样式落 live 专属 `chat-live.css`，
    不动冻结的 `chat.css`）。仅 `!syncing && !loading && 列表空` 才落「暂无会话记录」。搜索「无匹配会话」同门
    （syncing 时改显同款建索引提示）。
  - **同步完成回取（边沿触发 + 陈旧标）**：首扫期（syncing）加载到的 projects/sessions 打**陈旧标**
    （`projectsStale`/`sessionsStale`）；**严格 `syncing→idle` 边沿**且（有陈旧标 或 首扫期空列表）→ bump
    `refetchEpoch` 一轮，projects/sessions effect 各回取一次补齐（列表非空走 `sessionsRefreshed` top-merge、
    不闪骨架；空列表走 `sessionsLoaded` 全替换）。**防循环**：稳态 `idle→idle` 裸帧永不 bump（非边沿）；
    idle 期新鲜加载即清陈旧标。

## §7.6 noCC 空态（CHAT_L1_14 翻牌）+ banner 文案 prop 化 + 关闭

- **noCC 空态（CHAT_L1_14，§0 记 stub-only → 本批翻牌）**：`~/.claude/` 不存在（无任何 CC 痕迹）时，
  中栏渲染 noCC 空态（对齐 chat.spec.json CHAT_L1_14）：文案 **以 spec 为准**「未检测到 Claude Code 聊天
  记录…」+ 对话气泡图标 +「了解 Claude Code」按钮。**与 CHAT_L1_15 的 noProjects 空态区分**：noProjects
  =「~/.claude/projects/ 存在但空」→ 沿 §0 实渲染「暂无会话记录」；noCC =「~/.claude/ 整个不存在」→ 新
  noCC 文案。判定优先级：noCC（根缺失）> noProjects（根在但无项目）。
  - **Codex 存在但 CC 不存在**：M5 双源——若 `~/.codex/` 有数据则**不进 noCC 空态**（有 Codex 会话可浏览）；
    noCC 仅当 CC + Codex 双缺。
- **archive banner 文案 prop 化**（§1 banner，用户已拍板）：`.chat-archive-banner` 静态长文案改为 **prop
  注入**：
  - **缺省 prop = §1 冻结文案**（zh.ts:41 原文，含「已自动归档到 ~/.muxvo/chat-archive/」）——**golden 用
    缺省 prop，字节不动**（既有 banner golden 保留）。
  - **live 运行时 prop = 新文案**：指向**数据根 `chat-history/`**（不再是 `~/.muxvo/chat-archive/`），
    对齐 chat-data §6.2 的新镜像位置。live 与 golden 走不同 prop 值 → golden 不受 live 文案变更影响
    （加性改造）。
  - **dogfood-r5 PR-5 再修订（共享归档池，纯增；live-only）**：live 运行时 prop 文案改为「…Muxvo 已自动
    归档到**共享归档库（所有 Muxvo 分身共用）永久保留**…」，对齐 chat-data §6.5 中心化共享池（不再是 per-分身
    `chat-history/`）。缺省 prop（golden 静态兜底 `ChatHistoryScreen` 冻结文案，含 `~/.muxvo/chat-archive/`）
    **字节不动**，golden 不受影响。web 常量 `LIVE_BANNER_TEXT`（`ChatHistoryLive.tsx`）；dom-assert
    `chat-r1-batch3` 三段进度断言的静态长文案标识串同步 `chat-history/`→`共享归档库`。
  - 「归档进行中」互斥变体（onArchiveProgress，§1）仍 dom-assert，不出 golden。
- **Esc / 关闭（chatClose）**：面板 Ready/SessionDetail 态按 Esc 或点关闭 → 面板关闭回 Closed（对齐
  chat.spec.json CHAT_L1_14_close `Ready -> Closed`）。关闭时：退订 §7.2 两推送、停中/右栏分页哨兵、
  保留下次进入的项目筛选（CHAT_L1_19 `maintain previous project filter` 由容器态持有，不随关闭清空）。
  关闭是 web 容器级动作，经 bridge close 通道（非 chat.request 七 kind 之一，见 §7.1 补录）。
  - **保活修订（dogfood-r4 问题3b，对抗补录）**：为「切走再切回浏览态全保持」，关闭**不再卸载 chat 容器**，
    改为 main.tsx 常驻挂载 + 可见性切换（详见新 §7.9）。因此「退订两推送」的旧口径**修订为：订阅保持在线**
    （隐藏期继续消费 session-append/sync-status，回来即最新）；native 侧 panelMode 已回 `.terminal`，不再对
    隐藏面板推定向帧亦无害（订阅在但无渲染副作用）。「停分页哨兵」由 IntersectionObserver 在隐藏（0 尺寸/
    visibility:hidden）时自然不触发承接。Esc 关闭语义不变（但仅**可见**期监听，见 §7.9）。

## §7.7 双击跳转与继续聊天（引用 CHAT_L1_18 裁决）

> 裁决记录：`~/Library/Caches/muxvo-build/logs/m5-batch0-chat18-adjudication.md`（三方对照：老 app 无
> handler / kickoff M08 略去 / PRD.md:1016+1869 有并定义语义 / spec P0）。结论建议 = **按 spec 真实现**
> （沿 CHAT_L1_13/14 stub-only→M5 先例），批末独立裁决确认 (A) 实现 / (B) 标偏差豁免。以下按建议 (A) 写，
> 裁决落 (B) 时本节整体降级为「不实现 + status.json 偏差 note」。

- **继续聊天（resume，REQ-CHAT_BROWSE-027，legacy 已有）**：右栏顶部 `.session-detail__resume-bar` 按钮
  → 切 Terminal Tab **新开终端** + 上下文恢复到该会话；有 customTitle 则新终端标签继承。这是显式 resume 入口。
  - **live canResume 判据（M5-R1 批2 语义修订：CC 面不再看 archiveOnly）**：`canResume =
    source∈{claude-code,codex} 且 cwd 非空 且消息已加载`。archiveOnly 会话 = **仅归档**（CC 已清原文件、
    镜像仍在，chat-data §2.3/§6.1），**可回填后照常 resume**——native 回填契约：`chatResume`（仅 claude
    harness）注入前过归档回填闸 `ensureResumable`（ChatRestore 镜像→CC 单向回填，chat-data 冻结面修订
    登记①）：restored/alreadyPresent → 照常注入 `claude --resume`；archiveMissing/failed → 跳过注入
    （终端保持纯 shell）+ 主线程 NSAlert「无法恢复会话」（ARCHIVE_NOT_FOUND=归档缺失 / RESTORE_FAILED=
    回填失败文案）。M08 REQ-CHAT_BROWSE-028「无法恢复 → 按钮不显示」对 archiveOnly 不再适用（回填使其
    可恢复）；web 侧原 `!archiveOnly` 拦截随本修订作废（web 判据收敛归 web 接线批）。注入另增**尺寸就绪
    门**（PTY 收到首个 bounds 驱动 resize 后才写 payload，5s 超时兜底——防回放按 spawn 80×24 窄烧写），
    见 `terminal-session-restore.md` 冻结面修订需求登记⑩。
  - **数据依赖**：archiveOnly 由数据面产出（chat-data §2.3），经 wire 承载 = protocol.json
    `ChatSessionView.archiveOnly`（v9 新增布尔字段），语义 =「仅归档」标记（供 UI 标注来源，非 resume
    拦截位）。§4 静态复刻形（golden/vitest）不含 archiveOnly-blocked 样本，§4 canResume 措辞不变。
- **双击卡片：聚焦跳转或继续聊天（CHAT_L1_18 / T09；2026-07-07 用户拍板细化 jump-or-resume，M5-R1 m-2 补记）**：
  中栏卡片 `onDoubleClick`（§3 卡片）经纯函数 `pickDoubleClickAction(session, resumeCtx, terminals)` 三分决策
  （web 半 `live/actions.ts`）——
  1. **有匹配活体终端 → `chatJumpToTerminal`（聚焦跳转，轻量导航不新开）**：终端 cwd 与 session 解析 cwd
     **前缀匹配**且状态非 `Stopped`/`Removed`。匹配口径与 native `cwdPrefixMatches` **逐字一致**
     （TerminalService.swift:878-891）：两侧**去尾斜杠归一**（根 `/` 保留），按**路径分量边界**判「终端 cwd ==
     session.cwd 或以 `session.cwd + "/"` 开头」——含 worktree 子目录（session 在项目根、终端在其 worktree
     子目录 → 命中）；`/a/proj` 不误配 `/a/proj-x`；空 session.cwd 恒不命中。**web/native 必须同口径**，否则
     `/repo` 会话 vs 只开着 `/repo/worktree-x` 终端、尾斜杠差异会分叉（web 误判「无活体」开重复终端）。
  2. **无匹配终端但 cwd 可解析 → `chatResume`（继续聊天）**：等价右栏「继续聊天」入口，native 恢复上下文到
     新终端。source∈{claude-code,codex}——搜索内容匹配占位卡 source 未知时，从已加载消息 uuid 前缀推断
     （`codex-` → codex，M-1），避免 codex 会话错注入 CC harness。
  3. **cwd 不可解析（会话无 cwd 且无消息 cwd）→ `chatJumpToTerminal` 保底**：cwd 缺席 → native 决策 `.closeOnly`
     （仅关面板，不新开/不 resume）。
  - 面板关闭由 native 半按各动作语义处理（jump/closeOnly 关面板；resume 切 Terminal Tab）——**不再是 web 无条件关**。
  - archiveOnly 会话双击落 `chatResume` 分支：web 不拦截 → 交 native 处理。原「批2 接缝（archiveOnly
    会话不 resume）」已按相反方向兑现（M5-R1 批2「超30天回填续聊」）：native 回填闸统一处理——回填成功
    照常 resume；归档缺失/回填失败跳过注入 + NSAlert 反馈。web 双击/按钮无需特判 archiveOnly。
- **双击 vs 单击（防误触 220ms 去抖）**：单击（§3）= 右栏加载详情（浏览，不关面板），但**延迟 220ms 落地**
  （容器持 timer ref，卸载清理）；双击在该窗内先**撤销 pending 单击选中**再发射上述动作（连续单击换卡只留末次）。
  - 数据依赖已在 chat-data §2.3/§9 落定（cwd 可用 + resume 判定一致）；无新增数据面需求。
- **继续聊天后终端 header 路径同步（F-B 增补，dogfood-r1 2026-07-09；增补留痕，勿改上文原句）**：`chatResume`
  注入 `cd -- '<cwd>' && <harness> resume <sid>` 成功后，native 把注入 `cd` 的落点写成该终端的**权威 cwd**
  （`TerminalSession.noteInjectedCwd`），令终端 tile header 稳定显示继续聊天的目标 cwd——不被恢复终端 login
  shell 里 `.zshrc` 的 `cd`（OSC7 漂移）钉死到别处（用户 dogfood 反馈：点「继续聊天」CC 正常恢复但 header 路径
  不同步）。机理与冻结面登记见 `terminal-session-restore.md` 冻结面登记⑨ + `terminal-session.md` §5「注入 cd
  权威源登记」。CC/Codex 两 harness 同缝：Codex 续聊 cwd 取自逐条消息 cwd（← `session_meta.cwd`；`SessionSummary.cwd`
  恒 nil 是双跑红线），`CodexSourceTests.CD_codex_resume_cwd_from_session_meta` 钉死该链路。

## §7.8 M5-R1 批3 live 增量（W1/W8/W10/W11 + R7.3 归档开关；对抗补录）

> 以下均为 **live-only**（fx.live 存在才渲/接线）：静态复刻（§0~§6）与 6 张 chat golden 逐字节不受影响。
> 补录动机：批3 落地的顶部 chrome、右键菜单、回到顶部、mermaid/复制钮、归档开关此前未入 spec（对抗 minor#4）。

- **W1 顶部 tab 栏 chrome + 面板意图信箱**：进聊天历史后顶部 tab 栏（终端/Skills/MCP/Hooks/Plugins/历史聊天）
  **保留**（用户拍板）。live 壳 `ChatHistoryChrome` = `MenuBar(activeTab='chat')` + `ChatHistoryLive`
  （`.chat-history-overlay` 本就 fixed top:36px 嵌菜单栏下）。tab 路由：
  - 终端 → `chatClose`（回终端态）；历史聊天 → no-op（已在此）。
  - 配置 tab（skills/mcp/hooks/plugins）/ 齿轮 settings → **面板意图信箱**（`live/panelIntent.ts` 模块单例，
    3s TTL）：`setPendingPanel` + `chatClose` → 回终端后 `LiveChrome` 挂载 **peek 信箱**（初始化器纯读）打开对应
    面板、挂载 effect 清空信箱（StrictMode 双渲染安全，勿在初始化器里读走即清）。
  - 首页/终端态点「历史聊天」tab → `ui.action{chatOpen}`（native `setPanelMode(.chatHistory)`）。
- **R7.3 归档开关（banner checkbox 接线）**：§1 描述的「自动归档：开启/关闭」checkbox 现经 **config 通道**接线
  （非 legacy getArchiveEnabled）：读 `ConfigSnapshot.archiveEnabled`（ChatHistoryChrome 包 `ConfigProvider`
  供给），切换发 `PrefsPatch{archiveEnabled}`（`ConfigApi.set` 乐观更新 + rejected/传输错自动重拉 get 回滚）。
  关后 = 仅停新任务归档，已归档会话仍可见（native 语义）。无 configApi（截图/无桥）→ checkbox `readOnly` inert。
- **W8 会话右键菜单（`.session-context-menu`，fixed 定位）** + 内联重命名 + 删除确认：卡片右键出菜单（重命名 /
  导出 / 删除三项）。重命名 → §3 内联 `RenameInput`（预填 customTitle||title、全选、Enter/blur 提交、Esc 取消、
  空串=清除回默认）→ 发 `setTitle`（§7.1）。**W8 强绑定（2026-07-11）**：customTitle 与终端 tile customName
  是**同一个值**（以 CC sessionId 为键）——终端改名 → 正向链即时写 + `chatTitleUpdate` 推送即时刷（§7.2）；
  聊天卡改名 → 反向同步锚定终端 tile 名（§7.1 setTitle 行）；无自定义名 → 回落首条消息 title（chat-data §2）。
  删除 → 二次确认弹窗 `DeleteConfirmModal` → 发 `delete`（§7.1）；
  **codex 会话删除 → `rejected(UNSUPPORTED_SOURCE)`**，内联文案「Codex 会话暂不支持删除」（用户拍板 codex 不删）。
  - **§3 rename-input 样式偏差（对抗记录，二者取一待定）**：spec §3 写「透明底 + border-bottom var(--accent)」，
    实现为 `border + bg-input 圆角`。以实渲染工件为准（同 §0 偏差口径），spec 措辞后续对齐实现或反之，暂记 note。
- **W10 回到顶部钮**：右栏详情滚动离顶一定距离后出「回到顶部」浮钮，点击平滑滚回首条。live-only 浮层，静态无。
- **W11 markdown 复制能力（推翻 §0「复制按钮不存在」）**：live 渲染链 `chat-md-live`（经 ChatHistoryLive 动态
  import，截图 bundle 零感知）——① mermaid 围栏渲染为图（一次性 init 主题）；② 每个代码块渲「复制」钮；
  ③ 详情头渲「复制为 Markdown」整段钮（`formatMessagesAsMarkdown`）。均 live-only；golden 走 `chat-md-static`
  纯 `<pre class="hljs">` 无钮（§0 CHAT_L1_11 note 已改写）。

## §7.9 面板保活与浏览位置保持（dogfood-r4 问题3b）

> live-only（bridge 存在才生效）；截图/静态路径 `chatEverOpened` 恒 false → 保活容器永不挂载，静态图零介入。
> 动机：旧实现每次 `chatClose` 卸载整个 chat 容器，切走再切回 = 全新挂载 → 选中会话/滚动位置/展开态/搜索词
> 全丢，用户反馈「历史聊天切走再回来啥都没了」。

- **挂载一次（懒挂载闸）**：main.tsx `FixtureHost` 以 `chatEverOpenedRef`（首次 `panelMode==='chatHistory'`
  置真）懒挂载 chat 容器 `.chat-keepalive`——从未进过聊天历史则零成本不挂；无桥/截图路径 `chatOpen` 永不为真
  → 容器永不挂。首次进入后**常驻挂载**，`ChatHistoryChrome`/`ChatHistoryLive`/`useChatData` 全程不卸载。
- **可见性切换（非 display:none）**：隐藏用 `visibility:hidden + pointerEvents:none + inert + aria-hidden`
  （**不用 `display:none`**——保 `scrollTop`/布局树/组件态）。`inert` 由 DOM property 直设（绕 React 18 属性
  转发差异）。可见时正常。容器根 zero-style，其内 `.app`/overlay 自带 `position:fixed` 全屏定位，隐藏可见
  布局一致。主视图（终端/任务中心）与 chat 容器**并列于 Fragment**（primary 在前、容器在后 key 恒定）：
  `chatOpen` 翻转只切 primary 有无与容器可见性，**chat 容器不卸载**。chatOpen=true 时 primary=null（与旧
  「聊天可见时 LiveRoot 卸载」一致），LiveRoot 隐藏期不并存。
- **Esc 门控（唯一真雷）**：`ChatHistoryLive` 的 Esc→chatClose 监听**仅 `active`（可见）时挂载**——否则隐藏期
  在终端里按 Esc 会误发 chatClose。`active` 由 main.tsx 保活容器透传（`= chatOpen`）。
- **隐藏清瞬态**：`active` 翻 false 时清一次性 overlay（右键菜单 `menu`、删除确认 `deleteTarget`/`deleteError`、
  pending 防误触单击 timer）——避免复现时残留。浏览态（选中/滚动/展开/搜索词）不动。
- **跳渲**：`ChatHistoryChrome` 以 `React.memo(cmp, (p,n)=>!p.active&&!n.active)` 双隐藏时跳过 FixtureHost 每推
  重渲（隐藏面板无需跟拍 fx）；`active` 翻转必重渲。`useChatData` 订阅始终在线（数据事件驱动自身重渲，不受
  parent memo 影响）→ 隐藏期照常收敛最新。
- **hit-testing 不变式**：隐藏容器 `pointerEvents:none + inert` → 鼠标穿透到终端；native surface 洞几何不受
  影响（chat 面板本就无 tile 洞）。关闭语义修订见 §7.6 保活补录。

## §7.10 会话详情转写降噪（dogfood-r4 问题4）

> live-only（fx.live 存在才渲/接线）；静态复刻（§0~§6）与 6 张 chat golden 逐字节不受影响——新折叠壳/
> thinking/unknown 节点一律 gate 在 `isLive`，user 气泡 md 覆盖落 live 专属 `chat-live.css`。
> 动机：用户反馈会话详情噪声大（system-reminder / 命令回显 / shell 注入 / thinking 原文 / 未知块整块
> JSON dump 全平铺），人类可读对话被淹没。协议 v22（`ChatContentBlock` += `thinking` / `unknown` 两变体，
> union 加分支不占槽，见 bridge-v1.md §9 v22）。

- **thinking 块折叠（wire `thinking{text}`）**：native `ChatWire.contentBlock` 对 `type=="thinking"` 只取
  `thinking` 正文（`signature` 是加密签名、人类不可读 → wire 面丢弃），过桥 `.thinking(text)`。web 渲
  `ThinkingBlock` 折叠壳（复刻 ToolCallBlock 交互）：header「▶/▼ Thinking」，**默认折叠**，展开体走 markdown
  （§5 渲染核）。thinking **不入搜索文本口径**（`enumerateMatches` 只计 text 块）→ 渲染不传 highlight，保
  「DOM mark 数=枚举命中数」不变量（W6）。
- **未知块占位（wire `unknown{blockType, rawJson}`）**：native 对未识别 `type` 且**无可读 `text`** 的块
  （如 `redacted_thinking`），不再裸 dump 整块 JSON 进 text 块（问题4 根因2），改过桥 `.unknown(blockType,
  rawJson)`（原文 JSON 不丢）。web 渲 `UnknownBlock` 折叠壳：header「▶/▼ 不支持的块类型: {name}」，默认折叠，
  展开体 `<pre>` 原文 JSON。**回归护栏**：未知 `type` 但**带 `text`** 的块仍走 `.text`（现行为不变）。
- **system 字符串消息折叠壳 `SystemFoldBlock`**：live 的 system 字符串消息（`isLive && isSystem &&
  typeof content==='string'`）改渲折叠壳（非 `.message-bubble__text`）——header「▶/▼ SYSTEM · {分类标签} ·
  {首行摘要}」（摘要 CSS 单行 ellipsis，不 JS 截字），展开体**纯文本** pre-wrap（沿用 `.message-bubble__text`
  口径 + `Highlight`，**不渲 markdown**）。折叠时不再渲外层 `.message-bubble__label`（折叠壳自带 SYSTEM 头，
  避免双 SYSTEM）。
  - **分类与默认态（`classifySystemMessage` 前缀判别）**：`<system-reminder>`→提醒、`<command-name>` /
    `<command-message>`→命令、`<task-notification>`→任务通知、`<teammate-message`→队友消息、`cd `/`bindkey `
    起头→shell、其余→空标签。**默认展开态**：队友消息（人类可读对话）**默认展开**，其余噪声**默认折叠**；
    展开态为消息级独立态（点 header 切换）。
  - **搜索命中自动展开**：搜索且该条正文含 query（`highlight && content.includes(query)`）→ 折叠壳**强制展开**
    （`expanded = state || searchForced`），令高亮 mark 渲入 DOM，保「DOM mark 数=枚举命中数」不变量（W6）。
    header 摘要为纯文本不打 mark（避免与展开体重复计数）。
- **user 气泡 markdown（缺陷4 从 assistant 扩到 user）**：convert `messageToScreen` 现把 **user** 字符串消息
  也包成 `[{type:'text', text}]`（`role !== 'system'` 才包；**system 保持 string** 走折叠壳）→ user 气泡正文
  走 markdown（§5）。`chat-live.css` 补 user 气泡 md 覆盖：`.message-bubble--user .markdown-preview` 收紧
  留白 + 白字 + code/a 配色（防 light 主题蓝底撞色）。
- **静态路径不变**：`isLive=false` 时上述分支全不进——system/user 字符串仍逐字节渲 `.message-bubble__text`，
  无折叠壳/thinking/unknown 节点，外层 `.message-bubble__label` 照旧；6 张 chat golden 零像素影响。

