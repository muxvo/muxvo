// Chat wire 换算（M5 批3）——legacy 四类型（MuxvoChatHistory 输出）→ protocol.json v10 view 类型
// （ChatProjectView/ChatSessionView/ChatMessageView/ChatSearchHit）。纯函数、可单测，无 I/O（export 内容
// 构造亦纯，落盘在 ChatQueryEngine）。
//
// wire 形状 = 协议 view 面（≠ §8.1 dump 的 legacy 名）——主要换算（chat-history.md §7.1 映射表）：
//  · 时间戳 ISO 串 → 整数毫秒 `*Ms`（startedAtMs/lastModifiedMs/tsMs）。
//  · role（user/assistant/system 恒等）；ChatSource claude-code/codex → 协议 camel claudeCode/codex。
//  · 消息体 content(string∣blocks) → text?/blocks? **恰一存在**（组装侧不变量，见 messageView + ChatWireTests）。
//  · 工具块 input(已解析 JSONValue) → inputJson（原文串，sortedKeys 确定性）；tool_result content → resultJson；
//    image source → dataUri。
import Foundation
import MuxvoBridge
import MuxvoChatHistory
import MuxvoTranscript

enum ChatWire {
    // MARK: - 时间戳

    // ISO8601DateFormatter 非 Sendable 且 date(from:) 无文档级线程安全 → 单锁串行（换算是快路径，锁竞争可忽略）。
    private static let isoLock = NSLock()
    nonisolated(unsafe) private static let isoFrac: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f
    }()
    nonisolated(unsafe) private static let isoPlain: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime]; return f
    }()

    /// ISO8601（`YYYY-MM-DDTHH:MM:SS[.mmm]Z`）→ epoch 毫秒。空/解析失败 → 0（缺时间戳的降级值）。
    static func millis(fromISO iso: String) -> Int {
        if iso.isEmpty { return 0 }
        isoLock.lock(); defer { isoLock.unlock() }
        if let d = isoFrac.date(from: iso) ?? isoPlain.date(from: iso) {
            return Int((d.timeIntervalSince1970 * 1000).rounded(.towardZero))
        }
        return 0
    }

    // MARK: - view 换算

    static func source(_ s: MuxvoChatHistory.ChatSource) -> MuxvoBridge.ChatSource {
        switch s {
        case .claudeCode: return .claudeCode
        case .codex: return .codex
        }
    }

    static func projectView(_ p: ChatProjectInfo) -> ChatProjectView {
        // ChatProjectView 无 source 字段（协议，§7.1）。totalSize nil → 0（wire 非可选）。
        ChatProjectView(
            projectHash: p.projectHash, displayPath: p.displayPath, displayName: p.displayName,
            sessionCount: p.sessionCount, totalSize: p.totalSize ?? 0,
            lastActivityMs: Int(p.lastActivity.rounded(.towardZero)))
    }

    /// customTitle **只在 wire 层叠加**（M5-R1 批2）：调用方（engine sessionsPage）从 ChatCustomTitlesStore
    /// 反查传入；缺省 nil = 既有形状。reader/ChatStore 输出（双跑对照面）从不写 customTitle（§8.1 注不变）。
    /// archiveOnly = 仅归档（CC 原文件已清、镜像仍在）——M5-R1 批2 起 native 可经 ChatRestore 回填后照常
    /// resume（chat-history.md §7.7 语义修订），不再表示「无法 resume」。
    static func sessionView(_ s: ChatSessionSummary, customTitle: String? = nil) -> ChatSessionView {
        // cwd/worktreeLabel/archiveOnly 缺席 → nil（省略）。
        ChatSessionView(
            sessionId: s.sessionId, projectHash: s.projectHash, title: s.title,
            startedAtMs: millis(fromISO: s.startedAt),
            lastModifiedMs: Int(s.lastModified.rounded(.towardZero)),
            fileSize: s.fileSize, source: source(s.source), customTitle: customTitle,
            cwd: s.cwd, worktreeLabel: s.worktreeLabel, archiveOnly: s.archiveOnly)
    }

    static func messageView(_ m: ChatSessionMessage) -> ChatMessageView {
        let role: ChatRole
        switch m.type {
        case .user: role = .user
        case .assistant: role = .assistant
        case .system: role = .system
        }
        // 恰一存在：string → text 置、blocks nil；blocks → blocks 置（含空数组）、text nil（ChatWireTests 断言）。
        var text: String?
        var blocks: [MuxvoBridge.ChatContentBlock]?
        switch m.content {
        case let .text(s): text = s
        case let .blocks(arr): blocks = arr.map(contentBlock)
        }
        return ChatMessageView(
            uuid: m.uuid, sessionId: m.sessionId, role: role,
            cwd: m.cwd.isEmpty ? nil : m.cwd,
            tsMs: millis(fromISO: m.timestamp), text: text, blocks: blocks)
    }

    static func searchHit(_ r: ChatSearchResult) -> ChatSearchHit {
        ChatSearchHit(
            projectHash: r.projectHash, sessionId: r.sessionId, snippet: r.snippet,
            tsMs: millis(fromISO: r.timestamp))
    }

    static func contentBlock(_ b: MuxvoChatHistory.ChatContentBlock) -> MuxvoBridge.ChatContentBlock {
        switch b.type {
        case "text":
            return .text(text: b.text ?? "")
        case "tool_use":
            return .toolUse(name: b.name ?? "", inputJson: jsonString(b.input))
        case "tool_result":
            return .toolResult(resultJson: b.content.map(jsonString))
        case "image":
            return .image(dataUri: imageDataURI(b))
        case "thinking":
            // {signature, thinking} → 只取 thinking 正文；signature 是加密签名（人类不可读）→ wire 面丢弃。
            return .thinking(text: b.raw.objectValue?["thinking"]?.stringValue ?? "")
        default:
            // 未知块：有 text 走 text（现行为保留）；否则不再裸 dump 整块 JSON 进 text（dogfood-r4 问题4 根因2），
            // 改 unknown{blockType, rawJson}，原文不丢。redacted_thinking（无可读正文）自然落此。
            if let t = b.text { return .text(text: t) }
            return .unknown(blockType: b.type ?? "unknown", rawJson: jsonString(b.raw))
        }
    }

    /// JSONValue → 紧凑 JSON 串（sortedKeys 确定性）。标量走 fragmentsAllowed。
    /// nil / 序列化失败 → `"null"`（合法 JSON 字面量）——恒返回可被下游 `JSON.parse` 反解析的值。
    /// 空串曾是非法 JSON（tool_use 缺 input 键时 web 侧 `JSON.parse(inputJson)` 抛 SyntaxError → 工具块渲染崩）。
    static func jsonString(_ value: JSONValue?) -> String {
        guard let value else { return "null" }
        let any = value.toAny()
        guard let data = try? JSONSerialization.data(
            withJSONObject: any, options: [.fragmentsAllowed, .sortedKeys]),
            let s = String(data: data, encoding: .utf8)
        else { return "null" }
        return s
    }

    /// image 块 → data URI。source 已是字符串 URI → 原样；{media_type,data} base64 → `data:<mt>;base64,<data>`。
    static func imageDataURI(_ b: MuxvoChatHistory.ChatContentBlock) -> String {
        guard let src = b.source else { return "" }
        if let s = src.stringValue { return s }
        if let o = src.objectValue {
            let mt = o["media_type"]?.stringValue ?? "image/png"
            let data = o["data"]?.stringValue ?? ""
            return "data:\(mt);base64,\(data)"
        }
        return ""
    }

    // MARK: - export 内容（CHAT_L1_06；legacy chat-handlers.ts:118-152 语义）

    /// Markdown：`# {title}` + 每条 `## {role} ({timestamp})` + body（string 或 text 块 join \n）。
    static func exportMarkdown(messages: [ChatSessionMessage], title: String) -> String {
        var lines: [String] = ["# \(title)", ""]
        for m in messages {
            let body: String
            switch m.content {
            case let .text(s): body = s
            case let .blocks(arr):
                body = arr.filter { $0.type == "text" }.compactMap { $0.text }.joined(separator: "\n")
            }
            lines.append("## \(m.type.rawValue) (\(m.timestamp))")
            lines.append("")
            lines.append(body)
            lines.append("")
        }
        return lines.joined(separator: "\n")
    }

    /// JSON：legacy SessionMessage 形状数组（uuid/type/sessionId/cwd/timestamp/content）；prettyPrinted+sortedKeys。
    static func exportJSON(messages: [ChatSessionMessage]) -> Data {
        let arr: [Any] = messages.map { m in
            var d: [String: Any] = [
                "uuid": m.uuid, "type": m.type.rawValue, "sessionId": m.sessionId,
                "cwd": m.cwd, "timestamp": m.timestamp,
            ]
            switch m.content {
            case let .text(s): d["content"] = s
            case let .blocks(arr): d["content"] = arr.map { $0.raw.toAny() }
            }
            return d
        }
        return (try? JSONSerialization.data(
            withJSONObject: arr, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])) ?? Data("[]".utf8)
    }

    /// 文件名清洗（legacy：前 50 字符 + `/\:*?"<>|` → `_` + trim；空 → fallback）。
    static func sanitizeFileName(_ name: String, fallback: String) -> String {
        let invalid = CharacterSet(charactersIn: "/\\:*?\"<>|")
        let clipped = String(name.prefix(50))
        let replaced = clipped.components(separatedBy: invalid).joined(separator: "_")
        let trimmed = replaced.trimmingCharacters(in: .whitespaces)
        return trimmed.isEmpty ? fallback : trimmed
    }
}
