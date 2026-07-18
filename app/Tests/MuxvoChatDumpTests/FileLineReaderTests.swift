// muxvo-chat-dump 流式逐行读单测（M7 批6，台账 MINOR-2）。钉 FileLineReader 的 legacy readline
// 对齐语义：\n 切行 + 尾随 \r 剥除、末行无换行也产出、空行计入行序、maxLines 早停、start 偏移。
import Foundation
import Testing

@testable import muxvo_chat_dump

@Suite("muxvo-chat-dump 逐行读（FileLineReader）")
struct FileLineReaderTests {

    private func writeTemp(_ bytes: [UInt8]) throws -> URL {
        let url = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("muxvo-flr-\(UUID().uuidString).txt")
        try Data(bytes).write(to: url)
        return url
    }

    private func writeTemp(_ s: String) throws -> URL { try writeTemp(Array(s.utf8)) }

    @Test("\\r\\n 视作一个换行（尾随 \\r 剥除）")
    func crlfStripped() throws {
        let url = try writeTemp("a\r\nb\r\nc\r\n")
        defer { try? FileManager.default.removeItem(at: url) }
        #expect(FileLineReader.firstLines(url: url, maxLines: 10) == ["a", "b", "c"])
    }

    @Test("末行无尾随换行也产出")
    func lastLineNoNewline() throws {
        let url = try writeTemp("x\ny\nz") // 末行 z 无 \n
        defer { try? FileManager.default.removeItem(at: url) }
        #expect(FileLineReader.firstLines(url: url, maxLines: 10) == ["x", "y", "z"])
    }

    @Test("空行计入行序（产出 \"\"）")
    func emptyLinesCounted() throws {
        let url = try writeTemp("a\n\nb\n") // 中间一空行
        defer { try? FileManager.default.removeItem(at: url) }
        #expect(FileLineReader.firstLines(url: url, maxLines: 10) == ["a", "", "b"])
    }

    @Test("maxLines 早停（只读前 N 行）")
    func maxLinesEarlyStop() throws {
        let url = try writeTemp("1\n2\n3\n4\n5\n")
        defer { try? FileManager.default.removeItem(at: url) }
        #expect(FileLineReader.firstLines(url: url, maxLines: 2) == ["1", "2"])
    }

    @Test("start 字节偏移：从中途起读")
    func startOffset() throws {
        // "aaa\nbbb\n"：字节偏移 4 = 第二行 'bbb' 起点。
        let url = try writeTemp("aaa\nbbb\nccc\n")
        defer { try? FileManager.default.removeItem(at: url) }
        var out: [String] = []
        FileLineReader.forEachLine(url: url, start: 4) { out.append($0); return true }
        #expect(out == ["bbb", "ccc"])
    }

    @Test("超长单行（跨多个 64KB 块）完整产出，不切断字符")
    func longLineAcrossChunks() throws {
        // 单行 200KB（> 3 个 64KB 块），末尾一个 \n；含多字节字符验不切断。
        let long = String(repeating: "λ", count: 100_000) // 2 字节/字符 ≈ 200KB
        let url = try writeTemp(long + "\n")
        defer { try? FileManager.default.removeItem(at: url) }
        let lines = FileLineReader.firstLines(url: url, maxLines: 10)
        #expect(lines.count == 1)
        #expect(lines.first == long)
    }

    @Test("不存在的文件：静默产出空（不崩）")
    func missingFileNoCrash() {
        let url = URL(fileURLWithPath: "/nonexistent/muxvo-flr-\(UUID().uuidString)")
        #expect(FileLineReader.firstLines(url: url, maxLines: 10).isEmpty)
    }
}
