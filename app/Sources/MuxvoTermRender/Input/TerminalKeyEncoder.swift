// TerminalKeyEncoder：包裹 libghostty `ghostty_key_encoder_*`，把一次按键（AssembledKeyEvent）
// 依活终端 modes 编成终端转义字节（terminal-input.md §1「用 vt C API」列）。
//
// 线程契约（@unchecked Sendable）：编码器句柄单线程不变量。本类方法只在 TerminalKeyEncoding
// .withTerminal 闭包内（会话 queue 互斥）或测试线程上调用，与 vt feed 串行。encode 里
// setopt_from_terminal 读活终端状态，必须与 feed 互斥 —— 这正是收敛到 withTerminal 的原因。
import CGhosttyVT

/// 平台无关的一次按键装配结果，直接喂 vt 编码器。刻意不含 NSEvent，让编码管线可确定性测试
/// （测试直接构 AssembledKeyEvent → 编码 → 断言字节，不依赖键盘布局）。NSEvent → 此结构见
/// KeyEventAssembler。
public struct AssembledKeyEvent {
    /// press / release / repeat（默认 press）。
    public var action: GhosttyKeyAction
    /// 物理键（GhosttyKeyMap 产）。
    public var key: GhosttyKey
    /// 修饰位掩码（GhosttyMods）。
    public var mods: GhosttyMods
    /// 已被布局消费、不应再被编码成修饰转义的修饰位（如 Shift 已体现在 utf8 里）。
    public var consumedMods: GhosttyMods
    /// 本键产的 UTF-8 文本（Ctrl/Meta 变换之前的字符）；无文本 / 控制键 → nil。
    /// 禁含 C0（U+0000–001F、U+007F）与 macOS 功能键 PUA（U+F700–F8FF）——由装配侧过滤。
    public var utf8: String?
    /// 未加 Shift 的 Unicode 码点（0 = 无）。
    public var unshiftedCodepoint: UInt32
    /// 是否处于 IME 组字中（true → 抑制转义编码，§2）。
    public var composing: Bool

    public init(action: GhosttyKeyAction = GHOSTTY_KEY_ACTION_PRESS,
                key: GhosttyKey,
                mods: GhosttyMods = 0,
                consumedMods: GhosttyMods = 0,
                utf8: String? = nil,
                unshiftedCodepoint: UInt32 = 0,
                composing: Bool = false) {
        self.action = action
        self.key = key
        self.mods = mods
        self.consumedMods = consumedMods
        self.utf8 = utf8
        self.unshiftedCodepoint = unshiftedCodepoint
        self.composing = composing
    }
}

public final class TerminalKeyEncoder: @unchecked Sendable {
    private var encoder: GhosttyKeyEncoder?
    private var event: GhosttyKeyEvent?

    public init() {
        var enc: GhosttyKeyEncoder?
        if ghostty_key_encoder_new(nil, &enc) == GHOSTTY_SUCCESS { encoder = enc }
        var ev: GhosttyKeyEvent?
        if ghostty_key_event_new(nil, &ev) == GHOSTTY_SUCCESS { event = ev }
    }

    deinit {
        if let event { ghostty_key_event_free(event) }
        if let encoder { ghostty_key_encoder_free(encoder) }
    }

    /// 依活终端 modes 编码一次按键 → 终端字节。无产出（如裸修饰键）→ 空数组。
    ///
    /// - terminal：活会话的终端句柄（withTerminal 交付）。
    /// - optionAsAlt：macOS Option 是否当 Alt。注意 setopt_from_terminal 会把此项重置为
    ///   FALSE（modes 里无此信息，见 encoder.h），故其后必须重新 setopt。
    public func encode(_ e: AssembledKeyEvent,
                       terminal: OpaquePointer,
                       optionAsAlt: GhosttyOptionAsAlt) -> [UInt8] {
        guard let encoder, let event else { return [] }

        // 1) 每击同步终端 modes（cursor-key application / keypad / modifyOtherKeys / kitty…）。
        ghostty_key_encoder_setopt_from_terminal(encoder, terminal)
        // 2) 重装 option-as-alt（被上一步重置）。
        var oaa = optionAsAlt
        ghostty_key_encoder_setopt(encoder, GHOSTTY_KEY_ENCODER_OPT_MACOS_OPTION_AS_ALT, &oaa)

        // 3) 装配事件字段。
        ghostty_key_event_set_action(event, e.action)
        ghostty_key_event_set_key(event, e.key)
        ghostty_key_event_set_mods(event, e.mods)
        ghostty_key_event_set_consumed_mods(event, e.consumedMods)
        ghostty_key_event_set_composing(event, e.composing)
        ghostty_key_event_set_unshifted_codepoint(event, e.unshiftedCodepoint)

        // 4) utf8 指针须在 set_utf8→encode 全程存活 → 在同一闭包内完成 set+encode。
        return withOptionalUTF8(e.utf8) { ptr, len in
            ghostty_key_event_set_utf8(event, ptr, len)
            return encodeCurrentEvent(encoder, event)
        }
    }

    private func encodeCurrentEvent(_ encoder: GhosttyKeyEncoder, _ event: GhosttyKeyEvent) -> [UInt8] {
        func run(_ cap: Int) -> (GhosttyResult, [CChar], Int) {
            var buf = [CChar](repeating: 0, count: cap)
            var written = 0
            let rc = buf.withUnsafeMutableBufferPointer { p in
                ghostty_key_encoder_encode(encoder, event, p.baseAddress, p.count, &written)
            }
            return (rc, buf, written)
        }
        var (rc, buf, written) = run(128)
        if rc == GHOSTTY_OUT_OF_SPACE, written > 0 { (rc, buf, written) = run(written) }
        guard rc == GHOSTTY_SUCCESS, written > 0 else { return [] }
        return buf[0..<written].map { UInt8(bitPattern: $0) }
    }

    /// 把可选 String 借成 (const char* , len)，闭包期间指针有效；nil / 空串 → (nil, 0)。
    private func withOptionalUTF8<R>(_ s: String?, _ body: (UnsafePointer<CChar>?, Int) -> R) -> R {
        guard let s, !s.isEmpty else { return body(nil, 0) }
        var bytes = Array(s.utf8).map { CChar(bitPattern: $0) }
        return bytes.withUnsafeBufferPointer { p in body(p.baseAddress, p.count) }
    }
}
