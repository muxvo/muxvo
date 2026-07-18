// 输入源接口（§4，形状冻结，M5 不返工）。
//
// watch（热流）M4a 实装：文件 tail 增量读——记忆 offset，只喂新增字节给对应 harness 解析器；
// inode 变化或 size 回退（截断/轮转）→ 发 unknown(type:"rotation") 标记并从头重读（§4）。
// 轮询实现（不强依赖 FSEvents，§4 留实现自由度）。scanCold（冷扫全量历史）仅冻结签名，M5 实装。

import Foundation

/// 热流 / 冷扫两分层（§4 蓝本 ADR-001 保留资产）。
public protocol TranscriptSource: Sendable {
    /// 热流：从当前位置起增量产出事件（进程 stdout 或文件 tail）。
    func watch() -> AsyncStream<HarnessEvent>
    /// 冷扫：全量历史（M4a 仅签名，M5 实装）。
    func scanCold(since: Int64?) -> AsyncStream<HarnessEvent>
}

/// 文件 tail 源（§4）。轮询增量读；原子重写/截断 → rotation 标记 + 从头重读。
public struct FileTailSource: TranscriptSource {
    public enum Harness: Sendable {
        case claudeStreamJSON
        case codexExecJSON

        func makeParser(maxLineBytes: Int) -> any HarnessLineParser {
            switch self {
            case .claudeStreamJSON: return CCStreamParser(maxLineBytes: maxLineBytes)
            case .codexExecJSON: return CodexJSONParser(maxLineBytes: maxLineBytes)
            }
        }
    }

    let url: URL
    let harness: Harness
    let pollInterval: Duration
    let maxLineBytes: Int

    public init(
        url: URL,
        harness: Harness = .claudeStreamJSON,
        pollInterval: Duration = .milliseconds(30),
        maxLineBytes: Int = TranscriptLimits.maxLineBytes
    ) {
        self.url = url
        self.harness = harness
        self.pollInterval = pollInterval
        self.maxLineBytes = maxLineBytes
    }

    public func watch() -> AsyncStream<HarnessEvent> {
        let url = self.url
        let harness = self.harness
        let interval = self.pollInterval
        let maxLineBytes = self.maxLineBytes

        return AsyncStream { continuation in
            let task = Task {
                var parser = harness.makeParser(maxLineBytes: maxLineBytes)
                var offset: UInt64 = 0
                var lastInode: UInt64?

                while !Task.isCancelled {
                    if let attrs = try? FileManager.default.attributesOfItem(atPath: url.path) {
                        let size = (attrs[.size] as? NSNumber)?.uint64Value ?? 0
                        let inode = (attrs[.systemFileNumber] as? NSNumber)?.uint64Value ?? 0

                        // 轮转：inode 变化 或 size 回退到 offset 之下（截断/重写）。
                        if let last = lastInode, last != inode || size < offset {
                            continuation.yield(.unknown(type: "rotation", raw: url.lastPathComponent))
                            offset = 0
                            parser = harness.makeParser(maxLineBytes: maxLineBytes)
                        }
                        lastInode = inode

                        if size > offset, let handle = try? FileHandle(forReadingFrom: url) {
                            defer { try? handle.close() }
                            try? handle.seek(toOffset: offset)
                            let data = (try? handle.readToEnd()) ?? Data()
                            offset += UInt64(data.count)
                            for event in parser.feed(data) { continuation.yield(event) }
                        }
                    }
                    try? await Task.sleep(for: interval)
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    // 冷扫全量历史（§4，M5 批1 实装）：LineFramer 全量读（10MB 行上限 + 尾行缓冲同 watch，EOF 补
    // 换行 flush 末行）→ 逐行解析取 ts → since 过滤（仅当行带 ts 且 tsMs < since 才跳，无 ts 行不过滤）
    // → 复用 harness 对应 map（CC/Codex）产 HarnessEvent。磁盘会话 JSONL 的 summary/file-history-snapshot
    // 等未知 type 经 map 白名单透传为 .unknown（不加 HarnessEvent case）。
    //
    // ⚠️ 本实装仅践约 §4 冻结接口——M5 聊天数据管道不消费 scanCold（它走 SessionJSONLDecoder →
    // SessionRecord 信封面，见 SessionJSONLDecoder.swift）。此处存在只为不破 TranscriptSource 契约。
    public func scanCold(since: Int64?) -> AsyncStream<HarnessEvent> {
        let url = self.url
        let harness = self.harness
        let maxLineBytes = self.maxLineBytes

        return AsyncStream { continuation in
            let task = Task {
                guard let handle = try? FileHandle(forReadingFrom: url) else {
                    continuation.finish()
                    return
                }
                defer { try? handle.close() }

                var framer = LineFramer(maxLineBytes: maxLineBytes)
                var failures = 0
                var endedWithNewline = true

                func processFrames(_ frames: [LineFramer.Frame]) {
                    for frame in frames {
                        switch frame {
                        case .oversize:
                            failures += 1
                            continuation.yield(.parseError(count: failures))
                        case .line(let data):
                            if data.isEmpty { continue }
                            guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                                failures += 1
                                continuation.yield(.parseError(count: failures))
                                continue
                            }
                            failures = 0
                            // since 过滤：仅带 ts 且早于 since 的行跳过；无 ts 行（summary 等）不过滤。
                            if let since, let ts = SessionRecord.timestampMs(from: obj["timestamp"]), ts < since {
                                continue
                            }
                            let raw = String(decoding: data, as: UTF8.self)
                            let events: [HarnessEvent]
                            switch harness {
                            case .claudeStreamJSON: events = CCStreamParser.map(obj, raw: raw)
                            case .codexExecJSON: events = CodexJSONParser.map(obj, raw: raw)
                            }
                            for event in events { continuation.yield(event) }
                        }
                    }
                }

                while !Task.isCancelled {
                    let chunk = (try? handle.read(upToCount: 1 << 20)) ?? Data()
                    if chunk.isEmpty { break }
                    endedWithNewline = (chunk.last == 0x0A)
                    processFrames(framer.feed(chunk))
                }
                // EOF：末行无尾随换行时补一个换行 flush（全量扫须吐尽末行，与 tail 语义相反）。
                if !endedWithNewline {
                    processFrames(framer.feed(Data([0x0A])))
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}
