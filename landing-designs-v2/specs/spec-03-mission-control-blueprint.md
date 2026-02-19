# Spec 03: Mission Control + Blueprint — 蓝图指挥台

> D1 的蓝图概念融入指挥中心框架。精密、工程化、技术制图感。
> 设计师: Designer-1 | 状态: 初稿

---

## 1. 设计理念

把 Muxvo 的"多面板平铺"概念升华为**技术蓝图**——整个页面是一张精密的工程图纸，产品功能是图纸上的标注区域。背景布满低透明度的坐标网格，功能面板通过标注线/引出线与网格系统关联。传达"精密工程、可控、专业"的产品气质。

与 Spec-01 的关键区别:
- 01 是"面板矩阵 + amber 光晕"
- 03 是"坐标网格 + 标注线 + 精密刻度"，amber 更克制、更精确

---

## 2. 配色系统

### 2.1 基础色板

| Token | 色值 | 用途 |
|-------|------|------|
| `--lp-bg-deep` | `#060a10` | 最底层（比 01 偏蓝黑，模拟蓝图纸底色） |
| `--lp-bg-primary` | `#0a0f16` | 主背景（微蓝偏移） |
| `--lp-bg-card` | `#0d1219` | 面板卡片背景 |
| `--lp-bg-elevated` | `#151c25` | 悬浮层 |
| `--lp-text-primary` | `#d1d5db` | 主文字 |
| `--lp-text-secondary` | `#6b7280` | 辅助文字 / 标注说明 |
| `--lp-text-muted` | `#374151` | 坐标数字、极弱文字 |
| `--lp-amber` | `#e8a748` | 品牌主色、标注高亮 |
| `--lp-amber-hover` | `#f0c060` | hover |
| `--lp-amber-grid` | `rgba(232, 167, 72, 0.05)` | 网格线色 |
| `--lp-amber-grid-dot` | `rgba(232, 167, 72, 0.12)` | 网格交叉点 |
| `--lp-amber-annotation` | `rgba(232, 167, 72, 0.35)` | 标注线 |
| `--lp-amber-annotation-text` | `rgba(232, 167, 72, 0.6)` | 标注文字 |
| `--lp-border` | `#1a2130` | 面板边框 |
| `--lp-border-dashed` | `rgba(232, 167, 72, 0.18)` | 虚线边框（蓝图标注框） |

### 2.2 Amber 面积占比目标: 12-15%

比 01 更克制。amber 主要出现在网格线、标注线、交叉点圆点、CTA 按钮。大面积不使用 amber glow（与 01/05 的光晕策略形成区别）。

---

## 3. 排版系统

与 Spec-01 共享字体栈和基础字号体系，以下是差异点:

### 3.1 蓝图特有排版

| 元素 | 字号 | 字重 | 字体 | 颜色 | 说明 |
|------|------|------|------|------|------|
| 坐标刻度数字 | 10px | 400 | mono | `--lp-text-muted` | 网格边缘的坐标标记 |
| 标注引出文字 | 12px | 400 | mono | `--lp-amber-annotation-text` | 从面板拉出的功能说明 |
| 标注编号 | 11px | 600 | mono | `--lp-amber` | 圆圈内的编号 (01, 02, 03...) |
| 面板标题 | 18px | 600 | display | `--lp-text-primary` | 同 01 |

### 3.2 间距

与 Spec-01 相同的 8px 网格系统。背景坐标网格使用 40px 间距（与 8px 基准的 5 倍关系），每 5 条细线画 1 条稍粗线（200px 大网格）。

---

## 4. 背景网格系统 (蓝图核心)

### 4.1 网格实现

全页面背景使用 CSS 多重背景叠加：

```css
.blueprint-bg {
  background:
    /* 大网格 (200px) */
    linear-gradient(var(--lp-amber-grid) 1px, transparent 1px),
    linear-gradient(90deg, var(--lp-amber-grid) 1px, transparent 1px),
    /* 小网格 (40px) */
    linear-gradient(rgba(232,167,72,0.025) 1px, transparent 1px),
    linear-gradient(90deg, rgba(232,167,72,0.025) 1px, transparent 1px),
    /* 基底 */
    var(--lp-bg-primary);
  background-size:
    200px 200px,
    200px 200px,
    40px 40px,
    40px 40px,
    100% 100%;
}
```

### 4.2 网格交叉点圆点

在 200px 大网格的交叉点放置 3px amber 圆点 (`--lp-amber-grid-dot`)。通过 SVG pattern 或伪元素 repeating 实现。

### 4.3 网格边缘坐标刻度

页面左侧固定显示 Y 轴坐标刻度（仅桌面端），间隔 200px:
```
0100 ─
0200 ─
0300 ─
...
```
字号 10px, `--lp-text-muted`, JetBrains Mono。纯装饰性，`aria-hidden="true"`。

### 4.4 网格可见度控制

- 桌面端: 网格完全可见
- 平板端: 隐藏小网格和坐标刻度，仅保留大网格
- 移动端: 隐藏所有网格，保留纯色背景 + 极低透明度点阵（`--lp-amber-grid-dot` repeating）

---

## 5. 页面结构 (Section by Section)

### 5.0 顶部导航栏

与 Spec-01 一致，增加一个细节：导航栏底部边框改为 amber 虚线 (`1px dashed var(--lp-border-dashed)`)，呼应蓝图风格。

### 5.1 Hero Section

- **高度**: 100vh (min 700px, max 900px)
- **背景**: 网格系统 (无额外 amber 光晕，与 01/05 区分)

```
[上间距 ~28vh]

[标注框: 虚线边框 amber, padding 40px, max-width: 780px, 居中]
  ┌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┐
  ╎                                        ╎
  ╎  "The command center for              ╎
  ╎   your AI CLI tools"                  ╎
  ╎  (48px, 700, #e5e7eb)                ╎
  ╎                                        ╎
  ╎  "Precision-engineered workbench..."  ╎
  ╎  (18px, 400, #6b7280)                ╎
  ╎                                        ╎
  ╎  [Download]  [GitHub]                 ╎
  ╎                                        ╎
  └╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘
  左上角标注: "SPEC-01" (10px, mono, amber)

[产品截图, margin-top: 48px]
  max-width: 1060px
  border: 1px dashed var(--lp-border-dashed)
  padding: 4px (截图与虚线框之间的间距)
  内部截图: border-radius: 4px (比 01 更小的圆角, 更精密)

  截图四角各有一个十字准星标记 (+) 用 amber-annotation 色
  截图右侧拉出标注线 →「Tiling Terminal Layout」(12px, mono, amber-annotation-text)
```

### 5.2 功能标注区 (核心差异: 标注线风格)

- **背景**: 网格系统延续
- **padding**: 120px 上下
- **布局**: 居中产品截图 (大尺寸, max-width: 960px) + 四周标注线

**核心交互**: 一张 Muxvo 全界面截图居中，从截图的不同区域**拉出标注线**指向周围的说明卡片。

```
                    [标注卡片: Chat History]
                         ↑ (标注线)
                         |
 [标注卡片] ←———— [  Muxvo 全界面截图  ] ————→ [标注卡片]
 File Explorer           |                     Config Editor
                         |
                         ↓ (标注线)
                    [标注卡片: Skill Market]
```

**标注线规格**:
- 线条: 1px solid `--lp-amber-annotation`
- 起点: 截图内的功能区域 (用 8px amber 圆点标记)
- 终点: 标注卡片的连接边
- 转角: 直角折线 (非曲线, 蓝图风格)
- 终点箭头: 无 (用圆点终止)

**标注卡片规格**:
- 背景: `--lp-bg-card`
- 边框: 1px dashed `--lp-border-dashed`
- padding: 20px
- 左上角: 编号圆圈 (20px, 1px solid amber, 内含数字 11px mono amber)
- 标题: 16px 600 `--lp-text-primary`
- 描述: 13px 400 `--lp-text-secondary`, max 2 行
- hover: 标注线变亮 (`--lp-amber`), 圆点变大 (8→10px), 卡片边框变实线

**进入动画**: 截图先出现, 然后标注线从截图向外"生长" (stroke-dasharray 动画), 最后卡片淡入。每条标注线 stagger 0.15s。

### 5.3 单功能深度展示 (3 个 Section)

与 Spec-01 的 Section 4.3 结构类似 (左右交替), 但有蓝图风格差异:

- 截图容器使用虚线边框而非实线
- 截图角落有坐标标记 (如 `x:120 y:340`, 10px mono muted)
- 文字区的功能要点使用编号 (`01.` `02.` `03.`) 而非圆点
- section 之间的分隔: 一条 amber 水平标注线 + 中间一个编号节点

### 5.4 技术规格条

**蓝图特有 section**: 用技术制图的方式展示 Muxvo 的技术参数。

- **背景**: `--lp-bg-deep` (最深)
- **padding**: 80px 上下
- **布局**: 水平排列的参数块, 用竖线分隔

```
    Supported CLIs         Terminal Panels       Skill Packages
         3                    Up to 9              Open Ecosystem
   Claude Code              Flexible Grid          AI Scoring
   Codex                    2x2, 3x3, Custom       v2 Marketplace
   Gemini CLI               Independent Resize

(每个参数块: 大数字/关键词 24px 600 amber, 细节 13px 400 #6b7280)
(竖线分隔: 1px dashed amber-annotation, 高度 60px)
```

### 5.5 安装/快速开始

与 Spec-01 Section 4.5 类似, 但代码块样式改为:
- 边框: 1px dashed `--lp-border-dashed` (蓝图风格)
- 左侧: 行号 (mono, muted, 蓝图坐标感)
- 代码块上方: "INSTALL PROCEDURE" (10px, mono, amber, letter-spacing: 2px)

### 5.6 底部 CTA

与 Spec-01 Section 4.6 类似, 但:
- 无 amber 径向光晕 (保持蓝图的克制感)
- CTA 按钮使用 1px dashed amber 边框 + amber 文字 (非实心), hover 时填充为实心
- 按钮下方: 一条 amber 标注线指向 "v1.0.0 — macOS" (12px, mono, amber-annotation-text)

### 5.7 Footer

与 Spec-01 一致, 增加底部装饰: 一行坐标刻度 `0000 ─── 0200 ─── 0400 ─── 0600 ─── 0800 ─── 1000` (10px, mono, muted)。

---

## 6. 动画规格

### 6.1 蓝图特有动画

| 元素 | 效果 | 时长 | 说明 |
|------|------|------|------|
| 标注线生长 | stroke-dashoffset 从 100% → 0 | 0.6s | 从截图向外"画线" |
| 标注卡片淡入 | opacity 0→1 | 0.4s | 标注线到达后触发 |
| 标注圆点出现 | scale(0→1) + opacity 0→1 | 0.3s | 和标注线同时 |
| 网格淡入 | 页面加载时网格从 opacity 0→目标值 | 1.0s | 仅首次加载 |
| 坐标刻度滚入 | 左侧 Y 轴刻度随滚动位置更新 | 实时 | `scroll` 事件节流 |

### 6.2 通用动画

同 Spec-01 Section 5, 使用相同的入场动画规格和 Intersection Observer 策略。

---

## 7. 响应式策略

### 7.1 Desktop (>= 1024px)
- 网格完全可见 (大网格 + 小网格 + 交叉点 + Y轴刻度)
- 标注区使用四向标注线
- 所有蓝图装饰元素可见

### 7.2 Tablet (768-1023px)
- 隐藏小网格和 Y 轴坐标刻度
- 保留大网格 + 交叉点圆点
- 标注区改为: 截图在上, 标注卡片在下排成 2x2 网格 (标注线改为从截图底部向下)
- Hero 标注框 padding 减小, 标题 40px

### 7.3 Mobile (< 768px)
- 隐藏所有网格线, 改为极低透明度的均匀点阵背景
- 标注区改为: 截图在上, 功能列表在下 (无标注线, 纯列表)
- 虚线边框统一改为 1px solid `--lp-border` (简化渲染)
- 坐标标记、编号圆圈等装饰性蓝图元素全部隐藏
- Hero 标注框的虚线边框保留 (核心品牌感)

---

## 8. 与 Spec-01 的差异总结

| 维度 | 01 标准版 | 03 蓝图版 |
|------|-----------|-----------|
| 背景 | 纯色 + amber 径向光晕 | 坐标网格 + 交叉点圆点 |
| amber 表现形式 | 光晕、发光、渐变 | 线条、标注、刻度 |
| 面板边框 | 实线 + amber 上边框 | 虚线 + 蓝图标注框 |
| 功能展示 | 独立面板卡片 | 从截图拉出标注线 |
| 整体气质 | 控制台、温暖、沉稳 | 精密、工程化、冷静 |
| 动画核心 | 淡入滑入 | 标注线"生长" |
| 圆角 | 8-12px | 4px (更精密) |

---

## 9. 性能预算

与 Spec-01 一致, 额外注意:
- CSS 网格背景不会增加 DOM 节点, 性能影响微小
- 标注线使用 SVG `<line>` + `stroke-dasharray` 动画, 比 JS Canvas 更高效
- SVG 标注系统总节点数控制在 50 个以内
- 交叉点圆点使用 CSS repeating pattern 而非独立 DOM 元素
