// WaitDetectorCore：单终端等待检测核心（纯函数式，假时钟注入）。wait-detector.md §2/§3/§6。
//
// 定位：一个终端一实例，持有该终端的层合成状态。所有时间戳由调用方按单一 epoch ms 时钟传入
// （WaitClock），核内不读真时钟——故 30s 边界 / 间隔运算可用假时钟确定性单测（§9「单测大头」）。
//
// 层合成（§3）：优先级 Layer 0 > 进程 > 静默；edge-triggered；任一层报 WaitingInput 即等待。M3：
//   - Layer 0（hook）：notification/stop → waiting；userPromptSubmit → running（清）。
//   - 进程：不独立产 WaitingInput（进程退出的 Stopped/Disconnected 归 SessionRegistry 生命周期）；
//     进程层在此仅「前台进程退出 → 清静默弱信号」，且「前台是否非 shell」作静默门控输入。
//   - 静默（弱）：三与门控 = 前台非 shell **且** PTY 静默（自 lastActivity ≥30s）**且** 该终端无
//     Layer 0 事件流（§6）。silenceWaiting 是 (lastActivityMs, foregroundNonShell, hasSeenLayer0, now)
//     的纯函数，由 evaluateSilence 每轮（1s 轮询）重算——活动恢复或前台回 shell 自动清。
//
// 静默豁免（§3）：hasSeenLayer0（曾收到任意 Layer 0 事件）= 终端持久属性，静默层对它永久豁免；
// reset_on_user_input **不清** hasSeenLayer0（只清各层等待）。
public final class WaitDetectorCore {
    private var layer0Waiting = false
    private var silenceWaiting = false
    /// 曾收到任意 Layer 0 事件（静默永久豁免键，§3）。持久，reset 不清。
    private var hasSeenLayer0 = false
    /// 前台是否非 shell 进程（静默门控输入，1s 轮询喂入，§6）。
    private var foregroundNonShell = false
    /// 最近一次活动（PTY 输出 / 用户输入 / hook 事件）的 epoch ms——静默计时基准。
    private var lastActivityMs: UInt64
    /// 静默 ack 抑制水位（§3 ☆DOGFOOD_M3_08，用户裁决 2026-07-04）：acknowledge/userInput/reset
    /// 置为其 ts（单调抬升）；新 PTY 输出（ts 严格 > 水位）解除 = 开启新 episode。nil = 未抑制。
    /// 严格 > 是关键：poll 每秒以陈旧 lastOutputMs max 折叠喂入，stale ts ≤ 水位绝不解除；
    /// 同 ms 平局（echo ts == 输入 ts）不解除，后续任何更晚输出解除。
    private var silenceAckedAtMs: UInt64?

    /// - Parameter startMs: 初始活动时刻（默认 0；真集成传 spawn 时刻，测试传假时钟起点）。
    public init(startMs: UInt64 = 0) {
        lastActivityMs = startMs
    }

    // MARK: 查询

    /// 当前合成结论（Layer 0 > 静默；进程层不独立产等待）。
    public var conclusion: WaitConclusion {
        if layer0Waiting { return WaitConclusion(state: .waitingInput, source: .layer0) }
        if silenceWaiting { return WaitConclusion(state: .waitingInput, source: .silence) }
        return .running
    }

    /// 该终端是否已有 Layer 0 事件流（静默豁免；测试/门控用）。
    public var hasLayer0Flow: Bool { hasSeenLayer0 }

    // MARK: 事件摄入（edge-triggered、idempotent）

    /// 摄入一个等待事件，返回合成后新结论。同态重复摄入结论不变（idempotent）。
    @discardableResult
    public func ingest(_ event: WaitEventKind, ts: UInt64) -> WaitConclusion {
        switch event {
        case .notification, .stop:
            // Layer 0 进入等待：标记 hook 流（静默永久豁免）+ 清静默 + 记活动。
            hasSeenLayer0 = true
            layer0Waiting = true
            silenceWaiting = false
            lastActivityMs = max(lastActivityMs, ts)
        case .userPromptSubmit:
            // Layer 0 清红回运行（兜粘贴/提交）；仍标记 hook 流。
            hasSeenLayer0 = true
            layer0Waiting = false
            silenceWaiting = false
            lastActivityMs = max(lastActivityMs, ts)
        case .sessionStart:
            // 锚点采集专用事件（terminal-session-restore.md 登记 4）：detector 零语义影响——
            // 不标 hook 流（否则 resume 后闲置会话失去静默兜底弱提示）、不动等待态、不记活动。
            break
        case .userInput, .acknowledge:
            // reset_on_user_input / acknowledge：各层清回 running（hasSeenLayer0 持久不清）+
            // 置静默抑制水位（☆DOGFOOD_M3_08：确认后不再提醒，直到新输出开新 episode）。
            layer0Waiting = false
            silenceWaiting = false
            silenceAckedAtMs = max(silenceAckedAtMs ?? 0, ts)
            lastActivityMs = max(lastActivityMs, ts)
        case .processExit:
            // 前台进程退出：前台回空 + 清静默弱信号（§6 清除条件之一）；layer0 不受影响。
            // 抑制水位不清（§3 ☆修订：唯一解除条件 = 新输出；提示符回显天然解除）。
            foregroundNonShell = false
            silenceWaiting = false
        case .silence:
            // 直投静默事件（replay/测试，绕过 evaluateSilence 门控）：仅无 hook 流且未被抑制的终端接受。
            if !hasSeenLayer0, silenceAckedAtMs == nil { silenceWaiting = true }
        }
        return conclusion
    }

    /// PTY 输出活动（§6「任意 PTY 输出」）：推进静默计时基准。不直接改 silenceWaiting——
    /// 由下一轮 evaluateSilence 依新 lastActivity 自动清。新输出严格晚于抑制水位 → 解除抑制
    /// （开新 episode，☆DOGFOOD_M3_08）。返回当前结论（通常未变）。
    @discardableResult
    public func recordActivity(ts: UInt64) -> WaitConclusion {
        if let acked = silenceAckedAtMs, ts > acked { silenceAckedAtMs = nil }
        lastActivityMs = max(lastActivityMs, ts)
        return conclusion
    }

    /// 更新前台门控（1s 轮询喂入，§6）：前台是否跑非 shell 进程。
    public func setForegroundNonShell(_ nonShell: Bool) {
        foregroundNonShell = nonShell
    }

    /// 静默评估（1s 轮询驱动，§6 三与门控 + ☆ack 抑制第四与项）：silenceWaiting = 无 hook 流
    /// **且** 前台非 shell **且** 自 lastActivity 静默 ≥30s **且** 未被 ack 抑制。纯函数式重算——
    /// 门控失守（活动恢复/前台回 shell）自动清。返回新结论。
    @discardableResult
    public func evaluateSilence(nowMs: UInt64) -> WaitConclusion {
        let silent = !hasSeenLayer0
            && foregroundNonShell
            && (nowMs &- lastActivityMs >= SilencePolicy.SILENCE_THRESHOLD_MS)
            && silenceAckedAtMs == nil
        silenceWaiting = silent
        return conclusion
    }

    /// 显式 reset（tileClick/acknowledge 等价，§3）：各层清回 running（hasSeenLayer0 持久）+
    /// 置静默抑制水位（与 acknowledge 语义对齐，☆DOGFOOD_M3_08）。
    @discardableResult
    public func reset(ts: UInt64) -> WaitConclusion {
        layer0Waiting = false
        silenceWaiting = false
        silenceAckedAtMs = max(silenceAckedAtMs ?? 0, ts)
        lastActivityMs = max(lastActivityMs, ts)
        return conclusion
    }
}
