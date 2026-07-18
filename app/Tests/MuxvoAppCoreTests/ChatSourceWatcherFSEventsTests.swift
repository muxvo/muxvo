// ChatSourceWatcher 真 FSEventStream 集成哨（P0 崩溃回归锚，2026-07-07）。
// 与 ResourceWatcher 同源坏模式（eventPaths 裸 char** unsafeBitCast NSArray）——nightly e2e
// harness 真机崩溃报告 muxvo-e2e-harness-2026-07-07-063347.ips（线程 com.muxvo.chat.watcher）。
// 本哨起真流：写 <projectHash>/<sessionId>.jsonl → 断言回调携定向变化（修复前 = 测试进程段错误）。
import Foundation
import Testing

@testable import MuxvoAppCore

@Suite("ChatSourceWatcher 真 FSEvents 集成（只碰 $TMPDIR）", .serialized)
struct ChatSourceWatcherFSEventsTests {
    private final class Box: @unchecked Sendable {
        private let lock = NSLock()
        private var changes: [ChatSourceChange] = []
        func append(_ v: [ChatSourceChange]) { lock.lock(); changes.append(contentsOf: v); lock.unlock() }
        func snapshot() -> [ChatSourceChange] { lock.lock(); defer { lock.unlock() }; return changes }
    }

    @Test("真 FSEventStream：会话 jsonl 追加经回调定向到达（修复前此处段错误）")
    func realStreamDeliversSessionChange() throws {
        let root = URL(fileURLWithPath: NSTemporaryDirectory())
            .resolvingSymlinksInPath()
            .appendingPathComponent("muxvo-csw-fsevents-\(UUID().uuidString)", isDirectory: true)
        let projectDir = root.appendingPathComponent("hash-abc", isDirectory: true)
        try FileManager.default.createDirectory(at: projectDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let box = Box()
        let watcher = ChatSourceWatcher(ccProjectsRoot: root, codexRoot: nil, debounceMs: 50) { cc, _ in
            box.append(cc)
        }
        watcher.start()
        defer { watcher.stop() }

        try Data("{\"type\":\"probe\"}\n".utf8)
            .write(to: projectDir.appendingPathComponent("sess-1.jsonl"))

        let expected = ChatSourceChange(projectHash: "hash-abc", sessionId: "sess-1")
        let deadline = Date().addingTimeInterval(10)
        while Date() < deadline {
            if box.snapshot().contains(expected) { break }
            usleep(100_000)
        }
        #expect(box.snapshot().contains(expected),
                "真 FSEvents 回调未送达定向会话变化（修复前为进程段错误，不会走到这里）")
    }
}
