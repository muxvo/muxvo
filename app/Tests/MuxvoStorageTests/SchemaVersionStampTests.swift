import Foundation
import Testing

@testable import MuxvoStorage

@Suite("SCHEMA_VERSION 解析/序列化")
struct SchemaVersionStampTests {
    @Test("round-trip：序列化后可解析回相等值")
    func roundTrip() throws {
        let stamp = SchemaVersionStamp(version: 1, channel: .dev)
        let parsed = try SchemaVersionStamp.parse(stamp.serialized())
        #expect(parsed == stamp)
        #expect(String(decoding: stamp.serialized(), as: UTF8.self) == "1 dev\n")
    }

    @Test(
        "容忍空白变体",
        arguments: ["1 dev", "1 dev\n", "  1   dev \n", "\t1\tdev\t"]
    )
    func tolerantWhitespace(text: String) throws {
        let parsed = try SchemaVersionStamp.parse(Data(text.utf8))
        #expect(parsed == SchemaVersionStamp(version: 1, channel: .dev))
    }

    @Test(
        "拒绝非法内容（绝不当 fresh 处理）",
        arguments: [
            "", "1", "abc dev", "1 beta", "0 dev", "-1 dev",
            "1 dev extra", "1 dev\n2 prod", "{\"version\":1}",
        ]
    )
    func rejectsCorrupt(text: String) {
        #expect(throws: DataDirectoryError.self) {
            _ = try SchemaVersionStamp.parse(Data(text.utf8))
        }
    }

    @Test("拒绝非 UTF-8 内容")
    func rejectsNonUTF8() {
        #expect(throws: DataDirectoryError.self) {
            _ = try SchemaVersionStamp.parse(Data([0xFF, 0xFE, 0x80]))
        }
    }
}
