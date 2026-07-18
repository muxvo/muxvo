// Codex 查询面抽象 + 进程内 memo（M5 批3 首开异步化 MAJOR）。
//
// 背景：`CodexSessionSource.buildIndex()` 每次全量重读 `~/.codex/sessions/**`（真机 ~36s），getProjects /
// getAllRecentSessions / getSessionsForProject 都建立在它之上。ChatStore 若每次查询都直造新 CodexSessionSource，
// 面板每开一次、每点一个项目都付 36s——首开被 index 阻塞（批2 登记 MAJOR）。
//
// 方案：把 Codex 源抽象成 `ChatCodexQuerying`，ChatStore 注入其一实现。生产注入 `MemoizingCodexSource`：
//  · 读（getProjects/getAllRecent/getSessionsForProject）**非阻塞**，只回缓存（冷未预热 → 空，面板即刻拿到空态）。
//  · `prime()` 后台一次全量重读，缓存 projects + 全量会话列表；由装配层在首次请求/FSEvent 变化时后台调。
//  · search/readSession 是用户主动、非首开路径，直读源（不 memo；search 无 buildIndex 依赖，readSession 单文件廉价）。
//
// 缓存失效 = 装配层驱动 re-prime（FSEvent 监 `~/.codex` 变化时重跑 prime，mtime 失效语义）。
import Foundation

/// Codex 会话源查询面（CodexSessionSource 与其 memo 装饰器共用）。Sendable：跨 actor 在后台执行器上被捕获。
public protocol ChatCodexQuerying: Sendable {
    func getProjects() -> [ChatProjectInfo]
    func getSessionsForProject(_ projectHash: String, limit: Int) -> [ChatSessionSummary]
    func getAllRecentSessions(limit: Int) -> [ChatSessionSummary]
    func readSession(sessionId: String, limit: Int?) -> [ChatSessionMessage]
    func search(_ query: String) -> [ChatSearchResult]
}

/// CodexSessionSource 逐字段满足 `ChatCodexQuerying`（getSessionsForProject/readSession 的默认参数满足无默认的协议要求）。
extension CodexSessionSource: ChatCodexQuerying {}

/// Codex 查询 memo：读非阻塞回缓存、`prime()` 后台全量重读。冷库首开路径由此保证不等 36s。
public final class MemoizingCodexSource: ChatCodexQuerying, @unchecked Sendable {
    private let source: (any ChatCodexQuerying)?
    /// 具体源（便捷构造 `init(codexBase:)` 持有；`init(source:)` 注入假源时 nil）——缺陷2 memo 用它做
    /// **单文件直读**（`readSession(entry:)`）与 **prime 时建索引表**（`buildIndex()`）。假源注入时退回 `source` 全量扫。
    private let concrete: CodexSessionSource?
    /// prime 增量缓存（P0 风暴修复批3）：per-file (mtime,size) 命中免重读。仅具体源持有；
    /// 假源注入 nil → prime 退回三调用全量路径（既有测试面 + 正确性兜底）。
    private let indexCache: CodexIndexCache?
    private let lock = NSLock()
    private var cachedProjects: [ChatProjectInfo] = []
    private var cachedSessions: [ChatSessionSummary] = []
    /// prime 时建的 sessionId → IndexEntry 表（缺陷2）：readSession 命中即单文件直读，避开每次 buildIndex 全量扫
    /// （真机 594MB → 12s+）。**只缓存索引元数据（IndexEntry），绝不缓存消息体**——内容永远读时从文件取，外部
    /// 续写（活跃会话追加行）自然新鲜，无陈旧风险。first-wins 与 `CodexSessionSource.readSession` 的 `first(where:)` 语义一致。
    private var cachedIndex: [String: CodexSessionSource.IndexEntry] = [:]
    private var primed = false

    init(
        source: (any ChatCodexQuerying)?, concrete: CodexSessionSource?,
        indexCache: CodexIndexCache?
    ) {
        self.source = source
        self.concrete = concrete
        self.indexCache = indexCache
    }

    /// source nil = 无 Codex（codexBase 缺失）：一切读回空、prime 直接标记完成。
    /// concrete = 便捷构造透传的具体源（假源注入时 nil → readSession/prime 索引退回 source 全量扫，正确性兜底）。
    public convenience init(source: (any ChatCodexQuerying)?, concrete: CodexSessionSource? = nil) {
        self.init(
            source: source, concrete: concrete,
            indexCache: concrete.map { CodexIndexCache(source: $0) })
    }

    public convenience init(codexBase: URL?) {
        let src = codexBase.map { CodexSessionSource(codexBasePath: $0) }
        self.init(source: src, concrete: src)
    }

    /// 是否已至少预热一次（装配层据此决定是否推 chatSyncStatus idle）。
    public var isPrimed: Bool { lock.lock(); defer { lock.unlock() }; return primed }

    /// 后台重读（阻塞，仅后台调用）：缓存 projects + 全量会话 + sessionId→IndexEntry 表（缺陷2 单文件直读用）。
    /// 缓存失效由装配层驱动 re-prime（`ChatSourceWatcher` 监 Codex 可观察面 FSEvents 变化 →
    /// `ChatAssembly.refresh(reprimeCodex:)` → 本 prime 重跑，索引表随之刷新）——故 prime 后新增/删除会话经
    /// re-prime 自然同步；re-prime 到达前的空窗由 `readSession` 的「未命中/文件消失 → 全量扫回退」兜底。
    ///
    /// P0 风暴修复（批3）：生产路径（具体源 + CodexIndexCache）单遍 buildIndex（未变文件只 stat），
    /// projects/sessions/索引表从同一份 index 派生——修前 = 每次 3 遍全量重读（getProjects/getAllRecent/
    /// buildIndex 各扫一遍，真机 36s CPU/遍）。假源注入路径保留原三调用（既有测试面 + 正确性兜底）。
    public func prime() {
        guard let source else {
            lock.lock(); primed = true; lock.unlock(); return
        }
        if let concrete, let indexCache {
            let titles = concrete.getThreadTitles()
            let entries = indexCache.buildIndex(sessionsDir: concrete.sessionsDir, titles: titles)
            let p = concrete.getProjects(from: entries)
            let s = concrete.getAllRecentSessions(
                limit: .max, from: entries, titles: titles,
                firstUserMessage: { indexCache.firstUserMessage(for: $0) })
            var index: [String: CodexSessionSource.IndexEntry] = [:]
            for entry in entries where index[entry.sessionId] == nil {
                index[entry.sessionId] = entry  // first-wins：对齐 CodexSessionSource.readSession 的 first(where:)
            }
            lock.lock(); cachedProjects = p; cachedSessions = s; cachedIndex = index; primed = true; lock.unlock()
            return
        }
        let p = source.getProjects()
        let s = source.getAllRecentSessions(limit: .max)
        // 建索引表（仅便捷构造的具体源可 buildIndex；假源注入时无 concrete → 表留空，readSession 全量扫回退）。
        var index: [String: CodexSessionSource.IndexEntry] = [:]
        if let concrete {
            for entry in concrete.buildIndex() where index[entry.sessionId] == nil {
                index[entry.sessionId] = entry  // first-wins：对齐 CodexSessionSource.readSession 的 first(where:)
            }
        }
        lock.lock(); cachedProjects = p; cachedSessions = s; cachedIndex = index; primed = true; lock.unlock()
    }

    // MARK: - 读（非阻塞，回缓存）

    public func getProjects() -> [ChatProjectInfo] {
        lock.lock(); defer { lock.unlock() }; return cachedProjects
    }

    public func getAllRecentSessions(limit: Int) -> [ChatSessionSummary] {
        lock.lock(); defer { lock.unlock() }; return Array(cachedSessions.prefix(limit))
    }

    public func getSessionsForProject(_ projectHash: String, limit: Int) -> [ChatSessionSummary] {
        lock.lock(); defer { lock.unlock() }
        return Array(cachedSessions.filter { $0.projectHash == projectHash }.prefix(limit))
    }

    // MARK: - 按需（非首开路径）

    /// search 无 buildIndex 依赖此优化范畴外（本身逐文件早停），直读源。
    public func search(_ query: String) -> [ChatSearchResult] { source?.search(query) ?? [] }

    /// 单会话详情（缺陷2 修复）：命中 prime 时建的索引表且**文件仍在** → `concrete.readSession(entry:)` 单文件直读
    /// （避开 buildIndex 全量扫，真机 594MB→12s+ 根因）；未命中 / 文件已删 / 无 concrete（假源）→ 回退 `source` 全量扫
    /// （正确性兜底：prime 后新增会话在 re-prime 到达前仍可读）。索引只提供 filePath 等元数据，消息体永远读时从文件取。
    public func readSession(sessionId: String, limit: Int?) -> [ChatSessionMessage] {
        lock.lock(); let entry = cachedIndex[sessionId]; lock.unlock()
        if let entry, let concrete,
           FileManager.default.fileExists(atPath: entry.filePath.path)
        {
            return concrete.readSession(entry: entry, limit: limit)
        }
        return source?.readSession(sessionId: sessionId, limit: limit) ?? []
    }
}
