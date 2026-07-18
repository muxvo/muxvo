// PTY 子进程崩溃孤儿账本 + 孤儿收割（terminal-session.md §7.2）。
//
// 为什么 home 在 MuxvoStorage：账本落盘要走本模块唯一落盘入口 AtomicFile；收割器既要被
// 真壳启动路径（MuxvoApp StartupIntegrityCheck）用，又要被 SIGKILL 集成 helper 用——二者
// 的公共可 import 模块只有 MuxvoStorage（MuxvoTerm 不在其依赖图，Package.swift 冻结）。故
// 账本/收割是纯 pid 层设施（Foundation+Darwin），与 MuxvoTerm/会话核心解耦：SessionRegistry
// 通过注入闭包 record/remove 写账本（依赖倒置），本文件不反向依赖会话层。
//
// 账本语义：spawn 成功即原子写 {pid, 子进程启动时间}；正常收尸移除该条。app 崩溃（SIGKILL）
// 时 master fd 随进程关闭、前台组本会收内核 SIGHUP——本机制兜「忽略 SIGHUP 的后台残留」：
// 二次启动（crashRecovery）读账本，pid 存活且启动时间匹配（防 PID 复用误杀）→ SIGHUP → 短
// grace → SIGKILL → 清账本。启动时间用 sysctl(KERN_PROC_PID) 的 p_starttime（微秒），写/读
// 同源，PID 复用后启动时间必不同 → 不误杀。
import Darwin
import Foundation

/// 账本一条：pid + 该 pid 的进程启动时间（微秒，防 PID 复用误杀的判别键）。
public struct PtyChildRecord: Codable, Equatable, Sendable {
    public let pid: Int32
    public let startTimeMicros: UInt64

    public init(pid: Int32, startTimeMicros: UInt64) {
        self.pid = pid
        self.startTimeMicros = startTimeMicros
    }
}

/// 进程存活/启动时间探针（sysctl KERN_PROC_PID）。启动时间是 PID 复用判别键：同一 pid 被
/// 复用后 p_starttime 必不同——收割前比对，不匹配即视为「已非当初那个子进程」，不杀。
public enum PtyProcessProbe {
    /// pid 的进程启动时间（微秒）。进程不存在返回 nil（sysctl size==0）。
    public static func startTimeMicros(pid: Int32) -> UInt64? {
        var info = kinfo_proc()
        var size = MemoryLayout<kinfo_proc>.stride
        var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, pid]
        let rc = sysctl(&mib, 4, &info, &size, nil, 0)
        guard rc == 0, size > 0 else { return nil }
        let tv = info.kp_proc.p_starttime
        return UInt64(bitPattern: Int64(tv.tv_sec)) &* 1_000_000 &+ UInt64(bitPattern: Int64(tv.tv_usec))
    }

    /// kill(pid, 0)：0 或 EPERM = 存活；ESRCH = 已不存在。
    public static func isAlive(pid: Int32) -> Bool {
        if kill(pid, 0) == 0 { return true }
        return errno != ESRCH
    }
}

/// pty-children.json 账本存取（原子写，线程安全）。路径 = <root>/run/pty-children.json。
/// run/ 目录惰性创建。记账用 durability .full（崩溃后须可恢复账本才能收割孤儿）。
public final class PtyChildrenStore: @unchecked Sendable {
    private let fileURL: URL
    private let runDirectory: URL
    private let lock = NSLock()

    public init(root: URL) {
        runDirectory = root.appendingPathComponent("run", isDirectory: true)
        fileURL = runDirectory.appendingPathComponent("pty-children.json")
    }

    /// spawn 成功记一条：现取该 pid 的启动时间与之绑定。启动时间取不到（进程已瞬退）则不记。
    public func record(pid: Int32) throws {
        guard let start = PtyProcessProbe.startTimeMicros(pid: pid) else { return }
        lock.lock(); defer { lock.unlock() }
        var records = readLocked()
        records.removeAll { $0.pid == pid } // 同 pid 去重（防复用残留旧条）
        records.append(PtyChildRecord(pid: pid, startTimeMicros: start))
        try writeLocked(records)
    }

    /// 正常收尸移除该 pid 条。
    public func remove(pid: Int32) throws {
        lock.lock(); defer { lock.unlock() }
        var records = readLocked()
        let before = records.count
        records.removeAll { $0.pid == pid }
        guard records.count != before else { return } // 无变化不写盘
        try writeLocked(records)
    }

    /// 当前全部账本条目（文件不存在/损坏 → 空）。
    public func readAll() -> [PtyChildRecord] {
        lock.lock(); defer { lock.unlock() }
        return readLocked()
    }

    /// 清空账本（收割后调用）：删文件（幂等）。
    public func clear() throws {
        lock.lock(); defer { lock.unlock() }
        try AtomicFile.remove(at: fileURL, durability: .full)
    }

    // MARK: - 私有（须持 lock）

    private func readLocked() -> [PtyChildRecord] {
        guard let data = try? Data(contentsOf: fileURL) else { return [] }
        return (try? JSONDecoder().decode([PtyChildRecord].self, from: data)) ?? []
    }

    private func writeLocked(_ records: [PtyChildRecord]) throws {
        try FileManager.default.createDirectory(at: runDirectory, withIntermediateDirectories: true)
        let data = try JSONEncoder().encode(records)
        try AtomicFile.write(data, to: fileURL, durability: .full)
    }
}

/// 孤儿 PTY 收割器（纯 pid 层，无会话依赖）。SIGHUP → 短 grace → SIGKILL，启动时间匹配防复用误杀。
public enum OrphanPtyReaper {
    /// 收割默认 grace（规格 §3.2 优雅期，与 close grace 同源 5000ms；测试注入短值）。
    public static let defaultGraceMs = 5000

    /// 逐条收割 records 中「存活且启动时间匹配」的孤儿，返回确认被收割（已消失）的 pid。
    /// 匹配失败（PID 复用）或已消失的条目不杀。收割动作：SIGHUP→轮询 grace→仍活则 SIGKILL→
    /// 轮询确认消失（孤儿已被 launchd 收养，不能 waitpid，用 kill(pid,0)→ESRCH 判死）。
    /// - Parameter pollStepMs: 存活轮询步长（默认 20ms；测试可调）。
    @discardableResult
    public static func reap(
        _ records: [PtyChildRecord], graceMs: Int = defaultGraceMs, pollStepMs: Int = 20
    ) -> [Int32] {
        let selfPID = getpid()
        var reaped: [Int32] = []
        for rec in records {
            // 安全阀：绝不动 pid<=1（init/launchd）或自己。
            guard rec.pid > 1, rec.pid != selfPID else { continue }
            guard PtyProcessProbe.isAlive(pid: rec.pid) else { continue } // 已消失
            // PID 复用防误杀：启动时间不匹配 = 已非当初那个子进程，放过。
            guard let now = PtyProcessProbe.startTimeMicros(pid: rec.pid), now == rec.startTimeMicros
            else { continue }

            _ = kill(rec.pid, SIGHUP)
            if waitForDeath(rec.pid, timeoutMs: graceMs, stepMs: pollStepMs) {
                reaped.append(rec.pid); continue
            }
            _ = kill(rec.pid, SIGKILL) // 顽固（忽略 SIGHUP 的后台残留）→ 强杀
            if waitForDeath(rec.pid, timeoutMs: 1000, stepMs: pollStepMs) {
                reaped.append(rec.pid)
            }
        }
        return reaped
    }

    /// 轮询 pid 直到消失（ESRCH）或超时。
    private static func waitForDeath(_ pid: Int32, timeoutMs: Int, stepMs: Int) -> Bool {
        let deadline = DispatchTime.now() + .milliseconds(timeoutMs)
        while DispatchTime.now() < deadline {
            if !PtyProcessProbe.isAlive(pid: pid) { return true }
            usleep(UInt32(max(1, stepMs) * 1000))
        }
        return !PtyProcessProbe.isAlive(pid: pid)
    }
}

extension PtyChildrenStore {
    /// StartupIntegrityCheck 工厂：崩溃恢复路径读账本 → 收割孤儿 → 清账本（best-effort，不抛错阻断启动）。
    /// 名 "orphan-pty-reaper"（terminal-session.md §7.2）。仅在 crashRecovery verdict 触发（lifecycle §6）。
    public static func orphanReaperCheck(graceMs: Int = OrphanPtyReaper.defaultGraceMs) -> StartupIntegrityCheck {
        StartupIntegrityCheck("orphan-pty-reaper") { dataDirectory in
            let store = PtyChildrenStore(root: dataDirectory.root)
            let records = store.readAll()
            guard !records.isEmpty else { return }
            let reaped = OrphanPtyReaper.reap(records, graceMs: graceMs)
            try? store.clear() // 收割后一律清账本（当前 run 尚未 spawn 任何终端）
            FileHandle.standardError.write(
                Data("[muxvo] orphan-pty-reaper: \(records.count) 条账本，收割 \(reaped.count) 个孤儿\n".utf8))
        }
    }

    /// ShutdownStep 工厂：干净退出时收割账本中仍存活的子进程（保 checkpoint 前 PTY 静默，§7.1）→ 清账本。
    /// 名 "pty-close-all"。与真壳内存态 SessionRegistry.closeAll 组合：会话优雅关闭后其条目已被移除，
    /// 此步对空账本 no-op；未接内存态 Registry 时此步据账本兜底收割。best-effort，不抛错阻断 checkpoint。
    public static func closeAllShutdownStep(root: URL, graceMs: Int = OrphanPtyReaper.defaultGraceMs) -> ShutdownStep {
        ShutdownStep("pty-close-all") {
            let store = PtyChildrenStore(root: root)
            let records = store.readAll()
            guard !records.isEmpty else { return }
            OrphanPtyReaper.reap(records, graceMs: graceMs)
            try? store.clear()
        }
    }
}
