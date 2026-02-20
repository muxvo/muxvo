# 07-terminal-native.html 内容策略改进建议

## 核心诊断

当前页面的根本问题：**Hero 区是一个终端 session，但 Hero 之后页面变成了"命令行标题 + SaaS 卡片"的拼凑结构。** 终端感只停留在 `$ muxvo --features` 这样的一行命令提示符上，实际内容展示（gui-card、skill-gui-card）完全回退到了通用 SaaS 风格——圆角、DM Sans 字体、hover 高亮边框。用户的感受是"从终端突然跳进了一个普通产品页"。

要修好这个问题，不是微调卡片样式，而是**重新设计信息架构——让整个页面成为一个连贯的终端 session 叙事**。

---

## 建议 1：Features 区 — 用 `man page` 格式替代 GUI 卡片

### 改什么
Features section（当前的 4 个 gui-card 网格）

### 怎么改
完全去掉 gui-card。改为 `man muxvo` 的 man page 格式输出：

```
$ man muxvo

MUXVO(1)                    AI CLI Workbench                    MUXVO(1)

NAME
       muxvo - desktop workbench for AI CLI tools

SYNOPSIS
       muxvo [--claude-code | --codex | --gemini-cli] [options]

DESCRIPTION
       Tiling Terminals
              全屏网格布局，多终端并行运行。拖拽调整大小，
              每个面板独立运行不同的 CLI 工具。

       Chat History Search
              跨 session 全文搜索所有 AI CLI 对话记录。
              输入关键词，跨工具秒级返回。

       Config Editor
              可视化管理所有 AI CLI 配置文件。
              告别手动编辑 JSON/YAML，所见即所得。

       Skill Marketplace
              社区驱动的 Skill 包生态。每个 Skill 经 AI
              自动评分，质量一目了然。

SEE ALSO
       claude-code(1), codex(1), gemini-cli(1)
```

### 为什么更特别
- man page 是终端用户最熟悉的文档格式，一眼就能认出来，会产生"这帮人懂我"的共鸣
- 结构化的 NAME / SYNOPSIS / DESCRIPTION 层级天然就是信息架构，不需要卡片来分隔
- 全等宽字体、左对齐缩进、大写标题——这些都是 man page 的视觉特征，比圆角卡片更有终端味
- 页眉页脚的 `MUXVO(1)` 是 man page 经典元素，对终端用户是一个强烈的文化暗号

---

## 建议 2：Tools 区 — 用 `neofetch` 风格替代 tree 列表

### 改什么
Tools section（当前的 tree 结构展示支持的工具）

### 怎么改
把 `$ muxvo --tools` 的输出改为 neofetch 风格的系统信息面板。左边是一个小的 ASCII art 图标（或 muxvo logo 的迷你版），右边是 key-value 对齐的系统信息：

```
$ muxvo neofetch

        ╔══════╗        user@muxvo
        ║ MXVO ║        ──────────────────
        ╚══════╝        OS: macOS + Electron
                        Shell: AI CLI Workbench v1.0.0
                        Terminals: 8 (tiling grid)
                        ─────────────────
                        Tools: claude-code, codex, gemini-cli
                        Integrations: 9 (3 per tool)
                        Chat Sessions: 1,247 indexed
                        Skills Installed: 12
                        ─────────────────
                        Uptime: since you got tired of
                                switching between terminals
```

### 为什么更特别
- neofetch 是终端社区的"文化图腾"，在 r/unixporn 上人人都认识，是终端用户身份认同的象征
- 当前的 tree 结构虽然也是终端风格，但信息太少（只有工具名+子功能），缺乏"惊喜感"
- neofetch 的 key-value 布局可以传递更多产品数据点（session 数量、skill 数量等），比 tree 更有信息密度
- 最后一行的 Uptime 幽默感可以打破技术页面的沉闷，让人会心一笑

---

## 建议 3：Skills 区 — 用 `apt/brew search` 输出替代卡片网格

### 改什么
Skills section（当前的 3 个 skill-gui-card + GUI 列头）

### 怎么改
把 skill 展示从卡片网格改为模拟 `brew search` 或 `apt list` 的终端表格输出：

```
$ muxvo skills --list --sort=score --limit=5

  NAME                VERSION   SCORE   DOWNLOADS   STATUS
  ────────────────────────────────────────────────────────
  code-review-pro     2.1.0     ★ 4.8   12.4k       installed
  doc-generator       1.3.2     ★ 4.2    8.7k       installed
  test-writer         3.0.1     ★ 4.0    6.2k       available
  refactor-assist     1.0.0     ★ 3.9    4.1k       available
  security-scan       0.9.3     ★ 3.7    3.8k       available

  Showing 5 of 127 skills. Run `muxvo skills --browse` for more.

$ muxvo skills install test-writer
  Resolving dependencies... done
  Installing test-writer@3.0.1... ████████████████████ 100%
  ✓ test-writer installed successfully.
  Run `muxvo skills run test-writer` to get started.
```

### 为什么更特别
- 等宽对齐的表格是终端输出的核心形态，比 GUI 卡片强太多
- 加入一个模拟的 `install` 交互，让用户"看到"安装流程，比静态卡片更有沉浸感
- "Showing 5 of 127 skills" 暗示了生态规模，比 3 个卡片更让人想探索
- 这个模式用户已经在 npm/pip/brew 里见过无数次，几乎零认知成本

---

## 建议 4：增加 Demo 区 — 用 `asciinema` 风格的模拟录屏

### 改什么
在 Features 和 Tools 之间新增一个 section

### 怎么改
新增一个"终端录屏回放"区域，模拟一个真实的使用流程。不是真的嵌入 asciinema，而是用 CSS 动画逐行显示一个典型的工作流：

```
$ muxvo start --layout=3x1
  ┌─── claude-code ───┬──── codex ────┬── gemini-cli ──┐
  │ $ claude           │ $ codex       │ $ gemini       │
  │ > Fix the auth bug │ > Write tests │ > Review PR    │
  │ ...                │ ...           │ ...            │
  └────────────────────┴───────────────┴────────────────┘
  3 terminals running.

$ muxvo chat search "auth bug fix"
  Found 3 results across 2 tools:
  [claude-code] session-042: "Fixed JWT validation..."
  [claude-code] session-039: "Auth middleware refactor..."
  [codex]       session-017: "Token refresh bug..."
```

用 IntersectionObserver 触发，逐行淡入，模拟真实终端输出的节奏。

### 为什么更特别
- 当前页面完全没有"产品长什么样"的直观展示，只有抽象的文字描述
- 终端录屏是 CLI 产品最自然的 demo 方式（看看 asciinema.org 上的项目页）
- ASCII art 的分屏布局直接展示了 tiling terminal 的核心卖点，比"全屏网格布局"这句话强 10 倍
- 搜索的演示让用户直观理解"跨工具搜索"意味着什么

---

## 建议 5：页面叙事 — 从"功能罗列"变为"一个完整的终端 session"

### 改什么
整体页面的信息架构和叙事逻辑

### 怎么改
重新编排页面的 section 顺序，使其成为一个有故事弧线的终端 session：

1. **Hero** — `$ muxvo --version` + ASCII logo（已有，保留）
2. **"认识 Muxvo"** — `$ man muxvo`（man page 格式的功能介绍）
3. **"看它运行"** — `$ muxvo start`（ASCII 分屏 demo + 搜索演示）
4. **"你的工具都在"** — `$ muxvo neofetch`（neofetch 风格的工具/能力概览）
5. **"扩展能力"** — `$ muxvo skills --list`（包管理器风格的 skill 表格）
6. **"立刻开始"** — `$ muxvo install`（安装 CTA，已有，保留）
7. **Footer** — `$ exit`（已有，保留）

### 为什么更特别
- 当前的 section 之间没有叙事逻辑——是什么 → 有哪些工具 → 有哪些 skill → 下载。这是标准的功能清单思路
- 重新编排后是一个用户心智旅程：认识它 → 看它跑 → 了解它支持什么 → 发现更多玩法 → 开始使用
- 每个 section 的"命令"形成一个递进的 session 历史，就像真的在终端里一步步探索
- 这种叙事让"终端 session"不是装饰，而是信息架构本身

---

## 建议 6：Install CTA 区 — 加入操作系统检测和条件输出

### 改什么
Install section（当前只有一个进度条动画 + 一个下载按钮）

### 怎么改
让安装区看起来像真正的终端安装流程，包含系统检测：

```
$ muxvo install

  Detecting system...
  OS: macOS 15.3 (arm64)         ✓ supported
  Node: v22.4.0                  ✓ compatible
  Disk: 42GB free                ✓ sufficient

  Select install method:
  > [1] Download .dmg (recommended)
    [2] brew install muxvo
    [3] curl -fsSL https://get.muxvo.dev | sh

  ████████████████████████████████████████ 100%
  ✓ Installation complete.

  $ muxvo start
```

用 JS 检测真实 User-Agent 来动态显示 OS 名称（macOS / Windows / Linux），增强真实感。

### 为什么更特别
- 当前的进度条动画虽然有终端感，但太简单了——只有一个色块和一个百分比
- 系统检测 + 三个绿色的 checkmark 给人"它已经在我机器上了"的心理暗示
- 多种安装方式的展示（dmg / brew / curl）对终端用户是强信号——"这个团队知道我们用什么"
- brew 和 curl 的安装命令本身就是终端文化的一部分，每个开发者都用过

---

## 建议 7：微交互 — 让页面像终端一样可以"打字"

### 改什么
全局交互层

### 怎么改
加入一个隐藏的键盘监听器。当用户在页面上随便按键盘时，在某个固定位置（比如页面底部一个半透明的 "mini terminal"）显示他们的按键输入。如果用户输入了特定彩蛋命令，触发对应效果：

- 输入 `help` → 短暂显示导航提示
- 输入 `vim` → 短暂闪烁 "you're already in the right tool" 消息
- 输入 `sudo` → 短暂显示 "nice try"
- 输入 `clear` → 页面快速滚回顶部
- 输入 `ls` → 短暂列出 section 名称

### 为什么更特别
- 这是终端文化里"Easter egg"传统的网页版——对终端用户来说，发现彩蛋的乐趣是独特的社交货币
- 没有任何一个竞品在 landing page 上做过这种交互，差异化极强
- 用户一旦发现可以"打字"，会主动探索更多命令，停留时间和记忆度都会大幅提升
- 但要克制，不要做成一个完整的 shell——只要几个彩蛋就够了，点到为止

---

## 建议 8：字体和视觉一致性 — 彻底去掉 DM Sans

### 改什么
全局字体策略和所有使用 `font-family: var(--font-gui)` 的元素

### 怎么改
- 完全移除 DM Sans 字体的引入（`<link>` 标签中去掉 `DM+Sans`）
- 删除 `--font-gui` CSS 变量
- 所有文本统一使用 JetBrains Mono
- 如果某些地方需要视觉层级区分，通过 `font-weight`、`font-size`、`color`、`letter-spacing` 来实现，而不是切换字体

实际上，如果采用了建议 1-3（man page、neofetch、表格），就不再需要"GUI 字体"了——因为不再有 GUI 卡片。

### 为什么更特别
- DM Sans 是页面"人格分裂"的罪魁祸首——等宽的命令行标题后面突然出现无衬线的描述文字，终端幻觉瞬间打破
- 全等宽字体是终端模拟页面的底线要求。看看 terminal.css、cool-retro-term 这些项目的页面，全部是等宽字体
- 去掉 DM Sans 还能减少一个外部字体请求，提升加载速度
- 在纯等宽字体约束下，设计师会被迫用终端的方式解决排版问题（对齐、缩进、分隔线），反而会让整体更和谐

---

## 总结优先级

| 优先级 | 建议 | 改动规模 | 预期影响 |
|--------|------|----------|----------|
| P0 | 8. 去掉 DM Sans | 小 | 消除风格割裂的根本原因 |
| P0 | 1. Features → man page | 中 | 替换最大的 SaaS 败笔 |
| P0 | 3. Skills → 表格输出 | 中 | 替换第二大 SaaS 败笔 |
| P1 | 5. 重编叙事顺序 | 中 | 让页面成为连贯体验 |
| P1 | 4. 新增 Demo 区 | 大 | 唯一能"看到"产品的地方 |
| P1 | 2. Tools → neofetch | 中 | 文化共鸣加分 |
| P2 | 6. Install 增强 | 中 | 提升 CTA 转化 |
| P2 | 7. 键盘彩蛋 | 中 | 社交传播和记忆点 |
