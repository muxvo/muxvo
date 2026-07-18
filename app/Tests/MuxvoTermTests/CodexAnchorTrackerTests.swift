// CodexAnchorTracker 单测（terminal-session-restore.md §1.5，P-2 fast-follow r3）红→绿。
//
// 覆盖 TSR_CX_ 案例（纯状态机，全注入闭包，无真 fs/exec）：
//   · TSR_CX_bind_unique_candidate      前台 codex + 恰 1 cwd 匹配候选 → 绑定 record
//   · TSR_CX_bind_ambiguous_skips       候选 ≥2（同 cwd 撞窗）→ 保守跳过、留 pending
//   · TSR_CX_bind_no_candidate_retries  候选 0 → 留 pending，窗起点不重置（重试用同一 since）
//   · TSR_CX_two_terminals_same_cwd_skip 两 pending 终端同 cwd 抢同批候选 → 双双不绑
//   · TSR_CX_clear_on_confirmed_exit    连续 2 次确认非 codex → clearIfCodex、回 idle
//   · TSR_CX_probe_unknown_no_clear     unknown 不计清除数、不清已有计数
//   · TSR_CX_no_collect_nonhuman        worker/takeover/brain 终端不进观察集
//   · TSR_CX_rebind_after_restart       退出清锚 → 再起 codex → 重新 pendingBind 绑新会话
//   · TSR_CX_scan_only_when_pending     idle/bound 态 listCandidates 调用计数为 0
//   · TSR_CX_lastActiveTs_touch_throttled bound 态 touch 60s 节流
import Foundation
import Testing

@testable import MuxvoTerm

@Suite("CodexAnchorTracker（Codex 锚点采集状态机，§1.5）")
struct CodexAnchorTrackerTests {
    /// 副作用录制器。
    final class Spy: @unchecked Sendable {
        private let lock = NSLock()
        struct Rec: Equatable { let termId, sessionId, cwd, rollout: String; let ts: UInt64 }
        struct Clr: Equatable { let termId, sessionId: String }
        private var _records: [Rec] = []
        private var _clears: [Clr] = []
        var candidates: [RolloutCandidate] = []
        var ownership: [String: TerminalOwnership] = [:]
        func record(_ t: String, _ s: String, _ c: String, _ r: String, _ ts: UInt64) {
            lock.withLock { _records.append(Rec(termId: t, sessionId: s, cwd: c, rollout: r, ts: ts)) }
        }
        func clear(_ t: String, _ s: String) { lock.withLock { _clears.append(Clr(termId: t, sessionId: s)) } }
        var records: [Rec] { lock.withLock { _records } }
        var clears: [Clr] { lock.withLock { _clears } }
    }

    private func makeTracker(_ spy: Spy) -> CodexAnchorTracker {
        CodexAnchorTracker(
            record: { spy.record($0, $1, $2, $3, $4) },
            clearIfCodex: { spy.clear($0, $1) },
            listCandidates: { _, _ in spy.candidates },
            ownershipOf: { spy.ownership[$0] ?? .human })
    }

    // codex 前台（node 包装形态，命令行含 codex token）。
    private let codexFg = ForegroundProbe.ForegroundState.running(
        name: "node", command: "node /Users/x/.nvm/versions/node/v22/bin/codex exec")
    private let shellFg = ForegroundProbe.ForegroundState.idle
    private let unknownFg = ForegroundProbe.ForegroundState.unknown

    private func obs(_ termId: String, cwd: String = "/proj", _ fg: ForegroundProbe.ForegroundState) -> CodexTermObservation {
        CodexTermObservation(termId: termId, cwd: cwd, foreground: fg)
    }
    private func cand(_ sid: String, cwd: String = "/proj", mtime: UInt64 = 100) -> RolloutCandidate {
        RolloutCandidate(sessionId: sid, cwd: cwd, rolloutPath: "\(cwd)/rollout-\(sid).jsonl", mtimeMs: mtime)
    }
    private let sid1 = "019f5c1a-2c34-7b80-a606-a9c7017a6470"
    private let sid2 = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"

    @Test("TSR_CX_bind_unique_candidate：前台 codex + 恰 1 cwd 匹配候选 → 绑定 record（harness=.codex 由 store 侧）")
    func bindUnique() {
        let spy = Spy(); let t = makeTracker(spy)
        spy.candidates = [cand(sid1)]
        t.poll(observations: [obs("T", codexFg)], nowMs: 10_000)
        #expect(spy.records.count == 1)
        #expect(spy.records[0] == .init(termId: "T", sessionId: sid1, cwd: "/proj",
                                        rollout: "/proj/rollout-\(sid1).jsonl", ts: 10_000))
    }

    @Test("TSR_CX_bind_unique_candidate（/private 别名）：codex 记 realpath /private/tmp、终端 OSC7 /tmp → 归一匹配")
    func bindPrivateAlias() {
        let spy = Spy(); let t = makeTracker(spy)
        spy.candidates = [cand(sid1, cwd: "/private/tmp")]
        t.poll(observations: [obs("T", cwd: "/tmp", codexFg)], nowMs: 1)
        #expect(spy.records.count == 1, "/tmp ↔ /private/tmp 归一等价 → 绑定")
    }

    @Test("TSR_CX_bind_ambiguous_skips：候选 ≥2（同 cwd 撞窗）→ 不绑、留 pending")
    func bindAmbiguousSkips() {
        let spy = Spy(); let t = makeTracker(spy)
        spy.candidates = [cand(sid1), cand(sid2)]
        t.poll(observations: [obs("T", codexFg)], nowMs: 1)
        #expect(spy.records.isEmpty, "同 cwd 两候选歧义 → 保守跳过")
        // 收敛：其中一个候选消失（另一终端 rollout 已被别处绑）→ 唯一 → 绑。
        spy.candidates = [cand(sid1)]
        t.poll(observations: [obs("T", codexFg)], nowMs: 2)
        #expect(spy.records.count == 1, "歧义消解后绑定")
    }

    @Test("TSR_CX_bind_no_candidate_retries：候选 0（rollout 晚落盘）→ 留 pending，下轮出现即绑")
    func bindNoCandidateRetries() {
        let spy = Spy(); let t = makeTracker(spy)
        spy.candidates = []
        t.poll(observations: [obs("T", codexFg)], nowMs: 1)
        #expect(spy.records.isEmpty)
        spy.candidates = [cand(sid1)]
        t.poll(observations: [obs("T", codexFg)], nowMs: 2)
        #expect(spy.records.count == 1, "rollout 晚落盘，重试轮绑定")
    }

    @Test("TSR_CX_two_terminals_same_cwd_skip：两 pending 终端同 cwd 抢同批候选 → 双双不绑")
    func twoTerminalsSameCwdSkip() {
        let spy = Spy(); let t = makeTracker(spy)
        // 两终端同 cwd，各起 codex，两 rollout 候选同 cwd → 每终端都看到 ≥2 → 都不绑。
        spy.candidates = [cand(sid1), cand(sid2)]
        t.poll(observations: [obs("T1", codexFg), obs("T2", codexFg)], nowMs: 1)
        #expect(spy.records.isEmpty, "同 cwd 双终端双候选 → 双双不绑（歧义）")
    }

    @Test("TSR_CX_clear_on_confirmed_exit：连续 2 次确认非 codex → clearIfCodex、回 idle（hysteresis）")
    func clearOnConfirmedExit() {
        let spy = Spy(); let t = makeTracker(spy)
        spy.candidates = [cand(sid1)]
        t.poll(observations: [obs("T", codexFg)], nowMs: 1) // bound
        #expect(spy.records.count == 1)
        t.poll(observations: [obs("T", shellFg)], nowMs: 2) // 第 1 次确认非 codex → 不清
        #expect(spy.clears.isEmpty, "单次确认非 codex 不清（hysteresis）")
        t.poll(observations: [obs("T", shellFg)], nowMs: 3) // 第 2 次 → 清
        #expect(spy.clears == [.init(termId: "T", sessionId: sid1)])
    }

    @Test("TSR_CX_probe_unknown_no_clear：unknown 不计清除数、不清已有 streak")
    func unknownNoClear() {
        let spy = Spy(); let t = makeTracker(spy)
        spy.candidates = [cand(sid1)]
        t.poll(observations: [obs("T", codexFg)], nowMs: 1) // bound
        t.poll(observations: [obs("T", shellFg)], nowMs: 2) // streak=1
        t.poll(observations: [obs("T", unknownFg)], nowMs: 3) // unknown 不计、不清零
        #expect(spy.clears.isEmpty)
        t.poll(observations: [obs("T", shellFg)], nowMs: 4) // streak=2 → 清
        #expect(spy.clears.count == 1, "unknown 跳过后再一次确认非 codex 才达阈值")
    }

    @Test("TSR_CX_no_collect_nonhuman：worker/takeover/brain 终端不进观察集（ownership 过滤）")
    func noCollectNonHuman() {
        let spy = Spy(); let t = makeTracker(spy)
        spy.candidates = [cand(sid1)]
        spy.ownership = ["TW": .worker, "TT": .takeover, "TB": .brain]
        t.poll(observations: [obs("TW", codexFg), obs("TT", codexFg), obs("TB", codexFg)], nowMs: 1)
        #expect(spy.records.isEmpty, "非 human 终端不采集（防双恢复）")
    }

    @Test("TSR_CX_rebind_after_restart：退出清锚 → 再起 codex → 重新 pendingBind 绑新会话")
    func rebindAfterRestart() {
        let spy = Spy(); let t = makeTracker(spy)
        spy.candidates = [cand(sid1)]
        t.poll(observations: [obs("T", codexFg)], nowMs: 1) // bound sid1
        t.poll(observations: [obs("T", shellFg)], nowMs: 2)
        t.poll(observations: [obs("T", shellFg)], nowMs: 3) // 清 sid1、回 idle
        #expect(spy.clears.count == 1)
        // 同终端再起 codex（换了新会话 sid2）→ 重新绑。
        spy.candidates = [cand(sid2)]
        t.poll(observations: [obs("T", codexFg)], nowMs: 4)
        #expect(spy.records.last?.sessionId == sid2, "重启后重绑新会话")
    }

    @Test("TSR_CX_scan_only_when_pending：idle/bound 态 listCandidates 调用计数为 0（严禁全量扫的行为断言）")
    func scanOnlyWhenPending() {
        let spy = Spy(); let t = makeTracker(spy)
        // idle 态（前台非 codex）：不扫。
        t.poll(observations: [obs("T", shellFg)], nowMs: 1)
        #expect(t.scanCalls == 0, "idle 态零扫")
        // pending → 绑定：pending 期扫（此处 1 次即绑）。
        spy.candidates = [cand(sid1)]
        t.poll(observations: [obs("T", codexFg)], nowMs: 2)
        let afterBind = t.scanCalls
        #expect(afterBind >= 1, "pending 态才扫")
        // bound 态：前台仍 codex，但不再扫（已绑）。
        t.poll(observations: [obs("T", codexFg)], nowMs: 3)
        t.poll(observations: [obs("T", codexFg)], nowMs: 4)
        #expect(t.scanCalls == afterBind, "bound 态零扫")
    }

    @Test("TSR_CX_lastActiveTs_touch_throttled：bound 态 touch lastActiveTs 60s 节流")
    func touchThrottled() {
        let spy = Spy(); let t = makeTracker(spy)
        spy.candidates = [cand(sid1)]
        t.poll(observations: [obs("T", codexFg)], nowMs: 1) // bound（record #1）
        t.poll(observations: [obs("T", codexFg)], nowMs: 30_000) // <60s → 不 touch
        #expect(spy.records.count == 1, "60s 内不重复 touch")
        t.poll(observations: [obs("T", codexFg)], nowMs: 61_001) // ≥60s → touch（record #2）
        #expect(spy.records.count == 2, "过 60s 节流窗 → touch lastActiveTs")
        #expect(spy.records.last?.ts == 61_001)
    }

    @Test("shouldScan / commandIsCodex / pathsEquivalent 纯判据")
    func pureJudges() {
        #expect(CodexAnchorTracker.shouldScan(tick: 0))
        #expect(CodexAnchorTracker.shouldScan(tick: 19))
        #expect(!CodexAnchorTracker.shouldScan(tick: 21), "退避：21 tick 非 5 倍数不扫")
        #expect(CodexAnchorTracker.shouldScan(tick: 25), "5 倍数扫")
        // commandIsCodex：node 包装 + 原生 + 负例。
        #expect(ForegroundProbe.commandIsCodex("node /x/bin/codex exec"))
        #expect(ForegroundProbe.commandIsCodex("codex"))
        #expect(ForegroundProbe.commandIsCodex("/usr/local/bin/codex resume abc"))
        #expect(!ForegroundProbe.commandIsCodex("vim codex.md"), "token basename=codex.md ≠ codex，不误判")
        #expect(!ForegroundProbe.commandIsCodex("node server.js"))
        // pathsEquivalent。
        #expect(CodexAnchorTracker.pathsEquivalent("/tmp", "/private/tmp"))
        #expect(CodexAnchorTracker.pathsEquivalent("/proj/", "/proj"))
        #expect(!CodexAnchorTracker.pathsEquivalent("/a", "/b"))
    }

    @Test("ForegroundProbe.parseCommAndArgs：真实 ps 输出形状解析（node 包装 / 原生 / login shell / 空）")
    func parseCommAndArgs() {
        // npm node 包装（用户实测形态）：comm=node、argv 含 codex token → running(node) 且 commandIsCodex。
        let node = ForegroundProbe.parseCommAndArgs("node node /Users/x/.nvm/versions/node/v22/bin/codex exec")
        #expect(node?.name == "node")
        #expect(node.map { ForegroundProbe.commandIsCodex($0.command) } == true, "node 包装 argv 认出 codex")
        // 原生二进制：comm 全路径 → basename=codex。
        let native = ForegroundProbe.parseCommAndArgs("/opt/homebrew/bin/codex /opt/homebrew/bin/codex resume abc")
        #expect(native?.name == "codex")
        #expect(native.map { ForegroundProbe.commandIsCodex($0.command) } == true)
        // login shell：comm=-zsh（前缀 -）非 shell 判定用 basename。
        let shell = ForegroundProbe.parseCommAndArgs("-zsh -zsh")
        #expect(shell?.name == "-zsh")
        #expect(ForegroundProbe.isNonShellName(shell!.name) == false, "-zsh 属 shell 集")
        // 非 codex 命令不误判。
        let vim = ForegroundProbe.parseCommAndArgs("vim vim codex.md")
        #expect(vim.map { ForegroundProbe.commandIsCodex($0.command) } == false, "vim codex.md 不误判为 codex")
        // 空输出（子进程恰退出）→ nil。
        #expect(ForegroundProbe.parseCommAndArgs("   \n ") == nil)
    }
}
