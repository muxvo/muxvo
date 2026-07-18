// 防双开锁：flock(LOCK_EX|LOCK_NB)。进程被 SIGKILL 时由内核自动释放，无 stale lock 问题。
// 同进程两个 fd 对同一文件 flock 也互斥 → 双开拒绝可在进程内单测。
import Darwin
import Foundation
import os

public enum InstanceLockError: Error, Equatable {
    case alreadyLocked(otherPID: Int32?)
    case openFailed(path: String, code: Int32)
    case lockFailed(path: String, code: Int32)
}

public final class InstanceLock: Sendable {
    private let descriptor: OSAllocatedUnfairLock<Int32?> // nil = 已释放

    private init(descriptor fd: Int32) {
        self.descriptor = OSAllocatedUnfairLock(initialState: fd)
    }

    public static func acquire(at url: URL) throws -> InstanceLock {
        let path = url.path
        // O_CLOEXEC：flock fd 严禁被 fork+exec 的子进程（M3 起有 PTY 子进程）继承——
        // 继承会让子进程替测试/app 持锁，制造 alreadyRunning 假阳性（2026-07-02 批1 实测抓获）。
        let fd = open(path, O_CREAT | O_RDWR | O_CLOEXEC, 0o644)
        guard fd >= 0 else {
            throw InstanceLockError.openFailed(path: path, code: errno)
        }
        while flock(fd, LOCK_EX | LOCK_NB) == -1 {
            if errno == EINTR { continue }
            let code = errno
            close(fd)
            if code == EWOULDBLOCK {
                // 锁文件内容 = 持有者 pid（尽力解析，仅用于诊断文案）
                let otherPID = (try? String(contentsOf: url, encoding: .utf8))
                    .flatMap { Int32($0.trimmingCharacters(in: .whitespacesAndNewlines)) }
                throw InstanceLockError.alreadyLocked(otherPID: otherPID)
            }
            throw InstanceLockError.lockFailed(path: path, code: code)
        }
        // 锁已到手才写 pid（覆盖旧值；写失败不影响锁语义，忽略错误）
        ftruncate(fd, 0)
        let pid = "\(getpid())\n"
        _ = pid.withCString { Darwin.write(fd, $0, strlen($0)) }
        return InstanceLock(descriptor: fd)
    }

    /// 幂等释放（close fd 即放锁）。
    public func release() {
        descriptor.withLock { fd in
            if let open = fd {
                close(open)
                fd = nil
            }
        }
    }

    deinit {
        // 防泄漏兜底；语义性释放一律走显式 release()（生命周期由 LifecycleSession 持有保证）
        release()
    }
}
