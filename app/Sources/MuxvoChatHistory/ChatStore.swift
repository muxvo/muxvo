// 查询编排（specs/behavior/chat-data.md §1~§5 读者面）——把批1 纯函数 + chat.db 缓存 + Codex 源串成
// legacy `createChatProjectReader` 等价读者：四查询输出 legacy 四类型（§8.1）。
//
// 分工：
//  · projects()          —— 直扫 CC + 镜像目录事实 → buildProjectInfo → ChatProjectMerger（§1.4 archive
//                           Math.max + §1.2 worktree 归并）→ 与 Codex getProjects 跨源归并（§5.4 加）。
//  · sessions / allRecent —— reconcile 后读 chat_sessions 缓存（title/started/cwd/mtime/size）；空 title 丢弃、
//                           worktree 回查打 label、(projectHash,sessionId) CC 优先去重 + mirror 独有标
//                           archiveOnly（§2.4/§6.2）；再与 Codex 跨源按 sessionId 去重（CC 先，§5.4）。
//  · messages            —— **文件直读（不进 DB）**：CC 父目录→worktree 目录→镜像 依次命中（§1.3/§5.4
//                           readSession CC 先空则 Codex）；文件 >2MB 带 limit → tail 读跳残行 slice(-limit)（§3.6）。
//  · search              —— 一期**纯复验全扫** chat_search_lines（按 line_no 序，每 session 首命中即停，
//                           snippet 30/170，CC 先占位去重）+ Codex search，flat slice(0,500)（§4/§5.4）。FTS 预筛=批5。
//
// 注入 base（不碰 DataDirectory）：ccBase=`~/.claude/projects/`；mirrorBase=`<dataRoot>/chat-history/`（可空）；
// codexBase=`~/.codex`（可空）。per-source 对照（§8.3）由调用方按 base 组合（CC-only=codexBase nil 等）。
import Foundation
import GRDB
import MuxvoTranscript

/// 聊天读者查询面（§8.1 四类型输出契约）。
///
/// `reconcile`（M5 批3 首开异步化）：true = 查询前先把 CC/镜像目录 reconcile 进 chat.db（冷首建 ~18s；暖库增量）；
/// false = **只扫目录建 worktreeMap（快）+ 读现有 chat.db 行**，跳过 indexer——面板首开走 false 即刻返回已有缓存/空态，
/// 后台另跑一次 `reconcile()` 刷新 DB。默认 true 保持批2 双跑/既有调用方零行为变。
/// `includeUntitled`（dogfood-r4 问题5）：false（默认，dump/双跑）= 丢弃空 title 会话、有效 title=裸 title
/// （legacy 对齐）；true（生产 live 面）= 保留空 title 会话、有效 title = `title.isEmpty ? titleFallback : title`
/// （summary/assistant 兜底可见）。协议要求无默认（Swift 限制）；ChatStore 具体实现给 `= false` 默认。
public protocol ChatQueryService {
    func projects(reconcile: Bool) throws -> [ChatProjectInfo]
    func sessions(projectHash: String, limit: Int, includeUntitled: Bool, reconcile: Bool) throws -> [ChatSessionSummary]
    func allRecentSessions(limit: Int, includeUntitled: Bool, reconcile: Bool) throws -> [ChatSessionSummary]
    func messages(projectHash: String, sessionId: String, limit: Int?, reconcile: Bool) throws -> [ChatSessionMessage]
    func search(query: String, reconcile: Bool) throws -> [ChatSearchResult]
}

public struct ChatStore: ChatQueryService, Sendable {
    public let ccBase: URL
    public let mirrorBase: URL?
    public let codexBase: URL?
    public let database: ChatDatabase
    /// 注入的 Codex 源（生产传 MemoizingCodexSource，避免每查询 36s 全量重读）。nil = 从 codexBase 现造（原行为）。
    public let codexSourceOverride: (any ChatCodexQuerying)?
    /// displayPath 备忘（dogfood-r4 问题5）：cc/mirror scanner 共用此实例，命中 (首 .jsonl mtime,size) 免重读。
    /// nil = 不用备忘（dump/双跑/测试原行为，每次真读）。
    public let displayPathMemo: DisplayPathMemo?
    /// 镜像池目录事实备忘（登记⑩，扫描风暴根治）：**只传给 mirror scanner**（CC live 原地 append 语义
    /// 不兼容，见 DirFactMemo 头注）。nil = 不用备忘（dump/双跑/测试原行为，每查询/reconcile 全量真扫）。
    public let mirrorDirFactMemo: DirFactMemo?
    /// 生产自动归组策略（§10）：nil（默认，dump/双跑/既有测试）= 全关，一切输出与引入前逐字节相同；
    /// 生产装配传 `.relpad`。见 ChatAutoGrouping.swift 头注。
    public let autoGrouping: ChatAutoGroupingPolicy?

    /// 文件 tail 读阈值（§3.6：>2MB 且带 limit 才 tail）。
    static let tailThreshold = 2 * 1024 * 1024
    /// 聚合搜索结果上限（§5.4 slice(0,500)）。
    static let searchResultCap = 500

    public init(
        ccBase: URL, mirrorBase: URL? = nil, codexBase: URL? = nil, database: ChatDatabase,
        codexSource: (any ChatCodexQuerying)? = nil, displayPathMemo: DisplayPathMemo? = nil,
        mirrorDirFactMemo: DirFactMemo? = nil, autoGrouping: ChatAutoGroupingPolicy? = nil
    ) {
        self.ccBase = ccBase
        self.mirrorBase = mirrorBase
        self.codexBase = codexBase
        self.database = database
        self.codexSourceOverride = codexSource
        self.displayPathMemo = displayPathMemo
        self.mirrorDirFactMemo = mirrorDirFactMemo
        self.autoGrouping = autoGrouping
    }

    // internal（登记⑪）：ChatStoreLivePage.swift 的 liveSessionsPage 复用；语义零动。
    var codexReader: (any ChatCodexQuerying)? {
        codexSourceOverride ?? codexBase.map { CodexSessionSource(codexBasePath: $0) }
    }

    // MARK: - reconcile + worktreeMap

    /// 扫 CC + 镜像目录（可选 reconcile 进 chat.db），返回目录事实 + worktree 归并图（§1.2/§1.3）。
    /// reconcile=false：只扫目录（廉价，仅 listdir/stat + 首会话 10 行取 displayPath）建 worktreeMap，跳过
    /// indexer 全量重读——首开查询走此路，读现有 chat.db 缓存/空态即刻返回，不等 18s（批3 首开异步化）。
    ///
    /// `forceMirror`（登记⑩）：true（默认，warmup/backfill/dump/双跑）= mirror 道恒全量 reconcile（原行为）；
    /// false（refresh 道，须注入 mirrorDirFactMemo）= 按 memo 计划（首轮 full → 此后 delta 脏目录 → 空脏跳过）。
    /// **consume 先于扫描**为不变式：mark 早于 consume 的变更（fs 持久）必被 consume 后的本轮扫描看到；
    /// 本轮扫描新产生的脏留待下轮。失败 restore 回灌；force 道成功后 requestFull（并发 stale 写下轮自愈）。
    // internal（登记⑪）：ChatStoreLivePage.swift 复用（reconcile:false 取 worktreeMap）；语义零动。
    @discardableResult
    func facts(reconcile: Bool, forceMirror: Bool = true) throws -> (cc: [ChatDirectoryScanner.DirFact], mirror: [ChatDirectoryScanner.DirFact], worktreeMap: [String: [String]]) {
        let mirrorPlan: DirFactMemo.Plan? = (reconcile && !forceMirror) ? mirrorDirFactMemo?.consumePlan() : nil
        let ccFacts = ChatDirectoryScanner(base: ccBase, displayPathMemo: displayPathMemo).scan()
        let mirrorFacts = mirrorBase.map {
            ChatDirectoryScanner(base: $0, displayPathMemo: displayPathMemo, dirFactMemo: mirrorDirFactMemo).scan()
        } ?? []
        if reconcile {
            let indexer = ChatIndexer(database: database)
            do {
                try indexer.reconcile(facts: ccFacts, source: "cc")
                switch mirrorPlan {
                case .full:
                    try indexer.reconcile(facts: mirrorFacts, source: "mirror")
                case .delta(let dirs):
                    if !dirs.isEmpty {
                        try indexer.reconcileMirrorDelta(facts: mirrorFacts, dirtyDirs: dirs)
                    }  // 空脏集 = 池零变化，mirror 道整体跳过（增量的全部意义）
                case nil:
                    try indexer.reconcile(facts: mirrorFacts, source: "mirror")  // mirror 为空 → 清理陈旧 mirror 行
                    if forceMirror { mirrorDirFactMemo?.requestFull() }  // force 道与 refresh 并发时旧 facts
                        // 后到可复活已删行且 memo 已缓存新态不自愈——下轮全量重校（warmup/backfill 低频，代价一轮）
                }
            } catch {
                if let plan = mirrorPlan { mirrorDirFactMemo?.restore(plan) }  // 事务已回滚，脏不静默丢
                // force 道（plan=nil）throw 时不 requestFull：初始 fullRequested=true / 上轮 force 已置位
                // 兜底——force 失败即 reconcile 整体失败，engine 记 error 下轮重试仍走 force/full（MINOR-2 注）。
                throw error
            }
        }

        // worktreeMap 覆盖 cc + 镜像目录（§1.3 worktree 会话可能只在镜像）。
        let ccInfos = ccFacts.compactMap { infoFromFact($0, source: .claudeCode) }
        let mirrorInfos = mirrorFacts.compactMap { infoFromFact($0, source: .claudeCode) }
        let merged = ChatProjectMerger.merge(cc: ccInfos, archive: mirrorInfos)
        return (ccFacts, mirrorFacts, merged.worktreeMap)
    }

    /// 后台预热入口（批3）：把 CC + 镜像目录 reconcile 进 chat.db（暖库常驻 → 后续 reconcile 增量）。
    /// 装配层在面板首次请求/FSEvent 变化时后台调；与前台查询的 reconcile:false 快路并行，完成后推 chatSyncStatus idle。
    /// `forceMirror: false`（登记⑩）= refresh 道走 memo 计划（池未变跳过 mirror 全量对账）；默认 true 原行为。
    public func reconcile(forceMirror: Bool = true) throws {
        _ = try facts(reconcile: true, forceMirror: forceMirror)
    }

    private func infoFromFact(_ f: ChatDirectoryScanner.DirFact, source: ChatSource) -> ChatProjectInfo? {
        ChatProjectMerger.buildProjectInfo(
            projectHash: f.dirName, displayPath: f.displayPath, jsonlCount: f.files.count,
            totalSize: f.totalSize, lastActivityMs: f.dirMtimeMs, source: source)
    }

    // MARK: - 自动归组上下文（§10；autoGrouping nil → nil = 全关，dump 面零动）

    /// 每查询现算（纯内存，目录数×规则数子串判断，零新增 I/O——facts 由调用方已扫、codex 走 memo）。
    struct AutoGroupContext {
        let policy: ChatAutoGroupingPolicy
        /// index 对齐 policy.groups 的归组目标 hash（真项目条目 hash 或该组合成桶常量——颜色圆点/查询键锚定于此）。
        let targetHashes: [String]
        /// index 对齐：各组命中规则的 cc+mirror 目录名（sessions/messages/delete 回查扩展）。
        let ruleDirsByGroup: [Set<String>]
        /// index 对齐：各组命中规则的 Codex hash（已排序；sessions Codex 侧扩查）。
        let codexRuleHashesByGroup: [[String]]
        /// Codex 项目 worktree 父→子 hash（fix A：Codex 源无 §1.2 归并，子挂父下查询）。
        let codexWorktreeChildren: [String: [String]]

        /// isAll 归组键/outputHash 归一：先规则（规则目录不含 `--worktrees-`，两分支不相交）再剥 worktree。
        func normalize(_ dirName: String) -> String {
            if let gi = policy.groupIndex(for: dirName) { return targetHashes[gi] }
            return ChatProjectMerger.parentProjectHash(dirName) ?? dirName
        }

        /// 会话来源标签：worktree 子目录 → `--worktrees-` 后整段；规则目录 → 规则 token 后整段。
        func sourceLabel(_ dirName: String) -> String? {
            if ChatProjectMerger.parentProjectHash(dirName) != nil {
                return ChatProjectMerger.worktreeLabel(fromHash: dirName)
            }
            return policy.label(dirName)
        }

        func isTarget(_ projectHash: String) -> Bool {
            targetHashes.contains(projectHash)
        }

        /// 请求 hash 为某组目标时该组（含同目标多组）的规则目录集；非目标 → 空集。
        func ruleDirs(forTarget projectHash: String) -> Set<String> {
            var out = Set<String>()
            for (gi, t) in targetHashes.enumerated() where t == projectHash {
                out.formUnion(ruleDirsByGroup[gi])
            }
            return out
        }

        /// 请求 hash 为某组目标时该组的 Codex 规则 hash（确定序）；非目标 → 空。
        func codexRuleHashes(forTarget projectHash: String) -> [String] {
            var out: [String] = []
            for (gi, t) in targetHashes.enumerated() where t == projectHash {
                out += codexRuleHashesByGroup[gi]
            }
            return out.sorted()
        }
    }

    func autoGroupContext(
        ccFacts: [ChatDirectoryScanner.DirFact], mirrorFacts: [ChatDirectoryScanner.DirFact]
    ) -> AutoGroupContext? {
        guard let policy = autoGrouping else { return nil }
        let ccInfos = ccFacts.compactMap { infoFromFact($0, source: .claudeCode) }
        let mirrorInfos = mirrorFacts.compactMap { infoFromFact($0, source: .claudeCode) }
        let merged = ChatProjectMerger.merge(cc: ccInfos, archive: mirrorInfos).projects
        let codexInfos = codexReader?.getProjects() ?? []
        var ruleDirsByGroup = [Set<String>](repeating: [], count: policy.groups.count)
        for dir in ccFacts.map(\.dirName) + mirrorFacts.map(\.dirName) {
            if let gi = policy.groupIndex(for: dir) { ruleDirsByGroup[gi].insert(dir) }
        }
        var codexRuleHashesByGroup = [[String]](repeating: [], count: policy.groups.count)
        var codexWorktreeChildren: [String: [String]] = [:]
        for p in codexInfos {
            if let gi = policy.groupIndex(for: p.projectHash) {
                codexRuleHashesByGroup[gi].append(p.projectHash)
            } else if let parent = ChatProjectMerger.parentProjectHash(p.projectHash) {
                codexWorktreeChildren[parent, default: []].append(p.projectHash)
            }
        }
        for gi in codexRuleHashesByGroup.indices { codexRuleHashesByGroup[gi].sort() }
        for k in codexWorktreeChildren.keys { codexWorktreeChildren[k]?.sort() }
        // 逐组目标解析（tie 确定性见 resolveTargetHashes）；候选=CC 归并面+Codex 原生面，与 projects() 输出同源。
        let targetHashes = policy.resolveTargetHashes(in: merged + codexInfos)
        return AutoGroupContext(
            policy: policy, targetHashes: targetHashes, ruleDirsByGroup: ruleDirsByGroup,
            codexRuleHashesByGroup: codexRuleHashesByGroup, codexWorktreeChildren: codexWorktreeChildren)
    }

    /// §10 对外回查扩展（ChatAssembly delete 用）：projectHash 是否某组归组目标。
    public func isAutoGroupTarget(_ projectHash: String) -> Bool {
        guard autoGrouping != nil,
              let (ccFacts, mirrorFacts, _) = try? facts(reconcile: false),
              let ctx = autoGroupContext(ccFacts: ccFacts, mirrorFacts: mirrorFacts)
        else { return false }
        return ctx.isTarget(projectHash)
    }

    // MARK: - projects（§1 + §5.4）

    public func projects(reconcile: Bool = true) throws -> [ChatProjectInfo] {
        let (ccFacts, mirrorFacts, _) = try facts(reconcile: reconcile)
        let ccInfos = ccFacts.compactMap { infoFromFact($0, source: .claudeCode) }
        let mirrorInfos = mirrorFacts.compactMap { infoFromFact($0, source: .claudeCode) }
        let ccMerged = ChatProjectMerger.merge(cc: ccInfos, archive: mirrorInfos).projects  // §1.4 + §1.2
        var codexInfos = codexReader?.getProjects() ?? []
        if autoGrouping != nil {
            // §10 fix A：Codex 源同享 §1.2 worktree 归并（archive 空 → §1.4 no-op；merger 零改动复用）。
            // 老缺陷=Codex 项目按 cwd 直出条目，`<repo>/.worktrees/wt-N` 漏成独立「wt-N」项目。
            codexInfos = ChatProjectMerger.merge(cc: codexInfos, archive: []).projects
        }
        var merged = crossSourceMergeProjects(ccMerged, codexInfos)  // §5.4（加，非 Math.max）
        if let ctx = autoGroupContext(ccFacts: ccFacts, mirrorFacts: mirrorFacts) {
            merged = ctx.policy.group(merged, targetHashes: ctx.targetHashes)  // §10 fix B：逐组折叠进目标
        }
        return merged
    }

    /// §5.4：各源 flat 按 projectHash 归并（sessionCount 加、totalSize 加、lastActivity max），lastActivity 降序。
    private func crossSourceMergeProjects(_ cc: [ChatProjectInfo], _ codex: [ChatProjectInfo]) -> [ChatProjectInfo] {
        var order: [String] = []
        var map: [String: ChatProjectInfo] = [:]
        for p in cc + codex {
            if var existing = map[p.projectHash] {
                existing.sessionCount += p.sessionCount
                existing.totalSize = (existing.totalSize ?? 0) + (p.totalSize ?? 0)
                existing.lastActivity = max(existing.lastActivity, p.lastActivity)
                map[p.projectHash] = existing
            } else {
                map[p.projectHash] = p
                order.append(p.projectHash)
            }
        }
        return order.compactMap { map[$0] }.sorted { $0.lastActivity > $1.lastActivity }
    }

    // MARK: - sessions / allRecent（§2 + §6.2 + §5.4）

    public func sessions(projectHash: String, limit: Int, includeUntitled: Bool = false, reconcile: Bool = true) throws -> [ChatSessionSummary] {
        let (ccFacts, mirrorFacts, worktreeMap) = try facts(reconcile: reconcile)
        var dirSet = Set([projectHash] + (worktreeMap[projectHash] ?? []))
        let ctx = autoGroupContext(ccFacts: ccFacts, mirrorFacts: mirrorFacts)
        if let ctx { dirSet.formUnion(ctx.ruleDirs(forTarget: projectHash)) }  // §10 归组目录并入回查集（非目标=空集）
        // includeUntitled=false（dump/双跑）：丢空 title；true（生产）：保留（有效 title 走 fallback，见 summary(from:)）。
        let rows = try fetchCCSessionRows().filter { (includeUntitled || !$0.title.isEmpty) && dirSet.contains($0.dirName) }
        let ccSummaries = ccDedupSummaries(rows: rows, outputHash: { _ in projectHash }, includeUntitled: includeUntitled, limit: limit)
        var codexSummaries = codexReader?.getSessionsForProject(projectHash, limit: limit) ?? []
        if let ctx {
            // §10：Codex 侧扩查（worktree 子 hash + 目标时的规则 hash），条目 remap 到本项目并补来源标签。
            // CodexSessionSource 公开签名零动（dump per-source 面稳），聚合在本层完成。
            let extraHashes = (ctx.codexWorktreeChildren[projectHash] ?? [])
                + ctx.codexRuleHashes(forTarget: projectHash)
            for h in extraHashes {
                codexSummaries += (codexReader?.getSessionsForProject(h, limit: limit) ?? []).map { s in
                    var s = s
                    s.projectHash = projectHash
                    if s.worktreeLabel == nil { s.worktreeLabel = ctx.sourceLabel(h) }
                    return s
                }
            }
        }
        return crossSourceMergeSessions(ccSummaries, codexSummaries, limit: limit)
    }

    public func allRecentSessions(limit: Int, includeUntitled: Bool = false, reconcile: Bool = true) throws -> [ChatSessionSummary] {
        let (ccFacts, mirrorFacts, _) = try facts(reconcile: reconcile)
        let ctx = autoGroupContext(ccFacts: ccFacts, mirrorFacts: mirrorFacts)
        let rows = try fetchCCSessionRows().filter { includeUntitled || !$0.title.isEmpty }
        let ccSummaries = ccDedupSummaries(
            rows: rows,
            // §10：ctx 在场时归一先规则后剥 worktree（normalize）；nil = 原语义逐字。
            outputHash: { ctx?.normalize($0) ?? (ChatProjectMerger.parentProjectHash($0) ?? $0) },
            includeUntitled: includeUntitled, limit: limit)
        var codexSummaries = codexReader?.getAllRecentSessions(limit: limit) ?? []
        if let ctx {
            codexSummaries = codexSummaries.map { s in
                let norm = ctx.normalize(s.projectHash)
                guard norm != s.projectHash else { return s }
                var s2 = s
                if s2.worktreeLabel == nil { s2.worktreeLabel = ctx.sourceLabel(s.projectHash) }
                s2.projectHash = norm
                return s2
            }
        }
        return crossSourceMergeSessions(ccSummaries, codexSummaries, limit: limit)
    }

    /// chat_sessions 全部 cc+mirror 行（含 title 空——搜索面需要；sessions 层再滤 title）。
    private func fetchCCSessionRows() throws -> [ChatSessionRow] {
        try database.pool.read { db in
            try ChatSessionRow.fetchAll(db, sql:
                "SELECT * FROM chat_sessions WHERE source IN ('cc','mirror')")
        }
    }

    /// (outputHash, sessionId) CC 优先去重：同键有 cc 行→用 cc；仅 mirror→archiveOnly=true。
    /// worktree 目录行打 worktreeLabel。mtime 降序 slice limit（§2.4/§6.2）。
    private func ccDedupSummaries(
        rows: [ChatSessionRow], outputHash: (String) -> String, includeUntitled: Bool, limit: Int
    ) -> [ChatSessionSummary] {
        struct Pair { var cc: ChatSessionRow?; var mirror: ChatSessionRow? }
        var byKey: [String: Pair] = [:]
        var order: [String] = []
        for row in rows {
            let oh = outputHash(row.dirName)
            let key = "\(oh)\u{1F}\(row.sessionId)"
            if byKey[key] == nil { byKey[key] = Pair(); order.append(key) }
            if row.source == "cc" {
                byKey[key]!.cc = row
            } else if byKey[key]!.mirror == nil {
                byKey[key]!.mirror = row
            }
        }
        var out: [ChatSessionSummary] = []
        for key in order {
            let pair = byKey[key]!
            if let cc = pair.cc {
                out.append(summary(from: cc, outputProjectHash: outputHash(cc.dirName), archiveOnly: false, includeUntitled: includeUntitled))
            } else if let mirror = pair.mirror {
                out.append(summary(from: mirror, outputProjectHash: outputHash(mirror.dirName), archiveOnly: true, includeUntitled: includeUntitled))
            }
        }
        out.sort { $0.lastModified > $1.lastModified }
        return Array(out.prefix(limit))
    }

    // internal（登记⑪）：ChatStoreLivePage.swift 复用（行→summary 投影单一来源）；语义零动。
    func summary(from row: ChatSessionRow, outputProjectHash: String, archiveOnly: Bool, includeUntitled: Bool) -> ChatSessionSummary {
        // §10：规则目录会话补来源标签（policy nil → 原语义逐字：仅 worktree 子目录打 label）。
        let wtLabel = ChatProjectMerger.parentProjectHash(row.dirName) != nil
            ? ChatProjectMerger.worktreeLabel(fromHash: row.dirName) : autoGrouping?.label(row.dirName)
        // 有效 title（问题5）：includeUntitled 且裸 title 空 → 用 titleFallback（summary/assistant 链）；否则裸 title
        // （dump/双跑面 includeUntitled=false → 恒裸 title，零变化）。
        let effectiveTitle = (includeUntitled && row.title.isEmpty) ? row.titleFallback : row.title
        return ChatSessionSummary(
            sessionId: row.sessionId,
            projectHash: outputProjectHash,
            title: effectiveTitle,
            startedAt: row.startedAt,
            lastModified: Double(row.fileMtimeMs),
            fileSize: Int(row.fileSize),
            cwd: row.cwd,
            worktreeLabel: wtLabel,
            archiveOnly: archiveOnly ? true : nil,
            source: .claudeCode)
    }

    /// §5.4：CC + Codex flat 按 sessionId 去重（首现胜 = CC 优先），lastModified 降序 slice limit。
    private func crossSourceMergeSessions(
        _ cc: [ChatSessionSummary], _ codex: [ChatSessionSummary], limit: Int
    ) -> [ChatSessionSummary] {
        var seen = Set<String>()
        var out: [ChatSessionSummary] = []
        for s in cc + codex where seen.insert(s.sessionId).inserted {
            out.append(s)
        }
        out.sort { $0.lastModified > $1.lastModified }
        return Array(out.prefix(limit))
    }

    // MARK: - messages（§3 详情投影，文件直读；§1.3/§5.4 回查 + CC 先）

    public func messages(projectHash: String, sessionId: String, limit: Int?, reconcile: Bool = true) throws -> [ChatSessionMessage] {
        let (ccFacts, mirrorFacts, worktreeMap) = try facts(reconcile: reconcile)
        var children = worktreeMap[projectHash] ?? []
        if let ctx = autoGroupContext(ccFacts: ccFacts, mirrorFacts: mirrorFacts) {
            children += ctx.ruleDirs(forTarget: projectHash).sorted()  // §10：归组目录并入回查候选（确定序）
        }
        let ccMsgs = readCCSession(projectHash: projectHash, sessionId: sessionId, limit: limit, children: children)
        if !ccMsgs.isEmpty { return ccMsgs }               // §5.4 CC 有则用
        return codexReader?.readSession(sessionId: sessionId, limit: limit) ?? []  // 空落 Codex
    }

    /// CC 会话文件直读（§1.3 回查次序：父目录 → 子目录（worktree/§10 归组目录）→ 镜像）。首个存在的文件命中即投影。
    private func readCCSession(
        projectHash: String, sessionId: String, limit: Int?, children: [String]
    ) -> [ChatSessionMessage] {
        var candidates: [URL] = [ccBase.appendingPathComponent("\(projectHash)/\(sessionId).jsonl")]
        candidates += children.map { ccBase.appendingPathComponent("\($0)/\(sessionId).jsonl") }
        if let mirrorBase {
            candidates.append(mirrorBase.appendingPathComponent("\(projectHash)/\(sessionId).jsonl"))
            candidates += children.map { mirrorBase.appendingPathComponent("\($0)/\(sessionId).jsonl") }
        }
        for url in candidates where FileManager.default.fileExists(atPath: url.path) {
            return projectFile(url: url, sessionId: sessionId, limit: limit)
        }
        return []
    }

    /// 逐行投影一个会话文件（§3）。文件 >2MB 且带 limit → tail 读跳残行、投影后 slice(-limit)（§3.6）。
    private func projectFile(url: URL, sessionId: String, limit: Int?) -> [ChatSessionMessage] {
        let attrs = try? FileManager.default.attributesOfItem(atPath: url.path)
        let size = (attrs?[.size] as? Int) ?? 0
        let lines: [Data]
        if let limit, limit > 0, size > Self.tailThreshold {
            lines = ChatLineIO.allLines(url: url, fromOffset: size - Self.tailThreshold, skipFirst: true)
        } else {
            lines = ChatLineIO.allLines(url: url)
        }
        var decoder = SessionJSONLDecoder()
        var msgs: [ChatSessionMessage] = []
        for line in lines {
            let record = decoder.record(from: line)
            msgs += ChatMessageProjector.project(record: record, fallbackSessionId: sessionId)
        }
        if let limit, limit > 0 { return Array(msgs.suffix(limit)) }
        return msgs
    }

    // MARK: - search（§4 纯复验全扫 chat_search_lines + §5.4 聚合）

    public func search(query: String, reconcile: Bool = true) throws -> [ChatSearchResult] {
        let (ccFacts, mirrorFacts, _) = try facts(reconcile: reconcile)
        let ctx = autoGroupContext(ccFacts: ccFacts, mirrorFacts: mirrorFacts)
        let ccResults = try searchCC(query: query, ctx: ctx)
        let codexResults = codexReader?.search(query) ?? []
        return Array((ccResults + codexResults).prefix(Self.searchResultCap))  // §5.4 slice(0,500)
    }

    /// chat_search_lines 纯复验（§4）：cc 行先占位去重（(parentHash,sessionId)），每 session 按 line_no 序首命中即停。
    /// `ctx`（§10）在场时 projectHash 归一走 normalize（规则目录 → 目标 hash），点击结果落归组条目。
    private func searchCC(query: String, ctx: AutoGroupContext? = nil) throws -> [ChatSearchResult] {
        try database.pool.read { db in
            // cc 先于 mirror（§4.2 CC 先占位）；secondary id 稳定序。
            let sessions = try Row.fetchAll(db, sql: """
                SELECT id, source, dir_name, session_id FROM chat_sessions
                WHERE source IN ('cc','mirror') ORDER BY (source = 'cc') DESC, id ASC
                """)
            var seen = Set<String>()
            var results: [ChatSearchResult] = []
            for sess in sessions {
                let pk: Int64 = sess["id"]
                let dirName: String = sess["dir_name"]
                let sessionId: String = sess["session_id"]
                let normHash = ctx?.normalize(dirName) ?? (ChatProjectMerger.parentProjectHash(dirName) ?? dirName)
                let key = "\(normHash)/\(sessionId)"
                if !seen.insert(key).inserted { continue }  // CC 先占位，mirror 同 session 跳过
                let lines = try Row.fetchAll(db, sql:
                    "SELECT ts, text FROM chat_search_lines WHERE session_pk = ? ORDER BY line_no ASC",
                    arguments: [pk])
                for line in lines {
                    let text: String = line["text"]
                    if let match = SearchPredicate.firstMatch(text: text, query: query) {
                        results.append(ChatSearchResult(
                            projectHash: normHash, sessionId: sessionId,
                            snippet: match.snippet, timestamp: line["ts"]))
                        break  // 每 session 首命中即停
                    }
                }
            }
            return results
        }
    }
}
