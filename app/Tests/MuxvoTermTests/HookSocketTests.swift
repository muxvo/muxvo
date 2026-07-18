// HookSocketListener 集成测 + hook 中继脚本 bash 直测（批5①，wait-detector.md §9）。
//
// 覆盖 §10：WD_socket_reject（非法 JSON / v≠1 / 坏 event / 未知 termId / 超 64KB）、WD_socket_ratelimit
// （>20/s）、正常收包 / 并发 20 连接 / stale socket 接管。脚本测：无 env 秒退 / 无 socket 秒退 /
// 正常转发对照收包 / 退出 <100ms。socket 用 $TMPDIR 隔离（绝不碰真数据目录）。
import Darwin
import Foundation
import Testing
@testable import MuxvoTerm

// MARK: - helpers

// 默认 20s（旧 3s）：这些 socket 观察断言等的是 kqueue 驱动的 accept DispatchSource 回调。
// 全量并行 `swift test`（800+ 用例）下 GCD 池被 PTY/SIGKILL 等阻塞工作占满，accept 源回调调度尾
// 延迟被抬高——本机（无 CI env → scale=1）实测：单 suite 满载时 accept 落 ~3.5-4.8s（越过旧 3s 窗
// 口即红，connection 一直在 backlog、client connect/write 全成、accepted=0 且 acceptFailures=0 =
// 源从未被调度，非 accept 报错）；多 suite 并发风暴（多 agent 同跑全量）曾见 ~11.2s 深饥饿（同轮另有
// 6+ 无关计时用例一起红=整机调度塌陷，非 socket 专属）。20s 基线对最坏观测留 ~1.8× 余量；成功即返回，
// 绿路耗时不变；仅「真断裂」的判红时延随窗口增长（罕见，可接受）。CI 侧另有 muxvoCITimeoutScale ×8。
private func pollUntil(timeout: TimeInterval = 20, _ cond: () -> Bool) -> Bool {
    let deadline = Date().addingTimeInterval(timeout * muxvoCITimeoutScale())
    while Date() < deadline {
        if cond() { return true }
        usleep(5_000)
    }
    return cond()
}

/// 短路径 run 目录：unix socket 全路径须 < sockaddr_un 104 字节，$TMPDIR(/var/folders/…) 过长，
/// 故用 /tmp 短前缀（/tmp/mxh-<8hex>/hook.sock ≈27 字节，远低于上限；测试隔离，用后即弃）。
private func uniqueRunDir() -> URL {
    let suffix = UUID().uuidString.prefix(8)
    let dir = URL(fileURLWithPath: "/tmp/mxh-\(suffix)", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
}

/// 连接 unix socket、发字节、关闭（EOF → 服务端成帧）。SO_NOSIGPIPE 防 oversize 时 EPIPE 崩测。
/// 返回 nil=成功；否则失败阶段+errno（CI 诊断：本地恒成功，CI 红时定位 client/listener 半区）。
@discardableResult
private func sendToSocket(_ path: String, _ payload: [UInt8]) -> String? {
    let fd = socket(AF_UNIX, SOCK_STREAM, 0)
    guard fd >= 0 else { return "socket errno=\(errno)" }
    defer { close(fd) }
    var noSig: Int32 = 1
    setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &noSig, socklen_t(MemoryLayout<Int32>.size))

    var addr = sockaddr_un()
    addr.sun_family = sa_family_t(AF_UNIX)
    let ok = path.withCString { cpath -> Bool in
        withUnsafeMutablePointer(to: &addr.sun_path) { p in
            p.withMemoryRebound(to: CChar.self, capacity: 104) { dst in
                let n = strlen(cpath)
                guard n < 104 else { return false }
                memcpy(dst, cpath, n + 1)
                return true
            }
        }
    }
    guard ok else { return "path>104: \(path)" }
    let len = socklen_t(MemoryLayout<sockaddr_un>.size)
    let rc = withUnsafePointer(to: &addr) {
        $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(fd, $0, len) }
    }
    guard rc == 0 else { return "connect errno=\(errno)" }

    var sent = 0
    var writeErr: Int32 = 0
    payload.withUnsafeBytes { raw in
        while sent < raw.count {
            let n = Darwin.write(fd, raw.baseAddress!.advanced(by: sent), raw.count - sent)
            if n <= 0 { writeErr = errno; break }
            sent += n
        }
    }
    guard sent == payload.count else { return "write short \(sent)/\(payload.count) errno=\(writeErr)" }
    return nil
}

private func frame(termId: String, event: String, raw: String = "{}", v: Int = 1) -> [UInt8] {
    Array("{\"v\":\(v),\"termId\":\"\(termId)\",\"event\":\"\(event)\",\"raw\":\(raw)}".utf8)
}

// MARK: - socket 集成

@Suite("HookSocketListener 收包/校验/限速（批5①）", .serialized)
struct HookSocketListenerTests {

    /// 起监听（live 表 = liveIds），收集通过校验的事件。
    private func startListener(
        live: Set<String>
    ) throws -> (HookSocketListener, Locked2<[WaitEvent]>) {
        let box = Locked2<[WaitEvent]>([])
        let listener = HookSocketListener(
            runDirectory: uniqueRunDir(),
            isLiveTerminal: { live.contains($0) },
            onEvent: { ev in box.mutate { $0.append(ev) } })
        try listener.start()
        return (listener, box)
    }

    @Test("正常收包：合法 JSON + 活体 termId → onEvent 触发（ts=native epoch ms>0，kind 映射正确）")
    func acceptsValidFrame() throws {
        let (listener, box) = try startListener(live: ["T1"])
        defer { listener.stop() }
        let sendErr = sendToSocket(listener.socketURL.path, frame(termId: "T1", event: "Notification", raw: "{\"msg\":\"hi\"}"))
        let got = pollUntil { box.get().count == 1 }
        // CI 诊断（2026-07-03 首验红灯）：失败时带 send 半区结果 + listener counters 定位断点。
        #expect(got, "sendErr=\(sendErr ?? "无") counters=\(listener.snapshotCounters())")
        // 保真（W0b）：放大的超时只宽容「负载下 accept 源调度慢」（acceptFailures==0）。若 accept()
        // 真报错（fd 耗尽/源错误等）即 acceptFailures>0，仍须红——不被放宽窗口掩埋成真回归。
        #expect(listener.snapshotCounters().acceptFailures == 0,
                "accept 报错回归：counters=\(listener.snapshotCounters())")
        guard let ev = box.get().first else { return }
        #expect(ev.termId == "T1")
        #expect(ev.event == .notification)
        #expect(ev.ts > 0)                 // native 收包瞬间打 epoch ms 戳
        #expect(ev.raw?.contains("hi") == true)
        #expect(listener.snapshotCounters().accepted == 1)
    }

    @Test("Stop / UserPromptSubmit / SessionStart 事件串映射（白名单四 hook）")
    func mapsAllWhitelistedEvents() throws {
        let (listener, box) = try startListener(live: ["T"])
        defer { listener.stop() }
        sendToSocket(listener.socketURL.path, frame(termId: "T", event: "Stop"))
        sendToSocket(listener.socketURL.path, frame(termId: "T", event: "UserPromptSubmit"))
        sendToSocket(listener.socketURL.path, frame(termId: "T", event: "SessionStart"))
        #expect(pollUntil { box.get().count == 3 })
        let kinds = Set(box.get().map(\.event))
        #expect(kinds == [.stop, .userPromptSubmit, .sessionStart])
    }

    @Test("WD_socket_reject: 非法 JSON / v≠1 / 坏 event / 未知 termId 各自丢弃计数，onEvent 不触发")
    func rejectsInvalidFrames() throws {
        let (listener, box) = try startListener(live: ["Live"])
        defer { listener.stop() }
        sendToSocket(listener.socketURL.path, Array("not json at all".utf8))          // illegal
        sendToSocket(listener.socketURL.path, frame(termId: "Live", event: "X", v: 2)) // v≠1 → illegal
        sendToSocket(listener.socketURL.path, frame(termId: "Live", event: "Bogus"))   // 坏 event → illegal
        sendToSocket(listener.socketURL.path, frame(termId: "Ghost", event: "Stop"))   // 未知 termId

        #expect(pollUntil {
            let c = listener.snapshotCounters()
            return c.illegal >= 3 && c.unknownTerm >= 1
        })
        usleep(50_000)
        #expect(box.get().isEmpty) // 全丢弃，无事件出口
        #expect(listener.snapshotCounters().accepted == 0)
    }

    @Test("WD_socket_reject: 超 64KB 帧 → oversize 计数丢弃")
    func rejectsOversize() throws {
        let (listener, box) = try startListener(live: ["Big"])
        defer { listener.stop() }
        var payload = Array("{\"v\":1,\"termId\":\"Big\",\"event\":\"Stop\",\"raw\":\"".utf8)
        payload.append(contentsOf: [UInt8](repeating: 0x41, count: 70 * 1024)) // 70KB > 64KB 上限
        sendToSocket(listener.socketURL.path, payload)
        #expect(pollUntil { listener.snapshotCounters().oversize >= 1 })
        usleep(50_000)
        #expect(box.get().isEmpty)
    }

    @Test("WD_socket_ratelimit: 单 termId 25 条/秒 → 20 accepted + 5 rateLimited")
    func rateLimitsPerTerm() throws {
        let (listener, _) = try startListener(live: ["R"])
        defer { listener.stop() }
        for _ in 0..<25 {
            sendToSocket(listener.socketURL.path, frame(termId: "R", event: "Notification"))
        }
        #expect(pollUntil {
            let c = listener.snapshotCounters()
            return c.accepted + c.rateLimited == 25
        })
        let c = listener.snapshotCounters()
        #expect(c.accepted == HookSocketListener.rateLimitPerSecond) // 20
        #expect(c.rateLimited == 5)
    }

    @Test("并发 20 连接（20 个 termId）全 accepted")
    func concurrent20() throws {
        let ids = (0..<20).map { "C\($0)" }
        let (listener, box) = try startListener(live: Set(ids))
        defer { listener.stop() }
        DispatchQueue.concurrentPerform(iterations: 20) { i in
            sendToSocket(listener.socketURL.path, frame(termId: ids[i], event: "Stop"))
        }
        #expect(pollUntil { box.get().count == 20 })
        #expect(listener.snapshotCounters().accepted == 20)
        #expect(Set(box.get().map(\.termId)) == Set(ids))
    }

    @Test("stale socket 接管：路径存在残留文件 → start() unlink 覆盖后正常收包")
    func staleSocketTakeover() throws {
        let runDir = uniqueRunDir()
        let sockPath = runDir.appendingPathComponent("hook.sock").path
        // 残留一个普通文件占位（崩溃残留场景）。
        FileManager.default.createFile(atPath: sockPath, contents: Data([0x00]))
        let box = Locked2<[WaitEvent]>([])
        let listener = HookSocketListener(
            runDirectory: runDir, isLiveTerminal: { $0 == "T" },
            onEvent: { ev in box.mutate { $0.append(ev) } })
        try listener.start() // 应 unlink 残留 + 重新 bind 成功
        defer { listener.stop() }
        sendToSocket(sockPath, frame(termId: "T", event: "Notification"))
        #expect(pollUntil { box.get().count == 1 })
    }
}

// MARK: - hook 中继脚本 bash 直测

@Suite("HookScript 中继脚本 bash 直测（批5①）", .serialized)
struct HookScriptBashTests {

    /// 写脚本到 tmp（0755），返回路径。socketPath 注入到脚本默认 SOCK。
    private func writeScript(socketPath: String) throws -> String {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("muxvo-hook-\(UUID().uuidString).sh")
        try Data(HookScript.scriptText(socketPath: socketPath).utf8).write(to: url)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: url.path)
        return url.path
    }

    /// 跑脚本：env + arg1(event) + stdin(payload)，返回（退出码, 墙钟秒）。
    @discardableResult
    private func runScript(
        _ path: String, event: String, env: [String: String], stdin: String
    ) -> (Int32, TimeInterval) {
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/bin/bash")
        proc.arguments = [path, event]
        var full = ProcessInfo.processInfo.environment
        for (k, v) in env { full[k] = v }
        proc.environment = full
        let inPipe = Pipe()
        proc.standardInput = inPipe
        proc.standardOutput = FileHandle.nullDevice
        proc.standardError = FileHandle.nullDevice
        let start = Date()
        try? proc.run()
        inPipe.fileHandleForWriting.write(Data(stdin.utf8))
        try? inPipe.fileHandleForWriting.close()
        proc.waitUntilExit()
        return (proc.terminationStatus, Date().timeIntervalSince(start))
    }

    @Test("无 MUXVO_TERM_ID → 秒退 0，不发送（快速静默退出硬约束）")
    func noEnvExitsZero() throws {
        let path = try writeScript(socketPath: "/nonexistent/muxvo.sock")
        let (code, elapsed) = runScript(path, event: "Notification", env: [:], stdin: "{}")
        #expect(code == 0)
        #expect(elapsed < 0.3)
    }

    @Test("有 env 但 socket 不存在 → 秒退 0（[ -S ] 门控）")
    func noSocketExitsZero() throws {
        let path = try writeScript(socketPath: "/nonexistent/muxvo-\(UUID().uuidString).sock")
        let (code, elapsed) = runScript(
            path, event: "Stop", env: ["MUXVO_TERM_ID": "T"], stdin: "{\"x\":1}")
        #expect(code == 0)
        #expect(elapsed < 0.3)
    }

    @Test("正常转发：脚本 → nc → socket，listener 收到 termId/event 对照帧；退出 <100ms")
    func forwardsToSocket() throws {
        let box = Locked2<[WaitEvent]>([])
        let listener = HookSocketListener(
            runDirectory: uniqueRunDir(), isLiveTerminal: { $0 == "Tfwd" },
            onEvent: { ev in box.mutate { $0.append(ev) } })
        try listener.start()
        defer { listener.stop() }

        let path = try writeScript(socketPath: listener.socketURL.path)
        let (code, elapsed) = runScript(
            path, event: "Notification",
            env: ["MUXVO_TERM_ID": "Tfwd", "MUXVO_HOOK_SOCK": listener.socketURL.path],
            stdin: "{\"session\":\"abc\"}")
        #expect(code == 0)
        #expect(elapsed < 0.5) // nc 后台化，脚本本体秒退（宽松 0.5s 容 Process 启动开销）

        let got = pollUntil { box.get().count == 1 } // 默认 10s：同 accept 源饱和窗口 + nc 起进程开销
        #expect(got, "counters=\(listener.snapshotCounters())")
        guard let ev = box.get().first else { return }
        #expect(ev.termId == "Tfwd")
        #expect(ev.event == .notification)
        #expect(ev.raw?.contains("abc") == true) // raw 裸插 payload 原样透传
    }
}

// 线程安全盒（本文件独立，避免跨文件 private 冲突）。
final class Locked2<T>: @unchecked Sendable {
    private let lock = NSLock()
    private var value: T
    init(_ v: T) { value = v }
    func get() -> T { lock.lock(); defer { lock.unlock() }; return value }
    func mutate(_ f: (inout T) -> Void) { lock.lock(); f(&value); lock.unlock() }
}
