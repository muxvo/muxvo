// MuxvoPerfTests 共用替身：手动时钟 + 记录型 sink + 可编排采样器（比照 MuxvoUpdaterTests/UpdateTestDoubles）。
// 任何测试不 sleep 真实秒级——时序全经 ManualMemoryClock 快进。

import Foundation
@testable import MuxvoPerf

// MARK: 手动时钟

@MainActor
final class ManualMemoryClock: MemoryClock {
    final class Token: MemoryClockToken {
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

    @discardableResult
    func schedule(after seconds: TimeInterval, _ body: @escaping @MainActor () -> Void) -> MemoryClockToken {
        let token = Token()
        jobs.append(Job(dueAt: current.addingTimeInterval(seconds), token: token, body: body))
        return token
    }

    /// 快进并按到期序执行（含到期时刻相等者按登记序）。
    func advance(by seconds: TimeInterval) {
        current = current.addingTimeInterval(seconds)
        while let index = jobs.firstIndex(where: { $0.dueAt <= current && !$0.token.cancelled }) {
            let job = jobs.remove(at: index)
            job.body()
        }
        jobs.removeAll { $0.token.cancelled }
    }

    /// 距下一个未取消任务的间隔（断言周期间隔用）。
    var nextDueInterval: TimeInterval? {
        jobs.filter { !$0.token.cancelled }.map { $0.dueAt.timeIntervalSince(current) }.min()
    }
}

// MARK: 记录型警告 sink

@MainActor
final class RecordingWarningSink: MemoryWarningSink {
    private(set) var warnings: [MemoryWarning] = []
    func emit(_ warning: MemoryWarning) { warnings.append(warning) }
}

// MARK: 可编排采样器（内存字节可设、可数被采样次数）

@MainActor
final class StubMemorySampler: MemorySampler {
    var bytes: Int
    var stubMetrics: PerfMetrics
    private(set) var sampleCalls = 0

    init(
        bytes: Int = 0,
        metrics: PerfMetrics = PerfMetrics(memoryUsageMB: 0, terminalCount: 0, bufferLines: BufferLineMetrics(focused: 0, background: []))
    ) {
        self.bytes = bytes
        self.stubMetrics = metrics
    }

    func sampleBytes() -> Int {
        sampleCalls += 1
        return bytes
    }

    func metrics() -> PerfMetrics { stubMetrics }
}
