// ChangelogParser parity / FileUpdateLogger rotate / WhatsNewGate（auto-update.md §0/§7/§8）。

import Foundation
import Testing
import MuxvoTestSupport
@testable import MuxvoUpdater

// MARK: Changelog 解析 parity（预期 JSON 由 legacy shared/utils/changelog-parser.ts 原样跑出——
// 类型剥离逐行照抄的 node 脚本对同一 fixture 的输出，2026-07-13 生成；见批2 red-green 档）。

private let parityFixtureMarkdown = """
# Changelog

All notable changes.

## [Unreleased]

### Added
- 未发布条目（应被跳过）

## [1.2.0] - 2026-07-10

### Added
- 新增甲（含  内部双空格与尾空格）
- 新增乙 `代码片段` 与 **加粗**

### Fixed
- 修复一

### Added
- 重复分区头追加进既有 Added

### 自定义分区
- 未知 key 原样保留

## [1.1.0-beta.2] - 2026-06-01

孤行文字（无分区，应被忽略）
- 分区外条目（currentSection 为空，应被忽略）

### Changed

### Security
- 安全条目

## [1.1] - 2026-05-01

### Added
- 坏版本头（两段式，不匹配正则）——本行应归入上一个条目 1.1.0-beta.2 的 Security？不，
- 实际归属：版本头不匹配 → 整块仍属 1.1.0-beta.2，本分区 Added 属它

## [1.0.0] - 2026-04-01

### Removed
- 移除项
"""

private let legacyExpected: [ChangelogRelease] = [
    ChangelogRelease(version: "1.2.0", date: "2026-07-10", sections: [
        ChangelogSection(key: "Added", items: [
            "新增甲（含  内部双空格与尾空格）",
            "新增乙 `代码片段` 与 **加粗**",
            "重复分区头追加进既有 Added",
        ]),
        ChangelogSection(key: "Fixed", items: ["修复一"]),
        ChangelogSection(key: "自定义分区", items: ["未知 key 原样保留"]),
    ]),
    ChangelogRelease(version: "1.1.0-beta.2", date: "2026-06-01", sections: [
        ChangelogSection(key: "Changed", items: []),
        ChangelogSection(key: "Security", items: ["安全条目"]),
        ChangelogSection(key: "Added", items: [
            "坏版本头（两段式，不匹配正则）——本行应归入上一个条目 1.1.0-beta.2 的 Security？不，",
            "实际归属：版本头不匹配 → 整块仍属 1.1.0-beta.2，本分区 Added 属它",
        ]),
    ]),
    ChangelogRelease(version: "1.0.0", date: "2026-04-01", sections: [
        ChangelogSection(key: "Removed", items: ["移除项"]),
    ]),
]

@Suite("Changelog 解析（auto-update.md §7）")
struct ChangelogParserTests {
    @Test("UPD_changelog_parse_parity: Swift 解析器输出 == legacy changelog-parser 对同 fixture 的输出（等值）")
    func parityWithLegacyParser() {
        #expect(ChangelogParser.parse(parityFixtureMarkdown) == legacyExpected)
    }

    @Test("空/无匹配输入 → 空数组（legacy 读失败→[] 的解析半）")
    func emptyInput() {
        #expect(ChangelogParser.parse("") == [])
        #expect(ChangelogParser.parse("随便一段没有版本头的文字\n- 条目") == [])
    }
}

// MARK: update.log rotate（legacy update-logger.ts:21-28 对等）

@Suite("update.log 文件日志（auto-update.md §0/§8）")
struct FileUpdateLoggerTests {
    @Test("UPD_log_rotate_1mb: 启动时 >maxSize 整体清空；≤maxSize 保留追加；行格式 [ISO8601] [LEVEL] msg")
    func rotateOnStartup() throws {
        try withTempRoot { root in
            let path = root.appendingPathComponent("logs/update.log")
            try FileManager.default.createDirectory(
                at: path.deletingLastPathComponent(), withIntermediateDirectories: true
            )
            // >1MB → init 清空。
            try Data(repeating: 0x61, count: 1024 * 1024 + 1).write(to: path)
            let rotated = FileUpdateLogger(path: path)
            rotated.info("update:started")
            let afterRotate = try String(contentsOf: path, encoding: .utf8)
            #expect(!afterRotate.contains("aaaa"))
            #expect(afterRotate.contains("[INFO] update:started"))

            // ≤1MB → 保留并追加；ERROR 级别落 [ERROR]。
            let kept = FileUpdateLogger(path: path)
            kept.error("update:download-failed test")
            let lines = try String(contentsOf: path, encoding: .utf8)
                .split(separator: "\n").map(String.init)
            #expect(lines.count == 2)
            #expect(lines[0].contains("[INFO] update:started"))
            #expect(lines[1].contains("[ERROR] update:download-failed test"))
            // 行头 ISO8601 时间戳（[YYYY-…] 形状）。
            #expect(lines[1].hasPrefix("[20"))
        }
    }
}

// MARK: What's New 门（legacy App.tsx:171-184 对等）

@Suite("What's New 触发门（auto-update.md §7）")
struct WhatsNewGateTests {
    @Test("UPD_whatsnew_seen_writeback: lastSeen 缺席=首装不弹但写回；≠当前=弹且写回；==当前=不弹不写")
    func gateVerdicts() {
        // 首装：lastSeen 缺席 → 不弹，写回当前（legacy :180-182 恒更新）。
        #expect(WhatsNewGate.evaluate(lastSeen: nil, current: "2.0.0")
            == WhatsNewGate.Verdict(shouldShow: false, lastSeenToWrite: "2.0.0"))
        // 升级后首启：≠当前 → 弹 + 写回。
        #expect(WhatsNewGate.evaluate(lastSeen: "1.9.0", current: "2.0.0")
            == WhatsNewGate.Verdict(shouldShow: true, lastSeenToWrite: "2.0.0"))
        // 常态：==当前 → 不弹不写。
        #expect(WhatsNewGate.evaluate(lastSeen: "2.0.0", current: "2.0.0")
            == WhatsNewGate.Verdict(shouldShow: false, lastSeenToWrite: nil))
    }
}
