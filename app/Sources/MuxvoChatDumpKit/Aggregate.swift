// 多源聚合（chat-data.md §5.4 chat-multi-source）——CC + Codex 两源已对齐的四类型 dump 归并。
//
// §8.3：聚合面输入用「两源已对齐的 dump」，本层施加确定性归并/去重/排序规则。故聚合 diff
// 在两源 per-source 已对齐时按构造对齐（legacy-dump.mts 施加同规则）。
//
// §5.4 规则：
//  · getProjects：flat（CC 先 Codex 后）→ 按 projectHash 归并（sessionCount 加 / totalSize 加 /
//    lastActivity max，source/displayPath 取首现=CC）→ lastActivity 降序。
//  · sessions：flat → 按 sessionId 去重（首现胜=CC 优先）→ lastModified 降序 → slice limit。
//  · readSession：CC 非空则 CC，否则 Codex。
//  · search：flat（CC+Codex）→ slice(0, 500)。

import Foundation
import MuxvoChatHistory

public enum Aggregate {

    public static func projects(cc: [ChatProjectInfo], codex: [ChatProjectInfo]) -> [ChatProjectInfo] {
        var order: [String] = []
        var map: [String: ChatProjectInfo] = [:]
        for p in cc + codex {
            if var acc = map[p.projectHash] {
                acc.sessionCount += p.sessionCount
                acc.totalSize = (acc.totalSize ?? 0) + (p.totalSize ?? 0)
                acc.lastActivity = max(acc.lastActivity, p.lastActivity)
                map[p.projectHash] = acc
            } else {
                map[p.projectHash] = p
                order.append(p.projectHash)
            }
        }
        return order.map { map[$0]! }.sorted { $0.lastActivity > $1.lastActivity }
    }

    public static func sessions(cc: [ChatSessionSummary], codex: [ChatSessionSummary], limit: Int) -> [ChatSessionSummary] {
        var seen = Set<String>()
        var flat: [ChatSessionSummary] = []
        for s in cc + codex where seen.insert(s.sessionId).inserted {
            flat.append(s)
        }
        flat.sort { $0.lastModified > $1.lastModified }
        return Array(flat.prefix(limit))
    }

    public static func readSession(cc: [ChatSessionMessage], codex: [ChatSessionMessage]) -> [ChatSessionMessage] {
        cc.isEmpty ? codex : cc
    }

    public static func search(cc: [ChatSearchResult], codex: [ChatSearchResult]) -> [ChatSearchResult] {
        Array((cc + codex).prefix(500))
    }
}
