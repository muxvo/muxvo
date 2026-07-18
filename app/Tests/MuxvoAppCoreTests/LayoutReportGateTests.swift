// layoutReport 陈旧丢弃闸（DOGFOOD_M3_13 F4，还 host「TODO(批4③) stateId 丢弃」欠账）：
// 入站 BridgeScriptMessageHandler 每消息独立 Task 无 FIFO 契约——相邻两条 layoutReport 换序时，
// 陈旧窄 rect 后至会覆盖新鲜宽 rect（frame 被打回旧几何 + 若 >80ms 稳定 settle 会提交烧写），
// 且 web diff 门闩死到下次真实变化。高水位法：seq < 高水位丢弃；== 放行（拖动期同 id 多报常态）；
// > 推高；非 "s<n>" 形（demo/fixture 屏名）不参与丢弃（latest-wins 兼容冒烟/截图路径）。
// 否决「!=最新 push 即丢」：web 渲染恒滞后 native push 一拍，push 密集期会误杀全部合法报文。
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

@Suite("layoutReport 陈旧丢弃闸（DOGFOOD_M3_13 F4）")
@MainActor
struct LayoutReportGateTests {

    @Test("layoutSeq 解析：s<n> → n；demo/fixture 屏名 → nil（不参与丢弃）")
    func seqParsing() {
        #expect(CompositeRootViewController.layoutSeq("s1") == 1)
        #expect(CompositeRootViewController.layoutSeq("s42") == 42)
        #expect(CompositeRootViewController.layoutSeq("composite-demo") == nil)
        #expect(CompositeRootViewController.layoutSeq("terminal-grid-live") == nil)
        #expect(CompositeRootViewController.layoutSeq("s") == nil)
        #expect(CompositeRootViewController.layoutSeq("s12x") == nil)
    }

    @Test("闸语义：seq< 丢弃；== 放行（拖动期同 id 多报）；> 推高；非序 id 恒放行")
    func gateSemantics() {
        var gate = LayoutReportGate()
        #expect(gate.admit(stateId: "s3") == true)
        #expect(gate.admit(stateId: "s3") == true)  // 同 id 多报常态，绝不丢
        #expect(gate.admit(stateId: "s2") == false) // 陈旧丢弃
        #expect(gate.admit(stateId: "s5") == true)
        #expect(gate.admit(stateId: "s4") == false)
        #expect(gate.admit(stateId: "composite-demo") == true) // 非序 id 放行且不动高水位
        #expect(gate.admit(stateId: "s5") == true)
    }

    /// 行为级红锚：换序到达的陈旧报文不得覆盖新鲜几何（真 CompositeRoot 装配，MainWindowSizingTests 同型）。
    @Test("换序陈旧报文不得覆盖新鲜 surface 几何（旧代码红：latest-wins 照单全收）")
    func staleReportMustNotOverwriteFreshGeometry() throws {
        let tmpRoot = FileManager.default.temporaryDirectory
            .appendingPathComponent("muxvo-f4-\(UUID().uuidString)")
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

        let wide = TermRect(terminalId: sid.raw, x: 0, y: 0, w: 1200, h: 800, visible: true, role: .grid)
        let narrow = TermRect(terminalId: sid.raw, x: 0, y: 0, w: 333, h: 569, visible: true, role: .grid)

        root.handle(.layoutReport(stateId: "s5", rects: [wide], viewportW: nil, viewportH: nil))   // 新鲜宽报文先到
        root.handle(.layoutReport(stateId: "s3", rects: [narrow], viewportW: nil, viewportH: nil)) // 陈旧窄报文换序后至

        let frame = try #require(root.attachedSurfaceFrames["\(sid.raw)#grid"])
        // 旧代码红：latest-wins 把陈旧 333×569 套上 surface；新代码：s3 < 高水位 5 丢弃，几何保持宽。
        #expect(Int(frame.width) == 1200)
        #expect(Int(frame.height) == 800)
    }
}
