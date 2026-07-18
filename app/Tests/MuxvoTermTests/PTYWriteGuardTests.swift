// PTY 写路径守卫（M7 运行时欠账批①）：封「终端收尸后写已回收复用的 masterFD」μs 级 TOCTOU 残窗。
//
// μs 竞态无法确定性复现——本套件面向**守卫行为本身**：收尸→fd 关闭后，write 不再对该 fd 发起任何
// syscall（`writeSyscallCountForTest`），且即便 fd 号被复用到别处也不落字节（dup2 反腐蚀实证）。
// `fdClosedForTest` 是 fd 真关（cancel handler 异步跑完）的确定性等待锚，去掉真 μs 竞态的时序不确定。
//
// RED-GREEN：去掉 `PTYHost.write` 内 `guard let outcome else { break }`（fdGuard 拒写分支）即红——
// 收尸后 write 仍对已关/已复用 fd 发起 syscall（B 计数 +1、C tmp 被 "CORRUPT" 腐蚀）；守卫在位即绿。
// 纪律：只碰 $TMPDIR / 起 /bin/cat 保确定性；收尸走 terminate()（SIGKILL+同步 waitpid，无 grace 时序）。
import Darwin
import Dispatch
import Foundation
import Testing
@testable import MuxvoTerm

@Suite("PTYHost 写路径守卫（fd-recycle TOCTOU 全封）")
struct PTYWriteGuardTests {
    private func spawnCat(readQueue: DispatchQueue) throws -> PTYHost {
        let cfg = PTYSpawnConfig(
            executablePath: "/bin/cat", argv: ["cat"], environment: [:],
            cwd: nil, cols: 80, rows: 24)
        return try PTYHost(config: cfg, readQueue: readQueue, onData: { _ in }, onExit: { _, _ in })
    }

    /// 轮询等 fd 真关（cancel handler 在 readQueue 上异步跑）。
    private func waitFdClosed(_ host: PTYHost) -> Bool {
        let deadline = Date().addingTimeInterval(3 * muxvoCITimeoutScale())
        while Date() < deadline {
            if host.fdClosedForTest { return true }
            usleep(2_000)
        }
        return host.fdClosedForTest
    }

    @Test("A 活 fd：write 正常发起 syscall（守卫仅拒已关 fd，不误伤活写）")
    func liveWriteIssuesSyscall() throws {
        let q = DispatchQueue(label: "test.pty.read.A")
        let host = try spawnCat(readQueue: q)
        defer { host.terminate() }
        #expect(host.writeSyscallCountForTest == 0)
        host.write(Array("hello\n".utf8))
        #expect(host.writeSyscallCountForTest >= 1, "活 fd 上 write 应发起 ≥1 次 syscall")
        #expect(!host.fdClosedForTest)
    }

    @Test("B 收尸后：write 零 syscall（守卫拒写已关 fd）")
    func writeAfterReapIssuesNoSyscall() throws {
        let q = DispatchQueue(label: "test.pty.read.B")
        let host = try spawnCat(readQueue: q)
        host.terminate()
        #expect(waitFdClosed(host), "fd 未在窗内关闭")
        let before = host.writeSyscallCountForTest
        host.write(Array("late-after-close\n".utf8))
        #expect(host.writeSyscallCountForTest == before,
                "守卫失效：收尸后仍对已关（可能被复用）的 fd 发起 write syscall")
    }

    @Test("C 收尸后 fd 号被复用：迟到 write 不腐蚀复用者（dup2 反腐蚀实证）")
    func writeAfterReapDoesNotCorruptRecycledFd() throws {
        let q = DispatchQueue(label: "test.pty.read.C")
        let host = try spawnCat(readQueue: q)
        let oldFD = host.masterFD
        host.terminate()
        #expect(waitFdClosed(host), "fd 未在窗内关闭")
        // fd 已真关：把一个 tmp 文件 dup2 到 oldFD 号上（模拟内核把该号复用给邻会话/文件）。
        let tmp = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("pty-guard-\(UUID().uuidString).bin")
        FileManager.default.createFile(atPath: tmp.path, contents: nil)
        let sink = open(tmp.path, O_WRONLY | O_TRUNC)
        #expect(sink >= 0)
        defer { close(sink == oldFD ? sink : oldFD); try? FileManager.default.removeItem(at: tmp) }
        if sink != oldFD {
            #expect(dup2(sink, oldFD) == oldFD, "无法把 tmp 别名到 oldFD")
            close(sink)
        }
        // 此刻 oldFD 号指向 tmp 文件。旧 host 的迟到 write 若无守卫 → 字节落进 tmp（跨 fd 腐蚀）。
        host.write(Array("CORRUPT".utf8))
        let leaked = (try? Data(contentsOf: tmp)) ?? Data()
        #expect(leaked.isEmpty,
                "守卫失效：迟到 write 落到已回收 fd，tmp 被腐蚀=\(String(decoding: leaked, as: UTF8.self))")
    }
}
