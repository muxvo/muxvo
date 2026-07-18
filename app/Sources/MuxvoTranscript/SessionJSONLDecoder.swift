// 磁盘会话 JSONL 行解码器（M5 批1 A1-1）：行 → `.record(SessionRecord)` / `.malformed`。
//
// 纪律同 jsonl-transcript.md §2：非法 JSON / 非对象 JSON 静默计数（malformedCount）不抛错；
// 空/纯空白行「非记录非坏行」静默跳过不计数（§2.1 空行跳过）。只做信封解码，零聊天语义
// （type 白名单、内容归一化、title/搜索投影均归 MuxvoChatHistory，chat-data.md §2~§4）。
//
// 与 CCStreamParser 分工：CCStreamParser 走 HarnessEvent 输出面（编排热流/scanCold）；本解码器走
// SessionRecord 信封面（M5 聊天数据管道主用）——两者共用同一解析纪律，输出面不同。

import Foundation

public struct SessionJSONLDecoder {
    /// 真坏行累计（非法 JSON / 非对象 JSON）；空白行不计入。
    public private(set) var malformedCount = 0

    public init() {}

    public enum DecodedLine: Sendable, Equatable {
        case record(SessionRecord)
        case malformed
    }

    /// 解码一行字节（不含结尾 \n）。空白行 → `.malformed`（不计数）；坏行 → `.malformed` + 计数。
    public mutating func decode(_ line: Data) -> DecodedLine {
        if Self.isBlank(line) { return .malformed }
        guard let obj = try? JSONSerialization.jsonObject(with: line) as? [String: Any] else {
            malformedCount += 1
            return .malformed
        }
        return .record(SessionRecord(object: obj, raw: String(decoding: line, as: UTF8.self)))
    }

    /// 便捷：按 UTF-8 解码字符串行。
    public mutating func decode(_ line: String) -> DecodedLine {
        decode(Data(line.utf8))
    }

    /// 便捷：空行/坏行 → nil（坏行仍静默计数），供投影管道 `project(nil) -> []` 语义（chat-data §3.6）。
    public mutating func record(from line: Data) -> SessionRecord? {
        if case let .record(r) = decode(line) { return r }
        return nil
    }

    public mutating func record(from line: String) -> SessionRecord? {
        record(from: Data(line.utf8))
    }

    /// 全空白（空格/\t/\r/\n）即空行。
    private static func isBlank(_ data: Data) -> Bool {
        data.allSatisfy { $0 == 0x20 || $0 == 0x09 || $0 == 0x0D || $0 == 0x0A }
    }
}
