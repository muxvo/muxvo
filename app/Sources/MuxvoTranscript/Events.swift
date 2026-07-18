// 输出契约：统一 HarnessEvent 枚举（specs/orchestration/jsonl-transcript.md §3，v1-frozen 于⑭）。
//
// 形状逐字照落规格：case 集、字段名、字段类型不得改（改动走规格修订流程）。
// 全 Sendable 值类型，Swift 6 严格并发下过编译。Equatable/init 为附加能力（不改形状），
// 便于测试用 #expect(events == [...]) 断言，规格冻结的是「消费者面」，加同等值语义不违约。

import Foundation

/// CC / Codex 两种 harness 的行式事件统一输出面（§3）。
public enum HarnessEvent: Sendable, Equatable {
    /// CC: type=system, subtype=init。model 可空（老/未来版本可能不带）。
    case sessionStarted(sessionId: String, model: String?)
    /// 转写主体；usage 挂每条 assistant message（F9，仅 input/output tokens）。
    case assistantText(text: String, usage: Usage?)
    /// 审计摘要——input 原文不进事件值内，只出 digest（§3）。
    case toolUse(name: String, inputDigest: String)
    /// 消费者：转写视图可选展示 + 审计摘要（M4a 转写主用 toolUse；无消费即不推，非死码）。
    case toolResult(summaryDigest: String)
    /// 收口；numTurns=CC result.num_turns 权威（F9）。raw 保原文供审查裁决抽结构化 verdict。
    case result(status: ResultStatus, numTurns: Int?, raw: String)
    /// F2：真形状 type=rate_limit_event；status=allowed 是遥测非等待，判定权在调度器。
    case rateLimit(status: String, resetsAt: Int64?, raw: String)
    /// 白名单外 type / 未枚举 subtype → 保 raw 透传，绝不抛错（§2.2）。
    case unknown(type: String?, raw: String)
    /// 非法 JSON / 超限行 → 计数（§2.3）。count = 同源连续失败计数（达阈值即异常信号）。
    case parseError(count: Int)
}

/// result 事件状态（§3）。
public enum ResultStatus: Sendable, Equatable {
    case success
    case error(kind: String)
}

/// assistant message 用量（§3，F9：无 turns 字段——CC 不带每轮 turn）。
public struct Usage: Sendable, Equatable {
    public let inputTokens: Int?
    public let outputTokens: Int?

    public init(inputTokens: Int?, outputTokens: Int?) {
        self.inputTokens = inputTokens
        self.outputTokens = outputTokens
    }
}
