// JSONValue 归口（M5 批1 A1-2）：全模块统一用 MuxvoTranscript.JSONValue（A1-1 信封原语），避免双定义。
//
// - `typealias JSONValue`：把 A1-1 的类型引入本模块命名空间，A1-2/A1-3 写 `JSONValue` 即指此
//   （含 A1-3 Codex 层 `JSONValue(any:)` / `.string(...)`）。
// - `init(any:)`：从 JSONSerialization 产物（含 nil→.null）构造的便捷入口（A1-3 依赖 + 本层 image
//   块 source 构造用）。`toAny()` / `from(_:)` / 强类型访问器由 A1-1 的 JSONValue 本体提供，不在此重复。
// 注：输出四类型批1 只需 Sendable/Equatable（CD_* 断言走值相等）；dump/桥序列化归批2/批3。

import Foundation
import MuxvoTranscript

public typealias JSONValue = MuxvoTranscript.JSONValue

extension JSONValue {
    /// 从 JSONSerialization 产物构造（nil → `.null`）。
    public init(any value: Any?) {
        guard let value else { self = .null; return }
        self = JSONValue.from(value)
    }
}
