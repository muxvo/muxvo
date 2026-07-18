// 字号缩放全链翻牌（DOGFOOD_M3_05）：断链 1「zoom 菜单项不存在、按键落空」+ 服务侧「两路归一 +
// 持久化」的翻牌。三组：
//   R1  显示(View)菜单：放大/缩小/实际大小三项存在、键位(Cmd+= / Cmd++ / Cmd+- / Cmd+0)接通 action。
//   R2c TerminalService.applyZoom：projection 更新字号 → onFontSizeChanged 广播新字号 → 复位回 initial；
//       web 路径 handleTermCommand(.zoom) 亦归一同一入口（同样广播 + 返回 zoomed）。
//   R3  持久化（legacy zoomLevel 持久化对应，见 DOGFOOD_M3_05 legacy 对照）：applyZoom 后
//       config.terminal.fontSize 落盘 round-trip（重启保留）。
//
// 命名纪律：本文件无 spec-ID 翻牌 → 测试名不得像 spec ID（防 E_FORGED_ID）。
import AppKit
import Foundation
import Testing
import MuxvoBridge
import MuxvoStorage
import MuxvoTermRender
@testable import MuxvoAppCore
@testable import MuxvoTerm

// MARK: - R1 显示菜单键位接通

@Suite("显示菜单字号缩放键位（DOGFOOD_M3_05 R1）", .serialized)
@MainActor
struct ZoomMenuTests {

    private func cmdKey(_ chars: String, ignoring: String? = nil,
                        flags: NSEvent.ModifierFlags = [.command]) -> NSEvent {
        NSEvent.keyEvent(
            with: .keyDown, location: .zero, modifierFlags: flags, timestamp: 0,
            windowNumber: 0, context: nil, characters: chars,
            charactersIgnoringModifiers: ignoring ?? chars, isARepeat: false, keyCode: 0)!
    }

    @Test("主菜单含「显示」子菜单，放大/缩小/实际大小三项 action 接通 + 键位就位")
    func viewMenuHasZoomItemsWired() {
        var recorded: [UIStateProjection.ZoomDirection] = []
        let commands = AppMenuCommands(onZoom: { recorded.append($0) })
        let menu = commands.buildMainMenu()

        guard let viewMenu = menu.items.compactMap({ $0.submenu }).first(where: { $0.title == "显示" }) else {
            Issue.record("主菜单缺「显示」子菜单"); return
        }
        let inItems = viewMenu.items.filter { $0.action == #selector(AppMenuCommands.fontZoomIn(_:)) }
        let outItems = viewMenu.items.filter { $0.action == #selector(AppMenuCommands.fontZoomOut(_:)) }
        let resetItems = viewMenu.items.filter { $0.action == #selector(AppMenuCommands.fontZoomReset(_:)) }
        #expect(!inItems.isEmpty && !outItems.isEmpty && !resetItems.isEmpty)

        // 放大项键位含 "="（裸 Cmd+=，用户实际按键）与 "+"（Cmd+Shift+= 即 Cmd++）两者。
        let inKeys = Set(inItems.map { $0.keyEquivalent })
        #expect(inKeys.contains("=") && inKeys.contains("+"))
        #expect(outItems.contains { $0.keyEquivalent == "-" })
        #expect(resetItems.contains { $0.keyEquivalent == "0" })

        for it in inItems + outItems + resetItems {
            #expect(it.keyEquivalentModifierMask == [.command]) // 均 Cmd 修饰
            #expect(it.target === commands)                     // action 接通到真 target
        }
    }

    @Test("performKeyEquivalent 真匹配：Cmd+= / Cmd++ → 放大，Cmd+- → 缩小，Cmd+0 → 复位")
    func keyEquivalentsDispatchToDirections() {
        _ = NSApplication.shared // performKeyEquivalent 经 NSApp.sendAction 投递 action，须先初始化 NSApp
        var recorded: [UIStateProjection.ZoomDirection] = []
        let commands = AppMenuCommands(onZoom: { recorded.append($0) })
        let menu = commands.buildMainMenu()

        #expect(menu.performKeyEquivalent(with: cmdKey("=")) == true)           // 裸 Cmd+=
        #expect(recorded.last == .in)
        #expect(menu.performKeyEquivalent(with: cmdKey("+", flags: [.command, .shift])) == true) // Cmd+Shift+=
        #expect(recorded.last == .in)
        #expect(menu.performKeyEquivalent(with: cmdKey("-")) == true)           // Cmd+-
        #expect(recorded.last == .out)
        #expect(menu.performKeyEquivalent(with: cmdKey("0")) == true)           // Cmd+0
        #expect(recorded.last == .reset)
    }
}

// MARK: - R2c/R3 服务侧两路归一 + 持久化

@Suite("TerminalService 字号缩放两路归一与持久化（DOGFOOD_M3_05 R2c/R3）", .serialized)
@MainActor
struct ZoomServiceTests {

    /// $TMPDIR 下隔离数据根（不碰真 dev 目录）；调用方 defer 清理。
    private func makeTempRoot() -> URL {
        let base = FileManager.default.temporaryDirectory
            .appendingPathComponent("muxvo-zoom-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        return base
    }

    private func makeService(root: URL) -> (TerminalService, ConfigStore) {
        let store = ConfigStore(configFileURL: root.appendingPathComponent(ConfigStore.configFileName))
        let service = TerminalService(
            configStore: store, ptyChildrenStore: PtyChildrenStore(root: root),
            homePath: NSHomeDirectory(), dataRoot: root)
        return (service, store)
    }

    @Test("applyZoom：projection 字号 in/out/reset + onFontSizeChanged 广播新字号；复位回 initial(14)")
    func applyZoomBroadcastsAndResets() {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let (service, _) = makeService(root: root)
        var broadcast: [Int] = []
        service.onFontSizeChanged = { broadcast.append($0) }

        #expect(service.applyZoom(.in) == 15)   // 14 → 15
        #expect(service.applyZoom(.in) == 16)   // 15 → 16
        #expect(service.applyZoom(.out) == 15)  // 16 → 15
        #expect(service.applyZoom(.reset) == 14) // 复位回 initial（loaded.terminal.fontSize=14）
        #expect(broadcast == [15, 16, 15, 14])   // 每次都广播到渲染层
    }

    @Test("web 路径归一：handleTermCommand(.zoom) 经同一 applyZoom → 广播 + 返回 zoomed(新字号)")
    func webZoomPathUnifiedWithNative() {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let (service, _) = makeService(root: root)
        var broadcast: [Int] = []
        service.onFontSizeChanged = { broadcast.append($0) }

        let resp = service.handleTermCommand(.zoom(action: .in))
        guard case let .zoomed(fontSize) = resp else {
            Issue.record("zoom 应返回 zoomed"); return
        }
        #expect(fontSize == 15)          // web 路径也走 projection.zoom
        #expect(broadcast == [15])       // 且同样广播渲染层（两路归一）
    }

    @Test("持久化 round-trip：applyZoom 后 config.terminal.fontSize 落盘，新 ConfigStore 读回一致（重启保留）")
    func zoomPersistsFontSizeToConfig() {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let (service, store) = makeService(root: root)

        #expect(store.load().terminal.fontSize == 14) // 落盘前默认
        _ = service.applyZoom(.in) // 15
        _ = service.applyZoom(.in) // 16

        // 新 ConfigStore 从盘重读（模拟重启）：zoom 后字号已持久化。
        let reloaded = ConfigStore(configFileURL: root.appendingPathComponent(ConfigStore.configFileName)).load()
        #expect(reloaded.terminal.fontSize == 16)
    }

    @Test("重启恢复链两腿（验收 H-1）：盘上 16 → 状态腿 initial=16（再 zoom 得 17）+ 渲染腿装配级 FontConfig 新建视图=16")
    func fontSizeRestoreChainOnRelaunch() {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        // 第一启：zoom 到 16 落盘。
        let (first, store) = makeService(root: root)
        _ = first.applyZoom(.in) // 15
        _ = first.applyZoom(.in) // 16

        // 第二启（模拟重启）——状态腿：projection initial 从盘读（16），再放大即 17；reset 回会话启动值 16。
        let (second, _) = makeService(root: root)
        #expect(second.applyZoom(.in) == 17)
        #expect(second.applyZoom(.reset) == 16)

        // 渲染腿：AppDelegate 同款装配（FontConfig(size: 盘上字号) 喂 provider）→ 新建视图按持久字号，
        // 不再固定默认 14（H-1 根因：装配未喂字号）。
        let provider = SurfaceProvider(
            registry: second.registry,
            font: FontConfig(size: CGFloat(store.load().terminal.fontSize)),
            device: nil)
        #expect(provider.currentFontSize == 16)
    }
}
