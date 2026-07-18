import Foundation
import GRDB
import MuxvoTestSupport
import Testing

@testable import MuxvoDatabase
@testable import MuxvoStorage

private func makeTaskRow(id: String = UUID().uuidString.lowercased()) -> TaskRecord {
    TaskRecord(id: id, title: "t", state: "created", createdAt: 1, updatedAt: 1)
}

private func makeEventRow(taskId: String) -> TaskEventRecord {
    TaskEventRecord(
        taskId: taskId, kind: "task_created", payload: "{}", actor: "user",
        fromState: nil, toState: "created", createdAt: 1
    )
}

@Suite("MuxvoDatabase 引导与迁移")
struct DatabaseBootstrapTests {
    @Test("PRAGMA 配置生效：WAL / synchronous=NORMAL / foreign_keys=ON / busy_timeout=5000") // 验收 8-引导
    func pragmaConfiguration() throws {
        try withTempRoot { root in
            let db = try MuxvoDatabase.open(at: root.appendingPathComponent("s.db"))
            let (journalMode, synchronous, foreignKeys, busyTimeout) = try db.pool.read { conn in
                (
                    try String.fetchOne(conn, sql: "PRAGMA journal_mode"),
                    try Int.fetchOne(conn, sql: "PRAGMA synchronous"),
                    try Int.fetchOne(conn, sql: "PRAGMA foreign_keys"),
                    try Int.fetchOne(conn, sql: "PRAGMA busy_timeout")
                )
            }
            #expect(journalMode == "wal")
            #expect(synchronous == 1) // NORMAL = 1
            #expect(foreignKeys == 1)
            #expect(busyTimeout == 5000)
        }
    }

    @Test("迁移幂等：同一 DB 打开两次不重放，首开数据仍在") // 验收 8-①
    func migrationIdempotent() throws {
        try withTempRoot { root in
            let url = root.appendingPathComponent("s.db")
            let first = try MuxvoDatabase.open(at: url)
            let row = makeTaskRow()
            try first.pool.write { conn in try row.insert(conn) }
            #expect(try first.appliedMigrationIdentifiers()
                == ["v1_m1_orchestration_base", "v2_m4a_control_plane", "v3_m4a_takeover_session", "v4_m4a_task_archive", "v5_m4b_brain_idempotency", "v6_m4c_pipeline_templates"])

            // 二次 open：DDL 无 IF NOT EXISTS，若重放此处必抛；数据保留是「不重放」的实证
            let second = try MuxvoDatabase.open(at: url)
            #expect(try second.appliedMigrationIdentifiers()
                == ["v1_m1_orchestration_base", "v2_m4a_control_plane", "v3_m4a_takeover_session", "v4_m4a_task_archive", "v5_m4b_brain_idempotency", "v6_m4c_pipeline_templates"])
            let fetched = try second.pool.read { conn in
                try TaskRecord.fetchOne(conn, key: row.id)
            }
            #expect(fetched == row)
        }
    }

    @Test("schema 实物核对：两表、两触发器、四索引存在")
    func schemaObjectsExist() throws {
        try withTempRoot { root in
            let db = try MuxvoDatabase.open(at: root.appendingPathComponent("s.db"))
            let names = try db.pool.read { conn in
                try Set(String.fetchAll(
                    conn, sql: "SELECT name FROM sqlite_master WHERE type IN ('table','trigger','index')"
                ))
            }
            for expected in [
                "tasks", "task_events",
                "task_events_no_update", "task_events_no_delete",
                "idx_tasks_state", "idx_tasks_repo_active", "idx_task_events_task",
                "idx_tasks_idempotency_key", // v5_m4b_brain_idempotency 部分唯一索引
            ] {
                #expect(names.contains(expected), "缺 \(expected)")
            }
        }
    }
}

@Suite("append-only 触发器与 CHECK 约束（负向）")
struct SchemaConstraintTests {
    @Test("task_events UPDATE 被触发器 ABORT") // 验收 8-②
    func eventUpdateAborts() throws {
        try withTempRoot { root in
            let db = try MuxvoDatabase.open(at: root.appendingPathComponent("s.db"))
            let task = makeTaskRow()
            try db.pool.write { conn in
                try task.insert(conn)
                try makeEventRow(taskId: task.id).insert(conn)
            }
            do {
                try db.pool.write { conn in
                    try conn.execute(sql: "UPDATE task_events SET kind = 'task_queued'")
                }
                Issue.record("UPDATE 应当被触发器 ABORT")
            } catch let error as DatabaseError {
                #expect(error.message?.contains("append-only") == true)
            }
        }
    }

    @Test("task_events DELETE 被触发器 ABORT") // 验收 8-②
    func eventDeleteAborts() throws {
        try withTempRoot { root in
            let db = try MuxvoDatabase.open(at: root.appendingPathComponent("s.db"))
            let task = makeTaskRow()
            try db.pool.write { conn in
                try task.insert(conn)
                try makeEventRow(taskId: task.id).insert(conn)
            }
            do {
                try db.pool.write { conn in
                    try conn.execute(sql: "DELETE FROM task_events")
                }
                Issue.record("DELETE 应当被触发器 ABORT")
            } catch let error as DatabaseError {
                #expect(error.message?.contains("append-only") == true)
            }
        }
    }

    @Test("CHECK 负向：非法 state / 非法 actor / autonomy_level 越界均拒绝")
    func checkConstraintsReject() throws {
        try withTempRoot { root in
            let db = try MuxvoDatabase.open(at: root.appendingPathComponent("s.db"))
            let task = makeTaskRow()
            try db.pool.write { conn in try task.insert(conn) }

            var badState = makeTaskRow()
            badState.state = "limbo"
            #expect(throws: DatabaseError.self) {
                try db.pool.write { conn in try badState.insert(conn) }
            }
            var badAutonomy = makeTaskRow()
            badAutonomy.autonomyLevel = 4
            #expect(throws: DatabaseError.self) {
                try db.pool.write { conn in try badAutonomy.insert(conn) }
            }
            var badActor = makeEventRow(taskId: task.id)
            badActor.actor = "robot"
            #expect(throws: DatabaseError.self) {
                try db.pool.write { conn in try badActor.insert(conn) }
            }
            // 外键：挂到不存在的任务也拒绝（foreign_keys=ON 的实证）
            #expect(throws: DatabaseError.self) {
                try db.pool.write { conn in try makeEventRow(taskId: "no-such-task").insert(conn) }
            }
        }
    }
}

@Suite("WAL checkpoint 与生命周期接缝")
struct CheckpointSeamTests {
    @Test("checkpointTruncate 后 -wal 截断为 0 字节") // 验收 8-③
    func checkpointTruncatesWal() throws {
        try withTempRoot { root in
            let url = root.appendingPathComponent("s.db")
            let db = try MuxvoDatabase.open(at: url)
            try db.pool.write { conn in
                for _ in 0 ..< 50 { try makeTaskRow().insert(conn) }
            }
            let walPath = url.path + "-wal"
            let sizeBefore = try FileManager.default.attributesOfItem(atPath: walPath)[.size] as? Int
            #expect((sizeBefore ?? 0) > 0, "前置：WAL 应有内容")

            try db.checkpointTruncate()
            let sizeAfter = try FileManager.default.attributesOfItem(atPath: walPath)[.size] as? Int
            #expect(sizeAfter == 0)
        }
    }

    @Test("checkpoint ShutdownStep：holder 未装入 no-op 不抛；装入后触发截断") // 验收 8-③ 接缝
    func checkpointShutdownStepViaHolder() throws {
        try withTempRoot { root in
            let holder = DatabaseHolder()
            let step = MuxvoDatabase.checkpointShutdownStep(holder)
            try step.body() // 未安装：no-op

            let url = root.appendingPathComponent("s.db")
            let db = try MuxvoDatabase.open(at: url)
            try db.pool.write { conn in
                for _ in 0 ..< 50 { try makeTaskRow().insert(conn) }
            }
            holder.install(db)
            try step.body()
            let size = try FileManager.default
                .attributesOfItem(atPath: url.path + "-wal")[.size] as? Int
            #expect(size == 0)
        }
    }

    @Test("quick_check 接 StartupIntegrityCheck：好库通过；DB 缺失视为通过") // 验收 8-④
    func quickCheckIntegrity() throws {
        try withTempRoot { root in
            let check = MuxvoDatabase.quickCheckIntegrityCheck()
            // 经 lifecycle bootstrap 拿真实 DataDirectory（state/ 目录已建，session.db 尚无）
            let dataDirectory = try DataDirectory.bootstrap(at: root)
            try check.body(dataDirectory) // DB 缺失：通过（首崩可能尚未建库）

            _ = try MuxvoDatabase.open(at: dataDirectory.sessionDatabaseURL)
            try check.body(dataDirectory) // 好库：通过
        }
    }

    @Test("七步序集成：shutdown 跑 checkpoint step，崩溃重启跑 quick_check 记 ok") // 验收 8-接线
    func lifecycleEndToEnd() throws {
        try withTempRoot { root in
            let holder = DatabaseHolder()
            let configuration = LifecycleConfiguration(
                dataDirectoryRoot: root,
                integrityChecks: [MuxvoDatabase.quickCheckIntegrityCheck()],
                shutdownSteps: [MuxvoDatabase.checkpointShutdownStep(holder)]
            )
            // 第一轮：建库写数据 → 干净退出（checkpoint 截断 -wal）
            let first = try AppLifecycle.start(configuration: configuration)
            let dbURL = first.dataDirectory.sessionDatabaseURL
            let db = try MuxvoDatabase.open(at: dbURL)
            holder.install(db)
            try db.pool.write { conn in
                for _ in 0 ..< 20 { try makeTaskRow().insert(conn) }
            }
            try first.shutdown()
            let walSize = try FileManager.default
                .attributesOfItem(atPath: dbURL.path + "-wal")[.size] as? Int
            #expect(walSize == 0)

            // 第二轮：模拟崩溃（删 flag）→ 重启走 crash path，quick_check 记 ok
            try FileManager.default.removeItem(at: first.dataDirectory.gracefulExitFlagURL)
            let second = try AppLifecycle.start(configuration: configuration)
            defer { second._abandonForTesting() }
            #expect(second.verdict == .crashRecovery)
            let crashLog = try String(
                contentsOf: second.dataDirectory.lastCrashLogURL, encoding: .utf8)
            #expect(crashLog.contains("\"sqlite-quick-check\":\"ok\""))
        }
    }
}
