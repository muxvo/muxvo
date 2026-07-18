// 状态推送去抖（vendor-free，时钟外部注入）。
//
// 权威：terminal-session.md §6.3（TERM_L1_06）。Running↔WaitingInput 抖动去抖
// STATE_CHANGE_DEBOUNCE_MS=50（legacy manager.ts:103），防 yes/no 提示里上下键抖动刷屏；
// 50ms 内多次变化只出最终一条。终态 + 关闭意图**豁免立即推**：Stopped/Failed/Disconnected/
// Removed（legacy manager.ts:107 immediate 名单）+ Stopping（§3.2 关闭意图纳入立即推）。
//
// 设计：不内建真实 timer——时钟以毫秒时间戳外部注入（record(_:nowMs:) / flush(nowMs:)），
// 假时钟可确定性验「50ms 内只出最终一条」。真集成（批 2）在会话 queue 上挂 DispatchQueue
// timer 周期调 flush，与本纯逻辑解耦。

public final class StateDebouncer {
    /// 去抖窗口（terminal-session.md §6.3，legacy manager.ts:103）。
    public static let debounceMs: UInt64 = 50

    /// 豁免立即推名单：终态四态 + 关闭意图 Stopping（terminal-session.md §6.3 + §3.2）。
    public static let immediateStates: Set<TerminalState> =
        [.stopping, .stopped, .failed, .disconnected, .removed]

    private let emit: (TerminalState) -> Void
    private var pending: TerminalState?
    private var pendingSinceMs: UInt64 = 0

    /// emit：去抖决定「该推送」时的回调（真集成 hop 到 main；单测收集到数组断言）。
    public init(emit: @escaping (TerminalState) -> Void) {
        self.emit = emit
    }

    /// 记录一次状态变化。豁免态立即 emit 并清暂存；否则暂存该态、记录时间戳（覆盖旧暂存）。
    public func record(_ state: TerminalState, nowMs: UInt64) {
        if Self.immediateStates.contains(state) {
            pending = nil
            emit(state)
        } else {
            pending = state
            pendingSinceMs = nowMs
        }
    }

    /// 时钟推进后调用：暂存态静默满 debounceMs 则 emit 最终一条并清暂存；不足则不动。
    public func flush(nowMs: UInt64) {
        guard let pendingState = pending else { return }
        if nowMs &- pendingSinceMs >= Self.debounceMs {
            pending = nil
            emit(pendingState)
        }
    }

    /// 是否有未推送的暂存态（测试/集成观测用）。
    public var hasPending: Bool { pending != nil }
}
