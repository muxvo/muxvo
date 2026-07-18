// Codex `codex exec --json` 行解析器：其事件形状差异由本 mapper 吸收，输出同一 HarnessEvent。
//
// 真契约：codex-cli 0.137.0（W0a 本机实证，报告 logs/m4a-batch5-red/codex-probe.md 差异清单）。
//   起始 = `thread.started` + `thread_id`（**无 model**）——差异①(MAJOR)：session id 靠此不丢，
//   否则破坏 SEC-17 sessionId 回填 + `codex exec resume` 续接。每 item 前先发 `item.started`、
//   每 turn 前发裸 `turn.started`（差异⑤⑥）——显式吞、零 unknown 噪声透传。收口 `turn.completed`
//   只带 usage（无 status/is_error/num_turns，差异②）→ 事件级 success（失败经退出码在调度器侧辨）。
// 复用同一 §2 分帧/失败纪律（LineFramer + 连续失败阈值），仅 §3 映射按 Codex 事件名分派。
// 兼容旧别名（session.created / session_configured）防回退，未知事件保 raw 透传 unknown。

import Foundation

public struct CodexJSONParser: HarnessLineParser {
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
                out.append(recordFailure())
            case .line(let data):
                if data.isEmpty { continue }
                guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                    out.append(recordFailure())
                    continue
                }
                out.append(contentsOf: Self.map(obj, raw: String(decoding: data, as: UTF8.self)))
                consecutiveFailures = 0
            }
        }
        return out
    }

    private mutating func recordFailure() -> HarnessEvent {
        consecutiveFailures += 1
        if consecutiveFailures >= threshold { thresholdExceeded = true }
        return .parseError(count: consecutiveFailures)
    }

    // MARK: - 映射（手工构造形状，契约录制归批5）
    // internal（非 private）：scanCold 冷扫按 harness 分派复用（Codex 磁盘会话时）。

    static func map(_ obj: [String: Any], raw: String) -> [HarnessEvent] {
        switch obj["type"] as? String {
        case "thread.started":
            // 真契约①(MAJOR)：会话 id = thread_id（无 model）。旧别名保作回退防漂移。
            return [.sessionStarted(sessionId: obj["thread_id"] as? String ?? "", model: nil)]
        case "session.created", "session_configured":
            return [.sessionStarted(sessionId: obj["session_id"] as? String ?? "",
                                    model: obj["model"] as? String)]
        case "item.completed":
            return mapItem(obj["item"] as? [String: Any], raw: raw)
        case "turn.completed", "response.completed", "task_complete":
            return [mapTurn(obj, raw: raw)]
        case "item.started", "turn.started":
            // 差异⑤⑥：item.started（随后 item.completed 重复）+ 裸 turn.started 是遥测噪声，显式吞。
            return []
        case .some(let type):
            return [.unknown(type: type, raw: raw)]
        case .none:
            return [.unknown(type: nil, raw: raw)]
        }
    }

    private static func mapItem(_ item: [String: Any]?, raw: String) -> [HarnessEvent] {
        guard let item else { return [.unknown(type: "item.completed", raw: raw)] }
        switch item["type"] as? String {
        case "agent_message", "assistant_message":
            let text = (item["text"] as? String) ?? (item["message"] as? String) ?? ""
            return [.assistantText(text: text, usage: JSONField.usage(item["usage"]))]
        case "function_call", "command_execution":
            let name = (item["name"] as? String) ?? (item["command"] as? String) ?? ""
            return [.toolUse(name: name, inputDigest: Digest.ofJSON(item["arguments"] ?? item["input"]))]
        default:
            return [.unknown(type: "item/\(item["type"] as? String ?? "?")", raw: raw)]
        }
    }

    private static func mapTurn(_ obj: [String: Any], raw: String) -> HarnessEvent {
        let statusStr = obj["status"] as? String
        let isError = JSONField.bool(obj["is_error"]) ?? (statusStr == "error" || statusStr == "failed")
        let ok = !isError && (statusStr == nil || statusStr == "success" || statusStr == "completed")
        let status: ResultStatus = ok ? .success : .error(kind: statusStr ?? "error")
        return .result(status: status, numTurns: JSONField.int(obj["num_turns"]), raw: raw)
    }
}
