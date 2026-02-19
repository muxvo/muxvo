# Spec 04: Mission Control + Terminal Hero — 终端入场版

> 作者: Designer-2 | 核心理念: CLI 输入 -> GUI 展开的微交互传达产品核心价值，正文回归高效面板布局

---

## 1. 全局设计参数

### 1.1 配色系统

```
/* 背景层级 */
--landing-bg-deep:      #06080c    /* 页面最底层、footer */
--landing-bg-primary:   #0a0e14    /* 主内容区背景 */
--landing-bg-card:      #0d1117    /* 面板卡片背景 */
--landing-bg-elevated:  #161b22    /* 悬浮元素、代码块背景 */
--landing-bg-hover:     #1c2333    /* 卡片 hover 态 */

/* Amber 系统（占比 15-18%） */
--landing-amber:        #e8a748    /* 主品牌色 */
--landing-amber-hover:  #f0c060    /* hover 高亮 */
--landing-amber-glow:   #e8a74820  /* 径向光晕（Hero 背景） */
--landing-amber-border: #e8a74840  /* 面板上边框 */
--landing-amber-muted:  #e8a74812  /* 极淡环境光 */

/* 文字 */
--landing-text-hero:    #ffffff    /* Hero 区标题（纯白 vs 极暗背景，最大对比） */
--landing-text-primary: #d4d4d8    /* 正文主文字 */
--landing-text-secondary: #71717a  /* 次要说明 */
--landing-text-muted:   #3f3f46    /* 极弱提示 */

/* 终端专用色（仅 Hero 区） */
--landing-term-prompt:  #e8a748    /* $ 提示符 */
--landing-term-cmd:     #d4d4d8    /* 命令文字 */
--landing-term-cursor:  #e8a748    /* 光标 */
--landing-term-success: #4ade80    /* 命令执行成功反馈 */

/* 边框 */
--landing-border:       #1e2530
--landing-border-focus: #e8a74855
```

### 1.2 排版系统

```
/* 字体 */
--font-sans:  'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif
--font-mono:  'JetBrains Mono', 'Menlo', 'Monaco', monospace

/* 字号层级（桌面端 / 移动端） */
Hero 标题:       48px / 32px,  font-weight: 700,  line-height: 1.1,  letter-spacing: -0.02em
Hero 副标题:     20px / 16px,  font-weight: 400,  line-height: 1.5
Section 标题:    36px / 28px,  font-weight: 700,  line-height: 1.2,  letter-spacing: -0.01em
Section 副标题:  16px / 14px,  font-weight: 400,  line-height: 1.6
卡片标题:        18px / 16px,  font-weight: 600,  line-height: 1.3
卡片描述:        14px / 13px,  font-weight: 400,  line-height: 1.6
终端文字:        16px / 14px,  font-weight: 400,  line-height: 1.7,  font-family: var(--font-mono)
按钮文字:        15px / 14px,  font-weight: 600
```

### 1.3 间距系统

```
页面最大宽度:     1200px（内容区），居中
页面左右 padding: 64px / 24px（桌面 / 移动）
Section 间距:     120px / 80px
卡片间距 (gap):   20px / 16px
卡片内 padding:   24px / 20px
```

### 1.4 圆角系统

```
面板卡片:   8px
按钮:       6px
终端窗口:   12px（顶部）, 0（底部，与展开截图融合）
代码块:     6px
```

---

## 2. 页面结构（5 个 Section）

### Section 1: Terminal Hero（首屏）

**高度**: 100vh（视口全高）
**背景**: --landing-bg-deep (#06080c) + 中心径向 amber 光晕

#### 2.1.1 终端窗口组件

位置: 页面正中偏上（距顶部 25vh），水平居中
尺寸: 最大 800px 宽 x 自适应高

```
终端窗口结构:
┌──────────────────────────────────────────────────┐
│  ● ● ●   muxvo — zsh                            │  <- 标题栏: bg #161b22, 高度 36px
├──────────────────────────────────────────────────┤
│                                                  │
│  $ muxvo launch                                  │  <- amber 提示符 + 白色命令
│  ✓ Workbench ready                               │  <- 成功反馈（绿色），短暂显示
│                                                  │
│  [ 产品截图在此展开 ]                               │  <- 动画展开区域
│                                                  │
└──────────────────────────────────────────────────┘
```

- 标题栏: 三个圆点（#3f3f46 / #3f3f46 / #3f3f46，非红绿黄，避免 macOS 过度模拟）
- 终端背景: #0a0e14
- 边框: 1px solid #1e2530

#### 2.1.2 CLI -> GUI 转场动画

动画流程（总时长 2.5 秒，页面加载后 0.3 秒延迟开始）:

```
Phase 1 (0.0s - 0.6s): 打字
  - "$ muxvo launch" 逐字出现
  - 打字速度: 每字符 50ms
  - 光标: 2px 宽 amber 竖线，闪烁频率 530ms

Phase 2 (0.6s - 0.9s): 执行
  - 光标停止闪烁
  - 短暂停顿 300ms（模拟"执行中"）

Phase 3 (0.9s - 1.2s): 反馈
  - 新行出现: "✓ Workbench ready"
  - ✓ 用 --landing-term-success (#4ade80)
  - 文字用 --landing-text-primary

Phase 4 (1.2s - 2.5s): 展开
  - 终端窗口平滑扩展（height transition, ease-out, 800ms）
  - 命令行文字向上推移，产品截图从底部渐入（opacity 0->1 + translateY 20px->0）
  - 终端边框保留，截图在终端窗口"内部"展示
  - 同时：背景 amber 光晕从小范围扩展到大范围（scale 0.5->1, opacity 调整）
```

**跳过机制**:
- 用户点击终端窗口或按任意键: 立即跳到 Phase 4 结束态
- 用户向下滚动: 立即跳到 Phase 4 结束态
- 二次访问（localStorage 标记）: 直接显示结束态，无动画

**性能要求**:
- 仅使用 CSS transitions (transform, opacity, height)，不触发 layout reflow
- 无 JavaScript 驱动的逐帧动画，打字效果用 CSS steps() + overflow-hidden 实现
- 降级方案: prefers-reduced-motion 下直接显示结束态

#### 2.1.3 Hero 文案层

位置: 终端窗口上方

```
标题:   "The command center for your AI CLI tools."
        字体: DM Sans 700, 48px, #ffffff
        距终端窗口: 32px

副标题: "Manage Claude Code, Codex, and Gemini CLI from one workbench."
        字体: DM Sans 400, 20px, #71717a
        距标题: 12px
```

#### 2.1.4 CTA 按钮

位置: 终端窗口下方 40px（展开完成后显示，fade-in 300ms）

```
主按钮:
  文字: "Download for macOS"
  背景: #e8a748
  文字色: #06080c
  padding: 14px 32px
  border-radius: 6px
  hover: background #f0c060, box-shadow 0 0 20px #e8a74840

次按钮（右侧，间距 16px）:
  文字: "View on GitHub"
  背景: transparent
  边框: 1px solid #1e2530
  文字色: #d4d4d8
  hover: border-color #e8a74855, color #e8a748
```

#### 2.1.5 背景光晕

```css
.hero-glow {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 800px;
  height: 600px;
  background: radial-gradient(ellipse at center, #e8a74812 0%, transparent 70%);
  pointer-events: none;
  z-index: 0;
}
```

---

### Section 2: 核心价值主张（"Not a terminal"）

**背景**: #0a0e14（与 Hero 无缝过渡）
**内容宽度**: 800px 居中

```
布局:
┌─────────────────────────────────────────────┐
│                                             │
│     Not a terminal. Not an IDE.             │  <- 36px, #71717a (灰色弱化)
│     A workbench.                            │  <- 36px, #e8a748 (amber 强调)
│                                             │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐     │
│  │ Tiling  │  │  Chat   │  │  Skill  │     │
│  │Terminals│  │ History │  │ Market  │     │
│  │  icon   │  │  icon   │  │  icon   │     │
│  │ 一句话  │  │ 一句话  │  │ 一句话  │     │
│  └─────────┘  └─────────┘  └─────────┘     │
│                                             │
└─────────────────────────────────────────────┘
```

三列卡片:
- 容器: 三等分，gap 20px
- 每个卡片: 背景 #0d1117, border 1px #1e2530, border-top 2px #e8a74840, padding 24px
- 图标: 32x32, amber 线条图标（不是填充图标），居卡片顶部
- 卡片标题: 18px 600, #d4d4d8, 距图标 16px
- 卡片描述: 14px 400, #71717a, 距标题 8px, 最多两行

**滚动点亮**: 整个 section 在进入视口 30% 时 fade-in (opacity 0->1, translateY 20px->0, duration 600ms, ease-out)。一次性，不反复。

---

### Section 3: 功能展示面板矩阵

**背景**: #06080c -> #0a0e14 微妙渐变（增加层次感）
**内容宽度**: 1200px

#### 2.3.1 Section 标题

```
标题:   "Everything you need. Nothing you don't."
        36px 700, #ffffff, 居中
副标题: "Built for developers who live in the terminal."
        16px 400, #71717a, 居中, 距标题 12px
```

#### 2.3.2 面板网格

```
桌面端布局 (>= 1024px):  2 列 x 3 行, gap 20px
平板端布局 (768-1023px):  2 列 x 3 行, gap 16px
移动端布局 (< 768px):     1 列, gap 16px

┌──────────────────┐  ┌──────────────────┐
│  [截图区域]       │  │  [截图区域]       │
│  240px 高         │  │  240px 高         │
│                   │  │                   │
│  功能标题          │  │  功能标题          │
│  一句话描述        │  │  一句话描述        │
└──────────────────┘  └──────────────────┘
```

6 个功能面板内容:

| # | 标题 | 描述 | 截图内容 |
|---|------|------|----------|
| 1 | Tiling Terminal Grid | 全屏平铺多终端，拖拽调整布局 | 4 格终端网格截图 |
| 2 | Chat History Search | 跨 session 搜索所有 AI 对话 | 搜索界面 + 结果列表截图 |
| 3 | File Browser | 在终端旁直接浏览项目文件 | 文件树面板截图 |
| 4 | Config Visual Editor | 可视化编辑 CLAUDE.md 和设置 | 配置编辑器截图 |
| 5 | Skill Marketplace | 发现、安装、管理社区 Skill 包 | 市场列表截图 |
| 6 | AI Scoring | 每个 Skill 的 AI 质量评分 | 评分详情面板截图 |

#### 2.3.3 面板卡片样式

```css
.feature-card {
  background: #0d1117;
  border: 1px solid #1e2530;
  border-top: 2px solid #e8a74840;
  border-radius: 8px;
  overflow: hidden;           /* 截图区域填满卡片顶部 */
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.feature-card:hover {
  border-color: #e8a74855;
  box-shadow: 0 0 24px #e8a74810;
}

.feature-card__image {
  width: 100%;
  height: 240px;
  object-fit: cover;
  object-position: top left;  /* 截图从左上角开始，保证关键 UI 元素可见 */
}

.feature-card__body {
  padding: 20px 24px 24px;
}

.feature-card__title {
  font: 600 18px/1.3 var(--font-sans);
  color: #d4d4d8;
}

.feature-card__desc {
  font: 400 14px/1.6 var(--font-sans);
  color: #71717a;
  margin-top: 8px;
}
```

#### 2.3.4 滚动点亮动画

- 每张卡片在进入视口 20% 时触发独立的 fade-in
- 动画: opacity 0->1, translateY 16px->0, duration 500ms, ease-out
- 卡片之间有 80ms 的交错延迟（stagger），从左到右、从上到下
- 实现: Intersection Observer + CSS class toggle，不用 JS 动画库

---

### Section 4: CLI 支持矩阵

**背景**: #0a0e14
**内容宽度**: 800px 居中
**目的**: 明确展示支持的 AI CLI 工具，降低"这个工具支持我用的 CLI 吗"的不确定性

```
布局:
┌─────────────────────────────────────────────────┐
│                                                 │
│     "Works with your favorite AI CLIs"          │
│                                                 │
│  ┌─────────────┐ ┌─────────────┐ ┌───────────┐ │
│  │  Claude     │ │   Codex     │ │  Gemini   │ │
│  │  Code       │ │             │ │   CLI     │ │
│  │  [logo]     │ │   [logo]    │ │  [logo]   │ │
│  │  Anthropic  │ │   OpenAI    │ │  Google   │ │
│  └─────────────┘ └─────────────┘ └───────────┘ │
│                                                 │
│     "More CLIs coming soon."                    │
│                                                 │
└─────────────────────────────────────────────────┘
```

工具卡片样式:
- 背景: #0d1117, border 1px #1e2530, border-radius 8px
- Logo: 48x48, 居中，灰度显示（filter: grayscale(1) brightness(0.7)），hover 还原彩色
- 工具名: 16px 600, #d4d4d8, 居中
- 公司名: 13px 400, #71717a, 居中
- 三等分布局, gap 20px

---

### Section 5: Final CTA

**背景**: 从 #0a0e14 渐变到 #06080c（600px 高的线性渐变），底部叠加大面积 amber 环境光

```
布局:
┌─────────────────────────────────────────────────┐
│                                                 │
│    amber 径向光晕（从 CTA 按钮向外扩散）          │
│                                                 │
│     "Ready to take control?"                    │  <- 36px 700 #ffffff
│     "Download Muxvo and unify your AI CLI       │
│      workflow in minutes."                      │  <- 16px 400 #71717a
│                                                 │
│     [ Download for macOS ]  [ GitHub ]          │  <- 与 Hero CTA 样式一致
│                                                 │
│     v0.x.x · macOS · MIT License                │  <- 13px 400 #3f3f46
│                                                 │
└─────────────────────────────────────────────────┘
```

CTA 区域的 amber 光晕:
```css
.cta-glow {
  position: absolute;
  bottom: 10%;
  left: 50%;
  transform: translateX(-50%);
  width: 600px;
  height: 400px;
  background: radial-gradient(ellipse at center, #e8a74815 0%, transparent 70%);
  pointer-events: none;
}
```

---

## 3. 响应式策略

### 3.1 断点定义

```
桌面:  >= 1024px  （默认设计基准）
平板:  768-1023px
手机:  < 768px
```

### 3.2 关键变化

| 元素 | 桌面 | 平板 | 手机 |
|------|------|------|------|
| Hero 终端窗口 | 800px 宽 | 90vw | 100vw - 48px |
| 打字动画 | 完整执行 | 完整执行 | 加速到 1.5s |
| 核心价值三列 | 三等分 | 三等分 | 垂直堆叠 |
| 功能面板网格 | 2x3 | 2x3 | 1 列 |
| 功能卡片截图高度 | 240px | 200px | 180px |
| CLI 支持矩阵 | 三列 | 三列 | 三列（缩窄） |
| Section 间距 | 120px | 100px | 80px |

### 3.3 移动端特殊处理

- 终端标题栏的三个圆点缩小到 8px，标题文字缩到 12px
- 功能面板在移动端变为可横向滑动的 carousel（可选，备选方案是纯垂直堆叠）
- 所有 hover 效果在触屏设备上改为 :active 短暂高亮

---

## 4. 动画规范总表

| 动画 | 触发 | 时长 | 缓动 | 降级 |
|------|------|------|------|------|
| Hero 打字效果 | 页面加载 +0.3s | 2.5s | steps (打字), ease-out (展开) | 直接显示最终态 |
| Section fade-in | IntersectionObserver 30% | 600ms | ease-out | 无动画，直接显示 |
| 卡片 stagger | IntersectionObserver 20% | 500ms + 80ms stagger | ease-out | 无动画，直接显示 |
| CTA 按钮 hover | :hover | 200ms | ease | 无过渡 |
| 面板边框 hover | :hover | 200ms | ease | 无过渡 |

**全局降级规则**: `@media (prefers-reduced-motion: reduce)` 下，所有 transition-duration 设为 0ms，所有动画直接显示最终态。

---

## 5. 技术实现要点

### 5.1 CSS 优先原则
- 打字效果: 用固定宽度容器 + `width` animation + `steps()` + `overflow: hidden` 实现，不需要 JS
- 光标闪烁: `@keyframes blink { 50% { opacity: 0; } }` + `animation: blink 1.06s step-end infinite`
- 展开动画: `max-height` transition + `opacity` transition

### 5.2 性能预算
- 首次有意义绘制 (FMP): < 1.5s
- Largest Contentful Paint (LCP): < 2.5s（产品截图需要 lazy load 或预加载策略）
- 总 JS 体积: < 50KB (gzipped)，仅 IntersectionObserver polyfill + 跳过动画逻辑
- 产品截图: WebP 格式，桌面端每张 < 150KB，移动端提供 1x 分辨率版本

### 5.3 无障碍
- 终端动画区域添加 `role="img"` + `aria-label="Muxvo launch animation showing terminal command expanding into product interface"`
- 所有截图添加描述性 alt text
- CTA 按钮 amber 背景 (#e8a748) + 深色文字 (#06080c) 对比度 = 7.2:1 (WCAG AAA)
- 链接和交互元素的 focus-visible 样式: 2px amber outline + 2px offset
