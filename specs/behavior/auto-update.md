# 行为规格：软件自动更新（AutoUpdate）

> 状态：**v1-frozen**（2026-07-18 M7 批0 对账冻结：自动更新全链已上线，Sparkle 2.6.4 全接管、
> 协议 update domain 已激活、真机换装终验 20/20 过；两条契约 spec `INSTALL_L2_01`/`INSTALL_L2_15`
> 于 `specs/legacy/status.json` 已翻牌 implemented 且有注入时钟真测试；批2 收官即此文行为体）。
> 改动走修订流程。§9 记「protocolVersion 31→32」为**该批加装时的历史增量**（main 现已推进至 v38，
> 后续批各自 bump，不回改本文）。UPD_* 案例池（§12）与实现 1:1，勿删勿改口径。
>
> 提炼自老 app 实际代码（`src/main/index.ts:735-900` 自更新装配 + `services/app/update-logger.ts` +
> `ipc/app-handlers.ts:31-43` release notes + `renderer/App.tsx:171-184` What's New 触发 +
> `components/settings/SettingsModal.tsx:119-143,361-397` 检查更新区 + `layout/UpdateProgress.tsx`
> 菜单栏进度环 + `whats-new/WhatsNewModal.tsx` + `shared/utils/changelog-parser.ts`，2026-07-13 亲读），
> **只记行为不抄结构**。
>
> UI 复刻屏已由既有 spec 承载，本文不重复、只接线：菜单栏进度环 = `menu-bar.md` §4（含 done 态，
> 本批加性注记）、设置面板检查更新行 = `settings-modal.md` §3-5（三态 dom-assert 挂账本批兑现）、
> What's New 弹窗 = `whats-new-modal.md`。本文承载：更新引擎状态机、原生弹窗、去打扰持久化、
> update.log、桥协议接线、UPD_* 案例池。
>
> ⭐与老版的**五处有意偏差**见 §11 白名单（①~④ 用户 2026-07-13 拍板采纳；⑤同类防打扰修复登记）。
> 对抗验收对照老版时以白名单豁免，**其余用户可感知行为逐条对齐（文案逐字）**。

## 0. 数据形状与持久化

- `config.json`（数据根，ConfigModel 浅合并；全部 optional，旧文件天然兼容）：
  ```
  updateDismissal: { version: string, count: int }?   // 去打扰状态；count=999 = 该版本永久静默
  lastSeenVersion: string?                            // What's New 门控（更新后首启检测）
  ```
- `logs/update.log`（数据根）：行格式 `[ISO8601] [LEVEL] message`（LEVEL ∈ ERROR/WARN/INFO/DEBUG）；
  **启动时**文件 >1MB 则整体清空（rotate-on-startup，非运行中截断；legacy update-logger.ts:21-28）；
  写失败静默吞。
- 随包资源：`CHANGELOG.zh.md` / `CHANGELOG.en.md`（`Contents/Resources/`，Keep-a-Changelog 格式，
  repo 根为源，`app.sh bundle` 拷入）。
- 当前版本号：bundle `CFBundleShortVersionString`（`app.sh` 经 `MUXVO_APP_VERSION` 注入，默认 0.1.0）；
  web 侧经 `HelloResponse.appVersion` 取得。

## 1. 启用门与检查节律

- **生产启用门** = Info.plist 键 `MuxvoUpdateFeedURL` 存在（对齐 legacy `!is.dev` 门）：
  dev（`swift run`/裸构建）缺席 → 更新面整体 no-op（不查、不轮询、零网络）；此时 web
  「检查更新」按钮行为 = legacy dev no-op 对等：请求即时 ack、无任何推送 → 8s 超时判「已是最新」
  （不是「检查失败」——legacy dev handler 返回 null 不 reject，:898）。
- env 缝：`MUXVO_UPDATE_FEED_URL` 覆盖 feed 地址（e2e/真机脚本注 localhost）；
  `MUXVO_UPDATE_TIMINGS_MS`（仅测试）把 6h/72h/8s/3s/2s 全套时序毫秒化。
- **启动即查一次 + 每 6h 轮询**（偏差①；legacy 实况 4h/注释 1h/spec INSTALL_L2_01=21600000ms，按 spec）。
  检查失败（启动/轮询/手动皆同）：推 `updateError` → 菜单栏红 X 气泡「下载失败」3s——**legacy 对等**
  （autoUpdater 'error' 事件对检查失败同样推 UPDATE_ERROR :867-873，离线启动会闪红 X，非静默；
  批2 亲读修正）+ update.log 记 ERROR。不弹任何窗。
- `autoDownload=false` 恒成立：发现新版**永不自动下载**，必经用户点「立即下载」（弹窗）或
  「下载 v{x}」（设置面板）。下载完成后退出时自动安装恒开（`autoInstallOnAppQuit=true` 对等）。

## 2. 发现新版：三按钮弹窗与去打扰状态机

任何来源（启动检查/6h 轮询/设置面板手动检查）发现新版本 version 的统一处理序（legacy :806-825）：

1. 取消 pending 的 72h 会话内 reminder 定时器（若有）。
2. 若 `version ≠ updateDismissal.version` → **重置** `updateDismissal = {version, count: 0}` 并立即落盘。
3. 推 `updateAvailable{version}` 到 web（**无论后续弹不弹框**——设置面板据此切 available 态）。
4. 若 `count > 1` → 静默返回（不弹框）。
5. 若已有更新弹窗在屏（防重入门，legacy isPromptingUpdate :747,768）→ 跳过。
6. 弹**原生三按钮弹窗**（NSAlert，中文硬编码不随 language 切换；呈现 = 挂主窗 sheet **非阻塞**，
   §4 两按钮框同——app-modal 会冻结主 run loop 的桥推送，启动即查场景下 web 首帧 ui.state
   被弹窗压住、整个弹窗期示人演示 fixture 假终端，2026-07-16 真机定性；无可挂窗回退 app-modal）：

| 项 | 文案（逐字） |
|---|---|
| 标题 | `Muxvo 有可用更新` |
| 正文 | `发现新版本 v{version}` |
| 详情 | `下载在后台进行，不影响当前工作。下次启动时自动安装更新。` |
| 按钮 | `立即下载`（default）｜`暂不更新`（cancel）｜`不再提醒此版本` |

用户选择：

- **立即下载**：先推 `updateDownloading{percent:0, bytesPerSecond:0, transferred:0, total:0}` 首帧
  （菜单栏指示器立现，legacy pushDownloadStart :760-765），再启动下载。
- **暂不更新**：`count+1` 落盘；若加后 `count ≤ 1` → 安排 **72h 后会话内直接重弹**同版本弹窗
  （不重新 check，legacy :796-799）。综合效果 = **每版本至多提示 2 次**（初次 + 72h/下次触发）。
- **不再提醒此版本**：`count=999` 落盘 → 该版本永久静默（新版本号出现即被第 2 步重置）。

**downloaded 待装态吸收**（偏差⑤）：更新已下载待装后，后续检查再发现**同版本** → 不弹框、不推送
（吸收）；发现**更高版本** → 按新版本走全新去打扰周期（第 2 步重置）。

## 3. 下载

- 进度逐次推 `updateDownloading{percent(0..100 double), transferred, total, bytesPerSecond}`；
  同时 **dock 图标进度条** = percent/100（legacy setProgressBar :829；绘制经 DockTileRenderer 与
  Dock 徽标共用 contentView 合成，互不 clobber——wait-detector.md §8 渲染通道）。渲染（26×26 环 +
  hover 气泡文案/字节格式）= `menu-bar.md` §4。
- 完成：清 dock 进度条；推 `updateDownloaded{version}`；弹两段式安装弹窗（§4）。
- 失败：**自动重试 1 次**（偏差②，INSTALL_L2_15）；重试成功则对用户全程无感；重试仍失败 →
  清 dock 进度条、推 `updateError{}`、update.log 记 ERROR。
- 工件校验失败（签名/校验和）与网络失败同路径同文案（legacy 不区分，:867-873）。

## 4. 下载完成：两段式安装弹窗

| 项 | 文案（逐字） |
|---|---|
| 标题 | `下载完成` |
| 正文 | `v{version} 已下载完成` |
| 详情 | `立即重启安装，还是下次启动时自动安装？` |
| 按钮 | `立即重启`（default）｜`下次启动时安装` |

- **立即重启**：安装+重启动作**必须出弹窗回调栈后**执行（legacy setImmediate 防 SIGABRT :859-863
  对等 → 新版经注入时钟 tick 出栈后调用 installer）；安装触发的 app 退出**不弹退出确认**
  （legacy `forceClose=true` :861 对等——用户点「立即重启」已明示），仍走优雅关停序。
- **下次启动时安装**：无即时动作；app 退出时自动安装新版本（autoInstallOnAppQuit 对等）。

## 5. 错误呈现

- 菜单栏红 X 气泡「下载失败」3s 淡出（= `menu-bar.md` §4 error 态）；网络/下载/校验不分文案。
- 设置面板 checking 中收到 `updateError` 推送 → 「检查失败」红字（§6）。

## 6. 手动检查（设置面板，web 侧状态机）

`updateStatus ∈ idle | checking | available | up-to-date | error`（文案见 §10；渲染 =
`settings-modal.md` §3-5）。

- **每次打开设置面板重置为 idle**（legacy :130-132）。
- 点「检查更新」→ `checking` + 发 `updateCheck` 请求（即时 ack）→ 结果经推送：
  - `updateAvailable{version}` → `available`（按钮「下载 v{version}」）——**设置面板开着时该推送
    随时生效**（不要求处于 checking，legacy :133-136）。
  - `updateNotAvailable` → `up-to-date`（偏差④：真结果提前显示；legacy 恒等超时）。
  - `updateError` → `error`（仅 checking 中生效；idle 下的后台轮询错误不动设置面板）。
  - **8s 超时兜底**：仍处 checking → `up-to-date`（legacy :123-125）。
  - 请求发送本身失败（桥 rejected）→ `error`（legacy .catch :126）。
- `available` 点「下载 v{version}」→ 发 `updateDownload` 请求 + **关闭设置弹窗**（legacy :140-143）；
  native 收到后推 percent:0 首帧再启动下载（与弹窗「立即下载」同链）。
- 行左侧恒显「当前版本 v{appVersion}」+「查看更新内容」链接（点开 What's New，§7）。

## 7. What's New（更新后首启弹窗）

- **触发**（legacy App.tsx:171-184 对等）：web 主界面加载后查询 `whatsNewStatus` →
  返回 `{shouldShow, appVersion}`；native 判定 `shouldShow = (lastSeenVersion 存在 && ≠ 当前版本)`，
  且**查询时即写回** `lastSeenVersion = 当前版本`（≠当前才写；首装 lastSeenVersion 缺席 →
  不弹但写回）。web 收到 `shouldShow=true` → **2s 后**弹 What's New。
- 数据：`releaseNotes{locale}` → native 读随包 `CHANGELOG.{zh|en}.md`（locale=='en' 用 en，
  其余一律 zh）→ Keep-a-Changelog 解析为有序 `entries: [ReleaseEntry]`；读失败 → `[]` →
  弹窗空态「v{x} 暂无更新说明」。解析规则与 legacy parser 等值（版本头正则
  `^## [x.y.z(-suffix)] - YYYY-MM-DD`、`### Section`、`- item`、跳过 [Unreleased]、
  section 保插入序）——UPD_changelog_parse_parity 以 fixture JSON 等值锁定。
- 渲染（current/older 划分、历史默认全折叠、section 标签 zh 映射、「知道了」）= `whats-new-modal.md`。
- 弹窗开着时切换 locale → 重取 notes（legacy :29 effect 依赖 locale）。
- 设置面板「查看更新内容」手动打开同一弹窗，**不触碰** lastSeenVersion。

## 8. update.log 里程碑 token（真机脚本/测试断言锚）

INFO 级里程碑行含稳定 token（行内其余文字自由）：`update:checked`、`update:available v{x}`、
`update:downloading`、`update:downloaded v{x}`、`update:installing`、`update:install-on-quit`、
`update:relaunched v{x}`（新版首启由装配处补记）、`update:whats-new-shown v{x}`（native 收到
whatsNewStatus 查询且 shouldShow=true 时记）、`update:retry`；错误一律 ERROR 级。

## 9. 桥协议接线（protocolVersion 31→32，不占新消息槽）

`app.request`（#8）新增变体：

| 请求变体 | 字段 | 响应 |
|---|---|---|
| `updateCheck` | — | `updateAck{}`（结果经推送） |
| `updateDownload` | — | `updateAck{}` |
| `releaseNotes` | `locale: string` | `releaseNotes{ entries: [ReleaseEntry] }` |
| `whatsNewStatus` | — | `whatsNewStatus{ shouldShow: bool, appVersion: string }` |

新类型：`ReleaseEntry{ version: string, date: string, sections: [ReleaseSection] }`、
`ReleaseSection{ key: string, items: [string] }`（DSL 无 map，数组保插入序）。

`data.event`（#9）新增变体（推送，web 订阅）：

| 推送变体 | 字段 |
|---|---|
| `updateChecking` | —（检查开始；web 当前不消费，诊断/前向兼容） |
| `updateAvailable` | `version: string` |
| `updateNotAvailable` | — |
| `updateDownloading` | `percent: double, transferred: int, total: int, bytesPerSecond: int` |
| `updateDownloaded` | `version: string` |
| `updateError` | —（文案统一「下载失败」，web 无需 message） |

## 10. 全部用户可见文案表

**原生弹窗（中文硬编码，不随 language）**：见 §2、§4 表。

**菜单栏气泡**（`menu-bar.md` §4；zh-only，legacy 同）：`正在下载更新...`｜`v{version} 下载完成`｜
`下次启动时自动更新`｜`下载失败`｜字节 `{n} KB` / `{n.1} MB`（<1MB 取整 KB，否则一位小数 MB）、
速度后缀 `/s`。

**设置面板**（zh / en，legacy SettingsModal :361-397）：

| 位置 | zh | en |
|---|---|---|
| 行标签 | 检查更新 | Check for Updates |
| 行描述 | 当前版本 v{x} | Current version v{x} |
| 链接 | 查看更新内容 | What's New |
| idle 按钮 | 检查更新 | Check |
| checking | 检查中... | Checking... |
| up-to-date | 已是最新版本 | Up to date |
| available 按钮 | 下载 v{x} | Download v{x} |
| error（红 #ff5f57） | 检查失败 | Check failed |

**What's New**（zh / en，`whats-new-modal.md`）：标题 更新内容/What's New；分区 新增/变更/修复/移除/
弃用/安全（en 用原 key：Added/Changed/Fixed/Removed/Deprecated/Security，未知 key 原样）；
历史版本/Previous Versions；空态 `v{x} 暂无更新说明` / `No release notes for v{x}`；知道了/Got it。

## 11. 偏差白名单（对抗验收豁免；此外行为逐条对齐老版）

| # | 偏差 | 老版 | 新版 | 依据 |
|---|---|---|---|---|
| ① | 轮询间隔 | 4h（注释误写 1h） | **6h** | spec INSTALL_L2_01；用户 2026-07-13 拍板 |
| ② | 下载失败重试 | 无 | **自动重试 1 次**，仍败才提示 | spec INSTALL_L2_15；用户拍板 |
| ③ | 诊断日志 | electron-updater 自带 update.log | **等价自建**（§0/§8） | M7 可诊断性硬要求；用户拍板 |
| ④ | 「已是最新」判定 | 恒等 8s（not-available 死通道） | **真结果提前显示**，8s 仍是上限兜底 | 用户拍板 |
| ⑤ | downloaded 待装后再检查 | 同版本**重复弹**三按钮框（count=0 不拦，4h 一次） | **吸收不重弹**（§2 末） | 防打扰修复，与①~④同向；登记待用户收官确认 |

## 12. UPD_* 案例池（spec-coverage 强制 1:1；`tools/spec-coverage/check.mjs` BEHAVIOR_POOLS 注册）

| 用例名 | 断言 |
|---|---|
| UPD_check_on_launch | 装配后启动即查：假 feed requestLog ≥1 |
| UPD_poll_6h | 注入时钟快进：相邻两次检查间隔 = 6h（21600000ms；INSTALL_L2_01 同测） |
| UPD_prod_only_gate | 无 feed URL：零网络请求、不轮询；updateCheck 即时 ack 且零推送 |
| UPD_dialog_copy_available | 三按钮框 title/message/detail/按钮文案与顺序逐字 ==（§2 表；测试侧字面量） |
| UPD_dialog_copy_ready | 两按钮框逐字 ==（§4 表） |
| UPD_available_push_silent | count>1 静默：不弹框但仍推 updateAvailable |
| UPD_download_first_frame_0 | 「立即下载」/updateDownload 请求：下载启动前先推 percent:0 首帧 |
| UPD_snooze_persist | 「暂不更新」→ count+1 落盘（store 可见） |
| UPD_snooze_72h_reprompt | count≤1：72h（假时钟）后会话内直接重弹同版本框（不重新 check） |
| UPD_snooze_cap_2 | 第 2 次「暂不」后（count=2）：重启重建 controller 复用 store，available 不再弹框 |
| UPD_mute_version | 「不再提醒此版本」→ count=999 落盘，同版本永久静默 |
| UPD_mute_reset_new_version | 更高版本 available → updateDismissal 重置 {新版本, 0} 落盘并可再弹 |
| UPD_reprompt_guard | 弹窗在屏时再收 available → 不叠弹（防重入门） |
| UPD_downloaded_no_reprompt | downloaded 态同版本 available 吸收：不弹不推（偏差⑤） |
| UPD_download_progress_sink | 进度推送序列 percent 单调不减且含终态；transferred/total/bytesPerSecond 透传 |
| UPD_dock_progress | dock 进度 sink 收 percent/100 序列；downloaded 与 error 均清进度（-1 语义） |
| UPD_error_retry_once | 首次下载失败自动重试恰 1 次（下载调用计数=2）；重试成功全程不推 updateError（INSTALL_L2_15 同测） |
| UPD_error_badge_copy | 重试仍失败：推 updateError；web 气泡「下载失败」3s 隐藏（vitest 半） |
| UPD_error_log_file | 失败路径 update.log 落 ERROR 行；里程碑 token（§8）按序出现 |
| UPD_log_rotate_1mb | 启动时 update.log >1MB → 整体清空；≤1MB 保留 |
| UPD_restart_now_installs | 两按钮框选「立即重启」→ installAndRelaunch 恰 1 次且在弹窗回调栈外 |
| UPD_install_on_next_launch | 选「下次启动时安装」→ 无即时安装；退出时 installer 收到 install-on-quit |
| UPD_settings_check_button_states | 设置面板五态（idle/checking/up-to-date/available/error）文案 zh/en 逐字（settings-modal.md:93 挂账兑现） |
| UPD_settings_8s_timeout | checking 8s（假时钟）无推送 → up-to-date |
| UPD_settings_early_uptodate | checking 中收 updateNotAvailable → 立即 up-to-date（偏差④） |
| UPD_settings_download_closes | available 点「下载 v{x}」→ 发 updateDownload 且设置弹窗关闭 |
| UPD_settings_reopen_resets | 重开设置面板 updateStatus 重置 idle |
| UPD_menubar_done_badge | updateDownloaded 推送 → 环 done 绿对勾 + 气泡「v{x} 下载完成」「下次启动时自动更新」+ 3s 隐藏 |
| UPD_menubar_ring_live | updateDownloading 推送 → live 菜单栏环出现且 percent 驱动 strokeDashoffset |
| UPD_hover_bubble_copy | 气泡「{transferred} / {total}」与「{speed}/s」按 KB/MB 规则格式化（<1MB 取整 KB 否则 1 位小数 MB） |
| UPD_whatsnew_2s_after_upgrade | shouldShow=true → 2s（假时钟）后弹 What's New；shouldShow=false 不弹 |
| UPD_whatsnew_seen_writeback | whatsNewStatus 查询即写回 lastSeenVersion=当前；首装（缺席）→ shouldShow=false 且写回 |
| UPD_whatsnew_history | 历史版本默认全折叠、点 toggle 展开；current 缺失 → 空态文案 |
| UPD_changelog_parse_parity | Swift 解析器对共享 fixture 的输出 == legacy changelog-parser 预生成 JSON（等值） |
| UPD_bad_feed_graceful | malformed/404 feed：不崩、推 updateError（红 X 气泡，legacy error 事件对等）、update.log 有痕 |
| UPD_bad_checksum_reject | 工件校验失败 → 拒装走下载失败路径（重试 1 次后 updateError） |
| UPD_swap_install_e2e | 真机换装终验 `tools/update-swap/run.sh` PASS（公证 vA→vB 换装+重启断版本+What's New 存证；人工触发，token 挂 e2e harness 注释） |

## 13. golden 声明

本批 **零新增 golden、预期全部现有 golden 字节零动**：`mb-upd-downloading`/`mb-upd-error`/
`set-update`/`wn-notes` 等复刻屏 fixture 传参不变；done 态气泡属 hover 浮层（display:none 默认，
`menu-bar.md` §4「tooltip 不出 golden」既有约定），live 接线走 vitest dom-assert。若实现中任何
golden 字节变动 → 停下列清单交用户巡检，严禁擅自重冻。
