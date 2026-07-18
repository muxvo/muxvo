// 内存监控 spec 归属 + RED-GREEN（M7 批4）。
// 规格：specs/legacy/l1/cross.spec.json（PERF_L1_01/PERF_L1_02）+ l2/perf-thresholds.spec.json
// （PERF_L2_01/PERF_L2_02）。阈值/文案硬编码字面量断言（禁 import 生产常量比常量，防互抄回路）。

import Foundation
import Testing
@testable import MuxvoPerf

@Suite("内存监控（M7 批4）")
@MainActor
struct MemoryMonitorTests {

    private func makeMonitor(
        sampler: StubMemorySampler,
        sink: RecordingWarningSink,
        clock: ManualMemoryClock,
        timings: MemoryTimings = MemoryTimings()
    ) -> MemoryMonitor {
        MemoryMonitor(sampler: sampler, sink: sink, clock: clock, timings: timings)
    }

    @Test("PERF_L2_01: 内存检查间隔 60s＝60000ms，start() 后每 60s 触发一次检查（注入时钟）")
    func checkIntervalSixtySeconds() {
        // 阈值常量字面量（perf-thresholds.spec.json PERF_L2_01）。
        #expect(MemoryTimings().checkIntervalMs == 60_000)
        #expect(MemoryTimings().checkInterval == 60)

        // 注入时钟：start() 排下一次在 60s 后；未到不检查、到点检查、链式续排。
        let sampler = StubMemorySampler(bytes: 3_000_000_000) // 高内存，采样即触发（隔离间隔面）
        let clock = ManualMemoryClock()
        let monitor = makeMonitor(sampler: sampler, sink: RecordingWarningSink(), clock: clock)
        monitor.start()
        #expect(sampler.sampleCalls == 0)          // start() 本身不立即检查
        #expect(clock.nextDueInterval == 60)       // 下一次恰在 60s 后
        clock.advance(by: 59)
        #expect(sampler.sampleCalls == 0)          // 未到 60s 不检查
        clock.advance(by: 1)
        #expect(sampler.sampleCalls == 1)          // 到 60s 检查一次
        clock.advance(by: 60)
        #expect(sampler.sampleCalls == 2)          // 链式续排，再 60s 第二次
    }

    @Test("PERF_L2_02: 阈值 2GB＝2147483648 bytes，currentMemory > threshold 才警告（黄色图标数据源；严格大于边界）")
    func warningThresholdTwoGigabytes() {
        // 阈值常量字面量（perf-thresholds.spec.json PERF_L2_02 = 2 * 1024 * 1024 * 1024）。
        #expect(MemoryTimings().warningThresholdBytes == 2_147_483_648)

        let clock = ManualMemoryClock()

        // 恰在阈值：不警告（严格大于，比照旧 performance/monitor.ts shouldShowMemoryWarning）。
        let atSink = RecordingWarningSink()
        let atSampler = StubMemorySampler(bytes: 2_147_483_648)
        makeMonitor(sampler: atSampler, sink: atSink, clock: clock).checkNow()
        #expect(atSink.warnings.isEmpty)

        // 超阈值 1 字节：警告触发（黄色警告图标的数据源）。
        let overSink = RecordingWarningSink()
        let overSampler = StubMemorySampler(bytes: 2_147_483_649)
        makeMonitor(sampler: overSampler, sink: overSink, clock: clock).checkNow()
        #expect(overSink.warnings.count == 1)
    }

    @Test("PERF_L1_02: 内存超 2GB 推送警告，载荷 {currentMemoryMB, threshold=2048, message}＋文案「内存占用较高，建议关闭部分终端」（RED-GREEN）")
    func memoryPressurePushesWarning() {
        let clock = ManualMemoryClock()

        // RED：内存低于阈值 → 零推送。
        let calmSink = RecordingWarningSink()
        makeMonitor(sampler: StubMemorySampler(bytes: 1_000_000_000), sink: calmSink, clock: clock).checkNow()
        #expect(calmSink.warnings.isEmpty)

        // GREEN：注入内存压力（2.5GB）→ 推送一条，载荷逐字。
        let hotSink = RecordingWarningSink()
        // 2.5 GiB = 2684354560 bytes → 2560 MB。
        makeMonitor(sampler: StubMemorySampler(bytes: 2_684_354_560), sink: hotSink, clock: clock).checkNow()
        #expect(hotSink.warnings.count == 1)
        let warning = hotSink.warnings[0]
        #expect(warning.currentMemoryMB == 2560)
        #expect(warning.threshold == 2048)   // 阈值 MB（2GB）
        #expect(warning.message == "内存占用较高，建议关闭部分终端")
    }

    @Test("PERF_L1_01: 性能指标格式 {memoryUsageMB, terminalCount, bufferLines{focused, background[]}}")
    func perfMetricsFormat() {
        let sampler = StubMemorySampler(metrics: PerfMetrics(
            memoryUsageMB: 512,
            terminalCount: 3,
            bufferLines: BufferLineMetrics(focused: 10_000, background: [1000, 1000])))
        let monitor = makeMonitor(sampler: sampler, sink: RecordingWarningSink(), clock: ManualMemoryClock())
        let metrics = monitor.currentMetrics()
        #expect(metrics.memoryUsageMB == 512)
        #expect(metrics.terminalCount == 3)
        #expect(metrics.bufferLines.focused == 10_000)
        #expect(metrics.bufferLines.background == [1000, 1000])
    }
}
