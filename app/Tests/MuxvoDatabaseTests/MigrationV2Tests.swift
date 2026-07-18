// migration v2_m4a_control_plane 的 schema 契约测试。
// DDL 权威：policy-audit.md §5（audit_log 字段基线 + append-only）+ 任务 A 指令表。
// 工艺仿同目录 MuxvoDatabaseTests：withTempRoot 隔离 + 原始 SQL 直断 schema 实物
//（不经 Record 类型——迁移层断言与领域映射解耦，且令未实现时跑得出干净运行期红灯）。
import Foundation
import GRDB
import MuxvoTestSupport
import Testing

@testable import MuxvoDatabase

@Suite("migration v2：audit_log 表 + tasks 新列")
struct MigrationV2SchemaTests {
    @Test("audit_log 表存在且可 insert 一行") // 验收 v2-①
    func auditLogInsertable() throws {
        try withTempRoot { root in
            let db = try MuxvoDatabase.open(at: root.appendingPathComponent("s.db"))
            try db.pool.write { conn in
                try conn.execute(
                    sql: """
                    INSERT INTO audit_log (ts, task_id, category, decision, input_digest)
                    VALUES (100, 't1', 'whitelist_allow', 'allow', ?)
                    """,
                    arguments: [String(repeating: "a", count: 64)]
                )
            }
            let (count, basisDefault, decision) = try db.pool.read { conn in
                (
                    try Int.fetchOne(conn, sql: "SELECT count(*) FROM audit_log") ?? -1,
                    try String.fetchOne(conn, sql: "SELECT basis FROM audit_log LIMIT 1"),
                    try String.fetchOne(conn, sql: "SELECT decision FROM audit_log LIMIT 1")
                )
            }
            #expect(count == 1)
            #expect(basisDefault == "{}") // basis DEFAULT '{}'
            #expect(decision == "allow")
        }
    }

    @Test("audit_log UPDATE 被触发器 ABORT（append-only）") // 验收 v2-②
    func auditLogUpdateAborts() throws {
        try withTempRoot { root in
            let db = try MuxvoDatabase.open(at: root.appendingPathComponent("s.db"))
            try db.pool.write { conn in
                try conn.execute(
                    sql: "INSERT INTO audit_log (ts, category, decision) VALUES (1, 'c', 'allow')")
            }
            do {
                try db.pool.write { conn in
                    try conn.execute(sql: "UPDATE audit_log SET decision = 'deny'")
                }
                Issue.record("UPDATE 应当被触发器 ABORT")
            } catch let error as DatabaseError {
                #expect(error.message?.contains("append-only") == true)
            }
        }
    }

    @Test("audit_log DELETE 被触发器 ABORT（append-only）") // 验收 v2-②
    func auditLogDeleteAborts() throws {
        try withTempRoot { root in
            let db = try MuxvoDatabase.open(at: root.appendingPathComponent("s.db"))
            try db.pool.write { conn in
                try conn.execute(
                    sql: "INSERT INTO audit_log (ts, category, decision) VALUES (1, 'c', 'allow')")
            }
            do {
                try db.pool.write { conn in
                    try conn.execute(sql: "DELETE FROM audit_log")
                }
                Issue.record("DELETE 应当被触发器 ABORT")
            } catch let error as DatabaseError {
                #expect(error.message?.contains("append-only") == true)
            }
        }
    }

    @Test("tasks 新列 verification_command / account_id 可写读") // 验收 v2-③
    func tasksNewColumnsWritable() throws {
        try withTempRoot { root in
            let db = try MuxvoDatabase.open(at: root.appendingPathComponent("s.db"))
            try db.pool.write { conn in
                try conn.execute(
                    sql: """
                    INSERT INTO tasks (id, title, state, created_at, updated_at,
                                       verification_command, account_id)
                    VALUES ('t2', 'y', 'created', 1, 1, 'swift test', 'acct-1')
                    """)
            }
            let (verif, account) = try db.pool.read { conn in
                (
                    try String.fetchOne(
                        conn, sql: "SELECT verification_command FROM tasks WHERE id = 't2'"),
                    try String.fetchOne(conn, sql: "SELECT account_id FROM tasks WHERE id = 't2'")
                )
            }
            #expect(verif == "swift test")
            #expect(account == "acct-1")
        }
    }

    @Test("v1→v2：已有 v1 数据的库升级干净通过，v1 行保留、audit_log 与新列就位") // 验收 v2-④
    func v1ToV2UpgradePreservesData() throws {
        try withTempRoot { root in
            let url = root.appendingPathComponent("s.db")
            let migrator = Migrations.migrator()
            let pool = try DatabasePool(path: url.path)
            // 只升到 v1，造既有 v1 数据（模拟旧库）
            try migrator.migrate(pool, upTo: "v1_m1_orchestration_base")
            try pool.write { conn in
                try conn.execute(
                    sql: """
                    INSERT INTO tasks (id, title, state, created_at, updated_at)
                    VALUES ('legacy-1', 'old', 'created', 1, 1)
                    """)
            }
            // 应用全部迁移（含 v2）——旧库无 v2 时干净追加，不重放 v1
            try migrator.migrate(pool)
            let (auditExists, legacyTitle, hasNewCols, v2Applied) = try pool.read {
                conn -> (Bool, String?, Bool, Bool) in
                let audit = try Bool.fetchOne(
                    conn,
                    sql: "SELECT count(*) > 0 FROM sqlite_master WHERE type = 'table' AND name = 'audit_log'"
                ) ?? false
                let title = try String.fetchOne(conn, sql: "SELECT title FROM tasks WHERE id = 'legacy-1'")
                let cols = try String.fetchAll(conn, sql: "SELECT name FROM pragma_table_info('tasks')")
                let applied = try migrator.appliedIdentifiers(conn)
                return (
                    audit, title,
                    cols.contains("verification_command") && cols.contains("account_id"),
                    applied.contains("v2_m4a_control_plane")
                )
            }
            #expect(auditExists)
            #expect(legacyTitle == "old") // v1 数据未被扰动
            #expect(hasNewCols)
            #expect(v2Applied)
        }
    }
}

@Suite("v2 Record 映射：AuditLogRecord / TaskRecord 新列")
struct MigrationV2RecordTests {
    @Test("AuditLogRecord insert 往返：snake_case 列映射 + seq 由 AUTOINCREMENT 分配")
    func auditLogRecordRoundTrip() throws {
        try withTempRoot { root in
            let db = try MuxvoDatabase.open(at: root.appendingPathComponent("s.db"))
            let digest = String(repeating: "b", count: 64) // 全长 sha256 hex 64（SEC-18）
            let seq: Int64 = try db.pool.write { conn in
                var rec = AuditLogRecord(
                    ts: 42, taskId: "task-x", category: "hardlist_escalate",
                    decision: "escalate", basis: "{\"listItem\":\"rm_rf\"}",
                    inputDigest: digest, eventSeq: 7, detailRef: "logs/tasks/task-x/1.json"
                )
                try rec.insert(conn)
                return conn.lastInsertedRowID
            }
            let fetched = try db.pool.read { conn in
                try AuditLogRecord.fetchOne(conn, key: seq)
            }
            #expect(fetched?.ts == 42)
            #expect(fetched?.taskId == "task-x")
            #expect(fetched?.category == "hardlist_escalate")
            #expect(fetched?.decision == "escalate")
            #expect(fetched?.basis == "{\"listItem\":\"rm_rf\"}")
            #expect(fetched?.inputDigest == digest)
            #expect(fetched?.eventSeq == 7)
            #expect(fetched?.detailRef == "logs/tasks/task-x/1.json")
        }
    }

    @Test("TaskRecord 新列 verificationCommand/accountId 经 GRDB 往返，默认 nil 不破既有")
    func taskRecordNewColumnsRoundTrip() throws {
        try withTempRoot { root in
            let db = try MuxvoDatabase.open(at: root.appendingPathComponent("s.db"))
            let withGuards = TaskRecord(
                id: "g1", title: "t", state: "created", createdAt: 1, updatedAt: 1,
                verificationCommand: "swift test", accountId: "acct-9"
            )
            let plain = TaskRecord(id: "g2", title: "t", state: "created", createdAt: 1, updatedAt: 1)
            try db.pool.write { conn in
                try withGuards.insert(conn)
                try plain.insert(conn)
            }
            let (a, b) = try db.pool.read { conn in
                (try TaskRecord.fetchOne(conn, key: "g1"), try TaskRecord.fetchOne(conn, key: "g2"))
            }
            #expect(a?.verificationCommand == "swift test")
            #expect(a?.accountId == "acct-9")
            #expect(b?.verificationCommand == nil) // 默认 nil
            #expect(b?.accountId == nil)
            #expect(a == withGuards) // 完整往返相等（新列已纳入 Equatable）
        }
    }
}
