// 原生兜底底随界面亮暗（settings-dogfood 二轮，terminal-theme.md §5.1）：web 整页透明后 tile 格缝/
// 非终端区透出 CompositeRoot 容器层 + host 层底色——亮色界面须同步 #f0f0f3，否则格缝全黑（真机实锤）。
// 命名纪律：本文件无 spec-ID 翻牌 → 测试名不得像 spec ID。
import AppKit
import Foundation
import Testing
import MuxvoKit
import MuxvoStorage
import MuxvoTerm
import MuxvoTermRender
@testable import MuxvoAppCore

@Suite("原生兜底底随界面亮暗（applyBackdropTheme）", .serialized)
@MainActor
struct BackdropThemeTests {
    @Test("light → 容器/host 双层 #f0f0f3；dark → 双层 #0a0e14（幂等重施加）")
    func backdropFollowsInterfaceTheme() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("muxvo-backdrop-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = ConfigStore(configFileURL: root.appendingPathComponent(ConfigStore.configFileName))
        let service = TerminalService(
            configStore: store, ptyChildrenStore: PtyChildrenStore(root: root),
            homePath: NSHomeDirectory(), dataRoot: root)
        defer { service.stop() }
        let vc = CompositeRootViewController(
            surfaceProvider: SurfaceProvider(registry: service.registry, device: nil),
            terminalService: service)
        _ = vc.view // 触发 loadView（默认 dark 兜底）

        #expect(vc.view.layer?.backgroundColor == CompositeColors.bgPrimary, "loadView 默认 dark 兜底")

        vc.applyBackdropTheme(lightTheme: true)
        #expect(vc.view.layer?.backgroundColor == CompositeColors.bgPrimaryLight)
        #expect(vc.host.view.layer?.backgroundColor == CompositeColors.bgPrimaryLight)

        vc.applyBackdropTheme(lightTheme: false)
        vc.applyBackdropTheme(lightTheme: false) // 幂等
        #expect(vc.view.layer?.backgroundColor == CompositeColors.bgPrimary)
        #expect(vc.host.view.layer?.backgroundColor == CompositeColors.bgPrimary)
    }
}
