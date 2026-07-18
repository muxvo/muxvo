// 终端会话恢复计划器（terminal-session-restore.md §3）：join 锚点 + 逐条过闸 → 纯决策（可单测）。
//
// 输入 = 已 spawn 的终端（新 termId + openTerminals 持久化的稳定 id + cwd）+ 锚点 map（store 读盘）。
// join：稳定 id 命中 → 用该锚点；旧 config 无 id → best-effort cwd+顺序匹配（匹配不上退化 M3）。
// 过闸（任一不过 → 退化 M3，不注入）：三字段复检（SEC-M2）→ transcript 预检（SEC-M1，per-harness 容器：
// .cc=~/.claude、.codex=~/.codex/sessions）→ harness 支持闸 → crash-loop 熔断（MAJ-2）。决策交执行层
// （seed 锚点/注入/横幅计数），本计划器纯函数无副作用。
import Foundation

public enum TerminalRestorePlanner {
    /// 一个已 spawn 终端的 join 输入。
    public struct JoinInput: Sendable, Equatable {
        public let newTermId: String
        public let stableId: String? // openTerminals 持久化 id（nil = 旧 config 无 id）
        public let cwd: String
        public init(newTermId: String, stableId: String?, cwd: String) {
            self.newTermId = newTermId
            self.stableId = stableId
            self.cwd = cwd
        }
    }

    /// 逐终端决策。
    public enum Decision: Equatable, Sendable {
        /// 全闸过 → 注入。seedAttempts = crash-loop 结转计数（跨重启累加，执行层 seed 到新 termId + 打 lastResumeTs）。
        case inject(anchor: TerminalSessionAnchor, seedAttempts: Int)
        /// crash-loop 熔断 → 隔离（不注入）；执行层结转锚点保隔离态 + 横幅计数。
        case isolate(anchor: TerminalSessionAnchor)
        /// 三字段损坏 / transcript 预检失败 / 非 .cc → 退化 M3 + 横幅「无法在本机恢复」计数。
        case cannotRestore(anchor: TerminalSessionAnchor)
        /// 无锚点 join（无 id/cwd 匹配或本就无锚点）→ 纯 M3，无横幅。
        case none
    }

    public struct PlanEntry: Sendable {
        public let newTermId: String
        public let decision: Decision
    }

    public struct Plan: Sendable {
        public let entries: [PlanEntry]
        public let cannotRestoreCount: Int
        public let crashLoopIsolatedCount: Int
    }

    /// 计算恢复计划（per-harness 容器版，P-2 fast-follow）。
    /// - Parameter containers: 各 harness 的 transcript 容器（.cc=~/.claude 或隔离 configDir、
    ///   .codex=~/.codex/sessions）；锚点 harness 无对应容器 → 预检失败（cannotRestore，退化 M3）。
    /// - Parameter transcriptPrecheck: transcript 存在+容器校验注入缝（默认真 I/O = TerminalRestoreGate.transcriptPrecheckPasses；测试注入确定谓词）。
    public static func plan(
        inputs: [JoinInput],
        anchors: [String: TerminalSessionAnchor],
        containers: [TerminalHarness: String],
        nowMs: UInt64,
        thresholdK: Int = TerminalRestoreGate.crashLoopThresholdK,
        windowMs: UInt64 = TerminalRestoreGate.crashLoopWindowMs,
        transcriptPrecheck: ((String, TerminalHarness) -> Bool)? = nil
    ) -> Plan {
        let precheck = transcriptPrecheck ?? { path, harness in
            guard let container = containers[harness] else { return false }
            return TerminalRestoreGate.transcriptPrecheckPasses(rawPath: path, container: container)
        }
        var remaining = anchors // 消费池（同锚点不被两输入重复消费）
        var entries: [PlanEntry] = []
        var cannotRestore = 0
        var isolated = 0

        for input in inputs {
            guard let (key, anchor) = joinAnchor(input, from: remaining) else {
                entries.append(PlanEntry(newTermId: input.newTermId, decision: .none))
                continue
            }
            remaining.removeValue(forKey: key) // 消费该锚点

            // 三字段复检（SEC-M2）+ harness 支持闸（§3）+ cwd 无控制字节（M-1：控制字节 cwd 退化 M3 不注入变形串）。
            guard TerminalRestoreGate.anchorComplete(anchor), harnessSupported(anchor.harness),
                  !TerminalRestoreGate.cwdHasControlBytes(anchor.cwd) else {
                entries.append(PlanEntry(newTermId: input.newTermId, decision: .cannotRestore(anchor: anchor)))
                cannotRestore += 1
                continue
            }
            // transcript 预检（SEC-M1，唯一「文件存在」硬闸；per-harness 容器）。
            guard precheck(anchor.transcriptPath, anchor.harness) else {
                entries.append(PlanEntry(newTermId: input.newTermId, decision: .cannotRestore(anchor: anchor)))
                cannotRestore += 1
                continue
            }
            // crash-loop 熔断（MAJ-2）。
            let verdict = TerminalRestoreGate.crashLoopVerdict(
                resumeAttempts: anchor.resumeAttempts, lastResumeTs: anchor.lastResumeTs,
                nowMs: nowMs, thresholdK: thresholdK, windowMs: windowMs)
            if verdict.isolate {
                entries.append(PlanEntry(newTermId: input.newTermId, decision: .isolate(anchor: anchor)))
                isolated += 1
            } else {
                entries.append(PlanEntry(
                    newTermId: input.newTermId,
                    decision: .inject(anchor: anchor, seedAttempts: verdict.newAttempts)))
            }
        }
        return Plan(entries: entries, cannotRestoreCount: cannotRestore, crashLoopIsolatedCount: isolated)
    }

    /// harness 支持闸（§3；P-2 fast-follow 后 .cc/.codex 皆放行）。保留函数作未来新 harness 的收窄位——
    /// 枚举扩了但恢复链未接好前，在此挡下防半接线注入。
    public static func harnessSupported(_ h: TerminalHarness) -> Bool { h == .cc || h == .codex }

    /// 旧签名（单容器 =.cc，既有调用零改）：转发 per-harness 版；.codex 锚点在此签名下无容器 → 预检失败。
    public static func plan(
        inputs: [JoinInput],
        anchors: [String: TerminalSessionAnchor],
        container: String,
        nowMs: UInt64,
        thresholdK: Int = TerminalRestoreGate.crashLoopThresholdK,
        windowMs: UInt64 = TerminalRestoreGate.crashLoopWindowMs,
        transcriptPrecheck: ((String) -> Bool)? = nil
    ) -> Plan {
        plan(
            inputs: inputs, anchors: anchors, containers: [.cc: container], nowMs: nowMs,
            thresholdK: thresholdK, windowMs: windowMs,
            transcriptPrecheck: transcriptPrecheck.map { f in { path, _ in f(path) } })
    }

    /// join（M-3 回修：收紧防跨会话误 resume）：
    ///  - 有稳定 id → **精确 join**；未命中即 nil，**绝不降级到 cwd 猜测**（防：锚点在去抖窗丢失的 human 终端
    ///    被同 cwd 的 worker/他会话锚点 cwd-兜底 join → 注入他会话 sessionId 的跨会话误 resume 放大器）。
    ///  - 无稳定 id（旧 config）→ best-effort，**仅当唯一未消费同 cwd 锚点**才 join；0 或 >1（歧义）→ nil 退化 M3
    ///    （不猜——歧义下宁可不恢复，也不误 resume 到错会话）。
    private static func joinAnchor(
        _ input: JoinInput, from pool: [String: TerminalSessionAnchor]
    ) -> (key: String, anchor: TerminalSessionAnchor)? {
        if let id = input.stableId {
            if let a = pool[id] { return (id, a) }
            return nil // 有 id 但未命中 → 不降级 cwd 猜测
        }
        let candidates = pool.filter { $0.value.cwd == input.cwd }.keys
        guard candidates.count == 1, let key = candidates.first else { return nil } // 歧义/无 → 不猜
        return (key, pool[key]!)
    }
}
