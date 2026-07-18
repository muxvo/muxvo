// TerminalSurfaceView 输入转发（批3③ 挂接，检查点⑩接线；terminal-input.md §0/§2/§8）。
//
// keyDown 惯用法：先 interpretKeyEvents 触发 IME（setMarkedText/insertText），一轮内
// 未产生 insertText 且不在 composing 时才走 encoder（方向键/Ctrl 组合经
// doCommandBySelector 落回 handleKeyDown 编码写 PTY）。
// NSTextInputClient 必须落在视图（AppKit 经 first responder 查询协议），逐条转发控制器。
import AppKit

extension TerminalSurfaceView: CursorRectProviding {
    public func cursorRectOnScreen() -> NSRect { cursorRectOnScreenImpl() }
}

extension TerminalSurfaceView {
    public override func keyDown(with event: NSEvent) {
        guard let controller = inputController else { return super.keyDown(with: event) }
        imeHandledKeystroke = false
        interpretKeyEvents([event]) // IME / 直插路径（insertText 置标志）
        var produced = imeHandledKeystroke
        if !imeHandledKeystroke, !controller.isComposing {
            produced = controller.handleKeyDown(event) // 编码路径（含回底+重置闪烁）
        }
        // M4b B3-3：真人 keyDown 产出字节（含 IME 上屏）→ 回报 app 层（humanControl 置位 allow-list 唯一入口，
        // SEC-M5）。焦点视图才收 keyDown（聚焦门天然满足）；裸修饰键无产出 → 不报（produced=false）。
        if produced, let id = session?.id.raw { onProducedKeystroke?(id) }
    }

    public override func performKeyEquivalent(with event: NSEvent) -> Bool {
        guard let controller = inputController else { return super.performKeyEquivalent(with: event) }
        // F2 键截留守卫（DOGFOOD_M3_06，§8）：AppKit keyEquivalent 按视图树 DFS 首答制，多 surface 下
        // 非焦点 surface 会先被问到并抢答（且 performCommandKey 的 interceptPaste 是判定即副作用——就地取
        // 剪贴板 paste 进 attach 绑死的自身会话）。故非本 surface 为 first responder 时一律放行：交回
        // WKWebView（web 输入框自吞 Cmd+V/C）→ 菜单系统（zoom 键不变）。window==nil（未接线/独立视图）
        // 返 false，与放行一致。必须在调 performCommandKey 之前。
        guard window?.firstResponder === self else { return false }
        // hasSelection 接真（批4②）：查会话活选区 → 仅有选区才截 Cmd+C，无选区放行（§8）。
        switch controller.performCommandKey(event, hasSelection: session?.hasSelection() ?? false) {
        case .forwardToPTY:
            return false // 交回正常 keyDown / 菜单通道
        case .interceptPaste:
            return true // 控制器已就地取剪贴板走 paste_is_safe 流程
        case .interceptCopy:
            // 导出选区纯文本 → 系统剪贴板（§4）。
            if let text = session?.copySelectionPlainText(), !text.isEmpty {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(text, forType: .string)
            }
            return true
        case .interceptSearch:
            // Cmd+F（批5②）：接线则打开该终端搜索条并消费事件；未接线放行给菜单系统。
            if let onRequestSearch, let id = session?.id.raw {
                onRequestSearch(id)
                return true
            }
            return false
        case .interceptFontIncrease, .interceptFontDecrease, .interceptFontReset:
            return false // 动作归 app 菜单层（zoom 原生菜单）；放行给菜单系统
        }
    }
}

// MARK: - NSTextInputClient（IME 最小实现，terminal-input.md §2）
// @preconcurrency：协议要求 nonisolated，视图是 MainActor——AppKit 恒在 main 调用这些方法，
// 用 preconcurrency conformance 桥接（Swift 6 AppKit 协议惯用法）。

extension TerminalSurfaceView: @preconcurrency NSTextInputClient {
    public func insertText(_ string: Any, replacementRange: NSRange) {
        imeHandledKeystroke = true
        inputController?.imeInsertText(string, replacementRange: replacementRange)
        needsDisplay = true // preedit 清除后重绘
    }

    public func setMarkedText(_ string: Any, selectedRange: NSRange, replacementRange: NSRange) {
        imeHandledKeystroke = true
        inputController?.imeSetMarkedText(
            string, selectedRange: selectedRange, replacementRange: replacementRange)
        needsDisplay = true // preedit overlay 重绘
    }

    public func unmarkText() {
        inputController?.imeUnmarkText()
        needsDisplay = true
    }

    public func hasMarkedText() -> Bool { inputController?.imeHasMarkedText() ?? false }
    public func markedRange() -> NSRange { inputController?.imeMarkedRange() ?? NSRange(location: NSNotFound, length: 0) }
    public func selectedRange() -> NSRange { inputController?.imeSelectedRange() ?? NSRange(location: NSNotFound, length: 0) }

    public func attributedSubstring(forProposedRange range: NSRange,
                                    actualRange: NSRangePointer?) -> NSAttributedString? { nil }
    public func validAttributesForMarkedText() -> [NSAttributedString.Key] {
        inputController?.imeValidAttributesForMarkedText() ?? []
    }

    public func firstRect(forCharacterRange range: NSRange,
                          actualRange: NSRangePointer?) -> NSRect {
        inputController?.imeFirstRect(forCharacterRange: range) ?? .zero
    }

    public func characterIndex(for point: NSPoint) -> Int { 0 }
}
