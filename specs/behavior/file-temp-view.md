# file-temp-view（文件临时查看三栏）行为规格

> ⚠️ **已退役（2026-07-07，用户授权）**：三栏 FileTempView 被 tab 式文件视图取代 —— 见
> `specs/behavior/file-tabs-view.md`（v1 定版）。M2 静态屏 `FileTempViewScreen.tsx`、`screens.json`
> `file-temp-view` 条目、8 张 golden（ftv-md/ftv-md-dirty/ftv-code/ftv-sheet/ftv-unsaved/ftv-light/
> ftv-image-sub/ftv-pdf-sub）及 fixtures 均已删除；FILE_L1_09 断言迁至 file-tabs-view，
> FILE_L1_10/11（右栏多终端）改派 not-applicable（右栏不复存在，单来源终端 tab 替代）。
> **本文件保留作历史行为说明书**（渲染分型/未保存确认等语义被 file-tabs-view 继承复用）。

> 来源：muxvo-legacy `src/renderer/components/file/FileTempView.tsx` / `FileTempView.css` /
> `SpreadsheetView.tsx(.css)` / `PdfPreview.tsx` / `UnsavedPromptDialog.tsx(.css)` /
> `components/markdown/MarkdownWysiwyg.tsx(.css)` / `components/terminal/TerminalSidebar.tsx(.css)`
> + App.tsx:198-230（数据编排）。行为说明书，不抄结构。

## 0. 实况要点

- **三栏宽度**：左栏/右栏初值为组件常量 200/280，但挂载即 getConfig 覆盖——legacy 主进程
  config 默认 `ftvLeftWidth: 250`（main/services/config/defaults.ts:19）恒有值，**运行实况
  左 250 / 中 flex:1 / 右 280**（= FILE_L1_09；web 侧权威常量 `web/src/config/defaults.ts`
  DEFAULT_FTV_LEFT_WIDTH/DEFAULT_FTV_RIGHT_WIDTH）。拖拽手柄可调 80..700，松手写回 config。
- **code/text 不渲染行号**：FileTempView 内 `CodeView`（行号视图）是死代码（仅
  FilePreviewFloat 消费）；fileType=code|text 实渲染为 `.file-temp-view__editor` 纯
  textarea（mono 13px，tab-size 2）。screens.json "code 行号视图" 提法以此实况修正——
  ftv-code golden = textarea 形态。
- **右栏只显来源终端**：`terminals.filter(t => t.id === sourceTerminalId)`（:407）——
  恒 ≤1 个 tile；FILE_L1_10/11 与此相反，已改派 M6 终裁。右栏仅在该 filter 非空时渲染。
- **数据编排在 App 层**（App.tsx:198-230）：ext→fileType（utils/file-tree.ts
  mapExtToFileType）；image → content=`local-file://` URL；pdf → content=filePath
  （PdfPreview 自行 readFile base64 + pdfjs）；spreadsheet → readFile base64；
  其余 → readFile utf-8 文本。fixture host 直接把 content/fileType 当 props 灌，绕过 readFile。

## 1. 容器与三栏（FileTempView.css）

- `.file-temp-view`：`position: fixed; top: var(--menu-bar-height, 36px); left/right/bottom 0;
  display: flex; z-index: 150; background: var(--bg-deep)`。入场动画（entered 两帧后置位；
  截图禁动画恒终态）：左栏自 `translateX(calc(100vw - 320px))` 滑入；中栏 opacity 0→1。
- 左栏 `.file-temp-view__files`：width=ftvLeftWidth（行内样式），flex column，
  border-right 1px var(--border)。
- 拖拽手柄 `.file-temp-view__resize-handle`：6px 宽透明，hover var(--accent-glow)，
  active var(--accent)。左右各一（右手柄仅右栏存在时）。
- 中栏 `.file-temp-view__content`：flex:1。
- 右栏 = TerminalSidebar：行内 `width: rightWidth; flexShrink: 0; opacity: 0;
  transition: opacity .3s ease .15s` + entered 时 `.file-temp-view__sidebar--entered`
  （opacity 1 !important）。`.terminal-sidebar`：flex column，border-left 1px var(--border)，
  bg var(--bg-deep)；item 高 `100/min(n,3)%`，min-height 150px，内放 compact TerminalTile。

## 2. 左栏文件树

- 头 `.file-temp-view__files-header`：padding 12px 14px，border-bottom，13px/600；
  标题 = projectCwd 末段（accent、mono）；右侧隐藏文件 toggle
  `.file-temp-view__toggle-hidden(--active)` 同 file-panel §2 同款形态/行为。
- 树 `.file-temp-view__files-content`：flex:1 滚动，padding 8px；FileItem 行同
  file-panel §3（但**不传 meta**，无尺寸徽记）；`isActive = entry.path === filePath ||
  entry.name === fileName` → `.file-item--active`（var(--accent-glow) 底）。
- 数据/排序/懒展开/隐藏过滤同 file-panel §3（utils/file-tree.ts mapIpcToTree）。
  自动揭示：打开的文件若在已加载祖先链下，自动逐级 readDir 展开并 scrollIntoView。

## 3. 中栏

- 头 `.file-temp-view__content-header`：padding 12px 16px，border-bottom，mono 12px/600
  var(--text-secondary)，gap 8px：
  - 文件名 `.file-temp-view__content-filename`（flex:1）；dirty 时前缀
    `.file-temp-view__dirty-dot`：8×8 圆点 `var(--warning, #f59e0b)` → 实值 **#fbbf24**
    （legacy theme.css:32），margin-right 6px。
  - markdown 限定 mode 钮 `.file-temp-view__mode-btn`：2px 10px/11px/600，border
    var(--border)；文案 sourceMode? 'WYSIWYG' : 'Source'（i18n 两语同文案）；
    sourceMode 时加 `--active`（accent-glow 底/accent 字/accent 边）。⌘/ 切换。
  - 类型 tag `.file-temp-view__content-tag--{fileType}`：10px，1px 6px，圆角 3px；
    文案 MD/CODE/TXT/IMG/XLS/PDF；底一律 var(--accent-glow)，字色 markdown→var(--info)
    #60a5fa、code→var(--purple) #a78bfa、text→var(--text-secondary)、image→var(--success)；
    spreadsheet/pdf 无专属类（仅基类样式，字色继承 header 的 var(--text-secondary)）。
  - 返回钮 `.file-temp-view__back`：32×28，accent 配色（accent-muted 底/accent-glow 边），
    ← SVG；点击 = 关闭请求（dirty 时弹 unsaved 对话框）。Esc 同。
- 体 `.file-temp-view__content-body`：flex:1 滚动，padding 16px，13px/1.8，
  bg var(--bg-primary)。按 fileType：
  - **markdown**：默认 MarkdownWysiwyg（TipTap）`.markdown-wysiwyg > div >
    .tiptap.ProseMirror`，样式见 MarkdownWysiwyg.css（h1 1.8em 带底线、code
    `var(--code-bg, rgba(248,165,194,.15))/var(--code-fg,#f8a5c2)`（dark 走 fallback、
    light 走 theme.css:108 vars）、pre var(--bg-elevated) 等）；source 模式 = editor textarea。
    编辑触发 onChange → isDirty。
  - **code/text**：`.file-temp-view__editor` textarea（§0）。
  - **image**：`.file-temp-view__image` 居中容器（min-height 200px），img max-width 100% /
    max-height calc(100vh - 150px)，圆角 4px。
  - **spreadsheet**：SpreadsheetView（SheetJS 解析 base64）：多 sheet 时顶部
    `.spreadsheet-view__tabs`（active tab：bg var(--bg-surface)——**该 var 两主题均未定义**，
    计算值=透明底+currentColor 底边，复刻须保留同款 var() 缺省行为）；
    `.spreadsheet-view__table` border-collapse mono 12px，行号列
    `.spreadsheet-view__row-num`（bg var(--bg-deep)，min-width 40px，右对齐
    var(--text-muted)），单元格 1px var(--border) 边框 + `.spreadsheet-view__cell-text`
    padding 4px 8px；>1000 行截断提示。单元格点击行内编辑（视觉面不截）。
  - **pdf**：PdfPreview——loading `.pdf-preview--loading` / 失败 `.pdf-preview--error`
    （居中 14px var(--text-secondary,#888) 文本）/ 成功 toolbar（翻页/缩放钮 + `n / N` +
    百分比）+ canvas。canvas 栅格非确定性 → B4 golden 取 **error 终态**（喂非法 PDF 字节，
    pdfjs 报 `Invalid PDF structure.`），toolbar+canvas 不进像素对比（方案见 fixture note）。

## 4. UnsavedPromptDialog（二层）

- `.unsaved-prompt-dialog__overlay`：fixed inset 0，rgba(0,0,0,.5)，z-index 300，居中。
- `.unsaved-prompt-dialog`：380px，padding 24px，圆角 12px，bg var(--bg-elevated)，
  border var(--border)，shadow var(--shadow-dialog)。
- 标题（15px/600）`未保存的更改`；正文（13px var(--text-secondary)）`{fileName} 有未保存的更改。`；
  按钮行右对齐 gap 8px：`取消`（透明/--border）`丢弃`（透明/var(--error) 字+边）
  `保存`（var(--accent) 底/var(--bg-deep) 字）。Esc/点遮罩 = 取消。
- 触发：dirty 状态下点返回/Esc/树中切换文件；保存→写盘后执行 pending；丢弃→直接执行。

## 5. fixture/复刻约定（B4）

- golden 侧：单组件挂载（无网格底图；终端内容经顶层 terminals 喂 FixtureTermContent）；
  props 直灌（content/fileType 来自 payload，绕过 readFile——App.tsx 编排等价）；
  列宽走 getConfig 替身（fileConfig.ftvLeftWidth/ftvRightWidth = 250/280）；
  source/dirty/unsaved 经 FixtureDriver 生产 click/原生 setter 注值路径抵达。
- web 侧：纯 props；三栏宽用 defaults.ts DEFAULT_FTV_*；wysiwyg 为 tiptap 产物静态复刻
  （复用 skills-panel 的 renderMarkdown）；spreadsheet 表格按 SheetJS 产物 DOM 静态生成
  （fixture 直接给 cells 数组）；不引 TipTap/SheetJS/pdfjs。
