// JSONSerialization 取值小工具（CC / Codex mapper 共用）。
// JSON 数字/布尔经 JSONSerialization 桥接为 NSNumber——统一从 NSNumber 取原生类型，
// 缺字段/类型不符即 nil（前向兼容：未知字段忽略、缺字段不 crash）。

import Foundation

enum JSONField {
    static func int(_ value: Any?) -> Int? { (value as? NSNumber)?.intValue }
    static func int64(_ value: Any?) -> Int64? { (value as? NSNumber)?.int64Value }
    static func bool(_ value: Any?) -> Bool? { (value as? NSNumber)?.boolValue }

    /// assistant/agent message 的 usage（§3，F9：仅 input/output tokens，无 turns）。
    static func usage(_ value: Any?) -> Usage? {
        guard let dict = value as? [String: Any] else { return nil }
        return Usage(inputTokens: int(dict["input_tokens"]),
                     outputTokens: int(dict["output_tokens"]))
    }
}
