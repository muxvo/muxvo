// 复合 UI spike 主控：建窗口（下层 TerminalHostView + 上层 PassthroughWebView）、加载
// chrome 测试页、接洞 rect 上报、挂会话与压测负载，跑 S1-S6 自动化后落报告。
// 默认跑完退出（便于取证）；--keep-open 保持窗口供人工复核（IME/白闪视觉）。
import AppKit
import ProbeCore
import ProbeRendererMetal
import WebKit

@MainActor
final class SpikeAppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler {
    // CLI
    let tileCount: Int
    let seconds: Int
    let reportPath: String?
    let keepOpen: Bool

    // 组件
    var window: NSWindow!
    var host: TerminalHostView!
    var webview: PassthroughWebView!
    let holeStore = HoleStore()

    // 会话/负载
    var sessions: [TerminalSession] = []
    var replayers: [CastReplayer] = []

    // web 侧事件回传（S2/S3 佐证），主线程访问
    struct WebEvent { let kind: String; let x: Double; let y: Double; let onHole: Bool; let id: String }
    var webEvents: [WebEvent] = []

    // rect 上报计时（S5）：native 触发 resize 的时刻 → 下一条 report 到达时刻
    var lastResizeTriggerTS: DispatchTime?
    var reportLatenciesMS: [Double] = []
    var reportTimestamps: [(stateId: Int, ts: DispatchTime, rectCount: Int)] = []

    init(tiles: Int, seconds: Int, reportPath: String?, keepOpen: Bool) {
        self.tileCount = tiles
        self.seconds = seconds
        self.reportPath = reportPath
        self.keepOpen = keepOpen
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        Task { @MainActor in
            do {
                try await setup()
                let scenario = SpikeScenario(app: self)
                try await scenario.run()
                if keepOpen {
                    FileHandle.standardError.write(Data("\n[spike] 自动化完成，窗口保持打开供人工复核（IME/白闪）。关闭窗口或 Ctrl-C 退出。\n".utf8))
                } else {
                    finish(0)
                }
            } catch {
                FileHandle.standardError.write(Data("[spike] scenario failed: \(error)\n".utf8))
                finish(1)
            }
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func finish(_ code: Int32) {
        replayers.forEach { $0.stop() }
        host?.tiles.forEach { $0.detachSession() }
        sessions.forEach { $0.close() }
        exit(code)
    }

    // MARK: - setup

    private func setup() async throws {
        guard let device = MTLCreateSystemDefaultDevice() else {
            throw ProbeError.ghosttyFailed("no Metal device (需要 GUI/GPU 会话)")
        }
        let atlas = GlyphAtlas(device: device)

        let rect = NSRect(x: 60, y: 60, width: 1440, height: 900) // golden 同构尺寸
        window = NSWindow(contentRect: rect, styleMask: [.titled, .resizable], backing: .buffered, defer: false)
        window.title = "Muxvo composite-probe (C 案 spike)"
        window.contentMinSize = NSSize(width: 1024, height: 640)
        let content = window.contentView!
        content.wantsLayer = true

        // 下层：终端宿主（先加 = 在下）
        host = TerminalHostView(frame: content.bounds, device: device, atlas: atlas, tileCount: tileCount)
        content.addSubview(host)

        // 上层：透明 webview
        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "layout")
        config.userContentController.add(self, name: "probe")
        webview = PassthroughWebView(frame: content.bounds, configuration: config, holeStore: holeStore)
        content.addSubview(webview)

        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        // 加载 chrome 测试页
        webview.loadHTMLString(ChromePage.html(tiles: tileCount), baseURL: nil)

        // 等首个含全部洞的 layoutReport
        try await waitUntil(timeoutMS: 8000) { [weak self] in
            guard let self else { return true }
            return self.holeStore.snapshot().rects.count >= self.tileCount
        }
        host.applyHoleRects(holeStore.snapshot().rects)

        // 会话：tile0 = 交互 shell（S3 键盘/S4 input→pixel 需回显）；其余 ccmix 压测负载
        let castDir = Self.findCastDir()
        var castFiles: [String] = []
        if let castDir {
            castFiles = ((try? FileManager.default.contentsOfDirectory(atPath: castDir)) ?? [])
                .filter { $0.hasSuffix(".cast") }.sorted().map { castDir + "/" + $0 }
        }
        var castIdx = 0
        for i in 0..<tileCount {
            if i == 0 {
                let s = try TerminalSession(cols: 80, rows: 24, spawnShell: true, label: "kb")
                sessions.append(s)
                host.tiles[0].attach(s)
                continue
            }
            let kind = LoadKind.ccmix.resolved(forIndex: i)
            let useCast = (kind == .cast) && !castFiles.isEmpty
            let s = try TerminalSession(cols: 80, rows: 24, maxScrollbackLines: 10_000,
                                        spawnShell: !useCast, label: "t\(i)")
            sessions.append(s)
            host.tiles[i].attach(s)
            if useCast {
                let r = try CastReplayer(path: castFiles[castIdx % castFiles.count])
                castIdx += 1
                r.start(into: s, speed: 10, loop: true)
                replayers.append(r)
            }
        }
        try await sleepMS(400)
    }

    /// 启动 shell 类负载（S4 前调；避免全程占 CPU 干扰 S1-S3）。
    func startShellLoads(seconds: Int) {
        guard let loadsDir = Self.findLoadsDir() else { return }
        for i in 1..<tileCount {
            let kind = LoadKind.ccmix.resolved(forIndex: i)
            if kind != .cast {
                LoadDriver.startScript(on: sessions[i], loadsDir: loadsDir, kind: .ccmix, index: i, seconds: seconds)
            }
        }
    }

    // MARK: - WKScriptMessageHandler

    nonisolated func userContentController(_ uc: WKUserContentController, didReceive message: WKScriptMessage) {
        // 消息在主线程投递
        MainActor.assumeIsolated {
            if message.name == "layout" { handleLayout(message.body) }
            else if message.name == "probe" { handleProbe(message.body) }
        }
    }

    private func handleLayout(_ body: Any) {
        guard let d = body as? [String: Any] else { return }
        let stateId = (d["stateId"] as? Int) ?? (d["stateId"] as? NSNumber)?.intValue ?? 0
        let modal = (d["modal"] as? Bool) ?? false
        var rects: [HoleRect] = []
        if let arr = d["rects"] as? [[String: Any]] {
            for r in arr {
                func dv(_ k: String) -> Double { (r[k] as? Double) ?? (r[k] as? NSNumber)?.doubleValue ?? 0 }
                let idx = (r["idx"] as? Int) ?? (r["idx"] as? NSNumber)?.intValue ?? 0
                rects.append(HoleRect(idx: idx, x: dv("x"), y: dv("y"), w: dv("w"), h: dv("h")))
            }
        }
        holeStore.update(stateId: stateId, rects: rects, modal: modal)
        host?.applyHoleRects(rects)
        let now = DispatchTime.now()
        reportTimestamps.append((stateId, now, rects.count))
        if let t0 = lastResizeTriggerTS {
            reportLatenciesMS.append(Double(now.uptimeNanoseconds - t0.uptimeNanoseconds) / 1e6)
            lastResizeTriggerTS = nil
        }
    }

    private func handleProbe(_ body: Any) {
        guard let d = body as? [String: Any] else { return }
        let kind = d["kind"] as? String ?? "?"
        func dv(_ k: String) -> Double { (d[k] as? Double) ?? (d[k] as? NSNumber)?.doubleValue ?? 0 }
        webEvents.append(WebEvent(kind: kind, x: dv("x"), y: dv("y"),
                                  onHole: (d["onHole"] as? Bool) ?? false, id: d["id"] as? String ?? ""))
    }

    // MARK: - JS 驱动

    func js(_ script: String) async {
        await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
            webview.evaluateJavaScript(script) { _, _ in cont.resume() }
        }
    }

    /// 取 DOM 元素的 CSS rect（左上原点）。
    func jsRect(elementId: String) async -> (x: Double, y: Double, w: Double, h: Double)? {
        let script = "(function(){var e=document.getElementById('\(elementId)');if(!e)return null;var r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};})()"
        return await withCheckedContinuation { (cont: CheckedContinuation<(x: Double, y: Double, w: Double, h: Double)?, Never>) in
            webview.evaluateJavaScript(script) { res, _ in
                guard let d = res as? [String: Any] else { cont.resume(returning: nil); return }
                func dv(_ k: String) -> Double { (d[k] as? Double) ?? (d[k] as? NSNumber)?.doubleValue ?? 0 }
                cont.resume(returning: (dv("x"), dv("y"), dv("w"), dv("h")))
            }
        }
    }

    /// CSS 中心点（左上原点）→ 窗口坐标（左下原点，= locationInWindow）。
    func cssToWindowPoint(x: Double, y: Double) -> NSPoint {
        NSPoint(x: x, y: Double(host.bounds.height) - y)
    }

    // MARK: - helpers

    func sleepMS(_ ms: Int) async throws { try await Task.sleep(nanoseconds: UInt64(ms) * 1_000_000) }

    func waitUntil(timeoutMS: Int, pollMS: Int = 50, _ cond: @escaping () -> Bool) async throws {
        var waited = 0
        while waited < timeoutMS {
            if cond() { return }
            try await sleepMS(pollMS)
            waited += pollMS
        }
    }

    static func findLoadsDir() -> String? {
        let fm = FileManager.default
        var dir = fm.currentDirectoryPath
        for _ in 0..<8 {
            let cand = dir + "/probes/term-probe/loads"
            if fm.fileExists(atPath: cand + "/flood-cjk.sh") { return cand }
            let cand2 = dir + "/loads"
            if fm.fileExists(atPath: cand2 + "/flood-cjk.sh") { return cand2 }
            dir = (dir as NSString).deletingLastPathComponent
        }
        return nil
    }

    static func findCastDir() -> String? {
        guard let loads = findLoadsDir() else { return nil }
        let cast = loads + "/cast"
        return FileManager.default.fileExists(atPath: cast) ? cast : nil
    }
}
