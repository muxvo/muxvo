// ShutdownCoordinating 的真实现（替换 M1 任务 1 的 Noop 占位）。
// 同步 shutdown 跑在 GCD 后台队列（F_FULLFSYNC 8-20ms，不阻塞主线程/cooperative pool），
// 完成后调 completion 放行 NSApp.reply(toApplicationShouldTerminate:)。
import Foundation
import MuxvoKit
import os

public final class LifecycleShutdownCoordinator: ShutdownCoordinating {
    private let session: LifecycleSession
    private let begun = OSAllocatedUnfairLock(initialState: false)
    private let queue = DispatchQueue(label: "com.muxvo.shutdown", qos: .userInitiated)

    public init(session: LifecycleSession) {
        self.session = session
    }

    public func beginShutdown(reason: ShutdownReason, completion: @escaping @Sendable () -> Void) {
        // 重入闸：AppKit 侧可能的重复 terminate 是环境噪声，容忍（log + 忽略）；
        // 包内的二次 session.shutdown() 才是编程错误（precondition 炸）。两者刻意分离。
        let first = begun.withLock { begun -> Bool in
            if begun { return false }
            begun = true
            return true
        }
        guard first else {
            NSLog("[muxvo] beginShutdown 重入，忽略 reason=\(reason)")
            return
        }
        let session = session
        queue.async {
            do {
                try session.shutdown()
                NSLog("[muxvo] graceful shutdown 完成 reason=\(reason)")
            } catch {
                // 抛错也放行退出：标志未写，下次启动走崩溃恢复路径（蓝本语义）
                NSLog("[muxvo] shutdown step 失败（仍放行退出，下次启动走崩溃恢复）：\(error)")
            }
            completion()
        }
    }
}
