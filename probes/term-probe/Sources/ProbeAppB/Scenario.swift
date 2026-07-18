// ProbeAppB 场景：探针 2 的「有视图」侧验证（清单 2/3/5 + FPS 指标）。
// 自动化流程（全部主线程 async，与 MTKView 60fps draw 交错执行）：
//   Phase 0  建窗口 + 4 视图（2×2，刻意不同尺寸）+ 20 会话标准混布（ccmix）
//   Phase A  轮换 attach：每 2s 全部 4 视图换会话，采 FPS/首帧/内存
//   Phase B  内容校验：marker 会话 attach 后经 render state 读回文本断言
//   Phase C  detach/attach ×100 泄漏检验：footprint 回落
//   Phase D  双视图同会话 + 三种尺寸仲裁策略（lastWins / minEnvelope / primary）
// 产出 JSON 报告（reports/raw/appb-*.json）后自动退出。
import AppKit
import Metal
import ProbeCore
import ProbeRendererMetal

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow!
    private var views: [TerminalMetalView] = []
    private var sessions: [TerminalSession] = []
    private var replayers: [CastReplayer] = []
    private var markerSession: TerminalSession?
    private var report: [String: Any] = [:]

    // CLI 参数
    private let rotationSeconds: Int
    private let cycleCount: Int
    private let sessionCount: Int
    private let reportPath: String?

    override init() {
        var seconds = 60
        var cycles = 100
        var count = 20
        var path: String?
        let args = Array(CommandLine.arguments.dropFirst())
        var i = 0
        while i < args.count {
            switch args[i] {
            case "--seconds":
                i += 1
                seconds = i < args.count ? Int(args[i]) ?? seconds : seconds
            case "--cycles":
                i += 1
                cycles = i < args.count ? Int(args[i]) ?? cycles : cycles
            case "--sessions":
                i += 1
                count = i < args.count ? Int(args[i]) ?? count : count
            case "--report":
                i += 1
                path = i < args.count ? args[i] : nil
            default:
                break
            }
            i += 1
        }
        self.rotationSeconds = seconds
        self.cycleCount = cycles
        self.sessionCount = count
        self.reportPath = path
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        Task { @MainActor in
            do {
                try await runScenario()
                finish(exitCode: 0)
            } catch {
                FileHandle.standardError.write("scenario failed: \(error)\n".data(using: .utf8)!)
                finish(exitCode: 1)
            }
        }
    }

    private func finish(exitCode: Int32) {
        replayers.forEach { $0.stop() }
        views.forEach { $0.detachSession() }
        sessions.forEach { $0.close() }
        markerSession?.close()
        writeReport()
        exit(exitCode)
    }

    private func writeReport() {
        guard let data = try? JSONSerialization.data(
            withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
        else { return }
        let json = String(decoding: data, as: UTF8.self)
        print(json)
        let root = probeRootDir()
        let dir = root + "/reports/raw"
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        let fmt = DateFormatter()
        fmt.dateFormat = "yyyyMMdd-HHmmss"
        let path = reportPath ?? dir + "/appb-\(fmt.string(from: Date())).json"
        try? (json + "\n").write(toFile: path, atomically: true, encoding: .utf8)
        FileHandle.standardError.write("report written: \(path)\n".data(using: .utf8)!)
    }

    // MARK: - 场景主流程

    private func runScenario() async throws {
        report["probe"] = "term-probe appb"
        report["sessions"] = sessionCount
        report["rotation_seconds"] = rotationSeconds
        report["cycles"] = cycleCount

        // Phase 0：窗口 + 视图 + 会话
        guard let device = MTLCreateSystemDefaultDevice() else {
            throw ProbeError.ghosttyFailed("no Metal device")
        }
        let atlas = GlyphAtlas(device: device)
        report["cell_px"] = ["w": atlas.cellW, "h": atlas.cellH]

        let rect = NSRect(x: 80, y: 80, width: 1560, height: 980)
        window = NSWindow(contentRect: rect, styleMask: [.titled], backing: .buffered, defer: false)
        window.title = "Muxvo term-probe B"
        let content = window.contentView!
        // 刻意不同尺寸的 4 视图：左列宽、右列窄（仲裁实验要求两个视图网格不同）
        let frames = [
            NSRect(x: 0, y: 490, width: 900, height: 490),
            NSRect(x: 900, y: 490, width: 660, height: 490),
            NSRect(x: 0, y: 0, width: 900, height: 490),
            NSRect(x: 900, y: 0, width: 660, height: 490),
        ]
        for (i, f) in frames.enumerated() {
            let v = TerminalMetalView(frame: f, device: device, atlas: atlas, viewID: i)
            content.addSubview(v)
            views.append(v)
        }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        try await sleepMS(800)
        let baselineMB = Metrics.physFootprintMB()
        report["footprint_baseline_mb"] = round2(baselineMB)

        // 20 会话标准混布
        let loadsDir = probeRootDir() + "/loads"
        let castDir = loadsDir + "/cast"
        let castFiles = ((try? FileManager.default.contentsOfDirectory(atPath: castDir)) ?? [])
            .filter { $0.hasSuffix(".cast") }.sorted().map { castDir + "/" + $0 }
        guard !castFiles.isEmpty else {
            throw ProbeError.spawnFailed("no .cast files in \(castDir)")
        }
        var castIdx = 0
        for idx in 0..<sessionCount {
            let kind = LoadKind.ccmix.resolved(forIndex: idx)
            let s = try TerminalSession(
                cols: 120, rows: 40, maxScrollbackLines: 10_000,
                spawnShell: kind != .cast, label: "appb\(idx)")
            sessions.append(s)
            if kind == .cast {
                let r = try CastReplayer(path: castFiles[castIdx % castFiles.count])
                castIdx += 1
                r.start(into: s, speed: 10, loop: true)
                replayers.append(r)
            }
        }
        try await sleepMS(1000)
        report["footprint_headless_idle_mb"] = round2(Metrics.physFootprintMB())

        // 启动 shell 类负载
        let loadSeconds = rotationSeconds + cycleCount / 8 + 120
        for (idx, s) in sessions.enumerated() where LoadKind.ccmix.resolved(forIndex: idx) != .cast {
            LoadDriver.startScript(on: s, loadsDir: loadsDir, kind: .ccmix, index: idx, seconds: loadSeconds)
        }
        try await sleepMS(8000)
        report["footprint_loaded_8s_mb"] = round2(Metrics.physFootprintMB())

        // Phase A：轮换 attach
        for v in views { _ = v.snapshotMetrics(reset: true) }
        var attachedSamples: [Double] = []
        let ticks = max(1, rotationSeconds / 2)
        for tick in 0..<ticks {
            for (i, v) in views.enumerated() {
                v.attach(sessions[(tick * views.count + i) % sessionCount])
            }
            try await sleepMS(2000)
            attachedSamples.append(Metrics.physFootprintMB())
        }
        var aggregate = FrameMetrics()
        var perView: [[String: Any]] = []
        for v in views {
            let m = v.snapshotMetrics()
            perView.append(m.summary())
            m.intervalsMS.forEach { aggregate.addInterval($0) }
            m.encodeMS.forEach { aggregate.addEncode($0) }
            m.gpuMS.forEach { aggregate.addGPU($0) }
            m.firstFrameLatencyMS.forEach { aggregate.addFirstFrame($0) }
        }
        report["rotation_per_view"] = perView
        report["rotation_aggregate"] = aggregate.summary()
        report["footprint_attached_steady_mb"] = round2(Metrics.steadyStateMB(samples: attachedSamples))
        let sortedIntervals = aggregate.intervalsMS.sorted()
        let fpsP99 = FrameMetrics.percentile(sortedIntervals, 0.99)
        report["kpi_frame_p99_ms"] = round2(fpsP99)
        report["kpi_frame_p99_pass"] = fpsP99 < 16.7 * 1.1
        let ff = aggregate.firstFrameLatencyMS.sorted()
        report["kpi_first_frame_p95_ms"] = round2(FrameMetrics.percentile(ff, 0.95))
        report["kpi_first_frame_max_ms"] = round2(ff.last ?? 0)
        report["kpi_first_frame_pass"] = (ff.last ?? 999) < 100

        // Phase B：内容校验（marker 会话，状态级读回）
        let marker = try TerminalSession(
            cols: 100, rows: 30, maxScrollbackLines: 2_000,
            spawnShell: true, label: "appb-marker")
        markerSession = marker
        views[0].attach(marker)
        marker.send("echo MUXVO_RENDER_CHECK_$((1234+1))_OK\n")
        var contentOK = false
        for _ in 0..<20 {
            try await sleepMS(250)
            if views[0].visibleTextLines().contains(where: { $0.contains("MUXVO_RENDER_CHECK_1235_OK") }) {
                contentOK = true
                break
            }
        }
        report["content_check_pass"] = contentOK

        // Phase C：detach/attach ×N 泄漏检验
        views.forEach { $0.detachSession() }
        try await sleepMS(1500)
        let beforeCycle = Metrics.physFootprintMB()
        for i in 0..<cycleCount {
            views[0].attach(sessions[i % sessionCount])
            try await sleepMS(50)
            views[0].detachSession()
        }
        try await sleepMS(2000)
        let afterCycle = Metrics.physFootprintMB()
        report["cycle_test"] = [
            "cycles": cycleCount,
            "footprint_before_mb": round2(beforeCycle),
            "footprint_after_mb": round2(afterCycle),
            "delta_mb": round2(afterCycle - beforeCycle),
            // 阈值：100 轮后涨幅 <8MB 视为无泄漏（atlas 缓存增长 + 噪声容差）
            "pass": (afterCycle - beforeCycle) < 8.0,
        ]

        // Phase D：双视图同会话 + 三种仲裁策略
        var arbitration: [[String: Any]] = []
        for policy in ["lastWins", "minEnvelope", "primary"] {
            let r = try await runArbitration(policy: policy, session: marker)
            arbitration.append(r)
        }
        report["arbitration"] = arbitration
        report["arbitration_any_pass"] = arbitration.contains { ($0["pass"] as? Bool) == true }

        // 收尾内存
        views.forEach { $0.detachSession() }
        try await sleepMS(1000)
        report["footprint_final_detached_mb"] = round2(Metrics.physFootprintMB())
        report["timestamp"] = ISO8601DateFormatter().string(from: Date())
    }

    /// 双视图(0,1)挂同一会话，按策略 resize，验证 stty 读数一致 + 双视图均持续出帧。
    private func runArbitration(policy: String, session: TerminalSession) async throws -> [String: Any] {
        let vA = views[0] // primary / first
        let vB = views[1] // last attacher
        vA.alwaysFullRebuild = true
        vB.alwaysFullRebuild = true
        defer {
            vA.alwaysFullRebuild = false
            vB.alwaysFullRebuild = false
            vA.detachSession()
            vB.detachSession()
        }
        vA.attach(session)
        vB.attach(session)

        let gA = vA.gridForCurrentSize()
        let gB = vB.gridForCurrentSize()
        let target: (cols: UInt16, rows: UInt16)
        switch policy {
        case "lastWins": target = gB
        case "minEnvelope": target = (min(gA.cols, gB.cols), min(gA.rows, gB.rows))
        default: target = gA // primary
        }
        let resized = session.resize(cols: target.cols, rows: target.rows)

        // stty 读数验证内核侧一致
        let mA0 = vA.snapshotMetrics(reset: true)
        _ = mA0
        let mB0 = vB.snapshotMetrics(reset: true)
        _ = mB0
        session.send("stty size\n")
        var sttyOK = false
        let expect = "\(target.rows) \(target.cols)"
        for _ in 0..<24 {
            try await sleepMS(250)
            if session.dumpPlainText().contains(expect) {
                sttyOK = true
                break
            }
        }
        try await sleepMS(500)
        let framesA = vA.snapshotMetrics().intervalsMS.count
        let framesB = vB.snapshotMetrics().intervalsMS.count
        let bothAlive = framesA > 30 && framesB > 30 // ~6s 窗口内两视图都该有上百帧

        return [
            "policy": policy,
            "view_a_grid": ["cols": Int(gA.cols), "rows": Int(gA.rows)],
            "view_b_grid": ["cols": Int(gB.cols), "rows": Int(gB.rows)],
            "target": ["cols": Int(target.cols), "rows": Int(target.rows)],
            "resize_ok": resized,
            "stty_ok": sttyOK,
            "both_views_rendering": bothAlive,
            "frames_a": framesA,
            "frames_b": framesB,
            "pass": resized && sttyOK && bothAlive,
        ]
    }

    // MARK: - helpers

    private func sleepMS(_ ms: Int) async throws {
        try await Task.sleep(nanoseconds: UInt64(ms) * 1_000_000)
    }

    private func round2(_ x: Double) -> Double {
        (x * 100).rounded() / 100
    }
}

func probeRootDir() -> String {
    let fm = FileManager.default
    var dir = fm.currentDirectoryPath
    for _ in 0..<5 {
        if fm.fileExists(atPath: dir + "/loads/flood-cjk.sh") { return dir }
        dir = (dir as NSString).deletingLastPathComponent
    }
    return fm.currentDirectoryPath
}
