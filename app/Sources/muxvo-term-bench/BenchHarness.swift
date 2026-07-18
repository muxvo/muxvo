// bench_input_to_pixel 宿主 + 打点（terminal-rendering.md §8）。
//
// 宿主 = 最小 AppKit app 真窗口（不用 probe-cli——须测产品渲染路径：会话 queue→快照→
// TerminalSurfaceView encode→present）。链路（§8）：
//   注键 t0（直调产品输入路径 inputController.handleKeyDown，绕系统事件队列）
//     → key encode → PTY write → /bin/cat 行规程 echo → PTY read → vt_write（echo 字节到达）
//     → RenderCoordinator update（generation g）→ 首个含 g 帧 commandBuffer.addCompletedHandler t1。
//
// 打点两个终点：
//   - GPU 完成（onFrameCompleted，Metal 完成线程）= 主判据 input→pixel。
//   - 快照发布（addFrameObserver，main）= 参考列，纯 CPU 段（无 present）。
//   无 GPU present 时降级为 cpu-segment：只测「注键→快照发布」，如实标注 GPU 段待补。
import AppKit
import CGhosttyVT
import Dispatch
import Foundation
import MetalKit
import MuxvoTerm
import MuxvoTermRender

enum BenchScene: String { case cat, zsh }
enum BenchMode: String { case auto, gpu, cpu }

struct BenchOptions {
    var scene: BenchScene = .cat
    var keys: Int = 1000
    var spacingMs: Int = 50
    var mode: BenchMode = .auto
    var reportPath: String?
    var cols: UInt16 = 80
    var rows: UInt16 = 24
    /// cat 场景每 N 个测量击键插一次未测量 Return，冲 canonical 行缓冲（MAX_CANON），防溢出停 echo。
    var flushEvery: Int = 200
    /// 单样本等落帧超时（ms）：超时未落帧 → 记 drop。
    var timeoutMs: Int = 400
    /// 注入前静置（等 shell/cat 就绪、提示符落定）。
    var settleMs: Int = 500
}

/// 打点闸门：把「注键 t0」与「首个 generation>armedGen 的帧完成 t1」配对成一个样本。
/// 一次只 arm 一个测量击键（击键间距 50ms >> 延迟，天然不重叠）。跨线程（main + Metal 完成线程）
/// 用锁；@unchecked Sendable。
final class FrameGate: @unchecked Sendable {
    private let lock = NSLock()
    private var armedGen: UInt64 = .max     // .max = 未 arm
    private var t0 = DispatchTime.now()
    private var idx = -1
    private var publishNs: UInt64?
    let usesGPU: Bool

    private let rlock = NSLock()
    private var gpuSamples: [UInt64?]        // 主判据（gpu=GPU 完成 / cpu-segment=快照发布）
    private var pubSamples: [UInt64?]        // 快照发布参考列

    init(count: Int, usesGPU: Bool) {
        self.usesGPU = usesGPU
        gpuSamples = Array(repeating: nil, count: count)
        pubSamples = Array(repeating: nil, count: count)
    }

    func arm(index: Int, afterGen: UInt64, t0: DispatchTime) {
        lock.lock()
        armedGen = afterGen; self.t0 = t0; idx = index; publishNs = nil
        lock.unlock()
    }

    func disarm() {
        lock.lock(); armedGen = .max; idx = -1; lock.unlock()
    }

    /// 快照发布（main，来自 addFrameObserver）。cpu-segment 模式下此即样本终点。
    func onPublish(gen: UInt64, at t1: DispatchTime) {
        lock.lock()
        guard idx >= 0, armedGen != .max, gen > armedGen else { lock.unlock(); return }
        let ns = t1.uptimeNanoseconds &- t0.uptimeNanoseconds
        if publishNs == nil { publishNs = ns }
        if usesGPU { lock.unlock(); return }
        let i = idx
        armedGen = .max; idx = -1
        lock.unlock()
        record(i, gpu: ns, pub: ns)
    }

    /// GPU 帧完成（Metal 完成线程，来自 onFrameCompleted）。gpu 模式下此即样本终点。
    func onGPUFrame(gen: UInt64, at t1: DispatchTime) {
        guard usesGPU else { return }
        lock.lock()
        guard idx >= 0, armedGen != .max, gen > armedGen else { lock.unlock(); return }
        let ns = t1.uptimeNanoseconds &- t0.uptimeNanoseconds
        let i = idx
        let pub = publishNs ?? ns
        armedGen = .max; idx = -1
        lock.unlock()
        record(i, gpu: ns, pub: pub)
    }

    private func record(_ i: Int, gpu: UInt64, pub: UInt64) {
        rlock.lock()
        if i >= 0, i < gpuSamples.count { gpuSamples[i] = gpu; pubSamples[i] = pub }
        rlock.unlock()
    }

    func results() -> (gpu: [UInt64?], pub: [UInt64?]) {
        rlock.lock(); defer { rlock.unlock() }
        return (gpuSamples, pubSamples)
    }
}

/// 线程安全布尔盒（warmup 观测 GPU present 是否真落帧）。
final class AtomicFlag: @unchecked Sendable {
    private let lock = NSLock()
    private var v = false
    func set() { lock.lock(); v = true; lock.unlock() }
    var value: Bool { lock.lock(); defer { lock.unlock() }; return v }
}

@MainActor
final class BenchAppDelegate: NSObject, NSApplicationDelegate {
    private let options: BenchOptions
    private let font = FontConfig(family: "Menlo", size: 14)

    private var window: NSWindow?
    private var view: TerminalSurfaceView?
    private var session: TerminalSession?
    private var gate: FrameGate?
    private var observerToken: Int?

    private var usesGPU = true
    private var scale: CGFloat = 2
    private var metrics: CellMetrics?
    private let warmFlag = AtomicFlag()

    init(options: BenchOptions) { self.options = options }

    func applicationDidFinishLaunching(_ notification: Notification) {
        setup()
    }

    // MARK: - 装配

    private func setup() {
        let device = MTLCreateSystemDefaultDevice()
        usesGPU = options.mode != .cpu && device != nil
        // cpu-segment 模式（含无 GPU / 无 window-server drawable 的 headless 上下文）：视图用 device=nil，
        // renderer.canRender=false → draw() 早退不碰 currentDrawable（否则 headless 进程 present 会 SIGTRAP，
        // 见 SurfaceViewTests 注）。只测「注键→快照发布」CPU 段。
        let viewDevice: MTLDevice? = usesGPU ? device : nil
        scale = NSScreen.main?.backingScaleFactor ?? 2
        let m = FontMetrics.measure(font, scale: scale)
        metrics = m

        // 会话：cat（主判据，行规程 echo）/ zsh -f（参考，ZLE echo）。
        var cfg = TerminalSession.Config()
        cfg.cols = options.cols
        cfg.rows = options.rows
        cfg.cwd = NSHomeDirectory()
        cfg.spawnShell = true
        switch options.scene {
        case .cat:
            cfg.executablePath = "/bin/cat"
            cfg.argv = ["cat"]
        case .zsh:
            cfg.executablePath = "/bin/zsh"
            cfg.argv = ["zsh", "-f"]
        }
        do {
            session = try TerminalSession(config: cfg)
        } catch {
            FileHandle.standardError.write("会话创建失败：\(error)\n".data(using: .utf8)!)
            exit(1)
        }

        let v = TerminalSurfaceView(session: session, font: font, device: viewDevice)
        view = v
        if usesGPU {
            // gpu 模式：真窗口 present 路径（须真交互 GUI 会话；内容尺寸=网格×cell 点，
            // backing scale 下 drawable≈网格×cell(px)→保持 80×24）。
            let cellWpt = CGFloat(m.widthPx) / scale
            let cellHpt = CGFloat(m.heightPx) / scale
            let contentSize = NSSize(width: cellWpt * CGFloat(options.cols),
                                     height: cellHpt * CGFloat(options.rows))
            let w = NSWindow(
                contentRect: NSRect(origin: NSPoint(x: 120, y: 120), size: contentSize),
                styleMask: [.titled, .closable], backing: .buffered, defer: false)
            w.title = "muxvo-term-bench (\(options.scene.rawValue))"
            w.contentView = v
            w.makeFirstResponder(v)
            w.makeKeyAndOrderFront(nil)
            window = w
            NSApp.activate(ignoringOtherApps: true)
        } else {
            // cpu-segment 模式：无 window、无 present（headless 安全）。视图仍持 inputController
            // 走产品编码路径；网格由会话 config 定（不经 layout）。
            _ = session?.resize(cols: options.cols, rows: options.rows,
                                cellWidthPx: UInt32(m.widthPx), cellHeightPx: UInt32(m.heightPx))
        }

        // 打点观察者（main）：快照发布 → gate.onPublish。
        observerToken = session?.addFrameObserver(deliverOn: .main) { [weak self] snap in
            let now = DispatchTime.now()
            MainActor.assumeIsolated { self?.gate?.onPublish(gen: snap.generation, at: now) }
        }

        // 静置后 warmup（若 GPU），再跑测量。
        DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(options.settleMs)) { [weak self] in
            self?.warmupThenRun()
        }
    }

    // MARK: - warmup：验证 GPU present 真落帧，否则降级 cpu-segment

    private func warmupThenRun() {
        guard usesGPU else { startMeasured(); return }
        // warmup 期间 onFrameCompleted 只置 flag。
        view?.onFrameCompleted = { [warmFlag] _, _ in warmFlag.set() }
        // 注几个未测量键触发落帧。
        for _ in 0..<3 { injectChar() }
        DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(1500)) { [weak self] in
            guard let self else { return }
            if !self.warmFlag.value {
                FileHandle.standardError.write(
                    "warmup 未观测到 GPU present 落帧 → 降级 cpu-segment（GPU 段待解锁环境补跑）\n".data(using: .utf8)!)
                self.usesGPU = false
            }
            self.startMeasured()
        }
    }

    private func startMeasured() {
        let g = FrameGate(count: options.keys, usesGPU: usesGPU)
        gate = g
        if usesGPU {
            view?.onFrameCompleted = { gen, t in g.onGPUFrame(gen: gen, at: t) }
        } else {
            view?.onFrameCompleted = nil
        }
        FileHandle.standardError.write(
            "开始测量：scene=\(options.scene.rawValue) keys=\(options.keys) mode=\(usesGPU ? "gpu" : "cpu-segment")\n"
                .data(using: .utf8)!)
        injectMeasured(0)
    }

    // MARK: - 测量循环（main 上链式调度，不阻塞 runloop → draw/completion 可跑）

    private func injectMeasured(_ i: Int) {
        guard i < options.keys else { finish(); return }
        let g0 = session?.currentFrame()?.generation ?? 0
        let t0 = DispatchTime.now()
        gate?.arm(index: i, afterGen: g0, t0: t0)
        injectChar()

        DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(options.spacingMs)) { [weak self] in
            guard let self else { return }
            self.gate?.disarm()   // 超过间距未落帧 → 该样本 drop
            let done = i + 1
            let needFlush = self.options.scene == .cat && self.options.flushEvery > 0
                && done % self.options.flushEvery == 0 && done < self.options.keys
            if needFlush {
                self.injectReturn()   // 未测量：冲 canonical 行缓冲
                DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(self.options.spacingMs)) { [weak self] in
                    self?.injectMeasured(done)
                }
            } else {
                self.injectMeasured(done)
            }
            if done % 200 == 0 {
                FileHandle.standardError.write("  进度 \(done)/\(self.options.keys)\n".data(using: .utf8)!)
            }
        }
    }

    // MARK: - 注键（走产品输入链：encode → writeInput → PTY）

    private func injectChar() {
        // 固定 'x'：最大确定性；key=X + utf8="x"，encoder 依 modes 编码（无 ctrl/meta → 直发 utf8）。
        let ev = AssembledKeyEvent(
            action: GHOSTTY_KEY_ACTION_PRESS, key: GHOSTTY_KEY_X,
            mods: 0, consumedMods: 0, utf8: "x", unshiftedCodepoint: 0x78)
        view?.inputController?.handleKeyDown(ev)
    }

    private func injectReturn() {
        let ev = AssembledKeyEvent(
            action: GHOSTTY_KEY_ACTION_PRESS, key: GHOSTTY_KEY_ENTER,
            mods: 0, consumedMods: 0, utf8: nil, unshiftedCodepoint: 0)
        view?.inputController?.handleKeyDown(ev)
    }

    // MARK: - 收尾

    private func finish() {
        // 宽限等末样本落帧。
        DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(options.timeoutMs)) { [weak self] in
            self?.emitAndExit()
        }
    }

    private func emitAndExit() {
        guard let gate, let m = metrics else { exit(1) }
        let (gpuNs, pubNs) = gate.results()
        let perSample = gpuNs.map { $0.map { Double($0) / 1_000_000.0 } }
        let gpuMs = gpuNs.compactMap { $0.map { Double($0) / 1_000_000.0 } }
        let pubMs = pubNs.compactMap { $0.map { Double($0) / 1_000_000.0 } }
        let dropped = gpuNs.filter { $0 == nil }.count

        let cw = view?.drawableSize.width ?? 0
        let ch = view?.drawableSize.height ?? 0
        let result = BenchRunResult(
            scene: options.scene.rawValue,
            mode: usesGPU ? "gpu" : "cpu-segment",
            judged: usesGPU,
            keys: options.keys, spacingMs: options.spacingMs,
            cols: Int(session?.cols ?? options.cols), rows: Int(session?.rows ?? options.rows),
            scale: Double(scale), cellWidthPx: m.widthPx, cellHeightPx: m.heightPx,
            drawableWidthPx: Int(cw), drawableHeightPx: Int(ch),
            primary: LatencySummary.make(msSamples: gpuMs, dropped: dropped),
            publish: LatencySummary.make(msSamples: pubMs, dropped: pubNs.filter { $0 == nil }.count),
            perSampleMs: perSample)

        let json = result.asJSON()
        let md = result.summaryMarkdown(baselineP99: nil)
        FileHandle.standardError.write((md + "\n").data(using: .utf8)!)
        if let path = options.reportPath {
            try? (md + "\n\n```json\n" + json + "\n```\n").write(toFile: path, atomically: true, encoding: .utf8)
            FileHandle.standardError.write("报告已写：\(path)\n".data(using: .utf8)!)
        }
        print(json)

        session?.close()
        let exitCode: Int32 = (result.pass == false) ? 3 : 0
        exit(exitCode)
    }
}
