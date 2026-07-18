# 行为规格：WaitDetector（终端交互等待检测，M3 = Layer 0 + 进程/静默兜底）

> **全新功能**（老 app 无结构化等待检测，只有正则刮屏 + BEL/OSC，属病根类）。权威：`ADR-001-gpui-rescinded.md` §4
> （Layer 0 修订）+ `architecture.md` §2.9（四层分级 + regex 四纪律，亲验 201-235 行）+ 设计底稿
> `m3-design-annex-B-ui-wait.md` §4 + `task-state-machine.md` §3（wait_entered 接缝）。legacy 行为锚点亲验：
> `../muxvo-legacy/src/main/services/terminal/{input-detector.ts,manager.ts,foreground-detector.ts}`。
> **读行为不抄结构；控制面走结构化通道（hook/进程状态），绝不刮屏模拟按键**（核心原则二）。
> 状态：**v1-frozen**（2026-07-02 检查点⑨通过：全新功能规格经用户过目无异议，hook 授权文案过目通过）。裁决点 ★=用户 ☆=独立 agent。
> target：`MuxvoTerm`（detector 核心 + socket + WaitEventBus）+ `MuxvoTermRender`（无——UI 输出端 web 已复刻）+ 安装 UX。

## §0 两套 taxonomy 切分（写死在规格里）

同一物理信号可能同时服务两个不同的「等待」概念，**必须以主键切分**，否则 M3/M4a 互相污染：

| taxonomy | 主键 | 语义 | 归属规格 | 里程碑 |
|---|---|---|---|---|
| **(a) 终端交互等待** | `terminalId` | 「这个终端在等用户回答」（红点/badge/呼吸边框 + WaitingCard） | **本规格** | M3 |
| (b) 任务编排等待 | `taskId` | `waitClass{quota/429/silence}`（限额/速率窗口） | `task-state-machine.md` §3 `wait_entered` | M4a |

- **界线判据**：以 `terminalId` 为主键归 (a)；以 `taskId` 为主键归 (b)。
- **共享接缝 = `WaitEventBus`（多订阅）**：M3 唯一订阅者是本 detector；M4a 编排引擎作**第二订阅者**消费同一事件流喂 `wait_entered`（task-state-machine.md:41「WaitDetector Layer 0（M3）」产生者）。〔**M4b draft 更正（found MIN-3，见文末修订记录 2026-07-06 ①）**：M4a headless worker 非 SessionRegistry 终端、**零 WaitEvent 流经**（此「第二订阅者」M4a 实为**空转预接缝**）；真正**实消费**是 M4b 交互式 worker（真 PTY 终端，`interactive-worker.md` ①§3）。此内联「M4a 消费」措辞过时，以修订记录①为准。〕
- **事件形状此刻冻结**（M4a 不得改）：

```
WaitEvent { termId: String; event: WaitEventKind; ts: UInt64; raw: JSON? }
WaitEventKind = .notification | .stop | .userPromptSubmit | .processExit | .silence | .userInput | .acknowledge
```

- **`ts` 权威 = native 产生/收包时刻 epoch ms**（唯一时钟）。**hook JSON 不携带 ts**——native 在 socket 收包瞬间打 epoch ms 戳（BSD/macOS `date` 无 `%N`，`date +%s%3N` 产不出毫秒、`date +%s` 是秒，§4）；进程/静默事件用 native 同一单调 ms 时钟。**全流程单一时钟**保 `ingest` 的间隔/排序/30s 边界运算正确（防秒/毫秒混算 ~1000× 误差）。

## §1 M3 范围与四层留位

- **M3 做**：Layer 0（harness hook）+ 进程兜底 + 静默兜底。
- **M3 不做（仅接口留位）**：OSC 133 语义 prompt 标记、CLI 内置硬编码模式、shell integration 脚本注入、regex fallback（architecture.md §2.9 原四层）。这些是「无结构化通道的普通 CLI」兜底（ADR-001 §4「原四层降级为非 CC 类 CLI 兜底」），M3 只保留分层接口。
- **regex 四纪律（architecture.md:226-233 原文附录，M3 不实现 regex，但接口留位者未来实现时强制）**：
  1. 必须跑在 worker 线程，严禁在 PTY reader hot path 同步调用（legacy `input-detector.ts` 恰在 onData 同步跑，manager.ts:300——**病根之一**）；
  2. 用 UTF-8 字符边界 slicing，严禁 byte 边界 slice（过去 panic 真实根因）；
  3. 50ms 最小 interval polling；
  4. RegexSet 启动编译一次；每条 regex 配 ≥15 条回归测试，加 regex 前先加测试；模块级注释写明「改动需过 regex + UTF-8 边界 + thread 三条」。
- **legacy 等待信号（不继承实现，仅记录行为）**：`detectBellSignal`（BEL `\x07`，排除 OSC 终止符，input-detector.ts:120-124）、`detectOscNotification`（OSC 9 / OSC 777，input-detector.ts:130-136）、`detectWaitingInput`（正则组合，input-detector.ts:58-104）——M3 由 **Layer 0 hook 取代**（Notification/Stop 事件 = BEL/OSC 的结构化等价，更可靠）。

## §2 状态模型与 10 态机映射

- WaitState（architecture.md:214 trait 照搬为 Swift protocol）：`enum WaitState { Running, Idle, WaitingInput }`。detector 纯函数 `ingest(event, ts) -> WaitState`（edge-triggered, idempotent）+ `reset_on_user_input()`。
- **detector → 10 态机事件映射**（terminal-session.md §2 的状态机）：

| detector 结论 | 发往状态机事件 | 效果 |
|---|---|---|
| WaitingInput | `WAIT_INPUT` | Running→WaitingInput |
| reset / user input | `USER_INPUT` | WaitingInput→Running |
| acknowledge | `AUTO_RESUME` | WaitingInput→Running（legacy acknowledgeWaiting，manager.ts:547） |

- **Busy**：M3 **不产出**（无可靠信号源，UI 也归灰）；枚举保留（terminal-session.md §2.1）。
- **Idle → 快照映射为 Running**：10 枚举无 Idle；UI 三分类「绿=存活」是 M2 golden 冻结语义（term-grid.md §3.1）。Idle 区分度留给 M4a 编排消费，**不进 ui.state**。
- **推送时序**：终态立即推 / 非终态 50ms 去抖（terminal-session.md §6.3）。

## §3 层间合成 / reset / acknowledge

- **优先级**：`Layer 0 > 进程 > 静默`；**edge-triggered**；任一层报 WaitingInput 即红。
- **有 hook 事件流入的终端抑制静默兜底**（防 CC 长思考误报）：该终端一旦收到过 Layer 0 事件，静默层对它完全豁免（§6）。
- **reset_on_user_input**：挂 **PTY 写入路径**（terminal-session.md §2.2 USER_INPUT 产生点）——任意用户字节全清各层。排除终端自应答（`isTerminalAutoResponse`，manager.ts:27-35：光标位置报告 `\x1b[r;cR`、焦点事件 `\x1b[I/O`、设备属性 `\x1b[?...c` **不触发** USER_INPUT）。
- **acknowledge**：`tileClick`（native 隐含）/ `acknowledgeWaiting`（显式动作，桥草案 §ui.action）→ `USER_INPUT` 等价清红（legacy acknowledgeWaiting → AUTO_RESUME，manager.ts:542-550）。
- **acknowledge 后静默抑制**（☆ 2026-07-04 修订，DOGFOOD_M3_08，用户裁决）：`acknowledge` / `userInput` / `reset` 在清各层的同时，对**静默弱信号**记录抑制水位（= 该事件 ts，单调抬升）。抑制期内 §6 三与门控**不重新触发**；**唯一解除条件 = 新 PTY 输出（输出 ts 严格 > 水位）**，视为开启新 episode——新 episode 内重新安静 ≥30s 方可再次提醒。`processExit` 不显式解除（真实流程中提示符回显输出天然解除）。强信号（Layer 0）不受抑制影响：ack 清红后新 hook 事件立即重亮（事件驱动）；hasSeenLayer0 终端静默永久豁免，抑制位无观测效果。
- **sidebarSelect 隐含 acknowledge**（☆ 2026-07-04 修订，DOGFOOD_M3_08，用户裁决）：切到 sidebar 预览查看 = 已看过，与 `tileClick` 同语义（native onSurfaceClick 与 web 点击两路同经 handleAction 单点收敛）。
- **waitingNotification.count** = 当前 WaitingInput 终端数（native 聚合）；静默兜底产的 WaitingInput **不计入 count**（§6）。

## §4 Layer 0 传输：unix socket

- 路径 `~/Library/Application Support/Muxvo2 Dev/run/hook.sock`（~62 字节 < `sockaddr_un` 104 上限；数据目录隔离纪律内，绝不碰老版目录）。
- **选 socket 不选 spool+FSEvents**：socket 亚毫秒 / 连接即焚无残留 / app 不在时 connect 秒退（等待是活体状态无需重放）/ 一连接一事件天然成帧。spool 有合并延迟、要 GC、重启重放陈旧状态有害。
- **socket 生命周期**：启动 `unlink` 残留 + `bind` + `listen`（后台队列 accept，逐连接读一条 JSON，**64KB 上限**，非法丢弃计数日志）；退出 unlink；崩溃残留下次启动 unlink 覆盖。**重启不重放**：进程兜底扫一遍 + 后续事件流自愈。
- **hook 脚本**（装 `.../Muxvo2 Dev/hooks/muxvo-hook.sh`，内容随 app 版本化，快速静默退出是硬约束）：

```bash
#!/bin/bash
# Muxvo WaitDetector Layer 0 relay — 快速静默退出是硬约束
[ -n "$MUXVO_TERM_ID" ] || exit 0
SOCK="${MUXVO_HOOK_SOCK:-$HOME/Library/Application Support/Muxvo2 Dev/run/hook.sock}"
[ -S "$SOCK" ] || exit 0
payload=$(cat)
printf '{"v":1,"termId":"%s","event":"%s","raw":%s}' \
  "$MUXVO_TERM_ID" "$1" "$payload" | nc -U -w 1 "$SOCK" &
exit 0
```

- **无 ts 字段**（B2）：hook JSON 不带时间戳——**native 在 socket 收包瞬间打 epoch ms 戳**作 WaitEvent.ts 权威（§0）。理由：macOS/BSD `date` 无 `%N`（`date +%s%3N` 产字面 `…3N`、`date +%s` 是秒），hook 本就产不出可信 ms，与其塞秒进 ms 字段致混算，不如让 native 单一时钟落戳。
- **安全约束（写进 spec）**：脚本**不 eval 输入**、stdin 不透传 shell、raw 按**不可信数据**解析（大小/字段白名单）；socket **0600**；native 每 termId **限速 20/s**。
- **注入面（m-7）**：`raw:%s` 用 `$payload`（CC stdin JSON）**裸插不加引号**——非法/空 → 框架 JSON 破损 → native 按「非法 JSON 丢弃计数」兜住；`event`=$1 是 muxvo 自装固定串；`termId`=`$MUXVO_TERM_ID` **构造为 native 生成 UUID（无引号字符，无需转义）**。**native 从不信任框架**：按 白名单字段+大小上限+活体 termId 表校验重解析，查无 termId 即丢弃 ⇒ 注入爆炸半径限于「自己那条事件被丢」，无法冒充未知 termId。
- **MUXVO_TERM_ID 注入**：spawn PTY 注入（terminal-session.md §1.2；shell→CC→hook 子进程 env 传导链已确认）；native 按 termId 查活体终端表，**查无即丢弃**；ssh/容器内 CC env 不传导 → 自动退化到兜底层。
- **MUXVO_HOOK_SOCK 注入（多分身路由修复，2026-07-11）**：`~/.claude/settings.json` 全局共享一份 hook 组，脚本内默认 SOCK 是**安装方分身**烘焙路径——多分身并开时其他分身的 hook 事件投错 socket（锚点绑定/Layer 0 全断，真机取证：安装方 titles 有值、其余分身全空）。故 spawn PTY **恒注入** `MUXVO_HOOK_SOCK=<本 app dataRoot>/run/hook.sock`（terminal-session.md §1.2；TerminalService 生产 configTemplate 经 extraEnv 注入，路径与 native 监听同一 `HookScript.socketURL` 派生源），脚本 `${MUXVO_HOOK_SOCK:-…}` 消费、烘焙默认仅作兜底。settings 指向哪个分身的脚本副本不再影响路由（各分身脚本内容同版）。
- **「native 从不解析 raw」纪律收窄（M4b，2026-07-06，draft——冻结随 M4b 规格簇终审）**：本节及 §2 的「detector 核不解读 `WaitEvent.raw` 内容」是 **detector 核自身纪律**（edge-triggered 只看 `event` kind、不依赖 raw 内容，防注入/防误报），**不禁止 detector 链外的独立 WaitEventBus 订阅者按白名单解析 raw**。M4b `SessionTracker`（`terminal-session-restore.md` ④§1，WaitEventBus 第三订阅者）按**白名单**抽 `raw` 的 `session_id`/`cwd`/`transcript_path` 作 resume 锚点——**fail-open 硬约束**（`raw==nil`/非法 JSON/缺字段 → 不产锚点、不抛错、**零影响 detector 主链快照**），按不可信数据解析（大小上限+字段白名单，绝不 eval/透传 shell），独立 `deliverOn` 队列不回传 bus。属**新增容错消费者**，与 detector 核纪律不冲突。

## §5 hook 选型（四装一不装）

| hook | 映射 | 装否 | 理由 |
|---|---|---|---|
| `Notification` | → WaitingInput | **装**（最高价值） | CC 主动通知需要注意 |
| `Stop` | → WaitingInput | **装** | 回复完成 =「该你了」，与旧 BEL/OSC 行为对齐 |
| `UserPromptSubmit` | → Running | **装** | 兜粘贴提交等路径（清红回运行） |
| `SessionStart` | ——（detector 零消费） | **装**（2026-07-16，登记兑现） | **锚点采集专用**（`terminal-session-restore.md` §1/登记 4）：resume/启动即锚定——堵「resume 起来但从未再对话的会话零 hook 事件 → 永无锚点 → 意外关闭不可恢复」缺口（真机案例 2026-07-16 wt-8）。detector 主链零语义影响：不标 hook 流（否则 resume 后闲置会话失去静默兜底弱提示）、不改等待态；编排消费者不产生任务态副作用（不解 silence 弱等待、不计 silence 进展；switch 前的 session_id 公共回填路径保持既有行为）。 |
| `PreToolUse` | —— | **不装** | 活动心跳由 PTY 输出字节**免费**获得，省每次工具调用 ~10-20ms 同步税 |

- TUI 弹窗（hook 管不到）**不在 detector 责任内**——升级人类场景（核心原则二），M3 静默兜底给弱提示。
- **「PreToolUse 不装」仅指等待检测心跳（found MIN-8，M4b draft 交叉标注）**：本表「不装 PreToolUse」是**detector 等待检测**语境——活动心跳不需要它。**M4b 交互式 worker 为「审批」另装 PreToolUse hook**（`interactive-worker.md` ①§2，隔离 config 内、双向审批脚本、经独立审批 socket 送策略引擎，用途与遥测/心跳**完全不同**）——两处「装/不装 PreToolUse」是**不同用途、不冲突**（遥测 hook 组不变量不动〔2026-07-16 起为四事件，SessionStart 仅锚点采集零遥测语义〕，审批 hook 是新增同步通道，事件不重叠）。此表的「不装」不否定 ①的审批 PreToolUse。

## §6 进程 / 静默兜底语义

- **进程兜底（确定性）**：
  1. 子进程退出 → EXIT_NORMAL/ABNORMAL → Stopped/Disconnected **立即推**（豁免名单沿用 legacy；退出码映射 terminal-session.md §3.3）。
  2. 前台进程轮询（1s，与 cwd 轮询同循环，legacy `CWD_POLL_INTERVAL_MS=1000`/`CWD_GRACE_MS=1000`，manager.ts:23-24,473-497）：产出 cwd-changed→ui.state；「前台是否 harness 类进程」（`getForegroundProcessName`/`getForegroundChildPid`，foreground-detector.ts:7-36）喂静默门控；前台消失回 shell 且 WaitingInput 无 hook 解释 → 清红。
- **静默兜底（低置信弱信号）**：三**与**门控 = 前台存在非 shell 进程 **且** PTY 静默 **≥30s** **且** 该终端**无 Layer 0 事件流**（hook 正常的 CC 终端完全豁免，§3）。
  - 输出 WaitingInput（红点/呼吸边框），**不计入 `waitingNotification.count`**。
  - 清除：任意 PTY 输出 / 用户输入 / 前台进程退出。
  - **re-arm 语义**（☆ 2026-07-04 修订，DOGFOOD_M3_08）：acknowledge/userInput 后弱信号被抑制，直到新 PTY 输出解除（见 §3 修订）——防「确认后无新活动重复提醒」。
  - 阈值 **30s 集中常量**（`SilencePolicy.SILENCE_THRESHOLD_MS = 30000`）；spec 标注「**粗糙引导层**」（CC 长思考可能误报，故不计 count、只弱提示）。

## §7 安装 UX（用户已裁决：方案 1+2 组合，授权后自动装）

- **CC settings.json hooks 实际 schema（2026-07-02 亲验 `~/.claude/settings.json`）**：`hooks.<Event>` 是**嵌套 matcher-group 数组**——元素为 `{ "matcher"?: string, "hooks": [ {"type":"command","command":"…","timeout":N} ] }`；`Stop` 组**无 matcher**（`{ "hooks": [...] }`）。**裸叶子命令对象 append 进数组 CC 不识别**（本机 PreToolUse/PostToolUse 带 matcher、Stop 不带，均为 group 形）。
- **muxvo 插入的确切形状**（每事件一个 group，append 到对应事件数组；Notification/Stop/UserPromptSubmit/SessionStart 均无 matcher——SessionStart 无 matcher = startup/resume/clear 全源匹配，正合「resume 即锚定」）：

```jsonc
// hooks.Notification[] / hooks.Stop[] / hooks.UserPromptSubmit[] 各 append 一个：
{
  "hooks": [
    { "type": "command",
      "command": "\"$HOME/Library/Application Support/Muxvo2 Dev/hooks/muxvo-hook.sh\" Notification",
      "timeout": 5 }
  ]
}
// command 末尾事件名作 $1（与 §4 脚本 "$1" 一致）：Notification / Stop / UserPromptSubmit / SessionStart 四份分别写各自事件名。
// ☆ 更正注记（2026-07-16 单绑定批）：上例 `$HOME/…` 是图示；实况 install() 写入的是**展开后的绝对路径**
// （HookScript.scriptURL(dataRoot:).path）——该绝对路径正是「本根授权证据」的载体（见下方单绑定条）。
```

- **方案 1 主路径**（用户裁决 2026-07-02）：首跑引导卡片 →「启用」→
  1. 备份 `settings.json.muxvo-bak-<ts>`；
  2. **JSON merge**：对 `hooks.Notification/Stop/UserPromptSubmit/SessionStart` 四数组各 **append 上述 group 对象**，**绝不触碰用户既有条目**；
  3. `AtomicFile` 原子写（MuxvoStorage 现成设施）；
  4. **幂等 + 可逆的识别策略（B1 修复）**：**按 group 的 `hooks[].command` 含子串 `muxvo-hook.sh` 识别**（可验证、不依赖 CC 是否保留自定义键）——已装则升级替换该 group、未装则 append；「停用」= 移除任何 `command` 含 `muxvo-hook.sh` 的 group。**放弃** `"__muxvo":true` 自定义键作主识别（CC round-trip 保留性 + `$schema` additionalProperties 容忍度未验），仅可作辅助标记不作依赖。
- **机器级单绑定（2026-07-16 用户裁决，跨分身劫持根修）**：settings.json 全局唯一，muxvo hook 组只保**一份绑定**，归「最后显式启用」的分身所有。
  - **授权证据 = 本根组**：组 `hooks[].command` 含**本分身脚本绝对路径**（`HookScript.scriptURL(dataRoot:).path`，全路径含 `/hooks/muxvo-hook.sh` 后缀免疫数据根名前缀撞车）才算本分身的授权。通用子串 `muxvo-hook.sh` **不再作授权证据**——事故链（2026-07-16 真机）：更新测试分身认领主 dev 授权 → 用户点「启用」→ 绑定被改指即将被 rm -rf 的根 → 全部 CC 会话 hook 空跑 + 每启动「中继脚本缺失」重弹死循环。
  - **自检语义**：本根组空 → `notInstalled`（**先于**脚本在位检查——他分身组在场、或组被清后本根脚本孤儿残留，均不弹）；本根组在 + 脚本缺失/缺事件/指纹不匹 → `drift`；全齐 → `installed`。
  - **他分身绑定在场**：不认领、不弹、只记启动日志（含对方绑定已损坏的场景——杜绝重弹死循环）；终端功能不受影响（§4 修订：每终端 PTY 恒注入 `MUXVO_HOOK_SOCK` 指向本分身 socket，脚本烘焙默认路径只是兜底，事件照常路由）。
  - **显式启用 = 接管**：install() 的移除识别**保持通用子串**（清扫全部 muxvo 组含他分身旧绑定与陈组）后装本根四组；仅显式路径可达——**设置面板「终端等待检测」行**（settings-modal.md，本批新增入口）或 env `MUXVO_HOOK_PROMPT=1`（dogfood 保留）。停用同理通用子串移除。
  - **路径迁移接受面**：改机器名/迁移主目录后旧绑定 command 指旧路径 → 视作他分身绑定，不弹；恢复走显式启用（裁决内接受）。
- **每次启动自检**（脚本文件在位 + 四事件各有**本根** group + 指纹版本匹配），**drift 提示重新启用而非静默重写**——2026-07-16 对抗回修 MAJOR-1 起，启动路径对「曾授权（已有**本根**组，单绑定条）+ drift」弹重启用对话框（写入仍须用户点「启用」）；fresh 首启的全新用户走下条自动启用门；非 fresh 的全新态/仅他分身绑定在场走设置面板/env 显式启用，不自动打扰。
- **首启静默自动启用（2026-07-17 产品口径；启动路径写真文件的唯一授权例外）**：**四条件门** = 数据根 lifecycle verdict 为 freshInstall ∧ selfCheck notInstalled ∧ 无他分身绑定（通用子串零命中，**无论对方绑定死活**——单绑定「不认领」裁决零变化）∧ 用户未曾主动停用（opt-out 记档，下条）。全真 → 静默 install()（此时机器无任何 muxvo 组，清扫即空扫，无接管语义），成功置一次性轻提示 pending（config `hookAutoEnabledNoticePending`，web 首查即消费出 toast「已启用终端等待检测，可在设置中管理」4s 自动消隐——查询即写回，WhatsNewGate 先例）；install 失败只记日志**静默降级**（设置面板仍是手动兜底），绝不弹窗。禁装门/env 门优先级不变（禁装门整体退出 hook 面；env MUXVO_HOOK_PROMPT=1 走授权弹窗不走自动装）。设计动机 = 老版等待提醒无感开箱即用（PRD M04 全 REQ 触发方式均「自动出现」、只有 opt-out），单绑定批把开发期多分身复杂度暴露给了单实例真实用户。**已知边界（记档非缺陷）**：settings.json 被外因清空的老用户（非 fresh 启动）不会被自动补装，走设置面板手动启用——「非 fresh 永不静默写」是**用户手删 hook 组必须被尊重**的保证。案例：WD_autoinstall_fresh_clean_machine / WD_autoinstall_foreign_present_skip / WD_autoinstall_optout_skip / WD_autoinstall_not_fresh_skip / WD_notice_consume_once / WD_panel_notice_route / WD_auto_enable_toast（web，settings-modal.md）。
- **用户主动停用 opt-out（2026-07-17）**：设置面板 installed 态「停用」按钮 → uninstall（通用子串清扫全部 muxvo 组，脚本文件保留）+ config `hookUserDisabled=true` 记档 → 首启自动装配门对该数据根**永久关**。**置位面收窄**：仅「停用」按钮置位；drift 弹窗/env 弹窗点「稍后手动」、授权 sheet 取消均**不**置位。任一次成功 install()（面板启用/接管、drift 重启用、env 弹窗、首启自动装）置回 false——显式重新启用 = 撤回停用意愿。停用**无确认 sheet**（产品选择：可逆 + 写前自动备份；此处记档防后续审查当遗漏）。桥面 = `hookDisable`/`hookAutoEnableNotice` 请求 + `hookNotice` 响应（v38，`app.request` 既有 union 加 variant，消息条数零增）。案例：WD_disable_records_optout / WD_enable_clears_optout / WD_panel_disable_route。
- **foreignBound 用户面归一（2026-07-17 用户裁决：多实例概念不出用户可见面）**：设置面板 foreignBound 渲染与 notInstalled **完全同构**（同描述文案 + 「启用」按钮）；「实例/绑定」字眼只存在于启动日志与 native 授权 sheet 的接管语境句。归属机制零变化（不认领/不弹/显式启用=接管照旧）。**名实注记**：foreignBound 时本实例提醒实为**寄生工作态**——PTY 恒注入 `MUXVO_HOOK_SOCK`（§4 修订），事件确能路由回本实例；但依赖**他根**脚本在位可执行（对方删数据根即全链死）、不受本实例指纹自检保障，故用户面呈现「未启用」是保守口径；点「启用」接管后转受保障态（对已工作场景幂等无害）。案例：WD_panel_row_states（归一断言，settings-modal.md）/ WD_panel_foreign_enable_delegate（同）。
- **禁装门（2026-07-16 更新测试真机撞出）**：Info.plist `MuxvoHookInstallDisabled` = 布尔 true → hook 面**整体退出**（不自检、不弹、env 门也不装，仅 NSLog 留痕）；键缺席 = 照常。用途 = 短命测试分身（如更新测试 vA：数据根被重置脚本反复清空）——纵深防线：即使装配面有回归，此类分身也不参与 hook 面。案例：WD_hooks_disabled_gate。（原⚠️遗留「授权证据不校验指向」已由上方单绑定条根修，2026-07-16 晚。）
- **方案 2 兜底**：设置面板展示待粘贴 JSON + 「验证安装」按钮（测试事件走 socket 回环）。
- **方案 3 项目级**：不推荐（污染用户仓库），仅文档提及。
- **授权文案随⑨给用户过目**（m3-adjudications.md A 区记录）。

## §8 UI 输出端 M3 清单

四者 web M2 已复刻、全部 ui.state 驱动，**M3 web 零新画**（term-grid.md §3）：

| 输出端 | 驱动字段 | M2 复刻处 |
|---|---|---|
| 状态点 红/绿/灰 | `TerminalSnapshot.state`（WaitingInput→红、Running→绿、余灰） | term-grid.md §3.1 |
| badge "1" | 同上 WaitingInput | term-grid.md §3.2 |
| tile 呼吸红边框 | 同上 WaitingInput | term-grid.md §3.2 |
| WaitingCard 浮卡「N 个终端等待输入」 | `waitingNotification.count` | term-grid.md §5 |
| Dock badge | native 聚合**可见等待数**（`visibleWaitingCount`=WaitingInput 全计**含静默弱信号**，与上三行 per-终端口径一致；legacy dock-badge.ts `state==='WaitingInput'` 亲验无强弱之分。settings-dogfood 批改口径——原「强信号 count」致满屏黄灯角标恒 0 观感断裂；浮卡 count 强口径不变，案例 `WD_dock_badge_includes_silence`。已知边界：计数含收起终端，折叠 rail 圆点为用户裁决统一淡灰 → 折叠态可能「角标亮而屏上无黄可寻」，展开 rail 即见。**渲染通道=自绘 contentView**（settings-dogfood 批收口）：macOS 26 存在 bundle-id 级 badgeLabel 抑制——凡历史上被通知系统登记过、badge 授权 disabled 的 id，`dockTile.badgeLabel` 系统登记正确（lsappinfo StatusLabel 可见）但 Dock 拒画，三个真 muxvo id 全中，实证三臂矩阵 probes/dock-badge-probe/reports/；故 DockTileRenderer 合成 icon+徽标胶囊（+更新进度条共用），**不再写 badgeLabel**（健康机器上系统叠画会成双角标），已知偏差=lsappinfo StatusLabel 真值与 VoiceOver 徽标读数丧失；徽标胶囊按文本自动加宽不做 99+ 截断（macOS 系统角标惯例显全数）。案例 `WD_dock_tile_badge_render`/`WD_dock_tile_compose`/`WD_dock_tile_clear_restores_icon`） | 原生输出端（SessionHub Σ 各窗 → DockBadgeController → DockTileRenderer 自绘） |

> ☆ 修订（DOGFOOD_M3_18，2026-07-07 用户裁决）：WaitingCard 浮卡的**显隐门控**——**终端屏不显示**（重写版常驻终端屏遮挡 FAB 是现场缺陷），仅在**非终端覆盖层**（聊天历史/Skills/MCP/Hooks/Plugins/文件面板/临时文件查看 + 新增任务中心；**不含 settings**）显示，点卡片正文跳回终端屏、✕ 单独清红。铁证 legacy `WaitingInputNotification.tsx` L74 overlayActive 门控。live-only 门控实现与 golden f8 保全细节见 term-grid.md §5 ☆ 修订。

## §9 测试策略（不烧 token）

- **单测（大头）**：detector 核心 `ingest(event, ts)` **纯函数式表驱动**——覆盖 10 态机全 transitions / 层合成优先级 / 静默豁免门控 / reset 全清 / 30s 边界 / 50ms 去抖与终态豁免（**假时钟**）。
- **socket 集成测**：真 listener + nc/Swift 客户端注入伪造 hook JSON → 断言快照推送。用例：正常 / 无 env 丢弃 / 未知 termId 丢弃 / 非法 JSON / 64KB 超限 / stale socket 接管 / 并发 20 连接 / 限速 20/s。
- **hook 脚本测**：bash 直跑喂 stdin——无 env 秒退 0 / 无 socket 秒退 0 / 正常转发对照收包 / **退出 <100ms**。
- **端到端彩排**（人工不进 CI）：dogfood 前真 CC 会话验 Notification→红点全链路一次。
- 「按剧本触发 hook」小工具落 `tools/`，M4a fake-cli 可继承。

## §10 案例表（spec↔test 1:1 命名池，dogfood 反馈追加）

> M3 无 legacy spec 桶 ID 直接映射本规格（等待检测是新功能，30 桶里无对应 case）；本表是 detector 单测命名池，dogfood 期 `DOGFOOD_M3_NN` 追加。

| 用例名 | 断言 |
|---|---|
| WD_layer0_notification | Notification 事件 → WaitingInput，快照 state 更新 |
| WD_layer0_stop | Stop 事件 → WaitingInput |
| WD_layer0_userprompt | UserPromptSubmit → Running（清红） |
| WD_reset_on_write | PTY 用户写入 → 全层 reset → Running；终端自应答不 reset |
| WD_acknowledge_tileclick | tileClick / acknowledgeWaiting → 清红 |
| WD_priority_layer0_over_silence | 有 hook 流的终端静默 40s 不触发静默弱信号 |
| WD_silence_30s | 无 hook + 前台非 shell + 静默 30s → 弱 WaitingInput，count 不增 |
| WD_silence_clear | 静默态收到任意输出 → 清 |
| WD_count_excludes_silence | 静默兜底 WaitingInput 不计入 waitingNotification.count |
| WD_dock_badge_includes_silence | visibleWaitingCount 含静默弱信号（Dock 徽标口径，§8 行）；浮卡 waitingCount 维持强口径；清 → 双归零 |
| WD_dock_tile_badge_render | 设徽标 → DockTileRenderer 挂 contentView+display；重复设只重绘不重挂（§8 Dock badge 行渲染通道） |
| WD_dock_tile_compose | 徽标与更新进度条共用 contentView 合成互不 clobber；单清一路另一路仍挂 |
| WD_dock_tile_clear_restores_icon | 徽标+进度双输入皆空 → contentView=nil 还原系统默认图标 |
| WD_debounce_50ms | 50ms 内 Running↔WaitingInput 抖动只出最终一条；终态立即推 |
| WD_socket_reject | 非法 JSON / 超 64KB / 未知 termId / 无 env → 丢弃计数 |
| WD_layer0_sessionstart_no_state | SessionStart → detector 零影响：不改态、不标 hook 流（静默兜底豁免不授予）、等待态在场不清红（§5 SessionStart 行） |
| WD_socket_ratelimit | 单 termId >20/s → 丢弃 |
| WD_install_shape | append 的 group = 嵌套 matcher-group（`{hooks:[{type:command,command:"…muxvo-hook.sh <Event>",timeout}]}`，无 matcher），与 CC schema 匹配；四事件各一（2026-07-16 起含 SessionStart；老 3-hook 安装 → 自检 drift「缺 hook：SessionStart」提示重新启用，非静默重写） |
| WD_install_idempotent | 识别按 `hooks[].command` 含 `muxvo-hook.sh`：二次启用不重复写（替换升级）；停用移除全部含该子串的 group；用户既有条目零改动 |
| WD_waiteventbus_shape | WaitEvent{termId,event,ts,raw} 冻结形状；ts=native epoch ms（hook 不带 ts）；M4a 第二订阅者可读同流 |
| WD_silence_ack_no_rearm | 静默弱信号 ack 后无新输出，任意时长（+30s/+10min）不重触发；poll 反复喂陈旧 lastOutputMs 不解除抑制（☆ DOGFOOD_M3_08） |
| WD_silence_new_output_new_episode | ack 后新 PTY 输出（ts>水位）解除抑制 → 再安静 30s 重新触发；29999ms 边界内不触发（☆ DOGFOOD_M3_08） |
| WD_ack_sidebar_select | sidebarSelect 与 tileClick / acknowledgeWaiting 同语义隐含 acknowledge（☆ DOGFOOD_M3_08） |
| WD_binding_foreign_not_claimed | 他分身装的 4 组不构成本分身授权：selfCheck=notInstalled、启动重弹判定 false（§7 单绑定；2026-07-16 劫持事故复现） |
| WD_binding_own_drift_priority | 本根 3 事件老安装（缺 SessionStart）在他分身组同场时仍报 drift 缺 SessionStart——主人升级激活路径（a762787 批）防回归 |
| WD_binding_script_orphan_silent | settings 无任何 muxvo 组 + 本根脚本孤儿在位 → notInstalled（授权证据=本根组，杀「中继脚本缺失」重弹死循环） |
| WD_binding_takeover | 显式 install() = 接管：他分身组清除、本根 4 组落位、用户既有条目零动 |
| WD_autoinstall_fresh_clean_machine | fresh + 干净机器（四条件全真）→ 静默装成：本根 4 组落位、selfCheck=installed（§7 首启自动启用） |
| WD_autoinstall_foreign_present_skip | 他分身绑定在场 → 自动装门关：不装不认领，settings **字节零动**（单绑定裁决零变化） |
| WD_autoinstall_optout_skip | opt-out 记档在场 → fresh 也不装、不创建 settings |
| WD_autoinstall_not_fresh_skip | 非 fresh 启动 → 永不静默写（用户手删 hook 组被尊重） |
| WD_disable_records_optout | requestDisable → 全部 muxvo 组清除 + opt-out=true + 终态 notInstalled + 脚本保留 |
| WD_enable_clears_optout | 任一次成功 install() → opt-out 清回 false（显式重新启用=撤回停用意愿） |
| WD_notice_consume_once | 轻提示查询即写回：首查 true、再查 false（一次性） |
| WD_panel_disable_route | app.request hookDisable：调缝恰一次回终态；抛错 rejected(HOOK_DISABLE_FAILED)；缝缺席 disabled |
| WD_panel_notice_route | app.request hookAutoEnableNotice：经缝消费；缝缺席恒 hookNotice(show:false) |

## 修订记录

- **2026-07-17 午后（首启启用 UX 批，fix/hook-enable-ux）**：用户反馈「终端等待检测」行对真实用户莫名其妙（真实用户只装一个 muxvo；老版提醒无感开箱即用——侦察定案：老版根本不装 CC hook，检测走 PTY 输出解析默认全开，PRD M04 印证）。产品口径三裁决（2026-07-17）：①fresh 首启四条件门静默自动启用+一次性轻提示；②多实例概念退出用户可见面（foreignBound 渲染归一 notInstalled）；③installed 态加「停用」按钮（opt-out 记档）。§7 新增三条款 + 启动自检条尾句改口 + 「绝不写真文件」doctrine 收窄为「唯一授权例外=fresh 四条件门」；§10 追加 WD_autoinstall_*/WD_disable_*/WD_enable_clears_optout/WD_notice_*/WD_panel_disable_route/WD_panel_notice_route 十行；桥 v38（hookDisable/hookAutoEnableNotice/hookNotice variant）。单绑定机制（2026-07-16 两裁决）与 drift「非静默重写」条款零变化。冻结主体不变，本条为增补留痕。

- **2026-07-16 晚（单绑定根修，fix/hook-single-binding）**：跨分身授权混淆/绑定劫持根修（真机事故：更新测试分身认领主 dev 授权→点启用劫持绑定→数据根被清→全 CC 会话 hook 空跑+重弹死循环）。用户裁决：①hook 归属 = **机器级单绑定**（他分身组不认领不弹只日志，显式启用=接管）；②显式启用入口 = **设置面板按钮**（settings-modal.md 通用区行，经 app.request hookStatus/hookEnable，桥 v37）。§7 新增单绑定条 + 自检/重弹条款改「本根组」口径 + jsonc 绝对路径更正注记 + 禁装门遗留注销；§10 追加 WD_binding_* 四行。冻结主体不变，本条为增补留痕。

- **2026-07-11（title-sync 批，多分身路由修复）**：用户反馈「终端命名不同步聊天历史」，真机取证根因 = §4 hook 脚本 SOCK 烘焙**安装方分身**路径（settings.json 全局共享一份 hook 组），多分身并开时其他分身事件全部投错 socket → SessionTracker 锚点永不绑定（customTitle 正向链/首绑补写全断，Layer 0 等待检测、resume 锚点连带）。修 = spawn PTY 恒注入 `MUXVO_HOOK_SOCK`（§4 新增注入行 + 脚本块 SOCK 行更新为 env 覆盖形；terminal-session.md §1.2 补行）。脚本 `${MUXVO_HOOK_SOCK:-…}` 消费能力 M3 起就有（测试缝转正为生产路由），脚本内容/指纹版本零改。冻结主体不变，本条为增补留痕。
- **2026-07-04（DOGFOOD_M3_08）**：用户反馈「session 完成任务提醒，确认后无新活动又再次提醒」；根因 = ack 后静默 re-arm 语义无明文（语义缺口非违背），检测核无「已确认」记忆位（acknowledge 实际 = snooze 30s）。用户裁决（直接生效）：①确认后同终端不再提醒，直到新 PTY 输出开新 episode；②sidebarSelect 隐含 acknowledge。修订 §3 两条 + §6 re-arm 行 + §10 追加 WD_silence_ack_no_rearm / WD_silence_new_output_new_episode / WD_ack_sidebar_select。v1-frozen 主体不变，本条为增补留痕（教训：绝不静默改冻结 spec）。
- **2026-07-06（M4b，draft——冻结随 M4b 规格簇终审）**：M4b 编排交互式 worker 落地引发三处注记级修订（**冻结形状零改，均加性/收窄**）：①**§0/§3 WaitEventBus 第二订阅者从「M4a 弱预接缝」转「M4b 实消费」**——M4a headless worker 非 SessionRegistry 终端、零 WaitEvent 流经（空转预接缝，`scheduler-worker.md` §5）；M4b 交互式 worker 是真 PTY 终端，其 hook 事件（Notification/Stop）经 detector 产 WaitEvent（主键 termId）→ **编排引擎凭 termId→taskId 绑定表首次实消费**喂任务态（`interactive-worker.md` ①§3）。`WaitEvent` 冻结形状零改，仅消费者到位。另 `SessionTracker` 为**第三订阅者**（`terminal-session-restore.md` ④§1，见 §4 raw 纪律收窄注记）。②**`silence` waitClass 归属澄清**：`silence` 属 §0 taxonomy **(b) 任务编排等待**（主键 taskId），由 M4b 交互式 worker 激活（前台非 shell + PTY 静默 ≥阈值 + 无近期 hook 进展 → 疑似卡在 hook 管不到的 TUI 弹窗前）；与 detector 核 (a) 层对 hook 终端的静默兜底抑制（§3/§6，主键 termId）是**两回事**——`scheduler-worker.md` §5 此前括注误写「taxonomy (a)」已同步澄清。③**§4/§5 可选加装 `SessionStart` hook（S1 增强，可选，待独立裁决复核）**：现装三 hook（Notification/Stop/UserPromptSubmit）中 UserPromptSubmit 最早（S1 实测 +199ms）已够支撑 ④ 无条件锚点登记；S1 建议锚点从 SessionStart 抓取（最即时）。加装 SessionStart 为**加性可选增强**（不改现三 hook、不破 §5「三装一不装」现有语义，仅新增一采集触发），非 v1 必需。登记待实现批/独立裁决定夺。
- **2026-07-16（SessionStart 加装兑现，fix/sessionstart-anchor）**：上条③与 `terminal-session-restore.md` 登记 4 兑现——§5 表新增 `SessionStart` 行（四装一不装）、`WaitEventKind` 加性扩 `sessionStart` case（detector 核/编排消费者显式零消费，`SessionTracker` 采集为唯一消费者）、`HookScript.installedEvents` 扩至四事件（脚本内容零改动、版本不 bump；老 3-hook 安装经 §7 自检报 drift 提示重新启用）。触发根因 = 真机案例（测试7 wt-8 格）：resume 起来后从未再对话的 CC 会话零 hook 事件 → 永无锚点 → SIGKILL 后不可恢复。案例：WD_layer0_sessionstart_no_state 入池；WD_install_shape 断言随升至四事件。
