// 聊天会话自定义标题持久化（M5-R1）：老版 `sessionCustomTitles: Record<sessionId,string>`——终端重命名
// 写入，历史标题显示 customTitle||title。独立 JSON 文件（不塞 ConfigStore，避终端 config 高频写放大）。
//
// 仿 TerminalActiveSessionsStore（同 MuxvoStorage 落盘惯例）：NSLock 保护内存权威 map + AtomicFile
// 原子落盘（durability .full、0600）。差异：本 store 低频写（重命名/首绑补写）→ 即时落盘不去抖；
// 文件损坏 → 空表兜底不 crash。线程安全（renameSubmit 在 @MainActor 调，首绑补写在 tracker 后台队列
// hop main 后调，均经 NSLock 序列化）。
import Foundation

/// 聊天会话自定义标题存取（`<dataRoot>/state/chat-custom-titles.json`，形 `{"<sessionId>":"<title>"}`）。
public final class ChatCustomTitlesStore: @unchecked Sendable {
    private let fileURL: URL
    private let stateDirectory: URL

    private let lock = NSLock()
    private var titles: [String: String]
    /// 实际落盘次数（测试观测用；仅真变化才 +1）。
    public private(set) var diskWrites = 0

    /// 标题真变化后回调（(sessionId, 新值；nil=已清除)）。**锁外**触发（防回调重入死锁）；等值 no-op
    /// 不触发——天然去重/防环闸（chatTitleUpdate 推送 + 反向同步共用此闸）。调用线程 = 写入方线程
    /// （renameSubmit=main / setTitle=chat workQueue），消费方（AppDelegate）自行 hop main。
    /// **必须 @Sendable**：赋值点在 @MainActor（AppDelegate/harness），普通闭包类型会被运行时注入
    /// 「入口即断言 MainActor」的动态隔离检查——workQueue 写点触发即 SIGTRAP（e2e item43 GREEN 首跑实抓，
    /// 崩栈 ChatQueryEngine.setTitle→onChange→dispatch_assert_queue_fail）；@Sendable 令闭包非隔离，
    /// 体内自行 hop main。
    public var onChange: (@Sendable (String, String?) -> Void)?

    public init(root: URL) {
        let url = DataDirectory.chatCustomTitlesURL(under: root)
        fileURL = url
        stateDirectory = url.deletingLastPathComponent()
        titles = Self.readFromDisk(url)
    }

    /// 取自定义标题（无 → nil）。
    public func get(_ sessionId: String) -> String? {
        lock.withLock { titles[sessionId] }
    }

    /// 设置/清除：`title` 为 nil 或空串 → 移除该键；否则设置。仅在值真变化时落盘（幂等免冗余写）。
    /// 标题原样存（不 trim）——调用方（终端重命名正向链）已按 projection 语义 trim 后传入。
    public func set(_ sessionId: String, title: String?) {
        let normalized: String? = (title?.isEmpty == false) ? title : nil
        let changed: Bool = lock.withLock {
            if let normalized {
                guard titles[sessionId] != normalized else { return false }
                titles[sessionId] = normalized
            } else {
                guard titles.removeValue(forKey: sessionId) != nil else { return false }
            }
            writeLocked()
            return true
        }
        if changed { onChange?(sessionId, normalized) }
    }

    /// 移除该键（无该键 no-op、不落盘）。
    public func remove(_ sessionId: String) {
        let changed: Bool = lock.withLock {
            guard titles.removeValue(forKey: sessionId) != nil else { return false }
            writeLocked()
            return true
        }
        if changed { onChange?(sessionId, nil) }
    }

    /// 内存权威快照（历史标题渲染读、观测用）。
    public func all() -> [String: String] {
        lock.withLock { titles }
    }

    // MARK: 私有（须持 lock）

    private func writeLocked() {
        do {
            try FileManager.default.createDirectory(at: stateDirectory, withIntermediateDirectories: true)
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.sortedKeys]
            let data = try encoder.encode(titles)
            // durability .full + tmp 0o600（同 active-sessions；标题非机密但对齐本模块落盘保护口径）。
            try AtomicFile.write(data, to: fileURL, durability: .full)
            diskWrites += 1
        } catch {
            // 落盘失败不抛（标题丢失至多退化到 title 显示，非关键路径）；下次写再试。
            FileHandle.standardError.write(Data("[muxvo] chat-custom-titles 落盘失败：\(error)\n".utf8))
        }
    }

    private static func readFromDisk(_ url: URL) -> [String: String] {
        guard let data = try? Data(contentsOf: url) else { return [:] } // 缺失 = 空表
        return (try? JSONDecoder().decode([String: String].self, from: data)) ?? [:] // 损坏 = 空表兜底
    }
}
