// sync-state.json（chat-data.md §6.3 裁决 C）：`{lastSync: ISO, fileMtime: {相对路径→mtimeMs}}`。
//
// 定位 = **记录/断言面，非同步游标**。同步幂等的唯一权威判据是 §6.1「源 vs 镜像文件 mtime 秒级对比」
// （文件系统自身即游标）；sync-state.json 损坏/缺失**不影响同步正确性**——`load` 读失败即返回 nil，
// 调用方当空重建（ChatMirror 每轮 fullScan 以源文件现况整表覆盖）。
// 消费者：DATA_L1_07 spec-runner 断言 + 同步条 lastSyncMs 来源（chat-history.md §7）+ 双跑镜像面对照（§8.3）。
//
// mtimeMs 按 §8.2 规则 2 floor 到整数毫秒（丢浮点尾数），键为镜像相对路径（`<projectHash>/<sessionId>.jsonl`）。
import Foundation
import MuxvoStorage

public struct ChatSyncState: Sendable, Equatable, Codable {
    /// 本次同步完成时刻，ISO8601（`YYYY-MM-DDTHH:MM:SS.mmmZ`，UTC，对齐 legacy `new Date().toISOString()`）。
    public var lastSync: String
    /// 镜像相对路径 → 源文件 mtime（floor 到整数毫秒）。
    public var fileMtime: [String: Int]

    public init(lastSync: String, fileMtime: [String: Int]) {
        self.lastSync = lastSync
        self.fileMtime = fileMtime
    }

    /// 当前时刻的 ISO 串（CodexTime 与 Codex 侧 startedAt 同格式，3 位毫秒 + Z）。
    public static func nowISOString() -> String {
        CodexTime.isoString(fromMillis: Date().timeIntervalSince1970 * 1000)
    }

    /// 稳定序列化（sortedKeys：顶层与 fileMtime 内键均字典序，供双跑镜像面逐字节对照）。
    public func serialized() throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(self)
    }

    /// 容错解析：损坏/格式不符 → nil（调用方当空重建，不抛错、不影响同步）。
    public static func parse(_ data: Data) -> ChatSyncState? {
        try? JSONDecoder().decode(ChatSyncState.self, from: data)
    }

    /// 从文件读；缺失/读失败/损坏 → nil（自愈语义，见文件头）。
    public static func load(from url: URL) -> ChatSyncState? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return parse(data)
    }

    /// 原子写（AtomicFile 全 app 唯一落盘入口）。父目录缺失则先幂等建。
    public func write(to url: URL) throws {
        let directory = url.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try AtomicFile.write(serialized(), to: url, durability: .full)
    }
}
