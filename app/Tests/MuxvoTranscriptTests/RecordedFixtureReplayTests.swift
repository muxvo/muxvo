// JT_recorded_fixture_replay（specs/orchestration/jsonl-transcript.md §5 末行 + fake-cli.md §4 第 2 道锚）：
// 契约录制 fixtures 全量回放过解析库，零 parseError、零 thresholdExceeded——真世界锚点，防解析库
// 对真实 CC stream-json 形状的假设随 CC 版本漂移而悄悄失真（未枚举 subtype 如 thinking_tokens
// 产 unknown 是正常前向兼容，不算失败；只有非法 JSON / 超限行才是 parseError）。
import Foundation
import Testing

@testable import MuxvoTranscript

@Suite("契约录制回放防漂移（fake-cli §4 第 2 道锚）")
struct RecordedFixtureReplayTests {

    /// <repo>/app/Tests/MuxvoTranscriptTests/本文件 → 上溯至 <repo>（样板同 TaskStateMachineTests）。
    private static func repoRoot() -> URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()  // MuxvoTranscriptTests
            .deletingLastPathComponent()  // Tests
            .deletingLastPathComponent()  // app
            .deletingLastPathComponent()  // <repo>
    }

    @Test("JT_recorded_fixture_replay：录制 fixtures 全量回放零 parseError（防漂移锚）")
    func JT_recorded_fixture_replay() throws {
        let recordedDir = Self.repoRoot()
            .appendingPathComponent("tools/contract-recorder/fixtures/recorded", isDirectory: true)

        // 递归枚举全部版本目录下的 .jsonl（.script.json 是剧本不是回放对象，靠扩展名天然排除）。
        guard let walker = FileManager.default.enumerator(
            at: recordedDir,
            includingPropertiesForKeys: nil
        ) else {
            Issue.record("契约录制目录不存在或无法枚举：\(recordedDir.path)——防漂移锚失守")
            return
        }
        let jsonlFiles = walker.compactMap { $0 as? URL }
            .filter { $0.pathExtension == "jsonl" }
            .sorted { $0.path < $1.path }

        guard !jsonlFiles.isEmpty else {
            Issue.record("契约录制目录零 .jsonl fixture：\(recordedDir.path)——防漂移锚失守")
            return
        }

        // 反向自证：故意损坏行必产 parseError，确认本测试不空转（不是「解析器啥都吞」的假绿）。
        var probe = CCStreamParser()
        let corrupt = probe.feed("this line is deliberately not json\n")
        #expect(corrupt.contains { if case .parseError = $0 { return true }; return false },
                "反向对照：损坏行应产 parseError，否则回放的零 parseError 断言无意义")

        var totalLines = 0
        var totalEvents = 0
        for file in jsonlFiles {
            let data = try Data(contentsOf: file)
            let name = file.lastPathComponent

            // 选对入口：codex 录制走 Codex mapper，其余按 CC stream-json（当前录制物全为 CC）。
            var parser: any HarnessLineParser
            if file.path.lowercased().contains("codex") {
                parser = CodexJSONParser()
            } else {
                parser = CCStreamParser()
            }
            let events = parser.feed(data)

            let lineCount = data.split(separator: UInt8(ascii: "\n")).count
            totalLines += lineCount
            totalEvents += events.count

            // 锚 1：零 parseError 事件（真实形状里非法 JSON / 超限行才计 parseError）。
            let parseErrors = events.filter { if case .parseError = $0 { return true }; return false }
            #expect(parseErrors.isEmpty,
                    "\(name) 回放产 \(parseErrors.count) 条 parseError——解析库对真实形状假设已漂移")

            // 锚 2：零 thresholdExceeded 异常信号（连续失败越阈值即锁存）。
            #expect(!parser.thresholdExceeded,
                    "\(name) 回放触发 thresholdExceeded——连续解析失败越阈值")

            // 锚 3：至少 1 条非 unknown/非 parseError 事件，防「全 unknown 也算过」的假绿。
            let meaningful = events.filter {
                switch $0 {
                case .unknown, .parseError: return false
                default: return true
                }
            }
            #expect(!meaningful.isEmpty,
                    "\(name) 全量回放未产出任何结构化事件——疑似解析入口选错或形状全变")
        }

        // 汇总留痕（测试输出可见，便于漂移排查）。
        print("JT_recorded_fixture_replay: \(jsonlFiles.count) fixtures / \(totalLines) 行 / \(totalEvents) 事件，零 parseError")
    }
}
