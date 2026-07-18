// 生命周期接缝类型：struct 包 @Sendable 闭包（不用协议——Sendable 不证自明，
// 任务 8 接 GRDB 时 ShutdownStep("wal-checkpoint"){ try db.checkpoint() } 零摩擦）。
import Foundation

/// 干净退出的有序步骤。任一 step 抛错 → graceful-exit 标志不写、错误上抛。
public struct ShutdownStep: Sendable {
    public let name: String
    let body: @Sendable () throws -> Void

    public init(_ name: String, _ body: @escaping @Sendable () throws -> Void) {
        self.name = name
        self.body = body
    }
}

/// 崩溃恢复路径上的完整性检查（任务 8 注入 SQLite PRAGMA quick_check）。
/// 检查失败不中断启动（蓝本：crash path 无条件恢复），结果记入 last-crash.json。
public struct StartupIntegrityCheck: Sendable {
    public let name: String
    let body: @Sendable (DataDirectory) throws -> Void

    public init(_ name: String, _ body: @escaping @Sendable (DataDirectory) throws -> Void) {
        self.name = name
        self.body = body
    }
}
