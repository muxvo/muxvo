// WindowManager（批C/D C2「共享层抽取」）：activeContext 解析纯函数（§6.1 keyWindow→last-active→首窗
// 兜底）+ 登记/注销 contexts + makeFirstWindow 单窗形态。
//
// 命名纪律：MW_menu_routes_key_window 是 multi-window.md §8.1 强制表案例名（spec-coverage 1:1 兜底），
// 故 @Test 标题内嵌该 token；其余测试名非 spec-ID（防 E_FORGED_ID）。
import AppKit
import Foundation
import Testing
import MuxvoStorage
import MuxvoTermRender
@testable import MuxvoAppCore

@Suite("WindowManager 上下文装配与 activeContext 路由（批C C2）", .serialized)
@MainActor
struct WindowManagerTests {

    private func makeTempRoot() -> URL {
        let base = FileManager.default.temporaryDirectory
            .appendingPathComponent("muxvo-wm-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        return base
    }

    private func makeHub(root: URL) -> SessionHub {
        let store = ConfigStore(configFileURL: root.appendingPathComponent(ConfigStore.configFileName))
        return SessionHub(
            configModel: ConfigModel(store: store), ptyChildrenStore: PtyChildrenStore(root: root),
            homePath: NSHomeDirectory(), dataRoot: root)
    }

    /// 建一 WindowContext（不 spawn 终端；照 MainWindowSizingTests 的 SurfaceProvider(device:nil) 装配）。
    private func makeContext(hub: SessionHub, id: String) -> WindowContext {
        let service = TerminalService(hub: hub, ownsHub: false)
        let provider = SurfaceProvider(registry: service.registry, device: nil)
        let controller = MainWindowController(surfaceProvider: provider, terminalService: service)
        return WindowContext(windowId: id, service: service, windowController: controller)
    }

    @Test("MW_menu_routes_key_window：resolveActiveContext keyWindow 命中优先 → last-active → 首窗兜底 → 空 nil（§6.1 纯函数）")
    func MW_menu_routes_key_window() {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let hub = makeHub(root: root)
        defer { hub.registry.shutdownForTeardown() }
        let ctx1 = makeContext(hub: hub, id: "w1")
        let ctx2 = makeContext(hub: hub, id: "w2")
        let contexts = [ctx1, ctx2]

        // keyWindow 命中优先（即便 last-active 指向别窗）。
        #expect(WindowManager.resolveActiveContext(
            keyWindowId: "w2", lastActiveId: "w1", contexts: contexts)?.windowId == "w2")
        // keyWindow 无（焦点在 modal/无 keyWindow）→ last-active。
        #expect(WindowManager.resolveActiveContext(
            keyWindowId: nil, lastActiveId: "w2", contexts: contexts)?.windowId == "w2")
        // keyWindow id 已不在 contexts（如刚关窗）→ 落 last-active。
        #expect(WindowManager.resolveActiveContext(
            keyWindowId: "gone", lastActiveId: "w1", contexts: contexts)?.windowId == "w1")
        // keyWindow + last-active 均无命中 → 首窗兜底。
        #expect(WindowManager.resolveActiveContext(
            keyWindowId: nil, lastActiveId: nil, contexts: contexts)?.windowId == "w1")
        // 空 contexts → nil。
        #expect(WindowManager.resolveActiveContext(
            keyWindowId: "w1", lastActiveId: "w1", contexts: [])?.windowId == nil)
    }

    @Test("登记/注销 contexts：registerWindow 入列、unregisterWindow 剔除；activeContext 兜底首窗")
    func registerUnregisterContexts() {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let hub = makeHub(root: root)
        defer { hub.registry.shutdownForTeardown() }
        let wm = WindowManager(hub: hub)
        #expect(wm.contexts.isEmpty)
        #expect(wm.activeContext == nil)

        let ctx1 = makeContext(hub: hub, id: "w1")
        wm.registerWindow(ctx1)
        #expect(wm.contexts.count == 1)
        #expect(wm.activeContext?.windowId == "w1") // keyWindow 无 → last-active(=w1) → 命中

        let ctx2 = makeContext(hub: hub, id: "w2")
        wm.registerWindow(ctx2)
        #expect(wm.contexts.count == 2)

        wm.unregisterWindow(ctx1)
        #expect(wm.contexts.count == 1)
        #expect(wm.contexts.first?.windowId == "w2")
    }

    @Test("makeFirstWindow：C2 单窗——contexts 恒 1 项、activeContext = 首窗、hub 注入共享 registry")
    func makeFirstWindowSingleContext() {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let hub = makeHub(root: root)
        defer { hub.registry.shutdownForTeardown() }
        let wm = WindowManager(hub: hub)
        let (ctx, _) = wm.makeFirstWindow(startupTerminalCount: 1, onCloseRequested: {})
        #expect(wm.contexts.count == 1)
        #expect(wm.activeContext?.windowId == ctx.windowId)
        #expect(ctx.service.registry === hub.registry) // 共享全局 registry（§2.1）
        ctx.service.stop()
    }
}
