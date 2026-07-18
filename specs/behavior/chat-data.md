# chat-data（M5 聊天数据面）行为规格

> 状态：**v1-frozen**（2026-07-06 批0 独立裁决 GREEN，裁决记录 `~/Library/Caches/muxvo-build/logs/m5-batch0-verdict.md`；改动走修订流程）。
> 定位：**纯数据面**行为规格——项目/会话发现、元数据提取、详情投影、搜索、Codex 源、镜像/归档。
> 与 `chat-history.md`（三栏 UI 面）分界：本文件只管「JSONL/文件系统 → 四类型数据（ProjectInfo /
> SessionSummary / SessionMessage / SearchResult）」的转换语义；UI 渲染、气泡、markdown、live 推送
> 归 `chat-history.md`。live 数据流与分页游标见 `chat-history.md §7`。
> 权威来源（高→低）：跑起来的老 app → `muxvo-rs-kickoff/prd/`（449 REQ，重点 M08_CHAT_BROWSE /
> M09_CHAT_SEARCH / M10_CHAT_SYNC）→ `PRD.md` → 旧代码。
> 行为说明书来源（读行为不抄结构）：muxvo-legacy `src/main/services/` 下
> `chat-dual-source.ts`(838)、`codex-chat-source.ts`(490)、`chat-multi-source.ts`、`chat-archive.ts`、
> `chat-sync.ts`、`chat-watcher.ts`、`chat-sync-push.ts`、`jsonl-parser.ts`、`data-sync/{mirror,sync-state,sync-manager}.ts`
> + `src/shared/types/chat.types.ts`。行号引用均指 muxvo-legacy 该文件当前版本，是双跑 diff 红线。
> JSONL 逐行解析纪律（白名单/透传/坏行不抛错/尾行缓冲）共用 `specs/orchestration/jsonl-transcript.md`，
> 本文件只补聊天域的语义投影，不重复解析库契约。

## §0 定位与范围（scope note）

- **双源，砍 Gemini**：M5 用户已拍板只做 **CC（claude-code）+ Codex（codex）双源**。legacy 的
  `chat-multi-source.ts` 与 `chat.types.ts:9` `ChatSource='claude-code'|'codex'|'gemini'` 含 Gemini
  reader（`gemini-chat-source.ts`），M5 **不迁移 Gemini**：`ChatSource` 收敛为 `'claude-code'|'codex'`，
  多源聚合只接 CC + Codex 两 reader。`gemini-chat-source.ts` 只当反例参照，不进新代码。
  历史 Gemini 卡片徽记 `GM`（chat-history.md §3）保留 golden 字节冻结（加性改造不删既有 golden），
  但 live 数据面不产 gemini SessionSummary。**统一口径**：`GM` 徽记纯为既有 golden 字节保留，§5（Codex 源
  收敛）与 §8（双源 dump 面）均只出 CC/Codex——`gemini` source 永不出现在 live 或双跑输出。
- **数据面 ≠ 存储/索引选型**：本规格描述「读到什么、投影成什么」的**可观测语义**，不约束 M5 是否引入
  chat.db / 倒排索引 / 冷热分层。M5 实现（`MuxvoChatHistory` 纯函数层 + chat.db）只要在四类型输出面上
  与 legacy reader **逐字段可 diff**（§8 双跑 harness），内部结构一律不继承。
- **数据根隔离（严格）**：本仓库 dev 数据根 = `~/Library/Application Support/Muxvo2 Dev/`。镜像/归档一律
  落数据根内 `chat-history/`（§6）。**严禁**沿用 legacy 的 `~/.muxvo/chat-archive/`（chat-archive.ts:14）
  与 `~/Library/Application Support/Muxvo Dev/`（老版 dev）。CC 源目录 `~/.claude/projects/` 与 Codex 源
  `~/.codex/sessions/` 是**只读**输入，绝不写回。
  **唯一豁免（M7 升级迁移，legacy-migration.md）**：`~/.muxvo/chat-archive/` 允许作**一次性只读迁移源**
  （经 `DataDirectory.legacyMuxvoChatArchiveRootURL` 唯一派生、marker 门控、迁毕不再读）；仍严禁写入、
  严禁常驻读/watch。
- **cwd → projectHash 编码**：CC 的 projectHash = 目录名原样（CC 自己已把 cwd 编码进目录名）；Codex 无目录
  编码，由 reader 从 session_meta.cwd 现算 `cwd.replace(/[^a-zA-Z0-9-]/g,'-')`（codex-chat-source.ts:37-40）。
  两源同 cwd 必须产出**同一 projectHash**，才能在聚合层归并进同一项目（§5.3）。

---

## §1 CC 项目/会话发现

来源：`chat-dual-source.ts` `scanProjectsFromDir`(324-386) / `getProjects`(474-531) /
`getParentProjectHash`(36-39)。

### 1.1 项目扫描（scanProjectsFromDir）

- **projectHash = 目录名**：遍历 `~/.claude/projects/` 下每个子目录，目录名即 projectHash
  （324-331）。非目录项忽略（327）。
- **无 .jsonl 目录丢弃**：`jsonlFiles = files.filter(f => f.endsWith('.jsonl'))`；`jsonlFiles.length===0`
  → 该目录返回 null 被过滤（338-339, 382）。空目录/只含非 jsonl 的目录不产 ProjectInfo。
- **sessionCount** = jsonlFiles 数量（371）。**totalSize** = 所有 .jsonl 的 `stat.size` 之和，单个 stat
  失败按 0 计（342-345）。**lastActivity** = **目录** 的 `dirStat.mtimeMs`（不逐文件 stat 求最新，373）。
- **displayPath 从首个 session 读**：读 `jsonlFiles[0]` 前 **10** 行，取第一条能 `JSON.parse` 且含
  `obj.cwd` 的记录的 cwd 作 displayPath；读不到留空串（348-359）。
- **displayName fallback 规则**（361-365）：
  - `segments = projectHash.split('-').filter(s=>s.length>0)`；`fallbackName = segments[last]`（末段），
    segments 为空则 `fallbackName = projectHash`。
  - `displayName = displayPath ? (displayPath 按 '/' 切、去空、取最后一段 || fallbackName) : fallbackName`。
  - 即：有 cwd → 取 cwd 末段目录名；无 cwd → 取 projectHash 末段（`-` 分隔）。

### 1.2 worktree 归并（顺序敏感语义）

- **判定**：`getParentProjectHash(hash)` = `hash.indexOf('--worktrees-')`，`idx>0` 时返回
  `hash.slice(0, idx)`（父 hash），否则 null（36-39）。**worktreeLabel** = `--worktrees-` 之后的整段
  （getSessionsForProject:554 `wtHash.slice(lastIndexOf('--worktrees-')+len)`，如 `wt-1`/`worktree-10`）。
- **归并（getProjects:499-521，倒序遍历）**：对每个 worktree 子项目：
  - **父存在** → 把 worktree 的 `sessionCount` 累加进父、`totalSize` 累加、`lastActivity` 取 max，然后
    从列表 `splice` 删除该 worktree 条目（508-513）。父项目 sessionCount 因此 = 自身 + 各 worktree 之和。
  - **父缺失（父项目本身无 session）** → **remap**：把 worktree 条目的 projectHash 改写成父 hash，
    displayPath 去尾 `/\/.worktrees\/(wt|worktree)-\d+$/`，displayName 重取 displayPath 末段（514-519）。
    该条目**保留**在列表（不删），以父 hash 身份出现。
  - **顺序敏感**：倒序遍历 + splice 保证索引不失效；worktreeMap 记 `parent → [子 hash...]`（499-521），
    供 getSessionsForProject/readSession 回查 worktree 目录（§1.3）。
- **红线**：归并后列表里**不出现** `--worktrees-` 结尾的独立项目；worktree 的 session 必须能从父项目查到。

### 1.3 会话回查（worktree 目录）

- `getSessionsForProject`(538-582)：先扫父目录 CC 文件，再对 `worktreeMap.get(projectHash)` 的每个 worktree
  目录扫 .jsonl 并打 `worktreeLabel`（551-566）；archive 目录同 hash 也并入（569-579）。
- `readSession`(646-723)：CC 父目录文件不存在时，依次试各 worktree 目录 `<wtHash>/<sessionId>.jsonl`，
  命中即用（653-665）；再不存在落 archive（666-678）。

### 1.4 项目级 archive 合并（getProjects 编排层，倒序 worktree 归并之前）

- **执行位置**：`getProjects`(474-531) 先做 §1.1 扫 CC（scanProjectsFromDir(projectsDir)），**再扫
  archive/镜像目录**（scanProjectsFromDir(archiveProjectsDir)，483-484），合并后**才**做 §1.2 worktree 归并
  （499-521 在 483-496 **之后**）。archiveProjectsDir = M5 镜像根 `<dataRoot>/chat-history/`（§6.2，镜像同样
  是扁平项目结构）。
- **合并语义（Math.max，非累加、非会话去重）**（487-495）：对每个 archive 项目 ap——
  - **CC 已有同 projectHash** → `existing.sessionCount = Math.max(existing.sessionCount, ap.sessionCount)`
    （490-491）。**仅 sessionCount 取 max**；`totalSize`/`lastActivity`/`displayPath`/`displayName`
    **不动**（保持 CC 侧值，legacy 对这几项在本步不合并）。
  - **CC 无同 projectHash（archive 独有项目）** → 整条 `push` 进列表（493），以 archive 项目原样出现。
- **与会话级合并的不对称（红线，实现者必读）**：本节是**项目级** ProjectInfo 合并（Math.max sessionCount）；
  §2.4/§6.2 的 `(projectHash, fileName)` **CC 优先去重**是**会话级** SessionSummary 合并——两者语义不同，
  **不可**用会话级去重后的会话表反推 ProjectInfo.sessionCount（会与 legacy 的 Math.max 背离；sessionCount 是
  §8.1 双跑 diff 字段）。ProjectInfo.sessionCount 必须走本节 Math.max 口径独立算。
- **触发前提**：仅当 reader 挂了 archiveProjectsDir（镜像根）才触发；与 §6.2「reader 读取合并 = CC 源 + 镜像
  源」口径统一——双跑的 CC reader 若挂镜像，则项目级 Math.max 与会话级 archiveOnly 补标**同时**生效，别一边
  描述会话级 archive 合并、一边省项目级。

---

## §2 会话元数据（SessionSummary）

来源：`chat-dual-source.ts` `extractSessionSummary`(85-146) / `collectAndExtractSessions`(402-442)。
字段形状：`chat.types.ts:30-53`。

### 2.1 流式前 20 行

- `readFirstLines(filePath, 20)`（99）：createReadStream + readline，读满 20 行即
  `rl.close()+stream.destroy()`（62-79）——**不读全文**。逐行 trim，空行跳过；每行 try `JSON.parse`，
  失败静默跳过（102-130）。

### 2.2 title 规则（首条非内部 user 消息）

- 遍历前 20 行，找第一条 `obj.type==='user'`（109）：
  - `msgContent = obj.message?.content ?? obj.content`（111）。
  - `string` → rawContent 原样；`Array` → 只取 `b.type==='text' && typeof b.text==='string'` 的块，
    `.map(b=>b.text).join('\n')`（112-119）。**string 与 text 块数组双形态都要支持**。
  - `trimmedContent = rawContent.trim()`；非空且**不以下列前缀起头**才作 title（123）：
    `<command-message>` / `<local-command-caveat>` / `<teammate-message` / `<system-reminder>` /
    `Another Claude session sent a message:`。
    （注意 `<teammate-message` 无闭合 `>`，是前缀匹配。末一条 = CC 新版队友/agent 消息外壳，与 §3.3/§3.4
    投影层「YOU」修复同根——外壳形不该泄进用户可见的会话标题。）
  - `title = trimmedContent.slice(0, 100)`（**UTF-16 码元** 截 100），`break`（124-126）。
- **空 title 会话丢弃**：collectAndExtractSessions 对 summary `return summary.title ? summary : null`
  （435, 428），null 被过滤（441）。title 恒空（无非内部 user 消息）的会话**不进列表**。

### 2.3 startedAt / cwd / fileSize / lastModified

- **startedAt 赋值时机（红线）**：`if (!startedAt) startedAt = obj.timestamp || ''`（120）在**内部消息
  前缀判断之前**执行。即：即便该 user 消息是内部消息（被 title 跳过），它的 timestamp 仍会成为 startedAt。
  startedAt = **前 20 行内第一条 user 记录的 timestamp**，与 title 是否取自同一条无关。
- **cwd**：前 20 行内第一条含 `obj.cwd` 的记录的 cwd（106-108）；空则 `cwd || undefined`（144，undefined
  时该键在序列化中省略）。用于 resume 判定（source∈{cc,codex} 且有 cwd）。
- **fileSize** = `stat.size`（142，字节）。**lastModified** = `stat.mtimeMs`（92，毫秒浮点）。
  注意 collectAndExtractSessions 用 FileEntry.mtime 覆盖 lastModified（426），且命中缓存时也覆盖为
  当次 file.mtime（**426**；427 是 worktreeLabel 赋值，非 mtime）——lastModified 始终反映**当次扫描的
  mtime**，不吃 5 分钟缓存的旧值。**但命中缓存时只刷新 lastModified**：`fileSize`/`title`/`cwd`/`startedAt`
  仍取 5 分钟旧缓存（summaryCache）——单次 harness 内若同一文件在缓存窗口期增长，fileSize/title 可能滞后。
  双跑一般每会话重提取、风险低；但双跑 harness **须禁用或清空 summaryCache**，保 fileSize 与当次 stat 一致。
- **source** 恒 `'claude-code'`（143）。**worktreeLabel** 仅当来自 worktree 目录时置（433, 427）。
  **archiveOnly** 仅当该 session 只在 archive、CC 已删原文件时置 true（432）。

### 2.4 缓存与排序（列表口径）

- collectAndExtractSessions（402-442）：CC 与 archive 文件合并，**同 (projectHash, fileName) CC 优先**
  （408-414，archive 独有的补 `archiveOnly:true`）；按 mtime **降序** slice 前 limit（417-418）；再逐文件
  提取 summary（summaryCache TTL 5 分钟，425-434）。**先按 mtime 取 topN 再提取**——只对最近 N 个会话读头部。

---

## §3 详情投影（parseMessageLine 逐字规则）

来源：`chat-dual-source.ts` `parseMessageLine`(198-319) / `splitTeammateMessages`(169-196) /
`isProtocolJson`(154-163)。输出形状：`chat.types.ts:73-92`（SessionMessage）。
**这是 chat:get-session 的投影面；搜索面是它的超集（§4.3）。**

### 3.1 类型白名单

- 只认 `type ∈ {user, assistant, queue-operation}`（205）；其余（`summary` /
  `file-history-snapshot` / 未知）→ `return []` 忽略（205）。坏行 `JSON.parse` 抛错 → `return []`（316）。

### 3.2 内容归一化

- **queue-operation**：`content = typeof entry.content==='string' ? entry.content : ''`（顶层 content，
  非 message.content，208-210）。
- **user**：
  - `msgContent = entry.message?.content`。
  - `string` → 原样（213-214）。
  - `Array`：
    - **纯 tool_result 丢弃**：`blocks.length>0 && blocks.every(b=>b.type==='tool_result')` → `return []`
      （217-218）。这类 user 记录（工具回执）**不进详情**。
    - **含 image**（`blocks.some(b=>b.type==='image')`）→ 保留为块数组：只留 `text`/`image` 块，image
      映射 `{type:'image', source: b.source}`、text 映射 `{type:'text', text}`（219-230）。image **保留**。
    - 否则 → 取 text 块 `.join('\n')`，全无 text 则 `''`（232-235）。
  - `msgContent` 非 string/array 时落 `entry.content`（string）或 `''`（237-241）。
- **assistant**：`msgContent = entry.message?.content`，是 Array 直接透传为 content 块数组；否则试
  `entry.content`(Array) / `msgContent`(string) / `entry.content`(string) / `''`（243-254）。
  assistant 的 tool_use / tool_result / text / image 块**原样保留**给 UI（chat-history.md §4 渲染）。
  投影层透传全部原始块（含 thinking / 未识别块，raw JSONValue 保全）；其 **wire 呈现**（thinking 只取正文丢
  signature、未知块 → `unknown{blockType,rawJson}` 占位）由 `ChatWire` 换算 + UI 折叠，见 chat-history.md §7.10
  与 bridge-v1.md §9 v22——**投影层本身一行不动**（透传红线）。

### 3.3 system 重标（resolvedType）

初值 `resolvedType = type`（258）。以下命中改判 `'system'`：
- **queue-operation**：trimStart 后以 `<task-notification>` / `<system-reminder>` / `<command-message>` /
  `<command-name>` 起头 → system，否则 → **user**（260-273）。queue-operation 是「系统通知」或「用户打断」
  二选一。
- **user**：
  - `entry.isCompactSummary===true` → system（276）。
  - `entry.isMeta===true` → system（278-279）。
  - trimStart 后以 `<system-reminder>` / `<task-notification>` / `<command-message>` / `<command-name>`
    起头 → system（283-289）。
  - 正则 `/^(cd\s+|bindkey\s)/` 命中（Muxvo 注入的 shell 命令：cd+clear / cd+resume / bindkey）→ system
    （290-292）。
  - 以 `<teammate-message` 起头，**或**以 `Another Claude session sent a message:` 外壳起头**且**串内含
    `<teammate-message`（CC 新版把队友消息包在该外壳里注入，JSONL 落盘 role=user）→ **teammate 拆分**
    （293-302，见 §3.4）。`contains` 守卫：无 teammate 块的外壳（如某些 agent-message）不进拆分，避免被
    splitTeammateMessages 返 `[]` 吞掉整条。**红线：外壳形若漏判则归档查看器把队友消息标「YOU」（用户发送）。**
- assistant 永不改判（无对应分支）。

### 3.4 teammate 拆分（splitTeammateMessages）

- 触发：user 内容 trimStart 后以 `<teammate-message` 起头，或以 `Another Claude session sent a message:`
  外壳起头且串内含 `<teammate-message`（293）。外壳前缀由 `teammateBlockRegex` 落在 substring 之外，
  拆出的块自动剥离外壳文案。base 字段取 entry 的 `uuid/sessionId(∥ 参数 sessionId)/cwd/gitBranch/timestamp`（295-301）。
- 拆分（169-196）：正则 `/<teammate-message[^>]*>[\s\S]*?<\/teammate-message>/g` 抓出**每个** teammate 块；
  无匹配 → `return []`（173-175）。逐块：
  - 内层去壳 trim 后过 `isProtocolJson` → **纯协议块丢弃**（184）。`isProtocolJson`（154-163）：空串算协议；
    每行 trim 后 `JSON.parse().type ∈ PROTOCOL_TYPES` 才算协议，`PROTOCOL_TYPES =
    {idle_notification, teammate_terminated, shutdown_approved, shutdown_rejected}`（151）；任一行非法
    JSON 或非协议 type → 该块不是纯协议（保留）。
  - 保留块 → `{uuid: `${base.uuid}-tm${i}`（i=块序号）, type:'system', ..., content: **完整 `<teammate-message>`
    标签原文**}`（185-193）。content 保留整块含标签，供渲染器提取 name（chat-history.md §4：system 内含
    `<teammate-message>` 标记按 assistant 呈现、label `CLAUDE:{id}`）。

### 3.5 sidechain 不过滤

- parseMessageLine **不读 `isSidechain`/`sidechain` 字段**——sidechain（子代理会话）消息与主线消息
  一视同仁投影。**红线：不得在投影层引入 sidechain 过滤**（会与 legacy diff）。

### 3.6 结果与坏行

- 命中 → 单元素数组 `[{uuid(∥''), type:resolvedType, sessionId(entry.sessionId ∥ 参数),
  cwd(∥''), gitBranch, timestamp(∥''), content}]`（307-315）。teammate 拆分返回多元素（可 0 条）。
- **坏行静默跳过**：`JSON.parse` 抛错 → `return []`（316-318），不计数不上报（与 jsonl-transcript §2 的
  parseError 计数**不同**：详情投影层容忍脏行、不产错误事件）。
- **tail 读优化**：readSession 带 limit 且文件 > **2MB** 时从 `size-2MB` 起读，**跳过首（可能残缺）行**
  （684-689, 702-705）；最后 `slice(-limit)`（715-717）。tail 起点落在行中间导致的半行由 skipFirstLine 吞掉。

---

## §4 搜索语义

来源：`chat-dual-source.ts` `search`(729-828) / `extractSearchableText`(731-744)。输出：`SearchResult`
（chat.types.ts:95-104）。

### 4.1 匹配口径

- `q = query.toLowerCase()`（747）；`text.toLowerCase().includes(q)`（766）——**大小写不敏感、任意子串**
  （非分词、非前缀）。中文/emoji 按 JS 字符串子串匹配（UTF-16）。
- **只搜 user/assistant**：`obj.type!=='user' && obj.type!=='assistant'` 的行跳过（764）。
  queue-operation / summary / system-重标前的原始行都不搜。
- **extractSearchableText**（731-744）：`mc = obj.message?.content ?? obj.content`；`string` 原样；
  `Array` → 只取 `block.type==='text' && typeof block.text==='string'` 的 `block.text`，
  filter(Boolean).join('\n')。**tool_use / tool_result / image 块的文本不进搜索面**（只 text 块）。

### 4.2 命中/snippet/去重

- **每 session 首命中即停**：`found` 置位后 `rl.close()+stream.destroy()`，一个文件最多一条结果（759, 771-774）。
- **snippet**（767-770）：`idx = text.toLowerCase().indexOf(q)`；`slice(max(0,idx-30),
  min(len, idx+query.length+170))`——命中词前 **30**、后 **170** UTF-16 码元（总窗 ~200，命中词约在第 30 位）。
  截断按码元，可能切断代理对（§8 归一化处理孤代理）。
- **timestamp** = `obj.timestamp || ''` 原样（770，命中**那一行**的 timestamp，非会话级）。
- **去重**：`seenSessions` 以 `projectHash+'/'+sessionId` 去重（800-801）；先搜 CC 目录再搜 archive，
  **CC 先占位**保证同 session archive 不重复出（819-825）。search 用 `getParentProjectHash(dir.name) ∥
  dir.name` 归一 projectHash（787，worktree 归父）。

### 4.3 搜索面 ⊋ 详情投影面（红线）

- 搜索按**原始 JSONL 行**扫（extractSearchableText 直读 obj.message.content），**不经** parseMessageLine
  的丢弃规则。因此**详情投影层丢掉的行照样可搜到**：
  - 纯 tool_result user（§3.2 丢弃）→ 其中 text 块（若有）可搜（但纯 tool_result 无 text 块，实际不命中）。
  - isMeta / isCompactSummary / `<system-reminder>` / cd/bindkey 的 user（§3.3 重标 system 但仍是 user
    type）→ **可搜**（search 只看 `obj.type==='user'`，不看 isMeta）。
  - teammate 拆分的整块（§3.4）→ 原始 user 行 text 可搜。
  - **反例**：assistant 的 tool_use/tool_result 块文本详情**显示**但搜索**不命中**（extractSearchableText
    只取 text 块）——这一支是搜索面 ⊊ 详情面的部分，两面互不为真子集，合起来记：**搜索面覆盖被投影丢弃的
    user 行的 text，但不覆盖 assistant 非 text 块**。测试须双向锚定。

---

## §5 Codex 源

来源：`codex-chat-source.ts`(490)。API 镜像 CC reader，输出同四类型，`source='codex'`。

### 5.1 目录发现

- 根 `~/.codex/sessions/`；结构 `sessions/YYYY/MM/DD/*.jsonl`，`findAllSessionFiles`(204-245) 三层正则
  校验 `^\d{4}$`/`^\d{2}$`/`^\d{2}$`，每层读失败静默跳过。
- **sessionId 提取**（extractSessionId:43-52）：文件名 `rollout-YYYY-MM-DDTHH-MM-SS-{UUID}.jsonl`，去
  `.jsonl` 后按 `-` 切，取**末 5 段** join（UUID 5 组），不足 5 段用整 base。但 `_buildSummary`/index 优先用
  session_meta.payload.id（248-281, `entry.sessionId = meta?.id || sessionId`），**id 权威**。
- **projectHash**：无目录编码，由 `encodeProjectHash(cwd)` 现算（37-40，见 §5.3）。

### 5.2 文件格式与映射（parseCodexMessageLine）

Codex JSONL 每行 `{type, payload:{type,...}, timestamp}`。映射到 SessionMessage（88-172）：
- `event_msg`+`user_message` → `{type:'user', content: payload.message}`（空 message → null，102-113）。
- `event_msg`+`agent_message` → `{type:'assistant', content: payload.message(string)}`（116-127）。
- `response_item`+`function_call|custom_tool_call` → `{type:'assistant', content:[{type:'tool_use',
  name, input}]}`；name = payload.name ∥ payloadType；input = function_call?arguments:input；
  uuid = `payload.call_id ∥ codex-{sessionId}-tool-{i}`（138）。**注意**：call_id 存在时 uuid **无 `codex-`
  前缀**（直接是 call_id），故 chat-history §4 靠 `codex-` 前缀判 CODEX label 的逻辑对这类工具消息会**判空
  （落 CLAUDE label）**——per-source label 依赖 uuid 前缀，Codex 工具消息（有 call_id 时）是已知例外，
  label 面测试须锚定此支。
- `response_item`+`function_call_output|custom_tool_call_output` → `{type:'assistant',
  content:[{type:'tool_result', content: payload.output, tool_use_id: call_id}]}`（148-168）。
- **跳过**：session_meta / turn_context / token_count / reasoning / agent_reasoning 等 → null（170-171）。
- uuid 前缀 `codex-`（106, 119, 155）：UI 据此把 label 显示 `CODEX`（chat-history.md §4）。
- **session_meta**（readSessionMeta:55-85）：首行 `type==='session_meta'` 的 `payload.{id,cwd,timestamp}`
  供 cwd/id。

### 5.3 元数据与聚合

- **title**（_buildSummary:329-346）：`entry.title ∥ titles[sessionId]`；仍空 → `_extractFirstUserMessage`
  读首条 user_message slice(0,100)（458-483）；再空 → `sessionId` 兜底（**Codex title 永不空**，与 CC
  空-title-丢弃不同——记为**per-source 差异**，双跑按 source 各自口径）。
- **thread 标题**（getThreadTitles:190-201）：`~/.codex/.codex-global-state.json` 的
  `state['thread-titles'].titles[sessionId]`，5 分钟缓存。
- **startedAt** = `new Date(mtime).toISOString()`（341，非首条 timestamp，与 CC 不同）。
- **projectHash 编码统一（红线）**：`encodeProjectHash = cwd.replace(/[^a-zA-Z0-9-]/g,'-')`（37-40）。
  须与 CC 目录名编码一致，才能在多源聚合层按同 projectHash 归并进一个项目（chat-multi-source.ts:47-58）。
  CC 目录名是 CC 生成的既定编码——M5 须核对两者对同一 cwd 产同串（差异记 note 待裁决）。
- **search snippet 差异**：Codex search（407-455）snippet = `slice(start-30, start+query.length+30)`（后 **30**，
  非 CC 的 170），只搜 user_message，每 session 首命中即停，`results.length>=50` 截断。**per-source 主口径**：
  双跑对照按各源自身窗口，不强求 CC/Codex snippet 长度一致。

### 5.4 多源聚合（chat-multi-source）

- getProjects：各 reader 结果 flat，按 projectHash 归并（sessionCount 加、totalSize 加、lastActivity max），
  lastActivity 降序（39-63）。
- getSessions/getAllRecent：flat 后按 **sessionId** 去重（首现胜 = CC 优先），lastModified 降序 slice limit
  （65-107）。
- readSession：**CC 先，空则 Codex**（→ Gemini，M5 砍）（109-125）。
- search：各源 flat，`slice(0,500)`（127-134）。

---

## §6 镜像/归档

来源：`chat-archive.ts`（真实 fs 归档）/ `chat-sync.ts`（mtime 对比 + copy）/ `chat-watcher.ts`（增量触发）/
`data-sync/{mirror,sync-state,sync-manager}.ts`（DATA_L1 结构/策略**stub**，见 §6.3）。

### 6.1 mtime 秒级对比、仅增不删、copy 后写回源 mtime

- **秒级对比（LIVE 权威 = chat-archive.ts）**：镜像判据两侧 `Math.floor(mtimeMs/1000)`，**相等即跳过**，
  不等才 copy，镜像缺失记 0（必 copy）。生产**唯一接线路径 = chat-archive.ts**（index.ts:624-625
  `createChatArchiveManager`；判据在 chat-archive.ts:55-57 全量扫、115-118 增量）。`chat-sync.ts` 的
  `compareMtime`(27-34)/`createSyncManager`(39) 是**同模式的并行实现但无任何生产调用**（grep 实测零消费，
  与 `data-sync/*` 同为未接线骨架）——双跑取镜像基线**须以 chat-archive.ts 为准**，别误取 chat-sync.ts。
  秒级粒度避免坚果云/copy 的亚秒抖动误判。
- **copy 后写回源 mtime（幂等前提，实现口径）**：**`copyFile` 不保留源 mtime**——对抗实测（macOS + node，
  把源 mtime 回拨 1 小时后 `copyFileSync`）：目标 `mtimeMs` 取**复制时刻**而非源 mtime（`PRESERVED? false`），
  Swift `FileManager.copyItem` 同样不保。若 copy 后不干预，镜像 mtime=复制时刻，下一轮
  `floor(cc/1000) !== floor(mirror/1000)` 恒真 → **未变更文件每轮全量扫都重复 copy**，「秒级对比稳定/
  仅增不删」的幂等**不成立**（legacy chat-archive.ts 本身即有此隐患：85/120 行 `copyFile` 后无 `utimes` 回写）。
  **M5 实现口径**：copy 完成后**显式把镜像文件 mtime 写回源 mtime**（Swift
  `FileManager.setAttributes([.modificationDate: srcMtime])` 或 `utimensat`），使下轮秒级 `!==` 判据幂等
  （源未变→镜像 mtime==源 mtime→跳过）。全量扫（fullScan:73-97）逐目录递归 .jsonl；增量
  （archiveSession:102-127）单文件——**两路径均在 copy 后补写 mtime**。
- **与 legacy 行为的 diff 面（为何安全）**：双跑对照比的是**读者输出**（§8.1 四类型字段），**不比镜像目录逐
  文件 mtime**（§8.3 镜像面只比目录树存在性 + sync-state.json）。「copy 后写回 mtime」相对 legacy「copy 不
  写回」只改变**镜像文件自身的 mtime 属性**（legacy 会反复 copy，M5 幂等跳过），对 reader 读出的
  SessionSummary/SessionMessage **零影响**——故此偏差不进双跑 diff 红线，安全。
- **仅增不删（sync-only-no-delete）**：镜像只 copy、**从不删**（data-sync/sync-manager.ts:41-54 明确策略；
  archive/sync 无 delete 分支）。源删掉的 session 镜像仍留 → reader 合并时以 `archiveOnly:true` 标记
  （§2.3），resume 不可用但可浏览。
- **增量触发链**（chat-watcher.ts:29-49）：`watch(~/.claude/projects, {recursive})`，只认 `.jsonl`；
  从 filename 尾两段取 `projectHash=parts[-2]`、`sessionId=parts[-1] 去 .jsonl`；per-key **500ms 去抖**后
  推 `chat:session-update` 事件 + 调 onSessionUpdate 回调（archive 据此增量 copy）。启动全量扫延迟
  **3s** 避与列表加载抢 I/O（chat-archive.ts:130-140）。

### 6.2 新版数据根 chat-history/（严禁 ~/.muxvo）

- legacy 归档写死 `~/.muxvo/chat-archive/<projectHash>/<sessionId>.jsonl`（chat-archive.ts:14，**镜像 CC
  的 projects 扁平结构**）。**M5 改**：镜像落 `<dataRoot>/chat-history/`，dataRoot =
  `~/Library/Application Support/Muxvo2 Dev/`。**严禁 `~/.muxvo`**，严禁老版 dev 根（CLAUDE.md 数据隔离）。
  唯一豁免见 §1「数据根隔离」（M7 升级迁移一次性只读源，行为规格 legacy-migration.md）。
- reader 读取合并：CC 源（`~/.claude/projects/`）+ 镜像源合并，**同 (projectHash, fileName) CC 优先**
  （collectAndExtractSessions:408-414），镜像独有的补 `archiveOnly`。合并键 = **(projectHash, fileName)**，
  fileName = `<sessionId>.jsonl`。

### 6.3 sync-state.json / DATA_L1_06 结构（stub 实据 + 裁决 C 已落定）

**验证结论（zero-consumption stub，非产物）**：`data-sync/mirror.ts` `getMirrorStructure()` 返回静态结构
描述符 `files:['chat-history/sync-state.json', 'projects/{project-hash}/project-info.json',
'sessions/{session-id}.jsonl', 'history-index.jsonl']`；`data-sync/sync-state.ts` `getSyncStateSchema()`
返回静态 schema `{lastSync: ISO string, fileMtime: Record<string,number>}`；`data-sync/sync-manager.ts`
是**内存态**策略骨架（sourceSessions/mirrorSessions 字符串数组、sync-only-no-delete、只读降级文案
「无法写入数据目录，历史备份已暂停」、文件锁 retry），**无任何 fs 写**。

- grep 实据：`getMirrorStructure`/`getSyncStateSchema` **非自引用消费者 = 0**（仅被自身/测试引用）；
  `data-sync/sync-manager.ts` 无 copyFile/mkdir/writeFile。→ **DATA_L1_06 期望的
  `project-info.json`/`history-index.jsonl`/`chat-history/sync-state.json` 结构在 legacy 从未被任何代码
  真正写出**；真实归档产物是 `~/.muxvo/chat-archive/<hash>/<session>.jsonl` 的扁平结构。DATA_L1_06 与
  legacy 真实产物**不一致**（同 CHAT_L1_13/14 stub-only 先例）。
- **裁决 C（2026-07-06 批0 独立裁决，`m5-batch0-verdict.md`）——M5 镜像落盘结构定版**：
  - **镜像正文 = CC 同构扁平结构** `chat-history/<projectHash>/<sessionId>.jsonl`（与 §6.2 一致）：
    批1/批2 reader 用**同一份代码**读 live-CC 与镜像（只是 base 目录不同），零结构翻译层。
  - **`sync-state.json`：真物化**，格式沿 `{lastSync: ISO, fileMtime: {相对路径→mtimeMs}}`（sync-state.ts
    schema），落 `<dataRoot>/chat-history/sync-state.json`，AtomicFile 原子写。**定位 = 记录/断言面，
    非同步游标**——同步幂等判据唯一权威是 §6.1 的「源 vs 镜像文件 mtime 秒级对比」（文件系统自身即游标，
    sync-state.json 损坏/删除不影响同步正确性，自愈）。消费者：DATA_L1_07 spec-runner 断言 +
    同步条 `chatSyncStatus.lastSyncMs` 来源（chat-history.md §7）+ 双跑镜像面对照（§8.3）。
  - **`project-info.json` / `history-index.jsonl`：砍**——legacy 零消费 stub，内容均为 reader 输出的
    派生死缓存（无消费者、易腐），物化=继承负债（核心原则一）。**DATA_L1_06 翻牌口径**：冻结 spec 文件
    字节不动，spec-runner 测试断言**实况结构**（`chat-history/<hash>/<sid>.jsonl` + `sync-state.json`，
    无 project-info/history-index），偏差记 status.json note（同 CHAT_L1_15 Tier-B 先例）——批2 A2-2 执行。

### 6.4 只读降级与文件锁

- 镜像目录不可写 → 进 `readonly` 模式，warning「无法写入数据目录，历史备份已暂停」，不 crash、不阻塞
  UI（sync-manager.ts:41-46, 88-90）。文件被锁（正在写）→ `syncFile` 返回 `{skipped:true,
  retryOnNextSync:true}`，下轮重试（98-103）。M5 沿此策略（DATA_L1 期望）。

### 6.5 中心化共享归档池（dogfood-r5 W-A，登记⑨兑现登记⑦；本小节纯增，§6.1~§6.4 字节不动）

镜像的**每数据根隔离**（§6.2 `<dataRoot>/chat-history/`）是登记⑦「跨分身归档不互通」的根因。dogfood-r5 把镜像
写向 + 读回换指**所有 Muxvo 分身共用的中心化共享归档池**——CC 30 天清理后，任一分身归档过的会话，其余分身永久
可见/可搜/可续聊。

- **路径权威**：`DataDirectory.sharedChatHistoryRootURL()` = `<sharedRoot>/chat-history/`，唯一权威派生
  （ChatMirror/ChatRestore/ChatArchiveMigrator 一律经此，绝不字面量拼路径，§6.2 同纪律）。覆盖缝（解析后过
  `enforceLegacyRootGuard` 老目录守卫）：env `MUXVO_SHARED_ROOT`（**绝对路径**，测试/e2e 隔离；非 `/` 开头 = 配置
  错误 fatalError 显性挂）> Info.plist `MuxvoSharedRootName`（Application Support 下目录名，app.sh
  `MUXVO_SHARED_ROOT_NAME` 可选透传，空视同缺省）> 默认 `<applicationSupport>/Muxvo Shared`。**sync-state.json 与
  迁移 marker 留 per-分身**（各分身 `<dataRoot>/chat-history/sync-state.json` 与 `<dataRoot>/state/` marker，互不
  干扰）。
- **原子写与 temp 契约（多写者加固）**：共享池被多分身并发镜像同一 CC 源，`ChatMirror.copyOne` 改经
  `ChatFileOps.atomicCopy`——copy 前 stat 源 mtime → 写 temp `.tmp-<destBasename>.<UUID>`（**不以 `.jsonl` 结尾**，
  scanner/迁移天然不见）→ setAttributes 源 mtime → POSIX `rename(2)` 同卷原子替换；失败尽力删自家独占 temp。
  `fullScan` 可写分支末尾清扫 `.tmp-*.<UUID>` 且 mtime>1h 的孤儿 temp（写者崩溃在 rename 前遗留）——**严格只碰
  自家 temp 命名、绝不碰 `.jsonl` 归档载荷**，故此清扫**不违「仅增不删」**（清的是非归档中间物）。
- **双写者终态收敛（三条论证）**：① **同内容后到者胜**——两分身镜像同一源，rename 原子替换，最终态是完整文件
  （无半文件）；② **旧盖新自愈**——若旧内容 temp 晚到覆盖新内容，下一轮秒级 `floor(mtime)` 判据 `!=` 重新 copy，
  收敛到最新源；③ **读者永见完整文件**——rename(2) 原子性保证读者要么见旧完整、要么见新完整，绝无半写中间态。
- **一次性迁移（`ChatArchiveMigrator`，warmup 先于一切 reconcile）**：首次启动把 per-分身 legacy 镜像
  （`<dataRoot>/chat-history/`）的会话搬进共享池——逐 `<legacy>/<subdir>/*.jsonl`（只认 `.jsonl` → sync-state 天然
  不进池；只扫子目录 → top-level 不碰）：dest 缺失 → 原子拷（保 legacy mtime）；dest 存在 → 纯函数 `shouldReplace`
  判 `(floor(mtime/1000), size)` 字典序 **src 严格大于 dest 才替换**（新者胜；秒同则大者胜；相等/更旧跳过）。零硬
  失败才原子写 marker（`<dataRoot>/state/chat-archive-migrated.json`，存在即短路 no-op）；有失败不 seal → 下次重跑，
  已搬 dest 经 shouldReplace 相等即跳（compare-skip 幂等）。**marker per-分身**是关键：首分身 seal 只封自己，其余
  分身各自迁移自己的 legacy 镜像（否则漏迁）。迁移**不受 archiveEnabled 门控**（关档也须把历史迁进共享库）。
- **删除语义修订（仅增不删的边界收窄）**：§6.1「仅增不删」自此**限定为 ChatMirror 同步自身**（同步永不主动删
  镜像）。用户**显式硬删**一个会话（登记②）扩为**三根硬删**：CC 源 `~/.claude/projects/` + 共享池 + **本分身 legacy
  镜像** `<dataRoot>/chat-history/`（换根后 legacy 不再是主镜像，但删除须一并清本分身旧副本，否则删后本分身 reader
  仍见）+ chat.db 缓存行。三根拍板 2026-07-07。
- **已知限制（本批不修，登记待后批）**：① **跨分身删除复活**——A 分身删共享池某会话后，B 分身若其 CC 源未清、
  下轮 fullScan 会把它重新镜像进池（镜像仅增不删 + CC 源仍在）；根除需「删除墓碑」机制。② **首启空窗**——迁移在
  后台 warmup 跑，大库首次迁移期间面板可能短暂查不全（一次性成本，进度横幅覆盖）；机制细化（对抗验收 MINOR-2 补
  注）：迁移 partial 期若 reconcile 先行，旧根 mirror 行被 prune、新根文件未齐 → archiveOnly 会话**详情**短暂
  miss（列表因前台 reconcile:false 读旧行不空窗），下轮 warmup 收敛。③ **休眠分身按需迁移**——迁移
  在该分身**下次启动 warmup 时**才跑，长期不开的分身其 legacy 独有会话在它启动前不进池。④ **~18GB legacy 回收**
  ——旧 per-分身镜像本批**保留不删**（天然全量备份 + 回滚垫），~18GB 冗余回收归后批。⑤ **迁移两写者 TOCTOU
  （对抗验收 MINOR-1 登记）**——两分身同刻首迁 + 同会话 legacy 内容分叉 + 该会话 CC 源已清（archiveOnly）+ 双方
  均 stat 到 dest 缺失时，旧版副本可能后到胜出且无 CC 源可供 fullScan heal → 池内该会话为偏短转写（有效文件、
  非损坏）。复合条件极窄，登记不修；后批 legacy 清理/合并 CLI 时顺带按 (mtime,size) 复核收敛。

---

## §7 CD_* 案例池（spec↔test 1:1 命名池）

> 素材 = 手工构造 JSONL fixtures + 老 app 真会话脱敏样本。每条红线 ≥1 案例；四大陷阱 + teammate/image/
> queue-operation/多语言搜索/worktree/mirror/cwd-fallback 全覆盖。断言可测、双跑 diff 红线。
>
> **机器兜底闸（M5 批1 起）**：下方「已实装池」表（`| 用例名 | 断言 |`）由 `tools/spec-coverage/check.mjs`
> 消费（preflight 步骤 7），逐名断言在 `app/Tests`/`web/tests` 至少出现一处同名测试，缺失即红（正向缺失红、
> 反向多出不红）。批2+ 尚未实装的 I/O 面案例落文末「批2+ 待接池」表（表头 `待接用例名`，闸天然不收 →
> 不强制），实装后把该行移进「已实装池」表即纳入闸。

### 已实装池（批1 纯函数面 + Codex 源；spec-coverage 强制 1:1）

| 用例名 | 断言 |
|---|---|
| CD_project_no_jsonl_dropped | 目录无 .jsonl → 不产 ProjectInfo（§1.1） |
| CD_project_displaypath_from_cwd | displayPath 取首 session 前 10 行首个 obj.cwd；displayName = cwd 末段 |
| CD_project_displayname_fallback_hash | 无 cwd → displayName = projectHash `-` 分隔末段 |
| CD_worktree_merged_into_parent | `--worktrees-` 子项目归父：父 sessionCount = 自身+子之和，列表无独立 worktree 条目 |
| CD_worktree_parent_missing_remap | 父无 session → worktree 条目 remap 成父 hash + displayPath 去 `.worktrees/wt-N` 尾 |
| CD_worktree_label_preserved | worktree session 的 SessionSummary 带 worktreeLabel（`--worktrees-` 后整段） |
| CD_project_archive_merge_max | 同 projectHash CC+archive 并存 → ProjectInfo.sessionCount = Math.max(cc, archive)（非累加、非会话去重）；archive 独有项目整条并入；totalSize/lastActivity 保持 CC 值（§1.4） |
| CD_summary_empty_title_dropped | **陷阱①**：无非内部 user 消息 → title 空 → 会话不进列表 |
| CD_summary_title_skip_prefixes | title 跳过 `<command-message>`/`<local-command-caveat>`/`<teammate-message`/`<system-reminder>` 起头 |
| CD_summary_title_skip_another_claude_wrapper | title 跳过 `Another Claude session sent a message:` 外壳队友消息；全外壳 → title 空丢弃 |
| CD_summary_title_text_block_form | user content 为 text 块数组时 title 取 text join('\n') 截 100 |
| CD_summary_started_before_internal | **红线**：startedAt = 前 20 行首条 user 的 timestamp，即使该条是被跳过的内部消息 |
| CD_summary_filesize_mtime | fileSize=stat.size（字节）、lastModified=当次扫描 mtimeMs（不吃缓存旧值） |
| CD_summary_msgnull_falls_back_toplevel | message.content 为 JSON null（A1-1 呈 NSNull，非缺席）→ title 回落顶层 content（legacy nullish `obj.message?.content ?? obj.content`；NSNull 视同缺席）；空串非 nullish 不回落 |
| CD_detail_type_whitelist | 只投影 user/assistant/queue-operation；summary/file-history-snapshot/未知忽略 |
| CD_detail_pure_toolresult_dropped | **陷阱②**：user content 全 tool_result → 该消息不进详情 |
| CD_detail_image_preserved | user content 含 image → 保留 text+image 块，image 映射 {type,source} |
| CD_detail_queueop_user_vs_system | queue-operation：内容起头协议标签 → system，否则 user |
| CD_detail_ismeta_iscompact_system | isMeta / isCompactSummary 的 user → 重标 system |
| CD_detail_cd_bindkey_system | `/^(cd\s+|bindkey\s)/` 的 user → 重标 system（Muxvo 注入命令） |
| CD_detail_sidechain_not_filtered | **陷阱③**：isSidechain 消息不被过滤，与主线一致投影 |
| CD_detail_bad_line_skipped | 非法 JSON 行静默跳过、不产错误事件、不中断后续行 |
| CD_teammate_split_individual | `<teammate-message>×N` 拆成 N 条 system，uuid `-tm{i}`，content 保留整块含标签 |
| CD_teammate_protocol_block_dropped | 纯 idle_notification/teammate_terminated/shutdown_* 块被丢弃 |
| CD_teammate_another_claude_wrapper | `Another Claude session sent a message:` 外壳形队友消息 → 拆分为 system（不误判 user/YOU） |
| CD_teammate_wrapper_no_block_not_dropped | 外壳前缀但无 teammate 块（非 isMeta）→ 不误路由丢弃，保留 user |
| CD_search_substring_case_insensitive | toLowerCase 任意子串命中；大小写不敏感 |
| CD_search_chinese_emoji | 中文/emoji 子串命中（UTF-16） |
| CD_search_only_user_assistant | 只搜 user/assistant 的 text；queue-operation 及被重标为 system 的原始 user/queue-op 行不搜（CC JSONL 无 raw `system` type，system 是 resolvedType） |
| CD_search_snippet_window | snippet = 命中前 30 + query + 后 170（CC，UTF-16 码元） |
| CD_search_one_hit_per_session | 每 session 首命中即停，一文件最多一条结果 |
| CD_search_superset_of_detail | **陷阱④关联**：被详情丢弃的 user 行（isMeta/system-reminder/纯 tool_result 的 text）仍可搜到 |
| CD_search_summary_ignored | summary 类型行永不进搜索面（type 白名单外） |
| CD_codex_mapped_same_shape | Codex event_msg/response_item → 同 SessionMessage 四类型；uuid `codex-` 前缀；有 call_id 时 uuid = call_id（无前缀） |
| CD_codex_tool_no_callid | function_call 无 call_id → uuid `codex-{sid}-tool-{i}`；name 缺失兜底 payloadType |
| CD_codex_tool_empty_callid | call_id 为空串 → uuid 兜底 `codex-{sid}-tool-{i}`（legacy `payload.call_id \|\| ...` 真值语义，非保留空串） |
| CD_codex_custom_tool | custom_tool_call 取 payload.input（对象结构保真）；custom_tool_call_output → tool_result |
| CD_codex_tool_result_output_preserved | tool_result 的 output 为数组/对象 → content 原样保结构（legacy `(payload.output as string) \|\| ''` 真值语义：真值原样、falsy→""），不 `as? String` 丢成空串 |
| CD_codex_skip_and_empty | session_meta/token_count/reasoning/turn_context 跳过；空 user/agent message / 无 payload → nil |
| CD_codex_title_never_empty | Codex title 兜底 sessionId（与 CC 空-title-丢弃差异，per-source 口径） |
| CD_codex_title_from_first_user | 无 thread-title 但有 user_message → title = 首条 user 截 100 |
| CD_codex_title_thread_wins | thread-titles.titles[sessionId] 优先于首条 user |
| CD_codex_meta_id_authoritative | sessionId = meta.id（权威），非文件名末 5 段 |
| CD_codex_readsession_end_to_end | 全 rollout 逐行投影，cwd 来自 meta，lineIndex 计入被跳过/非空行；limit 取尾 N |
| CD_codex_readsession_bad_line_skipped | 坏 JSON 行静默跳过、后续行照常、lineIndex 仍前进 |
| CD_codex_getprojects_group_by_cwd | 同 cwd 聚一项目，count/totalSize 累加，lastActivity=max mtime，source=codex |
| CD_codex_search_snippet_and_scope | 命中 user_message 出结果；agent_message 不搜；snippet 后 30；命中行 timestamp |
| CD_codex_search_first_hit_per_session | 一 session 首命中即停，一文件最多一条 |
| CD_codex_search_chinese | 中文子串命中，snippet 原文保真 |
| CD_codex_search_snippet_window_30 | Codex snippet 前 30 后 30（非 CC 的后 170） |
| CD_codex_search_snippet_clamps_start | 命中靠头 → from clamp 到 0 |
| CD_codex_session_meta_parse | session_meta 投影 id/cwd/timestamp；非 meta → nil |
| CD_codex_iso_millis | mtime 毫秒 → JS `toISOString` 同格式（3 位毫秒 + Z，UTC） |
| CD_codex_projecthash_matches_cc | 同 cwd 下 Codex encodeProjectHash == CC 目录名编码，聚合归并同项目（**已验证一致，红线断言**：批0 裁决对本机 134 个真实 CC 目录交叉核对 132/132 逐字符命中，含 `_`/`.`/中文/空格/`&`/worktree；2 条表面 mismatch 系 worktree-remap 的 cwd 取值假象非编码分歧，见 `m5-batch0-verdict.md`。唯一未覆盖边角 = emoji 代理对，NIT 级） |
| CD_codex_projecthash_emoji_surrogate | emoji 代理对逐 UTF-16 码元映射双 dash（无 u-flag replace 字节等价，NIT 复刻 JS） |
| CD_codex_sessionid_last5_groups | 文件名末 5 段拼 UUID sessionId，不足 5 段用整 base |
| CD_codex_dir_discovery | 只收 sessions/YYYY/MM/DD 下 .jsonl，非法层级与非 jsonl 跳过 |
| CD_codex_dir_missing_empty | sessions 目录不存在 → 空数组，不抛错 |
| CD_codex_isdigits | 三层长度精确的 ASCII 数字段校验 |
| CD_mirror_mtime_second_compare | 两侧 floor(mtime/1000) 相等即跳过，不等才 copy；镜像缺失记 0 必 copy（§6.1，批2 A2-2） |
| CD_mirror_copy_writes_back_mtime | copy 后镜像 mtime 写回源 mtime（copyItem 不保 mtime）；连跑两轮第二轮 copy 数 = 0（幂等，§6.1/§8.3，批2 A2-2） |
| CD_mirror_data_root_not_dotmuxvo | 镜像落 `<dataRoot>/chat-history/`（经 DataDirectory 布局派生），绝不写 `~/.muxvo`（§6.2，批2 A2-2） |
| CD_mirror_readonly_degrade | 镜像根不可写 → readonly + warning「无法写入数据目录，历史备份已暂停」，不 crash、不 copy（§6.4，批2 A2-2） |
| CD_syncstate_schema | sync-state.json = {lastSync: ISO, fileMtime: {相对路径→mtimeMs}}；round-trip + 损坏/缺失自愈（§6.3，批2 A2-2） |
| CD_detail_tail_read_skip_first | 文件 >2MB 带 limit → 从 size-2MB 起读、跳首残行、投影后 slice(-limit)（§3.6，批2 A2-1；messages 文件直读） |
| CD_search_dedup_cc_priority | 同 (parentHash,sessionId) CC+mirror 只出一条，CC 先占位（§4.2，批2 A2-1；search chat_search_lines 去重） |
| CD_multisource_readsession_cc_first | readSession CC 有则用 CC，空才落 Codex（§5.4，批2 A2-1；messages 回查次序） |
| CD_mirror_cc_priority_merge | 合并键 (projectHash, fileName)，CC 覆盖同键镜像（reader 合并面，§6.2，批2 A2-1） |
| CD_mirror_add_only_no_delete | 仅镜像存在的 session → reader 合并标 archiveOnly（reader 合并面，§6.1/§2.3，批2 A2-1；镜像仅增不删写入面由 A2-2 非池名测试兜底） |
| CD_dirmemo_plan_initial_full | 登记⑩：DirFactMemo 初始计划 .full（首轮必全量），消费一次性、二次 .delta(空) |
| CD_dirmemo_hit_once_change_dirty | 登记⑩：命中 (dirName, dirMtimeMs) compute 只调一次；mtime 变重算 + 置脏 |
| CD_dirmemo_equal_fact_not_dirty | 登记⑩：mtime 变但 fact 值等价不置脏（memo 层）；新 mtime 落缓存 |
| CD_dirmemo_hot_window_no_cache | 登记⑩：热窗（<2s）不落存每次真算；未来 mtime（钟回拨）同落热窗 |
| CD_dirmemo_sweep_absent | 登记⑩：sweepAbsent 逐出不在枚举集的缓存键 + 置脏 |
| CD_dirmemo_restore | 登记⑩：restore 回灌——delta 并回脏集、full 复位（reconcile 失败不静默丢脏） |
| CD_dirmemo_request_full | 登记⑩：requestFull → 下轮 .full 且吞掉脏集（force 道完成后自愈） |
| CD_dirmemo_scan_equivalence | 登记⑩：scanner 带/不带 memo 输出全等（含 worktree/无 .jsonl 目录）；二扫命中仍全等 |
| CD_dirmemo_hit_short_circuit | 登记⑩：命中真短路取证——目录 mtime 复原后新增文件不可见（设计内），mtime 前进后可见 + 置脏 |
| CD_dirmemo_dir_vanish_and_cleared | 登记⑩：整目录删除 → facts 不含 + sweep 置脏；.jsonl 清空 → nil 哨兵 + 置脏 |
| CD_dirmemo_base_missing_sweep_all | 登记⑩：base 不可枚举 → 空 facts + 全部置脏（对齐「mirror 空清陈旧行」，晚一轮） |
| CD_dirmemo_store_first_full | 登记⑩：ChatStore 非 force 首轮必全量 reconcile（初始 .full） |
| CD_dirmemo_store_steady_skip | 登记⑩：稳态池零变化 mirror 道整体跳过（幽灵行存活锚）；cc 道同轮照常 |
| CD_dirmemo_store_delta_precise | 登记⑩：脏目录下轮 delta 对账、未变目录零触碰（consume 先于扫描的排序不变式） |
| CD_dirmemo_store_force_requestfull | 登记⑩：force 道恒全量 + 完成后 requestFull → 下一轮非 force 亦 .full 自愈 |
| CD_dirmemo_store_vanish_cleanup | 登记⑩：整目录消失 → sweep 置脏 → 下轮 delta 清 mirror 行 + chat_projects 行 |
| CD_dirmemo_store_nil_memo_full | 登记⑩：memo 不注入（dump/双跑/测试）非 force 也恒全量（原行为零变） |
| CD_delta_matches_full | 登记⑩：delta 四态（增长/新增/回退/文件消失）终态与全量 reconcile 逐行等价（applyFileState 单一来源） |
| CD_delta_untouched_dir | 登记⑩：delta 非脏目录零触碰（不 SELECT 不比对，脏目录照常对账） |
| CD_delta_source_isolation | 登记⑩：mirror delta 整目录删除不碰同 dirName 的 cc 行（source 分道） |
| CD_livepage_full_walk_equals_wire_sort | 登记⑪：对抗矩阵（孪生/mirror-only/空 title/worktree/跨组同 sid/codex 重叠）全翻页 ≡ 老路径 wire 排序切片；非末页满页 |
| CD_livepage_cc_mirror_pair_cc_wins | 登记⑪：孪生对出 cc（archiveOnly 缺席）；组内 cc last-wins = dir_name 字节序最大（反相关插入序取证，非 rowid）；emit 在胜者自身键位 |
| CD_livepage_mirror_only_archive_only | 登记⑪：仅 mirror 行 → archiveOnly=true；mirror first-wins = dir_name 字节序最小（反相关插入序取证，非 rowid） |
| CD_livepage_untitled_fallback_visible | 登记⑪：空 title 行生产面可见且 title=titleFallback（includeUntitled:true 口径） |
| CD_livepage_worktree_label_and_dirset | 登记⑪：项目面含 worktree 子目录会话（label 保留、outputProjectHash 恒入参 hash），全翻页 ≡ oracle |
| CD_livepage_dirset_excludes_foreign_rows | 登记⑪：组外（异项目）同 sid cc 行不遮蔽项目面 mirror 行（filter 先于 dedup） |
| CD_livepage_cross_parent_same_sid_max_lm_wins | 登记⑪：跨 parent 组同 sid → 组胜者中 lm 大者胜（含 archiveOnly 面） |
| CD_livepage_mtime_tie_page_boundary_no_dup_no_loss | 登记⑪：全同 mtime tie 串跨页界无重无漏；跨组 tie 只出一条（确定化偏差①） |
| CD_livepage_codex_overlap_suppressed | 登记⑪：codex 同 sid 被 CC 压制；独有 codex 按键位穿插 |
| CD_livepage_codex_first_wins_dedup | 登记⑪：codex 内部同 sid 原生序首现胜（双向变体：首现低 lm 与首现高 lm 皆首现胜），跨页游标不复活 |
| CD_livepage_cursor_beyond_end_empty | 登记⑪：合法但越界游标 → 空页 + hasMore=false（老 `idx ?? count` 等价） |
| CD_livepage_cursor_row_deleted_resumes | 登记⑪：游标行被删后续页 = 删除后 oracle 严格后继切片（keyset 抗删） |
| CD_livepage_hasmore_exact_page_multiple | 登记⑪：总数恰为页长整数倍 → 末页满页且 hasMore=false |
| CD_livepage_underfill_continuation | 登记⑪：同 (lm,sid) 败者簇 >批K 强制多批续取，胜者不被批边界吞掉（三元续批键） |
| CD_index_open_idempotent_reopen | 登记⑪：重开库幂等补建三索引；user_version 恒 2 不触发删表重建（行保留） |
| CD_livepage_window_uses_index | 登记⑪：两种窗口形态 EXPLAIN 走目标索引且无 TEMP B-TREE（防退化全表扫+排序） |
| CD_autogroup_disabled_by_default_zero_change | §10：policy nil（默认）→ projects/sessions/allRecent 输出与引入前全等（dump/双跑面保护锚） |
| CD_autogroup_relpadhq_merged_into_target | §10：`--relpadhq-` 系目录条目折叠进 RelPad 目标（count/size 累加、lastActivity max、列表无独立条目） |
| CD_autogroup_tmp_relpad_patterns | §10：`-T-relpad-`/`-tmp-relpad-`/`-private-tmp-relpad-` 三类 TMPDIR 模式均命中归组 |
| CD_autogroup_target_dynamic_case_insensitive_old_relpad_excluded | §10：目标=displayName 小写 == "relpad" 且自身不命中规则；old_RelPad 不被吸、不作目标 |
| CD_autogroup_no_target_synthetic_bucket | §10：无 RelPad 条目 → 合成桶（hash=muxvo-autogroup-relpad，displayName=RelPad）承接归组 |
| CD_autogroup_sessions_dirset_and_label | §10：sessions(目标 hash) 查得规则目录会话，且会话带来源标签（规则 token 后整段） |
| CD_autogroup_messages_lookup_in_rule_dir | §10：messages(目标 hash, sid) 能在规则目录中回查到会话文件 |
| CD_autogroup_allrecent_outputhash_normalized | §10：allRecentSessions 中规则目录会话 projectHash 归一为目标 hash |
| CD_autogroup_penraft_rules | §10：`-T-penraft-` 系渲染 job 目录折叠进 Penraft 目标，多组与 relpad 并行互不串，会话带 `render-job-*` 来源标签 |
| CD_codex_worktree_merged_into_parent | §10 fix A：Codex `--worktrees-wt-N` 项目并入父条目（老缺陷=漏成独立「wt-N」项目） |
| CD_codex_worktree_sessions_query_parent | §10 fix A：sessions(父 hash) 查得 Codex worktree 子会话且带 worktreeLabel |
| CD_livepage_autogroup_dirset_codex_children | §10：liveSessionsPage 项目面 dirSet 含规则目录、Codex 子 hash 扩查；isAll 归组键走 normalize |

### 批2+ 待接池（I/O 面 / chat.db / 镜像；尚未实装，spec-coverage 不强制）

> 表头 `待接用例名`（非 `用例名`），机器闸天然不收 → 不强制。批2 实装其测试后，把该行整条移进上方
> 「已实装池」表即纳入 1:1 兜底。

| 待接用例名 | 断言（批次） |
|---|---|
| （批2 认领项已全部移入上「已实装池」表；批5 FTS 预筛等后续待接项续填此表） | — |

---

## §8 双跑 harness 契约

> M5 验收核心（批2）：新版 `MuxvoChatHistory` dump 与 legacy reader dump **逐字段 diff**。本节冻结 dump
> 输出形状与归一化规则，供 harness 消费。

### 8.1 输出面（legacy 四类型字段名）

新版 dump 每条记录用 **legacy 字段名**（chat.types.ts），不引入新命名：
- **ProjectInfo**：`projectHash, displayPath, displayName, sessionCount, totalSize?, lastActivity, source`。
- **SessionSummary**：`sessionId, projectHash, title, startedAt, lastModified, fileSize, source,
  customTitle?, cwd?, archiveOnly?, worktreeLabel?`。
- **SessionMessage**：`uuid, type, sessionId, cwd, gitBranch?, timestamp, content`（content = string ∣
  AssistantContentBlock[]，块字段 `type,text?,name?,input?,content?,tool_use_id?,source?`）。
- **SearchResult**：`projectHash, sessionId, snippet, timestamp`。
- **注（customTitle 非 reader 产物）**：`customTitle` 列在 SessionSummary 形状里，但由上层（终端命名/重命名）
  注入，`extractSessionSummary` **从不写它**（grep 实测 reader 零写点）——纯 reader dump 恒不含 customTitle
  （§8.2 规则 4 省略），无双跑 diff 风险；批1 数据面**不读/不产** customTitle，勿误以为要读它。

### 8.2 归一化规则（两侧对称施加后再 diff）

1. **排序**：项目/会话按 `(projectHash, sessionId)` 字典序；消息按文件内出现序（**不排序**，投影顺序即红线）；
   搜索结果按 `(projectHash, sessionId)` 排序（消除并发扫描顺序抖动）。
2. **mtime floor 到 ms**：lastModified/lastActivity 取整数毫秒（丢浮点尾数）；镜像相关对比另按秒级
   （§6.1）——两口径分列，不混。
3. **孤代理归一**：snippet/title/content 文本里未配对的 UTF-16 代理码元 → `U+FFFD`（§4.2 按码元截断可能
   切断代理对，归一后再比）。
4. **undefined/nil 键省略**：值为 undefined/null 的可选键（totalSize/customTitle/cwd/archiveOnly/
   worktreeLabel/gitBranch）在序列化中**省略该键**，不写 `null`（对齐 legacy 的 `cwd||undefined`
   等语义，144）。**source 不在此列**（见规则 5）。
5. **source 必填对齐**：CC 恒 `claude-code`、Codex 恒 `codex`——两 reader 实际恒赋值（chat.types.ts 类型上
   虽 `source?` 可选，运行时永不缺）；缺 source 视为差异，**不省略、不视作可选键**。

### 8.3 per-source 主口径

- 双跑**按源分别对照**：CC 新版 vs CC legacy reader、Codex 新版 vs Codex legacy reader，各自 diff。
  **不**跨源强求一致（snippet 窗口 CC 170 / Codex 30、title 兜底 CC 空丢弃 / Codex 兜底 sessionId、
  startedAt CC 首条 timestamp / Codex mtime——均 per-source 差异，各比各的）。
- 聚合面（multi-source 归并/去重/排序）单独一组对照，输入用两源已对齐的 dump。
- 镜像面对照：给定同一 CC 源快照，跑一轮 sync 后比**镜像目录树存在性 + sync-state.json**（§6.3 裁决 C
  已定：无 project-info.json/history-index.jsonl 对照项）。**不逐文件比 mtime**——镜像文件 mtime 是 M5「copy 后写回
  源 mtime」(§6.1) 的实现细节，非红线字段。**幂等断言**改用「连跑两轮 sync，第二轮 copy 数 = 0」（源未变时
  §6.1 写回使秒级 `!==` 恒假），而非直接断言镜像 mtime 值。

---

## §9 CHAT_L1_18 双击跳终端（引用裁决）

裁决记录：`~/Library/Caches/muxvo-build/logs/m5-batch0-chat18-adjudication.md`。
数据面结论（与本文件相关部分）：跳转「对应终端」的 cwd 来源 = SessionSummary.cwd（§2.3）；「对应」= 按
session cwd 前缀匹配现有终端。跳转/续聊的 UI 状态机与文案见 `chat-history.md §7.7`。数据面只保证
SessionSummary.cwd 可用且与 resume 判定一致（source∈{cc,codex} 且 cwd 非空）。

---

## §10 生产自动归组（分叉面；2026-07-16 用户拍板「归并进 RelPad 项目」）

> 背景：RelPad hub（launchd 常驻）用 `claude -p` 在用完即删的临时目录起自动会话
> （`~/.relpadhq-assistant/triage-N`、`$TMPDIR/relpad-<purpose>-<rand>` 等），目录删了但
> `~/.claude/projects/` 会话记录残留并被镜像进共享池（实测 897 目录中 521 个 relpad 系）——每个
> cwd 编码目录成一条独立「项目」撑爆列表。临时目录已删无法 git 反查 → 按 hash 路径模式归属。
> 连带修复 fix A：Codex 源项目列表原不做 §1.2 worktree 归并，`<repo>/.worktrees/wt-N` 的 Codex
> 会话漏成独立「wt-N」条目（跨源合并按精确 hash，CC 侧同 hash 已并入父后对不上）。

- **分叉边界（§8 红线不动）**：策略经 `ChatStore.init(autoGrouping:)` 注入，**默认 nil = 全关**，
  一切输出与引入前逐字节相同（`CD_autogroup_disabled_by_default_zero_change` 锚死）；生产装配
  `ChatAssembly.make` 传 `.standard`，dump/双跑（ChatStoreReader）不传——与登记⑥/⑪「生产 live 面与
  dump 面刻意分叉」同先例。`ChatProjectMerger`（§1 冻结 legacy 对齐面）零动，策略独立
  `ChatAutoGrouping.swift`。
- **多分组结构（2026-07-16 penraft 扩展）**：策略 = `[Group]`，每组自带规则表+目标名+合成桶；hash
  命中多组时**首组胜**（组序即优先级）；`.standard = [relpad, penraft]`，新增后台工具项目追加一组即可。
- **规则表（hash 子串/前缀匹配）**：
  - `Group.relpad`：`contains "--relpadhq-"`（~/.relpadhq-* 全族）、`contains "-T-relpad-"`（系统
    TMPDIR）、`prefix "-tmp-relpad-"`、`prefix "-private-tmp-relpad-"` → 目标 `relpad`。
  - `Group.penraft`（Penraft 本地 HTML 渲染器 2026-05 存量：$TMPDIR/penraft-render/job-* 每渲染一篇
    起一次 claude）：`contains "-T-penraft-"`、`prefix "-tmp-penraft-"`、`prefix "-private-tmp-penraft-"`
    → 目标 `penraft`。
  已知取舍：路径里恰含这些 token 的无关项目会被误吸（个人 dogfood 工具接受，规则表常量可改）。
- **目标解析（逐组）**：候选（CC 归并面 + Codex 原生面）中「自身不命中任何组 且 displayName 小写 ==
  组目标」者取 lastActivity 最大（tie → hash 升序）；`old_RelPad` → "old_relpad" 天然不吸不作
  目标。无目标 → 该组合成桶（`muxvo-autogroup-relpad`/「RelPad」、`muxvo-autogroup-penraft`/「Penraft」）。
  颜色圆点 keyed on projectHash → 锚定目标 hash 自动稳定。
- **归组语义**（fix B）：projects() 跨源合并后，命中条目 sessionCount/totalSize 累加、lastActivity
  max 进目标（同 §1.2 累加式）；sessions/messages/delete 的目录回查集在 projectHash==目标时并入
  规则目录；allRecent/search/livePage-isAll 的 outputHash 归一 = 先规则后剥 worktree
  （两分支不相交：规则目录不含 `--worktrees-`）；会话卡来源标签 = 规则 token 后整段
  （如 `assistant-triage-6229`），复用 worktreeLabel 渲染，web 零改。
- **fix A 语义**：policy 在场时 Codex 项目列表过 `ChatProjectMerger.merge(cc:codex, archive:[])`
  （archive 空 → §1.4 no-op，仅 §1.2 worktree 归并）；sessions/livePage 项目面对 Codex worktree
  子 hash（parentProjectHash == 请求 hash）逐个 `getSessionsForProject` 扩查并 remap+打标签——
  `CodexSessionSource` 公开签名零动（§8.3 per-source dump 面稳）。
- **性能**：规则匹配 O(目录数×4) 子串判断；候选来自已扫 facts + memoized Codex index；零新增
  git/文件 I/O。

---

## 冻结面修订需求登记（本规格不直接改，登记待裁决/实现批兑现）

> 沿 `terminal-session-restore.md`「冻结面修订需求登记」先例：v1-frozen 正文**字节不动**，新增能力/语义在此登记，
> 由实现批兑现 + 独立裁决复核。M5-R1 批2（MuxvoChatHistory 域）落地①②③；④仅登记待装配批兑现。

1. **ChatRestore 会话回填反向通道（M5-R1「超 30 天回填续聊」，新增 `ChatRestore.swift`）**——CC 默认按 mtime
   清 30 天前 `~/.claude/projects/**/*.jsonl`，清后 `--resume` 失效。§6 的 ChatMirror 已把每条会话单向镜像进
   `<dataRoot>/chat-history/<projectHash>/<sid>.jsonl`（§6.1 仅增不删）；jsonl 自包含（首行 sessionId/cwd），
   回填单文件即可 resume。**写向不变式并立**：ChatRestore 是仓内**唯一被允许写 `~/.claude/projects`** 的反向
   通道，恒 `镜像 → CC` 单向；与 §6.1「sourceRoot 绝不写回」（ChatMirror 恒 `CC → 镜像`）分道，各自单向、互不违背。
   语义边界：① sessionId 严格 UUID 白名单（SEC-M3 同口径 `TerminalRestoreGate.isValidSessionId`，防路径注入）；
   ② 定位 = 枚举 mirrorRoot 一级子目录（sorted 确定序）首个含 `<sid>.jsonl`（UUID 全局唯一、子目录名原样保留即
   与 CC 同构，worktree 子目录名自然对应）；③ **dest 已存在绝不覆盖** → `alreadyPresent`；镜像找不到先查 CC 是否
   已在（在→`alreadyPresent`）再 `archiveMissing`；④ **回填后刷 mtime=now**——镜像 mtime 被 §6.1「copy 后写回源
   mtime」刷成旧源 mtime（可能 >30 天），不刷则 CC 下轮 30 天清理据旧 mtime **立即又删**；副作用 = dest 与镜像秒级
   mtime 不再等 → ChatMirror 下轮 fullScan 再镜像一次（内容逐字节恒等，无害，注释已登记）；⑤ 幂等（重跑
   `alreadyPresent`），任何 I/O 异常 → `failed(描述)`。案例：`ChatRestoreTests`（restored 逐字节相等 / dest 不覆盖 /
   archiveMissing / mtime≈now / 幂等二跑 / 自动建缺失目录 / worktree 目录名保留 / 非 UUID 拒绝）。

2. **会话硬删 `ChatDatabase.deleteSession`（用户拍板 2026-07-07，两处物理正本删）**——用户主动删一个会话时，硬删
   **CC 源文件 + 镜像文件**两处正本（文件系统双侧 `removeItem`）+ chat.db 缓存行。本批交付**数据层 DB 原语**：
   `deleteSession(sessionId:)` = `DELETE FROM chat_sessions WHERE session_id=?`，`chat_search_lines` 靠 schema 的
   `ON DELETE CASCADE`(+`foreign_keys=ON`) 随删；session_id 是 UUID 全局唯一，删所有匹配行（同会话 cc+mirror 缓存
   行一并清）；返回是否真删了行（删不存在 → false no-op，幂等）。文件系统双侧 removeItem 与响应/事件装配归装配层。
   **与 §6.1「仅增不删」不冲突**：仅增不删约束的是**镜像同步**永不主动删镜像文件；用户主动硬删是独立于同步的显式
   操作（删「这条会话不要了」的两处正本 + 缓存），非同步误删。案例：`ChatDatabaseDeleteTests`（删后 sessions 不含 +
   search_lines CASCADE 物理消失 + 删不存在 no-op）。

3. **`ChatMirror.fullScan` 进度回调 `onProgress`（§6.1 fullScan，行为恒等加性）**——装配层要「同步中 N/M」进度条
   时传入。两段化：先收集「需 copy 清单」（total 先知）→ 再逐个 copyOne，每处理一项回调 `(processed, total)`；
   **processed = 已处理项数（copied+skipped），末帧 processed==total**（供进度条推完成），与 `SyncResult.synced`
   （仅 copied，§8.3 幂等口径不变）分列；0 任务时回调一次 `(0,0)`。**返回值/落盘（sync-state）逐字段与无回调跑
   恒等**（既有 `ChatMirrorTests`/双跑镜像面 §8.3 零改动全绿）。节流不在此层（装配层做），回调保持纯粹。案例：
   `ChatMirrorTests`（进度单调到 total / 0 任务 (0,0) 末帧 / 带不带回调 SyncResult 逐字段恒等）。

4. **`archiveEnabled` 归档开关（仅登记，待装配批兑现）**——用户可关闭聊天历史归档：`archiveEnabled=false` 时
   **停排新的归档同步任务**（不再调 `fullScan`/`archiveSession`），**查询面（reader 四查询）不受影响**（仍读现有
   CC 源 + 已有镜像 + Codex，历史可查）。定位 = 装配/生命周期层的调度开关，与 §6.4「只读降级」**正交**（只读是
   环境不可写的被动降级 + warning；archiveEnabled 是用户主动停归档），非数据原语——故本批不落代码，登记待装配批
   （agent D / 后续批）兑现 + 独立裁决复核。

5. **Codex 源扫描治理（P0 CPU 风暴修复 m5/r1-fix1，2026-07-08 真机取证定谳）**——修前四因子相乘成 264% CPU
   稳态（FSEvents 监整棵 `~/.codex` × refresh 无在飞去重 × prime 每次 3 遍全量重读 × forEachLine 整文件
   grapheme 急切 split），Codex 桌面版根目录家务写（sqlite WAL/models_cache/global-state.bak）即可触发。四钉子：
   ① **触发面 = 读者可观察面精确覆盖**：`ChatSourceWatcher.isCodex` 只认 `sessions/` 子树（含目录本身）+
   `.codex-global-state.json` 精确匹配（`.bak` 不算）；FSEvents 订阅面保持 `~/.codex` 根（分类层过滤）。legacy
   对 `~/.codex` 完全无监视（chat-watcher.ts 只监 CC 且只认 .jsonl），本触发链为 M5 批3 新发明，收窄无 legacy
   偏离。② **refresh/warmup 单飞+合并**：在飞（含 warmup）期触发只置 pending（reprimeCodex OR 合并、**零围栏
   帧**），收尾后至多补跑一次；围栏帧严格成对（syncing→终态）；`archiveBackfill` 刻意不进槽（不携 prime、用户
   显式触发）。③ **prime per-file 增量缓存契约（`CodexIndexCache`，memo 侧；reader struct 恒无缓存、双跑
   「每会话重提取」路径不变）**：键 =(path, mtime_ms, size)，命中免重读；**「同 (path,mtime,size) 改内容不生效」
   为设计内行为**（与 ChatIndexer 未变跳过同口径；rollout 追加型写必增 size）；title/storedSid 不入缓存、每次
   prime 用 fresh titles 派生（global-state 变化不陈旧）；删除文件随新表自然逐出。④ **`CodexFile.forEachLine`
   字节化**：字节级按 0x0A 切行（= legacy Node `split('\n')` 码元语义；CRLF 边缘由 grapheme「\r\n 单字符不切」
   改为切开，**向 legacy 对齐**——真实 rollout 无 CRLF，双跑真数据 89/89 零 diff 佐证）+ `.mappedIfSafe` +
   真早停；行切分/trim/空行跳过/早停语义钉子见案例。mmap 对追加型写安全；缩短改写理论 SIGBUS，真实写型无此
   路径（登记备查）。性能：chat-dump index 真库（333 文件/626MB）36,375ms → 677ms。案例：
   `ChatRefreshStormTests`（T1 触发面 / T2 单飞合并×3）、`CodexPrimeCacheTests`（缓存契约黑盒 + 读计数×2 +
   titles 陈旧防治 + 增删逐出）、`CodexFileLineTests`（CRLF + 行语义八钉子）；双跑 fixture 78/78 + 真数据
   89/89 diff=0。

6. **空 title 会话可见性兜底 `title_fallback` + `includeUntitled`（dogfood-r4 问题5，2026-07-10）**——真实用户
   反馈「历史聊天里好多会话看不到/一片空」：根因 = §2.2「空 title → 会话丢弃」把「首条真 user 是内部消息、正文
   只有 assistant/summary」的会话整条隐藏。修（**生产 live 面与 dump/双跑面刻意分叉**）：
   - **提取层（`extractMeta`，仍限前 20 物理行）**：除 title/startedAt/cwd 外多算 `titleFallback` 链——①首条
     `type=="summary"` 记录的 `summary` 字段非空 → utf16Prefix(100)；②否则首条 assistant 非空 text 块 join →
     prefix(100)；③仍空留 ''。产物写 **新列 `title_fallback`**（chat.db schema **v1→v2**，版本不识→删表重建的
     既有机制自动兜；`title` 列保 legacy 纯度不写 fallback）。`SessionSummaryExtractor.extract`（nil 门控版，
     dump/双跑专用）**一字不动**——两处从此刻意分叉（生产要可见+可读、双跑要与 legacy 逐字节等，天然背离）。
     `ChatRecordReading` 加 `summaryText`（协议扩展默认 nil，mock 零破坏；真 SessionRecord 暴露顶层 `summary` 键）。
   - **查询层（`ChatQueryService`/`ChatStore.sessions|allRecentSessions` 加 `includeUntitled: Bool=false`）**：
     false（dump/双跑，含 `muxvo-chat-dump` 不传）= 丢空 title + 有效 title=裸 title（**双跑面零变化**）；true
     （`ChatQueryEngine` 生产调用点 + export 反查 `sessionTitle` 传）= 保留空 title 会话 + 有效 title=
     `title.isEmpty ? titleFallback : title`。growSession 重读条件仍看**裸 title**（title 空就随增长继续尝试
     升级真 title/fallback，行为自然正确）。keyset 分页口径不变（有效 title 兜底后非空，仍 nextCursor 判终止）。
   - **web 末道兜底**（`convert.sessionToScreen`，live-only）：`title || '(无标题)'`——native fallback 链也空时
     绝不渲染空标题卡片。案例：`ExtractMetaFallbackTests`（三态+优先级）、`StoreIncludeUntitledTests`（双口径+
     schema v2 入库+双空）、`GrowRereadTests`（增长升级 title/fallback）、`ChatAssemblyTests` wire 级空 title 可见、
     `chat-live-convert` '(无标题)'。

7. **跨分身归档镜像不互通（已知缺口，本批不修，登记待独立批）**——每个测试分身/数据根各有独立 `chat-history/`
   镜像与 `chat.db`；A 分身归档的会话不进 B 分身的镜像（镜像源恒为 live `~/.claude/projects`，是全局共享的，但
   30 天清理后各分身只保留自己扫到过的镜像正本）。现象：多分身长期并用时，某会话原文件被 CC 清理后，只在「当时
   开着并归档过它的那个分身」的镜像里留存，其余分身查不到该历史。定位 = 归档镜像的**每数据根隔离**设计副作用，
   非本批 title 可见性范畴；修法（跨根共享镜像 / 中心化归档池）涉及数据目录布局重构，登记待独立批裁决。

8. **displayPath 备忘 `DisplayPathMemo`（dogfood-r4 问题5 附带，性能）**——`ChatDirectoryScanner` 每次 `scan()`
   对每目录首 .jsonl 读前 10 物理行取 cwd 作 displayPath；面板每查询 + 每 FSEvent reconcile 都重扫 → 同文件反复
   小读。加 `DisplayPathMemo`（`final class`+NSLock，键=首 .jsonl `(path,mtimeMs,size)`）→ 命中免重读；cc/mirror
   scanner 共用一实例（`ChatAssembly.make` 装配注入 `ChatStore`）。dump/双跑/测试不注入 → 每次真读，零行为变。
   **「同 (path,mtime,size) 内容变更不生效」为设计内**（对齐 `CodexIndexCache` 先例；会话追加型写必增 size 自然
   失效）。案例：`DisplayPathMemoTests`（命中 compute 只调一次 / 变 mtime 重算）。

9. **中心化共享归档池（dogfood-r5 W-A，⑦之修法兑现；⑦原文一字不动，本条即其兑现）**——⑦「跨分身归档镜像不
   互通」定位的根因（镜像每数据根隔离）由本批换根根治：`ChatStore.mirrorBase` 与 `ChatMirror.mirrorRoot` 换指
   `DataDirectory.sharedChatHistoryRootURL()`（所有分身共用；sync-state 与迁移 marker 留 per-分身），`ChatAssembly.make`
   加**必填 `sharedArchiveRoot`**（编译期强制调用方显式决定，防测试污染真实池第一道防线；e2e 传 tmp 隔离根 +
   precondition 第二道防线）。首启经 `ChatArchiveMigrator` 把 legacy 镜像一次性迁进池（marker per-分身、
   `(floorSec,size)` 新者胜、compare-skip 幂等重入、warmup 先于一切 reconcile 且**不受 archiveEnabled 门控**）；
   `ChatRestore` `mirrorRoot`→**`mirrorRoots` 按序**（池优先、legacy 兜底 firstMatch）；`delete` 扩为**三根硬删**
   （CC 源 + 池 + 本分身 legacy）。原子写（temp+rename(2)）+ 孤儿 temp 清扫 + 双写者终态收敛（三条论证）保多分身
   并发镜像同源安全。行为/路径权威详见**新增 §6.5**；已知限制（跨分身删除复活 / 首启空窗 / 休眠分身按需迁移 /
   ~18GB legacy 回收）§6.5 登记待后批。live 归档横幅文案同步改「已自动归档到共享归档库（所有 Muxvo 分身共用）永久
   保留」（golden 静态兜底 `ChatHistoryScreen` 字节不动，chat-history.md live 登记）。案例：`ChatSharedPoolWiringTests`
   （装配级经 make：迁移先于 reconcile 因果 + delete 三根）、`ChatRestoreTests` 多根按序、`ChatStoreQueryTests` 换根
   reconcile 重入、`ChatArchiveMigratorTests`（四象限 + marker 幂等 + sync-state 不进池）、`ChatMirrorTests`（temp
   命名 + 原子覆盖 + 孤儿清扫 + 并发双写者收敛）、`DataDirectoryTests`（覆盖缝三层 + 相对路径拒绝 + marker 落点）。

10. **镜像池目录事实备忘 `DirFactMemo` + mirror delta 对账（聊天扫描风暴根治，2026-07-14 真机采样定谳）**——
    ⑨共享池被 legacy 归档回收（2026-07-12）灌到 ~600 目录/12.3 万 .jsonl 后，`ChatStore.facts()` 每查询/每
    refresh 的 mirror 全量逐文件 stat（裸内核 walk 1.24s）在 live CC 持续写盘（FSEvents → refresh 背靠背）下
    成 ~150% CPU 稳态风暴（两分身各一，采样热点 stat 2300/getattrlistbulk 964）。修（**§1.1 正文字节不动，
    纯缓存，查询语义零变**）：
    - **`DirFactMemo`（仿⑧ DisplayPathMemo：final class+NSLock，`ChatAssembly.make` 注入）**：键 =
      `(dirName, 目录 mtimeMs)`，命中免整目录 listdir+逐文件 stat（含 nil 哨兵 = 无 .jsonl 目录）。**只注入
      mirror scanner**——正确性前提 = 池内唯一写原语 atomicCopy temp+rename(2)/removeItem **必更目录 mtime**
      （跨分身写者同路）；live CC 原地 append 不动目录 mtime，**cc 侧禁注入**（注入即漏更新）。
    - **热窗（racy-clean，仿 make/git）**：目录 mtime 距 now < 2s 不落存（每次真算）——防扫描与 rename 同 ms
      竞态致条目永久 stale；带符号比较，未来 mtime（钟回拨）恒落热窗只降性能。
    - **per-目录脏集合 + `consumePlan()`（初始 .full → 此后 .delta(脏集)，空集 = mirror 道整体跳过）**：重算
      产出与缓存不等/首见/消失（`sweepAbsent` 扫尾）→ 置脏。消费方 `ChatStore.facts(reconcile:forceMirror:)`
      **consume 先于扫描**（排序不变式：fs 持久，mark 早于 consume 的变更必被 consume 后的扫描看到；本轮扫描
      新脏留待下轮，≤1 刷新周期延迟且仅 mirror 行 = archiveOnly 面，无感）。失败 `restore()` 回灌不静默丢脏。
    - **`ChatIndexer.reconcileMirrorDelta(facts:dirtyDirs:)`**：只 SELECT/比对脏目录行（per-file 三态与全量
      共用 `applyFileState`，语义单一来源）；facts 不含的脏目录 = 整目录消失 → 删行（CASCADE）+ chat_projects
      行。非脏目录零触碰——替代每轮 `SELECT *` 12.3 万 mirror 行建字典。
    - **调用面**：`ChatQueryEngine.refresh` → `store.reconcile(forceMirror: false)`（memo 计划道）；warmup/
      archiveBackfill 保持默认 force 全量 + **成功后 `requestFull()`**（二者不进单飞槽，与 refresh 并发时旧
      facts 快照后到可复活已删行且 memo 已缓存新态不再 miss——下轮全量重校自愈，低频代价一轮）。dump/双跑/
      测试不注入 memo → 恒全量，零行为变。
    - **设计内（登记备查）**：①「目录 mtime 复原 + 内容变」不生效（池内无此写型，取证测试
      CD_dirmemo_hit_short_circuit 演示）；② DirFact 全字段等值判定（含 dirMtimeMs）→ 纯 mtime bump（孤儿
      temp 清扫）多一轮无谓 delta，保守无害；③ base 整体不可枚举 → 陈旧行清理晚一轮生效；④ 幽灵行若落
      **从未被缓存**的目录名（fs 上从不存在），refresh 道永不触碰——由 force 道（warmup/backfill）全量清；
      同族变体（对抗验收 MINOR-1）：目录在热窗内新生（<2s 未落存）即被**整目录**删除 → sweepAbsent 逐不到
      （不在 cache.keys）→ 其行滞留到下次 force/重启（真实 delete 走单文件 removeItem 留空目录 = nil 哨兵
      置脏，不走此路；池目录整删本不发生，触发面极窄）。
    案例：CD_dirmemo_*（memo 单元 7 + scanner 集成 4 + ChatStore 计划门控 6）+ CD_delta_*（indexer delta 3），
    全部已入上方「已实装池」表纳 1:1 闸。
11. **`liveSessionsPage` 生产 paged 下推（⑪欠账兑现，2026-07-14；原欠账 = `sessions/allRecentSessions`
    每次面板查询 `SELECT * FROM chat_sessions WHERE source IN ('cc','mirror')` 全量捞 ~12.7 万行内存过滤
    排序，100~300ms/次 + 瞬时内存，触发面 = 用户交互与 chatSessionUpdate 后 web 复取）**——修 = 把 wire 层
    keyset 分页（游标 `mtimeMs:sessionId`、pageSize 50）下推进数据层新路径（**光下推 LIMIT 无效**：生产
    调用原为 `limit:.max` + wire 内存切片）：
    - **分叉边界（⑥先例同款：生产 live 面与 dump/双跑面刻意分叉）**：新增 `ChatStoreLivePage.swift`
      `liveSessionsPage(projectHash:after:pageSize:)`（恒 includeUntitled:true），仅 `ChatAssembly.sessionsPage`
      消费；**老路径零逻辑动**（fetchCCSessionRows/sessions/allRecentSessions/ccDedupSummaries 及
      ChatQueryService 协议）= dump/双跑 oracle 面（includeUntitled:false）与 delete/export 反查照旧全量
      （用户显式操作低频，登记设计内残余）。等价由 CD_livepage_full_walk_equals_wire_sort（新路径全翻页 ≡
      老路径 + 退役前 wire 排序切片）钉死。
    - **索引（`ChatDatabase.ensureIndexes`，open 时幂等补建，刻意不 bump user_version=2）**：
      `idx_chat_sessions_mtime_sid (file_mtime_ms, session_id)` / `idx_chat_sessions_sid (session_id)` /
      `idx_chat_sessions_dir_mtime_sid (dir_name, file_mtime_ms, session_id)`。老库升级首开原地建索引
      （12.7 万行 ~0.3-1s 一次性）；老查询面遍历序不变（source 不在任何索引首列、SELECT * 非覆盖 → 恒全表
      rowid 序）。**窗口/点查/EXISTS 四处 SQL 均 `INDEXED BY` 钉计划**——无 ANALYZE 时 planner 实测会选
      UNIQUE 自动索引 (source=?) + temp 排序，序扫 + LIMIT 早停全毁（EXPLAIN 取证入闸）。
    - **语义保真（§2.4/§6.2 逐条对齐，Swift 侧裁决不进 SQL）**：CC 窗口 = keyset 谓词 + ORDER BY
      (file_mtime_ms, session_id, id) DESC + LIMIT 批（项目面 per-dir 流 + k 路归并，不用 `IN + 全局
      ORDER BY` 防 temp sort）；每候选行 sid 组点查 → 组内 cc last-wins/mirror first-wins/仅 mirror 标
      archiveOnly——**「先后」= 老 fetchCCSessionRows 实际迭代序 = UNIQUE 自动索引
      (source, dir_name, session_id) 序（对抗验收 MAJOR-1 EXPLAIN+运行时探针定谳，非 rowid 序），组内
      sid 恒等 → cc 胜者 = dir_name 字节序最大行、mirror 胜者 = 最小行（UTF-8 memcmp 对齐 SQLite
      BINARY，同 (source,dir,sid) UNIQUE 唯一无并列，全确定）**；isAll 二级坍缩 = 各组胜者
      取 lm 最大；codex 先原生序 sid 首现去重再滤窗，EXISTS 压制（项目面限 dirSet——组外行不遮蔽，
      老「filter 先于 dedup」语义）。emit 判定用**键判定**（候选 ∈ 该 sid 合格胜者集）+ 请求内 sid
      seen-set + wire 游标严格 (lm,sid) 后继三件套闭合跨页；**内部续批键 = (lm,sid,rowid) 三元**（cc/mirror
      孪生行同键簇跨批界不吞胜者）。sortKeyMs 截断单一来源 `ChatStore.liveSortKeyMs`（排序/encode/compare/
      下推谓词四处同键）。
    - **设计内偏差**：①二级坍缩 lm tie（同 sid 跨组同 mtime）从老不稳定排序任意序**确定化**为首扫组胜；
      ②组内 last-wins 胜者可为 mtime 较低行，emit 在胜者自身键位（老路径同，输出序按胜者 lastModified）；
      ③升级首开建索引一次性代价；④delete/export 反查仍走老全量路径；⑤collation 混用登记（对抗验收
      MINOR-3）：CC 段 SQL 比较用 BINARY、codex 窗滤/归并用 Swift String 序——sid 实为小写 UUID
      （纯 ASCII）两序恒等，非 ASCII sid 属理论面。
    - 取证：12 万行合成库老路径全捞 1510.9ms → 新路径 6.2ms/页（debug 构建，~250×）；语义交叉锚前两页
      逐项一致。案例：CD_livepage_*（等价主锚 + 去重/可见性/项目面/二级坍缩/codex/游标边界/续批 13 例）+
      CD_index_open_idempotent_reopen + CD_livepage_window_uses_index，全部已入上方「已实装池」表纳 1:1 闸。
