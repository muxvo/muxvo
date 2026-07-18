# usage-limit-alert：CC 用量 limit 90% 预警（提前换号提醒）

状态：v1.1（2026-07-11 用户拍板：静默检测 / 系统通知+app 内弹窗双保险 / 5h+7d 都监测；2026-07-12 用户拍板阈值 95→90，99 加急不动）

## §0 定位与边界

- 目标：订阅账号 5 小时窗口 / 每周限额接近 100% 之前（≥90%）提前提醒用户换号，避免 ~20 个终端同时被动停摆。用户在任一终端 `/login` 换号一次即全局生效。
- 与现有链路的关系：orch worker 的 `rate_limit_event`（TranscriptPager/WaitPlanner/OrchNotifier.hitLimit）是「已被限死」的**事后**处理，本 spec 是「即将被限」的**事前**预警，二者互补，本特性**不改动**该链路。
- v1 明确不做：不动桥协议（14/15 条）、无 web 面板 UI、不碰 orch 调度、不做多账号并行监测（监测对象=当前全局登录账号）、不做已有外来 statusLine 的包裹链。

## §1 数据源契约（CC 2.1.206 亲验，2026-07-11）

- CC 的 statusline 机制：`~/.claude/settings.json` 顶层 `statusLine: {type:"command", command:"…"}`；CC 每交互会话在状态变化时（300ms 防抖）以 stdin 喂 JSON 调用该命令，stdout 显示在终端底部（**空输出=不显示**）。
- stdin JSON 含可选字段（无 rate limit 数据时整个 `rate_limits` 键缺失，如 API-key 账号）：
  - `rate_limits.five_hour.used_percentage`：0-100 float
  - `rate_limits.five_hour.resets_at`：epoch **秒**
  - `rate_limits.seven_day.*`：同构
- 数据为**账号级**（unified rate limit，源自 API 响应头缓存）：任一活跃会话喂的都是当前登录账号的最新值。会话不活跃期间无更新（可接受：用量只在会话活跃时增长）。
- 取证结论（勿重查）：本地不落盘、无 headless `/usage`、转写 JSONL 无此字段——statusline 是唯一不碰 OAuth token、不刮屏的精确来源。CC 版本升级字段漂移风险由脚本静默容忍 + dogfood 冒烟兜底。

## §2 传感器脚本（muxvo-statusline.sh）

- 安装位置 `<dataRoot>/hooks/muxvo-statusline.sh`（0755），内容以 Swift 常量承载、安装时生成式写出（同 HookScript 理由：Resources 被 exclude 且 Package.swift 冻结）；顶部 `# muxvo-statusline-version: N` 指纹行供 drift 自检。
- 行为：读 stdin JSON → 提取两窗口 `used_percentage`/`resets_at`（全链可缺，缺哪个窗口就不写哪个键）→ 原子写 `<dataRoot>/run/usage-status.json`：
  `{"writtenAtMs": <epoch ms>, "fiveHour"?: {"usedPct": <float>, "resetsAt": <epoch 秒>}, "sevenDay"?: {…}}`
- 原子性：同目录 mktemp + rename（os.replace）——多会话并发写 last-writer-wins，读方永不见半截文件。
- stdout：**输出模板常量，v1 = 空串（静默，用户拍板终端不显示任何文字）**；改常量即可恢复显示（如 `5h 43% · 7d 12%`）。
- 健壮性硬约束：无 jq 依赖（用 /usr/bin/python3；python3 缺失 bash 层直接 exit 0）；任何异常（非法 JSON/写失败）一律静默 exit 0，**绝不污染 CC 终端**；墙钟耗时远低于 CC 5s 超时。
- 不设 MUXVO_TERM_ID 门：数据账号级，Muxvo 之外的 CC 会话贡献数据是收益不是泄漏。

## §3 安装 UX（StatusLineInstaller，对齐 HookInstaller 纪律）

- 授权先行：菜单「启用 CC 用量预警…」（或 env `MUXVO_STATUSLINE_PROMPT=1` 脚本化备用）→ NSAlert 授权卡 → 用户确认才写。启动路径只跑**只读自检日志**，绝不自动写真文件。
- 安装序：写脚本(0755) → 备份 `settings.json.muxvo-bak-<ts>`（同秒幂等保首份）→ StatusLineSettingsMerge 纯函数 merge → AtomicFile 原子写。
- merge 三态（`inspect`）：
  - `absent`（无 statusLine 键）→ enable 写入 `{type:"command", command:"\"<脚本路径>\""}`（引号裹路径，dataRoot 含空格）
  - `muxvo`（command 含 `muxvo-statusline.sh` 子串）→ enable 替换升级（幂等）；disable 删键
  - `foreign`（键存在且非 muxvo，含非对象形状）→ enable **拒绝**（抛 foreignStatusLine，弹「检测到已有自定义 statusLine，Muxvo 不覆盖」后放弃）；disable 不动
- 损坏 JSON → 拒绝覆盖（corruptSettings），绝不静默重写用户文件；未知顶层键全保留。
- 停用：菜单同项按状态切换为「停用 CC 用量预警」→ 备份 → merge disable → 原子写；脚本文件保留（无害，复用）。
- selfCheck 四态：`notInstalled`（settings absent 且不论脚本）/ `installed`（muxvo + 脚本在位 + 指纹匹配）/ `foreign` / `drift(reason)`（muxvo 但脚本缺失或指纹不匹配）——drift 只提示重新启用，不静默重写。

## §4 监测语义（UsageLimitWatcher）

- 采样：15s 定时轮询 `<dataRoot>/run/usage-status.json`（timer 工厂注入，测试手动 tick；不用文件监听——20 会话高频 rename 换 inode 反复重挂不划算，15s 延迟对 90% 边沿足够）。watcher **常开**（文件缺失/未安装 = no-op，成本≈0；中途菜单启用无需重启）。
- 阈值：level ∈ {90, 99}（常量集中一处；2026-07-12 用户拍板 95→90，99 加急不动）。每窗口（fiveHour/sevenDay）独立判定。
- 边沿去重：key = (window, resetsAt, level)。pct ≥ level 且 key 未 fire → fire 一次并登记；同 key 绝不重复（96→97→98 只响一次，99 跨越再响一次加急）。
- 再武装：① resetsAt 变化（窗口重置/换号）→ 旧 key 全部失效（按当前 resetsAt 清理登记）；② pct 回落 < level−5（滞回，防抖动反复触发）→ 该 key 撤销登记，再爬升可再 fire。
- 误报双守卫（满足其一即本轮不告警、不动登记）：
  - 陈旧：`nowMs − writtenAtMs > 10min`（所有会话已停，数据无意义）
  - 已过期：`resetsAt*1000 ≤ nowMs`（窗口已重置而文件未刷新）——仅跳过该窗口
- 解析失败 / 字段缺失 / 文件缺失 → no-op（不告警不崩溃）。
- 纯函数拆分：`parse(Data) -> UsageStatus?` 与 `decide(state, status, nowMs) -> ([UsageAlert], newState)` 均可直测。

## §5 提醒呈现（双保险，only-notify 纪律：只提示、绝不迁移任何状态）

- 系统横幅 + Dock 关注：OrchNotifier 第五类 `limitApproaching`，identifier = `usage.approach.<window>.<resetsAt>.<level>`（同窗口同重置期同级聚合一条）；文案含窗口名（5 小时窗口/每周限额）、百分比、重置时刻、行动指引「现在在任一终端 /login 换号（一次全局生效）」；账号 email 从 `~/.claude.json` 顶层 `oauthAccount.emailAddress` 只读 best-effort（失败 nil 静默省略）。level 99 文案升级为「马上用尽」。非真 .app 进程（swift run/裸可执行/测试）→ 跳系统横幅只 Dock，静默降级（沿 R2 硬约束；守卫谓词=真 .app 判据 `RealAppBundleGuard`——bundleIdentifier 判法会被 -sectcreate 嵌 plist 骗过，fix/r2-bundle-guard 根治）。
- app 内弹窗：主窗口 `beginSheetModal` **异步非阻塞**呈现（**严禁 runModal**——会卡主线程冻结终端渲染/PTY）；无主窗口时跳过弹窗（横幅已发）。点掉即走。

## §6 装配与时序（UsageAlertAssembly）

- `UsageAlertAssembly.make(settingsURL, dataRoot, now, makeTimer, notify) -> (installer, watcher)`：组合根（AppDelegate）逐字调它——装配级测试的被测面（M4b 教训：单测注入 fake 掩盖组合根断点）。
- AppDelegate didFinishLaunching：OrchNotifier 提升为启动期单例（orch 装配复用同实例）→ assembly 接线（notify = 横幅 + 弹窗）→ installer 只读自检日志 → watcher 常开。
- 菜单：App 菜单「启用 CC 用量预警…」/「停用 CC 用量预警」（同项按 selfCheck 状态切换标题）。

## §7 测试策略

- merge 纯函数、watcher 边沿状态机（假时钟+spy）、脚本（Process 跑 /bin/bash + $TMPDIR fixture）、installer（$TMPDIR 假 settings，绝不碰真文件）分层直测；装配级红绿锚走真文件真 parse 真判定（仅 timer 手动 tick、notify 用 spy）。
- 真机 e2e：见计划验证节（脚本直验 / 手写 usage-status.json 触发 / 真 CC 会话冒烟含「终端底部无可见变化」断言）。

## §8 案例表（spec↔test 1:1 命名池）

| 案例 | 断言 |
|---|---|
| UL_merge_install_shape | enable 于空场写出 `{type:command,command:"…muxvo-statusline.sh…"}`，未知顶层键全保留 |
| UL_merge_idempotent | 二次 enable 替换升级（不重复、新 command 生效） |
| UL_merge_foreign_refuse | 已有外来 statusLine → enable 抛 foreignStatusLine，原文不动 |
| UL_merge_disable_only_muxvo | disable 只删 muxvo 的 statusLine；外来/缺失不动 |
| UL_merge_corrupt_refuse | 损坏 JSON → 抛 corruptSettings 拒绝覆盖 |
| UL_inspect_tristate | inspect 三态 absent/muxvo/foreign（含非对象形状=foreign） |
| UL_script_writes_atomic | 完整 fixture stdin → usage-status.json 形状正确（writtenAtMs+两窗口）且无临时残片 |
| UL_script_silent_stdout | stdout 为空（用户拍板静默） |
| UL_script_missing_fields | 无 rate_limits → exit 0、文件只有 writtenAtMs 无窗口键 |
| UL_script_invalid_json_exit0 | 非法 JSON stdin → exit 0、不写文件 |
| UL_script_fast | 墙钟 < 2s（防 CC 5s 超时） |
| UL_edge_fire_at_90 | pct 96 首见 → fire 一次 level 90 |
| UL_edge_dedupe_same_window | 96→97 同 (window,resetsAt) 不再 fire |
| UL_edge_rearm_on_reset | resetsAt 变化 → 同窗口再 fire |
| UL_edge_hysteresis | 96→92（≥85 未回落够）不再武装；96→84（<85）回落后再爬 96 → 再 fire |
| UL_edge_level_99 | 96 已 fire 后爬 99.5 → 追加 fire level 99 |
| UL_edge_stale_no_fire | writtenAtMs 距今 >10min → 不 fire |
| UL_edge_expired_resets_no_fire | resetsAt ≤ now → 该窗口不 fire |
| UL_watch_missing_file_noop | 文件缺失 → tick 无 fire 无崩溃 |
| UL_install_selfcheck_states | install→installed；删脚本→drift；改指纹→drift；foreign 场→不写 settings |
| UL_assembly_file_to_notify | 装配级红绿锚：真组合缝 + 真文件——无文件 tick 不触发（红）；写 96% 文件 + tick → spy 收到（绿） |
