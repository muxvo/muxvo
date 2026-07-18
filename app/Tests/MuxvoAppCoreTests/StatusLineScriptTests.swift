// StatusLineScript bash 直测（usage-limit-alert.md §2 / §8 UL_script_*）。
//
// Process 跑 /bin/bash 执行生成式脚本（$TMPDIR fixture，绝不碰真数据根）：验原子写形状、静默
// stdout（用户拍板 2026-07-11）、缺字段/非法输入静默 exit 0、墙钟远低于 CC 5s 超时。
import Foundation
import MuxvoTestSupport
import Testing

@testable import MuxvoAppCore

@Suite("StatusLineScript 传感器脚本（usage-limit-alert.md §2）")
struct StatusLineScriptTests {
    /// 完整 statusline stdin fixture（§1 亲验形状，两窗口齐全）。
    private let fullFixture = """
    {"session_id":"s1","model":{"id":"claude-opus-4-8","display_name":"Opus"},\
    "rate_limits":{"five_hour":{"used_percentage":96.2,"resets_at":1783500000},\
    "seven_day":{"used_percentage":41.0,"resets_at":1783900000}}}
    """

    private struct RunResult {
        let exitCode: Int32
        let stdout: Data
    }

    /// 写出脚本到临时根并以 /bin/bash 执行（stdin 喂 fixture），返回退出码 + stdout。
    private func runScript(dataRoot: URL, stdin: String) throws -> RunResult {
        let scriptURL = StatusLineScript.scriptURL(dataRoot: dataRoot)
        try FileManager.default.createDirectory(
            at: scriptURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        let usagePath = StatusLineScript.usageStatusURL(dataRoot: dataRoot).path
        try StatusLineScript.scriptText(usageStatusPath: usagePath)
            .write(to: scriptURL, atomically: true, encoding: .utf8)

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/bash")
        process.arguments = [scriptURL.path]
        let stdinPipe = Pipe()
        let stdoutPipe = Pipe()
        process.standardInput = stdinPipe
        process.standardOutput = stdoutPipe
        process.standardError = Pipe() // stderr 不入断言（python 缺失等场景静默）
        try process.run()
        stdinPipe.fileHandleForWriting.write(Data(stdin.utf8))
        stdinPipe.fileHandleForWriting.closeFile()
        let out = stdoutPipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        return RunResult(exitCode: process.terminationStatus, stdout: out)
    }

    private func readStatus(dataRoot: URL) -> [String: Any]? {
        let url = StatusLineScript.usageStatusURL(dataRoot: dataRoot)
        guard let data = try? Data(contentsOf: url) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    // MARK: UL_script_writes_atomic

    @Test("UL_script_writes_atomic: 完整 fixture → usage-status.json 两窗口形状正确，run/ 无临时残片")
    func writesAtomic() throws {
        try withTempRoot { root in
            let result = try runScript(dataRoot: root, stdin: fullFixture)
            #expect(result.exitCode == 0)
            let status = readStatus(dataRoot: root)
            #expect((status?["writtenAtMs"] as? NSNumber)?.int64Value ?? 0 > 0)
            let five = status?["fiveHour"] as? [String: Any]
            #expect((five?["usedPct"] as? NSNumber)?.doubleValue == 96.2)
            #expect((five?["resetsAt"] as? NSNumber)?.int64Value == 1_783_500_000)
            let seven = status?["sevenDay"] as? [String: Any]
            #expect((seven?["usedPct"] as? NSNumber)?.doubleValue == 41.0)
            // 原子写不留临时残片（mkstemp 的 .usage-status-* 已 rename 走）。
            let runDir = StatusLineScript.usageStatusURL(dataRoot: root).deletingLastPathComponent()
            let leftovers = (try? FileManager.default.contentsOfDirectory(atPath: runDir.path))?
                .filter { $0.hasPrefix(".usage-status-") } ?? []
            #expect(leftovers.isEmpty)
        }
    }

    // MARK: UL_script_silent_stdout

    @Test("UL_script_silent_stdout: stdout 零字节（静默，用户拍板终端不显示任何文字）")
    func silentStdout() throws {
        try withTempRoot { root in
            let result = try runScript(dataRoot: root, stdin: fullFixture)
            #expect(result.exitCode == 0)
            #expect(result.stdout.isEmpty)
        }
    }

    // MARK: UL_script_missing_fields

    @Test("UL_script_missing_fields: 无 rate_limits → exit 0，文件只有 writtenAtMs 无窗口键")
    func missingFields() throws {
        try withTempRoot { root in
            let result = try runScript(
                dataRoot: root, stdin: #"{"session_id":"s1","model":{"id":"m"}}"#)
            #expect(result.exitCode == 0)
            let status = readStatus(dataRoot: root)
            #expect((status?["writtenAtMs"] as? NSNumber) != nil)
            #expect(status?["fiveHour"] == nil)
            #expect(status?["sevenDay"] == nil)
        }
    }

    // MARK: UL_script_invalid_json_exit0

    @Test("UL_script_invalid_json_exit0: 非法 JSON stdin → exit 0、不写文件、stdout 仍空")
    func invalidJSON() throws {
        try withTempRoot { root in
            let result = try runScript(dataRoot: root, stdin: "not json at all")
            #expect(result.exitCode == 0)
            #expect(result.stdout.isEmpty)
            #expect(readStatus(dataRoot: root) == nil)
        }
    }

    // MARK: UL_script_fast

    @Test("UL_script_fast: 墙钟 < 2s（防 CC statusline 5s 超时）")
    func fast() throws {
        try withTempRoot { root in
            let start = Date()
            _ = try runScript(dataRoot: root, stdin: fullFixture)
            #expect(Date().timeIntervalSince(start) < 2.0)
        }
    }
}
