// 终端收起 reducer 半（批A A1，term-grid.md §11）：TG_MIN_* 案例池的投影层断言。
// web 半（rail 渲染/折叠徽标/空态提示/零洞）归 web/tests；尺寸门集成半归 TerminalServiceMinimizeTests（A3）；
// e2e 半（surface detach/re-attach）归 E2EScenarioMinimize item44（A4）。
//
// 惯例沿 TerminalServiceTests.swift：Swift Testing + isolatedTemplate（spawnShell:false 无真 PTY）+
// FakeClock（noteLastLine 去抖用）；close 全链用 cleanExitTemplate（真进程即退 → 终态）。
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

/// 可注入假毫秒时钟（noteLastLine 50ms 去抖断言用；lock 保线程安全）。
private final class FakeClock: @unchecked Sendable {
    private let lock = NSLock()
    private var value: UInt64
    init(_ start: UInt64) { value = start }
    func read() -> UInt64 { lock.lock(); defer { lock.unlock() }; return value }
    func set(_ ms: UInt64) { lock.lock(); value = ms; lock.unlock() }
    var nowMs: @Sendable () -> UInt64 { { self.read() } }
}

/// 建 N 个隔离终端，返回 (projection, ids)。registry 生命周期归调用方 defer shutdown。
private func makeProjection(
    _ registry: SessionRegistry, count: Int,
    nowMs: (() -> UInt64)? = nil,
    template: @escaping () -> TerminalSession.Config = isolatedTemplate
) -> (UIStateProjection, [String]) {
    let projection = nowMs.map {
        UIStateProjection(registry: registry, homePath: tmpDir(), nowMs: $0, configTemplate: template)
    } ?? UIStateProjection(registry: registry, homePath: tmpDir(), configTemplate: template)
    var ids: [String] = []
    for _ in 0..<count {
        if case let .created(id, _) = projection.createTerminal(cwd: nil) { ids.append(id) }
    }
    precondition(ids.count == count, "测试前提：全部创建成功")
    return (projection, ids)
}

@Suite("终端收起 reducer（批A A1，term-grid.md §11）", .serialized)
struct UIStateProjectionMinimizeTests {

    @Test("TG_MIN_minimize_leaves_grid: minimizeTile → 快照该终端 minimized=true；其余不带；选中被收起项清 selectedId")
    func minimizeMarksSnapshot() {
        let registry = SessionRegistry()
        defer { registry.shutdownForTeardown() }
        let (projection, ids) = makeProjection(registry, count: 3)

        projection.selectTile(ids[1])
        projection.minimizeTile(ids[1])
        let snap = projection.snapshot()
        #expect(snap.terminals.first { $0.id == ids[1] }?.minimized == true)
        #expect(snap.terminals.filter { $0.minimized }.count == 1)
        #expect(snap.selectedId == nil) // 收起选中项 → 清 selectedId（§11.3）
        // order 保序：收起不动维序（§11.1）。
        #expect(snap.terminals.map(\.id) == ids)

        // 幂等：重复收起不产生额外变化。
        projection.minimizeTile(ids[1])
        #expect(projection.snapshot().terminals.filter { $0.minimized }.count == 1)
    }

    @Test("TG_MIN_restore_returns_original_slot: 恢复回 order 原槽位（保序）+ 恢复即选中")
    func restoreReturnsOriginalSlotAndSelects() {
        let registry = SessionRegistry()
        defer { registry.shutdownForTeardown() }
        let (projection, ids) = makeProjection(registry, count: 3)

        projection.minimizeTile(ids[1])
        #expect(projection.snapshot().terminals.map(\.id) == ids) // 收起期 order 不变

        projection.restoreTile(ids[1])
        let snap = projection.snapshot()
        #expect(snap.terminals.map(\.id) == ids) // 恢复回原槽（中间位）
        #expect(snap.terminals.first { $0.id == ids[1] }?.minimized == false)
        #expect(snap.selectedId == ids[1]) // 恢复即选中（§11.3）

        // 非收起 id 的 restore no-op（不改选中）。
        projection.selectTile(ids[0])
        projection.restoreTile(ids[2])
        #expect(projection.snapshot().selectedId == ids[0])
    }

    @Test("TG_MIN_restore_all: restoreAllMinimized 清空收起集，不改选中/焦点；空集 no-op")
    func restoreAllClearsSet() {
        let registry = SessionRegistry()
        defer { registry.shutdownForTeardown() }
        let (projection, ids) = makeProjection(registry, count: 3)

        projection.minimizeTile(ids[0])
        projection.minimizeTile(ids[2])
        projection.selectTile(ids[1])
        var emitted = 0
        projection.onSnapshot = { _ in emitted += 1 }

        projection.restoreAllMinimized()
        let snap = projection.snapshot()
        #expect(snap.terminals.allSatisfy { !$0.minimized })
        #expect(snap.selectedId == ids[1]) // 不改选中（§11.3）
        #expect(emitted == 1)

        projection.restoreAllMinimized() // 空集 no-op：不再 emit
        #expect(emitted == 1)
    }

    @Test("TG_MIN_reorder_preserves_minimized_slots: 可见重排收起槽锁定；无收起时与旧实现逐位等价")
    func reorderLocksMinimizedSlots() {
        let registry = SessionRegistry()
        defer { registry.shutdownForTeardown() }
        let (projection, ids) = makeProjection(registry, count: 4)
        let (a, b, c, d) = (ids[0], ids[1], ids[2], ids[3])

        // 收起 b（槽1）。web 只对可见 [a,c,d] 发新序 [d,c,a] → 期望 [d,b,c,a]（b 钉槽1）。
        projection.minimizeTile(b)
        projection.reorder([d, c, a])
        #expect(projection.snapshot().terminals.map(\.id) == [d, b, c, a])

        // 含未知 id / 重复 id / 漏可见 id：未知忽略、重复取首现、漏者按原相对序垫底（旧语义保持）。
        projection.reorder(["ghost", a, a, c]) // 可见现序 [d,c,a] → 流 [a,c] + 漏 d 垫底 → [a,b,c,d]
        #expect(projection.snapshot().terminals.map(\.id) == [a, b, c, d])

        // 恢复 b 后无收起：与旧实现逐位等价（filtered + 缺席垫底）。
        projection.restoreTile(b)
        projection.reorder([c, b])
        #expect(projection.snapshot().terminals.map(\.id) == [c, b, a, d])
    }

    @Test("TG_MIN_minimize_focused_exits_focus: 收起 focused 主格 → 回 Tiling 且 focused/activeSidebar 清；收起 sidebar 预览项 → 高亮回落主格")
    func minimizeFocusedExitsFocusMode() {
        let registry = SessionRegistry()
        defer { registry.shutdownForTeardown() }
        let (projection, ids) = makeProjection(registry, count: 3)

        // 收起 focused 主格：先回平铺再收起（与 dropTerminal 同型，§11.3）。
        projection.maximizeTile(ids[0])
        projection.minimizeTile(ids[0])
        var snap = projection.snapshot()
        #expect(snap.viewMode == .tiling)
        #expect(snap.focusedId == nil)
        #expect(snap.activeSidebarId == nil)
        #expect(snap.terminals.first { $0.id == ids[0] }?.minimized == true)

        // Focused 中收起 sidebar 预览项：留在 Focused，预览高亮回落主格。
        projection.restoreTile(ids[0])
        projection.maximizeTile(ids[1])
        projection.selectSidebar(ids[2])
        projection.minimizeTile(ids[2])
        snap = projection.snapshot()
        #expect(snap.viewMode == .focused)
        #expect(snap.focusedId == ids[1])
        #expect(snap.activeSidebarId == ids[1]) // 回落主格（防悬空指向收起项）
        #expect(snap.terminals.first { $0.id == ids[2] }?.minimized == true)
    }

    @Test("TG_MIN_maximize_unminimizes: maximizeTile(已收起 id) 防御性先恢复再聚焦")
    func maximizeUnminimizesFirst() {
        let registry = SessionRegistry()
        defer { registry.shutdownForTeardown() }
        let (projection, ids) = makeProjection(registry, count: 2)

        projection.minimizeTile(ids[0])
        projection.maximizeTile(ids[0])
        let snap = projection.snapshot()
        #expect(snap.terminals.first { $0.id == ids[0] }?.minimized == false)
        #expect(snap.viewMode == .focused)
        #expect(snap.focusedId == ids[0])
    }

    @Test("TG_MIN_close_from_rail: 关闭收起终端复用 close 全链——终态直移除且收起集/持久化清干净")
    func closeMinimizedTerminalRemoves() {
        let registry = SessionRegistry()
        defer { registry.shutdownForTeardown() }
        // 真进程即退（cleanExit）→ 终态 Stopped；观察者不接（测试直驱），经 registry.state 同步读。
        let (projection, ids) = makeProjection(registry, count: 2, template: cleanExitTemplate)

        // 等两进程退干净（终态 isRemovable），把观察到的终态灌回投影（生产由 registry 观察者驱动）。
        #expect(registry.awaitAllReaped(ids.map { SessionID(raw: $0) })) // 事件驱动等全部收尸至终态（M7 批6）
        for id in ids { projection.noteStateChange(SessionID(raw: id), registry.state(of: SessionID(raw: id)) ?? .stopped) }

        projection.minimizeTile(ids[0])
        guard case .closed = projection.closeTerminal(terminalId: ids[0]) else {
            Issue.record("终态收起终端 close 应走直移除"); return
        }
        let snap = projection.snapshot()
        #expect(!snap.terminals.contains { $0.id == ids[0] })
        // 收起集清干净：持久化视图无残留 minimized 项（dropTerminal 清集合）。
        #expect(projection.persistableTerminals.map(\.id) == [ids[1]])
        #expect(projection.persistableTerminals.allSatisfy { !$0.minimized })
    }

    @Test("TG_MIN_persist_roundtrip: persistableTerminals 带 minimized；restoreTerminals 还原收起态且选中回落首个可见项")
    func persistRoundtripRestoresMinimized() {
        let registry = SessionRegistry()
        defer { registry.shutdownForTeardown() }
        let (projection, ids) = makeProjection(registry, count: 3)

        projection.minimizeTile(ids[0])
        projection.minimizeTile(ids[2])
        let persisted = projection.persistableTerminals
        #expect(persisted.map(\.minimized) == [true, false, true])

        // 「重启」：新 registry/projection 按持久化项恢复（末位 entry 收起 → 选中回落首个可见）。
        let registry2 = SessionRegistry()
        defer { registry2.shutdownForTeardown() }
        let projection2 = UIStateProjection(
            registry: registry2, homePath: tmpDir(), configTemplate: isolatedTemplate)
        var persistFired = 0
        projection2.onTerminalsPersist = { persistFired += 1 }
        let newIds = projection2.restoreTerminals(
            persisted.map { PersistableTerminal(id: $0.id, cwd: tmpDir(), customName: $0.customName, minimized: $0.minimized) },
            fallbackCount: 1)
        #expect(newIds.count == 3)
        let snap = projection2.snapshot()
        #expect(snap.terminals.map(\.minimized) == [true, false, true])
        #expect(snap.selectedId == newIds[1]) // 末位收起 → 选中回落首个可见项（§11.1）
        #expect(persistFired == 0) // restore 期抑制回写（既有语义守卫）
    }

    @Test("TG_MIN_lastline_only_minimized: noteLastLine 仅收起项接受（去抖后入快照）；非收起不带；恢复后清")
    func lastLineOnlyOnMinimized() {
        let registry = SessionRegistry()
        defer { registry.shutdownForTeardown() }
        let clock = FakeClock(1_000)
        let (projection, ids) = makeProjection(registry, count: 2, nowMs: clock.nowMs)
        let (a, b) = (SessionID(raw: ids[0]), SessionID(raw: ids[1]))

        // 非收起 id：门控拒绝（快照不带 lastLine）。
        projection.noteLastLine(a, "$ npm run dev")
        clock.set(1_100); projection.flush()
        #expect(projection.snapshot().terminals.first { $0.id == ids[0] }?.lastLine == nil)

        // 收起后采样：50ms 去抖窗满 → 快照带 lastLine。
        projection.minimizeTile(ids[0])
        projection.noteLastLine(a, "✓ build ok")
        clock.set(1_200); projection.flush()
        var snap = projection.snapshot()
        #expect(snap.terminals.first { $0.id == ids[0] }?.lastLine == "✓ build ok")
        #expect(snap.terminals.first { $0.id == ids[1] }?.lastLine == nil)

        // 无变化不重复触发（幂等门）。
        var emitted = 0
        projection.onSnapshot = { _ in emitted += 1 }
        projection.noteLastLine(a, "✓ build ok")
        clock.set(1_400); projection.flush()
        #expect(emitted == 0)

        // 恢复后 lastLine 清（仅收起态携带，payload 冻结）。
        projection.restoreTile(ids[0])
        #expect(projection.snapshot().terminals.first { $0.id == ids[0] }?.lastLine == nil)
        _ = b // b 仅作对照组
    }

    @Test("收起终端死亡/等待留边栏：state 跟随（waitingInput 叠加不受收起影响），waitingCount 照常计")
    func minimizedTerminalStateStillTracked() {
        let registry = SessionRegistry()
        defer { registry.shutdownForTeardown() }
        let clock = FakeClock(1_000)
        let (projection, ids) = makeProjection(registry, count: 2, nowMs: clock.nowMs)

        projection.minimizeTile(ids[0])
        projection.noteWaiting(SessionID(raw: ids[0]), .layer0)
        clock.set(1_100) // waitingInput 经 50ms 去抖（非终态）→ 假时钟推窗后 flush 生效
        projection.flush()
        let snap = projection.snapshot()
        #expect(snap.terminals.first { $0.id == ids[0] }?.state == .waitingInput)
        #expect(snap.terminals.first { $0.id == ids[0] }?.minimized == true)
        #expect(snap.waitingCount == 1)
    }
}
