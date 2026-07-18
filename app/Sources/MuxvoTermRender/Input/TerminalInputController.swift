// TerminalInputController：输入链编排（terminal-input.md §0–§8）。
//
// 事件流向（§0）：宿主视图 main 捕获 NSEvent → 本控制器 → withTerminal 在会话 queue 上
// 编码（与 vt feed 互斥）→ writer 直写 PTY。人键入直达 PTY、零桥参与。
//
// 持有关系：encoding / writer / host / cursorRectProvider 皆 weak（本控制器不拥有会话与视图，
// 避免环）。encoder 与 ime 由本控制器拥有。
//
// 挂接（见报告「挂接说明」）：
//   - encoding：生产需 MuxvoTerm 侧 adapter conform TerminalKeyEncoding（拿会话私有 queue/term）；
//     本层/测试用隔离实现。
//   - host：TerminalSurfaceView 已 conform TerminalInputHost（prepareForKeystroke/setFocused）。
//   - writer：TerminalSession 已 conform TerminalInputWriting（公有 write）。
//   - 宿主视图把 keyDown/performKeyEquivalent/NSTextInputClient 回调转发到本控制器对应方法。
import AppKit
import CGhosttyVT

@MainActor
public final class TerminalInputController {
    public struct Config {
        /// macOS Option 是否当 Alt。默认 FALSE：与 ghostty 自身默认一致、贴合 macOS 文本录入
        /// 直觉（Option+e 组重音而非发 Alt 转义）；Alt-as-Meta（shell 词跳转）留 config 打开。
        public var optionAsAlt: GhosttyOptionAsAlt = GHOSTTY_OPTION_AS_ALT_FALSE
        /// 不安全粘贴（含换行 / 结束序列）是否弹确认框。裁决⑨：默认开（防误粘贴多行命令直执）。
        public var confirmUnsafePaste: Bool = true
        public init() {}
    }

    public var config: Config

    private weak var encoding: (any TerminalKeyEncoding)?
    private weak var writer: (any TerminalInputWriting)?
    private weak var host: (any TerminalInputHost)?
    private weak var cursorRectProvider: (any CursorRectProviding)?

    private let encoder = TerminalKeyEncoder()
    private let ime = TerminalIMEState()

    /// 不安全粘贴确认回调（宿主注入）：给 text，回调传 true=确认粘贴。默认开但未注入 handler 时直粘。
    public var onConfirmUnsafePaste: ((String, @escaping (Bool) -> Void) -> Void)?
    /// Cmd+V 取剪贴板文本（默认读系统剪贴板纯文本）。
    public var pasteboardString: () -> String? = { NSPasteboard.general.string(forType: .string) }

    public init(encoding: any TerminalKeyEncoding,
                writer: any TerminalInputWriting,
                host: (any TerminalInputHost)? = nil,
                cursorRectProvider: (any CursorRectProviding)? = nil,
                config: Config = Config()) {
        self.encoding = encoding
        self.writer = writer
        self.host = host
        self.cursorRectProvider = cursorRectProvider
        self.config = config
    }

    // MARK: 按键（§1）

    /// 编码 + 写 PTY。返回是否有产出（裸修饰键等无产出 → false，不回底/不写）。
    @discardableResult
    public func handleKeyDown(_ assembled: AssembledKeyEvent) -> Bool {
        let bytes = encoding?.withTerminal { term in
            encoder.encode(assembled, terminal: term, optionAsAlt: config.optionAsAlt)
        } ?? []
        guard !bytes.isEmpty else { return false }
        host?.prepareForKeystroke()   // §5 回底 + §4.3 重置闪烁相位（仅真有产出时）
        writer?.writeInput(bytes)
        return true
    }

    /// NSEvent 便捷入口：装配（组字态由 IME 决定）→ 编码写入。
    @discardableResult
    public func handleKeyDown(_ event: NSEvent) -> Bool {
        let assembled = KeyEventAssembler.assemble(
            event, optionAsAlt: config.optionAsAlt, composing: ime.isComposing)
        return handleKeyDown(assembled)
    }

    // MARK: Cmd 截留（§8）

    /// 判定 Cmd 组合处置；interceptPaste 由本控制器就地执行（取剪贴板→paste），其余返给宿主处理。
    @discardableResult
    public func performCommandKey(key: GhosttyKey, command: Bool, hasSelection: Bool) -> CommandKeyAction {
        let action = CommandKeyInterception.decide(command: command, key: key, hasSelection: hasSelection)
        if action == .interceptPaste, let text = pasteboardString(), !text.isEmpty { paste(text) }
        return action
    }

    /// NSEvent 便捷入口。
    @discardableResult
    public func performCommandKey(_ event: NSEvent, hasSelection: Bool) -> CommandKeyAction {
        performCommandKey(
            key: GhosttyKeyMap.key(forVirtualKeyCode: event.keyCode),
            command: event.modifierFlags.contains(.command),
            hasSelection: hasSelection)
    }

    // MARK: 粘贴（§3）

    public func paste(_ text: String) {
        guard !text.isEmpty else { return }
        if PasteHandler.isSafe(text) { writePaste(text); return }
        // 不安全：确认开且有 handler → 走确认；否则直粘。
        // 契约：confirm 的完成回调须在 main 线程投递（NSAlert sheet 天然如此）。
        if config.confirmUnsafePaste, let confirm = onConfirmUnsafePaste {
            confirm(text) { [weak self] ok in
                guard ok else { return }
                MainActor.assumeIsolated { self?.writePaste(text) }
            }
        } else {
            writePaste(text)
        }
    }

    private func writePaste(_ text: String) {
        let bracketed = encoding?.withTerminal { term -> Bool in
            var b = false
            _ = ghostty_terminal_mode_get(term, GhosttyMode(2004), &b)  // DEC 2004 bracketed paste
            return b
        } ?? false
        let bytes = PasteHandler.encode(text, bracketed: bracketed)
        guard !bytes.isEmpty else { return }
        host?.prepareForKeystroke()
        writer?.writeInput(bytes)
    }

    // MARK: 焦点（§7）

    public func focusChanged(_ focused: Bool) {
        host?.setFocused(focused)   // 先转发（光标 hollow / 闪烁 timer）
        let bytes = encoding?.withTerminal { term -> [UInt8] in
            var active = false
            _ = ghostty_terminal_mode_get(term, GhosttyMode(1004), &active)  // DEC 1004 focus events
            return active ? FocusReporter.encode(gained: focused) : []
        } ?? []
        guard !bytes.isEmpty else { return }
        writer?.writeInput(bytes)
    }

    // MARK: IME（§2）—— 宿主视图把 NSTextInputClient 回调转发到这里

    public var isComposing: Bool { ime.isComposing }
    /// 当前 preedit（视图画下划线 overlay 时读）。
    public var preeditText: String { ime.markedText }

    public func imeSetMarkedText(_ string: Any, selectedRange: NSRange, replacementRange: NSRange) {
        ime.setMarkedText(imePlainString(string), selectedRange: selectedRange)
    }

    public func imeInsertText(_ string: Any, replacementRange: NSRange) {
        ime.clear()
        let text = imePlainString(string)
        guard !text.isEmpty else { return }
        host?.prepareForKeystroke()          // 提交如键入 → 回底
        writer?.writeInput(Array(text.utf8))  // UTF-8 直写 PTY（§2）
    }

    public func imeUnmarkText() { ime.clear() }
    public func imeHasMarkedText() -> Bool { ime.isComposing }
    public func imeMarkedRange() -> NSRange { ime.markedRange }
    public func imeSelectedRange() -> NSRange { ime.selectedRange }

    /// firstRect：候选窗定位 = 光标 cell 屏幕矩形（§2）。无 provider → .zero。
    public func imeFirstRect(forCharacterRange range: NSRange) -> NSRect {
        cursorRectProvider?.cursorRectOnScreen() ?? .zero
    }

    /// 不做富样式 marked text。
    public func imeValidAttributesForMarkedText() -> [NSAttributedString.Key] { [] }
}
