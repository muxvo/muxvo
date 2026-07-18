// 审计摘要（§3）：tool_use 的 input 原文、tool_result 的 content 原文都是提示注入面（§2.4），
// 绝不进事件值——只出一个确定性 digest 供审计引用。用自实现 FNV-1a 64（零外部依赖，
// 纯 Foundation），digest 里不含任何原文字节，仅哈希 + 长度。非密码学用途（去重/引用即可）。

import Foundation

enum Digest {
    /// 对任意 JSON 值（dict/array/scalar/nil）求稳定 digest。
    /// 键序无关：用 .sortedKeys 规范化后再哈希，故字段顺序漂移不改 digest。
    static func ofJSON(_ value: Any?) -> String {
        let bytes: Data
        if let value, JSONSerialization.isValidJSONObject(["_": value]) {
            bytes = (try? JSONSerialization.data(
                withJSONObject: ["_": value], options: [.sortedKeys]
            )) ?? Data()
        } else if let value {
            // scalar（String/Number/Bool）——包一层再规范化。
            bytes = Data(String(describing: value).utf8)
        } else {
            bytes = Data()
        }
        return ofBytes(bytes)
    }

    static func ofBytes(_ data: Data) -> String {
        var hash: UInt64 = 0xcbf2_9ce4_8422_2325
        for b in data {
            hash ^= UInt64(b)
            hash = hash &* 0x0000_0100_0000_01b3
        }
        return String(format: "fnv1a64:%016llx+%db", hash, data.count)
    }
}
