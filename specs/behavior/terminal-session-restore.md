# 行为规格：终端会话恢复（崩溃/重启后 resume harness 会话断点）

> 状态：**v1-frozen（2026-07-07：五视角评审 9B/32M/27m 全回写 + 四技术裁决落地 + 双独立裁判 GREEN〔logs/m4b-judge-{a,b}.md〕+ 用户 10 项产品裁决回写〔P-1~P-9+COST-1，_INDEX §5 台账〕）**。修订史：draft-r0→r1（S1/S2/S6）→r2（评审簇 B/F 回写）→用户裁决回写（P-1 自动回车/P-2 CC-only/P-3 皆恢复）→冻结→**r3（2026-07-13 用户拍板激活 P-2 fast-follow：Codex 自动恢复交付，登记 12 + §1.5 + §5 TSR_CX_ 组）**。
> **全新功能**（M3 只恢复终端窗口到各自 cwd，不续会话）。权威：`docs/REBUILD-PLAN.md:103`（★用户需求
> 2026-07-04）+ M3 wait-detector hook 事件已含 `session_id` 的技术锚点。诚实边界：恢复的是 **harness 会话
> 对话上下文**（`claude --resume <sessionId>`），**shell 自身/非 harness 进程状态不承诺**（只回 cwd = M3 现状）。
> 裁决点 ★=用户裁决 ☆/T=独立 agent 裁决。
> 近亲规格：`wait-detector.md`（锚点来源 = 同一 WaitEventBus）、`terminal-session.md` §9/§6（终端持久化与恢复
> 现状）、`scheduler-worker.md` §4.7/§6（**编排侧接管终端/worker 会话恢复自管——本规格出界**，防双恢复）。
> target：`MuxvoTerm`（SessionTracker + 持久化 + 恢复注入）+ `MuxvoAppCore`（InitialCommandInjector 泛化）。

## §0 范围与诚实边界

- **做**：app 崩溃/重启后，崩溃前**普通可见终端**里正在跑的 CC 会话，重启后自动 spawn shell 回 cwd 并注入
  `claude --resume <sessionId>` 接续断点。
- **诚实边界**：恢复 = harness 会话**对话上下文**；**不恢复** shell 变量/别名/后台作业、vim/ssh/普通命令等
  非 harness 进程状态、终端 scrollback 历史像素（重启即空）。这些 M4b 不承诺。

### 出界清单（严禁在本规格实现，防双恢复/职责漂移）

| 出界对象 | 归属 | 界线 |
|---|---|---|
| **任务接管终端**（`TakeoverTerminalManager`） | `scheduler-worker.md` §4.7⑥ | paused_human 过 reconcile 保态；接管终端随 app 死 → 面板「重开终端」= `takeOver` 幂等重建。**不进** SessionTracker、**不写** 本规格持久化文件。 |
| **worker 会话恢复**（headless） | `scheduler-worker.md` §6 存活和解 | 孤儿收尸 + `makeResumePlan(tasks.session_id)`，DB 驱动。与本规格互不触碰。 |
| **指挥台终端** | `command-console.md`（③，起草中） | 其会话恢复（若需要）归该规格自身；本规格只管**用户手起的普通终端**。 |
| 非 harness 进程状态 | —— | 只恢复 cwd（M3 现状），不承诺。 |
| ~~Codex 标准可见终端会话~~（**已出界转入界，r3**） | 【P-2 fast-follow 已激活，用户 2026-07-13 拍板】 | v1 曾裁 CC-only（S6：收敛面而非能力缺口）；**r3 起 Codex 标准可见终端会话恢复正式入界**——锚点采集经 CodexAnchorTracker（§1.5，前台探针 + rollout 定向匹配，替代 CC 的 hook 源），恢复链复用同一 planner/闸/注入器（换命令串 `codex resume <sid>`）。编排 worker 侧 Codex resume 仍由 CodexAdapter 自管（出界不变）。 |

## §1 锚点采集（SessionTracker）

- **SessionTracker = `WaitEventBus` 新订阅者**（第三订阅者：M3 detector hub / M4a 编排引擎为前两个；多播已支持，
  `WaitEventBus.swift`，各订阅者独立 `deliverOn` 队列互不阻塞）。**独立于 detector 主链**——异常不回传 bus。
- **采集源**：CC hook 事件（`WaitEventKind.notification/.stop/.userPromptSubmit`）的 `WaitEvent.raw`（= CC hook
  stdin 原始 JSON 文本，`WaitTypes.swift:26`）。白名单抽取三字段：`session_id`（→sessionId）、`cwd`、
  `transcript_path`。harness 种类 **不从 raw 推断**——M4b hook 仅来自 CC（`wait-detector.md` §5）→ 常量 `.cc`。
  S1 §2 实测：SessionStart/UserPromptSubmit/Stop payload **皆即时携** `{session_id, transcript_path, cwd}`——
  故三字段从 hook payload **直接取**，**绝不 glob `projects/` 找文件名**（S1：文件可能整场不存在，`transcript_path`
  只指向将来路径）。
- **无条件登记纪律（S1/S2 定案，硬约束）**：锚点在**首个 hook 事件到达即无条件登记**——**transcript 文件存在性
  绝不能做持久化写入的条件**（S1/S2 实证落盘时机不可控：短/程序驱动会话可能整场零落盘、长会话秒级 debounce）；
  否则最该恢复的短会话锚点永远写不下去。**一句话：hook 到达即登记锚点（无条件），resume 前才校验文件在盘
  （有条件，§3 预检）。** 最理想即时源是 **SessionStart**（S1/S2）；**2026-07-16 起 SessionStart 已加装**（登记 4 兑现，
  `wait-detector.md` §5 四装一不装）——采集源为四 hook（notification/stop/userPromptSubmit/sessionStart），
  **resume/启动即锚定**：堵「resume 起来但从未再对话的会话零 hook 事件 → 永无锚点 → 意外关闭不可恢复」
  缺口（真机案例 2026-07-16 测试7 wt-8 格，会话 77f79f11：最后对话轮后 claude 退出正确清锚，其后多次
  resume 零对话 → 无锚 → SIGKILL 后仅回 shell）。
- **fail-open 纪律**（硬约束）：`raw==nil` / 非法 JSON / 缺 `session_id` → **不产锚点、不抛错、零影响 detector
  主链**。解析按不可信数据（大小上限、字段白名单），绝不 eval/透传 shell。
- **锚点更新**：命中即以 `{sessionId, harness:.cc, cwd, transcriptPath, lastActiveTs = event.ts}` 覆盖该 termId
  条目（「最近活跃会话」语义：同终端换新会话 → 新 sessionId 覆盖旧）。
- **清条目**：`.processExit`（前台 harness 退出）/ 用户显式关闭终端（`term.command close` 用户路径，
  `terminal-session.md` §3.2）/ 终端移除 → 删该 termId 条目。
- **ownership 排除过滤（found B-2，防双恢复，硬约束）**：SessionTracker **采集前先查 termId↔taskId 绑定表 / ownership 标记**——ownership ∈ `{human, worker, takeover, brain}`，**只采集 `human`（用户手起的普通终端）**。交互式 worker（ownership=worker，`interactive-worker.md` ①）、接管终端（takeover）、指挥台（brain）的终端**同样是 `SessionRegistry` 终端、同样发带 `session_id` 的 hook 事件**，若不过滤会被 SessionTracker 抓成锚点 → 与调度器 §6 存活和解 / §4.7 接管重建**双恢复**（同一会话被两条路径各起一次）。ownership 由 §1 绑定表（`interactive-worker.md`）+ takeover/brain 终端登记提供；查无绑定 = human（默认，向后兼容纯人终端）。`TSR_no_double_restore_takeover` 据此改机制断言（§5）。
- 采集**内容盲**：只取 sessionId/cwd/transcript_path 定位用，不解读会话内容（核心原则二边界）。

## §1.5 Codex 锚点采集（CodexAnchorTracker，r3 / P-2 fast-follow 2026-07-13）

Codex 无 hook → 锚点来源改「前台进程识别 + rollout 定向匹配」双证据关联。全部设计裁决随 r3 冻结：

- **触发**：挂 `SessionHub.pollWaitDetector()` 既有 1s 聚合 tick，**零新 timer、不挂 ChatSourceWatcher**
  （chat 装配可整体降级〔ChatAssembly.make 失败即缺席〕，采集器不押其可用性；前台退出检测反正需要轮询）。
  每 tick 一次**统一前台探针 pass** 产 `[shellPid: ForegroundState]` 快照，WaitDetectorHub 与本采集器共享
  ——**净 exec 数与 M3 现状持平**（不翻倍 pgrep/ps）。`ForegroundProbe` 增三态 `{idle, running(name),
  unknown}`：清锚点判定必须区分「确认不是 codex」与「探测失败」（旧布尔 API 语义不变，在三态上派生）。
- **绑定算法**（每 termId 状态机 idle→pendingBind→bound）：human 终端（ownership 过滤复用 §1）前台名
  从非 codex 变 `codex` → pendingBind（时间窗起点 = 观测时刻 - 3s slack，容忍探测周期与 eager 落盘先后抖动）
  → 定向列候选（**只列覆盖窗口的日期目录**〔本地今天+昨天+UTC 今天，跨午夜/时区安全〕、mtime ≥ 窗起点的
  `rollout-*.jsonl`、只读**首行**（硬上限 256KB，只读前 N 字节）session_meta 取 `payload.{id,cwd}`）→ **cwd 归一后恰好 1 个候选匹配终端
  OSC7 cwd 才绑**（归一 = 去尾斜杠 + `/private` 别名，同 cwd-pin 口径）。0 个 → 留 pending 重试（rollout
  可能晚于进程起）；≥2 个 → **保守跳过**（与 §3 join「歧义不猜」同哲学：宁可不恢复绝不误 resume 他会话）。
  扫描退避：pending 前 20 tick 每秒、之后每 5s 一次；**idle/bound 态零文件系统触碰**（M5 P0 594MB 全量扫
  教训——本采集器严禁 `findAllSessionFiles` 类全量扫，候选上限 32）。
- **锚点生命周期**：绑定即 `updateAnchor(harness:.codex, transcriptPath=rollout 绝对路径)`；bound 且前台仍
  codex → **60s 节流** touch lastActiveTs（不逐 tick——否则去抖 store 每秒落盘）；**连续 2 次「确认非
  codex」观测**（idle 或 running(非 codex)；unknown 不计数亦不清计数）→ `clearIfMatches(termId, .codex,
  boundSessionId)` **条件清除**——防跨 harness 竞态（退 codex 秒起 claude 时 CC hook 已写新 .cc 锚点，无
  条件 clear 会误删）。用户关终端/终端移除走既有 `store.clear` 路径（零改动）+ 采集器状态复位。同终端
  CC↔Codex 切换 = 两采集源写同一 store 键、最近活跃覆盖（§1 语义不变）。
- **恢复侧**：planner harness 闸放行 .codex；transcript 预检容器 per-harness（.cc=`~/.claude`、
  .codex=`~/.codex/sessions`，锚点 harness 无对应容器 → cannotRestore）；注入串经
  `ResumeCommand.Harness(TerminalHarness)` 单向映射取 `cd -- '<esc>' && codex resume <sid>`（登记 8 已证
  形；sid 同过 isValidSessionId 严格 UUID + 控制字节闸，防护面与 CC 对称）。crash-loop 熔断/并发闸/静默门/
  尺寸就绪门/人键 abort/审计取证**全部零改动复用**（审计行加 harness 字段）。
- **诚实边界（r3 新增，heuristic 有界残余如实定界）**：
  - 嵌套 shell/tmux/screen 里跑的 codex 采不到（前台探针只看 shell 直接子进程）——退化 M3，不误绑；
  - codex TUI 内换会话（`/new` 等）**不追踪**（追踪需再开 cwd 匹配窗 = worker rollout 误绑放大器）——
    崩溃后恢复到前一个会话（轻度陈旧、无害）；重绑唯一路径 = 前台退出确认 → 清 → 再起 → 重新 pendingBind；
  - 依赖 `ps -o comm=` 进程名恰为 `codex`（Rust 原生二进制成立；包装形态采不到 → 退化 M3）；
  - 同 cwd 多终端同时起 codex → 双双不绑（保守跳过，本机自愈：先后错开 3s 窗即各绑各）；worker 会话
    rollout 与 human 终端同 cwd 撞窗的残余风险由 ownership 过滤 + 唯一候选判据压低，不承诺归零；
  - **旧版二进制降级上界 = M3**：锚点文件含 .codex 条目后，旧版（整体严格解码）读入全丢 → 全部终端退化
    纯 cwd 恢复（无数据损坏、无误注入）；r3 起读盘宽容逐条解码（坏条目只丢该条），为未来枚举再扩兜底。

## §2 持久化（terminal-active-sessions.json）

- **独立文件** `<dataRoot>/run/terminal-active-sessions.json`（与 `pty-children.json`/`hook.sock` 同 `run/` 域：
  瞬态运行物，但内容须跨重启存活作恢复依据，同 pty-children 先例）。**不复用 `openTerminals`**：写频不同
  （openTerminals 仅布局变化写 config.json；本文件随会话活跃高频更新）、语义不同（窗口布局 vs 会话断点）。
- **形状**：`{ "<termId>": { sessionId, harness, cwd, transcriptPath, lastActiveTs, resumeAttempts?, lastResumeTs? } }`。
  `resumeAttempts`/`lastResumeTs` = crash-loop 熔断计数（MAJ-2，见 §4）；缺省 0/nil。
- **写**：锚点更新 → **去抖 ~1s** 落盘（`AtomicFile`，`durability:.full` 同 pty-children——崩溃后须可读）；
  文件权限 **0600**（SEC-M2：sessionId/transcriptPath/cwd 是可导向 resume 注入的定位物，仅属主可读写，同 `hook.sock` 0600 口径）。
  去抖窗内崩溃至多丢最近 ~1s 锚点更新；sessionId 一会话内不变，回退到上一锚点仍可 resume（诚实边界，可接受）。
- **join 键问题（核心设计张力，见 §3 恢复）**：openTerminals 现只持久化 `{cwd, customName?}`、**无稳定 termId**
  （`ConfigStore.swift:39-45`），而 termId 是 native 每次 spawn 新生成 UUID → 重启后旧 termId 无法直接对上新
  终端。恢复须以**稳定 termId** join 两侧 → 需 openTerminals 增持久化 termId（正好兑现 `ConfigStore.swift` 偏差②
  「稳定 UUID 是否入持久化留裁决」）。见 §3 与文末「冻结面修订需求登记」【T-3】。

## §3 恢复流程（启动装配，在 restoreTerminals 路径内）

现状 `UIStateProjection.restoreTerminals`（`UIStateProjection.swift:398-415`）逐 openTerminals entry 重 spawn
新 shell 到 cwd。本规格在其上叠加「会话锚点恢复层」：

1. 读 `terminal-active-sessions.json` → `{termId: anchor}`。
2. 逐 openTerminals entry spawn shell 到 cwd（沿用现有逻辑：坏 cwd 回退 homePath，不因单条坏 cwd 丢终端）。
3. 按**稳定 termId** join 锚点（旧 config 无 id → best-effort cwd+顺序匹配，匹配不上退化为 M3 纯 cwd 恢复，【T-3】）。
4. 有锚点的终端逐条过闸（**任一闸不过 → 只留普通 shell 到 cwd = M3 现状**，不报错）：
   - **复检三字段（SEC-M2）**：restore 前对每条锚点复检 `{sessionId, transcriptPath, cwd}` 齐备且类型合法（防落盘损坏/半写）；任一缺失即退化 M3。
   - **transcriptPath 预检（唯一「文件存在」硬闸 + SEC-M1 规范化）**：先 **`realpath` 规范化** `anchor.transcriptPath`（解析 `..`/symlink），再校验规范化后路径**落在 `~/.claude/`（或隔离 configDir）容器内**——防 `../` 穿越 / symlink 逃逸把预检变成任意路径存在性探测；容器内且文件**在本机存在**才过（陈旧/多设备锚点防线，【T-2】）。**规范化后路径仅用于「文件存在」预检、绝不拼进注入命令**（注入只用已校验 sessionId）。
   - **sessionId 严格 UUID 正则（SEC-M3，收紧）**：`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`（**替代 draft-r1 过宽的 `^[0-9a-f-]+$`**——旧式允许纯 `-`/前导 `-`，可被解析成选项）；不匹配即跳过。注入时另加 `--` 断选项（见 §3 注入路径）。
   - **crash-loop 熔断（MAJ-2）**：查该锚点 `resumeAttempts`——若已达阈值 **K**（隔离阈值，实现批定，如 3）且最近失败在近窗内 → **隔离该锚点**（本次不注入、退化 M3）+ 计入横幅「N 个会话反复崩溃已暂停自动恢复」。判据：注入后 **T 秒内** worker/终端崩溃 = 计一次 `resumeAttempts++`（注入即 `lastResumeTs` 打戳，二次启动见「上次 resume 后 T 秒内又崩」即累加）。K 次 → 隔离，避免「注入→崩→重启→再注入」死循环烧资源/反复弹窗。
   - **harness 支持闸**：r3 起 `.cc`/`.codex` 皆放行（P-2 fast-follow 已激活，§1.5）；闸保留作未来新
     harness 的收窄位（枚举扩了但恢复链未接好前在此挡下）。transcript 预检容器随 harness 选
     （.cc=`~/.claude`、.codex=`~/.codex/sessions`）。
4.5. **跨子系统重启恢复并发闸（MAJ-3）**：N 个终端同时有锚点时，**在飞 resume ≤ M 串行/小并发放行**（M 实现批定，如 2-3）——避免重启瞬间 N 个 `claude --resume` 同时起把机器打满（CPU/内存/凭据握手风暴）。闸是**恢复注入层的节流**，与调度器 worker 恢复各自独立（本规格只管人终端恢复；worker 恢复并发归 `scheduler-worker.md` §6）。
5. 全闸过 → 让恢复终端接续会话（注入路径**案 A 推荐 / 案 B 备选**，S2 定；尾部回车=自动回车，【P-1】已裁）。**注入落审计/取证行（SEC-m1）**：恢复自动执行 `claude --resume` 属「app 代人自动跑命令」，须留本地取证——记 `{termId, sessionId, cwd, ts, resumeAttempts}` 到本地恢复日志（非 audit_log 编排面；恢复是终端行为非任务事件），供「重启后自动跑了什么」可追溯。

### 注入路径（S2 定案：案 A 推荐；案 B 降备选保留行为形状）

> spike **S2（注入时序）已完成（2026-07-06，`logs/m4b-spike-s2.md`）→ 定案案 A（注入）为推荐案**。恢复的资产复用
> `TakeoverTextInjector`（`TakeoverTerminalManager.swift:65-104`：静默门 500ms/超时 8s/规范化剥控制字节）泛化为
> **InitialCommandInjector**。S2 数据：静默门 140 次注入实验 **100/100 ok（含慢 rc）**、不带门慢 rc 下 3/20 撞碎 →
> 门**必要且充分**；真 CC resume 端到端**正测试 PASS**（对已落盘会话注入 `cd <dir> && claude --resume <sid>` + CR，
> CC 起来、还原上文、答出埋入的口令）；**静默门参数（500ms/8s）实测背书可冻结为默认**，另须显式前置 `seen_first`
> （注入前先见首输出，空 shell 尚未回显时注入同样有碎裂风险）。

- **注入命令形状 + cwd shell 转义（SEC-B1，二选一定案：选「转义 cwd」）**：注入串 = `cd -- '<escaped cwd>' && claude --resume -- <sessionId>`。**cwd 单引号转义**：整个 cwd 用单引号包裹，内部 `'` → `'\''`（闭引号+转义单引号+开引号）——单引号内 shell 不做任何展开，杀死 `$()`/`;`/`&&`/空格 等全部元字符注入面。`cd --` / `--resume --` 各加 `--` 断选项（防前导 `-` 的 cwd/sessionId 被当 flag）。**为何选「转义 cwd」而非「不发 cd 靠 spawn chdir」**：案 A 的终端首进程是 login shell，其 `.zshrc` 会把 cwd 漂到别处（S2 实测），故不能靠 spawn 时的 chdir——**必须在注入串里显式 re-cd**；既然要发 cd，就转义之。cwd 源自 hook raw（不可信，§1）故转义是硬需求。
- **案 A（注入普通 shell）【推荐案，S2 背书】**：终端首进程 = 普通 login shell；InitialCommandInjector 走静默门（首输出=提示符回显后
  静默 ≥silenceMs 才写）→ `write("cd -- '<escaped cwd>' && claude --resume -- <sessionId>")`。尾部 CR 语义**已裁（P-1，用户 2026-07-07：自动回车）**：
  - **定案=自动回车**：InitialCommandInjector **在本场景**允许尾部单个 CR（与 TakeoverTextInjector「绝不发 CR」不变量分道，登记
    【T-4】）。风险面比接管注入窄（目标是**空 shell 提示符**非活体 CC TUI，注入串是 app 生成固定形，最坏 = 无害报错）。
  - ~~落选案=只打字~~（复用 `normalize` 剥 CR/LF、用户自己按回车）：更保守但每终端每次重启需人工一次回车，削弱「一模一样接续」——用户裁落选，保留作降级参考。
- **案 B（首进程 exec）【备选案，注入保真度若日后翻车的退路，保留行为形状】**：终端首进程直接 = `claude --resume <sessionId>`（argv 给定，非普通 shell）→ **无注入时序、
  无 CR 问题**（进程即命令）。代价：CC 退出后终端行为需定义（落回 shell / 关闭），且「下面没有一个正常 shell」——与用户强需求「跟平常终端用 CC 一模一样」（[[feedback-task-detail-live-terminal]]）弱契合，故 S2 桌面分析倾向案 A。折中可用 `zsh -c 'claude --resume …; exec zsh -l -i'` 兼得案 B 确定性与可用 shell。
- **注入 vs 人键竞态 → 检出人键即 abort 注入（feas M-9，硬约束）**：恢复注入是「app 代人打字」，若人在恢复瞬间已开始往该终端打字，机器注入与人键交错会污染两边。**注入前/注入中检出任意 `USER_INPUT`（真人键盘字节）→ 立即 abort 注入、退化为普通 shell 到 cwd**（人自己接管这个终端，M3 现状），不续发注入串。provenance 判定复用 `wait-detector.md` §3 的输入来源机制（只认真人 key event，排除自动回显/程序注入）。与静默门正交：静默门防「shell 未就绪就注入撞碎」，本闸防「人已介入还硬注入」。abort 属正常退化，不报错、不计 crash-loop 失败。
- **【P-1】已裁（用户 2026-07-07）**：自动回车。裁决依据与两案对照见开放问题 P-1 框（S2 数据背书）。

## §4 语义边界

- **崩溃 vs 正常退出（【P-3】已裁，用户 2026-07-07：皆恢复）**：**崩溃 + 正常重启皆恢复**——任意重启都 resume 上次活跃会话；正常退出**不**清锚点。唯一清锚点动作 = §1 清条目路径（前台 harness 自退 / 用户显式关终端 / 终端移除）。
- **staleness（【T-1】，推荐写死）**：锚点**不设时限**——只要 `transcriptPath` 文件在本机存在就尝试 resume。理由：
  CC 会话不自过期、transcript 在盘即可 resume；设时限反而丢长任务上下文。唯一失效判据 = §3 预检文件不存在。
- **多设备（【T-2】，推荐写死）**：坚果云/多设备同步 config 可能带来他机锚点（本机无对应 transcript）→ §3 预检失败 →
  跳过该终端 resume（仅普通 shell 到 cwd）+ **顶部横幅**「N 个会话无法在本机恢复」。不静默、不误 resume。
- **安全**：①sessionId **严格 UUID 正则** `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`（SEC-M3，替代过宽的 `^[0-9a-f-]+$`，§3）+ 注入加 `--resume -- <id>` 断选项；②`cwd` 沿 restoreTerminals 现有防御（`isValidDirectory`/坏 cwd
  回退 homePath）+ **注入串里单引号转义**（SEC-B1，`cd -- '<escaped>'`，§3 注入路径）；③`transcriptPath` **先 `realpath` 规范化再校验落在 `~/.claude/`（或隔离 configDir）容器内**（SEC-M1，解析 `..`/symlink 防越界读探测），仅作「文件存在」预检、**不拼进命令**；④注入串 = `cd -- '<escaped cwd>' && claude --resume -- <已校验 id>`，全 app 生成固定形 + 转义 + 断选项，非用户自由文本——注入面比接管 pendingText 更窄；⑤`terminal-active-sessions.json` **0600**（SEC-M2，§2）；⑥恢复注入落本地取证行（SEC-m1，§3 步5）。
- **crash-loop 熔断（MAJ-2）**：锚点带 `resumeAttempts`/`lastResumeTs`（§2）；注入后 T 秒内崩溃计一次失败，累计达 K 次 → **隔离该锚点**（停自动恢复）+ 顶部横幅「N 个会话反复崩溃已暂停自动恢复，可手动重开」。防「注入→崩→重启→再注入」死循环。计数跨重启累加（落盘在锚点内），成功续跑（存活过 T 秒窗）→ 清零。
- **并发闸（MAJ-3）**：重启瞬间 N 终端同时有锚点 → 在飞 resume ≤ M 串行/小并发放行（§3 步4.5），防 N 个 `claude --resume` 同起打满机器。
- **幂等**：同一启动只恢复一次；恢复注入失败（超时/静默门不达/规范化后空）→ 降级为普通 shell（TakeoverTextInjector
  既有返回 false 语义），不阻塞其余终端。
- **短会话零落盘 = 诚实边界（S1/S2 新条目）**：崩溃时会话若**从未落盘**（transcript 文件不存在）→ **不可恢复**。S2
  负测试实证：`claude --resume <sid>` 对零落盘会话报 `No conversation found` 干净退出（headless 与交互式一致、**不伪装
  活会话**）。§3 预检文件不在盘即走此分支——仅普通 shell 到 cwd + 顶部横幅**如实说**「N 个会话无转写无法恢复」（同多设备
  横幅口径，不静默、不盲注 resume）。转写文件 = resume 的唯一真相源（S2）。
- **恢复 cwd 须为已信任项目（S2 建议5）**：交互式 `claude --resume` 在**未信任的 cwd** 下会先弹「trust this folder」
  onboarding 拦住整个 turn（S2 头一次跑即撞上）。真实恢复发生在用户已在 app 内打开/信任的项目，通常无碍；本规格**显式
  假设「恢复 cwd = 已信任项目」**，并把「未信任 → onboarding 弹窗」列为 hook 管不到的 **TUI 升级人类场景**（呼窗给人点、
  绝不机器盲按——核心原则二）。注入命令须显式 `cd <锚点 cwd>` 锚定（登录 shell 会因 `.zshrc` 漂到别处，S2 实测）。

## §5 案例表（spec↔test 1:1，前缀 `TSR_`；含 2 条 SIGKILL 集成场景归 MuxvoLifecycleTests）

| 用例名 | 断言 |
|---|---|
| TSR_anchor_from_hook | notification/stop/userPromptSubmit 事件 raw 解析出 session_id/cwd/transcript_path → 锚点更新，lastActiveTs=event.ts，harness=.cc |
| TSR_anchor_from_sessionstart | sessionStart 事件同样登记锚点（登记 4 兑现：resume/启动即锚定，未再对话也可恢复）；ownership 过滤同样生效 |
| TSR_anchor_parse_failopen | raw=nil / 非法 JSON / 缺 session_id → 不产锚点、不抛错、detector 主链快照零影响 |
| TSR_anchor_latest_wins | 同 termId 后到新 sessionId 覆盖旧（最近活跃语义） |
| TSR_clear_on_process_exit | processExit 事件 → 清该 termId 锚点 |
| TSR_clear_on_user_close | 用户显式关终端（close 用户路径）→ 清锚点；自退/移除同理 |
| TSR_persist_debounced | 高频锚点更新去抖 ~1s 落盘一次（假时钟）；AtomicFile 原子、durability .full |
| TSR_persist_roundtrip | 落盘后重读形状一致 `{termId:{sessionId,harness,cwd,transcriptPath,lastActiveTs}}` |
| TSR_restore_injects_resume | 有效锚点 + transcript 存在 + sessionId 合法 → 恢复终端下发 `cd -- '<escaped cwd>' && claude --resume -- <id>`（**含 cd 前缀**，案 A 注入=推荐 S2 背书 / 案 B exec=备选） |
| TSR_cwd_shell_escaped | cwd 含 shell 元字符（`$()`/`;`/空格/`'`）→ 注入串单引号转义（内 `'`→`'\''`）+ `cd --` 断选项 → 无命令注入执行（SEC-B1） |
| TSR_untrusted_cwd_escalates | 恢复 cwd 为未信任项目 → `claude --resume` 撞 CC「trust this folder」onboarding 弹窗（hook 管不到）→ **呼窗升级人类处置、native 绝不盲按**（核心原则二，§4） |
| TSR_precheck_transcript_missing_skips | transcript 文件本机不存在 → 跳过 resume、仅 spawn shell 到 cwd（M3 现状）+ 计入横幅计数 |
| TSR_transcript_realpath_containment | transcriptPath 带 `..`/symlink 指向 `~/.claude/` 外 → realpath 规范化后容器校验失败 → 跳过 resume（SEC-M1，防越界读探测） |
| TSR_sessionid_whitelist_rejects | sessionId 不匹配**严格 UUID 正则** `^[0-9a-f]{8}-…-[0-9a-f]{12}$`（含前导 `-`/纯 `-` 旧式被拒）→ 跳过注入（SEC-M3），退化普通 shell |
| TSR_anchor_file_0600_and_recheck | 锚点文件落盘 0600（SEC-M2）；restore 前复检 `{sessionId,transcriptPath,cwd}` 三字段齐备合法，缺失/损坏 → 退化 M3 |
| TSR_bad_cwd_falls_back | 锚点 cwd 已失效 → 回退 homePath（沿 restoreTerminals 防御），闸后 resume 语义不变 |
| ~~TSR_harness_cc_only~~（r3 退役） | ~~harness=.cc 才恢复~~——P-2 fast-follow 激活后语义反转，由 TSR_CX_harness_codex_supported + TSR_CX_lenient_decode_drops_bad_entry 接替（闸放行 .codex；未知 harness 仍被挡且只丢单条） |
| TSR_no_double_restore_takeover | **（机制断言，found B-2）**SessionTracker 采集前查 ownership，只采 human 终端；worker/takeover/brain 终端**不进** SessionTracker/本恢复路径（各由调度器 §6/§4.7 自恢复）→ 无同会话双恢复 |
| TSR_crash_loop_isolates | 同锚点注入后 T 秒内反复崩溃累计 K 次 → 隔离该锚点停自动恢复 + 横幅计数（MAJ-2）；存活过 T 秒窗 → resumeAttempts 清零 |
| TSR_resume_concurrency_gated | 重启时 N（>M）终端同时有锚点 → 在飞 resume ≤ M 串行/小并发放行（MAJ-3），不同起 N 个 claude --resume |
| TSR_user_input_aborts_injection | 注入前/中检出真人 key（provenance 复用 wait-detector §3）→ abort 注入、退化普通 shell（feas M-9）；不报错、不计 crash-loop 失败 |
| TSR_resume_injection_audited | 恢复注入 → 落本地取证行 `{termId,sessionId,cwd,ts,resumeAttempts}`（SEC-m1），可追溯「重启后自动跑了什么」 |
| TSR_join_key_stable_id | 恢复按稳定 termId join 锚点；旧 config 无 id → best-effort cwd+序，匹配不上退化 M3（【T-3】） |
| TSR_inject_cr_semantics | 注入尾部**恰一个 CR**（【P-1】已裁自动回车；案 A）：断言注入串尾带单 CR、串内无其他 CR/LF；案 B 无此断言 |
| TSR_inject_waits_first_resize | （登记⑩）静默门已可注入但 sizeReady 未翻 → 不写 payload；sizeReady 翻 true 后写入、恰一次（假时钟） |
| TSR_inject_size_timeout_fallback | （登记⑩）sizeReady 恒 false → 尺寸就绪超时（5s，假时钟）后仍照常注入（兜底 = 不劣于修复前，注入不弃） |
| TSR_human_abort_during_size_wait | （登记⑩）尺寸就绪前置等待期真人键 → abort、零写入、返回 false（与静默门人键语义一致） |
| **TSR_sigkill_restore_e2e** | （MuxvoLifecycleTests 新增场景6，feas M-10）**假 harness 合成 hook socket 帧产锚点 + 假 transcript 文件**（不烧真 CC token）→ SIGKILL helper → 二次启动 spawn 终端 + 下发 resume → 断言 resume 命令送达；真 CC 恢复留手工冒烟（S2 已端到端 PASS） |
| **TSR_sigkill_stale_anchor_skips** | （MuxvoLifecycleTests 新增场景7，feas M-10）假 harness 发 hook 帧落锚点但**不造 transcript 文件** → SIGKILL → 二次启动预检失败 → 不注入、横幅计数 |

### §5.1 r3 追加：Codex 自动恢复案例组（TSR_CX_，spec↔test 1:1）

| 用例名 | 断言 |
|---|---|
| TSR_CX_anchor_codex_roundtrip | .codex 锚点落盘/重读形状一致（transcriptPath=rollout 绝对路径） |
| TSR_CX_lenient_decode_drops_bad_entry | 宽容逐条解码：未知 harness/坏条目只丢该条，同文件 cc/codex 条目存活（§1.5 降级兜底） |
| TSR_CX_clear_if_matches_guards_cross_harness | 条件清除：harness/sessionId 双匹配才删；.cc 新锚点不被迟到的 codex 退出确认误删 |
| TSR_CX_cross_harness_latest_wins | 同 termId CC↔Codex 最近活跃覆盖同一键（保 crash-loop 计数） |
| TSR_CX_harness_codex_supported | harness 闸放行 .codex（.cc/.codex 皆过），全闸过 → inject |
| TSR_CX_containers_per_harness | per-harness 容器（真 I/O）：各查各容器；codex 文件逃逸 `~/.codex/sessions` → cannotRestore |
| TSR_CX_rollout_missing_skips | codex rollout 不在盘 → cannotRestore + 横幅计数（与 CC 同一恢复时门） |
| TSR_CX_crash_loop_isolates_codex | 熔断对 .codex 锚点同判据生效 |
| TSR_CX_bind_unique_candidate | 前台 codex + 恰一个 cwd 匹配候选 → 绑定产锚点（§1.5 双证据关联） |
| TSR_CX_bind_ambiguous_skips | 候选 ≥2（同 cwd 撞窗）→ 保守跳过不绑、留 pending |
| TSR_CX_bind_no_candidate_retries | 候选 0（rollout 晚落盘）→ 留 pending 下轮重试，窗起点不重置 |
| TSR_CX_two_terminals_same_cwd_skip | 两 pending 终端同 cwd 抢同批候选 → 双双不绑 |
| TSR_CX_clear_on_confirmed_exit | 连续 2 次「确认非 codex」→ 条件清锚点、状态回 idle（hysteresis） |
| TSR_CX_probe_unknown_no_clear | unknown 观测不计清除数、亦不清已有计数（探测抖动免疫） |
| TSR_CX_no_collect_nonhuman | worker/takeover/brain 终端不进观察集（ownership 过滤，防双恢复同 §1） |
| TSR_CX_rebind_after_restart | 退出确认清锚 → 同终端再起 codex → 重新 pendingBind 绑新会话 |
| TSR_CX_scan_only_when_pending | idle/bound 态 listCandidates 调用计数为 0；pending 态按退避节流（「严禁全量扫」的行为断言） |
| TSR_CX_lastActiveTs_touch_throttled | bound 态 touch lastActiveTs 60s 节流（不逐 tick 落盘） |
| TSR_CX_probe_directed_dates_and_mtime | 定向读只出窗口日期目录内 mtime≥窗起点候选（今天/昨天/UTC 今天以外目录零触碰） |
| TSR_CX_probe_first_line_only_failopen | 只读首行（硬上限 256KB，只读前 N 字节非整文件物化——session_meta 首行含完整 system prompt 实测 ~17KB）；非 session_meta/坏 JSON/超上限无换行 → 该文件跳过（fail-open） |
| TSR_CX_probe_caps_candidates | 候选数上限 32，超出截断（防 rollout 风暴） |
| TSR_CX_restore_injects_codex_resume | 真装配假 PTY：.codex 锚点重启注入 payload 逐字 = `cd -- '<esc>' && codex resume <sid>\r` |
| TSR_CX_restore_missing_rollout_banner | 真装配：.codex 锚点 rollout 缺失 → 不注入 + 横幅计数 |
| **TSR_CX_sigkill_restore_e2e** | （MuxvoLifecycleTests）直写 .codex 锚点 + 假 rollout（首行 session_meta）→ helper 真 SIGKILL → 二启决策 inject 且注入串逐字 `codex resume` 形 |
| **TSR_CX_sigkill_stale_anchor_skips** | （MuxvoLifecycleTests）.codex 锚点不造 rollout → SIGKILL → 二启 cannotRestore + 横幅计数 |

## 冻结面修订需求登记（本规格不直接改，登记待裁决/实现批兑现）

1. **wait-detector.md「native 从不解析 raw」注记**（§4 m-7 + `WaitTypes.swift:26`）**收窄为 detector 核自身纪律**。
   本规格 SessionTracker 是 detector 链外的独立 WaitEventBus 订阅者，按白名单+fail-open 解析 raw 的
   session_id/cwd/transcript_path 属**新增消费者**，不违背 detector 主链「不解析」纪律。请在该注记加脚注指向本规格。
2. **ConfigStore openTerminals 增持久化稳定 termId**（`ConfigStore.swift:39-45` 现 `{cwd, customName?}`）——支撑 §2/§3
   锚点 join，正好兑现 `ConfigStore.swift` 偏差②「稳定 UUID 是否入持久化留裁决」。属既有文件修订，待实现批 + 独立裁决。
3. **TakeoverTextInjector 泛化为 InitialCommandInjector**（`TakeoverTerminalManager.swift:65-104`）——其「绝不发 CR」
   不变量在本恢复场景**分道（P-1 已裁自动回车：允许尾部单 CR）**。登记为对既有实现的泛化需求（确定义务）。**S2 背书**：静默门
   500ms/8s 参数经 140 次注入实验证明必要且充分（含慢 rc），可冻结为默认；须显式前置 `seen_first`（注入前先见首输出）。
4. **`wait-detector.md` §5 可选加装 SessionStart hook（S1 增强，可选，待独立裁决复核）**：现装三 hook
   （Notification/Stop/UserPromptSubmit）中 UserPromptSubmit 最早（+199ms）已够可靠支撑无条件登记（§1）；S1 建议锚点
   一律从 SessionStart 抓取（最即时）。加装 SessionStart 求更早锚点是**加性可选增强**（不改现三 hook、不破 §5「三装一
   不装」的现有语义，仅新增一个采集触发），非 v1 必需。登记为对 `wait-detector.md` §5 的可选修订诉求。
   **✅ 已兑现（2026-07-16，fix/sessionstart-anchor，本登记即修订授权）**：触发根因 = 真机案例（测试7 wt-8 格，
   会话 77f79f11）——「resume 起来但从未再对话」的会话零 hook 事件 → 永无锚点 → SIGKILL 后不可恢复（S1 当年
   「UserPromptSubmit 已够可靠」的判断对『用户会打字的会话』成立，对『resume 后闲置』类不成立）。增量 =
   `WaitEventKind.sessionStart`（加性 case，detector/编排零消费）+ `HookScript.installedEvents` 四事件 +
   SessionTracker 采集分支扩入 + §1/§5 正文随改；老 3-hook 安装经 `wait-detector.md` §7 自检报 drift
   「缺 hook：SessionStart」提示重新启用（非静默重写）。案例 TSR_anchor_from_sessionstart / 
   WD_layer0_sessionstart_no_state 入池。
5. **`fake-cli.md`「发 hook 帧」方言（feas M-10，恢复 SIGKILL 测试用）**：`TSR_sigkill_*` 集成场景（§5，MuxvoLifecycleTests）
   不烧真 CC token——需假 harness 能**向 hook socket 合成 hook 帧**（Notification/Stop 携 `{session_id, cwd, transcript_path}`）
   产出锚点 + 造/不造**假 transcript 文件**触发预检过/不过。此「发 hook 帧」方言与 `interactive-worker.md` 登记 9 的
   `--interactive` 方言同源（`tools/hook-replay` 帧），登记为 `fake-cli.md` 加性诉求；真 CC 恢复端到端已由 S2 手工冒烟 PASS。
6. **§4「顶部横幅」的 web 顶部条 wire 增量（B1 停手项，2026-07-07 裁决 R1 登记）**：两类横幅（「N 个会话无法在本机恢复」/「N 个会话反复崩溃已暂停自动恢复」）的 **web 顶部条视觉形态**需新增 ui.state/桥字段——协议 v13 消息数锁死，wire 增量**归批末合并窗口/后续批裁**。B1 v1 交付形 = 系统通知（尽力而为）+ durable 本地日志 `session-restore-banner.log`（0600，授权被拒也无条件落盘）——§4「不静默」承诺的 substance 已守住，缺的是顶部条 form（对抗验收 M-4 + 裁决 `logs/m4b-b1-adjudication.md` 偏差1/R1）。
7. **注入命令形修正 `claude --resume -- <id>` → `claude --resume <id>`（M5-R1 缺陷7，2026-07-08）**：本规格 §3/§4/§5（`resumeCommandBody`/TSR_restore_injects_resume/TSR_cwd_shell_escaped 等冻结正文行 :91/:95/:97/:113/:139/:140）现写「`--resume --` 断选项」。**该形是真机回归**——`claude` CLI 的 `--resume [value]` 是 commander **可选值参数**，`--` 是选项终止符：`--resume` 后紧跟 `--` 取不到值 → CC 打开交互「选择会话」列表、sessionId 掉成位置参数 prompt（真机 + 老版实测一致）。**修正 = 去掉 `--resume` 后的 `--`**；`cd --` 的 `--` **保留**（cwd 可能前导 `-`，断选项无害）。**补偿控制不回退**：sessionId 严格 UUID 白名单（SEC-M3，`isValidSessionId` + InitialCommandInjector 二次校验）前置，UUID 永不以 `-` 开头，前导 `-` 的 sid 到不了命令构建 → 去掉 `--resume` 的断 `--` 不扩注入面。冻结正文行本次**不直改**（本登记即修订授权，实现批 `ResumeCommand` 已兑现，冻结正文由后续合并窗口批量校订）。
8. **Codex 续聊注入 harness 扩展（M5-R1 缺陷7 同批，§7.7 用户主动「继续聊天」路径）**：`ResumeCommand` 增 `Harness{.claude,.codex}`——Codex 形 = `cd -- '<esc>' && codex resume <sid>`（sid 位置参数、无 `--`，与 `CodexAdapter.makeTakeoverArgv` 交互续接同形）。**限用户主动 chatResume 路径**（`handleChatResume` 按 `source` 传 harness）；§1 auto-restore 的 `TerminalHarness` **仍恒 .cc 不变**（P-2 里程碑收窄独立于此，两枚举分立）。Codex session id 亦为 UUID，同过 isValidSessionId 严格白名单 + 控制字节闸（M-1），防护面与 CC 对称。编排 worker 侧 Codex resume 仍由 CodexAdapter 自管（§0 出界），两路不耦合。
9. **注入 cd 写权威 cwd → 终端 header 路径同步（F-B，dogfood-r1 2026-07-09）**：恢复注入（`enqueueRestoreInjection`，本规格 §3）与 §7.7 继续聊天注入（`enqueueChatResumeInjection`）在静默门过、payload 写成功后，调 `TerminalSession.noteInjectedCwd` 把注入 `cd` 的落点写成权威 cwd。**根因**：header = `terminal.cwd` = 投影 `cwds[id]`，被 `terminal-session.md` §5 的 ~1s `refreshCwds` 用 OSC7 值（`_cwd`，此前**仅 OSC7 回调写**）覆盖——注入 `cd` 与命令同行内执行**不产生新 OSC7**、其后 harness TUI 无 OSC7，故注入前恢复 login shell 里 `.zshrc` 的 `cd`（OSC7 漂移）会把 header 钉死到漂移目录（spawn 时 chdir 本正确，§3 注入路径已述「login shell `.zshrc` 会漂 cwd」故必须显式 re-cd）。**投影层修不动**：refreshCwds 每轮从 `session.cwd` 重灌，只写投影 1s 内即被 clobber——唯一正确缝 = `TerminalSession._cwd` 层加**第二写源**（与 OSC7 回调同写同锁、最后写者胜；注入晚于注入前漂移故权威）。**归一对齐**：注入落点经 `expandingTildeInPath`+去尾斜杠归一 = createTerminal 存投影 `cwds[id]` 口径，令 refreshCwds 回读恰等 `cwds[id]` 不二次 clobber。abort/超时不写 → OSC7 自愈路径保留。本规格 §3 注入路径正文**不直改**，此登记即修订授权（对齐 `terminal-session.md` §5「注入 cd 权威源登记」+ `chat-history.md` §7.7 增补）。
   **⑨修订（dogfood-r3 问题2，2026-07-10）：「最后写者胜」升级为 pin 窗口**。原语义押在「注入晚于注入前漂移，故权威」——该时序假设在真机被打破：注入 write() 只是排队字节即返回、`noteInjectedCwd` 同步紧随，而 `.zshrc` 漂移 cd 的在飞 OSC7 / 异步 prompt 插件（p10k gitstatus 类，静默门过后 1-2s 重绘再发）可在其**后**到达，把 `_cwd` 覆写回漂移目录且无人纠正（harness TUI 期间无后续 OSC7）→「聊天能继续、header 停在漂移路径」。修订语义：`noteInjectedCwd` 写权威 cwd **并置 pin**（默认窗口 5s，`Config.cwdPinWindowMs`）；窗口内 `handlePwdChanged` 对**不匹配**注入落点的 OSC7 忽略（不写 `_cwd`、不发 cwd 回调），**匹配**（shell 真正执行到注入 cd 后 precmd 吐出落点 OSC7）即接受并解 pin，超时自动解除恢复正常接受。匹配为纯字符串归一（file:// 解码 + 去尾斜杠 + `/private` 别名等价，**不做 symlink 解析**——失配最坏 pin 撑满窗口自动解除，header 仍正确）。三注入调用方（§3 恢复 / §7.7 chatResume / worktree-popover create·chatJump 钉住）同缝全覆盖。abort/超时不注入不 pin 语义不变。测试：`CwdPinTests`（决策纯函数+会话接线）+ `CwdPinInjectionTests`/`ChatResumeGateTests` 各一「漂移晚到」红→绿锚。
10. **注入尺寸就绪门（dogfood 窄烧写彻查，2026-07-11）**：§3 恢复注入与 §7.7 继续聊天注入在静默门**之外**
   增加前置等待——会话收到**首个 bounds 驱动 resize**（`TerminalSession.hasReceivedResize`：resize() 过
   <10×2 防御即置位，含同尺寸幂等命中——tile 恰为 spawn 默认 80×24 时首次 sync 仍进函数即算就绪；spawn
   默认值本身不算）后才写 payload；超时 5s 兜底照常注入（`InitialCommandInjector.sizeReadyTimeoutMs`，
   终端洞不可见场景——用户停在别的面板无 layoutReport 永不就绪，兜底 = 不劣于修复前）。**根因**：PTY
   一律 80×24 spawn 不等布局，resume 回放 transcript 早于第一次正确 resize 时整段按 80 列**硬换行**烧进
   scrollback——变宽 reflow 只救软换行救不回硬换行（`terminal-rendering.md` 硬换行语义），宽 tile 下呈现
   「上半右侧大片空、下半全宽」。前置等待期人键介入同 abort（与静默门语义一致）；等待不占静默门 8s 预算
   （最坏串联 13s，双重极端才达到）。注入落地落 `.notice` 取证（`resume 注入落地 [id] cols=…x… sizeReady=…`）
   ——日后再报窄烧写 log show 一眼判层（sizeReady=false=超时兜底 80×24；cols 正常仍窄=O1a 窄 tile /F7 层，
   勿误归因）。`CwdPinInjector`/`TakeoverTextInjector` **不适用**（cd+clear 无烧写面 / 面向已布局活体 CC）。
   O1a 固有代价（tile 真实窄时段流入的输出按真实容量硬换行）**不在本登记范围**——已裁决不修。测试：
   `TSR_inject_waits_first_resize` / `TSR_inject_size_timeout_fallback` / `TSR_human_abort_during_size_wait`
   + `hasReceivedResize` 单测（MuxvoTermTests）+ e2e 装配级场景（`lastResumeInjectionForTest` 测试缝）
   + 装配红绿锚「尺寸就绪门装配红绿锚」（ChatPanelRoutingTests，对抗回修 MINOR-2：扣住 resize 断言不注入
   → 投递 resize 才落地；红证=撤调用点接线后 0.76s 即注入被抓，logs/resume-size-gate-red-anchor.log）。
   残余（对抗 MINOR-1 登记非必修）：尺寸等待在 injectionThrottle 内持 slot ≤5s——多不可见终端崩溃恢复
   时有界排队（ceil(K/2)×5s）非饿死；后续批可将等待移出 throttle。
11. **指挥台重启降级提示（M4b 台账「重启后 console 无工具残余」清账，B4' 对抗验收 MINOR-6，fix/console-restore-notice 2026-07-11）**：
   §0 出界表「指挥台终端」行的理想态 = brain ownership 排除（§1）令指挥台**不进** SessionTracker/本恢复路径（归 `command-console.md` 自恢复）；**但 brain 排除位现仍留接缝未接线**（§1「brain B4 接线」，`TakeoverOwnershipBox` 生产盒 brain 恒回退 .human）→ 指挥台终端**事实上被本路径当普通会话扫入**：其 PTY 根 claude 发 hook 事件（cwd=console-home）→ 落锚点 → 重启注入 `claude --resume`（**无 `--mcp-config`**）→ 指挥四工具在恢复出的 claude 侧不存在（三路 fail-closed，**行为正确**）。**本批只识别 + 告知、不改恢复行为**（fail-closed 现状正确、brain 排除接线仍归后续）：识别落 `TerminalService.createStartupTerminals`（组合根持 dataRoot）→ `noteRestoredConsoles`——以 **console-home cwd 锚**（`ConsoleHomeManager.consoleHomeURL(dataRoot)`，`command-console.md` §1 spawn cwd）匹配恢复终端**持久化 source cwd**（覆盖「有锚点 resume」与「无锚点纯 shell」两降级态、**独立于会话锚点分支**），两侧同经 `normalizeInjectedCwd` 归一（皆派生自同一 dataRoot、无 symlink 别名）；命中数 > 0 → `SessionRestoreBanner.consoleDegraded(count:)`（复用 §4 横幅先例：durable emit 无条件留痕 + 系统通知尽力而为·真 .app 守卫；纯串文案 `consoleDegradedBody`「N 个指挥台已恢复为普通终端（指挥工具不可用），请从「文件 → 新建指挥台」（⌘⇧N）重开」）。**残余**：① web 顶部横幅 form（`RestoreBanner` wire 增字段）归批末合并窗口（同 cannotRestore/crashLoop 的 form 半先例，登记 6）；② heuristic 有界残余——用户把普通终端 cwd 停在 console-home 会误计（诚实定界，同 §4 多设备/短会话口径）；③ 待 brain ownership 排除接线（§1，归后续）后，指挥台不再进本恢复路径，本提示自然归零（届时可裁是否移除或改由 `command-console.md` 自恢复面告知）。测试：`bannerBodies`/`bannerNotSilentWhenNotificationUnavailable`（文案 + 不静默，`SessionRestoreSupportTests`）+ 装配缝 `restoreIdentifiesDegradedConsole`（真 `createStartupTerminals` → `lastRestoreConsoleCount`，普通终端不计、restoreSessions 早退仍计，`SessionRestoreIntegrationTests`）。

12. **Codex 自动恢复交付（r3，P-2 fast-follow 激活批 2026-07-13，用户拍板）**：全部增量 = §1.5（CodexAnchorTracker
   采集 + 设计裁决：1s tick 快照共享 / 不挂 ChatSourceWatcher / 唯一候选保守绑定 / hysteresis 条件清除 /
   定向读三闸）+ `TerminalHarness` 扩 `.codex` + 读盘宽容逐条解码 + planner per-harness 容器
   （`~/.codex/sessions`）+ `ResumeCommand.Harness(TerminalHarness)` 单向映射（两枚举仍分立，登记 8 语义不变
   ——其「§1 TerminalHarness 仍恒 .cc」一句随本登记废止）+ 审计行加 harness 字段 + §5.1 TSR_CX_ 案例组
   （旧 TSR_harness_cc_only 退役）。冻结正文各处「harness==.cc」字样以本登记为修订授权，语义以 §1.5 为准。
   待真机回写项：codex resume 续接后 rollout 文件行为（续写原文件 vs 新建；设计已双兼容——候选匹配用 mtime
   不用 birthtime，仅影响措辞）。**真机已验（2026-07-14）**：codex-cli 0.144.1 `codex resume` **续写原 rollout**
   （文件名/session id/cwd 不变、mtime 刷新）；进程识别关键修正——用户 codex 为 npm node 包装，shell 前台直接
   子进程 comm=node、原生 codex 是孙进程 → 判据为「argv token basename==codex」非 comm==codex；session id
   小写 UUIDv7 过严格正则；cwd 记 realpath（/private/tmp，归一 /private 别名已含）。
   **对抗验收 ACCEPT（0 MAJOR/6 MINOR，2026-07-14）**：MINOR-3 首行读加 256KB 硬上限（已修）+ MINOR-6 ps 解析
   抽纯函数补单测（已修）；欠账登记（后续批，均 §1.5 已诚实定界或无害）——MINOR-1 listCandidates 在 main
   pendingBind 态定向 fs（idle/bound 零 fs，正常文件量 sub-ms，可移出 main）、MINOR-2 同 cwd 双终端错峰交叉绑
   （同项目内、tile 位可能互换、危害低）、MINOR-4 worker rollout 同 cwd 撞窗（ownership 只挡 worker 终端不挡其
   rollout 进候选）、MINOR-5 states 表依赖 onTerminalRemoved 剪除（已可靠接线，无泄漏）。

## 开放问题清单

### 产品问题（★已全部裁决，2026-07-07 用户裁；裁决结果已回写各节，此处保留两案对照作裁决记录）

- **【P-1】注入 `claude --resume` 后自动回车 vs 只打字 → 已裁：自动回车（照推荐）**（仅注入案 A 相关）
  - 推荐：**自动回车**——本场景目标是空 shell 提示符（非活体 CC TUI）、注入串是 app 生成固定形、最坏无害报错，
    自动回车才兑现「一模一样接续」；但与 TakeoverTextInjector「绝不发 CR」不变量分道，需泛化。
  - **S2 数据摘要（`logs/m4b-spike-s2.md`）**：正测试即以**带 CR** 走完整链（`cd <dir> && claude --resume <sid> "<问口令>"` + CR）
    → CC 起来、还原上文、答出埋入口令、干净退出，SessionStart/UserPromptSubmit/Stop 全绿；140 次注入实验带门 100/100（含慢 rc）。
    数据表明**自动回车路径实测可行且安全**（注入串是 app 生成固定形、目标是空 shell），支撑推荐案。
  - 案「自动回车」：恢复即续跑，零人工。案「只打字」：每终端每次重启后需人工按一次回车（安全但削弱「一模一样」）。
- **【P-2】Codex 标准可见终端会话是否恢复 → 已裁：v1 CC-only → r3 追裁（用户 2026-07-13）：激活 fast-follow，本批交付 Codex 自动恢复（§1.5 + 登记 12）**
  - 推荐：**v1 CC-only**——**S6 定案（`logs/m4b-spike-s6.md`）理由 = 收敛面而非能力缺口**：先用单 harness 把锚点抽象/
    预检门/注入门冻结验收，再接第二 adapter。（原「Codex 无 hook → 无锚点来源」的推断**被 S6 推翻**：Codex 锚点原语完全
    对称且**更优**——rollout JSONL 首行即 `session_meta`〔含 `id`/`cwd`，eager 落盘，**无 CC 短会话零落盘那道坎**〕；
    `codex resume <uuid> "<prompt>"` 与 `claude --resume <sid> "<prompt>"` 逐位对齐；`notify=turn-ended` ≈ Stop hook。）
  - **fast-follow 一句话路径**：复用 ④ 锚点抽象换命令串——Codex 锚点 = 最新 `~/.codex/sessions/**/rollout-*.jsonl` 首行
    `session_meta.payload.id`（+`cwd`）；接管注入 `codex resume <uuid>`；恢复前预检 = rollout 文件在盘（与 CC 同一恢复时门）。
    （编排 worker 侧 Codex resume 由 CodexAdapter 自管，属 §0 出界，不受此裁影响。）
  - 案「CC-only」：Codex 终端只恢复 cwd。案「也恢复 Codex」：接第二 adapter（S6 证原语齐备、低风险 fast-follow），M4b 增量小但扩验收面。
  - **⚠️ 里程碑收窄点破（complete MAJ-1，须用户知悉）**：`REBUILD-PLAN.md:103` 原文承诺涵盖 Codex 标准终端会话恢复；v1 选 **CC-only** 是对该里程碑承诺的**收窄**（非能力缺口——S6 已证 Codex 原语齐备且更优，纯为「先单 harness 冻结抽象」的收敛策略）。用户裁 P-2 时须明确知悉：**选 CC-only = 接受里程碑范围收窄 + Codex 留 fast-follow**（冻结时由主会话在 `REBUILD-PLAN.md:103` checklist 补 Codex fast-follow 注记，该注记动作不属本规格回写范围）。这是「诚实告知里程碑与原承诺的差」，非替用户预决。
- **【P-3】仅崩溃恢复 vs 崩溃+正常重启皆恢复 → 已裁：皆恢复（照推荐）**
  - 推荐：**皆恢复**——用户需求原文即「崩溃/重启」；正常重启用户也期望接续。
  - 案「皆恢复」：任意重启都 resume 上次活跃会话。案「仅崩溃」：正常退出清锚点、只崩溃才 resume（更保守，正常退出被视作「用户主动收工」）。

### 技术问题（☆按推荐写死，待独立裁决复核）

- **【T-1】staleness 不设时限**：只要 transcript 文件在本机存在就 resume（§4）。
- **【T-2】多设备/陈旧锚点预检失败 → 跳过 + 横幅**（§3 预检 + §4）。
- **【T-3】join 键 = 稳定 termId**（openTerminals 加 id，冻结面修订②），旧 config best-effort 退化（§2/§3）。
- **【T-4】InitialCommandInjector 泛化路径**（复用静默门；CR 语义已随 P-1 定=尾部单 CR，冻结面修订③转确定义务）。

### spike 依赖（已消解 2026-07-06）

- **S1（`logs/m4b-spike-s1.md`）**：→ 锚点无条件登记（§1）、transcript/session_id 从 hook 直取不 glob（§1）、resume 前才校验文件在盘（§3 预检）、短会话零落盘诚实边界（§4）。
- **S2（`logs/m4b-spike-s2.md`）**：→ **案 A 注入为推荐案**（静默门 140 次 100/100 含慢 rc、真 CC resume e2e 正测试 PASS、负测试诚实报错）；案 B 降备选保留行为形状（§3）；InitialCommandInjector 静默门 500ms/8s 实测背书（登记 3）；恢复 cwd 须已信任项目（§4）；P-1 附 S2 数据呈裁，**已裁自动回车（2026-07-07）**。
- **S6（`logs/m4b-spike-s6.md`）**：→ P-2 v1 CC-only 定案理由 = 收敛面而非能力缺口 + Codex fast-follow 一句话路径（开放问题 P-2 / §0 出界表）。
- **无剩余 spike 分叉。**
