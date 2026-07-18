// Sendable JSON 值树（M5 批1）：磁盘会话 JSONL 信封解码后，块内任意字段（tool_use.input /
// image.source / tool_result.content 等）以此表示——消费者（MuxvoChatHistory 投影层）无需
// 二次 JSON.parse 整行即可读到，且全 Sendable（[String: Any] 非 Sendable，Swift 6 严格并发下不可跨域）。
//
// 与 JSONField（NSNumber 取值小工具）分工：JSONField 服务解析器逐字段取值；本类型服务「保真整块
// 透传 + 强类型访问」两用（§8.1 assistant 块原样透传给 UI，同时 dump 面按具名字段归一）。

import Foundation

/// JSON 标量/容器的 Sendable 表示（bool/int/double 分列，保数值往返保真）。
public enum JSONValue: Sendable, Equatable {
    case null
    case bool(Bool)
    case int(Int64)
    case double(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    /// 从 JSONSerialization 产出的 `Any`（NSNull/NSNumber/NSString/NSArray/NSDictionary）桥接。
    /// bool 经 CFBoolean 类型辨识与整数分开；整数/浮点按 NSNumber.objCType 区分（"d"/"f" = 浮点）。
    public static func from(_ any: Any) -> JSONValue {
        switch any {
        case is NSNull:
            return .null
        case let s as String:
            return .string(s)
        case let a as [Any]:
            return .array(a.map(JSONValue.from))
        case let o as [String: Any]:
            return .object(o.mapValues(JSONValue.from))
        case let n as NSNumber:
            if CFGetTypeID(n) == CFBooleanGetTypeID() { return .bool(n.boolValue) }
            let t = String(cString: n.objCType)
            return (t == "d" || t == "f") ? .double(n.doubleValue) : .int(n.int64Value)
        default:
            return .null
        }
    }

    // MARK: - 强类型访问器（缺键/类型不符即 nil，前向兼容）

    public var stringValue: String? { if case let .string(s) = self { return s } else { return nil } }
    public var boolValue: Bool? { if case let .bool(b) = self { return b } else { return nil } }
    public var intValue: Int64? { if case let .int(i) = self { return i } else { return nil } }
    public var doubleValue: Double? {
        switch self {
        case let .double(d): return d
        case let .int(i): return Double(i)
        default: return nil
        }
    }
    public var arrayValue: [JSONValue]? { if case let .array(a) = self { return a } else { return nil } }
    public var objectValue: [String: JSONValue]? { if case let .object(o) = self { return o } else { return nil } }

    /// 还原为 JSONSerialization 风格的 `Any`（NSNull/NSNumber/String/[Any]/[String:Any]）。
    /// SessionRecord 以此把 Sendable 存储换成 ChatRecordReading 的 `Any?` 读取面——消费者的
    /// `as? String` / `as? [Any]` / `as? [String:Any]` 与直读 JSONSerialization 输出一致。
    public func toAny() -> Any {
        switch self {
        case .null: return NSNull()
        case .bool(let b): return NSNumber(value: b)
        case .int(let i): return NSNumber(value: i)
        case .double(let d): return NSNumber(value: d)
        case .string(let s): return s
        case .array(let a): return a.map { $0.toAny() }
        case .object(let o): return o.mapValues { $0.toAny() }
        }
    }
}
