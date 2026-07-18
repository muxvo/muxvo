import Darwin
import Foundation
import MuxvoTestSupport
import Testing

@testable import MuxvoStorage

@Suite("InstanceLock 互斥")
struct InstanceLockTests {
    @Test("同进程双开被拒（带对方 pid），释放后可重获") // 验收 3-⑤
    func secondOpenRejectedSameProcess() throws {
        try withTempRoot { root in
            let url = root.appendingPathComponent("instance.lock")
            let first = try InstanceLock.acquire(at: url)
            #expect(throws: InstanceLockError.alreadyLocked(otherPID: getpid())) {
                _ = try InstanceLock.acquire(at: url)
            }
            first.release()
            let second = try InstanceLock.acquire(at: url)
            second.release()
        }
    }

    @Test("release 幂等：重复调用不出错")
    func releaseIsIdempotent() throws {
        try withTempRoot { root in
            let lock = try InstanceLock.acquire(at: root.appendingPathComponent("instance.lock"))
            lock.release()
            lock.release()
        }
    }

    @Test("锁文件内容为持有进程 pid")
    func lockFileContainsPID() throws {
        try withTempRoot { root in
            let url = root.appendingPathComponent("instance.lock")
            let lock = try InstanceLock.acquire(at: url)
            defer { lock.release() }
            let content = try String(contentsOf: url, encoding: .utf8)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            #expect(Int32(content) == getpid())
        }
    }
}
