// migration v5_m4b_brain_idempotency 的 schema 契约测试（command-console.md §3 / control-plane-mcp.md §3.4）。
// tasks 加列 idempotency_key（nullable TEXT）+ 部分唯一索引 WHERE NOT NULL：非终态同键去重的 DB 最后防线；
// NULL 键（人/面板录入 + 终态释放）不占索引、可多行。工艺仿同目录 MigrationV3Tests。
import Foundation
import GRDB
import MuxvoTestSupport
import Testing

@testable import MuxvoDatabase

@Suite("migration v5：tasks.idempotency_key 列 + 部分唯一索引")
struct MigrationV5SchemaTests {
    @Test("idempotency_key 列存在、nullable、可写读")
    func idempotencyKeyColumn() throws {
        try withTempRoot { root in
            let db = try MuxvoDatabase.open(at: root.appendingPathComponent("s.db"))
            let hasColumn = try db.pool.read { conn in
                try Row.fetchAll(conn, sql: "PRAGMA table_info(tasks)")
                    .contains { $0["name"] == "idempotency_key" }
            }
            #expect(hasColumn, "tasks 表须有 idempotency_key 列（migration v5）")
            // nullable：不带 idempotency_key 的 insert 照常成功（既有写路径零改动）。
            try db.pool.write { conn in
                try conn.execute(sql: """
                INSERT INTO tasks (id, title, state, created_at, updated_at)
                VALUES ('t1', 'x', 'created', 1, 1)
                """)
            }
        }
    }

    @Test("部分唯一索引：非 NULL 同键第二插冲突；NULL 键多行放行")
    func partialUniqueIndex() throws {
        try withTempRoot { root in
            let db = try MuxvoDatabase.open(at: root.appendingPathComponent("s.db"))
            // 两行 NULL 键 → 允许（部分索引 WHERE NOT NULL 不覆盖 NULL）。
            try db.pool.write { conn in
                try conn.execute(sql: """
                INSERT INTO tasks (id, title, state, created_at, updated_at) VALUES ('n1','x','completed',1,1);
                INSERT INTO tasks (id, title, state, created_at, updated_at) VALUES ('n2','x','completed',1,1);
                """)
            }
            // 一行非 NULL 键 → 成功。
            try db.pool.write { conn in
                try conn.execute(sql: """
                INSERT INTO tasks (id, title, state, created_at, updated_at, idempotency_key)
                VALUES ('k1','x','created',1,1,'KEY-A')
                """)
            }
            // 同键第二行 → 唯一冲突抛。
            var threw = false
            do {
                try db.pool.write { conn in
                    try conn.execute(sql: """
                    INSERT INTO tasks (id, title, state, created_at, updated_at, idempotency_key)
                    VALUES ('k2','x','created',1,1,'KEY-A')
                    """)
                }
            } catch { threw = true }
            #expect(threw, "非 NULL 同键第二插须唯一冲突")
        }
    }
}
