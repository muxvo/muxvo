# Spec 10: Amber Signal + Docs — 文档信号塔

> 作者: Designer-2 | 核心理念: 官网即快速入门指南，用文档的信息架构 + amber 的品牌温度，做"最开发者友好"的方案

---

## 1. 设计哲学

这个方案的核心赌注是：**开发者在选择工具时，最终决策依据是文档质量，而非视觉效果**。

传统官网的漏斗是：视觉吸引 -> 功能了解 -> 文档阅读 -> 下载。
本方案把漏斗压缩为：文档即官网 -> 下载。用户在"了解产品"的同时就在"学习使用"。

与纯文档站的区别：通过 amber 品牌色的大面积使用（20-25%），赋予文档页面"产品官网"的品牌感和记忆度，避免看起来像 GitHub README。

---

## 2. 全局设计参数

### 2.1 配色系统

```
/* 背景层级 */
--docs-bg-deep:       #06080c    /* 侧边栏背景 */
--docs-bg-primary:    #0a0e14    /* 内容区背景 */
--docs-bg-code:       #161b22    /* 代码块背景 */
--docs-bg-elevated:   #0d1117    /* 卡片、提示框背景 */

/* Amber 系统（占比 20-25%）— 比其他方案更激进 */
--docs-amber:         #e8a748    /* 主品牌色 */
--docs-amber-hover:   #f0c060
--docs-amber-bg:      #e8a74815  /* 导航高亮背景 */
--docs-amber-border:  #e8a74840  /* section 装饰边框 */
--docs-amber-inline:  #e8a74825  /* inline code 背景 */
--docs-amber-heading: #e8a748    /* section 标题左侧装饰条 */

/* 文字 */
--docs-text-hero:     #ffffff
--docs-text-primary:  #d4d4d8
--docs-text-secondary:#71717a
--docs-text-muted:    #3f3f46
--docs-text-link:     #60a5fa    /* 链接色，与 GitHub/MDN 一致 */
--docs-text-code:     #e8a748    /* 代码关键词高亮 */

/* 边框 */
--docs-border:        #1e2530
--docs-border-focus:  #e8a74855
```

### 2.2 排版系统

这个方案的排版更偏文档阅读优化，行高和间距比其他方案更大。

```
/* 字体 */
sans: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif
mono: 'JetBrains Mono', 'Menlo', 'Monaco', monospace

/* 字号层级 */
页面标题 (h1):    36px / 28px,  DM Sans 700,  line-height 1.2
Section 标题 (h2): 28px / 24px, DM Sans 700,  line-height 1.3
子标题 (h3):      20px / 18px,  DM Sans 600,  line-height 1.4
正文:             15px / 14px,  DM Sans 400,  line-height 1.75  /* 比其他方案宽松 */
代码块:           14px / 13px,  JetBrains Mono 400, line-height 1.65
inline code:      14px / 13px,  JetBrains Mono 400
导航项:           14px / 13px,  DM Sans 500
按钮:             15px / 14px,  DM Sans 600
```

### 2.3 间距

```
侧边栏宽度:       260px（桌面端固定），移动端折叠
内容区最大宽度:    800px
内容区左 padding:  80px / 40px / 24px（桌面/平板/移动）
内容区右 padding:  80px / 40px / 24px
Section 间距:      80px / 60px
段落间距:          20px
代码块上下间距:    24px
列表项间距:        8px
```

---

## 3. 页面结构

### 3.1 全局布局框架

```
桌面端 (>= 1024px):

┌──────────┬─────────────────────────────────────────┐
│          │                                         │
│  侧边栏   │              内容区                     │
│  260px   │         max-width 800px                 │
│  固定     │              居中                       │
│          │                                         │
│  Logo    │  ┌─────────────────────────────────────┐│
│  导航     │  │   Hero 区（标题 + 描述 + CTA）       ││
│  链接     │  ├─────────────────────────────────────┤│
│          │  │   Quick Start                        ││
│          │  ├─────────────────────────────────────┤│
│          │  │   Features                           ││
│          │  ├─────────────────────────────────────┤│
│          │  │   Supported CLIs                     ││
│          │  ├─────────────────────────────────────┤│
│          │  │   Installation                       ││
│          │  ├─────────────────────────────────────┤│
│          │  │   FAQ                                ││
│          │  ├─────────────────────────────────────┤│
│          │  │   Footer CTA                         ││
│          │  └─────────────────────────────────────┘│
└──────────┴─────────────────────────────────────────┘
```

### 3.2 侧边栏

```css
.sidebar {
  position: fixed;
  top: 0;
  left: 0;
  width: 260px;
  height: 100vh;
  background: #06080c;
  border-right: 1px solid #1e2530;
  padding: 24px 16px;
  overflow-y: auto;
  z-index: 100;
}
```

侧边栏内容:

```
┌─────────────────────┐
│  ◆ Muxvo            │  <- Logo + 产品名, amber 图标, 16px 700
│                     │
│  v0.x.x             │  <- 版本号, 13px #3f3f46
│                     │
│  ─────────────────  │  <- 分隔线 1px #1e2530
│                     │
│  ● Quick Start      │  <- 导航项（当前项有 amber 左边框 + amber 背景）
│    Features         │
│    Supported CLIs   │
│    Installation     │
│    FAQ              │
│                     │
│  ─────────────────  │
│                     │
│  [ Download ]       │  <- amber 按钮，固定在导航底部区域
│  ★ GitHub           │  <- 文字链接, #71717a
│                     │
└─────────────────────┘
```

导航项样式:
```css
.nav-item {
  display: block;
  padding: 8px 12px;
  font: 500 14px/1.3 var(--font-sans);
  color: #71717a;
  border-radius: 4px;
  border-left: 2px solid transparent;
  transition: color 0.15s ease, background 0.15s ease, border-color 0.15s ease;
}

.nav-item:hover {
  color: #d4d4d8;
  background: #1c2333;
}

.nav-item.active {
  color: #e8a748;
  background: #e8a74815;
  border-left-color: #e8a748;
}
```

侧边栏滚动跟踪: 使用 IntersectionObserver 监听各 section 进入视口，自动更新 active 导航项。

---

### 3.3 Section: Hero

不是传统官网的"全屏 hero"，而是文档首页的"项目介绍区"。

```
内容区顶部:

┌─────────────────────────────────────────────┐
│                                             │
│  The command center for AI CLI tools.       │  <- h1, 36px 700 #ffffff
│                                             │
│  Muxvo is a desktop workbench that unifies  │  <- 正文, 15px 400 #d4d4d8
│  Claude Code, Codex, and Gemini CLI into    │
│  one tiling terminal interface with chat    │
│  history search, file browsing, config      │
│  editing, and a Skill marketplace.          │
│                                             │
│  [ Download for macOS ]  [ View on GitHub ] │
│                                             │
│  ┌───────────────────────────────────────┐  │
│  │                                       │  │
│  │         产品截图（宽屏）                │  │  <- 圆角 8px, border, shadow
│  │                                       │  │
│  └───────────────────────────────────────┘  │
│                                             │
└─────────────────────────────────────────────┘
```

Hero 区域无动画（文档站的核心体验是"信息即刻可用"，动画在这里是减分项）。

CTA 按钮样式与其他 spec 一致（amber 主按钮 + 透明次按钮）。

---

### 3.4 Section: Quick Start

这是本方案的核心差异化区域——用户看完就能安装使用。

```
┌─────────────────────────────────────────────┐
│                                             │
│  ▌Quick Start                               │  <- h2, 左侧 3px amber 装饰条
│                                             │
│  Get Muxvo running in under a minute.       │  <- 15px #71717a
│                                             │
│  1. Download                                │  <- h3, 20px 600 #d4d4d8
│                                             │
│  ┌─ bash ─────────────────────────────────┐ │
│  │ # macOS (Apple Silicon)                │ │
│  │ curl -fsSL https://muxvo.app/install \ │ │
│  │   | sh                                 │ │
│  │                                        │ │
│  │ # Or download from releases page       │ │
│  └────────────────────────────────────────┘ │
│                                             │
│  2. Launch                                  │
│                                             │
│  ┌─ bash ─────────────────────────────────┐ │
│  │ muxvo                                  │ │
│  └────────────────────────────────────────┘ │
│                                             │
│  3. Add your CLIs                           │
│                                             │
│  Muxvo auto-detects installed AI CLIs.      │
│  Currently supported:                       │
│                                             │
│  · Claude Code (Anthropic)                  │
│  · Codex (OpenAI)                           │
│  · Gemini CLI (Google)                      │
│                                             │
└─────────────────────────────────────────────┘
```

#### 代码块样式

```css
.code-block {
  background: #161b22;
  border: 1px solid #1e2530;
  border-radius: 6px;
  padding: 16px 20px;
  overflow-x: auto;
  font: 400 14px/1.65 var(--font-mono);
  color: #d4d4d8;
}

/* 代码块顶部语言标签 */
.code-block__lang {
  display: inline-block;
  font: 500 12px/1 var(--font-mono);
  color: #71717a;
  background: #0d1117;
  padding: 2px 8px;
  border-radius: 3px;
  position: absolute;
  top: 8px;
  right: 12px;
}

/* 代码高亮色 */
.code-comment  { color: #3f3f46; }
.code-string   { color: #4ade80; }
.code-command  { color: #e8a748; }
.code-flag     { color: #60a5fa; }
```

#### 复制按钮

每个代码块右上角有复制按钮:
```
图标: clipboard icon, 16x16, #3f3f46
hover: #71717a
点击后: 变为 checkmark icon + "Copied!" (1.5s), amber 色
位置: absolute, top 8px, right 40px
```

#### h2 左侧装饰条

```css
h2 {
  padding-left: 16px;
  border-left: 3px solid #e8a748;
}
```

这是 amber 在文档中的主要存在方式——每个 section 标题左侧的 amber 竖条。简洁、一致、不干扰阅读，但持续强化品牌色。

---

### 3.5 Section: Features

功能展示采用文档式的"feature card"列表，不是网格。

```
┌─────────────────────────────────────────────┐
│                                             │
│  ▌Features                                  │
│                                             │
│  ┌───────────────────────────────────────┐  │
│  │  ┌────────────────────────────────┐   │  │
│  │  │        功能截图                 │   │  │
│  │  └────────────────────────────────┘   │  │
│  │                                       │  │
│  │  Tiling Terminal Grid                 │  │  <- 20px 600 #d4d4d8
│  │                                       │  │
│  │  Full-screen tiling layout for        │  │  <- 15px 400 #71717a
│  │  multiple terminal sessions. Drag     │  │
│  │  to resize, click to focus. Each      │  │
│  │  panel runs independently.            │  │
│  │                                       │  │
│  │  · Supports 1-9 terminal panels      │  │  <- 特性列表, · 用 amber
│  │  · Drag-to-resize borders            │  │
│  │  · Per-panel CWD tracking            │  │
│  └───────────────────────────────────────┘  │
│                                             │
│       32px 间距                              │
│                                             │
│  ┌───────────────────────────────────────┐  │
│  │  [下一个功能卡片，相同结构]              │  │
│  └───────────────────────────────────────┘  │
│                                             │
└─────────────────────────────────────────────┘
```

Feature card 样式:
```css
.feature-card {
  background: #0d1117;
  border: 1px solid #1e2530;
  border-radius: 8px;
  overflow: hidden;
  margin-bottom: 32px;
}

.feature-card__image {
  width: 100%;
  height: auto;
  aspect-ratio: 16/9;
  object-fit: cover;
}

.feature-card__body {
  padding: 24px;
}

.feature-card__title {
  font: 600 20px/1.4 var(--font-sans);
  color: #d4d4d8;
}

.feature-card__desc {
  font: 400 15px/1.75 var(--font-sans);
  color: #71717a;
  margin-top: 8px;
}

.feature-card__list {
  margin-top: 16px;
  list-style: none;
}

.feature-card__list li {
  font: 400 14px/1.6 var(--font-sans);
  color: #d4d4d8;
  padding-left: 16px;
  position: relative;
  margin-bottom: 4px;
}

.feature-card__list li::before {
  content: '·';
  color: #e8a748;
  position: absolute;
  left: 0;
  font-weight: 700;
}
```

展示的功能（按重要性排序，垂直堆叠）:
1. Tiling Terminal Grid
2. Chat History & Search
3. Skill Marketplace + AI Scoring
4. File Browser
5. Config Visual Editor
6. Multi-CLI Support

---

### 3.6 Section: Supported CLIs

```
┌─────────────────────────────────────────────┐
│                                             │
│  ▌Supported CLIs                            │
│                                             │
│  Muxvo currently supports these AI CLI      │
│  tools. More coming soon.                   │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │  Tool          │ Provider │ Status  │    │
│  ├─────────────────────────────────────┤    │
│  │  Claude Code   │Anthropic │   ✓     │    │  <- 表格行，✓ 用 #4ade80
│  │  Codex         │ OpenAI   │   ✓     │    │
│  │  Gemini CLI    │ Google   │   ✓     │    │
│  │  Aider         │   —      │ Planned │    │  <- Planned 用 #71717a
│  │  Continue      │   —      │ Planned │    │
│  └─────────────────────────────────────┘    │
│                                             │
└─────────────────────────────────────────────┘
```

表格样式:
```css
.cli-table {
  width: 100%;
  border-collapse: collapse;
  font: 400 14px/1.5 var(--font-sans);
}

.cli-table th {
  text-align: left;
  padding: 10px 16px;
  font-weight: 600;
  color: #71717a;
  border-bottom: 1px solid #1e2530;
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.cli-table td {
  padding: 12px 16px;
  color: #d4d4d8;
  border-bottom: 1px solid #1e253050;
}

.cli-table tr:hover td {
  background: #1c2333;
}
```

---

### 3.7 Section: Installation

详细安装说明，带多种安装方式的 tab 切换。

```
┌─────────────────────────────────────────────┐
│                                             │
│  ▌Installation                              │
│                                             │
│  [ curl ]  [ Homebrew ]  [ Manual ]         │  <- tab 切换
│                                             │
│  ┌─ bash ─────────────────────────────────┐ │
│  │ curl -fsSL https://muxvo.app/install \ │ │
│  │   | sh                                 │ │
│  └────────────────────────────────────────┘ │
│                                             │
│  System Requirements                        │  <- h3
│  · macOS 12.0 or later                     │
│  · Apple Silicon or Intel                  │
│  · 200MB disk space                        │
│                                             │
└─────────────────────────────────────────────┘
```

Tab 样式:
```css
.install-tab {
  display: inline-block;
  padding: 8px 16px;
  font: 500 14px/1 var(--font-sans);
  color: #71717a;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease;
}

.install-tab:hover {
  color: #d4d4d8;
}

.install-tab.active {
  color: #e8a748;
  border-bottom-color: #e8a748;
}
```

---

### 3.8 Section: FAQ

折叠式问答列表。

```
┌─────────────────────────────────────────────┐
│                                             │
│  ▌FAQ                                       │
│                                             │
│  ▸ Is Muxvo free?                           │  <- 折叠态: ▸ amber, 文字 #d4d4d8
│                                             │
│  ▾ Does Muxvo replace my terminal?          │  <- 展开态: ▾ amber
│    No. Muxvo wraps your existing terminal   │  <- 答案: 15px #71717a, 左侧缩进
│    and AI CLIs. It doesn't replace them,    │
│    it organizes them.                       │
│                                             │
│  ▸ What data does Muxvo collect?            │
│                                             │
│  ▸ Can I use Muxvo with other CLI tools?    │
│                                             │
└─────────────────────────────────────────────┘
```

FAQ 项样式:
```css
.faq-item {
  border-bottom: 1px solid #1e2530;
  padding: 16px 0;
}

.faq-question {
  font: 500 15px/1.5 var(--font-sans);
  color: #d4d4d8;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
}

.faq-question__arrow {
  color: #e8a748;
  font-size: 12px;
  transition: transform 0.2s ease;
}

.faq-question__arrow.open {
  transform: rotate(90deg);
}

.faq-answer {
  font: 400 15px/1.75 var(--font-sans);
  color: #71717a;
  padding: 12px 0 4px 20px;
  max-height: 0;
  overflow: hidden;
  transition: max-height 0.3s ease, padding 0.3s ease;
}

.faq-answer.open {
  max-height: 500px;
  padding: 12px 0 4px 20px;
}
```

---

### 3.9 Section: Footer CTA

```
┌─────────────────────────────────────────────┐
│                                             │
│  ────────────────────────────────────────   │  <- 分隔线
│                                             │
│  Ready to try Muxvo?                        │  <- 28px 700 #ffffff
│                                             │
│  [ Download for macOS ]                     │  <- amber 按钮
│                                             │
│  MIT License · v0.x.x · Made for CLI devs   │  <- 13px #3f3f46
│                                             │
└─────────────────────────────────────────────┘
```

---

## 4. 响应式策略

### 4.1 侧边栏响应式（关键）

```
桌面 (>= 1024px):
  侧边栏 260px 固定可见
  内容区 margin-left: 260px

平板 (768-1023px):
  侧边栏默认隐藏
  顶部显示 hamburger 按钮（左上角）
  点击后侧边栏从左侧滑入（transform: translateX, 300ms ease-out）
  叠加半透明遮罩（#06080c80）

手机 (< 768px):
  与平板相同
  侧边栏宽度改为 280px（接近全屏）
```

### 4.2 顶部导航栏（平板/移动端）

侧边栏隐藏后，顶部出现固定导航栏:
```css
.topbar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 52px;
  background: #06080cee;
  backdrop-filter: blur(8px);
  border-bottom: 1px solid #1e2530;
  display: flex;
  align-items: center;
  padding: 0 16px;
  z-index: 90;
}
```

内容: [hamburger] [logo + Muxvo] [spacer] [Download 按钮(小)]

### 4.3 内容区响应式

| 元素 | 桌面 | 平板 | 手机 |
|------|------|------|------|
| 内容区宽度 | max 800px | max 800px | 100% - 48px |
| 内容区左右 padding | 80px | 40px | 24px |
| h1 字号 | 36px | 32px | 28px |
| h2 字号 | 28px | 24px | 24px |
| 正文字号 | 15px | 15px | 14px |
| 代码块字号 | 14px | 14px | 13px |
| 功能卡片截图 | 16:9 | 16:9 | 4:3（更方正，移动端利用率更高） |
| CLI 表格 | 标准表格 | 标准表格 | 卡片列表（每行一个工具） |
| 安装 tab | 内联 tab | 内联 tab | 全宽 tab |
| Section 间距 | 80px | 60px | 60px |

---

## 5. 动画规范

本方案刻意减少动画，与"文档站"的即时可用理念一致。

| 动画 | 触发 | 时长 | 说明 |
|------|------|------|------|
| 侧边栏滑入（移动端） | hamburger 点击 | 300ms ease-out | transform: translateX |
| FAQ 展开/折叠 | 问题点击 | 300ms ease | max-height transition |
| 安装 tab 切换 | tab 点击 | 200ms | opacity crossfade |
| 导航 active 状态 | 滚动触发 | 150ms | color + background transition |
| 代码复制反馈 | 点击复制 | 1500ms | 图标切换 + fade-out |

**无滚动触发动画**。所有内容在进入视口时即完整显示，不做 fade-in。这是本方案与其他 9 个方案的关键差异——文档内容不应该"表演"，应该"随时可读"。

---

## 6. Amber 的使用策略（本方案独特之处）

在 20-25% amber 占比下，amber 的分布方式和其他方案完全不同:

| Amber 用法 | 面积/频率 | 目的 |
|------------|----------|------|
| h2 左侧装饰条 | 3px x ~30px, 每个 section 一次 | 结构化标记，一眼看到章节边界 |
| 导航 active 项 | 背景 + 左边框 | 位置指示 |
| inline code 背景 | 微量, 文内出现 | 代码元素识别 |
| 代码块关键词 | 命令名、路径等 | 语法高亮中的品牌色植入 |
| CTA 按钮 | 2 处（hero + footer） | 转化入口 |
| FAQ 箭头 | 极小面积 | 交互提示 |
| 特性列表圆点 | 极小面积 | 品牌色微渗透 |

与 Amber Signal 方案（大面积渐变背景）相比，本方案的 amber 是"分散的、功能性的"——每个 amber 元素都有明确的信息架构功能，而非纯装饰。累积起来仍然达到 20-25% 的视觉占比，但不会干扰阅读。

---

## 7. 与其他 Spec 的关键差异

| 维度 | Spec-04 (Terminal Hero) | Spec-06 (Orchestrator) | Spec-10 (Docs Signal) |
|------|------------------------|----------------------|---------------------|
| 信息架构 | 营销官网式 | 营销官网式 | 文档站式 |
| 导航方式 | 滚动 | 滚动 | 侧边栏锚点 + 滚动 |
| 动画策略 | Hero 动画 + 滚动点亮 | 连线动画 + 滚动点亮 | 几乎无动画 |
| 内容深度 | 浅（每功能一句话） | 中（每功能一段话） | 深（每功能详细说明 + 代码示例） |
| 用户决策路径 | 看截图 -> 下载 | 理解编排概念 -> 下载 | 读文档 -> 已学会 -> 下载 |
| 首屏信息 | 终端动画 | 产品截图 | 文字介绍 + 截图 |
| 二次访问价值 | 低（动画看过了） | 低 | 高（可当文档反复查阅） |
| SEO 友好度 | 中（截图为主） | 中 | 高（大量文字内容，锚点链接） |
| 目标用户 | 快速决策型 | 需要理解价值的用户 | 深度评估型开发者 |
