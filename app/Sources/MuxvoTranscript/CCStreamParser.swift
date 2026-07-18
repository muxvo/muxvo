// CC `claude -p --output-format stream-json` 行解析器（§2 纪律 + §3 映射）。
//
// 纪律：仅按 \n 分帧（LineFramer）、不完整尾行缓冲等续、单行超上限截断记 parseError；
// 已知 type 强类型化、未知 type/subtype/字段保 raw 透传发 unknown 绝不抛错；非法 JSON
// 记 parseError，同源连续失败达阈值锁存异常信号（thresholdExceeded）。
// 值语义、Sendable：feed 是唯一可变入口，可被文件 tail / stdout pipe 增量喂入。

import Foundation

public struct CCStreamParser: HarnessLineParser {
    private var framer: LineFramer
    private let threshold: Int
    public private(set) var consecutiveFailures = 0
    public private(set) var thresholdExceeded = false

    public init(
        maxLineBytes: Int = TranscriptLimits.maxLineBytes,
        consecutiveFailureThreshold: Int = TranscriptLimits.consecutiveFailureThreshold
    ) {
        self.framer = LineFramer(maxLineBytes: maxLineBytes)
        self.threshold = consecutiveFailureThreshold
    }

    public mutating func feed(_ chunk: Data) -> [HarnessEvent] {
        var out: [HarnessEvent] = []
        for frame in framer.feed(chunk) {
            switch frame {
            case .oversize:
                out.append(recordFailure())                 // 超限行 = 失败一行（§2.1）
            case .line(let data):
                if data.isEmpty { continue }                // 空行：非事件非失败，跳过
                guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                    out.append(recordFailure())             // 非法 JSON（§2.3）
                    continue
                }
                let raw = String(decoding: data, as: UTF8.self)
                out.append(contentsOf: Self.map(obj, raw: raw))
                consecutiveFailures = 0                      // 成功一行 → 连续失败归零
            }
        }
        return out
    }

    private mutating func recordFailure() -> HarnessEvent {
        consecutiveFailures += 1
        if consecutiveFailures >= threshold { thresholdExceeded = true }
        return .parseError(count: consecutiveFailures)
    }

    // MARK: - 映射（§3，纯函数）
    // internal（非 private）：scanCold（TranscriptSource）冷扫复用同一映射，避免重复 CC 语义。

    static func map(_ obj: [String: Any], raw: String) -> [HarnessEvent] {
        switch obj["type"] as? String {
        case "system":
            let subtype = obj["subtype"] as? String
            guard subtype == "init" else {
                // 未枚举 subtype（如 thinking_tokens）→ 透传 unknown（§3 实测印证）。
                return [.unknown(type: "system/\(subtype ?? "?")", raw: raw)]
            }
            return [.sessionStarted(sessionId: obj["session_id"] as? String ?? "",
                                    model: obj["model"] as? String)]
        case "rate_limit_event":
            let info = obj["rate_limit_info"] as? [String: Any] ?? [:]
            return [.rateLimit(status: info["status"] as? String ?? "",
                               resetsAt: JSONField.int64(info["resetsAt"]),
                               raw: raw)]
        case "assistant":
            return mapAssistant(obj)
        case "user":
            return mapUser(obj)
        case "result":
            return [mapResult(obj, raw: raw)]
        case .some(let type):
            return [.unknown(type: type, raw: raw)]
        case .none:
            return [.unknown(type: nil, raw: raw)]
        }
    }

    private static func mapAssistant(_ obj: [String: Any]) -> [HarnessEvent] {
        guard let message = obj["message"] as? [String: Any] else { return [] }
        let usage = JSONField.usage(message["usage"])
        // content 可为块数组，亦可（少见）为纯字符串。
        if let text = message["content"] as? String {
            return [.assistantText(text: text, usage: usage)]
        }
        guard let content = message["content"] as? [[String: Any]] else { return [] }
        var out: [HarnessEvent] = []
        for block in content {
            switch block["type"] as? String {
            case "text":
                out.append(.assistantText(text: block["text"] as? String ?? "", usage: usage))
            case "tool_use":
                // input 原文不出库（§3）：只出 digest。
                out.append(.toolUse(name: block["name"] as? String ?? "",
                                    inputDigest: Digest.ofJSON(block["input"])))
            case "thinking", "redacted_thinking":
                // 内部推理块：非转写主体，跳过合理（不抛错、不产事件）。
                continue
            case let blockType:
                // 其余未知内容块：§2「未知必透传」——可观测不静默丢弃 → unknown
                // （与 CodexMapper 未知 item 产 unknown 对称；raw 取该块本身）。
                out.append(.unknown(type: "assistant_block:\(blockType ?? "?")",
                                    raw: Self.rawBlock(block)))
            }
        }
        return out
    }

    /// 未知内容块的原文（§2.4：free text 仅供展示/审计，绝不进策略引擎）。
    private static func rawBlock(_ block: [String: Any]) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: block, options: [.sortedKeys]) else {
            return String(describing: block)
        }
        return String(decoding: data, as: UTF8.self)
    }

    private static func mapUser(_ obj: [String: Any]) -> [HarnessEvent] {
        guard let message = obj["message"] as? [String: Any],
              let content = message["content"] as? [[String: Any]] else { return [] }
        return content
            .filter { ($0["type"] as? String) == "tool_result" }
            .map { .toolResult(summaryDigest: Digest.ofJSON($0["content"])) }
    }

    private static func mapResult(_ obj: [String: Any], raw: String) -> HarnessEvent {
        let subtype = obj["subtype"] as? String
        let isError = JSONField.bool(obj["is_error"]) ?? false
        let status: ResultStatus = (subtype == "success" && !isError)
            ? .success
            : .error(kind: subtype ?? (isError ? "error" : "unknown"))
        return .result(status: status, numTurns: JSONField.int(obj["num_turns"]), raw: raw)
    }
}
