# Spec 07: Terminal Native / 终端原生

> 设计理念：官网即终端 session。目标用户是 CLI 重度用户，我们用他们最熟悉的视觉语言——命令行——来讲故事。整个页面模拟一个增强版终端环境：monospace 字体为主、命令提示符导航、ASCII 装饰。但核心创新在于"CLI 输入 → GUI 输出"的反差——命令是终端风格的，输出结果却是现代 UI 卡片，精确传达 Muxvo 的核心价值。

---

## 1. 色彩系统

### 1.1 核心色板

| 角色 | 色值 | 用途 |
|------|------|------|
| Amber Prompt | `#e8a748` | 命令提示符、命令文字、活跃元素 |
| Amber Dim | `#e8a74880` | 次级 amber（ASCII 边框、标注） |
| Background Terminal | `#0a0e14` | 全站主背景（终端背景色） |
| Background Panel | `#0d1117` | GUI 输出卡片背景 |
| Background Surface | `#161b22` | 代码块背景、hover 态 |
| Text Output | `#d4d4d8` | 命令输出文字（stdout） |
| Text Dim | `#71717a` | 注释、次要信息（类似代码注释色） |
| Text Bright | `#f5f5f5` | 强调文字 |
| Success | `#4ade80` | 成功状态、安装完成提示 |
| Cursor | `#e8a748` | 闪烁光标 |
| Border Terminal | `#1e2530` | 面板分隔线 |

### 1.2 Amber 占比策略

目标占比：**10-12%**。amber 仅出现在命令提示符、命令文字、光标、核心标题上。大面积留给终端深色背景和灰色输出文字。克制是关键——终端不应该五颜六色。

---

## 2. 排版系统

### 2.1 字体栈

```css
/* 全站主字体：等宽 */
--font-primary: 'JetBrains Mono', 'Fira Code', 'SF Mono', monospace;
/* GUI 输出区域字体：无衬线 */
--font-gui: 'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif;
```

**核心规则**：终端风格区域（命令、导航、标题、ASCII）全部使用 monospace。GUI 输出区域（功能卡片、描述文案）使用 DM Sans。这个字体切换本身就是"CLI → GUI"反差的视觉表达。

### 2.2 字号与层级

| 层级 | 桌面 (>=1280px) | 平板 (768-1279px) | 手机 (<768px) | 字体 | 字重 | 行高 |
|------|-----------------|-------------------|---------------|------|------|------|
| ASCII Art Logo | 预设尺寸 | 缩小版 | 简化版或纯文字 | mono | 400 | 1.0 |
| 命令提示符 | 20px | 18px | 16px | mono | 700 | 1.6 |
| 命令文字 | 20px | 18px | 16px | mono | 400 | 1.6 |
| Section "命令" | 18px | 17px | 15px | mono | 400 | 1.6 |
| GUI 卡片标题 | 24px | 22px | 20px | DM Sans | 600 | 1.3 |
| GUI 卡片正文 | 16px | 15px | 15px | DM Sans | 400 | 1.6 |
| 注释/dim 文字 | 14px | 13px | 13px | mono | 400 | 1.5 |

---

## 3. 页面结构与 Section 详细规格

### 3.1 整体页面结构

模拟一个终端 session 的输出记录。每个 section 对应一条"命令"和它的"输出"。

```
[Terminal Chrome Bar]           — 模拟终端窗口顶栏
[Section 1: Hero / $ muxvo]    — ASCII logo + 介绍文字
[Section 2: $ muxvo --features] — 功能概览（GUI 卡片输出）
[Section 3: $ muxvo --tools]   — CLI 工具支持
[Section 4: $ muxvo skills]    — Skill 市场
[Section 5: $ muxvo install]   — 下载安装 CTA
[Footer / exit]                — 简化 footer
```

---

### 3.2 Terminal Chrome Bar（全站顶部）

**布局**：
- 固定顶部，高度 36px
- 背景：`#161b22`
- 左侧：三个圆形"窗口按钮"（红 `#ff5f57`、黄 `#febc2e`、绿 `#28c840`），每个直径 12px，间距 8px
- 中间：标题文字 `muxvo — zsh — 120x40`（`#71717a`，12px，mono）
- 右侧：留空

**功能**：
- 这不是真正的导航栏，但包含导航功能
- 点击中间标题区域展开下拉导航菜单（命令行风格列表）：
  ```
  > features
  > tools
  > skills
  > install
  > github (外链)
  > docs (外链)
  ```
- 每个菜单项前有 `>`，hover 时 `>` 变为 amber 色

**响应式**：
- <768px：保持不变（终端 chrome bar 在任何尺寸下都有意义）

---

### 3.3 Section 1: Hero

**布局**：
- 背景：`#0a0e14`（纯终端背景）
- 高度：`100vh`（最小 600px）
- 内容区域：`max-width: 900px`，左对齐（终端文字从不居中）
- `padding: 80px 24px`（上方留空模拟终端顶部空白）

**内容（从上到下）**：

1. ASCII Art Logo（amber 色）：
```
 ███╗   ███╗██╗   ██╗██╗  ██╗██╗   ██╗ ██████╗
 ████╗ ████║██║   ██║╚██╗██╔╝██║   ██║██╔═══██╗
 ██╔████╔██║██║   ██║ ╚███╔╝ ██║   ██║██║   ██║
 ██║╚██╔╝██║██║   ██║ ██╔██╗ ╚██╗ ██╔╝██║   ██║
 ██║ ╚═╝ ██║╚██████╔╝██╔╝ ██╗ ╚████╔╝ ╚██████╔╝
 ╚═╝     ╚═╝ ╚═════╝ ╚═╝  ╚═╝  ╚═══╝   ╚═════╝
```
颜色：`#e8a748`

2. 命令行介绍：
```
$ muxvo --version
v1.0.0

$ muxvo --what
The desktop workbench for AI CLI tools.
Tiling terminals. Chat history. Skill marketplace.

$ muxvo --supports
claude-code  codex  gemini-cli

$█
```

- `$` 提示符：`#e8a748`，font-weight 700
- 命令文字（`muxvo --version` 等）：`#f5f5f5`
- 输出文字：`#d4d4d8`
- 最后一行的 `█` 光标：amber 色，闪烁动画

3. 底部 CTA（在最后一条命令后）：
```
$ muxvo install
```
这行本身是一个可点击的按钮区域，hover 时整行背景变 `#161b22`

**动画**：
- 打字机效果：页面加载后，从 ASCII logo 开始逐行"打出"内容
- **速度极快**：总时长不超过 2.5 秒完成全部文字
- 用户按任意键或点击可立刻跳过（全部内容即时显示）
- 光标持续闪烁：`opacity: 1 → 0`，周期 1s，`step-end`

**响应式**：
- <768px：ASCII art 替换为简化版（3 行高度）或纯文字 "MUXVO"（amber, 36px, mono, bold）
- 命令文字 16px，`max-width: 100%`

---

### 3.4 Section 2: Features / $ muxvo --features

**布局**：
- 背景：`#0a0e14`
- 上方有命令行输入：
  ```
  $ muxvo --features
  ```
  （amber 提示符 + 白色命令）

- 命令下方是"输出"：**现代 GUI 风格的功能卡片**（这是 CLI → GUI 反差的核心体现）
- 卡片区域：2 列 grid，`gap: 16px`，`max-width: 900px`

**功能卡片设计（GUI 风格）**：
- 背景：`#0d1117`
- 边框：`1px solid #1e2530`
- `border-radius: 8px`
- `padding: 24px`
- 标题：DM Sans, 20px, 600, `#f5f5f5`
- 描述：DM Sans, 15px, 400, `#9ca3af`
- 每张卡片左上角有一个 amber 小标签：`[01]`、`[02]`（mono 字体，amber 色）

**4 张功能卡片**：
```
[01] Tiling Terminals      [02] Chat History Search
全屏网格布局……              跨 session 全文搜索……

[03] Config Editor          [04] Skill Marketplace
可视化管理配置文件……        AI 评分的社区 Skill 包……
```

**视觉关键**：
- 命令行输入区（mono, amber）和 GUI 卡片输出（DM Sans, 灰白）的字体/风格切换要非常明显
- 卡片区域左侧用一条竖线（`#1e2530`）连接到命令行，模拟"输出缩进"

**交互**：
- 卡片 hover：`border-color: #e8a74840`，微弱 amber 发光

**响应式**：
- <768px：单列卡片

---

### 3.5 Section 3: CLI Tools / $ muxvo --tools

**布局**：
- 背景：`#0a0e14`
- 命令行：`$ muxvo --tools`
- 输出模拟 `tree` 命令格式：

```
$ muxvo --tools

Supported AI CLI tools:
├── claude-code .............. Anthropic Claude Code
│   ├── terminal management
│   ├── chat history sync
│   └── config editing
├── codex ................... OpenAI Codex CLI
│   ├── terminal management
│   ├── chat history sync
│   └── config editing
└── gemini-cli .............. Google Gemini CLI
    ├── terminal management
    ├── chat history sync
    └── config editing

3 tools, 9 integrations
```

**视觉**：
- 全部使用 mono 字体
- Tree 线符号（`├──`、`│`、`└──`）：`#71717a`
- 工具名：`#e8a748`（amber）
- 描述文字：`#d4d4d8`
- 点线（`...`）：`#71717a`
- 最后一行统计：`#4ade80`（success 绿色），模拟命令执行成功

**响应式**：
- <768px：缩小字号到 14px，必要时截断点线。Tree 结构保持不变（等宽字体天然适配）

---

### 3.6 Section 4: Skill Market / $ muxvo skills

**布局**：
- 背景：`#0a0e14`
- 命令行：`$ muxvo skills --list --sort=score`
- 输出：混合模式——表头用终端表格风格，每个 Skill 详情用 GUI 卡片

**命令输出（终端风格表头）**：
```
$ muxvo skills --list --sort=score

SKILL               SCORE   AUTHOR          STATUS
─────────────────────────────────────────────────────
```

**然后是 GUI 卡片**（3 个示例 Skill 卡片横排）：
- 卡片背景：`#0d1117`
- 每张卡片展示：Skill 名、评分（amber 星星）、作者、简介
- 卡片标题用 DM Sans（GUI 风格）

**视觉**：
- 表头的 `─────` 分隔线：`#1e2530`
- 表头字段名：`#71717a`，全大写，mono
- 从纯文字表头过渡到 GUI 卡片的"切换"是视觉亮点——暗示 Muxvo 让 CLI 数据变成可视化

**响应式**：
- <768px：隐藏表头（屏幕太窄放不下），直接显示 GUI 卡片垂直排列

---

### 3.7 Section 5: Install CTA / $ muxvo install

**布局**：
- 背景：`#0a0e14`
- `padding: 80px 24px`
- 内容居中，`max-width: 700px`

**内容**：
```
$ muxvo install

Downloading Muxvo v1.0.0 for macOS...
████████████████████████████████████████ 100%

✓ Installation complete.
```

- 进度条用 amber 色填充块：`#e8a748`
- `✓ Installation complete.` 用 `#4ade80` 绿色
- 进度条下方是真正的下载按钮：

```
[Download for macOS]  — amber 背景按钮
```

- 按钮样式：`background: #e8a748`，`color: #06080c`，`font-family: mono`，`border-radius: 4px`（终端风格的小圆角），`padding: 12px 32px`
- 按钮文字：`$ brew install muxvo` 或 `Download .dmg`

**次要链接**：
```
$ open https://github.com/user/muxvo    # View source
$ open https://docs.muxvo.dev           # Read docs
```
每行是可点击的链接，`#` 后面的注释用 `#71717a`

**动画**：
- 进度条有填充动画（进入视口时触发），从 0% 到 100%，时长 1.5s
- `✓` 在进度条填满后 200ms 出现

**响应式**：
- <768px：布局基本不变（终端风格天然适配窄屏）

---

### 3.8 Footer

**布局**：
- 背景：`#0a0e14`
- 上方分隔：一行 `─` 字符（`#1e2530`）

**内容**（终端风格）：
```
$ muxvo --links

docs    https://docs.muxvo.dev
github  https://github.com/user/muxvo
twitter https://twitter.com/muxvo

$ exit
muxvo session ended. © 2026 Muxvo.
```

- 链接名（docs、github）：`#e8a748`
- URL：`#71717a`，hover 时变 `#d4d4d8`
- `$ exit` 和版权信息：`#71717a`

---

## 4. 动画方案

### 4.1 核心动画：打字机效果（仅 Hero）

```javascript
// 仅在 Hero 区域使用
// 总时长上限：2.5 秒
// 逐行显示，每行间隔 150ms
// ASCII art 整块瞬间出现（不逐字）
// 用户点击/按键即刻显示全部内容
```

### 4.2 光标闪烁

```css
@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}
.cursor {
  animation: blink 1s step-end infinite;
  color: #e8a748;
}
```

### 4.3 进度条填充（Section 5）

```css
@keyframes fill-progress {
  from { width: 0%; }
  to { width: 100%; }
}
.progress-bar {
  animation: fill-progress 1.5s ease-out forwards;
  background: #e8a748;
  height: 16px; /* 用 █ 字符实现，非 CSS bar */
}
```

### 4.4 滚动触发

- 每个 section 的"命令行"在进入视口时从左侧 `translateX(-12px)` 渐入，200ms
- GUI 卡片从底部 `translateY(16px)` 渐入，400ms
- 所有动画仅触发一次

### 4.5 禁止的动画

- 不使用 parallax
- 不使用 3D transforms
- 不使用粒子/WebGL
- 不使用 hover 放大效果（终端里没有这种东西）

---

## 5. 响应式策略

### 5.1 核心适配

终端风格天然适配不同屏幕宽度（终端本身就是固定宽度字符流）。

| 元素 | 桌面 (>=1280px) | 平板 (768-1279px) | 手机 (<768px) |
|------|-----------------|-------------------|---------------|
| 内容最大宽度 | 900px | 90vw | 100vw - 32px |
| ASCII art | 完整版 | 完整版 | 简化版或纯文字 |
| 功能卡片 | 2 列 | 2 列 | 单列 |
| Skill 卡片 | 3 列 | 2 列 | 单列 |
| Tree 结构 | 完整展示 | 完整展示 | 缩小字号 |
| Terminal chrome | 完整 | 完整 | 简化（隐藏尺寸信息） |

### 5.2 关键原则

- **不因响应式而丧失终端感**：即使在手机端也要保持 mono 字体、`$` 提示符、命令行格式
- ASCII art 在 <768px 可简化但不能完全移除——至少保留 "MUXVO" 的 mono bold 文字
- GUI 卡片在手机端从 grid 变为垂直堆叠，但卡片样式不变

---

## 6. 关键设计决策记录

| 决策 | 结论 | 原因 |
|------|------|------|
| 全站用 monospace 还是混合字体？ | 混合：命令区 mono，输出区 DM Sans | "CLI 输入 → GUI 输出"的字体切换就是 Muxvo 的价值隐喻 |
| 打字机效果是否保留？ | 保留，但极快（<2.5s）且可跳过 | 打字机是终端感的核心元素，但不能考验耐心 |
| 导航用标准 nav bar 还是终端菜单？ | 终端 chrome bar + 下拉命令菜单 | 保持全站终端一致性，但下拉菜单确保可发现性 |
| ASCII art 有多大？ | 6 行高度 | 够有冲击力但不会占满首屏，给下方命令留空间 |
| 色彩是否引入终端绿？ | 仅 success 状态用 `#4ade80` | Amber 是品牌色，取代传统终端绿是差异化策略 |
| 终端风格的"注释"用什么符号？ | `#`（shell 注释风格） | 目标用户最熟悉的注释符号 |
