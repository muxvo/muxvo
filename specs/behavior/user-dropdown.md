# 行为规格：MenuBar 用户头像下拉（UserDropdown）

> 提炼自老 app 实际代码（components/auth/UserDropdown.tsx 71 行 + UserDropdown.css 135 行，
> 2026-06-12 读取），**只记行为不抄结构**。注意 legacy 源码在 `components/auth/`（非 layout/）。

## 0. 数据形状（fixture 驱动）

```
screen: 'user-dropdown'        // = menu-bar 屏 + 下拉 open 态（golden 侧 JS click trigger 打开）
base / auth / update           // 同 menu-bar.md；auth 必非 null（无 user → 组件 return null）
```

## 1. 触发与开闭（UserDropdown.tsx:13-26,34）

- 仅 `state.status==='authenticated' && state.user` 时由 AuthButton 渲染
- trigger 点击 toggle open；open 时点击组件外任意处（mousedown）关闭
- 复刻屏：open 由 fixture 决定（golden 侧走生产入口 click，web 侧直渲终态）

## 2. 闭合态 trigger（.user-dropdown__trigger）

- 容器 `.user-dropdown`：relative、z 2
- trigger：24×24 圆形按钮、border 1px `var(--border)`、bg transparent、overflow hidden
- 有 avatarUrl → `img.user-dropdown__avatar`（100% 圆形 cover）；
  无 → `.user-dropdown__avatar-placeholder`（首字母大写：username||email||'?' 的 [0]，
  bg `var(--accent-muted)` 字 `var(--accent)` 11px 700）
- 闭合 avatar/placeholder 两态 = **dom-assert**

## 3. 展开菜单（.user-dropdown__menu，UserDropdown.tsx:44-67）

- 定位：absolute top `calc(100%+8px)` right 0、min-width **200px**、z 400
- 样式：bg `var(--bg-elevated)`、border 1px `var(--border)`、圆角 8px、
  `var(--shadow-elevated)`、padding `8px 0`
- 结构：`__info`（flex gap 10px padding `10px 14px`：32×32 圆 avatar/placeholder（14px 700）+
  `__details` 列 gap 2px：`__name` 13px 600 单行省略（username||email）+
  `__provider` 11px `var(--text-secondary)` **text-transform capitalize**（github→Github））
  → `__divider`（1px `var(--border)` margin `4px 0`）
  → `__logout-btn`（整行 `8px 14px` 左对齐 13px `var(--text-secondary)`，文案 t('auth.logout')=`登出`；
  hover 变 `var(--error)`——不出 golden）

## 4. golden 与 dom-assert

- `mb-user-menu`：menu-bar 组合（Tiling 底图+badge）+ 已登录（头像 data-URI）+ menu open
- dom-assert：闭合 avatar / placeholder 两态

## live 接线注记（右上角批 B5，2026-07-13）

authenticated 态由 AuthContext 驱动（LiveChrome/ChatHistoryChrome 双树同源）：trigger 点击 toggle、
外点（mousedown）关闭、登出项 → app.request authLogout（尽力吊销+本地必登出）→ authStatusChanged
推送 → 头像退位回登录 icon。真机全链取证 = e2e item54（login-modal.md §6.1 AUTH_e2e_full_chain）。
