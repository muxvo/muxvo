# 磁盘会话 JSONL 脱敏样本（M5 批1 A1-1）

素材源 = 本机 `~/.claude/projects/` 真实 CC 会话（只读采样）的**结构**，按 M4a SEC-15 脱敏纪律处理：
**字段名/嵌套结构/类型保真**，用户名/真实路径/敏感正文替换为 `REDACTED*` 占位或通用示例
（`/Users/dev/...`、`SR-fixture-session-*`）。无任何真实用户名、绝对路径、密钥、正文。

供 `MuxvoTranscriptTests`（SR_/SC_）与 `MuxvoChatHistoryTests`（CD_）回放复用。经 `#filePath`
相对定位读取（样板同 `RecordedFixtureReplayTests`）。

## 覆盖矩阵

| 文件 | 覆盖 |
|---|---|
| `cc-session-covering.jsonl` | summary 行 · ISO ts（含小数秒/整秒两式）· isSidechain=true · 纯 tool_result user · isMeta+`<system-reminder>` · isCompactSummary · queue-operation · file-history-snapshot · image 块 · text 块数组 · teammate-message · 中文 + emoji · thinking 块 |
| `cc-session-search.jsonl` | 搜索面：中英文 + emoji 的 user/assistant text · summary · 纯 tool_result（搜索面丢弃锚点） |

## 红线

- 已有 fixture **即截即冻结**：不重生成、不改字节（改内容 = 破 SR_/SC_/CD_ 断言基线）。
- 新增覆盖点 = 新增 fixture 或 fixture 内**追加行**，不改既有行。
