// CodexRolloutProbe 单测（terminal-session-restore.md §1.5，P-2 fast-follow r3）红→绿。
//
// 覆盖 TSR_CX_ 案例（临时 sessions 树，定向读，无全量扫）：
//   · TSR_CX_probe_directed_dates_and_mtime  只出窗口日期目录内 mtime≥since 候选；窗外日期目录零触碰
//   · TSR_CX_probe_first_line_only_failopen   首行非 session_meta/坏 JSON → 该文件跳过（fail-open）
//   · TSR_CX_probe_caps_candidates            候选上限 32（mtime 降序截断）
//   · dateDirs 性质（含本地今天/昨天、去重）
import Foundation
import Testing

import MuxvoTestSupport
@testable import MuxvoChatHistory

@Suite("CodexRolloutProbe（rollout 定向读，§1.5）")
struct CodexRolloutProbeTests {
    private let sid1 = "019f5c1a-2c34-7b80-a606-a9c7017a6470"
    private let sid2 = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    private let nowMs: Int64 = 1_783_990_000_000 // 固定时钟（可测）

    /// 写一个 rollout 到 sessions/<dateDir>/，设 mtime（ms）。dateDir 形如 "2026/07/14"。
    @discardableResult
    private func writeRollout(
        sessionsDir: URL, dateDir: String, filename: String, lines: [String], mtimeMs: Int64
    ) throws -> URL {
        let dir = sessionsDir.appendingPathComponent(dateDir, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let file = dir.appendingPathComponent(filename, isDirectory: false)
        try lines.joined(separator: "\n").write(to: file, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes(
            [.modificationDate: Date(timeIntervalSince1970: Double(mtimeMs) / 1000.0)],
            ofItemAtPath: file.path)
        return file
    }
    private func metaLine(id: String, cwd: String) -> String {
        #"{"type":"session_meta","timestamp":"2026-07-14T00:00:00.000Z","payload":{"id":"\#(id)","cwd":"\#(cwd)"}}"#
    }

    @Test("TSR_CX_probe_directed_dates_and_mtime：只出窗口日期目录内 mtime≥since 候选；窗外日期目录不触碰")
    func directedDatesAndMtime() throws {
        try withTempRoot { root in
            let sessionsDir = root.appendingPathComponent("sessions", isDirectory: true)
            let today = CodexRolloutProbe.dateDirs(nowMs: nowMs).first!
            // 今天目录：一新（mtime=now）一旧（mtime=now-10min），since 卡中间。
            try writeRollout(sessionsDir: sessionsDir, dateDir: today,
                filename: "rollout-a-\(sid1).jsonl", lines: [metaLine(id: sid1, cwd: "/proj/a")], mtimeMs: nowMs)
            try writeRollout(sessionsDir: sessionsDir, dateDir: today,
                filename: "rollout-b-\(sid2).jsonl", lines: [metaLine(id: sid2, cwd: "/proj/b")],
                mtimeMs: nowMs - 600_000)
            // 窗外日期目录（去年）：即便 mtime 新也不被列（不在 dateDirs 覆盖）。
            try writeRollout(sessionsDir: sessionsDir, dateDir: "2025/01/01",
                filename: "rollout-old-cccccccc-cccc-cccc-cccc-cccccccccccc.jsonl",
                lines: [metaLine(id: "cccccccc-cccc-cccc-cccc-cccccccccccc", cwd: "/proj/c")], mtimeMs: nowMs)

            let since = nowMs - 300_000 // 5min 前 → 只 sid1（now）过，sid2（10min 前）不过
            let hits = CodexRolloutProbe.recentCandidates(sessionsDir: sessionsDir, sinceMs: since, nowMs: nowMs)
            #expect(hits.count == 1, "只 mtime≥since 且在窗口日期目录的候选")
            #expect(hits.first?.sessionId == sid1)
            #expect(hits.first?.cwd == "/proj/a")
            #expect(hits.first?.rolloutPath.hasSuffix("rollout-a-\(sid1).jsonl") == true)
        }
    }

    @Test("TSR_CX_probe_first_line_only_failopen：首行非 session_meta/坏 JSON → 该文件跳过（fail-open）")
    func firstLineOnlyFailOpen() throws {
        try withTempRoot { root in
            let sessionsDir = root.appendingPathComponent("sessions", isDirectory: true)
            let today = CodexRolloutProbe.dateDirs(nowMs: nowMs).first!
            // 首行坏 JSON。
            try writeRollout(sessionsDir: sessionsDir, dateDir: today,
                filename: "rollout-bad-\(sid1).jsonl", lines: ["this is not json", metaLine(id: sid1, cwd: "/p")],
                mtimeMs: nowMs)
            // 首行是别的 type（非 session_meta）。
            try writeRollout(sessionsDir: sessionsDir, dateDir: today,
                filename: "rollout-notmeta-\(sid2).jsonl",
                lines: [#"{"type":"event_msg","payload":{"type":"user_message","message":"hi"}}"#],
                mtimeMs: nowMs)
            // 正常。
            let good = "dddddddd-dddd-dddd-dddd-dddddddddddd"
            try writeRollout(sessionsDir: sessionsDir, dateDir: today,
                filename: "rollout-good-\(good).jsonl", lines: [metaLine(id: good, cwd: "/g")], mtimeMs: nowMs)

            let hits = CodexRolloutProbe.recentCandidates(sessionsDir: sessionsDir, sinceMs: 0, nowMs: nowMs)
            #expect(hits.count == 1, "坏首行/非 meta 首行跳过，只留正常 session_meta")
            #expect(hits.first?.sessionId == good)
        }
    }

    @Test("TSR_CX_probe_caps_candidates：候选上限 32（mtime 降序截断）")
    func capsCandidates() throws {
        try withTempRoot { root in
            let sessionsDir = root.appendingPathComponent("sessions", isDirectory: true)
            let today = CodexRolloutProbe.dateDirs(nowMs: nowMs).first!
            // 40 个文件，mtime 各异（i 越大越新）。
            for i in 0..<40 {
                let id = String(format: "%08x-0000-0000-0000-000000000000", i)
                try writeRollout(sessionsDir: sessionsDir, dateDir: today,
                    filename: "rollout-\(i)-\(id).jsonl", lines: [metaLine(id: id, cwd: "/p")],
                    mtimeMs: nowMs - Int64((40 - i)) * 1000) // i=39 最新
            }
            let hits = CodexRolloutProbe.recentCandidates(sessionsDir: sessionsDir, sinceMs: 0, nowMs: nowMs)
            #expect(hits.count == CodexRolloutProbe.maxCandidates, "截断到上限 32")
            // 降序：首个是最新（i=39）。
            #expect(hits.first?.sessionId == String(format: "%08x-0000-0000-0000-000000000000", 39))
        }
    }

    @Test("dateDirs：含本地今天/昨天 + UTC 今天，去重、格式 YYYY/MM/DD")
    func dateDirsShape() {
        let dirs = CodexRolloutProbe.dateDirs(nowMs: nowMs)
        #expect(!dirs.isEmpty)
        #expect(Set(dirs).count == dirs.count, "去重")
        for d in dirs {
            let parts = d.split(separator: "/")
            #expect(parts.count == 3, "YYYY/MM/DD")
            #expect(parts[0].count == 4 && parts[1].count == 2 && parts[2].count == 2)
        }
        // 本地今天与昨天必不同 → 至少 2 个目录。
        #expect(dirs.count >= 2)
    }

    @Test("sessions 目录不存在 → 空（fail-open，不崩）")
    func missingDirEmpty() throws {
        try withTempRoot { root in
            let hits = CodexRolloutProbe.recentCandidates(
                sessionsDir: root.appendingPathComponent("nope"), sinceMs: 0, nowMs: nowMs)
            #expect(hits.isEmpty)
        }
    }

    @Test("MINOR-3：首行读硬上限——正常大首行（含长 system prompt）过；超上限无换行 → 视损坏跳过（只读前 N 字节）")
    func firstLineByteCap() throws {
        try withTempRoot { root in
            let sessionsDir = root.appendingPathComponent("sessions", isDirectory: true)
            let today = CodexRolloutProbe.dateDirs(nowMs: nowMs).first!
            // 正常：首行含 32KB padding（模拟长 system prompt，仍 < 256KB 上限）→ 过。
            let bigOk = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"
            let padded = #"{"type":"session_meta","payload":{"id":"\#(bigOk)","cwd":"/g","pad":"\#(String(repeating: "x", count: 32 * 1024))"}}"#
            try writeRollout(sessionsDir: sessionsDir, dateDir: today,
                filename: "rollout-big-\(bigOk).jsonl", lines: [padded], mtimeMs: nowMs)
            let okHits = CodexRolloutProbe.recentCandidates(sessionsDir: sessionsDir, sinceMs: 0, nowMs: nowMs)
            #expect(okHits.contains { $0.sessionId == bigOk }, "32KB 首行（<256KB）正常解析")

            // 损坏：单行 > 256KB 且无换行 → 读满上限仍无换行 → 跳过（不 parse 截断串）。
            let dir = sessionsDir.appendingPathComponent(today, isDirectory: true)
            let corrupt = dir.appendingPathComponent("rollout-corrupt-ffffffff-ffff-ffff-ffff-ffffffffffff.jsonl")
            try Data(String(repeating: "z", count: 300 * 1024).utf8).write(to: corrupt) // 300KB 无换行
            try FileManager.default.setAttributes(
                [.modificationDate: Date(timeIntervalSince1970: Double(nowMs) / 1000.0)], ofItemAtPath: corrupt.path)
            let hits2 = CodexRolloutProbe.recentCandidates(sessionsDir: sessionsDir, sinceMs: 0, nowMs: nowMs)
            #expect(!hits2.contains { $0.rolloutPath.contains("corrupt") }, "超上限无换行首行 → 损坏跳过")
        }
    }
}
