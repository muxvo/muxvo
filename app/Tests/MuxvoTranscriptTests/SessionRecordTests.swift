// SR_* 案例（M5 批1 A1-1）：磁盘会话 JSONL 信封解码（SessionRecord + SessionJSONLDecoder + timestampMs）。
// 只验「信封面」——聊天语义投影（title/详情/搜索）归 MuxvoChatHistory 的 CD_* 案例。
// 内容读取面按 ChatRecordReading 契约（messageContent/topLevelContent 为 Any?，消费者 `as?` 归一化）。
// 素材 = 手工构造 + Fixtures/sessions 脱敏真样本（结构保真）。
import Foundation
import Testing

@testable import MuxvoTranscript

@Suite("SessionRecord 信封解码（chat-data.md §2/§3 输入面）")
struct SessionRecordTests {

    // <file>/app/Tests/MuxvoTranscriptTests/SessionRecordTests.swift → MuxvoTranscriptTests 目录。
    private static func fixturesDir() -> URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .appendingPathComponent("Fixtures/sessions", isDirectory: true)
    }

    /// 解码某 fixture 的第 index 条（1 基，跳空白行不计）为 SessionRecord。
    private static func record(fixture: String, line index: Int) throws -> SessionRecord {
        let url = fixturesDir().appendingPathComponent(fixture)
        let text = try String(contentsOf: url, encoding: .utf8)
        let lines = text.split(separator: "\n", omittingEmptySubsequences: true)
        var dec = SessionJSONLDecoder()
        guard case let .record(r) = dec.decode(String(lines[index - 1])) else {
            throw TestError.notRecord
        }
        return r
    }

    enum TestError: Error { case notRecord }

    // 便捷：messageContent/topLevelContent 的块数组（Any? → [[String:Any]]）。
    private static func blocks(_ any: Any?) -> [[String: Any]]? {
        (any as? [Any])?.compactMap { $0 as? [String: Any] }
    }

    // MARK: - 全字段解码（user string 形态，含中文 + emoji + ISO 小数秒）

    @Test("SR_decode_user_string_all_fields：user 字符串内容全字段 + timestampMs")
    func SR_decode_user_string_all_fields() throws {
        let r = try Self.record(fixture: "cc-session-covering.jsonl", line: 2)
        #expect(r.type == "user")
        #expect(r.uuid == "u-0001")
        #expect(r.parentUuid == nil)                 // JSON null → nil
        #expect(r.sessionId == "SR-fixture-session-a")
        #expect(r.cwd == "/Users/dev/muxvo")
        #expect(r.gitBranch == "m5/batch1")
        #expect(r.timestamp == "2026-07-06T10:23:45.123Z")
        #expect(r.isSidechain == false)
        #expect(r.isMeta == nil)                     // 缺键 → nil（非 false）
        #expect(r.messageContent as? String == "帮我把聊天数据面的信封解码补全，覆盖中文与 emoji 🚀")
        #expect(r.topLevelContent == nil)            // 无顶层 content 键
        #expect(r.timestampMs == 1783333425123)      // ISO 小数秒 → epoch ms
        #expect(!r.raw.isEmpty)
    }

    // MARK: - assistant 块数组（thinking/text/tool_use 保真 + 未列字段透传）

    @Test("SR_decode_assistant_blocks：message.content 块数组原始值透传（as? [Any]）")
    func SR_decode_assistant_blocks() throws {
        let r = try Self.record(fixture: "cc-session-covering.jsonl", line: 3)
        #expect(r.type == "assistant")
        guard let bs = Self.blocks(r.messageContent) else {
            Issue.record("期望 messageContent 为块数组"); return
        }
        #expect(bs.count == 3)
        #expect(bs[0]["type"] as? String == "thinking")
        #expect(bs[1]["type"] as? String == "text")
        #expect(bs[1]["text"] as? String == "好的，我先读取现有解析库。")
        #expect(bs[2]["type"] as? String == "tool_use")
        #expect(bs[2]["name"] as? String == "Read")
        // input 是嵌套对象，消费者无需二次 parse 即可取字段。
        #expect((bs[2]["input"] as? [String: Any])?["file_path"] as? String
                == "/Users/dev/muxvo/app/Sources/MuxvoTranscript/CCStreamParser.swift")
        // §8.1 未列字段（id）也不丢，供 UI 透传。
        #expect(bs[2]["id"] as? String == "toolu_redacted_01")
        #expect(r.timestampMs == 1783333430000)      // 整秒 ISO
    }

    // MARK: - 纯 tool_result user（信封原样暴露；投影层丢弃归 CD_）

    @Test("SR_decode_pure_tool_result：tool_result 块字段原样可读")
    func SR_decode_pure_tool_result() throws {
        let r = try Self.record(fixture: "cc-session-covering.jsonl", line: 4)
        guard let bs = Self.blocks(r.messageContent) else {
            Issue.record("期望块数组"); return
        }
        #expect(bs.count == 1)
        #expect(bs[0]["type"] as? String == "tool_result")
        #expect(bs[0]["tool_use_id"] as? String == "toolu_redacted_01")
        #expect(bs[0]["content"] as? String == "REDACTED file contents")
        #expect(bs[0]["is_error"] as? Bool == false)   // 透传保真
    }

    // MARK: - isMeta + <system-reminder>（bool 严格 + 字符串内容）

    @Test("SR_decode_isMeta_system_reminder：isMeta=true 且内容为 system-reminder 字符串")
    func SR_decode_isMeta_system_reminder() throws {
        let r = try Self.record(fixture: "cc-session-covering.jsonl", line: 5)
        #expect(r.isMeta == true)
        #expect(r.isCompactSummary == nil)
        #expect((r.messageContent as? String)?.hasPrefix("<system-reminder>") == true)
    }

    // MARK: - queue-operation 顶层 content 字符串（message 缺席）

    @Test("SR_decode_queue_operation_top_content：顶层 content 字符串，messageContent 为 nil")
    func SR_decode_queue_operation_top_content() throws {
        let r = try Self.record(fixture: "cc-session-covering.jsonl", line: 6)
        #expect(r.type == "queue-operation")
        #expect(r.messageContent == nil)             // 无 message
        #expect(r.topLevelContent as? String == "继续实现 SessionRecord 的 timestampMs")
    }

    // MARK: - summary 未知信封（type 保留，两内容面缺席）

    @Test("SR_decode_summary_envelope：summary 行 type 保留、messageContent/topLevelContent 缺席")
    func SR_decode_summary_envelope() throws {
        let r = try Self.record(fixture: "cc-session-covering.jsonl", line: 1)
        #expect(r.type == "summary")
        #expect(r.messageContent == nil)
        #expect(r.topLevelContent == nil)
        #expect(r.timestampMs == nil)                // summary 无 timestamp
    }

    // MARK: - image 块 source 保真

    @Test("SR_decode_image_block_source：image.source 对象保真（type/media_type/data）")
    func SR_decode_image_block_source() throws {
        let r = try Self.record(fixture: "cc-session-covering.jsonl", line: 9)
        guard let bs = Self.blocks(r.messageContent) else {
            Issue.record("期望块数组"); return
        }
        #expect(bs.count == 2)
        #expect(bs[0]["type"] as? String == "text")
        #expect(bs[1]["type"] as? String == "image")
        let src = bs[1]["source"] as? [String: Any]
        #expect(src?["type"] as? String == "base64")
        #expect(src?["media_type"] as? String == "image/png")
        #expect(src?["data"] as? String == "REDACTEDBASE64")
    }

    // MARK: - isSidechain=true（§3.5 不过滤，信封仍暴露标记）

    @Test("SR_decode_isSidechain_true：isSidechain 布尔真被解出")
    func SR_decode_isSidechain_true() throws {
        let r = try Self.record(fixture: "cc-session-covering.jsonl", line: 8)
        #expect(r.isSidechain == true)
    }

    // MARK: - teammate-message 整块留原文（拆分归 CD_）

    @Test("SR_decode_teammate_content_string：teammate 整块作字符串内容保留")
    func SR_decode_teammate_content_string() throws {
        let r = try Self.record(fixture: "cc-session-covering.jsonl", line: 11)
        let content = r.messageContent as? String
        #expect(content?.contains("<teammate-message") == true)
        #expect(content?.contains("投影层 title 规则已实现") == true)
    }

    // MARK: - 强类型面（MessageContent/ContentBlock，详情投影用）

    @Test("SR_typed_content_surface：message?.content / content 强类型视图 + ContentBlock 具名访问")
    func SR_typed_content_surface() throws {
        // user string → message?.content == .string
        let user = try Self.record(fixture: "cc-session-covering.jsonl", line: 2)
        #expect(user.message?.content == .string("帮我把聊天数据面的信封解码补全，覆盖中文与 emoji 🚀"))
        #expect(user.content == .absent)             // 无顶层 content 键

        // assistant blocks → message?.content == .blocks，ContentBlock 具名访问
        let asst = try Self.record(fixture: "cc-session-covering.jsonl", line: 3)
        guard case let .blocks(blocks) = asst.message?.content else {
            Issue.record("期望 .blocks"); return
        }
        #expect(blocks.count == 3)
        #expect(blocks[1].type == "text")
        #expect(blocks[1].text == "好的，我先读取现有解析库。")
        #expect(blocks[2].name == "Read")
        #expect(blocks[2].input?.objectValue?["file_path"]?.stringValue
                == "/Users/dev/muxvo/app/Sources/MuxvoTranscript/CCStreamParser.swift")
        #expect(blocks[2].object["id"]?.stringValue == "toolu_redacted_01")   // 未列字段透传

        // image 块 source（JSONValue）
        let img = try Self.record(fixture: "cc-session-covering.jsonl", line: 9)
        let imgBlocks = img.message?.content.blocksValue
        #expect(imgBlocks?[1].type == "image")
        #expect(imgBlocks?[1].source?.objectValue?["media_type"]?.stringValue == "image/png")

        // queue-operation → message nil、content .string
        let queueOp = try Self.record(fixture: "cc-session-covering.jsonl", line: 6)
        #expect(queueOp.message == nil)
        #expect(queueOp.content == .string("继续实现 SessionRecord 的 timestampMs"))
    }

    // MARK: - message.content = null 与缺席区分（nil vs NSNull）

    @Test("SR_messageContent_null_vs_absent：JSON null → NSNull（as? String 为 nil）；缺席 → nil")
    func SR_messageContent_null_vs_absent() {
        var dec = SessionJSONLDecoder()
        guard case let .record(rNull) = dec.decode(#"{"type":"user","message":{"content":null}}"#),
              case let .record(rAbsent) = dec.decode(#"{"type":"user","message":{"role":"user"}}"#) else {
            Issue.record("期望 record"); return
        }
        #expect(rNull.messageContent is NSNull)      // null 键存在 → NSNull（非 nil）
        #expect(rNull.messageContent as? String == nil)
        #expect(rAbsent.messageContent == nil)       // 无 content 键 → nil
    }

    // MARK: - timestampMs：ISO 两式一致差 + 数值 ts 归一

    @Test("SR_timestampMs_iso_and_numeric：ISO 小数秒/整秒 + 数值秒/毫秒/偏移归一")
    func SR_timestampMs_iso_and_numeric() {
        // ISO：小数秒比整秒多 123ms。
        #expect(SessionRecord.timestampMs(from: "2026-07-06T10:23:45.123Z") == 1783333425123)
        #expect(SessionRecord.timestampMs(from: "2026-07-06T10:23:45Z") == 1783333425000)
        // 时区偏移：+08:00 == 减 8 小时的 Z。
        #expect(SessionRecord.timestampMs(from: "2026-07-06T10:23:45+08:00") == 1783304625000)
        // 数值毫秒原样；数值秒 ×1000。
        #expect(SessionRecord.timestampMs(from: NSNumber(value: 1783333425123)) == 1783333425123)
        #expect(SessionRecord.timestampMs(from: NSNumber(value: 1783333425)) == 1783333425000)
        // 非法 / 缺失 → nil。
        #expect(SessionRecord.timestampMs(from: "not-a-timestamp") == nil)
        #expect(SessionRecord.timestampMs(from: nil) == nil)
    }

    // 数值 ts 时 timestamp 字段（要求 ISO 原样串）为 nil，值仅经 timestampMs 呈现。
    @Test("SR_numeric_ts_field_nil：数值 timestamp → timestamp 字段 nil、timestampMs 有值")
    func SR_numeric_ts_field_nil() {
        let obj: [String: Any] = ["type": "user", "timestamp": NSNumber(value: 1783333425)]
        let r = SessionRecord(object: obj, raw: "{}")
        #expect(r.timestamp == nil)
        #expect(r.timestampMs == 1783333425000)
    }

    // MARK: - ISO8601Millis 直测（自实现解析）

    @Test("SR_iso8601_millis_direct：自实现 ISO→ms 覆盖小数秒/偏移/非法")
    func SR_iso8601_millis_direct() {
        #expect(ISO8601Millis.toMs("2026-07-05T08:15:00Z") == 1783239300000)
        #expect(ISO8601Millis.toMs("2026-07-06T02:23:45Z") == 1783304625000)
        #expect(ISO8601Millis.toMs("2026-07-06T10:23:45+08:00") == 1783304625000)
        #expect(ISO8601Millis.toMs("2026-07-06") == nil)          // 不足 19 字节
        #expect(ISO8601Millis.toMs("garbage") == nil)
    }

    // MARK: - JSONValue.toAny 往返（嵌套对象/数组/标量还原为 JSONSerialization 风格）

    @Test("SR_jsonvalue_toany_roundtrip：JSONValue → Any 还原标准 Foundation 类型")
    func SR_jsonvalue_toany_roundtrip() {
        let v = JSONValue.from(["a": "s", "n": 42, "b": true, "arr": [1, 2], "nul": NSNull()] as [String: Any])
        let any = v.toAny() as? [String: Any]
        #expect(any?["a"] as? String == "s")
        #expect(any?["n"] as? Int == 42)
        #expect(any?["b"] as? Bool == true)
        #expect((any?["arr"] as? [Any])?.count == 2)
        #expect(any?["nul"] is NSNull)
    }

    // MARK: - 解码器：坏行计数 / 空白跳过 / 非对象 JSON / 缺 type / 可选便捷

    @Test("SR_decoder_malformed_and_blank：坏行计数、空白不计、非对象 JSON 坏行")
    func SR_decoder_malformed_and_blank() {
        var dec = SessionJSONLDecoder()
        // 合法记录。
        #expect({ if case .record = dec.decode(#"{"type":"user"}"#) { return true }; return false }())
        #expect(dec.malformedCount == 0)
        // 空白行：非记录非坏行，不计数。
        #expect(dec.decode("   ") == .malformed)
        #expect(dec.decode("") == .malformed)
        #expect(dec.malformedCount == 0)
        // 真坏行：非法 JSON。
        #expect(dec.decode("this is not json") == .malformed)
        #expect(dec.malformedCount == 1)
        // 合法 JSON 但非对象（数组）→ 坏行。
        #expect(dec.decode("[1,2,3]") == .malformed)
        #expect(dec.malformedCount == 2)
    }

    @Test("SR_decoder_record_optional：record(from:) 便捷——空行/坏行 → nil，合法 → 非 nil")
    func SR_decoder_record_optional() {
        var dec = SessionJSONLDecoder()
        #expect(dec.record(from: #"{"type":"user"}"#) != nil)
        #expect(dec.record(from: "") == nil)
        #expect(dec.record(from: "not json") == nil)
        #expect(dec.malformedCount == 1)             // 仅坏行计数，空行不计
    }

    @Test("SR_decoder_missing_type_empty：缺 type 的合法对象 → type 空串、仍是 record")
    func SR_decoder_missing_type_empty() {
        var dec = SessionJSONLDecoder()
        guard case let .record(r) = dec.decode(#"{"foo":1}"#) else {
            Issue.record("期望 record"); return
        }
        #expect(r.type == "")
        #expect(dec.malformedCount == 0)
    }

    // MARK: - fixture 全量解码：每非空行 → record，零坏行

    @Test("SR_fixture_decode_all_records：两 fixture 每非空行解码为 record，零坏行")
    func SR_fixture_decode_all_records() throws {
        for fixture in ["cc-session-covering.jsonl", "cc-session-search.jsonl"] {
            let url = Self.fixturesDir().appendingPathComponent(fixture)
            let text = try String(contentsOf: url, encoding: .utf8)
            var dec = SessionJSONLDecoder()
            var records = 0
            for line in text.split(separator: "\n", omittingEmptySubsequences: true) {
                guard case .record = dec.decode(String(line)) else {
                    Issue.record("\(fixture) 出现非 record 行：\(line)"); continue
                }
                records += 1
            }
            #expect(dec.malformedCount == 0, "\(fixture) 不应有坏行")
            #expect(records > 0)
        }
    }
}
