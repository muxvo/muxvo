// 恢复支撑件单测（terminal-session-restore.md §3 MAJ-3 并发闸 / SEC-m1 取证 / §4 横幅文案）红→绿。
//
// 覆盖 TSR_ 案例：
//   · TSR_resume_concurrency_gated   N(>M) 注入 → 在飞 ≤ M（InjectionThrottle 峰值断言）
//   · TSR_resume_injection_audited   注入 → 落本地取证行 {termId,sessionId,cwd,ts,resumeAttempts}
//   · 横幅文案（cannotRestore / crashLoop）——纯串可测（系统横幅呈现由 bundle 守卫，此处不触）
import Foundation
import Testing
import MuxvoTestSupport
import MuxvoTerm

@testable import MuxvoAppCore

@Suite("恢复支撑件（并发闸 / 取证 / 横幅文案）")
struct SessionRestoreSupportTests {
    /// 采集录制器（@unchecked Sendable：闭包在 deliverOn 队列触发）。
    private final class TrackRecorder: @unchecked Sendable {
        private let lock = NSLock()
        private var ids: [String] = []
        func add(_ id: String) { lock.withLock { ids.append(id) } }
        var collected: [String] { lock.withLock { ids } }
    }

    @Test("M-3：worker 判据未接前 TakeoverOwnershipBox 只排除 takeover——worker/brain 仍 .human（向后兼容）")
    func takeoverOwnershipBoxOnlyExcludesTakeover() {
        // 用**生产**ownership 盒（非合成闭包）：只设接管判据识别 TK；worker 判据未设 → worker/brain 恒 .human。
        let box = TakeoverOwnershipBox()
        box.setTakeoverCheck { $0 == "TK" }
        // 真实生产盒的 ownership 语义直验：
        #expect(box.ownership(of: "TK") == .takeover, "takeover 已接线 → 排除")
        #expect(box.ownership(of: "WK") == .human, "worker 判据未设 → 生产盒返 .human（向后兼容）")
        #expect(box.ownership(of: "BR") == .human, "⚠️ brain 未接线 → 生产盒返 .human（B4 接线义务）")
        #expect(box.ownership(of: "H") == .human, "纯人终端 → human")
    }

    @Test("IW_termtask_binding（B2-0 半）：setWorkerCheck 接实后 worker termId 排除出恢复采集账本（解析序 takeover→worker→human）")
    func workerOwnershipExcludesFromRestore() {
        // B2-0：InteractiveWorkerHost 绑定表接进 setWorkerCheck 后，worker 终端 ownership=.worker → SessionTracker 排除。
        let box = TakeoverOwnershipBox()
        box.setTakeoverCheck { $0 == "TK" }
        box.setWorkerCheck { $0 == "WK" } // 模拟绑定表：WK 是活跃交互式 worker termId
        // 解析序断言：takeover 优先于 worker，worker 优先于 human；判据外均回退 human。
        #expect(box.ownership(of: "TK") == .takeover, "takeover 命中 → .takeover（解析序最高）")
        #expect(box.ownership(of: "WK") == .worker, "worker 判据命中 → .worker（B2-0 接线）")
        #expect(box.ownership(of: "BR") == .human, "brain 未接线 → .human（B4 义务）")
        #expect(box.ownership(of: "H") == .human, "纯人终端 → human")

        // 端到端：真 SessionTracker 用生产盒 → takeover + worker 均被排除，仅 human 入恢复账本（杜绝双恢复）。
        let bus = WaitEventBus()
        let rec = TrackRecorder()
        let q = DispatchQueue(label: "own-box-worker")
        let tracker = SessionTracker(
            bus: bus, deliverOn: q,
            record: { termId, _, _, _, _ in rec.add(termId) },
            remove: { _ in },
            ownershipOf: { box.ownership(of: $0) })
        _ = tracker
        let sid = "11111111-2222-3333-4444-555555555555"
        let raw = "{\"session_id\":\"\(sid)\",\"cwd\":\"/p\",\"transcript_path\":\"/p/t.jsonl\"}"
        for id in ["TK", "WK", "BR", "H"] {
            bus.publish(WaitEvent(termId: id, event: .stop, ts: 1, raw: raw))
        }
        q.sync {}
        #expect(rec.collected.sorted() == ["BR", "H"],
                "worker 判据接实后：TK + WK 均排除，worker termId 不入恢复账本（B2-0 双恢复根治）")
    }

    @Test("TSR_resume_concurrency_gated：N=5 注入、M=2 → 在飞峰值 ≤ M")
    func concurrencyGate() async {
        let throttle = InjectionThrottle(limit: 2)
        await withTaskGroup(of: Void.self) { group in
            for _ in 0..<5 {
                group.addTask {
                    await throttle.run { try? await Task.sleep(nanoseconds: 25_000_000) } // 25ms 重叠窗
                }
            }
        }
        let peak = await throttle.peakConcurrency
        #expect(peak == 2, "在飞 resume 峰值恰 M=2（不同起 5 个 claude --resume）；实测 \(peak)")
    }

    @Test("TSR_resume_injection_audited：注入落本地取证行（SEC-m1，可追溯重启后自动跑了什么）")
    func auditLine() throws {
        try withTempRoot { root in
            let url = root.appendingPathComponent("session-restore-audit.log")
            SessionRestoreAudit.record(
                url: url, termId: "T1", sessionId: "11111111-2222-3333-4444-555555555555",
                cwd: "/proj", tsMs: 1720000000000, resumeAttempts: 2)
            SessionRestoreAudit.record(
                url: url, termId: "T2", sessionId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                cwd: "/w", tsMs: 1720000000001, resumeAttempts: 0)
            let content = try String(contentsOf: url, encoding: .utf8)
            let lines = content.split(separator: "\n").filter { !$0.isEmpty }
            #expect(lines.count == 2, "追加式取证（每注入一行）")
            #expect(content.contains("\"termId\":\"T1\""))
            #expect(content.contains("\"sessionId\":\"11111111-2222-3333-4444-555555555555\""))
            #expect(content.contains("\"cwd\":\"/proj\""))
            #expect(content.contains("\"resumeAttempts\":2"))
            #expect(content.contains("\"ts\":1720000000000"))
            // m-1 回修：取证日志 0600（与 SEC-M2 保护同源 sessionId/cwd 一致）。
            let perms = try FileManager.default.attributesOfItem(atPath: url.path)[.posixPermissions] as? NSNumber
            #expect(perms?.int16Value == 0o600, "取证日志仅属主可读写（m-1）")
        }
    }

    @Test("横幅文案：预检失败 / 熔断（§4）+ 指挥台降级（M4b 台账清账）")
    func bannerBodies() {
        #expect(SessionRestoreBanner.cannotRestoreBody(count: 3) == "3 个会话无法在本机恢复")
        #expect(SessionRestoreBanner.crashLoopBody(count: 2) == "2 个会话反复崩溃，已暂停自动恢复，可手动重开")
        #expect(SessionRestoreBanner.consoleDegradedBody(count: 2)
            == "2 个指挥台已恢复为普通终端（指挥工具不可用），请从「文件 → 新建指挥台」（⌘⇧N）重开")
    }

    @MainActor
    @Test("M-4：授权不可用（hasBundle=false）横幅仍 durable 留痕、绝不静默（§4「不静默」硬承诺）")
    func bannerNotSilentWhenNotificationUnavailable() {
        final class Sink: @unchecked Sendable {
            private let lock = NSLock()
            private var msgs: [String] = []
            func emit(_ m: String) { lock.withLock { msgs.append(m) } }
            var all: [String] { lock.withLock { msgs } }
        }
        let sink = Sink()
        // hasBundle=false 模拟裸可执行/授权不可用：系统通知被跳过，但 emit 仍须留痕。
        let banner = SessionRestoreBanner(hasBundle: false, emit: { sink.emit($0) })
        banner.cannotRestore(count: 2)
        banner.crashLoopPaused(count: 1)
        banner.consoleDegraded(count: 3) // 指挥台降级同「不静默」硬承诺
        banner.cannotRestore(count: 0) // count==0 不留痕
        banner.consoleDegraded(count: 0) // 指挥台 count==0 亦不留痕
        #expect(sink.all.count == 3, "count>0 的横幅事件全部 durable 留痕（不因授权不可用静默丢）")
        #expect(sink.all[0].contains("2 个会话无法在本机恢复"))
        #expect(sink.all[1].contains("反复崩溃，已暂停自动恢复"))
        #expect(sink.all[2].contains("3 个指挥台已恢复为普通终端"))
    }
}
