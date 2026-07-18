// GRDB 引导（spec task-state-machine.md §5 的 SQLite 配置）：
// journal_mode=WAL（DatabasePool 自动）、synchronous=NORMAL、foreign_keys=ON、busy_timeout=5000。
// 生命周期接缝：checkpoint ShutdownStep（经 DatabaseHolder——shutdownSteps 在 start() 时注册，
// DB 在 start() 之后才打开）+ quick_check StartupIntegrityCheck（自带只读连接，跑在 DB 打开前）。
import Foundation
import GRDB
import MuxvoStorage
import os

public enum MuxvoDatabaseError: Error, Equatable {
    case quickCheckFailed(results: [String])
}

public final class MuxvoDatabase: Sendable {
    public let pool: DatabasePool

    private init(pool: DatabasePool) {
        self.pool = pool
    }

    /// 打开（或创建）session 数据库并跑迁移（migrator 幂等：已应用的迁移不重放）。
    public static func open(at url: URL) throws -> MuxvoDatabase {
        var config = Configuration()
        config.busyMode = .timeout(5.0) // busy_timeout=5000ms
        config.foreignKeysEnabled = true // GRDB 默认即 true，显式置位以示 spec 约束
        config.prepareDatabase { db in
            // WAL 下 NORMAL：commit 不强制 fsync（checkpoint 时才刷），单写者场景的标准档位
            try db.execute(sql: "PRAGMA synchronous=NORMAL")
            // prepareDatabase 跑在 GRDB setupBusyMode 之后：统一覆盖 pool reader
            // 的内部默认 10s（Configuration.readonlyBusyMode 是 internal，改不到）
            try db.execute(sql: "PRAGMA busy_timeout=5000")
        }
        let pool = try DatabasePool(path: url.path, configuration: config)
        try Migrations.migrator().migrate(pool)
        return MuxvoDatabase(pool: pool)
    }

    /// WAL checkpoint（TRUNCATE）：把 WAL 内容并入主库并截断 -wal 文件。
    public func checkpointTruncate() throws {
        try pool.writeWithoutTransaction { db in
            _ = try db.checkpoint(.truncate)
        }
    }

    /// 测试断言用：已应用的迁移标识集合（grdb_migrations 记账表）。
    public func appliedMigrationIdentifiers() throws -> Set<String> {
        try pool.read { db in
            try Migrations.migrator().appliedIdentifiers(db)
        }
    }

    // MARK: - 生命周期接缝

    /// 干净退出第一步：WAL checkpoint。holder 尚未装入 DB（启动失败路径）则 no-op。
    public static func checkpointShutdownStep(_ holder: DatabaseHolder) -> ShutdownStep {
        ShutdownStep("wal-checkpoint") {
            guard let database = holder.database else { return }
            try database.checkpointTruncate()
        }
    }

    /// 崩溃恢复路径的完整性检查：独立只读连接跑 PRAGMA quick_check。
    /// DB 文件不存在 = 通过（首崩可能尚未建库）；结果非 ["ok"] 即 throw（由 lifecycle 记入 last-crash.json）。
    public static func quickCheckIntegrityCheck() -> StartupIntegrityCheck {
        StartupIntegrityCheck("sqlite-quick-check") { dataDirectory in
            let url = dataDirectory.sessionDatabaseURL
            guard FileManager.default.fileExists(atPath: url.path) else { return }
            var config = Configuration()
            config.readonly = true
            config.busyMode = .timeout(5.0)
            let queue = try DatabaseQueue(path: url.path, configuration: config)
            let results = try queue.read { db in
                try String.fetchAll(db, sql: "PRAGMA quick_check")
            }
            guard results == ["ok"] else {
                throw MuxvoDatabaseError.quickCheckFailed(results: results)
            }
        }
    }
}

/// shutdownSteps 注册（start 时）与 DB 打开（start 后）之间的时序桥：
/// step 执行时从这里取当前 DB 引用，未安装则 no-op（与「启动失败仍走单退出路径」一致）。
public final class DatabaseHolder: Sendable {
    private let state = OSAllocatedUnfairLock<MuxvoDatabase?>(initialState: nil)

    public init() {}

    public func install(_ database: MuxvoDatabase) {
        state.withLock { $0 = database }
    }

    public var database: MuxvoDatabase? {
        state.withLock { $0 }
    }
}
