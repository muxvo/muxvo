# Round 2 投票 — Designer-1 (视觉创新派)

> 已阅读 10 个候选方向 + D2/D3 原始提案。以下是逐项投票和深入意见。

---

## 逐项投票

### 1. Mission Control / 任务指挥中心
**投票: 支持**

D3 的核心洞察非常准确——"指挥中心"直接跳出了"终端 vs IDE"的归类陷阱。从视觉创新角度，这个方向给了我们充足的发挥空间：多面板矩阵、状态灯系统、扫描网格，都是视觉上极具表现力的元素。关键是要做到"现代 mission control"（SpaceX Crew Dragon 路线）而不是"复古 NASA"（CRT 绿屏路线），否则会和 Terminal Native 的复古感冲突。

**补充建议**: Hero 区域可以做一个"从远到近"的视角推进——页面加载时先看到指挥中心全局（小面板矩阵），滚动后视角推进到单个面板的细节。这种电影化的镜头感可以和 Cinematic Spotlight 融合。

### 2. Amber Signal / 琥珀信号塔
**投票: 支持**

D3 说得对——色彩差异化是成本最低、记忆最深的差异化手段。我在第一轮提的 Molten Amber 虽然被淘汰了（WebGL 成本太高），但核心思路一致：让 amber 不只是点缀，而是视觉主角。25-30% 的 amber 面积占比是一个大胆但可执行的策略。

**补充建议**: 要特别注意 amber 大面积使用时的"施工警示"联想问题（D3 也提到了）。解决方案是：amber 不以条纹/色块的方式出现，而是以**光源/辐射**的方式出现——径向渐变、柔和光晕、光线穿透。光是没有边界的，不会产生"警示条纹"的联想。同时，amber 背景区域上的文字建议用 #06080c 深色而非白色，这样"amber 底深字"和"深底 amber 字"交替，节奏感更好。

### 3. Blueprint Grid / 工程蓝图
**投票: 建议修改 → 降级为辅助元素**

这是我第一轮的首选，但在看完 10 个方向后，我认为 Blueprint 作为独立风格方向略显单薄。网格/标注线的视觉语言更适合作为**其他方向的底层纹理**，而不是独立撑起整个官网。具体来说：Mission Control 的"控制台扫描网格" + Blueprint 的"标注线"可以自然融合。

**建议**: 不作为独立候选，而是将 Blueprint 的标注线、坐标点等元素融入 Mission Control 或 Cinematic Spotlight 作为背景肌理。

### 4. Cinematic Spotlight / 电影聚光
**投票: 支持 (建议与其他方向融合)**

光影处理是所有暗色官网都需要解决的核心问题，Cinematic Spotlight 与其说是一个独立方向，不如说是一套**光影语言系统**。它可以服务于 Mission Control（面板被 amber 光逐个照亮）、Amber Signal（amber 以光源形态扩散）、甚至 Terminal Native（终端屏幕的荧光溢出效果）。

**补充建议**: 滚动触发的"亮/暗节奏"是 D2 提的好想法。具体实现上，推荐用 CSS `scroll-timeline` + `@keyframes` 而非 JS Intersection Observer，性能更好且代码更简洁（2024+ 浏览器支持率已足够）。每个 section 的"点亮"时序应该有 0.3-0.5s 的 stagger 延迟，避免同时亮起的突兀感。

### 5. Terminal Native / 终端原生
**投票: 建议修改**

我对这个方向的态度从第一轮到现在有变化。核心问题不是"终端风格酷不酷"，而是**它和 Mission Control 在争夺同一个叙事空间**。两者都在说"这是给 CLI 用户的"，但 Mission Control 的叙事层级更高（"指挥多个终端"），Terminal Native 的叙事层级更低（"这就是一个终端"）。如果官网开头就用终端视觉语言，用户的第一反应是"又一个终端"，而不是"一个指挥台"。

**建议**: Terminal Native 不作为整体风格方向，而是作为**局部叙事手法**——在 Mission Control 框架下，某些 section（比如快速安装、CLI 命令演示）使用终端风格的交互元素。这样既保留了用户认同感，又不会拉低品类定位。

### 6. Workbench Utility / 工具台面
**投票: 反对 (作为独立方向)**

D2 的"务实派"逻辑是对的——产品截图即 hero、3 秒理解产品、零废话。但从视觉创新角度，这不是一个"风格方向"，而是一个**信息架构原则**。任何风格方向都可以（也应该）在 Hero 区域直接展示产品截图。Workbench Utility 如果作为独立方向，结果就是一个标准的 SaaS 模板页面，辨识度为零。

**建议**: 将"产品截图即 Hero""3 秒理解产品""高信息密度"作为所有方向都必须遵循的**设计原则**，而不是一个独立的风格候选。

### 7. Orchestrator / 编排者
**投票: 支持 (有保留)**

节点连线的编排视觉确实能传达 Muxvo "连接多个 CLI 工具"的核心价值。但我担心两点：(1) 节点连线图在 n8n、Zapier、Retool 这类产品中已经被充分使用，辨识度不够独特；(2) 如果 Muxvo 目前只支持 3 个 CLI 工具（Claude Code、Codex、Gemini CLI），节点图会显得"刻意复杂化一个简单关系"。

**补充建议**: 如果用 Orchestrator 视觉，节点不应该只是 3 个 CLI 工具的连线，而应该展示**用户工作流的全景**：终端面板 → 聊天历史 → 配置文件 → Skill 市场 → 发布，形成一个更丰富的编排图。同时，连线风格要区别于 no-code 平台——用直线/折线而非曲线，用 amber 脉冲光点而非彩色箭头。

### 8. Split Persona / 双面对比
**投票: 建议修改 → 降级为单一 Section**

Before/After 叙事是强大的说服工具，但不应该是整个官网的风格基调。如果每个 section 都是"before/after"，用户很快会审美疲劳。更好的做法是：在官网的某一个关键 section（比如第二屏）做一次高质量的 Before/After 对比，然后迅速切入正面叙事。

**具体建议**: 用一个"分屏 + 滑块"的交互：左侧是 4 个散乱的终端窗口 + 3 个 Tab 切换，右侧是 Muxvo 的整合界面。用户可以拖动中间的 amber 分割线来对比。这一个交互比整页 Before/After 更有冲击力。

### 9. Craft Object / 精工器物
**投票: 反对 (作为独立方向)**

D3 的"工匠感"理念我非常欣赏——Teenage Engineering 和 Analogue 的设计确实让人心动。但问题是：这种风格的核心是**实物的材质感**（金属、皮革、木纹），在纯数字界面上很难真实还原。数字产品的"工匠感"更多体现在**交互细节和动画品质**上（比如 Apple 产品页的滚动物理感），而不是纹理贴图。

**建议**: 不作为独立风格方向，但将"精工"理念融入执行标准——所有动画要有精确的 easing curve、所有间距要遵循 8px 网格、所有 hover 态要有质感反馈。这是"工匠精神"在数字设计中的正确落点。

### 10. Spatial Depth / 空间纵深
**投票: 建议修改 → 降级为 Hero 区域手法**

3D 空间感是好的，但全页使用 3D transforms 的性能风险太高，且在移动端几乎不可用。更好的策略是：仅在 Hero 区域用一次高品质的 3D 展示（产品截图以微透视角度呈现，带视差滚动），其余部分回归 2D 布局。

**具体建议**: Hero 区域的产品截图用 `perspective: 1200px; rotateY(-5deg); rotateX(2deg)` 的微透视，滚动时逐渐归零回到平面。这一个细节就够了——克制的 3D 比铺天盖地的 3D 更有高级感。

---

## 最值得深入的 2-3 个方向

### Top 1: Mission Control + Amber Signal 融合 (同意 D3 的融合建议)

这是我认为最值得深入的方向。理由：

1. **品类定位**: Mission Control 的"指挥中心"隐喻让 Muxvo 直接跳出"终端/IDE"的品类竞争
2. **视觉差异化**: Amber Signal 的大面积暖光策略在冷色竞品中做到最大辨识度
3. **融合逻辑自然**: "被 amber 光照亮的指挥台" = Mission Control 的布局骨架 + Amber Signal 的色彩策略 + Cinematic Spotlight 的光影手法
4. **开发可行性**: 主要依赖 CSS（网格背景、径向渐变、scroll-driven animations），不需要 WebGL

**融合后的具象画面**:
- Hero 区域：深黑背景 + 中央大面积 amber 径向光晕，光晕中央是 Muxvo 产品截图（微透视角度），截图中可见多个终端面板平铺。光晕从中心 #e8a74830 衰减到边缘透明，模拟"指挥台屏幕在暗室中发光"
- 标题文字在截图上方或下方，用 #ffffff 大字 + amber 下划线
- 向下滚动：进入功能区，每个功能是一个"控制台面板"（暗色卡片 + 1px amber 上边框），面板在进入视口时被 amber 光"点亮"
- 背景全程有低透明度的 amber 网格线（Blueprint 元素融入）

### Top 2: Orchestrator (编排者)

这是一个值得探索的备选方向，原因是它的**叙事独特性**——用"编排图"来可视化 Muxvo 的价值，这在 dev tool 官网中确实罕见。但需要解决"和 no-code 平台撞脸"的问题。

**差异化关键**: 编排图中的"节点"不是抽象的方块，而是**真实的 UI 截图缩略图**——终端面板截图、聊天历史截图、配置编辑器截图，用 amber 连线串联。这样既保持了编排视觉，又让用户立即看到真实产品。

### Top 3: Cinematic Spotlight (作为通用光影系统)

不是作为独立方向，而是作为一套**可复用的光影动效规范**，为 Top 1 或 Top 2 服务。具体包括：
- 滚动触发的 section 亮灭节奏
- amber 光源的衰减公式（radius、opacity、blur 的标准参数）
- 光影在不同断点（desktop / tablet / mobile）的降级策略

---

## 建议替换/合并的方向

| 原方向 | 建议 | 理由 |
|--------|------|------|
| #3 Blueprint Grid | 融入 Mission Control 作为背景肌理 | 单独撑不起整页，但作为网格底纹非常好 |
| #5 Terminal Native | 降为局部 section 手法 | 和 Mission Control 叙事冲突，但作为安装区域的交互元素很好 |
| #6 Workbench Utility | 升级为"设计原则"而非"风格候选" | 不是风格方向，是所有方向都该遵循的信息架构标准 |
| #8 Split Persona | 降为单一 section 的交互组件 | 一个高质量 Before/After 对比滑块 > 整页 Before/After |
| #9 Craft Object | 融入执行标准（动效品质、间距精度） | 数字场景下"工匠感"应体现在细节打磨而非纹理贴图 |
| #10 Spatial Depth | 降为 Hero 区域的微透视效果 | 克制的 3D 比铺天盖地的 3D 更高级 |

**精简后的核心候选**（建议进入第三轮深入设计的方向）：

1. **Mission Control + Amber Signal + Cinematic Spotlight 三合一** — 主推方向
2. **Orchestrator (编排者)** — 备选方向，叙事差异化最强
3. 以上两个方向都应融入：Blueprint 网格底纹 + Terminal Native 局部元素 + Workbench Utility 信息架构原则 + Split Persona 单点对比 + Spatial Depth 微透视 + Craft Object 执行品质标准

---

## 其他设计建议

### 关于 Hero 区域的具象建议

无论最终选哪个方向，Hero 区域必须在 3 秒内完成三件事：
1. **视觉锚定**: 用户看到的第一个画面必须是 Muxvo 产品的真实界面（多终端平铺），不是抽象图形
2. **品类定义**: 标题必须包含"AI CLI"或"Claude Code / Codex / Gemini CLI"，让用户立即知道这是给谁用的
3. **行动号召**: 下载按钮必须在首屏可见，不需要滚动

建议的 Hero 结构（适用于 Mission Control + Amber Signal 融合方向）：
```
[深黑背景 + amber 径向光晕]

          The command center for
          Claude Code, Codex & Gemini CLI

     [产品截图：多终端平铺 + 聊天面板 + 文件树]
     (微透视角度，带 amber 边缘光)

          [Download for macOS]  [View on GitHub]
```

### 关于移动端策略

开发者在手机上看官网的概率不低（推特/HN 链接 → 手机浏览器），但不会在手机上下载桌面应用。移动端的目标不是"转化"，而是"留下印象 + 记住名字"。因此：
- 移动端大幅简化：Hero 截图缩小、功能区变为垂直列表、取消所有 3D 和视差效果
- 但 amber 品牌色的冲击力不能减弱——移动端反而要增加 amber 面积占比（因为屏幕小，需要更强的色彩记忆）
- 移动端 CTA 改为"Send download link to my email"或"Star on GitHub"，而非直接下载

### 关于动效性能的底线原则

1. 所有动效必须可以通过 `prefers-reduced-motion` 媒体查询完全关闭
2. CSS-only 动画优先，JS 动画仅在 CSS 无法实现时使用
3. 单页面同时运行的动画不超过 3 个
4. 任何动画的首帧必须在 16ms 内渲染完成（不允许动画启动时的卡顿）
