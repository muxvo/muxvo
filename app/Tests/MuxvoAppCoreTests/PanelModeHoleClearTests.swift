// 面板切屏洞清单清空（M4a 收官验收现场缺陷，2026-07-06）：切任务中心时 detachAllSurfacesForPanelMode()
// 只清 surface（host.applyLayout 空 rects）**漏清 holeStore**——陈旧终端洞残留，PassthroughWebView.hitTest
// 于旧洞区恒穿透到已清空的 host，任务中心表单点击/换焦全死（需求框恰在洞外+自动聚焦故仍可打字）。
// web 侧无补救：TaskCenterScreen 全新挂载的 useLayoutReport 依「从未有洞不刷空报」防刷屏语义不会发空报。
// 修复不变量 = panelmode-detach 与 layoutReport 消费同款「洞清单 + host 几何一致更新」单点收口。
// e2e 走查历史全绿系合成 click 不经真 hitTest 链的已知盲区；真值+hitTest 双锚补在 harness item15 (3b)。
// 命名纪律：非 spec-ID 翻牌，测试名不像 spec ID。
import AppKit
import Foundation
import Testing
import MuxvoBridge
import MuxvoKit
import MuxvoStorage
import MuxvoTerm
import MuxvoTermRender
@testable import MuxvoAppCore

@Suite("面板切屏清洞清单（M4a 验收缺陷修复）")
@MainActor
struct PanelModeHoleClearTests {

    @Test("detachAllSurfacesForPanelMode 后洞清单必须为空（旧代码红：holeStore 残留旧洞恒穿透）")
    func panelModeDetachClearsHoleStore() throws {
        let tmpRoot = FileManager.default.temporaryDirectory
            .appendingPathComponent("muxvo-holeclear-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: tmpRoot, withIntermediateDirectories: true)
        let configStore = ConfigStore(configFileURL: tmpRoot.appendingPathComponent(ConfigStore.configFileName))
        let service = TerminalService(
            configStore: configStore,
            ptyChildrenStore: PtyChildrenStore(root: tmpRoot),
            homePath: NSHomeDirectory(),
            dataRoot: tmpRoot)
        var cfg = TerminalSession.Config()
        cfg.spawnShell = false
        guard case let .success(sid) = service.registry.create(config: cfg) else {
            throw CocoaError(.featureUnsupported)
        }
        let provider = SurfaceProvider(registry: service.registry, device: nil)
        let root = CompositeRootViewController(surfaceProvider: provider, terminalService: service)
        _ = root.view
        root.view.frame = NSRect(x: 0, y: 0, width: 1440, height: 900)
        defer { service.registry.close(sid) }

        // 终端屏常态：layoutReport 落洞（洞清单 + host 一致更新的单点收口）。
        let hole = TermRect(terminalId: sid.raw, x: 0, y: 0, w: 1200, h: 800, visible: true, role: .grid)
        root.handle(.layoutReport(stateId: "s1", rects: [hole], viewportW: nil, viewportH: nil))
        #expect(!root.layoutRects.isEmpty, "前置：洞应已落 holeStore")
        #expect(root.attachedSurfaceCount == 1, "前置：grid surface 应已 attach")

        // 切任务中心（生产 AppDelegate.setPanelMode 与 e2e harness 共用的同一条缝）。
        root.detachAllSurfacesForPanelMode()
        #expect(root.attachedSurfaceCount == 0) // 既有行为：surface 全清
        // 旧代码红：holeStore 残留旧洞 → PassthroughWebView 于该区恒穿透，任务中心面板鼠标事件死。
        #expect(root.layoutRects.isEmpty, "洞清单必须随 panelmode-detach 同步清空")
    }
}
