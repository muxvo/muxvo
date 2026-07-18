// 聊天自定义标题持久化面（M5-R1，ChatCustomTitlesStore）红→绿。
//
// 覆盖：读写往返 / nil 与空串清除 / 损坏 JSON 兜底 / 并发 set 不丢写 / 落盘路径正确。
import Foundation
import MuxvoTestSupport
import Testing

@testable import MuxvoStorage

@Suite("ChatCustomTitlesStore（聊天自定义标题持久化）")
struct ChatCustomTitlesStoreTests {
    private let sid = "11111111-2222-3333-4444-555555555555"

    @Test("读写往返：set 后 get + 新实例重读一致")
    func roundtrip() throws {
        try withTempRoot { root in
            let s1 = ChatCustomTitlesStore(root: root)
            s1.set(sid, title: "我的会话")
            #expect(s1.get(sid) == "我的会话")
            // 新实例从盘重读 → 一致。
            let s2 = ChatCustomTitlesStore(root: root)
            #expect(s2.get(sid) == "我的会话")
            #expect(s2.all() == [sid: "我的会话"])
        }
    }

    @Test("nil 与空串清除：set(nil)/set(\"\")/remove 均移除该键并落盘")
    func nilAndEmptyClears() throws {
        try withTempRoot { root in
            let store = ChatCustomTitlesStore(root: root)
            store.set(sid, title: "t")
            #expect(store.get(sid) == "t")
            // 空串清除。
            store.set(sid, title: "")
            #expect(store.get(sid) == nil)
            // 重设 → nil 清除。
            store.set(sid, title: "t2")
            store.set(sid, title: nil)
            #expect(store.get(sid) == nil)
            // remove 幂等（已空 → no-op 不额外落盘）。
            let writesBefore = store.diskWrites
            store.remove(sid)
            #expect(store.diskWrites == writesBefore, "无该键 remove 不落盘")
            // 落盘反映清除（新实例读为空）。
            #expect(ChatCustomTitlesStore(root: root).all().isEmpty)
        }
    }

    @Test("幂等免冗余写：同值重 set 不落盘")
    func idempotentSetSkipsWrite() throws {
        try withTempRoot { root in
            let store = ChatCustomTitlesStore(root: root)
            store.set(sid, title: "same")
            let after = store.diskWrites
            store.set(sid, title: "same") // 同值 → 跳过
            #expect(store.diskWrites == after, "同值重 set 不重复落盘")
            store.set(sid, title: "changed") // 变化 → 落盘
            #expect(store.diskWrites == after + 1)
        }
    }

    @Test("损坏 JSON 兜底：非法内容 → 空表、不 crash，可继续写")
    func corruptFileFallsBackToEmpty() throws {
        try withTempRoot { root in
            // 先写一个合法条目建目录 + 文件。
            let seed = ChatCustomTitlesStore(root: root)
            seed.set(sid, title: "x")
            // 用垃圾覆盖文件。
            let url = DataDirectory.chatCustomTitlesURL(under: root)
            try Data("{not json at all".utf8).write(to: url)
            // 新实例：损坏 → 空表兜底。
            let store = ChatCustomTitlesStore(root: root)
            #expect(store.all().isEmpty, "损坏 JSON → 空表兜底")
            // 仍可正常写（覆盖损坏文件）。
            store.set(sid, title: "recovered")
            #expect(ChatCustomTitlesStore(root: root).get(sid) == "recovered")
        }
    }

    @Test("并发 set 不丢写：多线程各写独立键 → 全部持久化")
    func concurrentSetsAllPersist() throws {
        try withTempRoot { root in
            let store = ChatCustomTitlesStore(root: root)
            let n = 50
            DispatchQueue.concurrentPerform(iterations: n) { i in
                store.set("sess-\(i)", title: "title-\(i)")
            }
            let all = store.all()
            #expect(all.count == n, "并发写全部落表（NSLock 序列化，无丢写）")
            for i in 0..<n { #expect(all["sess-\(i)"] == "title-\(i)") }
            // 落盘一致（新实例重读齐全）。
            #expect(ChatCustomTitlesStore(root: root).all().count == n)
        }
    }

    @Test("落盘路径正确：文件落 <root>/state/chat-custom-titles.json")
    func writesToStatePath() throws {
        try withTempRoot { root in
            let store = ChatCustomTitlesStore(root: root)
            store.set(sid, title: "p")
            let expected = root.appendingPathComponent("state", isDirectory: true)
                .appendingPathComponent("chat-custom-titles.json")
            #expect(FileManager.default.fileExists(atPath: expected.path), "落盘路径 = state/chat-custom-titles.json")
            #expect(expected == DataDirectory.chatCustomTitlesURL(under: root))
        }
    }

    // MARK: onChange（title-sync 批：chatTitleUpdate 推送源，chat-history.md §7.2 title-update）

    /// onChange 事件收集盒（onChange 是 @Sendable——普通闭包会被赋值点的 actor 上下文推断隔离、
    /// 后台写点触发即动态隔离断言 trap，e2e item43 实抓；@Sendable 闭包内经引用捕获盒收集）。
    private final class EventLog: @unchecked Sendable {
        private let lock = NSLock()
        private var items: [(String, String?)] = []
        func append(_ sid: String, _ title: String?) { lock.withLock { items.append((sid, title)) } }
        var all: [(String, String?)] { lock.withLock { items } }
    }

    @Test("onChange 真变才触发：set 新值/改值/清除各一次，等值重 set 与空键 remove 不触发")
    func onChangeFiresOnRealChangeOnly() throws {
        try withTempRoot { root in
            let store = ChatCustomTitlesStore(root: root)
            let log = EventLog()
            store.onChange = { log.append($0, $1) }

            store.set(sid, title: "A")                    // 新值 → 触发 (sid, "A")
            store.set(sid, title: "A")                    // 等值 → 不触发（防环闸）
            store.set(sid, title: "B")                    // 改值 → 触发 (sid, "B")
            store.set(sid, title: "")                     // 空串清除 → 触发 (sid, nil)
            store.set(sid, title: nil)                    // 已空再清 → 不触发
            store.remove(sid)                             // 空键 remove → 不触发
            store.set(sid, title: "C")
            store.remove(sid)                             // 有键 remove → 触发 (sid, nil)

            let events = log.all
            #expect(events.count == 5, "5 次真变化，等值/空键 no-op 不触发")
            #expect(events[0] == (sid, "A"))
            #expect(events[1] == (sid, "B"))
            #expect(events[2] == (sid, nil))
            #expect(events[3] == (sid, "C"))
            #expect(events[4] == (sid, nil))
        }
    }

    @Test("onChange 锁外触发：回调内重入读写 store 不死锁")
    func onChangeFiresOutsideLock() throws {
        try withTempRoot { root in
            let store = ChatCustomTitlesStore(root: root)
            let reentrant = EventLog()
            store.onChange = { [weak store] sessionId, _ in
                // NSLock 非重入：若 onChange 在 withLock 内触发，此 get 必死锁（测试挂起即回归信号）。
                reentrant.append(sessionId, store?.get(sessionId))
            }
            store.set(sid, title: "reentrant")
            #expect(reentrant.all.last?.1 == "reentrant", "回调时新值已可见（先写后 fire）")
        }
    }
}
