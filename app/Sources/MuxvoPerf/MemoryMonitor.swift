// 内存监控控制器（M7 批4）：每 60s 采样进程内存，超 2GB 阈值即推送人眼警告。
// 全接缝注入（MemorySeams.swift），自身不碰 mach/AppKit/桥——生产采样器/推送/时钟落 MuxvoAppCore 装配。
//
// 规格锚：
//   PERF_L2_01 内存检查间隔 60s（timings.checkInterval）
//   PERF_L2_02 阈值 2GB=2147483648 bytes，currentMemory > threshold → 警告（严格大于，比照旧
//              performance/monitor.ts shouldShowMemoryWarning）
//   PERF_L1_02 超 2GB 推送警告，文案「内存占用较高，建议关闭部分终端」
//   APP_L1_05  推送格式 {currentMemoryMB, threshold, message}（译成 data.event 落装配层）
//   PERF_L1_01 性能指标格式经 currentMetrics() 暴露

import Foundation

@MainActor
public final class MemoryMonitor {
    /// 内存警告文案（PERF_L1_02 冻结）。
    public static let warningMessage = "内存占用较高，建议关闭部分终端"

    private let sampler: MemorySampler
    private let sink: MemoryWarningSink
    private let clock: MemoryClock
    private let timings: MemoryTimings
    private var pollToken: MemoryClockToken?

    public init(
        sampler: MemorySampler,
        sink: MemoryWarningSink,
        clock: MemoryClock,
        timings: MemoryTimings = MemoryTimings()
    ) {
        self.sampler = sampler
        self.sink = sink
        self.clock = clock
        self.timings = timings
    }

    // MARK: 检查节律（PERF_L2_01）

    /// 启动周期检查（每 checkInterval 一次；比照 UpdateController 轮询链式重排）。
    public func start() {
        scheduleNextCheck()
    }

    /// 立即检查一次（手动/测试入口，不排下一次）。
    public func checkNow() {
        performCheck()
    }

    /// 停止周期检查。
    public func stop() {
        pollToken?.cancel()
        pollToken = nil
    }

    private func scheduleNextCheck() {
        pollToken = clock.schedule(after: timings.checkInterval) { [weak self] in
            guard let self else { return }
            self.performCheck()
            self.scheduleNextCheck()
        }
    }

    // MARK: 阈值判定与推送（PERF_L2_02 / PERF_L1_02 / APP_L1_05）

    private func performCheck() {
        let bytes = sampler.sampleBytes()
        // 严格大于阈值才警告（PERF_L2_02 rule: currentMemory > threshold）。
        guard bytes > timings.warningThresholdBytes else { return }
        let warning = MemoryWarning(
            currentMemoryMB: bytes / (1024 * 1024),
            threshold: timings.thresholdMB,
            message: Self.warningMessage
        )
        sink.emit(warning)
    }

    // MARK: 性能指标（PERF_L1_01）

    /// 当前性能指标快照。
    public func currentMetrics() -> PerfMetrics {
        sampler.metrics()
    }
}
