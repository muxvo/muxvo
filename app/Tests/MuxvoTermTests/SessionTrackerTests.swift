// SessionTracker 单测（terminal-session-restore.md §1，第三 WaitEventBus 订阅者）红→绿。
//
// 覆盖 TSR_ 案例：
//   · TSR_anchor_from_hook          三 hook raw 解析 session_id/cwd/transcript_path → record（ts=event.ts）
//   · TSR_anchor_from_sessionstart  SessionStart 事件同样登记锚点（登记 4 兑现：resume 未再对话也有锚）
//   · TSR_anchor_parse_failopen     raw=nil/非法 JSON/缺 session_id → 不产锚点、不抛错、detector 主链零影响
//   · TSR_anchor_latest_wins        同 termId 后到新 sessionId 覆盖旧（tracker+真 store 集成）
//   · TSR_clear_on_process_exit     processExit → remove
//   · TSR_clear_on_user_close       用户关终端/移除 → terminalRemoved → remove
//   · TSR_no_double_restore_takeover ownership≠human（takeover/worker/brain）→ 不采集（防双恢复）
import Darwin
import Foundation
import Testing
import MuxvoKit
@testable import MuxvoTerm

@Suite("SessionTracker（锚点采集，§1）")
struct SessionTrackerTests {
    /// record/remove 调用录制器（@unchecked Sendable：闭包在 deliverOn 队列触发）。
    final class Spy: @unchecked Sendable {
        private let lock = NSLock()
        struct Rec: Equatable { let termId, sessionId, cwd, transcript: String; let ts: UInt64 }
        private var _records: [Rec] = []
        private var _removed: [String] = []
        func record(_ t: String, _ s: String, _ c: String, _ tr: String, _ ts: UInt64) {
            lock.withLock { _records.append(Rec(termId: t, sessionId: s, cwd: c, transcript: tr, ts: ts)) }
        }
        func remove(_ t: String) { lock.withLock { _removed.append(t) } }
        var records: [Rec] { lock.withLock { _records } }
        var removed: [String] { lock.withLock { _removed } }
    }

    final class Counter: @unchecked Sendable {
        private let lock = NSLock()
        private var n = 0
        func bump() { lock.withLock { n += 1 } }
        var value: Int { lock.withLock { n } }
    }

    private func rawJSON(sessionId: String, cwd: String, transcript: String) -> String {
        "{\"session_id\":\"\(sessionId)\",\"cwd\":\"\(cwd)\",\"transcript_path\":\"\(transcript)\",\"hook_event_name\":\"Stop\"}"
    }

    /// 建 tracker + 发事件 + 同步屏障 flush（serial 队列：publish 的 async 块在 sync 前已跑完）。
    private func makeTracker(
        bus: WaitEventBus, spy: Spy, queue: DispatchQueue,
        ownershipOf: @escaping @Sendable (String) -> TerminalOwnership = { _ in .human }
    ) -> SessionTracker {
        SessionTracker(
            bus: bus, deliverOn: queue,
            record: { spy.record($0, $1, $2, $3, $4) },
            remove: { spy.remove($0) },
            ownershipOf: ownershipOf)
    }

    @Test("TSR_anchor_from_hook：三 hook raw 解析三字段 → record，ts=event.ts")
    func anchorFromHook() {
        let bus = WaitEventBus()
        let spy = Spy()
        let q = DispatchQueue(label: "t")
        let tracker = makeTracker(bus: bus, spy: spy, queue: q)
        _ = tracker
        let sid = "11111111-2222-3333-4444-555555555555"
        for (i, kind) in [WaitEventKind.notification, .stop, .userPromptSubmit].enumerated() {
            bus.publish(WaitEvent(
                termId: "T1", event: kind, ts: UInt64(1000 + i),
                raw: rawJSON(sessionId: sid, cwd: "/proj", transcript: "/proj/t.jsonl")))
        }
        q.sync {}
        #expect(spy.records.count == 3)
        #expect(spy.records.allSatisfy { $0.sessionId == sid && $0.cwd == "/proj" && $0.transcript == "/proj/t.jsonl" })
        #expect(spy.records.map(\.ts) == [1000, 1001, 1002], "ts 取 event.ts")
    }

    @Test("TSR_anchor_from_sessionstart：SessionStart 事件 → record（resume 未再对话的会话也有锚，登记 4）")
    func anchorFromSessionStart() {
        let bus = WaitEventBus()
        let spy = Spy()
        let q = DispatchQueue(label: "t-ss")
        let tracker = makeTracker(bus: bus, spy: spy, queue: q)
        _ = tracker
        let sid = "77f79f11-2442-4983-a8c9-fda405fd8c81"
        bus.publish(WaitEvent(
            termId: "T-ss", event: .sessionStart, ts: 2000,
            raw: rawJSON(sessionId: sid, cwd: "/wt8", transcript: "/wt8/t.jsonl")))
        q.sync {}
        #expect(spy.records.count == 1, "SessionStart 即锚定（真机案例：resume 后零对话的会话此前无锚不可恢复）")
        #expect(spy.records.first == Spy.Rec(termId: "T-ss", sessionId: sid, cwd: "/wt8", transcript: "/wt8/t.jsonl", ts: 2000))
        // ownership 过滤对 SessionStart 同样生效（防双恢复，§1 found B-2）。
        let spy2 = Spy()
        let q2 = DispatchQueue(label: "t-ss2")
        let tracker2 = makeTracker(bus: bus, spy: spy2, queue: q2, ownershipOf: { _ in .worker })
        _ = tracker2
        bus.publish(WaitEvent(
            termId: "T-w", event: .sessionStart, ts: 2001,
            raw: rawJSON(sessionId: sid, cwd: "/wt8", transcript: "/wt8/t.jsonl")))
        q2.sync {}
        #expect(spy2.records.isEmpty, "非 human 终端 SessionStart 不采集")
    }

    @Test("TSR_anchor_parse_failopen：raw=nil/非法 JSON/缺 session_id → 不产锚点、不抛错")
    func parseFailOpen() {
        // 纯解析函数直验（fail-open 判据）。
        #expect(SessionTracker.parseAnchorFields(raw: nil) == nil)
        #expect(SessionTracker.parseAnchorFields(raw: "not json{{") == nil)
        #expect(SessionTracker.parseAnchorFields(raw: "{\"cwd\":\"/p\"}") == nil, "缺 session_id → fail-open")
        #expect(SessionTracker.parseAnchorFields(raw: "{\"session_id\":\"\"}") == nil, "空 session_id → fail-open")
        // 有 session_id、缺 cwd/transcript → 仍产锚点（无条件登记，cwd/transcript 空由恢复层复检退化）。
        let f = SessionTracker.parseAnchorFields(raw: "{\"session_id\":\"abc\"}")
        #expect(f?.sessionId == "abc" && f?.cwd == "" && f?.transcript == "")
        // 端到端：坏 raw 事件不触 record，且 bus 其他订阅者照收（主链零影响）。
        let bus = WaitEventBus()
        let spy = Spy()
        let q = DispatchQueue(label: "t2")
        let tracker = makeTracker(bus: bus, spy: spy, queue: q)
        _ = tracker
        let otherSaw = Counter()
        let q2 = DispatchQueue(label: "other")
        bus.subscribe(deliverOn: q2) { _ in otherSaw.bump() }
        bus.publish(WaitEvent(termId: "T", event: .stop, ts: 1, raw: "garbage{"))
        q.sync {}; q2.sync {}
        #expect(spy.records.isEmpty, "坏 raw → 无锚点")
        #expect(otherSaw.value == 1, "detector 主链（其他订阅者）照收，零影响")
    }

    @Test("TSR_anchor_latest_wins：同 termId 后到新 sessionId 覆盖旧（覆盖语义由末次 record 落定）")
    func latestWins() {
        // 用本地「末写胜」假 store（真 store 覆盖已在 MuxvoStorageTests 验）——此处验 tracker 逐事件转发
        // 且末次覆盖前次（同 termId key）。
        final class LatestStore: @unchecked Sendable {
            private let lock = NSLock()
            private var map: [String: String] = [:]
            func put(_ termId: String, _ sessionId: String) { lock.withLock { map[termId] = sessionId } }
            func get(_ termId: String) -> String? { lock.withLock { map[termId] } }
        }
        let store = LatestStore()
        let bus = WaitEventBus()
        let q = DispatchQueue(label: "t3")
        let tracker = SessionTracker(
            bus: bus, deliverOn: q,
            record: { termId, sessionId, _, _, _ in store.put(termId, sessionId) },
            remove: { _ in })
        _ = tracker
        let old = "11111111-1111-1111-1111-111111111111"
        let new = "22222222-2222-2222-2222-222222222222"
        bus.publish(WaitEvent(termId: "T", event: .stop, ts: 1,
            raw: rawJSON(sessionId: old, cwd: "/p", transcript: "/p/a.jsonl")))
        bus.publish(WaitEvent(termId: "T", event: .stop, ts: 2,
            raw: rawJSON(sessionId: new, cwd: "/p", transcript: "/p/b.jsonl")))
        q.sync {}
        #expect(store.get("T") == new, "最近活跃会话覆盖旧")
    }

    @Test("TSR_clear_on_process_exit / TSR_clear_on_user_close：processExit / 用户关终端 → remove")
    func clearPaths() {
        let bus = WaitEventBus()
        let spy = Spy()
        let q = DispatchQueue(label: "t4")
        let tracker = makeTracker(bus: bus, spy: spy, queue: q)
        bus.publish(WaitEvent(termId: "T", event: .processExit, ts: 1))
        q.sync {}
        #expect(spy.removed == ["T"], "processExit → 清条目")
        tracker.terminalRemoved(termId: "T2") // 用户显式关终端 / 移除路径
        #expect(spy.removed == ["T", "T2"])
    }

    @Test("TSR_no_double_restore_takeover（机制半）：SessionTracker 排除任意非 human ownership（found B-2）")
    func ownershipExcludesNonHuman() {
        // ⚠️ 本测试仅验 SessionTracker **机制**：给定 ownershipOf 返回非 .human 即排除。它**不**证明生产盒
        // 真能识别 worker/brain——生产 ownership 盒（TakeoverOwnershipBox）**当前只识 takeover**，worker/brain
        // 恒返 .human（未接线，B2 绑定表 / B4 接线义务）。生产真实覆盖见 MuxvoAppCoreTests 的
        // `takeoverOwnershipBoxOnlyExcludesTakeover`（诚实标注未接线缺口，勿在此伪装已防护）。
        let bus = WaitEventBus()
        let spy = Spy()
        let q = DispatchQueue(label: "t5")
        let tracker = makeTracker(bus: bus, spy: spy, queue: q, ownershipOf: { termId in
            switch termId {
            case "TK": return .takeover
            case "WK": return .worker
            case "BR": return .brain
            default: return .human
            }
        })
        _ = tracker
        let sid = "11111111-2222-3333-4444-555555555555"
        for id in ["TK", "WK", "BR", "HUMAN"] {
            bus.publish(WaitEvent(termId: id, event: .stop, ts: 1,
                raw: rawJSON(sessionId: sid, cwd: "/p", transcript: "/p/t.jsonl")))
        }
        q.sync {}
        #expect(spy.records.map(\.termId) == ["HUMAN"], "机制：ownership≠human 一律排除（takeover/worker/brain）")
    }
}
