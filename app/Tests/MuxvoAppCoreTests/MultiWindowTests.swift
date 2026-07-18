// 多窗口 C3（multi-window.md §1/§3/§6）：newWindow 完整竖切 + 两级上限每窗隔离 + 关窗分流 + flat 持久化
// 防 clobber。装配真 WindowManager + 真 MainWindowController（隔离会话模板 spawnShell=false，免真 shell），
// 断言跨窗投影隔离 / registry 全局池计数 / 存活窗持久化。
//
// 命名纪律：MW_* 是 multi-window.md §8.1 强制表案例名（spec-coverage 1:1 兜底），@Test 标题内嵌该 token；
// MW_ 前缀不匹配 spec-runner ID_PREFIX_RE（无 _L\d+_）→ 不入 1:1 spec-ID 唯一性闸（与 check.mjs MW 池分治）。
import AppKit
import Foundation
import Testing
@testable import MuxvoBridge
import MuxvoStorage
import MuxvoTerm
@testable import MuxvoAppCore

@Suite("多窗口 C3：新窗完整竖切 / 两级上限 / 关窗分流 / flat 持久化（multi-window.md §1/§3）", .serialized)
@MainActor
struct MultiWindowTests {

    private func makeTempRoot() -> URL {
        let base = FileManager.default.temporaryDirectory
            .appendingPathComponent("muxvo-mw-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        return base
    }

    /// 隔离会话模板 hub（spawnShell=false）：所有终端为隔离会话（pid nil、无真 shell），快且确定。
    private func makeHub(root: URL) -> SessionHub {
        let store = ConfigStore(configFileURL: root.appendingPathComponent(ConfigStore.configFileName))
        return SessionHub(
            configModel: ConfigModel(store: store), ptyChildrenStore: PtyChildrenStore(root: root),
            homePath: NSHomeDirectory(), dataRoot: root,
            configTemplate: { var c = TerminalSession.Config(); c.spawnShell = false; return c })
    }

    /// 填满某窗到 target 个终端（经 projection.createTerminal 同链）。
    @discardableResult
    private func fill(_ service: TerminalService, to target: Int) -> Bool {
        while service.windowTerminalIds.count < target {
            guard case .created = service.createTerminalFromMenu() else { return false }
        }
        return true
    }

    @Test("MW_new_window_full_clone: ⌥⌘N 建的新窗=完整 UI（独立 service/composite/bus + 独立 window），默认 1 终端（裁决①④）")
    func MW_new_window_full_clone() {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let hub = makeHub(root: root)
        defer { hub.registry.shutdownForTeardown() }
        let wm = WindowManager(hub: hub)
        let (ctx1, _) = wm.makeFirstWindow(startupTerminalCount: 1, onCloseRequested: {})
        let ctx2 = wm.newWindow()
        defer { ctx1.service.stop(); ctx2.service.stop() }

        #expect(wm.contexts.count == 2)
        #expect(ctx1 !== ctx2)
        #expect(ctx1.service !== ctx2.service)                    // 独立 TerminalService/投影
        #expect(ctx1.composite !== ctx2.composite)                 // 独立 CompositeRoot（新 webView + 新 BridgeBus）
        #expect(ctx1.windowController.window !== ctx2.windowController.window) // 独立 NSWindow
        #expect(ctx1.service.registry === ctx2.service.registry)   // 但共享全局 registry（§2.1）
        // 新窗默认 1 终端（裁决④）。
        #expect(ctx2.service.windowTerminalIds.count == 1)
        // 跨窗投影隔离：新窗那个终端不入首窗投影。
        let w1ids = Set(ctx1.service.windowTerminalIds)
        let w2ids = Set(ctx2.service.windowTerminalIds)
        #expect(w1ids.isDisjoint(with: w2ids))
    }

    @Test("MW_per_window_cap20_frozen_message: 窗1 满 20 → 第 21 个 projection 层拒绝带冻结文案（TERM_L2_83 oracle）；窗2 独立仍可建")
    func MW_per_window_cap20_frozen_message() {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let hub = makeHub(root: root)
        defer { hub.registry.shutdownForTeardown() }
        let wm = WindowManager(hub: hub)
        let (ctx1, _) = wm.makeFirstWindow(startupTerminalCount: 1, onCloseRequested: {})
        defer { ctx1.service.stop() }

        #expect(fill(ctx1.service, to: 20)) // 窗1 → 20
        #expect(ctx1.service.windowTerminalIds.count == 20)

        // 窗1 第 21 个：拒绝 + **每窗冻结文案**（先窗后全局，全局 40 未满仍先出每窗冻结文案）。
        let resp = ctx1.service.handleTermCommand(.create(cwd: nil))
        guard case let .rejected(code, message) = resp else {
            Issue.record("窗1 第 21 个应 rejected，实得 \(resp)"); return
        }
        #expect(code == .maxReached)
        #expect(message == "已达最大终端数，请关闭不用的终端") // 冻结 oracle 逐字（RegistryPolicy 权威）

        // 窗2 独立（每窗 20 隔离）：仍可建（全局 21<40）。
        let ctx2 = wm.newWindow()
        defer { ctx2.service.stop() }
        #expect(ctx2.service.windowTerminalIds.count == 1)
        guard case .created = ctx2.service.createTerminalFromMenu() else {
            Issue.record("窗2 应可建（每窗上限隔离，窗1 满不拦窗2）"); return
        }
        #expect(ctx2.service.windowTerminalIds.count == 2)
    }

    @Test("MW_maxreached_per_window_gray: snapshot.maxReached=本窗满∨全局满——窗1 满 20 置真、窗2 空置假；全局满 40 则未满窗也置真")
    func MW_maxreached_per_window_gray() {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let hub = makeHub(root: root)
        defer { hub.registry.shutdownForTeardown() }
        let wm = WindowManager(hub: hub)
        let (ctx1, _) = wm.makeFirstWindow(startupTerminalCount: 1, onCloseRequested: {})
        defer { ctx1.service.stop() }

        // 按窗独立置灰：窗1 满 20 → true；窗2 空 → false。
        #expect(fill(ctx1.service, to: 20))
        #expect(ctx1.service.currentMaxReached == true)
        let ctx2 = wm.newWindow() // 窗2：1 终端
        defer { ctx2.service.stop() }
        #expect(ctx2.service.currentMaxReached == false)

        // 全局满 40 则未满窗也置灰：窗2 补到 19（全局 20+19=39），第 3 窗 1 终端（全局 40）。
        #expect(fill(ctx2.service, to: 19))
        let ctx3 = wm.newWindow() // 窗3：1 终端 → 全局 40
        defer { ctx3.service.stop() }
        #expect(hub.registry.count == 40)
        // 窗3 本窗仅 1 个（<20）但全局已 40 → 置真（§3.2「全局满则全窗置灰」）。
        #expect(ctx3.service.currentMaxReached == true)
    }

    @Test("MW_close_nonlast_keeps_others: 关非最后一窗收割本窗会话，其余窗会话/投影零扰动、registry count 正确（裁决②）")
    func MW_close_nonlast_keeps_others() {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let hub = makeHub(root: root)
        defer { hub.registry.shutdownForTeardown() }
        let wm = WindowManager(hub: hub)
        let (ctx1, _) = wm.makeFirstWindow(startupTerminalCount: 2, onCloseRequested: {})
        defer { ctx1.service.stop() }
        let ctx2 = wm.newWindow()
        #expect(fill(ctx2.service, to: 2)) // 窗2 → 2 终端
        #expect(hub.registry.count == 4)   // 全局池 2 + 2
        let w1ids = Set(ctx1.service.windowTerminalIds)

        wm.confirmCloseWindow = { _, _ in true } // 有活终端 → 确认（测试注入不真弹窗）
        wm.requestClose(windowId: ctx2.windowId)

        #expect(wm.contexts.count == 1)                       // 窗2 已关
        #expect(wm.contexts.first?.windowId == ctx1.windowId)
        #expect(hub.registry.count == 2)                      // 窗2 两会话已收割（全局池计数正确）
        #expect(Set(ctx1.service.windowTerminalIds) == w1ids) // 窗1 投影/会话零扰动
    }

    @Test("MW_last_window_close_quit_funnel: 最后一窗红叉走既有整机退出漏斗，非单窗收割（裁决②⑩）")
    func MW_last_window_close_quit_funnel() {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let hub = makeHub(root: root)
        defer { hub.registry.shutdownForTeardown() }
        let wm = WindowManager(hub: hub)
        var quitFunnelCalled = 0
        let (ctx1, _) = wm.makeFirstWindow(
            startupTerminalCount: 1, onCloseRequested: { quitFunnelCalled += 1 })
        defer { ctx1.service.stop() }
        var confirmShown = 0
        wm.confirmCloseWindow = { _, _ in confirmShown += 1; return true }

        wm.requestClose(windowId: ctx1.windowId) // 唯一窗 = 最后一窗

        #expect(quitFunnelCalled == 1)  // 走整机退出漏斗（onLastWindowClose）
        #expect(confirmShown == 0)       // 未弹单窗收割确认
        #expect(wm.contexts.count == 1)  // 窗未被单窗收割关（漏斗接管整机退出序）
        #expect(hub.registry.count == 1) // 会话未被单窗收割
    }

    @Test("MW_quit_persist_no_clobber: 关非最后一窗后顶层镜像反映存活首窗终端（收割窗删分组不 clobber 首窗，§4）")
    func MW_quit_persist_no_clobber() {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let hub = makeHub(root: root)
        defer { hub.registry.shutdownForTeardown() }
        let wm = WindowManager(hub: hub)
        let (ctx1, _) = wm.makeFirstWindow(startupTerminalCount: 2, onCloseRequested: {})
        defer { ctx1.service.stop() }
        ctx1.service.persistOpenTerminals() // 存活首窗（窗1）2 终端落本窗分组 + 镜像顶层
        let w1ids = Set(ctx1.service.windowTerminalIds)
        #expect(hub.configModel.config.openTerminals.count == 2)
        #expect(hub.configModel.config.windows.count == 1) // schema v2：首窗分组

        let ctx2 = wm.newWindow() // 窗2 建 1 终端 → windows[] 增第 2 分组（顶层恒镜像首窗，不被 clobber）
        #expect(hub.configModel.config.windows.count == 2)
        #expect(hub.configModel.config.openTerminals.count == 2) // 顶层仍首窗 2 终端（§4.3 镜像首窗，非窗2）

        wm.confirmCloseWindow = { _, _ in true }
        wm.requestClose(windowId: ctx2.windowId) // 关窗2 → 收割 + 删窗2 分组（裁决③）

        // 关窗后 windows[] 只剩首窗、顶层镜像反映首窗（存活首窗，无 clobber）。
        #expect(hub.configModel.config.windows.count == 1)
        #expect(hub.configModel.config.windows.first?.windowId == ctx1.windowId)
        let cfgIds = Set(hub.configModel.config.openTerminals.compactMap { $0.id })
        #expect(cfgIds == w1ids)
        #expect(hub.configModel.config.openTerminals.count == 2)
    }

    @Test("MW_persist_restore_two_windows: 两窗各终端/编号/frame 写盘 → 新装配逐窗还原 + 聚合恢复层一次（schema v2，C4）")
    func MW_persist_restore_two_windows() {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        // ① 第一次装配：建两窗、各带终端 → 写盘 config.windows[]。
        do {
            let hub = makeHub(root: root)
            defer { hub.registry.shutdownForTeardown() }
            let wm = WindowManager(hub: hub)
            let (ctx1, _) = wm.makeFirstWindow(startupTerminalCount: 2, onCloseRequested: {})
            let ctx2 = wm.newWindow()
            #expect(fill(ctx2.service, to: 3)) // 窗2 → 3 终端
            ctx1.service.persistOpenTerminals()
            ctx2.service.persistOpenTerminals()

            let cfg = hub.configModel.config
            #expect(cfg.windows.count == 2)
            #expect(cfg.windows[0].windowId == ctx1.windowId)
            #expect(cfg.windows[0].number == 1)
            #expect(cfg.windows[0].openTerminals.count == 2)
            #expect(cfg.windows[0].frame != nil) // frame 写回（registerWindowEntry 从 window.frame 读，§4.4）
            #expect(cfg.windows[1].number == 2)
            #expect(cfg.windows[1].openTerminals.count == 3)
            #expect(cfg.openTerminals.count == 2) // 顶层镜像首窗（§4.3）
            ctx1.service.stop(); ctx2.service.stop()
        }
        // ② 第二次装配（模拟重启）：新 hub 读同一 config.json → windowsForRestore 逐 entry 还原两窗。
        do {
            let hub = makeHub(root: root)
            defer { hub.registry.shutdownForTeardown() }
            let wm = WindowManager(hub: hub)
            let entries = hub.configModel.config.windowsForRestore(firstWindowId: "w1")
            #expect(entries.count == 2)
            _ = wm.makeFirstWindowForRestore(entry: entries[0], onCloseRequested: {})
            wm.restoreAdditionalWindowsThenInject(additionalEntries: Array(entries.dropFirst()))
            defer { for c in wm.contexts { c.service.stop() } }

            #expect(wm.contexts.count == 2)
            #expect(wm.contexts[0].windowId == "w1")            // 编号/id 还原（裁决⑨固定编号）
            #expect(wm.contexts[0].service.windowTerminalIds.count == 2)
            #expect(wm.contexts[1].service.windowNumber == 2)
            #expect(wm.contexts[1].service.windowTerminalIds.count == 3) // 窗2 三终端还原
        }
    }

    @Test("MW_legacy_config_migration: 旧扁平 config（无 windows[]）→ 合成单窗，终端/命名/收起/网格比零丢失 + 双写镜像（schema v2，C4）")
    func MW_legacy_config_migration() {
        // 纯逻辑（ConfigStore 迁移函数）：旧扁平 config → windowsForRestore 合成单窗。
        var flat = MuxvoConfig()
        flat.openTerminals = [
            .init(id: "t1", cwd: "/tmp/a", customName: "build"),
            .init(id: "t2", cwd: "/tmp/b", minimized: true, cols: 100, rows: 30),
        ]
        flat.gridLayout = .init(columnRatios: [2, 1], rowRatios: [1, 1])
        #expect(flat.windows.isEmpty)

        let synth = flat.windowsForRestore(firstWindowId: "w1")
        #expect(synth.count == 1)
        #expect(synth[0].windowId == "w1")
        #expect(synth[0].number == 1)
        #expect(synth[0].openTerminals == flat.openTerminals) // 零丢失（含命名/收起/尺寸快照）
        #expect(synth[0].gridLayout == flat.gridLayout)       // 网格比零丢失（裁决⑪）

        // 双写镜像（§4.3）：合成 windows 装回 config + 抹顶层 → mirrorFirstWindowToTop 回填 == 原扁平。
        var migrated = flat
        migrated.windows = synth
        migrated.openTerminals = []
        migrated.gridLayout = .init()
        migrated.mirrorFirstWindowToTop()
        #expect(migrated.openTerminals == flat.openTerminals)
        #expect(migrated.gridLayout == flat.gridLayout)

        // 装配层迁移落盘：旧扁平 config 首启 → makeFirstWindowForRestore 建首窗即写 config.windows[]（§4.2）。
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let store = ConfigStore(configFileURL: root.appendingPathComponent(ConfigStore.configFileName))
        try? store.save(flat) // 预置旧扁平 config.json（无 windows[]）
        let hub = SessionHub(
            configModel: ConfigModel(store: store), ptyChildrenStore: PtyChildrenStore(root: root),
            homePath: NSHomeDirectory(), dataRoot: root,
            configTemplate: { var c = TerminalSession.Config(); c.spawnShell = false; return c })
        defer { hub.registry.shutdownForTeardown() }
        let wm = WindowManager(hub: hub)
        let entries = hub.configModel.config.windowsForRestore(firstWindowId: "w1")
        let (ctx, _) = wm.makeFirstWindowForRestore(entry: entries[0], onCloseRequested: {})
        wm.restoreAdditionalWindowsThenInject(additionalEntries: [])
        defer { ctx.service.stop() }
        #expect(hub.configModel.config.windows.count == 1)          // 迁移落盘：windows[] 权威
        #expect(ctx.service.windowTerminalIds.count == 2)           // 两终端还原
    }

    @Test("MW_close_deletes_entry: 主动关非最后一窗 → 删 config.windows 分组（裁决③不复活）")
    func MW_close_deletes_entry() {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let hub = makeHub(root: root)
        defer { hub.registry.shutdownForTeardown() }
        let wm = WindowManager(hub: hub)
        let (ctx1, _) = wm.makeFirstWindow(startupTerminalCount: 1, onCloseRequested: {})
        defer { ctx1.service.stop() }
        let ctx2 = wm.newWindow()
        #expect(hub.configModel.config.windows.count == 2)

        wm.confirmCloseWindow = { _, _ in true }
        wm.requestClose(windowId: ctx2.windowId)
        #expect(hub.configModel.config.windows.count == 1) // 窗2 分组已删（不复活）
        #expect(hub.configModel.config.windows.first?.windowId == ctx1.windowId)
    }

    // 编排 fan-out 断言引 orch Gen 类型（TaskView/OrchStatePush/.orchState）+ broadcastOrchState，
    // 公开仓无编排整段不编译；data.event fan-out 覆盖由 broadcastDataEvent 产品路径承载。

    @Test("isShuttingDown 门：整机退出期逐窗析构不删 config.windows 分组（防 ⌘Q 误清空，§1.2）")
    func shuttingDownKeepsEntries() {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let hub = makeHub(root: root)
        defer { hub.registry.shutdownForTeardown() }
        let wm = WindowManager(hub: hub)
        let (ctx1, _) = wm.makeFirstWindow(startupTerminalCount: 1, onCloseRequested: {})
        defer { ctx1.service.stop() }
        let ctx2 = wm.newWindow()
        #expect(hub.configModel.config.windows.count == 2)

        wm.beginShutdown() // 整机退出：随后逐窗析构 close 回调不删分组
        wm.confirmCloseWindow = { _, _ in true }
        wm.requestClose(windowId: ctx2.windowId)
        #expect(hub.configModel.config.windows.count == 2) // 分组仍在（下次冷启还原全窗）
    }

    @Test("frame 还原/一次性迁移（§4.4）：entry.frame 存在直接应用；非首窗缺席不迁移；首窗缺席读旧 autosave 键兜底")
    func frameRestoreAndAutosaveMigration() {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let hub = makeHub(root: root)
        defer { hub.registry.shutdownForTeardown() }
        let wm = WindowManager(hub: hub)

        // ① entry.frame 存在 → 直接应用（确定性）。
        let w1 = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1440, height: 900),
            styleMask: [.titled, .resizable], backing: .buffered, defer: false)
        w1.minSize = NSSize(width: 400, height: 300)
        let f = MuxvoConfig.Frame(x: 150, y: 90, width: 1100, height: 700)
        #expect(wm.applyRestoredFrame(w1, frame: f, isFirstEverWindow: true))
        #expect(w1.frame.width == 1100)
        #expect(w1.frame.height == 700)

        // ② 非首窗 + frame 缺席 → 不迁移（返回 false）。
        let w2 = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 800, height: 600),
            styleMask: [.titled, .resizable], backing: .buffered, defer: false)
        #expect(!wm.applyRestoredFrame(w2, frame: nil, isFirstEverWindow: false))

        // ③ 首窗 + frame 缺席 + 旧 autosave 键 → 一次性迁移应用（环境支持时断言迁移尺寸）。
        let name = WindowManager.legacyFirstWindowAutosaveName
        let key = "NSWindow Frame \(name)"
        let src = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 900, height: 600),
            styleMask: [.titled, .resizable], backing: .buffered, defer: false)
        src.minSize = NSSize(width: 400, height: 300)
        src.setFrame(NSRect(x: 210, y: 140, width: 1180, height: 760), display: false)
        src.saveFrame(usingName: name) // 写 NSUserDefaults「NSWindow Frame MuxvoMainWindow」
        defer { UserDefaults.standard.removeObject(forKey: key) }
        let dst = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 500, height: 400),
            styleMask: [.titled, .resizable], backing: .buffered, defer: false)
        dst.minSize = NSSize(width: 400, height: 300)
        if wm.applyRestoredFrame(dst, frame: nil, isFirstEverWindow: true) {
            #expect(dst.frame.width == 1180) // 迁移到旧记录尺寸（此后由 registerWindowEntry 读回落 entry.frame）
        }
    }
}
