// 磁盘会话 JSONL 行的强类型信封（M5 批1 A1-1，并行协作契约）。
//
// 定位：CC/Codex 磁盘会话 JSONL（`~/.claude/projects/**/*.jsonl` 等）单行 → 信封字段。
// 只做「信封」——零聊天语义（title/详情/搜索的投影语义归 MuxvoChatHistory，chat-data.md §2~§4）。
//
// 内容读取面提供两套（单一存储 JSONValue，两视图派生，A1-2 各路径按需取）：
//   ① Any? 面（ChatRecordReading 契约）：messageContent / topLevelContent = legacy
//      `entry.message?.content` / 顶层 `entry.content` 的 JSONSerialization 风格 `Any?`
//      （String/[Any]/[String:Any]/NSNumber/NSNull），消费者用 `as?` 归一化（ContentAccess/搜索/摘要）。
//      A1-2 写 `extension SessionRecord: ChatRecordReading {}` 零 body 达成（字段名/类型逐一对齐）。
//   ② 强类型面（详情投影用）：message?.content / content = MessageContent（.string/.blocks/.absent），
//      块为 ContentBlock（.object 保完整块 + 具名访问器，§8.1 dump/透传）。
//   Sendable：内部以 Sendable 的 JSONValue 存储，Any? 面按需 toAny 还原、强类型面按需派生，
//   SessionRecord 保持 Sendable 值类型不破。
//
// ⚠️ API 形状钉死（并行协作契约）：字段名/语义为 A1-2/A1-3 依赖面，不得擅改。
// 权威：specs/behavior/chat-data.md §2（startedAt/cwd/title）、§3（parseMessageLine 内容归一化）。

import Foundation

/// 磁盘会话 JSONL 单行信封（Sendable 值类型）。
public struct SessionRecord: Sendable, Equatable {
    /// 记录类型（`user`/`assistant`/`queue-operation`/`summary`/`file-history-snapshot`/… 原样；
    /// 缺 `type` 键则空串——投影白名单据此天然忽略，同 legacy `obj.type==='...'` 恒 false）。
    public let type: String
    public let uuid: String?
    public let parentUuid: String?
    /// 会话 id（读 `sessionId` 键；legacy `entry.sessionId` 口径，snake `session_id` 不并入）。
    public let sessionId: String?
    public let cwd: String?
    public let gitBranch: String?
    /// 时间戳原样字符串（CC/Codex 恒为 ISO8601，如 `2026-07-06T10:23:45.123Z`）。
    /// 数值型 ts（防御性，真实数据不出现）时此字段为 nil，值仅经 `timestampMs` 呈现。
    public let timestamp: String?
    /// §3.5 红线：sidechain 不在投影层过滤——本字段仅供信封审计，ChatRecordReading **不暴露**它。
    public let isSidechain: Bool?
    public let isMeta: Bool?
    public let isCompactSummary: Bool?
    /// `message.role`（保真备用）。
    public let messageRole: String?
    /// 加性扩展（dogfood-r4 问题5）：顶层 `summary` 键（`type=="summary"` 记录携带）——供空 title 会话的
    /// title fallback 链取首条 summary。信封零语义（同 cwd/gitBranch 一样只透传原始键），无 summary 键则 nil。
    public let summaryText: String?
    /// `timestamp` → epoch 毫秒便捷换算（ISO8601 或数值 ts 均支持；无法解析 = nil）。
    public let timestampMs: Int64?
    /// 该行 JSONL 原文（UTF-8 解码，不含结尾 \n）——审计/搜索/双跑 diff 兜底面。
    public let raw: String

    // Sendable 存储：`[String: Any]` / `Any?` 非 Sendable，原始内容值以 JSONValue 保真存储（唯一源）。
    private let hasMessage: Bool
    private let messageContentJSON: JSONValue?
    private let topLevelContentJSON: JSONValue?

    // MARK: - ① Any? 面（ChatRecordReading）

    /// legacy `entry.message?.content` 的原始 JSON 值（String/[Any]/[String:Any]/NSNumber/NSNull），
    /// 键缺失或无 message → nil；JSON null → NSNull。满足 `ChatRecordReading.messageContent`。
    public var messageContent: Any? { messageContentJSON?.toAny() }
    /// legacy 顶层 `entry.content` 原始值，键缺失 → nil。满足 `ChatRecordReading.topLevelContent`。
    public var topLevelContent: Any? { topLevelContentJSON?.toAny() }

    // MARK: - ② 强类型面（详情投影）

    /// `message` 信封（`{role, content}`）；无 message 键 → nil。
    public var message: MessageEnvelope? {
        hasMessage ? MessageEnvelope(role: messageRole, content: MessageContent.from(messageContentJSON)) : nil
    }
    /// 顶层 `entry.content` 的强类型视图（queue-operation 为 `.string`；assistant 兜底可为 `.blocks`）。
    public var content: MessageContent { MessageContent.from(topLevelContentJSON) }

    /// 从 JSONSerialization 产出的字典构造（decoder 已保证 obj 是 `[String: Any]`）。
    public init(object obj: [String: Any], raw: String) {
        self.type = obj["type"] as? String ?? ""
        self.uuid = obj["uuid"] as? String
        self.parentUuid = obj["parentUuid"] as? String
        self.sessionId = obj["sessionId"] as? String
        self.cwd = obj["cwd"] as? String
        self.gitBranch = obj["gitBranch"] as? String
        self.timestamp = obj["timestamp"] as? String
        // as? Bool 仅对 JSON 布尔命中（非布尔 NSNumber 返 nil），对齐 §3.3 `===true` 严格语义。
        self.isSidechain = obj["isSidechain"] as? Bool
        self.isMeta = obj["isMeta"] as? Bool
        self.isCompactSummary = obj["isCompactSummary"] as? Bool
        self.summaryText = obj["summary"] as? String
        // message.content：键存在（含 JSON null）才记，缺 message / 缺 content 键 → nil。
        if let msg = obj["message"] as? [String: Any] {
            self.hasMessage = true
            self.messageRole = msg["role"] as? String
            self.messageContentJSON = msg["content"].map(JSONValue.from)
        } else {
            self.hasMessage = false
            self.messageRole = nil
            self.messageContentJSON = nil
        }
        // 顶层 content：键存在（含 JSON null）才记。
        self.topLevelContentJSON = obj["content"].map(JSONValue.from)
        self.timestampMs = SessionRecord.timestampMs(from: obj["timestamp"])
        self.raw = raw
    }

    /// ISO8601 字符串或数值 ts → epoch 毫秒（数值按秒/毫秒启发式归一）。
    static func timestampMs(from any: Any?) -> Int64? {
        if let s = any as? String { return ISO8601Millis.toMs(s) }
        if let n = any as? NSNumber {
            if CFGetTypeID(n) == CFBooleanGetTypeID() { return nil }
            let v = n.doubleValue
            // |v| < 1e11 视为秒（epoch 秒当前约 1.7e9，毫秒约 1.7e12，1e11 干净分界）。
            return Int64(abs(v) < 100_000_000_000 ? (v * 1000).rounded() : v.rounded())
        }
        return nil
    }
}

/// `message` 信封（`{role, content}`）。投影层主用 `content`；`role` 保真备用。
public struct MessageEnvelope: Sendable, Equatable {
    public let role: String?
    public let content: MessageContent

    public init(role: String?, content: MessageContent) {
        self.role = role
        self.content = content
    }
}

/// 消息内容两形态 + 缺席（§3.2 归一化输入面）。
/// `.string` = JSON 字符串；`.blocks` = 块数组；`.absent` = 键缺失或非 string/array（null/数字/对象）。
public enum MessageContent: Sendable, Equatable {
    case string(String)
    case blocks([ContentBlock])
    case absent

    /// 从原始 JSONValue 归一：string→`.string`；array→`.blocks`（非对象元素丢弃，同 legacy 按 `b.type` 过滤）；
    /// 其余（nil/object/number/null/bool）→ `.absent`。
    public static func from(_ json: JSONValue?) -> MessageContent {
        switch json {
        case .string(let s): return .string(s)
        case .array(let a): return .blocks(a.compactMap { $0.objectValue.map(ContentBlock.init(object:)) })
        default: return .absent
        }
    }

    /// 便捷：`.string` 的字符串，否则 nil（queue-operation 顶层 content 取值用）。
    public var stringValue: String? { if case let .string(s) = self { return s } else { return nil } }
    /// 便捷：`.blocks` 的块数组，否则 nil。
    public var blocksValue: [ContentBlock]? { if case let .blocks(b) = self { return b } else { return nil } }
}

/// 内容块（text / tool_use / tool_result / image / thinking / …）。
/// `object` 保完整解码块（键名保真，供 §3.2 assistant「原样透传给 UI」）；具名访问器覆盖 §8.1 dump
/// 契约字段（`type,text?,name?,input?,content?,tool_use_id?,source?`），投影/归一无需再解析。
public struct ContentBlock: Sendable, Equatable {
    /// 该块的完整解码对象（含 id/is_error/caller/signature 等 §8.1 未列字段，透传不丢）。
    public let object: [String: JSONValue]

    public init(object: [String: JSONValue]) {
        self.object = object
    }

    public var type: String? { object["type"]?.stringValue }
    public var text: String? { object["text"]?.stringValue }
    public var name: String? { object["name"]?.stringValue }
    public var input: JSONValue? { object["input"] }
    /// 块内层 content（tool_result 的 content：字符串或块数组）。
    public var content: JSONValue? { object["content"] }
    public var toolUseId: String? { object["tool_use_id"]?.stringValue }
    /// image source（`{type, media_type, data}`）。
    public var source: JSONValue? { object["source"] }
}

/// ISO8601 → epoch 毫秒的自实现解析（零 DateFormatter 共享态 → 线程安全 + 无锁快路）。
/// 覆盖 `YYYY-MM-DDTHH:MM:SS[.fff][Z|±HH[:]MM]`（CC/Codex 恒 UTC `Z`；偏移分支为防御）。
enum ISO8601Millis {
    static func toMs(_ s: String) -> Int64? {
        let u = Array(s.utf8)
        guard u.count >= 19 else { return nil }   // 至少 "YYYY-MM-DDTHH:MM:SS"
        func digit(_ i: Int) -> Int? { let c = u[i]; return (c >= 48 && c <= 57) ? Int(c - 48) : nil }
        func num(_ start: Int, _ n: Int) -> Int? {
            guard start + n <= u.count else { return nil }
            var v = 0
            for i in start..<(start + n) { guard let x = digit(i) else { return nil }; v = v * 10 + x }
            return v
        }
        guard let year = num(0, 4), u[4] == 45,           // '-'
              let month = num(5, 2), u[7] == 45,
              let day = num(8, 2),
              u[10] == 84 || u[10] == 116,                 // 'T'/'t'
              let hh = num(11, 2), u[13] == 58,            // ':'
              let mm = num(14, 2), u[16] == 58,
              let ss = num(17, 2) else { return nil }

        var idx = 19
        var fracMs = 0
        if idx < u.count, u[idx] == 46 {                   // '.'
            idx += 1
            var scale = 100
            while idx < u.count, let x = digit(idx) {
                if scale >= 1 { fracMs += x * scale; scale /= 10 }
                idx += 1
            }
        }
        var offsetMinutes = 0
        if idx < u.count {
            let c = u[idx]
            if c == 90 || c == 122 {                       // 'Z'/'z' = UTC
                idx += 1
            } else if c == 43 || c == 45 {                 // '+'/'-'
                let sign = (c == 45) ? -1 : 1
                idx += 1
                guard let oh = num(idx, 2) else { return nil }
                idx += 2
                if idx < u.count, u[idx] == 58 { idx += 1 } // 可选 ':'
                let om = num(idx, 2) ?? 0
                offsetMinutes = sign * (oh * 60 + om)
            }
        }
        // days_from_civil（Howard Hinnant）：民用日历 → 1970-01-01 起的天数。
        var y = year
        if month <= 2 { y -= 1 }
        let era = (y >= 0 ? y : y - 399) / 400
        let yoe = y - era * 400
        let doy = (153 * (month + (month > 2 ? -3 : 9)) + 2) / 5 + day - 1
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
        let days = era * 146097 + doe - 719468
        let secs = Int64(days) * 86400 + Int64(hh) * 3600 + Int64(mm) * 60 + Int64(ss)
        return secs * 1000 + Int64(fracMs) - Int64(offsetMinutes) * 60_000
    }
}
