// JT_* 案例表（specs/orchestration/jsonl-transcript.md §5）——解析纪律 + 映射契约。
// func 名逐字用案例池名；断言语义照 §5 表。tail 轮转（JT_tail_rotation_detected）见
// TranscriptTailTests.swift；契约回放（JT_recorded_fixture_replay）由接线 agent 另接。
import Foundation
import Testing

@testable import MuxvoTranscript

@Suite("JSONL / stream-json 解析契约（§2 纪律 + §3 映射）")
struct TranscriptParsingTests {

    // §5：半行到达不产事件；补齐后恰一条。
    @Test("JT_partial_line_buffered：半行缓冲，补齐后恰一条")
    func JT_partial_line_buffered() {
        var p = CCStreamParser()
        let full = #"{"type":"system","subtype":"init","session_id":"s1","model":"claude-fable-5"}"#
        let cut = full.index(full.startIndex, offsetBy: 20)
        #expect(p.feed(String(full[..<cut])).isEmpty)          // 半行：无事件
        let events = p.feed(String(full[cut...]) + "\n")        // 补齐 + 换行
        #expect(events == [.sessionStarted(sessionId: "s1", model: "claude-fable-5")])
    }

    // §5：未知 type → unknown(raw)，流不中断。
    @Test("JT_unknown_type_passthrough：未知 type 透传 unknown，后续行照常")
    func JT_unknown_type_passthrough() {
        var p = CCStreamParser()
        let raw = #"{"type":"wibble","foo":1}"#
        #expect(p.feed(raw + "\n") == [.unknown(type: "wibble", raw: raw)])
        // 流不中断：随后一条已知行仍正确解析。
        let more = p.feed(#"{"type":"system","subtype":"init","session_id":"s2"}"# + "\n")
        #expect(more == [.sessionStarted(sessionId: "s2", model: nil)])
    }

    // §5：已知 type 多出新字段 → 正常解析（前向兼容，CC 每月漂移不红）。
    @Test("JT_unknown_field_ignored：已知 type 多出未知字段仍正确解析")
    func JT_unknown_field_ignored() {
        var p = CCStreamParser()
        let raw = #"{"type":"result","subtype":"success","is_error":false,"num_turns":3,"result":"done","brand_new_field":{"x":1},"another_2027_field":42}"#
        #expect(p.feed(raw + "\n") == [.result(status: .success, numTurns: 3, raw: raw)])
    }

    // §5：>10MB 行 → parseError + 截断，后续行正常（用小 maxLineBytes 走同一截断路径）。
    @Test("JT_oversize_line_truncated：超限行截断记 parseError，后续行正常")
    func JT_oversize_line_truncated() {
        var p = CCStreamParser(maxLineBytes: 64)
        let huge = #"{"type":"assistant","x":""# + String(repeating: "A", count: 300) + #""}"#
        let good = #"{"type":"system","subtype":"init","session_id":"after"}"#
        let events = p.feed(huge + "\n" + good + "\n")
        #expect(events.count == 2)
        #expect(events[0] == .parseError(count: 1))                          // 截断计一次失败
        #expect(events[1] == .sessionStarted(sessionId: "after", model: nil)) // 后续行正常
    }

    // §5：连续 20 行非法 → 上报异常信号（thresholdExceeded 锁存）。
    @Test("JT_garbage_threshold：连续 20 行非法越阈值 → 异常信号")
    func JT_garbage_threshold() {
        var p = CCStreamParser()
        for i in 0..<19 { _ = p.feed("this is not json \(i)\n") }
        #expect(p.consecutiveFailures == 19)
        #expect(p.thresholdExceeded == false)          // 第 19 条尚未越阈值
        let ev = p.feed("garbage 20\n")
        #expect(ev == [.parseError(count: 20)])
        #expect(p.thresholdExceeded == true)           // 第 20 条 → 异常信号
    }

    // §5：result → status/num_turns 正确抽取；turn 计数口径 == result.num_turns（F9）。
    @Test("JT_result_success_turns：result 抽 status/num_turns，口径 == num_turns")
    func JT_result_success_turns() {
        var p = CCStreamParser()
        let raw = #"{"type":"result","subtype":"success","is_error":false,"num_turns":2,"result":"ok","stop_reason":"end_turn"}"#
        let events = p.feed(raw + "\n")
        #expect(events == [.result(status: .success, numTurns: 2, raw: raw)])
        guard case let .result(status, numTurns, _) = events[0] else {
            Issue.record("期望 result，实得 \(events)"); return
        }
        #expect(status == .success)
        #expect(numTurns == 2)   // turn 口径 == result.num_turns（F9）
    }

    // §5：rate_limit_event 真形状（F4 真捕获脱敏版）→ rateLimit(status, resetsAt)；
    // status=allowed 是遥测，解析层照实产出、不做等待判断（判定权在调度器）。
    @Test("JT_ratelimit_real_shape：真 rate_limit_event → rateLimit，allowed 不触发等待")
    func JT_ratelimit_real_shape() {
        var p = CCStreamParser()
        // 素材 = 本机 claude 2.1.201 真捕获，session_id/uuid 已脱敏为 REDACTED（无真实用户名/路径）。
        let raw = #"{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","resetsAt":1783136400,"rateLimitType":"five_hour","overageStatus":"rejected","overageDisabledReason":"org_level_disabled","isUsingOverage":false},"uuid":"REDACTED-uuid","session_id":"REDACTED-session"}"#
        let events = p.feed(raw + "\n")
        #expect(events == [.rateLimit(status: "allowed", resetsAt: 1783136400, raw: raw)])
        guard case let .rateLimit(status, resetsAt, _) = events[0] else {
            Issue.record("期望 rateLimit，实得 \(events)"); return
        }
        #expect(status == "allowed")        // 遥测态照实产出
        #expect(resetsAt == 1783136400)     // 绝对 epoch，非相对秒
    }

    // §5：toolUse 输出 digest，input 原文不在事件值内（提示注入面不出库）。
    @Test("JT_tooluse_digest_only：toolUse 只出 digest，input 原文不入事件")
    func JT_tooluse_digest_only() {
        var p = CCStreamParser()
        let secret = "rm -rf /Users/REDACTED/secret-path"
        let raw = #"{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Bash","id":"toolu_x","input":{"command":"\#(secret)","description":"d"}}]}}"#
        let events = p.feed(raw + "\n")
        #expect(events.count == 1)
        guard case let .toolUse(name, digest) = events[0] else {
            Issue.record("期望 toolUse，实得 \(events)"); return
        }
        #expect(name == "Bash")
        #expect(!digest.isEmpty)
        #expect(!digest.contains(secret))       // input 原文不在 digest 内
        #expect(!digest.contains("command"))    // 字段名亦不泄漏
    }

    // 评审回修（非 JT 池名）：未知 assistant 内容块不静默丢弃，透传 unknown（§2「未知必透传」）；
    // 仅 thinking / redacted_thinking 白名单跳过（内部推理块，非转写主体）。
    @Test("assistant_unknown_block_passthrough：未知内容块透传 unknown，thinking 白名单跳过")
    func assistant_unknown_block_passthrough() {
        var p = CCStreamParser()
        let raw = #"{"type":"assistant","message":{"role":"assistant","content":[{"type":"thinking","thinking":"secret reasoning"},{"type":"video","url":"x"},{"type":"text","text":"hi"}]}}"#
        let events = p.feed(raw + "\n")
        #expect(events.count == 2)   // thinking 跳过；video→unknown；text→assistantText
        #expect(events.contains { if case .unknown("assistant_block:video", _) = $0 { return true }; return false })
        #expect(events.contains(.assistantText(text: "hi", usage: nil)))
        // thinking 内文（被跳过）不泄漏进任何 unknown.raw。
        for event in events {
            if case let .unknown(_, blockRaw) = event { #expect(!blockRaw.contains("secret reasoning")) }
        }
    }

    // §5：codex --json 真契约（W0a codex-cli 0.137.0，codex-probe.md 差异清单）→ 同一 HarnessEvent 枚举。
    @Test("JT_codex_mapped_same_enum：codex 真契约事件映射进同一 HarnessEvent（thread.started→sessionStarted 修复 MAJOR①）")
    func JT_codex_mapped_same_enum() {
        var p = CodexJSONParser()
        // 真契约起始=thread.started+thread_id（无 model）——差异①(MAJOR)：session id 靠此不丢。
        let start = #"{"type":"thread.started","thread_id":"019f34e4-c439-7ae0-830f-48fc471595d1"}"#
        // 每 item 前先发 item.started（差异⑤）、turn 前发裸 turn.started（差异⑥）——须被显式吞。
        let turnStart = #"{"type":"turn.started"}"#
        let itemStart = #"{"type":"item.started","item":{"id":"item_0","type":"command_execution","command":"/bin/zsh -lc \"ls\"","status":"in_progress"}}"#
        // 真契约工具=command_execution：command 全 shell 串 + exit_code（无 arguments/input，差异③）。
        let cmd  = #"{"type":"item.completed","item":{"id":"item_0","type":"command_execution","command":"/bin/zsh -lc \"ls\"","aggregated_output":"sum.js\n","exit_code":0,"status":"completed"}}"#
        // 真契约 agent_message：item 上无 usage（差异④）。
        let msg  = #"{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"hello from codex"}}"#
        // 真契约收口=turn.completed 只带 usage（无 status/is_error/num_turns，差异②）。
        let done = #"{"type":"turn.completed","usage":{"input_tokens":30582,"output_tokens":536}}"#
        let events = p.feed([start, turnStart, itemStart, cmd, msg, done].joined(separator: "\n") + "\n")
        // 差异①(MAJOR)：会话 id = thread_id（旧 mapper 误取 session_id → 恒空 → 此断言红）。
        #expect(events.contains(.sessionStarted(
            sessionId: "019f34e4-c439-7ae0-830f-48fc471595d1", model: nil)))
        // 差异⑤⑥：item.started/turn.started 显式吞——零 unknown 噪声透传。
        #expect(!events.contains { if case .unknown = $0 { return true }; return false })
        // 差异③：command_execution → toolUse（name=command 全串）。
        #expect(events.contains { if case let .toolUse(name, _) = $0 { return name.contains("ls") }; return false })
        // 差异④：agent_message 无 usage → assistantText usage nil。
        #expect(events.contains(.assistantText(text: "hello from codex", usage: nil)))
        // 差异②：turn.completed 只 usage → 事件级 success、numTurns nil（失败经退出码在调度器侧辨）。
        #expect(events.contains { if case .result(.success, nil, _) = $0 { return true }; return false })
    }
}
