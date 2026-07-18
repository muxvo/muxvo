// ProbeAppA：Track A（GhosttyKit 完整嵌入 API）对照实验 —— 探针 2 清单第 7 项。
//
// 目的不是把 Track A 做成产品路径，而是「用实验做实否决结论」：
// 1. API 形态：ghostty_surface_config_s 在 macOS 必须携带 NSView（platform.macos.nsview），
//    surface 与 view 在创建时刻 1:1 绑定；全部 surface API 中没有任何「换绑/摘除视图」
//    或「无视图创建」入口 → 会话/视图分离在 Track A 结构性不成立。
// 2. 运行时：20 个 surface 挂「永不上屏的窗口」里的离屏 NSView + set_occlusion(false)
//    模拟 headless，跑 flood 负载，测每 surface 边际内存（与 Track B headless 1.37MB 对照）。
// 3. NULL nsview 创建尝试：最后执行（可能崩溃，主数据已先落盘），结果计入报告。
//
// 注意：本程序不依赖 ProbeCore——libghostty-fat.a（v1.3.1）不含 vt 终端状态符号，
// 链接 ProbeCore 会拖入 ghostty_terminal_* 未定义符号。
import AppKit
import Darwin
import GhosttyKit

// MARK: - footprint（与 ProbeCore.Metrics 同口径，就地内联）

func physFootprintMB() -> Double {
    var info = task_vm_info_data_t()
    var count = mach_msg_type_number_t(
        MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size)
    let selfTask = task_self_trap()
    let kr: kern_return_t = withUnsafeMutablePointer(to: &info) { ptr in
        ptr.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { intPtr in
            task_info(selfTask, task_flavor_t(TASK_VM_INFO), intPtr, &count)
        }
    }
    guard kr == KERN_SUCCESS else { return 0 }
    return Double(info.phys_footprint) / 1_048_576.0
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

// MARK: - runtime 回调（最小桩：全部 no-op / 拒绝）

let wakeupCB: ghostty_runtime_wakeup_cb = { _ in
    // app_tick 由主线程定时器驱动，这里无需额外调度
}
let actionCB: ghostty_runtime_action_cb = { _, _, _ in
    false // 全部 action 不处理（探针无 UI 语义）
}
let readClipboardCB: ghostty_runtime_read_clipboard_cb = { _, _, _ in false }
let confirmReadClipboardCB: ghostty_runtime_confirm_read_clipboard_cb = { _, _, _, _ in }
let writeClipboardCB: ghostty_runtime_write_clipboard_cb = { _, _, _, _, _ in }
let closeSurfaceCB: ghostty_runtime_close_surface_cb = { _, _ in }

// 实测：普通 NSView（默认 CALayer）会让 ghostty renderer 线程在 dispatch_assert_queue
// 上 SIGABRT——嵌入 API 隐含要求宿主视图按 Ghostty 自家 SurfaceView 的形状提供
// CAMetalLayer 背板。此契约未见于头文件文档，「未对第三方稳定化」的又一实证。
final class MetalHostView: NSView {
    override func makeBackingLayer() -> CALayer {
        CAMetalLayer()
    }
}

// MARK: - 实验主体

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var app: ghostty_app_t?
    private var config: ghostty_config_t?
    private var window: NSWindow!
    private var surfaces: [ghostty_surface_t] = []
    private var tick: Timer?
    private var report: [String: Any] = [:]

    private let surfaceCount: Int
    private let loadSeconds: Int
    private let reportPath: String?

    override init() {
        var count = 20
        var seconds = 30
        var path: String?
        let args = Array(CommandLine.arguments.dropFirst())
        var i = 0
        while i < args.count {
            switch args[i] {
            case "--surfaces":
                i += 1
                count = i < args.count ? Int(args[i]) ?? count : count
            case "--seconds":
                i += 1
                seconds = i < args.count ? Int(args[i]) ?? seconds : seconds
            case "--report":
                i += 1
                path = i < args.count ? args[i] : nil
            default:
                break
            }
            i += 1
        }
        self.surfaceCount = count
        self.loadSeconds = seconds
        self.reportPath = path
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        Task { @MainActor in
            await run()
        }
    }

    private func run() async {
        report["probe"] = "term-probe appa (Track A control)"
        report["surfaces"] = surfaceCount
        report["seconds"] = loadSeconds
        report["api_evidence"] = [
            "surface_requires_nsview": "ghostty_surface_config_s.platform.macos.nsview（创建时绑定）",
            "no_view_swap_api": "全部 ghostty_surface_* 函数无任何换绑/摘除/二次挂载视图入口",
            "no_headless_path": "无不带 platform view 的 surface 创建路径（iOS 同理 uiview）",
        ]

        // ghostty 初始化（不加载用户配置文件，保证确定性）
        guard ghostty_init(UInt(CommandLine.argc), CommandLine.unsafeArgv) == 0 else {
            fail("ghostty_init failed")
            return
        }
        guard let cfg = ghostty_config_new() else {
            fail("config_new failed")
            return
        }
        config = cfg
        ghostty_config_finalize(cfg)

        var rt = ghostty_runtime_config_s()
        rt.userdata = nil
        rt.supports_selection_clipboard = false
        rt.wakeup_cb = wakeupCB
        rt.action_cb = actionCB
        rt.read_clipboard_cb = readClipboardCB
        rt.confirm_read_clipboard_cb = confirmReadClipboardCB
        rt.write_clipboard_cb = writeClipboardCB
        rt.close_surface_cb = closeSurfaceCB
        guard let app = ghostty_app_new(&rt, cfg) else {
            fail("app_new failed")
            return
        }
        self.app = app

        // tick 驱动（Ghostty 自家 app 由 wakeup 调度；探针用 8ms 定时器从简）
        tick = Timer.scheduledTimer(withTimeInterval: 0.008, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated {
                if let a = self?.app { ghostty_app_tick(a) }
            }
        }

        // 离屏配置 = 永不上屏的窗口（计划所要求的「离屏 NSView 模拟 headless」）。
        // 实测记录（均为否决证据，详见报告）：
        // - 窗口可见时：renderer 线程首帧即 dispatch_assert_queue SIGABRT（普通 NSView
        //   与 CAMetalLayer 背板均崩）——嵌入契约按 Ghostty 自家 SurfaceView 形状隐式约定
        // - 离屏 + 无创建间隔：surface_new 串行创建挂死于第 3 个 → 需让出 runloop
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1700, height: 1100),
            styleMask: [.titled], backing: .buffered, defer: false)
        window.title = "Muxvo term-probe A (Track A control)"
        report["visible_window_result"] = "renderer 线程 dispatch_assert_queue SIGABRT（首帧即崩，CAMetalLayer 背板亦同）"

        try? await Task.sleep(nanoseconds: 500_000_000)
        let baseline = physFootprintMB()
        report["footprint_baseline_mb"] = round2(baseline)

        // 20 surface × 离屏 NSView + flood 负载
        let script = probeRootDir() + "/loads/flood-color.sh"
        let cmd = "/bin/bash \(script) \(loadSeconds + 30)"
        for i in 0..<surfaceCount {
            // 离屏跑法用普通 NSView：CAMetalLayer 背板即使离屏也会唤起 renderer 绘制
            // → dispatch_assert_queue SIGABRT；普通 CALayer 让 renderer 保持休眠（实测稳定）。
            let view = NSView(frame: NSRect(x: Double(i % 5) * 330, y: Double(i / 5) * 260, width: 320, height: 250))
            view.wantsLayer = true
            window.contentView!.addSubview(view)
            var sc = ghostty_surface_config_new()
            sc.platform_tag = GHOSTTY_PLATFORM_MACOS
            sc.platform = ghostty_platform_u(macos: ghostty_platform_macos_s(nsview: Unmanaged.passUnretained(view).toOpaque()))
            sc.scale_factor = 2.0
            sc.font_size = 13
            FileHandle.standardError.write("creating surface \(i)...\n".data(using: .utf8)!)
            cmd.withCString { cstr in
                sc.command = cstr
                if let s = ghostty_surface_new(app, &sc) {
                    surfaces.append(s)
                }
            }
            FileHandle.standardError.write("surface \(i) ok\n".data(using: .utf8)!)
            // 注意：这里一旦让出 runloop（哪怕 100ms sleep），renderer 线程会立刻
            // dispatch_assert_queue SIGABRT；紧凑同步创建反而稳定——嵌入 API 在
            // 非 Ghostty 自家壳下的行为高度脆弱（证据记入报告）。
        }
        report["surfaces_created"] = surfaces.count
        guard surfaces.count == surfaceCount else {
            fail("only \(surfaces.count)/\(surfaceCount) surfaces created")
            return
        }
        for s in surfaces {
            ghostty_surface_set_occlusion(s, false) // 模拟 headless：标记不可见
        }

        try? await Task.sleep(nanoseconds: 2_000_000_000)
        report["footprint_surfaces_idle_mb"] = round2(physFootprintMB())

        // 负载窗口内周期采样
        var samples: [Double] = []
        for _ in 0..<(loadSeconds * 2) {
            try? await Task.sleep(nanoseconds: 500_000_000)
            samples.append(physFootprintMB())
        }
        let tail = samples.suffix(max(2, samples.count / 4))
        let steady = tail.reduce(0, +) / Double(tail.count)
        let peak = samples.max() ?? 0
        report["footprint_steady_mb"] = round2(steady)
        report["footprint_peak_mb"] = round2(peak)
        report["marginal_per_surface_mb"] = round2((steady - baseline) / Double(surfaceCount))
        report["samples_mb"] = samples.map { round2($0) }

        // 主数据先落盘，再做可能崩溃的 NULL-view 尝试
        report["null_view_attempt"] = "pending"
        writeReport()

        var nullCfg = ghostty_surface_config_new()
        nullCfg.platform_tag = GHOSTTY_PLATFORM_MACOS
        nullCfg.platform = ghostty_platform_u(macos: ghostty_platform_macos_s(nsview: nil))
        nullCfg.scale_factor = 2.0
        let nullSurface = ghostty_surface_new(app, &nullCfg)
        report["null_view_attempt"] = nullSurface == nil
            ? "returned NULL（拒绝创建，无 headless 路径）"
            : "意外成功（需进一步调查）"
        if let ns = nullSurface { ghostty_surface_free(ns) }

        // 收尾
        for s in surfaces { ghostty_surface_free(s) }
        surfaces = []
        try? await Task.sleep(nanoseconds: 1_000_000_000)
        report["footprint_after_free_mb"] = round2(physFootprintMB())
        writeReport()
        exit(0)
    }

    private func fail(_ msg: String) {
        report["error"] = msg
        writeReport()
        FileHandle.standardError.write((msg + "\n").data(using: .utf8)!)
        exit(1)
    }

    private func writeReport() {
        report["timestamp"] = ISO8601DateFormatter().string(from: Date())
        guard let data = try? JSONSerialization.data(
            withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
        else { return }
        let json = String(decoding: data, as: UTF8.self)
        print(json)
        let dir = probeRootDir() + "/reports/raw"
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        let fmt = DateFormatter()
        fmt.dateFormat = "yyyyMMdd-HHmmss"
        let path = reportPath ?? dir + "/appa-\(fmt.string(from: Date())).json"
        try? (json + "\n").write(toFile: path, atomically: true, encoding: .utf8)
        FileHandle.standardError.write("report written: \(path)\n".data(using: .utf8)!)
    }

    private func round2(_ x: Double) -> Double {
        (x * 100).rounded() / 100
    }
}

let nsapp = NSApplication.shared
let delegate = AppDelegate()
nsapp.delegate = delegate
nsapp.setActivationPolicy(.accessory) // 不抢焦点：窗口永不上屏
nsapp.run()
