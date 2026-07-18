# 行为规格：MCP 两栏面板（McpPanel）

> 提炼自老 app 实际代码（mcp/McpPanel.tsx 521 行 + McpPanel.css 88 行 + hooks/useMcpConfig.ts，
> 2026-06-12 读取），**只记行为不抄结构**。

## 0. 数据形状（fixture 驱动）

```
screen: 'mcp-panel'
mcp: {
  servers: [{ name, type('stdio'|'http'|'sse'), scope('global'|'desktop'|'codex'|'gemini'),
              command?, args?: string[], url?, headers?, env?, configPath }],
  selected: name|null,   // golden 驱动器点对应项
  form: bool             // true = 选中后再点「编辑」进入表单（mcp-form）
}
```
golden 侧 stub 由 servers 按 scope 反拼配置文件答案（global→~/.claude.json mcpServers、
desktop→…/claude_desktop_config.json、gemini→~/.gemini/settings.json；codex TOML 不在 fixture 用）。

## 1. 数据行为（useMcpConfig）

- 读 4 个全局源（global/desktop/codex/gemini）+ 可选项目源；**App 挂载不传 projectCwd**
  （App.tsx `<McpPanel />`）→ 生产只出「系统」一组（groupByLevel：项目 scope 才出「项目」组）
- type 推断：有 url → 含 '/sse' 则 sse 否则 http；无 url → stdio
- 仅 global scope 可编辑/删除；其余显示只读提示

## 2. 容器与布局

- 宿主：`.mcp-panel-overlay`（fixed top 36px、z 180、bg `var(--bg-deep)`，App.css:41）
- `.mcp-panel` flex h100 bg `var(--bg-primary)`；左 `__left` 宽 **280**（:40 初值，200..500 可拖）
  右边框 1px；右 `__right` flex 1 min-width 300；`__resize-handle` 6px

## 3. 左栏列表

- 头 `__header`：`14px 16px` 底边框 14px 700：`MCP Servers`（t）+ `__count` 角标 + 右靠
  `__add-btn`（22×22 边框 ＋ `var(--accent)`）
- 列表 `__list` padding 4px；分组头 `__group-header`（▶ 8px + `__group-label` 12px 700 +
  `__group-count` 右靠 10px）；组标签 **`系统`/`项目`（TSX 硬编码中文）**
- 项 `__item`：`8px 12px` 圆角 6px flex gap 8px；active=`var(--accent-glow)`；
  `__item-name` 14px 600 mono flex1 省略 + `__scope-badge`（9px 700 大写 letter-spacing .3：
  global→`CC` 橙 / desktop→`CC Desk` 橙 / codex→`Codex` 绿 / gemini→`GM` 紫）+
  `__type-badge`（9px 700：STDIO 橙/HTTP 蓝/SSE 紫）
- 空态：`__empty` `暂无 MCP 服务器配置`（t('mcp.noServers')）；loading：`加载中...`——均 dom-assert

## 4. 右栏 detail（mode=view 且 selected）

- `__detail` padding `20px 24px` 列向滚动；头 `__detail-header`（gap 10 mb 20）：
  `__detail-name` 18px 700 mono + scope/type badge
- 行 `__detail-row`（列向 gap 4、行间 12）：`__detail-label` 11px 600 大写
  `var(--text-secondary)` + `__detail-value`（14px；--mono 加 mono；headers/env 为
  `pre`（JSON.stringify(,null,2)，bg `var(--bg-deep)` 圆角 6px 12px 字））
- stdio：命令/参数行；http/sse：URL/Headers 行；通用：环境变量（有 env 才出）/ 配置路径
- global：底部 `__detail-actions`（上边框 pt16）`编辑`（--primary glow 钮）+ `删除`（--danger 红）；
  非 global：`__detail-hint` 只读提示（蓝底 12px）
- 未选中：`__placeholder` 居中 `选择一个服务器查看详情`

## 5. 右栏 form（mode=edit|add）

- `__form` padding `20px 24px`；头 `__form-header` 16px 700（`添加服务器`/`编辑服务器`）
- 字段（`__form-label` 列向 12px 600 + 控件 bg `var(--bg-deep)` 边框圆角 6px mono 14px）：
  名称 input / 类型 select（STDIO|HTTP|SSE）/ stdio→命令 input + 参数 input（placeholder `空格分隔`）
  / 非 stdio→URL input + Headers textarea(rows3) / 环境变量 textarea(rows3)
- edit 模式预填选中值：args 以空格 join；env/headers JSON.stringify(,null,2)
- 底部 `__form-actions`：`保存`（--primary）+ `取消`

## 6. golden 与 dom-assert

- `mcp-list`：系统组 4 server（stdio/http × CC/CC Desk/GM scope 混合）+ 选中 stdio detail
  （命令/参数/环境变量/配置路径 + 编辑/删除）
- `mcp-form`：同列表 + 选中后进「编辑」表单（stdio 字段组，预填值）
- dom-assert：http 字段变体（URL/Headers）/ 空态 / loading
