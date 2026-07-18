// 网格 resize settle（vendor-free，时钟外部注入）。
//
// 权威：terminal-rendering.md §1.2 ☆ / terminal-session.md §4 ☆（DOGFOOD_M3_12）。
// PTY resize 全链原本零节流：布局切换中间帧/入站换序回闪的瞬态窄 rect、分隔条拖动与窗口
// live resize 的逐帧几何流，每个不同宽度都直达 TIOCSWINSZ→SIGWINCH，前台程序（CC）逐帧
// 全量重绘把中间宽度的硬换行永久烧进 scrollback（vt reflow 只救软换行）。
//
// 语义 = trailing debounce + maxWait 混合：
// - 候选值静默满 settleMs（80ms）→ flush 吐终值（吞掉窗内任意宽→窄→宽 flap）；
// - 连续变化流下自首个未提交变化起满 maxWaitMs（150ms）→ record 直接判 .commitNow
//   **内联提交**（不依赖 timer——分隔条拖动的 event-tracking runloop 下最稳），保
//   「实时重排」（PRD REQ-TERM_GRID-011）为 ≥6.7Hz 有界延迟而非逐帧。
//
// 设计照 StateDebouncer 惯例：不内建真实 timer，时钟以毫秒时间戳外部注入
// （record(cols:rows:nowMs:) / flush(nowMs:)），假时钟确定性验证；真集成
// （TerminalSurfaceView）在 main 上挂 one-shot timer 到期调 flush。
public final class GridResizeSettler {
    /// trailing 静默窗：候选值此时长内无新变化才提交（吞瞬态 flap 的窗口）。
    public static let settleMs: UInt64 = 80
    /// 连续变化流的提交上限间隔：自首个未提交变化起最迟此时长必提交一次（拖动期实时重排保真）。
    public static let maxWaitMs: UInt64 = 150

    /// record 的裁决：maxWait 已到 → 调用方立即提交；否则挂/续 trailing timer。
    public enum Verdict: Equatable {
        case commitNow(cols: Int, rows: Int)
        case scheduled(dueInMs: UInt64)
    }

    private var pending: (cols: Int, rows: Int)?
    private var lastChangeMs: UInt64 = 0
    private var firstPendingMs: UInt64 = 0

    public init() {}

    /// 记录一个候选网格值。maxWait 到期 → 返回 .commitNow 并清空（调用方就地提交）；
    /// 否则暂存（覆盖旧候选、trailing 窗重置，maxWait 锚保持首个未提交变化时刻）。
    ///
    /// allowMaxWait：true 保 maxWait 中间提交（DOGFOOD_M3_16 曾以此豁免窗口边 live-resize）。
    /// m3-layout-r5 F1 起生产一律传 false（settle-only）：拖拽期每次 maxWait 内联提交都命中
    /// 活动 Ink 帧烧录永久残骸（2026-07-07 现场实录），原豁免所引 PRD REQ-TERM_GRID-011 只管辖
    /// 竖向分隔条、不覆盖窗口 resize。参数与 maxWait 机制留存库级（本类单测覆盖），供将来
    /// 显式重启用时不需重写。
    public func record(cols: Int, rows: Int, nowMs: UInt64, allowMaxWait: Bool = true) -> Verdict {
        if pending == nil { firstPendingMs = nowMs }
        pending = (cols, rows)
        lastChangeMs = nowMs
        if allowMaxWait, nowMs &- firstPendingMs >= Self.maxWaitMs {
            pending = nil
            return .commitNow(cols: cols, rows: rows)
        }
        return .scheduled(dueInMs: Self.settleMs)
    }

    /// 时钟推进后调用：候选静默满 settleMs → 吐终值并清空；不足/无候选 → nil（调用方按
    /// dueInMs(nowMs:) 重挂 timer）。
    public func flush(nowMs: UInt64) -> (cols: Int, rows: Int)? {
        guard let p = pending else { return nil }
        guard nowMs &- lastChangeMs >= Self.settleMs else { return nil }
        pending = nil
        return p
    }

    /// 撤销候选（几何回到已提交值 / detach）。
    public func cancel() {
        pending = nil
    }

    /// 是否有未提交候选（集成 re-arm 与测试观测用）。
    public var hasPending: Bool { pending != nil }

    /// 距 trailing 到期还差多少 ms（无候选 → nil；已到期 → 0）。flush 未到期后重挂 timer 用。
    public func dueInMs(nowMs: UInt64) -> UInt64? {
        guard pending != nil else { return nil }
        let elapsed = nowMs &- lastChangeMs
        return elapsed >= Self.settleMs ? 0 : Self.settleMs - elapsed
    }
}
