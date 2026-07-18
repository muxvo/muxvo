# 行为规格：Skills 三栏面板（SkillsPanel + SkillList + SkillFileTree）

> 提炼自老 app 实际代码（skill/SkillsPanel.tsx 372 行 + SkillList.tsx 192 行 +
> SkillFileTree.tsx 127 行 + SkillsPanel.css 62 行 + SearchInput.{tsx,css} +
> file/FileItem.tsx + FilePanel.css:110-152 + markdown/MarkdownWysiwyg.{tsx,css}，
> 2026-06-12 读取），**只记行为不抄结构**。

## 0. 数据形状（fixture 驱动）

```
screen: 'skills-panel'
skills: {
  items: [{ name, path, source?('claude'|'codex'|'gemini'|'shared'), level, desc }],
  selected: path|null, sourceMode: bool, dirty: bool, dirtyValue?: string  // dirty 时编辑区终值
}
files: { "<abs path>": "content" }   // golden 侧喂 config.getResourceContent + fs.readFile
dirs:  { "<abs path>": [{ name, isDirectory }] }  // golden 侧喂 fs.readDir（path 由 stub 拼）
```
desc 与 SKILL.md frontmatter 双登记（golden 自 frontmatter 解析、web 直读 desc，compare 兜底）。
**选中 skill 的 SKILL.md 不带 frontmatter**（wysiwyg 会把 `---`+YAML 渲染为 hr/setext 杂讯）。

## 1. 容器与三栏（App.tsx:281-285 + SkillsPanel.css）

- 宿主：`.skills-panel-overlay`（fixed top `var(--menu-bar-height)` 其余 0、z 180、bg `var(--bg-deep)`）
- `.skills-panel`：flex、height 100%、bg `var(--bg-primary)`
- 左 `__left` 宽 **240**（state 初值 :31）/ 中 `__middle` 宽 **280**（:32，仅选中 skill 后渲染）/
  右 `__right` flex 1 min-width 300；左中均右边框 1px `var(--border)`、列 flex+overflow-y
- 栏间 `__resize-handle` 宽 6px（col-resize；拖拽范围 150..500，不出 golden）

## 2. 左栏 SkillList

- 头部 `.skill-list__header`：padding `14px 16px` 底边框、14px 700 `Skills`（t('skills.title')）+
  `__count` 角标（11px 600 `var(--accent)`/`var(--accent-glow)` 圆角 8px，值=总数；**空态也渲染 0**）
- 搜索框（共享 SearchInput，仅非空列表渲染）：`.search-input-wrap` padding `8px 12px` 底边框；
  input 高 6px 垂直 padding、12px、bg `var(--bg-elevated)`、placeholder **"Search skills..."（硬编码英文）**
- 分组（groupSkills）：level=project 且 projectName → 按项目名一组；其余并入 **"系统 Skills"**（硬编码）；
  组头 `__group-header`（▶ 8px 箭头，展开 rotate90 + `__group-label` 12px 600 +
  `__group-count` 10px 右靠）；组项缩进 `__group-items` padding-left 4px
- 项 `__item`：padding `10px 12px` 圆角 6px；active=bg `var(--accent-glow)`；
  `__item-name` 14px 600 mono + source badge（theme.css 共享 `.source-badge`：
  codex→CX 绿 / gemini→GM 紫 / 其余→CC 橙；**source='shared' → CX+GM 双 badge**）+
  `__item-desc` 11px `var(--text-secondary)` **两行 clamp**
- 空态（skills.length===0，SkillList.tsx:100-116）：`.skill-list__body > .skill-list__empty`，
  `<p>暂无技能</p>`（t('skills.noSkills')）+ 两行 hint `<p class="skill-list__empty-hint">`：
  `~/.claude/skills/` 与 `<project>/.claude/skills/`。
  **`.skill-list__empty`/`__empty-hint`/`__body` 在 legacy 无任何 CSS 规则**（全局 reset 默认样式）。
  ⚠️ CONFIG_L1_16 spec 期望文案「还没有 Skills...」为零消费 stub，实渲染以本节为准（检查点⑥ Tier-B）
- 搜索无命中（:137-141）：`<p>No matching skills</p>`（硬编码英文）——dom-assert
- loading（:85-98）：3 个 `__skeleton` 块——不出 golden

## 3. 中栏 SkillFileTree（选中 skill 才渲染）

- 头部 `__header`：padding `14px 16px` 底边框、14px 600 mono、值=skill 目录名（path 最后段）
- 树体 `__body`：readDir(skillPath) → mapIpcToTree（**文件夹优先 + localeCompare**、
  隐藏文件默认过滤、showHiddenFiles 取 getConfig）→ FileItem 行
- FileItem（FilePanel.css 共享样式——fixture 页须显式 import FilePanel.css 才与生产一致）：
  flex gap 8px、padding `6px 8px` + 缩进 `8+indent*20`、圆角 5px、mono 12px；
  图标 18px 宽（folder 📁/📂、md 📝、json ⚙️、其余 📄）；active=bg `var(--accent-glow)`；
  folder 名字 `var(--accent)` 色
- 空目录：`__empty` = t('skills.emptyFolder')=`空目录`——dom-assert

## 4. 右栏 编辑/查看（selectedFilePath 非空）

- 头 `__editor-header`：padding `10px 16px` 底边框 flex gap 8px：
  `__editor-filename`（14px 600 mono，文件名）→ dirty 时 `__editor-dirty`（8px 红点 `var(--error)`）→
  markdown 时 `__editor-mode-btn`（11px 边框钮，**显示将切去的模式**：wysiwyg 态显 'Source'、
  source 态显 'WYSIWYG'）→ `__editor-tag`（右靠 10px 700，MD/CODE/IMG/TXT，bg 蓝 glow 字 `var(--info)`）
- 体 `__editor-body`（flex 1 overflow auto）：
  - markdown+wysiwyg：`.markdown-wysiwyg`（h100 滚动）> div > `.tiptap`（ProseMirror 注入类）；
    .tiptap：sans 15px/1.8、padding `24px 32px`、min-h 100% + prosemirror 注入基线
    （position relative、word-wrap break-word、white-space break-spaces、ligatures off）；
    元素样式见 MarkdownWysiwyg.css（h1 1.8em 底边框/h2 1.5em/code 粉系 `--code-fg #f8a5c2`/
    pre bg `var(--bg-elevated)` 圆角 8px/blockquote 左 4px 边框斜体/li 含 p）
  - source / 非 markdown 文本：`textarea`（mono 14px/1.6、padding 16px、透明底无边框）
  - 自动选中：选 skill 后自动 load `<skillPath>/SKILL.md`（SkillsPanel.tsx:188-193）
- 未选文件：`__placeholder` 居中 `选择左侧技能查看详情`（**TSX 硬编码中文**，:357——
  selectedSkillPath 非空时文案为 `选择一个文件查看内容`，但该分支实际不可达：选 skill 即自动选文件）

## 5. golden 与 dom-assert

- `sk-list`：3 skill（系统组 2 + 项目组 1，CC/CX+GM badge）+ 选中 + 文件树 + SKILL.md wysiwyg 满载
- `sk-dirty`：同上但 source 模式 textarea + dirty 红点（golden 驱动：点 Source → 原生 setter 注值）
- `sk-empty`：空列表（四面板空态代表作；CONFIG_L1_16 断言此屏文案）
- dom-assert：搜索无命中 "No matching skills"（SkillList.tsx:139）
