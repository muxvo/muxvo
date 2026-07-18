// 主窗口尺寸契约（DOGFOOD_M3_13 W1 红锚）：生产装配路径的窗口内容区必须是 1440×900。
//
// 根因（H-window）：`window.contentViewController = root` 会让 AppKit 按 root 视图当刻尺寸
// 重设窗口——CompositeRootViewController.loadView 建的是零 frame NSView() → 窗口坍缩 →
// 被 minSize(1024×640) 钳制 → 冷启动真实内容区 1024×612。web 首帧在此错误视口测量，
// 3 终端平铺洞 rect = 333×569 → 31×28 烧进 PTY（用户 stty 实测 28×31 铁证）。
// e2e 从未暴露：harness 装配后显式 setFrame(1440×900)（E2EScenario.swift:77-78），生产无此步。
//
// 命名纪律：非 spec-ID 翻牌，测试名不像 spec ID。
import AppKit
import Foundation
import Testing
import MuxvoKit
import MuxvoStorage
import MuxvoTermRender
@testable import MuxvoAppCore

@Suite("主窗口尺寸契约（DOGFOOD_M3_13 H-window）", .serialized)
@MainActor
struct MainWindowSizingTests {

    /// 生产同款装配（照 E2EScenario 装配纪律，隔离数据根、不 spawn 终端）。
    private func makeController() throws -> MainWindowController {
        let tmpRoot = FileManager.default.temporaryDirectory
            .appendingPathComponent("muxvo-w1-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: tmpRoot, withIntermediateDirectories: true)
        let configStore = ConfigStore(configFileURL: tmpRoot.appendingPathComponent(ConfigStore.configFileName))
        let service = TerminalService(
            configStore: configStore,
            ptyChildrenStore: PtyChildrenStore(root: tmpRoot),
            homePath: NSHomeDirectory(),
            dataRoot: tmpRoot)
        let provider = SurfaceProvider(registry: service.registry, device: nil)
        return MainWindowController(surfaceProvider: provider, terminalService: service)
    }

    @Test("生产装配后窗口内容区 == 1440×900（不被 contentViewController 坍缩钳到 minSize）")
    func windowKeepsDesignedContentSize() throws {
        // frame autosave 会把测试进程历史 run 存的 frame 应用回来（defaults 跨 run 持久），
        // 先清存档保证断言的是「无存档默认路径」= 设计尺寸。
        UserDefaults.standard.removeObject(forKey: "NSWindow Frame MuxvoMainWindow")
        let controller = try makeController()
        let window = try #require(controller.window)
        let content = window.contentRect(forFrameRect: window.frame).size
        // 旧代码红：contentViewController 赋值按零 frame root 视图坍缩 → minSize 钳制 → 1024×612。
        #expect(Int(content.width) == 1440)
        #expect(Int(content.height) == 900)
    }
}
