// chat.db 引导 + indexer 增量三态（specs/behavior/chat-data.md §7 indexer + §0 派生缓存）。
// schema 版本不认识重建 + 增长/回退/消失三态 + mirror 行不动。
import Foundation
import GRDB
import Testing

import MuxvoTestSupport
@testable import MuxvoChatHistory

// MARK: - fixture 工具

/// 在 base（CC 项目根或镜像根）下写 `<project>/<session>.jsonl`，行 join `\n`，可设 mtime。
@discardableResult
func writeSessionFile(
    base: URL, project: String, session: String, lines: [String], mtime: Date? = nil
) throws -> URL {
    let dir = base.appendingPathComponent(project, isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let file = dir.appendingPathComponent("\(session).jsonl", isDirectory: false)
    // 真实 CC 会话每行（含末行）均 `\n` 结尾（实测 ~/.claude 与批1 fixture 皆如此）——fixture 照此。
    try (lines.joined(separator: "\n") + "\n").write(to: file, atomically: true, encoding: .utf8)
    if let mtime {
        try FileManager.default.setAttributes([.modificationDate: mtime], ofItemAtPath: file.path)
    }
    return file
}

/// CC user 行（含 sessionId/timestamp/message.content）。
func ccUser(_ text: String, session: String = "S", ts: String = "2026-07-06T00:00:00.000Z") -> String {
    #"{"type":"user","sessionId":"\#(session)","timestamp":"\#(ts)","message":{"role":"user","content":"\#(text)"}}"#
}

func reconcileCC(_ db: ChatDatabase, base: URL, source: String = "cc") throws {
    let facts = ChatDirectoryScanner(base: base).scan()
    try ChatIndexer(database: db).reconcile(facts: facts, source: source)
}

func searchLineCount(_ db: ChatDatabase, session: String) throws -> Int {
    try db.pool.read { conn in
        try Int.fetchOne(conn, sql: """
            SELECT COUNT(*) FROM chat_search_lines l JOIN chat_sessions s ON s.id = l.session_pk
            WHERE s.session_id = ?
            """, arguments: [session]) ?? 0
    }
}

func sessionRowExists(_ db: ChatDatabase, session: String, source: String) throws -> Bool {
    try db.pool.read { conn in
        (try Int.fetchOne(conn, sql:
            "SELECT COUNT(*) FROM chat_sessions WHERE session_id = ? AND source = ?",
            arguments: [session, source]) ?? 0) > 0
    }
}

// MARK: - schema 版本重建（§0 派生缓存特权）

@Suite("chat.db 引导 + schema 重建")
struct ChatDatabaseTests {

    @Test("PRAGMA 工艺：WAL / synchronous=NORMAL / foreign_keys=ON / busy_timeout=5000 + user_version")
    func bootstrapPragmas() throws {
        try withTempRoot { root in
            let db = try ChatDatabase.open(at: root.appendingPathComponent("chat.db"))
            let (journal, sync, fk, busy, ver) = try db.pool.read { conn in
                (try String.fetchOne(conn, sql: "PRAGMA journal_mode"),
                 try Int.fetchOne(conn, sql: "PRAGMA synchronous"),
                 try Int.fetchOne(conn, sql: "PRAGMA foreign_keys"),
                 try Int.fetchOne(conn, sql: "PRAGMA busy_timeout"),
                 try Int.fetchOne(conn, sql: "PRAGMA user_version"))
            }
            #expect(journal == "wal")
            #expect(sync == 1)
            #expect(fk == 1)
            #expect(busy == 5000)
            #expect(ver == ChatDatabase.schemaVersion)
        }
    }

    @Test("schema 版本不认识 → 删表重建（派生缓存特权：老数据丢弃）")
    func unknownVersionRebuilds() throws {
        try withTempRoot { root in
            let url = root.appendingPathComponent("chat.db")
            do {
                let db1 = try ChatDatabase.open(at: url)
                try db1.pool.write { conn in
                    try conn.execute(sql: """
                        INSERT INTO chat_sessions (source, dir_name, session_id, file_size, file_mtime_ms)
                        VALUES ('cc', 'P', 'S', 10, 20)
                        """)
                    try conn.execute(sql: "PRAGMA user_version = 99")  // 伪造不认识的版本
                }
            }  // db1 出作用域 → pool 释放
            let db2 = try ChatDatabase.open(at: url)
            #expect(try db2.userVersion() == ChatDatabase.schemaVersion)  // 盖回当前版本
            let count = try db2.pool.read { try Int.fetchOne($0, sql: "SELECT COUNT(*) FROM chat_sessions") }
            #expect(count == 0)  // 表被重建，老行丢弃
        }
    }
}

// MARK: - indexer 增量三态（§7）

@Suite("indexer 增量三态（增长/回退/消失）+ mirror 行不动")
struct ChatIndexerThreeStateTests {

    @Test("增长：追加行 → 从 indexed_bytes 续解析 append 搜索行（不重扫全文）")
    func growAppends() throws {
        try withTempRoot { root in
            let cc = root.appendingPathComponent("projects", isDirectory: true)
            let db = try ChatDatabase.open(at: root.appendingPathComponent("chat.db"))
            try writeSessionFile(base: cc, project: "P", session: "S",
                lines: [ccUser("hello alpha"), ccUser("second beta")],
                mtime: Date(timeIntervalSince1970: 1000))
            try reconcileCC(db, base: cc)
            #expect(try searchLineCount(db, session: "S") == 2)
            let firstIndexed = try db.pool.read { try Int64.fetchOne($0,
                sql: "SELECT indexed_bytes FROM chat_sessions WHERE session_id='S'") } ?? 0

            // 追加一行、新 mtime → 增长
            try writeSessionFile(base: cc, project: "P", session: "S",
                lines: [ccUser("hello alpha"), ccUser("second beta"), ccUser("third gamma")],
                mtime: Date(timeIntervalSince1970: 2000))
            try reconcileCC(db, base: cc)
            #expect(try searchLineCount(db, session: "S") == 3)
            let secondIndexed = try db.pool.read { try Int64.fetchOne($0,
                sql: "SELECT indexed_bytes FROM chat_sessions WHERE session_id='S'") } ?? 0
            #expect(secondIndexed > firstIndexed)  // 断点前进
        }
    }

    @Test("增长回归（批2 对抗 NIT-2）：续解析 line_no 连续接续、老行不重插不篡改、新行可搜")
    func growPreservesLineNoContinuity() throws {
        try withTempRoot { root in
            let cc = root.appendingPathComponent("projects", isDirectory: true)
            let db = try ChatDatabase.open(at: root.appendingPathComponent("chat.db"))
            try writeSessionFile(base: cc, project: "P", session: "S",
                lines: [ccUser("hello alpha"), ccUser("second beta")],
                mtime: Date(timeIntervalSince1970: 1000))
            try reconcileCC(db, base: cc)
            // 增长追加一行。
            try writeSessionFile(base: cc, project: "P", session: "S",
                lines: [ccUser("hello alpha"), ccUser("second beta"), ccUser("third gamma")],
                mtime: Date(timeIntervalSince1970: 2000))
            try reconcileCC(db, base: cc)

            // 搜索行 = 恰 3 行、line_no 0/1/2 连续、文本按文件序（老两行原位不动、新行接尾）。
            let rows = try db.pool.read { conn in
                try Row.fetchAll(conn, sql: """
                    SELECT l.line_no AS n, l.text AS t FROM chat_search_lines l
                    JOIN chat_sessions s ON s.id = l.session_pk
                    WHERE s.session_id = 'S' ORDER BY l.line_no ASC
                    """)
            }
            #expect(rows.map { $0["n"] as Int64 } == [0, 1, 2])   // 连续接续，非重启/跳号
            #expect(rows.map { $0["t"] as String } == ["hello alpha", "second beta", "third gamma"])
            // 老行仍首命中在 line_no 0；新行可搜。
            let store = ChatStore(ccBase: cc, database: db)
            #expect(try store.search(query: "hello alpha").count == 1)
            #expect(try store.search(query: "third gamma").count == 1)
        }
    }

    @Test("回退/重写：文件缩小重写 → 删行重建（老搜索行清空）")
    func rewriteRebuilds() throws {
        try withTempRoot { root in
            let cc = root.appendingPathComponent("projects", isDirectory: true)
            let db = try ChatDatabase.open(at: root.appendingPathComponent("chat.db"))
            try writeSessionFile(base: cc, project: "P", session: "S",
                lines: [ccUser("aaaa"), ccUser("bbbb"), ccUser("cccc")],
                mtime: Date(timeIntervalSince1970: 1000))
            try reconcileCC(db, base: cc)
            #expect(try searchLineCount(db, session: "S") == 3)

            // 重写为更短内容（size 变小）→ rebuild
            try writeSessionFile(base: cc, project: "P", session: "S",
                lines: [ccUser("x")],
                mtime: Date(timeIntervalSince1970: 2000))
            try reconcileCC(db, base: cc)
            #expect(try searchLineCount(db, session: "S") == 1)  // 老 3 行清、新 1 行
            // 且新内容可搜、老内容搜不到
            let store = ChatStore(ccBase: cc, database: db)
            #expect(try store.search(query: "aaaa").isEmpty)
            #expect(try store.search(query: "x").count == 1)
        }
    }

    @Test("消失：CC 文件删除 → chat_sessions 行删（CASCADE 搜索行）；mirror 行不动")
    func disappearDeletesCCOnly() throws {
        try withTempRoot { root in
            let cc = root.appendingPathComponent("projects", isDirectory: true)
            let mirror = root.appendingPathComponent("mirror", isDirectory: true)
            let db = try ChatDatabase.open(at: root.appendingPathComponent("chat.db"))
            // 同 session 在 cc 与 mirror 各一份
            try writeSessionFile(base: cc, project: "P", session: "S", lines: [ccUser("live one")])
            try writeSessionFile(base: mirror, project: "P", session: "S", lines: [ccUser("mirror one")])
            try reconcileCC(db, base: cc, source: "cc")
            try reconcileCC(db, base: mirror, source: "mirror")
            #expect(try sessionRowExists(db, session: "S", source: "cc"))
            #expect(try sessionRowExists(db, session: "S", source: "mirror"))

            // 删 CC 文件 → 再 reconcile('cc')
            try FileManager.default.removeItem(at: cc.appendingPathComponent("P/S.jsonl"))
            try reconcileCC(db, base: cc, source: "cc")
            #expect(try sessionRowExists(db, session: "S", source: "cc") == false)  // cc 行删
            #expect(try sessionRowExists(db, session: "S", source: "mirror"))       // mirror 行不动
            #expect(try searchLineCount(db, session: "S") == 1)  // 仅剩 mirror 的搜索行
        }
    }
}
