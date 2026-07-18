// 详情投影（specs/behavior/chat-data.md §3）——纯函数，逐字复刻 legacy
// `chat-dual-source.ts` parseMessageLine(198-319) / splitTeammateMessages(169-196) /
// isProtocolJson(154-163)。一记录 → 0+ 条 ChatSessionMessage。
//
// 红线（易错，实现者必读）：
//  · 类型白名单 user/assistant/queue-operation，其余 → []（§3.1）。
//  · 纯 tool_result 的 user → 丢弃（[]）；含 image 的 user → 保 text+image 块（§3.2）。
//  · queue-operation 起头协议标签 → system，否则 user（§3.3）；user 的 isMeta/isCompactSummary/
//    系统标签前缀/cd|bindkey 正则 → system；`<teammate-message` 起头 → 拆分（§3.3/§3.4）。
//  · assistant 永不改判、原始块透传保全字段（§3.2/§3.3，见 ChatContentBlock）。
//  · sidechain 不过滤（§3.5，本层根本不读 isSidechain——协议 ChatRecordReading 也不暴露它）。

import Foundation
import MuxvoTranscript

public enum ChatMessageProjector {

    // MARK: - 常量（§3.3/§3.4）

    /// queue-operation 起头即判 system 的协议标签（§3.3）。
    static let queueOpSystemPrefixes = [
        "<task-notification>", "<system-reminder>", "<command-message>", "<command-name>",
    ]
    /// user 起头即判 system 的系统标签（§3.3；顺序与 legacy 一致）。
    static let userSystemPrefixes = [
        "<system-reminder>", "<task-notification>", "<command-message>", "<command-name>",
    ]
    /// CC 新版把队友消息包在「Another Claude session sent a message:\n<teammate-message …>」外壳里注入
    /// （老版是裸 `<teammate-message` 起头）。JSONL 落盘为 role=user——外壳形也要走 teammate 拆分，
    /// 否则漏判为 user、归档查看器标「YOU」（§3.4）。
    static let teammateWrapperPrefix = "Another Claude session sent a message:"
    /// 纯协议块类型（§3.4 isProtocolJson）。
    static let protocolTypes: Set<String> = [
        "idle_notification", "teammate_terminated", "shutdown_approved", "shutdown_rejected",
    ]

    static let cdBindkeyRegex = try! NSRegularExpression(pattern: "^(cd\\s+|bindkey\\s)")
    static let teammateBlockRegex = try! NSRegularExpression(
        pattern: "<teammate-message[^>]*>[\\s\\S]*?</teammate-message>")
    static let teammateOpenTagRegex = try! NSRegularExpression(pattern: "<teammate-message[^>]*>\\n?")
    static let teammateCloseTagRegex = try! NSRegularExpression(pattern: "</teammate-message>\\s*$")

    // MARK: - 主投影

    /// 记录 → 0+ 条消息。record 为 nil（空行/坏行 decode 得 nil）→ []（§3.1/§3.6）。
    public static func project(
        record: (any ChatRecordReading)?,
        fallbackSessionId: String
    ) -> [ChatSessionMessage] {
        guard let r = record else { return [] }
        let type = r.type
        guard type == "user" || type == "assistant" || type == "queue-operation" else { return [] }

        // --- 内容归一化（user 纯 tool_result 信号丢弃）---
        let normalized: ChatMessageContent
        switch type {
        case "queue-operation":
            normalized = .text(r.topLevelContent as? String ?? "")
        case "user":
            switch normalizeUserContent(r) {
            case .drop:
                return []
            case .value(let c):
                normalized = c
            }
        default:  // assistant
            normalized = normalizeAssistantContent(r)
        }

        // 类型判定用的字符串态（块态 → ""，对齐 legacy `typeof normalizedContent==='string' ? ... : ''`）。
        let contentStr: String
        if case .text(let s) = normalized { contentStr = s } else { contentStr = "" }

        // --- resolvedType（§3.3）---
        var resolvedType: ChatMessageType = (type == "assistant") ? .assistant : .user

        if type == "queue-operation" {
            let trimmed = ChatText.jsTrimStart(contentStr)
            resolvedType = hasAnyPrefix(trimmed, queueOpSystemPrefixes) ? .system : .user
        } else if type == "user" {
            if r.isCompactSummary == true {
                resolvedType = .system
            } else if r.isMeta == true {
                resolvedType = .system
            } else {
                let trimmed = ChatText.jsTrimStart(contentStr)
                if hasAnyPrefix(trimmed, userSystemPrefixes) {
                    resolvedType = .system
                } else if matchesCdBindkey(trimmed) {
                    resolvedType = .system
                } else if trimmed.hasPrefix("<teammate-message")
                    || (trimmed.hasPrefix(teammateWrapperPrefix) && trimmed.contains("<teammate-message"))
                {
                    // 裸起头（老版）或「Another Claude…」外壳内确含 teammate 块（新版）→ 拆分。
                    // `contains` 守卫：无 teammate 块的外壳（如某些 agent-message）不误路由到 splitTeammate（返 [] 会吞整条）。
                    let base = TeammateBase(
                        uuid: r.uuid ?? "",
                        sessionId: r.sessionId ?? fallbackSessionId,
                        cwd: r.cwd ?? "",
                        gitBranch: r.gitBranch,
                        timestamp: r.timestamp ?? "")
                    return splitTeammateMessages(content: trimmed, base: base)
                }
            }
        }
        // assistant：不改判（§3.3）。

        return [ChatSessionMessage(
            uuid: r.uuid ?? "",
            type: resolvedType,
            sessionId: r.sessionId ?? fallbackSessionId,
            cwd: r.cwd ?? "",
            gitBranch: r.gitBranch,
            timestamp: r.timestamp ?? "",
            content: normalized)]
    }

    // MARK: - 内容归一化（§3.2）

    enum UserContent {
        case drop  // 纯 tool_result → 丢弃
        case value(ChatMessageContent)
    }

    /// user 内容归一化（§3.2）：string 原样；array → 纯 tool_result 丢弃 / 含 image 保 text+image 块 /
    /// 否则 text 块 join('\n')；非 string/array → 顶层 content(string) 或 ""。
    static func normalizeUserContent(_ r: any ChatRecordReading) -> UserContent {
        let mc = r.messageContent
        if let s = mc as? String { return .value(.text(s)) }
        if let arr = mc as? [Any] {
            if !arr.isEmpty && arr.allSatisfy({ blockType($0) == "tool_result" }) {
                return .drop
            }
            let hasImages = arr.contains { blockType($0) == "image" }
            if hasImages {
                let out: [ChatContentBlock] = arr.compactMap { element in
                    let t = blockType(element)
                    guard t == "text" || t == "image" else { return nil }
                    let dict = element as? [String: Any]
                    if t == "image" {
                        let src = dict?["source"]
                        return ChatContentBlock(type: "image", source: src.map { JSONValue(any: $0) })
                    } else {
                        return ChatContentBlock(type: "text", text: dict?["text"] as? String)
                    }
                }
                return .value(.blocks(out))
            } else {
                let texts: [String] = arr.compactMap { element in
                    guard let block = element as? [String: Any],
                          (block["type"] as? String) == "text",
                          let t = block["text"] as? String else { return nil }
                    return t
                }
                return .value(.text(texts.joined(separator: "\n")))
            }
        }
        if let s = r.topLevelContent as? String { return .value(.text(s)) }
        return .value(.text(""))
    }

    /// assistant 内容归一化（§3.2）：message.content 是 Array → 原始块透传（保全字段）；否则试
    /// entry.content(Array) / message.content(string) / entry.content(string) / ""。
    static func normalizeAssistantContent(_ r: any ChatRecordReading) -> ChatMessageContent {
        let mc = r.messageContent
        if let arr = mc as? [Any] {
            return .blocks(arr.map { ChatContentBlock(raw: JSONValue(any: $0)) })
        }
        if let arr = r.topLevelContent as? [Any] {
            return .blocks(arr.map { ChatContentBlock(raw: JSONValue(any: $0)) })
        }
        if let s = mc as? String { return .text(s) }
        if let s = r.topLevelContent as? String { return .text(s) }
        return .text("")
    }

    // MARK: - teammate 拆分（§3.4）

    struct TeammateBase {
        let uuid: String
        let sessionId: String
        let cwd: String
        let gitBranch: String?
        let timestamp: String
    }

    /// 拆分拼接的 `<teammate-message>` 块（§3.4）：每块一条 system 消息，uuid `-tm{i}`（i=原始块序号，
    /// 含被跳过的协议块位置），content 保留整块含标签；纯协议块丢弃；无匹配 → []。
    static func splitTeammateMessages(content: String, base: TeammateBase) -> [ChatSessionMessage] {
        let ns = content as NSString
        let matches = teammateBlockRegex.matches(
            in: content, range: NSRange(location: 0, length: ns.length))
        if matches.isEmpty { return [] }

        var results: [ChatSessionMessage] = []
        for (i, m) in matches.enumerated() {
            let block = ns.substring(with: m.range)
            let inner = stripTeammateShell(block)
            if isProtocolJson(inner) { continue }
            results.append(ChatSessionMessage(
                uuid: "\(base.uuid)-tm\(i)",
                type: .system,
                sessionId: base.sessionId,
                cwd: base.cwd,
                gitBranch: base.gitBranch,
                timestamp: base.timestamp,
                content: .text(block)))
        }
        return results
    }

    /// 去 teammate 外壳（legacy 180-183）：去首个开标签(+可选\n) → 去闭标签(+尾空白) → trim。
    static func stripTeammateShell(_ block: String) -> String {
        var s = replaceFirst(teammateOpenTagRegex, in: block, with: "")
        s = replaceFirst(teammateCloseTagRegex, in: s, with: "")
        return ChatText.jsTrim(s)
    }

    /// 纯协议块判定（§3.4）：空串算协议；每行 trim 后须 JSON.parse 且 type∈protocolTypes；任一行非法
    /// JSON 或非协议 type → 该块非纯协议（保留）。
    static func isProtocolJson(_ text: String) -> Bool {
        let trimmed = ChatText.jsTrim(text)
        if trimmed.isEmpty { return true }
        let lines = trimmed.components(separatedBy: "\n")
        return lines.allSatisfy { line in
            let l = ChatText.jsTrim(line)
            if l.isEmpty { return true }
            guard let data = l.data(using: .utf8),
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let t = obj["type"] as? String else { return false }
            return protocolTypes.contains(t)
        }
    }

    // MARK: - 小工具

    static func blockType(_ element: Any) -> String? {
        (element as? [String: Any])?["type"] as? String
    }

    static func hasAnyPrefix(_ s: String, _ prefixes: [String]) -> Bool {
        prefixes.contains { s.hasPrefix($0) }
    }

    static func matchesCdBindkey(_ s: String) -> Bool {
        let ns = s as NSString
        return cdBindkeyRegex.firstMatch(in: s, range: NSRange(location: 0, length: ns.length)) != nil
    }

    /// 只替换首个匹配（对齐 JS `String.replace(regex, '')` 无 /g 语义）。
    static func replaceFirst(_ re: NSRegularExpression, in s: String, with template: String) -> String {
        let ns = s as NSString
        guard let m = re.firstMatch(in: s, range: NSRange(location: 0, length: ns.length)) else {
            return s
        }
        return ns.replacingCharacters(in: m.range, with: template)
    }
}
