// 镜像池目录事实备忘 + mirror delta 对账（specs/behavior/chat-data.md 登记⑩，聊天扫描风暴根治）。
// 四层：memo 单元语义 / scanner 集成（含缓存短路取证与设计内限制）/ ChatStore 计划门控（首轮 full →
// 稳态 skip → 脏目录 delta → force 恒跑+requestFull）/ ChatIndexer delta 与全量语义等价。
// fixture 工具（writeSessionFile / ccUser / ccUserCwd / sessionRowExists）复用 ChatIndexerTests / ChatStoreTests。
import Foundation
import GRDB
import Testing

import MuxvoTestSupport
@testable import MuxvoChatHistory

// MARK: - 工具

/// 恒冷时钟（2100-01-01，任何真实目录 mtime 都在热窗外 → 恒可落存）。
private let coldClock: @Sendable () -> Int64 = { 4_102_444_800_000 }

/// 直插「幽灵」会话行（fs 上无对应文件）——存活/被清是「mirror 道跳过/对账」的可观察锚。
private func insertGhost(_ db: ChatDatabase, dir: String, session: String, source: String = "mirror") throws {
    try db.pool.write { conn in
        try conn.execute(sql: """
            INSERT INTO chat_sessions (source, dir_name, session_id, file_size, file_mtime_ms, indexed_bytes, title)
            VALUES (?, ?, ?, 1, 1, 0, 'ghost')
            """, arguments: [source, dir, session])
    }
}

private func setDirMtime(_ dir: URL, _ date: Date) throws {
    try FileManager.default.setAttributes([.modificationDate: date], ofItemAtPath: dir.path)
}

private func fakeFact(_ dir: String, size: Int = 1) -> ChatDirectoryScanner.DirFact {
    ChatDirectoryScanner.DirFact(dirName: dir, displayPath: "", totalSize: size, dirMtimeMs: 0, files: [])
}

// MARK: - memo 单元语义

@Suite("DirFactMemo 单元语义（登记⑩）")
struct DirFactMemoUnitTests {

    @Test("CD_dirmemo_plan_initial_full：初始计划 .full（首轮必全量），消费一次性：二次 .delta(空)")
    func initialPlanFullThenEmpty() {
        let memo = DirFactMemo(now: coldClock)
        #expect(memo.consumePlan() == .full)
        #expect(memo.consumePlan() == .delta([]))
    }

    @Test("CD_dirmemo_hit_once_change_dirty：命中 (dirName, dirMtimeMs) → compute 只调一次；mtime 变 → 重算 + 置脏")
    func hitOnceAndMtimeChangeMarksDirty() {
        let memo = DirFactMemo(now: coldClock)
        _ = memo.consumePlan()  // 清初始 full
        var computeCount = 0
        let compute = { () -> ChatDirectoryScanner.DirFact? in computeCount += 1; return fakeFact("D") }
        #expect(memo.fact(dirName: "D", dirMtimeMs: 1000, compute: compute) == fakeFact("D"))
        #expect(memo.consumePlan() == .delta(["D"]))  // 首见置脏
        #expect(memo.fact(dirName: "D", dirMtimeMs: 1000, compute: compute) == fakeFact("D"))
        #expect(computeCount == 1)                     // 命中不重算
        #expect(memo.consumePlan() == .delta([]))      // 命中不置脏
        var changedCount = 0
        _ = memo.fact(dirName: "D", dirMtimeMs: 2000) { changedCount += 1; return fakeFact("D", size: 2) }
        #expect(changedCount == 1)                     // mtime 变重算
        #expect(memo.consumePlan() == .delta(["D"]))   // 内容变 → 置脏
    }

    @Test("CD_dirmemo_equal_fact_not_dirty：mtime 变但 fact 值等价 → 不置脏（memo 层语义；真实 DirFact 含 dirMtimeMs 字段故纯 mtime bump 仍脏一轮，保守登记⑩）")
    func equalFactMtimeBumpNotDirty() {
        let memo = DirFactMemo(now: coldClock)
        _ = memo.consumePlan()
        _ = memo.fact(dirName: "D", dirMtimeMs: 1000) { fakeFact("D") }
        _ = memo.consumePlan()  // 清首见脏
        _ = memo.fact(dirName: "D", dirMtimeMs: 2000) { fakeFact("D") }  // mtime bump，内容等值
        #expect(memo.consumePlan() == .delta([]))
        // 新 mtime 已入缓存：同 mtime 再来命中
        var computeCount = 0
        _ = memo.fact(dirName: "D", dirMtimeMs: 2000) { computeCount += 1; return fakeFact("D") }
        #expect(computeCount == 0)
    }

    @Test("CD_dirmemo_hot_window_no_cache：热窗（mtime 距 now < 2s）不落存：每次真算、每次置脏（首见规则令 delta 恒覆盖热目录）")
    func hotWindowNeverCaches() {
        let memo = DirFactMemo(now: { 2500 })  // mtime=1000 → 距 now 1500ms < 2000
        _ = memo.consumePlan()
        var computeCount = 0
        let compute = { () -> ChatDirectoryScanner.DirFact? in computeCount += 1; return fakeFact("D") }
        _ = memo.fact(dirName: "D", dirMtimeMs: 1000, compute: compute)
        _ = memo.fact(dirName: "D", dirMtimeMs: 1000, compute: compute)
        #expect(computeCount == 2)
        #expect(memo.consumePlan() == .delta(["D"]))
        // 未来 mtime（钟回拨）同样落热窗：只降性能不错缓存
        _ = memo.fact(dirName: "F", dirMtimeMs: 99_999, compute: { fakeFact("F") })
        _ = memo.consumePlan()
        var fCount = 0
        _ = memo.fact(dirName: "F", dirMtimeMs: 99_999, compute: { fCount += 1; return fakeFact("F") })
        #expect(fCount == 1)
    }

    @Test("CD_dirmemo_sweep_absent：缓存键不在枚举集 → 逐出 + 置脏（整目录消失不产生 miss，显式扫尾兜底）")
    func sweepAbsentEvictsAndMarks() {
        let memo = DirFactMemo(now: coldClock)
        _ = memo.consumePlan()
        _ = memo.fact(dirName: "D", dirMtimeMs: 1000) { fakeFact("D") }
        _ = memo.fact(dirName: "E", dirMtimeMs: 1000) { fakeFact("E") }
        _ = memo.consumePlan()
        memo.sweepAbsent(visited: ["E"])
        #expect(memo.consumePlan() == .delta(["D"]))
        var computeCount = 0
        _ = memo.fact(dirName: "D", dirMtimeMs: 1000) { computeCount += 1; return fakeFact("D") }
        #expect(computeCount == 1)  // 已逐出 → 真算
    }

    @Test("CD_dirmemo_restore：回灌（reconcile 失败路径）：delta 并回脏集、full 复位")
    func restoreRefillsPlan() {
        let memo = DirFactMemo(now: coldClock)
        _ = memo.consumePlan()
        _ = memo.fact(dirName: "D", dirMtimeMs: 1000) { fakeFact("D") }
        let plan = memo.consumePlan()
        #expect(plan == .delta(["D"]))
        memo.restore(plan)
        #expect(memo.consumePlan() == .delta(["D"]))  // 脏没丢
        memo.restore(.full)
        #expect(memo.consumePlan() == .full)
    }

    @Test("CD_dirmemo_request_full：force 道完成后自愈：下轮 .full 且吞掉脏集")
    func requestFullOverridesDirty() {
        let memo = DirFactMemo(now: coldClock)
        _ = memo.consumePlan()
        _ = memo.fact(dirName: "D", dirMtimeMs: 1000) { fakeFact("D") }
        memo.requestFull()
        #expect(memo.consumePlan() == .full)
        #expect(memo.consumePlan() == .delta([]))  // 脏已被 full 吞并
    }
}

// MARK: - scanner 集成

@Suite("ChatDirectoryScanner × DirFactMemo（登记⑩）")
struct DirFactMemoScannerTests {

    private func fixture(_ root: URL) throws -> URL {
        let base = root.appendingPathComponent("pool", isDirectory: true)
        try writeSessionFile(base: base, project: "P", session: "a",
            lines: [ccUserCwd("hi", cwd: "/Users/t/proj", session: "a")])
        try writeSessionFile(base: base, project: "P", session: "b", lines: [ccUser("hey", session: "b")])
        try writeSessionFile(base: base, project: "P--worktrees-wt-1", session: "c",
            lines: [ccUser("wt", session: "c")])
        try writeSessionFile(base: base, project: "Q", session: "d", lines: [ccUser("q", session: "d")])
        // 无 .jsonl 目录（§1.1 丢弃）
        try FileManager.default.createDirectory(
            at: base.appendingPathComponent("empty", isDirectory: true), withIntermediateDirectories: true)
        return base
    }

    @Test("CD_dirmemo_scan_equivalence：带 memo 与不带 memo 输出全等（含 worktree/无 jsonl 目录）；二扫命中仍全等")
    func memoOutputEqualsPlain() throws {
        try withTempRoot { root in
            let base = try fixture(root)
            let plain = ChatDirectoryScanner(base: base).scan()
            let memo = DirFactMemo(now: coldClock)
            let memoized = ChatDirectoryScanner(base: base, dirFactMemo: memo)
            let first = memoized.scan()
            let second = memoized.scan()  // 全命中缓存
            #expect(first == plain)
            #expect(second == plain)
            #expect(plain.count == 3)  // empty 目录丢弃
        }
    }

    @Test("CD_dirmemo_hit_short_circuit：命中真短路（取证）：目录 mtime 复原后新增文件不可见；mtime 前进后可见 + 置脏")
    func hitShortCircuitsRealScan() throws {
        try withTempRoot { root in
            let base = try fixture(root)
            let dirP = base.appendingPathComponent("P", isDirectory: true)
            try setDirMtime(dirP, Date(timeIntervalSince1970: 1000))
            let memo = DirFactMemo(now: coldClock)
            let scanner = ChatDirectoryScanner(base: base, dirFactMemo: memo)
            let first = scanner.scan()
            #expect(first.first { $0.dirName == "P" }?.files.count == 2)
            _ = memo.consumePlan()

            // 加第三个会话，然后把目录 mtime 复原 → 备忘命中 → 看不到新文件（缓存真的短路了真扫）
            try writeSessionFile(base: base, project: "P", session: "z", lines: [ccUser("z", session: "z")])
            try setDirMtime(dirP, Date(timeIntervalSince1970: 1000))
            let cached = scanner.scan()
            #expect(cached.first { $0.dirName == "P" }?.files.count == 2)
            #expect(memo.consumePlan() == .delta([]))
            #expect(ChatDirectoryScanner(base: base).scan().first { $0.dirName == "P" }?.files.count == 3)

            // mtime 前进（池内真实写恒如此：rename/remove 必更目录 mtime）→ 重扫可见 + 置脏
            try setDirMtime(dirP, Date(timeIntervalSince1970: 2000))
            let fresh = scanner.scan()
            #expect(fresh.first { $0.dirName == "P" }?.files.count == 3)
            #expect(memo.consumePlan() == .delta(["P"]))
        }
    }

    @Test("CD_dirmemo_dir_vanish_and_cleared：整目录删除 → facts 不含 + sweep 置脏；.jsonl 清空（目录在）→ nil 哨兵 + 置脏")
    func absentAndClearedDirsMarked() throws {
        try withTempRoot { root in
            let base = try fixture(root)
            let memo = DirFactMemo(now: coldClock)
            let scanner = ChatDirectoryScanner(base: base, dirFactMemo: memo)
            _ = scanner.scan()
            _ = memo.consumePlan()

            try FileManager.default.removeItem(at: base.appendingPathComponent("Q", isDirectory: true))
            try FileManager.default.removeItem(
                at: base.appendingPathComponent("P--worktrees-wt-1/c.jsonl", isDirectory: false))
            let facts = scanner.scan()
            #expect(!facts.contains { $0.dirName == "Q" })
            #expect(!facts.contains { $0.dirName == "P--worktrees-wt-1" })  // 清空目录 → nil 哨兵丢弃
            #expect(memo.consumePlan() == .delta(["Q", "P--worktrees-wt-1"]))
        }
    }

    @Test("CD_dirmemo_base_missing_sweep_all：base 不可枚举 → 空 facts + 全部置脏（对齐原行为「mirror 空 → 清理陈旧行」，晚一轮生效）")
    func missingBaseSweepsAll() throws {
        try withTempRoot { root in
            let base = try fixture(root)
            let memo = DirFactMemo(now: coldClock)
            let scanner = ChatDirectoryScanner(base: base, dirFactMemo: memo)
            _ = scanner.scan()
            _ = memo.consumePlan()
            try FileManager.default.removeItem(at: base)
            #expect(scanner.scan().isEmpty)
            // nil 哨兵目录（empty）也在缓存中，扫尾一并逐出置脏（delta 对无行目录 = no-op，无害）
            #expect(memo.consumePlan() == .delta(["P", "P--worktrees-wt-1", "Q", "empty"]))
        }
    }
}

// MARK: - ChatStore 计划门控

@Suite("ChatStore mirror reconcile 计划门控（登记⑩）")
struct ChatStoreMirrorPlanTests {

    private func openStore(_ root: URL, memo: DirFactMemo?)
        throws -> (store: ChatStore, cc: URL, mirror: URL, db: ChatDatabase)
    {
        let cc = root.appendingPathComponent("projects", isDirectory: true)
        let mirror = root.appendingPathComponent("chat-history", isDirectory: true)
        try FileManager.default.createDirectory(at: cc, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: mirror, withIntermediateDirectories: true)
        let db = try ChatDatabase.open(at: root.appendingPathComponent("chat.db"))
        let store = ChatStore(ccBase: cc, mirrorBase: mirror, database: db, mirrorDirFactMemo: memo)
        return (store, cc, mirror, db)
    }

    /// 建稳态：R1(.full 建库) + R2(.delta 首见脏) → 此后无变化即 .delta(空) 跳过。
    private func settle(_ store: ChatStore) throws {
        try store.reconcile(forceMirror: false)
        try store.reconcile(forceMirror: false)
    }

    @Test("CD_dirmemo_store_first_full：首轮必跑（初始 .full）：非 force reconcile 即建 mirror 行")
    func firstReconcileRunsFull() throws {
        try withTempRoot { root in
            let s = try openStore(root, memo: DirFactMemo(now: coldClock))
            try writeSessionFile(base: s.mirror, project: "P", session: "m1", lines: [ccUser("hi", session: "m1")])
            try s.store.reconcile(forceMirror: false)
            #expect(try sessionRowExists(s.db, session: "m1", source: "mirror"))
        }
    }

    @Test("CD_dirmemo_store_steady_skip：池零变化时 mirror 道整体不触碰（幽灵行存活为锚）；cc 道同轮照常增量")
    func steadyStateSkipsMirrorButNotCC() throws {
        try withTempRoot { root in
            let s = try openStore(root, memo: DirFactMemo(now: coldClock))
            try writeSessionFile(base: s.mirror, project: "P", session: "m1", lines: [ccUser("hi", session: "m1")])
            try settle(s.store)
            try insertGhost(s.db, dir: "P", session: "ghost")
            try writeSessionFile(base: s.cc, project: "C", session: "c1", lines: [ccUser("cc", session: "c1")])
            try s.store.reconcile(forceMirror: false)  // .delta(空) → mirror 跳过
            #expect(try sessionRowExists(s.db, session: "ghost", source: "mirror"))  // 跳过 → 幽灵存活
            #expect(try sessionRowExists(s.db, session: "c1", source: "cc"))         // cc 道照常
        }
    }

    @Test("CD_dirmemo_store_delta_precise：脏目录 delta 精准：变更目录下轮对账、未变目录零触碰（排序不变式：本轮脏留待下轮）")
    func deltaTouchesOnlyDirtyDirs() throws {
        try withTempRoot { root in
            let s = try openStore(root, memo: DirFactMemo(now: coldClock))
            try writeSessionFile(base: s.mirror, project: "P", session: "m1", lines: [ccUser("hi", session: "m1")])
            try writeSessionFile(base: s.mirror, project: "Q", session: "q1", lines: [ccUser("q", session: "q1")])
            try settle(s.store)
            try writeSessionFile(base: s.mirror, project: "P", session: "m2", lines: [ccUser("m2", session: "m2")])
            try insertGhost(s.db, dir: "Q", session: "ghostq")
            try s.store.reconcile(forceMirror: false)  // 消费空计划（跳过）；本轮扫描发现 P 变 → 置脏
            #expect(!(try sessionRowExists(s.db, session: "m2", source: "mirror")))  // 晚一轮
            try s.store.reconcile(forceMirror: false)  // .delta({P})
            #expect(try sessionRowExists(s.db, session: "m2", source: "mirror"))
            #expect(try sessionRowExists(s.db, session: "ghostq", source: "mirror"))  // Q 非脏零触碰
        }
    }

    @Test("CD_dirmemo_store_force_requestfull：force 道恒全量 + 完成后 requestFull：幽灵被清；下一轮非 force 也 .full 再清一次")
    func forceLaneAlwaysFullAndRequestsFull() throws {
        try withTempRoot { root in
            let s = try openStore(root, memo: DirFactMemo(now: coldClock))
            try writeSessionFile(base: s.mirror, project: "P", session: "m1", lines: [ccUser("hi", session: "m1")])
            try settle(s.store)
            try insertGhost(s.db, dir: "P", session: "g1")
            try s.store.reconcile()  // force 默认 → 全量 → g1 被清（消失态）
            #expect(!(try sessionRowExists(s.db, session: "g1", source: "mirror")))
            try insertGhost(s.db, dir: "P", session: "g2")
            try s.store.reconcile(forceMirror: false)  // requestFull 生效 → .full → g2 也被清
            #expect(!(try sessionRowExists(s.db, session: "g2", source: "mirror")))
            try insertGhost(s.db, dir: "P", session: "g3")
            try s.store.reconcile(forceMirror: false)  // 回归稳态 skip → g3 存活
            #expect(try sessionRowExists(s.db, session: "g3", source: "mirror"))
        }
    }

    @Test("CD_dirmemo_store_vanish_cleanup：整目录消失 sweep 置脏 → 下轮 delta 清 mirror 行 + chat_projects 行")
    func vanishedDirCleansRows() throws {
        try withTempRoot { root in
            let s = try openStore(root, memo: DirFactMemo(now: coldClock))
            try writeSessionFile(base: s.mirror, project: "P", session: "m1", lines: [ccUser("hi", session: "m1")])
            try settle(s.store)
            try FileManager.default.removeItem(at: s.mirror.appendingPathComponent("P", isDirectory: true))
            try s.store.reconcile(forceMirror: false)  // skip + sweep 置脏
            try s.store.reconcile(forceMirror: false)  // .delta({P})：facts 无 P → 整目录删
            #expect(!(try sessionRowExists(s.db, session: "m1", source: "mirror")))
            let projectRows = try s.db.pool.read { conn in
                try Int.fetchOne(conn, sql:
                    "SELECT COUNT(*) FROM chat_projects WHERE source = 'mirror' AND dir_name = 'P'") ?? -1
            }
            #expect(projectRows == 0)
        }
    }

    @Test("CD_dirmemo_store_nil_memo_full：memo 不注入（dump/双跑/测试）：非 force 也恒全量（原行为零变）")
    func nilMemoAlwaysFull() throws {
        try withTempRoot { root in
            let s = try openStore(root, memo: nil)
            try writeSessionFile(base: s.mirror, project: "P", session: "m1", lines: [ccUser("hi", session: "m1")])
            try s.store.reconcile(forceMirror: false)
            try insertGhost(s.db, dir: "P", session: "ghost")
            try s.store.reconcile(forceMirror: false)  // 无 memo → 全量 → 幽灵被清
            #expect(!(try sessionRowExists(s.db, session: "ghost", source: "mirror")))
        }
    }
}

// MARK: - indexer delta

@Suite("ChatIndexer mirror delta（登记⑩）")
struct ChatIndexerMirrorDeltaTests {

    private struct RowLite: Equatable {
        let dir: String, session: String, size: Int64, indexed: Int64, title: String, searchLines: Int
    }

    private func mirrorRows(_ db: ChatDatabase) throws -> [RowLite] {
        try db.pool.read { conn in
            try Row.fetchAll(conn, sql: """
                SELECT s.dir_name AS d, s.session_id AS sid, s.file_size AS fs, s.indexed_bytes AS ib,
                       s.title AS t, (SELECT COUNT(*) FROM chat_search_lines l WHERE l.session_pk = s.id) AS lc
                FROM chat_sessions s WHERE s.source = 'mirror' ORDER BY s.dir_name, s.session_id
                """).map {
                RowLite(dir: $0["d"], session: $0["sid"], size: $0["fs"], indexed: $0["ib"],
                        title: $0["t"], searchLines: $0["lc"])
            }
        }
    }

    /// 初始池：D1/a(2行)、D1/b、D2/c(2行)。返回 base。
    private func seed(_ root: URL) throws -> URL {
        let base = root.appendingPathComponent("pool", isDirectory: true)
        try writeSessionFile(base: base, project: "D1", session: "a",
            lines: [ccUser("a1", session: "a"), ccUser("a2", session: "a")],
            mtime: Date(timeIntervalSince1970: 1000))
        try writeSessionFile(base: base, project: "D1", session: "b",
            lines: [ccUser("b1", session: "b")], mtime: Date(timeIntervalSince1970: 1000))
        try writeSessionFile(base: base, project: "D2", session: "c",
            lines: [ccUser("c1", session: "c"), ccUser("c2", session: "c")],
            mtime: Date(timeIntervalSince1970: 1000))
        return base
    }

    /// 变异四态：a 增长（前缀不变+追加）、d 新增、c 回退重写、b 删除。
    private func mutate(_ base: URL) throws {
        try writeSessionFile(base: base, project: "D1", session: "a",
            lines: [ccUser("a1", session: "a"), ccUser("a2", session: "a"), ccUser("a3-grown", session: "a")],
            mtime: Date(timeIntervalSince1970: 2000))
        try writeSessionFile(base: base, project: "D1", session: "d",
            lines: [ccUser("d-new", session: "d")], mtime: Date(timeIntervalSince1970: 2000))
        try writeSessionFile(base: base, project: "D2", session: "c",
            lines: [ccUser("c-rewritten", session: "c")], mtime: Date(timeIntervalSince1970: 2000))
        try FileManager.default.removeItem(at: base.appendingPathComponent("D1/b.jsonl"))
    }

    @Test("CD_delta_matches_full：delta 四态（增长/新增/回退/文件消失）终态与全量 reconcile 逐行等价")
    func deltaMatchesFullReconcile() throws {
        try withTempRoot { root in
            let base = try seed(root)
            let db = try ChatDatabase.open(at: root.appendingPathComponent("chat.db"))
            try ChatIndexer(database: db).reconcile(
                facts: ChatDirectoryScanner(base: base).scan(), source: "mirror")
            try mutate(base)
            let facts = ChatDirectoryScanner(base: base).scan()
            try ChatIndexer(database: db).reconcileMirrorDelta(facts: facts, dirtyDirs: ["D1", "D2"])

            // 对照庫：同 facts 全量 reconcile（语义单一来源 → 终态必须逐行等价）
            let refDb = try ChatDatabase.open(at: root.appendingPathComponent("ref.db"))
            try ChatIndexer(database: refDb).reconcile(facts: facts, source: "mirror")
            #expect(try mirrorRows(db) == mirrorRows(refDb))
            #expect(!(try sessionRowExists(db, session: "b", source: "mirror")))  // 文件消失 → 行删
        }
    }

    @Test("CD_delta_untouched_dir：非脏目录零触碰：D2 也变了但只报 D1 → D2 行保持旧值")
    func untouchedDirKeepsStaleRows() throws {
        try withTempRoot { root in
            let base = try seed(root)
            let db = try ChatDatabase.open(at: root.appendingPathComponent("chat.db"))
            try ChatIndexer(database: db).reconcile(
                facts: ChatDirectoryScanner(base: base).scan(), source: "mirror")
            let before = try mirrorRows(db).filter { $0.dir == "D2" }
            try mutate(base)
            let facts = ChatDirectoryScanner(base: base).scan()
            try ChatIndexer(database: db).reconcileMirrorDelta(facts: facts, dirtyDirs: ["D1"])
            #expect(try mirrorRows(db).filter { $0.dir == "D2" } == before)  // 旧值原封不动
            #expect(try sessionRowExists(db, session: "d", source: "mirror"))  // D1 照常对账
        }
    }

    @Test("CD_delta_source_isolation：同 dirName 的 cc 行在 mirror delta 整目录删除下存活")
    func sourceIsolation() throws {
        try withTempRoot { root in
            let base = try seed(root)
            let db = try ChatDatabase.open(at: root.appendingPathComponent("chat.db"))
            let facts = ChatDirectoryScanner(base: base).scan()
            try ChatIndexer(database: db).reconcile(facts: facts, source: "cc")
            try ChatIndexer(database: db).reconcile(facts: facts, source: "mirror")
            // D1 整目录消失（facts 不含）→ mirror 行删、cc 行不动
            try ChatIndexer(database: db).reconcileMirrorDelta(
                facts: facts.filter { $0.dirName != "D1" }, dirtyDirs: ["D1"])
            #expect(!(try sessionRowExists(db, session: "a", source: "mirror")))
            #expect(try sessionRowExists(db, session: "a", source: "cc"))
        }
    }
}
