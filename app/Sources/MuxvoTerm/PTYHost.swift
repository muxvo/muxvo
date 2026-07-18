// PTYHost：pty master fd 的宿主。封装 forkpty 起进程、非阻塞读回调、写退避、
// resize、优雅关闭协议（SIGHUP → grace → SIGKILL）与退出观察（DispatchSource
// 进程源 + waitpid 区分 exited/signaled）。
//
// 并发（设计附件 A §2.1）：
// - 读回调（onData）在传入的会话串行 queue 上触发，与 TerminalSession 的 feed
//   天然串行；write_pty 回写走同一 masterFD。
// - 生命周期（进程源/强杀升级定时器/收尸）在独立 lifecycleQueue 上，不与 feed 竞争。
// - reaped/forcedKill 用锁收敛：进程源与强杀升级定时器可能并发，收尸恰一次。
import CMuxvoPTY
import Darwin
import Dispatch
import Foundation
import os

/// 子进程退出结果（数据面；态机映射 EXIT_NORMAL/EXIT_ABNORMAL 属集成层，本批不做）。
public enum PTYExit: Sendable, Equatable {
    /// WIFEXITED：正常退出，带退出码。
    case exited(code: Int32)
    /// WIFSIGNALED：被信号终结，带信号号。
    case signaled(signal: Int32)
}

public enum PTYError: Error, CustomStringConvertible {
    case spawnFailed(errno: Int32, path: String)
    public var description: String {
        switch self {
        case .spawnFailed(let e, let p): return "muxvo_pty_spawn 失败 path=\(p) errno=\(e)"
        }
    }
}

/// PTY spawn 参数：argv/envp/cwd 全由上层（TerminalSession）组好。
public struct PTYSpawnConfig: Sendable {
    public var executablePath: String
    /// argv（含 login shell 的 argv[0] `-` 前缀约定）。
    public var argv: [String]
    /// 完整环境（"KEY=VALUE"），已按 env 合同增删。
    public var environment: [String: String]
    public var cwd: String?
    public var cols: UInt16
    public var rows: UInt16

    public init(
        executablePath: String,
        argv: [String],
        environment: [String: String],
        cwd: String?,
        cols: UInt16,
        rows: UInt16
    ) {
        self.executablePath = executablePath
        self.argv = argv
        self.environment = environment
        self.cwd = cwd
        self.cols = cols
        self.rows = rows
    }
}

public final class PTYHost: @unchecked Sendable {
    /// 关闭生命周期打点（DOGFOOD_M3_09）：SIGHUP 优雅关闭 / SIGKILL 强杀升级两处，同 lifecycle category。
    private static let lifecycleLog = Logger(subsystem: "com.muxvo", category: "lifecycle")

    public let pid: pid_t
    public let masterFD: Int32

    private let readSource: DispatchSourceRead
    private let processSource: DispatchSourceProcess
    private let lifecycleQueue: DispatchQueue

    private let lock = NSLock()
    private var reaped = false
    private var closing = false
    private var forcedKill = false
    private var escalation: DispatchWorkItem?

    /// fd 写守卫（M7：封「写已回收复用的 masterFD」μs 级 TOCTOU 残窗）。cancel handler 关 fd 时在同一
    /// 锁内置 `closed`；write 每次 syscall 前在同锁内查 `closed`——「查开态 + 单次 syscall」与「close fd + 置位」
    /// 互斥，故 write 永不落到已关（可能被内核复用给邻会话）的 fd。masterFD 非阻塞（O_NONBLOCK），单次
    /// write syscall μs 级返回，持锁不阻塞收尸。write_pty 回写、用户 write 走同一守卫。
    private final class FDGuard: @unchecked Sendable {
        private let lock = NSLock()
        private var closed = false
        private var writeSyscalls = 0
        /// fd 开着 → 计一次 syscall 并跑 body（其内 errno 就地读，锁内不释放）返回结果；已关 → nil（拒写）。
        func withOpenFd<R>(_ body: () -> R) -> R? {
            lock.lock(); defer { lock.unlock() }
            guard !closed else { return nil }
            writeSyscalls += 1
            return body()
        }
        /// 关 fd + 置位（原子）：置位后一切 withOpenFd 返 nil。
        func markClosed(_ closeFd: () -> Void) {
            lock.lock(); closeFd(); closed = true; lock.unlock()
        }
        var isClosed: Bool { lock.lock(); defer { lock.unlock() }; return closed }
        var syscallCount: Int { lock.lock(); defer { lock.unlock() }; return writeSyscalls }
    }
    private let fdGuard: FDGuard

    /// 退出观察回调（在 lifecycleQueue 上触发一次）：exit 结果 + 是否走了 SIGKILL 强杀升级。
    private let onExit: (@Sendable (PTYExit, Bool) -> Void)?

    /// - Parameters:
    ///   - config: spawn 参数
    ///   - readQueue: 读回调（onData）触发的队列（= 会话串行 queue）
    ///   - onData: pty 输出到达（[UInt8] 块），在 readQueue 上
    ///   - onExit: 子进程退出（在内部 lifecycleQueue 上，恰一次）
    public init(
        config: PTYSpawnConfig,
        readQueue: DispatchQueue,
        onData: @escaping @Sendable ([UInt8]) -> Void,
        onExit: (@Sendable (PTYExit, Bool) -> Void)? = nil
    ) throws {
        var master: Int32 = -1
        let effectiveCwd = config.cwd ?? ""
        let envArray = config.environment.map { "\($0.key)=\($0.value)" }
        // fd 关闭上界：fork 前取（getdtablesize 非 async-signal-safe，不能在子分支调）。
        let maxfd = getdtablesize()

        let pid = withNullTerminatedCArray(config.argv) { argvC in
            withNullTerminatedCArray(envArray) { envC in
                config.executablePath.withCString { pathC in
                    effectiveCwd.withCString { cwdC in
                        muxvo_pty_spawn(pathC, argvC, envC, cwdC, config.cols, config.rows, maxfd, &master)
                    }
                }
            }
        }
        guard pid > 0, master >= 0 else {
            throw PTYError.spawnFailed(errno: errno, path: config.executablePath)
        }
        self.pid = pid
        self.masterFD = master
        self.onExit = onExit
        // fd 守卫先于 readSource 建：cancel handler 捕获本地引用（不捕 self，避 init 期未全初始化）。
        let guardRef = FDGuard()
        self.fdGuard = guardRef

        let lifeQ = DispatchQueue(label: "muxvo.pty.lifecycle.\(pid)")
        self.lifecycleQueue = lifeQ

        // 非阻塞读，配合 DispatchSourceRead（64KB 循环读到 EAGAIN）。
        let flags = fcntl(master, F_GETFL, 0)
        _ = fcntl(master, F_SETFL, flags | O_NONBLOCK)

        let rsrc = DispatchSource.makeReadSource(fileDescriptor: master, queue: readQueue)
        rsrc.setEventHandler {
            var buf = [UInt8](repeating: 0, count: 65536)
            while true {
                let n = buf.withUnsafeMutableBytes { p in
                    read(master, p.baseAddress, p.count)
                }
                guard n > 0 else { break } // EAGAIN / EOF：退出由进程源收尾
                onData(Array(buf[0..<n]))
                if n < buf.count { break }
            }
        }
        // fd 关闭放在 cancel handler，避免 source 活跃期间 close 造成 fd 复用竞态。
        // 关 fd + 置写守卫 closed 原子（fdGuard）：此后 write 一律拒写，封 fd-recycle TOCTOU。
        rsrc.setCancelHandler { guardRef.markClosed { close(master) } }
        self.readSource = rsrc

        let psrc = DispatchSource.makeProcessSource(
            identifier: pid, eventMask: [.exit], queue: lifeQ
        )
        self.processSource = psrc
        // self 完全初始化后再挂 handler / resume。
        psrc.setEventHandler { [weak self] in self?.reapAndFinish() }

        rsrc.resume()
        psrc.resume()
    }

    // MARK: 写入（EAGAIN 退避）

    public func write(_ bytes: [UInt8]) {
        guard !bytes.isEmpty else { return }
        var off = 0
        bytes.withUnsafeBytes { raw in
            let base = raw.baseAddress!
            while off < bytes.count {
                // 守卫内单次 syscall（errno 就地读）：fd 已关 → nil，立即放弃（不碰已回收 fd）。
                let outcome = fdGuard.withOpenFd { () -> (n: Int, err: Int32) in
                    let n = Darwin.write(masterFD, base + off, bytes.count - off)
                    return (n, errno)
                }
                guard let outcome else { break } // fd 已收尸关闭：拒写（封 fd-recycle TOCTOU）
                if outcome.n > 0 {
                    off += outcome.n
                } else if outcome.n < 0 && outcome.err == EAGAIN {
                    usleep(1000) // 内核写缓冲满：短退避后重试（退避在守卫锁外）
                } else {
                    break // EOF / EIO（fd 已关或对端消失）
                }
            }
        }
    }

    // MARK: 测试可见（写守卫行为断言；@testable import）

    /// fd 是否已被 cancel handler 关闭（写守卫已置位）。收尸后拒写测试的确定性等待锚。
    var fdClosedForTest: Bool { fdGuard.isClosed }
    /// 实际发起的 write syscall 次数（守卫拒写不计）。收尸后 write 零 syscall = 守卫生效。
    var writeSyscallCountForTest: Int { fdGuard.syscallCount }

    public func write(_ text: String) { write(Array(text.utf8)) }

    /// TIOCSWINSZ（内核据此自动向前台进程组发 SIGWINCH；不手动发）。
    @discardableResult
    public func setWinsize(cols: UInt16, rows: UInt16) -> Bool {
        muxvo_pty_set_winsize(masterFD, cols, rows) == 0
    }

    // MARK: 优雅关闭协议

    /// SIGHUP → 进程组 → grace 内退出走进程源收尸；grace 超时升级 SIGKILL。
    /// 幂等：已在关闭/已收尸则忽略。
    public func gracefulClose(graceMs: Int) {
        lock.lock()
        if closing || reaped { lock.unlock(); return }
        closing = true
        let work = DispatchWorkItem { [weak self] in self?.escalateKill() }
        escalation = work
        lock.unlock()

        Self.lifecycleLog.info("gracefulClose SIGHUP pid=\(self.pid) grace=\(graceMs)ms")
        signalClose(SIGHUP)
        lifecycleQueue.asyncAfter(deadline: .now() + .milliseconds(graceMs), execute: work)
    }

    /// 立即强杀 + 收尸（deinit / 紧急路径）。幂等。
    public func terminate() {
        lock.lock()
        if reaped { lock.unlock(); return }
        closing = true
        escalation?.cancel()
        lock.unlock()
        signalClose(SIGKILL)
        reapAndFinish()
    }

    // MARK: 内部收尸

    /// 向进程组发信号（覆盖前台子进程）+ 向 leader pid 直发一份兜底。
    /// forkpty 子进程经 setsid 成为新会话/组首领（pgid==pid），但「父发信号」与「子 setsid」
    /// 存在竞态窗口：窗口内进程组 pid 尚未建立，`kill(-pid)` 会 ESRCH 而信号丢失（温顺子进程
    /// 因此收不到 SIGHUP、被迫走 grace 超时强杀）。故并向 leader pid 直发（幂等），保证首领必达。
    private func signalClose(_ sig: Int32) {
        let group = kill(-pid, sig) == 0
        let leader = kill(pid, sig) == 0
        if !group && !leader {
            let e = errno // 两路都失败（如进程已消失）：记 errno 便于诊断，不致命。
            FileHandle.standardError.write(Data("muxvo pty: kill pid=\(pid) sig=\(sig) errno=\(e)\n".utf8))
        }
    }

    private func escalateKill() {
        lock.lock()
        let done = reaped
        if !done { forcedKill = true }
        lock.unlock()
        guard !done else { return }
        Self.lifecycleLog.notice("escalateKill SIGKILL pid=\(self.pid)（grace 超时未退）")
        signalClose(SIGKILL)
    }

    private func reapAndFinish() {
        lock.lock()
        if reaped { lock.unlock(); return }
        reaped = true
        escalation?.cancel()
        let forced = forcedKill
        lock.unlock()

        var status: Int32 = 0
        // 进程源 .exit 触发即已成僵尸；此处收尸立即返回。终端/紧急路径亦可直接进。
        let w = waitpid(pid, &status, 0)
        let result: PTYExit
        if w == pid {
            if wIfExited(status) {
                result = .exited(code: wExitStatus(status))
            } else if wIfSignaled(status) {
                result = .signaled(signal: wTermSig(status))
            } else {
                result = .exited(code: -1)
            }
        } else {
            // 已被他处收割（ECHILD 等）——无从取码，记异常退出。
            result = .exited(code: -1)
        }

        processSource.cancel()
        readSource.cancel() // cancel handler 关 fd
        onExit?(result, forced)
    }

    deinit {
        // 未收尸则兜底强杀，防僵尸/孤儿。
        lock.lock()
        let need = !reaped
        lock.unlock()
        if need { terminate() }
    }
}

// MARK: - C 字符串数组桥接

/// [String] → NULL 结尾的 `char *const []`，仅在 body 执行期间有效。
private func withNullTerminatedCArray<R>(
    _ values: [String],
    _ body: (UnsafePointer<UnsafeMutablePointer<CChar>?>) -> R
) -> R {
    var cStrings: [UnsafeMutablePointer<CChar>?] = values.map { strdup($0) }
    cStrings.append(nil)
    defer { for p in cStrings { if let p { free(p) } } }
    return cStrings.withUnsafeBufferPointer { body($0.baseAddress!) }
}

// MARK: - <sys/wait.h> 宏（Swift 未导入，按 Darwin 定义实现）

@inline(__always) private func wStatusField(_ s: Int32) -> Int32 { s & 0x7f }
@inline(__always) private func wIfExited(_ s: Int32) -> Bool { wStatusField(s) == 0 }
@inline(__always) private func wExitStatus(_ s: Int32) -> Int32 { (s >> 8) & 0xff }
/// _WSTATUS 既非 0（正常退出）也非 0x7f（停止）即为被信号终结。
@inline(__always) private func wIfSignaled(_ s: Int32) -> Bool {
    let f = wStatusField(s)
    return f != 0 && f != 0x7f
}
@inline(__always) private func wTermSig(_ s: Int32) -> Int32 { wStatusField(s) }
