// InputTests：输入链（键盘编码 / IME / 粘贴 / 焦点 / Cmd 截留）测试（terminal-input.md §1–§8）。
//
// 隔离终端：测试自建 GhosttyTerminal（不起真 shell），灌 DECSET 后断言编码变化——把「编码依活
// 终端 modes」的合同确定性验掉，不依赖键盘布局。写入用假 sink 记录字节。
import AppKit
import Carbon.HIToolbox
import Foundation
import Testing
import CGhosttyVT
@testable import MuxvoTermRender

// MARK: - 测试替身

/// 隔离终端宿主：拥有一个独立 GhosttyTerminal，可灌 DECSET，实现 TerminalKeyEncoding。
@MainActor
final class IsolatedTerminalHost: TerminalKeyEncoding {
    nonisolated(unsafe) private var term: OpaquePointer?

    init(cols: UInt16 = 80, rows: UInt16 = 24) {
        var t: OpaquePointer?
        let opts = GhosttyTerminalOptions(cols: cols, rows: rows, max_scrollback: 0)
        if ghostty_terminal_new(nil, &t, opts) == GHOSTTY_SUCCESS { term = t }
    }
    deinit { if let term { ghostty_terminal_free(term) } }

    /// 灌 VT 字节（DECSET 序列等）。
    func feed(_ s: String) {
        guard let term else { return }
        let bytes = Array(s.utf8)
        bytes.withUnsafeBufferPointer { ghostty_terminal_vt_write(term, $0.baseAddress, $0.count) }
    }

    func withTerminal<R>(_ body: (OpaquePointer) -> R) -> R? {
        guard let term else { return nil }
        return body(term)
    }
}

/// 假 PTY 写 sink：记录一切写入字节。
final class RecordingWriter: TerminalInputWriting {
    private(set) var written: [UInt8] = []
    func writeInput(_ bytes: [UInt8]) { written.append(contentsOf: bytes) }
    var text: String { String(decoding: written, as: UTF8.self) }
    func reset() { written.removeAll() }
}

@MainActor
final class RecordingHost: TerminalInputHost {
    private(set) var prepareCount = 0
    private(set) var focusStates: [Bool] = []
    func prepareForKeystroke() { prepareCount += 1 }
    func setFocused(_ focused: Bool) { focusStates.append(focused) }
}

@MainActor
final class FixedCursorRect: CursorRectProviding {
    var rect = NSRect(x: 11, y: 22, width: 8, height: 16)
    func cursorRectOnScreen() -> NSRect { rect }
}

// 直接编码一次按键（走隔离终端）。
@MainActor
private func encode(_ e: AssembledKeyEvent, on host: IsolatedTerminalHost,
                    optionAsAlt: GhosttyOptionAsAlt = GHOSTTY_OPTION_AS_ALT_FALSE) -> [UInt8] {
    let enc = TerminalKeyEncoder()
    return host.withTerminal { enc.encode(e, terminal: $0, optionAsAlt: optionAsAlt) } ?? []
}

// MARK: - §1 键码映射

@MainActor
@Suite("输入链 §1 键码映射")
struct KeyMapTests {
    @Test("虚拟键码抽查 → GhosttyKey")
    func spotChecks() {
        #expect(GhosttyKeyMap.key(forVirtualKeyCode: UInt16(kVK_ANSI_A)) == GHOSTTY_KEY_A)
        #expect(GhosttyKeyMap.key(forVirtualKeyCode: UInt16(kVK_Return)) == GHOSTTY_KEY_ENTER)
        #expect(GhosttyKeyMap.key(forVirtualKeyCode: UInt16(kVK_Delete)) == GHOSTTY_KEY_BACKSPACE)
        #expect(GhosttyKeyMap.key(forVirtualKeyCode: UInt16(kVK_ForwardDelete)) == GHOSTTY_KEY_DELETE)
        #expect(GhosttyKeyMap.key(forVirtualKeyCode: UInt16(kVK_UpArrow)) == GHOSTTY_KEY_ARROW_UP)
        #expect(GhosttyKeyMap.key(forVirtualKeyCode: UInt16(kVK_LeftArrow)) == GHOSTTY_KEY_ARROW_LEFT)
        #expect(GhosttyKeyMap.key(forVirtualKeyCode: UInt16(kVK_ANSI_Keypad5)) == GHOSTTY_KEY_NUMPAD_5)
        #expect(GhosttyKeyMap.key(forVirtualKeyCode: UInt16(kVK_F5)) == GHOSTTY_KEY_F5)
        #expect(GhosttyKeyMap.key(forVirtualKeyCode: UInt16(kVK_Escape)) == GHOSTTY_KEY_ESCAPE)
        #expect(GhosttyKeyMap.key(forVirtualKeyCode: UInt16(kVK_Option)) == GHOSTTY_KEY_ALT_LEFT)
        #expect(GhosttyKeyMap.key(forVirtualKeyCode: UInt16(kVK_RightOption)) == GHOSTTY_KEY_ALT_RIGHT)
        #expect(GhosttyKeyMap.key(forVirtualKeyCode: 0xFFFF) == GHOSTTY_KEY_UNIDENTIFIED)
    }

    @Test("修饰位映射")
    func modsMapping() {
        #expect(GhosttyKeyMap.mods(from: []) == 0)
        #expect(GhosttyKeyMap.mods(from: [.shift]) == GhosttyKeyMap.Mod.shift)
        #expect(GhosttyKeyMap.mods(from: [.control]) == GhosttyKeyMap.Mod.ctrl)
        #expect(GhosttyKeyMap.mods(from: [.option]) == GhosttyKeyMap.Mod.alt)
        #expect(GhosttyKeyMap.mods(from: [.command]) == GhosttyKeyMap.Mod.super_)
        let both = GhosttyKeyMap.mods(from: [.shift, .control])
        #expect(both == (GhosttyKeyMap.Mod.shift | GhosttyKeyMap.Mod.ctrl))
    }
}

// MARK: - §1 编码管线（隔离终端灌 DECSET）

@MainActor
@Suite("输入链 §1 编码管线")
struct KeyEncodeTests {
    @Test("方向键：normal → CSI，application(DECCKM) → SS3")
    func arrowCursorMode() {
        let host = IsolatedTerminalHost()
        let up = AssembledKeyEvent(key: GHOSTTY_KEY_ARROW_UP)

        // 常规光标键模式：ESC [ A
        #expect(encode(up, on: host) == [0x1b, 0x5b, 0x41])

        // DECCKM 置位（application cursor keys）：ESC O A
        host.feed("\u{1b}[?1h")
        #expect(encode(up, on: host) == [0x1b, 0x4f, 0x41])

        // 复位回常规
        host.feed("\u{1b}[?1l")
        #expect(encode(up, on: host) == [0x1b, 0x5b, 0x41])
    }

    @Test("基础键：Enter / Tab / Backspace / Escape")
    func basicKeys() {
        let host = IsolatedTerminalHost()
        #expect(encode(AssembledKeyEvent(key: GHOSTTY_KEY_ENTER), on: host) == [0x0d])
        #expect(encode(AssembledKeyEvent(key: GHOSTTY_KEY_TAB), on: host) == [0x09])
        #expect(encode(AssembledKeyEvent(key: GHOSTTY_KEY_BACKSPACE), on: host) == [0x7f])
        #expect(encode(AssembledKeyEvent(key: GHOSTTY_KEY_ESCAPE), on: host) == [0x1b])
    }

    @Test("可见字符：'a' 直通，Ctrl+A → 0x01")
    func letterAndCtrl() {
        let host = IsolatedTerminalHost()
        let a = AssembledKeyEvent(key: GHOSTTY_KEY_A, utf8: "a", unshiftedCodepoint: 0x61)
        #expect(encode(a, on: host) == [0x61])

        let ctrlA = AssembledKeyEvent(key: GHOSTTY_KEY_A, mods: GhosttyKeyMap.Mod.ctrl,
                                      utf8: "a", unshiftedCodepoint: 0x61)
        #expect(encode(ctrlA, on: host) == [0x01])
    }

    @Test("裸修饰键无产出")
    func bareModifierNoOutput() {
        let host = IsolatedTerminalHost()
        let shift = AssembledKeyEvent(key: GHOSTTY_KEY_SHIFT_LEFT, mods: GhosttyKeyMap.Mod.shift)
        #expect(encode(shift, on: host).isEmpty)
    }

    @Test("handleKeyDown：有产出才回底+写；无产出不动")
    func handleKeyDownGating() {
        let host = IsolatedTerminalHost()
        let writer = RecordingWriter()
        let viewHost = RecordingHost()
        let ctrl = TerminalInputController(encoding: host, writer: writer, host: viewHost)

        #expect(ctrl.handleKeyDown(AssembledKeyEvent(key: GHOSTTY_KEY_ENTER)) == true)
        #expect(writer.written == [0x0d])
        #expect(viewHost.prepareCount == 1)

        writer.reset()
        #expect(ctrl.handleKeyDown(AssembledKeyEvent(key: GHOSTTY_KEY_SHIFT_LEFT,
                                                     mods: GhosttyKeyMap.Mod.shift)) == false)
        #expect(writer.written.isEmpty)
        #expect(viewHost.prepareCount == 1)  // 未再 prepare
    }
}

// MARK: - §2 IME

@MainActor
@Suite("输入链 §2 IME")
struct IMETests {
    private func makeController() -> (TerminalInputController, RecordingWriter, RecordingHost) {
        let host = IsolatedTerminalHost()
        let writer = RecordingWriter()
        let viewHost = RecordingHost()
        let ctrl = TerminalInputController(
            encoding: host, writer: writer, host: viewHost, cursorRectProvider: FixedCursorRect())
        return (ctrl, writer, viewHost)
    }

    @Test("组字序列：setMarkedText → insertText 全程")
    func compositionSequence() {
        let (ctrl, writer, viewHost) = makeController()
        let full = NSRange(location: 0, length: 0)

        // 组字中：preedit 存在、composing 真、未写 PTY
        ctrl.imeSetMarkedText("ni", selectedRange: NSRange(location: 2, length: 0), replacementRange: full)
        #expect(ctrl.isComposing)
        #expect(ctrl.preeditText == "ni")
        #expect(ctrl.imeMarkedRange() == NSRange(location: 0, length: 2))
        #expect(writer.written.isEmpty)

        // 提交：清 preedit + UTF-8 直写 + 回底
        ctrl.imeInsertText("你", replacementRange: full)
        #expect(!ctrl.isComposing)
        #expect(ctrl.preeditText.isEmpty)
        #expect(writer.text == "你")
        #expect(viewHost.prepareCount == 1)
    }

    @Test("unmarkText 取消组字，不写 PTY")
    func unmark() {
        let (ctrl, writer, _) = makeController()
        ctrl.imeSetMarkedText("ka", selectedRange: NSRange(location: 2, length: 0),
                              replacementRange: NSRange(location: 0, length: 0))
        #expect(ctrl.isComposing)
        ctrl.imeUnmarkText()
        #expect(!ctrl.isComposing)
        #expect(writer.written.isEmpty)
    }

    @Test("firstRect 取光标屏幕矩形")
    func firstRect() {
        let host = IsolatedTerminalHost()
        let provider = FixedCursorRect()
        let ctrl = TerminalInputController(encoding: host, writer: RecordingWriter(),
                                           cursorRectProvider: provider)
        #expect(ctrl.imeFirstRect(forCharacterRange: NSRange(location: 0, length: 0)) == provider.rect)
    }
}

// MARK: - §3 粘贴

@MainActor
@Suite("输入链 §3 粘贴")
struct PasteTests {
    @Test("安全粘贴：bracketed 关直通 / 开则包裹")
    func safePaste() {
        let host = IsolatedTerminalHost()
        let writer = RecordingWriter()
        let ctrl = TerminalInputController(encoding: host, writer: writer)

        ctrl.paste("ls")
        #expect(writer.text == "ls")

        // 开 bracketed（DEC 2004）
        writer.reset()
        host.feed("\u{1b}[?2004h")
        ctrl.paste("ls")
        #expect(writer.text == "\u{1b}[200~ls\u{1b}[201~")
    }

    @Test("不安全粘贴：确认开 → 走确认；确认后按 bracketed 两态编码")
    func unsafePasteConfirm() {
        let host = IsolatedTerminalHost()
        let writer = RecordingWriter()
        let ctrl = TerminalInputController(encoding: host, writer: writer)

        var pending: ((Bool) -> Void)?
        var askedText: String?
        ctrl.onConfirmUnsafePaste = { text, complete in askedText = text; pending = complete }

        // 含换行 = 不安全 → 弹确认、暂不写
        ctrl.paste("a\nb")
        #expect(askedText == "a\nb")
        #expect(writer.written.isEmpty)

        // 确认 → 写入（非 bracketed：换行转 CR）
        pending?(true)
        #expect(writer.text == "a\rb")
    }

    @Test("不安全粘贴：确认拒绝 → 不写")
    func unsafePasteReject() {
        let host = IsolatedTerminalHost()
        let writer = RecordingWriter()
        let ctrl = TerminalInputController(encoding: host, writer: writer)
        var pending: ((Bool) -> Void)?
        ctrl.onConfirmUnsafePaste = { _, complete in pending = complete }

        ctrl.paste("a\nb")
        pending?(false)
        #expect(writer.written.isEmpty)
    }

    @Test("不安全粘贴：确认关 → 直粘不弹")
    func unsafePasteConfirmOff() {
        let host = IsolatedTerminalHost()
        let writer = RecordingWriter()
        var cfg = TerminalInputController.Config()
        cfg.confirmUnsafePaste = false
        let ctrl = TerminalInputController(encoding: host, writer: writer, config: cfg)
        var asked = false
        ctrl.onConfirmUnsafePaste = { _, _ in asked = true }

        ctrl.paste("a\nb")
        #expect(!asked)
        #expect(writer.text == "a\rb")
    }

    @Test("bracketed 开下不安全确认后包裹 + 保留换行")
    func unsafePasteBracketed() {
        let host = IsolatedTerminalHost()
        let writer = RecordingWriter()
        let ctrl = TerminalInputController(encoding: host, writer: writer)
        host.feed("\u{1b}[?2004h")
        var pending: ((Bool) -> Void)?
        ctrl.onConfirmUnsafePaste = { _, complete in pending = complete }

        ctrl.paste("a\nb")
        pending?(true)
        // bracketed 包裹；换行在 bracketed 下保留为 \n
        #expect(writer.text == "\u{1b}[200~a\nb\u{1b}[201~")
    }
}

// MARK: - §7 焦点

@MainActor
@Suite("输入链 §7 焦点")
struct FocusTests {
    @Test("mode 1004 关：转发宿主但不编码")
    func focusModeGatedOff() {
        let host = IsolatedTerminalHost()
        let writer = RecordingWriter()
        let viewHost = RecordingHost()
        let ctrl = TerminalInputController(encoding: host, writer: writer, host: viewHost)

        ctrl.focusChanged(true)
        #expect(viewHost.focusStates == [true])   // 恒转发宿主
        #expect(writer.written.isEmpty)            // 1004 未开 → 不发
    }

    @Test("mode 1004 开：gained→CSI I、lost→CSI O")
    func focusModeOn() {
        let host = IsolatedTerminalHost()
        let writer = RecordingWriter()
        let viewHost = RecordingHost()
        let ctrl = TerminalInputController(encoding: host, writer: writer, host: viewHost)
        host.feed("\u{1b}[?1004h")

        ctrl.focusChanged(true)
        #expect(writer.written == [0x1b, 0x5b, 0x49])   // CSI I
        writer.reset()
        ctrl.focusChanged(false)
        #expect(writer.written == [0x1b, 0x5b, 0x4f])   // CSI O
        #expect(viewHost.focusStates == [true, false])
    }
}

// MARK: - §8 Cmd 截留判定

@MainActor
@Suite("输入链 §8 Cmd 截留")
struct CommandKeyTests {
    @Test("判定表穷举")
    func decisionTable() {
        // Ctrl+C（无 Cmd）恒放行进 PTY
        #expect(CommandKeyInterception.decide(command: false, key: GHOSTTY_KEY_C, hasSelection: false) == .forwardToPTY)
        #expect(CommandKeyInterception.decide(command: false, key: GHOSTTY_KEY_C, hasSelection: true) == .forwardToPTY)

        // Cmd+C：有选区才截
        #expect(CommandKeyInterception.decide(command: true, key: GHOSTTY_KEY_C, hasSelection: true) == .interceptCopy)
        #expect(CommandKeyInterception.decide(command: true, key: GHOSTTY_KEY_C, hasSelection: false) == .forwardToPTY)

        // Cmd+V / Cmd+F
        #expect(CommandKeyInterception.decide(command: true, key: GHOSTTY_KEY_V, hasSelection: false) == .interceptPaste)
        #expect(CommandKeyInterception.decide(command: true, key: GHOSTTY_KEY_F, hasSelection: false) == .interceptSearch)

        // 字号
        #expect(CommandKeyInterception.decide(command: true, key: GHOSTTY_KEY_EQUAL, hasSelection: false) == .interceptFontIncrease)
        #expect(CommandKeyInterception.decide(command: true, key: GHOSTTY_KEY_NUMPAD_ADD, hasSelection: false) == .interceptFontIncrease)
        #expect(CommandKeyInterception.decide(command: true, key: GHOSTTY_KEY_MINUS, hasSelection: false) == .interceptFontDecrease)
        #expect(CommandKeyInterception.decide(command: true, key: GHOSTTY_KEY_NUMPAD_SUBTRACT, hasSelection: false) == .interceptFontDecrease)
        #expect(CommandKeyInterception.decide(command: true, key: GHOSTTY_KEY_DIGIT_0, hasSelection: false) == .interceptFontReset)
        #expect(CommandKeyInterception.decide(command: true, key: GHOSTTY_KEY_NUMPAD_0, hasSelection: false) == .interceptFontReset)

        // 其它 Cmd 组合放行
        #expect(CommandKeyInterception.decide(command: true, key: GHOSTTY_KEY_W, hasSelection: false) == .forwardToPTY)
    }

    @Test("performCommandKey：interceptPaste 就地取剪贴板粘贴")
    func interceptPasteRunsPaste() {
        let host = IsolatedTerminalHost()
        let writer = RecordingWriter()
        let ctrl = TerminalInputController(encoding: host, writer: writer)
        ctrl.pasteboardString = { "hi" }

        let action = ctrl.performCommandKey(key: GHOSTTY_KEY_V, command: true, hasSelection: false)
        #expect(action == .interceptPaste)
        #expect(writer.text == "hi")
    }
}
