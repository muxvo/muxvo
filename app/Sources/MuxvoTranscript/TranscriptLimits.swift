// 解析纪律的集中常量（specs/orchestration/jsonl-transcript.md §2）。
// 只此一处定义，解析器/framer/tail 全部引用，改一处即改全局（§2.3「集中常量」要求）。

import Foundation

public enum TranscriptLimits {
    /// 单行上限（§2.1）：超限截断 + parseError，不 crash。默认 10MB。
    /// 测试可经解析器 init 覆盖为小值，避免为走截断路径分配 10MB。
    public static let maxLineBytes = 10 * 1024 * 1024

    /// 同源连续失败阈值（§2.3）：连续失败达此值 → 上报异常信号。默认 20。
    public static let consecutiveFailureThreshold = 20
}

/// CC / Codex 两解析器的共同增量喂入面——文件 tail（FileTailSource）据此驱动，
/// harness 差异被各自 mapper 吸收，输出统一 HarnessEvent。
public protocol HarnessLineParser: Sendable {
    /// 喂入字节块，按 \n 分帧后产出零到多条事件；不完整尾行内部缓冲等续（§2.1）。
    mutating func feed(_ chunk: Data) -> [HarnessEvent]
    /// 同源连续解析失败计数（成功一行即归零）。
    var consecutiveFailures: Int { get }
    /// 连续失败是否已越过阈值（越过即锁存 true，供上层判 worker 异常，§2.3）。
    var thresholdExceeded: Bool { get }
}

public extension HarnessLineParser {
    /// 便捷：按 UTF-8 喂入字符串（测试与 stdout pipe 常用）。
    mutating func feed(_ text: String) -> [HarnessEvent] {
        feed(Data(text.utf8))
    }
}
