// liveSessionsPage（chat-data.md 登记⑪ 生产 paged 下推）——语义等价 + 跨页边界 + 索引闸。
// oracle = 老路径（sessions/allRecentSessions limit:.max includeUntitled:true）+ 退役前 wire 排序切片
// 逐字复刻；行 fixture 直插 chat_sessions（精确控制 rowid/mtime/source 铺对抗矩阵），目录文件只在
// per-project 面需要 worktreeMap 时落盘。
import Foundation
import GRDB
import Testing

import MuxvoTestSupport
@testable import MuxvoChatHistory

/// 可配列表 Codex 桩（native 序即数组序——codex 内部首现去重语义锚）。
private struct ListCodexStub: ChatCodexQuerying {
    let list: [ChatSessionSummary]
    func getProjects() -> [ChatProjectInfo] { [] }
    func getSessionsForProject(_ projectHash: String, limit: Int) -> [ChatSessionSummary] {
        Array(list.filter { $0.projectHash == projectHash }.prefix(limit))
    }
    func getAllRecentSessions(limit: Int) -> [ChatSessionSummary] { Array(list.prefix(limit)) }
    func readSession(sessionId: String, limit: Int?) -> [ChatSessionMessage] { [] }
    func search(_ query: String) -> [ChatSearchResult] { [] }
}

private func codexSummary(sid: String, hash: String = "CX", title: String = "cx", lm: Double) -> ChatSessionSummary {
    ChatSessionSummary(sessionId: sid, projectHash: hash, title: title,
                       startedAt: "2026-07-06T00:00:00.000Z", lastModified: lm,
                       fileSize: 10, source: .codex)
}

@Suite("ChatStore.liveSessionsPage（登记⑪ 生产 paged 下推）")
struct ChatStoreLivePageTests {

    private func makeStore(root: URL, codex: (any ChatCodexQuerying)? = nil)
        throws -> (store: ChatStore, cc: URL, db: ChatDatabase)
    {
        let cc = root.appendingPathComponent("projects", isDirectory: true)
        try FileManager.default.createDirectory(at: cc, withIntermediateDirectories: true)
        let db = try ChatDatabase.open(at: root.appendingPathComponent("chat.db"))
        let store = ChatStore(ccBase: cc, mirrorBase: nil, codexBase: nil,
                              database: db, codexSource: codex)
        return (store, cc, db)
    }

    /// 直插一行（rowid 随插入序单调 → last-wins/first-wins 可控）。
    @discardableResult
    private func insertRow(
        _ db: ChatDatabase, source: String, dir: String, sid: String, mtimeMs: Int64,
        title: String = "t", fallback: String = ""
    ) throws -> Int64 {
        try db.pool.write { d in
            var row = ChatSessionRow(
                id: nil, source: source, dirName: dir, sessionId: sid, fileSize: 10,
                fileMtimeMs: mtimeMs, indexedBytes: 0, title: title, titleFallback: fallback,
                startedAt: "", cwd: nil)
            try row.insert(d)
            return row.id!
        }
    }

    /// 老路径 oracle：limit:.max + 退役前 wire 全序（sortKeyMs DESC, sessionId DESC）→ 全列表。
    private func oracleSorted(_ store: ChatStore, projectHash: String?) throws -> [ChatSessionSummary] {
        let all: [ChatSessionSummary] = projectHash == nil
            ? try store.allRecentSessions(limit: .max, includeUntitled: true, reconcile: false)
            : try store.sessions(projectHash: projectHash!, limit: .max, includeUntitled: true, reconcile: false)
        return all.sorted { a, b in
            let ka = ChatStore.liveSortKeyMs(a.lastModified), kb = ChatStore.liveSortKeyMs(b.lastModified)
            if ka != kb { return ka > kb }
            return a.sessionId > b.sessionId
        }
    }

    /// 新路径全翻页（wire 同款游标续行），返回逐页数组。
    private func liveWalk(_ store: ChatStore, projectHash: String?, pageSize: Int) throws -> [[ChatSessionSummary]] {
        var pages: [[ChatSessionSummary]] = []
        var after: LiveSessionCursor?
        while true {
            let (page, hasMore) = try store.liveSessionsPage(
                projectHash: projectHash, after: after, pageSize: pageSize)
            pages.append(page)
            guard hasMore, let last = page.last else { break }
            after = LiveSessionCursor(
                mtimeMs: ChatStore.liveSortKeyMs(last.lastModified), sessionId: last.sessionId)
        }
        return pages
    }

    /// 等价比较投影（老/新两路输出的可观察面）。
    private func key(_ s: ChatSessionSummary) -> String {
        "\(s.sessionId)|\(s.projectHash)|\(s.title)|\(Int(s.lastModified))"
            + "|\(s.archiveOnly == true)|\(s.worktreeLabel ?? "-")"
    }

    // MARK: - 等价性主锚

    @Test("CD_livepage_full_walk_equals_wire_sort：对抗矩阵全翻页 ≡ 老路径 wire 排序切片（isAll+项目面）")
    func fullWalkEqualsWireSort() throws {
        try withTempRoot { root in
            let codex = ListCodexStub(list: [
                codexSummary(sid: "s1", lm: 999_000),          // 与 CC 同 sid → 压制
                codexSummary(sid: "cx1", lm: 750_000),         // 独有 → 按键位穿插
                codexSummary(sid: "cx2", lm: 50_000),
            ])
            let s = try makeStore(root: root, codex: codex)
            // cc/mirror 孪生（镜像写回源 mtime = 同键）
            try insertRow(s.db, source: "cc", dir: "P", sid: "s1", mtimeMs: 900_000, title: "A")
            try insertRow(s.db, source: "mirror", dir: "P", sid: "s1", mtimeMs: 900_000, title: "A")
            // mirror-only（archiveOnly）
            try insertRow(s.db, source: "mirror", dir: "P", sid: "s2", mtimeMs: 800_000, title: "B")
            // 空 title + fallback（includeUntitled:true 面可见）
            try insertRow(s.db, source: "cc", dir: "P", sid: "s3", mtimeMs: 700_000, title: "", fallback: "FB")
            // worktree 目录（isAll 归父组）
            try insertRow(s.db, source: "cc", dir: "P--worktrees-wt-1", sid: "s4", mtimeMs: 600_000, title: "W")
            // 跨组同 sid：P 组 mirror(500k) vs Q 组 cc(300k) → 二级坍缩 lm 大者（mirror）胜
            try insertRow(s.db, source: "mirror", dir: "P", sid: "s5", mtimeMs: 500_000, title: "P面")
            try insertRow(s.db, source: "cc", dir: "Q", sid: "s5", mtimeMs: 300_000, title: "Q面")
            // 组内 last-wins（dir 字节序最大）——反相关插入序（MAJOR-1）：dir 序大者先插
            try insertRow(s.db, source: "cc", dir: "P--worktrees-wt-2", sid: "s6", mtimeMs: 350_000, title: "新")
            try insertRow(s.db, source: "cc", dir: "P", sid: "s6", mtimeMs: 400_000, title: "老")
            // mirror first-wins（dir 字节序最小）——反相关：dir 序小者后插
            try insertRow(s.db, source: "mirror", dir: "P--worktrees-wt-3", sid: "s7", mtimeMs: 450_000, title: "镜b")
            try insertRow(s.db, source: "mirror", dir: "P", sid: "s7", mtimeMs: 450_000, title: "镜a")
            // 铺量强制翻页（互异 mtime 免 tie，保有序精确比对）
            for i in 0..<12 {
                try insertRow(s.db, source: "cc", dir: "P", sid: "fill\(i)", mtimeMs: Int64(200_000 - i * 1000), title: "f\(i)")
            }

            let oracle = try oracleSorted(s.store, projectHash: nil)
            let pages = try liveWalk(s.store, projectHash: nil, pageSize: 5)
            let flat = pages.flatMap { $0 }
            #expect(flat.map(key) == oracle.map(key))
            // 非末页必满页（keyset 分页无空洞）
            for p in pages.dropLast() { #expect(p.count == 5) }
        }
    }

    // MARK: - 一级去重/可见性钉子

    @Test("CD_livepage_cc_mirror_pair_cc_wins：孪生对出 cc（archiveOnly 缺席）；组内 cc last-wins = dir_name 字节序最大（反相关插入序取证，非 rowid）")
    func ccMirrorPairCCWins() throws {
        try withTempRoot { root in
            let s = try makeStore(root: root)
            // 反相关插入序（对抗验收 MAJOR-1）：dir 序最大者（wt-1）**先插**（rowid 小）——若胜者公式
            // 误用 rowid last-wins 会选 C1；老实际迭代序 = UNIQUE 自动索引 (source,dir_name,session_id)
            // 序 → last-wins = dir 字节序最大 = C2（oracle 对照同锚）。
            try insertRow(s.db, source: "cc", dir: "P--worktrees-wt-1", sid: "x", mtimeMs: 90_000, title: "C2")
            try insertRow(s.db, source: "mirror", dir: "P", sid: "x", mtimeMs: 100_000, title: "M")
            try insertRow(s.db, source: "cc", dir: "P", sid: "x", mtimeMs: 100_000, title: "C1")
            let (page, hasMore) = try s.store.liveSessionsPage(projectHash: nil, after: nil, pageSize: 10)
            #expect(page.count == 1)
            #expect(hasMore == false)
            #expect(page[0].title == "C2")             // dir 字节序最大者胜（"P--worktrees-wt-1" > "P"）
            #expect(page[0].archiveOnly == nil)
            #expect(page[0].lastModified == 90_000)    // emit 在胜者自身键位
            #expect(page[0].worktreeLabel == "wt-1")
            let oracle = try oracleSorted(s.store, projectHash: nil)
            #expect(page.map(key) == oracle.map(key))
        }
    }

    @Test("CD_livepage_mirror_only_archive_only：仅 mirror 行 → archiveOnly=true；mirror first-wins = dir_name 字节序最小（反相关插入序取证，非 rowid）")
    func mirrorOnlyArchiveOnly() throws {
        try withTempRoot { root in
            let s = try makeStore(root: root)
            // 反相关插入序（MAJOR-1）：dir 序最小者（P）**后插**（rowid 大）——误用 rowid first-wins
            // 会选第二镜；老实际迭代序下 first-wins = dir 字节序最小 = 第一镜。
            try insertRow(s.db, source: "mirror", dir: "P--worktrees-wt-1", sid: "m", mtimeMs: 100_000, title: "第二镜")
            try insertRow(s.db, source: "mirror", dir: "P", sid: "m", mtimeMs: 100_000, title: "第一镜")
            let (page, _) = try s.store.liveSessionsPage(projectHash: nil, after: nil, pageSize: 10)
            #expect(page.count == 1)
            #expect(page[0].archiveOnly == true)
            #expect(page[0].title == "第一镜")          // dir 字节序最小者胜（"P" < "P--worktrees-wt-1"）
            let oracle = try oracleSorted(s.store, projectHash: nil)
            #expect(page.map(key) == oracle.map(key))
        }
    }

    @Test("CD_livepage_untitled_fallback_visible：空 title 行可见且 title=titleFallback（生产 includeUntitled:true 口径）")
    func untitledFallbackVisible() throws {
        try withTempRoot { root in
            let s = try makeStore(root: root)
            try insertRow(s.db, source: "cc", dir: "P", sid: "u", mtimeMs: 100_000, title: "", fallback: "兜底题")
            let (page, _) = try s.store.liveSessionsPage(projectHash: nil, after: nil, pageSize: 10)
            #expect(page.map(\.sessionId) == ["u"])
            #expect(page[0].title == "兜底题")
        }
    }

    // MARK: - 项目面（dirSet/worktree）

    @Test("CD_livepage_worktree_label_and_dirset：项目面含 worktree 子目录会话（label 保留），全翻页 ≡ oracle")
    func worktreeLabelAndDirSet() throws {
        try withTempRoot { root in
            let s = try makeStore(root: root)
            // 真目录落盘 → facts worktreeMap 生效（P 子目录 wt-1）
            try writeSessionFile(base: s.cc, project: "P", session: "seed-p", lines: [ccUser("hi", session: "seed-p")])
            try writeSessionFile(base: s.cc, project: "P--worktrees-wt-1", session: "seed-w", lines: [ccUser("hi", session: "seed-w")])
            try insertRow(s.db, source: "cc", dir: "P", sid: "a", mtimeMs: 300_000, title: "父")
            try insertRow(s.db, source: "cc", dir: "P--worktrees-wt-1", sid: "b", mtimeMs: 200_000, title: "子")
            let pages = try liveWalk(s.store, projectHash: "P", pageSize: 1)
            let flat = pages.flatMap { $0 }
            let oracle = try oracleSorted(s.store, projectHash: "P")
            #expect(flat.map(key) == oracle.map(key))
            #expect(flat.map(\.sessionId) == ["a", "b"])
            #expect(flat[1].worktreeLabel == "wt-1")
            #expect(flat.allSatisfy { $0.projectHash == "P" })   // outputProjectHash 恒入参 hash
        }
    }

    @Test("CD_livepage_dirset_excludes_foreign_rows：组外（异项目）同 sid cc 行不遮蔽项目面 mirror 行")
    func dirsetExcludesForeignRows() throws {
        try withTempRoot { root in
            let s = try makeStore(root: root)
            try writeSessionFile(base: s.cc, project: "P", session: "seed-p", lines: [ccUser("hi", session: "seed-p")])
            try insertRow(s.db, source: "mirror", dir: "P", sid: "z", mtimeMs: 100_000, title: "P镜")
            try insertRow(s.db, source: "cc", dir: "F", sid: "z", mtimeMs: 900_000, title: "F源")  // 组外
            let (page, _) = try s.store.liveSessionsPage(projectHash: "P", after: nil, pageSize: 10)
            let mine = page.filter { $0.sessionId == "z" }
            #expect(mine.count == 1)
            #expect(mine[0].archiveOnly == true)       // 组外 cc 不遮蔽（老 filter 先于 dedup 语义）
            #expect(mine[0].title == "P镜")
            let oracle = try oracleSorted(s.store, projectHash: "P")
            #expect(page.map(key) == oracle.map(key).filter { !$0.hasPrefix("seed-p") })
        }
    }

    // MARK: - 二级坍缩（isAll 跨组）

    @Test("CD_livepage_cross_parent_same_sid_max_lm_wins：跨 parent 组同 sid → 组胜者中 lm 大者胜（含 archiveOnly 面）")
    func crossParentSameSidMaxLmWins() throws {
        try withTempRoot { root in
            let s = try makeStore(root: root)
            try insertRow(s.db, source: "mirror", dir: "P", sid: "s", mtimeMs: 500_000, title: "P镜")
            try insertRow(s.db, source: "cc", dir: "Q", sid: "s", mtimeMs: 300_000, title: "Q源")
            let (page, _) = try s.store.liveSessionsPage(projectHash: nil, after: nil, pageSize: 10)
            #expect(page.count == 1)
            #expect(page[0].projectHash == "P")        // 胜组 = lm 大者（P 组 mirror 胜者）
            #expect(page[0].archiveOnly == true)
            #expect(page[0].lastModified == 500_000)
            let oracle = try oracleSorted(s.store, projectHash: nil)
            #expect(page.map(key) == oracle.map(key))
        }
    }

    @Test("CD_livepage_mtime_tie_page_boundary_no_dup_no_loss：全同 mtime tie 串跨页界无重无漏；跨组 tie 只出一条")
    func mtimeTiePageBoundary() throws {
        try withTempRoot { root in
            let s = try makeStore(root: root)
            for i in 0..<10 {
                try insertRow(s.db, source: "cc", dir: "P", sid: String(format: "t%02d", i), mtimeMs: 100_000, title: "T")
            }
            // 跨组同 sid 同 lm（二级坍缩 tie）：确定规则 = 首扫者 emit，且全程只出一条
            try insertRow(s.db, source: "cc", dir: "P", sid: "tie", mtimeMs: 100_000, title: "P面")
            try insertRow(s.db, source: "cc", dir: "Q", sid: "tie", mtimeMs: 100_000, title: "Q面")
            let pages = try liveWalk(s.store, projectHash: nil, pageSize: 3)
            let flat = pages.flatMap { $0 }
            let sids = flat.map(\.sessionId)
            #expect(Set(sids).count == sids.count)                       // 无重
            #expect(Set(sids) == Set((0..<10).map { String(format: "t%02d", $0) } + ["tie"]))  // 无漏
            // tie 场景与 oracle 比集合（老路径 tie 序不稳定，spec 登记确定化偏差）
            let oracle = try oracleSorted(s.store, projectHash: nil)
            #expect(Set(flat.map(\.sessionId)) == Set(oracle.map(\.sessionId)))
            for p in pages.dropLast() { #expect(p.count == 3) }
        }
    }

    // MARK: - codex 合并

    @Test("CD_livepage_codex_overlap_suppressed：codex 同 sid 被 CC 压制；独有 codex 按键位穿插")
    func codexOverlapSuppressed() throws {
        try withTempRoot { root in
            let codex = ListCodexStub(list: [
                codexSummary(sid: "dup", title: "codex影", lm: 999_000),
                codexSummary(sid: "solo", title: "codex独", lm: 150_000),
            ])
            let s = try makeStore(root: root, codex: codex)
            try insertRow(s.db, source: "cc", dir: "P", sid: "dup", mtimeMs: 100_000, title: "CC正")
            try insertRow(s.db, source: "cc", dir: "P", sid: "top", mtimeMs: 200_000, title: "高")
            let (page, _) = try s.store.liveSessionsPage(projectHash: nil, after: nil, pageSize: 10)
            #expect(page.map(\.sessionId) == ["top", "solo", "dup"])   // solo 按 150k 键位插入
            #expect(page.first { $0.sessionId == "dup" }?.title == "CC正")
            let oracle = try oracleSorted(s.store, projectHash: nil)
            #expect(page.map(key) == oracle.map(key))
        }
    }

    @Test("CD_livepage_codex_first_wins_dedup：codex 内部同 sid 原生序首现胜（双向变体：首现低 lm 与首现高 lm 皆首现胜），跨页游标不复活")
    func codexFirstWinsDedup() throws {
        try withTempRoot { root in
            let codex = ListCodexStub(list: [
                codexSummary(sid: "c", title: "首现", lm: 100_000),
                codexSummary(sid: "c", title: "后现高mtime", lm: 900_000),  // native 序在后 → 让位
                codexSummary(sid: "d", title: "陪跑", lm: 500_000),
                // 变体（对抗验收 MINOR-2）：首现 = 高 lm——「误取 lm 小者」实现在上组同绿，此组分歧
                codexSummary(sid: "e", title: "e首现高", lm: 800_000),
                codexSummary(sid: "e", title: "e后现低", lm: 50_000),
            ])
            let s = try makeStore(root: root, codex: codex)
            let pages = try liveWalk(s.store, projectHash: nil, pageSize: 1)
            let flat = pages.flatMap { $0 }
            #expect(flat.map(\.sessionId) == ["e", "d", "c"])          // e=800k 键位（首现高）、c=100k 键位（首现低）
            #expect(flat.first { $0.sessionId == "c" }?.title == "首现")
            #expect(flat.first { $0.sessionId == "e" }?.title == "e首现高")
            let oracle = try oracleSorted(s.store, projectHash: nil)
            #expect(flat.map(key) == oracle.map(key))
        }
    }

    // MARK: - 游标边界

    @Test("CD_livepage_cursor_beyond_end_empty：合法但越界（小于全部键）→ 空页 + hasMore=false")
    func cursorBeyondEndEmpty() throws {
        try withTempRoot { root in
            let s = try makeStore(root: root)
            try insertRow(s.db, source: "cc", dir: "P", sid: "a", mtimeMs: 100_000, title: "A")
            let (page, hasMore) = try s.store.liveSessionsPage(
                projectHash: nil, after: LiveSessionCursor(mtimeMs: 1, sessionId: ""), pageSize: 10)
            #expect(page.isEmpty)
            #expect(hasMore == false)
        }
    }

    @Test("CD_livepage_cursor_row_deleted_resumes：游标行被删后续页 = 删除后 oracle 严格后继切片（keyset 天然抗删）")
    func cursorRowDeletedResumes() throws {
        try withTempRoot { root in
            let s = try makeStore(root: root)
            for i in 0..<8 {
                try insertRow(s.db, source: "cc", dir: "P", sid: "r\(i)", mtimeMs: Int64(800_000 - i * 1000), title: "R")
            }
            let (page1, hasMore1) = try s.store.liveSessionsPage(projectHash: nil, after: nil, pageSize: 3)
            #expect(hasMore1 == true)
            let cursorRow = page1.last!
            _ = try s.db.deleteSession(sessionId: cursorRow.sessionId)   // 删游标行
            let after = LiveSessionCursor(
                mtimeMs: ChatStore.liveSortKeyMs(cursorRow.lastModified), sessionId: cursorRow.sessionId)
            let (page2, _) = try s.store.liveSessionsPage(projectHash: nil, after: after, pageSize: 3)
            let expected = try oracleSorted(s.store, projectHash: nil).filter { s2 in
                let k = ChatStore.liveSortKeyMs(s2.lastModified)
                return k < after.mtimeMs || (k == after.mtimeMs && s2.sessionId < after.sessionId)
            }.prefix(3)
            #expect(page2.map(key) == expected.map(key))
        }
    }

    @Test("CD_livepage_hasmore_exact_page_multiple：总数恰为页长整数倍 → 末页满页且 hasMore=false")
    func hasMoreExactPageMultiple() throws {
        try withTempRoot { root in
            let s = try makeStore(root: root)
            for i in 0..<6 {
                try insertRow(s.db, source: "cc", dir: "P", sid: "e\(i)", mtimeMs: Int64(600_000 - i * 1000), title: "E")
            }
            let (p1, h1) = try s.store.liveSessionsPage(projectHash: nil, after: nil, pageSize: 3)
            #expect(p1.count == 3 && h1 == true)
            let last = p1.last!
            let (p2, h2) = try s.store.liveSessionsPage(
                projectHash: nil,
                after: LiveSessionCursor(mtimeMs: ChatStore.liveSortKeyMs(last.lastModified), sessionId: last.sessionId),
                pageSize: 3)
            #expect(p2.count == 3 && h2 == false)                        // 恰尽：无第 4 条 → false
        }
    }

    // MARK: - 内部续批（P1-2 同键簇跨批界）

    @Test("CD_livepage_underfill_continuation：大量同 (lm,sid) 败者簇强制窗口多批续取，胜者不被批边界吞掉")
    func underfillContinuation() throws {
        try withTempRoot { root in
            let s = try makeStore(root: root)
            // 20 sid × 30 行（1 cc + 29 mirror，同 sid 同 mtime = 同键簇）= 600 行 > 批 K(256)：
            // 批边界必然切进簇内——若续批键退化为 (lm,sid) 严格后继，整簇剩余行（可能含 cc 胜者）被跳过。
            for i in 0..<20 {
                let sid = String(format: "u%02d", i)
                let lm = Int64(900_000 - i * 1000)
                for d in 1...29 {
                    try insertRow(s.db, source: "mirror", dir: "P--worktrees-wt-\(d)", sid: sid, mtimeMs: lm, title: "败")
                }
                try insertRow(s.db, source: "cc", dir: "P--worktrees-wt-30", sid: sid, mtimeMs: lm, title: "胜")
            }
            let pages = try liveWalk(s.store, projectHash: nil, pageSize: 20)
            let flat = pages.flatMap { $0 }
            #expect(flat.count == 20)
            // 每 sid 组内 cc last-wins：胜者必为 cc（archiveOnly 缺席 + title 胜）——批边界吞胜者则此处红
            #expect(flat.allSatisfy { $0.archiveOnly == nil && $0.title == "胜" })
            let oracle = try oracleSorted(s.store, projectHash: nil)
            #expect(flat.map(key) == oracle.map(key))
        }
    }

    // MARK: - 索引闸

    @Test("CD_index_open_idempotent_reopen：重开库幂等补建三索引，user_version 恒 2 不触发重建")
    func indexOpenIdempotentReopen() throws {
        try withTempRoot { root in
            let path = root.appendingPathComponent("chat.db")
            let db1 = try ChatDatabase.open(at: path)
            try insertRow(db1, source: "cc", dir: "P", sid: "keep", mtimeMs: 1, title: "K")
            #expect(try db1.userVersion() == 2)
            let db2 = try ChatDatabase.open(at: path)                    // 重开：IF NOT EXISTS no-op
            #expect(try db2.userVersion() == 2)
            let names = try db2.pool.read { d in
                try String.fetchAll(d, sql: "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_chat_sessions_%' ORDER BY name")
            }
            #expect(names == ["idx_chat_sessions_dir_mtime_sid", "idx_chat_sessions_mtime_sid", "idx_chat_sessions_sid"])
            // 未触发删表重建：行还在
            let count = try db2.pool.read { d in
                try Int.fetchOne(d, sql: "SELECT COUNT(*) FROM chat_sessions") ?? 0
            }
            #expect(count == 1)
        }
    }

    @Test("CD_livepage_window_uses_index：两种窗口形态走目标索引且无 temp 排序（防静默退化——无 ANALYZE 时 planner 曾实选 UNIQUE 自动索引 + 排序）")
    func windowUsesIndex() throws {
        try withTempRoot { root in
            let s = try makeStore(root: root)
            try insertRow(s.db, source: "cc", dir: "P", sid: "a", mtimeMs: 1, title: "A")
            func plan(_ sql: String) throws -> String {
                try s.db.pool.read { d in
                    try Row.fetchAll(d, sql: "EXPLAIN QUERY PLAN " + sql)
                        .map { "\($0)" }.joined(separator: "\n")
                }
            }
            // isAll 窗口（生产 SQL 同形）
            let allPlan = try plan("""
                SELECT * FROM chat_sessions INDEXED BY idx_chat_sessions_mtime_sid
                WHERE source IN ('cc','mirror')
                ORDER BY file_mtime_ms DESC, session_id DESC, id DESC LIMIT 256
                """)
            // per-dir 窗口（生产 SQL 同形）
            let dirPlan = try plan("""
                SELECT * FROM chat_sessions INDEXED BY idx_chat_sessions_dir_mtime_sid
                WHERE source IN ('cc','mirror') AND dir_name = 'P'
                ORDER BY file_mtime_ms DESC, session_id DESC, id DESC LIMIT 256
                """)
            // 宽松断言（EXPLAIN 输出格式随 SQLite 版本漂移，只锚索引名 + 排序缺席）
            #expect(allPlan.contains("idx_chat_sessions_mtime_sid"))
            #expect(dirPlan.contains("idx_chat_sessions_dir_mtime_sid"))
            #expect(!allPlan.contains("TEMP B-TREE"))     // 序扫免排序 = LIMIT 早停成立
            #expect(!dirPlan.contains("TEMP B-TREE"))
        }
    }
}
