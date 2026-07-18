// TerminalService/UIStateProjection 翻牌（批4③）：TERM_L1_01/04/06/07 + TERM_L2_83/PERF_L2_07 各恰
// 1 active @Test（批C C3 起 TERM_L2_83「每窗 20 冻结文案」/PERF_L2_07「每窗满禁用」下沉到 projection 层，
// registry 层改测全局 40=RegistryTests.MW_global_cap40_message，见 multi-window.md §3）。
// 断言经 UIStateProjection（可测投影核心）+ SessionRegistry 公共 API；TerminalService（MuxvoApp
// 薄胶水）只做「中性 outcome/snapshot ↔ MuxvoBridge 类型」映射，属可编译验证的纯胶水（不单测）。
//
// 命名：仅这 6 个 @Test 用 spec-ID 形状；helper/Suite 名不得像 spec ID（防 E_FORGED_ID）。
// 时钟：projection 的 nowMs 注入假时钟，确定性验 50ms 去抖（TERM_L1_06）；真进程退出映射
// （TERM_L1_07）用 pollUntil 等内核往返。
import Darwin
import Foundation
import Testing
import MuxvoKit
import MuxvoTermCore
@testable import MuxvoTerm

// 真进程退出→终态由 SessionRegistry.awaitReaped 事件驱动等待（M7 批6，替代 pollUntilExit 收尸轮询，
// 见 ReapWait.swift）。

/// 可注入假毫秒时钟（TERM_L1_06 去抖用；lock 保线程安全）。
private final class FakeClock: @unchecked Sendable {
    private let lock = NSLock()
    private var value: UInt64
    init(_ start: UInt64) { value = start }
    func read() -> UInt64 { lock.lock(); defer { lock.unlock() }; return value }
    func set(_ ms: UInt64) { lock.lock(); value = ms; lock.unlock() }
    var nowMs: @Sendable () -> UInt64 { { self.read() } }
}

/// 隔离配置模板（spawnShell:false）：无真 PTY，供状态/去抖断言，pid=0（不用于 pid>0 断言）。
private func isolatedTemplate() -> TerminalSession.Config {
    var c = TerminalSession.Config()
    c.spawnShell = false
    return c
}

/// /bin/cat 真 PTY 模板：得确定性 pid>0，SIGHUP 即退，供 create/close 流断言。
private func catTemplate() -> TerminalSession.Config {
    var c = TerminalSession.Config()
    c.executablePath = "/bin/cat"
    c.argv = ["cat"]
    return c
}

/// /bin/sh -c 'exit 0' 模板：进程即刻干净退出 → 终态 Stopped，供终态移除流断言。
private func cleanExitTemplate() -> TerminalSession.Config {
    var c = TerminalSession.Config()
    c.executablePath = "/bin/sh"
    c.argv = ["sh", "-c", "exit 0"]
    return c
}

private func tmpDir() -> String { FileManager.default.temporaryDirectory.path }

@Suite("TerminalService 投影与命令路由（批4③翻牌）", .serialized)
struct TerminalServiceFlipTests {

    // MARK: TERM_L1_01 create

    @Test("TERM_L1_01: term.command create → created{terminalId 非空, pid>0}；invalidCwd/maxReached 走 rejected")
    func createReturnsTerminalIdAndPid() {
        let registry = SessionRegistry()
        defer { registry.shutdownForTeardown() }
        let projection = UIStateProjection(
            registry: registry, homePath: tmpDir(), configTemplate: catTemplate)

        // 成功：created{terminalId 非空, pid>0}（TERM_L1_01 形状 oracle）。
        guard case let .created(terminalId, pid) = projection.createTerminal(cwd: nil) else {
            Issue.record("create 应返回 created"); return
        }
        #expect(!terminalId.isEmpty)
        #expect(pid > 0)
        // 新建即入快照并选中（结构变化立即推的观测面）。
        let snap = projection.snapshot()
        #expect(snap.terminals.contains { $0.id == terminalId })
        #expect(snap.selectedId == terminalId)

        // 无效 cwd → rejected.invalidCwd（业务失败走 rejected，不占信封错误，桥草案 §2）。
        guard case let .rejected(reason, _) = projection.createTerminal(cwd: "/nonexistent/muxvo-xyz-\(UUID().uuidString)")
        else { Issue.record("无效 cwd 应 rejected"); return }
        #expect(reason == .invalidCwd)
    }

    @Test("M6 批1：注入 defaultCwd 时 create(cwd:nil) 落默认路径（非 homePath）；nil 注入回退 homePath")
    func createUsesInjectedDefaultCwd() throws {
        let home = tmpDir()
        let defaultDir = home + "/muxvo-defcwd-\(UUID().uuidString)"
        try FileManager.default.createDirectory(
            atPath: defaultDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(atPath: defaultDir) }

        let registry = SessionRegistry()
        defer { registry.shutdownForTeardown() }
        let projection = UIStateProjection(
            registry: registry, homePath: home, configTemplate: isolatedTemplate,
            defaultCwd: { defaultDir })
        guard case let .created(terminalId, _) = projection.createTerminal(cwd: nil) else {
            Issue.record("create 应成功"); return
        }
        let snap = projection.snapshot()
        #expect(snap.terminals.first { $0.id == terminalId }?.cwd == defaultDir)

        // nil 注入（现有测试路径）→ 回退 homePath（零改动语义守卫）。
        let plain = UIStateProjection(
            registry: SessionRegistry(), homePath: home, configTemplate: isolatedTemplate)
        guard case let .created(id2, _) = plain.createTerminal(cwd: nil) else {
            Issue.record("create 应成功"); return
        }
        #expect(plain.snapshot().terminals.first { $0.id == id2 }?.cwd == home)
    }

    @Test("TERM_L2_83_max_terminal_20: 每窗第 20 个 created、第 21 个 projection 层拒绝带冻结文案（multi-window.md §3 每窗口径）")
    func TERM_L2_83_max_terminal_20() {
        let registry = SessionRegistry()
        defer { registry.shutdownForTeardown() }
        let projection = UIStateProjection(
            registry: registry, homePath: tmpDir(), configTemplate: isolatedTemplate)

        // 每窗上限 20（projection 层先拦，registry 全局 40 之下——本窗满 20 即冻结文案，保 TERM_L2_83 oracle）。
        for i in 1...RegistryPolicy.maxPerWindowCount {
            guard case .created = projection.createTerminal(cwd: nil) else {
                Issue.record("第 \(i) 个（≤20）应 created"); return
            }
        }
        guard case let .rejected(reason, message) = projection.createTerminal(cwd: nil) else {
            Issue.record("第 21 个应 rejected"); return
        }
        #expect(reason == .maxReached)
        #expect(message == "已达最大终端数，请关闭不用的终端") // 冻结 spec 文案逐字（RegistryPolicy 权威，禁改）
    }

    @Test("PERF_L2_07: 每窗满 20 → snapshot.maxReached==true（禁用新建按钮，multi-window.md §3.2 每窗口径）")
    func PERF_L2_07() {
        let registry = SessionRegistry()
        defer { registry.shutdownForTeardown() }
        let projection = UIStateProjection(
            registry: registry, homePath: tmpDir(), configTemplate: isolatedTemplate)

        for _ in 1 ..< RegistryPolicy.maxPerWindowCount { // 建 19 个
            guard case .created = projection.createTerminal(cwd: nil) else {
                Issue.record("19 个内应 created"); return
            }
        }
        #expect(!projection.snapshot().maxReached) // 本窗 19 个：未满
        guard case .created = projection.createTerminal(cwd: nil) else {
            Issue.record("第 20 个应 created"); return
        }
        #expect(projection.snapshot().maxReached) // 本窗满 20：快照 maxReached==true
    }

    // MARK: TERM_L1_04 close

    @Test("TERM_L1_04: term.command close → closed + Registry 进 Stopping；未知 id → rejected.notFound")
    func closeStopsSessionAndRejectsUnknown() {
        let registry = SessionRegistry()
        defer { registry.shutdownForTeardown() }
        let projection = UIStateProjection(
            registry: registry, homePath: tmpDir(), configTemplate: catTemplate)

        guard case let .created(terminalId, _) = projection.createTerminal(cwd: nil) else {
            Issue.record("create 应成功"); return
        }
        #expect(registry.state(of: SessionID(raw: terminalId)) == .running)

        guard case let .closed(closedId) = projection.closeTerminal(terminalId: terminalId) else {
            Issue.record("close 应返回 closed"); return
        }
        #expect(closedId == terminalId)
        #expect(registry.state(of: SessionID(raw: terminalId)) == .stopping) // CLOSE→Stopping（立即）

        // 未知 id → rejected.notFound（不误碰他会话）。
        guard case let .rejected(reason, _) = projection.closeTerminal(terminalId: "no-such-id") else {
            Issue.record("未知 id 应 rejected"); return
        }
        #expect(reason == .notFound)
    }

    // MARK: TERM_L1_06 state-change 去抖

    @Test("TERM_L1_06: 状态变化→快照 state 更新；50ms 内抖动只出最终一条（假时钟）")
    func stateChangeDebouncedToFinalOnly() {
        let clock = FakeClock(0)
        let registry = SessionRegistry()
        defer { registry.shutdownForTeardown() }
        let projection = UIStateProjection(
            registry: registry, homePath: tmpDir(), nowMs: clock.nowMs, configTemplate: isolatedTemplate)

        guard case let .created(terminalId, _) = projection.createTerminal(cwd: nil) else {
            Issue.record("create 应成功"); return
        }
        let id = SessionID(raw: terminalId)

        // 收集器：只统计「抖动阶段」的推送（create 的首推在安装前）。
        var snapshots: [ProjectionSnapshot] = []
        projection.onSnapshot = { snapshots.append($0) }

        // Running↔WaitingInput 抖动（均非 immediate 态），窗口内每次刷新去抖时间戳 → 期间零推送。
        projection.noteStateChange(id, .running);      clock.set(10)
        projection.noteStateChange(id, .waitingInput); clock.set(20)
        projection.noteStateChange(id, .running);      clock.set(30)
        projection.noteStateChange(id, .waitingInput)
        #expect(snapshots.isEmpty) // 50ms 未静默，抖动期零推

        // 静默满 50ms（末次 t=30，推进到 90>30+50）→ flush 只出最终一条。
        clock.set(90)
        projection.flush()
        #expect(snapshots.count == 1)
        #expect(snapshots.last?.terminals.first(where: { $0.id == terminalId })?.state == .waitingInput)
    }

    // MARK: TERM_L1_07 exit → 终态映射 + 立即推

    @Test("TERM_L1_07: exit(0)→Stopped、非0/信号→Disconnected（映射）且终态立即推（去抖豁免）")
    func exitMapsToTerminalStateAndPushesImmediately() {
        // —— 映射（registry 权威，§3.3）：真进程退出码 → 终态 —— //
        let registry = SessionRegistry()
        defer { registry.shutdownForTeardown() }

        var clean = TerminalSession.Config()
        clean.executablePath = "/bin/sh"; clean.argv = ["sh", "-c", "exit 0"]
        guard case let .success(cleanID) = registry.create(config: clean) else {
            Issue.record("clean 会话应创建成功"); return
        }
        #expect(registry.awaitReaped(cleanID) != nil) // 事件驱动等收尸（M7 批6）
        #expect(registry.state(of: cleanID) == .stopped) // 0 → Stopped

        var crash = TerminalSession.Config()
        crash.executablePath = "/bin/sh"; crash.argv = ["sh", "-c", "exit 3"]
        guard case let .success(crashID) = registry.create(config: crash) else {
            Issue.record("crash 会话应创建成功"); return
        }
        #expect(registry.awaitReaped(crashID) != nil) // 事件驱动等收尸（M7 批6）
        #expect(registry.state(of: crashID) == .disconnected) // 非0 → Disconnected

        // —— 立即推（projection 去抖豁免，§6.3）：终态 record 不待 flush 即出 —— //
        let clock = FakeClock(0)
        let projection = UIStateProjection(
            registry: registry, homePath: tmpDir(), nowMs: clock.nowMs, configTemplate: isolatedTemplate)
        guard case let .created(tid, _) = projection.createTerminal(cwd: nil) else {
            Issue.record("projection create 应成功"); return
        }
        let id = SessionID(raw: tid)

        var pushed: [ProjectionSnapshot] = []
        projection.onSnapshot = { pushed.append($0) }
        projection.noteStateChange(id, .stopped) // 不 flush
        #expect(pushed.count == 1) // 终态豁免立即推
        #expect(pushed.last?.terminals.first(where: { $0.id == tid })?.state == .stopped)

        projection.noteStateChange(id, .disconnected)
        #expect(pushed.count == 2)
        #expect(pushed.last?.terminals.first(where: { $0.id == tid })?.state == .disconnected)
    }

    // MARK: cwd 轮询接线（§5 主路径）

    @Test("cwd 轮询接线：会话 OSC7 file:// 更新 → refreshCwds 归一 → 快照 cwd 落普通路径")
    func cwdPollSurfacesOsc7Path() {
        let registry = SessionRegistry()
        defer { registry.shutdownForTeardown() }
        let projection = UIStateProjection(
            registry: registry, homePath: tmpDir(), configTemplate: isolatedTemplate)
        guard case let .created(tid, _) = projection.createTerminal(cwd: nil) else {
            Issue.record("create 应成功"); return
        }
        // 隔离会话直灌 OSC7（feed 同步处理 → session.cwd 即为 file:// 原始形）。
        registry.session(for: SessionID(raw: tid))?
            .feed("\u{1b}]7;file://localhost/private/tmp/muxvo-cwd-poll\u{07}")
        #expect(registry.session(for: SessionID(raw: tid))?.cwd.hasPrefix("file://") == true)

        var snaps: [ProjectionSnapshot] = []
        projection.onSnapshot = { snaps.append($0) }
        projection.refreshCwds()
        #expect(snaps.count == 1) // cwd 变化推一次
        #expect(snaps.last?.terminals.first?.cwd == "/private/tmp/muxvo-cwd-poll") // file:// 归一为普通路径

        // 无新变化再轮询 → 不重复推。
        projection.refreshCwds()
        #expect(snaps.count == 1)
    }
}

@Suite("终态 tile 移除流（尾批 item 4，REMOVE→Removed）", .serialized)
struct RemovedFlowTests {

    @Test("registry.remove：终态会话可移除（entry 剔除，幂等）；活会话拒绝")
    func removeOnlyTerminalStates() {
        let registry = SessionRegistry()
        defer { registry.shutdownForTeardown() }

        // 活会话（隔离，恒 Running）→ REMOVE 不命中转移表 → 拒绝。
        var cfg = TerminalSession.Config(); cfg.spawnShell = false
        guard case let .success(live) = registry.create(config: cfg) else {
            Issue.record("create 应成功"); return
        }
        #expect(registry.state(of: live) == .running)
        #expect(registry.remove(live) == false)
        #expect(registry.session(for: live) != nil) // 未移除

        // 终态会话（exit 0 → Stopped）→ 可移除。
        guard case let .success(dead) = registry.create(config: cleanExitTemplate()) else {
            Issue.record("create 应成功"); return
        }
        #expect(registry.awaitReaped(dead) != nil) // 事件驱动等收尸（M7 批6）
        #expect(registry.state(of: dead) == .stopped)
        #expect(registry.remove(dead) == true)
        #expect(registry.session(for: dead) == nil) // entry 剔除
        #expect(registry.remove(dead) == false)     // 再移除 false（幂等）
    }

    @Test("projection.closeTerminal 终态 tile → 移除（快照剔除）；焦点 tile 移除回平铺")
    func closeOnTerminalStateRemovesTileAndRestoresTiling() {
        let registry = SessionRegistry()
        defer { registry.shutdownForTeardown() }
        let projection = UIStateProjection(
            registry: registry, homePath: tmpDir(), configTemplate: cleanExitTemplate)

        guard case let .created(tid, _) = projection.createTerminal(cwd: nil) else {
            Issue.record("create 应成功"); return
        }
        let id = SessionID(raw: tid)
        projection.maximizeTile(tid) // 进 Focused，focusedId=该 tile
        #expect(registry.awaitReaped(id) != nil) // 事件驱动等收尸（M7 批6）
        #expect(registry.state(of: id) == .stopped)
        projection.noteStateChange(id, .stopped) // 同步观察者态（测试直驱，无 observer 接线）
        #expect(projection.snapshot().terminals.contains { $0.id == tid })

        // 终态 close = 移除。
        guard case .closed = projection.closeTerminal(terminalId: tid) else {
            Issue.record("终态 close 应返回 closed"); return
        }
        let snap = projection.snapshot()
        #expect(!snap.terminals.contains { $0.id == tid }) // 快照剔除
        #expect(snap.focusedId == nil)
        #expect(snap.viewMode == .tiling)                  // 焦点被剔 → 回平铺（legacy REMOVE reducer）

        // 已移除 id 再 close → notFound（不再是活/终态 tile）。
        guard case let .rejected(reason, _) = projection.closeTerminal(terminalId: tid) else {
            Issue.record("已移除 id 应 rejected"); return
        }
        #expect(reason == .notFound)
    }
}

@Suite("openTerminals 恢复 / 维序写回 + customName 持久化（尾批 item 1/3）", .serialized)
struct OpenTerminalsPersistTests {

    @Test("restore：按存档逐条重 spawn（cwd+customName 带出，维序）；空档回退 fallbackCount")
    func restoreSpawnsPerEntryWithNameAndFallsBackWhenEmpty() {
        let registry = SessionRegistry()
        defer { registry.shutdownForTeardown() }
        let projection = UIStateProjection(
            registry: registry, homePath: tmpDir(), configTemplate: isolatedTemplate)

        let dir = tmpDir()
        let entries = [
            PersistableTerminal(cwd: dir, customName: "阿尔法"),
            PersistableTerminal(cwd: dir, customName: nil),
        ]
        let ids = projection.restoreTerminals(entries, fallbackCount: 1)
        #expect(ids.count == 2)
        let snap = projection.snapshot()
        #expect(snap.terminals.count == 2)
        #expect(snap.terminals[0].customName == "阿尔法") // 维序：第 0 条带出 customName
        #expect(snap.terminals[1].customName == nil)
        #expect(snap.terminals.allSatisfy { $0.cwd == dir }) // 各 spawn 于存档 cwd

        // 空档 → 回退建 fallbackCount 个于 homePath。
        let reg2 = SessionRegistry(); defer { reg2.shutdownForTeardown() }
        let proj2 = UIStateProjection(registry: reg2, homePath: tmpDir(), configTemplate: isolatedTemplate)
        #expect(proj2.restoreTerminals([], fallbackCount: 2).count == 2)
    }

    @Test("restore 期抑制 onTerminalsPersist；随后 user create/rename/reorder 各触发一次维序回写")
    func persistFiresOnUserChangesNotDuringRestore() {
        let registry = SessionRegistry()
        defer { registry.shutdownForTeardown() }
        let projection = UIStateProjection(
            registry: registry, homePath: tmpDir(), configTemplate: isolatedTemplate)

        var persistSnapshots: [[PersistableTerminal]] = []
        projection.onTerminalsPersist = { persistSnapshots.append(projection.persistableTerminals) }

        // restore 加载期不回写（抑制）。
        let dir = tmpDir()
        let ids = projection.restoreTerminals(
            [PersistableTerminal(cwd: dir, customName: "旧名")], fallbackCount: 1)
        #expect(ids.count == 1)
        #expect(persistSnapshots.isEmpty) // restore 全程抑制

        // user create → 回写一次，维序含两条。
        guard case let .created(tid2, _) = projection.createTerminal(cwd: nil) else {
            Issue.record("create 应成功"); return
        }
        #expect(persistSnapshots.count == 1)
        #expect(persistSnapshots.last?.count == 2)

        // rename → 回写，customName 带出。
        projection.renameSubmit(ids[0], name: "新名")
        #expect(persistSnapshots.count == 2)
        #expect(persistSnapshots.last?.first?.customName == "新名")

        // reorder → 回写，维序反转（ids[0] 挪到末尾，customName 随之）。
        projection.reorder([tid2, ids[0]])
        #expect(persistSnapshots.count == 3)
        #expect(persistSnapshots.last?.count == 2)
        #expect(persistSnapshots.last?.last?.customName == "新名")
    }
}

/// pid 记录器（onChildSpawned/onChildReaped 注入闭包为 @Sendable，须线程安全收集）。
private final class PidLedger: @unchecked Sendable {
    private let lock = NSLock()
    private var spawned: [Int32] = []
    private var reaped: [Int32] = []
    func recordSpawn(_ pid: Int32) { lock.lock(); spawned.append(pid); lock.unlock() }
    func recordReap(_ pid: Int32) { lock.lock(); reaped.append(pid); lock.unlock() }
    var spawnedPids: [Int32] { lock.lock(); defer { lock.unlock() }; return spawned }
    var reapedPids: [Int32] { lock.lock(); defer { lock.unlock() }; return reaped }
}

@Suite("pty-children 活会话账本接线（批4③，⑩观察②缺口）", .serialized)
struct PtyChildrenWiringTests {

    // Registry 的 onChildSpawned/onChildReaped 是 TerminalService 接 PtyChildrenStore.record/remove 的接缝
    // （依赖倒置，terminal-session.md §7.2）。此验 registry 侧契约：真 spawn 记 pid、终态观察移除 pid。
    // 账本文件本身的往返（record→readAll→clear）由 MuxvoStorageTests + SIGKILL 场景⑤覆盖。
    @Test("spawn 记账本 pid（record 被调）→ close 后终态移除（remove 被调），pid 与会话 pid 一致")
    func spawnRecordsAndCloseRemovesLedgerPid() {
        let ledger = PidLedger()
        let registry = SessionRegistry(
            onChildSpawned: { ledger.recordSpawn($0) },
            onChildReaped: { ledger.recordReap($0) }
        )
        defer { registry.shutdownForTeardown() }

        var cfg = TerminalSession.Config()
        cfg.executablePath = "/bin/cat"; cfg.argv = ["cat"] // SIGHUP 即退，得确定性 pid
        guard case let .success(id) = registry.create(config: cfg),
              let session = registry.session(for: id), let pid = session.pid
        else { Issue.record("会话创建应成功"); return }

        // spawn 成功即记账本一条，pid 与会话 pid 一致（> 0）。
        #expect(pid > 0)
        #expect(ledger.spawnedPids == [pid])
        #expect(ledger.reapedPids.isEmpty) // 尚未收尸

        // close → cat 收 SIGHUP 退出 → 终态观察 handleExit 调 onChildReaped 移除该 pid。
        registry.close(id)
        #expect(registry.awaitReaped(id) != nil) // 事件驱动等收尸（M7 批6）
        #expect(ledger.reapedPids == [pid]) // 恰移除一次（收尸幂等）
    }
}

@Suite("用户关闭自动移除（DOGFOOD_M3_09：一步到位，终态单帧合并）", .serialized)
struct UserCloseAutoRemoveTests {

    // T1：用户主动关闭活会话 → 进程退到终态 → 观察与移除合并单帧，tile 自动消失，其余终端不受扰。
    @Test("用户关闭活会话：终态 noteStateChange 单帧移除 tile（快照剔除 / session nil / persist 恰一次 / 他终端不扰）")
    func userCloseRemovesOnTerminalStateInSingleFrame() {
        let registry = SessionRegistry()
        defer { registry.shutdownForTeardown() }
        let projection = UIStateProjection(
            registry: registry, homePath: tmpDir(), configTemplate: catTemplate)

        guard case let .created(tid1, _) = projection.createTerminal(cwd: nil),
              case let .created(tid2, _) = projection.createTerminal(cwd: nil) else {
            Issue.record("两会话应创建成功"); return
        }
        let id1 = SessionID(raw: tid1), id2 = SessionID(raw: tid2)

        // 用户主动关闭 t1（活会话 → registry.close 发 SIGHUP）；cat 收 SIGHUP 退出到 Stopped。
        guard case .closed = projection.closeTerminal(terminalId: tid1) else {
            Issue.record("close 应返回 closed"); return
        }
        #expect(registry.awaitReaped(id1) != nil) // 事件驱动等收尸（M7 批6）
        #expect(registry.state(of: id1) == .stopped)

        // 装收集器（只统计合并帧的推送/持久化）。
        var pushed: [ProjectionSnapshot] = []
        var persistCount = 0
        projection.onSnapshot = { pushed.append($0) }
        projection.onTerminalsPersist = { persistCount += 1 }

        // 观察者态到达（生产由 registry.addObserver → hop main 驱；测试直驱等价）。
        projection.noteStateChange(id1, .stopped)

        #expect(pushed.count == 1)                              // 合并单帧：不先推死 tile 再推移除
        guard let snap = pushed.last else { Issue.record("应有一帧"); return }
        #expect(!snap.terminals.contains { $0.id == tid1 })    // t1 自动消失
        #expect(registry.session(for: id1) == nil)             // registry entry 剔除
        #expect(snap.terminals.contains { $0.id == tid2 })     // t2 不受扰
        #expect(registry.session(for: id2) != nil)
        #expect(persistCount == 1)                             // 维序写回恰一次
        #expect(projection.persistableTerminals.count == 1)    // 仅剩 t2
    }

    // T2：强杀升级路径（grace 超时 → SIGKILL → Disconnected）亦自动移除（假时钟确定性）。
    @Test("用户关闭强杀升级：grace 超时 Disconnected 亦单帧移除（假时钟 pumpTimeouts）")
    func userCloseRemovesOnForcedKillDisconnected() {
        let clock = FakeClock(0)
        let registry = SessionRegistry(nowMs: clock.nowMs)
        defer { registry.shutdownForTeardown() }
        let projection = UIStateProjection(
            registry: registry, homePath: tmpDir(), nowMs: clock.nowMs, configTemplate: isolatedTemplate)

        guard case let .created(tid, _) = projection.createTerminal(cwd: nil) else {
            Issue.record("create 应成功"); return
        }
        let id = SessionID(raw: tid)

        // 用户关闭（隔离会话无真 PTY，永不自退）→ Stopping。
        guard case .closed = projection.closeTerminal(terminalId: tid) else {
            Issue.record("close 应返回 closed"); return
        }
        #expect(registry.state(of: id) == .stopping)

        // grace 超时（默认 5000ms）→ TIMEOUT → Disconnected。
        clock.set(UInt64(TerminalSession.defaultCloseGraceMs) + 1)
        registry.pumpTimeouts(nowMs: clock.read())
        #expect(registry.state(of: id) == .disconnected)

        var pushed: [ProjectionSnapshot] = []
        var persistCount = 0
        projection.onSnapshot = { pushed.append($0) }
        projection.onTerminalsPersist = { persistCount += 1 }

        projection.noteStateChange(id, .disconnected)

        #expect(pushed.count == 1)
        #expect(!(pushed.last?.terminals.contains { $0.id == tid } ?? true)) // Disconnected 亦 removable → 自动移除
        #expect(registry.session(for: id) == nil)
        #expect(persistCount == 1)
    }

    // T3：自发退出（敲 exit / 崩溃）保留死 tile（防修过头）；随后 ✕ 一键 REMOVE 回归。
    @Test("自退保留死 tile（未经 close 命令）：终态不自动移除、persist 不触发；随后 close = 移除")
    func selfExitKeepsDeadTileThenCloseRemoves() {
        let registry = SessionRegistry()
        defer { registry.shutdownForTeardown() }
        let projection = UIStateProjection(
            registry: registry, homePath: tmpDir(), configTemplate: cleanExitTemplate)

        guard case let .created(tid, _) = projection.createTerminal(cwd: nil) else {
            Issue.record("create 应成功"); return
        }
        let id = SessionID(raw: tid)
        #expect(registry.awaitReaped(id) != nil) // 事件驱动等收尸（M7 批6）
        #expect(registry.state(of: id) == .stopped) // 进程自退 → Stopped

        var pushed: [ProjectionSnapshot] = []
        var persistCount = 0
        projection.onSnapshot = { pushed.append($0) }
        projection.onTerminalsPersist = { persistCount += 1 }

        // 自退路径未经 closeTerminal → 不在 pendingUserClose → 拦截不命中 → 保留死 tile。
        projection.noteStateChange(id, .stopped)
        #expect(pushed.count == 1)                                          // 终态立即推（TERM_L1_07 口径不变）
        #expect(pushed.last?.terminals.contains { $0.id == tid } == true)  // 死 tile 保留
        #expect(pushed.last?.terminals.first { $0.id == tid }?.state == .stopped)
        #expect(registry.session(for: id) != nil)
        #expect(persistCount == 0)                                         // 自退不触发维序回写

        // 死 tile ✕ = 一键 REMOVE（现有行为，回归）。
        guard case .closed = projection.closeTerminal(terminalId: tid) else {
            Issue.record("死 tile close 应返回 closed"); return
        }
        #expect(!projection.snapshot().terminals.contains { $0.id == tid }) // 移除
        #expect(registry.session(for: id) == nil)
        #expect(persistCount == 1)                                         // REMOVE 触发维序回写
    }

    // T4：Stopping 窗口内二次 close 幂等；终态后恰一次移除、一次 persist。
    @Test("Stopping 期二次 close 幂等：均 closed；终态后恰一次移除一次 persist")
    func doubleCloseWhileStoppingIsIdempotent() {
        let clock = FakeClock(0)
        let registry = SessionRegistry(nowMs: clock.nowMs)
        defer { registry.shutdownForTeardown() }
        let projection = UIStateProjection(
            registry: registry, homePath: tmpDir(), nowMs: clock.nowMs, configTemplate: isolatedTemplate)

        guard case let .created(tid, _) = projection.createTerminal(cwd: nil) else {
            Issue.record("create 应成功"); return
        }
        let id = SessionID(raw: tid)

        guard case .closed = projection.closeTerminal(terminalId: tid) else {
            Issue.record("首次 close 应 closed"); return
        }
        #expect(registry.state(of: id) == .stopping)
        // Stopping 期二次 close（用户连点 ✕）→ 仍 closed、不新增副作用。
        guard case .closed = projection.closeTerminal(terminalId: tid) else {
            Issue.record("二次 close 应 closed"); return
        }
        #expect(registry.state(of: id) == .stopping)

        var pushed: [ProjectionSnapshot] = []
        var persistCount = 0
        projection.onSnapshot = { pushed.append($0) }
        projection.onTerminalsPersist = { persistCount += 1 }

        clock.set(UInt64(TerminalSession.defaultCloseGraceMs) + 1)
        registry.pumpTimeouts(nowMs: clock.read())
        #expect(registry.state(of: id) == .disconnected)

        projection.noteStateChange(id, .disconnected)
        #expect(pushed.count == 1)
        #expect(!(pushed.last?.terminals.contains { $0.id == tid } ?? true))
        #expect(registry.session(for: id) == nil)
        #expect(persistCount == 1) // 恰一次移除一次 persist（pendingUserClose 幂等集合）
    }
}
