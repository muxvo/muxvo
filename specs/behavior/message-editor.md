# 行为规格：消息编辑器（TipTap 输入 / 草稿 / 附件 / 发送方言 / 形态切换）

> ⚠️ **已退役（2026-07-08，用户裁决）**：终端下方的 TipTap 富文本输入框（composer）整体删除 —— CC TUI
> 自带输入框归子进程不可替换重绘，斜杠补全/↑↓历史本就是 CC TUI 自带，我们叠加的第二输入框冗余。已删：
> `web/src/editor/`（12 文件）+ `web/src/styles/editor.css` + TermTile 编辑器区双门控/挂载 + fixture
> `editors`/`EditorFixture` + client 的 `sendInput`/`sendControl`/`writeTempImage` 包装；协议删
> `TermCommandRequest.{sendInput,sendControl}` + `TermCommandResponse.sent` + `FsRequest`/`FsResponse` 图片两变体
> + 类型 `AttachmentRef`/`AttachmentKind`/`ControlKey`（协议 v19）；native 删 `EditorSendPayload.swift` /
> `FsImageService.swift` / `TerminalService.executeSend`；6 张 me-* golden + EDITOR_L1_01–07（→ not-applicable）
> + e2e item18/19 一并退役。**保留**：TipTap 依赖（markdown/file-tabs/chat 共用）、`insertText` 拖拽入终端链、
> altScreen 原生信号。**本文件保留作历史行为说明书**（方言组包/附件策略等语义留档）。

> **本规格为「结局 A」：legacy 从未把编辑器 UI 装进 tile**（§11 存疑点①代码考古定谳）——编辑器是**依 PRD 首次实现的新增 UI**。
> 权威序（高→低）：硬验收 `specs/legacy/l1/editor.spec.json`（EDITOR_L1_01–08）→ PRD `muxvo-legacy/muxvo-rs-kickoff/prd/modules/{M05_EDITOR_INPUT,M06_EDITOR_ATTACH,M07_EDITOR_SEND}.md`（30+30+23=83 REQ）→ 旧测试工件层 machine/util（**只提炼行为，禁抄结构**；亲验点标注文件行号）。
> 技术栈已裁决：新版用 **TipTap**（EDITOR_L1_08 contenteditable div → **n/a**）；TipTap 已在仓库（`web/package.json` @tiptap/* 3.27.2），**必须走 `React.lazy(() => import())` 懒加载**（golden 铁律，`web/src/markdown/TiptapEditor.tsx` 先例）。
> 状态：**v1-draft**（2026-07-06 批2 规格先行；实现 agent 以本规格为唯一蓝本）。裁决点 ★=用户 ☆=独立 agent/代码证据。
> target：`web`（TipTap 编辑器 + 草稿/附件 UI + 键路由）+ `Swift`（方言组包 + NSPasteboard + PTY write + alt-screen 检测），语义消息过桥、**终端字节流永不过桥**。

## 0. 范围 · 权威 · 红线

- **写什么发什么**：编辑器只产**语义消息**（`{terminalId, text, attachments}` / 控制键），**方言字节（`\r`/`\n`/`\x1b\r`/`\x16`/`\x03`）一律在 Swift 组包**（EDITOR_L1_01–05 测缝在 Swift 侧逐字节 spy）。web 绝不拼终端字节。
- **发送走 `term.command` 变体**（`input`/`control`），**图片持久化走 `fs.request`**（`writeTempImage`），**终端输出/回显不经本模块**（属 M01，桥无任何终端输出消息——病根不回潮，terminal-input.md §0 红线沿用）。
- **控制面纪律（核心原则二）**：本模块全是「人眼交互」输入，不涉编排控制面。
- **golden 铁律**：编辑器区渲染 = `live || fx.editors` 双门控（§9）；M2 冻结的 **21 张 terminal-grid golden 逐字节不变**为回归硬门。

**硬验收表（EDITOR_L1_01–08）**

| ID | 断言 | 承接节 | owner | 翻牌 |
|---|---|---|---|---|
| EDITOR_L1_01 | input `"hello"` → `pty.write("hello\r")` | §6 §8 | swift | implemented |
| EDITOR_L1_02 | CC 多行 → `pty.write("line1\x1b\rline2\r")` | §6 §8 | swift | implemented |
| EDITOR_L1_03 | shell 多行 → `pty.write("line1\nline2\n")` | §6 §8 | swift | implemented |
| EDITOR_L1_04 | 粘贴图片存 `/tmp/muxvo-images/{uuid}.png` | §7 §8 | swift | implemented |
| EDITOR_L1_05 | CC 图片 → 写剪贴板 → `pty.write("\x16")` | §7 §8 | swift | implemented |
| EDITOR_L1_06 | 默认 `editor.mode == RichEditor` | §1 | web(default) | implemented |
| EDITOR_L1_07 | 默认 sendKey `{send:[Enter,Cmd+Enter], newline:Shift+Enter}` | §2 §6 | web(default) | implemented |
| EDITOR_L1_08 | ~~contenteditable div~~ | §0 | — | **n/a**（TipTap 取代） |

## 1. 形态状态机（RichEditor / RawTerminal）

> REQ-EDITOR_INPUT-002/016/017/018/019/030 · REQ-EDITOR_ATTACH-030 · EDITOR_L1_06

- **两态**（亲验 `editor-machine.ts` / `editor-mode.ts`）：`RichEditor`（默认，编辑器可见、键盘作用于编辑器、Ctrl+C/Z/D 穿透）↔ `RawTerminal`（编辑器收起、键盘直达终端、无穿透规则）。**默认 `RichEditor`**（EDITOR_L1_06）。
- **alt-screen 边沿自动切换**：终端进 alt screen（备用屏缓冲）→ `RichEditor→RawTerminal`（编辑器淡出）；退出 → `RawTerminal→RichEditor`（淡入，草稿保留）。
  - ☆ **只认 alt-screen 信号**（§11③）：legacy machine 硬编码 `\x1b[?1049h`（进）/`\x1b[?1049l`（退），不认其他 DEC 私有模式。新架构**不 web 侧扫字节**——由 Swift 查 vt `GHOSTTY_TERMINAL_DATA_ACTIVE_SCREEN == alternate`（权威，terminal-rendering.md），经 `ui.state.terminals[].altScreen` 边沿推给 web（§8）。web 零状态机：`altScreen==true` 即渲 RawTerminal 形态。
- **手动切换**（REQ-019）：编辑器区「收起/展开输入框」控件 → 翻转 **web 本地 per-terminal `manualHidden` 态**（§8 协调裁决 a0d6316：不过桥，LiveChrome 面板开关同类先例；洞几何变化经 `layoutReport` 自动上报，native 无需知情）。**alt-screen 期手动「展开」不生效**（PRD §10：让位终端）。
- **150ms 淡入淡出动画**（REQ-030）：形态切换过渡 150ms；**动画中间帧不入 golden**（golden 只截稳态，§9）。

## 2. 输入编辑核心

> REQ-EDITOR_INPUT-003/004/005/006/007/009/010/011/026/027/028/029 · REQ-SEND-003/018/020 · EDITOR_L1_07

| 键 | 作用 | 前置 |
|---|---|---|
| Enter | 发送（§6） | 编辑器可见+有焦点+非空/有附件+未 sending |
| Cmd+Enter | 发送（等效 Enter） | 同上 |
| Shift+Enter | 光标处换行，不发送 | 有焦点 |
| ⌘Z / ⌘⇧Z(⌘Y) | 撤销/重做，每终端隔离，≤200 步 | 有撤销历史 |
| ⌘A | 全选编辑器内容 | 有焦点 |
| ⌘C | 复制选中 → 系统剪贴板 | 有选中 |
| ⌘V | 粘贴（图片→§7；文本→纯文本降级） | 有焦点 |
| Esc / ↑↓ | Esc 无操作；↑↓ 仅光标移动（不调发送历史，REQ-SEND-020） | 有焦点 |

- **默认 sendKey（EDITOR_L1_07）**：`send=[Enter, Cmd+Enter]`、`newline=Shift+Enter`（亲验 `editor-key-handler.ts`：Shift+Enter→newline；Enter 无 ctrl/shift→submit）。
- **粘贴降级纯文本**（REQ-007）：外部富文本粘贴保留换行/空格但**剥样式**（PRD §9 不支持富文本；TipTap 配 `StarterKit` 但禁 bold/italic 等 mark，或粘贴钩子取 `text/plain`）。
- **多行生长与滚动**（REQ-006/026）：下限约 2 行，默认上限约 12 行，超上限内部滚动（不撑破 tile）；tile 高压缩到 <2 行 → 退化为单行横滚条（PRD §9）。
- **字数胶囊**（REQ-027）：内容超软上限（约 1 万字或 500 行）→ 右下角灰色胶囊「N 行 · N K 字」，实时更新；超硬上限颜色转浅橙。**发送/清空即消失**。
- **IME 组字守卫**（§11⑥）：☆ 组字期间（`compositionstart`→`compositionend`，TipTap/DOM `isComposing`）**Enter 只确认候选、不触发发送**——沿用 terminal-input.md §2 composing 抑制语义（web 侧）。夺焦时 `discardMarkedText` 清 preedit（同 terminal-input.md §7）。

## 3. 草稿模型（每终端隔离）

> REQ-EDITOR_INPUT-011/012/013/014/015 · REQ-ATTACH-024

- **隔离单元 = 终端**：每终端独立 `{content, cursor, selection, undoStack, attachments}`。终端 A 的草稿/撤销栈不影响 B（REQ-011）。多窗口各自管（PRD §8.4）。
- **切终端保留**（REQ-012）：切走记下当前终端草稿+光标+滚动位；切回原样恢复，无「空一瞬又出现」的闪烁（切回瞬间内容即在）。
- **关终端清**（REQ-013/014 · REQ-ATTACH-024）：终端关闭 → 该终端草稿+附件同步销毁，不遗留给新建终端。关闭有草稿的终端时二次确认对话框正文追加「未发送草稿将丢弃」（M01 close-confirm-dialog.md 承接）。
- **发送清**（REQ-013）：发送成功 → content+attachments 清空回空态（§6）。
- **重启恢复**（REQ-015，**P1 deferred**）：⚑ 当前终端草稿跨重启恢复属 P1，**本批不实现**（依赖 M01 终端恢复 REQ-026）；标注 deferred，草稿常驻内存即可，落盘恢复后续批次。

## 4. 焦点模型

> REQ-EDITOR_INPUT-024/025 · REQ-SEND-021

- **默认焦点在编辑器**（REQ-024）：新建/切到终端（RichEditor 形态）→ 键盘默认作用于编辑器；编辑器边框淡色高亮，终端主区光标暗色 hollow。
- **点终端主区转移焦点**（REQ-025）：点终端洞区 → 焦点交终端本体（native `makeFirstResponder(surface)`，DOGFOOD_M3_06 先例，terminal-input.md §7）；编辑器边框转灰。点回编辑区 → 焦点回编辑器。
- **发送后焦点保留**（REQ-SEND-021）：发送成功后光标留在编辑器，可直接接着敲。
- **native/web 焦点协同**：编辑器可见+应聚焦 → WKWebView 为 key、web focus 编辑器 DOM；收起（RawTerminal）→ native 令 surface 为 firstResponder。tile 选中/新建 → focus 该终端编辑器。

## 5. 控制键穿透（Ctrl 无 Cmd）

> REQ-EDITOR_INPUT-012/013/020/021/022/023

| 键 | 穿透字节 | 说明 |
|---|---|---|
| Ctrl+C | `\x03` | 打断当前任务；草稿**不动**（`preserveContent`） |
| Ctrl+Z | `\x1a` | 挂起当前任务；草稿不动 |
| Ctrl+D | `\x04` | 发送 EOF；草稿不动 |

- 亲验 `editor-key-handler.ts`：三键 `action:'passthrough'` + 对应 ptySignal，`clearEditor:false`。**只在无 Cmd 时穿透**（macOS ⌘Z 走编辑器撤销，Ctrl+Z 才穿透——PRD §8.3 明列）。
- 键发生在 web 编辑器（WKWebView 有焦点）→ web 拦截 → `term.command{kind:'control',terminalId,key}`（§8）→ Swift 映射字节 write PTY。**穿透后草稿原样留存**（REQ-023）。
- ⚑ **Ctrl+C 与「取消加载中附件」优先级**（REQ-ATTACH-023 · §7）：有加载中附件时 Ctrl+C **优先取消该附件**、不穿透；无加载中附件才穿透终端（PRD M06 §11 倾向此裁；default 采此，§11 dogfood 复核）。

## 6. 发送协议 + 状态机

> REQ-EDITOR_INPUT-003/008 · REQ-SEND-001~023 全 · EDITOR_L1_01/02/03/07

**方言字节表（Swift 组包，逐字节即 EDITOR_L1_01–03；亲验 `text-forwarder.ts`）**

| 前台 | 单行 | 多行 | 空文本 |
|---|---|---|---|
| **CC**（`isClaudeCode`，§11②名单） | `text + "\r"` | `lines.join("\x1b\r") + "\r"` | 不发（`shouldSend:false`） |
| **其他**（Codex/Gemini/shell/bash/zsh…） | `text + "\n"` | `text + "\n"`（内嵌 `\n` 原样保留） | 不发 |

- ⚑ **仅 Claude Code 走 ESC+CR 多行方言**（legacy 权威）：Codex/Gemini 亦归「其他」= `\n` 方言（§11⑤ dogfood 复核 Codex 是否需 CC 待遇；default 遵 legacy）。
- **空/仅附件**（REQ-SEND-004/005/011）：无字符无附件 → Enter 什么都不发生（不闪不弹）；仅附件无文本 → 可发（图片单发，§7）。

**发送状态机（REQ-SEND-006~019，亲验 `rich-editor.ts` Idle/Composing/Sending）**

```
idle ──Enter(非空/有附件)──▶ sending ──ok────▶ idle（清空+空态占位，静默无 toast REQ-023）
                              │  ├─>400ms──▶ 显式发送中：边框暗化+内容半透明+锁定(REQ-015/016)
                              │  ├─10s 超时─▶ failed「发送超时」
                              │  └─fail─────▶ failed（内容保留+下方红条+Enter 重试 REQ-008/009/010）
failed ──Enter──▶ sending（重试）  failed 连续 3 次 ──▶ 红条右端追加「复制内容」链接（成功一次归零）
failed ──删空全部内容──▶ idle（红条消失）
```

- **发送中锁定**（REQ-016）：sending 期 Enter 不再触发新发送；可 Ctrl+C 穿透。>400ms 才显式视觉（避免频闪）。
- **图片未就绪延迟**（REQ-SEND-013）：有加载中附件时 Enter → 进 sending 视觉、**不提前清空**，等附件就绪(≤2s)自动发；超 2s → failed「图片保存超时，请移除后重新粘贴」。
- **50 万字硬上限确认**（REQ-SEND-014 · REQ-INPUT-027）：超硬上限 Enter → 居中确认框「输入非常长…确定继续？」「继续发送/取消」；继续→发送，取消→内容不动。
- **失败原因文案**（REQ-SEND-017）：终端未就绪 / 对方未响应 / 图片超时 / 内容过大，各异（PRD §9 文案表照录）。
- **Esc 无操作、↑↓ 仅光标、无发送历史上下翻、无取消发送按钮、成功不 toast**（REQ-SEND-018/020/022/023）。

## 7. 附件（粘贴 / 拖入 / 加号）

> REQ-EDITOR_ATTACH-001~030 全 · REQ-SEND-010/013 · EDITOR_L1_04/05

- **两入口**（REQ-ATTACH-001/002/003）：Cmd+V 粘贴剪贴板图 / 访达拖入（图片或非图文件）。拖入悬停 → 编辑器琥珀色描边 +「松开以添加附件」；拖出编辑器外松手 → 不添加（REQ-006/007）。
  - ⚑ **REQ-ATTACH-004（编辑器左下角「+」开系统文件窗）**：【用户裁决 2026-07-07 移除】——左下角「+」与右下角新建终端 FAB（同为「+」橙球）视觉混淆，删除该入口；图片入口仅保留粘贴 + 拖拽。REQ-ATTACH-003 的拖入入口随之收窄为「仅拖拽」（无文件窗兜底）。
- **校验**（REQ-013/014/015，亲验 `image-sender.ts::validateImage`）：单图 ≤ **5 MB**；格式 ∈ **{PNG, JPG, GIF}**（其他一律拒）；每条消息 ≤ **5 个**附件。web 先行校验（数量+即时错误条），Swift `writeTempImage` 侧**权威复校** size+format（返 rejected code，防御）。
- **五态**（REQ-008/009/010/016）：加载中（灰方块转圈）→ 成功（**固定尺寸约 120×90 缩略图**，圆角细边）/ 失败（红块+感叹号，hover「读取失败，请重试」，点击移除）。超限/格式拒 = 不入附件区、底部红条提示（REQ-010/011）。
- **持久化路径**（EDITOR_L1_04）：粘贴/拖入图 → web 取 base64 → `fs.request{kind:'writeTempImage',imageData,format}`（§8）→ Swift 写 **`/tmp/muxvo-images/{uuid}.{ext}`**（§11④ 按 spec 字面，非 os.tmpdir）→ 返 filePath。web 缩略图用本地 blob 即时渲，filePath 供发送。
- **发送方言**（EDITOR_L1_05，亲验 `image-sender.ts::buildImagePayload`）：

| 前台 | 剪贴板可用 | 策略 | 动作 |
|---|---|---|---|
| CC | 是 | clipboard | Swift 载 filePath 图 → 写 NSPasteboard（**同步写完**）→ `pty.write("\x16")` |
| CC | 否 | filepath | filePath 随文本发（拼进文本 payload） |
| 其他 | — | filepath | filePath 随文本发 |

- ⚑ **多图 \x16 间隔 + 剪贴板覆盖副作用**（§11 dogfood）：default = 附件先于文本发；CC clipboard 逐图「写 NSPasteboard→\x16→await 短 drain→下一图」；末图后**恢复原剪贴板内容**（缓解覆盖用户剪贴板）。
- **交互细节**：hover 缩略图右上角圆形 × → 点击移除、其余左补位、编辑器文字保留（REQ-006/019/020）；多附件横向排列超行换行（REQ-021/022）；错误条固定位置数秒淡出（REQ-025/026）；删最后一个回纯文本、附件区不占位（REQ-027/029）；加载中不计入「可发送」（REQ-028，见 §6 延迟）；Ctrl+C 取消加载中附件（REQ-023，见 §5⚑）；进 RawTerminal 附件区同步隐藏、数据保留（REQ-030 · §1）。发送后附件区清空（REQ-024 · §3）。附件仅内存，不跨重启（PRD §9）。

## 8. 桥与分层契约

> 协议增补由实现 agent codegen（bridge/protocol.json，批2 协议 bump）；本节定语义蓝本。EDITOR_L1_01–05 测缝全在 Swift。

- **`term.command` 新增 `input` 变体**（web→native request）：`{ kind:'input', terminalId, text, attachments?: [{ filePath, isImage, name? }] }`。native 落点：查前台进程名（复用 `ForegroundProbe.processName`，§11②）→ 判 `isClaudeCode` → `buildTextPayload` 组文本方言（EDITOR_L1_01–03）→ 逐附件 `buildImagePayload`（CC 剪贴板：**先同步写 NSPasteboard 再 `\x16`**；否则拼 filePath）→ write PTY。web 客户端 helper 名 `sendInput`。
- **`term.command` 新增 `control` 变体**：`{ kind:'control', terminalId, key:'c'|'z'|'d' }` → native 映射 `\x03`/`\x1a`/`\x04` write PTY（§5）。helper 名 `sendControl`。
- **`fs.request` 转 active（现 stub）**：`{ kind:'writeTempImage', imageData(base64), format }` → resp `{ kind:'wroteTempImage', filePath }` | `{ kind:'rejected', code, message }`（size/format 复校，EDITOR_L1_04）。CC 剪贴板写+`\x16` 折进 `term.command input` native 处理（保证顺序），不单列 fs 通道。
- **`ui.state` 增 `altScreen`**（native→web push）：`TerminalSnapshot.altScreen?: boolean` per-terminal，native 由 vt active-screen 边沿驱动（§1）。web 据此渲 RichEditor/RawTerminal 形态。
- **手动收起/展开不过桥**【协调裁决 2026-07-06】：`manualHidden` 为 web 本地 per-terminal UI 态（LiveChrome 面板开关同类先例——纯 web 态不走 ui.action）；洞几何变化经 layoutReport 自动上报，native 无需知情。若后续原生菜单/e2e 驱动需要再补 ui.action 变体（kind 扩展不占消息名额）。
- **红线**：web 发送的 `text`/`attachments` 为**语义原文**，方言字节零出现在 web 侧；桥消息数 ≤15 条硬闸——本批净增变体在既有 `term.command`/`fs.request`/`ui.state`/`ui.action` 域内扩 kind，**不新增顶层消息类型**（不撞 15 条闸）。

## 9. 视觉与 golden 纪律

> M2 冻结 64 golden；本模块回归门 = 21 张 terminal-grid golden 逐字节不变。

- **双门控铁律**：编辑器区渲染 = `live || fx.editors`。**引 TermTile `stopping` 先例**（`TermTile.tsx:41-43` `const stopping = !!live && ...`；截图/纯 fixture 恒 false → golden 不变）。21 张 grid golden 无 live provider、无 `fx.editors` → **编辑器不渲染 → 逐字节不变**（回归门）。
- **TipTap 懒加载铁律**：编辑器 TipTap 只经 `React.lazy(() => import())`（`web/src/markdown/TiptapEditor.tsx` 先例）→ Vite 切独立 chunk，**绝不进初始/截图 bundle**（否则截图 DOM 漂移、golden 破）。
- **新增屏 `message-editor` 6 态清单**（新 golden，`fx.editors` 门控；即截即 commit、严禁重生成已有 golden）：`empty`（空态占位）/ `draft-long`（多行+字数胶囊）/ `attach`（缩略图+×）/ `sending`（边框暗化+半透明）/ `failed`（红条+重试）/ `light`（浅色主题代表作）。清单入 `specs/screens.json` `message-editor` 簇（授权后新增，遵 fixtures 契约按屏拆 `fixtures/screens/`）。
- **浮层盖洞挂岛**：编辑器区（及描边/错误条/确认框）盖在终端洞上 → **必挂 `data-hit-island=""`**（DOGFOOD_M3_04 岛机制，`TermTile.tsx:87`/`LiveSearchBar.tsx:110` 先例）令 native 从穿透区抠掉、点击拦回 web；否则点击被下层 surface 吞。

## 10. 测试与翻牌口径

| spec ID | 承接 | 断言 | owner | 翻牌 |
|---|---|---|---|---|
| EDITOR_L1_01 | §6 §8 | Swift spy：input `"hello"` → `pty.write("hello\r")` 逐字节 | swift | implemented |
| EDITOR_L1_02 | §6 §8 | Swift spy：CC 多行 → `"line1\x1b\rline2\r"` | swift | implemented |
| EDITOR_L1_03 | §6 §8 | Swift spy：shell 多行 → `"line1\nline2\n"` | swift | implemented |
| EDITOR_L1_04 | §7 §8 | Swift：writeTempImage → path `/tmp/muxvo-images/*.png` | swift | implemented |
| EDITOR_L1_05 | §7 §8 | Swift：CC 图 → NSPasteboard 写 → `pty.write("\x16")` | swift | implemented |
| EDITOR_L1_06 | §1 | web default `editor.mode == 'RichEditor'` | web | implemented |
| EDITOR_L1_07 | §2 §6 | web default sendKey `{send:[Enter,Cmd+Enter],newline:Shift+Enter}` | web | implemented |
| EDITOR_L1_08 | §0 | — | — | **n/a 维持**（TipTap） |

- Swift 侧 01–05 用 PTY-write spy + NSPasteboard spy 逐字节/逐调用断言（不起真 CC）。web 侧 06–07 走 defaults 快照；DOM 行为（换行/撤销/字数胶囊/附件五态）走 vitest DOM 断言（非 golden）。
- **spec↔test 1:1**：EDITOR 桶 8 case 全落测（08 n/a 亦登记）；总数维持 176（EDITOR 已在册，本批只落实现+新增 web DOM 测，不改 .spec.json case 数）。

## 11. 存疑点与裁决记录

**① 默认可见性【终裁 ☆ 代码证据定谳，未开老 app】**
`grep -riE 'contenteditable|RichEditor' muxvo-legacy/src/renderer/` 仅命中 `stores/editor-mode-ui-map.ts`（纯 mode→UI 映射函数）+ `components/editor/editor-config.ts`（全仓零引用孤儿）；`<textarea>` 命中全是**别的面板**（Skills/FileTempView/Markdown/Hooks/Mcp），**无一在终端 tile**；`TerminalTile.tsx` 零编辑器引用。→ **结局 A 成立**：编辑器 = 依 PRD 首次实现新增 UI，行为权威 = PRD REQ + 冻结 spec，**live 默认可见 `RichEditor`**（REQ-EDITOR_INPUT-002 + EDITOR_L1_06），**无 legacy 像素参照**。故本批 golden 为全新 6 态（§9），不比对老 app。

**② CC 前台进程名单【裁 ☆ 本机实测】**
`ps -Ao comm=` 实测：真 `claude` CLI（`which claude`=`~/.local/bin/claude`）comm = **`claude`**；Codex CLI comm=`codex`、Gemini=`node`/`gemini`。legacy `isClaudeCode` 只认 `claude-code`/`claude code`（`text-forwarder.ts:16-18`）——与真实 comm `claude` **不符**，且 L1 fixture 传 `"Claude Code"`（EDITOR_L1_02）。→ 裁定 Swift `isClaudeCodeNames` **可配常量集**，初值（小写比较）= **`{"claude", "claude-code", "claude code"}`**（覆盖真 comm + L1 fixture）。Codex/Gemini **故意不入集**（legacy 归「其他」`\n` 方言 + filepath 图片）。复用既有 `ForegroundProbe.processName`（`app/Sources/MuxvoTerm/Wait/ForegroundProbe.swift`）取前台名。

**③ alt-screen 只认 `\x1b[?1049h/l`【裁 ☆ legacy 亲验】** — legacy machine 硬编码此 CSI；新架构 Swift 查 vt `ACTIVE_SCREEN==alternate` 边沿推 `ui.state.altScreen`，web 不扫字节。default 定；无待复核。

**④ tmp 路径 `/tmp/muxvo-images/`【裁 ☆ spec 字面优先】** — EDITOR_L1_04 断言 `/tmp/muxvo-images/{uuid}.png`；legacy 实为 `os.tmpdir()`（macOS = `/var/folders/…`）。spec（硬验收）权威 > 旧代码 → Swift 写**字面 `/tmp/muxvo-images/`**。default 定。

**⑤ 非 CC 多行方言 + filepath 拼接格式【批2 dogfood 实测回写】** — default：Codex/Gemini 遵 legacy 归「其他」`\n`（不给 CC 的 ESC+CR）；filepath 策略下图片路径与文本拼接顺序/分隔（default：附件路径在前、空格分隔、随文本一并 `\n` 发）。dogfood 真跑 Codex/Gemini 复核是否需调整。

**⑥ IME 组字守卫【裁 ☆ 沿用 terminal-input.md §2】** — 组字期 Enter 只确认候选不发送（web `isComposing`）；default 开。dogfood 复核中文/日文输入法。

**⑦ 多图 \x16 间隔 / 剪贴板覆盖副作用【批2 dogfood 实测回写】** — default：逐图写 NSPasteboard→`\x16`→await 短 drain；末图后恢复原剪贴板。真跑 CC 多图粘贴复核间隔是否够、是否漏图/串图。

**⑧ 编辑器增行 resize 防抖【minor，dogfood】** — 编辑器高度 2↔12 行变化 → tile 洞几何变 → layoutReport 重发 → PTY resize。default：复用既有 `useLayoutReport`，对编辑器高度驱动的上报防抖，避免高频 resize。

**⑨ 单编辑器 vs 每 tile 编辑器【⚑ 待用户/dogfood 确认，default PRD 忠实】** — REQ-EDITOR_INPUT-001「每个终端下方**始终**有输入区」→ default = **per-tile 编辑器**（每 tile 各渲自己的编辑器，草稿隔离，空间挤压走 §2 min-2-行/单行横滚）。若高 tile 数下过挤/过重，fallback = 仅选中 tile 渲编辑器（草稿仍 per-terminal 数据保留）。渲染门控（§9）+ 焦点模型（§4）两种布局皆适用；最终 tile 内布局归 term-grid.md 渲染批。

---
**REQ 覆盖索引（82 覆盖 + 1 裁决移除 = 83/83）**：M05-INPUT 001–030 → §1(002,016-019,030) §2(003-007,009-011,026-029) §3(011-015) §4(024,025) §5(012,013,020-023) §6(003,008) §2(001,008 隐含每终端输入区+空态)；M06-ATTACH 001–030 → §7 全（**004=用户裁决 2026-07-07 移除**，与新建终端 FAB 混淆）+ §5(023) §1(030) §3(024)；M07-SEND 001–023 → §6 全 + §4(021) §7(010,013)。逐条：INPUT 001(§1/§7 每终端输入区)·002/016-019/030(§1)·003-007/009-011/026-029(§2)·008(§2/§6)·012-015(§3)·020-023(§5)·024-025(§4)·027(§2/§6)·028(§2)｜ATTACH 001-003/005-022/024-029(§7)·004(§7 裁决移除)·023(§5/§7)·030(§1/§7)｜SEND 001-020/022-023(§6)·021(§4)·010/013(§6/§7)。
