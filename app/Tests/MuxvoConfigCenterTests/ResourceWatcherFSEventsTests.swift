// ResourceWatcher 真 FSEventStream 集成哨（P0 崩溃回归锚，2026-07-07）。
// 既有套件按头注释「不起真 FS、直驱 ingest」，恰好绕开了生产 FSEvents 回调层——该层
// eventPaths 裸 char** 被 unsafeBitCast 成 NSArray，首个真实事件即野指针 SIGSEGV
// （真机崩溃报告 MuxvoApp-2026-07-07-083011.ips，线程 com.muxvo.config.watcher）。
// 本哨起真流：写 settings.json → 断言回调携正确分类到达（修复前 = 测试进程段错误）。
import Foundation
import Testing

@testable import MuxvoConfigCenter

@Suite("ResourceWatcher 真 FSEvents 集成（只碰 $TMPDIR）", .serialized)
struct ResourceWatcherFSEventsTests {
    /// 锁盒收集器：回调来自 watcher 后台 queue。
    private final class Box: @unchecked Sendable {
        private let lock = NSLock()
        private var values: [String] = []
        func append(_ v: String) { lock.lock(); values.append(v); lock.unlock() }
        func snapshot() -> [String] { lock.lock(); defer { lock.unlock() }; return values }
    }

    @Test("真 FSEventStream：settings.json 变化经回调分类到达（修复前此处段错误）")
    func realStreamDeliversSettingsChange() throws {
        // FSEvents 回报真实路径（/private/var/…），root 先解符号链接保 classify 前缀命中。
        let root = URL(fileURLWithPath: NSTemporaryDirectory())
            .resolvingSymlinksInPath()
            .appendingPathComponent("muxvo-rw-fsevents-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let box = Box()
        let watcher = ResourceWatcher(claudeRoot: root, debounceMs: 50) { box.append($0) }
        watcher.start()
        defer { watcher.stop() }

        // 起流后写入（SinceNow 只看新事件）；latency 0.2s + 去抖 50ms，给 10s 宽窗（低核 CI 余量）。
        try Data("{}".utf8).write(to: root.appendingPathComponent("settings.json"))

        let deadline = Date().addingTimeInterval(10)
        while Date() < deadline {
            if box.snapshot().contains("settings") { break }
            try? FileManager.default.attributesOfItem(atPath: root.path)  // keep-alive 触碰无害
            usleep(100_000)
        }
        #expect(box.snapshot().contains("settings"),
                "真 FSEvents 回调未送达 settings 分类（修复前为进程段错误，不会走到这里）")
    }
}
