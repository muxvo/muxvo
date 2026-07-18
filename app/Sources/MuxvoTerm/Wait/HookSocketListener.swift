// HookSocketListener：Layer 0 hook 传输的 unix socket 收包端（wait-detector.md §4）。
//
// 路径 `<dataRoot>/run/hook.sock`（~62 字节 < sockaddr_un 104 上限；数据目录隔离纪律内）。
// 选 socket 不选 spool+FSEvents（§4）：亚毫秒 / 连接即焚无残留 / app 不在时 connect 秒退 /
// 一连接一事件天然成帧。**重启不重放**（进程兜底扫一遍 + 后续事件流自愈）。
//
// 生命周期（§4）：启动 unlink 残留 + bind + listen（后台 DispatchSource accept，逐连接读一条
// JSON，64KB 上限，非法丢弃计数）；stop/deinit unlink；崩溃残留下次启动 unlink 覆盖。socket 0600。
//
// 安全（§4「native 从不信任框架」）：raw 按不可信数据——不 eval、不透传 shell；按白名单字段
// （v==1 / termId / event∈四 hook）+ 大小上限（64KB）+ **活体 termId 表**校验；查无 termId 即丢弃
// ⇒ 注入爆炸半径限于「自己那条事件被丢」。每 termId 限速 20/s。收包瞬间打 epoch ms 戳作 ts 权威。
import Darwin
import Dispatch
import Foundation
import os

public final class HookSocketListener: @unchecked Sendable {
    /// 可诊断性日志（DOGFOOD_M3_02 F5 先例，subsystem com.muxvo，`log show` 一网打尽）。
    private static let log = Logger(subsystem: "com.muxvo", category: "hooksock")

    /// 单帧上限（§4）：64 KB。超限连接丢弃计数。
    public static let maxFrameBytes = 64 * 1024
    /// 每 termId 限速（§4）：20 条/秒（固定 1s 窗口）。
    public static let rateLimitPerSecond = 20
    /// 连接读超时（防恶意连接不发不关拖住 worker）。
    private static let recvTimeoutSeconds: Int = 2
    private static let acceptBacklog: Int32 = 64

    /// hook JSON 的 event 串 → WaitEventKind（白名单；不在表内即非法丢弃）。
    static let eventMap: [String: WaitEventKind] = [
        "Notification": .notification,
        "Stop": .stop,
        "UserPromptSubmit": .userPromptSubmit,
        "SessionStart": .sessionStart,
    ]

    /// 丢弃/接收计数（观测 + 测试断言）。线程安全。
    public struct Counters: Sendable, Equatable {
        public var accepted: Int = 0
        public var illegal: Int = 0        // 非 JSON / 字段白名单不符 / v≠1
        public var unknownTerm: Int = 0    // termId 不在活体表
        public var oversize: Int = 0       // >64KB
        public var rateLimited: Int = 0    // 超 20/s
        public var acceptFailures: Int = 0 // accept() 返非 EAGAIN 错误次数（诊断：fd 耗尽 vs 源饥饿）
    }

    public let socketURL: URL
    private let runDirectory: URL
    /// 活体 termId 校验（§4）：查无即丢弃。由上层注入（真壳接 SessionRegistry 活体表）。
    private let isLiveTerminal: @Sendable (String) -> Bool
    /// 校验通过的事件出口（真壳接 WaitEventBus.publish）。
    private let onEvent: @Sendable (WaitEvent) -> Void

    private let acceptQueue = DispatchQueue(label: "muxvo.wait.hooksock.accept")
    private let connQueue = DispatchQueue(label: "muxvo.wait.hooksock.conn", attributes: .concurrent)
    private let stateLock = NSLock()
    private var listenFD: Int32 = -1
    private var acceptSource: DispatchSourceRead?
    private var running = false
    private var counters = Counters()
    // 限速窗口：termId → (窗口起点 epoch ms, 窗口内计数)。
    private var rateWindows: [String: (startMs: UInt64, count: Int)] = [:]

    public init(
        runDirectory: URL,
        isLiveTerminal: @escaping @Sendable (String) -> Bool,
        onEvent: @escaping @Sendable (WaitEvent) -> Void
    ) {
        self.runDirectory = runDirectory
        self.socketURL = runDirectory.appendingPathComponent("hook.sock")
        self.isLiveTerminal = isLiveTerminal
        self.onEvent = onEvent
    }

    deinit { stop() }

    // MARK: 启动 / 停止

    /// 启动监听：建 run/ + unlink 残留 + socket/bind/listen（0600）+ DispatchSource accept。
    /// 已在运行则忽略。绑定失败抛错。
    public func start() throws {
        stateLock.lock()
        if running { stateLock.unlock(); return }
        stateLock.unlock()

        try FileManager.default.createDirectory(at: runDirectory, withIntermediateDirectories: true)
        let path = socketURL.path
        guard path.utf8.count < 104 else {
            throw HookSocketError.pathTooLong(path)
        }

        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { throw HookSocketError.syscall("socket", errno) }

        // 崩溃/上次残留 socket 文件：unlink 覆盖（§4）。
        unlink(path)

        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)
        let bindOK = path.withCString { cpath -> Bool in
            withUnsafeMutablePointer(to: &addr.sun_path) { sunPathPtr -> Bool in
                sunPathPtr.withMemoryRebound(to: CChar.self, capacity: 104) { dst -> Bool in
                    let n = strlen(cpath)
                    guard n < 104 else { return false }
                    memcpy(dst, cpath, n + 1)
                    return true
                }
            }
        }
        guard bindOK else { close(fd); throw HookSocketError.pathTooLong(path) }

        let len = socklen_t(MemoryLayout<sockaddr_un>.size)
        let bindRC = withUnsafePointer(to: &addr) { ptr -> Int32 in
            ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, len) }
        }
        guard bindRC == 0 else { let e = errno; close(fd); throw HookSocketError.syscall("bind", e) }

        // 0600：仅本用户可连（§4）。
        chmod(path, 0o600)

        guard listen(fd, Self.acceptBacklog) == 0 else {
            let e = errno; close(fd); unlink(path); throw HookSocketError.syscall("listen", e)
        }

        // 非阻塞 + DispatchSource accept（比照 PTYHost 读源模式，不占阻塞线程）。
        let flags = fcntl(fd, F_GETFL, 0)
        _ = fcntl(fd, F_SETFL, flags | O_NONBLOCK)

        let src = DispatchSource.makeReadSource(fileDescriptor: fd, queue: acceptQueue)
        src.setEventHandler { [weak self] in self?.acceptLoop() }
        src.setCancelHandler { close(fd) }

        stateLock.lock()
        listenFD = fd
        acceptSource = src
        running = true
        stateLock.unlock()

        src.resume()
    }

    /// 停止监听 + unlink socket（幂等）。
    public func stop() {
        stateLock.lock()
        guard running else { stateLock.unlock(); return }
        running = false
        let src = acceptSource
        acceptSource = nil
        listenFD = -1
        stateLock.unlock()
        src?.cancel() // cancel handler 关 fd
        unlink(socketURL.path)
    }

    /// 当前计数快照（测试/观测）。
    public func snapshotCounters() -> Counters {
        stateLock.lock(); defer { stateLock.unlock() }
        return counters
    }

    // MARK: accept / 读连接

    private func acceptLoop() {
        while true {
            let cfd = accept(currentListenFD(), nil, nil)
            if cfd < 0 {
                let e = errno
                // EAGAIN/EWOULDBLOCK：本轮已无待接连接（正常收尾，不计数）。
                if e == EAGAIN || e == EWOULDBLOCK { break }
                // 其余 errno（EMFILE/ENFILE/EINTR…）：记 errno 供 CI/dogfood 诊断——可据此区分
                // 「accept 报 fd 耗尽」vs「acceptFailures=0 即源从未被调度（线程池饥饿）」。
                // 控制流不变：仍退出等下次源触发（纯加计数/日志，行为语义零变更）。
                bump { $0.acceptFailures += 1 }
                Self.log.error("hook socket accept 失败 errno=\(e, privacy: .public)")
                break
            }
            connQueue.async { [weak self] in self?.handleConnection(cfd) }
        }
    }

    private func currentListenFD() -> Int32 {
        stateLock.lock(); defer { stateLock.unlock() }
        return listenFD
    }

    private func handleConnection(_ fd: Int32) {
        defer { close(fd) }
        // macOS/BSD 下 accept() 继承 listen fd 的 O_NONBLOCK → 收到的连接 fd 非阻塞，read 会以 EAGAIN
        // 立即返回（把「数据还没到」误当 EOF，多段大帧被截断、SO_RCVTIMEO 也失效）。显式清 O_NONBLOCK
        // 恢复阻塞语义，配合 SO_RCVTIMEO 让 read 阻塞到「有数据 / EOF / 超时」，完整成帧。
        let flags = fcntl(fd, F_GETFL, 0)
        if flags >= 0 { _ = fcntl(fd, F_SETFL, flags & ~O_NONBLOCK) }
        // 读超时：防连而不发/不关。
        var tv = timeval(tv_sec: Self.recvTimeoutSeconds, tv_usec: 0)
        setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))

        var buffer = [UInt8]()
        buffer.reserveCapacity(4096)
        var chunk = [UInt8](repeating: 0, count: 8192)
        var oversize = false
        while true {
            let n = chunk.withUnsafeMutableBytes { read(fd, $0.baseAddress, $0.count) }
            if n > 0 {
                buffer.append(contentsOf: chunk[0..<n])
                if buffer.count > Self.maxFrameBytes { oversize = true; break }
            } else {
                break // EOF / 超时 / 错误：成帧结束（一连接一事件）。
            }
        }

        if oversize {
            bump { $0.oversize += 1 }
            return
        }
        process(frame: buffer)
    }

    // MARK: 解析 + 校验 + 出口

    private func process(frame: [UInt8]) {
        let recvMs = WaitClock.nowMs()
        guard !frame.isEmpty,
              let obj = (try? JSONSerialization.jsonObject(with: Data(frame))) as? [String: Any]
        else { bump { $0.illegal += 1 }; return }

        // 白名单字段：v==1 / termId 非空 String / event∈四 hook。
        guard let v = obj["v"] as? Int, v == 1,
              let termId = obj["termId"] as? String, !termId.isEmpty,
              let eventStr = obj["event"] as? String, let kind = Self.eventMap[eventStr]
        else { bump { $0.illegal += 1 }; return }

        // 活体 termId 表（§4 安全边界）：查无即丢弃 → 注入无法冒充未知 termId。
        guard isLiveTerminal(termId) else { bump { $0.unknownTerm += 1 }; return }

        // 每 termId 限速 20/s。
        guard admitRate(termId: termId, nowMs: recvMs) else { bump { $0.rateLimited += 1 }; return }

        // raw：不可信原文，透传存证（不 eval/不解析结构）。缺失/null → nil。
        let raw = Self.rawText(obj["raw"])
        bump { $0.accepted += 1 }
        // 收包时刻 = <2s 判据权威 t0（hook 彩排取证锚点；raw 不可信不入日志）。
        Self.log.notice("hook 事件收包 term=\(termId, privacy: .public) event=\(eventStr, privacy: .public) recvMs=\(recvMs, privacy: .public)")
        onEvent(WaitEvent(termId: termId, event: kind, ts: recvMs, raw: raw))
    }

    /// raw 值 → 紧凑 JSON 文本（存证用）。NSNull/缺失 → nil；序列化失败 → nil。
    private static func rawText(_ value: Any?) -> String? {
        guard let value, !(value is NSNull) else { return nil }
        // 顶层可能是标量/对象/数组——用 fragmentsAllowed 兜标量。
        guard JSONSerialization.isValidJSONObject(value) || value is String || value is NSNumber else {
            return nil
        }
        if let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]) {
            return String(decoding: data, as: UTF8.self)
        }
        return nil
    }

    /// 固定 1s 窗口限速：窗口过期则重置；窗口内 < 上限放行、达上限拒。
    private func admitRate(termId: String, nowMs: UInt64) -> Bool {
        stateLock.lock(); defer { stateLock.unlock() }
        if var win = rateWindows[termId], nowMs &- win.startMs < 1000 {
            guard win.count < Self.rateLimitPerSecond else { return false }
            win.count += 1
            rateWindows[termId] = win
            return true
        }
        rateWindows[termId] = (startMs: nowMs, count: 1)
        return true
    }

    private func bump(_ mutate: (inout Counters) -> Void) {
        stateLock.lock(); mutate(&counters); stateLock.unlock()
    }
}

public enum HookSocketError: Error, CustomStringConvertible, Equatable {
    case syscall(String, Int32)
    case pathTooLong(String)
    public var description: String {
        switch self {
        case let .syscall(op, e): return "hook socket \(op) errno=\(e)"
        case let .pathTooLong(p): return "hook socket 路径超 sockaddr_un 上限：\(p)"
        }
    }
}
