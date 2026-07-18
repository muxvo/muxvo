# 老版升级数据迁移（legacy-migration）

> 状态：**v1**（2026-07-16 聊天归档迁移上线）+ **§7 M7 批3 待落地增补（2026-07-18 批0 起草，待冻结）**。
> 本批已上线范围 = **聊天正文归档**（用户拍板 2026-07-16：只迁正文，§1-§6）。
> **D1b 已拍板（2026-07-17，勿再问）**：老版 config 外观偏好（theme/fontSize/terminal.* 等）、窗口几何/网格/
> openTerminals/savedWorkspaces、preferences.json、.auth-token、device_id **全不迁**，一律用新版默认——
> 详见 §7.0 不迁总表。发布数据根落地（Muxvo2）、首启迁移 UX/卸载指引、死代码退役 ×3 = 批3 落地（§7）。
>
> 关联规格：chat-data.md §1「数据根隔离」豁免句 + §6.2/§6.5（共享池与 PR-4 内部迁移语义）、
> distribution.md §7（老版升级承接 Path A，Squirrel 原地替换 spike 定）。

## 1. 行为

老版 Electron Muxvo 的聊天归档 `~/.muxvo/chat-archive/<projectHash>/<sessionId>.jsonl`（chat-archive.ts:14，
CC/Codex JSONL 字节镜像，与共享池**同构**）在新版首启一次性并入中心化共享池
`<sharedRoot>/chat-history/<projectHash>/<sessionId>.jsonl`：

- **触发点**：`ChatQueryEngine.warmup` 与 `archiveBackfill` 开头，紧随 PR-4 内部迁移（per-分身镜像→池）
  之后、先于 fullScan/reconcile——老会话**当轮 warmup 即入库可查**（archiveOnly 语义同镜像独有会话）。
  实际时机 = 首次 chat.request（warmup 惰性启动，GCD 弹性池，主线程零阻塞）。
- **引擎**：复用 `ChatArchiveMigrator` 零改动（legacy-archive-reclaim 批经 `muxvo-chat-dump merge-archive`
  真机实测同源同池）。语义随引擎：只认 `<子目录>/*.jsonl`；dest 缺失原子拷（保源 mtime）；dest 已存在按
  `shouldReplace (floorSec(mtime), size)` 字典序**新者胜**；零硬失败才落 marker（seal），有失败不落、
  下次启动 compare-skip 只补失败项。
- **与 PR-4 迁移的顺序无关性**：两迁移目标同池、共用 shouldReplace 纯函数，终态不随执行序变；排在
  PR-4 之后仅为叙述一致。**不受归档开关（archiveEnabled）门控**——理由同 PR-4（关档也须把历史并池）。
- **源目录缺失**（全新用户/已卸载老版）：引擎空扫 → 落 `copied:0` marker 永久短路，等价「检测存在才跑」；
  此后每次启动只余一次 marker stat。

## 2. 门控（两道独立防线，测试/隔离分身结构上不可能吸真归档）

1. **防线一（装配参数）**：`ChatAssembly.make` 尾置参 `legacyMuxvoArchiveRoot: URL? = nil`，**默认 nil =
   功能关**。全仓唯一非 nil 调用点 = 生产 `AppDelegate.assembleChatServices`；e2e/单测直造 make 不传。
2. **防线二（覆盖即禁）**：AppDelegate 仅当共享根**未被覆盖**（env `MUXVO_SHARED_ROOT` 与 plist
   `MuxvoSharedRootName` 均空，判定 = `DataDirectory.isSharedRootOverridden` 纯函数）时传源。覆盖根定义上
   是隔离/验收池，真实老归档只准进正式默认池「Muxvo Shared」。跳过时 migrator 不构造 → **marker 不落**，
   该分身日后以默认根启动仍会补迁（无假 seal）。

## 3. marker（per-分身）

`<dataRoot>/state/legacy-chat-archive-migrated.json`，独立于 PR-4 的 `chat-archive-migrated.json`
（两迁移源不同、各自幂等 seal）。per-分身理由沿 chat-data.md §6.5 既有裁决：首分身 seal 只封自己，
多分身各做一次 compare-skip 全扫是有界一次性成本。

## 4. `~/.muxvo` 纪律豁免（chat-data.md §1 豁免句的实施细则）

- 源路径经 `DataDirectory.legacyMuxvoChatArchiveRootURL(home:)` **唯一派生**。preflight 步6 grep 固化：
  `".muxvo` 字面量只允许 DataDirectory.swift（本派生点）、AppDelegate.swift（既有新手引导老版踪迹检测
  `MUXVO_LEGACY_TRACE_PATH` 回退，先于本纪律存在、与迁移无关）与测试文件。
- 豁免仅限**一次性只读迁移源**：严禁写入 `~/.muxvo`、严禁常驻读/watch、marker seal 后不再读。
- `home` 参数可注入供单测（$HOME 覆盖不影响 FileManager user-domain——已知坑，测试一律传 fixture 根）。

## 5. 已知限制（登记非缺陷）

- **老版自定义标题不迁**（用户拍板 2026-07-16，**D1b 已确认不迁**）：customTitle 存老版 AS 索引、不在归档
  JSONL；会话回落默认标题（首条 user 消息）。
- **seal 后老版继续归档不再吸**：marker 落后老版 app 若仍运行并归档新会话，本迁移不再拉取——这些会话
  同时存在于 `~/.claude/projects/`，新版镜像道（ChatMirror）直接覆盖，无实际丢失窗口。
- **老归档迁后保留不删**（沿 A批「老聊天全保留」裁决）：本迁移绝不清理 `~/.muxvo`；回收归后批。
- **病态权限子目录静默跳过**（引擎既有行为，对抗 NOTE-3 登记）：`~/.muxvo/chat-archive/<子目录>` 列目录
  失败时该批会话不迁且不计 failed、照常 seal（`jsonlFiles` 读失败返空集）；仅家目录自身权限病态才触发，
  登记不工程化。
- **dogfood 分身按设计参与迁移**（对抗 MINOR-2 定谳）：仅带 `MUXVO_DATA_ROOT_NAME` 的测试分身共享正式
  默认池（dogfood-r5 W-A 本意），故同样吸老归档进真实池——正是要 dogfood 的生产行为；开发机 A批已并池，
  实际增量为零或补吸老版新归档，均只读源、无破坏面。

## 6. spec↔test 映射

| ID | 断言 | 测试 |
|---|---|---|
| LM_warmup_migrates_legacy_archive | 老归档独有会话 warmup 并池 + 可查（archiveOnly）+ 独立 marker 落 per-分身 state | ChatAssemblyTests.LegacyMuxvoArchiveWiringTests.legacyArchiveMigratesOnWarmup |
| LM_idempotent_marker_seal | seal 后源再改（更新 mtime）二跑短路，池内容不变 | 同上.idempotentAfterSeal |
| LM_nil_param_off | make 不传源 → 不迁、marker 不落（防线一） | 同上.nilParamMeansOff |
| LM_conflict_newer_wins | 老归档旧快照 vs 池内新快照 → skip 池保新 + 照常 seal | 同上.conflictNewerWins |
| LM_source_root_derivation | `<home>/.muxvo/chat-archive` 派生（home 注入） | DataDirectoryTests.legacyMuxvoChatArchiveRootDerivation |
| LM_marker_derivation | marker 落 `<root>/state/legacy-chat-archive-migrated.json` 且异于 PR-4 marker | DataDirectoryTests.legacyChatArchiveMigrationMarkerDerivation |
| LM_override_gate_truth_table | env/plist 任一非空=覆盖；空串视同缺省 | DataDirectoryTests.sharedRootOverriddenTruthTable |
| LM_gate_resolver_semantic_lock | 门控↔resolveSharedRoot 对同输入永不漂移（覆盖 ⟺ 非默认形状） | DataDirectoryTests.gateMatchesResolverSemantics |
| LM_override_gate_shell_e2e | 门控壳读真实 MUXVO_SHARED_ROOT 键，与 defaultSharedRoot 同键同感知 | DataDirectoryTests(env 串行套件).sharedRootOverriddenShellEndToEnd |
| （引擎语义：幂等/compare-skip/新者胜/partial 不 seal） | 既有 12 测覆盖，本批零改动 | MuxvoChatHistoryTests.ChatArchiveMigratorTests |

## 7. M7 批3 待落地增补（草案，spec↔test 待批3 实现时补 ID）

> §1-§6 = **已上线**聊天归档迁移。本节 = 批3 待做项（发布数据根/迁移 UX/死代码退役），落地时按
> spec↔test 1:1 补测试 ID。此处只钉行为方向，不预写未实现的测试 ID。

### 7.0 不迁总表（D1b 拍板定案）

| 老版数据 | 老版路径 | 处置 |
|---|---|---|
| 聊天归档 | `~/.muxvo/chat-archive/` | **迁**（§1，已上线） |
| config.json（窗口几何/网格/openTerminals/主题/字号/终端外观/savedWorkspaces）| `~/Library/Application Support/muxvo/config.json` | **不迁**（新版默认；SessionHub v2 语义已重构无对应 schema） |
| preferences.json（updateDismissal）| 同目录 | **不迁**（新更新器重新累计） |
| .auth-token | 同目录 | **不迁**（登录移出 V1） |
| device_id | 同目录 | **不迁**（新版埋点自生成设备 id） |
| update.log / `~/.muxvo` 其余（guide.md/logs/mem-diag.log）| — | **不迁**（瞬态/每启重生成） |
| `~/.muxvo/exports/` | — | **原地保留不搬**（用户自有产物） |

### 7.1 发布数据根 Muxvo2（D1a，批3）

- 现状：`DataDirectory.swift` 只有 `devRootName = "Muxvo2 Dev"`，无正式发布根。
- 发布根 = **`Muxvo2`**（`~/Library/Application Support/Muxvo2/`）。⚠️严禁 `Muxvo`：APFS 大小写不敏感，
  `Muxvo` 与老版生产根 `muxvo/` 同目录 → 迁移只读防线物理击穿（R-06）。
- 落地契约：`forbiddenLegacyRootNames`（现 `["muxvo dev", "muxvo"]`）保持；**加新根 realpath ≠ 老根
  `~/Library/Application Support/muxvo` realpath 断言**（enforceLegacyRootGuard 同族），碰撞即拒启。

### 7.2 首启迁移 UX 与卸载指引（判据 5 启动器，批3，文案随本节共审）

- 升级用户识别（已上线先例）：在场 `~/.muxvo`（env `MUXVO_LEGACY_TRACE_PATH` 覆盖）→ AppDelegate 已据此
  预置 `tourCompleted=true`（升级用户不弹新手引导）。
- 首启迁移提示：检测到 `~/.muxvo/chat-archive` 且本次迁移有命中 → 一次性 toast「已迁入历史聊天归档」（措辞待定）；
  零命中不提示。
- 卸载老 app 指引：Path A 原地替换后老 bundle 已被换掉，指引主要针对手动并存安装用户；文案待共审。

### 7.3 死代码退役 ×3（与迁移同装配表面，M7-PLAN §4.2-3 并入本批）

批3 落地前逐处 RED-GREEN 核实「退役安全」（先证退役后行为不变），保守宁留勿误删：

1. ChatAssembly `deleteCandidates` 第三根硬删（per-分身 legacy 镜像根）。
2. ChatArchiveMigrator 第一迁移器装配源对账（确认与第二迁移器职责不重叠、发布根落地后去留）。
3. AppDelegate ChatRestore `mirrorRoots` per-分身 legacy 兜底退役。

### 7.4 批3 验收闸

迁移 e2e：造老版 fixture（`~/.muxvo/chat-archive/<项目>/<会话>.jsonl` + `muxvo/config.json`）→ 首启 →
断言聊天归档落位 + marker + **老根零字节未动**（find -newer 空集）+ config 未迁（用新版默认）+ 新根 realpath≠老根 +
半途杀进程重跑幂等 + 回滚（删新根、老根完好）。测试分身带 `MUXVO_DATA_ROOT_NAME`+`MUXVO_SHARED_ROOT` 隔离，绝不碰真老根。
