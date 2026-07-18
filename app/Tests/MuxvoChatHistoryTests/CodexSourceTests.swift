// CD_codex_* 案例池（chat-data.md §7 Codex 侧）：行投影 shape / title 兜底 / 目录读者 /
// 搜索 / 元数据。纯解析层用解码 dict 直驱；读者层在临时 ~/.codex 树上端到端跑（SEC-15：合成脱敏样本）。
import Foundation
import Testing

import MuxvoTestSupport
@testable import MuxvoChatHistory

@Suite("Codex 源投影/读者（§5 映射 + 元数据 + 搜索）")
struct CodexSourceTests {

    // MARK: - 纯解析层（CodexLineParser.parseMessage）

    private func obj(_ json: String) -> [String: Any] {
        try! JSONSerialization.jsonObject(with: Data(json.utf8)) as! [String: Any]
    }

    @Test("CD_codex_mapped_same_shape：四类别 → 同 SessionMessage 四类型，uuid codex- 前缀")
    func CD_codex_mapped_same_shape() {
        let sid = "sess-1"
        // user_message
        let user = CodexLineParser.parseMessage(
            obj(#"{"type":"event_msg","timestamp":"t1","payload":{"type":"user_message","message":"hi"}}"#),
            sessionId: sid, cwd: "/w", lineIndex: 3)
        #expect(user == ChatSessionMessage(
            uuid: "codex-sess-1-user-3", type: .user, sessionId: sid, cwd: "/w",
            timestamp: "t1", content: .text("hi")))

        // agent_message
        let agent = CodexLineParser.parseMessage(
            obj(#"{"type":"event_msg","timestamp":"t2","payload":{"type":"agent_message","message":"yo"}}"#),
            sessionId: sid, cwd: "/w", lineIndex: 4)
        #expect(agent == ChatSessionMessage(
            uuid: "codex-sess-1-agent-4", type: .assistant, sessionId: sid, cwd: "/w",
            timestamp: "t2", content: .text("yo")))

        // function_call with call_id → uuid == call_id（**无 codex- 前缀**，§5.2 例外），input 保真 JSON 串
        let call = CodexLineParser.parseMessage(
            obj(#"{"type":"response_item","timestamp":"t3","payload":{"type":"function_call","name":"exec_command","arguments":"{\"cmd\":\"ls\"}","call_id":"call_ABC"}}"#),
            sessionId: sid, cwd: "/w", lineIndex: 5)
        #expect(call == ChatSessionMessage(
            uuid: "call_ABC", type: .assistant, sessionId: sid, cwd: "/w", timestamp: "t3",
            content: .blocks([ChatContentBlock(
                type: "tool_use", name: "exec_command", input: .string("{\"cmd\":\"ls\"}"))])))
        #expect(call?.uuid == "call_ABC")  // 显式锚定：非 codex- 前缀

        // function_call_output → tool_result，content=.string(output)，tool_use_id=call_id
        let out = CodexLineParser.parseMessage(
            obj(#"{"type":"response_item","timestamp":"t4","payload":{"type":"function_call_output","call_id":"call_ABC","output":"file1\nfile2"}}"#),
            sessionId: sid, cwd: "/w", lineIndex: 6)
        #expect(out == ChatSessionMessage(
            uuid: "codex-sess-1-result-6", type: .assistant, sessionId: sid, cwd: "/w", timestamp: "t4",
            content: .blocks([ChatContentBlock(
                type: "tool_result", content: .string("file1\nfile2"), toolUseId: "call_ABC")])))
    }

    @Test("CD_codex_tool_no_callid：function_call 无 call_id → uuid codex-{sid}-tool-{i}")
    func CD_codex_tool_no_callid() {
        let msg = CodexLineParser.parseMessage(
            obj(#"{"type":"response_item","payload":{"type":"function_call","arguments":"{}"}}"#),
            sessionId: "s", cwd: "", lineIndex: 2)
        #expect(msg?.uuid == "codex-s-tool-2")
        // name 缺失 → 兜底 payloadType（legacy `payload.name || payloadType`）
        if case .blocks(let b)? = msg?.content { #expect(b.first?.name == "function_call") }
        else { Issue.record("应为 blocks") }
    }

    @Test("CD_codex_custom_tool：custom_tool_call 取 payload.input（对象保真），custom_tool_call_output → tool_result")
    func CD_codex_custom_tool() {
        let call = CodexLineParser.parseMessage(
            obj(#"{"type":"response_item","payload":{"type":"custom_tool_call","name":"grep","input":{"q":"x","n":3}}}"#),
            sessionId: "s", cwd: "", lineIndex: 0)
        #expect(call?.content == .blocks([ChatContentBlock(
            type: "tool_use", name: "grep",
            input: .object(["q": .string("x"), "n": .int(3)]))]))  // 对象结构保真
        let out = CodexLineParser.parseMessage(
            obj(#"{"type":"response_item","payload":{"type":"custom_tool_call_output","call_id":"c1","output":"done"}}"#),
            sessionId: "s", cwd: "", lineIndex: 1)
        #expect(out?.content == .blocks([ChatContentBlock(
            type: "tool_result", content: .string("done"), toolUseId: "c1")]))
    }

    @Test("CD_codex_tool_result_output_preserved：output 数组/对象 → content 保结构（legacy 真值语义，非丢空串）")
    func CD_codex_tool_result_output_preserved() {
        // 数组型 output（本机真实数据 36 条命中此路径）→ content 保数组，绝不 `as? String ?? ""` 丢成空
        let arr = CodexLineParser.parseMessage(
            obj(#"{"type":"response_item","payload":{"type":"function_call_output","call_id":"c1","output":["a","b"]}}"#),
            sessionId: "s", cwd: "", lineIndex: 0)
        #expect(arr?.content == .blocks([ChatContentBlock(
            type: "tool_result", content: .array([.string("a"), .string("b")]), toolUseId: "c1")]))

        // 对象型 output → content 保对象结构（数值分列 .int）；custom_tool_call_output 同路径同修
        let objOut = CodexLineParser.parseMessage(
            obj(#"{"type":"response_item","payload":{"type":"custom_tool_call_output","call_id":"c2","output":{"stdout":"hi","code":0}}}"#),
            sessionId: "s", cwd: "", lineIndex: 1)
        #expect(objOut?.content == .blocks([ChatContentBlock(
            type: "tool_result", content: .object(["stdout": .string("hi"), "code": .int(0)]),
            toolUseId: "c2")]))

        // falsy（空串 / 缺 output / null）→ content 兜底 .string("")（legacy `|| ''`）
        for json in [
            #"{"type":"response_item","payload":{"type":"function_call_output","call_id":"c","output":""}}"#,
            #"{"type":"response_item","payload":{"type":"function_call_output","call_id":"c"}}"#,
            #"{"type":"response_item","payload":{"type":"function_call_output","call_id":"c","output":null}}"#,
        ] {
            let m = CodexLineParser.parseMessage(obj(json), sessionId: "s", cwd: "", lineIndex: 0)
            #expect(m?.content == .blocks([ChatContentBlock(
                type: "tool_result", content: .string(""), toolUseId: "c")]))
        }
    }

    @Test("CD_codex_tool_empty_callid：call_id 空串 → uuid 兜底 codex-{sid}-tool-{i}（真值语义，非保留空串）")
    func CD_codex_tool_empty_callid() {
        let msg = CodexLineParser.parseMessage(
            obj(#"{"type":"response_item","payload":{"type":"function_call","arguments":"{}","call_id":""}}"#),
            sessionId: "s", cwd: "", lineIndex: 7)
        #expect(msg?.uuid == "codex-s-tool-7")  // 空串 call_id 不作 uuid（legacy `payload.call_id || ...` 真值兜底）
    }

    @Test("CD_codex_skip_and_empty：session_meta/token_count/reasoning/turn_context 跳过；空 message → nil")
    func CD_codex_skip_and_empty() {
        for json in [
            #"{"type":"session_meta","payload":{"id":"x"}}"#,
            #"{"type":"event_msg","payload":{"type":"token_count","info":{}}}"#,
            #"{"type":"response_item","payload":{"type":"reasoning","summary":"..."}}"#,
            #"{"type":"turn_context","payload":{}}"#,
            #"{"type":"event_msg","payload":{"type":"user_message","message":""}}"#,   // 空 user → nil
            #"{"type":"event_msg","payload":{"type":"agent_message","message":""}}"#,  // 空 agent → nil
            #"{"type":"event_msg"}"#,                                                    // 无 payload → nil
        ] {
            #expect(CodexLineParser.parseMessage(obj(json), sessionId: "s", cwd: "", lineIndex: 0) == nil)
        }
    }

    // MARK: - 读者层（临时 ~/.codex 树）

    /// 在 base（=~/.codex）下写一个会话文件 sessions/y/m/d/filename，行 join \n，可设 mtime。
    @discardableResult
    private func writeSession(
        base: URL, y: String, m: String, d: String, filename: String,
        lines: [String], mtime: Date? = nil
    ) throws -> URL {
        let dir = base.appendingPathComponent("sessions/\(y)/\(m)/\(d)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let file = dir.appendingPathComponent(filename, isDirectory: false)
        try lines.joined(separator: "\n").write(to: file, atomically: true, encoding: .utf8)
        if let mtime {
            try FileManager.default.setAttributes([.modificationDate: mtime], ofItemAtPath: file.path)
        }
        return file
    }

    private func metaLine(id: String, cwd: String, ts: String = "2026-06-04T18:39:26.000Z") -> String {
        #"{"type":"session_meta","timestamp":"\#(ts)","payload":{"id":"\#(id)","cwd":"\#(cwd)","timestamp":"\#(ts)"}}"#
    }
    private func userLine(_ message: String, ts: String = "2026-06-04T18:39:30.000Z") -> String {
        #"{"type":"event_msg","timestamp":"\#(ts)","payload":{"type":"user_message","message":"\#(message)"}}"#
    }

    @Test("CD_codex_title_never_empty：无 thread-title、无 user_message → title 兜底 sessionId")
    func CD_codex_title_never_empty() throws {
        try withTempRoot { root in
            let base = root  // 充当 ~/.codex
            let id = "019e9237-6c4c-79e0-8676-f8b9a700a0f8"
            // 仅 meta（无 user_message，无 thread-title）
            try writeSession(base: base, y: "2026", m: "06", d: "04",
                filename: "rollout-2026-06-04T18-39-26-\(id).jsonl",
                lines: [metaLine(id: id, cwd: "/Users/testuser/demo")])
            let src = CodexSessionSource(codexBasePath: base)
            let summaries = src.getAllRecentSessions(limit: 10)
            #expect(summaries.count == 1)
            #expect(summaries.first?.title == id)          // 兜底 sessionId（永不空）
            #expect(summaries.first?.source == .codex)
            #expect(summaries.first?.cwd == nil)           // 登记：Codex summary 不设 cwd（对齐 legacy）
        }
    }

    @Test("CD_codex_title_from_first_user：无 thread-title 但有 user_message → title = 首条 user 截 100")
    func CD_codex_title_from_first_user() throws {
        try withTempRoot { root in
            let id = "aaaa-bbbb-cccc-dddd-eeee"
            try writeSession(base: root, y: "2026", m: "06", d: "04",
                filename: "rollout-2026-06-04T00-00-00-\(id).jsonl",
                lines: [metaLine(id: id, cwd: "/w"), userLine("first question here")])
            let summaries = CodexSessionSource(codexBasePath: root).getAllRecentSessions(limit: 10)
            #expect(summaries.first?.title == "first question here")
        }
    }

    @Test("CD_codex_title_thread_wins：thread-titles.titles[sessionId] 优先于首条 user")
    func CD_codex_title_thread_wins() throws {
        try withTempRoot { root in
            let id = "tttt-1111-2222-3333-4444"
            try writeSession(base: root, y: "2026", m: "06", d: "04",
                filename: "rollout-2026-06-04T00-00-00-\(id).jsonl",
                lines: [metaLine(id: id, cwd: "/w"), userLine("ignored first message")])
            let state = #"{"thread-titles":{"titles":{"\#(id)":"Curated Title"}}}"#
            try state.write(to: root.appendingPathComponent(".codex-global-state.json"),
                atomically: true, encoding: .utf8)
            let summaries = CodexSessionSource(codexBasePath: root).getAllRecentSessions(limit: 10)
            #expect(summaries.first?.title == "Curated Title")
        }
    }

    @Test("CD_codex_meta_id_authoritative：sessionId = meta.id（非文件名末 5 段）")
    func CD_codex_meta_id_authoritative() throws {
        try withTempRoot { root in
            // 文件名 UUID 与 meta.id 故意不同 → 存储用 meta.id
            try writeSession(base: root, y: "2026", m: "06", d: "04",
                filename: "rollout-2026-06-04T00-00-00-ffff-9999-8888-7777-6666.jsonl",
                lines: [metaLine(id: "META-ID-0001", cwd: "/w")])
            let summaries = CodexSessionSource(codexBasePath: root).getAllRecentSessions(limit: 10)
            #expect(summaries.first?.sessionId == "META-ID-0001")
        }
    }

    @Test("CD_codex_readsession_end_to_end：全 rollout 逐行投影，cwd 来自 meta，lineIndex 计非空行")
    func CD_codex_readsession_end_to_end() throws {
        try withTempRoot { root in
            let id = "rs01-1111-2222-3333-4444"
            try writeSession(base: root, y: "2026", m: "06", d: "04",
                filename: "rollout-2026-06-04T00-00-00-\(id).jsonl",
                lines: [
                    metaLine(id: id, cwd: "/Users/testuser/repo"),        // idx 0 → skip
                    #"{"type":"event_msg","payload":{"type":"token_count"}}"#,  // idx 1 → skip
                    userLine("do the thing", ts: "t-user"),                // idx 2 → user
                    #"{"type":"event_msg","timestamp":"t-agent","payload":{"type":"agent_message","message":"ok"}}"#,  // idx 3
                ])
            let msgs = CodexSessionSource(codexBasePath: root).readSession(sessionId: id)
            #expect(msgs.count == 2)
            #expect(msgs[0].uuid == "codex-\(id)-user-2")   // lineIndex 计入被跳过的行
            #expect(msgs[0].cwd == "/Users/testuser/repo")  // cwd 来自 meta
            #expect(msgs[0].content == .text("do the thing"))
            #expect(msgs[1].uuid == "codex-\(id)-agent-3")
            // limit：取尾 N
            let tail = CodexSessionSource(codexBasePath: root).readSession(sessionId: id, limit: 1)
            #expect(tail.map(\.uuid) == ["codex-\(id)-agent-3"])
        }
    }

    @Test("CD_codex_resume_cwd_from_session_meta（F-B 钉死）：rollout 首行 session_meta.cwd == 全部投影消息 cwd（§7.7 Codex 续聊 cwd 源）")
    func CD_codex_resume_cwd_from_session_meta() throws {
        // 钉死链路：Codex `SessionSummary.cwd` 恒 nil（双跑红线，勿改数据面 reader），故用户「继续聊天」某
        // Codex 会话时 chatResume 的 cwd **只能**取自逐条消息的 cwd（← session_meta.payload.cwd）。F-B「注入
        // cd 写权威 cwd」的正确性依赖此 cwd 无误——任何映射回归都会让 Codex 续聊落错目录。故显式钉死。
        try withTempRoot { root in
            let id = "cwd0-1111-2222-3333-4444"
            let target = "/Users/testuser/proj-codex"
            try writeSession(base: root, y: "2026", m: "06", d: "04",
                filename: "rollout-2026-06-04T00-00-00-\(id).jsonl",
                lines: [
                    metaLine(id: id, cwd: target),   // 首行 session_meta.payload.cwd = 目标
                    userLine("q1"),                  // → user 消息
                    #"{"type":"event_msg","timestamp":"t2","payload":{"type":"agent_message","message":"a1"}}"#,
                    #"{"type":"response_item","timestamp":"t3","payload":{"type":"function_call","name":"exec","arguments":"{}","call_id":"c1"}}"#,
                ])
            let msgs = CodexSessionSource(codexBasePath: root).readSession(sessionId: id)
            #expect(msgs.count == 3, "user + agent + tool_use 三条投影")
            #expect(msgs.allSatisfy { $0.cwd == target },
                    "全部投影消息 cwd == session_meta.cwd（Codex 续聊 chatResume 的唯一 cwd 源）；实得 \(msgs.map(\.cwd))")
        }
    }

    @Test("CD_codex_readsession_bad_line_skipped：坏 JSON 行静默跳过、后续行照常、lineIndex 仍前进")
    func CD_codex_readsession_bad_line_skipped() throws {
        try withTempRoot { root in
            let id = "bad0-1111-2222-3333-4444"
            try writeSession(base: root, y: "2026", m: "06", d: "04",
                filename: "rollout-2026-06-04T00-00-00-\(id).jsonl",
                lines: [
                    metaLine(id: id, cwd: "/w"),              // idx 0
                    "{ this is not valid json",               // idx 1 → 坏行跳过，lineIndex 仍 +1
                    userLine("after bad line"),               // idx 2
                ])
            let msgs = CodexSessionSource(codexBasePath: root).readSession(sessionId: id)
            #expect(msgs.count == 1)
            #expect(msgs[0].uuid == "codex-\(id)-user-2")  // 证明坏行占了 idx 1
        }
    }

    // MARK: - MemoizingCodexSource readSession 缓存直读（缺陷2：单文件直读避 buildIndex 全量扫）

    @Test("CD_codex_memo_readsession_equals_direct：prime 后 memo 单文件直读与直读源逐字段相等")
    func CD_codex_memo_readsession_equals_direct() throws {
        try withTempRoot { root in
            let id = "memo-1111-2222-3333-4444"
            try writeSession(base: root, y: "2026", m: "06", d: "04",
                filename: "rollout-2026-06-04T00-00-00-\(id).jsonl",
                lines: [
                    metaLine(id: id, cwd: "/Users/testuser/repo"),
                    userLine("do the thing", ts: "t-user"),
                    #"{"type":"event_msg","timestamp":"t-agent","payload":{"type":"agent_message","message":"ok"}}"#,
                ])
            let memo = MemoizingCodexSource(codexBase: root)
            memo.prime()  // 建索引表 → readSession 命中走单文件直读
            let direct = CodexSessionSource(codexBasePath: root).readSession(sessionId: id)
            #expect(!direct.isEmpty)
            // 命中缓存直读 == 直读源（逐字段，ChatSessionMessage Equatable）；limit 尾 N 亦一致。
            #expect(memo.readSession(sessionId: id, limit: nil) == direct)
            #expect(memo.readSession(sessionId: id, limit: 1)
                    == CodexSessionSource(codexBasePath: root).readSession(sessionId: id, limit: 1))
        }
    }

    @Test("CD_codex_memo_readsession_new_after_prime_fallback：prime 后新建会话未入表 → 全量扫回退仍可读")
    func CD_codex_memo_readsession_new_after_prime_fallback() throws {
        try withTempRoot { root in
            let existing = "old0-1111-2222-3333-4444"
            try writeSession(base: root, y: "2026", m: "06", d: "04",
                filename: "rollout-2026-06-04T00-00-00-\(existing).jsonl",
                lines: [metaLine(id: existing, cwd: "/w"), userLine("first")])
            let memo = MemoizingCodexSource(codexBase: root)
            memo.prime()  // 此刻索引只含 existing
            // prime 后新建一会话（未 re-prime）→ 不在 cachedIndex → readSession 回退全量扫，仍读到。
            let fresh = "new0-5555-6666-7777-8888"
            try writeSession(base: root, y: "2026", m: "06", d: "05",
                filename: "rollout-2026-06-05T00-00-00-\(fresh).jsonl",
                lines: [metaLine(id: fresh, cwd: "/w"), userLine("brand new")])
            let msgs = memo.readSession(sessionId: fresh, limit: nil)
            #expect(msgs == CodexSessionSource(codexBasePath: root).readSession(sessionId: fresh),
                    "未命中缓存 → 全量扫回退，与直读源等价（prime 后新增会话仍可读）")
            #expect(msgs.contains { $0.content == .text("brand new") })
        }
    }

    @Test("CD_codex_memo_readsession_deleted_file_fallback：prime 后文件删除 → 回退全量扫（与直读同为空）")
    func CD_codex_memo_readsession_deleted_file_fallback() throws {
        try withTempRoot { root in
            let id = "del0-1111-2222-3333-4444"
            let file = try writeSession(base: root, y: "2026", m: "06", d: "04",
                filename: "rollout-2026-06-04T00-00-00-\(id).jsonl",
                lines: [metaLine(id: id, cwd: "/w"), userLine("will be deleted")])
            let memo = MemoizingCodexSource(codexBase: root)
            memo.prime()  // 索引含该会话
            try FileManager.default.removeItem(at: file)  // prime 后文件消失
            // cachedIndex 仍有陈旧 entry，但 fileExists=false → 回退全量扫；文件已删 → buildIndex 找不到 → 空。
            #expect(memo.readSession(sessionId: id, limit: nil).isEmpty)
            #expect(CodexSessionSource(codexBasePath: root).readSession(sessionId: id).isEmpty, "直读源同为空")
        }
    }

    @Test("CD_codex_getprojects_group_by_cwd：同 cwd 聚一项目，count/totalSize 累加，source=codex")
    func CD_codex_getprojects_group_by_cwd() throws {
        try withTempRoot { root in
            let cwd = "/Users/testuser/proj"
            try writeSession(base: root, y: "2026", m: "06", d: "04",
                filename: "rollout-2026-06-04T00-00-00-aaaa-1-2-3-4.jsonl",
                lines: [metaLine(id: "s-a", cwd: cwd)], mtime: Date(timeIntervalSince1970: 1_749_000_000))
            try writeSession(base: root, y: "2026", m: "06", d: "05",
                filename: "rollout-2026-06-05T00-00-00-bbbb-1-2-3-4.jsonl",
                lines: [metaLine(id: "s-b", cwd: cwd)], mtime: Date(timeIntervalSince1970: 1_749_100_000))
            let projects = CodexSessionSource(codexBasePath: root).getProjects()
            #expect(projects.count == 1)
            let p = projects[0]
            #expect(p.projectHash == CodexProjectHash.encode(cwd))
            #expect(p.projectHash == "-Users-testuser-proj")
            #expect(p.displayName == "proj")
            #expect(p.sessionCount == 2)
            #expect(p.source == .codex)
            #expect(p.lastActivity == 1_749_100_000_000)  // max mtime（ms）
        }
    }

    @Test("CD_codex_search_snippet_and_scope：命中 user_message 出结果；agent_message 不搜；snippet 后 30")
    func CD_codex_search_snippet_and_scope() throws {
        try withTempRoot { root in
            let id = "srch-1111-2222-3333-4444"
            try writeSession(base: root, y: "2026", m: "06", d: "04",
                filename: "rollout-2026-06-04T00-00-00-\(id).jsonl",
                lines: [
                    metaLine(id: id, cwd: "/Users/testuser/s"),
                    #"{"type":"event_msg","timestamp":"hit-ts","payload":{"type":"user_message","message":"please NEEDLE this"}}"#,
                    // agent_message 含 query 但不应被搜到（只搜 user_message）
                    #"{"type":"event_msg","timestamp":"agent-ts","payload":{"type":"agent_message","message":"needle in agent"}}"#,
                ])
            let results = CodexSessionSource(codexBasePath: root).search("needle")
            #expect(results.count == 1)
            #expect(results[0].sessionId == id)
            #expect(results[0].projectHash == "-Users-testuser-s")
            #expect(results[0].timestamp == "hit-ts")               // 命中那一行的 timestamp
            #expect(results[0].snippet == "please NEEDLE this")     // 全长 < 窗口 → 整串，原文保真
            // 只出现在 agent 的词搜不到
            #expect(CodexSessionSource(codexBasePath: root).search("in agent").isEmpty)
        }
    }

    @Test("CD_codex_search_first_hit_per_session：一 session 首命中即停，一文件最多一条")
    func CD_codex_search_first_hit_per_session() throws {
        try withTempRoot { root in
            let id = "one0-1111-2222-3333-4444"
            try writeSession(base: root, y: "2026", m: "06", d: "04",
                filename: "rollout-2026-06-04T00-00-00-\(id).jsonl",
                lines: [
                    metaLine(id: id, cwd: "/w"),
                    userLine("alpha match one", ts: "ts1"),
                    userLine("alpha match two", ts: "ts2"),
                ])
            let results = CodexSessionSource(codexBasePath: root).search("alpha")
            #expect(results.count == 1)
            #expect(results[0].timestamp == "ts1")  // 首条即停
        }
    }

    // MARK: - session_meta / ISO 时间

    @Test("CD_codex_session_meta_parse：session_meta 投影 id/cwd/timestamp；非 meta → nil")
    func CD_codex_session_meta_parse() {
        let m = CodexSessionMeta.parse(obj(metaLine(id: "abc", cwd: "/x", ts: "T")))
        #expect(m == CodexSessionMeta(id: "abc", cwd: "/x", timestamp: "T"))
        #expect(CodexSessionMeta.parse(obj(#"{"type":"event_msg","payload":{}}"#)) == nil)
    }

    @Test("CD_codex_iso_millis：mtime 毫秒 → JS toISOString 同格式（3 位毫秒 + Z，UTC）")
    func CD_codex_iso_millis() {
        #expect(CodexTime.isoString(fromMillis: 0) == "1970-01-01T00:00:00.000Z")
        #expect(CodexTime.isoString(fromMillis: 1500) == "1970-01-01T00:00:01.500Z")
        #expect(CodexTime.isoString(fromMillis: 86_400_000) == "1970-01-02T00:00:00.000Z")
        #expect(CodexTime.isoString(fromMillis: 90_061_000) == "1970-01-02T01:01:01.000Z")
    }
}
