// ChatStore 查询面端到端（specs/behavior/chat-data.md §1~§5）——对 fixture 目录树跑四查询 +
// 批2 认领的 5 条 CD_*（tail 读 / 搜索去重 CC 先 / readSession CC 先 / mirror 合并 CC 优先 / mirror archiveOnly）。
import Foundation
import Testing

import MuxvoTestSupport
@testable import MuxvoChatHistory

// MARK: - fixture 工具（ccUser / writeSessionFile 复用 ChatIndexerTests.swift）

/// 带 cwd 的 CC user 行（projects displayPath / cwd 用）。
func ccUserCwd(_ text: String, cwd: String, session: String = "S", ts: String = "2026-07-06T00:00:00.000Z") -> String {
    #"{"type":"user","sessionId":"\#(session)","cwd":"\#(cwd)","timestamp":"\#(ts)","message":{"role":"user","content":"\#(text)"}}"#
}

/// CC 内部 user 行（system-reminder 起头 → title 跳过 → 空 title）。
func ccInternalUser(session: String = "S") -> String {
    #"{"type":"user","sessionId":"\#(session)","timestamp":"2026-07-06T00:00:00.000Z","message":{"role":"user","content":"<system-reminder>internal</system-reminder>"}}"#
}

/// 取 ChatSessionMessage 的纯文本（.text 分支），非 text → nil。
func msgText(_ m: ChatSessionMessage) -> String? {
    if case .text(let s) = m.content { return s } else { return nil }
}

// Codex fixture
@discardableResult
func writeCodex(base: URL, y: String, m: String, d: String, filename: String, lines: [String]) throws -> URL {
    let dir = base.appendingPathComponent("sessions/\(y)/\(m)/\(d)", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let file = dir.appendingPathComponent(filename, isDirectory: false)
    try lines.joined(separator: "\n").write(to: file, atomically: true, encoding: .utf8)
    return file
}
func codexMetaLine(id: String, cwd: String) -> String {
    #"{"type":"session_meta","timestamp":"2026-07-06T00:00:00.000Z","payload":{"id":"\#(id)","cwd":"\#(cwd)","timestamp":"2026-07-06T00:00:00.000Z"}}"#
}
func codexUserLine(_ msg: String) -> String {
    #"{"type":"event_msg","timestamp":"2026-07-06T00:00:01.000Z","payload":{"type":"user_message","message":"\#(msg)"}}"#
}

// MARK: - 查询面端到端

@Suite("ChatStore 查询面端到端（§1~§5）")
struct ChatStoreQueryTests {

    private func openStore(_ root: URL, mirror: Bool = false, codex: Bool = false)
        throws -> (store: ChatStore, cc: URL, mirror: URL?, codex: URL?)
    {
        let cc = root.appendingPathComponent("projects", isDirectory: true)
        try FileManager.default.createDirectory(at: cc, withIntermediateDirectories: true)
        let mirrorURL = mirror ? root.appendingPathComponent("chat-history", isDirectory: true) : nil
        let codexURL = codex ? root.appendingPathComponent("dotcodex", isDirectory: true) : nil
        let db = try ChatDatabase.open(at: root.appendingPathComponent("chat.db"))
        return (ChatStore(ccBase: cc, mirrorBase: mirrorURL, codexBase: codexURL, database: db), cc, mirrorURL, codexURL)
    }

    @Test("projects：worktree 归父，父 sessionCount = 自身 + 子，无独立 worktree 条目（§1.2）")
    func projectsWorktreeMerged() throws {
        try withTempRoot { root in
            let s = try openStore(root)
            try writeSessionFile(base: s.cc, project: "P", session: "a",
                lines: [ccUserCwd("hi", cwd: "/Users/t/proj", session: "a")])
            try writeSessionFile(base: s.cc, project: "P", session: "b",
                lines: [ccUserCwd("hi", cwd: "/Users/t/proj", session: "b")])
            try writeSessionFile(base: s.cc, project: "P--worktrees-wt-1", session: "c",
                lines: [ccUserCwd("hi", cwd: "/Users/t/proj/.worktrees/wt-1", session: "c")])
            let projects = try s.store.projects()
            #expect(projects.count == 1)
            #expect(projects.first?.projectHash == "P")
            #expect(projects.first?.sessionCount == 3)     // 2 + 1
            #expect(!projects.contains { $0.projectHash.contains("--worktrees-") })
        }
    }

    @Test("sessions：空 title 会话丢弃；正常会话进列表（§2.2）")
    func sessionsEmptyTitleDropped() throws {
        try withTempRoot { root in
            let s = try openStore(root)
            try writeSessionFile(base: s.cc, project: "P", session: "good",
                lines: [ccUser("real question", session: "good")])
            try writeSessionFile(base: s.cc, project: "P", session: "empty",
                lines: [ccInternalUser(session: "empty")])   // 仅内部消息 → title 空
            let sessions = try s.store.sessions(projectHash: "P", limit: 10)
            #expect(sessions.map(\.sessionId) == ["good"])
            #expect(sessions.first?.title == "real question")
        }
    }

    @Test("reconcile:false（批3 首开快路）：projects 走目录扫描即返；sessions 冷库空、reconcile 后读缓存有")
    func reconcileSkipFastPath() throws {
        try withTempRoot { root in
            let s = try openStore(root)
            try writeSessionFile(base: s.cc, project: "P", session: "a",
                lines: [ccUser("real question", session: "a")])
            // projects 不依赖 chat.db：reconcile:false 即返 CC 项目（不跑 indexer）。
            #expect(try s.store.projects(reconcile: false).map(\.projectHash) == ["P"])
            // sessions 依赖 chat.db 缓存：冷库（未 reconcile）→ 空态（非阻塞返回）。
            #expect(try s.store.sessions(projectHash: "P", limit: 10, reconcile: false).isEmpty)
            // 后台 reconcile 后，reconcile:false 读缓存 → 有数据。
            try s.store.reconcile()
            #expect(try s.store.sessions(projectHash: "P", limit: 10, reconcile: false).map(\.sessionId) == ["a"])
        }
    }

    @Test("search：中文子串命中，snippet 原文保真（§4.1）")
    func searchChinese() throws {
        try withTempRoot { root in
            let s = try openStore(root)
            try writeSessionFile(base: s.cc, project: "P", session: "S",
                lines: [ccUser("请帮我修复终端渲染问题", session: "S")])
            let results = try s.store.search(query: "终端渲染")
            #expect(results.count == 1)
            #expect(results.first?.sessionId == "S")
            #expect(results.first?.snippet.contains("终端渲染") == true)
        }
    }

    // MARK: - 批2 认领 CD_*

    @Test("CD_detail_tail_read_skip_first：文件 >2MB 带 limit → tail 读、取尾 limit（首消息不在结果）")
    func CD_detail_tail_read_skip_first() throws {
        try withTempRoot { root in
            let s = try openStore(root)
            let pad = String(repeating: "x", count: 200)
            var lines = [ccUser("FIRST_MESSAGE_UNIQUE", session: "S")]
            for i in 0..<9000 { lines.append(ccUser("filler \(i) \(pad)", session: "S")) }
            lines += [ccUser("LAST_A", session: "S"), ccUser("LAST_B", session: "S"), ccUser("LAST_C", session: "S")]
            let file = try writeSessionFile(base: s.cc, project: "P", session: "S", lines: lines)
            let size = (try FileManager.default.attributesOfItem(atPath: file.path)[.size] as? Int) ?? 0
            #expect(size > 2 * 1024 * 1024)  // 确保命中 tail 路径

            let tail = try s.store.messages(projectHash: "P", sessionId: "S", limit: 3)
            #expect(tail.count == 3)
            #expect(tail.compactMap(msgText) == ["LAST_A", "LAST_B", "LAST_C"])
            #expect(!tail.compactMap(msgText).contains("FIRST_MESSAGE_UNIQUE"))

            // 无 limit → 全读（首消息在内），证明 tail 是 limit 触发的子集
            let all = try s.store.messages(projectHash: "P", sessionId: "S", limit: nil)
            #expect(all.count == lines.count)
            #expect(msgText(all.first!) == "FIRST_MESSAGE_UNIQUE")
        }
    }

    @Test("messages limit=nil → 全量返回（session.all 数据层支撑，无上限）：CC 与 Codex 两侧都全返回")
    func messages_limit_nil_returns_all_both_sources() throws {
        try withTempRoot { root in
            let s = try openStore(root, codex: true)
            // CC 250 条 → limit=nil 全返回，首尾都在（<2MB，走全读路径而非 tail）
            let n = 250
            var ccLines: [String] = []
            for i in 0..<n { ccLines.append(ccUser("m\(i)", session: "S")) }
            try writeSessionFile(base: s.cc, project: "P", session: "S", lines: ccLines)
            let ccAll = try s.store.messages(projectHash: "P", sessionId: "S", limit: nil)
            #expect(ccAll.count == n)
            #expect(msgText(ccAll.first!) == "m0")
            #expect(msgText(ccAll.last!) == "m\(n - 1)")

            // Codex 侧同样：readSession(limit:nil) 全返回（跨源 session.all 都要无上限）
            var cxLines = [codexMetaLine(id: "CX", cwd: "/w")]
            for i in 0..<120 { cxLines.append(codexUserLine("cx\(i)")) }
            try writeCodex(base: s.codex!, y: "2026", m: "07", d: "08",
                filename: "rollout-2026-07-08T00-00-00-cccc-1-2-3-4.jsonl", lines: cxLines)
            let cxAll = try s.store.messages(projectHash: "PX", sessionId: "CX", limit: nil)
            #expect(cxAll.count == 120)
        }
    }

    @Test("CD_search_dedup_cc_priority：同 session CC+mirror 只出一条，CC 先占位")
    func CD_search_dedup_cc_priority() throws {
        try withTempRoot { root in
            let s = try openStore(root, mirror: true)
            try writeSessionFile(base: s.cc, project: "P", session: "S",
                lines: [ccUser("needle CC version", session: "S", ts: "cc-ts")])
            try writeSessionFile(base: s.mirror!, project: "P", session: "S",
                lines: [ccUser("needle MIRROR version", session: "S", ts: "mirror-ts")])
            let results = try s.store.search(query: "needle")
            #expect(results.count == 1)                              // 去重
            #expect(results.first?.snippet.contains("CC version") == true)  // CC 占位胜
            #expect(results.first?.timestamp == "cc-ts")
        }
    }

    @Test("CD_multisource_readsession_cc_first：readSession CC 有则用 CC，空才落 Codex")
    func CD_multisource_readsession_cc_first() throws {
        try withTempRoot { root in
            let s = try openStore(root, codex: true)
            // 同 sessionId S 在 CC 与 Codex 各有内容 → CC 胜
            try writeSessionFile(base: s.cc, project: "P", session: "S",
                lines: [ccUser("CC_MESSAGE", session: "S")])
            try writeCodex(base: s.codex!, y: "2026", m: "07", d: "06",
                filename: "rollout-2026-07-06T00-00-00-aaaa-1-2-3-4.jsonl",
                lines: [codexMetaLine(id: "S", cwd: "/w"), codexUserLine("CODEX_MESSAGE")])
            let ccWin = try s.store.messages(projectHash: "P", sessionId: "S", limit: nil)
            #expect(ccWin.compactMap(msgText) == ["CC_MESSAGE"])   // CC 先

            // 仅 Codex 存在的 session → 落 Codex
            try writeCodex(base: s.codex!, y: "2026", m: "07", d: "07",
                filename: "rollout-2026-07-07T00-00-00-bbbb-1-2-3-4.jsonl",
                lines: [codexMetaLine(id: "CODEXONLY", cwd: "/w"), codexUserLine("ONLY_CODEX")])
            let codexFallback = try s.store.messages(projectHash: "P", sessionId: "CODEXONLY", limit: nil)
            #expect(codexFallback.compactMap(msgText) == ["ONLY_CODEX"])
        }
    }

    @Test("CD_mirror_cc_priority_merge：合并键 (projectHash,sessionId) CC 覆盖同键镜像")
    func CD_mirror_cc_priority_merge() throws {
        try withTempRoot { root in
            let s = try openStore(root, mirror: true)
            try writeSessionFile(base: s.cc, project: "P", session: "S",
                lines: [ccUser("CCTITLE", session: "S")])
            try writeSessionFile(base: s.mirror!, project: "P", session: "S",
                lines: [ccUser("MIRRORTITLE", session: "S")])
            let sessions = try s.store.sessions(projectHash: "P", limit: 10)
            #expect(sessions.count == 1)
            #expect(sessions.first?.sessionId == "S")
            #expect(sessions.first?.title == "CCTITLE")           // CC 覆盖镜像
            #expect(sessions.first?.archiveOnly == nil)           // 有 CC → 非 archiveOnly
        }
    }

    @Test("CD_mirror_add_only_no_delete：仅镜像存在的 session → 合并标 archiveOnly")
    func CD_mirror_add_only_no_delete() throws {
        try withTempRoot { root in
            let s = try openStore(root, mirror: true)
            // cc/P 有 live 会话 S1；mirror/P 有仅镜像会话 M（cc 无）
            try writeSessionFile(base: s.cc, project: "P", session: "S1",
                lines: [ccUser("live one", session: "S1")])
            try writeSessionFile(base: s.mirror!, project: "P", session: "M",
                lines: [ccUser("archived only", session: "M")])
            let sessions = try s.store.sessions(projectHash: "P", limit: 10)
            let byId = Dictionary(uniqueKeysWithValues: sessions.map { ($0.sessionId, $0) })
            #expect(byId["S1"]?.archiveOnly == nil)     // live → 非 archiveOnly
            #expect(byId["M"]?.archiveOnly == true)     // 仅镜像 → archiveOnly
            #expect(byId["M"]?.title == "archived only")
        }
    }

    @Test("换根 reconcile 重入（PR-4）：同一 chat.db 镜像根 A→B 换根，旧根 mirror 行清、新根行入（schema 不 bump）")
    func rebaseMirrorReconcileReentry() throws {
        try withTempRoot { root in
            let cc = root.appendingPathComponent("projects", isDirectory: true)
            try FileManager.default.createDirectory(at: cc, withIntermediateDirectories: true)
            let mirrorA = root.appendingPathComponent("mirror-a", isDirectory: true)
            let mirrorB = root.appendingPathComponent("mirror-b", isDirectory: true)
            let db = try ChatDatabase.open(at: root.appendingPathComponent("chat.db"))
            // mirrorA 有会话 X、mirrorB 有会话 Y（cc 无对应 → 各自 archiveOnly）。
            try writeSessionFile(base: mirrorA, project: "P", session: "X",
                lines: [ccUser("archived X", session: "X")])
            try writeSessionFile(base: mirrorB, project: "P", session: "Y",
                lines: [ccUser("archived Y", session: "Y")])

            // 换根前：store 指 mirrorA → reconcile → chat.db mirror 行只有 X。
            let storeA = ChatStore(ccBase: cc, mirrorBase: mirrorA, database: db)
            try storeA.reconcile()
            #expect(try storeA.sessions(projectHash: "P", limit: 10, reconcile: false).map(\.sessionId) == ["X"])

            // 换根：新 store 指 mirrorB（同一 db）→ reconcile → 旧根 X 行清、新根 Y 行入。
            let storeB = ChatStore(ccBase: cc, mirrorBase: mirrorB, database: db)
            try storeB.reconcile()
            let after = try storeB.sessions(projectHash: "P", limit: 10, reconcile: false)
            #expect(after.map(\.sessionId) == ["Y"])       // 旧根 X 已清、新根 Y 入
            #expect(after.first?.archiveOnly == true)       // 换根后新根会话仍 archiveOnly（cc 无）
        }
    }
}
