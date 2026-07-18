// ApprovalSocketListener 集成测 + 审批中继脚本 bash 直测（interactive-worker.md §2；B2-4）。
//
// 覆盖：PreToolUse 请求→决策回包三态往返、raw 字段解析、PostToolUse fire-and-forget 反推、非法帧丢弃；
// 脚本测：**三态防线「杀监听→必 ask」**（socket 缺失 / 无 termId → stdout permissionDecision ask，绝不 allow）
// + 活体监听端到端（脚本 nc → app 回包 → 脚本 emit permissionDecision）。socket 用 /tmp 短路径（躲 104 上限）。
import Darwin
import Foundation
import Testing

@testable import MuxvoTerm

@Suite("ApprovalSocketListener 收发/解析/反推（B2-4）", .serialized)
struct ApprovalSocketTests {

    // MARK: helpers

    private func pollUntil(timeout: TimeInterval = 20, _ cond: () -> Bool) -> Bool {
        let deadline = Date().addingTimeInterval(timeout * muxvoCITimeoutScale())
        while Date() < deadline {
            if cond() { return true }
            usleep(5_000)
        }
        return cond()
    }

    private func uniqueRunDir() -> URL {
        let dir = URL(fileURLWithPath: "/tmp/mxa-\(UUID().uuidString.prefix(8))", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    private func connectUnix(_ path: String) -> Int32 {
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { return -1 }
        var noSig: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &noSig, socklen_t(MemoryLayout<Int32>.size))
        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)
        let ok = path.withCString { cpath -> Bool in
            withUnsafeMutablePointer(to: &addr.sun_path) { p in
                p.withMemoryRebound(to: CChar.self, capacity: 104) { dst in
                    let n = strlen(cpath); guard n < 104 else { return false }
                    memcpy(dst, cpath, n + 1); return true
                }
            }
        }
        guard ok else { close(fd); return -1 }
        let len = socklen_t(MemoryLayout<sockaddr_un>.size)
        let rc = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(fd, $0, len) }
        }
        guard rc == 0 else { close(fd); return -1 }
        return fd
    }

    /// 双向：连 → 写帧 + \n → 读一行回包 → 返回回包串（nil = 连接/读失败）。
    /// 读超时 20s×CI scale：与 HookSocketTests 同口径——全量并行下 accept DispatchSource 回调受 GCD 池
    /// 饱和拖尾（实测深饥饿 ~11s），短超时会把「源未被调度」误判成断裂。成功即返回，绿路耗时不变。
    private func requestDecision(_ path: String, frame: String, timeout: TimeInterval = 20) -> String? {
        let fd = connectUnix(path)
        guard fd >= 0 else { return nil }
        defer { close(fd) }
        var tv = timeval(tv_sec: Int(timeout * muxvoCITimeoutScale()), tv_usec: 0)
        setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
        let out = Array((frame + "\n").utf8)
        var sent = 0
        out.withUnsafeBytes { raw in
            while sent < raw.count {
                let n = Darwin.write(fd, raw.baseAddress!.advanced(by: sent), raw.count - sent)
                if n <= 0 { break }; sent += n
            }
        }
        guard sent == out.count else { return nil }
        var buf = [UInt8]()
        var chunk = [UInt8](repeating: 0, count: 4096)
        while true {
            let n = read(fd, &chunk, chunk.count)
            if n <= 0 { break }
            buf.append(contentsOf: chunk[0 ..< n])
            if buf.contains(0x0A) { break }
        }
        return buf.isEmpty ? nil : String(decoding: buf, as: UTF8.self)
    }

    /// 单向发帧（PostToolUse fire-and-forget）：连 → 写帧 + \n → 关。
    private func sendFrame(_ path: String, frame: String) {
        let fd = connectUnix(path)
        guard fd >= 0 else { return }
        defer { close(fd) }
        let out = Array((frame + "\n").utf8)
        var sent = 0
        out.withUnsafeBytes { raw in
            while sent < raw.count {
                let n = Darwin.write(fd, raw.baseAddress!.advanced(by: sent), raw.count - sent)
                if n <= 0 { break }; sent += n
            }
        }
    }

    private func startListener(
        reply: ApprovalHookReply
    ) throws -> (ApprovalSocketListener, ApprovalCapture) {
        let cap = ApprovalCapture()
        let listener = ApprovalSocketListener(
            runDirectory: uniqueRunDir(),
            decide: { req in cap.recordRequest(req); return reply },
            observePostTool: { obs in cap.recordPost(obs) })
        try listener.start()
        return (listener, cap)
    }

    private func preFrame(termId: String = "T", tool: String = "Bash",
                          input: String = "{\"command\":\"rm\"}", toolUseId: String = "tu1") -> String {
        "{\"v\":1,\"termId\":\"\(termId)\",\"event\":\"PreToolUse\",\"raw\":{\"tool_name\":\"\(tool)\",\"tool_input\":\(input),\"tool_use_id\":\"\(toolUseId)\"}}"
    }

    // MARK: - 往返三态

    @Test("PreToolUse allow 往返：回包 permissionDecision allow；解出 tool_name/input/tool_use_id")
    func preToolUseAllowRoundtrip() throws {
        let (listener, cap) = try startListener(reply: .allow(reason: nil))
        defer { listener.stop() }
        let resp = requestDecision(listener.socketURL.path, frame: preFrame())
        #expect(resp?.contains("\"permissionDecision\":\"allow\"") == true, "resp=\(resp ?? "nil")")
        #expect(pollUntil { cap.requests().count == 1 })
        let req = cap.requests().first
        #expect(req?.toolName == "Bash")
        #expect(req?.toolUseID == "tu1")
        #expect(req?.toolInputJSON.contains("command") == true)
        #expect(listener.snapshotCounters().preToolUse == 1)
    }

    @Test("PreToolUse deny 往返：回包 permissionDecision deny + reason 透传")
    func preToolUseDenyRoundtrip() throws {
        let (listener, _) = try startListener(reply: .deny(reason: "policy DENY here"))
        defer { listener.stop() }
        let resp = requestDecision(listener.socketURL.path, frame: preFrame())
        #expect(resp?.contains("\"permissionDecision\":\"deny\"") == true)
        #expect(resp?.contains("policy DENY here") == true)
    }

    @Test("PreToolUse ask 往返（升级人类）：回包 permissionDecision ask")
    func preToolUseAskRoundtrip() throws {
        let (listener, _) = try startListener(reply: .ask(reason: "escalated"))
        defer { listener.stop() }
        let resp = requestDecision(listener.socketURL.path, frame: preFrame())
        #expect(resp?.contains("\"permissionDecision\":\"ask\"") == true)
    }

    @Test("PostToolUse fire-and-forget：observePostTool 触发（termId/tool_use_id），无回包")
    func postToolUseObserved() throws {
        let (listener, cap) = try startListener(reply: .allow(reason: nil))
        defer { listener.stop() }
        sendFrame(listener.socketURL.path,
                  frame: "{\"v\":1,\"termId\":\"Tp\",\"event\":\"PostToolUse\",\"raw\":{\"tool_use_id\":\"tux\"}}")
        #expect(pollUntil { cap.posts().count == 1 })
        #expect(cap.posts().first?.termId == "Tp")
        #expect(cap.posts().first?.toolUseID == "tux")
        #expect(listener.snapshotCounters().postToolUse == 1)
    }

    @Test("非法帧（非 JSON / 未知 event / v≠1）→ illegal 计数，不 decide/observe")
    func rejectsIllegalFrames() throws {
        let (listener, cap) = try startListener(reply: .allow(reason: nil))
        defer { listener.stop() }
        sendFrame(listener.socketURL.path, frame: "not json")
        sendFrame(listener.socketURL.path, frame: "{\"v\":2,\"termId\":\"T\",\"event\":\"PreToolUse\",\"raw\":{\"tool_name\":\"X\"}}")
        sendFrame(listener.socketURL.path, frame: "{\"v\":1,\"termId\":\"T\",\"event\":\"Bogus\",\"raw\":{}}")
        #expect(pollUntil { listener.snapshotCounters().illegal >= 3 })
        usleep(50_000)
        #expect(cap.requests().isEmpty)
        #expect(cap.posts().isEmpty)
    }
}

// MARK: - 审批中继脚本 bash 直测

@Suite("ApprovalHookScript 中继脚本 bash 直测（B2-4 三态防线）", .serialized)
struct ApprovalHookScriptBashTests {

    private func uniqueRunDir() -> URL {
        let dir = URL(fileURLWithPath: "/tmp/mxas-\(UUID().uuidString.prefix(8))", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    private func writeScript(socketPath: String) throws -> String {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("muxvo-approval-\(UUID().uuidString).sh")
        try Data(ApprovalHookScript.scriptText(socketPath: socketPath).utf8).write(to: url)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: url.path)
        return url.path
    }

    /// 跑脚本 → 返回 (退出码, stdout, 墙钟秒)。
    @discardableResult
    private func runScript(
        _ path: String, event: String, env: [String: String], stdin: String
    ) -> (Int32, String, TimeInterval) {
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/bin/bash")
        proc.arguments = [path, event]
        var full = ProcessInfo.processInfo.environment
        for (k, v) in env { full[k] = v }
        proc.environment = full
        let inPipe = Pipe(); let outPipe = Pipe()
        proc.standardInput = inPipe
        proc.standardOutput = outPipe
        proc.standardError = FileHandle.nullDevice
        let start = Date()
        try? proc.run()
        inPipe.fileHandleForWriting.write(Data(stdin.utf8))
        try? inPipe.fileHandleForWriting.close()
        let outData = outPipe.fileHandleForReading.readDataToEndOfFile()
        proc.waitUntilExit()
        return (proc.terminationStatus, String(decoding: outData, as: UTF8.self), Date().timeIntervalSince(start))
    }

    @Test("杀监听→必 ask：socket 缺失 → PreToolUse stdout permissionDecision ask，绝不 allow（对抗断言）")
    func absentSocketAsks() throws {
        let path = try writeScript(socketPath: "/tmp/nonexistent-\(UUID().uuidString).sock")
        let (code, out, _) = runScript(
            path, event: "PreToolUse", env: ["MUXVO_TERM_ID": "T"],
            stdin: "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"rm -rf /\"},\"tool_use_id\":\"t1\"}")
        #expect(code == 0)
        #expect(out.contains("\"permissionDecision\":\"ask\""), "out=\(out)")
        #expect(!out.contains("\"permissionDecision\":\"allow\""))
    }

    @Test("无 MUXVO_TERM_ID → PreToolUse ask（三态防线）")
    func noTermIdAsks() throws {
        let path = try writeScript(socketPath: "/tmp/whatever.sock")
        let (code, out, _) = runScript(path, event: "PreToolUse", env: [:],
                                       stdin: "{\"tool_name\":\"Bash\"}")
        #expect(code == 0)
        #expect(out.contains("\"permissionDecision\":\"ask\""))
    }

    @Test("活体监听端到端：脚本 nc → app 回 allow → 脚本 emit permissionDecision allow")
    func liveListenerAllowEndToEnd() throws {
        let cap = ApprovalCapture()
        let listener = ApprovalSocketListener(
            runDirectory: uniqueRunDir(),
            decide: { req in cap.recordRequest(req); return .allow(reason: nil) },
            observePostTool: { _ in })
        try listener.start()
        defer { listener.stop() }

        let path = try writeScript(socketPath: listener.socketURL.path)
        let (code, out, elapsed) = runScript(
            path, event: "PreToolUse",
            env: ["MUXVO_TERM_ID": "Tlive", "MUXVO_APPROVAL_SOCK": listener.socketURL.path],
            stdin: "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"ls\"},\"tool_use_id\":\"tu9\"}")
        #expect(code == 0)
        #expect(out.contains("\"permissionDecision\":\"allow\""), "out=\(out) elapsed=\(elapsed)")
        #expect(cap.requests().first?.termId == "Tlive")
        #expect(cap.requests().first?.toolUseID == "tu9")
    }

    @Test("活体监听端到端：app 回 ask（升级）→ 脚本 emit permissionDecision ask")
    func liveListenerAskEndToEnd() throws {
        let listener = ApprovalSocketListener(
            runDirectory: uniqueRunDir(),
            decide: { _ in .ask(reason: "escalate to human") },
            observePostTool: { _ in })
        try listener.start()
        defer { listener.stop() }
        let path = try writeScript(socketPath: listener.socketURL.path)
        let (code, out, _) = runScript(
            path, event: "PreToolUse",
            env: ["MUXVO_TERM_ID": "Ta", "MUXVO_APPROVAL_SOCK": listener.socketURL.path],
            stdin: "{\"tool_name\":\"Bash\",\"tool_input\":{},\"tool_use_id\":\"z\"}")
        #expect(code == 0)
        #expect(out.contains("\"permissionDecision\":\"ask\""), "out=\(out)")
    }

    @Test("PostToolUse 脚本 fire-and-forget → 监听 observePostTool 触发；脚本秒退无 stdout 决策")
    func postToolScriptFireForget() throws {
        let cap = ApprovalCapture()
        let listener = ApprovalSocketListener(
            runDirectory: uniqueRunDir(),
            decide: { _ in .ask(reason: nil) },
            observePostTool: { obs in cap.recordPost(obs) })
        try listener.start()
        defer { listener.stop() }
        let path = try writeScript(socketPath: listener.socketURL.path)
        let (code, out, elapsed) = runScript(
            path, event: "PostToolUse",
            env: ["MUXVO_TERM_ID": "Tpost", "MUXVO_APPROVAL_SOCK": listener.socketURL.path],
            stdin: "{\"tool_use_id\":\"pt1\",\"tool_response\":{\"ok\":true}}")
        #expect(code == 0)
        #expect(!out.contains("permissionDecision")) // fire-and-forget 无决策 stdout
        #expect(elapsed < 1.0) // nc 后台化秒退
        let got = { () -> Bool in
            let deadline = Date().addingTimeInterval(10)
            while Date() < deadline { if !cap.posts().isEmpty { return true }; usleep(5_000) }
            return !cap.posts().isEmpty
        }()
        #expect(got)
        #expect(cap.posts().first?.toolUseID == "pt1")
    }
}

/// 审批请求/反推捕获盒（线程安全；本文件私有）。
final class ApprovalCapture: @unchecked Sendable {
    private let lock = NSLock()
    private var reqs: [ApprovalRequest] = []
    private var postObs: [PostToolObservation] = []
    func recordRequest(_ r: ApprovalRequest) { lock.lock(); reqs.append(r); lock.unlock() }
    func recordPost(_ o: PostToolObservation) { lock.lock(); postObs.append(o); lock.unlock() }
    func requests() -> [ApprovalRequest] { lock.lock(); defer { lock.unlock() }; return reqs }
    func posts() -> [PostToolObservation] { lock.lock(); defer { lock.unlock() }; return postObs }
}
