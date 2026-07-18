// Chat 服务生产装配 + 七 kind handler（M5 批3；M5-R1 批2 增 delete/setTitle/session.all/进度帧/归档开关）。
// BridgeBus.onChatRequest 落点（chat.request）。
//
// 职责：装配 ChatStore（批2 chat.db 查询面）+ Codex memo + 镜像 + FSEvents watcher，把 chat.request 七 kind
// （projects/sessions/session/search/export/delete/setTitle）路由到 ChatQueryService 查询 + wire 换算（ChatWire），
// 把同步引擎事件（chatSessionUpdate/chatSyncStatus）经 data.event 推 web。
// 写边界（M5-R1 批2 收窄「只读」）：查询五 kind 绝不写 CC/Codex 源；delete 是唯一 CC 源写点（硬删两处正本，
// 用户拍板 2026-07-07）且绝不碰 ~/.codex；setTitle 只写数据根 chat-custom-titles.json。
//
// ⚠️ 首开异步化（批2 登记 MAJOR）：ChatStore 首次 reconcile（CC 冷首建 ~18s）+ Codex buildIndex（~36s 全量重读）
// 绝不阻塞面板查询路径。前台查询一律 `reconcile:false`（只扫目录 + 读现有 chat.db 缓存/空态，即刻返回）；
// 后台 warmup 另跑 reconcile + Codex prime，完成经 chatSyncStatus 翻牌 idle → web 复取。冷库 projects 首调
// 不阻塞在 Codex prime 上（ChatAssemblyTests.firstOpenProjectsDoesNotBlockOnCodexPrime 因果断言：返回先于 prime 完成）。
//
// 装配层零 UI 依赖（取注入 push 闭包）：AppDelegate.assembleChatServices 构造 + 接 composite.onChatRequest /
// onPushEvent = composite.pushDataEvent。装配失败 = 降级（chat 面回 rejected(INTERNAL)），终端主功能照常。
import AppKit
import Foundation
import MuxvoBridge
import MuxvoChatHistory
import MuxvoStorage

// MARK: - 查询引擎（Sendable，后台执行器上跑；无 actor 隔离，纯 I/O + 换算）

/// chat.request 七 kind 的实际执行体：查询 ChatQueryService（reconcile:false 快路）→ wire 换算 → ChatResponse。
/// 分页 keyset（§7.3）：sessions 向下 `lastModifiedMs:sessionId`；messages 向上 before=uuid；缺 cursor = 到头。
struct ChatQueryEngine: Sendable {
    let store: ChatStore
    let codexMemo: MemoizingCodexSource
    let mirror: ChatMirror?
    let syncStateURL: URL
    let exportDir: URL
    /// CC 根 `~/.claude`（ccBase 的父）——ccDetected 判据（§7.6 noCC = 该目录不存在）。
    let claudeRoot: URL
    /// 自定义标题 store（M5-R1 批2）：sessions 响应 wire 层叠加 customTitle + setTitle/delete 写。与
    /// TerminalService.chatTitlesStore 同一实例（AppDelegate 装配）。nil = 未装配（叠加缺席、setTitle 拒绝）。
    let titlesStore: ChatCustomTitlesStore?
    /// 一次性归档迁移器（dogfood-r5 PR-4）：per-分身 legacy 镜像（`<dataRoot>/chat-history/`）→ 中心化
    /// 共享池，warmup/archiveBackfill 开头调（marker 后短路 no-op）。nil = 未注入（测试直造 engine 无迁移；
    /// 生产/e2e 经 make 恒注入）。
    let migrator: ChatArchiveMigrator?
    /// per-分身 legacy 镜像根（PR-4 换根后 delete 第三候选根，硬删本分身残留 legacy 镜像；三根拍板 2026-07-07）。
    /// nil = 无 legacy 根（测试直造 engine；生产经 make 注入 `<dataRoot>/chat-history/`）。
    let legacyMirrorRoot: URL?
    /// M7 升级迁移（legacy-migration.md）：老版 Electron 归档（`~/.muxvo/chat-archive/`）→ 共享池的第二
    /// 迁移器，warmup/archiveBackfill 在 PR-4 迁移后调（独立 marker 短路；源缺失 → 引擎空扫 seal，等价
    /// 「检测存在才跑」）。nil = 功能关（测试/e2e 不传；共享根被覆盖的隔离分身装配层传 nil，marker 不落）。
    let legacyArchiveMigrator: ChatArchiveMigrator?

    static let pageSize = 50

    /// 显式 init（PR-4 加 migrator/legacyMirrorRoot 两参、M7 升级迁移加 legacyArchiveMigrator，尾置带默认
    /// nil——既有直造 engine 的测试调用点零改动；make 装配显式传注入迁移器 + legacy 根）。
    init(
        store: ChatStore, codexMemo: MemoizingCodexSource, mirror: ChatMirror?,
        syncStateURL: URL, exportDir: URL, claudeRoot: URL,
        titlesStore: ChatCustomTitlesStore?,
        migrator: ChatArchiveMigrator? = nil, legacyMirrorRoot: URL? = nil,
        legacyArchiveMigrator: ChatArchiveMigrator? = nil
    ) {
        self.store = store
        self.codexMemo = codexMemo
        self.mirror = mirror
        self.syncStateURL = syncStateURL
        self.exportDir = exportDir
        self.claudeRoot = claudeRoot
        self.titlesStore = titlesStore
        self.migrator = migrator
        self.legacyMirrorRoot = legacyMirrorRoot
        self.legacyArchiveMigrator = legacyArchiveMigrator
    }

    // MARK: 路由

    func handle(_ request: ChatRequest) -> ChatResponse {
        do {
            switch request {
            case .projects:
                return try projects()
            case let .sessions(projectHash, cursor):
                return try sessionsPage(projectHash: projectHash, cursor: cursor)
            case let .session(projectHash, sessionId, before, all):
                // all=true（M5-R1 批2）：忽略 before 游标一次性返回整会话（搜索态/回到顶部/整段复制）；
                // 缺席/false = 既有 before 游标分页。
                if all == true {
                    return try messagesAll(projectHash: projectHash, sessionId: sessionId)
                }
                return try messagesPage(projectHash: projectHash, sessionId: sessionId, before: before)
            case let .search(query):
                return try search(query: query)
            case let .export(projectHash, sessionId, format):
                return try export(projectHash: projectHash, sessionId: sessionId, format: format)
            case let .delete(projectHash, sessionId):
                return try delete(projectHash: projectHash, sessionId: sessionId)
            case let .setTitle(sessionId, title):
                return setTitle(sessionId: sessionId, title: title)
            }
        } catch {
            // 业务失败经类型化 rejected（不占信封错误，bridge-v1 §9）。
            return .rejected(code: "INTERNAL", message: String(describing: error))
        }
    }

    // MARK: projects（§7.1）

    private func projects() throws -> ChatResponse {
        let infos = try store.projects(reconcile: false)
        let detected = FileManager.default.fileExists(atPath: claudeRoot.path)
        return .projects(projects: infos.map(ChatWire.projectView), ccDetected: detected)
    }

    // MARK: sessions（中栏，keyset 向下 §7.3）

    private func sessionsPage(projectHash: String?, cursor: String?) throws -> ChatResponse {
        let isAll = (projectHash == nil || projectHash == "__all__")
        // cursor 缺席 = 首页；提供但畸形/被篡改 = rejected（不静默重发首页 → 客户端重复追加/循环）。
        // 解析/编码留 wire 层（游标格式所有权）；合法但越界 → store 侧 keyset 天然空页 + hasMore=false
        // （与老内存切片 `idx ?? sorted.count` 语义等价）。
        var after: LiveSessionCursor?
        if let cursor {
            guard let parsed = Self.parseSessionCursor(cursor) else {
                return .rejected(code: "BAD_CURSOR", message: "malformed sessions cursor")
            }
            after = parsed
        }
        // 生产 live 面走 liveSessionsPage（登记⑪ 下推：keyset 窗口 + SQL 索引，免全表捞 + 内存排序切片；
        // 恒 includeUntitled:true——保留空 title 会话、有效 title 走 titleFallback，问题5 口径不变）。
        // 输出已是 (sortKeyMs DESC, sessionId DESC) wire 全序，无需再排。dump/双跑面仍走老
        // sessions/allRecentSessions，两面刻意分叉（chat-data.md 登记⑥ 先例、登记⑪ 边界）。
        let (page, hasMore) = try store.liveSessionsPage(
            projectHash: isAll ? nil : projectHash!, after: after, pageSize: Self.pageSize)
        let next = (hasMore && !page.isEmpty) ? encodeSessionCursor(page[page.count - 1]) : nil
        // customTitle 叠加只在 wire 层（M5-R1 批2）：ChatStore 输出是双跑对照面，绝不带 customTitle。
        return .sessions(
            sessions: page.map { ChatWire.sessionView($0, customTitle: titlesStore?.get($0.sessionId)) },
            nextCursor: next)
    }

    /// keyset 排序/游标统一主键（§7.3）：lastModified 截整数毫秒。排序、encode、compare、**下推谓词**
    /// 四处同键（委托 ChatStore.liveSortKeyMs 单一来源，登记⑪）——杜绝「全精度 Double 排序 vs 整数游标」
    /// 口径漂移（页边界静默丢会话）。真实数据 lastModified 恒整数（PosixStat 整毫秒），此截断为恒等。
    private static func sortKeyMs(_ s: ChatSessionSummary) -> Int {
        ChatStore.liveSortKeyMs(s.lastModified)
    }

    private func encodeSessionCursor(_ s: ChatSessionSummary) -> String {
        "\(Self.sortKeyMs(s)):\(s.sessionId)"
    }

    /// cursor（`lastModifiedMs:sessionId`）解析（登记⑪：下标定位退役，keyset 谓词下推 store）。
    /// 畸形（无 `:` / lm 非整数 / sessionId 空）→ nil（调用侧 rejected）；合法性规则与退役前逐字同。
    private static func parseSessionCursor(_ cursor: String) -> LiveSessionCursor? {
        guard let sep = cursor.firstIndex(of: ":"),
              let clm = Int(cursor[cursor.startIndex..<sep])
        else { return nil }
        let csid = String(cursor[cursor.index(after: sep)...])
        guard !csid.isEmpty else { return nil }
        return LiveSessionCursor(mtimeMs: clm, sessionId: csid)
    }

    // MARK: session/messages（右栏，反向 keyset 向上 §7.3）

    private func messagesPage(projectHash: String, sessionId: String, before: String?) throws -> ChatResponse {
        // 文件直读（不进 DB）；投影顺序即文件序（chat-data §8.2 消息不排序）。
        let all = try store.messages(projectHash: projectHash, sessionId: sessionId, limit: nil, reconcile: false)
        // before = 当前最旧已加载消息 uuid；向上补更早 pageSize 条。缺 before = 取最近 pageSize。
        let upperExclusive: Int
        if let before {
            upperExclusive = all.firstIndex { $0.uuid == before } ?? 0  // 未找到 → 视为到头（older 空）
        } else {
            upperExclusive = all.count
        }
        let older = all[0..<upperExclusive]
        let page = Array(older.suffix(Self.pageSize))
        let hasEarlier = page.count < older.count
        // prevCursor 缺席 = 到头（§7.3 顶部 all-loaded）。指向本页最旧一条 uuid，供下次 before 请求。
        let prev = (hasEarlier && !page.isEmpty) ? page[0].uuid : nil
        return .messages(messages: page.map(ChatWire.messageView), prevCursor: prev)
    }

    /// session.all=true（M5-R1 批2）：limit:nil 全量返回整会话（数据层既有语义，ChatStoreTests 锚 CC 250/
    /// Codex 120 全返）。响应不带 prevCursor（协议定稿：全量即到头，web 无需再向上翻页）。
    private func messagesAll(projectHash: String, sessionId: String) throws -> ChatResponse {
        let all = try store.messages(projectHash: projectHash, sessionId: sessionId, limit: nil, reconcile: false)
        return .messages(messages: all.map(ChatWire.messageView), prevCursor: nil)
    }

    // MARK: delete（M5-R1 批2；硬删两处正本，用户拍板 2026-07-07）

    /// 会话硬删：CC 源文件（父目录 + worktree 子目录，readCCSession §1.3 同款拼法）+ 镜像文件 +
    /// `ChatDatabase.deleteSession`（chat_search_lines 靠 CASCADE 随删）+ 自定义标题清除。
    ///  - 任一文件真删成功或 DB 真删行 → `.deleted(sessionId)`（装配层复用 chatSessionUpdate 失效通道）。
    ///  - CC 面（文件+DB）全无而 Codex 识得 → `rejected(UNSUPPORTED_SOURCE)`（本批不碰 ~/.codex，用户拍板；
    ///    source 判定沿 engine 既有惯例 = CC 先、空落 Codex，§5.4——codex 会话 CC 双侧必空，不会误删）。
    ///  - 两侧都不识 → `rejected(NOT_FOUND)`。removeItem 的 I/O 异常经 handle 外层 catch → rejected(INTERNAL)。
    private func delete(projectHash: String, sessionId: String) throws -> ChatResponse {
        // 路径分量白名单（防注入：两分量都拼进 removeItem 路径）。非法 → 与「不存在」同响应面。
        guard Self.isSafePathComponent(projectHash), Self.isSafePathComponent(sessionId) else {
            return .rejected(code: "NOT_FOUND", message: "非法 projectHash/sessionId")
        }
        var removedFile = false
        for url in deleteCandidates(projectHash: projectHash, sessionId: sessionId)
        where FileManager.default.fileExists(atPath: url.path) {
            try FileManager.default.removeItem(at: url)
            removedFile = true
        }
        let removedRow = try store.database.deleteSession(sessionId: sessionId)
        if removedFile || removedRow {
            titlesStore?.remove(sessionId)
            return .deleted(sessionId: sessionId)
        }
        if !codexMemo.readSession(sessionId: sessionId, limit: 1).isEmpty
            || codexMemo.getAllRecentSessions(limit: .max).contains(where: { $0.sessionId == sessionId }) {
            return .rejected(code: "UNSUPPORTED_SOURCE", message: "Codex 会话本批不支持删除（不写 ~/.codex）")
        }
        return .rejected(code: "NOT_FOUND", message: "会话不存在：\(sessionId)")
    }

    /// 删除候选路径（readCCSession §1.3 同款拼法）：每根（CC 源 + 共享池 + legacy 镜像）各 `<projectHash>/<sid>.jsonl` +
    /// 全部 worktree 子目录 `<child>/<sid>.jsonl`（child = 一级目录名 parentProjectHash == projectHash，
    /// 与 worktreeMap 同判据；目录直扫代替私有 facts()，语义一致）+ §10 归组目录（projectHash 为归组目标时，
    /// 命中规则的一级目录也是子——否则 RelPad 组内会话删除找不到文件）。
    private func deleteCandidates(projectHash: String, sessionId: String) -> [URL] {
        let fileName = "\(sessionId).jsonl"
        // 三根硬删（用户 2026-07-07 拍板）：CC 源 + 共享归档池（PR-4 起 mirrorBase 即池）+ per-分身 legacy
        // 镜像残留（换根后 legacy 不再是主镜像，但删除须一并清本分身旧副本，否则删后本分身 reader 仍见）。
        var roots: [URL] = [store.ccBase]
        if let mirrorBase = store.mirrorBase { roots.append(mirrorBase) }
        if let legacyMirrorRoot { roots.append(legacyMirrorRoot) }
        // §10：目标判定一次（matches 按目录名逐一判，覆盖三根各自独有的规则目录）。
        let groupPolicy = store.isAutoGroupTarget(projectHash) ? store.autoGrouping : nil
        var out: [URL] = []
        for root in roots {
            out.append(root.appendingPathComponent(projectHash, isDirectory: true)
                .appendingPathComponent(fileName, isDirectory: false))
            let subdirs = (try? FileManager.default.contentsOfDirectory(atPath: root.path)) ?? []
            for child in subdirs.sorted()
            where ChatProjectMerger.parentProjectHash(child) == projectHash
                || groupPolicy?.matches(child) == true {
                out.append(root.appendingPathComponent(child, isDirectory: true)
                    .appendingPathComponent(fileName, isDirectory: false))
            }
        }
        return out
    }

    /// 路径分量白名单：非空、无分隔符/NUL、非 `.`/`..`（projectHash/sessionId 都拼进文件路径）。
    static func isSafePathComponent(_ s: String) -> Bool {
        !s.isEmpty && !s.contains("/") && !s.contains("\0") && s != "." && s != ".."
    }

    // MARK: setTitle（M5-R1 批2；老版 sessionCustomTitles 对等）

    /// 设置/清除自定义标题：写 ChatCustomTitlesStore（trim 后空/缺席 = 清除，与终端重命名正向链同口径）→ .ok。
    private func setTitle(sessionId: String, title: String?) -> ChatResponse {
        guard let titlesStore else {
            return .rejected(code: "UNAVAILABLE", message: "标题存储未装配")
        }
        let trimmed = title?.trimmingCharacters(in: .whitespacesAndNewlines)
        titlesStore.set(sessionId, title: (trimmed?.isEmpty == false) ? trimmed : nil)
        return .ok
    }

    // MARK: search（§7.4）

    private func search(query: String) throws -> ChatResponse {
        let results = try store.search(query: query, reconcile: false)
        return .search(results: results.map(ChatWire.searchHit))
    }

    // MARK: export（CHAT_L1_06；落数据根 exports/）

    private func export(projectHash: String, sessionId: String, format: ChatExportFormat) throws -> ChatResponse {
        let msgs = try store.messages(projectHash: projectHash, sessionId: sessionId, limit: nil, reconcile: false)
        // 文件名/markdown H1 沿用会话标题（REQ-CHAT_SYNC-014/015；legacy chat-handlers export = `title || sessionId`，
        // 文件名截 50 + 非法字符 `/\:*?"<>|`→`_`）。协议 export 不携 title → 从 chat.db sessions 缓存按 sessionId 反查；
        // 缺/空（未 warmup / Codex 项目 / 空标题）→ 裸 sessionId 兜底（与 legacy title 缺席分支一致）。
        let title = sessionTitle(projectHash: projectHash, sessionId: sessionId)
        let content: Data
        let ext: String
        switch format {
        case .json:
            content = ChatWire.exportJSON(messages: msgs); ext = "json"
        case .markdown:
            content = Data(ChatWire.exportMarkdown(messages: msgs, title: title ?? sessionId).utf8); ext = "md"
        }
        let name = title.map { ChatWire.sanitizeFileName($0, fallback: sessionId) } ?? sessionId
        try FileManager.default.createDirectory(at: exportDir, withIntermediateDirectories: true)
        let outURL = exportDir.appendingPathComponent("\(name).\(ext)", isDirectory: false)
        try content.write(to: outURL)
        return .exported(outputPath: outURL.path)
    }

    /// export 用会话标题反查（chat.db sessions 缓存，CC 面）。空/缺/失败 → nil（调用侧 sessionId 兜底）。
    /// 反查 CC-only：Codex 会话不在 store.sessions → 落 sessionId 兜底（native 无 Codex title 反查，属预期）。
    private func sessionTitle(projectHash: String, sessionId: String) -> String? {
        // includeUntitled:true（问题5）：空 title 会话也反查得到（hit.title = 有效 title = fallback）；仍空则 nil→sessionId 兜底。
        guard let hit = try? store.sessions(projectHash: projectHash, limit: .max, includeUntitled: true, reconcile: false)
            .first(where: { $0.sessionId == sessionId }), !hit.title.isEmpty
        else { return nil }
        return hit.title
    }

    // MARK: 后台同步（warmup / refresh / 增量镜像）

    /// 首开后台预热：全量镜像 + reconcile chat.db + Codex prime。返回 (同步条状态, lastSyncMs)。
    /// `archive=false`（M5-R1 批2 归档开关）：跳过 mirror.fullScan（停排新归档），reconcile + prime 照跑
    /// ——查询面不残废（chat.db/Codex 缓存照常新鲜）。`onProgress` = fullScan 进度回调（节流在推送层）。
    func warmup(archive: Bool = true, onProgress: ((Int, Int) -> Void)? = nil) -> (ChatSyncStatus, Int?) {
        // PR-4：迁移**先于本进程一切 reconcile/fullScan**（legacy 镜像 → 共享池），**不受 archive 门控**
        // ——关档也须把历史迁进池（否则该分身 legacy 独有会话永远进不了共享库）。marker 后短路 no-op。
        _ = migrator?.migrateIfNeeded()
        // M7 升级迁移：老版归档并池（独立 marker）。与上行顺序无关紧要——两迁移共用 shouldReplace
        // (floorSec(mtime),size) 新者胜，终态不随执行序变；仍须先于 fullScan/reconcile，老会话当轮入库。
        _ = legacyArchiveMigrator?.migrateIfNeeded()
        let mirrorResult = archive ? mirror?.fullScan(onProgress: onProgress) : nil
        let reconcileOK = ((try? store.reconcile()) != nil)
        codexMemo.prime()
        return (syncStatus(mirrorResult: mirrorResult, reconcileOK: reconcileOK), lastSyncMs())
    }

    /// 归档开关翻开的补扫（archiveToggled(true)）：fullScan + reconcile（把补镜像的行写进 chat.db），
    /// 不重 prime Codex（开关只管归档，Codex 缓存与之无关）。
    func archiveBackfill(onProgress: ((Int, Int) -> Void)? = nil) -> (ChatSyncStatus, Int?) {
        _ = migrator?.migrateIfNeeded()  // PR-4：补扫路径同样保证迁移先于 reconcile（marker 后 no-op）
        _ = legacyArchiveMigrator?.migrateIfNeeded()  // M7 升级迁移：同 warmup（marker 后 no-op）
        let mirrorResult = mirror?.fullScan(onProgress: onProgress)
        let reconcileOK = ((try? store.reconcile()) != nil)
        return (syncStatus(mirrorResult: mirrorResult, reconcileOK: reconcileOK), lastSyncMs())
    }

    /// 变化后刷新：reconcile 增量（+ 可选 Codex reprime）。镜像增量由 archive(...) 逐会话完成，此处不 fullScan。
    /// forceMirror:false（登记⑩）：mirror 道按 DirFactMemo 计划——池未变跳过、变过只对账脏目录；
    /// warmup/archiveBackfill 保持默认 force 全量（低频 + 完成后 requestFull 下轮自愈）。
    func refresh(reprimeCodex: Bool) -> (ChatSyncStatus, Int?) {
        let reconcileOK = ((try? store.reconcile(forceMirror: false)) != nil)
        if reprimeCodex { codexMemo.prime() }
        return (reconcileOK ? .idle : .error, lastSyncMs())
    }

    /// 单会话增量镜像（§6.1 仅增不删；FSEvents 触发）。best-effort，失败静默。
    func archive(projectHash: String, sessionId: String) {
        _ = mirror?.archiveSession(projectHash: projectHash, sessionId: sessionId)
    }

    private func syncStatus(mirrorResult: ChatMirror.SyncResult?, reconcileOK: Bool) -> ChatSyncStatus {
        if mirrorResult?.mode == .readonly { return .error }  // §6.4 只读降级 → 同步暂停（§7.5）
        return reconcileOK ? .idle : .error
    }

    /// 同步条 lastSyncMs 来源（§7.5）：sync-state.json.lastSync ISO → ms；缺失/损坏 → nil。
    private func lastSyncMs() -> Int? {
        guard let state = ChatSyncState.load(from: syncStateURL) else { return nil }
        let ms = ChatWire.millis(fromISO: state.lastSync)
        return ms == 0 ? nil : ms
    }
}

// MARK: - 装配 + 生命周期（@MainActor：push 闭包与握手侧同域）

@MainActor
public final class ChatAssembly {
    /// Chat 查询/warmup 的阻塞 I/O（reconcile 18s / Codex 36s）**一律走 GCD 弹性池**，绝不用 Task.detached
    /// （Swift 协作线程池按核数封顶，阻塞 I/O 会饿死全进程 async 工作——含 UI 其他桥请求）。concurrent：warmup
    /// 与前台查询并行、彼此不阻。
    private static let workQueue = DispatchQueue(
        label: "com.muxvo.chat.engine", qos: .userInitiated, attributes: .concurrent)

    let engine: ChatQueryEngine
    private let ccProjectsRoot: URL
    private let codexRoot: URL?
    private var watcher: ChatSourceWatcher?
    /// data.event 出口（AppDelegate 接 composite.pushDataEvent）。nil = 未接线（推送丢弃，查询仍可用）。
    public var onPushEvent: (@MainActor (DataEvent) -> Void)?
    /// setTitle 成功副作用（chat-history.md W8 双向同步）：AppDelegate 接 TerminalService
    /// `applyChatTitleToAnchoredTerminal`——该 sid 正锚定在开着的终端 → tile 名跟随。参数 = trim 后
    /// 标题（nil = 已清除）。nil 回调 = 未接线（单向，历史记录自身仍改）。
    public var onCustomTitleSet: (@MainActor (String, String?) -> Void)?
    private var didStartWarmup = false
    // 同步单飞态（P0 风暴修复）：warmup/refresh 共用一个「至多 1 在飞 + 1 排队」槽，prime 绝不并发。
    // 全部 @MainActor 读写（触发点与 onDone 收尾均主 actor），零锁。archiveBackfill 刻意不进槽
    // （不携 prime、仅用户显式开关触发、DB 访问由 GRDB 串行化）。
    private var warmupInFlight = false
    private var refreshInFlight = false
    private var pendingWarmup = false
    /// nil = 无 pending；non-nil = 在飞任务收尾后补跑一次 refresh（值 = 各触发 reprimeCodex 的 OR 合并）。
    private var pendingRefreshReprime: Bool?
    /// 聊天自动归档开关（M5-R1 批2；AppDelegate 接 ConfigStore.chatArchiveEnabled）。恒 true 缺省 = 既有
    /// 行为。触发点（warmup/FSEvent/toggled）全在 @MainActor 求值，故取主 actor 闭包（可安全读 ConfigModel）。
    public var archiveEnabled: @MainActor () -> Bool = { true }
    /// export 成功后 Finder reveal（M5-R1 批2，FsService.swift revealInFinder 先例）。
    /// 测试注入假闭包断言被调，不真开 Finder。
    var revealInFinder: @MainActor (String) -> Void = { path in
        NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)])
    }
    /// 归档进度帧节流时钟（毫秒；测试注入假时钟得确定性节流断言）。
    var progressNowMs: @Sendable () -> Int = { Int(Date().timeIntervalSince1970 * 1000) }

    init(engine: ChatQueryEngine, ccProjectsRoot: URL, codexRoot: URL?) {
        self.engine = engine
        self.ccProjectsRoot = ccProjectsRoot
        self.codexRoot = codexRoot
    }

    /// 生产装配：chat.db（数据根 state/）+ 镜像/读回指**中心化共享归档池**（dogfood-r5 PR-4）+ Codex memo
    /// （~/.codex）。throws = chat.db 打开失败（AppDelegate do-catch 降级）。`titlesStore` 与
    /// TerminalService.chatTitlesStore 同一实例（AppDelegate 构造注入；customTitle wire 叠加 + setTitle/delete 写端）。
    ///
    /// `sharedArchiveRoot`（**必填无默认**——编译期强制每个调用方显式决定，防测试/e2e 静默污染真实共享池
    /// 第一道防线；生产由 AppDelegate 传 `DataDirectory` 的共享归档根权威访问器，e2e 传 tmp 下隔离根）：ChatStore.mirrorBase
    /// 与 ChatMirror.mirrorRoot 均换指此根（所有 Muxvo 分身共用镜像，CC 30 天清理后永不丢）。sync-state 与
    /// marker/迁移 legacy 源 **留 per-分身**（各分身独立迁移自己的 legacy 镜像；首分身 seal 不影响其余分身补迁）。
    ///
    /// `legacyMuxvoArchiveRoot`（M7 升级迁移，legacy-migration.md）：老版 Electron 归档根（生产 =
    /// `~/.muxvo/chat-archive/`，AppDelegate 经 DataDirectory 派生并做覆盖门控）。**默认 nil = 功能关**
    /// ——e2e/单测直造 make 不传，结构上不可能把真实老归档吸进隔离池（防线一）。
    public static func make(
        dataRoot: URL, claudeRoot: URL, codexRoot: URL?, sharedArchiveRoot: URL,
        titlesStore: ChatCustomTitlesStore? = nil,
        legacyMuxvoArchiveRoot: URL? = nil
    ) throws -> ChatAssembly {
        let ccBase = claudeRoot.appendingPathComponent("projects", isDirectory: true)
        let db = try ChatDatabase.open(at: DataDirectory.chatDatabaseURL(under: dataRoot))
        let memo = MemoizingCodexSource(codexBase: codexRoot)
        let legacyMirrorRoot = DataDirectory.chatHistoryDirectoryURL(under: dataRoot)  // per-分身 legacy（迁移源 + delete 第三根）
        let store = ChatStore(
            ccBase: ccBase,
            mirrorBase: sharedArchiveRoot,  // PR-4：镜像写 + 读回都指共享归档池
            codexBase: codexRoot, database: db, codexSource: memo,
            displayPathMemo: DisplayPathMemo(),  // 问题5：cc/mirror scanner 共用，免每查询/FSEvent 重读首 .jsonl 取 cwd
            mirrorDirFactMemo: DirFactMemo(),  // 登记⑩：共享池目录 mtime 备忘（池 12 万文件级后每轮全量 stat
            // = CPU 风暴）；只作用 mirror scanner，refresh 道 reconcile(forceMirror:false) 按脏目录增量对账
            autoGrouping: .standard)  // §10 生产道自动归组（RelPad hub + Penraft 渲染器等后台工具的
            // 临时目录会话塌缩进各自项目条目）；dump/双跑（ChatStoreReader）不传 → legacy 对齐面零动
        let mirror = ChatMirror(
            sourceRoot: ccBase, mirrorRoot: sharedArchiveRoot,
            syncStateURL: DataDirectory.chatSyncStateURL(under: dataRoot))  // sync-state 留 per-分身
        let migrator = ChatArchiveMigrator(
            legacyRoot: legacyMirrorRoot, sharedRoot: sharedArchiveRoot,
            markerURL: DataDirectory.chatArchiveMigrationMarkerURL(under: dataRoot))  // marker per-分身
        let legacyArchiveMigrator = legacyMuxvoArchiveRoot.map {  // M7 升级迁移：nil = 功能关
            ChatArchiveMigrator(
                legacyRoot: $0, sharedRoot: sharedArchiveRoot,
                markerURL: DataDirectory.legacyChatArchiveMigrationMarkerURL(under: dataRoot))
        }
        let engine = ChatQueryEngine(
            store: store, codexMemo: memo, mirror: mirror,
            syncStateURL: DataDirectory.chatSyncStateURL(under: dataRoot),
            exportDir: DataDirectory.chatExportsDirectoryURL(under: dataRoot),
            claudeRoot: claudeRoot, titlesStore: titlesStore,
            migrator: migrator, legacyMirrorRoot: legacyMirrorRoot,
            legacyArchiveMigrator: legacyArchiveMigrator)
        return ChatAssembly(engine: engine, ccProjectsRoot: ccBase, codexRoot: codexRoot)
    }

    /// BridgeBus.onChatRequest 落点。首次调用触发后台 warmup（不阻塞本次返回）；查询本身在后台执行器跑
    /// （@MainActor 在 await 期释放，UI 不卡）。
    public func handle(_ request: ChatRequest) async -> ChatResponse {
        ensureWarmupStarted()
        let response = await runOnEngine { $0.handle(request) }
        applyResponseSideEffects(request: request, response: response)
        return response
    }

    /// 响应后置副作用（M5-R1 批2；await 后回 @MainActor 执行）：delete 成功 → 复用 chatSessionUpdate 失效
    /// 通道（web 复取列表）；export 成功 → Finder reveal（revealInFinder 可注入）。查询响应无副作用。
    private func applyResponseSideEffects(request: ChatRequest, response: ChatResponse) {
        switch response {
        case let .deleted(sessionId):
            guard case let .delete(projectHash, _) = request else { return }
            onPushEvent?(.chatSessionUpdate(projectHash: projectHash, sessionId: sessionId))
        case let .exported(outputPath):
            revealInFinder(outputPath)
        case .ok:
            // setTitle 成功 → 反向同步回调（W8 双向）。trim 口径同 engine setTitle（:261），保回调值与
            // store 落盘值一致。chatTitleUpdate 推送不在此发——由 titlesStore.onChange 单点发（等值 no-op
            // 时此处会重复触发但 store 不会，推送面以 store 为准）。
            guard case let .setTitle(sessionId, title) = request else { return }
            let trimmed = title?.trimmingCharacters(in: .whitespacesAndNewlines)
            onCustomTitleSet?(sessionId, (trimmed?.isEmpty == false) ? trimmed : nil)
        default:
            break
        }
    }

    /// 前台查询在 GCD 弹性池执行（@MainActor 在 await 期释放，UI 不卡；阻塞 I/O 不占协作池）。
    private func runOnEngine<T: Sendable>(_ work: @Sendable @escaping (ChatQueryEngine) -> T) async -> T {
        let engine = self.engine
        return await withCheckedContinuation { cont in
            Self.workQueue.async { cont.resume(returning: work(engine)) }
        }
    }

    /// 起 FSEvents 监 CC 源 + Codex 源（§7.2 外部续写 → chatSessionUpdate；§6.1 增量镜像）。AppDelegate 接线后调。
    public func start() {
        let w = ChatSourceWatcher(
            ccProjectsRoot: ccProjectsRoot, codexRoot: codexRoot
        ) { [weak self] changes, codexChanged in
            // watcher 后台队列触发 → hop main（onPushEvent @MainActor），仿 ResourceWatcher 先例。
            DispatchQueue.main.async {
                MainActor.assumeIsolated {
                    self?.onSourceChanged(changes, codexChanged: codexChanged)
                }
            }
        }
        w.start()
        watcher = w
    }

    /// 面板关闭/退出：停 FSEvents（§7.6 退订）。
    public func stop() {
        watcher?.stop()
        watcher = nil
    }

    // MARK: - 内部：warmup / 归档开关 / 变化刷新 / 同步条推送

    private func ensureWarmupStarted() {
        guard !didStartWarmup else { return }
        didStartWarmup = true
        guard !refreshInFlight else { pendingWarmup = true; return }  // refresh 在飞：排队（prime 不并发）
        startWarmup()
    }

    private func startWarmup() {
        warmupInFlight = true
        let archive = archiveEnabled() // 主 actor 求值一次，随任务下队（关 = 跳 fullScan，查询面照常）
        runSyncTask(
            { engine, sink in engine.warmup(archive: archive, onProgress: sink.onProgress) },
            onDone: { [weak self] in
                guard let self else { return }
                self.warmupInFlight = false
                self.drainPendingSync()
            })
    }

    /// refresh 单飞+合并（P0 风暴修复）：在飞（含 warmup）期间的触发只置 pending（reprimeCodex OR
    /// 合并、**零围栏帧**），收尾后至多补跑一次——FSEvents 再密也至多 1 在飞 + 1 排队，全量 prime
    /// 绝不并发堆叠（2026-07-08 采样档：无此门时 12 线程并行全量扫 597MB = 264% CPU 稳态）。
    private func scheduleRefresh(reprimeCodex: Bool) {
        if refreshInFlight || warmupInFlight {
            pendingRefreshReprime = (pendingRefreshReprime ?? false) || reprimeCodex
            return
        }
        refreshInFlight = true
        runSyncTask(
            { engine, _ in engine.refresh(reprimeCodex: reprimeCodex) },
            onDone: { [weak self] in
                guard let self else { return }
                self.refreshInFlight = false
                self.drainPendingSync()
            })
    }

    /// 在飞任务收尾后的排队消化：pendingWarmup 优先（至多一次；pending refresh 留到 warmup 收尾
    /// 再消化）；否则补跑至多一次 refresh。
    private func drainPendingSync() {
        if pendingWarmup {
            pendingWarmup = false
            startWarmup()
            return
        }
        guard let reprime = pendingRefreshReprime else { return }
        pendingRefreshReprime = nil
        scheduleRefresh(reprimeCodex: reprime)
    }

    /// 归档开关翻转（M5-R1 批2；config patch 命中 archiveEnabled 时 AppDelegate 转调）：
    /// 开 → 立即补一轮 fullScan（把停摆期漏掉的会话补进镜像）；关 → 只停新任务（后续触发点读
    /// archiveEnabled() 即跳），在飞 fullScan 不打断（仅增不删，跑完无害）。
    public func archiveToggled(enabled: Bool) {
        guard enabled else { return }
        runSyncTask { engine, sink in engine.archiveBackfill(onProgress: sink.onProgress) }
    }

    /// 源变化（FSEvents 去抖后）：逐 CC 会话增量镜像（归档开关关 = 跳过，失效通道照推）+ 定向
    /// chatSessionUpdate；再经单飞槽 refresh（reconcile 增量 + 视 Codex 变化 reprime）翻同步条。
    /// internal：FSEvents watcher hop main 后同路；测试直调（watcher per-key 去抖已单测，此处只测门）。
    func onSourceChanged(_ changes: [ChatSourceChange], codexChanged: Bool) {
        let engine = self.engine
        let archive = archiveEnabled()
        for c in changes {
            if archive {
                Self.workQueue.async { engine.archive(projectHash: c.projectHash, sessionId: c.sessionId) }
            }
            onPushEvent?(.chatSessionUpdate(projectHash: c.projectHash, sessionId: c.sessionId))
        }
        scheduleRefresh(reprimeCodex: codexChanged)
    }

    /// 同步条围栏：推 syncing → GCD 弹性池跑 work → hop main 推终态（idle/error + lastSyncMs）。§7.5。
    /// 归档进度帧（M5-R1 批2，chat-data 冻结面登记③「节流归装配」）：work 把 sink.onProgress 接给
    /// mirror.fullScan——sink 按 ≥1s 节流推 syncing(synced,total)、末帧无条件；终态帧带末值。
    /// `onDone`（P0 风暴修复）：终态帧推送后在主 actor 调（单飞槽清位 + 排队消化用）；不传 = 零变化。
    private func runSyncTask(
        _ work: @Sendable @escaping (ChatQueryEngine, ChatSyncProgressSink) -> (ChatSyncStatus, Int?),
        onDone: (@MainActor @Sendable () -> Void)? = nil
    ) {
        onPushEvent?(.chatSyncStatus(status: .syncing, lastSyncMs: nil, synced: nil, total: nil))
        let engine = self.engine
        let sink = ChatSyncProgressSink(nowMs: progressNowMs) { [weak self] synced, total in
            Task { @MainActor in
                self?.onPushEvent?(.chatSyncStatus(status: .syncing, lastSyncMs: nil, synced: synced, total: total))
            }
        }
        Self.workQueue.async { [weak self] in
            let (status, ms) = work(engine, sink)
            let last = sink.lastFrame
            Task { @MainActor in
                self?.onPushEvent?(
                    .chatSyncStatus(status: status, lastSyncMs: ms, synced: last?.synced, total: last?.total))
                onDone?()
            }
        }
    }
}

// MARK: - 归档进度推送 sink（M5-R1 批2；节流在推送层，回调侧保持纯粹）

/// `mirror.fullScan(onProgress:)` → chatSyncStatus 进度帧的节流 sink：
///  · 非末帧：距上次推送 ≥intervalMs（默认 1s）才推一帧；首帧（lastPushMs 缺席）即推。
///  · 末帧（processed == total，含 0 任务的 (0,0)）：**无条件推**（进度条必收敛到满格）。
///  · `lastFrame` 记末值，供 runSyncTask 终态帧携带（终态帧带末值）。
/// 时钟注入（`nowMs`）便于测试确定性。@unchecked Sendable：fullScan 在单一 workQueue 任务内串行回调，
/// lock 为防御性（跨 sink 读 lastFrame 在任务完成后）。
final class ChatSyncProgressSink: @unchecked Sendable {
    static let defaultIntervalMs = 1000

    private let intervalMs: Int
    private let nowMs: @Sendable () -> Int
    private let pushFrame: @Sendable (_ synced: Int, _ total: Int) -> Void
    private let lock = NSLock()
    private var lastPushMs: Int?
    private var last: (synced: Int, total: Int)?

    init(
        intervalMs: Int = ChatSyncProgressSink.defaultIntervalMs,
        nowMs: @escaping @Sendable () -> Int,
        pushFrame: @escaping @Sendable (_ synced: Int, _ total: Int) -> Void
    ) {
        self.intervalMs = intervalMs
        self.nowMs = nowMs
        self.pushFrame = pushFrame
    }

    /// 已推送的最后一帧值（末帧恒被推，故 = 扫描末值）；无任何回调（refresh 等无 fullScan 路径）→ nil。
    var lastFrame: (synced: Int, total: Int)? {
        lock.withLock { last }
    }

    /// fullScan 每处理一项回调一次（processed = copied+skipped 已处理数；ChatMirror 契约末帧 processed==total）。
    func onProgress(_ processed: Int, _ total: Int) {
        let shouldPush: Bool = lock.withLock {
            last = (processed, total)
            if processed >= total { return true } // 末帧（含 (0,0)）无条件
            let now = nowMs()
            if let prev = lastPushMs, now - prev < intervalMs { return false }
            lastPushMs = now
            return true
        }
        if shouldPush { pushFrame(processed, total) }
    }
}
