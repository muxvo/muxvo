// ApprovalSocketListener：交互式 worker 同步审批的 unix socket **会回包**收端（interactive-worker.md §2）。
//
// 与遥测 `HookSocketListener`（读一帧即 close、从不回写、单向 ingest）**并存不复用**——审批须双向：读
// PreToolUse 请求帧 → 走同一 control-plane 策略引擎裁决 → **回包**决策行（allow/deny/ask）。故独立 socket
// （`<dataRoot>/run/approval.sock`）+ 独立监听，`HookSocketListener`「读帧即焚」不变量不受影响（勿改它）。
//
// 换行分帧契约（对齐 fake-cli `--interactive` 审批 socket，FakeCliHookServerSupport/InteractiveHooks）：
//   请求帧 `{"v":1,"termId","event","raw":<CC hook payload>}` + `\n` → 决策行
//   `{"permissionDecision":"allow|deny|ask","permissionDecisionReason":"..."}` + `\n`。
//   PostToolUse 帧 fire-and-forget（不回包，反推锚 oracle-4）。
//
// 裁决/反推逻辑不在本类（纯传输）：注入 `decide`/`observePostTool` 闭包（装配层桥 termId→taskId +
// ControlPlaneCore 交互式入口，同 `HookSocketListener` 的 isLiveTerminal/onEvent 注入体例）。**三态防线**
// 落在 decide 闭包：termId 未映射 / 任务非 running / 未决 → 一律 `.ask`，绝不 `.allow`（fail-safe）。
import Darwin
import Dispatch
import Foundation
import os

/// 一次 PreToolUse 审批请求（解出结构化字段；worker 自由文本不入裁决——提示注入面隔离，五原则 #2）。
public struct ApprovalRequest: Sendable {
    public let termId: String
    public let toolName: String
    /// 规范化（sortedKeys）tool_input JSON（策略引擎的唯一结构化输入）。
    public let toolInputJSON: String
    /// CC tool_use_id（PostToolUse 反推匹配键；缺失 → nil，按 taskId 单未决兜底匹配）。
    public let toolUseID: String?
    public let ts: UInt64

    public init(termId: String, toolName: String, toolInputJSON: String, toolUseID: String?, ts: UInt64) {
        self.termId = termId
        self.toolName = toolName
        self.toolInputJSON = toolInputJSON
        self.toolUseID = toolUseID
        self.ts = ts
    }
}

/// PostToolUse 反推观测（人于 CC 原生对话框裁后工具真跑 → 触发 ⇒ 人允许，§2 oracle-4）。
public struct PostToolObservation: Sendable {
    public let termId: String
    public let toolUseID: String?
    public let ts: UInt64

    public init(termId: String, toolUseID: String?, ts: UInt64) {
        self.termId = termId
        self.toolUseID = toolUseID
        self.ts = ts
    }
}

/// 审批回包三态（S-hook：`permissionDecision` allow|deny|ask）。reason 转述给 CC/人（best-effort）。
public enum ApprovalHookReply: Sendable, Equatable {
    case allow(reason: String?)
    case deny(reason: String)
    case ask(reason: String?)

    var decisionString: String {
        switch self {
        case .allow: return "allow"
        case .deny: return "deny"
        case .ask: return "ask"
        }
    }

    var reason: String {
        switch self {
        case let .allow(r): return r ?? ""
        case let .deny(r): return r
        case let .ask(r): return r ?? ""
        }
    }
}

public final class ApprovalSocketListener: @unchecked Sendable {
    private static let log = Logger(subsystem: "com.muxvo", category: "approvalsock")

    /// 单帧上限：64 KB（同 HookSocketListener）。超限连接丢弃计数。
    public static let maxFrameBytes = 64 * 1024
    /// 读超时（防连而不发/不关拖住 worker 的 hook 进程）。
    private static let recvTimeoutSeconds: Int = 2
    private static let acceptBacklog: Int32 = 64

    /// event 白名单（审批脚本只发这两个；其余非法丢弃）。
    static let approvalEvent = "PreToolUse"
    static let postToolEvent = "PostToolUse"

    public struct Counters: Sendable, Equatable {
        public var preToolUse: Int = 0
        public var postToolUse: Int = 0
        public var illegal: Int = 0        // 非 JSON / 字段白名单不符 / v≠1 / 未知 event
        public var oversize: Int = 0
        public var acceptFailures: Int = 0
    }

    public let socketURL: URL
    private let runDirectory: URL
    /// PreToolUse 请求 → 决策（装配层桥 termId→taskId + ControlPlaneCore 交互式入口；三态防线在此闭包内）。
    private let decide: @Sendable (ApprovalRequest) async -> ApprovalHookReply
    /// PostToolUse 反推观测（best-effort；无未决审批则 no-op）。
    private let observePostTool: @Sendable (PostToolObservation) async -> Void

    private let acceptQueue = DispatchQueue(label: "muxvo.approval.accept")
    private let connQueue = DispatchQueue(label: "muxvo.approval.conn", attributes: .concurrent)
    private let stateLock = NSLock()
    private var listenFD: Int32 = -1
    private var acceptSource: DispatchSourceRead?
    private var running = false
    private var counters = Counters()

    /// - runDirectory：`<dataRoot>/run/`（socket 宿主，与 hook.sock 同目录，各 bind 各的）。
    public init(
        runDirectory: URL,
        decide: @escaping @Sendable (ApprovalRequest) async -> ApprovalHookReply,
        observePostTool: @escaping @Sendable (PostToolObservation) async -> Void
    ) {
        self.runDirectory = runDirectory
        socketURL = runDirectory.appendingPathComponent(ApprovalHookScript.socketFileName)
        self.decide = decide
        self.observePostTool = observePostTool
    }

    deinit { stop() }

    // MARK: 启动 / 停止

    /// 启动监听：建 run/ + unlink 残留 + socket/bind/listen（0600）+ DispatchSource accept。幂等。
    public func start() throws {
        stateLock.lock()
        if running { stateLock.unlock(); return }
        stateLock.unlock()

        try FileManager.default.createDirectory(at: runDirectory, withIntermediateDirectories: true)
        let path = socketURL.path
        guard path.utf8.count < 104 else { throw ApprovalSocketError.pathTooLong(path) }

        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { throw ApprovalSocketError.syscall("socket", errno) }
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
        guard bindOK else { close(fd); throw ApprovalSocketError.pathTooLong(path) }

        let len = socklen_t(MemoryLayout<sockaddr_un>.size)
        let bindRC = withUnsafePointer(to: &addr) { ptr -> Int32 in
            ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, len) }
        }
        guard bindRC == 0 else { let e = errno; close(fd); throw ApprovalSocketError.syscall("bind", e) }

        chmod(path, 0o600) // 仅本用户可连（同 hook.sock）
        guard listen(fd, Self.acceptBacklog) == 0 else {
            let e = errno; close(fd); unlink(path); throw ApprovalSocketError.syscall("listen", e)
        }
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

    /// 停止监听 + unlink socket（幂等）。停后 socket 文件消失 → 审批脚本 `[ -S ]` 假 → emit_ask（对抗防线）。
    public func stop() {
        stateLock.lock()
        guard running else { stateLock.unlock(); return }
        running = false
        let src = acceptSource
        acceptSource = nil
        listenFD = -1
        stateLock.unlock()
        src?.cancel()
        unlink(socketURL.path)
    }

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
                if e == EAGAIN || e == EWOULDBLOCK { break }
                bump { $0.acceptFailures += 1 }
                Self.log.error("approval socket accept 失败 errno=\(e, privacy: .public)")
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
        // 清 O_NONBLOCK（accept 继承 listen fd 的非阻塞会把「数据没到」误当 EOF）+ 读超时，配合 \n 成帧。
        let flags = fcntl(fd, F_GETFL, 0)
        if flags >= 0 { _ = fcntl(fd, F_SETFL, flags & ~O_NONBLOCK) }
        var tv = timeval(tv_sec: Self.recvTimeoutSeconds, tv_usec: 0)
        setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))

        guard let frame = readLine(fd) else { close(fd); return }
        let recvMs = WaitClock.nowMs()
        guard let parsed = Self.parse(frame: frame) else {
            bump { $0.illegal += 1 }; close(fd); return
        }

        switch parsed.event {
        case Self.approvalEvent:
            bump { $0.preToolUse += 1 }
            let req = ApprovalRequest(
                termId: parsed.termId, toolName: parsed.toolName,
                toolInputJSON: parsed.toolInputJSON, toolUseID: parsed.toolUseID, ts: recvMs)
            let decide = self.decide
            Task {
                let reply = await decide(req)
                Self.writeReply(fd, reply)
                close(fd)
            }
        case Self.postToolEvent:
            bump { $0.postToolUse += 1 }
            close(fd) // fire-and-forget：不回包
            let obs = PostToolObservation(termId: parsed.termId, toolUseID: parsed.toolUseID, ts: recvMs)
            let observe = observePostTool
            Task { await observe(obs) }
        default:
            bump { $0.illegal += 1 }; close(fd)
        }
    }

    // MARK: 解析

    struct ParsedFrame {
        let termId: String
        let event: String
        let toolName: String
        let toolInputJSON: String
        let toolUseID: String?
    }

    /// 解 `{"v":1,"termId","event","raw":<payload>}`；白名单校验 v==1 / termId 非空 / event∈{Pre,Post}TooUse。
    /// raw 内解 tool_name / tool_input（object → 规范化 sortedKeys JSON）/ tool_use_id（PostToolUse 只需后者）。
    static func parse(frame: Data) -> ParsedFrame? {
        guard !frame.isEmpty, frame.count <= maxFrameBytes,
              let obj = (try? JSONSerialization.jsonObject(with: frame)) as? [String: Any],
              let v = obj["v"] as? Int, v == 1,
              let termId = obj["termId"] as? String, !termId.isEmpty,
              let event = obj["event"] as? String, event == approvalEvent || event == postToolEvent
        else { return nil }
        let raw = obj["raw"] as? [String: Any] ?? [:]
        let toolUseID = raw["tool_use_id"] as? String
        // tool_name：PreToolUse 必需；PostToolUse 可缺（反推只用 tool_use_id）。
        let toolName = raw["tool_name"] as? String ?? ""
        if event == approvalEvent, toolName.isEmpty { return nil }
        // tool_input 规范化（不可信数据；缺失/非对象 → 空对象）。
        let inputObj = raw["tool_input"] as? [String: Any] ?? [:]
        let inputJSON: String
        if let data = try? JSONSerialization.data(withJSONObject: inputObj, options: [.sortedKeys]) {
            inputJSON = String(decoding: data, as: UTF8.self)
        } else {
            inputJSON = "{}"
        }
        return ParsedFrame(termId: termId, event: event, toolName: toolName,
                           toolInputJSON: inputJSON, toolUseID: toolUseID)
    }

    // MARK: 回包

    /// 决策行序列化 + 写回（单行 + `\n`，供 bash sed / fake-cli readOneLine 成帧）。reason 净化（去 `"` `\`
    /// 换行）保单行 + bash 解析不破。写失败（hook 已关/EPIPE）静默——nc 空返即 emit_ask，仍不 fail-open。
    static func writeReply(_ fd: Int32, _ reply: ApprovalHookReply) {
        let reason = sanitizeReason(reply.reason)
        let line = "{\"permissionDecision\":\"\(reply.decisionString)\",\"permissionDecisionReason\":\"\(reason)\"}\n"
        var data = Array(line.utf8)
        var off = 0
        while off < data.count {
            let n = data.withUnsafeBytes { write(fd, $0.baseAddress!.advanced(by: off), data.count - off) }
            if n <= 0 { if errno == EINTR { continue }; break }
            off += n
        }
    }

    static func sanitizeReason(_ s: String) -> String {
        String(s.prefix(500)).map { c -> Character in
            (c == "\"" || c == "\\" || c == "\n" || c == "\r") ? " " : c
        }.reduce(into: "") { $0.append($1) }
    }

    // MARK: 底层读

    /// 读到 `\n`（去换行）成一帧；EOF 前有残行则原样返（容忍无换行），全空 → nil。上限保护。
    private func readLine(_ fd: Int32) -> Data? {
        var buf = Data()
        var chunk = [UInt8](repeating: 0, count: 8192)
        while true {
            if let idx = buf.firstIndex(of: 0x0A) { return buf.subdata(in: buf.startIndex ..< idx) }
            if buf.count > Self.maxFrameBytes { bump { $0.oversize += 1 }; return nil }
            let n = chunk.withUnsafeMutableBytes { read(fd, $0.baseAddress, $0.count) }
            if n > 0 { buf.append(contentsOf: chunk[0 ..< n]) }
            else if n == 0 { return buf.isEmpty ? nil : buf }
            else { if errno == EINTR { continue }; return buf.isEmpty ? nil : buf }
        }
    }

    private func bump(_ mutate: (inout Counters) -> Void) {
        stateLock.lock(); mutate(&counters); stateLock.unlock()
    }
}

public enum ApprovalSocketError: Error, CustomStringConvertible, Equatable {
    case syscall(String, Int32)
    case pathTooLong(String)
    public var description: String {
        switch self {
        case let .syscall(op, e): return "approval socket \(op) errno=\(e)"
        case let .pathTooLong(p): return "approval socket 路径超 sockaddr_un 上限：\(p)"
        }
    }
}
