// ⌘+/-/0 面板缩放（dogfood-r3 问题5）：applyZoomRouted 路由矩阵 + panelZoom 阶梯/clamp/复位 +
// panelOverlayReport 置/清/切模式防御清空 + config.panelZoom 持久化 round-trip + ui.state 字节冻结守卫
// （panelZoom==1.0 时 JSON 无该键 → 既有 fixture/golden 零变化）。
// 命名纪律：无 spec-ID 翻牌 → 测试名不得像 spec ID（防 E_FORGED_ID）。
import AppKit
import Foundation
import Testing
import MuxvoBridge
import MuxvoStorage
@testable import MuxvoAppCore
@testable import MuxvoTerm

@Suite("面板缩放路由与持久化（dogfood-r3 问题5）", .serialized)
@MainActor
struct PanelZoomTests {

    private func makeTempRoot() -> URL {
        let base = FileManager.default.temporaryDirectory
            .appendingPathComponent("muxvo-panelzoom-\(UUID().uuidString)", isDirectory: true)
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

    @Test("路由矩阵：终端网格 → 缩终端字号（现状）；taskCenter/chatHistory → 缩面板；overlay 上报翻路由")
    func zoomRoutingMatrix() {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let (service, _) = makeService(root: root)
        var fontBroadcast: [Int] = []
        service.onFontSizeChanged = { fontBroadcast.append($0) }

        // ① 终端网格（默认）：⌘+ → 终端字号 14→15，panelZoom 不动。
        service.applyZoomRouted(.in)
        #expect(fontBroadcast == [15])
        #expect(service.panelZoom == 1.0)

        // ② taskCenter：⌘+ → panelZoom 1.0→1.1，字号不动。
        service.setPanelMode(.taskCenter)
        service.applyZoomRouted(.in)
        #expect(service.panelZoom == 1.1)
        #expect(fontBroadcast == [15], "全页面板下不得再动终端字号")

        // ③ chatHistory 同为全页面板。
        service.setPanelMode(.chatHistory)
        service.applyZoomRouted(.in)
        #expect(service.panelZoom == 1.2)

        // ④ 回 terminal + overlay 上报（skills 面板开）→ 仍缩面板；上报关 → 回终端字号。
        service.setPanelMode(.terminal)
        service.handleAction(.panelOverlayReport(source: "panel", active: true))
        service.applyZoomRouted(.out)
        #expect(service.panelZoom == 1.1)
        service.handleAction(.panelOverlayReport(source: "panel", active: false))
        service.applyZoomRouted(.in)
        #expect(fontBroadcast == [15, 16], "overlay 关后回终端字号路由")
        #expect(service.panelZoom == 1.1)
    }

    @Test("panelZoom 阶梯 ±0.1 clamp [0.6, 2.0]、⌘0 复位 1.0（十分位取整防浮点漂移）")
    func panelZoomStepClampReset() {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let (service, _) = makeService(root: root)

        for _ in 0..<15 { service.applyPanelZoom(.in) }
        #expect(service.panelZoom == 2.0, "上界 clamp 2.0")
        #expect(service.applyPanelZoom(.reset) == 1.0)
        for _ in 0..<10 { service.applyPanelZoom(.out) }
        #expect(service.panelZoom == 0.6, "下界 clamp 0.6")
        service.applyPanelZoom(.reset)
        service.applyPanelZoom(.in)
        service.applyPanelZoom(.in)
        service.applyPanelZoom(.out)
        #expect(service.panelZoom == 1.1, "1.0→1.1→1.2→1.1 阶梯无浮点漂移")
    }

    @Test("overlay 源集合：置/清/多源并存；setPanelMode 切换防御清空（web 刷新丢 cleanup 兜底）")
    func overlaySourcesLifecycle() {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let (service, _) = makeService(root: root)

        service.handleAction(.panelOverlayReport(source: "panel", active: true))
        service.handleAction(.panelOverlayReport(source: "fileTabs", active: true))
        #expect(service.webOverlaySourcesForTest == ["panel", "fileTabs"])
        service.handleAction(.panelOverlayReport(source: "panel", active: false))
        #expect(service.webOverlaySourcesForTest == ["fileTabs"])

        service.setPanelMode(.taskCenter)
        #expect(service.webOverlaySourcesForTest.isEmpty, "切模式防御清空 overlay 残留")

        // 第三重兜底（对抗验收 MINOR-1）：web 整页刷新 re-hello → 清残留（cleanup 不跑 + panelMode
        // 全程 terminal 时前两重都不触发的场景）。
        service.handleAction(.panelOverlayReport(source: "panel", active: true))
        service.noteWebRehello()
        #expect(service.webOverlaySourcesForTest.isEmpty, "re-hello 清空 overlay 残留")
    }

    @Test("持久化 round-trip：applyPanelZoom 落 config.panelZoom；新 service init 读回（含异常值 clamp）")
    func panelZoomPersistsAndRestores() {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let (service, store) = makeService(root: root)
        #expect(store.load().panelZoom == 1.0) // 默认

        service.applyPanelZoom(.in)
        service.applyPanelZoom(.in) // 1.2
        let reloaded = ConfigStore(configFileURL: root.appendingPathComponent(ConfigStore.configFileName)).load()
        #expect(reloaded.panelZoom == 1.2)

        // 模拟重启：新 service 从盘恢复 panelZoom。
        let (second, _) = makeService(root: root)
        #expect(second.panelZoom == 1.2)

        // clamp 纯函数：异常持久值钳回边界。
        #expect(TerminalService.clampPanelZoom(9.9) == 2.0)
        #expect(TerminalService.clampPanelZoom(0.1) == 0.6)
    }

    @Test("字节冻结守卫：panelZoom==1.0 → ui.state JSON 无 panelZoom 键（fixture/golden 零变化）；≠1.0 → 带值")
    func uiStateOmitsPanelZoomAtDefault() throws {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let (service, _) = makeService(root: root)
        var captured: UIState?
        service.onState = { captured = $0 }

        service.republishState()
        let defaultState = try #require(captured)
        #expect(defaultState.panelZoom == nil)
        let defaultJson = String(decoding: try JSONEncoder().encode(defaultState), as: UTF8.self)
        #expect(!defaultJson.contains("panelZoom"), "默认 1.0 不得出现在 JSON（字节冻结）")

        service.applyPanelZoom(.in) // 1.1 → 自带重推
        let zoomed = try #require(captured)
        #expect(zoomed.panelZoom == 1.1)
    }
}
