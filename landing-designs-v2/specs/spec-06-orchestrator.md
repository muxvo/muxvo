# Spec 06: Orchestrator — 编排者

> 作者: Designer-2 | 核心理念: 用节点连线图传达"一个工作台编排多个 AI CLI"的独特价值，同时保持信息传达效率

---

## 1. 全局设计参数

### 1.1 配色系统

```
/* 背景层级 */
--landing-bg-deep:      #06080c
--landing-bg-primary:   #0a0e14
--landing-bg-card:      #0d1117
--landing-bg-elevated:  #161b22
--landing-bg-hover:     #1c2333

/* Amber 系统（占比 12-15%） */
--landing-amber:        #e8a748
--landing-amber-hover:  #f0c060
--landing-amber-line:   #e8a74860    /* 连线默认色 */
--landing-amber-line-active: #e8a748 /* 连线 hover/活跃态 */
--landing-amber-glow:   #e8a74818
--landing-amber-dot:    #e8a748      /* 流动光点 */

/* 工具差异色（仅用于节点图标，极小面积） */
--landing-tool-claude:  #e8a748      /* Claude Code = 品牌 amber */
--landing-tool-codex:   #4ade80      /* Codex = 绿 */
--landing-tool-gemini:  #60a5fa      /* Gemini CLI = 蓝 */

/* 文字 */
--landing-text-hero:    #ffffff
--landing-text-primary: #d4d4d8
--landing-text-secondary: #71717a
--landing-text-muted:   #3f3f46

/* 边框 */
--landing-border:       #1e2530
--landing-border-focus: #e8a74855
```

### 1.2 排版系统

```
Hero 标题:       48px / 32px,  DM Sans 700,  line-height 1.1,  letter-spacing -0.02em
Hero 副标题:     20px / 16px,  DM Sans 400,  line-height 1.5
Section 标题:    36px / 28px,  DM Sans 700,  line-height 1.2
Section 副标题:  16px / 14px,  DM Sans 400,  line-height 1.6
节点标签:        14px / 13px,  DM Sans 600,  line-height 1.3
卡片标题:        18px / 16px,  DM Sans 600,  line-height 1.3
卡片描述:        14px / 13px,  DM Sans 400,  line-height 1.6
按钮文字:        15px / 14px,  DM Sans 600
```

### 1.3 间距与尺寸

```
页面最大宽度:     1200px
页面 padding:     64px / 24px（桌面 / 移动）
Section 间距:     120px / 80px
卡片间距:         20px / 16px
卡片内 padding:   24px / 20px
圆角:             卡片 8px, 按钮 6px, 节点 12px
```

---

## 2. 页面结构（5 个 Section）

### Section 1: Hero + 产品截图

**核心决策**: Hero 区不用连线图，用产品截图 + 文案。连线图放在第二屏。原因：用户进入首屏必须 3 秒内看到产品长什么样，连线图虽有概念价值但无法替代截图的直觉传达力。

**高度**: 100vh
**背景**: #06080c + 中心 amber 径向光晕

```
布局:
┌─────────────────────────────────────────────────┐
│                                                 │
│     "One workbench.                             │
│      Three AI CLIs.                             │
│      Total control."                            │  <- 48px 700 #ffffff, 逐行 stagger
│                                                 │
│     "Orchestrate Claude Code, Codex, and        │
│      Gemini CLI from a single interface."       │  <- 20px 400 #71717a
│                                                 │
│     [ Download ]  [ GitHub ]                    │
│                                                 │
│     ┌──────────────────────────────────┐        │
│     │      产品截图（宽屏比例）          │        │
│     │      展示多终端平铺 + 侧面板       │        │
│     └──────────────────────────────────┘        │
│                                                 │
└─────────────────────────────────────────────────┘
```

截图样式:
- 最大宽度 960px, 圆角 12px
- 边框: 1px solid #1e2530
- 阴影: 0 16px 48px rgba(0,0,0,0.4)
- 下方自然渐隐到背景色（底部叠加 linear-gradient 遮罩）

---

### Section 2: 编排图 — 核心价值可视化

**背景**: #0a0e14
**内容宽度**: 1000px
**这是本方案的核心差异化区域**

#### 2.2.1 Section 标题

```
"Your CLI tools, orchestrated."
36px 700 #ffffff, 居中

"Muxvo connects your AI CLIs into one unified workspace."
16px 400 #71717a, 居中
```

#### 2.2.2 编排图布局

```
桌面端（>= 1024px）:

                    ┌─────────────┐
                    │   Muxvo     │  <- 中心节点（最大）
                    │  Workbench  │
                    └──────┬──────┘
                    ╱      │      ╲
              ╱            │            ╲
     ┌──────────┐   ┌──────────┐   ┌──────────┐
     │ Claude   │   │  Codex   │   │ Gemini   │  <- 工具节点
     │  Code    │   │          │   │   CLI    │
     └────┬─────┘   └────┬─────┘   └────┬─────┘
          │              │              │
     ┌────┴─────┐   ┌────┴─────┐   ┌────┴─────┐
     │ Terminal  │   │   Chat   │   │  Config  │  <- 功能节点
     │  Grid    │   │ History  │   │  Editor  │
     └──────────┘   └──────────┘   └──────────┘
```

#### 2.2.3 节点样式

**中心节点 (Muxvo)**:
```css
.node-center {
  width: 160px;
  height: 80px;
  background: #0d1117;
  border: 2px solid #e8a748;
  border-radius: 12px;
  box-shadow: 0 0 32px #e8a74820;
  display: flex;
  align-items: center;
  justify-content: center;
}
.node-center__label {
  font: 600 16px/1.3 var(--font-sans);
  color: #e8a748;
}
```

**工具节点 (Claude/Codex/Gemini)**:
```css
.node-tool {
  width: 140px;
  height: 72px;
  background: #0d1117;
  border: 1px solid #1e2530;
  border-top: 2px solid var(--tool-color);  /* 使用对应工具色 */
  border-radius: 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 16px;
}
.node-tool__icon {
  width: 28px;
  height: 28px;
  /* 工具 logo，灰度 + hover 还原彩色 */
}
.node-tool__label {
  font: 600 14px/1.3 var(--font-sans);
  color: #d4d4d8;
}
```

**功能节点 (Terminal/Chat/Config)**:
```css
.node-feature {
  width: 130px;
  height: 64px;
  background: #161b22;
  border: 1px solid #1e2530;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.node-feature__label {
  font: 400 13px/1.3 var(--font-sans);
  color: #71717a;
}
```

#### 2.2.4 连线样式与动画

连线实现: SVG `<path>` 元素，使用 cubic bezier 曲线

```css
.connection-line {
  stroke: #e8a74840;
  stroke-width: 1.5;
  fill: none;
}
.connection-line:hover {
  stroke: #e8a748;
  stroke-width: 2;
}
```

**光点流动动画**:
```css
.flow-dot {
  r: 3;
  fill: #e8a748;
  filter: drop-shadow(0 0 4px #e8a74880);
}

/* 沿路径移动 */
@keyframes flow {
  0% { offset-distance: 0%; opacity: 0; }
  10% { opacity: 1; }
  90% { opacity: 1; }
  100% { offset-distance: 100%; opacity: 0; }
}

.flow-dot {
  offset-path: path('...');  /* 与连线路径一致 */
  animation: flow 3s ease-in-out infinite;
}
```

- 三条主连线（Muxvo -> 三个工具）的光点有 1s 的 stagger 延迟
- 工具到功能的连线光点在鼠标 hover 工具节点时触发
- `prefers-reduced-motion: reduce` 下隐藏光点，连线保持静态

#### 2.2.5 编排图交互

- **Hover 工具节点**: 该节点的 border-top 变亮，下方连线变亮，对应功能节点高亮
- **Hover 功能节点**: 该功能节点的描述文字出现（tooltip 或侧边面板）
- **移动端**: 编排图简化为垂直布局（Muxvo 在顶部，三个工具节点横排，功能节点省略或折叠）

---

### Section 3: 功能深潜

**背景**: #06080c
**内容宽度**: 1200px

从编排图过渡到详细功能展示。每个功能用"左文右图"或"左图右文"交替布局。

```
桌面端布局:

Feature 1（左文右图）:
┌──────────────────────────────────────────────┐
│  ┌───────────────┐  ┌─────────────────────┐  │
│  │               │  │                     │  │
│  │  Section 标题  │  │    产品截图          │  │
│  │  描述段落      │  │    560px x 360px    │  │
│  │               │  │                     │  │
│  └───────────────┘  └─────────────────────┘  │
│       440px                 680px             │
└──────────────────────────────────────────────┘

Feature 2（左图右文）: 镜像布局
Feature 3（左文右图）: 再交替
```

每个 Feature block:
- 间距: 80px（feature 之间）
- 文字侧: 标题 24px 700 #d4d4d8 + 描述 15px 400 #71717a + 可选的特性列表
- 截图侧: 圆角 8px, border 1px #1e2530, box-shadow 0 8px 32px rgba(0,0,0,0.3)
- 文字侧与截图侧 gap: 60px

特性列表样式:
```
·  Feature point one        <- · 用 amber 色, 文字 #d4d4d8, 14px
·  Feature point two
·  Feature point three
```

展示的 3 个核心功能:
1. **Tiling Terminal Grid** — 全屏终端平铺管理
2. **Chat History & Search** — 跨 session AI 对话搜索
3. **Skill Marketplace + AI Scoring** — 社区 Skill 包 + 质量评分

移动端: 全部变为"文字在上，截图在下"的垂直堆叠。

---

### Section 4: CLI 工具矩阵

**布局和样式**: 与 Spec-04 的 Section 4 完全一致（三列工具卡片，展示 Claude Code / Codex / Gemini CLI）。

增加一个关联元素：在卡片上方展示一条简化的连线（从"Muxvo"标签到三个卡片），呼应 Section 2 的编排图视觉语言。

连线样式: 与 Section 2 一致，但更轻（stroke: #e8a74825, stroke-width: 1），作为视觉呼应而非主角。

---

### Section 5: Final CTA

**布局和样式**: 与 Spec-04 的 Section 5 基本一致。

差异点：CTA 标题改为 "Ready to orchestrate?" 呼应"编排者"主题。

---

## 3. 响应式策略

### 3.1 编排图响应式（关键挑战）

```
桌面 (>= 1024px):
  完整三层编排图（如上所示）

平板 (768-1023px):
  缩小节点尺寸（中心 140x70, 工具 120x64, 功能 110x56）
  连线保持

手机 (< 768px):
  简化布局:
  ┌─────────────┐
  │   Muxvo     │
  └──────┬──────┘
         │
  ┌──────┴──────┐
  │ Claude Code │
  │   Codex     │  <- 三个工具名横排（无节点框）
  │ Gemini CLI  │
  └─────────────┘

  省略功能节点层和连线动画
  改为：工具名下方直接跟功能列表文字
```

### 3.2 其他断点变化

| 元素 | 桌面 | 平板 | 手机 |
|------|------|------|------|
| Hero 截图 | 960px | 90vw | 100vw - 48px |
| 功能深潜 | 左右交替 | 左右交替（缩窄） | 上下堆叠 |
| 功能截图 | 560x360 | 50vw x auto | 100% 宽 x auto |
| Section 间距 | 120px | 100px | 80px |

---

## 4. 动画规范总表

| 动画 | 触发 | 时长 | 缓动 | 降级 |
|------|------|------|------|------|
| Hero 标题 stagger | 页面加载 +0.2s | 每行 400ms, stagger 150ms | ease-out | 直接显示 |
| 编排图绘入 | IntersectionObserver 30% | 节点 fade-in 500ms, 连线 draw-in 600ms | ease-out | 直接显示 |
| 光点流动 | 编排图可见后持续 | 3s/cycle, 无限循环 | ease-in-out | 隐藏光点 |
| 功能区交替 | IntersectionObserver 20% | 600ms, 文字与图片 stagger 200ms | ease-out | 直接显示 |
| 节点 hover | :hover | 200ms | ease | 无过渡 |

**连线 draw-in 效果**:
```css
.connection-line {
  stroke-dasharray: var(--line-length);
  stroke-dashoffset: var(--line-length);
  transition: stroke-dashoffset 600ms ease-out;
}
.connection-line.visible {
  stroke-dashoffset: 0;
}
```

---

## 5. 与 Spec-04 的关键差异

| 维度 | Spec-04 (Terminal Hero) | Spec-06 (Orchestrator) |
|------|------------------------|----------------------|
| 核心隐喻 | "终端命令打开工作台" | "一个中心编排多个工具" |
| Hero 焦点 | 终端动画 + 截图展开 | 产品截图 + 文案 |
| 第二屏 | 三列价值主张卡片 | 节点连线编排图（核心差异区域） |
| 功能展示 | 2x3 面板网格 | 左右交替深潜布局 |
| 视觉动画重心 | Hero 区的 CLI->GUI 转场 | 编排图的连线绘入 + 光点流动 |
| 信息架构 | 宽而浅（6 个功能并列） | 窄而深（3 个功能详细展开） |
| 适合场景 | 用户想快速概览所有功能 | 用户想理解"为什么需要统一工作台" |
