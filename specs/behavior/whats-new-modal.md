# 行为规格：What's New 弹窗（WhatsNewModal）

> 提炼自老 app 实际代码（components/whats-new/WhatsNewModal.tsx 138 行 + WhatsNewModal.css 217 行 +
> shared/utils/changelog-parser.ts ReleaseEntry，2026-06-12 读取），**只记行为不抄结构**。
> 新实现是纯展示组件 + fixture props；release notes 获取走桥，复刻屏不实现。

## 0. 数据形状（fixture 驱动）

```
whatsNew {
  appVersion: string        // "0.5.0"（golden 侧来自 __APP_VERSION__ define，与 legacy package.json 锁死）
  entries: Array<{ version, date /* "YYYY-MM-DD" */, sections: Record<sectionKey, string[]> }>
  expanded: string[]        // 展开的历史版本号列表（legacy 为组件内 Set state，golden 侧 host 点 toggle）
}
```

## 1. 打开/关闭与数据行为

- 打开：PanelContext `OPEN_WHATS_NEW`（版本变更自动 App.tsx:172-184 / 设置弹窗链接手动）；closed → null（:31）
- 数据经 `window.api.app.getReleaseNotes(locale)` 读入（**直接返回 ReleaseEntry[]，非 {success,data} 信封**，:25）。
  **替身缺此方法会 TypeError 崩**（critic 实测）——fixture 替身必须先扩
- current = entries 中 version === appVersion 的条目（:34）；其余为 olderEntries（保持 entries 顺序）；
  current 缺失 → `__empty`「v{x} 暂无更新说明」
- 历史版本默认全折叠（expandedVersions 初始空 Set，:27）；点 toggle 切换展开
- sectionKey → 标签映射（:8-15）：Added=新增 Changed=变更 Fixed=修复 Removed=移除
  Deprecated=弃用 Security=安全（en 用原 key）；未知 key 原样显示

## 2. DOM 结构与样式（WhatsNewModal.css）

`.whats-new__backdrop > .whats-new__modal > [__header] [__body] [__footer]`

- `__backdrop`：fixed inset 0、z-index 500、bg rgba(0,0,0,.5)、blur(4px)、flex 居中
- `__modal`：**宽 460px**、max-width 90vw、**max-height 80vh**、flex column、bg `var(--bg-elevated)`、
  border 1px `var(--border)`、圆角 12px、`var(--shadow-dialog)`
- `__header`：flex 两端、padding `16px 20px 12px`、底边框；`__title` 15px 600 gap 8px +
  星形 svg 18×18 `var(--accent)`；文案 zh「更新内容」/ en "What's New"（:76 直写三元）；`__close`「×」
- `__body`：padding `16px 20px`、纵向滚动 flex 1
- `__current`：mb 16px；`__version-badge` 14px 600 `var(--accent)` gap 8px mb 12px
  「v{version}」+ `__version-date` 11px 400 `var(--text-muted)`
- `__section`：mb 10px；`__section-title` 11px 600 大写 letter-spacing .5 `var(--text-muted)` mb 6px；
  `__list` ul padding-left 16px；`__item` li 13px `var(--text-primary)` line-height 1.6
- `__older`：顶边框 + padding-top 12px；`__older-title` 同 section-title 样式，
  文案 zh「历史版本」/ en "Previous Versions"
- `__older-toggle`：满宽左对齐按钮 gap 6px、padding `6px 8px` 圆角 6px、13px 500；
  `__chevron`「▸」10px `var(--text-muted)`，展开时 `--open` rotate 90deg；
  「v{version}」+ `__version-date`
- 展开内容 `__older-content`：padding `4px 8px 8px 22px`，内含同款 sections
- `__footer`：右对齐、padding `12px 20px`、顶边框；`__dismiss` bg `var(--accent)` 字 #000
  （light 主题字 #fff，css:214）13px 500、padding `6px 20px`、边框 `var(--border)` 圆角 8px，
  文案 zh「知道了」/ en "Got it"

## 3. golden 与 dom-assert

- `wn-notes`：zh 满载——current v0.5.0 多 section 多条目（长条目压换行）+ 历史 3 版本，
  其中 1 个展开（chevron 旋转 + 缩进内容）2 个折叠，展开/折叠同图
- dom-assert（后续批落 vitest，本批仅记录）：current 缺失空态、单 section 变体、en 文案三元
