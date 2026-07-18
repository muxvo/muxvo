import Testing

@testable import MuxvoTermCore

@Suite("StateDebouncer（50ms 去抖 + 终态豁免，假时钟，terminal-session.md §6.3 / TERM_L1_06）")
struct StateDebouncerTests {
    @Test("常量：50ms 窗口 + 豁免名单（终态四态 + Stopping）")
    func constants() {
        #expect(StateDebouncer.debounceMs == 50)
        #expect(StateDebouncer.immediateStates == [.stopping, .stopped, .failed, .disconnected, .removed])
    }

    @Test("50ms 内多次非终态变化只出最终一条（假时钟）")
    func coalescesToFinalWithinWindow() {
        var emitted: [TerminalState] = []
        let debouncer = StateDebouncer { emitted.append($0) }

        debouncer.record(.waitingInput, nowMs: 0)
        debouncer.record(.running, nowMs: 10)
        debouncer.record(.waitingInput, nowMs: 20)
        #expect(emitted.isEmpty) // 窗口内不推

        debouncer.flush(nowMs: 30) // 30-20=10 < 50，不足
        #expect(emitted.isEmpty)

        debouncer.flush(nowMs: 70) // 70-20=50 >= 50，出最终一条
        #expect(emitted == [.waitingInput])
        #expect(debouncer.hasPending == false)

        debouncer.flush(nowMs: 1000) // 已清，无重复
        #expect(emitted == [.waitingInput])
    }

    @Test("终态豁免立即推：Stopped 中断去抖窗口即时 emit 并清暂存")
    func terminalStateBypassesDebounce() {
        var emitted: [TerminalState] = []
        let debouncer = StateDebouncer { emitted.append($0) }

        debouncer.record(.running, nowMs: 0) // 非终态，暂存
        #expect(emitted.isEmpty)
        debouncer.record(.stopped, nowMs: 5) // 终态豁免 → 立即
        #expect(emitted == [.stopped])
        #expect(debouncer.hasPending == false)

        debouncer.flush(nowMs: 1000) // 暂存已清，无迟到的 running
        #expect(emitted == [.stopped])
    }

    @Test("关闭意图 Stopping 亦立即推（§3.2 纳入豁免名单）")
    func stoppingBypassesDebounce() {
        var emitted: [TerminalState] = []
        let debouncer = StateDebouncer { emitted.append($0) }
        debouncer.record(.stopping, nowMs: 0)
        #expect(emitted == [.stopping])
    }

    @Test("全部终态豁免逐一立即推")
    func allImmediateStatesEmitInstantly() {
        for state in StateDebouncer.immediateStates {
            var emitted: [TerminalState] = []
            let debouncer = StateDebouncer { emitted.append($0) }
            debouncer.record(state, nowMs: 0)
            #expect(emitted == [state], "\(state) 应立即推")
        }
    }
}
