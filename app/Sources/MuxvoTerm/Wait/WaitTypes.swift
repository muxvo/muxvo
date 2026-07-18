// WaitDetector 冻结类型 + 单一时钟 + 静默常量（wait-detector.md §0 taxonomy / §6 静默）。
//
// 本文件是 M3 等待检测子系统（终端交互等待，主键 terminalId）的类型合同。§0 明确「事件形状
// 此刻冻结（M4a 不得改）」——WaitEvent / WaitEventKind 逐字对齐规格，M4a 编排引擎作第二订阅者
// 消费同一事件流。所有类型 vendor-free（纯 Swift + Foundation），detector 核可纯函数式单测。
//
// 单一时钟纪律（§0）：ts 权威 = native 产生/收包时刻 **epoch ms**（Date.timeIntervalSince1970×1000）。
// hook JSON 不携带 ts——native 在 socket 收包瞬间打戳；进程/静默事件用同一 epoch ms 时钟。全流程
// 单一时钟保 ingest 的间隔/排序/30s 边界运算正确（防秒/毫秒或 wall/monotonic 混算）。
import Foundation

/// 等待事件种类（§0 冻结）。socket 层四 hook（notification/stop/userPromptSubmit/sessionStart）+
/// 进程退出 + 静默 + 用户输入（reset）+ acknowledge（tileClick 清红）。
/// sessionStart 为加性扩展（terminal-session-restore.md 冻结面登记 4 修订授权，2026-07-16 兑现）：
/// 仅锚点采集消费，detector 主链零语义影响（不标 hook 流、不豁免静默兜底）。
public enum WaitEventKind: String, Sendable, Equatable, Hashable {
    case notification       // Layer 0 hook：CC 主动通知 → WaitingInput
    case stop               // Layer 0 hook：回复完成「该你了」→ WaitingInput
    case userPromptSubmit   // Layer 0 hook：粘贴/提交 → Running（清红）
    case sessionStart       // Layer 0 hook：CC 会话启动/resume → 仅锚点采集（detector 零影响）
    case processExit        // 进程兜底：前台进程退出 → 清静默弱信号
    case silence            // 静默兜底：三与门控命中 → 弱 WaitingInput（不计 count）
    case userInput          // PTY 用户写入 reset → 全层清 → Running
    case acknowledge        // tileClick / acknowledgeWaiting → 清红（AUTO_RESUME 等价）
}

/// 冻结事件形状（§0）：`WaitEvent { termId, event, ts, raw }`。M4a 不得改字段。
/// - ts：native epoch ms（唯一时钟，§0）；hook 不带 ts，native 收包打戳。
/// - raw：CC stdin 原始 JSON **文本**（不可信数据，native 从不 eval/解析，仅透传给观察者存证）。
public struct WaitEvent: Sendable, Equatable {
    public let termId: String
    public let event: WaitEventKind
    public let ts: UInt64
    public let raw: String?

    public init(termId: String, event: WaitEventKind, ts: UInt64, raw: String? = nil) {
        self.termId = termId
        self.event = event
        self.ts = ts
        self.raw = raw
    }
}

/// detector 结论态（architecture.md §2 trait 照搬为 Swift enum）。Idle 在 M3 折叠为 Running
/// 快照语义（wait-detector.md §2「Idle→Running」），detector 核只产 running / waitingInput。
public enum WaitState: String, Sendable, Equatable, Hashable {
    case running
    case idle
    case waitingInput
}

/// WaitingInput 的信号来源（决定是否计入 waitingNotification.count，§3/§6）。
/// 强信号（layer0/process）计入 count；静默弱信号不计。
public enum WaitSource: String, Sendable, Equatable, Hashable {
    case layer0
    case process
    case silence

    /// 强信号（计入 count）。静默是「粗糙引导层」弱信号，不计。
    public var isStrong: Bool { self != .silence }
}

/// detector 单次合成结论：显示态 + 来源（running 时来源为 nil）。
public struct WaitConclusion: Sendable, Equatable {
    public let state: WaitState
    public let source: WaitSource?

    public init(state: WaitState, source: WaitSource?) {
        self.state = state
        self.source = source
    }

    /// Running（无等待）。
    public static let running = WaitConclusion(state: .running, source: nil)

    public var isWaiting: Bool { state == .waitingInput }
    /// 计入 count 的等待（强信号等待）。
    public var countsToNotification: Bool { isWaiting && (source?.isStrong ?? false) }
}

/// 静默兜底策略常量（§6）。阈值集中此处，粗糙引导层。
public enum SilencePolicy {
    /// 静默弱信号阈值：前台非 shell + PTY 静默 ≥ 此毫秒 + 无 Layer 0 事件流（§6 三与门控）。
    public static let SILENCE_THRESHOLD_MS: UInt64 = 30_000
}

/// 等待子系统单一时钟（§0）：epoch ms。socket 收包 / 进程 / 静默 / 输出活动全用此，防混算。
public enum WaitClock {
    /// 当前 epoch 毫秒。
    public static func nowMs() -> UInt64 { UInt64((Date().timeIntervalSince1970 * 1000.0).rounded()) }
}
