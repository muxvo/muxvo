// CodexFile.forEachLine 行为钉子（P0 CPU 风暴修复批0，m5/r1-fix1）。
//
// 背景：forEachLine 现实现整文件读入 + 整 String 按 grapheme 急切 split（真机 597MB×多遍 = 风暴成本主体），
// 批4 将换字节级切行（0x0A）+ 真早停。本文件把「行切分/trim/空行/早停/编码」语义先钉死：
//  · CRLF 案是**红测**：现 grapheme 版 "\r\n" 是单 Character 不被 "\n" 切开；字节版按 0x0A 切 = 对齐
//    legacy Node split('\n') 码元语义（真实 rollout 无 CRLF，双跑真数据档另证）。
//  · 其余案是前后双绿钉子：批4 改读法后必须原样全绿（行为保持红线）。
import Foundation
import Testing

import MuxvoTestSupport
@testable import MuxvoChatHistory

@Suite("CodexFile.forEachLine 行语义钉子")
struct CodexFileLineTests {

    /// 把 raw 字节写进临时文件，收集 forEachLine 的全部回调行。
    private func lines(of raw: Data, earlyStopAfter: Int? = nil) throws -> [String] {
        try withTempRoot { root in
            let file = root.appendingPathComponent("f.jsonl", isDirectory: false)
            try raw.write(to: file)
            var seen: [String] = []
            CodexFile.forEachLine(url: file) { line in
                seen.append(line)
                if let cap = earlyStopAfter, seen.count >= cap { return false }
                return true
            }
            return seen
        }
    }

    private func lines(of text: String, earlyStopAfter: Int? = nil) throws -> [String] {
        try lines(of: Data(text.utf8), earlyStopAfter: earlyStopAfter)
    }

    @Test("CRLF 按 \\n 切（对齐 legacy Node split('\\n') 码元语义；grapheme 版不切 → 红）")
    func crlfSplitsAtLF() throws {
        #expect(try lines(of: "a\r\nb") == ["a", "b"])   // "a\r" trim 掉尾 \r
    }

    @Test("尾换行/无尾换行：行集一致，无空尾行")
    func trailingNewlineIrrelevant() throws {
        #expect(try lines(of: "a\nb\n") == ["a", "b"])
        #expect(try lines(of: "a\nb") == ["a", "b"])
    }

    @Test("空文件：零回调")
    func emptyFileNoCallback() throws {
        #expect(try lines(of: Data()) == [])
    }

    @Test("纯空白行跳过 + 行首尾 trim")
    func whitespaceLinesSkippedAndTrimmed() throws {
        #expect(try lines(of: "  \n\t\n  x  \n") == ["x"])
    }

    @Test("早停：body 返回 false 后不再回调")
    func earlyStopStops() throws {
        #expect(try lines(of: "1\n2\n3", earlyStopAfter: 1) == ["1"])
    }

    @Test("非 UTF-8 字节：坏字节 U+FFFD 归一，与整串解码等价（0x0A 不出现在 UTF-8 续字节中）")
    func invalidUTF8ReplacementStable() throws {
        // 0xFF 独立坏字节 + \n + 'a'
        #expect(try lines(of: Data([0xFF, 0x0A, 0x61])) == ["\u{FFFD}", "a"])
    }

    @Test("孤立 \\r 不是行分隔符：行内 \\r 保留")
    func loneCRNotSeparator() throws {
        #expect(try lines(of: "a\rb\nc") == ["a\rb", "c"])
    }

    @Test("整文件只有 \\r\\n：全空白 → 零回调")
    func crlfOnlyFileNoCallback() throws {
        #expect(try lines(of: "\r\n") == [])
    }

    @Test("超长单行完整回调（无截断）")
    func longSingleLineIntact() throws {
        let long = String(repeating: "x", count: 200_000)
        #expect(try lines(of: long + "\n") == [long])
    }
}
