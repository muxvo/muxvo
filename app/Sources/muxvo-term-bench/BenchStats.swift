// bench_input_to_pixel 统计与报告（terminal-rendering.md §8）。
//
// 纯逻辑（无 AppKit/GPU）：把逐样本纳秒延迟折算 ms，算 nearest-rank 百分位，
// 组装 JSON + markdown 报告，输出 PASS/FAIL 判据说明。判据（§8）：
//   - 硬线：p99 < 16ms。
//   - 相对退步线：p99 > max(16ms, 基线×1.25) 即红（首基线无前值 → 仅硬线）。
import Foundation

/// 一路延迟样本的百分位摘要（单位 ms）。
struct LatencySummary {
    let count: Int          // 有效样本数
    let dropped: Int        // 未在超时内落帧的样本数
    let p50: Double
    let p95: Double
    let p99: Double
    let min: Double
    let max: Double
    let mean: Double

    /// nearest-rank 百分位（样本为 ms，升序）。空样本返回全 0。
    static func make(msSamples raw: [Double], dropped: Int) -> LatencySummary {
        let s = raw.sorted()
        guard !s.isEmpty else {
            return LatencySummary(count: 0, dropped: dropped, p50: 0, p95: 0, p99: 0, min: 0, max: 0, mean: 0)
        }
        func pct(_ p: Double) -> Double {
            let rank = Int((p / 100.0 * Double(s.count)).rounded(.up))
            return s[Swift.min(Swift.max(rank - 1, 0), s.count - 1)]
        }
        return LatencySummary(
            count: s.count, dropped: dropped,
            p50: pct(50), p95: pct(95), p99: pct(99),
            min: s.first!, max: s.last!,
            mean: s.reduce(0, +) / Double(s.count))
    }

    func asDict() -> [String: Any] {
        [
            "count": count, "dropped": dropped,
            "p50_ms": round4(p50), "p95_ms": round4(p95), "p99_ms": round4(p99),
            "min_ms": round4(min), "max_ms": round4(max), "mean_ms": round4(mean),
        ]
    }
}

private func round4(_ x: Double) -> Double { (x * 10000).rounded() / 10000 }

/// 一次 bench 运行的完整取证记录。
struct BenchRunResult {
    let scene: String
    let mode: String            // "gpu" | "cpu-segment"
    let judged: Bool            // gpu 场景才对 p99<16ms 判红；cpu-segment 降级不判
    let keys: Int
    let spacingMs: Int
    let cols: Int
    let rows: Int
    let scale: Double
    let cellWidthPx: Int
    let cellHeightPx: Int
    let drawableWidthPx: Int
    let drawableHeightPx: Int
    /// 主判据延迟（gpu 模式=注键→GPU 完成；cpu-segment=注键→快照发布）。
    let primary: LatencySummary
    /// 参考列（gpu 模式=注键→快照发布 CPU 段；cpu-segment 与 primary 同）。
    let publish: LatencySummary
    let perSampleMs: [Double?]  // 逐样本 primary（nil=drop），完整留档

    static let hardLineMs = 16.0

    /// 判据结果：gpu 且 p99<16ms → PASS；gpu 且 ≥16ms → FAIL；cpu-segment → nil（降级不判）。
    var pass: Bool? {
        guard judged else { return nil }
        return primary.p99 < Self.hardLineMs
    }

    func verdictLine(baselineP99: Double?) -> String {
        guard judged else {
            return "判据：cpu-segment 降级基线（无 GPU present），p99<16ms 硬线待 GUI 环境补 GPU 段。"
        }
        let regressionLine = max(Self.hardLineMs, (baselineP99 ?? 0) * 1.25)
        let hard = primary.p99 < Self.hardLineMs
        let reg = baselineP99 == nil ? true : primary.p99 <= regressionLine
        let ok = hard && reg
        var parts = ["硬线 p99<16ms：\(hard ? "PASS" : "FAIL")（实测 \(round4(primary.p99))ms）"]
        if let b = baselineP99 {
            parts.append("退步线 p99≤max(16, \(round4(b))×1.25=\(round4(regressionLine)))ms：\(reg ? "PASS" : "FAIL")")
        } else {
            parts.append("退步线：首基线无前值，仅硬线生效")
        }
        return "判据：\(ok ? "🟢 PASS" : "🔴 FAIL") —— " + parts.joined(separator: "；")
    }

    func asJSON() -> String {
        let dict: [String: Any] = [
            "bench": "bench_input_to_pixel",
            "scene": scene,
            "mode": mode,
            "judged": judged,
            "keys": keys,
            "spacing_ms": spacingMs,
            "grid": ["cols": cols, "rows": rows],
            "scale": scale,
            "cell_px": ["w": cellWidthPx, "h": cellHeightPx],
            "drawable_px": ["w": drawableWidthPx, "h": drawableHeightPx],
            "primary": primary.asDict(),
            "publish_reference": publish.asDict(),
            "pass": pass as Any,
            "per_sample_ms": perSampleMs.map { $0.map { ($0 * 10000).rounded() / 10000 } as Any? ?? NSNull() },
        ]
        guard let data = try? JSONSerialization.data(
            withJSONObject: dict, options: [.prettyPrinted, .sortedKeys])
        else { return "{}" }
        return String(decoding: data, as: UTF8.self)
    }

    /// 人读摘要（stdout + markdown 报告头）。
    func summaryMarkdown(baselineP99: Double?) -> String {
        func row(_ label: String, _ s: LatencySummary) -> String {
            "| \(label) | \(s.count) | \(s.dropped) | \(round4(s.p50)) | \(round4(s.p95)) | **\(round4(s.p99))** | \(round4(s.max)) | \(round4(s.mean)) |"
        }
        return """
        ## \(scene) 场景 · \(mode) 模式

        - 网格 \(cols)×\(rows) @\(scale)x，cell \(cellWidthPx)×\(cellHeightPx)px，drawable \(drawableWidthPx)×\(drawableHeightPx)px
        - 击键 N=\(keys)，间距 \(spacingMs)ms
        - \(verdictLine(baselineP99: baselineP99))

        | 路径 | 样本 | drop | p50 | p95 | p99 | max | mean |
        |---|---|---|---|---|---|---|---|
        \(row("primary（注键→\(judged ? "GPU 完成" : "快照发布")）", primary))
        \(row("参考（注键→快照发布 CPU 段）", publish))
        """
    }
}
