// Codex prime 增量索引缓存（P0 CPU 风暴修复批3；仅 MemoizingCodexSource.prime 消费）。
//
// 修前 prime 每次对 ~/.codex/sessions 全量重读（真机 333 文件/597MB ≈ 36s CPU/遍 × 3-4 遍），
// FSEvents 每次 Codex 变化都重跑 → 风暴成本主体之一。本层把「每文件重读」换成「每文件 stat」：
//  · 键 = 文件路径，(mtimeMs, size) 命中即复用已解析 raw meta 与 firstUser memo，miss 才重读。
//  · **刻意不缓存 title/storedSid 派生值**——title 每次 buildIndex 用当次 fresh titles 表派生
//    （.codex-global-state.json 被 Codex 桌面版周期性重写，烘死会陈旧）；storedSid 由 raw 派生。
//  · 每次构建换新字典、只迁移命中项 → 删除的文件自然逐出，零额外逻辑。
//  · reader（CodexSessionSource）本身保持无缓存：双跑 harness 直构 reader 的「每会话重提取」
//    路径不受影响。
//  · 「同 (path,mtime,size) 改内容不生效」为设计内行为（与 ChatIndexer 未变跳过同口径，
//    CodexPrimeCacheTests 显式钉锚）；rollout 追加型写必增 size，无此路径。
import Foundation

final class CodexIndexCache: @unchecked Sendable {
    struct RawMeta {
        let filenameSid: String
        /// session_meta.payload.id（无 meta 行 → nil；空串保留——派生处按真值语义兜底 filenameSid）。
        let metaId: String?
        let cwd: String
    }
    private struct Record {
        let mtimeMs: Int64
        let size: Int
        let raw: RawMeta
        var firstUser: String?  // nil=未算；""=已算且无 user 消息（legacy 语义）
    }

    // 注入缝（测试计数包装；生产走 convenience init(source:) 的真实现）。
    private let statFile: (URL) -> (mtimeMs: Int64, size: Int)?
    private let readMeta: (URL) -> CodexSessionMeta?
    private let readFirstUser: (URL) -> String

    private let lock = NSLock()
    private var records: [String: Record] = [:]

    init(
        statFile: @escaping (URL) -> (mtimeMs: Int64, size: Int)?,
        readMeta: @escaping (URL) -> CodexSessionMeta?,
        readFirstUser: @escaping (URL) -> String
    ) {
        self.statFile = statFile
        self.readMeta = readMeta
        self.readFirstUser = readFirstUser
    }

    convenience init(source: CodexSessionSource) {
        self.init(
            statFile: { PosixStat.of($0).map { (mtimeMs: $0.mtimeMs, size: $0.size) } },
            readMeta: { source.readSessionMeta($0) },
            readFirstUser: { source.extractFirstUserMessage($0) })
    }

    /// 一遍扫描：目录发现 + 逐文件 stat；(mtimeMs,size) 命中复用缓存（连带 firstUser memo 迁移），
    /// miss 重读首行 meta。entry 顺序 = 扫描顺序；title/storedSid 派生逐行同构
    /// CodexSessionSource.buildIndex（title 查表 filenameSid → metaId、真值语义兜底）。
    func buildIndex(sessionsDir: URL, titles: [String: String]) -> [CodexSessionSource.IndexEntry] {
        let files = CodexDirectory.findAllSessionFiles(sessionsDir: sessionsDir)
        let old = lock.withLock { records }
        var newRecords: [String: Record] = [:]
        newRecords.reserveCapacity(files.count)
        var entries: [CodexSessionSource.IndexEntry] = []
        entries.reserveCapacity(files.count)
        for file in files {
            guard let st = statFile(file) else { continue }  // 对齐 buildIndex 的 stat 失败跳过
            let key = file.path
            let record: Record
            if let hit = old[key], hit.mtimeMs == st.mtimeMs, hit.size == st.size {
                record = hit
            } else {
                let meta = readMeta(file)
                record = Record(
                    mtimeMs: st.mtimeMs, size: st.size,
                    raw: RawMeta(
                        filenameSid: CodexSessionId.extract(fromFileName: file.lastPathComponent),
                        metaId: meta?.id, cwd: meta?.cwd ?? ""),
                    firstUser: nil)
            }
            newRecords[key] = record
            let title = nonEmpty(titles[record.raw.filenameSid])
                ?? nonEmpty(titles[record.raw.metaId ?? ""]) ?? ""
            let storedSid = nonEmpty(record.raw.metaId) ?? record.raw.filenameSid
            entries.append(CodexSessionSource.IndexEntry(
                filePath: file, sessionId: storedSid, mtime: Double(st.mtimeMs), size: st.size,
                cwd: record.raw.cwd, title: title))
        }
        lock.withLock { records = newRecords }
        return entries
    }

    /// 首条 user 消息 memo（buildSummary 无 title 兜底路径）：命中直返，miss 读文件后写回。
    /// 键随 buildIndex 的 Record 走 → 文件 (mtime,size) 变化时 Record 已换新、memo 自动失效。
    func firstUserMessage(for file: URL) -> String {
        let key = file.path
        if let cached = lock.withLock({ records[key]?.firstUser }) { return cached }
        let value = readFirstUser(file)
        lock.withLock { records[key]?.firstUser = value }
        return value
    }
}

/// JS `x || fallback` 字符串真值语义（同 CodexSessionSource 私有工具；派生逻辑逐行同构用）。
private func nonEmpty(_ s: String?) -> String? {
    guard let s, !s.isEmpty else { return nil }
    return s
}
