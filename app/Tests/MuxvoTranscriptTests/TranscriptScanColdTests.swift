// SC_* 案例（M5 批1 A1-1）：FileTailSource.scanCold 冷扫全量历史（jsonl-transcript.md §4）。
// scanCold 仅践约冻结 TranscriptSource 接口——产 HarnessEvent，聊天数据管道不消费它（走
// SessionJSONLDecoder → SessionRecord）。故此处验：since 过滤 / ISO ts 提取 / 未知 type 透传 /
// 末行 flush / 超限行 parseError / harness 分派 / 脱敏 fixture 回放零 parseError。
import Foundation
import Testing

@testable import MuxvoTranscript

@Suite("scanCold 冷扫全量历史（§4 冻结接口践约）")
struct TranscriptScanColdTests {

    private static func fixturesDir() -> URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .appendingPathComponent("Fixtures/sessions", isDirectory: true)
    }

    /// 写临时 JSONL 文件（newlineTerminated=false 时末行无尾随换行，验 flush）。
    private func writeTemp(_ lines: [String], newlineTerminated: Bool = true) throws -> URL {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("sc-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent("session.jsonl")
        var body = lines.joined(separator: "\n")
        if newlineTerminated { body += "\n" }
        try Data(body.utf8).write(to: url)
        return url
    }

    private func collect(_ source: FileTailSource, since: Int64? = nil) async -> [HarnessEvent] {
        var out: [HarnessEvent] = []
        for await ev in source.scanCold(since: since) { out.append(ev) }
        return out
    }

    private func hasParseError(_ events: [HarnessEvent]) -> Bool {
        events.contains { if case .parseError = $0 { return true }; return false }
    }

    // MARK: - since 过滤（ISO ts 提取 + 早于 since 的行跳过）

    @Test("SC_scancold_since_filter：since 过滤 ISO 时间戳，早行事件被跳过")
    func SC_scancold_since_filter() async throws {
        let url = try writeTemp([
            #"{"type":"assistant","timestamp":"2026-07-05T08:00:00Z","message":{"role":"assistant","content":[{"type":"text","text":"early"}]}}"#,
            #"{"type":"assistant","timestamp":"2026-07-05T09:00:00Z","message":{"role":"assistant","content":[{"type":"text","text":"late"}]}}"#,
        ])
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let cutoff = ISO8601Millis.toMs("2026-07-05T08:30:00Z")!
        let events = await collect(FileTailSource(url: url), since: cutoff)
        #expect(events.contains(.assistantText(text: "late", usage: nil)))
        #expect(!events.contains(.assistantText(text: "early", usage: nil)))
        #expect(!hasParseError(events))
    }

    // MARK: - since=nil 全量（不过滤，两行都出）

    @Test("SC_scancold_no_since_all：since=nil 全量产出")
    func SC_scancold_no_since_all() async throws {
        let url = try writeTemp([
            #"{"type":"assistant","timestamp":"2026-07-05T08:00:00Z","message":{"role":"assistant","content":[{"type":"text","text":"early"}]}}"#,
            #"{"type":"assistant","timestamp":"2026-07-05T09:00:00Z","message":{"role":"assistant","content":[{"type":"text","text":"late"}]}}"#,
        ])
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let events = await collect(FileTailSource(url: url))
        #expect(events.contains(.assistantText(text: "early", usage: nil)))
        #expect(events.contains(.assistantText(text: "late", usage: nil)))
    }

    // MARK: - 末行无尾随换行 → flush（全量扫吐尽末行，与 tail 语义相反）

    @Test("SC_scancold_flush_final_line：末行无换行仍被 flush 产出")
    func SC_scancold_flush_final_line() async throws {
        let url = try writeTemp([
            #"{"type":"assistant","timestamp":"2026-07-05T08:00:00Z","message":{"role":"assistant","content":[{"type":"text","text":"onlyline"}]}}"#,
        ], newlineTerminated: false)
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let events = await collect(FileTailSource(url: url))
        #expect(events.contains(.assistantText(text: "onlyline", usage: nil)))
        #expect(!hasParseError(events))
    }

    // MARK: - 超限行 → parseError，后续行正常（复用 §2.1 截断纪律）

    @Test("SC_scancold_oversize_line_parseerror：超限行记 parseError，后续行正常")
    func SC_scancold_oversize_line_parseerror() async throws {
        let huge = #"{"type":"assistant","x":""# + String(repeating: "A", count: 300) + #""}"#
        let good = #"{"type":"system","subtype":"init","session_id":"after"}"#
        let url = try writeTemp([huge, good])
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let events = await collect(FileTailSource(url: url, maxLineBytes: 64))
        #expect(hasParseError(events))
        #expect(events.contains(.sessionStarted(sessionId: "after", model: nil)))
    }

    // MARK: - 未知 type 透传 unknown（summary/file-history-snapshot/queue-operation，不加 case）

    @Test("SC_scancold_unknown_type_passthrough：磁盘未知 type → unknown，不中断")
    func SC_scancold_unknown_type_passthrough() async throws {
        let url = Self.fixturesDir().appendingPathComponent("cc-session-covering.jsonl")
        let events = await collect(FileTailSource(url: url))
        func unknownType(_ t: String) -> Bool {
            events.contains { if case let .unknown(type, _) = $0 { return type == t }; return false }
        }
        #expect(unknownType("summary"))
        #expect(unknownType("file-history-snapshot"))
        #expect(unknownType("queue-operation"))
        #expect(!hasParseError(events))
    }

    // MARK: - Codex harness 分派（thread.started → sessionStarted）

    @Test("SC_scancold_codex_harness_dispatch：harness=codex 走 Codex mapper")
    func SC_scancold_codex_harness_dispatch() async throws {
        let url = try writeTemp([#"{"type":"thread.started","thread_id":"tid-1"}"#])
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let events = await collect(FileTailSource(url: url, harness: .codexExecJSON))
        #expect(events.contains(.sessionStarted(sessionId: "tid-1", model: nil)))
        #expect(!hasParseError(events))
    }

    // MARK: - 脱敏 fixture 回放：零 parseError + 至少一条结构化事件（防漂移锚，反向自证）

    @Test("SC_scancold_fixture_replay：脱敏 fixture 全量回放零 parseError")
    func SC_scancold_fixture_replay() async throws {
        // 反向自证：故意损坏行必产 parseError（否则「零 parseError」断言无意义）。
        let corruptURL = try writeTemp(["this line is deliberately not json"])
        defer { try? FileManager.default.removeItem(at: corruptURL.deletingLastPathComponent()) }
        #expect(hasParseError(await collect(FileTailSource(url: corruptURL))))

        for fixture in ["cc-session-covering.jsonl", "cc-session-search.jsonl"] {
            let url = Self.fixturesDir().appendingPathComponent(fixture)
            let events = await collect(FileTailSource(url: url))
            #expect(!hasParseError(events), "\(fixture) 回放产 parseError")
            let meaningful = events.contains {
                switch $0 {
                case .unknown, .parseError: return false
                default: return true
                }
            }
            #expect(meaningful, "\(fixture) 回放未产出任何结构化事件")
        }
    }

    // MARK: - 不存在文件 → 空流不 crash

    @Test("SC_scancold_missing_file：文件不存在 → 空流、不 crash")
    func SC_scancold_missing_file() async {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("sc-nonexistent-\(UUID().uuidString).jsonl")
        let events = await collect(FileTailSource(url: url))
        #expect(events.isEmpty)
    }
}
