// 生产 live 面 paged 会话查询（chat-data.md 登记⑪ 兑现）——把 wire 层 keyset 分页下推进数据层，
// 替代「fetchCCSessionRows 全表 SELECT 12.7 万行 + 内存去重排序 + wire 内存切片」的每查询 100~300ms。
//
// 分叉边界（登记⑥「生产 live 面与 dump/双跑面刻意分叉」同款先例）：
//  · 本文件是**生产专用新路径**（恒 includeUntitled:true），只被 ChatAssembly.sessionsPage 消费；
//  · 老路径（fetchCCSessionRows/sessions/allRecentSessions/ccDedupSummaries）逻辑零动 = dump/双跑
//    oracle 面（includeUntitled:false）与 delete/export 反查照旧；
//  · 语义等价由 CD_livepage_full_walk_equals_wire_sort（新路径全翻页 ≡ 老路径 wire 排序切片）钉死。
//
// 语义保真（老 ccDedupSummaries + crossSourceMergeSessions 逐条对齐）：
//  · 一级去重：组（项目面 = dirSet 全体行一组；isAll = parentProjectHash(dirName) ?? dirName 归组）内
//    cc last-wins / mirror first-wins；有 cc 出 cc（archiveOnly=false），否则出 mirror（archiveOnly=true）。
//    「先后」= 老 fetchCCSessionRows 实际迭代序 = UNIQUE 自动索引 (source, dir_name, session_id) 序
//    （对抗验收 MAJOR-1 EXPLAIN+运行时探针定谳，**非 rowid 序**）——组内 sid 恒等 → cc 胜者 = dir_name
//    字节序最大行、mirror 胜者 = 最小行（UTF-8 memcmp 对齐 SQLite BINARY collation，勿用 Swift String <）。
//  · 二级坍缩（仅 isAll，老 crossSourceMergeSessions 首现胜）：同 sid 跨组时各组胜者取 lm 最大者；
//    lm tie → 首扫到者 emit（较老路径不稳定排序的任意序**确定化**，设计内偏差，spec 登记）。
//  · codex 合并：先在**原生序**上 sid 首现去重（老 cc+codex 迭代序语义），再滤游标窗；任何 CC 同 sid
//    行存在即压制（项目面 EXISTS 限 dirSet——老路径压制方是 dirSet 内幸存 CC summary）。
//  · 输出序 = wire 全序 (sortKeyMs DESC, sessionId DESC)，emit 位置在胜者自身键上（胜者 lm 可低于同组
//    败者行——老路径同，输出序按胜者 lastModified 参与排序）。
//
// 跨页正确性三件套：emit 判定用**键判定**（候选行 ∈ 该 sid 合格胜者集）而非行身份 + 请求内 sid
// seen-set（tie 簇只出首扫者）+ wire 游标严格 (lm,sid) 后继（页界等键行必为已裁决 sid 的败者/tie 余者，
// 排除即正确）。内部欠页续批键 = (lm, sid, rowid) 三元增强——strict (lm,sid) 会把同键簇剩余行连胜者
// 一起跳过（cc/mirror 孪生行因镜像写回源 mtime 天然同键）。
import Foundation
import GRDB

/// wire keyset 游标（`mtimeMs:sessionId`；ChatAssembly 解析/编码，本层只吃解析后的键）。
public struct LiveSessionCursor: Sendable, Equatable {
    public let mtimeMs: Int
    public let sessionId: String
    public init(mtimeMs: Int, sessionId: String) {
        self.mtimeMs = mtimeMs
        self.sessionId = sessionId
    }
}

extension ChatStore {
    /// wire 排序/游标键单一口径（截整数毫秒；codex lastModified 是 Double 整毫秒，CC 是 Int64 恒等）。
    /// ChatAssembly.sortKeyMs 委托此处——排序、encode、compare、下推谓词四处同键。
    public static func liveSortKeyMs(_ lastModified: Double) -> Int {
        Int(lastModified.rounded(.towardZero))
    }

    /// 生产 live 面一页会话（恒 includeUntitled:true；reconcile 恒 false 快路，刷新由 engine 后台
    /// reconcile 推 chatSessionUpdate 驱动）。`projectHash` nil = isAll（「全部」列表）。
    /// 返回 page（(sortKeyMs DESC, sessionId DESC) 全序）+ hasMore（是否存在第 pageSize+1 条）。
    public func liveSessionsPage(
        projectHash: String?, after: LiveSessionCursor?, pageSize: Int
    ) throws -> (page: [ChatSessionSummary], hasMore: Bool) {
        guard pageSize > 0 else { return ([], false) }

        // dirSet：仅项目面（[projectHash]+worktree 子目录 + §10 归组目录）；来源与老路径同 = facts 目录
        // 扫描的 worktreeMap（reconcile:false 快路，DirFactMemo 已令 mirror 侧廉价）。isAll 原不需要
        // （outputProjectHash/label 均为 dirName 纯函数派生）——§10 ctx 在场时 isAll 也需 ctx 做归一。
        var dirSet: Set<String>?
        var ctx: AutoGroupContext?
        if projectHash != nil || autoGrouping != nil {
            let (ccFacts, mirrorFacts, worktreeMap) = try facts(reconcile: false)
            ctx = autoGroupContext(ccFacts: ccFacts, mirrorFacts: mirrorFacts)
            if let ph = projectHash {
                var ds = Set([ph] + (worktreeMap[ph] ?? []))
                if let ctx { ds.formUnion(ctx.ruleDirs(forTarget: ph)) }
                dirSet = ds
            }
        }

        // codex 全列表（memoized，量小）：先原生序 sid 首现去重（老 crossSourceMergeSessions 的
        // cc+codex 迭代序语义——窗口滤在去重**之后**，跨页 dup 才不会复活），再滤游标窗、排 wire 序。
        // §10：项目面扩查 worktree 子 hash + 目标时的规则 hash（父先子后、子按 hash 排序，去重确定性）；
        // isAll 面对命中条目做 projectHash 归一 + 补来源标签。
        let codexAll: [ChatSessionSummary]
        if let reader = codexReader {
            if let ph = projectHash {
                var all = reader.getSessionsForProject(ph, limit: .max)
                if let ctx {
                    let extraHashes = (ctx.codexWorktreeChildren[ph] ?? [])
                        + ctx.codexRuleHashes(forTarget: ph)
                    for h in extraHashes.sorted() {
                        all += reader.getSessionsForProject(h, limit: .max).map { s in
                            var s2 = s
                            s2.projectHash = ph
                            if s2.worktreeLabel == nil { s2.worktreeLabel = ctx.sourceLabel(h) }
                            return s2
                        }
                    }
                }
                codexAll = all
            } else if let ctx {
                codexAll = reader.getAllRecentSessions(limit: .max).map { s in
                    let norm = ctx.normalize(s.projectHash)
                    guard norm != s.projectHash else { return s }
                    var s2 = s
                    if s2.worktreeLabel == nil { s2.worktreeLabel = ctx.sourceLabel(s.projectHash) }
                    s2.projectHash = norm
                    return s2
                }
            } else {
                codexAll = reader.getAllRecentSessions(limit: .max)
            }
        } else {
            codexAll = []
        }
        var codexSeen = Set<String>()
        var codexWindow = codexAll.filter { codexSeen.insert($0.sessionId).inserted }
        if let after {
            codexWindow = codexWindow.filter { s in
                let k = Self.liveSortKeyMs(s.lastModified)
                return k < after.mtimeMs || (k == after.mtimeMs && s.sessionId < after.sessionId)
            }
        }
        codexWindow.sort { a, b in
            let ka = Self.liveSortKeyMs(a.lastModified), kb = Self.liveSortKeyMs(b.lastModified)
            if ka != kb { return ka > kb }
            return a.sessionId > b.sessionId
        }

        let ds = dirSet
        let ph = projectHash
        let agCtx = ctx
        // 单 pool.read 事务 = WAL 快照隔离：窗口批、sid 组点查、codex 压制 EXISTS 页内一致
        //（老路径单条 SELECT 也是单快照；页间可变与老路径每请求重算一致，键值游标覆盖行删/换）。
        return try database.pool.read { db in
            try Self.mergedPage(
                db: db, store: self, projectHash: ph, dirSet: ds, after: after,
                pageSize: pageSize, codexWindow: codexWindow, ctx: agCtx)
        }
    }

    // MARK: - 页归并主体（read 事务内）

    private static func mergedPage(
        db: Database, store: ChatStore, projectHash: String?, dirSet: Set<String>?,
        after: LiveSessionCursor?, pageSize: Int, codexWindow: [ChatSessionSummary],
        ctx: ChatStore.AutoGroupContext?
    ) throws -> (page: [ChatSessionSummary], hasMore: Bool) {
        // §10 归一（isAll 归组键 / outputHash 共用）：ctx nil = 原语义逐字（parentProjectHash ?? dirName）。
        let normalize: (String) -> String = { dirName in
            ctx?.normalize(dirName) ?? (ChatProjectMerger.parentProjectHash(dirName) ?? dirName)
        }
        let want = pageSize + 1  // 第 pageSize+1 个 emit 只用于 hasMore 判定（老 start+count<total 等价）

        // ---- CC 行流：每 dir 一条纯索引扫描流（isAll = 单流无 dir 谓词），k 路按 (lm,sid,id) DESC 归并。
        // 项目面刻意不用 `dir_name IN + 全局 ORDER BY`（SQLite 对 IN 前缀+余列排序不保证免 temp sort），
        // 每流 dir_name 等值走 idx_chat_sessions_dir_mtime_sid 纯序扫。
        let streams = (dirSet.map { $0.sorted().map { CCRowStream(dir: $0) } }) ?? [CCRowStream(dir: nil)]
        let batchK = 256

        func refill(_ s: CCRowStream) throws {
            guard !s.exhausted, s.idx >= s.buffer.count else { return }
            // INDEXED BY 钉死计划：无统计（无 ANALYZE）时 planner 会挑 UNIQUE 自动索引 (source=?) +
            // temp 排序（EXPLAIN 取证，CD_livepage_window_uses_index）——序扫 + LIMIT 早停全毁。
            // ORDER BY 恰合索引列序（rowid 隐式末列）→ 该索引恒可用，INDEXED BY 不会报错。
            let index = s.dir == nil ? "idx_chat_sessions_mtime_sid" : "idx_chat_sessions_dir_mtime_sid"
            var sql = "SELECT * FROM chat_sessions INDEXED BY \(index) WHERE source IN ('cc','mirror')"
            var args: [DatabaseValueConvertible] = []
            if let dir = s.dir {
                sql += " AND dir_name = ?"
                args.append(dir)
            }
            if let k = s.lastKey {
                // 内部续批：三元严格后继（同 (lm,sid) 簇内以 id 前进，胜者不被批边界吞掉）。
                sql += " AND (file_mtime_ms < ? OR (file_mtime_ms = ? AND (session_id < ?"
                    + " OR (session_id = ? AND id < ?))))"
                args += [k.lm, k.lm, k.sid, k.sid, k.id]
            } else if let after {
                // 首批：wire 游标二元严格后继（页界等键行 = 已裁决 sid 的余行，排除即正确）。
                sql += " AND (file_mtime_ms < ? OR (file_mtime_ms = ? AND session_id < ?))"
                args += [Int64(after.mtimeMs), Int64(after.mtimeMs), after.sessionId]
            }
            sql += " ORDER BY file_mtime_ms DESC, session_id DESC, id DESC LIMIT ?"
            args.append(batchK)
            let rows = try ChatSessionRow.fetchAll(db, sql: sql, arguments: StatementArguments(args))
            s.buffer = rows
            s.idx = 0
            if let last = rows.last, let lastId = last.id {
                s.lastKey = (last.fileMtimeMs, last.sessionId, lastId)
            }
            if rows.count < batchK { s.exhausted = true }
        }

        func nextRow() throws -> ChatSessionRow? {
            var best: (s: CCRowStream, row: ChatSessionRow)?
            for s in streams {
                if s.idx >= s.buffer.count { try refill(s) }
                guard s.idx < s.buffer.count else { continue }
                let r = s.buffer[s.idx]
                if let b = best?.row {
                    // (lm,sid,id) DESC 头 = 三元组最大者；跨流 tie 以 id 定序（裁决按 sid 组整体，序仅影响
                    // 扫描先后不影响胜负）。
                    if (r.fileMtimeMs, r.sessionId, r.id ?? 0) > (b.fileMtimeMs, b.sessionId, b.id ?? 0) {
                        best = (s, r)
                    }
                } else {
                    best = (s, r)
                }
            }
            guard let best else { return nil }
            best.s.idx += 1
            return best.row
        }

        // ---- sid 组裁决（老 ccDedupSummaries + crossSourceMergeSessions 语义，见文件头）。
        var sidSeen = Set<String>()                 // 请求内已 emit 的 sid（tie 簇只出首扫者）
        var eligibleCache: [String: Set<Int64>] = [:]  // sid → 合格胜者 rowid 集（防重复点查）

        // SQLite BINARY collation（UTF-8 memcmp）——Swift String < 是 Unicode 序，非 ASCII dir 名会分歧。
        func dirBytesLess(_ a: ChatSessionRow, _ b: ChatSessionRow) -> Bool {
            a.dirName.utf8.lexicographicallyPrecedes(b.dirName.utf8)
        }
        // 组内胜者：cc last-wins = dir_name 字节序最大；mirror first-wins = 最小（老实际迭代序 =
        // UNIQUE 自动索引 (source, dir_name, session_id) 序，组内 sid 恒等 → 先后完全由 dir_name 决定；
        // 同 (source, dir, sid) 行 UNIQUE 唯一 → 无并列，全确定）。
        func groupWinner(_ rows: [ChatSessionRow]) -> ChatSessionRow? {
            if let cc = rows.filter({ $0.source == "cc" }).max(by: dirBytesLess) {
                return cc
            }
            return rows.filter { $0.source == "mirror" }.min(by: dirBytesLess)
        }

        func eligibleWinnerIds(sid: String) throws -> Set<Int64> {
            if let cached = eligibleCache[sid] { return cached }
            // 胜者公式（dir_name 字节序 max/min）与取行序无关；ORDER BY id ASC 仅为迭代确定性。
            // INDEXED BY 防 planner 落 UNIQUE 自动索引 (source=?) 前缀扫全 source 行。
            var rows = try ChatSessionRow.fetchAll(
                db,
                sql: "SELECT * FROM chat_sessions INDEXED BY idx_chat_sessions_sid WHERE session_id = ?"
                    + " AND source IN ('cc','mirror') ORDER BY id ASC",
                arguments: [sid])
            if let dirSet { rows = rows.filter { dirSet.contains($0.dirName) } }  // 组外行不遮蔽
            var eligible = Set<Int64>()
            if dirSet != nil {
                // 项目面：outputHash 恒 projectHash → dirSet 全体行一组，无二级坍缩。
                if let w = groupWinner(rows), let id = w.id { eligible = [id] }
            } else {
                // isAll：parent/§10 归组 → 各组胜者取 lm 最大者集（tie 全员合格，首扫者 emit）。
                let groups = Dictionary(grouping: rows) { normalize($0.dirName) }
                let winners = groups.values.compactMap(groupWinner)
                if let maxLm = winners.map(\.fileMtimeMs).max() {
                    eligible = Set(winners.filter { $0.fileMtimeMs == maxLm }.compactMap(\.id))
                }
            }
            eligibleCache[sid] = eligible
            return eligible
        }

        func nextCCEmission() throws -> ChatSessionSummary? {
            while let r = try nextRow() {
                if sidSeen.contains(r.sessionId) { continue }
                guard let rid = r.id else { continue }
                guard try eligibleWinnerIds(sid: r.sessionId).contains(rid) else { continue }
                sidSeen.insert(r.sessionId)
                let outHash = projectHash ?? normalize(r.dirName)
                return store.summary(
                    from: r, outputProjectHash: outHash,
                    archiveOnly: r.source != "cc", includeUntitled: true)
            }
            return nil
        }

        // ---- codex 压制（归并前沿懒查，每页 ~pageSize 次索引 EXISTS）。
        func ccSidExists(_ sid: String) throws -> Bool {
            var sql = "SELECT EXISTS(SELECT 1 FROM chat_sessions INDEXED BY idx_chat_sessions_sid"
                + " WHERE session_id = ? AND source IN ('cc','mirror')"
            var args: [DatabaseValueConvertible] = [sid]
            if let dirSet {
                sql += " AND dir_name IN ("
                    + Array(repeating: "?", count: dirSet.count).joined(separator: ",") + ")"
                args += dirSet.sorted()
            }
            sql += ")"
            return try Bool.fetchOne(db, sql: sql, arguments: StatementArguments(args)) ?? false
        }

        var codexIdx = 0
        func nextCodexEmission() throws -> ChatSessionSummary? {
            while codexIdx < codexWindow.count {
                let c = codexWindow[codexIdx]
                codexIdx += 1
                if try ccSidExists(c.sessionId) { continue }  // 老语义：cc 先占位，codex 同 sid 让位
                return c
            }
            return nil
        }

        // ---- 双流归并（cc emission 天然 (lm,sid) DESC 序：emit 在胜者自身键位；codex 已排 wire 序）。
        var emitted: [ChatSessionSummary] = []
        var ccNext = try nextCCEmission()
        var cxNext = try nextCodexEmission()
        while emitted.count < want, ccNext != nil || cxNext != nil {
            let takeCC: Bool
            if let c = ccNext, let x = cxNext {
                // 同 (lm,sid) 键不可能（同 sid 已被压制）；同 lm 异 sid 按 sid DESC。
                takeCC = (Int64(liveSortKeyMs(c.lastModified)), c.sessionId)
                    > (Int64(liveSortKeyMs(x.lastModified)), x.sessionId)
            } else {
                takeCC = ccNext != nil
            }
            if takeCC {
                emitted.append(ccNext!)
                ccNext = try nextCCEmission()
            } else {
                emitted.append(cxNext!)
                cxNext = try nextCodexEmission()
            }
        }
        let hasMore = emitted.count > pageSize
        return (Array(emitted.prefix(pageSize)), hasMore)
    }
}

/// CC 窗口批扫描流（每 dir 一条；isAll 单条 dir=nil）。lastKey = 内部续批三元键。
private final class CCRowStream {
    let dir: String?
    var buffer: [ChatSessionRow] = []
    var idx = 0
    var exhausted = false
    var lastKey: (lm: Int64, sid: String, id: Int64)?
    init(dir: String?) { self.dir = dir }
}
