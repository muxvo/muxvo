// UpdateController 测试替身（auto-update.md §12 UPD_* 池载体）：全同步返回 + MainActor 泵停即定，
// 任何测试不 sleep 真实秒级（时序全走 ManualUpdateClock）。

import Foundation
import MuxvoUpdater

/// MainActor 泵：控制器内部 Task 均为 MainActor 同步替身链，泵若干 yield 即 settle。
@MainActor
func settle(_ rounds: Int = 25) async {
    for _ in 0..<rounds { await Task.yield() }
}

/// 事件驱动 settle（M7 批6 flaky 根治，替代固定 25 轮预算）：泵 MainActor yield 直到 cond 成立。
/// 根因：满载并行下多 @MainActor 套件竞争唯一 MainActor 执行器，controller 内部 Task 链未必在 25
/// yield 内跑到目标步（如排程 next poll）→ INSTALL_L2_01 `nextDueInterval` 偶为 nil 红。改为泵到
/// 条件成立：cap 仅防挂（默认 4000 轮，与负载解耦——满载只多泵几轮，绝不早退）。返回是否达成。
@MainActor
@discardableResult
func settleUntil(_ cap: Int = 4000, _ cond: @MainActor () -> Bool) async -> Bool {
    var i = 0
    while i < cap {
        if cond() { return true }
        await Task.yield()
        i += 1
    }
    return cond()
}

// MARK: 引擎替身

@MainActor
final class FakeUpdateEngine: UpdateEngine {
    enum CheckScript {
        case found(String)
        case upToDate
        case failure
    }
    enum DownloadScript {
        /// 逐帧进度 + 成功。
        case success(frames: [UpdateDownloadProgress])
        case failure
    }

    struct EngineError: Error {}

    var checkScripts: [CheckScript] = []
    var downloadScripts: [DownloadScript] = []
    private(set) var checkCalls = 0
    private(set) var downloadCalls = 0
    private(set) var dismissPendingCalls = 0
    private(set) var installAndRelaunchCalls: [DownloadedUpdate] = []
    private(set) var scheduleInstallOnQuitCalls: [DownloadedUpdate] = []

    func check() async throws -> UpdateCandidate? {
        checkCalls += 1
        guard !checkScripts.isEmpty else { return nil }
        switch checkScripts.removeFirst() {
        case .found(let version): return UpdateCandidate(version: version)
        case .upToDate: return nil
        case .failure: throw EngineError()
        }
    }

    func startDownload(
        _ candidate: UpdateCandidate,
        onProgress: @escaping @MainActor (UpdateDownloadProgress) -> Void
    ) async throws -> DownloadedUpdate {
        downloadCalls += 1
        guard !downloadScripts.isEmpty else { return DownloadedUpdate(version: candidate.version) }
        switch downloadScripts.removeFirst() {
        case .success(let frames):
            for frame in frames { onProgress(frame) }
            return DownloadedUpdate(version: candidate.version)
        case .failure:
            throw EngineError()
        }
    }

    func dismissPending() { dismissPendingCalls += 1 }
    func installAndRelaunch(_ update: DownloadedUpdate) { installAndRelaunchCalls.append(update) }
    func scheduleInstallOnQuit(_ update: DownloadedUpdate) { scheduleInstallOnQuitCalls.append(update) }
}

// MARK: 弹窗替身（记录请求 + 按剧本回选择；hold 模式供防重入测试）

@MainActor
final class RecordingPrompter: UpdatePrompter {
    private(set) var availableRequests: [UpdateDialogRequest] = []
    private(set) var downloadedRequests: [UpdateDialogRequest] = []
    var availableChoices: [UpdateAvailableChoice] = []
    var downloadedChoices: [UpdateDownloadedChoice] = []
    /// true = promptAvailable 挂起不回（防重入测试），经 releaseHeld 释放。
    var holdAvailable = false
    private var heldContinuations: [CheckedContinuation<UpdateAvailableChoice, Never>] = []

    func promptAvailable(_ request: UpdateDialogRequest) async -> UpdateAvailableChoice {
        availableRequests.append(request)
        if holdAvailable {
            return await withCheckedContinuation { heldContinuations.append($0) }
        }
        return availableChoices.isEmpty ? .snooze : availableChoices.removeFirst()
    }

    func promptDownloaded(_ request: UpdateDialogRequest) async -> UpdateDownloadedChoice {
        downloadedRequests.append(request)
        return downloadedChoices.isEmpty ? .installOnQuit : downloadedChoices.removeFirst()
    }

    func releaseHeld(with choice: UpdateAvailableChoice) {
        let held = heldContinuations
        heldContinuations = []
        for continuation in held { continuation.resume(returning: choice) }
    }
}

// MARK: 手动时钟

@MainActor
final class ManualUpdateClock: UpdateClock {
    final class Token: UpdateClockToken {
        var cancelled = false
        func cancel() { cancelled = true }
    }
    private struct Job {
        let dueAt: Date
        let token: Token
        let body: @MainActor () -> Void
    }

    private(set) var current = Date(timeIntervalSince1970: 1_700_000_000)
    private var jobs: [Job] = []
    var now: Date { current }

    @discardableResult
    func schedule(after seconds: TimeInterval, _ body: @escaping @MainActor () -> Void) -> UpdateClockToken {
        let token = Token()
        jobs.append(Job(dueAt: current.addingTimeInterval(seconds), token: token, body: body))
        return token
    }

    /// 快进并按到期序执行（含到期时刻相等者按登记序）。
    func advance(by seconds: TimeInterval) async {
        current = current.addingTimeInterval(seconds)
        while let index = jobs.firstIndex(where: { $0.dueAt <= current && !$0.token.cancelled }) {
            let job = jobs.remove(at: index)
            job.body()
            await settle()
        }
        jobs.removeAll { $0.token.cancelled }
        await settle()
    }

    /// 距下一个未取消任务的间隔（断言轮询间隔用）。
    var nextDueInterval: TimeInterval? {
        jobs.filter { !$0.token.cancelled }.map { $0.dueAt.timeIntervalSince(current) }.min()
    }
}

// MARK: 持久化/推送/dock/日志替身

@MainActor
final class MemoryDismissalStore: UpdateDismissalStore {
    var stored: UpdateDismissal?
    private(set) var saves: [UpdateDismissal] = []
    init(_ initial: UpdateDismissal? = nil) { stored = initial }
    func load() -> UpdateDismissal? { stored }
    func save(_ dismissal: UpdateDismissal) {
        stored = dismissal
        saves.append(dismissal)
    }
}

@MainActor
final class RecordingEventSink: UpdateEventSink {
    private(set) var events: [UpdateEvent] = []
    func emit(_ event: UpdateEvent) { events.append(event) }
    func downloadingFrames() -> [(Double, Int, Int, Int)] {
        events.compactMap {
            if case .downloading(let p, let t, let total, let bps) = $0 { return (p, t, total, bps) }
            return nil
        }
    }
}

@MainActor
final class RecordingDockSink: UpdateDockProgressSink {
    private(set) var fractions: [Double?] = []
    func setFraction(_ fraction: Double?) { fractions.append(fraction) }
}

final class SpyUpdateLogger: UpdateLogging, @unchecked Sendable {
    private let lock = NSLock()
    private var _lines: [String] = []
    var lines: [String] {
        lock.lock()
        defer { lock.unlock() }
        return _lines
    }
    func has(_ token: String) -> Bool { lines.contains { $0.contains(token) } }
    private func append(_ level: String, _ message: String) {
        lock.lock()
        _lines.append("[\(level)] \(message)")
        lock.unlock()
    }
    func info(_ message: String) { append("INFO", message) }
    func warn(_ message: String) { append("WARN", message) }
    func error(_ message: String) { append("ERROR", message) }
    func debug(_ message: String) { append("DEBUG", message) }
}

// MARK: 组装快捷

@MainActor
struct ControllerHarness {
    let engine = FakeUpdateEngine()
    let prompter = RecordingPrompter()
    let clock = ManualUpdateClock()
    let store: MemoryDismissalStore
    let events = RecordingEventSink()
    let dock = RecordingDockSink()
    let log = SpyUpdateLogger()
    let controller: UpdateController

    init(store initialStore: MemoryDismissalStore = MemoryDismissalStore(),
         timings: UpdateTimings = UpdateTimings()) {
        store = initialStore
        controller = UpdateController(
            engine: engine, prompter: prompter, clock: clock, store: store,
            events: events, dock: dock, log: log, timings: timings
        )
    }
}
