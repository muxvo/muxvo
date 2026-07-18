// 列表模式 TerminalService 半（批B B1，term-list-mode.md）：toggleListMode 重推（viewMode 落 .list/.tiling）
// + 尺寸门泛化红绿锚（List 态非选中后台会话在切换/注入前获真实尺寸——主格拷贝，防 80×24 烧写）。
// reducer 半归 UIStateProjectionListModeTests；web/视觉/e2e 半归 web tests + golden + e2e。
//
// 惯例沿 TerminalServiceMinimizeTests：便利构造 makeService(root:) + onState 捕获 + catTemplate 真 PTY。
import AppKit
import Foundation
import Testing
import MuxvoBridge
import MuxvoKit
import MuxvoStorage
@testable import MuxvoAppCore
@testable import MuxvoTerm

@Suite("列表模式 service 半（批B B1，term-list-mode.md）", .serialized)
@MainActor
struct TerminalServiceListModeTests {

    private func makeTempRoot() -> URL {
        let base = FileManager.default.temporaryDirectory
            .appendingPathComponent("muxvo-listmode-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        return base
    }

    /// /bin/cat 真 PTY 模板：pid>0、SIGHUP 即退。
    private func catTemplate() -> TerminalSession.Config {
        var c = TerminalSession.Config()
        c.executablePath = "/bin/cat"
        c.argv = ["cat"]
        return c
    }

    private func makeService(root: URL) -> TerminalService {
        let store = ConfigStore(configFileURL: root.appendingPathComponent(ConfigStore.configFileName))
        return TerminalService(
            configStore: store, ptyChildrenStore: PtyChildrenStore(root: root),
            homePath: NSHomeDirectory(), dataRoot: root, configTemplate: catTemplate)
    }

    @Test("TG_LIST_toggle_menu（service 半）：toggleListMode 立即重推 ui.state.viewMode = .list，再 toggle 回 .tiling")
    func toggleListModeRepublishes() throws {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let service = makeService(root: root)
        defer { service.registry.shutdownForTeardown() }
        var captured: UIState?
        service.onState = { captured = $0 }

        guard case .created(let t1, _) = service.handleTermCommand(.create(cwd: nil)),
              case .created = service.handleTermCommand(.create(cwd: nil)) else {
            Issue.record("create 应成功"); return
        }
        service.handleAction(.tileClick(terminalId: t1)) // 选中 t1 作详情

        service.toggleListMode()
        var snap = try #require(captured)
        #expect(snap.viewMode == .list)
        #expect(snap.selectedId == t1) // 缺省链保持已选
        #expect(snap.focusedId == nil)

        service.toggleListMode()
        snap = try #require(captured)
        #expect(snap.viewMode == .tiling)
        #expect(snap.selectedId == t1) // 切回平铺仍高亮
    }

    @Test("TG_LIST_toggle_button（service 半）：web 幽灵钮过桥 handleAction(.toggleListMode) 路由到 projection.toggleListMode（List↔Tiling 与菜单同落）")
    func toggleListModeActionRoutes() throws {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let service = makeService(root: root)
        defer { service.registry.shutdownForTeardown() }
        var captured: UIState?
        service.onState = { captured = $0 }

        guard case .created(let t1, _) = service.handleTermCommand(.create(cwd: nil)),
              case .created = service.handleTermCommand(.create(cwd: nil)) else {
            Issue.record("create 应成功"); return
        }
        service.handleAction(.tileClick(terminalId: t1)) // 选中 t1 作详情

        // 幽灵钮点击 = web→桥 ui.action(toggleListMode)；经 handleAction 路由（非直调 service.toggleListMode）。
        service.handleAction(.toggleListMode)
        var snap = try #require(captured)
        #expect(snap.viewMode == .list)
        #expect(snap.selectedId == t1) // 缺省链保持已选
        #expect(snap.focusedId == nil)

        service.handleAction(.toggleListMode) // 再点 → 回平铺
        snap = try #require(captured)
        #expect(snap.viewMode == .tiling)
        #expect(snap.selectedId == t1) // 切回平铺仍高亮
    }

    @Test("TG_LIST_never_selected_size_gate: List 态非选中后台会话未定尺寸 → ensureBackgroundSized 拷贝选中主格尺寸（注入/切换前过门）")
    func listBackgroundSizeGateCopiesSelectedSize() {
        let root = makeTempRoot(); defer { try? FileManager.default.removeItem(at: root) }
        let service = makeService(root: root)
        defer { service.registry.shutdownForTeardown() }

        guard case .created(let detail, _) = service.handleTermCommand(.create(cwd: nil)),
              case .created(let background, _) = service.handleTermCommand(.create(cwd: nil)) else {
            Issue.record("create 应成功"); return
        }
        service.handleAction(.tileClick(terminalId: detail)) // 选中 detail
        service.toggleListMode()                             // 进 List：detail=选中主格、background=后台
        let detailSession = service.registry.session(for: SessionID(raw: detail))!
        let backgroundSession = service.registry.session(for: SessionID(raw: background))!

        // 前置：两会话都停 spawn 默认（未收真实 resize）→ 门无源可拷，不动。
        #expect(!backgroundSession.hasReceivedResize)
        service.ensureBackgroundSized()
        #expect(!backgroundSession.hasReceivedResize, "无 sized 可见源时不拷（不造假尺寸）")

        // 选中主格收到真实 resize（模拟详情洞 layoutReport 落地）→ 门把尺寸拷给 List 后台会话。
        #expect(detailSession.resize(cols: 187, rows: 42))
        service.ensureBackgroundSized()
        #expect(backgroundSession.hasReceivedResize, "红绿锚：尺寸门未泛化到 List 后台集时此断言必红（80×24 超时注入）")
        #expect(backgroundSession.cols == 187)
        #expect(backgroundSession.rows == 42)

        // 幂等：已 sized 的后台会话不再被覆盖（真 resize 到达后门永不再触）。
        #expect(backgroundSession.resize(cols: 100, rows: 30))
        service.ensureBackgroundSized()
        #expect(backgroundSession.cols == 100, "已 sized 会话门不覆盖")

        // 切回 Tiling → 尺寸门泛化仅 List 态生效：新建未 sized 终端在 Tiling 态不被门碰（后台集恒空）。
        service.toggleListMode() // 回 Tiling
        guard case .created(let fresh, _) = service.handleTermCommand(.create(cwd: nil)) else {
            Issue.record("create 应成功"); return
        }
        let freshSession = service.registry.session(for: SessionID(raw: fresh))!
        service.ensureBackgroundSized()
        #expect(!freshSession.hasReceivedResize, "Tiling 态无收起/无 List 后台 → 尺寸门不碰任何终端")
    }
}
