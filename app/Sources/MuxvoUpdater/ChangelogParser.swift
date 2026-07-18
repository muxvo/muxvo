// Keep-a-Changelog 解析（specs/behavior/auto-update.md §7）：随包 CHANGELOG.{zh,en}.md →
// 有序 release 条目，供 What's New 弹窗（app.request releaseNotes）。
// 解析语义与 legacy shared/utils/changelog-parser.ts 等值（UPD_changelog_parse_parity 以
// fixture JSON 锁定）：版本头正则/[Unreleased] 跳过/### 分区/- 条目/分区保插入序。

import Foundation

public struct ChangelogSection: Equatable, Sendable {
    public let key: String
    public let items: [String]
    public init(key: String, items: [String]) {
        self.key = key
        self.items = items
    }
}

public struct ChangelogRelease: Equatable, Sendable {
    public let version: String
    public let date: String
    public let sections: [ChangelogSection]
    public init(version: String, date: String, sections: [ChangelogSection]) {
        self.version = version
        self.date = date
        self.sections = sections
    }
}

public enum ChangelogParser {
    // legacy :30 `^## \[(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?)\]\s*-\s*(\d{4}-\d{2}-\d{2})`
    private static let versionLine = try! NSRegularExpression(
        pattern: #"^## \[(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?)\]\s*-\s*(\d{4}-\d{2}-\d{2})"#
    )
    // legacy :39 `/^## \[Unreleased\]/i`
    private static let unreleasedLine = try! NSRegularExpression(
        pattern: #"^## \[Unreleased\]"#, options: [.caseInsensitive]
    )
    private static let sectionLine = try! NSRegularExpression(pattern: #"^### (.+)"#)
    private static let itemLine = try! NSRegularExpression(pattern: #"^- (.+)"#)

    public static func parse(_ markdown: String) -> [ChangelogRelease] {
        // 与 legacy 一致：分区按首现序保序，重复分区头追加进既有分区（Record 语义）。
        struct Builder {
            let version: String
            let date: String
            var order: [String] = []
            var itemsByKey: [String: [String]] = [:]
            func built() -> ChangelogRelease {
                ChangelogRelease(
                    version: version,
                    date: date,
                    sections: order.map { ChangelogSection(key: $0, items: itemsByKey[$0] ?? []) }
                )
            }
        }

        var entries: [ChangelogRelease] = []
        var current: Builder?
        var currentSection = ""

        for line in markdown.components(separatedBy: "\n") {
            let range = NSRange(line.startIndex..., in: line)
            if let match = versionLine.firstMatch(in: line, range: range) {
                if let done = current { entries.append(done.built()) }
                let version = String(line[Range(match.range(at: 1), in: line)!])
                let date = String(line[Range(match.range(at: 2), in: line)!])
                current = Builder(version: version, date: date)
                currentSection = ""
                continue
            }
            if unreleasedLine.firstMatch(in: line, range: range) != nil {
                if let done = current { entries.append(done.built()) }
                current = nil
                currentSection = ""
                continue
            }
            guard current != nil else { continue }
            if let match = sectionLine.firstMatch(in: line, range: range) {
                currentSection = String(line[Range(match.range(at: 1), in: line)!])
                    .trimmingCharacters(in: .whitespaces)
                if current!.itemsByKey[currentSection] == nil {
                    current!.order.append(currentSection)
                    current!.itemsByKey[currentSection] = []
                }
                continue
            }
            if let match = itemLine.firstMatch(in: line, range: range), !currentSection.isEmpty {
                let item = String(line[Range(match.range(at: 1), in: line)!])
                    .trimmingCharacters(in: .whitespaces)
                current!.itemsByKey[currentSection, default: []].append(item)
            }
        }
        if let done = current { entries.append(done.built()) }
        return entries
    }
}
