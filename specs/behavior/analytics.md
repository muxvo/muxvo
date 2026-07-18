# 行为规格：使用埋点（Analytics）

> 全新设计（2026-07-15 用户拍板：不继承老版事件表，从新产品功能出发重新构思；老版仅复用
> 服务端 ingestion 契约）。上报出口 = legacy 后端 `POST {MUXVO_API_URL ?? https://api.muxvo.com}/analytics/track`
>（`muxvo-legacy/server/src/routes/analytics.ts`：header `X-Device-ID` 必填 + `Authorization: Bearer` 可选；
> body 单事件 `{metric≤100字符, value?, metadata?}` 或批量 `{events:[...]}` ≤100 条/批；
> 落 Postgres `analytics_events(date, device_id, user_id, metric, value, metadata)`）。
> 后台看板（admin.muxvo.com）按 `metadata->>'app'` 区分新版（muxvo2）与老版（无 app 字段）。
>
> 隐私边界：只报事件名 + 枚举/数值参数，**不报任何用户内容**（不含 cwd、文件名、命令、聊天内容、
> 项目名、email）。device_id 为本产品自生成 UUID，不采集硬件指纹。

## 0. 数据形状与持久化

- `state/analytics-device-id`（数据根 state 目录下，纯文本一行 UUID，AtomicFile 原子写）：
  设备标识，每数据根一个，首次访问生成（isNew=true 信号 → 恰发一次 `app.first_launch`）。
  文件内容非法（非 UUID 解析）→ 重新生成并覆盖（视同首建）。**不迁移老版 device_id**（M7-PLAN 已定）。
- 公共信封（每条事件 metadata 由 tracker 自动合入，调用方同名键被覆盖、不可注销）：
  `{ app: "muxvo2", v: <CFBundleShortVersionString>, os: <macOS 版本 major.minor.patch> }`
- 无磁盘事件队列：事件仅存内存 buffer，进程死亡丢失未 flush 事件=可接受损耗（分析数据非账务）。

## 1. 事件表（权威清单；五层业务问题导向）

命名小写点分；params 进 metadata（枚举/小整数）；数值量放 value 列。

### L1 激活与留存（Swift 原生）
| metric | 触发点 | params / value |
|---|---|---|
| app.first_launch | device-id 文件首建（装配时） | — |
| app.launch | applicationDidFinishLaunching | restored_terminals |
| app.heartbeat | tracker 内部 10min 定时 | — （时长口径 = 心跳数×10min） |
| app.quit | performShutdown（applicationShouldTerminate 单漏斗确认后；取消退出不计） | value=uptime_min |

### L2 终端主战场（Swift 原生）
| metric | 触发点 | params / value |
|---|---|---|
| term.created | 终端创建收口（菜单/web/帮助三源；restore 播种/console 不计） | source: menu\|web\|help |
| term.closed | 终端关闭收口（web close 命令单点，含边栏 ×） | — |
| term.minimized | 收起到边栏 | — |
| term.list_mode | 列表模式开关（⌘⇧L/按钮归一） | on: true\|false |
| window.opened | 新窗口 ⌥⌘N | — |
| panel.opened | setPanelMode 切非终端面板 | panel: taskCenter\|chatHistory |

### L4 周边功能采纳（web 面板，经 app.telemetry 桥）
| metric | 触发点 | params |
|---|---|---|
| chat.session_restored | 聊天历史恢复会话 | agent: claude\|codex |
| chat.searched | 聊天历史搜索（每次面板打开只发一次） | — |
| chat.exported | 导出聊天记录 | format |
| files.file_opened | file tabs 打开文件（左树点击 + 面板进入两口） | kind: markdown\|code\|text\|image\|spreadsheet\|pdf |
| skills.opened | Skills 面板挂载 | — |
| onboarding.welcome_shown | 欢迎浮层展示 | — |
| onboarding.tour_ended | 导览结束（×/Esc=skipped，末步动作完成=completed） | outcome, step（结束时所在步序） |
| settings.theme_changed | 设置面板切主题 | theme |

### L5 增长与健康（Swift 原生）
| metric | 触发点 | params |
|---|---|---|
| auth.login | onStatusChanged 未登录→登录（启动 tryRestoreSession 恢复期不计——恢复≠登录动作） | provider（服务端 user.provider 透传） |
| auth.logout | onStatusChanged 登录→未登录（恢复期同上不计） | — |
| update.prompted | 更新弹窗展示（prompter 装饰器） | stage: available\|downloaded |
| update.choice | 更新弹窗选择 | stage, choice: download\|snooze\|mute\|restart_now\|install_on_quit |
| update.downloaded | 更新下载完成 | version |
| update.applied | 换装后首启（What's New 门检测到版本变更） | from_version |
| app.error | 关键失败位：更新引擎 error / 终端 spawn internal 失败（业务拒绝 maxReached/invalidCwd 不计） | domain: update\|terminal, code |

## 2. 启用门（dev/test 绝不向生产上报）

- enabled 判定（纯函数）：env `MUXVO_ANALYTICS=0` → **强制关**；env `MUXVO_ANALYTICS=1` → 强制开
 （本地对 localhost 验证用，配 `MUXVO_API_URL` 覆写指本地）；否则 = Info.plist 布尔键
  `MuxvoAnalyticsEnabled`（仅 `app.sh bundle` 注入，仿 `MuxvoUpdateFeedURL` 先例；测试分身
  ——`MUXVO_DATA_ROOT_NAME` 非默认——默认不注，防开发期分身流量污染生产指标，`MUXVO_ANALYTICS_BUNDLE=1` 可显式开）。
- 未启用 → tracker 全 no-op：不建定时器、不发心跳、**零网络调用**；track()/flushNow() 即返。
  `swift run` / e2e-harness / 单测 / preflight 天然无 plist 键 → 恒关。

## 3. 批量与节律

- track() 入队内存 buffer；**flush 触发** = 每 60s 定时 或 buffer ≥50 条（先到者）；单批 ≤100 条
 （服务端上限），一次 flush 循环发批直到空或失败。
- flush 结果：2xx → 移除已发；**4xx → 丢弃该批不重试**（schema 被拒重试无意义）；网络失败/5xx →
  整批留 buffer 下轮重试。flush 防重入（in-flight 门）。
- buffer 封顶 500，超出 drop-oldest（防离线无限膨胀）。
- 心跳：启用后每 10min 入队一条 `app.heartbeat`（不即时 flush，随下一轮 flush 走）。
- 退出：performShutdown（退出确认后单漏斗）入队 `app.quit` → `flushNow(deadline: 2s)` 串在优雅关停序
  之前——pending 全力发送，超时即放弃返回，**有界不阻塞退出**；SIGKILL/崩溃路径丢未 flush 事件=可接受。
- Bearer：`bearerProvider` 闭包每次 flush 时取（装配层接 AuthTokenStore）；nil → 不带 Authorization 头。

## 4. 桥通道（app.telemetry，v35 激活）

- `app.telemetry`（webToNative、event 型、fire-and-forget）payload = `TelemetryEvent
  { metric: string, value?: number, params?: KeyValue[] }`；native 立即回 ok，decode 失败回
  BAD_REQUEST（不 crash）。web 便捷入口 `web/src/bridge/track.ts` 的 `track()`——无桥
 （截图 fixture/浏览器直开）静默 no-op。
- web 事件与 Swift 原生事件同 tracker 汇合，同享信封/批量/门。

## 5. AN_* 案例池（spec-coverage 强制 1:1；`tools/spec-coverage/check.mjs` BEHAVIOR_POOLS 注册）

| 用例名 | 断言 |
|---|---|
| AN_envelope_merge | 发出事件 metadata 恒含 app/v/os 三键；调用方同名 params 被信封覆盖 |
| AN_device_id_persist | loadOrCreate 同目录两次 → 同 UUID，第二次 isNew=false |
| AN_device_id_first_new | 首建返回 isNew=true（装配层据此恰发一次 app.first_launch） |
| AN_device_id_corrupt_regen | 文件内容非 UUID → 重生成新 id 且 isNew=true |
| AN_flush_60s | 假钟推进 60s → 恰一次 POST /analytics/track，body 含入队事件 |
| AN_flush_threshold_50 | 入队第 50 条立即触发 flush（不等 60s 定时） |
| AN_batch_limit_100 | pending 120 条 → 单次 POST ≤100 条，余量随后续批次发出 |
| AN_flush_fail_retain | transport 网络失败 → 事件留 buffer；下轮成功后 buffer 清空且事件不丢不重 |
| AN_flush_4xx_drop | 400 响应 → 该批丢弃，后续 flush 不再重发 |
| AN_buffer_cap_500 | 未 flush 累积 601 条 → buffer ≤500 且丢最旧（最新事件保留） |
| AN_heartbeat_10min | 假钟推进 10min → 恰一条 app.heartbeat 入队；再推 10min → 第二条 |
| AN_disabled_noop | enabled=false → track/start/flushNow 全程零 transport 调用、零定时任务 |
| AN_gate_env_override | 门函数：env=1 无 plist 也开；env=0 有 plist 也关；无 env 依 plist 键 |
| AN_quit_flush_deadline | flushNow(deadline)：transport 挂起 → 按 deadline 时限返回不悬挂 |
| AN_bearer_optional | bearerProvider 有值 → 请求带 Authorization: Bearer；nil → 无该头 |
| AN_device_header | 每次 POST 带 X-Device-ID 头 = 注入的 device_id |
| AN_bridge_telemetry_decode | app.telemetry 合法 payload → decode 成功、onTelemetry 收到同值事件、回 ok |
| AN_bridge_telemetry_bad_payload | 坏 payload → 回 BAD_REQUEST 不 crash、onTelemetry 不触发 |
| AN_auth_restore_not_login | 恢复期（beginAuthObservation 前）登录态变更不计；启用后未登录→登录恰发 auth.login |
