// JT_tail_rotation_detected（§5 + §4 tail 语义）：真临时文件驱动 FileTailSource.watch，
// 原子重写模拟轮转（inode 变化）→ 断言 rotation 标记 + 从头重读。
import Foundation
import Testing

@testable import MuxvoTranscript

/// 收集异步事件（actor 隔离，闭包 @Sendable）。M7 批6：每次 add 向订阅流投递当前快照，供
/// `waitUntil` 事件驱动等待（替代 10ms sleep-poll，去负载竞态）。
private actor EventCollector {
    private(set) var events: [HarnessEvent] = []
    private var continuations: [UUID: AsyncStream<[HarnessEvent]>.Continuation] = [:]
    func add(_ e: HarnessEvent) {
        events.append(e)
        for c in continuations.values { c.yield(events) }
    }
    func snapshot() -> [HarnessEvent] { events }
    func contains(_ pred: @Sendable (HarnessEvent) -> Bool) -> Bool {
        events.contains(where: pred)
    }
    /// 订阅「每次 add 后的快照」流。onTermination 自摘除。
    func changes() -> AsyncStream<[HarnessEvent]> {
        let id = UUID()
        let (stream, cont) = AsyncStream.makeStream(
            of: [HarnessEvent].self, bufferingPolicy: .bufferingNewest(64))
        cont.onTermination = { [weak self] _ in Task { await self?.drop(id) } }
        continuations[id] = cont
        return stream
    }
    private func drop(_ id: UUID) { continuations[id] = nil }
}

@Suite("文件 tail 轮转（§4）")
struct TranscriptTailTests {

    @Test("JT_tail_rotation_detected：原子重写触发 rotation 标记并从头重读")
    func JT_tail_rotation_detected() async throws {
        let dir = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("muxvo-tail-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let file = dir.appendingPathComponent("transcript.jsonl")

        // 初始内容：s1。
        try (#"{"type":"system","subtype":"init","session_id":"s1"}"# + "\n")
            .write(to: file, atomically: true, encoding: .utf8)

        let src = FileTailSource(url: file, pollInterval: .milliseconds(10))
        let collector = EventCollector()

        let collecting = Task {
            for await ev in src.watch() {
                await collector.add(ev)
                if await collector.contains({
                    if case .sessionStarted("s2", _) = $0 { return true }; return false
                }) { break }
            }
        }

        // 等 s1 被读到（增量 tail）。
        try await waitUntil(collector) { events in events.contains {
            if case .sessionStarted("s1", _) = $0 { return true }; return false
        } }

        // 原子重写为 s2（新 inode）→ 触发轮转。
        try (#"{"type":"system","subtype":"init","session_id":"s2"}"# + "\n")
            .write(to: file, atomically: true, encoding: .utf8)

        // 等 s2 被读到（轮转后从头重读）。
        try await waitUntil(collector) { events in events.contains {
            if case .sessionStarted("s2", _) = $0 { return true }; return false
        } }
        collecting.cancel()

        let all = await collector.snapshot()
        // 顺序：s1 → rotation → s2。
        let idxS1 = all.firstIndex { if case .sessionStarted("s1", _) = $0 { return true }; return false }
        let idxRot = all.firstIndex { if case .unknown("rotation", _) = $0 { return true }; return false }
        let idxS2 = all.firstIndex { if case .sessionStarted("s2", _) = $0 { return true }; return false }
        #expect(idxS1 != nil)
        #expect(idxRot != nil)   // 发 unknown(type:"rotation") 标记
        #expect(idxS2 != nil)
        if let a = idxS1, let b = idxRot, let c = idxS2 {
            #expect(a < b && b < c)
        }
    }
}

/// 事件驱动等待条件成立，超时即抛错（M7 批6，替代 10ms sleep-poll，避免负载下 5s 截止假超时）。
/// 快路预检 → 订阅 collector.changes() 流 → 每次 add 后核谓词。backstop 仅防挂（60s，与负载解耦）；
/// for-await 消费 AsyncStream 天然响应取消，backstop 胜出时无泄漏无挂死。真超时（条件永不成立）抛
/// TailTimeout（保「失败而非挂死」语义）。
private func waitUntil(
    _ collector: EventCollector,
    timeout: Duration = .seconds(60),
    _ cond: @escaping @Sendable ([HarnessEvent]) -> Bool
) async throws {
    if cond(await collector.snapshot()) { return }
    let stream = await collector.changes()
    if cond(await collector.snapshot()) { return } // 订阅后再核，闭丢唤醒窗口
    let hit = await withTaskGroup(of: Bool.self) { group in
        group.addTask {
            for await events in stream where cond(events) { return true }
            return false
        }
        group.addTask {
            try? await Task.sleep(for: timeout)
            return false
        }
        let first = await group.next() ?? false
        group.cancelAll()
        return first
    }
    if !hit { throw TailTimeout() }
}

private struct TailTimeout: Error {}
