// migration v6_m4c_pipeline_templates 的 schema + 回填 + 合成契约测试（pipeline-supervisor.md §2 r3）。
// tasks 加 stage_role（nullable）+ 新 pipelines 表；存量 pipeline 按奇偶回填 stage_role 字节等价 +
// 每 distinct pipeline_id 合成 pipelines 行（snapshot=兼容模板 JSON、deadline/started=NULL）。
// 驱动 v5→v6 步进（先插存量数据于 v5 态、再迁 v6）验回填/合成；工艺仿同目录 MigrationV5Tests。
import Foundation
import GRDB
import MuxvoTestSupport
import Testing

@testable import MuxvoDatabase

@Suite("migration v6：pipelines 表 + tasks.stage_role + 存量回填/合成")
struct MigrationV6Tests {
    /// 建裸 pool（同 open 配置）并迁到 upTo（含）；返回 pool 供插数据/断言。
    private func poolMigrated(to root: URL, upTo: String?) throws -> DatabasePool {
        var config = Configuration()
        config.busyMode = .timeout(5.0)
        config.foreignKeysEnabled = true
        let pool = try DatabasePool(path: root.appendingPathComponent("v6.db").path, configuration: config)
        let migrator = Migrations.migrator()
        if let upTo {
            try migrator.migrate(pool, upTo: upTo)
        } else {
            try migrator.migrate(pool)
        }
        return pool
    }

    @Test("stage_role 列存在、nullable；pipelines 表存在且列齐")
    func schemaShape() throws {
        try withTempRoot { root in
            let db = try MuxvoDatabase.open(at: root.appendingPathComponent("s.db"))
            let taskCols = try db.pool.read { conn in
                try Row.fetchAll(conn, sql: "PRAGMA table_info(tasks)").map { $0["name"] as String }
            }
            #expect(taskCols.contains("stage_role"), "tasks 须有 stage_role 列")
            let pipeCols = try db.pool.read { conn in
                try Row.fetchAll(conn, sql: "PRAGMA table_info(pipelines)").map { $0["name"] as String }
            }
            #expect(Set(pipeCols) == ["pipeline_id", "template_id", "template_snapshot", "deadline_ms", "started_at", "created_at"])
            // nullable：不带 stage_role 的 insert 照常成功（既有写路径零改动）。
            try db.pool.write { conn in
                try conn.execute(sql: """
                INSERT INTO tasks (id, title, state, created_at, updated_at)
                VALUES ('t1','x','created',1,1)
                """)
            }
        }
    }

    @Test("PS_legacy_role_backfill_stable（迁移层）：奇 seq→execute、偶 seq→review 字节等价；无 pipeline 单任务 stage_role NULL")
    func backfillParityEquivalent() throws {
        try withTempRoot { root in
            let pool = try poolMigrated(to: root, upTo: "v5_m4b_brain_idempotency")
            // v5 态插存量：pipeline P 四段（seq1..4）+ 单任务 solo（无 pipeline）。
            try pool.write { db in
                for (seq, id) in [(1, "p1"), (2, "p2"), (3, "p3"), (4, "p4")] {
                    try db.execute(sql: """
                    INSERT INTO tasks (id, title, state, pipeline_id, pipeline_seq, created_at, updated_at)
                    VALUES (?, 'p', 'completed', 'PIPE-A', ?, 100, 100)
                    """, arguments: [id, seq])
                }
                try db.execute(sql: """
                INSERT INTO tasks (id, title, state, created_at, updated_at) VALUES ('solo','s','completed',5,5)
                """)
            }
            // 迁 v6：回填 + 合成。
            try Migrations.migrator().migrate(pool)
            let roles = try pool.read { db in
                try Row.fetchAll(db, sql: "SELECT id, stage_role FROM tasks WHERE pipeline_id = 'PIPE-A' ORDER BY pipeline_seq")
                    .map { ($0["id"] as String, $0["stage_role"] as String?) }
            }
            #expect(roles.map(\.1) == ["execute", "review", "execute", "review"])
            let soloRole = try pool.read { db in
                try String.fetchOne(db, sql: "SELECT stage_role FROM tasks WHERE id='solo'")
            }
            #expect(soloRole == nil, "无 pipeline 单任务 stage_role NULL")
        }
    }

    @Test("PS_legacy_pipeline_row_synthesized：每 distinct pipeline_id 合成一行、snapshot=兼容模板、deadline/started NULL、created_at=MIN")
    func synthesizePipelineRows() throws {
        try withTempRoot { root in
            let pool = try poolMigrated(to: root, upTo: "v5_m4b_brain_idempotency")
            try pool.write { db in
                // 两条存量 pipeline：A（created_at MIN=100，含 completed/failed 混合终态）+ B（MIN=300）。
                try db.execute(sql: "INSERT INTO tasks (id,title,state,pipeline_id,pipeline_seq,created_at,updated_at) VALUES ('a1','p','completed','PIPE-A',1,200,200)")
                try db.execute(sql: "INSERT INTO tasks (id,title,state,pipeline_id,pipeline_seq,created_at,updated_at) VALUES ('a2','p','failed','PIPE-A',2,100,100)")
                try db.execute(sql: "INSERT INTO tasks (id,title,state,pipeline_id,pipeline_seq,created_at,updated_at) VALUES ('b1','p','running','PIPE-B',1,300,300)")
            }
            try Migrations.migrator().migrate(pool)
            let rows = try pool.read { db in
                try Row.fetchAll(db, sql: "SELECT * FROM pipelines ORDER BY pipeline_id")
            }
            #expect(rows.count == 2, "两 distinct pipeline_id → 两合成行")
            let a = rows.first { $0["pipeline_id"] as String == "PIPE-A" }
            #expect(a?["template_id"] as String? == "cc-exec-codex-review")
            #expect(a?["template_snapshot"] as String? == PipelineSnapshotSeed.compatJSON)
            #expect(a?["deadline_ms"] as Int64? == nil)
            #expect(a?["started_at"] as Int64? == nil)
            #expect(a?["created_at"] as Int64? == 100, "created_at=该 pipeline 最早任务 created_at")
        }
    }

    @Test("幂等重跑：再迁不重复合成（pipeline_id PK + INSERT OR IGNORE）")
    func idempotentReRun() throws {
        try withTempRoot { root in
            let pool = try poolMigrated(to: root, upTo: "v5_m4b_brain_idempotency")
            try pool.write { db in
                try db.execute(sql: "INSERT INTO tasks (id,title,state,pipeline_id,pipeline_seq,created_at,updated_at) VALUES ('x1','p','completed','PIPE-X',1,10,10)")
            }
            try Migrations.migrator().migrate(pool)
            // 再迁（已应用不重放；即便手动重跑合成 SQL 也因 PK 幂等）——行数不变。
            try Migrations.migrator().migrate(pool)
            let count = try pool.read { db in
                try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM pipelines") ?? -1
            }
            #expect(count == 1)
        }
    }
}
