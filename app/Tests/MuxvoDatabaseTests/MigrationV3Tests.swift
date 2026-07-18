// migration v3_m4a_takeover_session 的 schema 契约测试（scheduler-worker.md §4.7⑤ r2，批4.6 W-B）。
// tasks 加列 session_id（nullable TEXT，append migration——_INDEX §3 既定通道）；SEC-17 口径零改
//（resume 只允许本任务已记录 id，含跨重启——持久化正是「含跨重启」的载体）。
// 工艺仿同目录 MigrationV2Tests：withTempRoot 隔离 + 原始 SQL 直断 schema 实物。
import Foundation
import GRDB
import MuxvoTestSupport
import Testing

@testable import MuxvoDatabase

@Suite("migration v3：tasks.session_id 列")
struct MigrationV3SchemaTests {
    @Test("tasks.session_id 列存在、nullable、可写读") // §4.7⑤ sessionId 持久化
    func sessionIdColumnWritable() throws {
        try withTempRoot { root in
            let db = try MuxvoDatabase.open(at: root.appendingPathComponent("s.db"))
            // 列存在（PRAGMA 实物断言，不经 Record 映射——未迁移时给干净运行期红灯）。
            let hasColumn = try db.pool.read { conn in
                try Row.fetchAll(conn, sql: "PRAGMA table_info(tasks)")
                    .contains { $0["name"] == "session_id" }
            }
            #expect(hasColumn, "tasks 表须有 session_id 列（migration v3）")

            // nullable：不带 session_id 的 insert 照常成功（既有写路径零改动）。
            try db.pool.write { conn in
                try conn.execute(
                    sql: """
                    INSERT INTO tasks (id, title, state, created_at, updated_at)
                    VALUES ('t1', 'x', 'created', 1, 1)
                    """)
            }
            // 可写读回。
            try db.pool.write { conn in
                try conn.execute(
                    sql: "UPDATE tasks SET session_id = 'sess-1' WHERE id = 't1'")
            }
            let readBack = try db.pool.read { conn in
                try String.fetchOne(conn, sql: "SELECT session_id FROM tasks WHERE id = 't1'")
            }
            #expect(readBack == "sess-1")
        }
    }

    @Test("TaskRecord 映射 session_id：写入经 Record 往返") // Record 层映射（Codable 列名）
    func taskRecordRoundtrip() throws {
        try withTempRoot { root in
            let db = try MuxvoDatabase.open(at: root.appendingPathComponent("s.db"))
            var rec = TaskRecord(
                id: "t2", title: "x", state: "created", createdAt: 1, updatedAt: 1)
            rec.sessionId = "sess-2"
            try db.pool.write { conn in try rec.insert(conn) }
            let fetched = try db.pool.read { conn in
                try TaskRecord.fetchOne(conn, key: "t2")
            }
            #expect(fetched?.sessionId == "sess-2")
        }
    }
}
