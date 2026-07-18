# file-tabs-view（tab 式文件视图）行为规格 — v1.1（2026-07-15 增补 §2.5 终端状态灯）

> **全新设计，无老 app 参照**（核心原则一 #4：规格过目后才写代码）。替换老三栏 FileTempView
> （M2 静态屏 FileTempViewScreen + 8 golden 已退役，用户授权 2026-07-07，见 §8）。
> 需求来源：用户 2026-07-06 参考图 + 裁决 ⑥⑦（可编辑+⌘S+未保存确认；占满网格区/左树常驻/
> [终端 tab][文件 tab…✕]/回平铺全关/muxvo 整体风格）。
> ★D1/D2/D3 已于 2026-07-07 经用户裁决全部按推荐案定版（视图保持/汇总确认/mtime 冲突检测）；
> 次级默认（标 ▵）用户未点名异议，默认生效。规格自此可实施。

> **《实施勘误注记》（M6-B 实施与规格差异登记，批末裁决复核）**
> a) §5 ⌘S/⌘W 实作为 web `document` keydown 监听（LiveFileTabsView），**未加 native 菜单项 keyEquivalent**：
>    终端 tab 聚焦时 Cmd 系键焦点在 Metal 洞、web 收不到 → 两键为规格 no-op；文件 tab 聚焦时 web 持焦、
>    两键正常。native 菜单拦截对本视图无增益（不需 native 持 tab 状态机），暂不加（独立评估结论）。
> b) **来源终端被关 → 视图自动退出**（`fx.terminals` 查无 sourceTerminalId 即 dispatch exit，dirty 丢弃）：
>    §0 退出路径的补充语义，规格未覆盖，定版补齐。
> c) §6 冲突 resp 落地为复用既有 `rejected{code:'MTIME_CONFLICT'}`（不新增专用变体，消息数不变）；
>    「覆盖」= 重发 writeFile **不带 baseMtimeMs**（create-or-overwrite）。
> d) **右键菜单（dogfood-r4 问题1）接线补齐**：M6-B 实施时左树/内容区未挂 `onContextMenu`，右键无反应
>    （反馈问题1）。补齐见 §1/§3——左树行同 file-panel 路径发 `showFileMenu`，内容区对活跃文件发（textarea/
>    选区/终端 tab 豁免）。桥面零变更（复用既有 `showFileMenu`/`menuAction`）。同批修问题2：native 弹出坐标
>    双翻镜像（见 file-panel.md §0.5）。

## 0. 定位与进入/退出

- **进入**：文件面板（file-panel）点击**文件行** → 关闭面板 → 本视图接管**整个网格区**
  （其他终端 tile 不可见；面板/侧栏等 chrome 不变）。批A 的点文件 no-op 在此接活。
- **归属**：视图绑定打开它的终端（sourceTerminal = 面板归属 tile）；其 cwd 即左树 root。
- **退出**：「回到平铺」按钮（tab 栏最右，网格图标）/ **Esc**（无浮层态时）→ 关闭**全部**文件
  tab 回终端网格（裁决⑦）。存在 dirty tab 时见 §4。
- ▵ 退出后再次点文件重新进入 = 全新会话（不恢复上次 tab 集合；无持久化）。

## 1. 布局（占满网格区）

```
┌─────────────┬──────────────────────────────────────────┐
│  左树（250） │ [⌗ 终端] [file1.md ✕] [file2.ts ✕] [●●●][⊞] │ ← tab 栏
│  （常驻）    ├──────────────────────────────────────────┤
│             │                                          │
│             │           活跃 tab 内容区                 │
│             │                                          │
└─────────────┴──────────────────────────────────────────┘
```

- **左树常驻**：复用批A `useLiveFileTree` + `FilePanelView` 树段（同源排序/dot 过滤/懒加载/
  隐藏开关）；宽度沿用 `DEFAULT_FTV_LEFT_WIDTH`(250)；点文件行 = 开/聚焦 tab（§2）。
  当前活跃文件行高亮（`file-item--active` 同款）。
- **左树行右键**（dogfood-r4 问题1，与 file-panel §3 同路径）：`fs.request showFileMenu{path,
  isDirectory, x:clientX, y:clientY}` → native `复制路径 / 在 Finder 中打开 / 用默认应用打开`（folder
  无「用默认应用打开」项）。`e.preventDefault()` 抑制系统菜单；一个在途门（`menuPendingRef`）防连发
  重入（弹出期间二次右键忽略）。folder 行右键 `isDirectory:true`；文件行 `false`。
- **tab 栏**：首位恒**终端 tab**（⌗ 图标 + 终端名/cwd 末段，不可关）；其后文件 tab 按打开序
  尾插（文件名 + ✕）；退出钮左侧为**终端状态灯组**（§2.5，≥2 终端时常驻可见，不随 tab 横滚）；
  最右「回到平铺」按钮。tab 溢出横向滚动（▵ 不做多行/收纳菜单）。
- **内容区**：渲染活跃 tab——终端 tab = 来源终端真洞直渲（`.tile-term-hole`，task-center
  接管态先例：岛/洞并存）；文件 tab = 查看/编辑器（§3）。
- muxvo 整体风格：配色/圆角/描边全走 theme.css 既有变量（dark/light 双主题），tab 栏视觉
  基调对齐 tile-header（琥珀 accent、font-mono 文件名）。

## 2. tab 状态机

- **打开**：左树点文件 → 已开该 path → 聚焦既有 tab（按 path 去重）；未开 → 尾插新 tab 并聚焦。
- **切换**：点 tab 头。终端 tab 聚焦时：内容区显终端洞，键盘输入进 PTY（焦点交还终端 surface）；
  文件 tab 聚焦时：焦点在编辑器。
- **单关**：文件 tab ✕ → 该 tab dirty 则未保存确认（§4），否则直接关；关后聚焦右邻（无右邻聚焦左邻，
  再无 → 聚焦终端 tab）。
- **★D1（已裁决 2026-07-07：A案）关最后一个文件 tab = 视图保持**（只剩终端 tab，等继续点树；
  回平铺走显式按钮/Esc）。
- ▵ 文件被外部删除/改名：tab 保留显示内存内容，保存时报错提示（不做 fs watch）。
- tab 数上限 ▵ 不设（横向滚动兜底）。

## 2.5 终端状态灯与洞内显示切换（v1.1，2026-07-15 用户定稿方案 2）

> 动机：视图接管网格区后其他终端零感知。tab 栏退出钮左侧加常驻灯组：边看文件边感知各
> 终端状态，点灯把洞内显示的终端切换为任意终端；视图归属（owner）不变。

- **state 增 `displayedTerminalId`**：洞（`.tile-term-hole` 的 `data-term-id`）与终端 tab
  显示名跟随它；enter 初始 = sourceTerminalId。**owner（=sourceTerminalId）语义全部不变**：
  左树 root、文件读写、来源终端消失自动退出（勘误 b）、活跃文件高亮仍绑 owner；左栏头终端名
  也恒显 owner。
- **灯组**：位于 `.file-tabs-view__tabs` 与退出钮之间，恒可见不随 tab 横滚；每灯一终端，
  序 = `fx.terminals` 序 ▵；8px 圆点三色 = Running 绿（脉冲）/ WaitingInput 红（快脉冲）/
  其余灰（与 tile-header 状态点三桶同语义，statusKind）；**owner 灯琥珀外环恒在**（不随切换
  丢失）；**当前 displayed 灯下 2px 琥珀指示条**（与 tab active 指示同构）。owner 环与指示条
  是两个独立维度（displayed≠owner 时分落两灯）。
- **单终端（灯数 <2）灯组整体隐藏**（无可切对象）。▵ minimized 终端照常入灯组（会话在跑
  即可切显）。
- **悬停**：HoverTip（160ms 自绘）显「终端名 · 状态（· 文件所属）」；名 = customName ??
  cwd 末段（cardTitle 同源）；状态文案：运行中 / 等待输入 / 已停止（Stopped|Disconnected|
  Failed）/ 其余「空闲」▵。
- **点灯 = 复合意图 `showTerminal`**：displayedTerminalId 切换 + activeId 自动置终端 tab
  （文件 tab 活跃时点灯即跳终端 tab）；dialog 模态期屏蔽（activate 同门）；同 id 且终端 tab
  已活跃 = no-op（引用相等）。
- **displayed 终端消失**（fx.terminals 查无且 ≠ owner）→ Live 归位 owner（`setDisplayed`：
  只改 displayed，不动 activeId 不夺焦、不受 dialog 屏蔽——模态期终端可死，state 须能修正）；
  **owner 消失 → 整体退出**（勘误 b，优先于归位）。
- 实现约束：洞 div 以 displayedTerminalId 为 key **强制重挂**（layoutReport 的
  MutationObserver 只观察 childList，属性级 data-term-id 变更零上报）；native applyLayout
  纯 rect 驱动 attach/detach，**零协议零 Swift**。已知代价 ▵：①切显对目标会话 PTY resize
  一次（grid 洞 drivesSessionResize 既有行为）；②key 重挂后的新洞元素在下次 fx 推送前不被
  ResizeObserver 观察（本视图洞几何仅随窗口变，window resize 监听兜底）。

## 3. 文件内容渲染与编辑（裁决⑥：可编辑 + ⌘S）

| 类型 | 渲染 | 可编辑 |
|---|---|---|
| markdown | 只读真渲染（dogfood-r3 问题7 改版）：live = 共享渲染核 `markdown/md-view`（markdown-it+hljs+mermaid+GFM 任务列表+复制钮+**锚点点击拦截**防主 frame 导航+首部 frontmatter→```yaml 围栏），`.markdown-view` 容器 Penraft 风排版（markdown-view.css，token 映射 theme.css）；golden/截图静态 fallback = md-static + `.markdown-wysiwyg .tiptap`（逐字节冻结不动，chat static/live 双渲染器同款工艺——MarkdownBody `renderMd?` prop 由 LiveFileTabsView 动态 import 注入，缺省走 fallback）。原「升级为真 tiptap WYSIWYG 编辑」诉求继续后批 ▵ | Source 模式 textarea 可编辑；⌘/ 切换 WYSIWYG/Source（老快捷键沿用） |
| code / text | 带行号只读视图（参考图样式）→ 编辑 = textarea + 行号列 | ✅ |
| image | data-URI 预览 | ❌ |
| spreadsheet | SheetJS 表格（复用 SheetBody，抽独立文件） | ❌ |
| pdf | 预览（pdfjs；错误态兜底） | ❌ |

- **⌘S**：活跃 tab dirty → `fs.request writeFile` 落盘 → 清 dirty。非 dirty no-op。
- **dirty 标记**：tab 头文件名前圆点（unsaved-prompt 同款琥珀点）+ 内容区文件名同步。
- **★D3（已裁决 2026-07-07：A案）外部变更冲突 = 保存时 mtime 比对**，变了弹「文件已被外部修改：
  覆盖/放弃」（编排 agent 并行改文件是 muxvo 常态场景，盲覆盖风险真实）。
- 编辑器为受控 textarea（批B 不引编辑器库；语法高亮/补全非目标）。
- **内容区右键**（dogfood-r4 问题1，`.file-tabs-view__content` 挂 `onContextMenu`）：对**活跃文件 tab**
  的 path 发 `showFileMenu{isDirectory:false, x:clientX, y:clientY}`（与左树共享同一在途门）。守卫放行序
  （命中即 return **不** `preventDefault`，保系统菜单）：① 活跃 = 终端 tab 或无活跃 tab（洞区由 native 洞后
  合成，web 不接管）；② 右键落在 `textarea/input` 内（保系统剪切/复制/粘贴）；③ 存在非空文本选区（保系统
  复制）。三者皆不命中才接管。tab 头右键 ▵ 后议（本批不做）。

## 4. 未保存确认

- **单关 dirty tab**：三键对话框「保存 / 丢弃 / 取消」（复用 unsaved-prompt DOM+CSS）。
- **★D2（已裁决 2026-07-07：A案）退出（回平铺/Esc）时多个 dirty tab = 一次汇总对话框**（列出
  N 个未保存文件：全部保存 / 全部丢弃 / 取消）。
- Esc 优先级：有确认对话框 → 关对话框（=取消）；无对话框 → 退出视图（§0）。

## 5. 快捷键面（▵ 默认，可增删）

| 键 | 行为 |
|---|---|
| ⌘S | 保存活跃文件 tab |
| Esc | 见 §4 优先级；最终=退出视图 |
| ⌘W | ▵ 关活跃文件 tab（终端 tab 聚焦时不响应，避免误关） |
| ⌘/ | markdown WYSIWYG/Source 切换 |
| ⌃Tab / ⌃⇧Tab | ▵ 批B 不做（tab 轮换后批） |

- 键拦截层级：视图挂载期 web 持焦（除终端 tab 聚焦时键入 PTY）；⌘S/⌘W 由 native 菜单
  keyEquivalent 拦（Cmd 系键焦点在 Metal 洞时 web 收不到——批A ⌘E 同理），Esc web 侧 capture。

## 6. 桥面（v_next，一次 bump）

- `fs.request` += `readFile{path}` / `writeFile{path, content}`（payload 级变体，消息数不变）；
  resp += `fileContent{content, truncated?}` / `fileWritten` ；超大文件（▵ >2MB）truncated 只读。
  二进制（image/pdf/xlsx）readFile 回 base64（▵ 变体带 encoding 标记）。
- **视图开关态 ▵ web 本地**（closeConfirm 范式）：无全局键需要 native 拥有（⌘S/⌘W 是 native
  菜单拦但可转发 event 给 web 处理，不需要 native 持 tab 状态机）。若后续要「⌘E 在视图内也
  开关面板」再议。
- 终端 tab 的洞渲染走既有 layoutReport（岛/洞并存 task-center 先例），无新协议。

## 7. 与既有件关系（复用清单）

- 复用：`useLiveFileTree`/`FilePanelView`（左树）、`file-tree-static.ts`、`EyeIcons`、
  `md-static.tsx`（md 只读渲染的 **golden 静态 fallback**；live 真渲染 = `markdown/md-view` 共享核，
  dogfood-r3 问题7，见 §3 markdown 行）、`SheetBody`（先从 FileTempViewScreen 抽独立文件）、
  `unsaved-prompt-dialog` DOM+CSS、`DEFAULT_FTV_LEFT_WIDTH`。
- 待退役（★须用户授权后动，批B 实施时一并）：`FileTempViewScreen.tsx` + specs/screens.json
  `file-temp-view` 条目 + golden 6 张（ftv-md/ftv-md-dirty/ftv-code/ftv-sheet/ftv-unsaved/
  ftv-light）+ hard-substitute 2 张（ftv-image-sub/ftv-pdf-sub）+ fixtures；挂靠 spec
  FILE_L1_09/10/11 迁移至新屏或 status.json 注记。

## 8. 视觉回归面（screens.json 新条目建议）

- 新屏 id `file-tabs-view`，golden **3 张**（少而准，即截即 commit + 用户巡检冻结）：
  ① 双文件 tab + md 活跃满载（dark）② dirty 点 + 退出汇总确认对话框态 ③ light 代表作
  （接棒 ftv-light 的 light 簇职责）。
- 其余全 dom-assert：tab 去重聚焦 / 单关聚焦迁移 / 终端 tab 洞结构 / ⌘S 清 dirty / D1 语义 /
  Esc 链 / 溢出滚动。
- v1.1 灯组入镜：ftabs-md-dark / ftabs-light 两 fixture 加多终端（三灯集齐三色 + owner 环 +
  指示条，md-dark 冻 displayed≠owner 分离态）重冻（用户巡检）；**ftabs-dirty-exit 保持单终端
  零字节**（把「单终端隐藏灯组 + props 可选 inert 工艺」冻进视觉回归）。

## 9. 测试面（概要）

- vitest：tab 状态机 reducer 纯函数直测（开/去重/关/聚焦迁移/dirty 集合）+ dom-assert
  （上表交互态）+ ⌘S/writeFile 载荷断言 + D2/D3 对话框路径。
- vitest 右键（dogfood-r4 问题1，`file-tabs-live.dom-assert` ⑪–⑭，每例 contextmenu 前先 mousedown 前奏）：
  左树文件行右键→唯一 `showFileMenu{isDirectory:false,x,y}`+pending 防重入+`defaultPrevented`；文件夹行
  →`isDirectory:true`；图片 tab 内容区 img 右键→活跃文件路径；文本 tab textarea 右键→零 `showFileMenu` 且
  未 `preventDefault`。
- e2e：进入视图（真 readDir/readFile）→ 编辑 → ⌘S 落盘（真 FS 验内容）→ 退出全关；item31 尾追加左树行右键
  （合成 mousedown+contextmenu 带已知 clientX/clientY → fs 往返 native 记录 anchor 断言，harness 以记录闭包
  替真 popUpFileMenu 避嵌套 runloop 挂死）。
- spec↔test：FILE_L1_09/10/11 终裁归属随退役迁移一并处理（status.json 登记）。
- vitest 灯组（v1.1，描述性命名不进 spec-runner）：reducer（enter 默认=source / showTerminal
  复合+模态屏蔽+同态 no-op 引用相等 / setDisplayed 正交+模态放行 / exit 重置 / activate 不改
  displayed）；dom-assert（三灯三色 / owner·current 类含分离态 / 单灯与缺省隐藏 / inert /
  洞 data-term-id 传参与缺省双分支 / tab 名跟随 displayed 而左栏头留 owner / title 锚含
  「文件所属」）；live（点灯洞切换 + **layoutReport rects 含新 id**（锁 key 重挂机制）/
  displayed 消失归位不夺焦 / owner 消失整体退出回归 / 单终端灯缺席 / 模态点灯洞不变）。
- e2e 灯组：双终端点灯切洞（断 data-term-id / 终端 tab active / --current / tab 名跟随）+
  连点回切冒烟（attach/detach 与 PTY resize 不挂死）+ owner 灯回切。
