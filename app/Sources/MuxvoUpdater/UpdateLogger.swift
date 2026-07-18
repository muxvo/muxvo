// update.log 文件日志（specs/behavior/auto-update.md §0/§8；legacy services/app/update-logger.ts 对等）：
// 行格式 [ISO8601] [LEVEL] message；启动（init）时 >maxSize 整体清空（rotate-on-startup，非运行中截断）；
// 写失败静默吞。线程安全（NSLock），可跨线程持有。

import Foundation

public final class FileUpdateLogger: UpdateLogging, @unchecked Sendable {
    public static let defaultMaxSize = 1024 * 1024 // 1MB（legacy MAX_LOG_SIZE）

    private let path: URL
    private let lock = NSLock()
    private let timestamp: () -> String

    public init(path: URL, maxSize: Int = FileUpdateLogger.defaultMaxSize) {
        self.path = path
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        self.timestamp = { formatter.string(from: Date()) }
        // rotate-on-startup（legacy :21-28）：>maxSize 清空；不存在/读不到 → 忽略。
        if let size = (try? FileManager.default.attributesOfItem(atPath: path.path)[.size]) as? Int,
           size > maxSize {
            try? Data().write(to: path)
        }
    }

    public func info(_ message: String) { write("INFO", message) }
    public func warn(_ message: String) { write("WARN", message) }
    public func error(_ message: String) { write("ERROR", message) }
    public func debug(_ message: String) { write("DEBUG", message) }

    private func write(_ level: String, _ message: String) {
        let line = "[\(timestamp())] [\(level)] \(message)\n"
        guard let data = line.data(using: .utf8) else { return }
        lock.lock()
        defer { lock.unlock() }
        do {
            if FileManager.default.fileExists(atPath: path.path) {
                let handle = try FileHandle(forWritingTo: path)
                defer { try? handle.close() }
                try handle.seekToEnd()
                try handle.write(contentsOf: data)
            } else {
                try FileManager.default.createDirectory(
                    at: path.deletingLastPathComponent(), withIntermediateDirectories: true
                )
                try data.write(to: path)
            }
        } catch {
            // 写失败静默（legacy :35-37）。
        }
    }
}
