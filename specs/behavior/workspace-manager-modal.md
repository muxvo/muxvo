# 行为规格：工作区管理弹窗（WorkspaceManagerModal）

> 提炼自老 app 实际代码（components/workspace/WorkspaceManagerModal.tsx 125 行 +
> WorkspaceManagerModal.css 138 行，2026-06-12 读取），**只记行为不抄结构**。
> 新实现是纯展示组件 + fixture props；workspace 增删改持久化走桥，复刻屏不实现。

## 0. 数据形状（fixture 驱动）

```
workspace {
  workspaces: Array<{ name, savedAt /* ISO8601，仅作 key 不渲染 */, terminals: Array<{cwd}> /* 仅 length 渲染 */ }>
  editing: null | { index, value }   // 行内编辑中：第 index 行渲染 input，值 = value
}
```

## 1. 打开/关闭与编辑行为

- 打开：PanelContext `OPEN_WORKSPACE_MANAGER`（重置其他面板，PanelContext.tsx:172-173）；
  原生菜单触发（App.tsx:144-150）；closed → null（:74）
- 关闭：backdrop 点击 / ✕ / ESC（:21-34）
- 列表经 `window.api.app.getConfig().data.savedWorkspaces` 异步读入（:14-19）
- 行内重命名（:48-72）：点击 `__name` → 该行换 `__name-input`（autoFocus + select）；
  Enter/blur 提交（trim 非空且变更才保存）、ESC 取消
- 删除：行尾 × 立即删除（**无确认**，:43-46）

## 2. DOM 结构与样式（WorkspaceManagerModal.css）

`.ws-manager__backdrop > .ws-manager > [__header] [__body > (__empty | __item ×N)]`

- `__backdrop`：fixed inset 0、z-index 500、bg rgba(0,0,0,.5)、blur(4px)、flex 居中
- `.ws-manager`：**宽 480px**、max-width 90vw、**max-height 70vh**、flex column、bg `var(--bg-elevated)`、
  border 1px `var(--border)`、圆角 12px、`var(--shadow-dialog)`
- `__header`：flex 两端、padding `16px 20px 12px`、底边框；`__title` 15px 600（**文案硬编码英文
  "Manage Workspaces"**，不走 i18n，:80）；`__close`「×」18px
- `__body`：padding `12px 20px 20px`、纵向滚动 flex 1
- `__item`：flex 居中 gap 10px、padding `8px 0`、底边框 `var(--border-subtle, var(--border))`
  （--border-subtle 两侧主题表均未定义 → 实际取 var(--border)）、末行无边框
  - `__name`：flex 1、13px `var(--text-primary)`、padding `4px 6px` 圆角 4px、透明边框 1px、单行省略
  - `__name-input`（编辑中行）：同 padding、**边框 1px `var(--accent)`**、bg `var(--bg-card)`、outline none
  - `__meta`：11px `var(--text-muted)` nowrap，文案 **硬编码英文 `{N} terminals`**（:108-110）
  - `__delete`：「×」13px `var(--text-muted)`、padding `4px 6px`
- `__empty`：居中 13px `var(--text-muted)`、padding `24px 0`，文案 "No saved workspaces"

## 3. golden 与 dom-assert

- `ws-list`：3 行列表 + 第 2 行（index 1）行内编辑中（input 值 ≠ 原名，光标已透明、选区折叠）同图
- dom-assert（后续批落 vitest，本批仅记录）：空态 `__empty`；删除无确认（行为断言）

## 4. golden 侧驱动说明

editingIdx 为组件内 state：golden 侧 fixture host JS click 第 index 行 `__name` →
等 `__name-input` → 原生 setter 注入 value（f7 编辑先例）→ 折叠选区（对冲 :51 的 select()）；
web 侧依 fixture 直接渲染编辑态行。
