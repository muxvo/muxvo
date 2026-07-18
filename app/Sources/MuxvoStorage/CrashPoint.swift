// SIGKILL 自杀注入机关（M1 任务 11 的 SIGKILL 集成测试用，本文件只装机关）。
// 双闸：#if DEBUG（release 编译为空）+ MUXVO_TEST_CRASH_POINT 环境变量点名。
// 命中 = kill(getpid(), SIGKILL)：真崩溃，不走 atexit/teardown，flock 由内核回收。
import Darwin
import Foundation

public enum CrashPoint: String, Sendable, CaseIterable {
    case startupAfterFlagDelete = "startup-after-flag-delete"
    case atomicWriteBeforeRename = "atomic-write-before-rename"
    case shutdownBeforeFlagWrite = "shutdown-before-flag-write"
    case shutdownAfterFlagWrite = "shutdown-after-flag-write"
}

enum CrashInjector {
    /// 环境变量名唯一居所。
    static let environmentKey = "MUXVO_TEST_CRASH_POINT"

    /// 纯判定（单测覆盖闸门逻辑用）：env 字典点名了哪个 crash point。
    static func armedPoint(in environment: [String: String]) -> CrashPoint? {
        environment[environmentKey].flatMap(CrashPoint.init(rawValue:))
    }

    #if DEBUG
        // 进程内 env 不变，只读一次；DEBUG 下每次 hit 只是一次 enum 比较，热路径零额外开销
        private static let armed: CrashPoint? =
            armedPoint(in: ProcessInfo.processInfo.environment)
    #endif

    @inline(__always)
    static func hit(_ point: CrashPoint) {
        #if DEBUG
            if armed == point { kill(getpid(), SIGKILL) }
        #endif
    }
}
