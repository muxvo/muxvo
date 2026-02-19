# Spec 02: Amber Signal Maximalist / 琥珀信号极致版

> 设计理念：当所有 dev tool 官网都在 5% amber 点缀的冷色海洋中时，Muxvo 把 amber 占比拉到 25-30%，成为唯一的"暖色异类"。用户在浏览器标签页切换时、在推特截图传播时，一眼识别："就是那个金色的。"

---

## 1. 色彩系统

### 1.1 核心色板

| 角色 | 色值 | 用途 |
|------|------|------|
| Amber Primary | `#e8a748` | 品牌主色，CTA 按钮、标题文字、活跃态 |
| Amber Light | `#f5c563` | Hover 状态、高亮强调、光晕中心 |
| Amber Deep | `#b8860b` | 渐变深部、amber 背景 section 的底色渐变 |
| Amber Muted | `#c4943c` | 金属质感渐变中间色、按钮渐变 |
| Background Primary | `#06080c` | 主背景（深色 section） |
| Background Elevated | `#0d1117` | 卡片背景、面板背景 |
| Background Surface | `#161b22` | 次级面板、hover 态背景 |
| Border Default | `#1e2530` | 默认边框色 |
| Text Primary | `#f5f5f5` | 深色背景上的主文字 |
| Text Secondary | `#9ca3af` | 深色背景上的次要文字 |
| Text On Amber | `#06080c` | Amber 背景上的文字（纯深色） |
| Text On Amber Secondary | `#1e2530` | Amber 背景上的次要文字 |

### 1.2 Amber 面积分配策略

整站 amber 色调视觉面积目标：**25-30%**。具体分配如下：

| 区域 | Amber 面积 | 实现方式 |
|------|-----------|---------|
| Hero 背景光晕 | 大面积径向渐变 | `radial-gradient(ellipse at 50% 40%, #e8a74830 0%, transparent 70%)` |
| 核心卖点条 (Section 2) | 全宽 amber 色带 | 实色 `#e8a748` 背景 + `#06080c` 文字 |
| 功能区标题装饰 | 左侧 4px amber 竖线 | `border-left: 4px solid #e8a748` |
| CTA 区域 (最后一屏) | 大面积 amber 渐变背景 | 线性渐变 `#b8860b` → `#e8a748` → `#b8860b` |
| 按钮 (全局) | 实心 amber | `background: linear-gradient(135deg, #e8a748, #c4943c)` |
| 深色 section 标题 | Amber 色文字 | `color: #e8a748` |

### 1.3 禁止使用的颜色

- 不引入蓝色、紫色、绿色等其他色相
- 不使用纯白 `#ffffff` 做大面积背景
- 不使用低饱和度黄色（避免"脏黄"）

---

## 2. 排版系统

### 2.1 字体栈

```css
--font-display: 'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif;
--font-mono: 'JetBrains Mono', 'Fira Code', monospace;
```

### 2.2 字号与层级

| 层级 | 桌面 (>=1280px) | 平板 (768-1279px) | 手机 (<768px) | 字重 | 行高 |
|------|-----------------|-------------------|---------------|------|------|
| Hero 标题 | 72px | 56px | 40px | 700 | 1.1 |
| Section 标题 | 48px | 40px | 32px | 700 | 1.2 |
| 卖点条数字 | 64px | 48px | 36px | 700 | 1.0 |
| 功能标题 | 24px | 22px | 20px | 600 | 1.3 |
| 正文 | 18px | 17px | 16px | 400 | 1.6 |
| 辅助文字 | 14px | 14px | 13px | 400 | 1.5 |
| 代码/命令 | 15px | 14px | 13px | 400 (mono) | 1.5 |

### 2.3 排版规则

- Hero 标题和 Section 标题使用 `letter-spacing: -0.02em`（紧凑感）
- Amber 背景 section 的标题使用 `text-transform: none`（不全大写，保持亲和力）
- Amber 底 section 内文字颜色一律为 `#06080c`，不使用白色或浅色
- 数字统计类内容使用 monospace 字体 + amber 色

---

## 3. 页面结构与 Section 详细规格

### 3.1 整体页面结构

```
[Navigation Bar]           — 固定顶部，深色半透明
[Section 1: Hero]          — 深色底 + amber 光晕
[Section 2: 核心卖点条]     — ★ AMBER 反转色带（amber 底 + 深色字）
[Section 3: 功能展示]       — 深色底，功能卡片
[Section 4: CLI 工具支持]   — 深色底，工具 logo 展示
[Section 5: Skill 市场]    — ★ AMBER 反转色带（第二次出现）
[Section 6: 用户场景]       — 深色底，场景描述
[Section 7: 开始使用 CTA]   — ★ AMBER 渐变背景（最强烈）
[Footer]                   — 深色底
```

标注 ★ 的 section 使用 amber 背景，形成"暗-亮-暗-暗-亮-暗-亮-暗"的视觉节奏。

---

### 3.2 Navigation Bar

**布局**：
- 高度：64px
- 背景：`rgba(6, 8, 12, 0.85)` + `backdrop-filter: blur(12px)`
- 最大宽度容器：1200px，居中
- 左侧：Muxvo logo（amber 色）+ 产品名
- 右侧：导航链接（Features / Skill Market / Docs / GitHub）+ Download 按钮
- Download 按钮：amber 实心按钮，`border-radius: 8px`，`padding: 8px 20px`

**交互**：
- 滚动超过 80px 后 nav 出现底部 `1px solid #1e2530` 分割线
- 导航链接 hover：文字变 `#e8a748`

**响应式**：
- <768px：右侧链接折叠为汉堡菜单，Download 按钮保留

---

### 3.3 Section 1: Hero

**布局**（桌面）：
- 高度：`100vh`（最小 680px）
- 内容居中排列（flex column, align-items: center）
- 上方：标题 + 副标题 + CTA 按钮组
- 下方：产品截图（带 amber 边框发光）

**内容**：
```
标题：Your AI CLI Mission Control
副标题：Tiling terminals. Chat history. Skill marketplace.
      One workbench for Claude Code, Codex, and Gemini CLI.
CTA：[Download for macOS]（amber 实心）  [View on GitHub]（透明边框）
截图：Muxvo 产品界面全景截图，展示多面板平铺状态
```

**视觉效果**：
- 背景：`#06080c` + 大面积 amber 径向渐变
  ```css
  background:
    radial-gradient(ellipse 800px 600px at 50% 35%, rgba(232, 167, 72, 0.18) 0%, transparent 100%),
    #06080c;
  ```
- 产品截图：`border-radius: 12px`，`border: 1px solid #e8a74840`，`box-shadow: 0 0 80px rgba(232, 167, 72, 0.12)`
- 标题 "Mission Control" 两个词用 amber 色（`#e8a748`），其余用 `#f5f5f5`

**动画**：
- 页面加载时截图从 `opacity: 0; transform: translateY(24px)` 渐入，时长 800ms，`ease-out`
- Amber 径向渐变有微弱的"呼吸"动画：透明度在 0.15-0.20 之间缓慢波动，周期 6s

**响应式**：
- <1280px：截图宽度从 1000px 缩小到 90vw
- <768px：高度改为 `auto`，`min-height: 100vh`。标题 40px，副标题单列，CTA 按钮垂直堆叠

---

### 3.4 Section 2: 核心卖点条（Amber 反转色带 #1）

**布局**：
- 全宽 amber 色带
- 背景色：`#e8a748`
- 内部容器：1200px 居中，`padding: 40px 24px`
- 三栏 grid：`grid-template-columns: repeat(3, 1fr)`，`gap: 48px`

**内容**：
```
栏 1：[图标] 3 AI CLIs / 一个工作台管理三大 AI CLI 工具
栏 2：[图标] Tiling Layout / 全屏平铺，终端不再互相遮挡
栏 3：[图标] Skill Market / AI 评分的 Skill 市场
```

**视觉**：
- 文字颜色：`#06080c`（标题/数字）和 `#1e2530`（说明文字）
- 图标：24x24，深色描线风格（不是 amber 色——在 amber 底上用深色图标）
- 每栏数字/关键词用 `font-size: 36px; font-weight: 700`
- 无圆角，无内阴影，纯实色块——与深色 section 形成最强对比

**响应式**：
- <768px：三栏变为单列，每栏之间用 1px `#06080c20` 分割线

---

### 3.5 Section 3: 功能展示

**布局**：
- 背景：`#06080c`
- 内部容器：1200px 居中，`padding: 80px 24px`
- Section 标题居中：`color: #e8a748`
- 功能卡片：2 列 grid（桌面），每个卡片高度 auto
  ```css
  grid-template-columns: repeat(2, 1fr);
  gap: 24px;
  ```

**功能卡片设计**：
- 每张卡片结构：上方小截图 (16:10 比例) + 下方标题和描述
- 卡片背景：`#0d1117`
- 卡片边框：`1px solid #1e2530`
- 卡片上边框：`border-top: 2px solid #e8a748`（amber 标识线，呼应指挥中心面板风格）
- `border-radius: 8px`
- `padding: 0`（截图区域无 padding）+ `padding: 24px`（文字区域）
- 标题：`#f5f5f5`，20px，600 字重
- 描述：`#9ca3af`，16px，400 字重

**展示功能（4 张卡片）**：
1. 平铺终端管理 — 全屏网格布局，终端不再互相遮挡
2. 聊天历史搜索 — 跨 session 全文搜索 AI 对话记录
3. 配置可视化编辑 — 可视化管理 claude/codex/gemini 配置
4. Skill 市场 + AI 评分 — 社区 Skill 包，AI 自动评分

**交互**：
- Hover 时卡片 `border-color: #e8a74860`，`box-shadow: 0 0 24px rgba(232, 167, 72, 0.08)`
- 截图区域 hover 时微放大 `transform: scale(1.02)`，时长 300ms

**响应式**：
- <768px：单列排列

---

### 3.6 Section 4: CLI 工具支持

**布局**：
- 背景：`#0a0e14`（略浅于主背景，做层次区分）
- 内部容器：1200px 居中，`padding: 60px 24px`
- 居中标题 + 三个工具 logo 横排

**内容**：
```
标题：One workbench. Three AI CLIs.（amber 色标题）
工具展示：
  [Claude Code logo] + "Claude Code" + 一句话描述
  [Codex logo] + "Codex" + 一句话描述
  [Gemini CLI logo] + "Gemini CLI" + 一句话描述
```

**视觉**：
- 三个工具用 `grid-template-columns: repeat(3, 1fr)` 排列
- 每个工具区块居中对齐：logo (48x48) → 工具名 (20px, #f5f5f5, 600) → 描述 (15px, #9ca3af)
- Logo 外圈有极微弱的 amber ring：`box-shadow: 0 0 0 1px #e8a74830`
- 工具之间用垂直分隔线：`1px solid #1e2530`

**响应式**：
- <768px：三列变为三行垂直排列，分隔线变为水平

---

### 3.7 Section 5: Skill 市场（Amber 反转色带 #2）

**布局**：
- 全宽 amber 背景色带（第二次出现 amber 反转）
- 背景：渐变 `linear-gradient(135deg, #b8860b, #e8a748 50%, #b8860b)`（比 Section 2 的纯实色更有深度）
- 内部容器：1200px，`padding: 64px 24px`
- 左右分栏：左侧文案 (5/12 宽)，右侧 Skill 卡片预览 (7/12 宽)

**内容**：
```
左侧：
  标题：Skill Marketplace（#06080c, 48px, 700）
  描述：社区驱动的 Skill 包生态。每个 Skill 经 AI 自动评分，
        质量一目了然。（#1e2530, 18px）
  CTA：[Explore Skills]（深色按钮 #06080c 底 + #f5f5f5 字）

右侧：
  2-3 个 Skill 卡片 mockup，卡片白色/浅色底，展示评分星星等
  卡片带轻微阴影，在 amber 背景上"浮起"
```

**视觉**：
- Skill 卡片背景：`#fffbf0`（暖白色），`border-radius: 12px`
- 卡片内评分区域用 amber 星星图标
- 右侧卡片微错位排列（非完全对齐），带 `box-shadow: 0 8px 32px rgba(6, 8, 12, 0.2)`

**响应式**：
- <768px：左右分栏变为上下排列，卡片横向滚动

---

### 3.8 Section 6: 用户场景

**布局**：
- 背景：`#06080c`
- 内部容器：1200px，`padding: 80px 24px`
- 居中标题 + 单列内容，每个场景为左右交替布局

**内容**（2-3 个场景）：
```
场景 1：多项目并行开发
  左图：Muxvo 平铺 4 个终端的截图
  右文：切换项目不再丢失终端状态……

场景 2：AI 对话回溯
  右图：聊天历史搜索界面截图
  左文：三天前那段 Claude 对话说了什么来着？……
```

**视觉**：
- 场景图片：`border-radius: 12px`，`border: 1px solid #1e2530`
- 图文比例：图 7/12，文 5/12
- 文字区域：标题 `#f5f5f5` 28px 700，描述 `#9ca3af` 17px 400
- 每个场景标题前有 amber 编号（`01.`、`02.`），`font-family: var(--font-mono)`, `color: #e8a748`

**响应式**：
- <768px：图文全部变为上下排列（图上文下）

---

### 3.9 Section 7: CTA 区域（Amber 渐变背景——最强烈）

**布局**：
- 全宽渐变背景——整个页面中 amber 最强烈的区域
- 背景：
  ```css
  background: linear-gradient(180deg,
    #06080c 0%,
    #b8860b 15%,
    #e8a748 50%,
    #b8860b 85%,
    #06080c 100%
  );
  ```
- 内部容器居中，`padding: 100px 24px`
- 内容纵向排列居中

**内容**：
```
标题：Ready to take control?（#06080c, 48px, 700）
副标题：Download Muxvo. Launch your workbench.（#1e2530, 20px）
CTA：[Download for macOS]（深色按钮 #06080c 底 + #f5f5f5 字，大号 padding: 16px 40px）
次级链接：View on GitHub / Read the docs（#1e2530，带下划线）
```

**视觉**：
- 这是全页的"引力终点"——amber 浓度最高的区域，视觉上形成终结感
- CTA 按钮在 amber 背景上使用深色（反转），确保对比度和点击欲望
- 按钮 hover：`background: #0d1117`，`box-shadow: 0 0 24px rgba(6, 8, 12, 0.3)`

**响应式**：
- <768px：`padding: 64px 24px`，标题 32px

---

### 3.10 Footer

**布局**：
- 背景：`#06080c`
- 内部容器：1200px，`padding: 48px 24px`
- 四列 grid：Product / Resources / Community / Legal
- 底部：版权信息 + Muxvo logo（amber 色小号）

**视觉**：
- 列标题：`#f5f5f5`，14px，600 字重，`text-transform: uppercase`，`letter-spacing: 0.05em`
- 链接：`#9ca3af`，14px，hover 变 `#e8a748`
- 上边框：`1px solid #1e2530`

---

## 4. 动画方案

### 4.1 原则

- **性能优先**：仅使用 `transform` 和 `opacity` 做动画（GPU 加速）
- **不使用 WebGL/Canvas**：所有效果纯 CSS + 少量 JS（Intersection Observer）
- **`prefers-reduced-motion` 尊重**：减少动画模式下禁用所有非必要动画

### 4.2 滚动触发动画（Intersection Observer）

| 元素 | 进入动画 | 时长 | 缓动 |
|------|---------|------|------|
| 功能卡片 | `opacity: 0 → 1`, `translateY(24px → 0)` | 600ms | `ease-out` |
| 场景图片 | `opacity: 0 → 1`, `translateX(±24px → 0)` | 700ms | `ease-out` |
| 统计数字 | 数字从 0 递增到目标值 | 800ms | `ease-out` |
| Amber 色带 section | 无动画，即时显示（amber 色带是"硬切"，增强节奏感） |

### 4.3 持续动画

| 元素 | 动画 | 时长 | 说明 |
|------|------|------|------|
| Hero amber 光晕 | 透明度 0.15 ↔ 0.20 呼吸 | 6s 循环 | `ease-in-out` |
| CTA 按钮 amber 辉光 | `box-shadow` 强度 0.1 ↔ 0.2 | 3s 循环 | 仅 Hero 和最终 CTA |

### 4.4 禁止的动画

- 不使用 parallax 滚动
- 不使用打字机效果
- 不使用粒子系统
- 不使用 3D transforms

---

## 5. 响应式策略

### 5.1 断点

```css
/* 桌面 */
@media (min-width: 1280px) { /* 1200px 容器 */ }
/* 小桌面/大平板 */
@media (min-width: 768px) and (max-width: 1279px) { /* 90vw 容器 */ }
/* 手机 */
@media (max-width: 767px) { /* 全宽 - 32px padding */ }
```

### 5.2 核心适配策略

| 元素 | 桌面 | 平板 | 手机 |
|------|------|------|------|
| Hero 标题 | 72px 居中 | 56px 居中 | 40px 左对齐 |
| Amber 色带内容 | 三栏 | 三栏（间距缩小） | 单列 |
| 功能卡片 | 2 列 grid | 2 列 grid | 单列 |
| 场景区域 | 图文左右排列 | 图文左右排列（比例调整） | 图上文下 |
| Skill 市场 | 左文右卡片 | 左文右卡片 | 上文下卡片 |
| 导航栏 | 全展开 | 全展开 | 汉堡菜单 |

### 5.3 Amber 反转色带在手机端

- 保持全宽 amber 背景（这是品牌差异化核心，不因响应式而削弱）
- 内部内容从多栏变为单列
- `padding` 从 40px 减小到 32px

---

## 6. 关键设计决策记录

| 决策 | 结论 | 原因 |
|------|------|------|
| Amber 背景上用什么字色？ | `#06080c` 深色 | 白字在 amber 上对比度不够 (WCAG AA 不通过)，深色字对比度 > 7:1 |
| Amber 反转色带出现几次？ | 2 次 + 1 次渐变 CTA | 少于 2 次"amber 主导"说服力不足，多于 3 次视觉疲劳 |
| 是否使用 glow/blur 效果？ | 仅 Hero 的径向渐变 | 大面积 amber 本身已足够有冲击力，过多 glow 会变得廉价 |
| 卡片是否用 amber 边框？ | 仅 top border 2px | 四边 amber 框太重，top border 兼顾"面板标识"感和视觉克制 |
| 手机端是否保留 amber 色带？ | 是 | 色彩差异化是核心策略，必须在所有设备上保持 |
