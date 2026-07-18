// 增量索引（specs/behavior/chat-data.md §7 indexer 三态 + §2/§4 元数据/搜索面）——把 scanner 事实
// reconcile 进 chat.db（chat_sessions 元数据缓存 + chat_search_lines 搜索面 + chat_projects 目录事实）。
//
// per 文件 (size, mtime_ms) 对比三态：
//  · 增长（size > indexed_bytes）→ 从 indexed_bytes 续解析、append 搜索行；title/started_at/cwd 仅在
//    原值空时重取前 20 **物理**行（含空/坏行——批1 对抗交接坑：readFirstLines 数物理行不数记录）。
//  · 回退/重写（size ≤ indexed_bytes 且有变）→ 删该会话搜索行、从 0 重建、meta 重取。
//  · 消失（scan 不含该文件而库有行）→ 删 chat_sessions 行（CASCADE 删搜索行）。**mirror 行不动**：
//    reconcile 按 source 分道（cc 道只碰 source='cc' 行），镜像扫描是 A2-2/独立一道 reconcile('mirror')。
//
// 搜索行口径（§4）：只存 user/assistant 行（queue-operation/summary 等不搜，§4.1）；text =
// extractSearchableText（text 块 join，§4.2）。**存全部 user/assistant 行**（含 text 空的纯 tool_result），
// 保「搜索面 ⊋ 详情投影面」+ 空 query 首命中行与 legacy 一致。line_no = 存储序号（文件序单调，断点续增）。
import Foundation
import GRDB
import MuxvoTranscript

public struct ChatIndexer {
    let database: ChatDatabase

    public init(database: ChatDatabase) { self.database = database }

    /// tail 读阈值 / 前 N 物理行（元数据）。
    static let metaLineCount = 20

    /// 把一个 source（'cc' / 'mirror'）的 scanner 事实 reconcile 进 chat.db。单写事务内完成（读改一致）。
    public func reconcile(facts: [ChatDirectoryScanner.DirFact], source: String) throws {
        try database.pool.write { db in
            let currentDirs = Set(facts.map { $0.dirName })
            let currentFiles = Set(facts.flatMap { fact in fact.files.map { "\(fact.dirName)\u{1F}\($0.sessionId)" } })

            // 既有行（本 source）→ (dir_name, session_id) 映射。
            let existing = try ChatSessionRow.fetchAll(db, sql:
                "SELECT * FROM chat_sessions WHERE source = ?", arguments: [source])
            var existingByKey: [String: ChatSessionRow] = [:]
            for row in existing { existingByKey["\(row.dirName)\u{1F}\(row.sessionId)"] = row }

            // 消失：库有行但 scan 不含 → 删行（CASCADE 搜索行）。仅本 source。
            for row in existing where !currentFiles.contains("\(row.dirName)\u{1F}\(row.sessionId)") {
                try db.execute(sql: "DELETE FROM chat_sessions WHERE id = ?", arguments: [row.id])
            }

            // chat_projects 目录事实：删消失目录、upsert 现存。
            let existingProjectDirs = try String.fetchAll(db, sql:
                "SELECT dir_name FROM chat_projects WHERE source = ?", arguments: [source])
            for dir in existingProjectDirs where !currentDirs.contains(dir) {
                try db.execute(sql: "DELETE FROM chat_projects WHERE source = ? AND dir_name = ?",
                    arguments: [source, dir])
            }
            for fact in facts {
                try db.execute(sql: """
                    INSERT INTO chat_projects (source, dir_name, dir_mtime_ms, display_path)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(source, dir_name) DO UPDATE SET dir_mtime_ms = excluded.dir_mtime_ms,
                      display_path = excluded.display_path
                    """, arguments: [source, fact.dirName, Int64(fact.dirMtimeMs), fact.displayPath])
            }

            // per 文件三态。
            for fact in facts {
                for file in fact.files {
                    let key = "\(fact.dirName)\u{1F}\(file.sessionId)"
                    try applyFileState(db, existing: existingByKey[key], fact: fact, file: file, source: source)
                }
            }
        }
    }

    /// mirror 道增量对账（登记⑩）：只处理 `dirtyDirs` 中目录——facts 含其现状则三态逐文件（与全量路径共用
    /// applyFileState，语义恒等）+ 目录内消失行删除；facts 不含（sweepAbsent 标脏的整目录消失）→ 删该目录
    /// 全部 mirror 行（CASCADE 搜索行）+ chat_projects 行。非脏目录零触碰（既不 SELECT 也不比对——增量的全部意义）。
    /// 单写事务（与全量 reconcile 同工艺，失败整体回滚由调用方 restore 脏集重试）。
    public func reconcileMirrorDelta(facts: [ChatDirectoryScanner.DirFact], dirtyDirs: Set<String>) throws {
        let source = "mirror"
        var factByDir: [String: ChatDirectoryScanner.DirFact] = [:]
        for f in facts { factByDir[f.dirName] = f }
        try database.pool.write { db in
            for dir in dirtyDirs.sorted() {  // 稳定序（事务内确定性）
                let rows = try ChatSessionRow.fetchAll(db, sql:
                    "SELECT * FROM chat_sessions WHERE source = ? AND dir_name = ?",
                    arguments: [source, dir])
                guard let fact = factByDir[dir] else {
                    // 整目录消失：删行（CASCADE 搜索行）+ 目录事实。
                    for row in rows {
                        try db.execute(sql: "DELETE FROM chat_sessions WHERE id = ?", arguments: [row.id])
                    }
                    try db.execute(sql: "DELETE FROM chat_projects WHERE source = ? AND dir_name = ?",
                        arguments: [source, dir])
                    continue
                }
                try db.execute(sql: """
                    INSERT INTO chat_projects (source, dir_name, dir_mtime_ms, display_path)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(source, dir_name) DO UPDATE SET dir_mtime_ms = excluded.dir_mtime_ms,
                      display_path = excluded.display_path
                    """, arguments: [source, fact.dirName, Int64(fact.dirMtimeMs), fact.displayPath])
                var rowBySession: [String: ChatSessionRow] = [:]
                for row in rows { rowBySession[row.sessionId] = row }
                var present = Set<String>()
                for file in fact.files {
                    present.insert(file.sessionId)
                    try applyFileState(db, existing: rowBySession[file.sessionId], fact: fact, file: file, source: source)
                }
                for row in rows where !present.contains(row.sessionId) {  // 目录内文件消失
                    try db.execute(sql: "DELETE FROM chat_sessions WHERE id = ?", arguments: [row.id])
                }
            }
        }
    }

    /// per 文件三态派发（全量 reconcile 与 mirror delta 共用——语义单一来源）：
    /// (size, mtime) 未变跳过；增长续解析；回退/重写重建；无行新插。
    private func applyFileState(
        _ db: Database, existing: ChatSessionRow?, fact: ChatDirectoryScanner.DirFact,
        file: ChatDirectoryScanner.FileFact, source: String
    ) throws {
        let size = Int64(file.size)
        let mtime = Int64(file.mtimeMs)  // floor 到 ms（§8.2 规则2）
        if let row = existing {
            if row.fileSize == size, row.fileMtimeMs == mtime { return }  // 未变
            if size > row.indexedBytes {
                try growSession(db, row: row, file: file, source: source, size: size, mtime: mtime)
            } else {
                try rebuildSession(db, row: row, fact: fact, file: file, source: source,
                    size: size, mtime: mtime)
            }
        } else {
            try insertSession(db, fact: fact, file: file, source: source, size: size, mtime: mtime)
        }
    }

    // MARK: - 三态实现

    private func insertSession(
        _ db: Database, fact: ChatDirectoryScanner.DirFact,
        file: ChatDirectoryScanner.FileFact, source: String, size: Int64, mtime: Int64
    ) throws {
        let meta = SessionSummaryExtractor.extractMeta(records: firstRecords(file.url))
        var row = ChatSessionRow(
            id: nil, source: source, dirName: fact.dirName, sessionId: file.sessionId,
            fileSize: size, fileMtimeMs: mtime, indexedBytes: 0,
            title: meta.title, titleFallback: meta.titleFallback, startedAt: meta.startedAt, cwd: meta.cwd)
        try row.insert(db)
        let pk = row.id!
        let newOffset = try appendSearchLines(db, sessionPk: pk, url: file.url, fromOffset: 0, startLineNo: 0)
        try db.execute(sql: "UPDATE chat_sessions SET indexed_bytes = ? WHERE id = ?",
            arguments: [Int64(newOffset), pk])
    }

    private func growSession(
        _ db: Database, row: ChatSessionRow, file: ChatDirectoryScanner.FileFact,
        source: String, size: Int64, mtime: Int64
    ) throws {
        let pk = row.id!
        // 续解析：从 indexed_bytes 起，line_no 接 MAX(line_no)+1。
        let maxLine = try Int64.fetchOne(db, sql:
            "SELECT MAX(line_no) FROM chat_search_lines WHERE session_pk = ?", arguments: [pk])
        let startLine = (maxLine ?? -1) + 1
        let newOffset = try appendSearchLines(
            db, sessionPk: pk, url: file.url, fromOffset: Int(row.indexedBytes), startLineNo: startLine)

        // title/started_at/cwd 仅在原值空时重取前 20 物理行（§7）。重取条件仍看**裸 title**（非 fallback）——
        // 前 20 物理行随文件增长可能新出现真 user title/summary/assistant（插入时文件尚短则缺），故 title 空
        // 就继续尝试升级；title 命中裸值则不再重取（fallback 已有也不覆盖真 title，行为自然正确，问题5）。
        var title = row.title, startedAt = row.startedAt, cwd = row.cwd
        var titleFallback = row.titleFallback
        if title.isEmpty || startedAt.isEmpty || cwd == nil {
            let meta = SessionSummaryExtractor.extractMeta(records: firstRecords(file.url))
            if title.isEmpty { title = meta.title; titleFallback = meta.titleFallback }  // 同刷 fallback（新行或已到真 title）
            if startedAt.isEmpty { startedAt = meta.startedAt }
            if cwd == nil { cwd = meta.cwd }
        }
        try db.execute(sql: """
            UPDATE chat_sessions SET file_size = ?, file_mtime_ms = ?, indexed_bytes = ?,
              title = ?, title_fallback = ?, started_at = ?, cwd = ? WHERE id = ?
            """, arguments: [size, mtime, Int64(newOffset), title, titleFallback, startedAt, cwd, pk])
    }

    private func rebuildSession(
        _ db: Database, row: ChatSessionRow, fact: ChatDirectoryScanner.DirFact,
        file: ChatDirectoryScanner.FileFact, source: String, size: Int64, mtime: Int64
    ) throws {
        let pk = row.id!
        try db.execute(sql: "DELETE FROM chat_search_lines WHERE session_pk = ?", arguments: [pk])
        let meta = SessionSummaryExtractor.extractMeta(records: firstRecords(file.url))  // 重写 → meta 重取（含 fallback）
        let newOffset = try appendSearchLines(db, sessionPk: pk, url: file.url, fromOffset: 0, startLineNo: 0)
        try db.execute(sql: """
            UPDATE chat_sessions SET file_size = ?, file_mtime_ms = ?, indexed_bytes = ?,
              title = ?, title_fallback = ?, started_at = ?, cwd = ? WHERE id = ?
            """, arguments: [size, mtime, Int64(newOffset), meta.title, meta.titleFallback, meta.startedAt, meta.cwd, pk])
    }

    // MARK: - 搜索行 append + 元数据物理行

    /// 从 fromOffset 起逐完整行，user/assistant 行的 extractSearchableText 入 chat_search_lines；返回新偏移。
    private func appendSearchLines(
        _ db: Database, sessionPk: Int64, url: URL, fromOffset: Int, startLineNo: Int64
    ) throws -> Int {
        var decoder = SessionJSONLDecoder()
        var lineNo = startLineNo
        var pending: Error?
        let newOffset = ChatLineIO.forEachLine(url: url, fromOffset: fromOffset) { data, _ in
            if pending != nil { return }
            guard let record = decoder.record(from: data) else { return }  // 空行/坏行跳过（不占 line_no）
            guard SearchPredicate.isSearchableType(record) else { return }  // 只 user/assistant（§4.1）
            let text = SearchPredicate.extractSearchableText(record)        // text 块 join（§4.2）
            let line = ChatSearchLineRow(
                sessionPk: sessionPk, lineNo: lineNo, ts: record.timestamp ?? "", text: text)
            do { try line.insert(db); lineNo += 1 } catch { pending = error }
        }
        if let pending { throw pending }
        return newOffset
    }

    /// 前 20 物理行解码出的记录（空/坏行占物理行额度但不入结果，§2.1）。
    private func firstRecords(_ url: URL) -> [any ChatRecordReading] {
        var decoder = SessionJSONLDecoder()
        return ChatLineIO.firstLines(url: url, count: Self.metaLineCount).compactMap { decoder.record(from: $0) }
    }
}

// MARK: - 非门控 meta 提取（indexer 缓存用；生产索引路径，刻意与 SessionSummaryExtractor.extract 分叉）

extension SessionSummaryExtractor {
    /// title 可空的 meta 四元组——chat_sessions 缓存用（title 空会话仍需入库供搜索面，§4）。
    ///
    /// **刻意分叉声明（dogfood-r4 问题5）**：与 `extract`（nil 门控版）**不再逐字一致**——本函数是生产索引路径，
    /// 除 title/startedAt/cwd 外**多算一列 `titleFallback`**（空 title 会话的显示兜底，见下 fallback 链）；
    /// `extract` 保 legacy 对齐（无 fallback、title 空→nil）专供 dump/双跑 diff（§8）。分叉原因：空 title 会话
    /// 在生产要「可见且有可读标题」，在双跑要「与 legacy 逐字节相等」——两个面天然背离，故不再同改。
    /// title/startedAt/cwd 三值的采集循环仍与 `extract` 同口径（cwd 于 title 命中 break 前捕获，§2.3）。
    ///
    /// titleFallback 链（仅 title 空时消费）：① 首条 `type=="summary"` 记录的 `summary` 字段非空 →
    /// utf16Prefix(100)；② 否则首条 assistant 非空 text 块 join → prefix(100)；③ 仍空留空串。
    static func extractMeta(records: [any ChatRecordReading])
        -> (title: String, startedAt: String, cwd: String?, titleFallback: String)
    {
        var title = ""
        var startedAt = ""
        var cwd = ""
        var summaryFallback = ""    // ① 首条 summary 记录的 summary 字段
        var assistantFallback = ""  // ② 首条 assistant 非空 text 块 join
        for record in records {
            if cwd.isEmpty, let c = record.cwd, !c.isEmpty { cwd = c }

            // fallback ①：首条 summary 记录（type=="summary"）的 summary 字段非空。
            if summaryFallback.isEmpty, record.type == "summary", let s = record.summaryText {
                let trimmed = ChatText.jsTrim(s)
                if !trimmed.isEmpty { summaryFallback = ChatText.utf16Prefix(trimmed, 100) }
            }
            // fallback ②：首条 assistant 非空 text 块 join（dropEmpty 剔空块）。
            if assistantFallback.isEmpty, record.type == "assistant" {
                let t = ChatText.jsTrim(ContentAccess.plainText(record, dropEmpty: true))
                if !t.isEmpty { assistantFallback = ChatText.utf16Prefix(t, 100) }
            }

            guard record.type == "user" else { continue }
            let rawContent = ContentAccess.plainText(record, dropEmpty: false)
            if startedAt.isEmpty { startedAt = record.timestamp ?? "" }
            let trimmed = ChatText.jsTrim(rawContent)
            if !trimmed.isEmpty, !titleSkipPrefixes.contains(where: { trimmed.hasPrefix($0) }) {
                title = ChatText.utf16Prefix(trimmed, 100)
                break  // title 命中即止；titleFallback 仅 title 空时消费，故 break 早退不影响正确性
            }
        }
        let titleFallback = !summaryFallback.isEmpty ? summaryFallback : assistantFallback
        return (title, startedAt, cwd.isEmpty ? nil : cwd, titleFallback)
    }
}
