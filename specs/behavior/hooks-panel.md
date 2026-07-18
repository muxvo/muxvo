# 行为规格：Hooks 两栏面板（HooksPanel）

> 提炼自老 app 实际代码（hook/HooksPanel.tsx 476 行 + HooksPanel.css 86 行 + hooks/useHookConfig.ts，
> 2026-06-12 读取），**只记行为不抄结构**。

## 0. 数据形状（fixture 驱动）

```
screen: 'hooks-panel'
hooks: {
  settings: { hooks: { <EventName>: [{ matcher?, hooks: [{ type, command, timeout?, async?,
                                                           statusMessage?, once? }] }] } },
  selectedId: string|null,   // 展平 id 形如 'global:<event>:<gi>:<hi>'；golden 驱动器点对应项
  form: bool                 // true = 选中后点「编辑」进表单（hk-form）
}
```
golden 侧 stub：config.getSettings() → `{ settings }` 原样返回；web 侧用同一展平规则
（事件序 → 组序 → 处理器序）从 settings 推导列表（单一数据源）。

## 1. 数据行为（useHookConfig）

- 全局源走 `config.getSettings()`→settings.hooks；项目源 fs 读 settings(.local).json——
  **App 挂载不传 projectCwd** → 生产仅 global scope（badge 恒 `Global` 绿）
- 展平：Event → MatcherGroup[] → Handler[] → HookEntry{id=`global:event:gi:hi`}
- 仅 global 可编辑/删除（App 路径下恒可编辑）

## 2. 容器与布局

- 宿主：`.hooks-panel-overlay`（fixed top 36px、z 180、bg `var(--bg-deep)`）
- `.hooks-panel` flex h100；左 `__left` 宽 **300**（:42 初值）右边框；右 `__right` flex1 min-w 300

## 3. 左栏列表

- 头 `__header`：`Hooks`（t）+ `__count` 角标 + `__add-btn` ＋
- **按事件分组**：`__event-group` > `__event-label`（12px 700 `var(--accent)` mono，事件名）+ 项
- 项 `__item`（列向 gap 4px、`8px 12px` 圆角 6px；active=glow）：
  `__item-info` 行 = 可选 `__item-matcher`（11px 600 accent glow 圆角 3 mono）+
  `__item-command`（12px mono `var(--text-secondary)` 单行省略）；
  `__item-badges` 行 = `__handler-badge`（9px 700：command 橙/prompt 蓝/agent 紫）+
  `__scope-badge`（global→`Global` 绿 / project→`Project` 蓝 / project-local→`Local` 紫）
- 空态（HooksPanel.tsx:173）：`__empty` `暂无 Hook 配置`（t('hooks.noHooks')）。
  ⚠️ CONFIG_L1_17 spec 期望文案「还没有配置 Hooks」为零消费 stub，实渲染以此为准（检查点⑥ Tier-B）。
  空态视觉同构，golden 代表作在 skills（sk-empty），此处 dom-assert

## 4. 右栏 detail

- `__detail` padding `20px 24px`；头：`__detail-event`（18px 700 mono 事件名）+ handler/scope badge
- 行（同 mcp 样式）：匹配器（有 matcher 才出，mono）/ 命令（mono）/ 处理类型 /
  超时（`{n}ms`，有 timeout 才出）/ 异步执行 true / 状态消息 / 仅执行一次 true / 配置路径（mono）
- 底部 `编辑`+`删除`（global）；`__placeholder`：`选择一个 Hook 查看详情`

## 5. 右栏 form

- 头 16px 700（`添加 Hook`/`编辑 Hook`）；字段：
  事件 select（15 事件枚举 PreToolUse..PreCompact）/ 匹配器 input（placeholder `工具名称或正则（可选）`）/
  处理类型 select（command|prompt|agent）/ 命令 textarea rows3（placeholder `命令或提示词`）/
  超时 input type=number（placeholder `ms`）/ 状态消息 input（placeholder `执行时显示的消息`）/
  `__form-checks`（gap16）：`异步执行` + `仅执行一次` checkbox（accent-color `var(--accent)`）
- edit 预填选中值；底部 `保存`+`取消`

## 6. golden 与 dom-assert

- `hk-list`：2 事件组 3 hook（matcher 有/无、command/prompt 混合）+ 选中 detail
  （matcher/command/timeout/async/configPath + item badges 可见）
- `hk-form`：选中后「编辑」表单（全字段预填 + 勾选 async）
- dom-assert：空态文案（CONFIG_L1_17 断这里）
