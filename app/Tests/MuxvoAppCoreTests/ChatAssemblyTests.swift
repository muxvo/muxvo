// ChatAssembly / ChatQueryEngine / ChatWire 直测（M5 批3）——CHAT_L1_01~08 spec 翻牌（handler roundtrip +
// 推送信封形状）+ 首开异步化计时断言 + keyset 分页 + wire「恰一存在」不变量 + Codex memo。
//
// 命名：八条 spec 翻牌各一个测试，显示名以 ID 前缀起头（如「CHAT_L1_01: ...」），spec-runner 1:1 归属恰
// 1 处 active / owner=swift；支撑测试不带 ID 前缀（不占 1:1 计数）。
import Foundation
import Testing

import MuxvoBridge
import MuxvoStorage
@testable import MuxvoAppCore
@testable import MuxvoChatHistory
import MuxvoTranscript

// MARK: - fixture 工具

private func makeTempDir() throws -> URL {
    let url = FileManager.default.temporaryDirectory
        .appendingPathComponent("muxvo-chat-batch3-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
}

/// 写一个 CC 会话文件（一条 user 消息，带 cwd/uuid/timestamp）。
private func writeCCSession(
    projectsDir: URL, project: String, session: String, cwd: String, text: String,
    uuid: String = "u1", ts: String = "2026-07-06T00:00:00.000Z"
) throws {
    let dir = projectsDir.appendingPathComponent(project, isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let line = #"{"type":"user","uuid":"\#(uuid)","sessionId":"\#(session)","cwd":"\#(cwd)","timestamp":"\#(ts)","message":{"role":"user","content":"\#(text)"}}"#
    try (line + "\n").write(
        to: dir.appendingPathComponent("\(session).jsonl", isDirectory: false),
        atomically: true, encoding: .utf8)
}

/// 写一个 CC 会话文件（多条 user 消息，uuid=u{i}），供 messages 反向分页。
private func writeCCMulti(
    projectsDir: URL, project: String, session: String, cwd: String, count: Int
) throws {
    let dir = projectsDir.appendingPathComponent(project, isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    var lines: [String] = []
    for i in 0..<count {
        let ts = String(format: "2026-07-06T00:00:%02d.000Z", i % 60)
        lines.append(#"{"type":"user","uuid":"u\#(i)","sessionId":"\#(session)","cwd":"\#(cwd)","timestamp":"\#(ts)","message":{"role":"user","content":"msg \#(i)"}}"#)
    }
    try (lines.joined(separator: "\n") + "\n").write(
        to: dir.appendingPathComponent("\(session).jsonl", isDirectory: false),
        atomically: true, encoding: .utf8)
}

/// 在 root 下装配一个 ChatQueryEngine（claudeRoot=root/.claude，chat.db=root/chat.db，镜像=root/chat-history）。
/// `titles` = 自定义标题 store（M5-R1 批2；缺省 nil = 未装配）。
private func makeEngine(
    root: URL, codex: (any ChatCodexQuerying)? = nil, titles: ChatCustomTitlesStore? = nil
) throws -> ChatQueryEngine {
    let claudeRoot = root.appendingPathComponent(".claude", isDirectory: true)
    let ccBase = claudeRoot.appendingPathComponent("projects", isDirectory: true)
    try FileManager.default.createDirectory(at: ccBase, withIntermediateDirectories: true)
    let db = try ChatDatabase.open(at: root.appendingPathComponent("chat.db"))
    let memo = MemoizingCodexSource(source: codex)
    let mirrorRoot = root.appendingPathComponent("chat-history", isDirectory: true)
    let syncStateURL = mirrorRoot.appendingPathComponent("sync-state.json", isDirectory: false)
    let store = ChatStore(
        ccBase: ccBase, mirrorBase: mirrorRoot, codexBase: nil, database: db, codexSource: memo)
    let mirror = ChatMirror(sourceRoot: ccBase, mirrorRoot: mirrorRoot, syncStateURL: syncStateURL)
    return ChatQueryEngine(
        store: store, codexMemo: memo, mirror: mirror, syncStateURL: syncStateURL,
        exportDir: root.appendingPathComponent("exports", isDirectory: true), claudeRoot: claudeRoot,
        titlesStore: titles)
}

private func ccProjectsDir(_ root: URL) -> URL {
    root.appendingPathComponent(".claude/projects", isDirectory: true)
}

private func encodeToObject(_ event: DataEvent) throws -> [String: Any] {
    let data = try JSONEncoder().encode(event)
    return try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
}

/// 门控 Codex 桩：getProjects（prime 的第一步，模拟 buildIndex 36s 全量重读）阻塞在 gate 上直到测试放行。
/// 首开若同步走它必挂在此；memo 屏蔽后前台非阻塞。用于「返回先于后台 prime 完成」的因果断言（非墙钟）。
/// 安全上限 gate 超时 30s 自解：真回归（前台误等 prime）时表现为 handle 迟迟不返回而非把整套挂死。
private struct GatedCodexStub: ChatCodexQuerying {
    let gate: DispatchSemaphore
    func getProjects() -> [ChatProjectInfo] { _ = gate.wait(timeout: .now() + 30); return [] }
    func getSessionsForProject(_ projectHash: String, limit: Int) -> [ChatSessionSummary] { [] }
    func getAllRecentSessions(limit: Int) -> [ChatSessionSummary] { [] }
    func readSession(sessionId: String, limit: Int?) -> [ChatSessionMessage] { [] }
    func search(_ query: String) -> [ChatSearchResult] { [] }
}

/// 固定 Codex 桩：返回一个 codex 项目/会话，供 memo prime 前后对照。
private struct FakeCodexStub: ChatCodexQuerying {
    func getProjects() -> [ChatProjectInfo] {
        [ChatProjectInfo(projectHash: "CX", displayPath: "/cx", displayName: "cx",
                         sessionCount: 1, totalSize: 10, lastActivity: 1_000_000, source: .codex)]
    }
    func getSessionsForProject(_ projectHash: String, limit: Int) -> [ChatSessionSummary] {
        getAllRecentSessions(limit: limit).filter { $0.projectHash == projectHash }
    }
    func getAllRecentSessions(limit: Int) -> [ChatSessionSummary] {
        [ChatSessionSummary(sessionId: "cxs", projectHash: "CX", title: "codex hi",
                            startedAt: "2026-07-06T00:00:00.000Z", lastModified: 1_000_000,
                            fileSize: 10, source: .codex)]
    }
    func readSession(sessionId: String, limit: Int?) -> [ChatSessionMessage] { [] }
    func search(_ query: String) -> [ChatSearchResult] { [] }
}

// MARK: - CHAT_L1_01~06：五 kind handler roundtrip

@Suite("CHAT batch3 handler roundtrip")
struct ChatHandlerRoundtripTests {

    @Test("CHAT_L1_01: chat:get-projects → chat.request projects 分支：{projects: ChatProjectView[], ccDetected}")
    func chatL1_01_projects() throws {
        let root = try makeTempDir(); defer { try? FileManager.default.removeItem(at: root) }
        let engine = try makeEngine(root: root)
        try writeCCSession(projectsDir: ccProjectsDir(root), project: "P", session: "a",
                           cwd: "/Users/t/proj", text: "hello")
        guard case let .projects(projects, ccDetected) = engine.handle(.projects) else {
            Issue.record("expected .projects"); return
        }
        #expect(ccDetected == true)           // ~/.claude（此处 root/.claude）存在
        #expect(projects.count == 1)
        #expect(projects[0].projectHash == "P")
        #expect(projects[0].displayName == "proj")   // cwd 末段
        #expect(projects[0].sessionCount == 1)
    }

    @Test("CHAT_L1_02: chat:get-sessions(projectHash) → sessions 分支：ChatSessionView[]（Ms 后缀/source camel）")
    func chatL1_02_sessions() throws {
        let root = try makeTempDir(); defer { try? FileManager.default.removeItem(at: root) }
        let engine = try makeEngine(root: root)
        try writeCCSession(projectsDir: ccProjectsDir(root), project: "P", session: "a",
                           cwd: "/Users/t/proj", text: "real question")
        _ = engine.warmup()   // 前台 sessions 走 reconcile:false 读 chat.db → 先 warmup 填库
        guard case let .sessions(sessions, nextCursor) = engine.handle(.sessions(projectHash: "P", cursor: nil)) else {
            Issue.record("expected .sessions"); return
        }
        #expect(sessions.count == 1)
        #expect(sessions[0].sessionId == "a")
        #expect(sessions[0].title == "real question")
        #expect(sessions[0].source == .claudeCode)          // camel（协议）
        #expect(sessions[0].startedAtMs == 1_783_296_000_000) // 2026-07-06T00:00:00Z → ms
        #expect(nextCursor == nil)                            // 仅 1 条，不足一页 → 到头
    }

    @Test("CHAT_L1_03: chat:get-sessions(__all__) → 全项目最近会话（跨项目聚合）")
    func chatL1_03_allSessions() throws {
        let root = try makeTempDir(); defer { try? FileManager.default.removeItem(at: root) }
        let engine = try makeEngine(root: root)
        try writeCCSession(projectsDir: ccProjectsDir(root), project: "P1", session: "a",
                           cwd: "/p1", text: "q1", uuid: "u1", ts: "2026-07-06T00:00:01.000Z")
        try writeCCSession(projectsDir: ccProjectsDir(root), project: "P2", session: "b",
                           cwd: "/p2", text: "q2", uuid: "u2", ts: "2026-07-06T00:00:02.000Z")
        _ = engine.warmup()
        guard case let .sessions(sessions, _) = engine.handle(.sessions(projectHash: "__all__", cursor: nil)) else {
            Issue.record("expected .sessions"); return
        }
        #expect(Set(sessions.map(\.sessionId)) == ["a", "b"])
    }

    @Test("问题5：空 user title 会话在 live sessionsPage 可见——有 assistant → wire title=fallback；双空 → wire title=''")
    func emptyTitleSessionsVisibleWithFallback() throws {
        let root = try makeTempDir(); defer { try? FileManager.default.removeItem(at: root) }
        let engine = try makeEngine(root: root)
        let dir = ccProjectsDir(root).appendingPathComponent("P", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        // 会话 fb：仅内部 user（system-reminder → 空 title）+ assistant text → titleFallback = assistant 文本。
        let fb = [
            #"{"type":"user","sessionId":"fb","cwd":"/p","timestamp":"2026-07-06T00:00:02.000Z","message":{"role":"user","content":"<system-reminder>x</system-reminder>"}}"#,
            #"{"type":"assistant","sessionId":"fb","timestamp":"2026-07-06T00:00:03.000Z","message":{"role":"assistant","content":[{"type":"text","text":"助手兜底标题"}]}}"#,
        ]
        try (fb.joined(separator: "\n") + "\n").write(
            to: dir.appendingPathComponent("fb.jsonl"), atomically: true, encoding: .utf8)
        // 会话 empty：仅内部 user、无 assistant/summary → title 与 fallback 双空 → wire title=''。
        let empty = [
            #"{"type":"user","sessionId":"empty","cwd":"/p","timestamp":"2026-07-06T00:00:01.000Z","message":{"role":"user","content":"<system-reminder>y</system-reminder>"}}"#,
        ]
        try (empty.joined(separator: "\n") + "\n").write(
            to: dir.appendingPathComponent("empty.jsonl"), atomically: true, encoding: .utf8)

        _ = engine.warmup()
        guard case let .sessions(sessions, _) = engine.handle(.sessions(projectHash: "P", cursor: nil)) else {
            Issue.record("expected .sessions"); return
        }
        // 修前两会话 title 空被 ChatStore 丢弃 → 不出现；修后 includeUntitled:true 保留。
        let byId = Dictionary(uniqueKeysWithValues: sessions.map { ($0.sessionId, $0) })
        #expect(byId["fb"]?.title == "助手兜底标题")   // assistant fallback 生效
        #expect(byId["empty"]?.title == "")            // 双空 → wire title=''（web 端 convert 再兜 '(无标题)'）
    }

    @Test("CHAT_L1_04: chat:get-session → messages 分支：ChatMessageView[]（role/tsMs/text 恰一）")
    func chatL1_04_session() throws {
        let root = try makeTempDir(); defer { try? FileManager.default.removeItem(at: root) }
        let engine = try makeEngine(root: root)
        try writeCCSession(projectsDir: ccProjectsDir(root), project: "P", session: "S",
                           cwd: "/Users/t/proj", text: "the question")
        guard case let .messages(messages, prevCursor) = engine.handle(
            .session(projectHash: "P", sessionId: "S", before: nil, all: nil)) else {
            Issue.record("expected .messages"); return
        }
        #expect(messages.count == 1)
        #expect(messages[0].role == .user)
        #expect(messages[0].text == "the question")   // string content → text 置
        #expect(messages[0].blocks == nil)             // 恰一存在
        #expect(messages[0].tsMs == 1_783_296_000_000)
        #expect(prevCursor == nil)
    }

    @Test("CHAT_L1_05: chat:search → search 分支：ChatSearchHit[]（snippet 保真/tsMs）")
    func chatL1_05_search() throws {
        let root = try makeTempDir(); defer { try? FileManager.default.removeItem(at: root) }
        let engine = try makeEngine(root: root)
        try writeCCSession(projectsDir: ccProjectsDir(root), project: "P", session: "S",
                           cwd: "/x", text: "请帮我修复终端渲染问题")
        _ = engine.warmup()   // search 读 chat_search_lines → 先 warmup 填库
        guard case let .search(results) = engine.handle(.search(query: "终端渲染")) else {
            Issue.record("expected .search"); return
        }
        #expect(results.count == 1)
        #expect(results[0].sessionId == "S")
        #expect(results[0].projectHash == "P")                  // fixture 项目目录名
        #expect(results[0].tsMs == 1_783_296_000_000)           // 消息 ts 2026-07-06T00:00:00Z → ms
        #expect(results[0].snippet.contains("终端渲染"))
    }

    @Test("CHAT_L1_06: chat:export → exported{outputPath}：markdown/json 双格式落盘")
    func chatL1_06_export() throws {
        let root = try makeTempDir(); defer { try? FileManager.default.removeItem(at: root) }
        let engine = try makeEngine(root: root)
        try writeCCSession(projectsDir: ccProjectsDir(root), project: "P", session: "S",
                           cwd: "/x", text: "hello export")
        // markdown
        guard case let .exported(mdPath) = engine.handle(
            .export(projectHash: "P", sessionId: "S", format: .markdown)) else {
            Issue.record("expected .exported(md)"); return
        }
        #expect(mdPath.hasSuffix("/exports/S.md"))
        let md = try String(contentsOfFile: mdPath, encoding: .utf8)
        #expect(md.hasPrefix("# S"))
        #expect(md.contains("## user"))
        #expect(md.contains("hello export"))
        // json
        guard case let .exported(jsonPath) = engine.handle(
            .export(projectHash: "P", sessionId: "S", format: .json)) else {
            Issue.record("expected .exported(json)"); return
        }
        #expect(jsonPath.hasSuffix("/exports/S.json"))
        let jsonData = try Data(contentsOf: URL(fileURLWithPath: jsonPath))
        let arr = try #require(JSONSerialization.jsonObject(with: jsonData) as? [[String: Any]])
        #expect(arr.first?["content"] as? String == "hello export")
        #expect(arr.first?["type"] as? String == "user")
    }
}

// MARK: - CHAT_L1_07/08：data.event 推送信封形状

@Suite("CHAT batch3 push shape")
struct ChatPushShapeTests {

    @Test("CHAT_L1_07: chat:session-update 推送格式 → data.event chatSessionUpdate{projectHash, sessionId}")
    func chatL1_07_sessionUpdate() throws {
        // 信封形状（协议 push 面）。
        let obj = try encodeToObject(.chatSessionUpdate(projectHash: "P", sessionId: "S"))
        #expect(obj["kind"] as? String == "chatSessionUpdate")
        #expect(obj["projectHash"] as? String == "P")
        #expect(obj["sessionId"] as? String == "S")
        // 内容来源：watcher 从 CC .jsonl 路径派生 (projectHash, sessionId)。
        let root = URL(fileURLWithPath: "/home/.claude/projects", isDirectory: true)
        let change = ChatSourceWatcher.ccChange(
            path: "/home/.claude/projects/P/S.jsonl", ccProjectsRoot: root)
        #expect(change == ChatSourceChange(projectHash: "P", sessionId: "S"))
        // 目录级/更深路径不产信号。
        #expect(ChatSourceWatcher.ccChange(path: "/home/.claude/projects/P", ccProjectsRoot: root) == nil)
    }

    @Test("CHAT_L1_08: chat:sync-status 推送格式 → data.event chatSyncStatus{status}（首访触发后台 warmup 翻牌）")
    @MainActor func chatL1_08_syncStatus() async throws {
        // 信封形状。
        let obj = try encodeToObject(.chatSyncStatus(status: .idle, lastSyncMs: 123, synced: nil, total: nil))
        #expect(obj["kind"] as? String == "chatSyncStatus")
        #expect(obj["status"] as? String == "idle")
        #expect(obj["lastSyncMs"] as? Int == 123)
        // 集成：ChatAssembly 首访即刻推 syncing（warmup 起点，同步在 ensureWarmupStarted 内）。
        let root = try makeTempDir(); defer { try? FileManager.default.removeItem(at: root) }
        let engine = try makeEngine(root: root)
        let assembly = ChatAssembly(
            engine: engine, ccProjectsRoot: ccProjectsDir(root), codexRoot: nil)
        var captured: [DataEvent] = []
        assembly.onPushEvent = { captured.append($0) }
        _ = await assembly.handle(.projects)
        let sawSyncing = captured.contains {
            if case .chatSyncStatus(.syncing, _, _, _) = $0 { return true } else { return false }
        }
        #expect(sawSyncing)
    }
}

// MARK: - 支撑：首开异步化计时 / 分页 / wire 不变量 / Codex memo / noCC

@Suite("CHAT batch3 首开异步化 + 分页 + wire")
struct ChatBatch3SupportTests {

    @Test("首开：projects 冷库不阻塞在 Codex prime 上（返回先于后台 prime 完成——因果断言，非墙钟）")
    @MainActor func firstOpenProjectsDoesNotBlockOnCodexPrime() async throws {
        let root = try makeTempDir(); defer { try? FileManager.default.removeItem(at: root) }
        // gate 卡住 Codex prime 的 getProjects：前台若同步等 prime 必挂死；memo 屏蔽后前台非阻塞。
        let gate = DispatchSemaphore(value: 0)
        defer { gate.signal() }   // 放行后台 prime 收尾（best-effort），先于上面 temp 目录移除
        let engine = try makeEngine(root: root, codex: GatedCodexStub(gate: gate))
        try writeCCSession(projectsDir: ccProjectsDir(root), project: "P", session: "a",
                           cwd: "/p", text: "hi")
        let assembly = ChatAssembly(
            engine: engine, ccProjectsRoot: ccProjectsDir(root), codexRoot: nil)
        let resp = await assembly.handle(.projects)
        // 因果断言（与墙钟无关）：handle 返回时后台 prime 仍未完成（getProjects 被 gate 卡住）→
        // 前台没等 prime。无论机器多慢/并发多高，prime 只在 gate 放行后才 isPrimed，故此处恒 false。
        #expect(!engine.codexMemo.isPrimed)
        guard case let .projects(projects, _) = resp else { Issue.record("expected .projects"); return }
        #expect(projects.contains { $0.projectHash == "P" })   // CC 目录扫描即刻可见
    }

    @Test("Codex memo：冷库 projects 不含 Codex；prime 后含")
    func codexMemoPrimeGate() throws {
        let root = try makeTempDir(); defer { try? FileManager.default.removeItem(at: root) }
        let engine = try makeEngine(root: root, codex: FakeCodexStub())
        // 冷（未 prime）：memo 读回空 → projects 无 CX。
        guard case let .projects(before, _) = engine.handle(.projects) else {
            Issue.record("expected .projects"); return
        }
        #expect(!before.contains { $0.projectHash == "CX" })
        // prime 后：projects 含 CX。
        engine.codexMemo.prime()
        guard case let .projects(after, _) = engine.handle(.projects) else {
            Issue.record("expected .projects"); return
        }
        #expect(after.contains { $0.projectHash == "CX" })
    }

    @Test("sessions keyset 分页：51 会话 → 首页 50 + nextCursor；游标续取 1 + nextCursor 缺席（到头）")
    func sessionsKeysetPagination() throws {
        let root = try makeTempDir(); defer { try? FileManager.default.removeItem(at: root) }
        let engine = try makeEngine(root: root)
        for i in 0..<51 {
            let ts = String(format: "2026-07-06T00:%02d:00.000Z", i)
            try writeCCSession(projectsDir: ccProjectsDir(root), project: "P", session: "s\(i)",
                               cwd: "/p", text: "q\(i)", uuid: "u\(i)", ts: ts)
        }
        _ = engine.warmup()
        guard case let .sessions(page1, cursor1) = engine.handle(.sessions(projectHash: "P", cursor: nil)) else {
            Issue.record("expected .sessions p1"); return
        }
        #expect(page1.count == 50)
        #expect(cursor1 != nil)
        guard case let .sessions(page2, cursor2) = engine.handle(.sessions(projectHash: "P", cursor: cursor1)) else {
            Issue.record("expected .sessions p2"); return
        }
        #expect(page2.count == 1)
        #expect(cursor2 == nil)   // 到头
        // 两页无重叠、无遗漏。
        let all = Set(page1.map(\.sessionId)).union(page2.map(\.sessionId))
        #expect(all.count == 51)
    }

    @Test("messages 反向分页：51 消息 → 首页最近 50 + prevCursor；before 续取 1 + prevCursor 缺席（到头）")
    func messagesReversePagination() throws {
        let root = try makeTempDir(); defer { try? FileManager.default.removeItem(at: root) }
        let engine = try makeEngine(root: root)
        try writeCCMulti(projectsDir: ccProjectsDir(root), project: "P", session: "S", cwd: "/x", count: 51)
        guard case let .messages(page1, prev1) = engine.handle(
            .session(projectHash: "P", sessionId: "S", before: nil, all: nil)) else {
            Issue.record("expected .messages p1"); return
        }
        #expect(page1.count == 50)
        #expect(page1.last?.uuid == "u50")   // 最近一条
        #expect(prev1 == "u1")               // 本页最旧（u1），仍有更早（u0）
        guard case let .messages(page2, prev2) = engine.handle(
            .session(projectHash: "P", sessionId: "S", before: prev1, all: nil)) else {
            Issue.record("expected .messages p2"); return
        }
        #expect(page2.count == 1)
        #expect(page2.first?.uuid == "u0")
        #expect(prev2 == nil)                // 到头
    }

    @Test("noCC：claudeRoot 不存在 → ccDetected=false（§7.6 判据）")
    func noCCDetection() throws {
        let root = try makeTempDir(); defer { try? FileManager.default.removeItem(at: root) }
        // makeEngine 会建 ccBase；此处删掉 .claude 制造 noCC。
        let engine = try makeEngine(root: root)
        try FileManager.default.removeItem(at: root.appendingPathComponent(".claude", isDirectory: true))
        guard case let .projects(projects, ccDetected) = engine.handle(.projects) else {
            Issue.record("expected .projects"); return
        }
        #expect(ccDetected == false)
        #expect(projects.isEmpty)
    }

    @Test("wire「恰一存在」：string content → text 置 blocks nil；block content → blocks 置 text nil")
    func wireTextXorBlocksInvariant() {
        let strMsg = ChatSessionMessage(
            uuid: "u", type: .user, sessionId: "S", cwd: "", timestamp: "2026-07-06T00:00:00.000Z",
            content: .text("hi"))
        let sv = ChatWire.messageView(strMsg)
        #expect(sv.text == "hi")
        #expect(sv.blocks == nil)

        let block = MuxvoChatHistory.ChatContentBlock(type: "text", text: "body")
        let blkMsg = ChatSessionMessage(
            uuid: "u2", type: .assistant, sessionId: "S", cwd: "", timestamp: "2026-07-06T00:00:00.000Z",
            content: .blocks([block]))
        let bv = ChatWire.messageView(blkMsg)
        #expect(bv.text == nil)
        #expect(bv.blocks?.count == 1)
        if case .text(let t) = bv.blocks?.first { #expect(t == "body") } else { Issue.record("expected .text block") }
    }

    @Test("wire tool_use 块：input JSONValue → inputJson 原文串（sortedKeys 确定性）")
    func wireToolUseInputJson() {
        let input = JSONValue.object(["b": .int(2), "a": .string("x")])
        let block = MuxvoChatHistory.ChatContentBlock(type: "tool_use", name: "Bash", input: input)
        let wire = ChatWire.contentBlock(block)
        guard case let .toolUse(name, inputJson) = wire else { Issue.record("expected .toolUse"); return }
        #expect(name == "Bash")
        #expect(inputJson == #"{"a":"x","b":2}"#)   // sortedKeys
    }

    @Test("wire thinking 块：{signature,thinking} → .thinking 只提 thinking 正文（signature 丢弃，dogfood-r4 问题4）")
    func wireThinkingBlockExtractsBody() {
        let block = MuxvoChatHistory.ChatContentBlock(raw: .object([
            "type": .string("thinking"),
            "signature": .string("EncRyptedSig=="),
            "thinking": .string("先分析再动手的推理正文"),
        ]))
        guard case let .thinking(text) = ChatWire.contentBlock(block) else {
            Issue.record("expected .thinking"); return
        }
        #expect(text == "先分析再动手的推理正文")   // 只取 thinking 正文，signature 不外泄
    }

    @Test("wire 未知块（无 text）：不再裸 dump 进 text，改 .unknown{blockType, rawJson}（rawJson 可反解析，问题4 根因2）")
    func wireUnknownBlockNotDumpedIntoText() throws {
        // redacted_thinking：无可读正文 → 自然落 unknown（不再当 text 渲染整块 JSON）。
        let block = MuxvoChatHistory.ChatContentBlock(raw: .object([
            "type": .string("redacted_thinking"),
            "data": .string("EncryptedBlob"),
        ]))
        guard case let .unknown(blockType, rawJson) = ChatWire.contentBlock(block) else {
            Issue.record("expected .unknown"); return
        }
        #expect(blockType == "redacted_thinking")
        // rawJson 原文不丢 + 合法 JSON（下游可反解析）。
        let parsed = try JSONSerialization.jsonObject(with: Data(rawJson.utf8)) as? [String: Any]
        #expect(parsed?["type"] as? String == "redacted_thinking")
        #expect(parsed?["data"] as? String == "EncryptedBlob")
    }

    @Test("wire 未知块（有 text）：仍走 .text（现行为回归护栏，不误落 unknown）")
    func wireUnknownBlockWithTextStillText() {
        let block = MuxvoChatHistory.ChatContentBlock(raw: .object([
            "type": .string("some_future_type"),
            "text": .string("未来类型但带可读 text"),
        ]))
        guard case let .text(t) = ChatWire.contentBlock(block) else {
            Issue.record("expected .text"); return
        }
        #expect(t == "未来类型但带可读 text")
    }

    @Test("wire jsonString：nil / 缺 input 恒回合法 JSON（\"null\"），下游 JSON.parse 不抛（MINOR-1）")
    func wireJsonStringLegalOnNil() throws {
        // nil 分支 → "null"（合法 JSON 字面量，可反解析为 NSNull；空串曾非法致 web JSON.parse 抛）。
        let nilOut = ChatWire.jsonString(nil)
        #expect(nilOut == "null")
        let parsedNil = try JSONSerialization.jsonObject(with: Data(nilOut.utf8), options: [.fragmentsAllowed])
        #expect(parsedNil is NSNull)
        // 正常分支 → 合法 JSON（可反解析）。
        let objOut = ChatWire.jsonString(.object(["a": .int(1)]))
        let parsedObj = try JSONSerialization.jsonObject(with: Data(objOut.utf8), options: [.fragmentsAllowed])
        #expect((parsedObj as? [String: Any])?["a"] as? Int == 1)
        // tool_use 缺 input（b.input nil）→ inputJson "null"（非空串），批4 JSON.parse(inputJson) 不抛。
        let block = MuxvoChatHistory.ChatContentBlock(type: "tool_use", name: "Bash", input: nil)
        guard case let .toolUse(_, inputJson) = ChatWire.contentBlock(block) else {
            Issue.record("expected .toolUse"); return
        }
        #expect(inputJson == "null")
        _ = try JSONSerialization.jsonObject(with: Data(inputJson.utf8), options: [.fragmentsAllowed])
    }

    @Test("sessions 游标畸形/被篡改 → rejected(BAD_CURSOR)，不静默重发首页（MINOR-3）")
    func sessionsMalformedCursorRejected() throws {
        let root = try makeTempDir(); defer { try? FileManager.default.removeItem(at: root) }
        let engine = try makeEngine(root: root)
        try writeCCSession(projectsDir: ccProjectsDir(root), project: "P", session: "a", cwd: "/p", text: "q")
        _ = engine.warmup()
        // 无冒号 / lm 非整数 / sessionId 空——三畸形均 rejected。
        for bad in ["garbage", "abc:sid", "1000:"] {
            guard case let .rejected(code, _) = engine.handle(.sessions(projectHash: "P", cursor: bad)) else {
                Issue.record("expected rejected for cursor=\(bad)"); return
            }
            #expect(code == "BAD_CURSOR")
        }
        // 回归护栏：nil cursor 仍正常返回首页（非畸形）。
        guard case .sessions = engine.handle(.sessions(projectHash: "P", cursor: nil)) else {
            Issue.record("expected .sessions for nil cursor"); return
        }
    }

    @Test("sessions keyset：51 会话刻意同一 mtime（tie）跨页无丢无重——排序/游标同键（MINOR-2）")
    func sessionsKeysetSameMtimeTie() throws {
        let root = try makeTempDir(); defer { try? FileManager.default.removeItem(at: root) }
        let engine = try makeEngine(root: root)
        let fixed = Date(timeIntervalSince1970: 1_783_296_000)   // 整秒 → 全部 tie 到同一整数 ms
        for i in 0..<51 {
            let sid = String(format: "s%02d", i)
            try writeCCSession(projectsDir: ccProjectsDir(root), project: "P", session: sid,
                               cwd: "/p", text: "q\(i)", uuid: "u\(i)")
            let file = ccProjectsDir(root).appendingPathComponent("P/\(sid).jsonl", isDirectory: false)
            try FileManager.default.setAttributes([.modificationDate: fixed], ofItemAtPath: file.path)
        }
        _ = engine.warmup()
        guard case let .sessions(page1, cursor1) = engine.handle(.sessions(projectHash: "P", cursor: nil)) else {
            Issue.record("expected p1"); return
        }
        #expect(page1.count == 50)
        #expect(cursor1 != nil)
        guard case let .sessions(page2, cursor2) = engine.handle(.sessions(projectHash: "P", cursor: cursor1)) else {
            Issue.record("expected p2"); return
        }
        #expect(page2.count == 1)
        #expect(cursor2 == nil)
        // 全部 tie 时纯按 sessionId 次键分页——无丢无重（游标同键杜绝页边界静默丢会话）。
        let all = Set(page1.map(\.sessionId)).union(page2.map(\.sessionId))
        #expect(all.count == 51)
    }

    @Test("export：文件名/H1 沿用会话标题（REQ-CHAT_SYNC-014/015；MINOR-5）")
    func exportTitleFromSession() throws {
        let root = try makeTempDir(); defer { try? FileManager.default.removeItem(at: root) }
        let engine = try makeEngine(root: root)
        try writeCCSession(projectsDir: ccProjectsDir(root), project: "P", session: "S",
                           cwd: "/x", text: "hello export")
        _ = engine.warmup()   // 填 chat.db → title 反查命中 "hello export"（首消息派生）
        guard case let .exported(mdPath) = engine.handle(
            .export(projectHash: "P", sessionId: "S", format: .markdown)) else {
            Issue.record("expected .exported"); return
        }
        #expect(mdPath.hasSuffix("/exports/hello export.md"))   // 文件名 = title（非 sessionId）
        let md = try String(contentsOfFile: mdPath, encoding: .utf8)
        #expect(md.hasPrefix("# hello export"))                 // H1 = title
    }

    @Test("sessions(projectHash: nil)：协议缺席 = __all__ 聚合（NIT-3 未直测路径）")
    func sessionsNilProjectHashAggregates() throws {
        let root = try makeTempDir(); defer { try? FileManager.default.removeItem(at: root) }
        let engine = try makeEngine(root: root)
        try writeCCSession(projectsDir: ccProjectsDir(root), project: "P1", session: "a",
                           cwd: "/p1", text: "q1", uuid: "u1", ts: "2026-07-06T00:00:01.000Z")
        try writeCCSession(projectsDir: ccProjectsDir(root), project: "P2", session: "b",
                           cwd: "/p2", text: "q2", uuid: "u2", ts: "2026-07-06T00:00:02.000Z")
        _ = engine.warmup()
        guard case let .sessions(sessions, _) = engine.handle(.sessions(projectHash: nil, cursor: nil)) else {
            Issue.record("expected .sessions"); return
        }
        #expect(Set(sessions.map(\.sessionId)) == ["a", "b"])
    }

    @Test("watcher per-key 去抖：两 key 各自独立 flush，非全局批窗合并（§6.1；MINOR-4）")
    func watcherPerKeyDebounce() {
        let ccRoot = URL(fileURLWithPath: "/home/.claude/projects", isDirectory: true)
        let spy = OnChangeSpy()
        // debounce 设极长：真 timer 不在测试内触发，仅手动 flushCC 驱动确定性。
        let w = ChatSourceWatcher(
            ccProjectsRoot: ccRoot, codexRoot: URL(fileURLWithPath: "/home/.codex"),
            debounceMs: 3_600_000
        ) { changes, codex in spy.record(changes, codex) }
        w.ingest(paths: [
            "/home/.claude/projects/P/A.jsonl",
            "/home/.claude/projects/P/B.jsonl",
        ])
        #expect(spy.calls.isEmpty)   // trailing：未到期不 flush
        let a = ChatSourceChange(projectHash: "P", sessionId: "A")
        let b = ChatSourceChange(projectHash: "P", sessionId: "B")
        w.flushCC(a)
        w.flushCC(b)
        // per-key：两次独立回调（各携单 key），非全局合并成一次 [A,B]。
        #expect(spy.calls.count == 2)
        #expect(spy.calls[0].changes == [a])
        #expect(spy.calls[0].codex == false)
        #expect(spy.calls[1].changes == [b])
        // 幂等：重复 flush 无操作。
        w.flushCC(a)
        #expect(spy.calls.count == 2)
    }
}

/// per-key 去抖测试用回调收集器（flushCC 同步单线程驱动，@unchecked 安全）。
private final class OnChangeSpy: @unchecked Sendable {
    struct Call { let changes: [ChatSourceChange]; let codex: Bool }
    var calls: [Call] = []
    func record(_ changes: [ChatSourceChange], _ codex: Bool) {
        calls.append(Call(changes: changes, codex: codex))
    }
}

// MARK: - M5-R1 批2 装配收口：delete / setTitle / session.all / customTitle / 进度帧 / 归档开关 / export reveal

/// Codex 桩：只识一个 sessionId（readSession 命中返回一条消息）——delete 的 UNSUPPORTED_SOURCE 判定用。
private struct DeletableCodexStub: ChatCodexQuerying {
    let sid: String
    func getProjects() -> [ChatProjectInfo] { [] }
    func getSessionsForProject(_ projectHash: String, limit: Int) -> [ChatSessionSummary] { [] }
    func getAllRecentSessions(limit: Int) -> [ChatSessionSummary] { [] }
    func readSession(sessionId: String, limit: Int?) -> [ChatSessionMessage] {
        guard sessionId == sid else { return [] }
        return [ChatSessionMessage(
            uuid: "cx-u1", type: .user, sessionId: sid, cwd: "/cx",
            timestamp: "2026-07-06T00:00:00.000Z", content: .text("codex msg"))]
    }
    func search(_ query: String) -> [ChatSearchResult] { [] }
}

/// 可翻转布尔盒（archiveEnabled 注入；主线程读写 + 防御锁）。
private final class FlagBox: @unchecked Sendable {
    private let lock = NSLock()
    private var v: Bool
    init(_ v: Bool) { self.v = v }
    var value: Bool {
        get { lock.withLock { v } }
        set { lock.withLock { v = newValue } }
    }
}

/// chatSyncStatus 帧匹配（status + synced/total 全等）。
private func isSyncFrame(
    _ e: DataEvent, _ status: MuxvoBridge.ChatSyncStatus, synced: Int?, total: Int?
) -> Bool {
    guard case let .chatSyncStatus(s, _, sy, to) = e else { return false }
    return s == status && sy == synced && to == total
}

@MainActor
private func pollUntil(timeout: TimeInterval = 10, _ cond: () -> Bool) async {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
        if cond() { return }
        try? await Task.sleep(nanoseconds: 20_000_000)
    }
}

@Suite("CHAT batch2 delete/setTitle/session.all/customTitle")
struct ChatBatch2MutationTests {
    private let sid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"

    @Test("delete：CC 源（父+worktree 子目录）+ 镜像文件硬删 + DB 行消失 + 自定义标题清除")
    func deleteRemovesCCFilesDBRowAndTitle() throws {
        let root = try makeTempDir(); defer { try? FileManager.default.removeItem(at: root) }
        let titles = ChatCustomTitlesStore(root: root)
        let engine = try makeEngine(root: root, titles: titles)
        try writeCCSession(projectsDir: ccProjectsDir(root), project: "P", session: sid,
                           cwd: "/p", text: "q1")
        try writeCCSession(projectsDir: ccProjectsDir(root), project: "P--worktrees-wt-1", session: sid,
                           cwd: "/p/wt", text: "q2", uuid: "u2")
        _ = engine.warmup()   // 镜像两份 + chat.db 行
        titles.set(sid, title: "自定义标题")
        let files = [
            ccProjectsDir(root).appendingPathComponent("P/\(sid).jsonl"),
            ccProjectsDir(root).appendingPathComponent("P--worktrees-wt-1/\(sid).jsonl"),
            root.appendingPathComponent("chat-history/P/\(sid).jsonl"),
            root.appendingPathComponent("chat-history/P--worktrees-wt-1/\(sid).jsonl"),
        ]
        for f in files {
            #expect(FileManager.default.fileExists(atPath: f.path), "前置：\(f.path) 应在")
        }
        guard case let .deleted(deletedSid) = engine.handle(.delete(projectHash: "P", sessionId: sid)) else {
            Issue.record("expected .deleted"); return
        }
        #expect(deletedSid == sid)
        for f in files {
            #expect(!FileManager.default.fileExists(atPath: f.path), "双侧硬删：\(f.path) 应消失")
        }
        // DB 行消失（再删返回 false = 已无行的幂等锚；CASCADE 清 search lines 由 ChatDatabaseDeleteTests 锚）。
        #expect(try engine.store.database.deleteSession(sessionId: sid) == false)
        #expect(titles.get(sid) == nil)
    }

    @Test("delete：assembly 成功响应后推 chatSessionUpdate（复用既有失效通道）")
    @MainActor func deletePushesSessionUpdate() async throws {
        let root = try makeTempDir(); defer { try? FileManager.default.removeItem(at: root) }
        let engine = try makeEngine(root: root)
        try writeCCSession(projectsDir: ccProjectsDir(root), project: "P", session: sid,
                           cwd: "/p", text: "q")
        let assembly = ChatAssembly(engine: engine, ccProjectsRoot: ccProjectsDir(root), codexRoot: nil)
        var captured: [DataEvent] = []
        assembly.onPushEvent = { captured.append($0) }
        guard case .deleted = await assembly.handle(.delete(projectHash: "P", sessionId: sid)) else {
            Issue.record("expected .deleted"); return
        }
        let sid = self.sid
        #expect(captured.contains {
            if case let .chatSessionUpdate(p, s) = $0 { return p == "P" && s == sid }
            return false
        })
    }

    @Test("delete：source=codex → rejected(UNSUPPORTED_SOURCE)（本批不碰 ~/.codex，用户拍板）")
    func deleteCodexRejected() throws {
        let root = try makeTempDir(); defer { try? FileManager.default.removeItem(at: root) }
        let codexSid = "cccccccc-1111-2222-3333-444444444444"
        let engine = try makeEngine(root: root, codex: DeletableCodexStub(sid: codexSid))
        guard case let .rejected(code, _) = engine.handle(
            .delete(projectHash: "CX", sessionId: codexSid)) else {
            Issue.record("expected .rejected"); return
        }
        #expect(code == "UNSUPPORTED_SOURCE")
    }

    @Test("delete：两侧都不识 → rejected(NOT_FOUND)；非法路径分量（..、含 /）同响应面（防注入）")
    func deleteNotFoundAndUnsafeComponents() throws {
        let root = try makeTempDir(); defer { try? FileManager.default.removeItem(at: root) }
        let engine = try makeEngine(root: root)
        for (p, s) in [("P", "99999999-9999-9999-9999-999999999999"), ("..", sid), ("P", "../escape")] {
            guard case let .rejected(code, _) = engine.handle(.delete(projectHash: p, sessionId: s)) else {
                Issue.record("expected .rejected for (\(p), \(s))"); return
            }
            #expect(code == "NOT_FOUND", "(\(p), \(s))")
        }
    }

    @Test("setTitle：写 titlesStore → .ok；空串/空白/缺席 = 清除")
    func setTitleRoundtripAndClear() throws {
        let root = try makeTempDir(); defer { try? FileManager.default.removeItem(at: root) }
        let titles = ChatCustomTitlesStore(root: root)
        let engine = try makeEngine(root: root, titles: titles)
        guard case .ok = engine.handle(.setTitle(sessionId: sid, title: "我的标题")) else {
            Issue.record("expected .ok"); return
        }
        #expect(titles.get(sid) == "我的标题")
        guard case .ok = engine.handle(.setTitle(sessionId: sid, title: nil)) else {
            Issue.record("expected .ok (clear nil)"); return
        }
        #expect(titles.get(sid) == nil)
        titles.set(sid, title: "again")
        guard case .ok = engine.handle(.setTitle(sessionId: sid, title: "   ")) else {
            Issue.record("expected .ok (clear blank)"); return
        }
        #expect(titles.get(sid) == nil)
    }

    @Test("setTitle：titlesStore 未装配 → rejected(UNAVAILABLE)")
    func setTitleWithoutStoreRejected() throws {
        let root = try makeTempDir(); defer { try? FileManager.default.removeItem(at: root) }
        let engine = try makeEngine(root: root)   // titles 缺席
        guard case let .rejected(code, _) = engine.handle(.setTitle(sessionId: sid, title: "T")) else {
            Issue.record("expected .rejected"); return
        }
        #expect(code == "UNAVAILABLE")
    }

    @Test("setTitle：assembly 成功后触发 onCustomTitleSet（W8 反向同步；trim 口径同 engine，空白=清除 nil）")
    @MainActor func setTitleFiresReverseSyncCallback() async throws {
        let root = try makeTempDir(); defer { try? FileManager.default.removeItem(at: root) }
        let titles = ChatCustomTitlesStore(root: root)
        let engine = try makeEngine(root: root, titles: titles)
        let assembly = ChatAssembly(engine: engine, ccProjectsRoot: ccProjectsDir(root), codexRoot: nil)
        var reversed: [(sid: String, title: String?)] = []
        assembly.onCustomTitleSet = { reversed.append(($0, $1)) }

        guard case .ok = await assembly.handle(.setTitle(sessionId: sid, title: "  名A  ")) else {
            Issue.record("expected .ok"); return
        }
        #expect(reversed.count == 1)
        #expect(reversed.last?.sid == sid)
        #expect(reversed.last?.title == "名A", "trim 后回调（与 store 落盘值一致）")

        guard case .ok = await assembly.handle(.setTitle(sessionId: sid, title: "   ")) else {
            Issue.record("expected .ok (clear blank)"); return
        }
        #expect(reversed.count == 2)
        #expect(reversed.last?.title == nil, "空白 = 清除 → 回调 nil（反向清 tile 名）")
    }

    @Test("setTitle：rejected（titlesStore 缺席）不触发 onCustomTitleSet")
    @MainActor func setTitleRejectedSkipsReverseSync() async throws {
        let root = try makeTempDir(); defer { try? FileManager.default.removeItem(at: root) }
        let engine = try makeEngine(root: root)   // titles 缺席 → rejected
        let assembly = ChatAssembly(engine: engine, ccProjectsRoot: ccProjectsDir(root), codexRoot: nil)
        var fired = false
        assembly.onCustomTitleSet = { _, _ in fired = true }
        guard case .rejected = await assembly.handle(.setTitle(sessionId: sid, title: "T")) else {
            Issue.record("expected .rejected"); return
        }
        #expect(!fired, "rejected 无副作用")
    }

    @Test("session.all=true：忽略游标一次性整会话（120 条全返）+ 响应不带 prevCursor；all 缺席/false 仍分页")
    func sessionAllReturnsFullSession() throws {
        let root = try makeTempDir(); defer { try? FileManager.default.removeItem(at: root) }
        let engine = try makeEngine(root: root)
        try writeCCMulti(projectsDir: ccProjectsDir(root), project: "P", session: "S", cwd: "/x", count: 120)
        guard case let .messages(all, prevAll) = engine.handle(
            .session(projectHash: "P", sessionId: "S", before: nil, all: true)) else {
            Issue.record("expected .messages(all)"); return
        }
        #expect(all.count == 120)
        #expect(all.first?.uuid == "u0")
        #expect(all.last?.uuid == "u119")
        #expect(prevAll == nil)   // 全量即到头，不带 prevCursor
        // 回归锚：all 缺席 / false → 既有 before 游标分页（最近 50）。
        for allFlag in [nil, false] as [Bool?] {
            guard case let .messages(page, prev) = engine.handle(
                .session(projectHash: "P", sessionId: "S", before: nil, all: allFlag)) else {
                Issue.record("expected .messages(page) all=\(String(describing: allFlag))"); return
            }
            #expect(page.count == 50)
            #expect(prev != nil)
        }
    }

    @Test("sessions：customTitle 只在 wire 层叠加（titlesStore 反查）；无题会话 nil；ChatStore 面零 customTitle（双跑红线）")
    func sessionsCustomTitleOverlay() throws {
        let root = try makeTempDir(); defer { try? FileManager.default.removeItem(at: root) }
        let titles = ChatCustomTitlesStore(root: root)
        let engine = try makeEngine(root: root, titles: titles)
        try writeCCSession(projectsDir: ccProjectsDir(root), project: "P", session: "a",
                           cwd: "/p", text: "q1", uuid: "u1", ts: "2026-07-06T00:00:01.000Z")
        try writeCCSession(projectsDir: ccProjectsDir(root), project: "P", session: "b",
                           cwd: "/p", text: "q2", uuid: "u2", ts: "2026-07-06T00:00:02.000Z")
        _ = engine.warmup()
        titles.set("a", title: "改名A")
        guard case let .sessions(sessions, _) = engine.handle(.sessions(projectHash: "P", cursor: nil)) else {
            Issue.record("expected .sessions"); return
        }
        #expect(sessions.first { $0.sessionId == "a" }?.customTitle == "改名A")
        #expect(sessions.first { $0.sessionId == "b" }?.customTitle == nil)
        // 双跑红线锚：叠加只在 wire 层——ChatStore 输出（对照面）无 customTitle 概念，缺省换算恒 nil。
        let summaries = try engine.store.sessions(projectHash: "P", limit: .max, reconcile: false)
        #expect(!summaries.isEmpty)
        for s in summaries {
            #expect(ChatWire.sessionView(s).customTitle == nil)
        }
    }

    @Test("export：assembly 后置钩子 revealInFinder 被调（注入假闭包，不真开 Finder）")
    @MainActor func exportRevealHookCalled() async throws {
        let root = try makeTempDir(); defer { try? FileManager.default.removeItem(at: root) }
        let engine = try makeEngine(root: root)
        try writeCCSession(projectsDir: ccProjectsDir(root), project: "P", session: "S",
                           cwd: "/x", text: "hello reveal")
        let assembly = ChatAssembly(engine: engine, ccProjectsRoot: ccProjectsDir(root), codexRoot: nil)
        var revealed: [String] = []
        assembly.revealInFinder = { revealed.append($0) }
        guard case let .exported(path) = await assembly.handle(
            .export(projectHash: "P", sessionId: "S", format: .markdown)) else {
            Issue.record("expected .exported"); return
        }
        #expect(revealed == [path])
    }
}

// MARK: - 归档进度帧节流（sink 单元 + warmup 集成）

/// 帧收集器（sink pushFrame 回调线程 = fullScan 所在 workQueue，锁保护）。
private final class FrameLog: @unchecked Sendable {
    private let lock = NSLock()
    private var frames: [[Int]] = []
    func push(_ s: Int, _ t: Int) { lock.withLock { frames.append([s, t]) } }
    var all: [[Int]] { lock.withLock { frames } }
}

/// 步进假时钟（每次读 +step 毫秒）。
private final class TickClock: @unchecked Sendable {
    private let lock = NSLock()
    private var now = 0
    private let step: Int
    init(step: Int) { self.step = step }
    func next() -> Int { lock.withLock { now += step; return now } }
}

@Suite("CHAT batch2 归档进度帧节流")
struct ChatSyncProgressSinkTests {

    @Test("<1s 不推：恒定时钟 5 帧 → 只推首帧 + 末帧（末帧必推）")
    func throttleWithinInterval() {
        let log = FrameLog()
        let sink = ChatSyncProgressSink(nowMs: { 1_000 }, pushFrame: { log.push($0, $1) })
        for i in 1...5 { sink.onProgress(i, 5) }
        #expect(log.all == [[1, 5], [5, 5]])
        #expect(sink.lastFrame?.synced == 5)
        #expect(sink.lastFrame?.total == 5)
    }

    @Test(">1s 推：时钟每帧 +2s → 帧帧都推")
    func throttleBeyondInterval() {
        let log = FrameLog()
        let clock = TickClock(step: 2_000)
        let sink = ChatSyncProgressSink(nowMs: { clock.next() }, pushFrame: { log.push($0, $1) })
        for i in 1...3 { sink.onProgress(i, 3) }
        #expect(log.all == [[1, 3], [2, 3], [3, 3]])
    }

    @Test("0 任务一帧：(0,0) 即末帧 → 无条件推")
    func zeroTaskSingleFrame() {
        let log = FrameLog()
        let sink = ChatSyncProgressSink(nowMs: { 1_000 }, pushFrame: { log.push($0, $1) })
        sink.onProgress(0, 0)
        #expect(log.all == [[0, 0]])
        #expect(sink.lastFrame?.synced == 0)
    }

    @Test("warmup 集成：syncing(synced,total) 进度帧节流推送 + 终态 idle 带末值")
    @MainActor func warmupProgressFramesIntegration() async throws {
        let root = try makeTempDir(); defer { try? FileManager.default.removeItem(at: root) }
        let engine = try makeEngine(root: root)
        try writeCCSession(projectsDir: ccProjectsDir(root), project: "P", session: "a",
                           cwd: "/p", text: "q1", uuid: "u1")
        try writeCCSession(projectsDir: ccProjectsDir(root), project: "P", session: "b",
                           cwd: "/p", text: "q2", uuid: "u2")
        let assembly = ChatAssembly(engine: engine, ccProjectsRoot: ccProjectsDir(root), codexRoot: nil)
        assembly.progressNowMs = { 0 }   // 恒定时钟：首帧 (1,2) 推、末帧 (2,2) 必推
        var captured: [DataEvent] = []
        assembly.onPushEvent = { captured.append($0) }
        _ = await assembly.handle(.projects)   // 触发后台 warmup（含 fullScan 2 个待镜像文件）
        await pollUntil { captured.contains { isSyncFrame($0, .idle, synced: 2, total: 2) } }
        // 终态帧带末值（synced==total==2）。
        #expect(captured.contains { isSyncFrame($0, .idle, synced: 2, total: 2) })
        // 进度帧：首帧 (1,2) + 末帧 (2,2) 均为 syncing。
        #expect(captured.contains { isSyncFrame($0, .syncing, synced: 1, total: 2) })
        #expect(captured.contains { isSyncFrame($0, .syncing, synced: 2, total: 2) })
    }
}

// MARK: - 归档开关（archiveEnabled 门控 + archiveToggled）

@Suite("CHAT batch2 归档开关")
struct ChatArchiveToggleTests {

    @Test("archiveEnabled=false：warmup 跳 fullScan（镜像不建）但 reconcile 照跑（查询面不残废）")
    @MainActor func archiveDisabledSkipsFullScanKeepsQueries() async throws {
        let root = try makeTempDir(); defer { try? FileManager.default.removeItem(at: root) }
        let engine = try makeEngine(root: root)
        try writeCCSession(projectsDir: ccProjectsDir(root), project: "P", session: "a",
                           cwd: "/p", text: "question")
        let assembly = ChatAssembly(engine: engine, ccProjectsRoot: ccProjectsDir(root), codexRoot: nil)
        assembly.archiveEnabled = { false }
        var captured: [DataEvent] = []
        assembly.onPushEvent = { captured.append($0) }
        _ = await assembly.handle(.projects)
        await pollUntil { captured.contains { if case .chatSyncStatus(.idle, _, _, _) = $0 { return true }; return false } }
        // 镜像未建（跳 fullScan）。
        let mirrorProject = root.appendingPathComponent("chat-history/P", isDirectory: true)
        #expect(!FileManager.default.fileExists(atPath: mirrorProject.path))
        // 查询面不残废：reconcile 照跑 → sessions 出数据。
        guard case let .sessions(sessions, _) = await assembly.handle(
            .sessions(projectHash: "P", cursor: nil)) else {
            Issue.record("expected .sessions"); return
        }
        #expect(sessions.count == 1)
    }

    @Test("FSEvent 源变化：归档关 → 跳增量镜像但 chatSessionUpdate 照推；开 → 镜像补上")
    @MainActor func sourceChangeGatesArchiveOnly() async throws {
        let root = try makeTempDir(); defer { try? FileManager.default.removeItem(at: root) }
        let engine = try makeEngine(root: root)
        try writeCCSession(projectsDir: ccProjectsDir(root), project: "P", session: "S",
                           cwd: "/p", text: "q")
        let assembly = ChatAssembly(engine: engine, ccProjectsRoot: ccProjectsDir(root), codexRoot: nil)
        let flag = FlagBox(false)
        assembly.archiveEnabled = { flag.value }
        var captured: [DataEvent] = []
        assembly.onPushEvent = { captured.append($0) }
        let mirrorFile = root.appendingPathComponent("chat-history/P/S.jsonl")

        assembly.onSourceChanged([ChatSourceChange(projectHash: "P", sessionId: "S")], codexChanged: false)
        // 失效通道照推（同步）。
        #expect(captured.contains {
            if case let .chatSessionUpdate(p, s) = $0 { return p == "P" && s == "S" }
            return false
        })
        // 最坏窗口后镜像仍无（增量归档被门跳过）。
        try? await Task.sleep(nanoseconds: 400_000_000)
        #expect(!FileManager.default.fileExists(atPath: mirrorFile.path))

        // 开归档 → 同路径触发 → 镜像补上。
        flag.value = true
        assembly.onSourceChanged([ChatSourceChange(projectHash: "P", sessionId: "S")], codexChanged: false)
        await pollUntil { FileManager.default.fileExists(atPath: mirrorFile.path) }
        #expect(FileManager.default.fileExists(atPath: mirrorFile.path))
    }

    @Test("archiveToggled：关 → 不排新任务（无新帧）；开 → 立即补一轮 fullScan（镜像补上 + 终态带末值）")
    @MainActor func archiveToggledBackfill() async throws {
        let root = try makeTempDir(); defer { try? FileManager.default.removeItem(at: root) }
        let engine = try makeEngine(root: root)
        try writeCCSession(projectsDir: ccProjectsDir(root), project: "P", session: "S",
                           cwd: "/p", text: "q")
        let assembly = ChatAssembly(engine: engine, ccProjectsRoot: ccProjectsDir(root), codexRoot: nil)
        let flag = FlagBox(false)
        assembly.archiveEnabled = { flag.value }
        var captured: [DataEvent] = []
        assembly.onPushEvent = { captured.append($0) }
        _ = await assembly.handle(.projects)   // warmup（关态：跳扫）
        await pollUntil { captured.contains { if case .chatSyncStatus(.idle, _, _, _) = $0 { return true }; return false } }
        let mirrorFile = root.appendingPathComponent("chat-history/P/S.jsonl")
        #expect(!FileManager.default.fileExists(atPath: mirrorFile.path))

        // 关 → 只停新任务：不排补扫（runSyncTask 首帧同步推，计数立判确定性）。
        let before = captured.count
        assembly.archiveToggled(enabled: false)
        #expect(captured.count == before)

        // 开 → 立即补一轮 fullScan。
        flag.value = true
        assembly.archiveToggled(enabled: true)
        await pollUntil { FileManager.default.fileExists(atPath: mirrorFile.path) }
        #expect(FileManager.default.fileExists(atPath: mirrorFile.path))
        // 补扫终态帧带末值（1 个文件补镜像 → (1,1)）。
        await pollUntil { captured.contains { isSyncFrame($0, .idle, synced: 1, total: 1) } }
        #expect(captured.contains { isSyncFrame($0, .idle, synced: 1, total: 1) })
    }
}

// MARK: - dogfood-r5 PR-4 共享池换根接线（装配级：经 ChatAssembly.make 显式传 tmp 共享根，绝不碰真实池）

@Suite("dogfood-r5 PR-4 共享池换根接线")
struct ChatSharedPoolWiringTests {

    /// 经 make 装配（tmp 隔离共享根，**绝不碰真实生产共享归档根**——Application Support 下，DataDirectory 权威）。dataRoot/共享根/claudeRoot
    /// 全在 root 下：dataRoot=root/data（legacy 镜像 + sync-state + marker 落此）；共享根=root/shared/chat-history。
    @MainActor
    private func makeAssembly(_ root: URL) throws -> (assembly: ChatAssembly, dataRoot: URL, shared: URL, claude: URL) {
        let dataRoot = root.appendingPathComponent("data", isDirectory: true)
        let shared = root.appendingPathComponent("shared/chat-history", isDirectory: true)
        let claude = root.appendingPathComponent(".claude", isDirectory: true)
        try FileManager.default.createDirectory(
            at: claude.appendingPathComponent("projects", isDirectory: true), withIntermediateDirectories: true)
        // chat.db 落 <dataRoot>/state/（生产 bootstrap 建树；测试直造 make，先建 state 目录供 ChatDatabase.open）。
        try FileManager.default.createDirectory(
            at: DataDirectory.chatDatabaseURL(under: dataRoot).deletingLastPathComponent(),
            withIntermediateDirectories: true)
        let assembly = try ChatAssembly.make(
            dataRoot: dataRoot, claudeRoot: claude, codexRoot: nil, sharedArchiveRoot: shared)
        return (assembly, dataRoot, shared, claude)
    }

    /// 写一条 user 行会话 .jsonl（NDJSON，末行 `\n`）。
    private func writeSession(dir: URL, session: String, text: String) throws {
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let line = #"{"type":"user","uuid":"\#(session)-u1","sessionId":"\#(session)","cwd":"/p","timestamp":"2026-07-06T00:00:00.000Z","message":{"role":"user","content":"\#(text)"}}"#
        try (line + "\n").write(to: dir.appendingPathComponent("\(session).jsonl"), atomically: true, encoding: .utf8)
    }

    @Test("迁移先于 reconcile：legacy 独有会话 → warmup 后池内有文件 + reconcile 见 archiveOnly + marker 落 per-分身")
    @MainActor func migrationBeforeReconcile() throws {
        let root = try makeTempDir(); defer { try? FileManager.default.removeItem(at: root) }
        let (assembly, dataRoot, shared, _) = try makeAssembly(root)
        // 种「legacy 镜像独有」会话（CC 源已被清、共享池尚无）：写 <dataRoot>/chat-history/P/leg.jsonl。
        let legacyMirror = DataDirectory.chatHistoryDirectoryURL(under: dataRoot)
        try writeSession(dir: legacyMirror.appendingPathComponent("P", isDirectory: true),
                         session: "leg", text: "legacy 独有会话")

        _ = assembly.engine.warmup()   // 迁移（legacy→池）先于 fullScan/reconcile

        // (1) 迁移把 legacy 文件搬进共享池。
        #expect(FileManager.default.fileExists(atPath: shared.appendingPathComponent("P/leg.jsonl").path))
        // (2) 因果：单次 warmup 后 reconcile 已见池内会话 → archiveOnly。若迁移未先于 reconcile 跑，reconcile
        //     时池空、leg 不会入库——leg 出现且 archiveOnly 即证「迁移先于 reconcile」。
        let sessions = try assembly.engine.store.allRecentSessions(
            limit: .max, includeUntitled: true, reconcile: false)
        let leg = sessions.first { $0.sessionId == "leg" }
        #expect(leg != nil)
        #expect(leg?.archiveOnly == true)
        // (3) marker 落 per-分身 dataRoot/state（非 sharedRoot）——首分身 seal 不阻其余分身补迁自己的 legacy。
        #expect(FileManager.default.fileExists(
            atPath: DataDirectory.chatArchiveMigrationMarkerURL(under: dataRoot).path))
    }

    @Test("delete 三根：CC 源 + 共享池 + legacy 镜像副本全删（legacyMirrorRoot 经 make 注入 engine）")
    @MainActor func deleteThreeRoots() throws {
        let root = try makeTempDir(); defer { try? FileManager.default.removeItem(at: root) }
        let (assembly, dataRoot, shared, claude) = try makeAssembly(root)
        let sid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
        let ccFile = claude.appendingPathComponent("projects/P/\(sid).jsonl")
        let poolFile = shared.appendingPathComponent("P/\(sid).jsonl")
        let legacyFile = DataDirectory.chatHistoryDirectoryURL(under: dataRoot)
            .appendingPathComponent("P/\(sid).jsonl")
        // 三根各种一份同 sid 会话（CC 源 + 共享池 + per-分身 legacy 镜像）。
        try writeSession(dir: ccFile.deletingLastPathComponent(), session: sid, text: "三根删除")
        try writeSession(dir: poolFile.deletingLastPathComponent(), session: sid, text: "三根删除")
        try writeSession(dir: legacyFile.deletingLastPathComponent(), session: sid, text: "三根删除")
        _ = assembly.engine.warmup()   // 建 chat.db 行（迁移见池已有同 sid 相等 → skip）
        for f in [ccFile, poolFile, legacyFile] {
            #expect(FileManager.default.fileExists(atPath: f.path), "前置：\(f.path) 应在")
        }
        guard case .deleted = assembly.engine.handle(.delete(projectHash: "P", sessionId: sid)) else {
            Issue.record("expected .deleted"); return
        }
        for f in [ccFile, poolFile, legacyFile] {
            #expect(!FileManager.default.fileExists(atPath: f.path), "三根硬删：\(f.path) 应消失")
        }
    }
}

// MARK: - M7 升级迁移接线（legacy-migration.md：老版 ~/.muxvo 归档 → 共享池；经 make 显式传 tmp 假老归档根，绝不碰真实家目录与真实池）

@Suite("M7 升级迁移接线（老版归档并池）")
struct LegacyMuxvoArchiveWiringTests {

    /// 经 make 装配（tmp 全隔离：dataRoot/共享根/claudeRoot/老归档根全在 root 下）。legacyArchive=nil
    /// 即生产门控「不迁」形态（防线一/二在装配层同为传 nil，engine 侧不可区分也无需区分）。
    @MainActor
    private func makeAssembly(_ root: URL, legacyArchive: URL?) throws
        -> (assembly: ChatAssembly, dataRoot: URL, shared: URL)
    {
        let dataRoot = root.appendingPathComponent("data", isDirectory: true)
        let shared = root.appendingPathComponent("shared/chat-history", isDirectory: true)
        let claude = root.appendingPathComponent(".claude", isDirectory: true)
        try FileManager.default.createDirectory(
            at: claude.appendingPathComponent("projects", isDirectory: true),
            withIntermediateDirectories: true)
        try FileManager.default.createDirectory(
            at: DataDirectory.chatDatabaseURL(under: dataRoot).deletingLastPathComponent(),
            withIntermediateDirectories: true)
        let assembly = try ChatAssembly.make(
            dataRoot: dataRoot, claudeRoot: claude, codexRoot: nil, sharedArchiveRoot: shared,
            legacyMuxvoArchiveRoot: legacyArchive)
        return (assembly, dataRoot, shared)
    }

    /// 写一条 user 行会话 .jsonl（NDJSON）；mtime 可显式定（shouldReplace 新者胜 fixture）。
    private func writeSession(dir: URL, session: String, text: String, mtime: Date? = nil) throws {
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let line = #"{"type":"user","uuid":"\#(session)-u1","sessionId":"\#(session)","cwd":"/p","timestamp":"2026-07-06T00:00:00.000Z","message":{"role":"user","content":"\#(text)"}}"#
        let file = dir.appendingPathComponent("\(session).jsonl")
        try (line + "\n").write(to: file, atomically: true, encoding: .utf8)
        if let mtime {
            try FileManager.default.setAttributes([.modificationDate: mtime], ofItemAtPath: file.path)
        }
    }

    @Test("老归档独有会话 → warmup 并池 + 可查（archiveOnly）+ 独立 marker 落 per-分身 state")
    @MainActor func legacyArchiveMigratesOnWarmup() throws {
        let root = try makeTempDir(); defer { try? FileManager.default.removeItem(at: root) }
        let legacyArchive = root.appendingPathComponent(".muxvo/chat-archive", isDirectory: true)
        try writeSession(dir: legacyArchive.appendingPathComponent("P", isDirectory: true),
                         session: "oldie", text: "老版独有会话")
        let (assembly, dataRoot, shared) = try makeAssembly(root, legacyArchive: legacyArchive)

        _ = assembly.engine.warmup()

        // (1) 老归档文件并入共享池，且当轮 reconcile 已可查（迁移先于 fullScan/reconcile）。
        #expect(FileManager.default.fileExists(atPath: shared.appendingPathComponent("P/oldie.jsonl").path))
        let sessions = try assembly.engine.store.allRecentSessions(
            limit: .max, includeUntitled: true, reconcile: false)
        let oldie = sessions.first { $0.sessionId == "oldie" }
        #expect(oldie != nil)
        #expect(oldie?.archiveOnly == true)
        // (2) 独立 marker（legacy-chat-archive-migrated.json）落 per-分身 state，不与 PR-4 marker 混用。
        #expect(FileManager.default.fileExists(
            atPath: DataDirectory.legacyChatArchiveMigrationMarkerURL(under: dataRoot).path))
    }

    @Test("幂等：一跑 seal 后源再改（更新 mtime），二跑 marker 短路不再拷（池内容不变）")
    @MainActor func idempotentAfterSeal() throws {
        let root = try makeTempDir(); defer { try? FileManager.default.removeItem(at: root) }
        let legacyArchive = root.appendingPathComponent(".muxvo/chat-archive", isDirectory: true)
        let srcDir = legacyArchive.appendingPathComponent("P", isDirectory: true)
        try writeSession(dir: srcDir, session: "idem", text: "初版内容")
        let (assembly, dataRoot, shared) = try makeAssembly(root, legacyArchive: legacyArchive)
        _ = assembly.engine.warmup()
        #expect(FileManager.default.fileExists(
            atPath: DataDirectory.legacyChatArchiveMigrationMarkerURL(under: dataRoot).path))

        // 源再改（mtime 拨未来——若无 marker 短路，shouldReplace 会判替换）。
        try writeSession(dir: srcDir, session: "idem", text: "seal 后改动不应再吸",
                         mtime: Date().addingTimeInterval(600))
        _ = assembly.engine.warmup()

        let pooled = try String(
            contentsOf: shared.appendingPathComponent("P/idem.jsonl"), encoding: .utf8)
        #expect(pooled.contains("初版内容"))
        #expect(!pooled.contains("seal 后改动不应再吸"))
    }

    @Test("make 不传老归档根 → 功能关：不迁、legacy marker 不落（防线一）")
    @MainActor func nilParamMeansOff() throws {
        let root = try makeTempDir(); defer { try? FileManager.default.removeItem(at: root) }
        let legacyArchive = root.appendingPathComponent(".muxvo/chat-archive", isDirectory: true)
        try writeSession(dir: legacyArchive.appendingPathComponent("P", isDirectory: true),
                         session: "off", text: "不该被吸的会话")
        let (assembly, dataRoot, shared) = try makeAssembly(root, legacyArchive: nil)

        _ = assembly.engine.warmup()

        #expect(!FileManager.default.fileExists(atPath: shared.appendingPathComponent("P/off.jsonl").path))
        #expect(!FileManager.default.fileExists(
            atPath: DataDirectory.legacyChatArchiveMigrationMarkerURL(under: dataRoot).path))
    }

    @Test("冲突新者胜：老归档旧快照 vs 池内新快照 → skip，池保留新内容且 seal")
    @MainActor func conflictNewerWins() throws {
        let root = try makeTempDir(); defer { try? FileManager.default.removeItem(at: root) }
        let legacyArchive = root.appendingPathComponent(".muxvo/chat-archive", isDirectory: true)
        try writeSession(dir: legacyArchive.appendingPathComponent("P", isDirectory: true),
                         session: "dup", text: "老归档旧快照",
                         mtime: Date(timeIntervalSince1970: 1_600_000_000))  // 2020
        let (assembly, dataRoot, shared) = try makeAssembly(root, legacyArchive: legacyArchive)
        // 池内预置同 session 的**更新**快照（mtime 现在）——shouldReplace 判 src 更旧 → skip。
        try writeSession(dir: shared.appendingPathComponent("P", isDirectory: true),
                         session: "dup", text: "池内新快照")

        _ = assembly.engine.warmup()

        let pooled = try String(
            contentsOf: shared.appendingPathComponent("P/dup.jsonl"), encoding: .utf8)
        #expect(pooled.contains("池内新快照"))
        #expect(!pooled.contains("老归档旧快照"))
        // skip 不算硬失败 → 照常 seal。
        #expect(FileManager.default.fileExists(
            atPath: DataDirectory.legacyChatArchiveMigrationMarkerURL(under: dataRoot).path))
    }

    // MARK: - M7 批3 §7.4 迁移安全不变量（只读源 / config 不迁 / realpath 隔离 / 幂等 / 回滚）

    /// 目录内全 .jsonl 文件的 (相对路径 → (字节, 秒级 mtime)) 快照，供「源零字节未动」逐字节+mtime 比对。
    private func snapshotTree(_ root: URL) throws -> [String: (data: Data, mtimeSec: Int)] {
        let fm = FileManager.default
        var out: [String: (Data, Int)] = [:]
        guard let e = fm.enumerator(at: root, includingPropertiesForKeys: [.contentModificationDateKey])
        else { return out }
        for case let url as URL in e where !url.hasDirectoryPath {
            let rel = url.path.replacingOccurrences(of: root.path + "/", with: "")
            let data = try Data(contentsOf: url)
            let mtime = (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?
                .contentModificationDate ?? Date(timeIntervalSince1970: 0)
            out[rel] = (data, Int(mtime.timeIntervalSince1970))
        }
        return out
    }

    @Test("§7.4 源零字节未动：迁移后老根 ~/.muxvo 全树逐字节 + mtime 与迁移前逐一相等（只读迁移）")
    @MainActor func sourceRootUntouched() throws {
        let root = try makeTempDir(); defer { try? FileManager.default.removeItem(at: root) }
        let legacyHome = root.appendingPathComponent(".muxvo", isDirectory: true)
        let legacyArchive = legacyHome.appendingPathComponent("chat-archive", isDirectory: true)
        try writeSession(dir: legacyArchive.appendingPathComponent("P", isDirectory: true),
                         session: "s1", text: "会话一")
        try writeSession(dir: legacyArchive.appendingPathComponent("Q", isDirectory: true),
                         session: "s2", text: "会话二")
        // 老根内非归档旁支（config/日志）：迁移绝不得触碰（§7.0 config 不迁）。
        try Data("{\"theme\":\"dark\"}".utf8)
            .write(to: legacyHome.appendingPathComponent("config.json"))
        let before = try snapshotTree(legacyHome)
        #expect(before.count == 3)  // s1.jsonl + s2.jsonl + config.json

        let (assembly, _, shared) = try makeAssembly(root, legacyArchive: legacyArchive)
        _ = assembly.engine.warmup()

        // (1) 归档已并池（迁移确实发生，非空跑）。
        #expect(FileManager.default.fileExists(atPath: shared.appendingPathComponent("P/s1.jsonl").path))
        // (2) 老根全树逐字节 + 秒级 mtime 与迁移前完全相等——find -newer 空集的程序化对等。
        let after = try snapshotTree(legacyHome)
        #expect(after.count == before.count)
        for (rel, b) in before {
            #expect(after[rel]?.data == b.data, "老根 \(rel) 内容被改动")
            #expect(after[rel]?.mtimeSec == b.mtimeSec, "老根 \(rel) mtime 被改动")
        }
    }

    @Test("§7.4 config 不迁：老根旁 config.json 不进池、新根不出现 config.json（只 .jsonl 迁，D1b 用新版默认）")
    @MainActor func configNotMigrated() throws {
        let root = try makeTempDir(); defer { try? FileManager.default.removeItem(at: root) }
        let legacyArchive = root.appendingPathComponent(".muxvo/chat-archive", isDirectory: true)
        try writeSession(dir: legacyArchive.appendingPathComponent("P", isDirectory: true),
                         session: "s1", text: "会话")
        // 病态：把 config.json 也塞进归档子目录——迁移器只认 .jsonl，config.json 必被跳过。
        try Data("{\"fontSize\":18}".utf8)
            .write(to: legacyArchive.appendingPathComponent("P/config.json"))
        let (assembly, dataRoot, shared) = try makeAssembly(root, legacyArchive: legacyArchive)

        _ = assembly.engine.warmup()

        #expect(FileManager.default.fileExists(atPath: shared.appendingPathComponent("P/s1.jsonl").path))
        // config.json 既不进共享池、也不进 per-分身数据根任何位置。
        #expect(!FileManager.default.fileExists(atPath: shared.appendingPathComponent("P/config.json").path))
        let leaked = FileManager.default.enumerator(at: dataRoot, includingPropertiesForKeys: nil)?
            .compactMap { ($0 as? URL)?.lastPathComponent }
            .contains("config.json") ?? false
        #expect(!leaked, "config.json 泄漏进新数据根")
    }

    @Test("§7.4 realpath 隔离：新数据根/共享根均不与老版生产根同真实路径（R-06 隔离前提成立）")
    @MainActor func newRootsRealpathDistinctFromLegacy() throws {
        let root = try makeTempDir(); defer { try? FileManager.default.removeItem(at: root) }
        let legacyArchive = root.appendingPathComponent(".muxvo/chat-archive", isDirectory: true)
        try writeSession(dir: legacyArchive.appendingPathComponent("P", isDirectory: true),
                         session: "s1", text: "会话")
        let (assembly, dataRoot, shared) = try makeAssembly(root, legacyArchive: legacyArchive)
        _ = assembly.engine.warmup()

        // 新根与老版生产根 `~/Library/Application Support/muxvo` realpath 绝不相同（隔离铁律）。
        // 用公开 URL API 逐一归一比对（DataDirectory 内部 R-06 谓词由 DataDirectoryTests @testable 覆盖）。
        let legacyProdReal = FileManager.default
            .urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("muxvo", isDirectory: true)
            .resolvingSymlinksInPath().standardizedFileURL
        #expect(dataRoot.resolvingSymlinksInPath().standardizedFileURL != legacyProdReal)
        #expect(shared.resolvingSymlinksInPath().standardizedFileURL != legacyProdReal)
    }

    @Test("§7.4 半途杀进程重跑幂等：预置一半已拷（模拟 marker 前被杀）→ 重跑补齐、无重复、源零改动")
    @MainActor func crashMidwayRerunIdempotent() throws {
        let root = try makeTempDir(); defer { try? FileManager.default.removeItem(at: root) }
        let legacyArchive = root.appendingPathComponent(".muxvo/chat-archive", isDirectory: true)
        try writeSession(dir: legacyArchive.appendingPathComponent("P", isDirectory: true),
                         session: "a", text: "会话A")
        try writeSession(dir: legacyArchive.appendingPathComponent("P", isDirectory: true),
                         session: "b", text: "会话B")
        let (assembly, dataRoot, shared) = try makeAssembly(root, legacyArchive: legacyArchive)
        // 模拟「拷完 a、写 marker 前被杀」：手动把 a 逐字节预置进池，marker 不落。
        let poolP = shared.appendingPathComponent("P", isDirectory: true)
        try FileManager.default.createDirectory(at: poolP, withIntermediateDirectories: true)
        try Data(contentsOf: legacyArchive.appendingPathComponent("P/a.jsonl"))
            .write(to: poolP.appendingPathComponent("a.jsonl"))
        let beforeSrc = try snapshotTree(legacyArchive)

        _ = assembly.engine.warmup()  // 重跑：a compare-skip、b 补拷、seal

        // (1) 两会话都在池且各恰一份（a 未被二次覆写、b 补齐）。
        let aPooled = try String(contentsOf: poolP.appendingPathComponent("a.jsonl"), encoding: .utf8)
        let bPooled = try String(contentsOf: poolP.appendingPathComponent("b.jsonl"), encoding: .utf8)
        #expect(aPooled.contains("会话A"))
        #expect(bPooled.contains("会话B"))
        #expect(FileManager.default.fileExists(
            atPath: DataDirectory.legacyChatArchiveMigrationMarkerURL(under: dataRoot).path))
        // (2) 源零改动（重跑同样只读）。
        let afterSrc = try snapshotTree(legacyArchive)
        #expect(afterSrc.mapValues { $0.data } == beforeSrc.mapValues { $0.data })
    }

    @Test("§7.4 回滚：迁移后删新数据根 + 共享根 → 老根全树逐字节完好（迁移对源非破坏，可安全回滚）")
    @MainActor func rollbackLeavesLegacyIntact() throws {
        let root = try makeTempDir(); defer { try? FileManager.default.removeItem(at: root) }
        let legacyArchive = root.appendingPathComponent(".muxvo/chat-archive", isDirectory: true)
        try writeSession(dir: legacyArchive.appendingPathComponent("P", isDirectory: true),
                         session: "keep1", text: "回滚保留一")
        try writeSession(dir: legacyArchive.appendingPathComponent("Q", isDirectory: true),
                         session: "keep2", text: "回滚保留二")
        let before = try snapshotTree(legacyArchive)
        let (assembly, dataRoot, shared) = try makeAssembly(root, legacyArchive: legacyArchive)
        _ = assembly.engine.warmup()
        #expect(FileManager.default.fileExists(atPath: shared.appendingPathComponent("P/keep1.jsonl").path))

        // 回滚 = 删整个新数据根 + 共享根（含其父 shared/）。
        try FileManager.default.removeItem(at: dataRoot)
        try FileManager.default.removeItem(at: shared.deletingLastPathComponent())

        // 老根全树逐字节 + mtime 完好——回滚零损失。
        let after = try snapshotTree(legacyArchive)
        #expect(after.count == before.count)
        for (rel, b) in before {
            #expect(after[rel]?.data == b.data, "回滚后老根 \(rel) 内容缺失/被改")
            #expect(after[rel]?.mtimeSec == b.mtimeSec, "回滚后老根 \(rel) mtime 被改")
        }
    }
}
