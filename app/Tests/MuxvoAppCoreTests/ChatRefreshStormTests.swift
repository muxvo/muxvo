// P0 CPU 风暴回归锚（m5/r1-fix1 批0）：Codex 触发面收窄（T1）+ refresh 单飞合并（T2）。
//
// 缺陷：FSEvents 监整棵 ~/.codex，Codex 桌面版家务写（sqlite WAL / models_cache / global-state.bak…）
// 也判 codexChanged=true → 每 500ms 静默窗排一发全量 reprime 到 concurrent 队列且无在飞去重 →
// 真机 12 线程并行全量扫 597MB = 264% CPU 稳态（2026-07-08 采样档取证）。
//  · T1 钉触发面 = `sessions/` 子树 + `.codex-global-state.json` 精确匹配（读者可观察面精确覆盖）。
//  · T2 钉单飞：在飞期（含 warmup）触发只置 pending（reprime OR 合并、零围栏帧），完成后至多补跑
//    一次；prime 绝不并发；syncing/终态帧严格成对。计数/并发峰值为因果断言，非墙钟。
import Foundation
import Testing

import MuxvoBridge
import MuxvoStorage
@testable import MuxvoAppCore
@testable import MuxvoChatHistory

// MARK: - fixture（范式同 ChatAssemblyTests；private 不跨文件共享）

private func makeTempDir() throws -> URL {
    let url = FileManager.default.temporaryDirectory
        .appendingPathComponent("muxvo-chat-storm-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
}

private func ccProjectsDir(_ root: URL) -> URL {
    root.appendingPathComponent(".claude/projects", isDirectory: true)
}

private func makeEngine(root: URL, codex: (any ChatCodexQuerying)? = nil) throws -> ChatQueryEngine {
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
        titlesStore: nil)
}

/// 门控+计数 Codex 桩：getProjects（prime 首步）记录进入次数与并发峰值后阻塞在 gate。
/// 安全上限 30s 自解：真回归表现为测试慢+断言红，而非整套挂死。
private final class GatedCountingCodexStub: ChatCodexQuerying, @unchecked Sendable {
    private let gate = DispatchSemaphore(value: 0)
    private let lock = NSLock()
    private var entries = 0
    private var active = 0
    private var peak = 0

    var primeEntries: Int { lock.withLock { entries } }
    var peakConcurrentPrimes: Int { lock.withLock { peak } }
    func release(_ n: Int) { for _ in 0..<n { gate.signal() } }

    func getProjects() -> [ChatProjectInfo] {
        lock.withLock {
            entries += 1
            active += 1
            peak = max(peak, active)
        }
        _ = gate.wait(timeout: .now() + 30)
        lock.withLock { active -= 1 }
        return []
    }
    func getSessionsForProject(_ projectHash: String, limit: Int) -> [ChatSessionSummary] { [] }
    func getAllRecentSessions(limit: Int) -> [ChatSessionSummary] { [] }
    func readSession(sessionId: String, limit: Int?) -> [ChatSessionMessage] { [] }
    func search(_ query: String) -> [ChatSearchResult] { [] }
}

/// per-key 去抖测试用回调收集器（ingest/flushCodex 同步单线程驱动，@unchecked 安全）。
private final class OnChangeSpy: @unchecked Sendable {
    struct Call { let changes: [ChatSourceChange]; let codex: Bool }
    var calls: [Call] = []
    func record(_ changes: [ChatSourceChange], _ codex: Bool) {
        calls.append(Call(changes: changes, codex: codex))
    }
}

/// 起始围栏帧计数：只认 synced/total 双 nil 的 syncing 帧（warmup 的 fullScan 进度帧也是
/// .syncing 但携 synced/total，非围栏，不计）。
private func syncingCount(_ frames: [DataEvent]) -> Int {
    frames.reduce(0) { acc, e in
        if case .chatSyncStatus(.syncing, _, .none, .none) = e { return acc + 1 }
        return acc
    }
}

private func terminalCount(_ frames: [DataEvent]) -> Int {
    frames.reduce(0) { acc, e in
        if case let .chatSyncStatus(s, _, _, _) = e, s != .syncing { return acc + 1 }
        return acc
    }
}

@MainActor
private func pollUntil(timeout: TimeInterval = 10, _ cond: () -> Bool) async {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
        if cond() { return }
        try? await Task.sleep(nanoseconds: 20_000_000)
    }
}

// MARK: - T1 触发面收窄（watcher 分类）

@Suite("P0 风暴 T1：Codex 触发面收窄")
struct ChatCodexTriggerSurfaceTests {
    private let codexRoot = URL(fileURLWithPath: "/home/.codex", isDirectory: true)

    @Test("isCodex：根目录家务路径不算 Codex 变化；sessions/**、global-state 与根级溢出信号算")
    func codexTriggerSurfaceNarrowed() {
        // Codex 桌面版家务写（真机取证实测清单）——不得触发 reprime。
        for p in [
            "/home/.codex/logs_2.sqlite-wal",
            "/home/.codex/models_cache.json",
            "/home/.codex/state_5.sqlite",
            "/home/.codex/process_manager/chat_processes.json",
            "/home/.codex/.codex-global-state.json.bak",
        ] {
            #expect(!ChatSourceWatcher.isCodex(path: p, codexRoot: codexRoot), "不应触发：\(p)")
        }
        // 读者可观察面（sessions/** + 标题表）+ 根路径本身（FSEvents 溢出/合并 rescan 信号，
        // FileEvents 常态不派发根级路径；对抗验收 MINOR-1）——必须触发。
        for p in [
            "/home/.codex",
            "/home/.codex/sessions",
            "/home/.codex/sessions/2026/07/08",
            "/home/.codex/sessions/2026/07/08/rollout-2026-07-08T00-00-00-x.jsonl",
            "/home/.codex/.codex-global-state.json",
        ] {
            #expect(ChatSourceWatcher.isCodex(path: p, codexRoot: codexRoot), "应触发：\(p)")
        }
    }

    @Test("ingest：家务路径不置 pendingCodex（flushCodex 零回调）；会话路径照常触发")
    func housekeepingIngestDoesNotArmCodexFlush() {
        let spy = OnChangeSpy()
        let w = ChatSourceWatcher(
            ccProjectsRoot: URL(fileURLWithPath: "/home/.claude/projects", isDirectory: true),
            codexRoot: codexRoot,
            debounceMs: 3_600_000  // 真 timer 不触发，仅手动 flush 驱动确定性
        ) { changes, codex in spy.record(changes, codex) }
        w.ingest(paths: ["/home/.codex/logs_2.sqlite-wal", "/home/.codex/models_cache.json"])
        w.flushCodex()  // 幂等：pendingCodex 未置 → 无回调
        #expect(spy.calls.isEmpty)
        w.ingest(paths: ["/home/.codex/sessions/2026/07/08/rollout-a.jsonl"])
        w.flushCodex()
        #expect(spy.calls.count == 1)
        #expect(spy.calls.first?.codex == true)
    }
}

// MARK: - T2 refresh 单飞+合并（ChatAssembly）

@Suite("P0 风暴 T2：refresh 单飞+合并")
struct ChatRefreshSingleFlightTests {

    @Test("在飞期连发 codex 触发：syncing 帧恰 1、合并为至多一次补跑、prime 绝不并发")
    @MainActor func refreshSingleFlightCoalesces() async throws {
        let root = try makeTempDir(); defer { try? FileManager.default.removeItem(at: root) }
        let stub = GatedCountingCodexStub()
        defer { stub.release(4) }  // 兜底放行（断言失败路径也不留悬挂 prime）
        let engine = try makeEngine(root: root, codex: stub)
        let assembly = ChatAssembly(engine: engine, ccProjectsRoot: ccProjectsDir(root), codexRoot: nil)
        var frames: [DataEvent] = []
        assembly.onPushEvent = { frames.append($0) }

        assembly.onSourceChanged([], codexChanged: true)
        assembly.onSourceChanged([], codexChanged: true)
        assembly.onSourceChanged([], codexChanged: true)
        #expect(syncingCount(frames) == 1, "在飞期触发应只合并：同步 syncing 帧恰 1")

        stub.release(4)
        await pollUntil { terminalCount(frames) > 0 && terminalCount(frames) == syncingCount(frames) }
        #expect(stub.primeEntries == 2, "1 在飞 + 1 合并补跑（非逐发全跑）")
        #expect(stub.peakConcurrentPrimes == 1, "prime 绝不并发（风暴根断言）")
        #expect(syncingCount(frames) == terminalCount(frames), "围栏帧严格成对")
    }

    @Test("在飞期 false 后 true：补跑恰一次且携 reprime（OR 合并）")
    @MainActor func coalesceMergesReprimeOR() async throws {
        let root = try makeTempDir(); defer { try? FileManager.default.removeItem(at: root) }
        let stub = GatedCountingCodexStub()
        defer { stub.release(4) }
        let engine = try makeEngine(root: root, codex: stub)
        let assembly = ChatAssembly(engine: engine, ccProjectsRoot: ccProjectsDir(root), codexRoot: nil)
        var frames: [DataEvent] = []
        assembly.onPushEvent = { frames.append($0) }

        assembly.onSourceChanged([], codexChanged: true)   // 在飞（prime 阻塞）
        assembly.onSourceChanged([], codexChanged: false)
        assembly.onSourceChanged([], codexChanged: true)
        #expect(syncingCount(frames) == 1, "在飞期触发应只合并")

        stub.release(4)
        await pollUntil { terminalCount(frames) > 0 && terminalCount(frames) == syncingCount(frames) }
        #expect(stub.primeEntries == 2, "补跑恰一次且携 reprime=true（OR 不丢位）")
        #expect(stub.peakConcurrentPrimes == 1)
    }

    @Test("refresh 在飞期首开：warmup 延迟排队（pendingWarmup），refresh 收尾后必跑不静默丢")
    @MainActor func refreshInFlightDefersWarmup() async throws {
        let root = try makeTempDir(); defer { try? FileManager.default.removeItem(at: root) }
        let stub = GatedCountingCodexStub()
        defer { stub.release(4) }
        let engine = try makeEngine(root: root, codex: stub)
        let assembly = ChatAssembly(engine: engine, ccProjectsRoot: ccProjectsDir(root), codexRoot: nil)
        var frames: [DataEvent] = []
        assembly.onPushEvent = { frames.append($0) }

        assembly.onSourceChanged([], codexChanged: true)  // refresh 在飞（prime 阻塞）
        _ = await assembly.handle(.projects)  // 首开：warmup 应排队（pendingWarmup），不并发起跑
        #expect(syncingCount(frames) == 1, "warmup 延迟排队：refresh 在飞期零新围栏帧")

        stub.release(4)
        await pollUntil { terminalCount(frames) >= 2 && terminalCount(frames) == syncingCount(frames) }
        // warmup 若被静默丢（回归：didStartWarmup 已置却漏 drain）→ entries/围栏帧停在 1，此处红。
        #expect(stub.primeEntries == 2, "refresh 收尾后 warmup 必跑（refresh prime + warmup prime）")
        #expect(stub.peakConcurrentPrimes == 1)
        #expect(syncingCount(frames) == 2, "两次真实 run：refresh + 延迟的 warmup")
    }

    @Test("warmup 在飞期的 codex 触发：合并到 warmup 完成后至多一次补跑")
    @MainActor func warmupInFlightMergesRefresh() async throws {
        let root = try makeTempDir(); defer { try? FileManager.default.removeItem(at: root) }
        let stub = GatedCountingCodexStub()
        defer { stub.release(4) }
        let engine = try makeEngine(root: root, codex: stub)
        let assembly = ChatAssembly(engine: engine, ccProjectsRoot: ccProjectsDir(root), codexRoot: nil)
        var frames: [DataEvent] = []
        assembly.onPushEvent = { frames.append($0) }

        _ = await assembly.handle(.projects)  // 首开触发 warmup（prime 阻塞在 gate）
        assembly.onSourceChanged([], codexChanged: true)
        assembly.onSourceChanged([], codexChanged: true)
        #expect(syncingCount(frames) == 1, "warmup 在飞期触发只合并（无并行 refresh）")

        stub.release(4)
        await pollUntil { terminalCount(frames) > 0 && terminalCount(frames) == syncingCount(frames) }
        #expect(stub.primeEntries == 2, "warmup + 一次合并补跑")
        #expect(stub.peakConcurrentPrimes == 1, "warmup 与 refresh 的 prime 不并发")
    }
}
