// TerminalIME：IME 最小实现的视图侧状态模型（terminal-input.md §2）。
//
// 只做：组字期存 preedit（marked text）+ 选中区间，供视图在光标 cell 画下划线 overlay；
// insertText 时清 preedit 并 UTF-8 直写 PTY（写动作在 TerminalInputController）。
// 不做：inline 候选、重排、marked range 富样式。
//
// NSTextInputClient 协议方法须落在 first responder（宿主视图）上、由 AppKit 经响应链查询，
// 故本层不能替视图 conform；而是把「状态迁移 + 提交文本」抽成可测模型，视图后续把各
// NSTextInputClient 回调转发到 TerminalInputController 的 ime* 方法（见报告「挂接说明」）。
import AppKit

/// 组字状态模型（纯逻辑，可脱 NSView 测）。
@MainActor
public final class TerminalIMEState {
    /// 当前 preedit（组字串）；空 = 未组字。
    public private(set) var markedText: String = ""
    /// preedit 内的选中区间（相对 preedit）。未组字时 location=NSNotFound。
    public private(set) var selectedRange = NSRange(location: NSNotFound, length: 0)

    public init() {}

    /// 是否正组字（有 preedit）。true → 编码按键须置 composing 抑制转义（§2）。
    public var isComposing: Bool { !markedText.isEmpty }

    /// setMarkedText：更新 preedit 与选中区间。空串等价于取消组字。
    public func setMarkedText(_ text: String, selectedRange: NSRange) {
        markedText = text
        self.selectedRange = text.isEmpty
            ? NSRange(location: NSNotFound, length: 0)
            : selectedRange
    }

    /// unmarkText / insertText：清空 preedit。
    public func clear() {
        markedText = ""
        selectedRange = NSRange(location: NSNotFound, length: 0)
    }

    /// marked range（供 NSTextInputClient.markedRange 转发）。
    public var markedRange: NSRange {
        isComposing ? NSRange(location: 0, length: markedText.utf16.count)
                    : NSRange(location: NSNotFound, length: 0)
    }
}

/// 从 NSTextInputClient 传入的 setMarkedText/insertText 参数（String 或 NSAttributedString）
/// 取纯文本。
public func imePlainString(_ any: Any) -> String {
    if let s = any as? String { return s }
    if let a = any as? NSAttributedString { return a.string }
    return ""
}
