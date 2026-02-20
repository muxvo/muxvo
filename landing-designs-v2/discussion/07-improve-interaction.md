# 07-terminal-native 交互改进建议

> 核心诊断：Hero 区用 ASCII art + typewriter 建立了"你在终端里"的心智模型，但滚动到下方后，所有 section 都退化成了"静态网页 + fade-in"，终端的沉浸感断裂了。改进的核心思路是：**让每个 section 都有独特的、来自终端世界的交互语言，而不是千篇一律的 fade-in。**

---

## 建议 1：Features 区 -- "Tab 补全"式渐进揭示

**改什么**：`#features` 区的 4 张 GUI Card 的出现方式

**怎么改**：
- 用户滚动到 Features 区时，先只显示命令行 `$ muxvo --features`，然后光标闪烁等待
- 用户按 Tab 键（或自动触发），逐个"补全"出 feature 卡片，伴随终端补全音效的视觉模拟（短暂的高亮闪烁）
- 每张卡片以"从单行文本展开为卡片"的方式出现：先显示一行摘要文字（如 `[01] Tiling Terminals`），然后像 `cat` 命令输出一样向下展开出完整描述
- 不按 Tab 也会在 1.5s 后自动触发，确保纯滚动用户不会卡住

**技术实现**：监听 `keydown` 事件的 Tab 键 + IntersectionObserver 作为 fallback 自动触发。卡片初始 `max-height: 1.4em; overflow: hidden`，触发后 transition 到 `max-height: 200px`。

**为什么更特别**：Tab 补全是终端用户最本能的操作。当用户发现"按 Tab 真的有反应"时，会产生"这个页面居然懂我"的惊喜感，建立起"这个页面是可交互的终端"的预期。

---

## 建议 2：Tools 区 -- "tree 命令实时输出流"逐行渲染

**改什么**：`#tools` 区的 tree 结构展示

**怎么改**：
- 滚动进入视口时，tree 不是一次性出现，而是逐行"打印"出来，模拟 `tree` 命令的实时输出
- 每行间隔 80-120ms（模拟真实终端输出速度），树枝字符（├── └──）先以灰色出现，工具名再以 amber 高亮"写入"
- 当三个工具都展开完毕后，底部的 `3 tools, 9 integrations` 以绿色闪现，模拟命令执行完毕的 summary 输出
- 如果用户快速滚过，检测到 section 即将离开视口时立即完成全部渲染（不让用户看到半成品）

**技术实现**：每个 `<div>` 行初始 `display:none`，用 `requestAnimationFrame` + 计时器逐个设为 `display:block`，配合 `opacity` 从 0 到 1 的短过渡。用一个 `IntersectionObserver` 监听离开视口来做"快速完成"逻辑。

**为什么更特别**：tree 命令的逐行输出是终端用户非常熟悉的视觉节奏。这个交互完美利用了内容本身的结构（tree 就是逐行打印的），让形式和内容统一。

---

## 建议 3：Skills 区 -- "muxvo skills search" 可交互搜索

**改什么**：`#skills` 区从静态卡片展示改为可交互的"搜索体验"

**怎么改**：
- 滚动到 Skills 区时，显示一个真正可输入的命令行 `$ muxvo skills search ___`
- 输入框以终端光标样式呈现，用户可以真的打字（比如输入 "code"、"test"、"doc"）
- 输入时，下方卡片实时筛选/排序，模拟终端中 `grep` 管道的效果：显示 `| grep "code" | sort -k2 -r` 的视觉反馈
- 不输入也可以，默认显示全部卡片（按 score 排序），和当前行为一致
- 在搜索框旁边显示一个暗淡的提示 `# try: code, test, doc`

**技术实现**：一个 styled `<input>` 叠在 `section-cmd` 区域上，用 CSS 让它看起来像终端输入。JS 监听 `input` 事件做简单的字符串匹配过滤。卡片用 `transition` 做显隐。

**为什么更特别**：这创造了"可玩性"--用户会想试试不同的搜索词。更重要的是，它直接演示了产品的核心价值主张（Skill 市场的搜索能力），让着陆页本身变成了产品的微型 demo。

---

## 建议 4：Install 区 -- "真实安装流程"多阶段模拟

**改什么**：`#install` 区的进度条动画

**怎么改**：
- 当前只有一个简单的进度条填充。改为模拟真实的 `npm install` / `brew install` 多阶段输出：
  ```
  $ muxvo install
  ==> Downloading Muxvo v1.0.0 for macOS (arm64)...
  ######################################## 100%
  ==> Verifying checksum... OK
  ==> Installing to /Applications/Muxvo.app
  ==> Linking binary to /usr/local/bin/muxvo
  ==> Post-install: checking dependencies...
       claude-code ✓  codex ✓  gemini-cli ✓
  ✓ Installation complete. Run `muxvo` to get started.
  ```
- 每一行逐步出现（200-400ms 间隔），进度条有真实的数字跳动（0% → 23% → 51% → 78% → 100%），校验阶段有短暂的"转圈"spinner（用 `|/-\` 字符动画）
- 安装完成后，Download 按钮从暗淡变为高亮可点击，伴随一个微妙的 glow 动画

**技术实现**：预定义一个"安装日志"数组，用 `setInterval` 逐条追加到 DOM。进度数字用 `requestAnimationFrame` 做补间。Spinner 用 4 帧字符循环替换。

**为什么更特别**：开发者对安装流程有强烈的既视感和情感联结。当他们看到熟悉的 `==>` 和 `###` 进度条时，会会心一笑。这是"开发者彩蛋"式的设计，让目标用户觉得"这个产品是做给我们的"。

---

## 建议 5：全局 -- "管道传输"式的 Section 过渡

**改什么**：section 之间的过渡方式（替代千篇一律的 fade-in）

**怎么改**：
- 在每两个 section 之间，插入一行"管道命令"过渡，模拟 Unix 管道：
  ```
  $ muxvo --features | head -4
  ... (features 内容)
  $ muxvo --features | pipe --to=tools
  ... (tools 内容)
  ```
- 过渡动画不是 fade-in，而是内容从右侧"流入"（模拟管道中数据流动的方向感），或者从上一个 section 的底部"倾泻"到下一个 section（像 `|` 管道的视觉化）
- 每个 section 的出场方式不同：
  - Features：Tab 补全展开（建议 1）
  - Tools：逐行打印（建议 2）
  - Skills：搜索结果"刷新"式出现（先显示 loading spinner `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`，然后结果弹出）
  - Install：多阶段安装日志（建议 4）

**技术实现**：管道过渡行用 `position: sticky` 短暂粘在视口中，制造"命令正在执行"的错觉，然后输出内容在下方展开。每个 section 的 IntersectionObserver 触发不同的动画函数。

**为什么更特别**：Unix 管道是"终端哲学"的灵魂 -- 小工具组合成强大流程。让每个 section 看起来像是上一个命令的输出被 pipe 到了下一个命令，整个页面就变成了一条完整的命令管道，叙事连贯性大幅提升。

---

## 建议 6：Chrome Bar -- "活的终端标题栏"

**改什么**：顶部固定的 Chrome Bar

**怎么改**：
- Chrome Bar 的标题文字根据当前可见 section 动态变化，模拟终端标题栏的行为：
  - Hero 区：`muxvo — zsh — 120x40`
  - Features 区：`muxvo --features — zsh — [running]`
  - Tools 区：`muxvo --tools — zsh — [running]`
  - Skills 区：`muxvo skills --list — zsh — [3 results]`
  - Install 区：`muxvo install — zsh — [downloading...]` → `[complete]`
- 切换时标题文字做一个快速的"刷新"动画（先清空再重新写入，模拟终端更新标题的闪烁）
- 红黄绿三个圆点增加 hover 交互：hover 红点显示 "x"，hover 黄点显示 "-"，hover 绿点显示 "+"（和 macOS 一致），点击绿点可以触发一个"全屏模式"效果（隐藏 chrome bar，内容扩展到全宽）

**技术实现**：用 IntersectionObserver 监听各 section 的可见性，动态更新 `.chrome-title` 的 `textContent`。标题切换时先 `opacity:0` 再改文字再 `opacity:1`。绿点全屏用 CSS class toggle 控制 chrome bar 的 `display` 和 content 的 `max-width`。

**为什么更特别**：标题栏是终端最容易被忽视但信息密度很高的区域。当用户注意到标题在随着滚动变化时，会增强"我真的在一个终端里"的沉浸感。这是一个低成本但高感知度的细节。

---

## 建议 7：Hero 区 -- "真正可输入的命令行"

**改什么**：Hero 区底部的 `$ _` 闪烁光标

**怎么改**：
- 让这个光标变成一个真正可以打字的输入区域。用户可以输入"命令"：
  - 输入 `help` → 显示可用命令列表（features / tools / skills / install）
  - 输入 `features` → 平滑滚动到 Features section
  - 输入任何未知命令 → 显示 `command not found: xxx. Try "help"` 的红色提示
  - 支持上下箭头浏览"命令历史"（预设几条历史命令）
  - 支持 Tab 补全：输入 `fea` + Tab → 自动补全为 `features`
- 输入框视觉上就是当前的命令行样式，不需要额外的 UI 元素

**技术实现**：一个透明背景的 `<input>`，绝对定位覆盖在 `$ _` 光标位置。用 JS 处理 keydown 事件实现命令解析、Tab 补全和历史浏览。保持一个小型命令映射表 `{ help, features, tools, skills, install }`。

**为什么更特别**：这是最强的"可玩性"设计。用户到达页面后，看到闪烁的光标会本能地想打字。当他们发现真的可以输入命令时，这就变成了一个"探索式体验" -- 用户会想试遍所有命令，停留时间和参与度会显著提升。这也是对产品本身（AI CLI 工具的工作台）最好的隐喻。

---

## 建议 8：全局 -- "stderr 彩蛋"滚动速度反馈

**改什么**：新增一个全局交互层，根据用户滚动速度给反馈

**怎么改**：
- 当用户极快地滚动时（速度超过阈值），在页面底部或侧边短暂显示一行终端 stderr 风格的提示：
  ```
  [warn] scroll speed too fast. you might miss something good.
  ```
  以红/黄色显示，2 秒后淡出
- 当用户在某个 section 停留超过 5 秒时，在该 section 底部显示一行：
  ```
  [info] interested? press Enter to dive deeper.
  ```
  点击/按 Enter 可以展开更多细节（比如 Features 区的卡片展开更详细的描述，Tools 区展开每个工具的具体集成细节）
- 这些"系统消息"使用不同于正文的颜色（比如黄色 warn、红色 error），模拟终端的 stderr 输出

**技术实现**：用一个全局 `scroll` 事件监听器计算滚动速度（`deltaY / deltaTime`）。停留检测用每个 section 的 `IntersectionObserver` + `setTimeout`。提示用一个固定定位的 toast 元素，CSS transition 控制显隐。

**为什么更特别**：这打破了"网页是被动的"预期。终端的 stderr 消息是用户非常熟悉但从未在网页上见过的东西。轻量级的"系统提示"既不打扰浏览，又创造了"这个页面在和我对话"的感觉。快速滚动的 warning 更是一个有趣的彩蛋，会让开发者会心一笑并主动分享。

---

## 优先级排序

| 优先级 | 建议 | 影响力 | 实现复杂度 |
|--------|------|--------|-----------|
| P0 | #2 Tree 逐行渲染 | 高 | 低 |
| P0 | #4 多阶段安装模拟 | 高 | 中 |
| P0 | #6 活的 Chrome Bar | 中 | 低 |
| P1 | #7 可输入命令行 | 很高 | 中 |
| P1 | #1 Tab 补全展开 | 高 | 中 |
| P1 | #5 管道过渡 | 中 | 中 |
| P2 | #3 可交互搜索 | 中 | 中 |
| P2 | #8 stderr 彩蛋 | 低-中 | 低 |

建议先做 P0 的三个（#2 #4 #6），因为它们实现简单、效果显著，能迅速让页面的终端感从 Hero 区扩展到全页面。然后做 P1 的 #7（可输入命令行），这是最大的"wow factor"。
