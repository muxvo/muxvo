// SessionRegistry：SessionID→TerminalSession 映射 + 创建唯一入口 + 10 态机驱动 +
// 状态推送去抖 + 事件观察者 + closeAll。行为规格：terminal-session.md §6（策略/去抖）、
// §2.2（事件产生点）、§3.2/§3.3（关闭协议/退出码→态）、§7.1（closeAll）。
//
// 并发：单串行 queue 收敛 entries/observers 全部读写；对外事件观察者 hop 到 main 派发。
// 退出观察不走 TerminalSession.Config.onExit（其回调 hop main，无 run loop 的单测里不触发），
// 改用**每会话后台 waiter** 调 session.waitForExit（信号量，不依赖 main）→ 回 queue 驱态机，
// 使态机在真壳与单测中都确定性推进。
//
// pty-children 账本依赖倒置：MuxvoTerm 不在 MuxvoStorage 依赖图（Package.swift 冻结），故
// Registry 只经注入闭包 onChildSpawned/onChildReaped 通报 pid，真壳侧把闭包接到
// MuxvoStorage.PtyChildrenStore（本模块不反向依赖落盘层）。
import Darwin
import Dispatch
import Foundation
import MuxvoKit
import MuxvoTermCore
import os

public final class SessionRegistry: @unchecked Sendable {
    /// 关闭生命周期打点（DOGFOOD_M3_09 可诊断性）：close 请求 / exit 分派 / Stopping 超时升级 / remove
    /// 四处收口——close 链路此前零打点（收命令/SIGHUP/升级/收尸全无），一次补齐。
    private static let lifecycleLog = Logger(subsystem: "com.muxvo", category: "lifecycle")

    /// 创建失败原因。maxReached 携带拒绝文案：registry 层满员=**全局池文案** `globalMaxReachedMessage`
    /// （multi-window.md §3 裁决⑧）；每窗 20 满的**冻结文案** `maxReachedMessage`（TERM_L2_83 oracle）由
    /// UIStateProjection 层先拦携带（先窗后全局）。
    public enum CreateError: Error, Equatable {
        case maxReached(message: String)
        case spawnFailed(String)
    }

    /// 会话上限（terminal-session.md §6.1，透传 RegistryPolicy）。
    public static let maxTerminalCount = RegistryPolicy.maxTerminalCount

    // MARK: 注入缝

    private let nowMs: @Sendable () -> UInt64
    private let onChildSpawned: (@Sendable (Int32) -> Void)?
    private let onChildReaped: (@Sendable (Int32) -> Void)?

    // MARK: 内部态（全部 queue 限定）

    private final class Entry {
        let session: TerminalSession
        var machine: TerminalStateMachine
        let debouncer: StateDebouncer
        var closeRequested = false
        var stoppingSinceMs: UInt64 = 0
        var graceMs: Int
        var exitResult: (PTYExit, Bool)?
        /// 会话归属（interactive-worker.md §5 B2-2）：.worker = 交互式 PTY worker，其崩溃孤儿收尸以 WorkerLedger
        /// 为权威（整 pgid 收割）→ **从 pty-children 账本排除**（onChildSpawned/onChildReaped 对 worker 不通报），
        /// 避免 §5 陷阱①「pty 收割器先 decapitate leader → worker 组收尸跳过 → fork 子进程逃逸」。默认 .human。
        let ownership: TerminalOwnership

        init(session: TerminalSession, debouncer: StateDebouncer, graceMs: Int, ownership: TerminalOwnership) {
            self.session = session
            machine = TerminalStateMachine() // Created
            self.debouncer = debouncer
            self.graceMs = graceMs
            self.ownership = ownership
        }
    }

    private let queue = DispatchQueue(label: "muxvo.term.registry")
    private var entries: [SessionID: Entry] = [:]
    private var observers: [@Sendable (SessionID, TerminalState) -> Void] = []
    /// 事件驱动收尸信号登记（M7 批6 测试基建缝）：SessionID → 待兑现 handler。仅 queue 内读写；
    /// handleExit 收尸处理完（态机已到终态）时于 queue 直接兑现，**不 hop main**（对比 observers 走
    /// main、无 run loop 的单测不达）。见 `onExitReaped`。
    private var exitWaiters: [SessionID: [@Sendable (PTYExit, Bool) -> Void]] = [:]

    // MARK: 生命周期

    /// - Parameters:
    ///   - nowMs: 毫秒单调时钟（默认真时钟；测试注入假时钟验 Stopping→TIMEOUT）。
    ///   - onChildSpawned/onChildReaped: pty-children 账本挂钩（默认 nil；真壳接 PtyChildrenStore）。
    public init(
        nowMs: @escaping @Sendable () -> UInt64 = { UInt64(DispatchTime.now().uptimeNanoseconds / 1_000_000) },
        onChildSpawned: (@Sendable (Int32) -> Void)? = nil,
        onChildReaped: (@Sendable (Int32) -> Void)? = nil
    ) {
        self.nowMs = nowMs
        self.onChildSpawned = onChildSpawned
        self.onChildReaped = onChildReaped
    }

    // MARK: 观察者

    /// 注册状态推送观察者（去抖后 emit，hop main）。返回后即生效。
    public func addObserver(_ observer: @escaping @Sendable (SessionID, TerminalState) -> Void) {
        queue.sync { observers.append(observer) }
    }

    /// 事件驱动收尸信号（M7 批6，测试基建替代 pollUntil 收尸轮询）：登记 handler，在该会话进程
    /// 退出被收尸处理完（handleExit 内，exitResult/onChildReaped 已就位、态机已推进到终态）时于
    /// registry queue **直接**兑现——不 hop main，故无 run loop 的单测里确定性触发（与 addObserver
    /// 走 DispatchQueue.main.async、单测不达形成对比）。会话已终态则立即兑现；已被移除（teardown/
    /// remove）则静默丢弃（无 exit 可等，防永久挂起，交由调用方 backstop 收口）。handler 在 registry
    /// queue 上被调用，勿在其中再同步回调本 registry（防重入死锁）——测试助手仅在其中 signal 信号量。
    public func onExitReaped(_ id: SessionID, _ handler: @escaping @Sendable (PTYExit, Bool) -> Void) {
        queue.async {
            guard let entry = self.entries[id] else { return } // 已移除：无 exit 可等
            if let existing = entry.exitResult {
                handler(existing.0, existing.1)
            } else {
                self.exitWaiters[id, default: []].append(handler)
            }
        }
    }

    // MARK: 查询

    public var count: Int { queue.sync { entries.count } }
    /// 满员快照（PERF_L2_07：满员 maxReached==true）。
    public var maxReached: Bool { queue.sync { RegistryPolicy.maxReached(currentCount: entries.count) } }
    public func session(for id: SessionID) -> TerminalSession? { queue.sync { entries[id]?.session } }
    /// 全部活会话（TerminalService 主题广播用，terminal-theme.md §5）。queue.sync 快照 entries 值。
    public func allSessions() -> [TerminalSession] { queue.sync { entries.values.map(\.session) } }
    public func state(of id: SessionID) -> TerminalState? { queue.sync { entries[id]?.machine.state } }
    /// 该会话最后一次退出结果（PTYExit + 是否走了 SIGKILL 强杀升级），未退出则 nil。
    public func exitInfo(of id: SessionID) -> (PTYExit, Bool)? { queue.sync { entries[id]?.exitResult } }

    // MARK: 创建（唯一入口，上限 20）

    /// 创建会话：满员拒绝（冻结文案）；否则起会话 + 驱 Created→Starting→Running。
    @discardableResult
    /// - Parameter ownership: 会话归属（默认 .human，既有调用零改）。`.worker`（交互式 PTY worker，B2-2）→
    ///   pid **不入** pty-children 账本（onChildSpawned/onChildReaped 跳过），改由 WorkerLedger 权威整组收尸
    ///   （interactive-worker.md §5 陷阱①）。会话/视图生命周期簿记（态机/exit waiter）不受 ownership 影响。
    public func create(
        config: TerminalSession.Config = TerminalSession.Config(),
        ownership: TerminalOwnership = .human
    ) -> Result<SessionID, CreateError> {
        queue.sync {
            guard RegistryPolicy.canCreate(currentCount: entries.count) else {
                return .failure(.maxReached(message: RegistryPolicy.globalMaxReachedMessage))
            }
            let id = SessionID(raw: UUID().uuidString)
            let debouncer = StateDebouncer(emit: { [weak self] state in
                self?.notifyObservers(id: id, state: state)
            })
            do {
                let session = try TerminalSession(id: id, config: config)
                let entry = Entry(
                    session: session, debouncer: debouncer, graceMs: config.closeGraceMs, ownership: ownership)
                entries[id] = entry
                // Created→Starting→Running（§2.2 SPAWN/SPAWN_SUCCESS）。隔离模式无进程亦驱到 Running 留位。
                transition(entry, id, .spawn)
                transition(entry, id, .spawnSuccess)
                if let pid = session.pid {
                    // worker 会话 pid 路由 WorkerLedger（InteractiveWorkerHost 记账），**不入** pty-children（§5 陷阱①）。
                    if ownership != .worker { onChildSpawned?(pid) }
                    launchExitWaiter(id: id, session: session, pid: pid)
                }
                return .success(id)
            } catch {
                // SPAWN_FAILURE→Failed 无常驻会话（init 抛错即无 map 条目）——仅返回错误。
                return .failure(.spawnFailed(String(describing: error)))
            }
        }
    }

    // MARK: 关闭

    /// 请求优雅关闭单会话：CLOSE→Stopping（立即推），发 SIGHUP（TerminalSession.requestClose）。
    public func close(_ id: SessionID, graceMs: Int? = nil) {
        queue.sync {
            guard let entry = entries[id] else { return }
            entry.closeRequested = true
            entry.stoppingSinceMs = nowMs()
            if let graceMs { entry.graceMs = graceMs }
            transition(entry, id, .close)
            Self.lifecycleLog.info(
                "close 请求 id=\(id.raw, privacy: .public) → Stopping，发 SIGHUP grace=\(entry.graceMs)ms")
            entry.session.requestClose(graceMs: graceMs)
        }
    }

    /// 关闭全部会话（§7.1）：并行优雅关闭，总限时 grace+缓冲；超时未终态者 SIGKILL 强杀收口。
    /// completion 在全部终态或超时兜底后回调（后台队列，不碰 main）。
    public func closeAll(
        graceMs: Int? = nil, timeout: TimeInterval? = nil, completion: (@Sendable () -> Void)? = nil
    ) {
        // 闭包只携带 SessionID（Sendable 值）；Entry 是队列私有类，一律在 queue.sync 内重查。
        let ids: [SessionID] = queue.sync {
            for (id, entry) in entries {
                entry.closeRequested = true
                entry.stoppingSinceMs = nowMs()
                if let graceMs { entry.graceMs = graceMs }
                transition(entry, id, .close)
                entry.session.requestClose(graceMs: graceMs)
            }
            return Array(entries.keys)
        }
        guard !ids.isEmpty else { completion?(); return }
        let grace = graceMs
            ?? queue.sync { entries.values.map(\.graceMs).max() }
            ?? TerminalSession.defaultCloseGraceMs
        let waitSeconds = timeout ?? (Double(grace) / 1000.0 + 2.0) // grace + 2s 缓冲（收尸/回队）
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { completion?(); return }
            let deadline = Date().addingTimeInterval(waitSeconds)
            while Date() < deadline {
                let done = self.queue.sync {
                    ids.allSatisfy { id in
                        guard let entry = self.entries[id] else { return true } // 已移除=已收口
                        return Self.isTerminal(entry.machine.state)
                    }
                }
                if done { break }
                usleep(20_000)
            }
            // 超时兜底：仍非终态者强杀收口（保 checkpoint 前 PTY 静默）。
            self.queue.sync {
                for id in ids {
                    guard let entry = self.entries[id],
                          !Self.isTerminal(entry.machine.state) else { continue }
                    entry.session.close()
                }
            }
            completion?()
        }
    }

    /// 移除已终态会话（尾批 item 4，§2.1 REMOVE→Removed）：仅 Stopped/Disconnected/Failed 可移除
    /// （REMOVE 转移表出边，活/Stopping 态拒绝）。成功则幂等强杀收口 PTY/vt 资源 + 剔除 entry。
    /// 返回是否移除（false = 未知 id 或非终态）。观察者不再收该 id 的态推（entry 已剔，快照剔除由
    /// 上层 projection 负责）。
    @discardableResult
    public func remove(_ id: SessionID) -> Bool {
        queue.sync {
            guard let entry = entries[id] else { return false }
            guard entry.machine.send(.remove) else { return false } // 非终态 → REMOVE 不命中转移表
            entry.session.close()                                    // 幂等释放（dead 会话 PTY 已闭）
            entries.removeValue(forKey: id)
            exitWaiters.removeValue(forKey: id) // 已终态收尸并剔除，待兑现者（若有）已在 handleExit 兑现
            Self.lifecycleLog.info("remove id=\(id.raw, privacy: .public) → entry 剔除")
            return true
        }
    }

    /// 强制收割指定会话（multi-window.md §1.2 关闭非最后一窗）：同步 force-close PTY + 直接剔 entry（不走
    /// 态机 REMOVE 门，同 shutdownForTeardown 的 teardown 语义，令全局池 count 即刻正确、防窗口析构后泄漏
    /// 40 名额）。未知 id 跳过（幂等）。unblock 各 waiter（session.close）。
    public func forceRemove(_ ids: [SessionID]) {
        queue.sync {
            for id in ids {
                guard let entry = entries[id] else { continue }
                entry.session.close()
                entries.removeValue(forKey: id)
                exitWaiters.removeValue(forKey: id)
            }
        }
    }

    /// 测试/拆除：同步强杀收口全部会话并清空（幂等）。unblock 各 waiter。
    public func shutdownForTeardown() {
        queue.sync {
            for (_, entry) in entries { entry.session.close() }
            entries.removeAll()
            exitWaiters.removeAll() // 拆除后不再兑现，交由等待方 backstop 收口
        }
    }

    // MARK: 超时泵（Stopping 驻留超时→TIMEOUT→Disconnected，§2.1 + §3.2 step 4）

    /// 推进超时：Stopping 且未退出、驻留满 grace 的会话 → TIMEOUT→Disconnected + 强杀收口。
    /// 兼顺带 flush 各会话去抖暂存。真壳由周期 timer 调（真时钟），测试注入假时钟确定性验证。
    public func pumpTimeouts(nowMs current: UInt64) {
        queue.sync {
            for (id, entry) in entries
                where entry.machine.state == .stopping && entry.exitResult == nil {
                if current &- entry.stoppingSinceMs >= UInt64(entry.graceMs) {
                    Self.lifecycleLog.notice(
                        "Stopping 超时升级 SIGKILL id=\(id.raw, privacy: .public) grace=\(entry.graceMs)ms → Disconnected")
                    transition(entry, id, .timeout)
                    entry.session.close()
                }
            }
            for (_, entry) in entries { entry.debouncer.flush(nowMs: current) }
        }
    }

    // MARK: 私有

    /// 态机转移（queue 限定）：命中则推进 + 经去抖记录（终态/Stopping 立即推，Running 等去抖）。
    private func transition(_ entry: Entry, _ id: SessionID, _ event: TerminalEvent) {
        dispatchPrecondition(condition: .onQueue(queue))
        guard entry.machine.send(event) else { return }
        entry.debouncer.record(entry.machine.state, nowMs: nowMs())
    }

    /// 退出处理（queue 限定，由 waiter 回队调用）：按「请求关闭 / 自发退出」分派态机（§3.3）。
    private func handleExit(id: SessionID, exit: PTYExit, forced: Bool, pid: Int32) {
        dispatchPrecondition(condition: .onQueue(queue))
        guard let entry = entries[id] else { return }
        entry.exitResult = (exit, forced)
        // worker 会话不入 pty-children（create 时已跳过 onChildSpawned）→ 退出亦不通报 pty 收割账本（对称，§5 陷阱①）。
        if entry.ownership != .worker { onChildReaped?(pid) }
        Self.lifecycleLog.info(
            "exit 分派 id=\(id.raw, privacy: .public) pid=\(pid) exit=\(String(describing: exit), privacy: .public) forced=\(forced) closeRequested=\(entry.closeRequested)")

        if entry.closeRequested || entry.machine.state == .stopping {
            // 请求关闭退出（已在 Stopping）：clean→EXIT_NORMAL→Stopped；grace 超时强杀→TIMEOUT→Disconnected。
            transition(entry, id, forced ? .timeout : .exitNormal)
        } else {
            // 非请求退出（自发）：code==0→CLOSE+EXIT_NORMAL 双发→Stopped；非0/信号→EXIT_ABNORMAL→Disconnected。
            let normal: Bool
            switch exit {
            case let .exited(code): normal = (code == 0)
            case .signaled: normal = false
            }
            if normal {
                transition(entry, id, .close)
                transition(entry, id, .exitNormal)
            } else {
                transition(entry, id, .exitAbnormal)
            }
        }
        // 收尸处理完（态机已到终态）→ 兑现事件驱动等待者（M7 批6）。放最后：兑现时 state(of:)/
        // exitInfo(of:)/pty-children 账本均确定就位，等待方随后同步读一致。
        if let waiters = exitWaiters.removeValue(forKey: id) {
            for waiter in waiters { waiter(exit, forced) }
        }
    }

    /// 每会话后台 waiter：阻塞等进程退出（信号量，不依赖 main）→ 回 queue 驱态机。
    private func launchExitWaiter(id: SessionID, session: TerminalSession, pid: Int32) {
        DispatchQueue.global(qos: .utility).async { [weak self] in
            guard let (exit, forced) = session.waitForExit(timeout: 86_400) else { return }
            self?.queue.async {
                self?.handleExit(id: id, exit: exit, forced: forced, pid: pid)
            }
        }
    }

    private func notifyObservers(id: SessionID, state: TerminalState) {
        dispatchPrecondition(condition: .onQueue(queue))
        let snapshot = observers
        for observer in snapshot {
            DispatchQueue.main.async { observer(id, state) }
        }
    }

    private static func isTerminal(_ state: TerminalState) -> Bool {
        switch state {
        case .stopped, .failed, .disconnected, .removed: return true
        default: return false
        }
    }
}
