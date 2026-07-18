// 会话元数据提取（specs/behavior/chat-data.md §2）——纯函数，复刻 legacy
// `chat-dual-source.ts` extractSessionSummary(85-146)。
//
// 输入 = 该会话**前 ≤20 行**解码出的记录序列（批2 用流式 readFirstLines(20) 读、逐行解码、
// 空行/坏行静默跳过后传入）+ 文件元数据（fileSize/lastModifiedMs 由调用方 stat 传入，保持纯函数）。
//
// 红线（易错，实现者必读）：
//  · startedAt 赋值在**内部消息前缀判断之前**（legacy line 120）——即便首条 user 是被 title 跳过的
//    内部消息，其 timestamp 仍成为 startedAt。startedAt = 前 20 行首条 user 记录的 timestamp。
//  · title 截断按 **UTF-16 码元** slice(0,100)；title 文本 = message.content ?? content（text 块 NO
//    filter(Boolean)，§2.2 与搜索面的空串剔除不同）。
//  · 空 title（无非内部 user 消息）→ 返回 nil（会话不进列表，legacy collectAndExtractSessions 435 丢弃）。

import Foundation

public enum SessionSummaryExtractor {

    /// title 跳过的内部消息前缀（§2.2）。注意 `<teammate-message` 无闭合 `>`（前缀匹配）。
    /// `Another Claude session sent a message:` = CC 新版队友/agent 消息外壳（JSONL role=user）——
    /// 同 ChatMessageProjector 的外壳形，不该泄进用户可见的会话标题（与投影层「YOU」修复同根）。
    static let titleSkipPrefixes = [
        "<command-message>",
        "<local-command-caveat>",
        "<teammate-message",
        "<system-reminder>",
        "Another Claude session sent a message:",
    ]

    /// 提取会话摘要（§2）。title 为空则返回 nil（丢弃该会话）。
    /// worktreeLabel / archiveOnly 由调用方（批2 collect 步）在返回后按来源补写（字段为 var）。
    public static func extract(
        records: [any ChatRecordReading],
        projectHash: String,
        sessionId: String,
        fileSize: Int,
        lastModifiedMs: Double,
        source: ChatSource = .claudeCode
    ) -> ChatSessionSummary? {
        var title = ""
        var startedAt = ""
        var cwd = ""

        for record in records {
            // cwd = 前 20 行首条含 cwd 的记录的 cwd（任意类型，§2.3）。
            if cwd.isEmpty, let c = record.cwd, !c.isEmpty {
                cwd = c
            }

            guard record.type == "user" else { continue }

            let rawContent = ContentAccess.plainText(record, dropEmpty: false)

            // startedAt 在内部消息判断之前赋值（红线，§2.3）。
            if startedAt.isEmpty {
                startedAt = record.timestamp ?? ""
            }

            let trimmed = ChatText.jsTrim(rawContent)
            if !trimmed.isEmpty, !hasSkippedPrefix(trimmed) {
                title = ChatText.utf16Prefix(trimmed, 100)
                break
            }
        }

        guard !title.isEmpty else { return nil }

        return ChatSessionSummary(
            sessionId: sessionId,
            projectHash: projectHash,
            title: title,
            startedAt: startedAt,
            lastModified: lastModifiedMs,
            fileSize: fileSize,
            cwd: cwd.isEmpty ? nil : cwd,
            source: source)
    }

    private static func hasSkippedPrefix(_ trimmed: String) -> Bool {
        titleSkipPrefixes.contains { trimmed.hasPrefix($0) }
    }
}
