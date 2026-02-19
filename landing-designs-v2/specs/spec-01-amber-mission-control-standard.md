# Spec 01: Amber Mission Control — 标准版

> 三人共识的"最佳实践"版本。信息密度优先，amber 中等浓度，面板矩阵布局。
> 设计师: Designer-1 | 状态: 初稿

---

## 1. 设计理念

"指挥中心"隐喻 + amber 暖光差异化 + 高信息密度。用户打开页面就像走进一个为 AI CLI 工具打造的操控台——多面板平铺、状态可视、一目了然。视觉调性在 Linear 的高级感和 Grafana 的信息密度之间取平衡。

---

## 2. 配色系统

### 2.1 基础色板

| Token | 色值 | 用途 |
|-------|------|------|
| `--lp-bg-deep` | `#06080c` | 页面最底层背景 |
| `--lp-bg-primary` | `#0a0e14` | 主背景、section 默认背景 |
| `--lp-bg-card` | `#0d1117` | 面板卡片背景 |
| `--lp-bg-elevated` | `#161b22` | 悬浮/弹出层背景 |
| `--lp-bg-hover` | `#1c2333` | 卡片 hover 态背景 |
| `--lp-text-primary` | `#e5e7eb` | 主文字（略微比产品 UI 的 #d4d4d8 亮，提升阅读对比度） |
| `--lp-text-secondary` | `#9ca3af` | 辅助说明文字 |
| `--lp-text-muted` | `#4b5563` | 极弱文字、placeholder |
| `--lp-amber` | `#e8a748` | 品牌主色 |
| `--lp-amber-hover` | `#f0c060` | amber hover 态 |
| `--lp-amber-muted` | `rgba(232, 167, 72, 0.15)` | amber 背景填充（面板标记等） |
| `--lp-amber-glow` | `rgba(232, 167, 72, 0.08)` | amber 光晕（径向渐变用） |
| `--lp-amber-line` | `rgba(232, 167, 72, 0.12)` | amber 网格线/分隔线 |
| `--lp-border` | `#1e2530` | 卡片/面板边框 |
| `--lp-border-amber` | `rgba(232, 167, 72, 0.25)` | amber 强调边框 |

### 2.2 Amber 面积占比目标: 15-18%

计算方式: amber 可见像素面积 / 视口总面积。包含：
- CTA 按钮实心背景 (~2%)
- 面板上边框 amber 线 (~1%)
- 径向光晕背景 (~5-7%)
- 文字高亮/标题装饰 (~3-4%)
- Hover 态发光 (~2-3% 动态)

### 2.3 语义色（极少量使用）

| Token | 色值 | 用途 |
|-------|------|------|
| `--lp-success` | `#4ade80` | CLI 工具"在线"状态点 |
| `--lp-info` | `#60a5fa` | 外链色、次要信息 |

---

## 3. 排版系统

### 3.1 字体栈

```css
--lp-font-display: 'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif;
--lp-font-mono: 'JetBrains Mono', 'Menlo', monospace;
```

### 3.2 字号/字重/行高

| 元素 | 字号 | 字重 | 行高 | 字体 |
|------|------|------|------|------|
| Hero 主标题 | 56px | 700 | 1.1 | display |
| Hero 副标题 | 20px | 400 | 1.5 | display |
| Section 标题 | 36px | 600 | 1.2 | display |
| Section 副标题 | 16px | 400 | 1.6 | display |
| 面板卡片标题 | 18px | 600 | 1.3 | display |
| 面板卡片正文 | 14px | 400 | 1.6 | display |
| 代码/命令 | 14px | 400 | 1.5 | mono |
| 导航链接 | 14px | 500 | 1.0 | display |
| CTA 按钮文字 | 15px | 600 | 1.0 | display |
| 页脚 | 13px | 400 | 1.5 | display |

### 3.3 间距系统 (8px 基准)

```
4px   — 极小间距（icon 与 label）
8px   — 基础间距
16px  — 卡片内 padding
24px  — 卡片间距 / section 内元素间距
32px  — section 内大块间距
48px  — 桌面端卡片 gap
64px  — section 上下 padding (mobile)
96px  — section 上下 padding (tablet)
120px — section 上下 padding (desktop)
```

---

## 4. 页面结构 (Section by Section)

### 4.0 顶部导航栏

- **位置**: `position: sticky; top: 0; z-index: 100`
- **高度**: 64px
- **背景**: `#0a0e14` + `backdrop-filter: blur(12px)` + 底部 1px `#1e2530` 边框
- **滚动后**: 背景透明度从 `0.8` 渐变到 `0.95`
- **内容**:
  - 左: Muxvo logo (amber 色, 24px 高) + 文字 "Muxvo" (DM Sans 700, 18px, #e5e7eb)
  - 中: 导航链接 (Features / Skill Market / Download) — 14px, #9ca3af, hover 变 #e5e7eb
  - 右: GitHub 图标链接 + "Download" CTA 按钮 (amber 实心, 圆角 6px, padding 8px 20px)

### 4.1 Hero Section

- **高度**: 100vh (最小 700px, 最大 900px)
- **背景**:
  - 基础: `#06080c`
  - 叠加: 居中 amber 径向渐变 `radial-gradient(ellipse 70% 60% at 50% 55%, rgba(232,167,72,0.07) 0%, transparent 70%)`
  - 噪点纹理: SVG noise filter, opacity 0.03 (增加质感，避免死黑)
- **布局**: flex column, 垂直居中

```
[上间距 ~30vh]

"The command center for your AI CLI tools"
(56px, 700, #e5e7eb, text-align: center, max-width: 720px)

"Tiling terminals, chat history search, config editor,
and a Skill marketplace — for Claude Code, Codex & Gemini CLI."
(20px, 400, #9ca3af, text-align: center, max-width: 560px, margin-top: 20px)

[两个按钮, 水平排列, gap: 16px, margin-top: 40px]
  [Download for macOS] — amber 实心按钮, 圆角 8px, padding 14px 32px
  [View on GitHub] — 幽灵按钮, 1px amber border, 同尺寸

[产品截图, margin-top: 56px]
  - 尺寸: max-width: 1100px, width: 90vw
  - 样式: border-radius: 12px, border: 1px #1e2530
  - 阴影: 0 20px 60px rgba(0,0,0,0.5), 0 0 120px rgba(232,167,72,0.05)
  - 内容: Muxvo 多终端平铺界面截图 (真实 UI)
  - 进入动画: opacity 0→1, translateY(20px→0), duration 0.8s, ease-out, delay 0.3s
```

### 4.2 "为什么选择 Muxvo" — 功能概览 (3 列面板)

- **背景**: `#0a0e14` + 顶部到底部的微弱渐变 (`#06080c` → `#0a0e14`)
- **padding**: 120px 上下
- **Section 标题**: "Built for AI CLI power users" (36px, 600, 居中)
- **副标题**: "Everything you need in one command center." (16px, #9ca3af, 居中)
- **面板网格**: margin-top: 64px

```
CSS Grid: grid-template-columns: repeat(3, 1fr); gap: 24px;
max-width: 1100px; margin: 0 auto;

每个面板卡片:
  - 背景: #0d1117
  - 边框: 1px #1e2530, border-top: 2px #e8a748
  - 圆角: 8px
  - padding: 32px
  - hover: background → #111827, border-color → rgba(232,167,72,0.25),
           box-shadow: 0 0 24px rgba(232,167,72,0.06)
  - transition: all 0.3s ease

卡片内容:
  [amber icon, 24x24, stroke style]
  [标题, 18px, 600, #e5e7eb, margin-top: 16px]
  [描述, 14px, 400, #9ca3af, margin-top: 8px, 2-3 行]
```

**6 个面板内容**:
1. Tiling Terminals — 全屏平铺终端, 多面板并行
2. Chat History — 搜索/浏览 AI 对话历史
3. File Explorer — 项目文件树浏览
4. Config Editor — 可视化 CLI 配置管理
5. Skill Market — 发现/安装/评分 Skill 包
6. Multi-CLI — Claude Code, Codex, Gemini CLI 统一管理

### 4.3 核心功能深度展示 (3 个全宽 Section, 交替布局)

每个 section 展示一个核心功能, 左右交替排列 (图左文右 → 图右文左 → 图左文右)。

**通用结构**:
- padding: 120px 上下
- max-width: 1100px
- 两栏: 55% 截图 + 45% 文字, gap: 64px, align-items: center
- 背景: `#0a0e14`, section 之间用 1px `#1e2530` 分隔线 (max-width: 200px, 居中)

**Section 4.3.1: Tiling Terminals**
```
[左: 产品截图 — 多终端平铺状态]
  - border-radius: 8px
  - border: 1px #1e2530
  - 进入动画: 从左滑入 (translateX(-20px→0), opacity 0→1)

[右: 文字区]
  "Full-screen tiling terminals"
  (36px, 600, #e5e7eb)

  "像平铺窗口管理器一样操控多个终端。2x2、3x1、
  自定义布局，每个面板独立运行不同的 CLI 工具。"
  (16px, 400, #9ca3af, margin-top: 16px)

  [功能要点, margin-top: 24px]
  每行: amber 圆点 (6px) + 文字 (14px, #e5e7eb)
  - 灵活的网格布局: 2x2, 3x1, 自定义
  - 独立 resize 和 focus 切换
  - 每个面板显示前台进程状态
```

**Section 4.3.2: Chat History** (图右文左)
- 类似结构, 截图展示聊天历史搜索界面
- 关键点: 全文搜索、按时间/项目过滤、一键导出

**Section 4.3.3: Skill Market** (图左文右)
- 截图展示 Skill 市场界面
- 关键点: AI 评分系统、一键安装、版本管理

### 4.4 CLI 工具支持条

- **背景**: `#06080c` (更深, 视觉节奏变化)
- **padding**: 80px 上下
- **布局**: 居中, flex column

```
"Works with your favorite AI CLIs"
(24px, 600, #e5e7eb, text-align: center)

[三个 CLI 工具 logo + 名称, 水平排列, gap: 64px, margin-top: 48px]
  每个: [Logo icon 40x40] + [名称 16px 500 #9ca3af] + [状态点 8px #4ade80 "Supported"]
  hover: 名称变 #e5e7eb, logo 微放大 scale(1.05)
```

### 4.5 安装/快速开始

- **背景**: `#0a0e14`
- **padding**: 120px 上下
- **布局**: 居中, max-width: 640px

```
"Get started in 30 seconds"
(36px, 600, #e5e7eb, text-align: center)

[安装步骤, margin-top: 48px]
三步, 每步:
  [步骤编号: amber 圆圈 (28px, 2px border amber, 内含数字 14px amber)]
  [命令行代码块]
    - 背景: #161b22
    - 字体: JetBrains Mono, 14px
    - padding: 16px 20px
    - border-radius: 8px
    - 右上角: 复制按钮 (icon, hover 显示)
    - 代码高亮: 命令前缀 $ 用 #4b5563, 命令用 #e5e7eb, 参数用 #e8a748

步骤 1: $ brew install --cask muxvo
步骤 2: $ muxvo
步骤 3: "选择你的 CLI 工具, 开始工作" (文字, 非代码)
```

### 4.6 底部 CTA

- **背景**: `#06080c` + 大面积 amber 径向光晕 `radial-gradient(ellipse 60% 50% at 50% 60%, rgba(232,167,72,0.10) 0%, transparent 70%)`
- **padding**: 120px 上下
- **布局**: 居中

```
"Ready to take control?"
(36px, 600, #e5e7eb, text-align: center)

"Download Muxvo and transform your AI CLI workflow."
(16px, 400, #9ca3af, text-align: center, margin-top: 12px)

[Download for macOS] — amber 实心大按钮, padding 16px 40px, 圆角 8px
(margin-top: 40px)

[GitHub star count badge, margin-top: 24px, 14px, #9ca3af]
```

### 4.7 Footer

- **背景**: `#06080c`
- **顶部边框**: 1px `#1e2530`
- **padding**: 48px 上下
- **布局**: max-width: 1100px, 三栏 (logo+版权 | 链接列 | 链接列)

```
[左栏]
  Muxvo logo (amber, 小号)
  "AI CLI Workbench" (13px, #4b5563)
  "© 2026 Muxvo" (13px, #4b5563, margin-top: 8px)

[中栏: Product]
  Features / Download / Changelog / Roadmap
  (13px, #9ca3af, hover: #e5e7eb, 行间距 28px)

[右栏: Community]
  GitHub / Discord / Twitter
  (13px, #9ca3af, hover: #e5e7eb, 行间距 28px)
```

---

## 5. 动画规格

### 5.1 总体原则
- 所有动画必须响应 `prefers-reduced-motion: reduce` → 完全禁用
- 单页面同时运行动画上限: 3 个
- CSS-only 优先, 仅 scroll-triggered 可见性用 Intersection Observer
- 默认 easing: `cubic-bezier(0.16, 1, 0.3, 1)` (ease-out-expo)

### 5.2 入场动画

| 元素 | 效果 | 时长 | 延迟 | 触发 |
|------|------|------|------|------|
| Hero 标题 | opacity 0→1, translateY(16px→0) | 0.6s | 0s | 页面加载 |
| Hero 副标题 | opacity 0→1, translateY(16px→0) | 0.6s | 0.1s | 页面加载 |
| Hero 按钮 | opacity 0→1, translateY(16px→0) | 0.6s | 0.2s | 页面加载 |
| Hero 截图 | opacity 0→1, translateY(20px→0) | 0.8s | 0.3s | 页面加载 |
| 功能面板卡片 | opacity 0→1, translateY(12px→0) | 0.5s | stagger 0.08s | 进入视口 |
| 深度展示截图 | opacity 0→1, translateX(±20px→0) | 0.6s | 0s | 进入视口 |
| 深度展示文字 | opacity 0→1 | 0.5s | 0.1s | 进入视口 |

### 5.3 交互动画

| 元素 | 效果 | 时长 |
|------|------|------|
| 面板卡片 hover | background 渐变 + box-shadow 出现 | 0.3s ease |
| 按钮 hover | background 变亮 (→ #f0c060) + scale(1.02) | 0.2s ease |
| 导航链接 hover | color 变亮 | 0.15s ease |
| 代码块复制按钮 | click 后 icon 变 checkmark, 1.5s 后恢复 | 0.2s |

### 5.4 滚动联动 (Scroll-triggered)

- 使用 `IntersectionObserver` (threshold: 0.15) 触发入场动画
- 每个 section 仅触发一次 (不重复)
- 不使用 scroll-jacking 或 scroll-snap (保持自然滚动体验)

---

## 6. 响应式策略

### 6.1 断点

| 断点 | 宽度 | 标记 |
|------|------|------|
| Desktop | >= 1024px | 默认 |
| Tablet | 768px - 1023px | `md` |
| Mobile | < 768px | `sm` |

### 6.2 Desktop (>= 1024px)

- 所有内容如上述规格
- max-width: 1100px, 左右 auto margin
- 面板网格: 3 列
- 功能深度展示: 左右两栏

### 6.3 Tablet (768px - 1023px)

- 面板网格: 2 列 (第 5-6 个面板宽度 span 1, 正常流)
- 功能深度展示: 改为上下排列 (截图全宽在上, 文字在下)
- Hero 标题: 44px
- Section padding: 96px 上下
- 整体左右 padding: 32px

### 6.4 Mobile (< 768px)

- 面板网格: 1 列
- 功能深度展示: 上下排列, 截图宽度 100%
- Hero 标题: 36px, 副标题: 16px
- Hero 截图: 宽度 100%, 圆角减小到 8px
- Section padding: 64px 上下
- 整体左右 padding: 20px
- CLI 工具条: 垂直堆叠
- 导航: 汉堡菜单, 全屏 overlay (背景 #0a0e14, amber 链接)
- 所有 translateX 入场动画改为 translateY (避免水平溢出)
- 径向光晕尺寸减半, 透明度不变 (保持 amber 品牌感)

### 6.5 移动端 CTA 特殊处理

移动端用户看到桌面应用不会立即下载。底部 CTA 区域:
- 主按钮: "Star on GitHub" (替代 Download)
- 次按钮: "Send me the download link" → 展开 email input
- 保留 Download 链接但降为文字链

---

## 7. 性能预算

| 指标 | 目标 |
|------|------|
| First Contentful Paint | < 1.2s |
| Largest Contentful Paint | < 2.5s (Hero 截图) |
| Total Page Weight | < 800KB (不含字体) |
| 字体文件 | DM Sans 400/600/700 + JetBrains Mono 400 = ~250KB (woff2) |
| 图片 | WebP, Hero 截图 < 300KB, 功能截图各 < 150KB |
| JS Bundle | < 20KB (仅 Intersection Observer + 汉堡菜单 + 代码复制) |
| CSS | < 15KB (minified) |
