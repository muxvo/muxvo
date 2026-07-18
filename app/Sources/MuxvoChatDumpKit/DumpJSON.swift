// 四类型 → legacy 字段名 JSON（chat-data.md §8.1 逐字 + §8.2 归一）——纯编码，无 I/O。
//
// §8.1 字段名对齐 chat.types.ts；§8.2：可选键 nil 省略、source 必填、mtime floor 到整数毫秒。
// diff.mjs 两侧再对称归一（floor/省略/U+FFFD/排序），故本编码器只需值正确 + 字段名正确；
// 但仍按 §8.2 产出（省 nil 键、mtime 整数），令原始 dump 已可读、近可比。
// 字段映射由 MuxvoChatDumpKitTests 钉住（legacy 字段名 + nil 省略 + mtime floor）。

import Foundation
import MuxvoChatHistory
import MuxvoTranscript

public enum DumpJSON {

    // MARK: - 单类型 → 字典（legacy 字段名）

    public static func project(_ p: ChatProjectInfo) -> [String: Any] {
        var o: [String: Any] = [
            "projectHash": p.projectHash,
            "displayPath": p.displayPath,
            "displayName": p.displayName,
            "sessionCount": p.sessionCount,
            "lastActivity": floorMs(p.lastActivity),
            "source": p.source.rawValue,
        ]
        if let t = p.totalSize { o["totalSize"] = t }  // nil 省略（§8.2 规则4）
        return o
    }

    public static func summary(_ s: ChatSessionSummary) -> [String: Any] {
        var o: [String: Any] = [
            "sessionId": s.sessionId,
            "projectHash": s.projectHash,
            "title": s.title,
            "startedAt": s.startedAt,
            "lastModified": floorMs(s.lastModified),
            "fileSize": s.fileSize,
            "source": s.source.rawValue,
        ]
        if let c = s.cwd { o["cwd"] = c }
        if let w = s.worktreeLabel { o["worktreeLabel"] = w }
        if let a = s.archiveOnly { o["archiveOnly"] = a }
        return o
    }

    public static func message(_ m: ChatSessionMessage) -> [String: Any] {
        var o: [String: Any] = [
            "uuid": m.uuid,
            "type": m.type.rawValue,
            "sessionId": m.sessionId,
            "cwd": m.cwd,
            "timestamp": m.timestamp,
            "content": content(m.content),
        ]
        if let g = m.gitBranch { o["gitBranch"] = g }
        return o
    }

    public static func searchResult(_ r: ChatSearchResult) -> [String: Any] {
        [
            "projectHash": r.projectHash,
            "sessionId": r.sessionId,
            "snippet": r.snippet,
            "timestamp": r.timestamp,
        ]
    }

    // MARK: - content（string ∣ block[]）

    public static func content(_ c: ChatMessageContent) -> Any {
        switch c {
        case .text(let s): return s
        case .blocks(let blocks): return blocks.map { $0.raw.toAny() }
        }
    }

    // MARK: - mtime floor（§8.2 规则2：整数毫秒）

    public static func floorMs(_ ms: Double) -> Int64 { Int64(ms.rounded(.down)) }

    // MARK: - 序列化（顶层数组）

    public static func encode(_ records: [[String: Any]]) throws -> Data {
        try JSONSerialization.data(withJSONObject: records, options: [.sortedKeys, .withoutEscapingSlashes])
    }
}
