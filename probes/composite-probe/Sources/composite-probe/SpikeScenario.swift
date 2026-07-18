// S1-S6 自动化。能程序化的程序化，纯视觉项（IME 候选窗定位、白闪逐帧）落人工步骤。
// 产出机器 JSON（reports/raw/spike-*.json）+ stderr 逐条款结论摘要，供检查点⑨与报告采编。
import AppKit
import CoreGraphics
import ProbeCore
import ProbeRendererMetal
import WebKit

@MainActor
final class SpikeScenario {
    let app: SpikeAppDelegate
    var report: [String: Any] = [:]

    init(app: SpikeAppDelegate) { self.app = app }

    func run() async throws {
        report["probe"] = "composite-probe C 案 spike"
        report["tiles"] = app.tileCount
        report["window"] = ["w": 1440, "h": 900]
        report["timestamp"] = ISO8601DateFormatter().string(from: Date())
        report["frame_p99_threshold_ms"] = 18.37 // M0 基线阈值 16.7×1.1

        log("=== S1 透明/白闪 ===")
        report["S1"] = await s1()
        log("=== S2 hitTest 穿透 ===")
        report["S2"] = await s2()
        log("=== S3 键盘/IME ===")
        report["S3"] = await s3()
        log("=== S4 合成性能 ===")
        report["S4"] = await s4()
        log("=== S5 rect 同步 ===")
        report["S5"] = await s5()
        log("=== S6 无泄漏 ===")
        report["S6"] = await s6()

        writeReport()
    }

    // MARK: - S1 透明 / 白闪

    private func s1() async -> [String: Any] {
        var r: [String: Any] = [:]
        let drawsBg = app.webview.drawsBackgroundReadback()
        let layerOpaque = app.webview.layer?.isOpaque ?? true
        r["drawsBackground_readback"] = drawsBg ?? "nil"
        r["layer_isOpaque"] = layerOpaque
        let cfgOK = (drawsBg == false) && (layerOpaque == false)
        r["transparency_config_ok"] = cfgOK

        // 洞区透明快照检查：初始 → reload → dark/light 切换全程采样，找最坏「不透明白」像素
        var stats: [[String: Any]] = []
        func sampleOnce(_ label: String) async {
            if let s = await snapshotHole0Stats() {
                stats.append(["phase": label, "minAlpha": s.minAlpha, "maxAlpha": s.maxAlpha,
                              "opaqueWhitePx": s.opaqueWhite, "sampled": s.sampled])
            }
        }
        await sampleOnce("initial")
        // reload（loadHTMLString 再来一次，模拟刷新——覆盖首帧空白期）
        app.webview.loadHTMLString(ChromePage.html(tiles: app.tileCount), baseURL: nil)
        for k in 0..<10 { try? await app.sleepMS(30); await sampleOnce("reload_\(k)") }
        try? await app.waitUntil(timeoutMS: 5000) { self.app.holeStore.snapshot().rects.count >= self.app.tileCount }
        app.host.applyHoleRects(app.holeStore.snapshot().rects)
        await app.js("window.spike.setTheme('light')"); try? await app.sleepMS(50); await sampleOnce("light")
        await app.js("window.spike.setTheme('dark')"); try? await app.sleepMS(50); await sampleOnce("dark")
        r["hole_snapshots"] = stats
        let worstWhite = stats.compactMap { $0["opaqueWhitePx"] as? Int }.max() ?? -1
        let maxAlphaEver = stats.compactMap { $0["maxAlpha"] as? Double }.max() ?? -1
        r["worst_opaque_white_px"] = worstWhite
        r["max_alpha_in_holes_ever"] = maxAlphaEver
        // 快照佐证：洞区始终无「不透明白」像素（webview 层无白闪）
        let snapshotClean = worstWhite == 0
        r["snapshot_holes_transparent"] = snapshotClean

        // screencapture 全复合取证（需屏幕录制权限；失败记人工）
        r["screencapture"] = attemptScreencapture()

        r["verdict"] = cfgOK
            ? (snapshotClean ? "做实（配置+快照绿）；白闪逐帧视觉留人工复核" : "配置绿但快照见非透明像素——需人工逐帧确认")
            : "否决倾向：透明化配置未生效"
        log("S1 cfg=\(cfgOK) snapshotClean=\(snapshotClean) worstWhitePx=\(worstWhite) maxAlpha=\(maxAlphaEver)")
        return r
    }

    /// 对 webview 洞0 区域取快照并统计 alpha/白像素（仅 webview 自身合成，不含下层终端）。
    /// NSImage 非 Sendable：在 takeSnapshot 的主线程回调内直接算好统计，跨 continuation 只回传值。
    private func snapshotHole0Stats() async -> (minAlpha: Double, maxAlpha: Double, opaqueWhite: Int, sampled: Int)? {
        guard let c = app.holeStore.snapshot().rects.first(where: { $0.idx == 0 }) else { return nil }
        return await withCheckedContinuation { (cont: CheckedContinuation<(minAlpha: Double, maxAlpha: Double, opaqueWhite: Int, sampled: Int)?, Never>) in
            let cfg = WKSnapshotConfiguration()
            cfg.afterScreenUpdates = true
            app.webview.takeSnapshot(with: cfg) { image, _ in
                MainActor.assumeIsolated {
                    guard let image, let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
                        cont.resume(returning: nil); return
                    }
                    let scale = Double(cg.width) / Double(self.app.webview.bounds.width)
                    cont.resume(returning: self.pixelStats(cg: cg, cssRect: c, scale: scale))
                }
            }
        }
    }

    private func pixelStats(cg: CGImage, cssRect r: HoleRect, scale: Double) -> (minAlpha: Double, maxAlpha: Double, opaqueWhite: Int, sampled: Int) {
        let w = cg.width, h = cg.height
        var buf = [UInt8](repeating: 0, count: w * h * 4)
        let cs = CGColorSpace(name: CGColorSpace.sRGB)!
        guard let ctx = CGContext(data: &buf, width: w, height: h, bitsPerComponent: 8,
                                  bytesPerRow: w * 4, space: cs,
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
            return (-1, -1, -1, 0)
        }
        ctx.setBlendMode(.copy) // 保留源 alpha，不做 sourceOver 合成
        ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
        // 采样洞区内网格（CSS 左上 → 图像像素；图像亦左上原点）
        let x0 = Int(r.x * scale) + 2, y0 = Int(r.y * scale) + 2
        let x1 = min(w - 1, Int((r.x + r.w) * scale) - 2)
        let y1 = min(h - 1, Int((r.y + r.h) * scale) - 2)
        var minA = 1.0, maxA = 0.0, white = 0, n = 0
        let strideX = max(1, (x1 - x0) / 30), strideY = max(1, (y1 - y0) / 30)
        var yy = y0
        while yy <= y1 {
            var xx = x0
            while xx <= x1 {
                let i = (yy * w + xx) * 4
                guard i + 3 < buf.count, xx >= 0, yy >= 0 else { xx += strideX; continue }
                let rr = Double(buf[i]) / 255, gg = Double(buf[i + 1]) / 255, bb = Double(buf[i + 2]) / 255
                let aa = Double(buf[i + 3]) / 255
                minA = min(minA, aa); maxA = max(maxA, aa)
                if aa > 0.5 && rr > 0.9 && gg > 0.9 && bb > 0.9 { white += 1 }
                n += 1
                xx += strideX
            }
            yy += strideY
        }
        return (round3(minA), round3(maxA), white, n)
    }

    private func attemptScreencapture() -> [String: Any] {
        let dir = NSHomeDirectory() + "/Library/Caches/muxvo-build/logs"
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        let path = dir + "/composite-spike-window.png"
        let task = Process()
        task.launchPath = "/usr/sbin/screencapture"
        task.arguments = ["-x", "-o", "-l\(app.window.windowNumber)", path]
        do {
            try task.run(); task.waitUntilExit()
            let size = (try? FileManager.default.attributesOfItem(atPath: path)[.size] as? Int) ?? 0
            return ["attempted": true, "exit": task.terminationStatus, "path": path, "bytes": size ?? 0,
                    "note": (size ?? 0) > 2000 ? "见 png（人工核对洞区透出终端）" : "空/极小——可能缺屏幕录制权限，改人工"]
        } catch {
            return ["attempted": true, "error": "\(error)"]
        }
    }

    // MARK: - S2 hitTest 穿透

    private func s2() async -> [String: Any] {
        var r: [String: Any] = [:]
        guard let c0 = app.holeStore.holeCenterCSS(idx: 0) else { r["error"] = "no hole0"; return r }
        let wp = app.cssToWindowPoint(x: c0.x, y: c0.y)
        r["hole0_css_center"] = ["x": c0.x, "y": c0.y]
        r["window_point"] = ["x": Double(wp.x), "y": Double(wp.y)]

        // 核心断言：洞区 hitTest 归属穿透
        let passHole = app.webview.wouldPassthrough(windowPoint: wp)
        let hitTargetHole = String(describing: type(of: app.window.contentView!.hitTest(wp) ?? NSView()))
        r["holes_active_would_passthrough"] = passHole
        r["holes_active_hittest_target"] = hitTargetHole

        // 合成事件到达下层
        app.host.recording = true
        app.host.resetEvents(); app.webEvents.removeAll()
        EventSynth.click(at: wp, in: app.window)
        EventSynth.doubleClick(at: wp, in: app.window)
        EventSynth.rightClick(at: wp, in: app.window)
        let scrollTgtHole = EventSynth.scroll(at: wp, deltaY: 3, in: app.window)
        try? await app.sleepMS(80)
        let holeKinds = app.host.eventKinds()
        r["holes_active_host_events"] = holeKinds
        r["holes_active_scroll_target"] = scrollTgtHole
        let holeGot = Set(holeKinds)
        let holePass = passHole && holeGot.isSuperset(of: ["mouseDown", "doubleClick", "rightMouseDown", "scrollWheel"])

        // modal 打开：rects 空 → 停穿透，同坐标命中 web
        await app.js("window.spike.openModal()")
        try? await app.waitUntil(timeoutMS: 3000) { self.app.holeStore.snapshot().modal || self.app.holeStore.snapshot().rects.isEmpty }
        try? await app.sleepMS(60)
        let passModal = app.webview.wouldPassthrough(windowPoint: wp)
        let hitTargetModal = String(describing: type(of: app.window.contentView!.hitTest(wp) ?? NSView()))
        app.host.resetEvents(); app.webEvents.removeAll()
        EventSynth.click(at: wp, in: app.window)
        EventSynth.rightClick(at: wp, in: app.window)
        let scrollTgtModal = EventSynth.scroll(at: wp, deltaY: 3, in: app.window)
        try? await app.sleepMS(80)
        let modalHostKinds = app.host.eventKinds()
        let modalWebEvents = app.webEvents.map { $0.kind }
        r["modal_would_passthrough"] = passModal
        r["modal_hittest_target"] = hitTargetModal
        r["modal_host_events"] = modalHostKinds
        r["modal_web_events"] = modalWebEvents
        r["modal_scroll_target"] = scrollTgtModal
        await app.js("window.spike.closeModal()")
        try? await app.waitUntil(timeoutMS: 3000) { self.app.holeStore.snapshot().rects.count >= self.app.tileCount }
        app.host.recording = false

        let modalPass = !passModal && modalHostKinds.isEmpty
        let pass = holePass && modalPass
        r["pass"] = pass
        r["verdict"] = pass ? "做实：洞区穿透到下层、modal 空清单同坐标命中 web" : "否决倾向：见字段"
        log("S2 holePass=\(holePass) modalPass=\(modalPass) holeKinds=\(holeKinds) modalHostKinds=\(modalHostKinds) scrollHole=\(scrollTgtHole) scrollModal=\(scrollTgtModal)")
        return r
    }

    // MARK: - S3 键盘/IME

    private func s3() async -> [String: Any] {
        var r: [String: Any] = [:]
        guard let session = app.host.tiles[0].session else { r["error"] = "no session on tile0"; return r }
        guard let c0 = app.holeStore.holeCenterCSS(idx: 0) else { r["error"] = "no hole0"; return r }
        let wp = app.cssToWindowPoint(x: c0.x, y: c0.y)

        // 点洞0 → host 成 first responder
        app.host.recording = true; app.host.resetEvents()
        EventSynth.click(at: wp, in: app.window)
        try? await app.sleepMS(30)
        let hostIsFR = app.window.firstResponder === app.host
        r["click_hole_host_first_responder"] = hostIsFR

        // 键入 "ls\r" → PTY 回显
        session.send("\r") // 清行
        try? await app.sleepMS(150)
        let marker = "ECHOKB"
        for ch in marker {
            EventSynth.keyDown(String(ch), keyCode: 0, in: app.window)
            try? await app.sleepMS(15)
        }
        var keyEchoed = false
        for _ in 0..<24 {
            try? await app.sleepMS(120)
            if session.dumpPlainText().contains(marker) { keyEchoed = true; break }
        }
        r["keydown_reaches_pty_echo"] = keyEchoed

        // Cmd+V → 剪贴板入 PTY
        session.send("\r"); try? await app.sleepMS(150)
        let paste = "MUXVOPASTE"
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(paste, forType: .string)
        EventSynth.keyDown("v", keyCode: 9, flags: .command, in: app.window)
        var pasteOK = false
        for _ in 0..<24 {
            try? await app.sleepMS(120)
            if session.dumpPlainText().contains(paste) { pasteOK = true; break }
        }
        r["cmd_v_reaches_pty"] = pasteOK

        // 焦点交还 web：web 输入框取得焦点后，键入应流向 web、不再到达下层 host。
        // 行为断言（比 firstResponder 身份更可靠）：web 聚焦后合成 keyDown → host 不收；
        // 再点洞 → host 重新收键。焦点获取用 spike.focusWebInput()（模拟点击 web 输入框的
        // 结果；S2 已证合成点击可达 WebKit DOM，但 WebKit 对「非可信」合成点击不自动聚焦
        // 表单控件，故此处用 JS focus 表达「web 取得焦点」这一结果，点击→聚焦另留人工步骤）。
        app.webEvents.removeAll()
        await app.js("window.spike.focusWebInput()")
        try? await app.sleepMS(120)
        let webFocusFired = app.webEvents.contains { $0.kind == "focus" && $0.id == "webinput" }
        let hostResigned = !(app.window.firstResponder === app.host)
        app.host.resetEvents()
        EventSynth.keyDown("Z", keyCode: 6, in: app.window)
        try? await app.sleepMS(60)
        let hostGotKeyWhileWebFocused = app.host.eventKinds().contains("keyDown")
        // 点回洞 → host 重新成为键入目标
        EventSynth.click(at: wp, in: app.window)
        try? await app.sleepMS(60)
        app.host.resetEvents()
        EventSynth.keyDown("Q", keyCode: 12, in: app.window)
        try? await app.sleepMS(60)
        let hostRegainedKey = app.host.eventKinds().contains("keyDown")
        r["focus_handoff_web_focus_fired"] = webFocusFired
        r["focus_handoff_host_resigned"] = hostResigned
        r["focus_handoff_key_to_web_not_host"] = !hostGotKeyWhileWebFocused
        r["focus_handoff_host_regains_key_on_hole_click"] = hostRegainedKey
        let handoffOK = webFocusFired && !hostGotKeyWhileWebFocused && hostRegainedKey
        r["focus_handoff_ok"] = handoffOK
        app.host.recording = false

        let pass = hostIsFR && keyEchoed && pasteOK && handoffOK
        r["pass"] = pass
        r["ime_candidate_window"] = "自动化不可测——见报告人工步骤（--keep-open 后中文 IME 输入观察候选窗贴合光标）"
        r["note"] = "spike host 用简化 keyDown→session.send；生产走 ghostty key encoder + NSTextInputClient IME。点击→表单聚焦为 WebKit 可信事件行为，留人工步骤。"
        r["verdict"] = pass ? "做实（键入/Cmd+V 达 PTY、焦点可在 web↔host 间交接）；IME 候选窗定位留人工" : "部分失败——见字段，查 makeFirstResponder"
        log("S3 hostFR=\(hostIsFR) keyEcho=\(keyEchoed) pasteOK=\(pasteOK) webFocus=\(webFocusFired) keyToWeb=\(!hostGotKeyWhileWebFocused) regain=\(hostRegainedKey)")
        return r
    }

    // MARK: - S4 合成性能

    private func s4() async -> [String: Any] {
        var r: [String: Any] = [:]
        app.startShellLoads(seconds: app.seconds + 40)
        try? await app.sleepMS(4000) // 预热
        for t in app.host.tiles { _ = t.snapshotMetrics(reset: true) }

        try? await app.sleepMS(app.seconds * 1000)

        var agg = FrameMetrics()
        var perTile: [[String: Any]] = []
        for t in app.host.tiles {
            let m = t.snapshotMetrics()
            perTile.append(["view": t.viewID, "p99_ms": round2(FrameMetrics.percentile(m.intervalsMS.sorted(), 0.99)),
                            "frames": m.intervalsMS.count])
            m.intervalsMS.forEach { agg.addInterval($0) }
            m.encodeMS.forEach { agg.addEncode($0) }
            m.gpuMS.forEach { agg.addGPU($0) }
        }
        let sortedI = agg.intervalsMS.sorted()
        let p99 = FrameMetrics.percentile(sortedI, 0.99)
        r["seconds"] = app.seconds
        r["total_frames"] = sortedI.count
        r["frame_interval_p50_ms"] = round2(FrameMetrics.percentile(sortedI, 0.50))
        r["frame_interval_p95_ms"] = round2(FrameMetrics.percentile(sortedI, 0.95))
        r["frame_interval_p99_ms"] = round2(p99)
        r["encode_cpu_p99_ms"] = round2(FrameMetrics.percentile(agg.encodeMS.sorted(), 0.99))
        r["gpu_p99_ms"] = round2(FrameMetrics.percentile(agg.gpuMS.sorted(), 0.99))
        r["frame_p99_pass"] = p99 < 18.37
        r["per_tile"] = perTile

        // input→pixel 草测（tile0 交互 shell）
        if let s0 = app.host.tiles[0].session {
            _ = app.host.tiles[0].inputLatencySnapshot(reset: true)
            for _ in 0..<200 {
                app.host.tiles[0].markInputNow()
                s0.send("x")
                try? await app.sleepMS(33)
            }
            try? await app.sleepMS(200)
            let lat = app.host.tiles[0].inputLatencySnapshot().sorted()
            r["input_to_pixel_samples"] = lat.count
            r["input_to_pixel_p50_ms"] = round2(FrameMetrics.percentile(lat, 0.50))
            r["input_to_pixel_p95_ms"] = round2(FrameMetrics.percentile(lat, 0.95))
            r["input_to_pixel_p99_ms"] = round2(FrameMetrics.percentile(lat, 0.99))
            r["input_to_pixel_p99_pass"] = (FrameMetrics.percentile(lat, 0.99) < 16.0)
            r["input_to_pixel_note"] = "草测：send→首个重建帧 GPU 完成；含轮询/光标闪烁噪声（偏保守），权威值待 M4 muxvo-term-bench"
        }
        let pass = (p99 < 18.37)
        r["pass"] = pass
        r["verdict"] = pass ? "做实：20 tile ccmix + 常驻透明 webview 帧 p99 <18.37ms 阈值" : "否决倾向：超帧预算"
        log("S4 framep99=\(round2(p99))ms pass=\(pass) inputP99=\(r["input_to_pixel_p99_ms"] ?? "-")")
        return r
    }

    // MARK: - S5 rect 同步

    private func s5() async -> [String: Any] {
        var r: [String: Any] = [:]

        // (a) 分隔条拖动模拟：setDivider → report 往返延迟
        app.reportLatenciesMS.removeAll()
        let ratios = [0.4, 0.7, 1.0, 0.55, 1.0, 0.8]
        for ratio in ratios {
            app.lastResizeTriggerTS = DispatchTime.now()
            await app.js("window.spike.setDivider(\(ratio))")
            try? await app.waitUntil(timeoutMS: 1500) { self.app.lastResizeTriggerTS == nil }
            try? await app.sleepMS(120)
        }
        let dividerLat = app.reportLatenciesMS.sorted()
        r["divider_report_latency_p50_ms"] = round2(FrameMetrics.percentile(dividerLat, 0.50))
        r["divider_report_latency_p99_ms"] = round2(FrameMetrics.percentile(dividerLat, 0.99))
        r["divider_report_latency_max_ms"] = round2(dividerLat.last ?? 0)
        r["divider_report_lag_frames_p99"] = round2(FrameMetrics.percentile(dividerLat, 0.99) / 16.67)

        // (b) 窗口 resize（含连续 live resize 模拟）
        app.reportLatenciesMS.removeAll()
        let sizes: [(Int, Int)] = [(1100, 760), (1440, 900), (1240, 820), (1440, 900)]
        for (w, h) in sizes {
            app.lastResizeTriggerTS = DispatchTime.now()
            app.window.setContentSize(NSSize(width: w, height: h))
            try? await app.waitUntil(timeoutMS: 1500) { self.app.lastResizeTriggerTS == nil }
            try? await app.sleepMS(150)
        }
        let resizeLat = app.reportLatenciesMS.sorted()
        r["resize_report_latency_p99_ms"] = round2(FrameMetrics.percentile(resizeLat, 0.99))
        r["resize_report_lag_frames_p99"] = round2(FrameMetrics.percentile(resizeLat, 0.99) / 16.67)

        // 连续 live resize：50 步小增量，数期间收到多少 report（上报是否跟得上）
        let beforeReports = app.holeStore.reportCount
        let baseW = 1200
        for step in 0..<50 {
            let w = baseW + (step % 25) * 8
            app.window.setContentSize(NSSize(width: w, height: 860))
            try? await app.sleepMS(12) // ~83Hz 拖动步频
        }
        try? await app.sleepMS(300)
        let liveReports = app.holeStore.reportCount - beforeReports
        r["live_resize_steps"] = 50
        r["live_resize_reports_received"] = liveReports

        // 稳态偏差：回到 1440×900 settle 后，tile.frame vs 上报 rect 的最大 px 偏差
        app.window.setContentSize(NSSize(width: 1440, height: 900))
        try? await app.sleepMS(500)
        let snap = app.holeStore.snapshot()
        app.host.applyHoleRects(snap.rects)
        let H = app.host.bounds.height
        var maxDelta = 0.0
        for hr in snap.rects where hr.idx < app.host.tiles.count {
            let f = app.host.tiles[hr.idx].frame
            let expX = hr.x, expY = Double(H) - hr.y - hr.h
            maxDelta = max(maxDelta, abs(Double(f.origin.x) - expX), abs(Double(f.origin.y) - expY),
                           abs(Double(f.width) - hr.w), abs(Double(f.height) - hr.h))
        }
        r["steady_state_max_offset_px"] = round3(maxDelta)
        r["steady_state_within_1px"] = maxDelta <= 1.0

        let laggyFrames = (FrameMetrics.percentile(resizeLat, 0.99) / 16.67)
        let pass = laggyFrames <= 2.5 && maxDelta <= 1.0 && liveReports > 0
        r["pass"] = pass
        r["note"] = "错位持续 = 上报往返延迟（native resize→ResizeObserver+rAF→postMessage→native）；稳态偏差取 tile.frame vs rect。真 live resize 用 setContentSize 密集步模拟。"
        r["verdict"] = pass ? "做实：错位 ≤~2 帧、稳态 ≤1px、live resize 上报跟得上" : "需 rAF 节流/inLiveResize 补偿后复测——见字段"
        log("S5 dividerP99=\(r["divider_report_latency_p99_ms"] ?? "-")ms resizeLagFrames=\(round2(laggyFrames)) liveReports=\(liveReports) steadyMax=\(round3(maxDelta))px")
        return r
    }

    // MARK: - S6 无泄漏

    private func s6() async -> [String: Any] {
        var r: [String: Any] = [:]
        guard let s0 = app.host.tiles[0].session else { r["error"] = "no session"; return r }
        app.host.tiles[0].detachSession()
        try? await app.sleepMS(600)
        let baseline = Metrics.physFootprintMB()
        for _ in 0..<100 {
            app.host.tiles[0].attach(s0)
            try? await app.sleepMS(40)
            app.host.tiles[0].detachSession()
        }
        try? await app.sleepMS(2000)
        let after = Metrics.physFootprintMB()
        let delta = after - baseline
        let pct = baseline > 0 ? delta / baseline * 100 : 0
        r["cycles"] = 100
        r["webview_resident"] = true
        r["footprint_baseline_mb"] = round2(baseline)
        r["footprint_after_mb"] = round2(after)
        r["delta_mb"] = round2(delta)
        r["delta_pct"] = round2(pct)
        let pass = abs(pct) <= 5.0 || delta < 8.0
        r["pass_within_5pct_or_8mb"] = pass
        r["pass"] = pass
        r["verdict"] = pass ? "做实：attach/detach×100 + webview 常驻内存回落基线 ±5%（或 <8MB）" : "否决倾向：查视图释放路径"
        // 复原 tile0
        app.host.tiles[0].attach(s0)
        log("S6 base=\(round2(baseline))MB after=\(round2(after))MB delta=\(round2(delta))MB (\(round2(pct))%) pass=\(pass)")
        return r
    }

    // MARK: - report / helpers

    private func writeReport() {
        guard let data = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]) else { return }
        let json = String(decoding: data, as: UTF8.self)
        print(json)
        let dir = probeRoot() + "/reports/raw"
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        let fmt = DateFormatter(); fmt.dateFormat = "yyyyMMdd-HHmmss"
        let path = app.reportPath ?? dir + "/spike-\(fmt.string(from: Date())).json"
        try? (json + "\n").write(toFile: path, atomically: true, encoding: .utf8)
        FileHandle.standardError.write(Data("[spike] report json: \(path)\n".utf8))
    }

    private func probeRoot() -> String {
        let fm = FileManager.default
        var dir = fm.currentDirectoryPath
        for _ in 0..<6 {
            if fm.fileExists(atPath: dir + "/Package.swift"), dir.hasSuffix("composite-probe") { return dir }
            dir = (dir as NSString).deletingLastPathComponent
        }
        return fm.currentDirectoryPath
    }

    private func log(_ s: String) { FileHandle.standardError.write(Data("[spike] \(s)\n".utf8)) }
    private func round2(_ x: Double) -> Double { (x * 100).rounded() / 100 }
    private func round3(_ x: Double) -> Double { (x * 1000).rounded() / 1000 }
}
