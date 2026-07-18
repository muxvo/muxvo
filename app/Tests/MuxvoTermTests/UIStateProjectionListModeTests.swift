// 列表模式 reducer 半（批B B1，term-list-mode.md）：TG_LIST_* 案例池的投影层断言。
// web 半（左栏 240px/单洞/收起分组/空态）归 web/tests；尺寸门泛化半归 TerminalServiceListModeTests；
// 视觉/e2e 半（详情完整 header 真交互）归 golden + e2e（主会话）。
//
// 惯例沿 UIStateProjectionMinimizeTests：Swift Testing + isolatedTemplate（无真 PTY）+ makeProjection helper；
// close 全链用 cleanExitTemplate（真进程即退 → 终态 isRemovable → closeTerminal 走直移除 dropTerminal）。
import Darwin
import Foundation
import Testing
import MuxvoKit
import MuxvoTermCore
@testable import MuxvoTerm

private func isolatedTemplate() -> TerminalSession.Config {
    var c = TerminalSession.Config()
    c.spawnShell = false
    return c
}

private func cleanExitTemplate() -> TerminalSession.Config {
    var c = TerminalSession.Config()
    c.executablePath = "/bin/sh"
    c.argv = ["sh", "-c", "exit 0"]
    return c
}

private func tmpDir() -> String { FileManager.default.temporaryDirectory.path }

// 真进程退出→终态由 SessionRegistry.awaitAllReaped 事件驱动等待（M7 批6，替代 pollUntil 收尸轮询，
// 见 ReapWait.swift）。

private func makeProjection(
    _ registry: SessionRegistry, count: Int,
    template: @escaping () -> TerminalSession.Config = isolatedTemplate
) -> (UIStateProjection, [String]) {
    let projection = UIStateProjection(registry: registry, homePath: tmpDir(), configTemplate: template)
    var ids: [String] = []
    for _ in 0..<count {
        if case let .created(id, _) = projection.createTerminal(cwd: nil) { ids.append(id) }
    }
    precondition(ids.count == count, "测试前提：全部创建成功")
    return (projection, ids)
}

@Suite("列表模式 reducer（批B B1，term-list-mode.md）", .serialized)
struct UIStateProjectionListModeTests {

    @Test("TG_LIST_toggle_menu: 非 List→List（清 focused/activeSidebar）+ List→Tiling（selectedId 保持）二态切换")
    func toggleListModeSwitchesTwoWay() {
        let registry = SessionRegistry()
        defer { registry.shutdownForTeardown() }
        let (projection, ids) = makeProjection(registry, count: 3)

        // 自 Tiling 进 List：清 focused/activeSidebar；selectedId 走缺省链（已选 b 保持）。
        projection.selectTile(ids[1])
        projection.toggleListMode()
        var snap = projection.snapshot()
        #expect(snap.viewMode == .list)
        #expect(snap.focusedId == nil)
        #expect(snap.activeSidebarId == nil)
        #expect(snap.selectedId == ids[1])

        // List → Tiling：selectedId 保持（切回平铺仍高亮该 tile）。
        projection.toggleListMode()
        snap = projection.snapshot()
        #expect(snap.viewMode == .tiling)
        #expect(snap.selectedId == ids[1])

        // 自 Focused 进 List：focusedId 入缺省链后即清（focused → selectedId 落 a）。
        projection.maximizeTile(ids[0]) // Focused，focusedId=a、selectedId 仍 b（maximize 不改选中）
        projection.toggleListMode()
        snap = projection.snapshot()
        #expect(snap.viewMode == .list)
        #expect(snap.focusedId == nil)
        #expect(snap.activeSidebarId == nil)
        #expect(snap.selectedId == ids[1]) // selectedId(b) 优先于 focusedId(a)
    }

    @Test("TG_LIST_default_selection: 缺省选中链 selectedId ?? focusedId ?? 首个非收起；收起项不入链；全收起→nil")
    func defaultSelectionChain() {
        // 分支1：selectedId 缺席、focusedId 存在 → 用 focused（且收起项不入链）。
        do {
            let registry = SessionRegistry()
            defer { registry.shutdownForTeardown() }
            let (projection, ids) = makeProjection(registry, count: 3)
            projection.minimizeTile(ids[2]) // c 收起 → selectedId 清（c 曾是末位选中）
            projection.maximizeTile(ids[0]) // Focused，focusedId=a、selectedId 仍 nil
            projection.toggleListMode()
            let snap = projection.snapshot()
            #expect(snap.selectedId == ids[0]) // nil ?? focusedId(a) → a
        }
        // 分支2：selectedId/focusedId 皆缺席 → 首个非收起（跳过收起的 a、c）。
        do {
            let registry = SessionRegistry()
            defer { registry.shutdownForTeardown() }
            let (projection, ids) = makeProjection(registry, count: 3)
            projection.minimizeTile(ids[2]) // c 收起 → selectedId 清
            projection.minimizeTile(ids[0]) // a 收起（非选中，只收起）
            // 现 selectedId=nil、focusedId=nil、非收起=[b]
            projection.toggleListMode()
            #expect(projection.snapshot().selectedId == ids[1]) // 首个非收起 = b
        }
        // 分支3：全收起 → nil（空态）。
        do {
            let registry = SessionRegistry()
            defer { registry.shutdownForTeardown() }
            let (projection, ids) = makeProjection(registry, count: 2)
            projection.minimizeTile(ids[1]) // 收起选中末位 → selectedId 清
            projection.minimizeTile(ids[0])
            projection.toggleListMode()
            #expect(projection.snapshot().selectedId == nil)
        }
    }

    @Test("TG_LIST_detail_interactive: 详情 = 选中的**非收起活体**终端（web 渲完整 TermTile role=grid 真交互；reducer 保证不降级为预览）")
    func detailIsLiveSelectedTerminal() {
        let registry = SessionRegistry()
        defer { registry.shutdownForTeardown() }
        let (projection, ids) = makeProjection(registry, count: 3)

        projection.selectTile(ids[1])
        projection.toggleListMode()
        let snap = projection.snapshot()
        // 详情终端 = selectedId、非收起（web 据此渲完整可交互 TermTile；完整 header/role=grid 由 web/e2e 验）。
        #expect(snap.selectedId == ids[1])
        #expect(snap.terminals.first { $0.id == ids[1] }?.minimized == false)
        // 非选中终端仍是活体（非收起）——web 只对 selectedId 渲洞、其余不渲（单洞不变量在 web 半验）。
        #expect(snap.terminals.filter { !$0.minimized }.count == 3)
    }

    @Test("TG_LIST_close_selected_advances: List 态关闭选中 → 顺延 order 之后首个非收起；无则 nil；关非选中不改选中")
    func closeSelectedAdvances() {
        let registry = SessionRegistry()
        defer { registry.shutdownForTeardown() }
        // 死会话（cleanExit）→ 终态 isRemovable，closeTerminal 走直移除 dropTerminal（触发顺延逻辑）。
        let (projection, ids) = makeProjection(registry, count: 3, template: cleanExitTemplate)
        let (a, b, c) = (ids[0], ids[1], ids[2])

        #expect(registry.awaitAllReaped(ids.map { SessionID(raw: $0) })) // 事件驱动等全部收尸至终态（M7 批6）
        for id in ids { projection.noteStateChange(SessionID(raw: id), registry.state(of: SessionID(raw: id)) ?? .stopped) }

        projection.toggleListMode()   // List
        projection.selectTile(b)      // 选中中位 b

        // 关闭非选中 a：选中不变（仍 b）。
        guard case .closed = projection.closeTerminal(terminalId: a) else { Issue.record("死会话 close 应直移除"); return }
        #expect(projection.snapshot().selectedId == b)
        #expect(projection.snapshot().terminals.map(\.id) == [b, c])

        // 关闭选中 b：顺延 order 之后首个非收起 = c。
        guard case .closed = projection.closeTerminal(terminalId: b) else { Issue.record("死会话 close 应直移除"); return }
        #expect(projection.snapshot().selectedId == c)
        #expect(projection.snapshot().terminals.map(\.id) == [c])

        // 关闭选中 c（末位，其后无非收起）→ selectedId nil。
        guard case .closed = projection.closeTerminal(terminalId: c) else { Issue.record("死会话 close 应直移除"); return }
        #expect(projection.snapshot().selectedId == nil)
        #expect(projection.snapshot().terminals.isEmpty)
    }

    @Test("List 态收起选中项 → 选中顺延（与 close 对称，详情不空悬——批B 对抗 MINOR-2）；Tiling 态收起选中仍清空")
    func minimizeSelectedAdvancesInList() {
        let registry = SessionRegistry()
        defer { registry.shutdownForTeardown() }
        let (projection, ids) = makeProjection(registry, count: 3)
        let (a, b, c) = (ids[0], ids[1], ids[2])

        // List 态收起选中中位 b → 顺延到 c（详情不空悬）。
        projection.toggleListMode()
        projection.selectTile(b)
        projection.minimizeTile(b)
        #expect(projection.snapshot().selectedId == c)

        // 收起选中末位 c（其后无非收起）→ nil 空态。
        projection.selectTile(c)
        projection.minimizeTile(c)
        #expect(projection.snapshot().selectedId == nil)

        // Tiling 态收起选中仍清空（既有语义守卫，TG_MIN_minimize_leaves_grid 口径不变）。
        projection.toggleListMode() // 回 Tiling
        projection.restoreTile(b)   // 恢复并选中 b
        #expect(projection.snapshot().selectedId == b)
        projection.minimizeTile(b)
        #expect(projection.snapshot().selectedId == nil)
        _ = a // a 仅作维序首位
    }

    @Test("TG_LIST_maximize_from_detail: 详情最大化进 Focused（focusedId=该终端）；restoreTiling 恒回 Tiling 不回 List")
    func maximizeFromDetailThenRestoreToTiling() {
        let registry = SessionRegistry()
        defer { registry.shutdownForTeardown() }
        let (projection, ids) = makeProjection(registry, count: 2)

        projection.toggleListMode()
        projection.selectTile(ids[0])
        projection.maximizeTile(ids[0]) // 详情最大化 → Focused
        var snap = projection.snapshot()
        #expect(snap.viewMode == .focused)
        #expect(snap.focusedId == ids[0])

        // 「回到平铺」恒落 Tiling（不记忆来路 List）。
        projection.restoreTiling()
        snap = projection.snapshot()
        #expect(snap.viewMode == .tiling)
        #expect(snap.focusedId == nil)
    }

    @Test("List→Tiling 洞守恒前置（reducer 半）：切回后 viewMode=.tiling、所有非收起终端仍在维序（web 半验洞重现）")
    func backToTilingKeepsVisibleTerminals() {
        let registry = SessionRegistry()
        defer { registry.shutdownForTeardown() }
        let (projection, ids) = makeProjection(registry, count: 3)

        projection.toggleListMode()
        #expect(projection.snapshot().viewMode == .list)
        projection.toggleListMode()
        let snap = projection.snapshot()
        #expect(snap.viewMode == .tiling)
        #expect(snap.terminals.map(\.id) == ids) // 非收起终端全在（洞重现由 web/TG_LIST_back_to_tiling_holes_restore 验）
    }
}
