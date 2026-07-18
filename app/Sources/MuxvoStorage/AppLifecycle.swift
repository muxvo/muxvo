// 启动七步固定序 + 干净退出（蓝本 architecture.md §7 的 Swift 等价物）。
// LifecycleSession = 蓝本 ShutdownGuard 的等价：fileprivate init（只有 AppLifecycle 能造）、
// shutdown 一次性消费、graceful-exit 标志最后写且全 app 唯一写入点在 shutdown 内部。
import Foundation
import os

public enum LaunchVerdict: Sendable, Equatable {
    case freshInstall // 本次 bootstrap 新建的数据目录
    case cleanExit // 标志存在 = 上次正常退出
    case crashRecovery // 非 fresh 且标志缺失 = 上次崩溃
}

public struct LifecycleConfiguration: Sendable {
    public var dataDirectoryRoot: URL
    public var channel: ReleaseChannel
    public var integrityChecks: [StartupIntegrityCheck] // M1 默认空；任务 8 注入 quick_check
    public var shutdownSteps: [ShutdownStep] // M1 默认空；任务 8 注入 WAL checkpoint

    public init(
        dataDirectoryRoot: URL,
        channel: ReleaseChannel = .dev,
        integrityChecks: [StartupIntegrityCheck] = [],
        shutdownSteps: [ShutdownStep] = []
    ) {
        self.dataDirectoryRoot = dataDirectoryRoot
        self.channel = channel
        self.integrityChecks = integrityChecks
        self.shutdownSteps = shutdownSteps
    }
}

public enum LifecycleError: Error {
    case alreadyRunning(otherPID: Int32?)
    case shutdownStepFailed(step: String, underlying: any Error)
}

public enum AppLifecycle {
    public static func start(configuration: LifecycleConfiguration) throws -> LifecycleSession {
        try start(
            configuration: configuration,
            onDoubleShutdown: {
                preconditionFailure("LifecycleSession.shutdown() 二次调用（一次性消费纪律）")
            }
        )
    }

    /// internal 重载：单测经 @testable 注入 onDoubleShutdown recorder；生产默认 = preconditionFailure。
    static func start(
        configuration: LifecycleConfiguration,
        onDoubleShutdown: @escaping @Sendable () -> Void
    ) throws -> LifecycleSession {
        let root = configuration.dataDirectoryRoot
        let fm = FileManager.default

        // 步 0（工程前置）：禁名守卫 + 幂等建 root——instance.lock 在数据目录内，fresh 时目录还不存在
        DataDirectory.enforceLegacyRootGuard(root)
        try fm.createDirectory(at: root, withIntermediateDirectories: true)

        // ① 防双开（失败 = 另一实例在跑）
        let lock: InstanceLock
        do {
            lock = try InstanceLock.acquire(at: DataDirectory.instanceLockURL(under: root))
        } catch let error as InstanceLockError {
            if case let .alreadyLocked(otherPID) = error {
                throw LifecycleError.alreadyRunning(otherPID: otherPID)
            }
            throw error
        }
        var lockHandedOff = false
        defer { if !lockHandedOff { lock.release() } } // 后续任一步 throw，锁随错误传播释放

        // ② bootstrap（版本过新/损坏/channel 不符在此 throw）
        let dataDirectory = try DataDirectory.bootstrap(at: root, channel: configuration.channel)

        // ③ verdict
        let flagExists = fm.fileExists(atPath: dataDirectory.gracefulExitFlagURL.path)
        let verdict: LaunchVerdict =
            dataDirectory.wasCreatedFresh ? .freshInstall : (flagExists ? .cleanExit : .crashRecovery)

        // ④ 消费标志：本次运行若崩溃，下次启动判 crashRecovery
        try AtomicFile.remove(at: dataDirectory.gracefulExitFlagURL, durability: .full)
        CrashInjector.hit(.startupAfterFlagDelete)

        // ⑤ 清扫上次崩溃留下的原子写孤儿
        try AtomicFile.sweepTemporaryFiles(under: root)

        // ⑥ 崩溃路径：完整性检查（失败不中断启动，记结果）+ append 一行 last-crash.json
        if verdict == .crashRecovery {
            var integrity: [String: String] = [:]
            for check in configuration.integrityChecks {
                do {
                    try check.body(dataDirectory)
                    integrity[check.name] = "ok"
                } catch {
                    integrity[check.name] = "failed: \(error)"
                }
            }
            try appendCrashRecord(to: dataDirectory, integrity: integrity)
        }

        // ⑦
        lockHandedOff = true
        return LifecycleSession(
            dataDirectory: dataDirectory, verdict: verdict, lock: lock,
            steps: configuration.shutdownSteps, onDoubleShutdown: onDoubleShutdown
        )
    }

    /// last-crash.json = JSON Lines（每次崩溃恢复 append 一行），保留最近 32 条。
    private static func appendCrashRecord(
        to dataDirectory: DataDirectory, integrity: [String: String]
    ) throws {
        struct CrashRecord: Codable {
            let ts: String
            let schemaVersion: Int
            let integrity: [String: String]
        }
        let record = CrashRecord(
            ts: ISO8601DateFormatter().string(from: Date()),
            schemaVersion: dataDirectory.schemaVersion.version,
            integrity: integrity
        )
        let line = try JSONEncoder().encode(record)
        var existing = (try? String(contentsOf: dataDirectory.lastCrashLogURL, encoding: .utf8))
            .map { $0.split(separator: "\n", omittingEmptySubsequences: true).map(String.init) }
            ?? []
        existing.append(String(decoding: line, as: UTF8.self))
        let kept = existing.suffix(32).joined(separator: "\n") + "\n"
        try AtomicFile.write(Data(kept.utf8), to: dataDirectory.lastCrashLogURL, durability: .full)
    }
}

public final class LifecycleSession: Sendable {
    public let verdict: LaunchVerdict
    public let dataDirectory: DataDirectory
    private let instanceLock: InstanceLock // 强持有：锁的存活期 = session 存活期
    private let steps: [ShutdownStep]
    private let consumed = OSAllocatedUnfairLock(initialState: false)
    private let onDoubleShutdown: @Sendable () -> Void

    fileprivate init(
        dataDirectory: DataDirectory, verdict: LaunchVerdict, lock: InstanceLock,
        steps: [ShutdownStep], onDoubleShutdown: @escaping @Sendable () -> Void
    ) {
        self.dataDirectory = dataDirectory
        self.verdict = verdict
        instanceLock = lock
        self.steps = steps
        self.onDoubleShutdown = onDoubleShutdown
    }

    /// 一次性消费（成败均算消费）。按注册序跑 steps，任一抛错 → 标志不写、错误上抛
    /// （下次启动走 crash path）；全部成功 → 最后写 graceful-exit 标志 → 释放锁。
    public func shutdown() throws {
        let first = consumed.withLock { consumed -> Bool in
            if consumed { return false }
            consumed = true
            return true
        }
        guard first else {
            onDoubleShutdown() // 生产默认 preconditionFailure（不返回）；测试注入 recorder 时安全 no-op
            return
        }
        for step in steps {
            do {
                try step.body()
            } catch {
                throw LifecycleError.shutdownStepFailed(step: step.name, underlying: error)
            }
        }
        CrashInjector.hit(.shutdownBeforeFlagWrite)
        // 全 app 唯一的 graceful-exit 标志写入点。内容仅为人查档，语义只看存在性。
        let stamp = ISO8601DateFormatter().string(from: Date()) + "\n"
        try AtomicFile.write(
            Data(stamp.utf8), to: dataDirectory.gracefulExitFlagURL, durability: .full
        )
        CrashInjector.hit(.shutdownAfterFlagWrite)
        instanceLock.release()
    }

    /// 测试专用：模拟崩溃——释放锁但不写标志（进程真死时 flock 由内核回收，
    /// 这里只为同进程内的测试编排；生产代码不得调用）。
    func _abandonForTesting() {
        instanceLock.release()
    }
}
