# 行为规格：Worktree 浮层（WorktreePopover）

> 提炼自老 app 实际代码（components/terminal/WorktreePopover.tsx 319 行 + WorktreePopover.css 178 行，
> 入口 TileHeader.tsx:186 handleWorktreeClick，2026-06-12 读取），**只记行为不抄结构**。
> 新实现是纯展示组件 + fixture props；worktree 创建/删除/开终端走桥，复刻屏不实现。

## 0. 数据形状（fixture 驱动）

```
worktree {
  terminalId: string          // 浮层归属的 tile（terminalCwd = 该终端 cwd）
  repoPath: string            // detectRepo 结果
  warning: null | { sizeMB: number, message: string }   // preCheck 大仓警告
  worktrees: Array<{ path, branch, isMain: boolean, isMerged: boolean }>   // list 结果
}
```

## 1. 入口与锚定

- 入口：tile header 的 worktree 分支按钮（`.tile-worktree-btn`，仅 git 仓库 tile 显示）
- **★门控字段缓存契约（dogfood-r3 问题6，2026-07-10）**：`isGitRepo` / `worktreeRegistered` 由
  `GitStatusCache` 填充（mapSnapshot 每推同步 lookup），TTL 30s 过期走 **stale-while-revalidate**——
  过期条目 lookup 返回**旧值**并登记后台探针刷新（值真变才 onChange 重推纠正），**绝不因过期回 nil
  闪灭按钮/徽标**（旧「过期回 nil」语义下任一无关推送落在过期窗即按钮消失、值没变探针不重推无人纠正
  →「时隐时现」）。真 miss（新 cwd / worktree 变更 invalidate 后）仍回 nil 走冷启动：探针点亮 ≤5s
  口径不变（E2E item25）。测试：`GitStatusCacheBehaviorTests.ttlBoundary`/`staleRevalidateFlipFires` +
  `FilePanelServiceTests.filePanelLifecycleAndGating` ⑤。
- 锚点：`top = 按钮 rect.bottom + 4`、`left = rect.left`（TileHeader.tsx:190）
  - 按钮元素定位按 terminalId（`.tile` 根 `data-terminal-id`，tileElsById）——**不用下标**：收起终端
    不进 `.tile` DOM 集合、本地乐观重排改 DOM 顺序，`fx.terminals` 全量下标会错位/越界（fix/worktree-
    popover-anchor 加性注记 2026-07-13；vitest worktree-live 回归 2 case + e2e item50 真机几何锚）
- 视口越界（WorktreePopover.tsx:227-237，宽 280 / 估高 200）：右溢 → `left = innerWidth - 280 - 8`；
  `left < 8` → 钉 8；下溢 → 翻上方
- portal 到 body：`.worktree-popover-overlay`（fixed inset 0，z-index 9999）点击关闭；
  浮层 `position:fixed`、z-index 10000

## 2. DOM 结构与样式（WorktreePopover.css）

`.worktree-popover-overlay > .worktree-popover > [header] [warning?] [create] [divider] [list]`

- `.worktree-popover`：宽 280px、max-height 320px 纵向滚动、bg `var(--bg-secondary, #1e1e2e)`
  （两侧主题表均未定义 --bg-secondary，**实际取 fallback #1e1e2e**）、`1px solid var(--border)`、
  圆角 8px、投影 `0 8px 24px rgba(0,0,0,.4)`、padding `8px 0`
- `__header`：11px 600 uppercase、letter-spacing .5px、色 `var(--text-muted)`、padding `4px 12px 8px`、
  文案固定英文 "Worktrees"
- `__warning`（仅 warning 非空）：11px、色 #fab387、bg rgba(250,179,135,.08)、左边框 2px #fab387、
  margin `0 8px 4px`、padding `6px 12px`、圆角 `0 4px 4px 0`，
  文案 `.git {sizeMB} MB — 创建可能较慢，建议清理历史大文件`
- `__create`：满宽左对齐按钮、透明底、色 `var(--accent)`、13px 500、padding `8px 12px`，
  文案 `+ New Worktree (from {主 worktree branch，缺省 main})`；creating 时 disabled（opacity .5）
- `__divider`：1px `var(--border)`、margin `4px 0`
- `__list`：flex column；行 `__item` = 满宽按钮（flex 行 gap 8px、padding `6px 12px`、13px
  `var(--font-mono)`、色 `var(--text-primary)`），组成：
  - `__dot`：6×6 圆点，amber `var(--accent)`；主 worktree `__dot--main` 绿 #a6e3a1
  - `__branch`：flex 1、单行省略
  - `__badge--current`（仅当前行）：10px 小胶囊、bg rgba(232,167,72,.15)、amber 字
  - `__badge--merged`（已合并且非主）：bg rgba(166,227,161,.15)、#a6e3a1 字
  - `__delete`（紧随 merged badge）：18×18 inline-flex 居中「✕」、11px、色 rgba(255,255,255,.4)
- 当前行 `__item--current`：bg rgba(232,167,72,.08)
- light 主题（[data-theme="light"]）：浮层 bg/边框/投影翻转 + merged badge 绿改 #40a02b（本批 golden 全 dark）

## 3. 状态行为

- 打开后链式异步：detectRepo → 非 repo 即 error「Not a git repository」；
  preCheck（失败静默吞）→ warning 置位；list → worktrees 置位；全程 loading 文案 "Loading..."
- **列表顺序**：主 worktree 置顶，其余按 list 返回序**倒序**（WorktreePopover.tsx:287）
- **当前行判定**：按 path 降序长度优先匹配 `terminalCwd === path || startsWith(path + '/')`
  （防主仓前缀吞掉 .worktrees/ 子路径，WorktreePopover.tsx:242-244）
- golden 两张：列表态 `wt-list`（main+current 同行、merged+删除✕ 行、新建按钮）、
  大仓警告态 `wt-warning`（warning 横幅 + 同列表）；loading/error/creating 走 dom-assert
- 行点击 = 在该 worktree 开新终端并命名为 branch；✕ = 删除 worktree；新建 = 创建 worktree
  并迁移主仓终端（均走桥，不进复刻屏）

## 4. live 功能实现（M6 批A，v9；复刻屏零感知）

- **开关态 web 本地**（LiveInteractions context，closeConfirm 范式）；关闭 = Esc / 点 overlay **背景** /
  操作成功后自动。overlay 全窗挂 `data-hit-island`。
  ★契约（dogfood-r2#4 根因 A 改写）：overlay 是浮层的**父元素**，关闭判定必须 `e.target === e.currentTarget`
  （仅 mousedown **直落 overlay 背景**才关）——浮层内行/按钮的 mousedown 会冒泡到 overlay，无 target 门则
  浮层在 click 生成前已卸载、内部点击真机必死（mousedown→mouseup→click 三连是真机序列；裸 click 派发的
  测试测不出，回归用例必须含 mousedown 前奏）。
- **打开链路一次往返**：`fs.request worktreeStatus{cwd}`（native 合并 detect+preCheck+list）——
  loading → ready（warning/worktrees 入态）| isRepo:false → 文案 "Not a git repository" |
  rejected → 显示 message。legacy 三连发 IPC 的中间态（§3 链式）由此收敛为两态。
- **warning 横幅文案 web 拼**：`.git {sizeMB} MB — 创建可能较慢，建议清理历史大文件`（§2 同式，
  协议只传 sizeMB）；TIMEOUT rejected 时按 legacy 特化句式结合手头 warning 拼提示。
- **行点击（含 current 行=再开一个，legacy 同义）**：`term.command create{cwd:wt.path}` →
  await created → `ui.action renameSubmit{terminalId, name:branch}` → 关浮层。
  ★契约（dogfood-r2#4 根因 B 改写，原「create 原生带 cwd、legacy 800ms `cd && clear` 补写不需要」
  的假设被 F-B 真机证据证伪——login shell 的 `.zshrc` 无条件 cd 会把 spawn cwd 漂走）：native 对
  **一切显式 cwd 的 create** 建成后经静默门注入 `cd -- '<cwd>' && clear`（CwdPinInjector，legacy 800ms
  盲延时的静默门版；真人键先到 → abort 不抢键盘）+ `noteInjectedCwd` 写权威 cwd（F-B 同缝，header
  不被 OSC7 漂移 clobber）。FAB/菜单/新窗播种/首窗空存档 fallback 之 cwd=nil（settings-dogfood 批改写
  含对抗 MINOR-1 回修补 fallback 链，真机 dogfood 2026-07-16
  「默认路径不生效」根因=此链无 pin、.zshrc cd 漂移无人纠正）：「终端默认路径」偏好**未设或失效 → 不触发**
  （保 .zshrc cd 既有习惯；失效目录的 homePath 兜底属落点半，不 pin）；**已设且有效 → 以
  `resolveDefaultCwdPin` 解析值同挂 pin**（`resolveDefaultCwd = resolveDefaultCwdPin ?? homePath` 委托，
  与 projection 落点同函数单一来源，零二次解析漂移）。chatResume 独立链路自带 cd，无双重注入。
  豁免登记（对抗回修 R-1，既有行为非本批引入）：①启动恢复重 spawn 的无锚/cannotRestore/isolate
  分支不注 cd（归 terminal-session-restore.md 管辖）；②chatResume 非法 sid/归档闸 block 降级分支
  纯新建无 cd——两处是否挂注入归 V1.1 裁决。
- **创建**：creating 置位（按钮 disabled，"Creating..."/大仓加后缀）→ `fs.request worktreeCreate{repoPath}`
  →成功走行点击同链开新终端；★**用户裁决（2026-07-06）：只新开不关旧**——legacy「关闭同仓主终端」
  迁移语义废弃，主仓终端保留（回归断言点：全链不发 close）。
- **删除（merged 非主行 ✕）**：`fs.request worktreeRemove{worktreePath}` → 成功重发 worktreeStatus
  刷新列表（不关浮层）；失败 error 显示。
- 每次打开带请求令牌，迟到应答丢弃（重开竞态防线）。

## 5. worktree 自定义名持久绑定（feat/worktree-custom-names，2026-07-16 用户拍板）

用户给 worktree 内的终端改名后，分支下拉列表该 worktree 行显示该名字，**持久绑定到 worktree
路径实体**：关终端 / 重启 app / 该 worktree 未开终端时均显示。

- **存储**：`WorktreeNamesStore`（`<dataRoot>/state/worktree-names.json`，`{worktree绝对路径: 名字}`），
  仿 ChatCustomTitlesStore（NSLock + AtomicFile、损坏空表兜底、等值 no-op 不落盘）。key 经
  canonicalKey 归一（解符号链接+标准化，/var↔/private/var 写读同 key）。不进 config.openTerminals
  （那是终端生命周期态；本映射绑路径实体）。
- **写入**（renameSubmit 正向链，与 title-sync 的 chatTitlesStore 块并列零共享）：该终端 cwd 经
  `worktreeRoot(forCwd:)`（找首个 `/.worktrees/` 标记截至其后一个组件）命中 worktree → `set(root, trimmed)`；
  空串 = 清映射；主仓/普通目录 cwd 不写（主行恒显 branch）。多终端同 worktree = 最后改名赢（同 key 覆写）。
  豁免登记：chatTitle 反向链（applyChatTitleToAnchoredTerminal）与 chatResume 标题继承走 projection
  直调不过 handleAction，不触发本映射——worktree 名只由用户显式改名驱动（设计内）。
- **读出**：`statusSync` 组装 WorktreeEntry 时 join `customName = names.get(wt.path)`（协议 v36 新
  optional 字段；主仓路径永不入表 → 主行天然 nil）。
- **清理**：`removeSync` 成功 → 清映射（名字随实体消亡）；`createSync` 成功 → 也清（编号 max+1
  复用同号同路径时防捡陈名）。
- **启动回填（存量升级，2026-07-16 用户反馈「之前的命名读不到」）**：AppDelegate 建 store 后，把
  config 持久化的开着终端（顶层扁平 openTerminals + windows[].openTerminals）的 (cwd, customName)
  经 `backfill` 补进映射——**只补缺**（已有 key 不覆盖：用户显式改名/清名优先；同 key 多候选先到
  先得），非 worktree cwd / 空名跳过，真有新增才落盘一次。本 store 引入前已命名的 tile 升级后
  立即可见；跨分身存量（其他数据根里的历史命名）由一次性种子脚本迁移，不进产品代码。
- **显示**（WorktreePopoverView）：有 customName 行主显自定义名 + `wt-N` 弱化小字（`__branch-code`）；
  无 customName 行 DOM 逐节点恒等（golden fixture 不含 customName → wt-list/wt-warning 零像素动）。
  行点击开新终端命名取 `customName ?? branch`（renameSubmit 回写映射，闭环自洽）。

| 用例名 | 断言 |
| --- | --- |
| WT_NAME_store_roundtrip_persist | set → 落盘；新实例重读同值；文件损坏 → 空表兜底不 crash |
| WT_NAME_root_derivation | `/repo/.worktrees/wt-19/src` → `/repo/.worktrees/wt-19`；主仓/普通目录/`.worktrees` 本身 → nil |
| WT_NAME_rename_binds_worktree | renameSubmit（终端 cwd 在 worktree 内）→ store 命中 worktree 根 = trimmed 名 |
| WT_NAME_rename_clear_removes | renameSubmit 空串 → 该 worktree 映射被清除 |
| WT_NAME_rename_main_repo_ignored | renameSubmit（终端 cwd 在主仓）→ store 零写入 |
| WT_NAME_last_rename_wins | 同 worktree 两终端先后改名 → store 值 = 后者 |
| WT_NAME_status_joins_custom_name | statusSync：有映射的 worktree 行 customName 携名；主行/无映射行 nil |
| WT_NAME_remove_clears_mapping | removeSync 成功 → 该路径映射消失 |
| WT_NAME_backfill_seeds_missing | 启动回填只补缺：已有 key 不覆盖、非 worktree/空名跳过、同 key 先到先得、落盘重读可见 |
| WT_NAME_create_clears_stale | 预置同路径陈名 → createSync 成功 → 陈名被清 |
| WT_NAME_popover_shows_custom_name | 行有 customName → 主显自定义名 + `__branch-code` 小字 = 分支名 |
| WT_NAME_popover_absent_dom_unchanged | 全部行无 customName → 无 `__branch-code` 节点，`__branch` 文本 = 分支名（golden 恒等面） |
| WT_NAME_item_click_names_custom | 点击带 customName 的行 → renameSubmit.name = customName（非 branch） |
| WT_PIN_default_cwd | create{cwd:nil} + defaultTerminalCwd 有效 → 注入 `cd -- '<解析值>' && clear`（§4：resolveDefaultCwdPin 与 projection 落点同函数，settings-dogfood 批） |
| WT_PIN_default_invalid_no_pin | 默认路径未设/失效 → 零注入（失效视同未设，不 pin homePath，保 .zshrc cd 习惯） |
