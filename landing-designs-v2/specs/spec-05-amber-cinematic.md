# Spec 05: Amber Cinematic — 暗室聚光版

> 电影光影路线, amber 做唯一光源。沉浸叙事、全屏 section、戏剧节奏。
> 设计师: Designer-1 | 状态: 初稿

---

## 1. 设计理念

整个页面是一间**暗室**——近乎纯黑的空间中，amber 是唯一的光源。每个 section 是一个"被光照亮的舞台"，滚动页面就像在暗室中逐一点亮聚光灯。这种设计的核心不是信息密度（那是 01 的领域），而是**叙事节奏**和**情感沉浸**。用户不是在"扫描功能列表"，而是在"体验一段故事"。

与 Spec-01 的关键区别:
- 01 = 信息密度优先, 面板矩阵, 一屏多内容
- 05 = 叙事沉浸优先, 全屏 section, 一屏一焦点

与 Spec-03 的关键区别:
- 03 = 精密冷静, 线条标注, 工程图纸
- 05 = 戏剧温暖, 光影渐变, 电影镜头感

---

## 2. 配色系统

### 2.1 基础色板

| Token | 色值 | 用途 |
|-------|------|------|
| `--lp-bg-void` | `#030508` | 最深黑（section 间的"void"区域） |
| `--lp-bg-deep` | `#06080c` | 主背景 |
| `--lp-bg-card` | `#0c1018` | 内容卡片（极少使用，大部分内容直接在深黑上） |
| `--lp-text-primary` | `#f3f4f6` | 主文字（比 01 更亮，在极暗背景上需要更高对比度） |
| `--lp-text-secondary` | `#9ca3af` | 辅助文字 |
| `--lp-text-muted` | `#4b5563` | 弱文字 |
| `--lp-amber` | `#e8a748` | 品牌主色 |
| `--lp-amber-bright` | `#f5be5e` | 光源中心（比标准 amber 更亮更暖） |
| `--lp-amber-hover` | `#f0c060` | hover |
| `--lp-amber-glow-strong` | `rgba(232, 167, 72, 0.12)` | 强光晕（section 中心） |
| `--lp-amber-glow-medium` | `rgba(232, 167, 72, 0.06)` | 中等光晕 |
| `--lp-amber-glow-subtle` | `rgba(232, 167, 72, 0.03)` | 微弱光晕（背景氛围） |
| `--lp-amber-text-glow` | `0 0 20px rgba(232, 167, 72, 0.3)` | 文字发光（仅用于 Hero 标题） |
| `--lp-border` | `#141a24` | 边框（比 01 更暗，更隐形） |

### 2.2 Amber 面积占比目标: 18-22%

比 01 更高, 但 amber 主要以**渐变光晕**的形式存在（模糊边缘, 无硬边界），视觉感受不会过于浓烈。

### 2.3 光影系统 (核心差异)

05 的配色核心不是静态色板，而是**光源模型**:

```
光源模型:
  位置: 每个 section 的视觉焦点中心（通常是截图或标题位置）
  形状: 椭圆, 水平宽于垂直 (aspect ratio ~1.5:1)
  衰减: 从中心 --lp-amber-glow-strong → --lp-amber-glow-medium → transparent
  半径: 约 50-60% 的视口宽度
  模糊: 额外叠加 120px blur 的 pseudo-element (增加柔和度)
```

---

## 3. 排版系统

### 3.1 字体栈

同 Spec-01。

### 3.2 字号/字重 (更大、更戏剧化)

| 元素 | 字号 | 字重 | 行高 | 特殊效果 |
|------|------|------|------|----------|
| Hero 主标题 | 64px | 700 | 1.05 | text-shadow: `--lp-amber-text-glow` |
| Hero 副标题 | 22px | 400 | 1.5 | 无 |
| Section 标题 | 44px | 600 | 1.15 | 无 |
| Section 描述 | 18px | 400 | 1.7 | 无 (比 01 更大行高, 增加阅读舒适度) |
| 功能标题 | 24px | 600 | 1.3 | 无 |
| 功能描述 | 16px | 400 | 1.7 | 无 |
| CTA 按钮 | 17px | 600 | 1.0 | 无 |

### 3.3 间距

与 01 的 8px 系统一致, 但 section 间距更大:
- Section padding: 160px 上下 (desktop), 120px (tablet), 80px (mobile)
- 内容区 max-width: 960px (比 01 的 1100px 更窄, 聚焦)

---

## 4. 页面结构 (Section by Section)

### 4.0 顶部导航栏

- 与 Spec-01 基本一致
- 差异: 背景初始完全透明 (Hero 是全屏暗黑), 滚动超过 Hero 后渐变为 `rgba(6,8,12, 0.9)` + blur
- 导航栏底部无边框 (在极暗背景上边框是多余的视觉噪音)

### 4.1 Hero Section — "暗室开灯"

- **高度**: 100vh (min 800px)
- **背景**: `--lp-bg-void` (#030508), 极致纯黑

**加载序列** (电影式入场):

```
Phase 1 (0-0.5s): 纯黑屏幕, 仅中央出现一个微弱的 amber 光点
  - 光点: radial-gradient, 半径 50px, opacity 从 0→0.15

Phase 2 (0.5-1.2s): 光点扩展为光晕, 标题文字淡入
  - 光晕扩展到: 半径 40vw, opacity 0.08
  - 标题淡入: "The command center for your AI CLI tools"
    64px, 700, #f3f4f6, text-shadow: 0 0 20px rgba(232,167,72,0.3)
    opacity 0→1, duration 0.8s

Phase 3 (1.2-1.8s): 副标题和按钮淡入
  - 副标题: 22px, #9ca3af, opacity 0→1, stagger 0.1s
  - 按钮组: 同 stagger

Phase 4 (1.8-2.5s): 产品截图从底部升起
  - translateY(40px→0), opacity 0→1, duration 0.8s
  - 截图自带微弱的 amber 外发光: box-shadow 0 0 80px rgba(232,167,72,0.08)
  - 截图上方有一层微弱的 amber 光照射效果:
    pseudo-element, radial-gradient from top center
```

**注意**: 整个入场序列必须可通过 `prefers-reduced-motion` 跳过（直接显示最终状态）。非 reduced-motion 下，如果用户在 Phase 4 之前开始滚动，立即跳到最终状态。

**截图规格**:
- max-width: 1000px, width: 85vw
- border-radius: 10px
- border: 1px `--lp-border`
- box-shadow: `0 20px 80px rgba(0,0,0,0.6), 0 0 100px rgba(232,167,72,0.06)`

### 4.2 "亮→暗" 过渡区

Hero 和第一个功能 section 之间的过渡:
- 高度: 200px
- 纯 CSS 渐变: 从 Hero 的光晕区域渐变到纯 `--lp-bg-void`
- 无内容, 纯视觉节奏 (暗示"光灭了, 下一盏即将亮起")

### 4.3 功能 Section x3 (每个全屏, 独立光源)

每个功能 section 占据至少 80vh, 有独立的 amber 光源。三个 section 形成"亮→暗→亮→暗→亮"的节奏。

**通用结构**:

```
[Section 背景]
  底色: --lp-bg-void (#030508)
  光源: radial-gradient(ellipse 55% 45% at [光源位置],
        rgba(232,167,72,0.08) 0%,
        rgba(232,167,72,0.03) 40%,
        transparent 70%)
  光源位置: 跟随截图位置 (截图在左则光源偏左, 反之偏右)

[内容: 左右交替, 50% 截图 + 50% 文字]

  截图侧:
    - 截图 max-width: 540px
    - border-radius: 8px
    - border: 1px --lp-border
    - 截图下方: 微弱 amber 反射光 (pseudo-element, 高度 60px,
      linear-gradient from rgba(232,167,72,0.04) to transparent)
      模拟"截图光线在桌面上的反射"

  文字侧:
    - 功能标题: 44px, 600, #f3f4f6
    - 分隔装饰: amber 短线 (width 40px, height 2px, margin-top 20px)
    - 描述: 18px, 400, #9ca3af, margin-top 16px, max-width 420px
    - 功能要点 (margin-top 32px):
      每行: amber 短横线 (12px wide, 2px, inline) + 文字 (16px, #d1d5db)
      行间距: 12px

[Section 间过渡]
  高度: 120px, 纯黑 --lp-bg-void, 无内容
  作用: 制造"光灭了"的节奏呼吸
```

**三个 Section 内容**:

**4.3.1: Tiling Terminals** (截图左, 文字右, 光源偏左)
- 标题: "Full-screen tiling terminals"
- 描述: 多终端平铺, 灵活布局, 独立控制
- 截图: 2x2 终端平铺状态

**4.3.2: Chat History** (截图右, 文字左, 光源偏右)
- 标题: "Search every AI conversation"
- 描述: 全文搜索, 时间线浏览, 导出
- 截图: 聊天历史搜索界面

**4.3.3: Skill Market** (截图左, 文字右, 光源偏左)
- 标题: "Discover, install, and score Skills"
- 描述: Skill 市场, AI 评分, 一键安装
- 截图: Skill 市场界面

### 4.4 CLI 支持区 (暗区中的微光)

与 Spec-01 Section 4.4 类似, 但:
- 背景是 `--lp-bg-void`, 无额外光源 (作为"暗区"节奏)
- 三个 CLI logo 各自带一个极微弱的光点 (8px amber dot, blur 20px), 模拟"仪表盘指示灯"
- 这是整个页面最暗的内容区域, 制造"最后的静默, 准备进入终场"的节奏

### 4.5 安装区

与 Spec-01 Section 4.5 类似, 但:
- 背景有中等强度的 amber 光晕 (比功能区略强)
- 代码块带 amber 左侧竖线 (3px, amber, 替代完整边框)
- 步骤编号: amber 圆点而非圆圈 (实心 12px amber dot)

### 4.6 终场 CTA — "最强光"

这是整个页面 amber 浓度最高的区域, 是叙事的"高潮":

- **背景**: `--lp-bg-void` + 最大面积 amber 光晕
  ```css
  radial-gradient(ellipse 70% 55% at 50% 50%,
    rgba(232,167,72,0.15) 0%,
    rgba(232,167,72,0.06) 40%,
    transparent 70%)
  ```
- **标题**: "Ready to take control?" — 44px, 700, #f3f4f6
- **按钮**: amber 实心, 但比其他 section 的按钮更大:
  - padding: 18px 48px
  - font-size: 17px
  - box-shadow: `0 0 40px rgba(232,167,72,0.2)` (按钮自身发光)
  - hover: box-shadow 扩大到 `0 0 60px rgba(232,167,72,0.3)`, scale(1.03)
- **按钮下方**: "Free and open source. macOS." (14px, #6b7280)

### 4.7 Footer

与 Spec-01 一致, 但:
- 背景使用 `--lp-bg-void` (最深)
- 无顶部边框 (从 CTA 区域的光晕自然过渡到暗)
- 整体 opacity 0.8 → 文字更暗, 制造"落幕"感

---

## 5. 动画规格

### 5.1 总体原则

同 Spec-01, 额外增加:
- 所有光晕的出现/消失使用 `transition: opacity 0.8s ease`, 比其他元素的 0.3-0.6s 更慢, 模拟真实灯光的缓慢变化
- 禁止任何光晕的"闪烁"效果 (abrupt opacity change), 所有变化必须平滑

### 5.2 Hero 入场动画

见 Section 4.1 的 Phase 1-4 详细描述。

### 5.3 Section 光源点亮动画

每个功能 section 在进入视口时触发"光源点亮":

```
触发条件: IntersectionObserver, threshold: 0.2
动画:
  1. 光晕从 opacity 0 → 目标值, duration 0.8s, ease-out
  2. 截图从 translateY(30px) opacity(0) → translateY(0) opacity(1),
     duration 0.7s, ease-out, delay 0.2s
  3. 文字从 opacity(0) → opacity(1), duration 0.5s, delay 0.4s
  4. 截图底部反射光延迟出现: opacity 0→1, duration 0.6s, delay 0.6s

离开视口: 不做任何处理 (不暗回去, 保持亮起状态)
```

### 5.4 光晕呼吸动画 (可选, 极微弱)

页面静止时, 当前可见 section 的光晕有极微弱的"呼吸"效果:
- opacity 在目标值的 ±10% 之间缓慢脉动
- 周期: 6s (极慢, 几乎不可察觉)
- 仅桌面端启用, 平板和移动端禁用
- `prefers-reduced-motion` 下完全禁用

### 5.5 交互动画

同 Spec-01 Section 5.3。

---

## 6. 响应式策略

### 6.1 Desktop (>= 1024px)

- 所有规格如上
- 功能 section: 左右交替两栏
- 光晕尺寸: 如规格所述
- 呼吸动画: 启用
- 内容区 max-width: 960px

### 6.2 Tablet (768-1023px)

- Hero 标题: 48px
- 功能 section: 改为上下排列 (截图全宽在上, 文字在下), 但光源位置改为居中
- 光晕尺寸: 水平半径减少 20%
- Section padding: 120px
- 呼吸动画: 禁用
- Section 间暗区高度: 80px

### 6.3 Mobile (< 768px)

- Hero 标题: 36px, 无 text-shadow (移动端渲染性能)
- Hero 截图: width 100%, 无外发光 box-shadow
- Hero 入场动画简化: 跳过 Phase 1 光点扩展, 直接从 Phase 2 开始 (缩短等待)
- 功能 section: 上下排列, 截图 100% 宽度
- 光晕: 保留但半径和透明度都减半
  - 从 `rgba(232,167,72,0.08)` 降到 `rgba(232,167,72,0.05)`
  - 半径从 55% 降到 35%
- Section 间暗区: 从 120px 减到 40px (移动端不需要过多空白)
- CTA 区域光晕: 保持桌面端的 80% 强度 (移动端的 CTA 依然要有冲击力)
- 导航: 汉堡菜单, 全屏 overlay

### 6.4 移动端 CTA 处理

同 Spec-01 Section 6.5。

---

## 7. 与 Spec-01, Spec-03 的对比

| 维度 | 01 标准版 | 03 蓝图版 | 05 电影版 |
|------|-----------|-----------|-----------|
| 背景基底色 | #0a0e14 | #0a0f16 (偏蓝) | #030508 (极黑) |
| amber 表现 | 光晕+实色混合 | 线条+刻度 | 纯光晕 (无硬边界) |
| 信息密度 | 高 (一屏多卡片) | 高 (标注密集) | 低 (一屏一焦点) |
| 每 section 内容量 | 6 个面板 or 2 栏 | 多标注卡片 | 1 个截图 + 1 段文字 |
| 叙事方式 | 扫描式 | 探索式 | 线性故事 |
| 动画核心 | 淡入滑入 | 标注线生长 | 光源点亮 |
| 整体气质 | 专业、可信 | 精密、工程化 | 沉浸、戏剧、高级 |
| 页面长度 | 中 | 中 | 长 (每 section 更高) |
| 最适合的用户心态 | "快速了解这是什么" | "仔细研究这个工具" | "被打动后想体验" |

---

## 8. 性能预算

| 指标 | 目标 | 备注 |
|------|------|------|
| First Contentful Paint | < 1.0s | Hero 初始是纯黑, FCP 可以很快 |
| Largest Contentful Paint | < 3.0s | Hero 截图在 Phase 4 才出现, LCP 比 01 略高 |
| Total Page Weight | < 900KB | 光晕纯 CSS, 不增加资源体积 |
| CSS 复杂度 | < 20KB | 光晕用 pseudo-element, 比多 DOM 节点更高效 |
| JS Bundle | < 20KB | 同 01 |
| GPU 占用 | 低 | 所有光晕使用 `will-change: opacity` 提示, 避免 layout thrash |
| 同时活跃动画 | <= 2 | 当前 section 的光晕 + 1 个入场动画 |

**性能关键注意**:
- 光晕使用 `::before` / `::after` pseudo-element + `opacity` 动画, 不触发 layout/paint
- 不使用 `filter: blur()` 做实时模糊 (性能杀手), 改用预模糊的大尺寸 radial-gradient
- Hero 入场的光点扩展使用 CSS `@keyframes` + `transform: scale()`, 在 compositor 层完成
