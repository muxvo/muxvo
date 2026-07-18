// 记录内容访问（specs/behavior/chat-data.md §2.2 / §4）——把 legacy `obj.message?.content ?? obj.content`
// 与 text 块归一收敛一处，供 Extractor(title) / SearchPredicate(search) 共用。吃 `any ChatRecordReading`
// 的 Any? 读取面（messageContent / topLevelContent）。

import Foundation

enum ContentAccess {

    /// legacy `obj.message?.content ?? obj.content`（JS nullish `??`：仅 null/undefined 才回落）。
    /// messageContent 为 JSON null 时 A1-1 呈 NSNull（非 Swift nil），若直接用 `??` 会因左值 `.some(NSNull)`
    /// 不回落顶层 content。legacy nullish 把 `null` 视同缺席回落——故此处把 NSNull 归一为缺席（nil）再回落。
    /// 空串/0/false 非 nullish（保留，与 legacy `??` 一致，不回落）。
    static func messageOrTopLevel(_ r: any ChatRecordReading) -> Any? {
        let m = r.messageContent
        return (m is NSNull ? nil : m) ?? r.topLevelContent
    }

    /// array 里的 text 块 join('\n')；dropEmpty=true 剔除空串块（filter(Boolean)，§4）；false 保留（§2.2）。
    static func textFromBlocks(_ arr: [Any], dropEmpty: Bool) -> String {
        let texts: [String] = arr.compactMap { element in
            guard let block = element as? [String: Any],
                  (block["type"] as? String) == "text",
                  let t = block["text"] as? String else { return nil }
            return t
        }
        return (dropEmpty ? texts.filter { !$0.isEmpty } : texts).joined(separator: "\n")
    }

    /// message.content ?? content → 纯文本（§2.2 title / §4 search）。string 原样；array 取 text 块 join；
    /// 其余（NSNull/数字/对象/nil）→ ""。
    static func plainText(_ r: any ChatRecordReading, dropEmpty: Bool) -> String {
        let mc = messageOrTopLevel(r)
        if let s = mc as? String { return s }
        if let arr = mc as? [Any] { return textFromBlocks(arr, dropEmpty: dropEmpty) }
        return ""
    }
}
