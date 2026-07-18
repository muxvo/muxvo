// chat.db 独立派生缓存（specs/behavior/chat-data.md §0 数据面 ≠ 存储选型）——**不进 session.db**，
// 可删重建。复用 MuxvoDatabase 的连接引导工艺（WAL / synchronous=NORMAL / foreign_keys=ON /
// busy_timeout=5000），但**独立 migrator**：schema 版本号写 `PRAGMA user_version`，打开时若不认识
// （版本不等）→ 删表重建（派生缓存特权，chat.db 内容全是 reader 输出的可再生缓存，丢了重扫即可）。
//
// DB 路径由调用方注入（`open(at:)`）——数据根接线归 A2-2/批3，本层不碰 DataDirectory。
//
// 表（chat-data 批0 设计）：
//  · chat_sessions   —— 每会话一行（source cc/codex/mirror），缓存 title/started_at/cwd/fileSize/mtime +
//                       indexer 断点 indexed_bytes；id 是整型 PK（session_pk），供 chat_search_lines 外键。
//  · chat_search_lines —— 按**原始行**建的搜索面（§4 搜索面 ⊋ 详情投影面），ON DELETE CASCADE 随会话删。
//  · chat_projects   —— 目录级事实缓存（dir mtime / displayPath），批2 predominantly 直扫，留缓存位。
import Foundation
import GRDB

public final class ChatDatabase: Sendable {
    public let pool: DatabasePool

    /// 当前 schema 版本（写入 `PRAGMA user_version`）。DDL 变更即 +1 → 老库开时版本不等 → 删表重建。
    /// v2（dogfood-r4 问题5）：chat_sessions 增 `title_fallback` 列——老 v1 库开时版本不等 → 删表重建（派生
    /// 缓存特权，丢了后台 warmup 重扫即可；重建空窗由 web 端问题3a 空态骨架 + 完成回取兜，见 chat-history §7.5）。
    static let schemaVersion = 2

    private init(pool: DatabasePool) {
        self.pool = pool
    }

    /// 打开（或创建）chat.db。若 `user_version` 与当前不等（新库=0 / 老版本）→ 删表重建 + 盖版本号。
    public static func open(at url: URL) throws -> ChatDatabase {
        var config = Configuration()
        config.busyMode = .timeout(5.0)     // busy_timeout=5000ms（同 MuxvoDatabase 工艺）
        config.foreignKeysEnabled = true    // chat_search_lines ON DELETE CASCADE 依赖外键强制
        config.prepareDatabase { db in
            try db.execute(sql: "PRAGMA synchronous=NORMAL")  // WAL 下 commit 不强制 fsync
            try db.execute(sql: "PRAGMA busy_timeout=5000")   // 统一覆盖 pool reader 内部默认
        }
        let pool = try DatabasePool(path: url.path, configuration: config)
        try pool.write { db in
            let version = try Int.fetchOne(db, sql: "PRAGMA user_version") ?? 0
            if version != schemaVersion {
                try dropAllTables(db)       // 派生缓存特权：不认识就删重建（新库无表，IF EXISTS 天然 no-op）
                try createSchema(db)
                try db.execute(sql: "PRAGMA user_version = \(schemaVersion)")
            }
            try ensureIndexes(db)           // fresh/重建/既有 v2 三路统一幂等补建，不参与版本判定
        }
        return ChatDatabase(pool: pool)
    }

    // MARK: - schema

    private static func dropAllTables(_ db: Database) throws {
        // 先删有外键的从表（虽 IF EXISTS + CASCADE，仍按依赖序删以防未来加约束）。
        try db.execute(sql: "DROP TABLE IF EXISTS chat_search_lines")
        try db.execute(sql: "DROP TABLE IF EXISTS chat_sessions")
        try db.execute(sql: "DROP TABLE IF EXISTS chat_projects")
    }

    private static func createSchema(_ db: Database) throws {
        try db.execute(sql: """
            CREATE TABLE chat_sessions (
              id            INTEGER PRIMARY KEY,                 -- session_pk（rowid），chat_search_lines 外键指向
              source        TEXT NOT NULL CHECK (source IN ('cc','codex','mirror')),
              dir_name      TEXT NOT NULL,                       -- CC/镜像=项目目录名（可为 worktree 目录）；codex=cwd 编码
              session_id    TEXT NOT NULL,                       -- <sessionId>（不含 .jsonl）
              file_size     INTEGER NOT NULL,                    -- stat.size（字节，§2.3）
              file_mtime_ms INTEGER NOT NULL,                    -- mtime 毫秒 floor（§8.2 规则2）
              indexed_bytes INTEGER NOT NULL DEFAULT 0,          -- indexer 断点：已解析到的字节偏移（行边界）
              title         TEXT NOT NULL DEFAULT '',            -- §2.2 缓存（仅原值空时重取，§7 indexer）
              title_fallback TEXT NOT NULL DEFAULT '',           -- v2/问题5：空 title 会话显示兜底（summary/assistant 链）
              started_at    TEXT NOT NULL DEFAULT '',            -- §2.3 缓存
              cwd           TEXT,                                -- §2.3 缓存（nil 省略）
              UNIQUE (source, dir_name, session_id)
            );
            """)
        try db.execute(sql: """
            CREATE TABLE chat_search_lines (
              session_pk INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
              line_no    INTEGER NOT NULL,                       -- 搜索行序号（文件序单调，非物理行号；断点续增）
              ts         TEXT NOT NULL DEFAULT '',               -- 该行 timestamp（§4.2 命中行 ts）
              text       TEXT NOT NULL,                          -- extractSearchableText 输出（§4，text 块 join）
              PRIMARY KEY (session_pk, line_no)
            ) WITHOUT ROWID;
            """)
        try db.execute(sql: """
            CREATE TABLE chat_projects (
              source       TEXT NOT NULL,
              dir_name     TEXT NOT NULL,
              dir_mtime_ms INTEGER NOT NULL,
              display_path TEXT NOT NULL DEFAULT '',
              PRIMARY KEY (source, dir_name)
            );
            """)
    }

    /// 查询面支撑索引（chat-data.md 登记⑪ liveSessionsPage）：`CREATE INDEX IF NOT EXISTS` 幂等补建，
    /// **刻意不 bump user_version**——索引是纯派生结构，老 v2 库开时原地补建（12.7 万行约 0.3~1s 一次性），
    /// 免删表重建（丢缓存 + 后台全量重扫代价更大）。老查询路径不受影响：`WHERE source IN` 的可用索引
    /// 恒为 UNIQUE 自动索引（source 是其首列，老实际遍历序 = (source, dir_name, session_id) 序，
    /// **非 rowid 序**——对抗验收 MAJOR-1 定谳）；下方三索引对该查询无可用约束列（session_id/
    /// file_mtime_ms/dir_name 均无谓词），planner 计划不变（双跑 oracle 面遍历序不变）。
    private static func ensureIndexes(_ db: Database) throws {
        // isAll keyset 窗口倒扫（ORDER BY file_mtime_ms DESC, session_id DESC 走此索引反向扫描）
        try db.execute(sql: """
            CREATE INDEX IF NOT EXISTS idx_chat_sessions_mtime_sid
              ON chat_sessions (file_mtime_ms, session_id)
            """)
        // sid 组点查（去重裁决）+ codex 压制 EXISTS
        try db.execute(sql: """
            CREATE INDEX IF NOT EXISTS idx_chat_sessions_sid
              ON chat_sessions (session_id)
            """)
        // per-project per-dir keyset 窗口（dir_name 等值 + 余列序扫）
        try db.execute(sql: """
            CREATE INDEX IF NOT EXISTS idx_chat_sessions_dir_mtime_sid
              ON chat_sessions (dir_name, file_mtime_ms, session_id)
            """)
    }

    /// 测试断言用：当前库的 `user_version`。
    public func userVersion() throws -> Int {
        try pool.read { try Int.fetchOne($0, sql: "PRAGMA user_version") ?? 0 }
    }

    /// 硬删一个会话的缓存行（chat-data.md 冻结面修订登记②，用户拍板 2026-07-07）。
    /// `chat_search_lines` 靠 schema 的 `ON DELETE CASCADE`（+ `foreign_keys=ON`）随会话删，无需手动双删。
    /// session_id 是 UUID 全局唯一，删所有匹配行（同会话的 cc + mirror 缓存行一并清）。
    /// 返回是否真删了行（幂等：删不存在的 sid → false 的 no-op）。
    /// （文件系统双侧 removeItem 与响应装配归装配层；本层只交付 DB 原语。）
    @discardableResult
    public func deleteSession(sessionId: String) throws -> Bool {
        try pool.write { db in
            let before = try Int.fetchOne(
                db, sql: "SELECT COUNT(*) FROM chat_sessions WHERE session_id = ?",
                arguments: [sessionId]) ?? 0
            guard before > 0 else { return false }
            try db.execute(
                sql: "DELETE FROM chat_sessions WHERE session_id = ?", arguments: [sessionId])
            return true
        }
    }
}

// MARK: - 持久化形状（列类型贴 DB；领域语义在纯函数层）

/// chat_sessions 行（indexer 增删改 + 查询面读）。`id` 为 nil 时 insert 由 SQLite 分配 rowid。
struct ChatSessionRow: Codable, FetchableRecord, MutablePersistableRecord, Equatable {
    static let databaseTableName = "chat_sessions"

    var id: Int64?
    var source: String        // 'cc' | 'codex' | 'mirror'
    var dirName: String
    var sessionId: String
    var fileSize: Int64
    var fileMtimeMs: Int64
    var indexedBytes: Int64
    var title: String
    /// v2/问题5：空 title 会话的显示兜底（summary/assistant 链）；title 非空时不消费。默认 '' 兼容旧 insert 点。
    var titleFallback: String = ""
    var startedAt: String
    var cwd: String?

    enum CodingKeys: String, CodingKey {
        case id, source, title, cwd
        case dirName = "dir_name"
        case sessionId = "session_id"
        case fileSize = "file_size"
        case fileMtimeMs = "file_mtime_ms"
        case indexedBytes = "indexed_bytes"
        case titleFallback = "title_fallback"
        case startedAt = "started_at"
    }

    // insert 后回填自增 rowid。
    mutating func didInsert(_ inserted: InsertionSuccess) {
        id = inserted.rowID
    }
}

/// chat_search_lines 行（indexer 写 + search 读）。
struct ChatSearchLineRow: Codable, FetchableRecord, PersistableRecord, Equatable {
    static let databaseTableName = "chat_search_lines"

    var sessionPk: Int64
    var lineNo: Int64
    var ts: String
    var text: String

    enum CodingKeys: String, CodingKey {
        case ts, text
        case sessionPk = "session_pk"
        case lineNo = "line_no"
    }
}
