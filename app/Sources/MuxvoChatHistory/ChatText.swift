// 字符串工具——对齐 JS 字符串语义（UTF-16 下标、trim/trimStart、toLowerCase）。
//
// legacy 是 JS：`slice`/`indexOf`/`length` 全按 **UTF-16 码元**，`trim`/`trimStart` 按 ECMAScript
// WhiteSpace+LineTerminator，`toLowerCase` 按 Unicode 默认小写映射。本文件把这些语义在 Swift 侧逐一
// 复刻，是 §2 title 截断 / §4 snippet 窗口 / 搜索匹配的双跑 diff 基础。

import Foundation

enum ChatText {

    // MARK: - UTF-16 下标（title slice / snippet 窗口）

    /// 取字符串前 `maxUnits` 个 UTF-16 码元（对齐 JS `str.slice(0, maxUnits)`）。
    /// 若边界切断代理对，孤代理由 UTF16 解码补 U+FFFD（对齐 §8.2 规则3 归一后形态）。
    static func utf16Prefix(_ s: String, _ maxUnits: Int) -> String {
        utf16Slice(s, from: 0, to: maxUnits)
    }

    /// 按 UTF-16 码元下标切片 `[from, to)`（对齐 JS `str.slice(from, to)` 的正向语义）。
    /// from/to 会 clamp 到 `[0, count]`；孤代理 → U+FFFD。
    static func utf16Slice(_ s: String, from: Int, to: Int) -> String {
        let units = Array(s.utf16)
        let lo = max(0, min(from, units.count))
        let hi = max(lo, min(to, units.count))
        if lo == hi { return "" }
        return String(decoding: units[lo..<hi], as: UTF16.self)
    }

    /// 字符串的 UTF-16 码元长度（对齐 JS `str.length`）。
    static func utf16Length(_ s: String) -> Int {
        s.utf16.count
    }

    /// 在 `haystack` 里找 `needle` 首次出现的 **UTF-16 码元** 起点（对齐 JS `indexOf`）；无则 nil。
    static func utf16IndexOf(_ haystack: String, _ needle: String) -> Int? {
        let h = Array(haystack.utf16)
        let n = Array(needle.utf16)
        if n.isEmpty { return 0 }
        if n.count > h.count { return nil }
        var i = 0
        let last = h.count - n.count
        while i <= last {
            var j = 0
            while j < n.count && h[i + j] == n[j] { j += 1 }
            if j == n.count { return i }
            i += 1
        }
        return nil
    }

    // MARK: - trim / trimStart（ECMAScript WhiteSpace + LineTerminator）

    /// ECMAScript `trim`/`trimStart` 的空白集：WhiteSpace + LineTerminator（含 NBSP/BOM/各 Zs）。
    /// 注意与 Swift `.whitespacesAndNewlines` 有差异（后者含 U+0085 NEL、缺 U+000B/000C/FEFF）。
    private static let jsWhitespace: CharacterSet = {
        var set = CharacterSet()
        let scalars = [
            0x0009, 0x000A, 0x000B, 0x000C, 0x000D, 0x0020, 0x00A0, 0x1680,
            0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007,
            0x2008, 0x2009, 0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF,
        ]
        for cp in scalars {
            if let u = Unicode.Scalar(cp) { set.insert(u) }
        }
        return set
    }()

    /// 对齐 JS `String.prototype.trim()`（两端）。
    static func jsTrim(_ s: String) -> String {
        s.trimmingCharacters(in: jsWhitespace)
    }

    /// 对齐 JS `String.prototype.trimStart()`（仅前端）。
    static func jsTrimStart(_ s: String) -> String {
        let scalars = s.unicodeScalars
        var idx = scalars.startIndex
        while idx < scalars.endIndex, jsWhitespace.contains(scalars[idx]) {
            idx = scalars.index(after: idx)
        }
        return String(scalars[idx...])
    }

    // MARK: - toLowerCase（Unicode 默认小写映射）

    /// 对齐 JS `String.prototype.toLowerCase()`（非 locale 相关的 Unicode 默认小写映射）。
    /// 残余风险：极少数 1:many/特例字母（如 U+0130 'İ'、U+1E9E 'ẞ'）Swift 与 JS 可能有细微差异；
    /// ASCII / CJK / emoji 全一致。搜索匹配以此为准（详见 §4.1 报告疑点）。
    static func jsLowercased(_ s: String) -> String {
        s.lowercased()
    }
}
