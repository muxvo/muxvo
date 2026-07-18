// 搜索谓词（specs/behavior/chat-data.md §4）——纯函数，逐字复刻 legacy
// `chat-dual-source.ts` search(729-828) / extractSearchableText(731-744)。
//
// 红线口径（易错，实现者必读）：
//  · 匹配大小写不敏感、任意子串（非分词/非前缀），按 UTF-16 码元（§4.1）。
//  · idx 在 **lowercased** 文本的 UTF-16 上求，snippet 却切 **原始** 文本——legacy 就是这行为
//    （lower 若改变长度会错位，属 legacy 既有语义，双跑逐字对齐，见 §4.1 报告疑点）。
//  · snippetEnd 用 **原始 query 的长度**（`query.length`，非 lowercased 后长度，legacy line 769）。
//  · 只搜 user/assistant 的 text（§4.1）；extractSearchableText 只取 text 块，tool_use/tool_result/
//    image 的文本不进搜索面（§4.2 反例：assistant 非 text 块详情显示但搜索不命中）。

import Foundation

public enum SearchPredicate {

    /// 小写化（对齐 JS toLowerCase，§4.1）。
    public static func lower(_ s: String) -> String {
        ChatText.jsLowercased(s)
    }

    /// 首次命中（§4.2）：返回 (命中 UTF-16 偏移, snippet)；未命中 nil。
    /// 偏移在 lowercased 文本上求；snippet 切原始文本。
    public static func firstMatch(text: String, query: String) -> (offset: Int, snippet: String)? {
        let lowered = ChatText.jsLowercased(text)
        let q = ChatText.jsLowercased(query)
        guard let idx = ChatText.utf16IndexOf(lowered, q) else { return nil }
        let snip = snippet(text: text, hitOffset: idx, queryLength: ChatText.utf16Length(query))
        return (idx, snip)
    }

    /// snippet 窗口（§4.2）：命中前 30 + query + 后 170，全部按原始文本的 UTF-16 码元切片。
    /// `queryLength` = 原始 query 的 UTF-16 长度（非 lowercased 后长度）。
    public static func snippet(text: String, hitOffset: Int, queryLength: Int) -> String {
        let start = max(0, hitOffset - 30)
        let end = min(ChatText.utf16Length(text), hitOffset + queryLength + 170)
        return ChatText.utf16Slice(text, from: start, to: end)
    }

    /// 可搜索类型判定（§4.1：只搜 user/assistant 的原始行；queue-operation/summary/system 等不搜）。
    public static func isSearchableType(_ record: any ChatRecordReading) -> Bool {
        record.type == "user" || record.type == "assistant"
    }

    /// 抽取可搜索文本（§4，extractSearchableText 731-744）：`message.content ?? content`；string 原样；
    /// array 只取 text 块（空串块剔除），join('\n')。**不检查 type**（type 过滤在调用方）。
    public static func extractSearchableText(_ record: any ChatRecordReading) -> String {
        ContentAccess.plainText(record, dropEmpty: true)
    }

    /// 单会话搜索（§4.2 每 session 首命中即停，一文件最多一条）。
    /// 输入 = 该会话按文件顺序的记录序列；只搜 user/assistant，返回首个命中或 nil。
    public static func searchSession(
        records: [any ChatRecordReading],
        query: String,
        projectHash: String,
        sessionId: String
    ) -> ChatSearchResult? {
        for record in records {
            guard isSearchableType(record) else { continue }
            let text = extractSearchableText(record)
            if let match = firstMatch(text: text, query: query) {
                return ChatSearchResult(
                    projectHash: projectHash,
                    sessionId: sessionId,
                    snippet: match.snippet,
                    timestamp: record.timestamp ?? "")
            }
        }
        return nil
    }
}
