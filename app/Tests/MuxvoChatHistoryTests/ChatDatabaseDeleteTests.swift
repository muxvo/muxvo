// ChatDatabase.deleteSession 硬删 + CASCADE（chat-data.md 冻结面修订登记②）。
// fixture 工具（writeSessionFile / ccUser / reconcileCC / searchLineCount / sessionRowExists）复用 ChatIndexerTests.swift。
import Foundation
import GRDB
import Testing

import MuxvoTestSupport
@testable import MuxvoChatHistory

@Suite("ChatDatabase.deleteSession 硬删 + CASCADE")
struct ChatDatabaseDeleteTests {

    /// 该 session 在 chat_search_lines 里的物理行数（按 session_id 定位 pk，直查从表——证 CASCADE 真删物理行、非仅 JOIN 落空）。
    private func rawSearchLines(_ db: ChatDatabase, session: String, source: String) throws -> Int {
        try db.pool.read { conn in
            guard let pk = try Int64.fetchOne(conn, sql:
                "SELECT id FROM chat_sessions WHERE session_id = ? AND source = ?",
                arguments: [session, source]) else { return -1 }  // -1 = session 行已不在
            return try Int.fetchOne(conn, sql:
                "SELECT COUNT(*) FROM chat_search_lines WHERE session_pk = ?", arguments: [pk]) ?? 0
        }
    }

    @Test("deleteSession：删后 sessions 查询不含、search_lines 关联行随 CASCADE 消失；返回 true")
    func deleteRemovesRowsAndCascades() throws {
        try withTempRoot { root in
            let db = try ChatDatabase.open(at: root.appendingPathComponent("chat.db"))
            let cc = root.appendingPathComponent("projects", isDirectory: true)
            try FileManager.default.createDirectory(at: cc, withIntermediateDirectories: true)
            let sid = "S1"
            try writeSessionFile(base: cc, project: "P", session: sid,
                lines: [ccUser("needle one", session: sid), ccUser("needle two", session: sid)])
            try reconcileCC(db, base: cc)

            // 预置：session 行在、search_lines 行在。
            #expect(try sessionRowExists(db, session: sid, source: "cc"))
            #expect(try searchLineCount(db, session: sid) > 0)
            // 直查从表物理行数（CASCADE 前）。
            let before = try rawSearchLines(db, session: sid, source: "cc")
            #expect(before > 0)

            #expect(try db.deleteSession(sessionId: sid) == true)

            // session 行没了、search_lines 关联行没了（JOIN 落空 + 物理行也没了）。
            #expect(try !sessionRowExists(db, session: sid, source: "cc"))
            #expect(try searchLineCount(db, session: sid) == 0)
            #expect(try rawSearchLines(db, session: sid, source: "cc") == -1)  // session 行已删 → pk 查不到
        }
    }

    @Test("deleteSession：删不存在的 sid → 幂等 no-op（返回 false）")
    func deleteNonexistentIsNoop() throws {
        try withTempRoot { root in
            let db = try ChatDatabase.open(at: root.appendingPathComponent("chat.db"))
            #expect(try db.deleteSession(sessionId: "does-not-exist") == false)
        }
    }
}
