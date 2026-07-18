// 恢复计划器纯逻辑单测（terminal-session-restore.md §3 join + 逐条过闸）红→绿。
//
// 覆盖 TSR_ 案例：
//   · TSR_join_key_stable_id          按稳定 termId join；旧 config 无 id → best-effort cwd+序，匹配不上退化 M3
//   · TSR_precheck_transcript_missing_skips  transcript 不在盘 → cannotRestore（横幅计数）、不注入
//   · TSR_crash_loop_isolates（集成）  熔断锚点 → isolate 决策、隔离计数
//   · inject 决策携结转 attempts（跨重启累加）
// P-2 fast-follow（TSR_CX_，Codex 自动恢复；旧 TSR_harness_cc_only 守护语义随枚举扩展退役）：
//   · TSR_CX_harness_codex_supported  harness 闸放行 .codex（.cc/.codex 皆过）
//   · TSR_CX_containers_per_harness   per-harness 容器：各查各容器、逃逸/缺文件 → cannotRestore
//   · TSR_CX_rollout_missing_skips    codex rollout 不在盘 → cannotRestore（与 CC 同一恢复时门）
//   · TSR_CX_crash_loop_isolates_codex  熔断对 .codex 锚点同样生效
//   · 旧单容器签名下 .codex 锚点无容器 → cannotRestore（降级行为登记）
import Foundation
import MuxvoTestSupport
import Testing

@testable import MuxvoStorage

@Suite("TerminalRestorePlanner（join + 闸决策）")
struct TerminalRestorePlannerTests {
    private let sid = "11111111-2222-3333-4444-555555555555"
    private func anchor(
        cwd: String = "/proj", transcript: String = "/proj/t.jsonl",
        attempts: Int = 0, lastResumeTs: UInt64? = nil, harness: TerminalHarness = .cc
    ) -> TerminalSessionAnchor {
        TerminalSessionAnchor(
            sessionId: sid, harness: harness, cwd: cwd, transcriptPath: transcript,
            lastActiveTs: 100, resumeAttempts: attempts, lastResumeTs: lastResumeTs)
    }

    @Test("TSR_join_key_stable_id：按稳定 id join；无 id → best-effort cwd+序；匹配不上 → none")
    func joinByStableId() {
        let anchors = ["OLD1": anchor(cwd: "/a"), "OLD2": anchor(cwd: "/b")]
        // 稳定 id join：openTerminals 曾持久化 id=OLD1 → 命中该锚点。
        let plan = TerminalRestorePlanner.plan(
            inputs: [
                .init(newTermId: "NEW1", stableId: "OLD1", cwd: "/a"),
                .init(newTermId: "NEW2", stableId: "OLD2", cwd: "/b"),
                .init(newTermId: "NEW3", stableId: "OLDX", cwd: "/nomatch"), // id 不在锚点 + cwd 不匹配 → none
            ],
            anchors: anchors, container: "/c", nowMs: 1000,
            transcriptPrecheck: { _ in true })
        #expect(plan.entries.count == 3)
        if case .inject = plan.entries[0].decision {} else { Issue.record("NEW1 应 inject") }
        if case .inject = plan.entries[1].decision {} else { Issue.record("NEW2 应 inject") }
        #expect(plan.entries[2].decision == .none, "id/cwd 皆不匹配 → 退化 M3")
    }

    @Test("旧 config 无 id → best-effort **唯一** cwd 匹配才 join（歧义 >1 → M3，M-3 回修防跨会话误 resume）")
    func bestEffortCwdMatch() {
        // 唯一同 cwd 锚点 → join 注入；无匹配 → none。
        let plan1 = TerminalRestorePlanner.plan(
            inputs: [
                .init(newTermId: "NEW1", stableId: nil, cwd: "/a"),
                .init(newTermId: "NEW3", stableId: nil, cwd: "/z"), // 无匹配 cwd → none
            ],
            anchors: ["OLD1": anchor(cwd: "/a")], container: "/c", nowMs: 1000,
            transcriptPrecheck: { _ in true })
        if case .inject = plan1.entries[0].decision {} else { Issue.record("唯一 /a 锚点 → inject") }
        #expect(plan1.entries[1].decision == .none)
        // 歧义（两个同 cwd 锚点）→ 不猜、退化 M3（防误 resume 到错会话）。
        let plan2 = TerminalRestorePlanner.plan(
            inputs: [.init(newTermId: "NEW", stableId: nil, cwd: "/a")],
            anchors: ["OLD1": anchor(cwd: "/a"), "OLD2": anchor(cwd: "/a")],
            container: "/c", nowMs: 1000, transcriptPrecheck: { _ in true })
        #expect(plan2.entries[0].decision == .none, "同 cwd 多锚点歧义 → 不注入退化 M3")
    }

    @Test("M-3：有稳定 id 但未命中 → 绝不降级 cwd 猜测（防跨会话误 resume 放大器）")
    func stableIdMissNeverCwdGuesses() {
        // human 终端持稳定 id H1（其锚点去抖窗丢失，不在盘），同 cwd 只有一个 worker 会话锚点 W1。
        // 旧「未命中 → cwd 兜底」会把 H1 join 到 W1 的 sessionId → 注入他会话 resume。收紧后 → none。
        let workerAnchor = TerminalSessionAnchor(
            sessionId: "99999999-9999-9999-9999-999999999999", harness: .cc,
            cwd: "/shared", transcriptPath: "/shared/w.jsonl", lastActiveTs: 1)
        let plan = TerminalRestorePlanner.plan(
            inputs: [.init(newTermId: "NEW-H1", stableId: "H1", cwd: "/shared")],
            anchors: ["W1": workerAnchor], container: "/c", nowMs: 1000,
            transcriptPrecheck: { _ in true })
        #expect(plan.entries[0].decision == .none, "有 id 未命中 → M3，绝不 cwd-兜底到他会话锚点")
    }

    @Test("TSR_precheck_transcript_missing_skips：transcript 不在盘 → cannotRestore + 横幅计数")
    func precheckMissing() {
        let anchors = ["OLD1": anchor()]
        let plan = TerminalRestorePlanner.plan(
            inputs: [.init(newTermId: "NEW1", stableId: "OLD1", cwd: "/proj")],
            anchors: anchors, container: "/c", nowMs: 1000,
            transcriptPrecheck: { _ in false }) // 预检失败
        if case .cannotRestore = plan.entries[0].decision {} else { Issue.record("应 cannotRestore") }
        #expect(plan.cannotRestoreCount == 1 && plan.crashLoopIsolatedCount == 0)
    }

    @Test("M-1：控制字节 cwd 锚点 → cannotRestore（退化 M3，不注入变形串）")
    func controlByteCwdCannotRestore() {
        let bad = TerminalSessionAnchor(
            sessionId: sid, harness: .cc, cwd: "/proj\r\nmalicious", transcriptPath: "/proj/t.jsonl", lastActiveTs: 1)
        let plan = TerminalRestorePlanner.plan(
            inputs: [.init(newTermId: "N", stableId: "K", cwd: "/proj")],
            anchors: ["K": bad], container: "/c", nowMs: 1,
            transcriptPrecheck: { _ in true })
        if case .cannotRestore = plan.entries[0].decision {} else { Issue.record("控制字节 cwd → cannotRestore") }
        #expect(plan.cannotRestoreCount == 1)
    }

    @Test("三字段损坏（空 sessionId）→ cannotRestore（SEC-M2 复检）")
    func incompleteAnchorSkips() {
        let bad = TerminalSessionAnchor(
            sessionId: "", harness: .cc, cwd: "/p", transcriptPath: "/p/t", lastActiveTs: 1)
        let plan = TerminalRestorePlanner.plan(
            inputs: [.init(newTermId: "N", stableId: "K", cwd: "/p")],
            anchors: ["K": bad], container: "/c", nowMs: 1,
            transcriptPrecheck: { _ in true })
        if case .cannotRestore = plan.entries[0].decision {} else { Issue.record("空 sessionId → cannotRestore") }
    }

    @Test("TSR_crash_loop_isolates（集成）：熔断锚点 → isolate 决策 + 隔离计数；inject 携结转 attempts")
    func crashLoopIsolate() {
        // attempts=2、上次 resume 后窗内又崩（now-last<T=30s）→ n=3≥K → isolate。
        let looping = anchor(attempts: 2, lastResumeTs: 80_000)
        let planIso = TerminalRestorePlanner.plan(
            inputs: [.init(newTermId: "N", stableId: "K", cwd: "/proj")],
            anchors: ["K": looping], container: "/c", nowMs: 100_000,
            transcriptPrecheck: { _ in true })
        if case .isolate = planIso.entries[0].decision {} else { Issue.record("应 isolate") }
        #expect(planIso.crashLoopIsolatedCount == 1)

        // attempts=1、窗内又崩 → n=2<K → inject（seedAttempts=2 结转跨重启累加）。
        let looping2 = anchor(attempts: 1, lastResumeTs: 90_000)
        let planInj = TerminalRestorePlanner.plan(
            inputs: [.init(newTermId: "N", stableId: "K", cwd: "/proj")],
            anchors: ["K": looping2], container: "/c", nowMs: 100_000,
            transcriptPrecheck: { _ in true })
        if case let .inject(_, seedAttempts) = planInj.entries[0].decision {
            #expect(seedAttempts == 2, "结转 attempts 跨重启累加")
        } else { Issue.record("应 inject") }
    }

    // MARK: - P-2 fast-follow（TSR_CX_，Codex 自动恢复）

    @Test("TSR_CX_harness_codex_supported：harness 闸放行 .codex，.codex 锚点全闸过 → inject")
    func codexHarnessSupported() {
        #expect(TerminalRestorePlanner.harnessSupported(.cc))
        #expect(TerminalRestorePlanner.harnessSupported(.codex))
        let plan = TerminalRestorePlanner.plan(
            inputs: [.init(newTermId: "N", stableId: "K", cwd: "/proj")],
            anchors: ["K": anchor(harness: .codex)], containers: [.codex: "/c"], nowMs: 1000,
            transcriptPrecheck: { _, _ in true })
        if case let .inject(a, _) = plan.entries[0].decision {
            #expect(a.harness == .codex)
        } else { Issue.record(".codex 锚点全闸过 → 应 inject") }
    }

    @Test("TSR_CX_containers_per_harness：各 harness 查各容器（真 I/O）；缺文件/逃逸本 harness 容器 → cannotRestore")
    func containersPerHarness() throws {
        try withTempRoot { root in
            let fm = FileManager.default
            let ccDir = root.appendingPathComponent(".claude/projects", isDirectory: true)
            let cxDir = root.appendingPathComponent(".codex/sessions/2026/07/14", isDirectory: true)
            try fm.createDirectory(at: ccDir, withIntermediateDirectories: true)
            try fm.createDirectory(at: cxDir, withIntermediateDirectories: true)
            let ccT = ccDir.appendingPathComponent("t.jsonl")
            let cxR = cxDir.appendingPathComponent("rollout-x.jsonl")
            try Data("x".utf8).write(to: ccT)
            try Data("y".utf8).write(to: cxR)
            let containers: [TerminalHarness: String] = [
                .cc: root.appendingPathComponent(".claude").path,
                .codex: root.appendingPathComponent(".codex/sessions").path,
            ]
            let anchors = [
                "A": anchor(transcript: ccT.path),                                  // cc→cc 容器内 → inject
                "B": anchor(transcript: cxR.path, harness: .codex),                 // codex→codex 容器内 → inject
                "C": anchor(transcript: ccT.path, harness: .codex),                 // codex 锚点指 cc 容器文件 → 逃逸本 harness 容器
                "D": anchor(transcript: cxDir.appendingPathComponent("nope.jsonl").path, harness: .codex), // 缺文件
            ]
            let plan = TerminalRestorePlanner.plan(
                inputs: [
                    .init(newTermId: "NA", stableId: "A", cwd: "/proj"),
                    .init(newTermId: "NB", stableId: "B", cwd: "/proj"),
                    .init(newTermId: "NC", stableId: "C", cwd: "/proj"),
                    .init(newTermId: "ND", stableId: "D", cwd: "/proj"),
                ],
                anchors: anchors, containers: containers, nowMs: 1000)
            if case .inject = plan.entries[0].decision {} else { Issue.record("cc 容器内 transcript → inject") }
            if case .inject = plan.entries[1].decision {} else { Issue.record("codex 容器内 rollout → inject") }
            if case .cannotRestore = plan.entries[2].decision {} else {
                Issue.record("codex 锚点 transcript 落 cc 容器 → 逃逸本 harness 容器 → cannotRestore")
            }
            if case .cannotRestore = plan.entries[3].decision {} else {
                Issue.record("TSR_CX_rollout_missing_skips：rollout 缺失 → cannotRestore")
            }
            #expect(plan.cannotRestoreCount == 2)
        }
    }

    @Test("TSR_CX_crash_loop_isolates_codex：熔断对 .codex 锚点同样生效（复用同一判据）")
    func crashLoopIsolatesCodex() {
        let looping = anchor(attempts: 2, lastResumeTs: 80_000, harness: .codex)
        let plan = TerminalRestorePlanner.plan(
            inputs: [.init(newTermId: "N", stableId: "K", cwd: "/proj")],
            anchors: ["K": looping], containers: [.codex: "/c"], nowMs: 100_000,
            transcriptPrecheck: { _, _ in true })
        if case .isolate = plan.entries[0].decision {} else { Issue.record(".codex 熔断 → isolate") }
        #expect(plan.crashLoopIsolatedCount == 1)
    }

    @Test("旧单容器签名下 .codex 锚点无容器 → cannotRestore（降级行为登记，防半接线注入）")
    func legacySignatureCodexDegrades() {
        let plan = TerminalRestorePlanner.plan(
            inputs: [.init(newTermId: "N", stableId: "K", cwd: "/proj")],
            anchors: ["K": anchor(harness: .codex)], container: "/c", nowMs: 1000)
        if case .cannotRestore = plan.entries[0].decision {} else {
            Issue.record("旧签名（[.cc: container]）对 .codex 锚点无容器 → 预检失败 cannotRestore")
        }
    }
}
