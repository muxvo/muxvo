# 行为规格：工作目录选择浮层（CwdPicker）

> 提炼自老 app 实际代码（components/terminal/CwdPicker.tsx 159 行 + CwdPicker.css 98 行，
> 入口 TileHeader.tsx:195 handleCwdClick，2026-06-12 读取），**只记行为不抄结构**。
> 新实现是纯展示组件 + fixture props；目录切换执行（cd 写入/selectDirectory/进程检测）走桥，复刻屏不实现。

## 0. 数据形状（fixture 驱动）

```
cwdPicker { terminalId: string }   // 浮层归属的 tile；currentCwd = 该终端的 cwd（原样全路径）
homePath 取 base.homePath（快捷路径标签固定文案，路径值仅交互用，不影响视觉）
```

## 1. 入口与锚定

- 入口：点击 tile header 的 cwd 青色文本（`.tile-cwd`；compact 模式不可点，TileHeader.tsx:197）
- 锚点：`anchor.top = cwd span rect.bottom + 4`、`anchor.left = rect.left`（TileHeader.tsx:198-199）
- 视口越界（CwdPicker.tsx:110-124，宽 320 / 估高 280）：
  右溢 → `left = innerWidth - 320 - 8`；`left < 8` → 钉 8；下溢 → 翻到锚点上方（`top = anchor.top - 280 - 8`）
- portal 到 body：全屏透明 overlay `.cwd-picker-portal-overlay`（fixed inset 0，z-index 1000），
  点击 overlay 关闭；浮层自身 `position:fixed` 吃算好的 top/left

## 2. DOM 结构与样式（CwdPicker.css）

`.cwd-picker-portal-overlay > .cwd-picker > [header] [current] [quick] [browse]`

- `.cwd-picker`：宽 320px、bg `var(--bg-elevated)`、`1px solid var(--border)`、圆角 6px、
  `var(--shadow-elevated)` 投影、padding 12px、13px、色 `var(--text-primary)`
- `.cwd-picker-header`：600 字重，margin-bottom 8px，文案「切换工作目录」（i18n cwd.title）
- `.cwd-picker-current`：12px、`var(--text-secondary)`、bg `var(--bg-primary)`、圆角 4px、
  padding `6px 8px`、margin-bottom 12px；内容 = 「当前:」+ 空格 +
  `span.cwd-picker-current-path`（**cwd 原样全路径**，不缩短；`var(--font-mono)`、text-primary）
- `.cwd-picker-quick`（margin-bottom 12px）：
  - `.cwd-picker-section-title`：11px、text-secondary、uppercase、letter-spacing .5px、mb 6px、「快捷路径」
  - `.cwd-picker-item` ×3：块级满宽按钮、透明底无边框、padding `8px 10px`、左对齐、13px、
    圆角 4px、mb 2px；hover bg-hover。标签固定：`~ (Home)` / `~/Desktop` / `~/Documents`
- `.cwd-picker-browse`：上边框 `1px solid var(--border)`、padding-top 12px；
  `.cwd-picker-browse-btn` 满宽按钮、bg `var(--bg-hover)`、13px 500 字重、padding `8px 12px`、
  圆角 4px、文案「浏览...」（hover bg-elevated）

## 3. 状态行为

- 打开：仅「open-树+快捷路径」一态（golden `cwd-open`）；无 loading/空态——快捷路径同步生成
  （`window.api.app.getHomePath()` 为**同步**调用，CwdPicker.tsx:43；fixture stub 必须同步返回）
- 关闭：Esc / 点击 overlay / 选中任一路径后
- 选择语义（不进复刻屏）：前台进程是 shell → 写 `cd <转义路径>` + updateCwd；非 shell → onConfirmExit 升级确认
