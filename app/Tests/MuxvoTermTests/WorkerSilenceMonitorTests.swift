// WorkerSilenceMonitor 单测（interactive-worker.md §3 SEC-M4，B2-6）：
//   IW_silence_waitclass_active（producer）：前台非 shell + PTY 静默 + 无 hook 进展 → 产 silence。
//   IW_tuipopup_spinner（wall-clock backstop）：spinner 刷屏戳破 PTY 静默 → 墙钟兜底仍产 silence。
// 全注入 foregroundNonShell 闭包 + 显式 nowMs（禁真进程/真时钟）；订阅 bus 录 silence 出口断言。
import Dispatch
import Foundation
import Testing

@testable import MuxvoTerm

/// bus 录 silence 事件（deliverOn 同步串行队列，poll 后确定性可读）。
private final class SilenceRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var events: [WaitEvent] = []
    let queue = DispatchQueue(label: "test.silence-recorder")
    func attach(to bus: WaitEventBus) { bus.subscribe(deliverOn: queue) { [self] e in
        if e.event == .silence { lock.withLock { events.append(e) } }
    } }
    /// 同步 barrier 等投递完成后读（deliverOn 是串行队列，barrier 后所有 async 已执行）。
    func drained() -> [WaitEvent] { queue.sync {}; return lock.withLock { events } }
}

@Suite("M4b B2-6 WorkerSilenceMonitor（§3 SEC-M4）", .timeLimit(.minutes(1)))
struct WorkerSilenceMonitorTests {
    private let idleMs: UInt64 = 30_000
    private let backstopMs: UInt64 = 90_000

    private func make(nonShell: Bool, rec: SilenceRecorder) -> (WorkerSilenceMonitor, WaitEventBus) {
        let bus = WaitEventBus()
        rec.attach(to: bus)
        let mon = WorkerSilenceMonitor(
            bus: bus,
            policy: .init(ptyIdleThresholdMs: idleMs, wallClockBackstopMs: backstopMs),
            foregroundNonShell: { _ in nonShell })
        return (mon, bus)
    }

    private func w(_ id: String, lastOutputMs: UInt64) -> WorkerSilenceMonitor.WorkerTerminal {
        .init(termId: id, shellPid: 4242, lastOutputMs: lastOutputMs)
    }

    // MARK: - IW_silence_waitclass_active（主判据）

    @Test("IW_silence_waitclass_active：前台非 shell + PTY 静默 ≥阈值 + 无 hook 进展 → 产 silence（一次，不重发）")
    func primarySilence() async throws {
        let rec = SilenceRecorder()
        let (mon, _) = make(nonShell: true, rec: rec)
        let base: UInt64 = 1_000_000
        // 首次 poll 建基线（lastHookMs=now）；此刻 hookIdle=0 → 不发。
        mon.poll(workers: [w("t1", lastOutputMs: base)], nowMs: base)
        #expect(rec.drained().isEmpty, "基线 poll 不发（hookIdle=0）")
        // 过阈值：PTY 自 base 静默 + 无 hook 进展 → 发 silence 一次。
        let later = base + idleMs + 1
        mon.poll(workers: [w("t1", lastOutputMs: base)], nowMs: later)
        var evs = rec.drained()
        #expect(evs.count == 1, "过阈值发一次 silence；实得 \(evs.count)")
        #expect(evs.first?.event == .silence && evs.first?.termId == "t1")
        // 再 poll（仍静默）→ 不重发（emitted 守卫）。
        mon.poll(workers: [w("t1", lastOutputMs: base)], nowMs: later + 5_000)
        evs = rec.drained()
        #expect(evs.count == 1, "已发 silence 不重发（emitted 守卫）；实得 \(evs.count)")
    }

    @Test("IW_silence_waitclass_active：前台是 shell（worker 空闲提示符/退出）→ 绝不产 silence")
    func shellForegroundNoSilence() async throws {
        let rec = SilenceRecorder()
        let (mon, _) = make(nonShell: false, rec: rec)
        let base: UInt64 = 1_000_000
        mon.poll(workers: [w("t1", lastOutputMs: base)], nowMs: base)
        mon.poll(workers: [w("t1", lastOutputMs: base)], nowMs: base + backstopMs + 1)
        #expect(rec.drained().isEmpty, "前台是 shell → 非卡 TUI 弹窗 → 无 silence")
    }

    @Test("hook 进展重置：silence 后 Stop hook 进展到达 → 清 emitted + 重置进展戳 → 后续再静默可再发")
    func hookProgressReArm() async throws {
        let rec = SilenceRecorder()
        let (mon, _) = make(nonShell: true, rec: rec)
        let base: UInt64 = 1_000_000
        mon.poll(workers: [w("t1", lastOutputMs: base)], nowMs: base)
        mon.poll(workers: [w("t1", lastOutputMs: base)], nowMs: base + idleMs + 1)
        #expect(rec.drained().count == 1)
        // Stop hook 进展（装配层转调 noteProgress，同步）→ 重置进展戳 + 清 emitted。
        let progressTs = base + idleMs + 2
        mon.noteProgress(termId: "t1", tsMs: progressTs)
        // 再次过阈值（自 progressTs 起算 PTY 静默 + 无新进展）→ 可再发第二次 silence。
        mon.poll(workers: [w("t1", lastOutputMs: progressTs)], nowMs: progressTs + idleMs + 1)
        #expect(rec.drained().count == 2, "hook 进展 re-arm 后再静默可再发；实得 \(rec.drained().count)")
    }

    // MARK: - IW_tuipopup_spinner（wall-clock backstop）

    @Test("IW_tuipopup_spinner：spinner 周期刷屏（PTY 不静默）戳破主判据 → wall-clock backstop 仍升级 silence")
    func wallClockBackstop() async throws {
        let rec = SilenceRecorder()
        let (mon, _) = make(nonShell: true, rec: rec)
        let base: UInt64 = 1_000_000
        mon.poll(workers: [w("t1", lastOutputMs: base)], nowMs: base)
        // spinner：每次 poll 时 lastOutputMs 都很新（PTY 一直在刷）→ ptyIdle 恒小 → 主判据永不命中。
        let mid = base + idleMs + 10_000
        mon.poll(workers: [w("t1", lastOutputMs: mid)], nowMs: mid) // PTY 刚刷 → ptyIdle≈0
        #expect(rec.drained().isEmpty, "spinner 刷屏 → PTY 不静默 → 主判据不命中")
        // 但 hook 进展自 base 起从未有 → 超 backstop 阈值 → 墙钟兜底升级（即使 PTY 刚刷）。
        let backstopHit = base + backstopMs + 1
        mon.poll(workers: [w("t1", lastOutputMs: backstopHit)], nowMs: backstopHit)
        let evs = rec.drained()
        #expect(evs.count == 1, "wall-clock backstop 命中发 silence（spinner 假阴性兜底）；实得 \(evs.count)")
        #expect(evs.first?.raw?.contains("wall_clock_backstop") == true, "raw 标 backstop 原因")
    }

    @Test("终端消失（worker 退出）→ 剪除内部状态（不泄漏）")
    func prunesGoneTerminals() async throws {
        let rec = SilenceRecorder()
        let (mon, _) = make(nonShell: true, rec: rec)
        let base: UInt64 = 1_000_000
        mon.poll(workers: [w("t1", lastOutputMs: base)], nowMs: base)
        mon.poll(workers: [], nowMs: base + 1000) // t1 消失
        // t1 复现（新 worker 复用 termId 概率极低，但断言状态已重置：又要过完整阈值才发）。
        mon.poll(workers: [w("t1", lastOutputMs: base + 2000)], nowMs: base + 2000)
        mon.poll(workers: [w("t1", lastOutputMs: base + 2000)], nowMs: base + 2000 + idleMs - 1) // 差 1ms 不足阈值
        #expect(rec.drained().isEmpty, "剪除后重置基线，未达新阈值不误发")
    }
}
