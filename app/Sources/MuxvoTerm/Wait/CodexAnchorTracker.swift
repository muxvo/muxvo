// CodexAnchorTracker：Codex 终端会话恢复锚点采集（terminal-session-restore.md §1.5，P-2 fast-follow r3）。
//
// Codex 无 hook（对偶 SessionTracker 的 CC hook 源）→ 锚点来源改「前台进程识别 + rollout 定向匹配」双证据
// 关联。本类是**纯状态机**：exec-free / fs-free——每 tick 吃装配层喂的前台观测数组，副作用全经注入闭包
// （record / clearIfCodex / listCandidates / ownershipOf），依赖倒置同 SessionTracker→store 先例。
//
// 硬约束（§1.5）：
//  · **只采 human**——ownership∈{human,worker,takeover,brain} 只采 human（防调度器 §6/接管 §4.7 双恢复）；
//  · **唯一候选才绑**——cwd 归一后恰 1 个未被认领的候选才绑；0 个重试、≥2 个保守跳过（歧义不猜，同 §3 join）；
//  · **条件清除**——连续 2 次「确认非 codex」才 clearIfCodex（unknown 不计数）；防跨 harness 竞态误删 .cc 新锚点；
//  · **零全量扫**——仅 pendingBind 态按退避调 listCandidates（idle/bound 态零 fs，M5 P0 594MB 教训）。
import Foundation

/// rollout 候选（listCandidates 注入闭包产出；probe 实现在 MuxvoChatHistory.CodexRolloutProbe，装配层映射）。
public struct RolloutCandidate: Sendable, Equatable {
    public let sessionId: String
    public let cwd: String
    public let rolloutPath: String
    public let mtimeMs: UInt64
    public init(sessionId: String, cwd: String, rolloutPath: String, mtimeMs: UInt64) {
        self.sessionId = sessionId
        self.cwd = cwd
        self.rolloutPath = rolloutPath
        self.mtimeMs = mtimeMs
    }
}

/// 单终端前台观测（装配层每 tick 从快照构造喂入）。
public struct CodexTermObservation: Sendable {
    public let termId: String
    public let cwd: String
    public let foreground: ForegroundProbe.ForegroundState
    public init(termId: String, cwd: String, foreground: ForegroundProbe.ForegroundState) {
        self.termId = termId
        self.cwd = cwd
        self.foreground = foreground
    }
}

public final class CodexAnchorTracker: @unchecked Sendable {
    // 常量（§1.5）
    /// pendingBind 时间窗回溯 slack：窗起点 = 进入 pending 时刻 - slack，容忍探测周期与 rollout eager 落盘的先后抖动。
    static let slackMs: UInt64 = 3_000
    /// 前 N tick 每 tick 扫（rollout 落盘晚于进程起的追赶窗）。
    static let pendingEagerTicks = 20
    /// 之后每 M tick 扫一次（退避，降 fs 触碰）。
    static let pendingSlowEveryTicks = 5
    /// bound 态 touch lastActiveTs 节流（不逐 tick，否则去抖 store 每秒落盘）。
    static let touchThrottleMs: UInt64 = 60_000
    /// 连续「确认非 codex」达此次数 → 清锚点（hysteresis，探测抖动免疫）。
    static let nonCodexClearStreak = 2

    private enum TermState {
        case idle
        /// 前台 codex，等 rollout 匹配。pendingSince=进入时刻（窗起点基准，不随重试重置）；tick=已重试轮次。
        case pendingBind(pendingSince: UInt64, tick: Int)
        /// 已绑会话。lastTouchMs=上次 touch；nonCodexStreak=连续确认非 codex 计数。
        case bound(sessionId: String, cwd: String, rolloutPath: String, lastTouchMs: UInt64, nonCodexStreak: Int)
    }

    private let record: @Sendable (_ termId: String, _ sessionId: String, _ cwd: String, _ rolloutPath: String, _ ts: UInt64) -> Void
    private let clearIfCodex: @Sendable (_ termId: String, _ sessionId: String) -> Void
    private let listCandidates: @Sendable (_ sinceMs: UInt64, _ nowMs: UInt64) -> [RolloutCandidate]
    private let ownershipOf: @Sendable (_ termId: String) -> TerminalOwnership

    private let lock = NSLock()
    private var states: [String: TermState] = [:]
    /// 测试观测：listCandidates 实际调用次数（TSR_CX_scan_only_when_pending 断言「idle/bound 零扫」）。
    public private(set) var scanCalls = 0

    public init(
        record: @escaping @Sendable (_ termId: String, _ sessionId: String, _ cwd: String, _ rolloutPath: String, _ ts: UInt64) -> Void,
        clearIfCodex: @escaping @Sendable (_ termId: String, _ sessionId: String) -> Void,
        listCandidates: @escaping @Sendable (_ sinceMs: UInt64, _ nowMs: UInt64) -> [RolloutCandidate],
        ownershipOf: @escaping @Sendable (_ termId: String) -> TerminalOwnership = { _ in .human }
    ) {
        self.record = record
        self.clearIfCodex = clearIfCodex
        self.listCandidates = listCandidates
        self.ownershipOf = ownershipOf
    }

    /// 终端移除（装配层 onTerminalRemoved 同步调）：仅复位内部状态；锚点清除由既有 store.clear 路径覆盖。
    public func terminalRemoved(termId: String) {
        lock.withLock { states[termId] = nil }
    }

    /// 逐 tick 驱动（生产由 SessionHub.pollWaitDetector 每 ~1s 调；测试传假 nowMs）。
    public func poll(observations: [CodexTermObservation], nowMs: UInt64) {
        lock.withLock {
            // 已 bound 的 sessionId ∪ 本轮已认领：绑定候选时排除（防两终端争同一 rollout / 重复绑）。
            var claimed = Set<String>()
            for case let .bound(sid, _, _, _, _) in states.values { claimed.insert(sid) }

            var live = Set<String>()
            for obs in observations {
                live.insert(obs.termId)
                // ownership 过滤（§1.5）：非 human 不进观察集；已有状态一并复位。
                guard ownershipOf(obs.termId) == .human else { states[obs.termId] = nil; continue }
                let isCodex = Self.foregroundIsCodex(obs.foreground)
                let isUnknown = obs.foreground == .unknown
                let prev = states[obs.termId] ?? .idle
                states[obs.termId] = step(
                    termId: obs.termId, cwd: obs.cwd, prev: prev,
                    isCodex: isCodex, isUnknown: isUnknown, nowMs: nowMs, claimed: &claimed)
            }
            // 观测缺席的终端（本 tick 未上报，通常已被剪除）不主动清锚点——留给 terminalRemoved/既有 clear。
            _ = live
        }
    }

    /// 单终端状态推进（须持 lock）。
    private func step(
        termId: String, cwd: String, prev: TermState,
        isCodex: Bool, isUnknown: Bool, nowMs: UInt64, claimed: inout Set<String>
    ) -> TermState {
        switch prev {
        case .idle:
            // 前台起 codex → 进 pendingBind 并**本 tick 立即尝试绑定**（rollout 可能已在盘）。非 codex/unknown → 留 idle。
            guard isCodex else { return .idle }
            return tryBindOrPend(termId: termId, cwd: cwd, pendingSince: nowMs, tick: 0, nowMs: nowMs, claimed: &claimed)

        case let .pendingBind(pendingSince, tick):
            if isUnknown { return .pendingBind(pendingSince: pendingSince, tick: tick) } // 抖动不放弃
            guard isCodex else { return .idle } // 前台已不是 codex（绑成前就退了）→ 回 idle
            return tryBindOrPend(
                termId: termId, cwd: cwd, pendingSince: pendingSince, tick: tick, nowMs: nowMs, claimed: &claimed)

        case let .bound(sid, bcwd, rollout, lastTouch, streak):
            if isUnknown {
                return .bound(sessionId: sid, cwd: bcwd, rolloutPath: rollout,
                              lastTouchMs: lastTouch, nonCodexStreak: streak) // unknown 不计数、不清零
            }
            if isCodex {
                // 前台仍 codex → 60s 节流 touch lastActiveTs（不碰 fs：用已知 sid/rollout/cwd 直写）。
                if nowMs &- lastTouch >= Self.touchThrottleMs {
                    record(termId, sid, bcwd, rollout, nowMs)
                    return .bound(sessionId: sid, cwd: bcwd, rolloutPath: rollout,
                                  lastTouchMs: nowMs, nonCodexStreak: 0)
                }
                return .bound(sessionId: sid, cwd: bcwd, rolloutPath: rollout,
                              lastTouchMs: lastTouch, nonCodexStreak: 0) // streak 归 0
            }
            // 确认非 codex（idle 或 running 非 codex）→ streak++；达阈值条件清除、回 idle。
            let n = streak + 1
            if n >= Self.nonCodexClearStreak {
                clearIfCodex(termId, sid)
                return .idle
            }
            return .bound(sessionId: sid, cwd: bcwd, rolloutPath: rollout,
                          lastTouchMs: lastTouch, nonCodexStreak: n)
        }
    }

    /// pendingBind 扫描 + 唯一候选绑定（否则留 pending 并递增 tick）。须持 lock。
    private func tryBindOrPend(
        termId: String, cwd: String, pendingSince: UInt64, tick: Int, nowMs: UInt64, claimed: inout Set<String>
    ) -> TermState {
        guard Self.shouldScan(tick: tick) else {
            return .pendingBind(pendingSince: pendingSince, tick: tick + 1) // 退避不扫
        }
        let since = pendingSince >= Self.slackMs ? pendingSince - Self.slackMs : 0
        scanCalls += 1
        let candidates = listCandidates(since, nowMs)
        // cwd 归一匹配 + 排除已认领 sessionId。
        let matches = candidates.filter {
            Self.pathsEquivalent($0.cwd, cwd) && !claimed.contains($0.sessionId)
        }
        guard matches.count == 1, let m = matches.first else {
            return .pendingBind(pendingSince: pendingSince, tick: tick + 1) // 0/≥2 → 保守，留 pending
        }
        claimed.insert(m.sessionId)
        record(termId, m.sessionId, m.cwd, m.rolloutPath, nowMs)
        return .bound(sessionId: m.sessionId, cwd: m.cwd, rolloutPath: m.rolloutPath,
                      lastTouchMs: nowMs, nonCodexStreak: 0)
    }

    // MARK: - 纯判据（可单测）

    /// 前台三态 → 是否在跑 codex（命令行 argv token basename 判据，覆盖 node 包装形态，见 ForegroundProbe）。
    static func foregroundIsCodex(_ state: ForegroundProbe.ForegroundState) -> Bool {
        if case let .running(_, command) = state { return ForegroundProbe.commandIsCodex(command) }
        return false
    }

    /// pendingBind 是否该扫（退避）：前 pendingEagerTicks tick 每 tick 扫，之后每 pendingSlowEveryTicks tick 扫。
    static func shouldScan(tick: Int) -> Bool {
        tick < pendingEagerTicks || tick % pendingSlowEveryTicks == 0
    }

    /// cwd 归一等价（§1.5，同 cwd-pin 口径）：去尾斜杠 + `/private` 别名等价（codex 记 realpath /private/tmp）；
    /// **不做 symlink 解析**（纯字符串，失配最坏是不绑退化 M3，无磁盘 I/O）。
    static func pathsEquivalent(_ a: String, _ b: String) -> Bool {
        let x = stripTrailingSlash(a)
        let y = stripTrailingSlash(b)
        return x == y || "/private" + x == y || x == "/private" + y
    }

    private static func stripTrailingSlash(_ s: String) -> String {
        var out = s
        while out.count > 1, out.hasSuffix("/") { out.removeLast() }
        return out
    }
}
