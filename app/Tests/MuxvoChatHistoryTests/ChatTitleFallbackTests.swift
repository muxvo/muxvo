// 空 title 会话可见性兜底（dogfood-r4 问题5）——extractMeta fallback 三态 + ChatStore includeUntitled 双口径 +
// schema v2 重建/入库 + growSession 重读回归 + DisplayPathMemo 命中。复用 ChatIndexerTests/ChatStoreTests 的
// fixture 工具（writeSessionFile / ccUser / ccInternalUser / reconcileCC，同模块 internal）。
import Foundation
import GRDB
import Testing

import MuxvoTestSupport
import MuxvoTranscript
@testable import MuxvoChatHistory

// MARK: - 本组 fixture

/// JSON 行 → SessionRecord（真解码路径），供 extractMeta 纯测。
private func fbRec(_ json: String) -> SessionRecord {
    let obj = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any] ?? [:]
    return SessionRecord(object: obj, raw: json)
}

/// CC assistant 行（text 块）。
private func ccAssistant(_ text: String, session: String = "S", ts: String = "2026-07-06T00:00:03.000Z") -> String {
    #"{"type":"assistant","sessionId":"\#(session)","timestamp":"\#(ts)","message":{"role":"assistant","content":[{"type":"text","text":"\#(text)"}]}}"#
}

/// CC summary 行（顶层 summary 键）。
private func ccSummary(_ text: String) -> String {
    #"{"type":"summary","summary":"\#(text)","leafUuid":"u0"}"#
}

private func rowTitleFallback(_ db: ChatDatabase, session: String) throws -> (title: String, fallback: String)? {
    try db.pool.read { conn in
        guard let row = try Row.fetchOne(conn, sql:
            "SELECT title, title_fallback FROM chat_sessions WHERE session_id = ?", arguments: [session])
        else { return nil }
        return (row["title"], row["title_fallback"])
    }
}

// MARK: - extractMeta fallback 三态（纯）

@Suite("问题5 extractMeta titleFallback 链")
struct ExtractMetaFallbackTests {

    @Test("① summary 记录 → titleFallback = summary 字段（截 100）")
    func summaryFallback() {
        let records: [any ChatRecordReading] = [
            fbRec(ccSummary("会话摘要标题")),
            fbRec(#"{"type":"user","message":{"content":"<system-reminder>x</system-reminder>"},"timestamp":"T"}"#),
        ]
        let m = SessionSummaryExtractor.extractMeta(records: records)
        #expect(m.title == "")               // 无真 user title
        #expect(m.titleFallback == "会话摘要标题")
    }

    @Test("② 无 summary → titleFallback = 首条 assistant text 块 join")
    func assistantFallback() {
        let records: [any ChatRecordReading] = [
            fbRec(#"{"type":"user","message":{"content":"<system-reminder>x</system-reminder>"},"timestamp":"T"}"#),
            fbRec(ccAssistant("助手第一句")),
        ]
        let m = SessionSummaryExtractor.extractMeta(records: records)
        #expect(m.title == "")
        #expect(m.titleFallback == "助手第一句")
    }

    @Test("① 优先于 ②：summary + assistant 同在 → 取 summary")
    func summaryBeatsAssistant() {
        let records: [any ChatRecordReading] = [
            fbRec(ccAssistant("助手句")),
            fbRec(ccSummary("摘要句")),
        ]
        #expect(SessionSummaryExtractor.extractMeta(records: records).titleFallback == "摘要句")
    }

    @Test("③ 双空：无 summary/assistant/真 user → titleFallback = ''")
    func doubleEmpty() {
        let records: [any ChatRecordReading] = [
            fbRec(#"{"type":"user","message":{"content":"<system-reminder>x</system-reminder>"},"timestamp":"T"}"#),
        ]
        let m = SessionSummaryExtractor.extractMeta(records: records)
        #expect(m.title == "")
        #expect(m.titleFallback == "")
    }

    @Test("真 title 命中：title 非空（titleFallback 不消费）")
    func realTitleWins() {
        let records: [any ChatRecordReading] = [
            fbRec(ccAssistant("助手句")),
            fbRec(#"{"type":"user","message":{"content":"真正标题"},"timestamp":"T"}"#),
        ]
        #expect(SessionSummaryExtractor.extractMeta(records: records).title == "真正标题")
    }
}

// MARK: - ChatStore includeUntitled 双口径 + schema v2 入库

@Suite("问题5 ChatStore includeUntitled 双口径")
struct StoreIncludeUntitledTests {

    private func openStore(_ root: URL) throws -> (store: ChatStore, cc: URL, db: ChatDatabase) {
        let cc = root.appendingPathComponent("projects", isDirectory: true)
        try FileManager.default.createDirectory(at: cc, withIntermediateDirectories: true)
        let db = try ChatDatabase.open(at: root.appendingPathComponent("chat.db"))
        return (ChatStore(ccBase: cc, database: db), cc, db)
    }

    @Test("默认 false 丢空 title（双跑锚）；includeUntitled:true 保留 + fallback 生效")
    func dualCaliber() throws {
        try withTempRoot { root in
            let s = try openStore(root)
            // 空真 title + assistant fallback。
            try writeSessionFile(base: s.cc, project: "P", session: "S",
                lines: [ccInternalUser(session: "S"), ccAssistant("助手兜底标题", session: "S")])
            let dropped = try s.store.allRecentSessions(limit: 10)                     // includeUntitled=false
            #expect(dropped.isEmpty)                                                    // 双跑锚：空 title 丢弃
            let kept = try s.store.allRecentSessions(limit: 10, includeUntitled: true)  // 生产口径
            #expect(kept.count == 1)
            #expect(kept.first?.title == "助手兜底标题")                                 // fallback 有效 title
        }
    }

    @Test("schema v2 + fallback 入库：userVersion==2、title_fallback 列填 fallback、title 列保 legacy 空")
    func schemaV2AndFallbackStored() throws {
        try withTempRoot { root in
            let s = try openStore(root)
            #expect(try s.db.userVersion() == 2)   // schema v2 重建
            try writeSessionFile(base: s.cc, project: "P", session: "S",
                lines: [ccInternalUser(session: "S"), ccAssistant("助手兜底", session: "S")])
            try reconcileCC(s.db, base: s.cc)
            let row = try rowTitleFallback(s.db, session: "S")
            #expect(row?.title == "")             // legacy title 纯度：空 title 不写 fallback 进 title 列
            #expect(row?.fallback == "助手兜底")   // fallback 落新列
        }
    }

    @Test("双空会话：includeUntitled:true 仍保留，有效 title=''（web 端 convert 再兜 '(无标题)'）")
    func doubleEmptyKeptWithBlankTitle() throws {
        try withTempRoot { root in
            let s = try openStore(root)
            try writeSessionFile(base: s.cc, project: "P", session: "S",
                lines: [ccInternalUser(session: "S")])   // 仅内部 user，无 assistant/summary
            let kept = try s.store.allRecentSessions(limit: 10, includeUntitled: true)
            #expect(kept.count == 1)
            #expect(kept.first?.title == "")
        }
    }
}

// MARK: - growSession 重读回归

@Suite("问题5 growSession 重读（title/fallback 随增长升级）")
struct GrowRereadTests {

    private func openDB(_ root: URL) throws -> (cc: URL, db: ChatDatabase) {
        let cc = root.appendingPathComponent("projects", isDirectory: true)
        try FileManager.default.createDirectory(at: cc, withIntermediateDirectories: true)
        return (cc, try ChatDatabase.open(at: root.appendingPathComponent("chat.db")))
    }

    @Test("插入时短文件 title/fallback 双空 → 增长追加 assistant → fallback 升级（title 仍空）")
    func growUpgradesFallback() throws {
        try withTempRoot { root in
            let (cc, db) = try openDB(root)
            try writeSessionFile(base: cc, project: "P", session: "S",
                lines: [ccInternalUser(session: "S")], mtime: Date(timeIntervalSince1970: 1000))
            try reconcileCC(db, base: cc)
            #expect(try rowTitleFallback(db, session: "S")?.fallback == "")   // 插入时无 assistant

            try writeSessionFile(base: cc, project: "P", session: "S",
                lines: [ccInternalUser(session: "S"), ccAssistant("后到助手兜底", session: "S")],
                mtime: Date(timeIntervalSince1970: 2000))
            try reconcileCC(db, base: cc)
            let row = try rowTitleFallback(db, session: "S")
            #expect(row?.title == "")               // 仍无真 user title
            #expect(row?.fallback == "后到助手兜底")  // 增长重读升级 fallback
        }
    }

    @Test("增长补出真 user title → title 升级（既有重读条件回归）")
    func growUpgradesRealTitle() throws {
        try withTempRoot { root in
            let (cc, db) = try openDB(root)
            try writeSessionFile(base: cc, project: "P", session: "S",
                lines: [ccInternalUser(session: "S")], mtime: Date(timeIntervalSince1970: 1000))
            try reconcileCC(db, base: cc)
            #expect(try rowTitleFallback(db, session: "S")?.title == "")

            try writeSessionFile(base: cc, project: "P", session: "S",
                lines: [ccInternalUser(session: "S"), ccUser("后到真标题", session: "S")],
                mtime: Date(timeIntervalSince1970: 2000))
            try reconcileCC(db, base: cc)
            #expect(try rowTitleFallback(db, session: "S")?.title == "后到真标题")
        }
    }
}

// MARK: - DisplayPathMemo 命中

@Suite("问题5 DisplayPathMemo 命中免重读")
struct DisplayPathMemoTests {

    @Test("同 (path,mtime,size) 命中 → compute 只调一次；变 mtime → 重算")
    func hitAndInvalidate() {
        let memo = DisplayPathMemo()
        var computeCount = 0
        let v1 = memo.displayPath(firstJsonlPath: "/p/a.jsonl", mtimeMs: 100, size: 10) {
            computeCount += 1; return "/cwd"
        }
        #expect(v1 == "/cwd")
        #expect(computeCount == 1)

        let v2 = memo.displayPath(firstJsonlPath: "/p/a.jsonl", mtimeMs: 100, size: 10) {
            computeCount += 1; return "/should-not-run"
        }
        #expect(v2 == "/cwd")          // 命中缓存值
        #expect(computeCount == 1)     // compute 未再调

        let v3 = memo.displayPath(firstJsonlPath: "/p/a.jsonl", mtimeMs: 200, size: 10) {
            computeCount += 1; return "/new-cwd"
        }
        #expect(v3 == "/new-cwd")      // mtime 变 → 重算
        #expect(computeCount == 2)
    }
}
