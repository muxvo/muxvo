// SessionHub（批C/D C2「共享层抽取」）：全局子系统单件——registry 注入缝（跨窗共享唯一 registry）、
// 全局字号广播（applyGlobalZoom fan-out 各窗投影 + 单值持久化）、每窗 UIStateProjection 隔离（noteStateChange
// order.contains 守卫丢外来 id）、便利构造兼容缝（convenience init 自建 hub、既有单窗 API 全可用）。
//
// 命名纪律：MW_font_zoom_global / MW_uistate_isolated_per_window 是 multi-window.md §8.1 强制表案例名
// （spec-coverage 1:1 兜底），@Test 标题内嵌该 token；其余测试名非 spec-ID（防 E_FORGED_ID）。
import AppKit
import Foundation
import Testing
import MuxvoBridge
import MuxvoStorage
@testable import MuxvoAppCore
@testable import MuxvoTerm

@Suite("SessionHub 全局子系统与每窗隔离（批C C2）", .serialized)
@MainActor
struct SessionHubTests {

    private func makeTempRoot() -> URL {
        let base = FileManager.default.temporaryDirectory
            .appendingPathComponent("muxvo-hub-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        return base
    }

    private func makeHub(root: URL) -> SessionHub {
        let store = ConfigStore(configFileURL: root.appendingPathComponent(ConfigStore.configFileName))
        return SessionHub(
            configModel: ConfigModel(store: store), ptyChildrenStore: PtyChildrenStore(root: root),
            homePath: NSHomeDirectory(), dataRoot: root)
    }

    @Test("registry 注入缝：同 hub 下两窗 TerminalService 共享唯一 registry（会话池全局，§2.1）")
    func sharedRegistryAcrossWindows() {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let hub = makeHub(root: root)
        defer { hub.registry.shutdownForTeardown() }
        let s1 = TerminalService(hub: hub, ownsHub: false)
        let s2 = TerminalService(hub: hub, ownsHub: false)
        #expect(s1.registry === hub.registry)
        #expect(s2.registry === hub.registry)
        #expect(s1.registry === s2.registry)
    }

    @Test("MW_font_zoom_global：一窗 ⌘+ 经 hub.applyGlobalZoom 广播两窗字号 + 单值持久化 config.terminal.fontSize（裁决⑦）")
    func MW_font_zoom_global() {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let hub = makeHub(root: root)
        defer { hub.registry.shutdownForTeardown() }
        let base = hub.configModel.config.terminal.fontSize
        let s1 = TerminalService(hub: hub, ownsHub: false)
        let s2 = TerminalService(hub: hub, ownsHub: false)
        var f1: [Int] = []; var f2: [Int] = []
        s1.onFontSizeChanged = { f1.append($0) }
        s2.onFontSizeChanged = { f2.append($0) }

        // 触发窗 s1 ⌘+ → hub 广播半：逐窗投影步进字号 + 各窗 onFontSizeChanged。
        let newSize = s1.applyZoom(.in)
        #expect(newSize == base + 1)
        #expect(f1 == [base + 1], "触发窗字号广播")
        #expect(f2 == [base + 1], "另一窗同步字号广播（全局单值，非各窗独立）")
        // 单值持久化（全局，非 per-window）。
        #expect(hub.configModel.config.terminal.fontSize == base + 1)

        // 复位：另一窗触发 ⌘0 亦全窗同步回 base。
        _ = s2.applyZoom(.reset)
        #expect(hub.configModel.config.terminal.fontSize == base)
        #expect(f1.last == base && f2.last == base)
    }

    @Test("MW_uistate_isolated_per_window：同 hub 两窗 UIStateProjection 独立——A 窗终端/panelMode 变化不入 B 窗快照（noteStateChange order 守卫）")
    func MW_uistate_isolated_per_window() {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let hub = makeHub(root: root)
        defer { hub.registry.shutdownForTeardown() }
        let sA = TerminalService(hub: hub, ownsHub: false)
        let sB = TerminalService(hub: hub, ownsHub: false)
        var aState: UIState?; var bState: UIState?
        sA.onState = { aState = $0 }
        sB.onState = { bState = $0 }

        guard case let .created(aId, _) = sA.handleTermCommand(.create(cwd: root.path)),
              case let .created(bId, _) = sB.handleTermCommand(.create(cwd: root.path)) else {
            Issue.record("两窗建终端失败"); return
        }
        sA.republishState(); sB.republishState()
        let aTerms = Set(aState?.terminals.map(\.id) ?? [])
        let bTerms = Set(bState?.terminals.map(\.id) ?? [])
        // 会话共享全局 registry，但「归属哪个窗」纯属各窗投影：A 建的终端不入 B 快照，反之亦然。
        #expect(aTerms.contains(aId) && !aTerms.contains(bId), "A 窗只含自己的终端")
        #expect(bTerms.contains(bId) && !bTerms.contains(aId), "B 窗只含自己的终端")

        // panelMode 窗内私有：A 切 taskCenter 不影响 B。
        sA.setPanelMode(.taskCenter)
        #expect(sA.panelMode == .taskCenter)
        #expect(sB.panelMode == .terminal, "A 窗 panelMode 独立，不串到 B 窗")

        sA.stop(); sB.stop()
    }

    @Test("MW_minimized_viewmode_scoped：批A minimizedIds 与批B viewMode=List 按窗隔离——A 窗收起/列表态不入 B 窗快照")
    func MW_minimized_viewmode_scoped() {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let hub = makeHub(root: root)
        defer { hub.registry.shutdownForTeardown() }
        let sA = TerminalService(hub: hub, ownsHub: false)
        let sB = TerminalService(hub: hub, ownsHub: false)
        var aState: UIState?; var bState: UIState?
        sA.onState = { aState = $0 }
        sB.onState = { bState = $0 }

        // 两窗各建 2 终端（各自 projection，共享 registry）。
        guard case let .created(a1, _) = sA.handleTermCommand(.create(cwd: root.path)),
              case .created = sA.handleTermCommand(.create(cwd: root.path)),
              case .created = sB.handleTermCommand(.create(cwd: root.path)),
              case .created = sB.handleTermCommand(.create(cwd: root.path)) else {
            Issue.record("两窗建终端失败"); return
        }

        // A 窗：收起 a1（批A minimized）+ 切列表模式（批B viewMode=List）——纯 reducer，走各窗 projection。
        sA.handleAction(.minimizeTile(terminalId: a1))
        sA.toggleListMode()
        sB.republishState() // B 窗补推一帧（确保基线快照，A 窗操作不触 B onState）
        guard let aSnap = aState, let bSnap = bState else {
            Issue.record("两窗快照缺失"); return
        }

        // A 窗快照：a1 收起 + viewMode=List。
        #expect(aSnap.terminals.first { $0.id == a1 }?.minimized == true, "A 窗 a1 已收起")
        #expect(aSnap.viewMode == .list, "A 窗列表模式")
        // B 窗快照：零收起 + viewMode=Tiling（窗内态不串窗，§5.2 各窗私有）。
        #expect(bSnap.terminals.allSatisfy { $0.minimized != true }, "B 窗无收起项（不受 A 窗扰动）")
        #expect(bSnap.viewMode == .tiling, "B 窗仍平铺（viewMode 窗内私有，不串 A 窗）")

        sA.stop(); sB.stop()
    }

    @Test("便利构造兼容缝：convenience init 自建 hub（ownsHub），既有单窗 API（registry/panelZoom）全可用")
    func convenienceInitSelfBuildsHub() {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let store = ConfigStore(configFileURL: root.appendingPathComponent(ConfigStore.configFileName))
        let service = TerminalService(
            configStore: store, ptyChildrenStore: PtyChildrenStore(root: root),
            homePath: NSHomeDirectory(), dataRoot: root)
        defer { service.registry.shutdownForTeardown() }
        // 自建 hub：registry 转发命中自身 hub。
        #expect(service.registry === service.hub.registry)
        // 全局 panelZoom 经 hub，但既有单窗 API 语义不变。
        service.applyPanelZoom(.in)
        #expect(service.panelZoom == 1.1)
    }
}
