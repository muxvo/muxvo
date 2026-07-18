// 内存监控生产装配（M7 批4）：MuxvoPerf 纯核 → 真采样（mach task_info）/真时钟（Timer）/
// data.event memoryWarning 全窗广播的接线。比照 UpdateAssembly（纯核在 MuxvoUpdater，装配在此）。
//
// 规格锚：APP_L1_05（memoryWarning 推送格式 {currentMemoryMB, threshold, message}）、
// PERF_L1_01/L1_02/L2_01/L2_02（间隔/阈值/文案——纯核 MuxvoPerf 承载）。
// web 黄色警告图标消费面尚未接（本批 native + 桥类型激活；web 侧 subscribeDataEvent 遇未知 kind
// 静默忽略，无 golden 影响）——登记 V1.1 remaining。

import Foundation
import Darwin
import MuxvoBridge
import MuxvoPerf

// MARK: 真时钟（60s 周期经 Timer 排期；比照 RealUpdateClock）

@MainActor
final class RealMemoryClock: MemoryClock {
    private final class Token: MemoryClockToken {
        weak var timer: Timer?
        init(timer: Timer) { self.timer = timer }
        func cancel() { timer?.invalidate() }
    }

    @discardableResult
    func schedule(after seconds: TimeInterval, _ body: @escaping @MainActor () -> Void) -> MemoryClockToken {
        let timer = Timer.scheduledTimer(withTimeInterval: max(seconds, 0), repeats: false) { _ in
            MainActor.assumeIsolated { body() }
        }
        return Token(timer: timer)
    }
}

// MARK: 真采样器（mach 常驻内存 + 终端计数/缓冲行数注入）

@MainActor
final class ProcessMemorySampler: MemorySampler {
    private let terminalCountProvider: @MainActor () -> Int
    private let bufferLinesProvider: @MainActor () -> BufferLineMetrics

    init(
        terminalCount: @escaping @MainActor () -> Int = { 0 },
        bufferLines: @escaping @MainActor () -> BufferLineMetrics = { BufferLineMetrics(focused: 0, background: []) }
    ) {
        self.terminalCountProvider = terminalCount
        self.bufferLinesProvider = bufferLines
    }

    func sampleBytes() -> Int {
        Self.residentBytes()
    }

    func metrics() -> PerfMetrics {
        PerfMetrics(
            memoryUsageMB: Self.residentBytes() / (1024 * 1024),
            terminalCount: terminalCountProvider(),
            bufferLines: bufferLinesProvider()
        )
    }

    /// 进程常驻内存字节数（proc_pid_rusage ri_resident_size）；失败回 0（保守，不误警告）。
    /// 取 proc_pid_rusage 而非 task_info：后者需读全局可变 var mach_task_self_，触 Swift 严格并发红。
    static func residentBytes() -> Int {
        var info = rusage_info_current()
        let kr = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: rusage_info_t?.self, capacity: 1) {
                proc_pid_rusage(getpid(), RUSAGE_INFO_CURRENT, $0)
            }
        }
        return kr == 0 ? Int(info.ri_resident_size) : 0
    }
}

// MARK: 推送 sink（MemoryWarning → data.event memoryWarning 全窗广播）

@MainActor
public final class BroadcastMemoryWarningSink: MemoryWarningSink {
    private weak var windowManager: WindowManager?
    public init(windowManager: WindowManager) { self.windowManager = windowManager }

    public func emit(_ warning: MemoryWarning) {
        windowManager?.broadcastDataEvent(MemoryAssembly.dataEvent(for: warning))
    }
}

// MARK: 装配根

public enum MemoryAssembly {
    /// MemoryWarning → data.event memoryWarning 译码（APP_L1_05 推送格式）。
    public static func dataEvent(for warning: MemoryWarning) -> DataEvent {
        .memoryWarning(
            currentMemoryMB: warning.currentMemoryMB,
            threshold: warning.threshold,
            message: warning.message
        )
    }

    /// 生产内存监控（真采样/真时钟/广播 sink）。调用方持有并 start()。
    @MainActor
    public static func make(
        windowManager: WindowManager,
        terminalCount: @escaping @MainActor () -> Int = { 0 },
        timings: MemoryTimings = MemoryTimings()
    ) -> MemoryMonitor {
        MemoryMonitor(
            sampler: ProcessMemorySampler(terminalCount: terminalCount),
            sink: BroadcastMemoryWarningSink(windowManager: windowManager),
            clock: RealMemoryClock(),
            timings: timings
        )
    }
}
