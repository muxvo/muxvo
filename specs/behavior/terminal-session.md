# 行为规格：终端会话（PTY 会话核心 + 10 态机 + 生命周期）

> 提炼自老 app 实际代码（`../muxvo-legacy/src/main/services/terminal/pty-adapter.ts`、`manager.ts`、
> `../muxvo-legacy/src/shared/machines/terminal-process.ts`、`foreground-detector.ts`，2026-07-02 亲自读取核验行号），
> **只记行为不抄结构**。新实现从本规格实现（forkpty+execvp C shim + Swift 会话核心 + libghostty-vt），
> 架构/命名/IPC channel 一律不继承。老代码只当「行为说明书」。
> 状态：**v1-frozen**（2026-07-02 检查点⑨通过：五视角对抗评审 2 blocking 修复闭环 + 用户裁决全按推荐——关闭信号 SIGHUP、TERM=xterm-256color）。含「偏差发现」小节：本规格与 legacy 实况/设计附件冲突处以实况为准。§3.2 步骤5 / §2.2 REMOVE 行 / §6.3 单帧合并注记为 DOGFOOD_M3_09 增补留痕（2026-07-04 用户裁决，v1-frozen 主体不变），见文末「修订记录」。
> 底稿：`~/Library/Caches/muxvo-build/logs/m3-design-annex-A-term-core.md` §1/§2。裁决点 ★=用户裁决 ☆=独立 agent 裁决。

## 0. 范围与所有权

- 本规格 = `MuxvoTermCore`（纯 Swift、零 C 依赖：状态机/Registry 策略/env 合同/默认值）+ `MuxvoTerm`
  （`TerminalSession`/`PTYHost`/`SessionRegistry`）+ `CMuxvoPTY`（forkpty/execvp/TIOCSWINSZ C shim）的行为合同。
- 渲染 = `terminal-rendering.md`；输入编码/IME/粘贴/选区 = `terminal-input.md`；等待检测 = `wait-detector.md`。三份互不重复。
- **会话恢复（崩溃/重启后 `claude --resume <sessionId>` 续断点）= `terminal-session-restore.md`（④，M4b draft）**（M4b，2026-07-06，draft 交叉引用）：本规格只管会话核心/生命周期/持久化（§6/§7 是终端窗口回 cwd 的 M3 现状）；「续 harness 会话对话上下文」是 M4b 新功能，归 ④ 管辖（SessionTracker 锚点采集 + InitialCommandInjector 恢复注入），不在本规格实现。
  - **§6/§7 `openTerminals` termId 形状变更登记（found MIN-2，M4b draft 诉求，冻结形状本轮不改）**：④ 恢复以**稳定 termId** join 锚点（④T-3），而现 `openTerminals` 仅持久化 `{cwd, customName?}`、**无稳定 termId**（`ConfigStore.swift:39-45`，termId 是每次 spawn 新生成 UUID）——④ 需 `openTerminals` **加持久化稳定 id**（`{cwd, customName?, stableId?}` 加性字段），否则重启后旧 termId 对不上新 spawn。**本 v1-frozen 规格 §6/§7 持久化形状本轮零改**，仅登记此 M4b 诉求（实现批随 ④T-3 兑现；旧 config 无 id → ④ best-effort cwd+顺序匹配降级，向后兼容）；对齐 §偏差发现「`ConfigStore.swift` 偏差②」。
  - **`openTerminals` 收起态加性字段（批A 终端收起，2026-07-11）**：形状增 `minimized?: bool`（缺席=false
    旧 config 兼容、未收起写回省略）。恢复为收起态的终端不建洞、`hasReceivedResize` 由
    `ensureBackgroundSized` 主格尺寸拷贝先行满足（防 80×24 注入烧写）。行为规格与案例池归
    `term-grid.md §11`（TG_MIN_persist_roundtrip / TG_MIN_restore_size_gate），本文件只登记形状。
- 终端字节流**永不过桥**（桥 v1-frozen §1 非目标、§8 归宿 `terminal:output → native`）。会话是下层设施：不进 GRDB、不进 TaskEventBus。

## 1. PTY spawn 与 env 合同

### 1.1 spawn 参数（继承 legacy 行为，实现换 forkpty+execvp）

| 项 | legacy 实况（文件:行号） | 新实现合同 |
|---|---|---|
| shell 取值 | `process.env.SHELL \|\| '/bin/zsh'`（pty-adapter.ts:66） | 同：`getenv("SHELL")` 兜底 `/bin/zsh` |
| login shell | node-pty 传参 `['--login']`（pty-adapter.ts:45） | ☆ **推荐 argv[0] 前缀 `-`**（`-zsh`，POSIX 通用 login 约定，不绑定 zsh 专有 `--login`）；见偏差发现①，本规格实验用 `-zsh` 已验证 login 生效 |
| 初始尺寸 | cols `>=10?cols:80`、rows `>=2?rows:24`（manager.ts:171-172） | 同：默认 80×24，下限 cols≥10/rows≥2（与 resize 防御同阈值，§4） |
| 终端 id | `term-${proc.pid}`（manager.ts:174） | **native 生成稳定 UUID**（全链路统一：快照/layoutReport/MUXVO_TERM_ID/DB），见偏差发现② |

### 1.2 env 合同（逐条继承 + 一处新增）

| 变量 | legacy 行为（文件:行号） | 新实现 |
|---|---|---|
| `CLAUDECODE` | 删除（pty-adapter.ts:24-26，让 spawned 终端里能再跑 CC） | 删除 |
| `TERM_PROGRAM` | darwin 且未设时注入 `Apple_Terminal`（pty-adapter.ts:32-34） | 同。目的：触发 `/etc/zshrc_Apple_Terminal` 发 **OSC 7**（cwd 追踪走结构化通道，§5） |
| `LANG` | darwin 且 缺失/`C`/`POSIX` 时注入 `en_US.UTF-8`（pty-adapter.ts:39-41） | 同（CJK 路径显示） |
| `COLORTERM` | **legacy 未设**（pty-adapter.ts 全文无 COLORTERM，见偏差发现③） | ☆ 新增 `COLORTERM=truecolor`（vt 支持真彩，声明能力）；标为**新增非继承** |
| `TERM` | node-pty `name:'xterm-256color'`（pty-adapter.ts:49） | **已裁决（⑨）：`xterm-256color`**（terminfo 随系统在；`xterm-ghostty` 需随包分发 terminfo，推迟 M7），见 m3-adjudications.md B 区③ |
| `MUXVO_TERM_ID` | 无（legacy id 不注入 env） | **新增**：注入会话 UUID，供 hook 脚本回传等待事件（wait-detector.md §4.2） |
| `MUXVO_HOOK_SOCK` | 无 | **新增（2026-07-11 多分身路由修复）**：注入本 app 的 hook socket 绝对路径（`<dataRoot>/run/hook.sock`）。hook 脚本装在全局 `~/.claude/settings.json`、内嵌默认 socket 是安装方分身路径，多分身并开时事件投错 socket → 锚点/等待检测全断；此变量令每终端事件路由回自己的 app（wait-detector.md §4）。**该键同时入 `deletedKeys` 恒删继承值**（对抗 MINOR-3：嵌套 muxvo——A 分身终端里启动 B 分身——B 的 environ 带 A 的路由值，透传则 B 的 worker/takeover hook 事件投给 A 静默丢失）；删除后 grid 终端由 TerminalService 生产 configTemplate 的 `extraEnv` 显式重注本 app 路径（extraEnv 叠加后于 EnvContract），worker/takeover 不注 → 脚本 `${MUXVO_HOOK_SOCK:-…}` 回落各自 app 烘焙默认（本就正确）。EnvContract 只知键名不知 dataRoot（vendor-free 纯合同） |

- fork 子分支只做 async-signal-safe 调用（`chdir`/`execvp`/`_exit`），env/argv 在 Swift 侧组好传入 C（附件 A §2.2）。
- legacy 首次输出时注入 `bindkey`（Home/End）+ 静默 `cd`（manager.ts:209-259）是 xterm.js 键位 workaround，**不继承**——ghostty key encoder 直接产 Home/End 编码（terminal-input.md），cwd 由 spawn 时 chdir 保证，无需注入。

## 2. 10 态机转移表（逐行迁移 legacy，文档即 oracle）

**权威**：`terminal-process.ts:29-45`（2026-07-02 逐行核验）。10 态、14 事件。测试将解析本表比对 `TerminalStateMachine.transitionTable`（比照 task-state-machine.md §4 做法）。

10 态：`Created / Starting / Running / Busy / WaitingInput / Stopping / Stopped / Disconnected / Failed / Removed`。
14 事件：`SPAWN / SPAWN_SUCCESS / SPAWN_FAILURE / PROCESS_START / PROCESS_DONE / WAIT_INPUT / USER_INPUT / AUTO_RESUME / CLOSE / EXIT_NORMAL / EXIT_ABNORMAL / TIMEOUT / RECONNECT / REMOVE`。

### 2.1 转移矩阵（from × event → to；空 = 该组合无转移，忽略事件不报错）

| from \ event | 目标转移（event→to） |
|---|---|
| `Created` | SPAWN→Starting |
| `Starting` | SPAWN_SUCCESS→Running；SPAWN_FAILURE→Failed |
| `Running` | PROCESS_START→Busy；WAIT_INPUT→WaitingInput；CLOSE→Stopping；EXIT_ABNORMAL→Disconnected |
| `Busy` | PROCESS_DONE→Running |
| `WaitingInput` | USER_INPUT→Running；AUTO_RESUME→Running |
| `Stopping` | EXIT_NORMAL→Stopped；TIMEOUT→Disconnected |
| `Stopped` | REMOVE→Removed |
| `Disconnected` | RECONNECT→Starting；REMOVE→Removed |
| `Failed` | REMOVE→Removed |
| `Removed` | （终态，无转移） |

- `send(event)` 语义：命中表则转移，未命中**静默忽略**（terminal-process.ts:50-56），不抛错——迁移保持此宽松语义。
- **M3 实际驱动 7 态**：Created/Starting/Running/Stopping/Stopped/Disconnected/Failed。`Busy`（PROCESS_START/DONE）与 `WaitingInput`（WAIT_INPUT）属编排层观察，M4+ 由 hook 事件驱动；M3 状态机建全 10 态**留位**，WaitingInput 由 wait-detector.md 驱动（Layer 0/进程/静默），Busy M3 不产出（wait-detector.md §2）。

### 2.2 事件产生点（M3 接线）

| 事件 | 产生者 | legacy 参照 |
|---|---|---|
| SPAWN / SPAWN_SUCCESS / SPAWN_FAILURE | spawn 流程 | manager.ts:166-176,340 |
| WAIT_INPUT | WaitDetector（wait-detector.md） | manager.ts:294-305 |
| USER_INPUT | PTY 写入路径（用户键入，非终端自应答） | manager.ts:356-364（`isTerminalAutoResponse` 旁通，§6.3） |
| AUTO_RESUME | acknowledgeWaiting（tileClick / acknowledgeWaiting 动作） | manager.ts:542-550 |
| CLOSE | close() 入口 | manager.ts:387,399 |
| EXIT_NORMAL / EXIT_ABNORMAL | 进程退出回调（按退出码分派，§3.3） | manager.ts:312-313（见偏差发现④） |
| TIMEOUT | 优雅关闭 grace 超时 | close() 5s（§3.2） |
| REMOVE | 用户关闭终态 tile（自退死 tile 的 ✕ 一键移除）/ 用户主动关闭活会话退到终态后**自动**移除（§3.2 步骤5，DOGFOOD_M3_09） | manager.ts:310-330 全局 onExit 对任何退出 `terminals.delete(id)`（亲验）+ REMOVE_TERMINAL reducer |

## 3. 优雅关闭协议与退出码

### 3.1 legacy 实况（亲验，构成裁决①依据）

- `close(id, force?)`（manager.ts:380-422）：非 force 路径 **`terminal.process.write('\x03')`**（manager.ts:401）——写 Ctrl+C **字节**进 PTY，由行规程转 SIGINT 给前台进程组；随后 `GRACEFUL_CLOSE_TIMEOUT=5000ms`（manager.ts:22）超时则 `process.kill()`（manager.ts:407）。
- force 路径直接 `process.kill()`（manager.ts:389）。`closeAll()`（manager.ts:507-522）对全部会话立即 `process.kill()`，**无优雅期**。
- **`process.kill()` 默认信号 = SIGHUP**（node-pty `UnixTerminal.prototype.kill`：`process.kill(pid, signal||'SIGHUP')`，`node_modules/node-pty/lib/unixTerminal.js:228`）。⇒ legacy 关闭真相 = 写 `\x03`（对空闲交互 shell 无效）→ **空等 5s** → `process.kill()` 即 **SIGHUP** 终结。
- **实测（2026-07-02，`/bin/zsh -i`，脚本 `scratchpad/sigtest3.py`）**：交互式 zsh 收 `\x03`（Ctrl+C 字节）与 `kill -INT` 均**不退出**（清行重画提示符）；`kill -TERM` **也不退出**（交互 shell 忽略）；仅 `kill -HUP` **干净退出（code=1）**。⇒ legacy 优雅关闭对空闲交互 shell **永远走满 5s 超时再强杀**——新设计只是把这个 SIGHUP **提前**、删掉无效的 5s SIGINT 空等（见 m3-adjudications.md B 区①）。

### 3.2 新实现优雅关闭协议

`close()`（信号**已裁决（⑨）：SIGHUP**，见 m3-adjudications.md B 区①）：

0. 关闭确认联动：web 侧 `CloseConfirmDialog`（`specs/behavior/close-confirm-dialog.md`）确认后才发 `term.command close`（dogfood 基线「关闭含确认」，桥草案 §2）；backdrop/取消不发。以下为 native 收到 close 后的协议。
1. 推 `Stopping`（CLOSE），状态**立即推**（Stopping 非终态但关闭意图应即时反映，实现在去抖豁免名单，§7）。
2. 向**进程组**发关闭信号 `SIGHUP`（已裁决⑨；grace 默认 5000ms，**可注入缩短供测试**——APP_L2_06/TERM_L2_31）。
3. grace 内进程退出 → `EXIT_NORMAL`/`EXIT_ABNORMAL`（按码，§3.3）→ 终态立即推 + waitpid 收尸。
4. grace 超时 → `SIGKILL` → waitpid → `TIMEOUT`→Disconnected（Stopping:TIMEOUT，§2.1）。
5. **用户关闭 → 终态自动移除**（☆ 2026-07-04 用户裁决，DOGFOOD_M3_09）：经 `term.command close` 的**用户主动关闭**路径，进程退出到终态（Stopped/Disconnected/Failed）后 tile **自动移除**（REMOVE→Removed），不留死 tile——回归 legacy「任何进程退出 tile 即消失」（manager.ts:310-330 全局 onExit 对任何退出 `terminals.delete(id)`，亲验）与 REQ-TERM_LIFECYCLE-012「确定后终端被强制收掉，无论命令是否还在跑」。**Stopped 观察与移除合并单帧**（不闪死 tile，§6.3）；grace 超时强杀路径同理（Disconnected 亦 removable，自动移除，等待上限=grace）。关闭中（Stopping）期间 tile 显「关闭中」变暗 + ✕ 禁用防误点（web，term-grid.md §3.5）。
   - **自退（敲 `exit`/崩溃）不适用**：非经 close 命令的自发退出保留死 tile + 「已停止」标签，✕ 跳确认一键 REMOVE（现有行为，用户裁决②）。
   - **closeAll（关停）不触发**：closeAll 走 registry.closeAll、projection 不参与（§7.1），关停窗口 openTerminals 持久化不受移除干扰。
   - 落点：移除决策是 UI 语义，归 projection（`pendingUserClose` 集合，作用域收窄到 close 用户路径）；registry 不做自动移除（closeAll 也置 closeRequested → registry 自动 remove 会把 openTerminals 写空，数据丢失级；见 m3-adjudications.md D 区）。
- 与 legacy 差异：legacy 写 `\x03` 字节（SIGINT），新实现发真信号到进程组（SIGHUP）——SIGHUP 是唯一能让空闲交互 shell 优雅退出的信号（§3.1 实测），避免「每次关闭都空等 5s」。

### 3.3 退出码 → 终态语义（TERM_L1_07）

- **非请求退出**（Running 态自发退出，如用户 `exit` 或进程崩溃）：`WIFEXITED && code==0` → `EXIT_NORMAL`（经 Running→…→Stopped，见下）；`code!=0 || WIFSIGNALED` → `EXIT_ABNORMAL`（Running→Disconnected）。
- **请求关闭退出**（已在 Stopping）：clean 退出 → `EXIT_NORMAL`→Stopped；grace 超时强杀 → `TIMEOUT`→Disconnected。
- Running 态无 EXIT_NORMAL 直达 Stopped 的边（§2.1）；实现对自发正常退出先补发 `CLOSE`（Running→Stopping）再 `EXIT_NORMAL`（Stopping→Stopped），复刻 legacy `machine.send('CLOSE'); machine.send('EXIT_NORMAL')`（manager.ts:312-313）双发序。
- 退出码经 `waitpid` 的 `WIFEXITED`/`WEXITSTATUS`/`WIFSIGNALED`/`WTERMSIG` 区分（进程源用 `DispatchSource.makeProcessSource(.exit)`，附件 A §2.2）。exitCode/signal **不进 ui.state 快照**（折叠为终态映射 0→Stopped、非0/信号→Disconnected；dogfood 若需展示再议扩字段，桥草案 §ui.state note）。

## 4. resize 防御

- `resize(cols,rows)`：`cols<10 || rows<2` **拒绝**（不下发 winsize）——亲验 manager.ts:369-378（`if (cols < 10 || rows < 2) return`）。
- 实现：会话 queue 上 `ghostty_terminal_resize`（带真实 cell px，供 XTWINOPS/图片协议）+ `TIOCSWINSZ` ioctl 一函数收口；内核据 master 侧 winsize 自动向前台进程组发 SIGWINCH，**不手动发 SIGWINCH**（附件 A §2.2）。
- ☆（DOGFOOD_M3_12 增补，2026-07-04）resize 请求在**视图层**经 settle（trailing 80ms + maxWait 150ms
  混合；首帧/度量重置立即）稳定后才执行本函数的 vt+TIOCSWINSZ 原子收口——瞬态几何（布局切换中间帧/
  乱序回闪）不触 PTY，连续几何流（分隔条/窗口 resize）收敛为 ≥~5.7Hz（间隔 ≤~175ms）+ 松手 80ms 内终值。本函数自身
  语义（10×2 门、一函数收口、不手动 SIGWINCH）不变。见 terminal-rendering.md §1.2 ☆ 与文末修订记录。
- ☆（m3-layout-r5 增补，2026-07-07）上条 maxWait 中间提交**退役**：一切连续几何流（含窗口边
  live-resize）settle-only，「松手一次到位」= 报文静默 80ms 后单次终值提交（用户裁决；每次中间提交
  都命中活动 Ink 帧烧录一份永久残骸，2026-07-07 四次拖拽实录）。**预算不变式**：每几何静止期每会话
  ≤1 次已应用 resize；本函数增风暴哨兵（1s 内已应用 >2 → .error 持久日志）与请求/已应用取证计数器
  （`resizeRequestCountForTest`/`resizeAppliedCountForTest`，e2e/单测断言读面），可疑窄化降级
  .notice（合法布局窄化居多，.error 让位哨兵），全部 resize 日志补会话短 ID。10×2 门槛同时成为
  视图层换算的退化守卫门槛（同源，见 terminal-rendering.md §1.2 ☆）；网格下限钳制（80×24）在
  **视图层**实施——本函数保持通用、不知下限。`lastOutputMs` 新增消费者（F7 输出静默门，同 ☆）：
  `msSinceLastOutput()`（从未输出 → nil）供视图层判「流式中」推迟尺寸变更——本函数自身仍即到即执行。

## 5. cwd 追踪（结构化通道，不刮屏）

两路，与 legacy 同双保险：

1. **OSC 7 回调（主路径）**：TERM_PROGRAM=Apple_Terminal 触发 zsh 发 `OSC 7 file://host/path`；legacy 在 onData 正则解析（manager.ts:271-288）。新实现走 vt 的 `GHOSTTY_TERMINAL_OPT_PWD_CHANGED` 回调接住（结构化，不正则刮屏）。注：该回调 doc 载 **OSC 7/9/1337 都触发**——无害超集（多接住等价 cwd 信号，语义一致）。
2. **前台进程轮询（兜底）**：`CWD_POLL_INTERVAL_MS=1000`（manager.ts:23,497）；仅 `Running`/`WaitingInput` 态轮询（manager.ts:476）；取前台子进程 pid（`pgrep -P shellPid` 取最后一个，foreground-detector.ts:24-36）→ `lsof -a -p PID -d cwd -Fn` + vis 解码（foreground-detector.ts:42-77）→ 与当前 cwd 不同则更新推 `PWD_CHANGED`。
- **grace 期**：`CWD_GRACE_MS=1000`（manager.ts:24），spawn 后 1s 内忽略 cwd 变化（manager.ts:278,485），避免 shell 初始化噪声。
- 与 cwd 轮询同循环还产出「前台是否 harness 类进程」喂 wait-detector 静默门控（wait-detector.md §6）。
- **注入 cd 权威源登记（F-B，dogfood-r1 2026-07-09；`terminal-session-restore.md` 冻结面登记⑨）**：恢复/继续
  聊天注入 `cd -- '<cwd>' && <harness> resume <id>` 的 `cd` 与命令**同行内执行、不产生新 OSC7**，其后 harness
  TUI 接管亦无 OSC7——故注入 `cd` 的落点才是权威 cwd。`TerminalSession.noteInjectedCwd` 为 `_cwd` 的**第二写源**
  （与主路径 OSC7 回调 handlePwdChanged 同写 `_cwd`、同 `stateLock`）：协调层注入成功即覆写 `_cwd`
  为该落点，令本 §5 的 ~1s cwd 轮询（`UIStateProjection.refreshCwds` 读 `session.cwd`）收敛，不被注入前 `.zshrc`
  的 OSC7 漂移钉死 header。投影层修不动（refreshCwds 每轮从 `session.cwd` 重灌，只写投影 1s 内被 clobber）——
  唯一正确缝 = `_cwd` 层；注入落点归一 = createTerminal 存投影 `cwds[id]` 口径（`expandingTildeInPath`+去尾斜杠），
  令 refreshCwds 回读恰等 `cwds[id]` 不二次 clobber。**并置 pin 窗口**（dogfood-r3 修订，权威语义详
  `terminal-session-restore.md` 登记⑨修订）：原「最后写者胜」时序假设被晚到漂移 OSC7（在飞字节/异步 prompt
  插件重绘）打破——`noteInjectedCwd` 现同时置 pin（默认 5s），窗口内不匹配落点的 OSC7 忽略、匹配即解 pin、
  超时自动解除；主路径 OSC7 回调在无 pin 时行为完全不变。

## 6. SessionRegistry 策略

### 6.1 上限 20（TERM_L2_83 / PERF_L2_07）

- `SessionID → TerminalSession` 映射，创建入口唯一，**上限 `maxTerminalCount = 20`**（manager.ts:21 `MAX_TERMINALS=20`）。
- 第 20 个创建成功、第 21 个起拒绝。
- **文案**：用**冻结 spec 文案 `"已达最大终端数，请关闭不用的终端"`**——`TERM_L2_83`（`boundaries.spec.json` value20.expected.message，2026-07-02 亲验）已写死此串，是 spec↔test 1:1 的**测试 oracle**，@Test 必须断言它。拒绝走 `term.command` rejected{code:"maxReached", message} 用此串。**与 as-built legacy 码 `'最多支持 20 个终端'`（manager.ts:160）不同 = 仅知会**（非用户裁决——不存在真正的产品选择，改文案须动 status.json overlay note）。张力（核心原则一权威序「跑起来的老 app>旧代码」vs 冻结 spec oracle）显式记 overlay note，默认落冻结 spec 文案。见偏差发现⑤。
- 满员时 ui.state 快照 `maxReached==true`（PERF_L2_07）。

### 6.2 scrollback 全程 10000（用户已裁决；实现口径修订 2026-07-02 批1）

- **用户裁决（2026-07-02 M3 规划）：全程 10000 行**，不做「非可见缩到 1000 不可逆」。
- **实现口径修订（批1 实测发现）**：libghostty `GhosttyTerminalOptions.max_scrollback` 实为**字节预算**而非行数（ghostty 源码 Screen.zig/PageList.zig/Config.zig `scrollback-limit` 默认 10MB "in bytes" 三处实证；C 头注释 "number of lines" 不准）。合同改为 `ScrollbackPolicy.maxScrollbackBytes == 12 MiB`——保证 **≥10000 行 @80 列**（实测 12MiB→12041 行@80列；更宽终端行更「贵」，dogfood 常规窗宽下满足意图）。惰性分配，空闲会话不占预算。
- 承接 5 条 spec（批2 翻牌）：`TERM_L2_84/85/86`、`PERF_L2_03/10`。断言口径 = 灌 40000 行后 SCROLLBACK_ROWS **≥10000 且确有封顶**（<灌入量）+ 常量口径。overlay note：「用户裁决全程 10000（2026-07-02）；vendor max_scrollback 系字节预算（C 头注释误导），实现取 12MiB ≈ ≥10000 行@80列，断言按此口径」。
- ⑪ bench 关注项：scrollback 满载上限由旧口径 ~10000 字节（M0 探针误设，≈800 行）变为 12MiB/会话——`bench_mem_per_terminal`(<20MB 边际) 与 scrollback-fill 封顶行为须按新口径复测。

### 6.3 状态推送去抖（TERM_L1_06）

- `Running ↔ WaitingInput` 抖动去抖 `STATE_CHANGE_DEBOUNCE_MS = 50`（manager.ts:103）——防 yes/no 提示里上下键抖动刷屏。
- **终态豁免立即推**：`Stopped / Failed / Disconnected / Removed` 立即推（manager.ts:107 `immediate` 名单）；Stopping（关闭意图）本规格亦纳入立即推名单（§3.2）。
- 去抖时钟**可注入**（假时钟测 50ms 内多次变化只出最终一条，TERM_L1_06）。
- 事件流：轻量观察者（AsyncStream 多播或回调数组），对外事件统一 hop 到 main 派发（附件 A §2.1/§2.3）。
- **单帧合并（DOGFOOD_M3_09）**：**用户主动关闭**路径（§3.2 步骤5）观察到终态时，「更新态 + 移除 tile」合并为**单次立即推**（不先推死 tile 再推移除快照）——避免死 tile 闪一帧。**自发退出**（TERM_L1_07 直驱 `noteStateChange` 无先行 `close`）**不命中**合并、终态照常保留死 tile，TERM_L1_07「终态豁免立即推」口径**不变**（合并帧本身即一次立即推）。

## 7. 关停与崩溃孤儿

### 7.1 ShutdownStep 排序

- `shutdownSteps = [pty-close-all, wal-checkpoint]`（数组序即执行序，改 `AppDelegate.swift` ShutdownStep 注册一处）。
- `pty-close-all`：并行对全部会话走优雅关闭（§3.2），总限时 `max(单会话 grace)+缓冲`，超时会话直接 SIGKILL——**保证 checkpoint 前 PTY 全静默**。与 legacy `closeAll()`（立即硬杀，manager.ts:516）差异：新实现给优雅期再兜底强杀（偏差发现⑥）。

### 7.2 pty-children.json + orphan-pty-reaper

- spawn 成功即原子写 `{pid, 子进程启动时间}` 到 `Muxvo2 Dev/run/pty-children.json`（走 MuxvoStorage AtomicFile）；正常收尸时移除该条。
- 新增 StartupIntegrityCheck 步 `orphan-pty-reaper`：启动读文件，校验 **pid 存活且启动时间匹配**（防 PID 复用误杀），命中则 SIGHUP → 短 grace → SIGKILL，清文件。
- 兜底对象：app 崩溃时 master fd 随进程关闭、前台组本会收内核 SIGHUP；此检查兜「忽略 SIGHUP 的后台残留」。
- legacy 无此机制（新增）。SIGKILL 集成测试加**场景 5**：helper 起真会话落 pty-children.json → SIGKILL helper → 二次启动跑 reaper → 断言子进程被收割、文件清空（现有 4 场景不动）。

## 8. 偏差发现（本规格与 legacy 实况/附件冲突，以实况为准）

| # | 冲突点 | legacy 实况（行号） | 附件/设计说法 | 本规格取值 |
|---|---|---|---|---|
| ① | login shell 机制 | `['--login']` 参数（pty-adapter.ts:45） | 附件 A §2.2「argv[0] 前缀 `-`」 | ☆ 用 argv[0] `-` 前缀（通用，实验已验证 login 生效）；行为等价，记录差异 |
| ② | 终端 id | `term-<pid>`（manager.ts:174） | 计划 §4 native UUID | native UUID（PID 会复用、不稳定，UUID 全链路统一）——**有意变更** |
| ③ | COLORTERM | **未设**（pty-adapter.ts 全文无） | 附件 A §2.2「补 COLORTERM=truecolor」称『继承 legacy』 | 新增 COLORTERM=truecolor，但标注**新增非继承**（附件措辞不准） |
| ④ | 退出码→态 | onExit 恒 CLOSE+EXIT_NORMAL→Stopped，**不看码**；EXIT_ABNORMAL 是死转移（manager.ts:312-313） | 计划/TERM_L1_07「非0/信号→Disconnected」 | 按码分派 EXIT_NORMAL/EXIT_ABNORMAL（激活既有死转移）——**有意改进**，记录 legacy 从不这么做 |
| ⑤ | 上限文案 | `'最多支持 20 个终端'`（manager.ts:160） | 冻结 spec `TERM_L2_83` = `'已达最大终端数，请关闭不用的终端'`（测试 oracle） | 用**冻结 spec 文案**（非用户裁决）；as-built 码文案不同**仅知会** + overlay note 记张力（§6.1） |
| ⑥ | 关停杀法 | closeAll 立即硬杀无优雅期（manager.ts:516） | 计划 pty-close-all 优雅→SIGKILL | 优雅期+超时强杀——**有意变更**（checkpoint 前 PTY 静默更稳） |

## 9. M3 spec 桶断言映射（本规格承接部分）

| spec ID | 本规格承接节 | 断言要点 | owner |
|---|---|---|---|
| TERM_L1_01 create | §1 + 桥草案 term.command | {kind:create,cwd}→created{terminalId 非空, pid>0}（fake spawner） | swift |
| TERM_L1_04 close | §3 + 桥草案 term.command | {kind:close}→closed + 状态机进 Stopping | swift |
| TERM_L1_06 state-change | §6.3 | 状态变化→快照 state 更新；50ms 内抖动只出最终一条（去抖并测） | swift |
| TERM_L1_07 exit | §3.3 | exit(0)→Stopped；非0/信号→Disconnected，立即推 | swift |
| TERM_L2_83 max_terminal_20 | §6.1 | 第 20 个 created、第 21 个 rejected{maxReached,文案} | swift |
| PERF_L2_07 | §6.1 | 常量 maxTerminalCount==20 + 满员快照 maxReached==true | swift |
| APP_L2_06 | §3.2 | 注入短 grace：慢进程被强杀、快进程不被强杀（默认常量==5000ms） | swift |
| TERM_L2_31 trans_stopping_disconnected | §3.2 + §2.1 | 假时钟：Stopping 驻留 5s→TIMEOUT→Disconnected | swift |
| TERM_L2_84/85/86 + PERF_L2_03/10 | §6.2 | SCROLLBACK_ROWS==10000 封顶 + 常量口径 + 裁决 overlay note | swift |
| （SIGKILL 场景 5 / orphan-reaper） | §7.2 | 二次启动收割子进程、pty-children.json 清空 | swift |

> TERM_L1_02（write）/L1_03（resize）/L1_05（output 负向）断言原生 API 合同，落 `MuxvoTermTests` 真 PTY 集成，详见 terminal-input.md §承接 与桥草案 §term.command。TERM_L1_09/10/16-19（默认值）落 `MuxvoTermCoreTests`，见 terminal-rendering.md §默认值。

## 修订记录

- **2026-07-11（title-sync 批）**：§1.2 env 合同表补 `MUXVO_HOOK_SOCK` 行（多分身 hook socket 路由修复，wait-detector.md §4/修订记录同批条目）。注入层 = TerminalService 生产 configTemplate 的 extraEnv；对抗 MINOR-3 回修追加：该键入 EnvContract.deletedKeys 恒删继承值（嵌套 muxvo 防 worker/takeover 串线，详见表行）。加性新增，冻结主体不变。
- **2026-07-04（DOGFOOD_M3_09）**：用户反馈「开多个终端时关闭其中一个，有时点 ✕ 后延迟 ~2s 才关，有时点了关不掉需再点一次」。根因 = 两步关闭设计（确认后 tile 变死 tile、视觉几乎不变）+ Stopping 窗口内二次 ✕ 又弹确认（removable=false）+ 连点第二下落 backdrop 即取消，三机制叠加；「~2s」= SIGHUP 后前台 CC 子进程自清理耗时（固有，非硬编码常量）。三方对照：legacy 无死 tile 概念、任何进程退出 tile 即消失（manager.ts:380-421 close() + 310-330 全局 onExit `terminals.delete`，亲验）；REQ-TERM_LIFECYCLE-011/012 亦「确定后终端被强制收掉，无论命令是否还在跑」。用户裁决（直接生效）：①**用户主动关闭一步到位**（进程退出 tile 自动消失 + 关闭中变暗反馈 + ✕ 禁用）；②**自退保留死 tile**但加明显「已停止」标签。修订 §3.2 步骤5 + §2.2 REMOVE 行 + §6.3 单帧合并注记 + status.json TERM_L1_07 note（旧「终态快照保留不自动移除」被裁决①部分推翻——仅用户关闭路径自动移除，自退路径不变）。v1-frozen 主体不变，本条为增补留痕（教训：绝不静默改冻结 spec）。
- **2026-07-04（DOGFOOD_M3_12）**：用户反馈「终端内容间歇性只占左半宽、同屏窄/宽段交替」。log stream
  取证实锤：①僵尸 surface（宿主摘除不调 detach()）以陈旧 bounds 在字号广播/backing 链上驱动活会话
  resize（值变化即 SIGWINCH 烧窄段 + PTY 卡死无纠正）；②resize 全链零节流，拖动/窗口几何风暴逐帧
  TIOCSWINSZ 放大烧毁面。修订 §4 settle 增补行（本函数语义不变）；detach 契约与 settle 全语义见
  terminal-rendering.md §1.2 ☆。已烧窄段不可恢复。v1-frozen 主体不变，本条为增补留痕。
