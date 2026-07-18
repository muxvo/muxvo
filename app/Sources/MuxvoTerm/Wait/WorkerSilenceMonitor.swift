// WorkerSilenceMonitor：交互式 worker silence 生产者（interactive-worker.md §3，SEC-M4，M4b B2-6）。
//
// 与 `WaitDetectorHub`/`WaitDetectorCore` 静默兜底的**根本分野**（勿混淆）：
//   · detector 核静默（wait-detector.md §6，主键 termId）= 对 hook 终端「CC 思考无输出」的**假阴性抑制**——
//     hook 终端恰恰**不产** silence（豁免），因为对人用的终端「静默」是正常思考。
//   · 本监视器（主键 termId、限 **worker 终端**）= 交互式 worker「疑似卡在 hook 管不到的 TUI 弹窗前」的**真语义
//     silence 生产者**：前台非 shell 进程 + PTY 静默 + 无近期 hook 进展 ⇒ 产 WaitEvent(.silence) 入既有 bus，
//     第二订阅者据绑定表映射 taskId 后 apply(wait_entered, waitClass:silence)（衔接 §2 TUI 弹窗呼出人处置）。
//
// **假阴性兜底（SEC-M4 实现批义务）**：带 spinner 的 TUI 弹窗周期刷屏 → 戳破「PTY 静默」判据 → 挂在弹窗前却
// 检不出。故 **wall-clock backstop**：前台非 shell 进程持续 + **无近期 hook 进展** ≥ 长阈值（即使 PTY 有微量刷新）
// 也升级——代价是「单个真活跃长 turn」超长阈值亦被软升级（粗糙引导层弱信号、可点开即消，可接受）。多 turn 工作
// 每 Stop hook 进展即重置进展窗，backstop 只对「无任何 hook 进展的长挂起」发火。
//
// 进展信号源 = 遥测三 hook（Notification/Stop/UserPromptSubmit）+ 用户输入，由装配层从 worker 终端事件转调
// `noteProgress`（重置进展戳 + re-arm）；PreToolUse/PostToolUse 走审批 socket（不入本 bus），故长 turn 内工具往返
// 不算进展——由 PTY 输出（lastOutputMs）与 backstop 共同覆盖。纯 pid/时钟层，vendor-free（只 publish 不 subscribe）。
import Dispatch
import Foundation

public final class WorkerSilenceMonitor: @unchecked Sendable {
    /// 阈值策略（§3；粗糙引导层，集中此处便于调参/测试注入）。
    public struct Policy: Sendable {
        /// 主判据：前台非 shell + PTY 静默 ≥ 此毫秒 + 无近期 hook 进展 ≥ 此毫秒 → silence。
        public var ptyIdleThresholdMs: UInt64
        /// wall-clock backstop：前台非 shell + 无近期 hook 进展 ≥ 此毫秒（即使 PTY 刷新）→ silence（防 spinner 假阴性）。
        public var wallClockBackstopMs: UInt64
        public init(ptyIdleThresholdMs: UInt64 = SilencePolicy.SILENCE_THRESHOLD_MS,
                    wallClockBackstopMs: UInt64 = 90_000) {
            self.ptyIdleThresholdMs = ptyIdleThresholdMs
            self.wallClockBackstopMs = wallClockBackstopMs
        }
    }

    /// 轮询输入：一个活体 worker 终端（termId + shell/leader pid + 最近 PTY 输出戳 epoch ms）。
    public struct WorkerTerminal: Sendable {
        public let termId: String
        public let shellPid: Int32
        public let lastOutputMs: UInt64
        public init(termId: String, shellPid: Int32, lastOutputMs: UInt64) {
            self.termId = termId
            self.shellPid = shellPid
            self.lastOutputMs = lastOutputMs
        }
    }

    private struct State { var lastHookMs: UInt64; var emitted: Bool }

    private let bus: WaitEventBus
    private let policy: Policy
    /// 前台非 shell 探测（注入便于测试；生产 = ForegroundProbe.isNonShellForeground）。
    private let foregroundNonShell: @Sendable (Int32) -> Bool
    private let lock = NSLock()
    private var states: [String: State] = [:]

    public init(
        bus: WaitEventBus,
        policy: Policy = Policy(),
        foregroundNonShell: @escaping @Sendable (Int32) -> Bool = { ForegroundProbe.isNonShellForeground(shellPid: $0) }
    ) {
        self.bus = bus
        self.policy = policy
        self.foregroundNonShell = foregroundNonShell
    }

    /// hook 进展回灌（装配层从 worker 终端的非 silence hook 事件 Stop/Notification/UserPromptSubmit/userInput 转调）：
    /// 重置该 termId 进展戳 + 清 emitted（有进展即再次进入可评估态；防单发 silence 后永不复评）。同步、可确定性测。
    public func noteProgress(termId: String, tsMs: UInt64) {
        lock.withLock {
            var s = states[termId] ?? State(lastHookMs: tsMs, emitted: false)
            if tsMs >= s.lastHookMs { s.lastHookMs = tsMs }
            s.emitted = false
            states[termId] = s
        }
    }

    /// 轮询评估（TerminalService 1s 循环调，仅传 worker 终端）：对每终端评估 silence，命中即 publish 一次。
    /// nowMs 用 WaitClock epoch ms（与 socket/lastOutputMs 同一时钟，§0）。
    public func poll(workers: [WorkerTerminal], nowMs: UInt64) {
        for w in workers {
            let nonShellFg = foregroundNonShell(w.shellPid)
            var emit = false
            lock.lock()
            var s = states[w.termId] ?? State(lastHookMs: nowMs, emitted: false)
            let ptyIdle = nowMs >= w.lastOutputMs ? nowMs &- w.lastOutputMs : 0
            let hookIdle = nowMs >= s.lastHookMs ? nowMs &- s.lastHookMs : 0
            if nonShellFg {
                // 主判据：PTY 真静默 + 无 hook 进展；backstop：无 hook 进展够久（spinner 刷 PTY 亦升级）。
                let primary = ptyIdle >= policy.ptyIdleThresholdMs && hookIdle >= policy.ptyIdleThresholdMs
                let backstop = hookIdle >= policy.wallClockBackstopMs
                if (primary || backstop) && !s.emitted { s.emitted = true; emit = true }
            } else {
                // 前台回 shell（worker 空闲提示符/退出）→ 非「卡 TUI 弹窗」→ 清 emitted，绝不误产 silence。
                s.emitted = false
            }
            states[w.termId] = s
            lock.unlock()
            if emit {
                let reason = ptyIdle >= policy.ptyIdleThresholdMs ? "pty_idle" : "wall_clock_backstop"
                bus.publish(WaitEvent(
                    termId: w.termId, event: .silence, ts: nowMs,
                    raw: "{\"waitClass\":\"silence\",\"reason\":\"\(reason)\"}"))
            }
        }
        // 剪除消失终端（worker 退出）。
        let alive = Set(workers.map { $0.termId })
        lock.withLock { states = states.filter { alive.contains($0.key) } }
    }
}
