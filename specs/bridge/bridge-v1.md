# 桥协议 v1（Swift ↔ WKWebView）

> 状态：**v1-frozen**（2026-06-11 检查点④通过：双独立裁判终审——约束一致性绿灯；可实现性仅 1 项 blocking（§8 汇总笔误 86→84）已修。依用户授权由独立 agent 裁决）。此后动台账（§4）= 改 `bridge/protocol.json` = CI 红区 + 重新评审。
> 2026-06-11 五视角对抗评审已回写：采纳并修订 nullable DSL（§6）、握手时序契约与 hello 幂等（§3）、protocolVersion 递增规则（§3/§7）、错误码界线（§2）、selftest 扩用例（§7）等；驳回拆 auth 槽、orch 拆槽、单字段 record 防御等 5 条（理由见评审会话记录）。
> 上游约束：REBUILD-PLAN M1「类型化消息 ≤15 条，CI 强制上限，编排面板预留约 4 条配额」+ 核心原则二「编排控制面走结构化通道，终端只给人看」。

## 1. 目标 / 非目标

**目标**：原生壳与 web 面板之间的全部通信走本协议；消息类型化（无字符串 payload）；总数有全生命周期预算（≤15），CI 硬强制。

**非目标**：
- 终端字节流**永不过桥**——高频流式文本逼迫 web 渲染管线正是老版病根，新版终端由 Metal 直渲（M0 已验证），web 只接收低频 UI 状态。
- 不做流式/二进制大负载通道（M5 聊天若遇分页瓶颈再评估 WKURLSchemeHandler，属实现细节不占消息槽）。
- M1 只激活 3 条消息（§5），其余 stub（handler 回 `UNIMPLEMENTED`）或 reserved。

## 2. 信封与错误形状

web→native（request 与 event 共用一条管道）：

```jsonc
// postMessage 入参（信封）
{ "v": 1, "type": "ui.action", "payload": { ... } }

// Promise resolve 值（回包；错误一律走结构化回包，不 reject——错误形状全协议统一）
{ "ok": true,  "payload": { ... } | null }
{ "ok": false, "error": { "code": "UNIMPLEMENTED" | "BAD_REQUEST" | "INTERNAL"
                                 | "UNAVAILABLE" | "VERSION_MISMATCH",
                          "message": "人类可读说明" } }
```

native→web 信封同形：`{ "v": 1, "type": "ui.state", "payload": { ... } }`。

- event 类消息（如 `ui.action`）：web 端不 await，native 立即回 `{ok:true, payload:null}`。
- 错误码界线：**台账内**（status = stub 或 reserved）→ `UNIMPLEMENTED`（reserved 消息的 handler 必须显式注册 UNIMPLEMENTED 应答，不得落入通用 default）；**台账外**（未知 `type`）→ `BAD_REQUEST`；payload 不符 schema → `BAD_REQUEST`。

## 3. 传输机制、握手、门控、节流

- **web→native**：`webkit.messageHandlers.muxvo.postMessage(envelope)`，native 侧 `WKScriptMessageHandlerWithReply`——每次调用天然返回 Promise，请求-响应关联交给 WebKit，**协议不需要自己的 id 字段**。
- **native→web**：`webView.callAsyncJavaScript("window.__muxvoBridge.receive(msg)", arguments:["msg": ...], in: .page)`——用 arguments 传值，绕开 evaluateJavaScript 字符串拼接转义坑。
- **contentWorld**：handler 注册与 receive 注入必须同在 `.page` world（web 代码要在主世界安装 `window.__muxvoBridge`）。
- **握手（时序契约）**：web 端必须**先安装 `window.__muxvoBridge.receive`，再发 `bridge.hello`**（client.ts 模块内顺序保证）——native 收到 hello 即可安全 flush，不存在 receive 悬空竞态。native 在 hello 应答前缓冲所有 push（FIFO），应答后按序 flush。
- **hello 幂等可重入**：任何时刻收到新 hello = 重新握手（清空未 flush 队列、应答后立即补推一条最新 snapshot）。这同时覆盖两种 Vite 场景：整页刷新（`webView(_:didCommit:)` 重置握手门）与**模块热替换**（页面不重载、didCommit 不触发——bridge 模块热替换后重新初始化、重发 hello 即可恢复）。
- **版本**：双侧类型 codegen 自同一 commit，正常不漂移；hello 带 `protocolVersion`，不等则回 `VERSION_MISMATCH`，web 显示错误横幅。**递增规则：`bridge/protocol.json` 的任何改动（含 payload schema 字段级变更）都必须递增 `protocolVersion`**——schema 漂移因此必然显形为版本不匹配，而非静默 decode 失败（CI 检查见 §7 第 5 条）。
- **节流**：`ui.state` 在 push 队列内合并——队列里已有未发出的 snapshot 则就地替换只保留最新（M0 设计输入②「dirty 驱动而非每帧」在桥层的体现）。**snapshot 语义 = 最新态完全覆盖**：web 渲染必须是 snapshot 的纯函数，不得依赖中间态序列——被合并跳过的中间态不构成正确性问题。所有桥操作在主线程。
- **截图契约隔离（铁律）**：`?screenshot=1` 时 web 端 bridge 代码路径一行不执行（不装 receive、不发 hello、无 import 副作用）；`__loadFixture`/`__fixtureReady` 契约与视觉回归流水线零感知。

## 4. 消息台账（15 槽全生命周期分配）

≤15 的正确解读：**整个产品生命周期**的协议预算。按域聚合，加动作 = payload 内 tagged union 加分支（不占槽）；加消息 = 动本台账（CI 红区）。

| # | type | 方向 | 模式 | 激活 | M1 状态 | 吸收的老 channel 域 |
|---|---|---|---|---|---|---|
| 1 | `bridge.hello` | web→native | request | M1 | **active** | APP 的 ready/版本类 |
| 2 | `ui.state` | native→web | push | M1 | **active** | TERMINAL 状态推送侧、CONFIG 主题、APP 窗口/导航态 |
| 3 | `ui.action` | web→native | event | M1 | **active** | 全部 UI 交互动作（点击/选中/拖拽/重命名/确认等待…） |
| 4 | `term.command` | web→native | request | M3 | stub | TERMINAL 操作侧（create/close/zoom/sendText…） |
| 5 | `chat.request` | web→native | request | M5 | stub | CHAT 读写路径（**激活前置**：先定分页契约——游标式，对标 25K 消息搜索 p99<500ms KPI） |
| 6 | `fs.request` | web→native | request | M6 | stub | FS 读写/watch + WORKTREE |
| 7 | `config.request` | web→native | request | M6 | stub | CONFIG + APP 偏好 + AUTH 全部账号操作 |
| 8 | `app.request` | web→native | request | M2+ | stub | APP 杂项（原生面板/菜单/更新操作/reveal…） |
| 9 | `data.event` | native→web | push | M5/M6 | stub | CHAT/FS/CONFIG/AUTH/更新 的数据变更通知（payload 带 domain tag） |
| 10 | `app.telemetry` | web→native | event | M2+ | stub | ANALYTICS + PERF 批量上报 |
| 11 | `orch.command` | web→native | request | M4a | **reserved** | （新功能）create_task/approve/cancel/retry |
| 12 | `orch.state` | native→web | push | M4a | **reserved** | （新功能）任务列表/状态机——与 ui.state 同模式：`kind=snapshot\|delta` 双分支不占槽，delta 一对一映射 task_events.seq |
| 13 | `orch.transcript` | native→web | push | M4a | **reserved** | （新功能）worker 实时转写流 |
| 14 | `orch.query` | web→native | request | M4a | **reserved** | （新功能）任务历史/审计日志读取 |
| 15 | —— | | | | 空余 | 头寸；动用需改 protocol.json 走台账评审 |

**status 流转规则**：`reserved → stub → active` 只能经修改 `bridge/protocol.json` 发生（git 可审）；reserved 的 4 条 orch 消息是编排面板配额，非 orch 消息不得占用（CI 断言非 orch ≤ 11）。

**台账变更粒度**：CI 以 protocol.json 的任何 diff 为「动台账」信号（工具不区分注释性改动）；是否豁免由 PR reviewer 判断。

与 A 路初稿的差异记录：`chat.query` 更名 `chat.request`（该消息含 delete/rename/restore 等写操作，"query" 名不副实；与 #6/#7/#8 动词统一）。

## 5. M1 三条激活消息的 payload schema

### 5.1 `bridge.hello`（request）

```jsonc
// req
{ "protocolVersion": 1, "webBuild": "dev" }
// resp.payload
{ "protocolVersion": 1, "appVersion": "0.1.0", "active": ["bridge.hello","ui.state","ui.action"] }
```

`active` = 当前已注册 handler 的消息名，web 据此降级（stub 消息不发起调用）。

### 5.2 `ui.state`（push）

```jsonc
{ "kind": "snapshot", "state": UIState }
```

`kind` 为 tagged union 判别字段；`"patch"` 分支预留（M2 全量推送过重时加分支，不占槽）。**UIState v1 ≡ web 现有 `Fixture` 类型**（`web/src/fixture/types.ts`，逐字段进 protocol.json）：

```ts
UIState {
  id: string; desc?: string;
  theme: "dark" | "light";
  homePath: string;
  viewMode: "Tiling" | "Focused";
  focusedId: string | null; selectedId: string | null; activeSidebarId: string | null;
  maxReached: bool;
  dragging: string | null; dragOver: string | null;
  editing: { id: string; value: string } | null;
  waitingNotification: { count: int } | null;
  terminals: TerminalSnapshot[];
  palette: { background: string; foreground: string };
}
TerminalSnapshot {       // ≡ TerminalFixture
  id: string;
  state: "Created"|"Starting"|"Running"|"Busy"|"WaitingInput"|"Stopping"|"Stopped"|"Disconnected"|"Failed"|"Removed";
  cwd: string;
  customName?: string; isGitRepo?: bool; worktreeRegistered?: bool;
  content?: ContentLine[];   // M1 demo 用静态内容；M3 起内容区由原生直渲，此字段仅服务复刻/截图
}
ContentLine = ContentSegment[];  ContentSegment { t: string; hex?: string }
```

**nullable vs optional（两种 DSL 语义，见 §6）**：`focusedId / selectedId / activeSidebarId / dragging / dragOver / editing / waitingNotification` 为 **nullable**（字段必在、值可为 null，JSON 形如 `{"focusedId":null}`）；`desc / customName / isGitRepo / worktreeRegistered / content` 为 **optional**（字段可缺）。codegen 双侧必须按此区分生成，两者序列化形态不同。

**state 严格性**：桥上传输的 `state` 必须是 10 枚举之一（协议侧严格）；web 现有的 `TerminalState | string` 宽松型仅作为 types.ts 内的本地别名保留（供 fixture 注入容错），不进协议。

protocol.json 成为 Fixture 的权威定义；`web/src/fixture/types.ts` 改为 re-export + 上述本地宽松别名（编译期处理，运行时零变化，视觉回归不受影响）。

### 5.3 `ui.action`（event）

tagged union，判别字段 `kind`。M1 只生成一个分支：

```jsonc
{ "kind": "tileClick", "terminalId": "t1" }
```

M2 预计分支（文档列出、不生成）：sidebarSelect / renameSubmit / dragMove / dragDrop / fabClick / closeTile / maximizeTile / acknowledgeWaiting。

## 6. 类型单一来源与 codegen

- **来源**：`bridge/protocol.json` = 消息台账（name/direction/pattern/status/milestone）+ 全部 payload 类型定义。
- **生成器**：`bridge/codegen.mjs`（零依赖 node ESM），输出两个文件**提交入库**：
  - `app/Sources/MuxvoBridge/Gen/Protocol.swift`（Codable struct/enum；tagged union 生成自定义 init/encode）
  - `web/src/bridge/gen/protocol.ts`（interface + 判别 union）
  - > 修订（2026-07-05 批4.6 拆分裁决 A 案）：Swift 侧改按消息域多文件输出——`Gen/Protocol.swift`（桥元数据）+ `Gen/Protocol+<域>.swift`（跨域共享类型落 `Protocol+Shared.swift`），分区规则见 `bridge/codegen.mjs` 头注释；TS 侧维持单文件。仅输出组织变化，DSL 八项冻结清单零触碰。
- 两侧**永不手写**消息类型；CI 重跑 codegen 与提交版 diff，非空即红。
- **DSL 特性冻结清单**（超出即触发协议评审，防生成器膨胀）：
  原始类型 `string | int | double | bool`；可选字段 `?`（JSON 中字段可缺）；**nullable（字段必在、值可空——与 `?` 是不同语义，序列化形态不同）**；数组；字符串枚举；record（命名字段对象）；tagged union（判别字段固定为 `kind`；**单分支 union 同样生成 kind 判别字段**，与多分支序列化形态一致）；类型引用（允许指向 union，嵌套不限深度）。**仅此八项。**

## 7. CI 强制方案

`node bridge/codegen.mjs --check`（计数点唯一 = protocol.json）：
1. `messages.length ≤ 15`，超出 exit 1 并打印全表；
2. 非 `orch.` 前缀消息 ≤ 11（4 条编排配额是硬约束）；`status:"reserved"` 且 `orch.` 前缀的恰为 4 条（后半句是 M1 期不变量——M4a 激活 orch 消息时随同一次台账评审同步调整该断言）；
3. 每条消息 payload 必须引用命名类型（拒绝裸 `string`/`any`——落实「无字符串 payload」）;
4. codegen 漂移：重新生成与提交版 diff 非空即红；
5. 版本递增：protocol.json 相对 git HEAD 有 diff 但 `protocolVersion` 未递增 → 红（对未提交改动生效，即 preflight 主闸场景；远端 Actions 若要等效需对比 merge-base/前一 commit，实现时注释说明）。

`--check --selftest`：内存构造反例逐一断言必红——红灯路径每次 preflight 都自验，不靠手工演示。用例六个：①16 条总数 ②12 条非编排 ③裸 string payload ④类型循环引用（须报错而非死循环）⑤定义但未被引用的死类型（警告）⑥union 分支 kind 值重复（报错）。

纵深防御：`MuxvoBridgeTests` 断言 `BridgeMessageType.allCases.count ≤ 15`（抓绕过 codegen 手改 Gen 文件的路径）。

落点：本地 `scripts/preflight.sh` 必跑；GitHub Actions ubuntu job 每次 push 跑（秒级）。

## 8. 附录：老 107 channel 逐条归宿表

四分类：`→#N` = 并入消息 #N 的 union 分支；`native` = 新架构原生内部事务不过桥；`n/a` = Electron 特有无对应物；`deferred` = M7 后再议。

### TERMINAL（18）

| channel | 归宿 | 说明 |
|---|---|---|
| terminal:create | →#4 | M3 |
| terminal:write | native | 人键入由原生终端视图直达 PTY |
| terminal:resize | native | 原生视图布局直接驱动 winsize |
| terminal:close | →#4 | M3 |
| terminal:output | **native** | **病根修复点：高频输出 Metal 直渲，永不过桥** |
| terminal:state-change | →#2 | 状态推送 |
| terminal:exit | →#2 | |
| terminal:get-foreground-process | native | WaitDetector 内部 |
| terminal:list | →#2 | 快照携带 |
| terminal:get-state | →#2 | |
| terminal:get-buffer | native | 渲染层/scrollback 原生事务 |
| terminal:update-cwd | →#2 | |
| terminal:cwd-changed | →#2 | |
| terminal:list-updated | →#2 | |
| terminal:acknowledge-waiting | →#3 | M2 分支 |
| terminal:set-name | →#3 | renameSubmit |
| terminal:zoom | →#4 | 字号是渲染参数，命令过桥、渲染原生 |
| terminal:debug-log | n/a | Electron 调试通道 |

### FS（10）

| channel | 归宿 | | channel | 归宿 |
|---|---|---|---|---|
| fs:read-dir | →#6 | | fs:select-directory | →#8（原生面板） |
| fs:read-file | →#6 | | fs:write-temp-image | →#6 |
| fs:write-file | →#6 | | fs:write-clipboard-image | →#6 |
| fs:watch-start | →#6 | | fs:show-file-menu | →#6（v9 改归，原 →#8；偏差登记见 §9） |
| fs:watch-stop | →#6 | | fs:change | →#9（fs domain） |

### CHAT（15）

get-projects / get-sessions / get-session / search / export / get-archive-enabled / set-archive-enabled / delete-session / set-session-name / restore-session → **#5**；
session-update / sync-status / archive-progress → **#9**（chat domain）；
show-session-menu / reveal-file → **#8**（原生菜单 / Finder）。

### CONFIG（8）

get-resources / get-resource-content / get-settings / save-settings / get-claude-md / save-claude-md / get-memory → **#7**；resource-change → **#9**（config domain）。

### APP（21）

| channel | 归宿 | 说明 |
|---|---|---|
| app:get-config / save-config / get-preferences / save-preferences | →#7 | 偏好并入 config |
| app:memory-warning | →#9 | update domain 邻座：M7 批4 激活为 data.event `memoryWarning{currentMemoryMB, threshold, message}`（协议 v40）；原 deferred「新版内存治理 M7 再议」兑现 |
| app:detect-cli-tools | →#8 | |
| app:update-checking / update-available / update-not-available / update-downloading / update-downloaded / update-error | →#9 | update domain 推送（M7） |
| app:check-for-update / download-update / install-update / get-release-notes | →#8 | M7 |
| app:zoom | native | 面板缩放由原生菜单驱动 WKWebView |
| app:close-requested / confirm-close / cancel-close | native | 关窗确认是原生对话框，无需绕 web |
| app:open-workspace-manager | →#2 | 原生菜单触发面板导航，经 ui.state 路由字段（M2 定） |

### DISCOVERY（11，Skill 市场——已退役）

fetch / get-detail / search / install / uninstall / get-installed / publish / unpublish / install-progress / publish-progress / packages-loaded → **retired**（2026-07-12 用户拍板 Skill 市场不做，PRODUCT-PLAN D5 裁决，决策报告 `~/Desktop/muxvo-skill商城决策报告-20260712.md`；原「deferred，M7 设计市场时定」归宿作废。若远期 fast-follow 复活，重走台账评审）。

### AUTH（14，登录——2026-07-13 用户拍板回归 V1，右上角批实装）

〔2026-07-12 D5 裁决〕登录随 Skill 市场移出 V1、降级 fast-follow；下列归宿映射**保留备届时复用**，V1 不实现。
〔2026-07-13 修订，右上角批〕用户明示 D5 的「移出 V1」仅指 Skill 市场，**登录本体要完整实现**——本表激活。
归宿微调：请求面由 **#7 → #8 app.request**（v33）。理由=异步约束：#7 config.request 的 composite 接线是
同步闭包（`(ConfigRequest) -> ConfigResponse`，保 ConfigRequestHandler 同步纯度），auth 必然异步（网络）；
#8 的 onAppRequest 已是 async 全链。槽位语义不变（union 变体零新增顶层消息），「宿主能力」语义成立。

login-github / login-google → **#8** `authLoginOAuth{provider}`；login-password → **#8** `authLoginPassword`；
register → **#8** `authRegister`；send-email-code → **#8** `authSendEmailCode{purpose}`；
reset-password → **#8** `authResetPassword`；logout → **#8** `authLogout`；get-status → **#8** `authStatus`；
get-profile / refresh-token → native 内部（AuthManager 启动恢复/12min 定时刷新，不过桥）；
verify-email-code → 不做（legacy EmailLoginForm 为 UI 不可达孤儿，验收范围=UI 可达交互）；
auth:oauth-callback → native（**轮询 /auth/poll 交付**——legacy 服务器实践不发深链重定向，深链不做；结果经 #9 推送）；
session-expired / status-change → **#9** `authSessionExpired` / `authStatusChanged{auth}`。

### ANALYTICS（3）+ PERF（1）

analytics:track / get-summary / clear、perf:log → **#10**（批量上报 + 查询分支）。

### WORKTREE（6）

worktree:list / create / remove / rename / detect-repo / pre-check → **#6**（git worktree 属文件系统域）。
v9 实况：detect-repo+pre-check+list 合并为一个 `worktreeStatus` 变体（一次往返）；create/remove 各自成变体；
**rename 缓议**（legacy UI 无入口，纯预留能力——不占 schema，需要时加变体不占槽）。

**汇总**：→#2~#10 共 85 条；native 10 条；n/a 1 条；retired 11 条（DISCOVERY，2026-07-12 D5 市场不做）；deferred 0 条（原 memory-warning 于 M7 批4 激活并入 →#9）。85+10+1+11+0 = 107 条全部有归宿，此表即迁移进度表的桥侧投影。

## 9. 版本变更登记（v9 起登记；此前版本经 protocol.json git 历史追溯）

### v9（2026-07-06，M6 批0「config.request / app.request / data.event 激活」）

M6 批0 先合 main 取得 v9 号段（串行规则：先到先合）：#7 `config.request`、#8 `app.request` stub→active（Config/App 域类型入库），#9 `data.event` stub→active（payload=`DataEvent` union，首分支 `configResourcesChanged{resourceType}`）。台账材料见 `logs/m6-batch0-protocol-review.md`（本登记行由 M5 合并窗口补录）。

### v10（2026-07-06，M5 批0「Chat 历史读写 + 数据变更推送 chat 分支激活」）

一次 bump 覆盖全部改形（原批内号段 v9，与 M6 批0 撞号后按串行规则改 v10 合入），消息数 **14/15 不变**（未动 #15 空槽，chat.request 激活零新增槽）；非 orch **10/11**；orch 恰 4 全 active（编排配额不变量）。

1. **#5 `chat.request` stub→active**：payload = `ChatRequest`/`ChatResponse`（均 union）。吸收 §8 CHAT 表读路径 get-projects / get-sessions / get-session / search / export。
   - **分页契约（激活前置，§4 台账要求）= 游标式**：`sessions.nextCursor?` 缺席=已到末页；`session{before?}` 缺席=取最近一页、`messages.prevCursor?` 缺席=已到会话开头（向更早翻页）。对标 25K 消息搜索 p99<500ms KPI。
   - **`sessions{projectHash?}` 缺席 = 全部项目**：即老版魔法串 `"__all__"` 的类型化翻译（用 optional 缺席表达「不限项目」，不再靠哨兵字符串）。
   - `ChatResponse.rejected{code,message}` 用 string code（`OrchCommandResponse` 先例，具体码值 native 实装时定，走域内不占槽）。
   - **本次未激活的 CHAT 写操作**：§8 列入 #5 的 get-archive-enabled / set-archive-enabled / delete-session / set-session-name / restore-session 未纳入本轮 `ChatRequest` 变体（M5 范围按需）；后续需要时作 `ChatRequest`/`ChatResponse` 的域内 union 分支追加，**不占新槽、仍在 #5 内**。
2. **#9 `data.event`（v9 已 active）+= 两 chat 分支**：在 M6 v9 所建 `DataEvent` union 上追加 `chatSessionUpdate{projectHash,sessionId}`（会话文件变更通知，触发 web 重取）/ `chatSyncStatus{status:ChatSyncStatus, lastSyncMs?}`（镜像/同步态推送）。吸收 §8 CHAT 表 session-update / sync-status。域 tag 即 variant kind，不占槽（与 v9 `configResourcesChanged` 同一 union 并存，正是 #9 的设计归宿）。archive-progress 暂未纳入（M5 无归档进度 UI 需求时再加）。
3. **`PanelMode` += `chatHistory`**（现 terminal / taskCenter / chatHistory）——聊天历史面板导航态，与 taskCenter 同为 optional 面板模式（缺席=terminal，既有 fixture/golden 零波及，panelMode 先例）。
4. **`ui.action` += `chatClose` / `chatJumpToTerminal{sessionId, cwd?}` / `chatResume{sessionId, cwd, source, customTitle?}`**——聊天历史面板三交互动作（关闭面板 / 跳到对应终端 / resume 该 session 起真终端）。均 web→native event。
5. **`ChatSessionView` += `archiveOnly?: bool`（缺席=false）**——批 0 对抗回修补 wire（规格面 MAJOR-5）。语义：会话**仅存在于镜像归档、CC 原文件已删，不可 resume**（legacy `chat.types.ts:49` 同名字段）。此前批内首版遗漏该字段，导致 archive-only 会话（source=CC、有 cwd）会误显「继续聊天」按钮、点击 resume 因原文件已删而失败。
   - **号段落定记录**：本批开发期号段 v9，合并窗口发现 M6 批0（config/app/data 激活）已先合 main 取走 v9 → 按串行规则本批改 **v10** 合入（DataEventPush 类型名让位于 main 已有的 `DataEvent`，两 chat 分支并入其 union）。遗留：`m6a/tile-buttons`（fs.request 激活，f678929 未合）后到方需按同规则取 v11 并重生成双侧。

### v11（2026-07-06，M4a 收官验收现场缺陷批「删除任务行」——轨1 主树直改）

**#11 `orch.command` 的 `OrchCommandRequest` union += `deleteTask{taskId}`**（软删归档，`task-center-panel.md` §3 r13）。域内 union 变体追加，**不占新槽、消息数 14/15 不变**；非 orch 10/11、orch 恰 4 全 active 不变。
   - **号段落定记录**：v11 原为 `m6a/tile-buttons`（fs.request，f678929 未合）预定——按串行规则「先到先合」，本批主树直改先合取 **v11**；**轨2 后到方改取 v12** 并重生成双侧（v10 登记行的遗留注记随之更新）。

**语义约定（codegen 不强制，实装/评审共识）**：
- **`ChatMessageView` 的 `text?` 与 `blocks?` 恰一存在**（互斥，非同缺同在）：纯文本消息用 `text`，含工具调用/图片的富消息用 `blocks: [ChatContentBlock]`。DSL 无「恰一」约束能力，靠 native 组装侧保证、消费侧按此假设渲染。
- **`ChatContentBlock.toolUse.inputJson` / `toolResult.resultJson?` = 任意 JSON 原文串过桥**（`TranscriptFullLine.raw` 先例）：不在协议里展开工具入参/结果的异构结构，字符串承载原始 JSON，web 侧按需解析。
- **`ChatSource` enum = `claudeCode | codex`**：M5 用户拍板**砍 gemini**（原三选一收敛为二）；后续里程碑若恢复 gemini 支持，作 `ChatSource` 加枚举值（enum 加值不占槽）。注意与既有 `HarnessKind`（orch 域）值域重合但**刻意分立为两个类型**——聊天历史来源标注与编排 harness 选择是不同消费面，不复用同一 enum 以免耦合两域演进。
- **时间戳统一 `int` 毫秒**（`*Ms` 后缀，`orch` 域 `updatedAtMs` 先例）：`lastActivityMs` / `startedAtMs` / `lastModifiedMs` / `tsMs` / `lastSyncMs` 全为毫秒整数。
- **`ChatSource` camel↔kebab 映射由批4 web 适配器承担**（回修 MINOR-1）：桥 wire 一律 camelCase（`claudeCode` / `codex`，enum 命名纪律）；但 fixture 消费面 `ChatHistoryScreen` 判 `session.source === 'claude-code'`（kebab）。批4 Live→fixture 适配器负责 `claudeCode → 'claude-code'`（codex 恒等），native 与协议侧不外泄 kebab。
- **`ChatSessionView.source` 缺席 ⇒ web 默认 `claudeCode`**（回修 MINOR-3）：source optional，缺席合法；消费侧遇缺席按 CC 处理（screen 现有默认 `absent → 'claude-code'`）。与之不对称的是 `ui.action.chatResume.source`（**必填**）——resume 时来源已由消费面确定，不允许缺。
- **`toolUse.inputJson` / `toolResult.resultJson` 由批4 web 适配器 `JSON.parse` 后喂 screen**（回修 MINOR-2）：wire 是 JSON 原文串（见上「任意 JSON 原文串过桥」约定）；而 screen 的 `ToolCallBlock` 期待**已解析对象**做 key/value 渲染。批4 适配器必须 `JSON.parse(inputJson) → input` 再交 screen，否则工具调用退化为「JSON 的 markdown」→ CHAT golden 视觉回归。
- **`ChatMessageView.text?` / `blocks?`「恰一存在」不变量的测试面归属 = 批1 native 组装单测**（回修 MINOR-5）：DSL 无「恰一」约束能力（允许 neither/both），both 或 neither 都会静默劣化渲染；批1 native 组装侧断言「恰一存在」，占住该不变量（消费侧按此假设渲染）。
- **`archiveOnly` 与 `canResume` 的关系**：`!archiveOnly` 是「继续聊天」（resume）的前置条件之一（与 `source ∈ {claudeCode, codex}`、有 `cwd` 并列）；archiveOnly 会话即便 source=CC、有 cwd 也**不可** resume。canResume 的完整判定归消费面（chat-history 规格 §7.7 / 批4 web），本协议只保证 wire 承载该布尔位。
- **归档 banner 开关/关闭钮 M5 live 无写通道**（回修 MINOR-4）：screen 渲染的归档 banner checkbox（`archiveEnabled`）与关闭钮在 M5 无 `chat.request` 变体、无 `ui.action` 承载（get/set-archive-enabled 已移出本轮 `ChatRequest`，见本节 v9 item 1）。故 M5 内该控件为**只读展示或纯本地 localStorage 行为**，持久化写通道按需后加——最终形态批4 依 `chat-history.md §7` 定。

**Swift 分区结果**（首次产出 `Protocol+Shared.swift`）：`ChatSource` 同时可达自 `ui`（chatResume）与 `chat`（ChatSessionView）两域 → 归 `Protocol+Shared.swift`；`ChatSyncStatus` + `DataEvent` 仅 `data` 域 → `Protocol+Data.swift`；其余 chat 类型 → `Protocol+Chat.swift`。

### v14（2026-07-07，M6 批A「终端 tile 两按钮功能开放」；批内原号 v9，合并窗口三方撞号后按串行规则改 v14）

一次 bump 覆盖全部改形，消息数 14/15 不变（未动 #15 空槽）：

1. **#6 `fs.request` 增 5 变体**（该消息已由 M6 批2 以 writeTempImage/writeClipboardImage 激活；本批为
   union 加分支不占槽）：readDir / showFileMenu /
   worktreeStatus（detect+preCheck+list 合一发）/ worktreeCreate / worktreeRemove。要点：readDir 恒返全量
   含 dotfiles 不排序（呈现策略归 web）；空目录=dir{[]}、无权限=rejected{PERM_DENIED} 两态分明；单层
   >5000 截断置 truncated；warning 只传 sizeMB（横幅文案 web 拼），rejected.message 由 native 拼好；
   非 git 仓库是数据不是错误（worktreeStatus{isRepo:false}）。rejected.code 用 string（OrchCommandResponse
   先例）：NOT_FOUND / PERM_DENIED / NOT_DIR / NOT_GIT_REPO / NESTED_WORKTREE / TIMEOUT / GIT_ERROR / INTERNAL。
2. **`ui.action` += fileOpen{terminalId} / fileClose / setShowHiddenFiles{value}**；
   **`UIState` += filePanel?（FilePanel{terminalId}）/ showHiddenFiles?**——文件面板开关态 native 拥有
   （searchBar 范式；⌘E 键焦点常驻 Metal 终端时必须 native 拦）；两字段 optional 而非 nullable：缺席=关闭/false，
   既有 fixture/golden 零波及（panelMode 先例）。worktree 浮层开关态 web 本地（closeConfirm 范式），不进 UIState。
3. **`term.command` += insertText{terminalId,text} / inserted{terminalId}**（#4 台账描述本含 sendText，域内非偏差）；
   shell 转义在 web 侧（insertText 保持「当用户键入写进 PTY」通用原语）。
4. **归宿偏差一处**：`fs:show-file-menu` 原 →#8 app.request，改归 →#6 fs.request。理由：菜单主语是文件路径
   （复制路径/Finder 定位/默认应用打开），域内聚 fs；避免为一个菜单动作激活 #8（评审面翻倍）；#8 留给 M7
   app 杂项批量激活。
5. **信任边界假设**：fs.request 赋予 web 面板任意路径读目录/弹菜单能力——面板是 bundle 内自有前端
   （muxvo-asset scheme 只服务 bundle 目录），非外部内容。
6. reorder 拖拽修复**不动协议**（dragPhase 否决）：真机取证终案 = web 侧 setDragImage 禁用令（WKWebView
   对游离元素快照失败杀会话）+ planReorder 方向感知插入（纯 dropBefore 向右拖差一位）；拖拽期全窗
   DragIsland 岛照挂（防洞区吞 dragover 的纵深防线），文件拖入终端复用。详见失败案例库
   2026-07-07-wkwebview-setdragimage-kills-drag-session.md。
### v15（2026-07-07，M6 主题批 2.5-B「终端配色 terminalThemeName」；批内原号 v13，合并窗口撞号后按串行规则改 v15）

**`ConfigSnapshot` += `terminalThemeName: string`（非可选）、`PrefsPatch` += `terminalThemeName?: string`（可选）**——终端 5 套配色名（`dark`/`light`/`monokai`/`dracula`/`solarized-dark`）持久化字段 `config.terminal.themeName` 的 wire 映射（出处 `specs/behavior/terminal-theme.md` 4d7e8cd §1/§4）。均 Config 域 record 加字段，**不占槽、消息数 14/15 不变**；非 orch 10/11、orch 恰 4 全 active 不变。

- **取 `string` 而非 codegen enum 的裁决（本批唯一偏离任务书处）**：主题名 `solarized-dark` 含连字符，codegen DSL enum 值须匹配 `^[A-Za-z][A-Za-z0-9]*$`（§6 冻结 DSL，无连字符）→ 做不了忠实 enum；且冻结 `settings-modal.md:70` 已把设置外观区下拉 5 选项值钉为字面 `dark/light/monokai/dracula/solarized-dark` 且「下拉当前值 = config.terminal.themeName」，`terminal-theme.md §1` 又是「未知/损坏名回退 dark」开集语义。故 `string` 字段最忠实两冻结规格、零边界映射（wire == persisted == 内部 name），比 camelCase enum + 边界翻译更少表示层。未知名解析回退 `dark` 由 native `TermTheme.named` 兜底（协议侧不设 closed enum 拒绝态，契合开集语义）。
  - snapshot 侧经 `TermTheme.named(themeName).name` 归一（过时/损坏名 → `"dark"`）；patch 侧 **UI 单选择器双字段直存**（R1 修订，取代原「智能跟随/花样粘住」）——设置外观区单个「主题」下拉一次 `set` 同带 `theme` + `terminalThemeName`，native `applyPatch` 按值直存两字段（`theme` 由 web 端按「选中===light?light:dark」预派生，native 不再联动计算）。**原 `TerminalThemeFollow.resolve` 纯函数随 §4 废止删除**（Swift agent 域）。
  - **`config.request` 的 `set` 应答维持 `.snapshot(当前完整 config)`**（非 `.saved`）：回传权威完整 snapshot 令 web 拾取校正下拉显示值（controlled select 绑 `terminalThemeName`）。R1 后该 snapshot 不再含跟随副作用，纯为「直存后回读权威值」。
- **号段落定记录**：批内基于 v12 编为 v13；合并窗口 main 已至 **v14**（M6 批A v14 见上），按串行规则重编 **v14→v15** 并重跑 codegen。web 侧下拉 option 值即 spec 5 名（含带连字符的 `solarized-dark`），无额外 camel↔kebab 适配。

### v16（2026-07-07，M6 批B「tab 式文件视图」；原取 v15 被主干占用，合并窗口重取，先到先合）

一次 bump 覆盖读写两能力，消息数 14/15 不变（未动 #15 空槽），非 orch/orch 计数不变量不变（非 orch 10、orch 恰 4 全 active）：

1. **#6 `fs.request` += `readFile{path, encoding?}` / `writeFile{path, content, baseMtimeMs?}`**（该消息已由 M6
   批2/批A 激活，union 加分支不占槽）；**`FsResponse` += `fileContent{content, encoding, truncated?, mtimeMs}` /
   `fileWritten{mtimeMs}`**。要点：
   - **readFile**：`encoding` 缺省 utf8，仅字面 `"base64"` 走二进制整读（其余含未知串按 utf8——`string`
     承载而非 enum，与 resp 侧 `encoding: string` 对齐、不新增类型）。utf8 >2MB 只读前 2MB 且置 `truncated:true`
     （截断处回退到合法 UTF-8 边界，最多丢末 3 字节）；base64 >20MB → rejected `TOO_LARGE`（不截断）。
     `mtimeMs` 由 native `PosixStat` 取**整数毫秒**（= JS `Math.floor(mtimeMs)`，双跑对齐先例）。
   - **writeFile**：`baseMtimeMs` 非缺 = 条件写（文件不存在→`NOT_FOUND`；实际 mtime ≠ base→`MTIME_CONFLICT`）；
     缺席 = create-or-overwrite（冲突「覆盖」路径）。native 在**同一 fs.io 串行队列**上先 stat 后写消 TOCTOU；
     既存文件**就地** truncate+write（保 inode/权限/硬链接：外部工具持 fd/watch 时 inode 稳定优先于原子替换，
     且 ≤2MB 文本写入窗口极小），不存在则创建；写后再 stat 回 `fileWritten{mtimeMs}`。
2. **rejected.code 复用既有 `rejected{code:string, message}`**（v14 先例，无新变体）：新 code 串
   `MTIME_CONFLICT` / `TOO_LARGE` / `NOT_UTF8` / `IS_DIR`；`NOT_FOUND` / `PERM_DENIED` 沿用既有串。message 由 native 拼好。
3. **`mtimeMs` / `baseMtimeMs` 用 `int` 原语**（`FsEntry.size` / 时间戳统一 `int` 毫秒先例，见本节 v9 约定）：
   Swift 侧 `Int`（64 位平台无损承载 `PosixStat.Int64` mtime），wire 为 JSON number。
4. **批B web tab 状态机/视图开关态为 web 本地**（closeConfirm 范式，规格 §6）：无新 `ui.action` / `UIState` 字段；
   ⌘S/⌘W/⌘/ 实作为 **web document 监听、未加 native 菜单项**（终端 tab 聚焦=焦点在 Metal 洞时两键均为规格
   no-op，native 拦无增益；见 specs/behavior/file-tabs-view.md 实施勘误注记 a，对抗验收独立评估成立）。
5. **信任边界假设（延伸 v14 item5）**：`writeFile` 赋予 web 面板**任意路径写**能力——论证与读侧同源（面板是
   bundle 内自有前端，muxvo-asset scheme 只服务 bundle 目录，非外部内容），写路径同读侧不设白名单。写侧风险
   增量（改坏文件）由两道约束收窄：写动作仅由用户显式保存（⌘S/对话框按钮）触发、无自动写路径；条件写默认带
   `baseMtimeMs`（D3 mtime 比对），盲覆盖仅在用户确认「覆盖」后发生。
6. **Swift 分区无变**：`readFile`/`writeFile` 及 `fileContent`/`fileWritten` 类型仍随 `FsRequest`/`FsResponse`
   归 `Protocol+Fs.swift`（fs 域单一可达）；无新跨域共享类型。

### v17（2026-07-08，M5-R1 批2「聊天历史删除/改名/全量加载/顶部 tab/自动归档开关 + 归档进度帧」）

一次 bump 覆盖全部改形，**全部加性**（不加不减信封消息，14/15 不变；非 orch 10/11、orch 恰 4 全 active 不变）。归属：协议 + codegen + 最小接线 = 批2 Agent A（本登记）；真实现（delete/setTitle/all 全量加载/chatOpen tab UI/归档进度节流/warmup 跳扫门控）= 批2 Agent B/C。

1. **#5 `chat.request` 的 `ChatRequest` union += `delete{projectHash, sessionId}` / `setTitle{sessionId, title?}`**（union 加分支不占槽）；`session` 变体 **+= `all?: bool`**（true=忽略 `before` 游标一次性返回整会话，供搜索态全量加载/回到顶部/整段复制；缺席=既有 before 游标分页语义）。`setTitle.title` 缺席/空串 = 清除自定义标题。
2. **`ChatResponse` union += `deleted{sessionId}` / `ok{}`**（union 加分支不占槽）：`deleted` = delete 成功应答；`ok` = setTitle 等无载荷成功应答。失败仍走既有 `rejected{code:string, message}`（v10 先例，具体码值 native 实装定）。
3. **#9 `data.event` 的 `DataEvent.chatSyncStatus` 分支 += `synced?: int` / `total?: int`**（归档进度帧字段；节流语义由 native 批内实现，schema 只加字段。缺席=无进度信息，同 v10/v11 既有同步条语义）。
4. **`ui.action` 的 `UIAction` union += `chatOpen{}`**（顶部 tab 进入聊天历史；web→native event，union 加分支不占槽）。native 语义 = `setPanelMode(.chatHistory)`（与菜单「聊天历史」同落点）——本批 A 做最小切屏路由（`CompositeRootViewController.handle` → `TerminalService.handleAction` → `setPanelMode(.chatHistory)`，与 `chatClose`/`exitTaskCenter` 同漏斗），tab UI + 完整交互批2 C 完善。无「激活消息贯穿路由+测试面」的纪律 grep（step 6 只管数据目录字面量），故仅需编译穷尽 + 真行为路由，无强制新测试（chatOpen 复用既有切屏路径）。
5. **`ConfigSnapshot` += `archiveEnabled: bool`（非可选）、`PrefsPatch` += `archiveEnabled?: bool`（可选）**——聊天自动归档开关（Config 域 record 加字段，不占槽）。存取通道由本批 A 接：`MuxvoConfig.chatArchiveEnabled: Bool`（`decodeIfPresent ?? true` **默认开**，缺席/旧 config 兼容）+ ConfigRequestHandler snapshot/patch 双向映射（照 dockBadgeMode 等既有字段写法）+ ConfigRequestHandlerTests 往返 case。config 行为门控（warmup 跳扫等）归批2 C。
6. **不加 `chatRestoreResult`**（方案评审已砍——回填失败反馈走 native NSAlert，非协议帧）。
7. **Swift 分区无变**：新增/改动类型均落既有域文件（`ChatRequest`/`ChatResponse` → `Protocol+Chat.swift`；`DataEvent` → `Protocol+Data.swift`；`UIAction` → `Protocol+Ui.swift`；`ConfigSnapshot`/`PrefsPatch` → `Protocol+Config.swift`）；无新跨域共享类型，无新文件。

### v32（2026-07-13，软件自动更新批；`auto-update.md` §9 兑现——§8 表 update domain 激活）

**全部加性，不加不减信封消息（14/15 不变；非 orch 10/11、orch 恰 4 全 active 不变）**：

1. **#8 `app.request` 的 `AppRequest` union += `updateCheck{}` / `updateDownload{}` / `releaseNotes{locale}` / `whatsNewStatus{}`**（union 加分支不占槽）；`AppResponse` union += `updateAck{}` / `releaseNotes{entries:[ReleaseEntry]}` / `whatsNewStatus{shouldShow, appVersion}`。新 record `ReleaseEntry{version, date, sections:[ReleaseSection]}`、`ReleaseSection{key, items:[string]}`（DSL 无 map，数组保 Keep-a-Changelog 插入序）。失败走既有 `rejected{code, message}`。
2. **#9 `data.event` 的 `DataEvent` union += 6 推送分支**：`updateChecking{}` / `updateAvailable{version}` / `updateNotAvailable{}` / `updateDownloading{percent:double, transferred:int, total:int, bytesPerSecond:int}` / `updateDownloaded{version}` / `updateError{}`（文案统一「下载失败」，web 无需 message——`auto-update.md` §5/§9）。
3. **Swift 分区**：`ReleaseEntry`/`ReleaseSection` 仅 app 域可达 → 落 `Protocol+App.swift`；`DataEvent` 新分支全原始类型字段 → `Protocol+Data.swift` 无新引用；无新跨域共享类型，无新文件。
4. 行为语义（去打扰门/首帧 percent:0/downloaded 吸收/8s 超时兜底）全在 `specs/behavior/auto-update.md`，协议只承载形状。

### v31（2026-07-13，dogfood-r6 反馈#1「交互式 worker 表单 opt-in」；`interactive-worker.md` §0 兑现）

**`OrchCommandRequest.createTask` += `workerMode?: string`**（加性可选字段，不占消息槽；值域 `"headless"|"interactive"`，absent=headless compat 零变）。native 消费：interactive → spec 落 panel 信封 `{"goal","origin":"panel","workerMode"}`（`SpecJSONEnvelope.panelInteractiveSpecJSON`，`workerPrompt` origin gate 扩 {brain,panel}）；未知值/与 `template` 同携 → `rejected(invalidWorkerMode)` 整单拒（交互式仅无模板单任务）。消息数 14/15 不变。

### v29（2026-07-12，B2 per-slot 表单账号选择；M4c 欠账销账批）

**`OrchCommandRequest.createTask` += `slotAccounts?: [SlotAccountPick]`；新 record `SlotAccountPick{slot, accountId}`；`TemplateOption` += 必填 `slots: [string]`**（加性可选字段+record+record 字段，不占消息槽；absent=纯自动指派 compat 零变）。消息数 14/15 不变。

### v28（2026-07-12，B3 模板拒载横幅；M4c 欠账 P2③ MINOR-2 销账批）

**`OrchStatePush.snapshot` += `templateRejects?: [TemplateRejectView]`；新 record `TemplateRejectView{fileName, reason}`**（加性可选字段+record，不占消息槽；absent=无拒载无横幅）。TemplateStore.rejectedFiles 经投影 TemplatesProjection 上线 → web TemplateRejectBanner。消息数 14/15 不变。

> 台账补登（B3 对抗 MINOR-2，并行批共有欠账一次清）：**v24**=M4c 批3 templates 字段（snapshot += `templates?: [TemplateOption]`）；**v25**=批A 终端收起（与 M4c 撞号重编）；**v26**=title-sync `chatTitleUpdate`（与批B 并行占用）；**v27**=批B 列表模式（v26 撞号后合 main 者重编）。详情各批 memory/merge commit。

### v23（2026-07-10，dogfood-r4 问题4「会话详情转写降噪」；W3 线；合 main M4b B5 撞号 v22→v23 重编）

> 台账勘误：v18~v22 系并行批次 bump（protocol.json 已随各批推进），§9 未逐条补登；本条直接续 v23，不回补历史。撞号说明：本分支原登 v22（union 加 `thinking`/`unknown` 变体），合 main 时其 v22 已被 M4b B5「restoreBanner/dismiss/OrchStatePush.select 幂等单发通道」占用（同为加性字段、零新消息槽、亦未登 §9），故按串行先到先合规则本条重编为 **v23**，两侧语义并存、均不占新槽（消息数 14/15 不变）。

**#5 `chat.request` 的 `ChatContentBlock` union += `thinking{text}` / `unknown{blockType, rawJson}`**（union 加分支不占槽，`deleteTask` v11 先例）。消息数 14/15 不变；非 orch 10/11、orch 恰 4 全 active 不变。

- **`thinking{text}`**：assistant 思考块过桥——native `ChatWire.contentBlock` 对 `type=="thinking"` 只取 `thinking` 正文（`signature` 加密签名人类不可读 → wire 面丢弃）。web 渲折叠块（展开体走 markdown）。
- **`unknown{blockType, rawJson}`**：未识别 `type` 且无可读 `text` 的块（如 `redacted_thinking`）——不再裸 dump 整块 JSON 进 `text`（问题4 根因2），改带 `blockType`（原 `type`）+ `rawJson`（原文 JSON 串，`inputJson`/`resultJson` 原文串过桥先例）。web 渲占位折叠块（展开体 `<pre>` 原文）。**回归护栏**：未知 `type` 但带 `text` 的块仍走 `.text`（现行为不变）。
- **语义约定（codegen 不强制）**：`thinking`/`unknown` 是 `blocks` 数组内的富消息块变体（与 `text`/`toolUse`/`toolResult`/`image` 并列），仅出现在 `ChatMessageView.blocks`；`text?`「恰一存在」不变量不受影响。
- **Swift 分区无变**：`ChatContentBlock` 仍随 `ChatRequest`/`ChatResponse` 归 `Protocol+Chat.swift`；无新跨域共享类型，无新文件。
- **归属**：协议 + codegen + ChatWire + web 渲染（折叠壳/user md）+ spec = W3 一线（chat-history.md §7.10）。

### v33 → **v34**（2026-07-13，右上角批 B2——登录/帮助/导览协议先行，一次 bump 承载全部扩展；合并 reconcile 重编）

> 撞号说明：**v32 已被 feat/auto-update 在飞分支占用**（update*/releaseNotes/whatsNewStatus 族），本批跨分支
> grep 后取 **v33**。两分支并行期各自从 v31 加性扩展、变体/字段零撞名；auto-update 先合 main（v32），本批
> 后合——merge reconcile 时按先例（v22→v23）重编为 **v34**（合并树=两侧变体并集，相对双亲均为改动，
> E_VERSION_NOT_BUMPED 双向满足）。消息数 14/15、非 orch 10/11 均不变——全部走 union 变体
> 与 record 加字段，零新增顶层消息。

- **#8 `AppRequest` += 8 变体**：`openExternal{url}`（条款/隐私链接经 native NSWorkspace 开系统浏览器，
  scheme 白名单 http/https）+ auth 7 变体（`authStatus` / `authLoginOAuth{provider}` / `authLoginPassword` /
  `authRegister` / `authSendEmailCode{purpose}` / `authResetPassword` / `authLogout`——归宿修订理由见 §8 AUTH 段）。
  **AppResponse += 3 变体**：`opened` / `authState{auth}` / `authAck`（oauth 已起轮询/验证码已发）；失败一律
  走既有 `rejected{code,message}`（AUTH_* 稳定错误码，中文文案在 web 层映射）。B2 阶段 auth 变体由
  AppRequestHandler 占位拒绝（AUTH_UNAVAILABLE），B5 换 AuthRequestRouter 实装。
- **#9 `DataEvent` += 2 变体**：`authStatusChanged{auth: AuthView}` / `authSessionExpired`（登录态推送——
  刻意不进 ui.state，防污染全量 golden fixture）。
- **#3 `UIAction` += 1 变体**：`helpOpen`（右上角问号=帮助会话一条龙，menu-bar.md；B3 实装）。
- **#7 `ConfigSnapshot`/`PrefsPatch` += `tourCompleted: bool`**（新手引导完成标，welcome-overlay.md 门控；
  「偏好并入 config」既定裁决）。lastSeenVersion 归 feat/auto-update（其 ConfigStore 已落，本批不碰）。
- **新共享类型**：`AuthProvider`（github/google）/ `AuthCodePurpose`（register/reset）/
  `AuthUserView{username,email?,avatarUrl?,provider}` / `AuthView{loggedIn,user?}`。

### v37（2026-07-16，hook 跨分身劫持根修批「设置面板显式启用入口」；wait-detector.md §7 单绑定条兑现）

消息数 **14/15、非 orch 10/11 均不变**——union 加分支不占槽，零新增顶层消息。
（注：v35=埋点批、v36=worktree 自定义名批，两批未在本台账补登记条，号段经 protocol.json git 历史追溯。）

- **#8 `AppRequest` += 2 变体**：`hookStatus{}`（设置面板打开时拉安装态）/ `hookEnable{}`（显式启用/接管——
  native 弹 sheet 授权确认，确认后 install() 写 `~/.claude/settings.json`，响应即带终态，pull-only 免推送，
  whatsNewStatus 先例）。**AppResponse += 1 变体**：`hookStatus{state: HookInstallState, reason?}`（请求/响应
  同名先例=whatsNewStatus；reason 仅 drift 态带漂移原因文案）。失败走既有 `rejected{code,message}`
  （`HOOK_INSTALL_FAILED`）。
- **新共享类型**：`HookInstallState` enum（`installed`/`notInstalled`/`drift`/`foreignBound`/`disabled`）——
  `foreignBound`=绑定属于其他 Muxvo 分身（§7 单绑定，可显式接管）；`disabled`=禁装门分身（面板不渲染该行）。

### v38（2026-07-17，hook 首启启用 UX 批；wait-detector.md §7 首启自动启用/opt-out 条款兑现）

消息数 **14/15、非 orch 10/11 均不变**——union 加分支不占槽，零新增顶层消息。

- **#8 `AppRequest` += 2 变体**：`hookDisable{}`（设置面板「停用」——uninstall 清全部 muxvo 组 + opt-out
  记档，无 sheet 直达，响应复用 `hookStatus` 回终态；失败 `rejected(HOOK_DISABLE_FAILED)`）/
  `hookAutoEnableNotice{}`（首启自动启用一次性轻提示查询——查询即消费，WhatsNewGate 先例）。
  **AppResponse += 1 变体**：`hookNotice{show: bool}`。
- `HookInstallState` 枚举**零动**（foreignBound 保留——用户面归一在 web 渲染层做，wait-detector.md §7）。

### v39（2026-07-18，M7 批5 运行时欠账——编排 worktree 批量 GC；`scheduler-worker.md` §2.1 兑现）

消息数 **14/15、非 orch 10/11 均不变**——union 加分支不占槽，零新增顶层消息。

- **#11 `orch.command` 的 `OrchCommandRequest` union += `gcWorktrees{includeOrphans?, dryRun?}`**（单个
  `cleanupWorktree` 的批量兄弟：批量回收编排自建的 archived/孤儿 worktree，四道保守防线见 §2.1）。响应复用
  `ok`/`rejected`（逐条回收/保留结果落调度器 `manual_action:worktree_gc` 审计，不经桥回传结构化报告）。域内
  union 变体追加，不占新槽；非 orch 10/11、orch 恰 4 全 active 不变。

### v40（2026-07-18，M7 批4 内存监控——§8 表唯一 deferred 条 `app:memory-warning` 激活）

消息数 **14/15、非 orch 10/11、orch 恰 4 全 active 均不变**——union 加分支不占槽，零新增顶层消息。

- **#9 `data.event` 的 `DataEvent` union += `memoryWarning{currentMemoryMB, threshold, message}`**（§8 APP 表
  唯一 deferred 条兑现，改派 →#9）：native 内存监控每 60s 采样常驻内存，超 2GB（2147483648 bytes）即推此帧
  （`threshold`=2048 MB，`message`=「内存占用较高，建议关闭部分终端」）。生产者 = `MuxvoPerf.MemoryMonitor`
  经 `MemoryAssembly` 广播（AppDelegate 启动装配）。字段全原始类型 → `Protocol+Data.swift` 无新引用，
  无新跨域共享类型，无新文件。规格锚 APP_L1_05 / PERF_L1_02（cross.spec.json）+ PERF_L2_01/02
  （perf-thresholds.spec.json）；行为与阈值/间隔/文案硬编码在 MuxvoPerf 纯核。
- **web 消费面（黄色警告图标）尚未接**：`subscribeDataEvent` 遇未知 kind 静默忽略（union 分支按 kind 过滤先例），
  golden 零影响；黄图标渲染登记 V1.1 remaining。

### v41（2026-07-18，M7 批3 迁移落地 + 批4 撞号 reconcile）

消息数 **14/15、非 orch 10/11 不变**——同为 union 加分支不占槽。批3（legacyMigrationNotice）与批4（memoryWarning）
均基 v39 独立 bump 到 v40，merge-train 合并时按「后合者 max+1」reconcile 到 **v41**（两变体并存，codegen 重生成无漂移）。

- **#8 `app.request` 的 `AppRequest` union += `legacyMigrationNotice{}` → `migrationNotice{show: bool}`**（M7 批3
  首启迁移 UX）：升级用户首次迁移完成后的下一次启动，web `LegacyMigrationNoticeLive` mount 即查询消费；native
  读 `~/.muxvo/chat-archive` 迁移 marker（copied>0）+ per-分身一次性闩（ConfigStore `legacyChatMigrationNoticeShown`）→
  首查返 `show:true` 并置闩，二查 false；隔离/禁装分身无 legacy marker 恒 false。规格锚 legacy-migration.md §7.2。
- web 消费面 = `LegacyMigrationNoticeLive.tsx`（逐字比照 `HookEnabledNoticeLive`：mount 查即消费、show 才有 DOM、
  4s 消隐、pointer-events:none；toast CSS 与 hook-enabled 组选择器共用）。**新增运行时 DOM，须过 visual-diff 验 golden**。
