// FrameMetrics：帧间隔/编码耗时/GPU 耗时的采样与分位数统计。
// KPI：p99 帧间隔 < 16.7ms × 1.1（ProMotion 屏 preferredFramesPerSecond 钉 60）。
import Foundation

public struct FrameMetrics: Sendable {
    public private(set) var intervalsMS: [Double] = []
    public private(set) var encodeMS: [Double] = []
    public private(set) var gpuMS: [Double] = []
    public private(set) var firstFrameLatencyMS: [Double] = [] // 每次 attach 一条

    public init() {}

    public mutating func addInterval(_ ms: Double) { intervalsMS.append(ms) }
    public mutating func addEncode(_ ms: Double) { encodeMS.append(ms) }
    public mutating func addGPU(_ ms: Double) { gpuMS.append(ms) }
    public mutating func addFirstFrame(_ ms: Double) { firstFrameLatencyMS.append(ms) }

    public mutating func reset() {
        intervalsMS.removeAll(keepingCapacity: true)
        encodeMS.removeAll(keepingCapacity: true)
        gpuMS.removeAll(keepingCapacity: true)
    }

    public static func percentile(_ sorted: [Double], _ p: Double) -> Double {
        guard !sorted.isEmpty else { return 0 }
        let idx = Int((Double(sorted.count - 1) * p).rounded())
        return sorted[idx]
    }

    /// 汇总为 JSON 友好的字典
    public func summary() -> [String: Any] {
        func stats(_ xs: [Double]) -> [String: Any] {
            guard !xs.isEmpty else { return ["count": 0] }
            let s = xs.sorted()
            return [
                "count": xs.count,
                "p50": r(Self.percentile(s, 0.50)),
                "p95": r(Self.percentile(s, 0.95)),
                "p99": r(Self.percentile(s, 0.99)),
                "max": r(s.last!),
                "mean": r(xs.reduce(0, +) / Double(xs.count)),
            ]
        }
        func r(_ x: Double) -> Double { (x * 1000).rounded() / 1000 }
        var out: [String: Any] = [
            "frame_interval_ms": stats(intervalsMS),
            "encode_cpu_ms": stats(encodeMS),
            "gpu_ms": stats(gpuMS),
        ]
        if !firstFrameLatencyMS.isEmpty {
            out["first_frame_latency_ms"] = firstFrameLatencyMS.map { r($0) }
        }
        return out
    }
}
