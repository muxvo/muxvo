// bench_vt_ingest（M1 任务 14）：bytes → vt 解析 → render state 快照的 ingest 延迟基准。
// bench_input_to_pixel（p99<16ms 全链路）经用户裁决推迟 M3（与渲染重构同 PR），
// 本基准覆盖其中纯 CPU 段（vt 状态机 + render state 提取），保住 M0→M3 的 bench 续航。
//
// 测量协议：
// - 素材 = loads/cast/ 真实 CC 回放（asciinema v2），CastReplayer 仅做解析，
//   直接迭代 events 不走 pacing 线程——确定性、秒级跑完
// - 每 (cast × run) 新建隔离会话（spawnShell:false），防 scrollback 跨 run 污染
// - feed 样本 = 单个 "o" 事件经 session.feed（queue.sync 同步）的耗时
// - update 样本 = ghostty_render_state_update 耗时，按 cast 原始时间轴 60Hz 帧窗口
//   聚簇：仅「有数据的帧」调一次（CC 回放有大段思考空窗，全刻度调用会塞进
//   海量 no-op 样本稀释 p99），末尾补一次收尾 update
import CGhosttyVT
import Foundation

public enum IngestBench {
    public struct Distribution {
        public let count: Int
        public let p50Ms: Double
        public let p95Ms: Double
        public let p99Ms: Double
        public let maxMs: Double
        public let meanMs: Double
    }

    public struct RunResult {
        public let bytesFed: UInt64
        public let wallSeconds: Double
        public let activeFrames: Int
        /// 跑完后整屏 dump 的字节数（>0 = 内容真的进了 vt，防空转假数据）
        public let finalDumpBytes: Int
    }

    public struct Result {
        public let castPath: String
        public let cols: UInt16
        public let rows: UInt16
        public let eventCount: Int
        public let castDurationSeconds: Double
        public let runs: [RunResult]
        public let feed: Distribution
        public let update: Distribution
    }

    /// 60Hz 帧窗口（按 cast 原始时间轴聚簇 render state update）
    public static let frameWindowSeconds = 1.0 / 60.0

    public static func run(
        castPath: String,
        runs: Int = 3,
        maxScrollbackLines: Int = 10_000
    ) throws -> Result {
        let replayer = try CastReplayer(path: castPath)
        var feedMs: [Double] = []
        var updateMs: [Double] = []
        feedMs.reserveCapacity(replayer.events.count * runs)
        var runResults: [RunResult] = []

        for runIdx in 0..<runs {
            let session = try TerminalSession(
                cols: replayer.cols, rows: replayer.rows,
                maxScrollbackLines: maxScrollbackLines,
                spawnShell: false, label: "ingest\(runIdx)")
            defer { session.close() } // defer 在每轮迭代末执行

            var st: OpaquePointer?
            guard ghostty_render_state_new(nil, &st) == GHOSTTY_SUCCESS, let st else {
                throw ProbeError.ghosttyFailed("render_state_new failed")
            }
            defer { ghostty_render_state_free(st) }

            var currentWindow = -1
            var fedInWindow = false
            var activeFrames = 0
            let runStart = DispatchTime.now()

            for ev in replayer.events {
                let w = Int(ev.t / Self.frameWindowSeconds)
                if w != currentWindow {
                    if fedInWindow {
                        let t0 = DispatchTime.now()
                        _ = session.updateRenderState(st)
                        updateMs.append(Self.elapsedMs(since: t0))
                        activeFrames += 1
                    }
                    currentWindow = w
                    fedInWindow = false
                }
                let t0 = DispatchTime.now()
                session.feed(ev.bytes)
                feedMs.append(Self.elapsedMs(since: t0))
                fedInWindow = true
            }
            if fedInWindow { // 收尾：最后一个活跃帧
                let t0 = DispatchTime.now()
                _ = session.updateRenderState(st)
                updateMs.append(Self.elapsedMs(since: t0))
                activeFrames += 1
            }

            let wall = Double(DispatchTime.now().uptimeNanoseconds - runStart.uptimeNanoseconds) / 1e9
            runResults.append(RunResult(
                bytesFed: session.bytesFed,
                wallSeconds: wall,
                activeFrames: activeFrames,
                finalDumpBytes: session.dumpPlainText().utf8.count))
        }

        return Result(
            castPath: castPath,
            cols: replayer.cols, rows: replayer.rows,
            eventCount: replayer.events.count,
            castDurationSeconds: replayer.duration,
            runs: runResults,
            feed: Self.distribution(of: feedMs),
            update: Self.distribution(of: updateMs))
    }

    private static func elapsedMs(since t0: DispatchTime) -> Double {
        Double(DispatchTime.now().uptimeNanoseconds - t0.uptimeNanoseconds) / 1e6
    }

    /// 最近秩百分位，与 ProbeRendererMetal/FrameMetrics.percentile 同口径
    /// （刻意不依赖该 target——会拖进 Metal/AppKit，10 行内联划算）
    static func percentile(_ sorted: [Double], _ p: Double) -> Double {
        guard !sorted.isEmpty else { return 0 }
        let idx = Int((Double(sorted.count - 1) * p).rounded())
        return sorted[idx]
    }

    static func distribution(of samples: [Double]) -> Distribution {
        let sorted = samples.sorted()
        let mean = samples.isEmpty ? 0 : samples.reduce(0, +) / Double(samples.count)
        return Distribution(
            count: samples.count,
            p50Ms: percentile(sorted, 0.50),
            p95Ms: percentile(sorted, 0.95),
            p99Ms: percentile(sorted, 0.99),
            maxMs: sorted.last ?? 0,
            meanMs: mean)
    }
}
