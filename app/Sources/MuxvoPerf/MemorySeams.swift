// 内存监控——接缝与数据形状（M7 批4；specs/legacy/l1/cross.spec.json PERF_L1_01/APP_L1_05、
// specs/legacy/l2/perf-thresholds.spec.json PERF_L2_01/02）。纯 Foundation 零 AppKit 零 vendor
// （单测免链 libghostty，秒级）；采样（process memory）/推送（data.event memoryWarning）/时钟
// 生产实现经此协议注入，落 MuxvoAppCore 装配（MemoryAssembly，比照 MuxvoUpdater/UpdateSeams）。
//
// 核心原则一：从行为规格实现，不继承旧 Electron 结构——旧版 memory-monitor.ts / metrics.ts /
// performance/monitor.ts 只作行为说明书。旧病根（浏览器画终端致内存 1-2GB）新架构 Metal 直渲已
// 根治；本监控是「≥阈值给人眼警告」的观察面，非病根补丁。

import Foundation

// MARK: - 性能指标格式（PERF_L1_01：{memoryUsageMB, terminalCount, bufferLines{focused, background[]}}）

/// 缓冲区行数指标：聚焦终端行数 + 各后台终端行数数组（旧 metrics.ts bufferLines 同形）。
public struct BufferLineMetrics: Equatable, Sendable {
    public let focused: Int
    public let background: [Int]
    public init(focused: Int, background: [Int]) {
        self.focused = focused
        self.background = background
    }
}

/// 性能指标快照（PERF_L1_01 格式合同）。memoryUsageMB = 进程常驻内存 MB；terminalCount/bufferLines
/// 为观察面字段（旧 getPerformanceMetrics 硬编码 0/空，本实现经采样器注入，缺席默认同旧）。
public struct PerfMetrics: Equatable, Sendable {
    public let memoryUsageMB: Int
    public let terminalCount: Int
    public let bufferLines: BufferLineMetrics
    public init(memoryUsageMB: Int, terminalCount: Int, bufferLines: BufferLineMetrics) {
        self.memoryUsageMB = memoryUsageMB
        self.terminalCount = terminalCount
        self.bufferLines = bufferLines
    }
}

// MARK: - 内存警告推送载荷（APP_L1_05 / PERF_L1_02：{currentMemoryMB, threshold, message}）

/// 内存警告值（生产经 MemoryAssembly 译成 data.event memoryWarning 全窗广播）。
/// - currentMemoryMB：当前进程常驻内存（MB，向下取整）。
/// - threshold：阈值（MB，= 2048 = 2GB；wire 面与旧 payload.threshold 对齐取 MB 非字节）。
/// - message：面向人眼的文案（PERF_L1_02 冻结「内存占用较高，建议关闭部分终端」）。
public struct MemoryWarning: Equatable, Sendable {
    public let currentMemoryMB: Int
    public let threshold: Int
    public let message: String
    public init(currentMemoryMB: Int, threshold: Int, message: String) {
        self.currentMemoryMB = currentMemoryMB
        self.threshold = threshold
        self.message = message
    }
}

// MARK: - 采样器（生产 = mach task_info 常驻内存 + 终端计数注入；测试注假体）

@MainActor
public protocol MemorySampler: AnyObject {
    /// 当前进程常驻内存字节数（阈值判定面，PERF_L2_02 以字节比较）。
    func sampleBytes() -> Int
    /// 性能指标快照（PERF_L1_01 格式）。
    func metrics() -> PerfMetrics
}

// MARK: - 警告推送 sink（生产 = data.event memoryWarning 广播；测试注记录型替身）

@MainActor
public protocol MemoryWarningSink: AnyObject {
    func emit(_ warning: MemoryWarning)
}

// MARK: - 时钟（60s 间隔经此注入；测试假时钟直进，任何测试不 sleep 真实秒级——比照 UpdateClock）

public protocol MemoryClockToken: AnyObject {
    func cancel()
}

@MainActor
public protocol MemoryClock: AnyObject {
    @discardableResult
    func schedule(after seconds: TimeInterval, _ body: @escaping @MainActor () -> Void) -> MemoryClockToken
}

// MARK: - 阈值与节律（PERF_L2_01 间隔 60s / PERF_L2_02 阈值 2GB=2147483648 bytes）

public struct MemoryTimings: Sendable {
    /// 内存检查间隔（PERF_L2_01 = 60000ms）。
    public var checkIntervalMs: Int
    /// 内存警告阈值（PERF_L2_02 = 2147483648 bytes = 2GB）。
    public var warningThresholdBytes: Int
    public init(checkIntervalMs: Int = 60_000, warningThresholdBytes: Int = 2_147_483_648) {
        self.checkIntervalMs = checkIntervalMs
        self.warningThresholdBytes = warningThresholdBytes
    }

    /// 调度用秒制间隔。
    public var checkInterval: TimeInterval { Double(checkIntervalMs) / 1000 }
    /// 推送载荷用 MB 阈值（2147483648 / 1MiB = 2048）。
    public var thresholdMB: Int { warningThresholdBytes / (1024 * 1024) }
}
