# Spec 08: Split Persona / 双面对比叙事

> 设计理念：竞品官网都在说"我有多好"。Muxvo 先说"没有我有多痛"。每个 section 都是一个 Before/After 对比：左侧（或上方）展示用户当前碎片化的 AI CLI 工作流痛点，右侧（或下方）展示 Muxvo 的整合方案。这种叙事方式在 dev tool 官网中极为罕见，能触发用户的情感共鸣——"对，这就是我的日常"。

---

## 1. 色彩系统

### 1.1 核心色板

| 角色 | 色值 | 用途 |
|------|------|------|
| **Before 侧（痛点侧）** | | |
| BG Before | `#12141a` | Before 区域背景（冷灰偏蓝） |
| BG Before Card | `#1a1c24` | Before 侧的窗口/面板卡片 |
| Border Before | `#2a2d38` | Before 侧边框（冷灰） |
| Text Before Primary | `#a0a4b0` | Before 侧主文字（刻意偏暗，传达"不够好"） |
| Text Before Dim | `#5a5e6a` | Before 侧次要文字 |
| **After 侧（Muxvo 侧）** | | |
| BG After | `#06080c` | After 区域背景（标准 Muxvo 深色） |
| BG After Card | `#0d1117` | After 侧面板卡片 |
| Border After | `#1e2530` | After 侧默认边框 |
| Border After Active | `#e8a74860` | After 侧活跃边框（amber 发光） |
| Text After Primary | `#f5f5f5` | After 侧主文字（明亮，传达"清晰"） |
| Text After Secondary | `#9ca3af` | After 侧次要文字 |
| **共用色** | | |
| Amber Primary | `#e8a748` | 品牌色，仅出现在 After 侧 + 分割线 |
| Amber Light | `#f5c563` | Hover 状态 |
| Divider Glow | `#e8a748` → transparent | Before/After 分割线渐变光 |
| Success | `#4ade80` | After 侧的"已解决"标记 |

### 1.2 关键色彩规则

- **Before 侧没有 amber**。这是最重要的规则。Before 侧的世界是冷灰、无色彩的——暗示缺少"那道光"。
- **After 侧引入 amber 后**，视觉温度骤变。这个温度差就是 Muxvo 的价值可视化。
- Amber 占比约 **15-18%**（集中在 After 侧和分割线），Before 侧完全零 amber。

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
| Hero 标题 | 64px | 48px | 36px | 700 | 1.1 |
| Section 标题 | 36px | 32px | 28px | 700 | 1.2 |
| Before 标签 | 14px | 13px | 13px | 600 | 1.0 |
| After 标签 | 14px | 13px | 13px | 600 | 1.0 |
| 功能标题 | 24px | 22px | 20px | 600 | 1.3 |
| 正文 | 17px | 16px | 15px | 400 | 1.6 |
| 辅助文字 | 14px | 14px | 13px | 400 | 1.5 |

### 2.3 Before/After 标签样式

```css
.label-before {
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #5a5e6a;
  font-family: var(--font-mono);
}
.label-after {
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #e8a748;
  font-family: var(--font-mono);
}
```

---

## 3. 页面结构与 Section 详细规格

### 3.1 整体页面结构

```
[Navigation Bar]                    — 标准深色导航
[Section 1: Hero / 分屏宣言]         — 左 Before 右 After 的首屏
[Section 2: 痛点 1 / 终端混乱]       — Before/After 对比
[Section 3: 痛点 2 / 聊天记录散落]    — Before/After 对比（左右翻转）
[Section 4: 痛点 3 / 配置碎片化]      — Before/After 对比
[Section 5: 全景展示]                — 纯 After 视角，完整产品截图
[Section 6: CTA]                    — 下载区域
[Footer]
```

叙事节奏：痛点 → 解决方案 → 痛点 → 解决方案 → 最终全景 → CTA

---

### 3.2 Navigation Bar

**布局**：
- 高度：64px
- 背景：`rgba(6, 8, 12, 0.9)` + `backdrop-filter: blur(12px)`
- 内容同 Spec-02，但 Download 按钮是唯一的 amber 元素

---

### 3.3 Section 1: Hero / 分屏宣言

**布局**（桌面）：
- 全宽，高度 `100vh`（最小 680px）
- **左右分屏**：左 50% Before 侧，右 50% After 侧
- 中间有一条垂直 amber 分割线

**左侧（Before）**：
- 背景：`#12141a`
- 内容（垂直居中，右对齐，`padding-right: 64px`）：
  ```
  标签：WITHOUT MUXVO（#5a5e6a, mono, 14px, uppercase）
  标题：Scattered terminals.（#a0a4b0, 48px, 700）
        Lost conversations.
        Endless switching.
  ```
- 下方：3-4 个小窗口 mockup 互相重叠、倾斜，模拟混乱的桌面
  - 窗口背景：`#1a1c24`，边框 `#2a2d38`
  - 窗口标题栏带灰色圆点（模拟 macOS 窗口按钮，但是灰色不是彩色——暗示"无生气"）
  - 窗口微旋转 `rotate(-3deg)` 到 `rotate(5deg)`，互相遮挡

**右侧（After）**：
- 背景：`#06080c`
- 内容（垂直居中，左对齐，`padding-left: 64px`）：
  ```
  标签：WITH MUXVO（#e8a748, mono, 14px, uppercase）
  标题：One command center.（#f5f5f5, 48px, 700）
        Everything in sight.
        Always in control.
  ```
- 下方：Muxvo 产品截图（整齐的多面板布局）
  - 截图边框 `1px solid #e8a74840`
  - 微弱 amber 外发光：`box-shadow: 0 0 48px rgba(232, 167, 72, 0.1)`

**中间分割线**：
- 宽度 2px
- 渐变色：
  ```css
  background: linear-gradient(
    to bottom,
    transparent 10%,
    #e8a74860 30%,
    #e8a748 50%,
    #e8a74860 70%,
    transparent 90%
  );
  ```
- 分割线中心有一个小圆形 amber 光点（直径 8px），是视觉焦点

**动画**：
- 页面加载：左侧内容从左侧 `translateX(-24px)` 渐入，右侧内容从右侧 `translateX(24px)` 渐入
- 时长 800ms，`ease-out`，左右同时但有 100ms 延迟差
- 分割线从中心向上下"生长"：`scaleY(0 → 1)`，600ms

**响应式**：
- <1024px：左右分屏变为**上下分屏**。Before 在上（背景 `#12141a`），After 在下（背景 `#06080c`）。分割线变为水平。
- <768px：标题 36px，padding 缩小

---

### 3.4 Section 2: 痛点 1 — 终端混乱

**布局**（桌面）：
- 全宽，`padding: 100px 0`
- 左右分栏：Before 侧 50% | After 侧 50%
- 内部容器：1200px 居中

**Before 侧（左 50%）**：
- 背景：`#12141a`（延伸到页面左边缘）
- 内容区 `padding: 48px`：
  ```
  标签：// THE PROBLEM（#5a5e6a, mono）
  标题：Terminal tab hell（#a0a4b0, 28px, 700）
  描述：6 个终端窗口。3 个项目。无数次 Cmd+Tab。
        你知道 Claude Code 在哪个窗口里跑着，但找到它
        需要 15 秒。（#5a5e6a, 16px）
  ```
- 配图：多个终端窗口互相遮挡的截图/mockup
  - 窗口标题显示不同路径：`~/project-a`、`~/project-b`
  - 窗口间有红色小叉标记（`#ef444460`，极低透明度），暗示"混乱"

**After 侧（右 50%）**：
- 背景：`#06080c`
- 内容区 `padding: 48px`：
  ```
  标签：// THE SOLUTION（#e8a748, mono）
  标题：Tiling terminals（#f5f5f5, 28px, 700）
  描述：全屏网格布局。每个终端都有固定位置。
        一眼看到所有正在运行的 CLI 工具。
        不再切换，因为一切都在视野中。（#9ca3af, 16px）
  ```
- 配图：Muxvo 平铺终端的截图
  - 整齐的 2x2 网格
  - 截图边框带 amber：`border: 1px solid #e8a74830`

**中间分隔**：
- 与 Hero 相同的垂直 amber 渐变线，但更细（1px）、更淡

**响应式**：
- <1024px：上下排列，Before 在上 After 在下，分割线变为水平

---

### 3.5 Section 3: 痛点 2 — 聊天记录散落（左右翻转）

**布局同 Section 2，但左右翻转**：After 在左，Before 在右。
打破单调的"永远左边是问题右边是方案"，形成交替节奏。

**Before 侧（右）**：
```
标签：// THE PROBLEM
标题：Where was that conversation?
描述：Claude 三天前建议了一个架构方案，但你不记得在哪个 session 里。
      打开 ~/.claude/history，翻了 20 个 JSON 文件。放弃了。
```
- 配图：文件列表 mockup，一堆 `.json` 文件名，毫无规律

**After 侧（左）**：
```
标签：// THE SOLUTION
标题：Chat history search
描述：全文搜索所有 AI CLI 对话记录。
      输入关键词，跨 session、跨工具，秒级返回。
```
- 配图：Muxvo 聊天搜索界面截图

---

### 3.6 Section 4: 痛点 3 — 配置碎片化

**布局同 Section 2（Before 左，After 右）**。

**Before 侧**：
```
标签：// THE PROBLEM
标题：Config file scavenger hunt
描述：Claude 的配置在 ~/.claude/，Codex 在另一个路径，
      Gemini CLI 又是另一个格式。每次改配置都要查文档。
```
- 配图：3 个不同路径的配置文件片段并排，格式各异

**After 侧**：
```
标签：// THE SOLUTION
标题：Visual config editor
描述：所有 AI CLI 配置集中管理。
      可视化编辑，不再手动改 JSON/YAML。
```
- 配图：Muxvo 配置编辑器截图

---

### 3.7 Section 5: 全景展示（纯 After 视角）

**布局**：
- 全宽，背景：`#06080c`
- `padding: 100px 24px`
- 这是唯一一个不做 Before/After 对比的 section——全部是"After"状态

**内容**：
```
居中标题：See the full picture.（#e8a748, 48px, 700）
副标题：Everything your AI CLI workflow needs. One workbench.（#9ca3af, 18px）
```

- 下方：一张完整的 Muxvo 全景产品截图（宽度 1100px），展示所有面板同时运行的状态
- 截图处理：
  - `border-radius: 12px`
  - `border: 1px solid #e8a74840`
  - `box-shadow: 0 0 80px rgba(232, 167, 72, 0.12), 0 4px 32px rgba(0, 0, 0, 0.4)`
  - 背景有微弱的 amber 径向渐变光晕（同 Spec-02 Hero 的手法）

**这个 section 的作用**：
- 在连续 3 个 Before/After 对比之后，给用户一个"全局视角"的解脱感——不再是碎片化的对比，而是完整的产品全景
- 视觉上也是从 Before/After 分屏布局跳转到全宽布局，节奏变化明显

**响应式**：
- <768px：截图宽度 `calc(100vw - 32px)`

---

### 3.8 Section 6: CTA

**布局**：
- 背景分两段：
  - 上半部分：`#12141a`（Before 色调——最后一次回忆痛点）
  - 下半部分：`#06080c` + amber 渐变光（After 色调——引向解决方案）
- 内容居中

**内容**：
```
上方小字：Still switching between 6 terminal windows?（#5a5e6a, 16px — Before 的声音）

主标题：Take control.（#f5f5f5, 48px, 700）

CTA：[Download for macOS]（amber 实心按钮）[View on GitHub]（透明边框按钮）

下方小字：Free and open source.（#9ca3af, 14px）
```

**视觉**：
- 上方小字是最后一次"Before 声音"（冷灰色、痛点文案），与下方的解决方案 CTA 形成最后的对比
- 背景从 `#12141a` 渐变到 `#06080c`，在 CTA 按钮处有 amber 径向光晕
- CTA 按钮样式同 Spec-02

**响应式**：
- <768px：`padding: 64px 24px`，标题 36px

---

### 3.9 Footer

**布局同 Spec-02**，标准深色 footer，无 Before/After 分屏。

---

## 4. 动画方案

### 4.1 核心动画：Before → After 切入

每个 Before/After section 的动画逻辑：

1. **用户滚动到 section 时**：Before 侧先显示（opacity 渐入，300ms）
2. **Before 侧显示后 400ms**：分割线从中心向上下"生长"（scaleY，300ms）
3. **分割线完成后**：After 侧从右侧（或左侧）滑入（translateX + opacity，500ms）

这个"先痛后治"的时序让用户在看到解决方案之前先感受到痛点。

### 4.2 Before 侧混乱窗口动画

Hero 区域的 Before 侧窗口 mockup：
- 3-4 个窗口卡片，初始状态是整齐排列
- 进入视口后 500ms 内微旋转到最终的"混乱"状态
- 使用 `transform: rotate()` + `translate()`，随机偏移

### 4.3 After 侧截图"归位"动画

对应 Before 的"混乱"：After 侧的 Muxvo 截图在进入视口时：
- 从微旋转（`rotate(1deg)`）回到正位（`rotate(0)`）
- 边框从 `#1e2530` 渐变为 `#e8a74840`
- 这个"归位"感和 Before 的"散乱"形成动画层面的对比

### 4.4 分割线持续动画

分割线中心的小 amber 光点有微弱的辉光呼吸：
```css
@keyframes glow-pulse {
  0%, 100% { box-shadow: 0 0 8px rgba(232, 167, 72, 0.3); }
  50% { box-shadow: 0 0 16px rgba(232, 167, 72, 0.5); }
}
```
周期 3s，`ease-in-out`

### 4.5 禁止的动画

- 不使用滑块（slider）做 Before/After 切换——太 cliche
- 不使用 3D transforms
- 不使用 parallax
- Before 侧的"混乱"不要过度——微旋转 3-5 度即可，不要做成"爆炸散落"

---

## 5. 响应式策略

### 5.1 断点

```css
@media (min-width: 1280px)  { /* 桌面：左右分屏 */ }
@media (min-width: 1024px) and (max-width: 1279px) { /* 小桌面：左右分屏但比例调整 */ }
@media (min-width: 768px) and (max-width: 1023px) { /* 平板：上下分屏 */ }
@media (max-width: 767px) { /* 手机：上下分屏，简化 */ }
```

### 5.2 分屏适配策略

| 屏幕 | Before/After 排列 | 分割线方向 | 混乱窗口 mockup |
|------|-------------------|-----------|-----------------|
| 桌面 (>=1024px) | 左右 50%/50% | 垂直 | 完整展示 3-4 个 |
| 平板 (768-1023px) | 上下排列 | 水平 | 简化为 2-3 个 |
| 手机 (<768px) | 上下排列 | 水平细线 | 简化为 2 个或仅用文字描述 |

### 5.3 手机端特殊处理

- Before/After 标签在手机端更重要（因为没有左右空间暗示），需要加大标签的视觉权重
- Before 标签加背景色块：`background: #2a2d38; padding: 4px 12px; border-radius: 4px`
- After 标签加背景色块：`background: #e8a74820; padding: 4px 12px; border-radius: 4px`

---

## 6. 关键设计决策记录

| 决策 | 结论 | 原因 |
|------|------|------|
| Before 侧用什么色调？ | 冷灰蓝 `#12141a` | 与 After 侧的暖色 `#06080c + amber` 形成温度差 |
| Before 侧是否完全灰色？ | 是，零 amber | amber = Muxvo 的光，Before = 没有 Muxvo 的世界 |
| 分割线用什么？ | Amber 渐变线 + 中心光点 | 分割线本身是"Muxvo 介入"的视觉隐喻 |
| Before/After 是否用 slider？ | 否 | 滑块太常见，用左右/上下分屏更有冲击力 |
| 痛点文案的调性？ | 轻度共鸣，不制造焦虑 | 描述真实场景（"6 个窗口切换"），不用夸张语气 |
| 需要几个 Before/After 对比？ | 3 个 | 少于 3 个不够有说服力，多于 3 个用户疲劳 |
| 最后是否需要纯 After section？ | 是（Section 5 全景） | 连续对比后需要"解脱感"，全景截图提供完整画面 |
| CTA 区域是否保留 Before 元素？ | 是，一句话（最后的痛点回忆） | 在按下下载前最后一次提醒"为什么需要 Muxvo" |
