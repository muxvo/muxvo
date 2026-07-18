// MemoizingCodexSource.prime() 增量缓存契约（P0 CPU 风暴修复批0，m5/r1-fix1）。
//
// 黑盒钉死批3 的 per-file (path, mtime, size) 缓存语义（与 ChatIndexer 三态 skip 同口径先例）：
//  · 红测：path/mtime/size 三不变 + 内容改写 → re-prime **不重读**（输出与首次相等）。现实现每次
//    prime 全量重读见新内容 → 红；缓存命中 → 绿。「同 (mtime,size) 改内容不生效」是设计内行为。
//  · 双绿钉子（防过度缓存/逐出缺陷）：mtime 变化重读见新值；新文件出现可见；删除文件消失。
import Foundation
import Testing

import MuxvoTestSupport
@testable import MuxvoChatHistory

@Suite("Codex prime 增量缓存契约")
struct CodexPrimeCacheTests {

    /// 在 base（充当 ~/.codex）下写 sessions/y/m/d/filename，行 join \n，可设 mtime（范式同 CodexSourceTests）。
    @discardableResult
    private func writeSession(
        base: URL, y: String = "2026", m: String = "07", d: String = "08", filename: String,
        lines: [String], mtime: Date? = nil
    ) throws -> URL {
        let dir = base.appendingPathComponent("sessions/\(y)/\(m)/\(d)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let file = dir.appendingPathComponent(filename, isDirectory: false)
        try lines.joined(separator: "\n").write(to: file, atomically: true, encoding: .utf8)
        if let mtime {
            try FileManager.default.setAttributes([.modificationDate: mtime], ofItemAtPath: file.path)
        }
        return file
    }

    private func metaLine(id: String, cwd: String) -> String {
        #"{"type":"session_meta","timestamp":"2026-07-08T00:00:00.000Z","payload":{"id":"\#(id)","cwd":"\#(cwd)","timestamp":"2026-07-08T00:00:00.000Z"}}"#
    }
    private func userLine(_ message: String) -> String {
        #"{"type":"event_msg","timestamp":"2026-07-08T00:00:01.000Z","payload":{"type":"user_message","message":"\#(message)"}}"#
    }

    private func makeMemo(_ base: URL) -> MemoizingCodexSource {
        let src = CodexSessionSource(codexBasePath: base)
        return MemoizingCodexSource(source: src, concrete: src)
    }

    /// 线程安全计数器（读计数注入缝用）。
    private final class Counter: @unchecked Sendable {
        private let lock = NSLock()
        private var n = 0
        func bump() { lock.withLock { n += 1 } }
        var value: Int { lock.withLock { n } }
    }

    @Test("缓存键 (path,mtime,size)：三不变 + 同字节长改内容 → re-prime 不重读（输出与首次相等）")
    func unchangedStatSkipsReread() throws {
        try withTempRoot { root in
            let id = "0000-1111-2222-3333-4444"
            let name = "rollout-2026-07-08T00-00-00-\(id).jsonl"
            let mtime = Date(timeIntervalSince1970: 1_700_000_000)
            // cwd "/w"→"/x"、"hello one"→"hello two" 均同字节长 → size 不变；mtime 写回原值。
            try writeSession(base: root, filename: name,
                             lines: [metaLine(id: id, cwd: "/w"), userLine("hello one")], mtime: mtime)
            let memo = makeMemo(root)
            memo.prime()
            let sessionsBefore = memo.getAllRecentSessions(limit: 10)
            let projectsBefore = memo.getProjects()
            #expect(sessionsBefore.count == 1)

            try writeSession(base: root, filename: name,
                             lines: [metaLine(id: id, cwd: "/x"), userLine("hello two")], mtime: mtime)
            memo.prime()
            // (path,mtime,size) 三不变 → 缓存命中不重读：summaries/projects 与首次逐字段相等。
            #expect(memo.getAllRecentSessions(limit: 10) == sessionsBefore)
            #expect(memo.getProjects() == projectsBefore)
        }
    }

    @Test("mtime 变化 → re-prime 重读见新内容（防过度缓存，双绿钉子）")
    func mtimeChangeRereads() throws {
        try withTempRoot { root in
            let id = "aaaa-bbbb-cccc-dddd-0001"
            let name = "rollout-2026-07-08T00-00-00-\(id).jsonl"
            try writeSession(base: root, filename: name,
                             lines: [metaLine(id: id, cwd: "/w"), userLine("old title")],
                             mtime: Date(timeIntervalSince1970: 1_700_000_000))
            let memo = makeMemo(root)
            memo.prime()
            #expect(memo.getAllRecentSessions(limit: 10).first?.title == "old title")

            try writeSession(base: root, filename: name,
                             lines: [metaLine(id: id, cwd: "/w"), userLine("new title")],
                             mtime: Date(timeIntervalSince1970: 1_700_000_002))
            memo.prime()
            #expect(memo.getAllRecentSessions(limit: 10).first?.title == "new title")
        }
    }

    @Test("新文件出现 → re-prime 可见；删除 → re-prime 消失（逐出，双绿钉子）")
    func addAndRemoveReflected() throws {
        try withTempRoot { root in
            let a = "aaaa-bbbb-cccc-dddd-000a"
            try writeSession(base: root, filename: "rollout-2026-07-08T00-00-00-\(a).jsonl",
                             lines: [metaLine(id: a, cwd: "/w"), userLine("qa")],
                             mtime: Date(timeIntervalSince1970: 1_700_000_000))
            let memo = makeMemo(root)
            memo.prime()
            #expect(memo.getAllRecentSessions(limit: 10).count == 1)

            let b = "aaaa-bbbb-cccc-dddd-000b"
            let fileB = try writeSession(
                base: root, filename: "rollout-2026-07-08T00-00-01-\(b).jsonl",
                lines: [metaLine(id: b, cwd: "/w"), userLine("qb")],
                mtime: Date(timeIntervalSince1970: 1_700_000_005))
            memo.prime()
            #expect(Set(memo.getAllRecentSessions(limit: 10).map(\.sessionId)) == [a, b])

            try FileManager.default.removeItem(at: fileB)
            memo.prime()
            #expect(memo.getAllRecentSessions(limit: 10).map(\.sessionId) == [a])
        }
    }

    @Test("读计数：冷 buildIndex 逐文件 readMeta；未变 re-build readMeta=0 只 stat；单文件变恰 +1")
    func readCountsIncrementalRebuild() throws {
        try withTempRoot { root in
            let ids = ["aaaa-bbbb-cccc-dddd-0c01", "aaaa-bbbb-cccc-dddd-0c02", "aaaa-bbbb-cccc-dddd-0c03"]
            var files: [URL] = []
            for (i, id) in ids.enumerated() {
                files.append(try writeSession(
                    base: root, filename: "rollout-2026-07-08T00-00-0\(i)-\(id).jsonl",
                    lines: [metaLine(id: id, cwd: "/w"), userLine("q\(i)")],
                    mtime: Date(timeIntervalSince1970: 1_700_000_000 + Double(i))))
            }
            let src = CodexSessionSource(codexBasePath: root)
            let metaReads = Counter()
            let statCalls = Counter()
            let cache = CodexIndexCache(
                statFile: { statCalls.bump(); return PosixStat.of($0).map { (mtimeMs: $0.mtimeMs, size: $0.size) } },
                readMeta: { metaReads.bump(); return src.readSessionMeta($0) },
                readFirstUser: { src.extractFirstUserMessage($0) })
            let sessionsDir = root.appendingPathComponent("sessions", isDirectory: true)

            let cold = cache.buildIndex(sessionsDir: sessionsDir, titles: [:])
            #expect(cold.count == 3)
            #expect(metaReads.value == 3)
            #expect(statCalls.value == 3)

            let warm = cache.buildIndex(sessionsDir: sessionsDir, titles: [:])
            #expect(warm.count == 3)
            #expect(metaReads.value == 3, "未变 re-build 不重读文件")
            #expect(statCalls.value == 6, "但每文件仍 stat（变化探测）")
            #expect(warm.map(\.sessionId) == cold.map(\.sessionId))

            // 只动第 2 个文件（mtime 前移）→ 恰 +1 次 readMeta
            try writeSession(
                base: root, filename: files[1].lastPathComponent,
                lines: [metaLine(id: ids[1], cwd: "/w2"), userLine("q1x")],
                mtime: Date(timeIntervalSince1970: 1_700_000_009))
            let third = cache.buildIndex(sessionsDir: sessionsDir, titles: [:])
            #expect(metaReads.value == 4, "单文件变化恰重读 1 个")
            #expect(third.first { $0.sessionId == ids[1] }?.cwd == "/w2")
        }
    }

    @Test("读计数：firstUser memo 同 (mtime,size) 只算一次；文件变后随 Record 换新自动失效")
    func firstUserMemoInvalidatesWithRecord() throws {
        try withTempRoot { root in
            let id = "aaaa-bbbb-cccc-dddd-0f01"
            let name = "rollout-2026-07-08T00-00-00-\(id).jsonl"
            let file = try writeSession(
                base: root, filename: name,
                lines: [metaLine(id: id, cwd: "/w"), userLine("first q")],
                mtime: Date(timeIntervalSince1970: 1_700_000_000))
            let src = CodexSessionSource(codexBasePath: root)
            let firstUserReads = Counter()
            let cache = CodexIndexCache(
                statFile: { PosixStat.of($0).map { (mtimeMs: $0.mtimeMs, size: $0.size) } },
                readMeta: { src.readSessionMeta($0) },
                readFirstUser: { firstUserReads.bump(); return src.extractFirstUserMessage($0) })
            let sessionsDir = root.appendingPathComponent("sessions", isDirectory: true)

            _ = cache.buildIndex(sessionsDir: sessionsDir, titles: [:])
            #expect(cache.firstUserMessage(for: file) == "first q")
            #expect(cache.firstUserMessage(for: file) == "first q")
            #expect(firstUserReads.value == 1, "memo 命中不重调")

            _ = cache.buildIndex(sessionsDir: sessionsDir, titles: [:])  // 未变：memo 随 Record 迁移
            #expect(cache.firstUserMessage(for: file) == "first q")
            #expect(firstUserReads.value == 1)

            try writeSession(
                base: root, filename: name,
                lines: [metaLine(id: id, cwd: "/w"), userLine("new q")],
                mtime: Date(timeIntervalSince1970: 1_700_000_005))
            _ = cache.buildIndex(sessionsDir: sessionsDir, titles: [:])  // 变化：Record 换新 → memo 失效
            #expect(cache.firstUserMessage(for: file) == "new q")
            #expect(firstUserReads.value == 2)
        }
    }

    @Test("titles 表换新 → re-prime 后 title 更新（title 不入 per-file 缓存，防 global-state 陈旧）")
    func titlesRefreshEvenWhenFilesUnchanged() throws {
        try withTempRoot { root in
            let id = "aaaa-bbbb-cccc-dddd-00t1"
            try writeSession(base: root, filename: "rollout-2026-07-08T00-00-00-\(id).jsonl",
                             lines: [metaLine(id: id, cwd: "/w"), userLine("fallback q")],
                             mtime: Date(timeIntervalSince1970: 1_700_000_000))
            let memo = makeMemo(root)
            memo.prime()
            #expect(memo.getAllRecentSessions(limit: 10).first?.title == "fallback q")

            // 文件不变，只落 thread-titles → re-prime 后 title 必须换新（缓存若烘死 title 此处红）。
            let state = #"{"thread-titles":{"titles":{"\#(id)":"Curated"}}}"#
            try state.write(to: root.appendingPathComponent(".codex-global-state.json"),
                            atomically: true, encoding: .utf8)
            memo.prime()
            #expect(memo.getAllRecentSessions(limit: 10).first?.title == "Curated")
        }
    }
}
