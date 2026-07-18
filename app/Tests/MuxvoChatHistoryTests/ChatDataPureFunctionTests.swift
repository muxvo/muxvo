// CD_* 案例池（specs/behavior/chat-data.md §7）——§1~§4 纯函数面逐条 1:1（func 名带 CD_ 编号）。
// 记录用真解码路径构造（JSON 串 → JSONSerialization → SessionRecord），连带验证 A1-1 信封解码 +
// ChatRecordReading 绑定。镜像 I/O / chat.db / dump / 多源去重 / tail 读的 CD_* 归批2（见报告清单）。
//
// 刁钻 fixture 自造：中文/emoji 代理对 snippet、teammate 拆分含协议块跳过、worktree 归并/remap、空 title。

import Foundation
import Testing
import MuxvoTranscript

@testable import MuxvoChatHistory

// MARK: - 构造工具

/// JSON 行 → SessionRecord（真解码路径：JSONSerialization → SessionRecord(object:raw:)）。
private func rec(_ json: String) -> SessionRecord {
    let data = Data(json.utf8)
    let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
    return SessionRecord(object: obj, raw: json)
}

private func proj(_ p: String, _ dp: String, _ dn: String, _ n: Int, _ sz: Int?, _ act: Double)
    -> ChatProjectInfo
{
    ChatProjectInfo(projectHash: p, displayPath: dp, displayName: dn, sessionCount: n,
                    totalSize: sz, lastActivity: act, source: .claudeCode)
}

// MARK: - §1 项目发现/归并（Merger）

@Suite("CD_project/worktree（§1 Merger）")
struct MergerTests {

    @Test("CD_project_no_jsonl_dropped：无 .jsonl 目录 → 不产 ProjectInfo")
    func CD_project_no_jsonl_dropped() {
        #expect(ChatProjectMerger.buildProjectInfo(
            projectHash: "-a-b", displayPath: "", jsonlCount: 0, totalSize: 0, lastActivityMs: 1) == nil)
        #expect(ChatProjectMerger.buildProjectInfo(
            projectHash: "-a-b", displayPath: "", jsonlCount: 1, totalSize: 0, lastActivityMs: 1) != nil)
    }

    @Test("CD_project_displaypath_from_cwd：有 displayPath → displayName = cwd 末段")
    func CD_project_displaypath_from_cwd() {
        let p = ChatProjectMerger.buildProjectInfo(
            projectHash: "-Users-testuser-foo", displayPath: "/Users/testuser/foo",
            jsonlCount: 2, totalSize: 300, lastActivityMs: 42)
        #expect(p?.displayName == "foo")
        #expect(p?.displayPath == "/Users/testuser/foo")
        #expect(p?.sessionCount == 2)
        #expect(p?.totalSize == 300)
        #expect(p?.lastActivity == 42)
    }

    @Test("CD_project_displayname_fallback_hash：无 cwd → displayName = projectHash `-` 末段")
    func CD_project_displayname_fallback_hash() {
        let p = ChatProjectMerger.buildProjectInfo(
            projectHash: "-Users-testuser-my-proj", displayPath: "",
            jsonlCount: 1, totalSize: 0, lastActivityMs: 1)
        #expect(p?.displayName == "proj")  // `-` 分隔末段（去空段）
        // 全 `-` 无有效段 → 整个 hash
        let empty = ChatProjectMerger.buildProjectInfo(
            projectHash: "---", displayPath: "", jsonlCount: 1, totalSize: 0, lastActivityMs: 1)
        #expect(empty?.displayName == "---")
    }

    @Test("CD_worktree_merged_into_parent：worktree 归父，父 sessionCount=自身+子，列表无独立 worktree 条目")
    func CD_worktree_merged_into_parent() {
        let cc = [
            proj("P", "/p", "p", 2, 10, 5),
            proj("P--worktrees-wt-1", "/p/.worktrees/wt-1", "wt-1", 3, 20, 8),
        ]
        let r = ChatProjectMerger.merge(cc: cc, archive: [])
        #expect(r.projects.count == 1)
        let parent = r.projects.first { $0.projectHash == "P" }
        #expect(parent?.sessionCount == 5)   // 2 + 3
        #expect(parent?.totalSize == 30)     // 10 + 20
        #expect(parent?.lastActivity == 8)   // max(5, 8)
        #expect(!r.projects.contains { $0.projectHash.contains("--worktrees-") })
        #expect(r.worktreeMap["P"] == ["P--worktrees-wt-1"])
    }

    @Test("CD_worktree_parent_missing_remap：父无 session → worktree remap 成父 hash + displayPath 去尾")
    func CD_worktree_parent_missing_remap() {
        let cc = [proj("P--worktrees-wt-1", "/Users/testuser/proj/.worktrees/wt-1", "wt-1", 3, 20, 8)]
        let r = ChatProjectMerger.merge(cc: cc, archive: [])
        #expect(r.projects.count == 1)
        let only = r.projects[0]
        #expect(only.projectHash == "P")
        #expect(only.displayPath == "/Users/testuser/proj")   // 去 /.worktrees/wt-1
        #expect(only.displayName == "proj")             // 新 displayPath 末段
        #expect(only.sessionCount == 3)                 // 不累加（父不存在）
        #expect(r.worktreeMap["P"] == ["P--worktrees-wt-1"])
    }

    @Test("CD_worktree_label_preserved：worktreeLabel = 最后 `--worktrees-` 之后整段")
    func CD_worktree_label_preserved() {
        #expect(ChatProjectMerger.worktreeLabel(fromHash: "P--worktrees-wt-1") == "wt-1")
        #expect(ChatProjectMerger.worktreeLabel(fromHash: "P--worktrees-worktree-10") == "worktree-10")
        #expect(ChatProjectMerger.worktreeLabel(fromHash: "P") == nil)
        #expect(ChatProjectMerger.parentProjectHash("P--worktrees-wt-1") == "P")
        #expect(ChatProjectMerger.parentProjectHash("--worktrees-wt-1") == nil)  // idx>0
    }

    @Test("CD_project_archive_merge_max：同 hash CC+archive → sessionCount=Math.max，其余保 CC；archive 独有并入")
    func CD_project_archive_merge_max() {
        let cc = [proj("A", "/a", "a", 3, 100, 5)]
        let archive = [
            proj("A", "/z", "z", 7, 999, 99),   // 同 hash
            proj("B", "/b", "b", 2, 50, 3),     // 独有
        ]
        let r = ChatProjectMerger.merge(cc: cc, archive: archive)
        let a = r.projects.first { $0.projectHash == "A" }
        #expect(a?.sessionCount == 7)          // max(3, 7)
        #expect(a?.totalSize == 100)           // 保 CC
        #expect(a?.lastActivity == 5)          // 保 CC
        #expect(a?.displayPath == "/a")        // 保 CC
        #expect(r.projects.contains { $0.projectHash == "B" && $0.sessionCount == 2 })
    }
}

// MARK: - §2 会话元数据（Extractor）

@Suite("CD_summary（§2 Extractor）")
struct ExtractorTests {

    @Test("CD_summary_empty_title_dropped：无非内部 user → title 空 → nil")
    func CD_summary_empty_title_dropped() {
        // 只有内部消息（system-reminder 前缀）+ assistant → title 恒空
        let records: [any ChatRecordReading] = [
            rec(#"{"type":"user","message":{"content":"<system-reminder>x</system-reminder>"},"timestamp":"T1"}"#),
            rec(#"{"type":"assistant","message":{"content":[{"type":"text","text":"hi"}]}}"#),
        ]
        #expect(SessionSummaryExtractor.extract(
            records: records, projectHash: "P", sessionId: "S", fileSize: 1, lastModifiedMs: 2) == nil)
    }

    @Test("CD_summary_title_skip_prefixes：title 跳过 4 类内部前缀，取首条真 user")
    func CD_summary_title_skip_prefixes() {
        let records: [any ChatRecordReading] = [
            rec(#"{"type":"user","message":{"content":"<command-message>/foo</command-message>"},"timestamp":"T1"}"#),
            rec(#"{"type":"user","message":{"content":"<teammate-message a>hi</teammate-message>"},"timestamp":"T2"}"#),
            rec(#"{"type":"user","message":{"content":"真正的标题"},"timestamp":"T3"}"#),
        ]
        let s = SessionSummaryExtractor.extract(
            records: records, projectHash: "P", sessionId: "S", fileSize: 10, lastModifiedMs: 20)
        #expect(s?.title == "真正的标题")
        #expect(s?.startedAt == "T1")  // 首条 user timestamp（即便是被跳过的内部消息）
    }

    @Test("CD_summary_title_skip_another_claude_wrapper：title 跳过「Another Claude…」外壳队友消息，取首条真 user")
    func CD_summary_title_skip_another_claude_wrapper() {
        // 同 ChatMessageProjector 外壳形同根：外壳队友消息不该泄进会话标题（用户可见归属面）。
        let records: [any ChatRecordReading] = [
            rec(#"{"type":"user","message":{"content":"Another Claude session sent a message:\n<teammate-message teammate_id=\"reviewer\">review done</teammate-message>"},"timestamp":"T1"}"#),
            rec(#"{"type":"user","message":{"content":"我的真实第一句"},"timestamp":"T2"}"#),
        ]
        let s = SessionSummaryExtractor.extract(
            records: records, projectHash: "P", sessionId: "S", fileSize: 10, lastModifiedMs: 20)
        #expect(s?.title == "我的真实第一句")
        #expect(s?.startedAt == "T1")  // startedAt 仍取首条 user ts（即便被跳过）

        // 全是外壳队友消息 → title 空 → session 丢弃（与裸 teammate 一致）
        let allWrapper: [any ChatRecordReading] = [
            rec(#"{"type":"user","message":{"content":"Another Claude session sent a message:\n<teammate-message a>x</teammate-message>"},"timestamp":"T1"}"#),
        ]
        #expect(SessionSummaryExtractor.extract(
            records: allWrapper, projectHash: "P", sessionId: "S", fileSize: 1, lastModifiedMs: 2) == nil)
    }

    @Test("CD_summary_title_text_block_form：text 块数组 title 取 join('\\n') 截 100")
    func CD_summary_title_text_block_form() {
        let long = String(repeating: "字", count: 150)
        let records: [any ChatRecordReading] = [
            rec("{\"type\":\"user\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"\(long)\"}]},\"timestamp\":\"T1\"}"),
        ]
        let s = SessionSummaryExtractor.extract(
            records: records, projectHash: "P", sessionId: "S", fileSize: 1, lastModifiedMs: 1)
        #expect(s?.title.count == 100)   // slice(0,100) UTF-16；'字' 各 1 码元 → 100 字符
    }

    @Test("CD_summary_started_before_internal：startedAt = 首条 user timestamp（即便内部消息）")
    func CD_summary_started_before_internal() {
        let records: [any ChatRecordReading] = [
            rec(#"{"type":"assistant","message":{"content":[{"type":"text","text":"a"}]},"timestamp":"TA"}"#),
            rec(#"{"type":"user","message":{"content":"<system-reminder>x</system-reminder>"},"timestamp":"TU_INTERNAL"}"#),
            rec(#"{"type":"user","message":{"content":"hello"},"timestamp":"TU_REAL"}"#),
        ]
        let s = SessionSummaryExtractor.extract(
            records: records, projectHash: "P", sessionId: "S", fileSize: 1, lastModifiedMs: 1)
        #expect(s?.startedAt == "TU_INTERNAL")  // 首条 user（内部）的 ts，非 title 那条
        #expect(s?.title == "hello")
    }

    @Test("CD_summary_filesize_mtime：fileSize/lastModified/cwd 透传")
    func CD_summary_filesize_mtime() {
        let records: [any ChatRecordReading] = [
            rec(#"{"type":"user","cwd":"/work/dir","message":{"content":"t"},"timestamp":"T1"}"#),
        ]
        let s = SessionSummaryExtractor.extract(
            records: records, projectHash: "P", sessionId: "S", fileSize: 4096, lastModifiedMs: 1700.5)
        #expect(s?.fileSize == 4096)
        #expect(s?.lastModified == 1700.5)
        #expect(s?.cwd == "/work/dir")
        #expect(s?.source == .claudeCode)
    }

    @Test("CD_summary_msgnull_falls_back_toplevel：message.content=JSON null → title 回落顶层 content（legacy nullish ??）")
    func CD_summary_msgnull_falls_back_toplevel() {
        // message.content 为 JSON null（A1-1 呈 NSNull，非缺席）+ 顶层 content 为字符串。
        // legacy `obj.message?.content ?? obj.content`（nullish）把 null 视同缺席 → 回落顶层 content。
        let records: [any ChatRecordReading] = [
            rec(#"{"type":"user","message":{"content":null},"content":"Real Title","timestamp":"T1"}"#),
        ]
        let s = SessionSummaryExtractor.extract(
            records: records, projectHash: "P", sessionId: "S", fileSize: 1, lastModifiedMs: 1)
        #expect(s?.title == "Real Title")   // 修前 NSNull 令 `??` 不回落 → title 空 → nil（RED）

        // ContentAccess 直测：null 回落顶层；对照空串（非 nullish）不回落、保留空串。
        let rNull = rec(#"{"type":"user","message":{"content":null},"content":"fallback","timestamp":"T"}"#)
        #expect(ContentAccess.plainText(rNull, dropEmpty: false) == "fallback")
        #expect(ContentAccess.plainText(rNull, dropEmpty: true) == "fallback")
        let rEmpty = rec(#"{"type":"user","message":{"content":""},"content":"should NOT surface","timestamp":"T"}"#)
        #expect(ContentAccess.plainText(rEmpty, dropEmpty: false) == "")  // 空串非 nullish → 保留，不回落
    }
}

// MARK: - §3 详情投影（Projector）

@Suite("CD_detail/teammate（§3 Projector）")
struct ProjectorTests {

    private func one(_ json: String) -> ChatSessionMessage? {
        ChatMessageProjector.project(record: rec(json), fallbackSessionId: "S").first
    }

    @Test("CD_detail_type_whitelist：只投影 user/assistant/queue-operation")
    func CD_detail_type_whitelist() {
        #expect(ChatMessageProjector.project(
            record: rec(#"{"type":"summary","summary":"x"}"#), fallbackSessionId: "S").isEmpty)
        #expect(ChatMessageProjector.project(
            record: rec(#"{"type":"file-history-snapshot"}"#), fallbackSessionId: "S").isEmpty)
        #expect(ChatMessageProjector.project(
            record: rec(#"{"type":"user","message":{"content":"hi"}}"#), fallbackSessionId: "S").count == 1)
    }

    @Test("CD_detail_pure_toolresult_dropped：user content 全 tool_result → 不进详情")
    func CD_detail_pure_toolresult_dropped() {
        let msgs = ChatMessageProjector.project(
            record: rec(#"{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"x","content":"r"}]}}"#),
            fallbackSessionId: "S")
        #expect(msgs.isEmpty)
        // 混入非 tool_result 块 → 不丢
        let mixed = ChatMessageProjector.project(
            record: rec(#"{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"x","content":"r"},{"type":"text","text":"hi"}]}}"#),
            fallbackSessionId: "S")
        #expect(mixed.count == 1)
    }

    @Test("CD_detail_image_preserved：user 含 image → 保 text+image 块，image 映射 {type,source}")
    func CD_detail_image_preserved() {
        let m = one(#"{"type":"user","uuid":"U","message":{"content":[{"type":"image","source":{"type":"base64","media_type":"image/png","data":"AAA"}},{"type":"text","text":"look"}]}}"#)
        guard case .blocks(let blocks)? = m?.content else { Issue.record("应为块数组"); return }
        #expect(blocks.count == 2)
        #expect(blocks[0].type == "image")
        #expect(blocks[0].source != nil)          // source 保留
        #expect(blocks[1].type == "text")
        #expect(blocks[1].text == "look")
    }

    @Test("CD_detail_queueop_user_vs_system：queue-op 起头协议标签 → system，否则 user")
    func CD_detail_queueop_user_vs_system() {
        #expect(one(#"{"type":"queue-operation","content":"<task-notification>done</task-notification>"}"#)?.type == .system)
        #expect(one(#"{"type":"queue-operation","content":"用户打断的普通文本"}"#)?.type == .user)
        // 顶层 content（非 message.content）
        #expect(one(#"{"type":"queue-operation","content":"stop"}"#)?.content == .text("stop"))
    }

    @Test("CD_detail_ismeta_iscompact_system：isMeta / isCompactSummary 的 user → system")
    func CD_detail_ismeta_iscompact_system() {
        #expect(one(#"{"type":"user","isMeta":true,"message":{"content":"m"}}"#)?.type == .system)
        #expect(one(#"{"type":"user","isCompactSummary":true,"message":{"content":"c"}}"#)?.type == .system)
        #expect(one(#"{"type":"user","message":{"content":"normal"}}"#)?.type == .user)
    }

    @Test("CD_detail_cd_bindkey_system：`^(cd\\s+|bindkey\\s)` 的 user → system")
    func CD_detail_cd_bindkey_system() {
        #expect(one(#"{"type":"user","message":{"content":"cd /foo && clear"}}"#)?.type == .system)
        #expect(one(#"{"type":"user","message":{"content":"bindkey abc"}}"#)?.type == .system)
        #expect(one(#"{"type":"user","message":{"content":"cdrom is not cd"}}"#)?.type == .user)  // 需 cd+空白
    }

    @Test("CD_detail_sidechain_not_filtered：isSidechain 消息与主线一致投影，不过滤")
    func CD_detail_sidechain_not_filtered() {
        let msgs = ChatMessageProjector.project(
            record: rec(#"{"type":"user","isSidechain":true,"message":{"content":"sub agent msg"}}"#),
            fallbackSessionId: "S")
        #expect(msgs.count == 1)
        #expect(msgs[0].type == .user)
        #expect(msgs[0].content == .text("sub agent msg"))
    }

    @Test("CD_detail_bad_line_skipped：坏行 decode → .malformed，投影 nil → []")
    func CD_detail_bad_line_skipped() {
        var dec = SessionJSONLDecoder()
        #expect(dec.decode("this is not json") == .malformed)
        #expect(dec.decode("") == .malformed)   // 空行也 malformed（不计数）
        #expect(ChatMessageProjector.project(record: nil, fallbackSessionId: "S").isEmpty)
    }

    @Test("CD_teammate_split_individual：N 块 → N 条 system，uuid `-tm{i}`，content 保留整块含标签")
    func CD_teammate_split_individual() {
        let json = #"{"type":"user","uuid":"U","message":{"content":"<teammate-message id=\"a\">hi</teammate-message><teammate-message id=\"b\">yo</teammate-message>"}}"#
        let msgs = ChatMessageProjector.project(record: rec(json), fallbackSessionId: "S")
        #expect(msgs.count == 2)
        #expect(msgs[0].type == .system)
        #expect(msgs[0].uuid == "U-tm0")
        #expect(msgs[1].uuid == "U-tm1")
        if case .text(let c0) = msgs[0].content {
            #expect(c0.hasPrefix("<teammate-message"))
            #expect(c0.contains("hi"))
        } else { Issue.record("teammate content 应为整块字符串") }
    }

    @Test("CD_teammate_protocol_block_dropped：纯协议块丢弃，保留块 uuid 保原始序号")
    func CD_teammate_protocol_block_dropped() {
        // block0 = 纯 idle_notification 协议（丢弃）；block1 = 真消息（保留，uuid -tm1）
        let json = #"{"type":"user","uuid":"U","message":{"content":"<teammate-message id=\"a\">{\"type\":\"idle_notification\"}</teammate-message><teammate-message id=\"b\">real</teammate-message>"}}"#
        let msgs = ChatMessageProjector.project(record: rec(json), fallbackSessionId: "S")
        #expect(msgs.count == 1)
        #expect(msgs[0].uuid == "U-tm1")   // 序号保留（block0 被跳过）
        // 全协议块 → []
        let allProto = #"{"type":"user","uuid":"U","message":{"content":"<teammate-message a>{\"type\":\"shutdown_approved\"}</teammate-message>"}}"#
        #expect(ChatMessageProjector.project(record: rec(allProto), fallbackSessionId: "S").isEmpty)
    }

    @Test("CD_teammate_another_claude_wrapper：CC 新版「Another Claude session sent a message:」外壳形 → teammate 拆分（不误判 user/YOU）")
    func CD_teammate_another_claude_wrapper() {
        // CC 新版把队友消息包在「Another Claude session sent a message:\n<teammate-message …>」外壳注入，
        // JSONL 落盘为 role=user。老逻辑只认裸 `<teammate-message` 起头 → 外壳形漏判为 user，归档查看器标「YOU」。
        let json = #"{"type":"user","uuid":"U","message":{"content":"Another Claude session sent a message:\n<teammate-message teammate_id=\"reviewer\" color=\"blue\">code review done, 2 MAJOR</teammate-message>"}}"#
        let msgs = ChatMessageProjector.project(record: rec(json), fallbackSessionId: "S")
        #expect(msgs.count == 1)
        #expect(msgs[0].type == .system)            // 不再是 .user（YOU）
        #expect(msgs[0].uuid == "U-tm0")
        if case .text(let c0) = msgs[0].content {
            #expect(c0.hasPrefix("<teammate-message"))   // 外壳「Another Claude…」前缀被剥离
            #expect(c0.contains("code review done"))
        } else { Issue.record("teammate content 应为整块字符串") }
    }

    @Test("CD_teammate_wrapper_no_block_not_dropped：外壳前缀但无 teammate 块（且非 isMeta）→ 不误路由丢弃，保留为 user")
    func CD_teammate_wrapper_no_block_not_dropped() {
        // 保守红线：只对确含 `<teammate-message` 块的外壳走拆分，避免无块外壳被 splitTeammateMessages 返回 [] 而整条吞掉。
        let json = #"{"type":"user","uuid":"U","message":{"content":"Another Claude session sent a message:\nplain agent note without teammate tag"}}"#
        let msgs = ChatMessageProjector.project(record: rec(json), fallbackSessionId: "S")
        #expect(msgs.count == 1)
        #expect(msgs[0].type == .user)
    }

    @Test("assistant 原始块透传保全 §8.1 外字段（thinking.signature / tool_use.id）")
    func assistant_blocks_passthrough_preserves_extra_fields() {
        let m = one(#"{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"reason","signature":"sig"},{"type":"tool_use","id":"tu1","name":"Bash","input":{"command":"ls"}}]}}"#)
        guard case .blocks(let blocks)? = m?.content else { Issue.record("应为块数组"); return }
        #expect(blocks.count == 2)
        // thinking 块保 signature/thinking（§8.1 未列，但透传保全 = 双跑红线）
        #expect(blocks[0].type == "thinking")
        #expect(blocks[0].raw.objectValue?["signature"]?.stringValue == "sig")
        #expect(blocks[0].raw.objectValue?["thinking"]?.stringValue == "reason")
        // tool_use 块保 id（§8.1 未列）
        #expect(blocks[1].type == "tool_use")
        #expect(blocks[1].name == "Bash")
        #expect(blocks[1].raw.objectValue?["id"]?.stringValue == "tu1")
        #expect(blocks[1].input?.objectValue?["command"]?.stringValue == "ls")
    }
}

// MARK: - §4 搜索（SearchPredicate）

@Suite("CD_search（§4 SearchPredicate）")
struct SearchTests {

    @Test("CD_search_substring_case_insensitive：toLowerCase 任意子串命中")
    func CD_search_substring_case_insensitive() {
        #expect(SearchPredicate.firstMatch(text: "Hello World", query: "WORLD") != nil)
        #expect(SearchPredicate.firstMatch(text: "Hello World", query: "lo wo") != nil)
        #expect(SearchPredicate.firstMatch(text: "Hello", query: "xyz") == nil)
    }

    @Test("CD_search_chinese_emoji：中文/emoji 子串命中（UTF-16）")
    func CD_search_chinese_emoji() {
        #expect(SearchPredicate.firstMatch(text: "你好世界和平", query: "世界") != nil)
        #expect(SearchPredicate.firstMatch(text: "开心😀庆祝🎉结束", query: "🎉") != nil)
        #expect(SearchPredicate.firstMatch(text: "abc", query: "世") == nil)
    }

    @Test("CD_search_snippet_window：snippet = 命中前 30 + query + 后 170（UTF-16 码元）")
    func CD_search_snippet_window() {
        let text = String(repeating: "a", count: 50) + "NEEDLE" + String(repeating: "b", count: 300)
        let m = SearchPredicate.firstMatch(text: text, query: "NEEDLE")
        #expect(m?.offset == 50)
        // start=max(0,50-30)=20；end=min(len,50+6+170)=226；len=30+6+170=206
        let expected = String(repeating: "a", count: 30) + "NEEDLE" + String(repeating: "b", count: 170)
        #expect(m?.snippet == expected)
        #expect(m?.snippet.count == 206)
    }

    @Test("CD_search_one_hit_per_session：每 session 首命中即停，一文件最多一条")
    func CD_search_one_hit_per_session() {
        let records: [any ChatRecordReading] = [
            rec(#"{"type":"user","message":{"content":"first hit findme here"},"timestamp":"T1"}"#),
            rec(#"{"type":"assistant","message":{"content":[{"type":"text","text":"second findme"}]},"timestamp":"T2"}"#),
        ]
        let r = SearchPredicate.searchSession(records: records, query: "findme", projectHash: "P", sessionId: "S")
        #expect(r != nil)
        #expect(r?.timestamp == "T1")          // 首命中那条
        #expect(r?.snippet.contains("first hit findme") == true)
    }

    @Test("CD_search_only_user_assistant：queue-operation / summary 不搜")
    func CD_search_only_user_assistant() {
        // summary 类型：即便文本含 query 也不搜
        #expect(SearchPredicate.searchSession(
            records: [rec(#"{"type":"summary","summary":"findme in summary"}"#)],
            query: "findme", projectHash: "P", sessionId: "S") == nil)
        // queue-operation：不搜
        #expect(SearchPredicate.searchSession(
            records: [rec(#"{"type":"queue-operation","content":"findme in queueop"}"#)],
            query: "findme", projectHash: "P", sessionId: "S") == nil)
    }

    @Test("CD_search_superset_of_detail：被详情重标 system 的 user 行（isMeta/system-reminder）仍可搜")
    func CD_search_superset_of_detail() {
        // isMeta user：详情 §3 重标 system，但搜索只看原始 type==user → 可搜
        #expect(SearchPredicate.searchSession(
            records: [rec(#"{"type":"user","isMeta":true,"message":{"content":"secret findme text"}}"#)],
            query: "findme", projectHash: "P", sessionId: "S") != nil)
        // system-reminder user：同理可搜（原始 type==user）
        #expect(SearchPredicate.searchSession(
            records: [rec(#"{"type":"user","message":{"content":"<system-reminder>findme</system-reminder>"}}"#)],
            query: "findme", projectHash: "P", sessionId: "S") != nil)
    }

    @Test("CD_search_summary_ignored：只取 text 块——assistant tool_use 文本不进搜索面")
    func CD_search_summary_ignored() {
        // assistant tool_use 块（name/input 有文本）不进搜索面（extractSearchableText 只取 text 块）
        #expect(SearchPredicate.searchSession(
            records: [rec(#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"findme","input":{"x":"findme"}}]}}"#)],
            query: "findme", projectHash: "P", sessionId: "S") == nil)
        // 但同记录若有 text 块含 query → 命中
        #expect(SearchPredicate.searchSession(
            records: [rec(#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"x"},{"type":"text","text":"findme in text"}]}}"#)],
            query: "findme", projectHash: "P", sessionId: "S") != nil)
    }
}
