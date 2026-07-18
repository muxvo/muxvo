# file-panel（右滑出文件树面板）行为规格

> 来源：muxvo-legacy `src/renderer/components/file/FilePanel.tsx` / `FileItem.tsx` /
> `FilePanel.css`（行为说明书，只读行为不抄结构）。M2 B4 视觉复刻 + M6 功能实现共用。

## 0. 实况要点（高于一切文档）

- **isNew/NEW 徽标在 FilePanel 数据路径中不可达**：`FileEntry.isNew` 仅是 FileItem 的
  可选 prop（FileItem.tsx:86 渲染 NEW 徽标），但 FilePanel 把 IPC 条目映射为 UI 条目时
  （FilePanel.tsx:51-66 `mapIpcEntries`）**不产出 isNew**，运行中的老 app 文件面板永远
  不出现 NEW 徽标（该字段唯一生产来源是 `fs:change` 推送事件 `FileChangeEvent.isNew`，
  与本面板无消费关系）。→ fp-tree golden 不含 NEW 徽标，视觉对比以此实况为准。
- **空目录/无权限 = 树区纯留白**：readDir 失败静默 catch（FilePanel.tsx:123-125），
  成功但空数组则 map 出空列表；无任何文案、无图标（`features/file-viewer/empty-state.ts`
  为零消费 stub）。FILE_L1_13/14 已改派 M6 终裁，本批仅记录实况。
- ★**M6 批A 终裁（用户裁决 2026-07-06）：空态/无权限启用 PRD 文案，覆盖上条 legacy 留白实况**——
  空目录渲染「此目录为空」+📁、无权限渲染「无法读取此目录，请检查权限」+🔒（`.file-panel__empty`，
  仅 live 可达新分支，fp-tree golden 零感知）。判空口径：readDir ok 且**全量** 0 条才算空；
  「隐藏条目被 showHidden=off 滤空」≠ 空目录（树区留白，不出文案——不说谎）。FILE_L1_13/14 就此销账。

## 0.5 live 功能实现（M6 批A，v9）

- **开关态 native 拥有**（`ui.state.filePanel{terminalId}`，searchBar 范式）：按钮/⌘E（native 拦，
  开面板时 firstResponder 交 WKWebView）→ `ui.action fileOpen/fileClose`；Esc/点外/✕ 同 fileClose。
- **树数据**：`fs.request readDir`（native 恒返全量含 dotfiles 不排序）；排序/dot 过滤 web 侧
  flattenTree 同源函数（golden 与 live 行为字节一致）；懒加载展开、折叠保 cache 重展不重拉、
  子目录失败静默（§3 实况）、仅 root 失败入面板级空态。
- **隐藏开关**：`ui.action setShowHiddenFiles{value}` → native 落 config + 推快照（持久化免费）；
  初值读 `ui.state.showHiddenFiles`。
- **右键**（面板条目 + tile 头文件按钮同路，REQ-034）：`fs.request showFileMenu{path,isDirectory,x,y}`
  → native NSMenu（复制路径 / 在 Finder 中打开 / [仅文件]用默认应用打开）；pending 期间防重入。
  - **anchor 坐标语义（dogfood-r4 问题2）**：`x/y` = 浏览器 `clientX/clientY`（CSS 左上原点）。native
    `CompositeRoot.popUpFileMenu` 经纯函数 `menuAnchorPoint(cssX,cssY,boundsHeight,isFlipped)` 换算：
    macOS WKWebView `isFlipped==true`（与 CSS 同向左上原点）→ **(cssX,cssY) 直传** `menu.popUp(at:in:)`
    （其 at 点落接收 view 自身坐标系）；非 flipped 兜底才翻 `boundsHeight−cssY`。M6 批A 原实现对 flipped
    的 webView 仍做 `bounds.height−cssY` = **双翻镜像**（误差 `|H−2·cssY|`，垂直中部 ≈0 故 M6 验收未察觉，
    靠上/下的行则错位）。注意 `PassthroughWebView.hitTest` 的 `bounds.height−point.y` 与此无关且正确——那里
    的 point 在**非 flipped 的 superview** 坐标系，本就该翻。
- **拖拽条目入终端**（REQ-020）：源行 dataTransfer `application/x-muxvo-path` + 全窗 DragIsland
  （岛机制防洞区吞 dragover）+ `body.dragging-file`（overlay 放行）；靶=tile 根只认该 type →
  `term.command insertText{terminalId, text:quotePath(path)}`（web 侧单引号转义含尾随空格）。
- **点文件行 = 批A no-op**（用户裁决：批B tab 式文件视图接管，见 file-tabs-view.md）。

## 1. 布局与尺寸（FilePanel.css）

- 容器 `.file-panel`：`position: fixed; top: var(--menu-bar-height, 36px); right: 0; bottom: 0;
  width: 320px`；`background: var(--bg-card)`；`backdrop-filter: blur(24px) saturate(180%)`；
  `border-left: 1px solid var(--border)`；`box-shadow: -8px 0 48px rgba(0,0,0,0.5)`；z-index 200。
- 滑入动画：初始 `translateX(100%)`，挂载后下一帧加 `.file-panel--open` → `translateX(0)`
  （transition 0.3s cubic-bezier(0.4,0,0.2,1)；截图禁动画 → 恒终态）。
- 点击外侧关闭：`.file-panel-overlay` 全屏透明层（z-index 199），点击 onClose；Esc 同。
  拖文件时 `body.dragging-file` 令 overlay `pointer-events: none`。

## 2. 头部

- `.file-panel__header`：padding 12px 14px，border-bottom 1px var(--border)，两端对齐。
- 标题 `.file-panel__title-name` = projectCwd 最后一段（`split('/').pop()`，空则 '~'）；
  色 var(--accent)，font-mono，13px/600。
- 动作组 `.file-panel__actions`（gap 6px）：
  - 隐藏文件 toggle `.file-panel__toggle-hidden`：28×28，圆角 6px；off = 透明底
    var(--text-muted) 斜杠眼睛 SVG（eye-off），on（`--active`）= var(--accent) 字色 +
    var(--accent-muted) 底 + var(--accent-glow) 边框，睁眼 SVG。点击翻转并把
    `showHiddenFiles` 写回 config（getConfig→saveConfig 合并）。
  - 关闭钮 `.file-panel__close`：28×28，`✕`（✕），accent 配色同 toggle-active。

## 3. 文件树

- `.file-panel__content`：flex:1，overflow-y auto，padding 8px。扁平列表渲染（无嵌套 DOM）。
- 数据：挂载/projectCwd/showHidden 变化时 `fs.readDir(projectCwd)`；条目排序 =
  **文件夹优先，再 name.localeCompare**；`showHidden=false` 时滤掉 `.` 开头条目。
  showHidden 初值取自 config.showHiddenFiles（getConfig）。
- 行 `.file-item`（FilePanel.css 共享样式，SkillFileTree 同款）：flex，gap 8px，
  padding 6px 8px + `paddingLeft: 8 + indent*20`（行内样式），圆角 5px，font-mono 12px；
  hover var(--bg-hover)；active（本面板恒 false）var(--accent-glow)。
  - 图标 `.file-item__icon`（14px/18px 宽）：folder 收起 📁 / 展开 📂；文件按扩展名
    md→📝、json→⚙️、其余 📄。
  - 名 `.file-item__name`：var(--text-primary)；folder 行名色 var(--accent)。
  - 尺寸徽记 `.file-item__meta`（仅文件且 IPC 给了 size）：var(--text-muted) 10px；
    格式 `<1024→{n}B`、`<1MB→{x.1}KB`、否则 `{x.1}MB`（toFixed(1)）。
- 展开/折叠：点 folder 行懒加载 `readDir(folderPath)`，子项 indent+1 插入其后；
  折叠移除所有更深 indent 的后代并清掉后代展开态。失败静默（子项不出现）。
- 点文件行：埋点 + `onOpenFile(path, ext)` → 关本面板并 OPEN_TEMP_VIEW（App.tsx:313-317）。
- 右键：`fs.showFileMenu`（原生菜单，非视觉面）。anchor 坐标 = clientX/clientY 直入 flipped WKWebView
  坐标系（见 §0.5；dogfood-r4 修双翻镜像）。

## 4. fixture/复刻约定（B4）

- golden 侧：base 网格底图 + 直挂 FilePanel（projectCwd 来自 payload）；树数据走
  fixture.html `fs.readDir` 替身（dirs 字典，含 size 透传）；showHidden=on 走 getConfig
  替身（fileConfig.showHiddenFiles）；展开态由 FixtureDriver 按名点 folder 行（生产路径），
  全部展开完成后在 `.file-panel__content` 打 `data-fx-ready`（就位把关）。
- web 侧：纯 props 由 dirs 字典 + expanded 列表静态扁平化（同序同滤同 indent 公式）。
