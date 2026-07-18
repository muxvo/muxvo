// 洞区 native 点击路由（DOGFOOD_M3_06）：焦点跟随点击后同步 tile 选中态的 native 直报链单测。
// 三层：
//   R1 纯函数 surfaceClickAction：role→ui.action 映射（grid→tileClick / sidebarPreview→sidebarSelect / island→nil）。
//   R2 Host 接线：applyLayout 建 surface 时注入 onUserClick（捕获 role），视图点击回报 → onSurfaceClick 带正确 (id, role)。
//   R3 派发效果：surfaceClickAction 映射的动作经 TerminalService.handleAction（与 web 同路）→ projection 选中态变化。
//
// 命名纪律：本文件无 spec-ID 翻牌 → 测试名不得像 spec ID（防 E_FORGED_ID）。
import AppKit
import Foundation
import Testing
import MuxvoBridge
import MuxvoKit
import MuxvoStorage
import MuxvoTerm
import MuxvoTermRender
@testable import MuxvoAppCore

// MARK: - R1 role→action 纯函数映射

@Suite("洞区点击 role→action 映射（DOGFOOD_M3_06 R1）")
@MainActor
struct SurfaceClickActionMapTests {
    @Test("grid→tileClick、sidebarPreview→sidebarSelect、island→nil")
    func roleMapping() {
        #expect(CompositeRootViewController.surfaceClickAction(terminalId: "T1", role: .grid)
                == .tileClick(terminalId: "T1"))
        #expect(CompositeRootViewController.surfaceClickAction(terminalId: "T1", role: .sidebarPreview)
                == .sidebarSelect(terminalId: "T1"))
        #expect(CompositeRootViewController.surfaceClickAction(terminalId: "T1", role: .island) == nil)
    }
}

// MARK: - R2 Host 建 surface 注入 onUserClick → onSurfaceClick 回报

@Suite("Host 洞下 surface 点击回报（DOGFOOD_M3_06 R2）", .serialized)
@MainActor
struct SurfaceHostClickReportTests {

    private func makeHost() -> TerminalSurfaceHostViewController {
        let provider = SurfaceProvider(registry: SessionRegistry(), device: nil)
        let host = TerminalSurfaceHostViewController(surfaceProvider: provider)
        _ = host.view // 触发 loadView
        return host
    }

    private func rect(_ id: String, _ role: TermRectRole) -> TermRect {
        TermRect(terminalId: id, x: 0, y: 0, w: 100, h: 100, visible: true, role: role)
    }

    @Test("grid 洞：建 surface 注入 onUserClick，点击回报 (id, grid)")
    func gridSurfaceReportsClick() {
        let host = makeHost()
        var captured: (String, TermRectRole)?
        host.onSurfaceClick = { captured = ($0, $1) }
        host.applyLayout([rect("T1", .grid)], stateId: "s1")

        let sv = host.attachedSurfaceView(forKey: "T1#grid") as? TerminalSurfaceView
        #expect(sv != nil, "grid 洞应建 TerminalSurfaceView")
        sv?.onUserClick?("T1") // 模拟 mouseDown 焦点跟随后的回报
        #expect(captured?.0 == "T1")
        #expect(captured?.1 == .grid)
    }

    @Test("sidebarPreview 洞：回报 (id, sidebarPreview)——role 随洞捕获正确")
    func sidebarSurfaceReportsClick() {
        let host = makeHost()
        var captured: (String, TermRectRole)?
        host.onSurfaceClick = { captured = ($0, $1) }
        host.applyLayout([rect("T2", .sidebarPreview)], stateId: "s1")

        let sv = host.attachedSurfaceView(forKey: "T2#sidebarPreview") as? TerminalSurfaceView
        #expect(sv != nil)
        sv?.onUserClick?("T2")
        #expect(captured?.0 == "T2")
        #expect(captured?.1 == .sidebarPreview)
    }
}

// MARK: - R3 映射动作派发 → projection 选中态变化（与 web 同路）

@Suite("洞区点击派发改 projection 选中态（DOGFOOD_M3_06 R3）", .serialized)
@MainActor
struct SurfaceClickDispatchTests {

    private func makeTempRoot() -> URL {
        let base = FileManager.default.temporaryDirectory
            .appendingPathComponent("muxvo-clickroute-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        return base
    }

    private func makeService(root: URL) -> TerminalService {
        let store = ConfigStore(configFileURL: root.appendingPathComponent(ConfigStore.configFileName))
        return TerminalService(
            configStore: store, ptyChildrenStore: PtyChildrenStore(root: root),
            homePath: NSHomeDirectory(), dataRoot: root)
    }

    @Test("grid 点击派发 tileClick → selectedId 变；sidebarPreview 派发 sidebarSelect → activeSidebarId 变")
    func dispatchChangesSelection() throws {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let service = makeService(root: root)
        let ids = service.createStartupTerminals(count: 2) // 真 spawn；order=[id0,id1]
        try #require(ids.count == 2)
        defer { for id in ids { _ = service.handleTermCommand(.close(terminalId: id)) } }

        var last: UIState?
        service.onState = { last = $0 }

        // grid 点 id0 → tileClick → selectedId=id0（与 web tileClick 同 handleAction 路）。
        let gridAction = try #require(
            CompositeRootViewController.surfaceClickAction(terminalId: ids[0], role: .grid))
        service.handleAction(gridAction)
        #expect(last?.selectedId == ids[0])

        // sidebarPreview 点 id1 → sidebarSelect → activeSidebarId=id1。
        let sideAction = try #require(
            CompositeRootViewController.surfaceClickAction(terminalId: ids[1], role: .sidebarPreview))
        service.handleAction(sideAction)
        #expect(last?.activeSidebarId == ids[1])
    }
}

// MARK: - D 双击聚焦路由（settings-dogfood 批，PAR-13 消费端接线）

@Suite("洞区双击 role→action 映射（doubleClickToFocus 门控）")
@MainActor
struct SurfaceDoubleClickActionMapTests {
    @Test("开关关→nil；开+grid→maximizeTile；开+sidebarPreview/island→nil（TG_dblclick_gated_off 半）")
    func gatedMapping() {
        #expect(CompositeRootViewController.surfaceDoubleClickAction(
            terminalId: "T1", role: .grid, enabled: false) == nil)
        #expect(CompositeRootViewController.surfaceDoubleClickAction(
            terminalId: "T1", role: .grid, enabled: true) == .maximizeTile(terminalId: "T1"))
        #expect(CompositeRootViewController.surfaceDoubleClickAction(
            terminalId: "T1", role: .sidebarPreview, enabled: true) == nil)
        #expect(CompositeRootViewController.surfaceDoubleClickAction(
            terminalId: "T1", role: .island, enabled: true) == nil)
    }
}

@Suite("Host 洞下 surface 双击回报（同 onUserClick 体例）", .serialized)
@MainActor
struct SurfaceHostDoubleClickReportTests {
    @Test("grid 洞：建 surface 注入 onUserDoubleClick，双击回报 (id, grid)")
    func gridSurfaceReportsDoubleClick() {
        let provider = SurfaceProvider(registry: SessionRegistry(), device: nil)
        let host = TerminalSurfaceHostViewController(surfaceProvider: provider)
        _ = host.view
        var captured: (String, TermRectRole)?
        host.onSurfaceDoubleClick = { captured = ($0, $1) }
        host.applyLayout(
            [TermRect(terminalId: "T1", x: 0, y: 0, w: 100, h: 100, visible: true, role: .grid)],
            stateId: "s1")

        let sv = host.attachedSurfaceView(forKey: "T1#grid") as? TerminalSurfaceView
        #expect(sv != nil, "grid 洞应建 TerminalSurfaceView")
        sv?.onUserDoubleClick?("T1") // 模拟 mouseDown clickCount==2 的回报
        #expect(captured?.0 == "T1")
        #expect(captured?.1 == .grid)
    }
}

@Suite("双击派发 maximizeTile 改 viewMode（与 web 同 handleAction 路）", .serialized)
@MainActor
struct SurfaceDoubleClickDispatchTests {
    private func makeTempRoot() -> URL {
        let base = FileManager.default.temporaryDirectory
            .appendingPathComponent("muxvo-dblclick-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        return base
    }

    private func makeService(root: URL, doubleClickToFocus: Bool) -> TerminalService {
        let store = ConfigStore(configFileURL: root.appendingPathComponent(ConfigStore.configFileName))
        try? store.save(MuxvoConfig(doubleClickToFocus: doubleClickToFocus))
        return TerminalService(
            configStore: store, ptyChildrenStore: PtyChildrenStore(root: root),
            homePath: NSHomeDirectory(), dataRoot: root)
    }

    @Test("开关关：门控读 false → 映射 nil，viewMode 不变（TG_dblclick_gated_off）")
    func disabledDoubleClickIsNoop() throws {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let service = makeService(root: root, doubleClickToFocus: false)
        let ids = service.createStartupTerminals(count: 1)
        try #require(ids.count == 1)
        defer { for id in ids { _ = service.handleTermCommand(.close(terminalId: id)) } }

        #expect(service.doubleClickToFocusEnabled == false)
        var last: UIState?
        service.onState = { last = $0 }
        let action = CompositeRootViewController.surfaceDoubleClickAction(
            terminalId: ids[0], role: .grid, enabled: service.doubleClickToFocusEnabled)
        #expect(action == nil, "开关关：双击不产生动作")
        service.handleAction(.tileClick(terminalId: ids[0])) // 驱一次推送取快照
        #expect(last?.viewMode == .tiling)
    }

    @Test("开关开：grid 双击 → Focused 且 focusedId 正确；重双击幂等（TG_dblclick_focus / TG_dblclick_focused_idempotent）")
    func enabledDoubleClickFocusesIdempotently() throws {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let service = makeService(root: root, doubleClickToFocus: true)
        let ids = service.createStartupTerminals(count: 2)
        try #require(ids.count == 2)
        defer { for id in ids { _ = service.handleTermCommand(.close(terminalId: id)) } }

        #expect(service.doubleClickToFocusEnabled == true)
        var last: UIState?
        service.onState = { last = $0 }
        let action = try #require(CompositeRootViewController.surfaceDoubleClickAction(
            terminalId: ids[1], role: .grid, enabled: service.doubleClickToFocusEnabled))
        service.handleAction(action)
        #expect(last?.viewMode == .focused)
        #expect(last?.focusedId == ids[1])
        service.handleAction(action) // Focused 下重双击 = 幂等重进（legacy 非 toggle 语义）
        #expect(last?.viewMode == .focused)
        #expect(last?.focusedId == ids[1])
    }
}

// MARK: - C 预览被动化 host 接线（DOGFOOD_M3_10）

/// applyLayout 按洞 role 给新建 surface 置 drivesSessionResize（grid→true、sidebarPreview→false）：
/// 聚焦形态下唯一存活的窄预览不得驱动共享 PTY resize（否则 CC 按窄 cols 硬换行烧 scrollback 不可逆），
/// 回平铺后新 grid surface 恢复驱动、网格复原。真隔离会话（spawnShell:false）走 registry。
/// 旧代码红：预览 surface 默认 true → layout 把会话压窄。命名纪律：测试名不像 spec ID。
@Suite("Host applyLayout 按 role 置预览被动（DOGFOOD_M3_10 C）", .serialized)
@MainActor
struct SurfacePassiveResizeHostTests {

    private func makeIsolated() throws -> (SessionRegistry, SessionID) {
        let registry = SessionRegistry()
        var cfg = TerminalSession.Config()
        cfg.spawnShell = false
        guard case let .success(id) = registry.create(config: cfg) else {
            throw CocoaError(.featureUnsupported) // 隔离会话建失败即 fail
        }
        return (registry, id)
    }

    private func gridRect(_ id: String) -> TermRect {
        TermRect(terminalId: id, x: 0, y: 0, w: 1200, h: 800, visible: true, role: .grid)
    }
    private func previewRect(_ id: String) -> TermRect {
        TermRect(terminalId: id, x: 0, y: 0, w: 300, h: 160, visible: true, role: .sidebarPreview)
    }

    @Test("grid 驱动、sidebarPreview 被动：聚焦预览 layout 不改网格，回平铺网格复原")
    func rolePassivityAndRecovery() throws {
        let (registry, sid) = try makeIsolated()
        let id = sid.raw
        let s = try #require(registry.session(for: sid))
        defer { registry.close(sid) }

        let provider = SurfaceProvider(registry: registry, device: nil)
        let host = TerminalSurfaceHostViewController(surfaceProvider: provider)
        _ = host.view
        host.view.frame = NSRect(x: 0, y: 0, width: 1440, height: 900)

        // ① 平铺：grid 洞定宽网格（显式 layout——headless 无 runloop 不自动触发）。
        // DOGFOOD_M3_13 F3：首帧经 settle——注钟 flush 取真基线（~168 列），防基线退化成未提交初值。
        host.applyLayout([gridRect(id)], stateId: "s1")
        let gridSurface = try #require(host.attachedSurfaceView(forKey: "\(id)#grid") as? TerminalSurfaceView)
        var now1: UInt64 = 1_000
        gridSurface.settleNowMs = { now1 }
        gridSurface.layout()
        now1 += 200
        gridSurface.flushGridSettle()
        let wideCols = Int(s.cols)
        #expect(wideCols >= 100)
        #expect(gridSurface.drivesSessionResize == true) // grid 主视图恒驱动

        // ② 聚焦形态：grid 洞缺席（0×0 → detach），唯一存活 = 窄 sidebarPreview。
        host.applyLayout([previewRect(id)], stateId: "s2")
        #expect(host.attachedSurfaceView(forKey: "\(id)#grid") == nil) // grid detach
        let previewSurface = try #require(host.attachedSurfaceView(forKey: "\(id)#sidebarPreview") as? TerminalSurfaceView)
        #expect(previewSurface.drivesSessionResize == false) // 旧代码红：默认 true
        previewSurface.layout()
        #expect(Int(s.cols) == wideCols) // 旧代码红：预览 layout 把会话压窄 ~35 列

        // ③ 回平铺：grid 洞回归 → 新 grid surface（flag=true）、网格复原（F3 后经 settle）。
        host.applyLayout([gridRect(id)], stateId: "s3")
        let gridSurface2 = try #require(host.attachedSurfaceView(forKey: "\(id)#grid") as? TerminalSurfaceView)
        #expect(gridSurface2.drivesSessionResize == true)
        var now2: UInt64 = 50_000
        gridSurface2.settleNowMs = { now2 }
        gridSurface2.layout()
        now2 += 200
        gridSurface2.flushGridSettle()
        #expect(Int(s.cols) == wideCols) // 网格回宽（恢复链）
    }
}
