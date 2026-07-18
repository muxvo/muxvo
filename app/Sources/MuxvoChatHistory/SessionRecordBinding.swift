// SessionRecord ↔ ChatRecordReading 绑定（M5 批1 A1-2）。
//
// A1-1 的 SessionRecord（MuxvoTranscript）已逐字段暴露 type/uuid/sessionId/cwd/gitBranch/timestamp/
// isMeta/isCompactSummary/messageContent/topLevelContent（并按 §3.5 刻意不暴露 isSidechain），
// 故零 body 即达成一致——投影/搜索/摘要纯函数吃 `any ChatRecordReading`，批2/批3 传真 SessionRecord。
// dogfood-r4 问题5：SessionRecord 另暴露 `summaryText`（顶层 summary 键）满足协议同名要求（覆盖协议扩展
// 的 nil 默认）→ title fallback 链在真数据上取到 summary；本 binding 仍零 body。

import Foundation
import MuxvoTranscript

extension SessionRecord: ChatRecordReading {}
