# 行为规格：Plugins 两栏面板（PluginPanel）

> 提炼自老 app 实际代码（plugin/PluginPanel.tsx 253 行 + PluginPanel.css 76 行 +
> hooks/usePluginConfig.ts 219 行，2026-06-12 读取），**只记行为不抄结构**。

## 0. 数据形状（fixture 驱动）

```
screen: 'plugins-panel'
plugins: {
  error: string|null,    // 非 null = 加载失败（显示 `Error: <error>`，见 §1）
  items: [{ id('name@marketplace'), name, marketplace, version, scope, installPath,
            enabled, installedAt(ISO), lastUpdated(ISO),
            manifest?: { description?, author?: { name } },
            contents: { commands: [], skills: [], hooks: [], agents: [] } }],
  selectedId: string|null
}
```
golden 侧 stub 由 items 反拼：installed_plugins.json / settings.enabledPlugins /
`{installPath}/.claude-plugin/plugin.json` / readDir(installPath/{commands,skills,hooks,agents})。
error 态：stub 对 installed_plugins.json reject `new Error(error)` →
组件 `String(err)` 渲染 `Error: <error>`（usePluginConfig.ts:183-185）。

## 1. 数据行为（usePluginConfig）

- 读 `~/.claude/plugins/installed_plugins.json`（{plugins:{key:[record]}}）；key 按最后 `@` 拆
  name/marketplace；enabled = settings.enabledPlugins[key]===true
- manifest 读 installPath/.claude-plugin/plugin.json（失败 fallback marketplace 目录）；
  contents 扫 4 子目录（commands/agents 取 .md 去后缀、skills 取子目录名、hooks 取全部文件名）
- **仅此面板有 error 分支**：顶层异常 → error 文案渲染在列表区 `.plugin-panel__empty`

## 2. 容器与布局

- 宿主：`.plugins-panel-overlay`（fixed top 36px、**z 10**（App.css:69，与其余面板 180 不同）、
  bg `var(--bg-deep)`）
- `.plugin-panel` flex h100；左 `__left` 宽 **280** 右边框；右 `__right` flex1 min-w 300

## 3. 左栏列表

- 头 `__header`：`插件`（t('plugins.title')）+ `__count` 角标（**无添加钮**）
- 按 marketplace 分组：`__group-title`（10px 700 大写 letter-spacing .3，空 marketplace→`Unknown`）
- 项 `__item`（`8px 12px` flex gap 8px；active=glow）：`__dot`（8px 圆点：enabled `#34d399` /
  disabled `var(--text-muted)` opacity .5）+ `__item-name` 14px 600 mono 省略
- 空态 `暂无已安装插件` / loading `加载中...` / error `Error: ...`——共用 `__empty`/`__loading` 样式
  （`20px 16px` 居中 `var(--text-muted)` 14px）

## 4. 右栏 detail（selected）

- `__detail` padding `20px 24px` gap 16 列向滚动
- 头：`__detail-name` 18px 700 mono + `__tag`（marketplace，10px 700 大写蓝）
- toggle 行 `__toggle-row`（bg `var(--bg-deep)` 圆角 6px `10px 12px` 两端）：
  `__toggle-label`（`已启用`/`已禁用` 14px 600）+ 开关 `__toggle`（36×20，checked 轨道
  `rgba(52,211,153,.3)`、滑块 16px 平移 16px 变 `#34d399`；未选中轨道 `var(--border)` 滑块灰）
- 信息行 `__info-row`（label 11px 600 大写 min-width 100px + value 14px）：
  版本 / 范围 / 安装时间 / 最后更新（`new Date(iso).toLocaleDateString()`，
  fixture 用固定 ISO，两侧同浏览器同 locale 输出一致）/ 描述、作者（manifest 有才出）
- 包含内容 `__contents-section`（上边框）：`__contents-title` `包含内容` +
  每类 `__content-group`（`__content-label` Commands/Skills/Hooks/Agents 硬编码英文 +
  `__content-list` 横排 chip `__content-item`（12px mono bg `var(--bg-deep)` 圆角 4px））；
  全空 → `__no-contents` `无包含内容`
- 安装路径 `__path-section`（上边框）：label + `__path`（12px mono `var(--text-muted)` 折行）
- 未选中：`__placeholder` `选择插件查看详情`

## 5. golden 与 dom-assert

- `pl-list`：1 marketplace 组 3 插件（enabled×2/disabled×1 圆点混合）+ 选中 enabled detail
  （toggle on + 信息行 + contents chips + 安装路径）
- `pl-error`：error 态（全簇 error 代表作，固定 EACCES 文案）
- dom-assert：空态 / loading
