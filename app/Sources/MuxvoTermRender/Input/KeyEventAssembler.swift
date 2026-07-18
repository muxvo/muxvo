// KeyEventAssembler：NSEvent → AssembledKeyEvent 装配（terminal-input.md §1「自己写」列）。
//
// 产字用 UCKeyTranslate（活键盘布局，物理键码 → 布局字符），而非直接吃 NSEvent.characters
// ——因为 characters 已把 Ctrl/Cmd 变换烤进去（Ctrl+A→\x01），违反 encoder「utf8 须为
// Ctrl/Meta 变换之前的字符」契约。故：
//   - unshiftedCodepoint = UCKeyTranslate(无修饰)
//   - utf8              = UCKeyTranslate(仅 Shift + 组字态 Option) 之结果，过滤 C0/PUA
//   - consumedMods      = 已施于 utf8 的修饰位（Shift、Option 当非 alt 时）
//   - Ctrl/Cmd 一律不入产字（交 encoder 依 key+mods 施加）
import AppKit
import Carbon.HIToolbox
import CGhosttyVT

public enum KeyEventAssembler {
    /// 把 NSEvent（keyDown/keyUp）装配成 AssembledKeyEvent。
    /// - optionAsAlt：Option 是否当 Alt。TRUE/LEFT/RIGHT → Option 不参与产字（留给 encoder 当修饰）；
    ///   FALSE → Option 参与产字（é 等），并计入 consumedMods。
    /// - composing：调用方（IME 组字中）传 true → 抑制转义编码。
    public static func assemble(_ event: NSEvent,
                                optionAsAlt: GhosttyOptionAsAlt,
                                composing: Bool = false) -> AssembledKeyEvent {
        let vk = event.keyCode
        let flags = event.modifierFlags
        let key = GhosttyKeyMap.key(forVirtualKeyCode: vk)
        let mods = GhosttyKeyMap.mods(from: flags)

        let action: GhosttyKeyAction = {
            switch event.type {
            case .keyUp: return GHOSTTY_KEY_ACTION_RELEASE
            default: return event.isARepeat ? GHOSTTY_KEY_ACTION_REPEAT : GHOSTTY_KEY_ACTION_PRESS
            }
        }()

        // 无修饰码点（供 encoder 做 Ctrl 数学等）。
        let unshifted = translate(vk, carbonModifiers: 0).unicodeScalars.first?.value ?? 0

        // 产字修饰：Shift 恒计；Option 仅在「不当 alt」时计。
        let shiftDown = flags.contains(.shift)
        let optionDown = flags.contains(.option)
        let optionComposes = optionDown && (optionAsAlt == GHOSTTY_OPTION_AS_ALT_FALSE)
        var carbonMods: Int = 0
        if shiftDown { carbonMods |= shiftKey }
        if optionComposes { carbonMods |= optionKey }

        let produced = translate(vk, carbonModifiers: carbonMods)
        let text = isTextProducing(produced) ? produced : nil

        // consumedMods = 已体现在 utf8 里的修饰（避免 encoder 重复编码）。
        var consumed: GhosttyMods = 0
        if text != nil {
            if shiftDown { consumed |= GhosttyKeyMap.Mod.shift }
            if optionComposes { consumed |= GhosttyKeyMap.Mod.alt }
        }

        return AssembledKeyEvent(
            action: action, key: key, mods: mods, consumedMods: consumed,
            utf8: text, unshiftedCodepoint: unshifted, composing: composing)
    }

    /// 文本产出判据：非空且不含 C0（<0x20 / 0x7f）与 macOS 功能键 PUA（U+F700–F8FF）。
    /// 方向键/功能键经 UCKeyTranslate 多为空或 PUA → 判为非文本 → utf8=nil（交 encoder 依 key 编码）。
    static func isTextProducing(_ s: String) -> Bool {
        guard !s.isEmpty else { return false }
        for scalar in s.unicodeScalars {
            let v = scalar.value
            if v < 0x20 || v == 0x7f { return false }
            if (0xF700...0xF8FF).contains(v) { return false }
        }
        return true
    }

    /// UCKeyTranslate 封装：物理键码 + Carbon 修饰掩码 → 布局字符（NoDeadKeys，取基础字符）。
    /// 布局数据不可用时回退 charactersIgnoringModifiers（近似）。
    static func translate(_ virtualKeyCode: UInt16, carbonModifiers: Int) -> String {
        guard let source = TISCopyCurrentKeyboardLayoutInputSource()?.takeRetainedValue(),
              let raw = TISGetInputSourceProperty(source, kTISPropertyUnicodeKeyLayoutData)
        else { return "" }
        let layoutData = Unmanaged<CFData>.fromOpaque(raw).takeUnretainedValue() as Data

        let modifierKeyState = UInt32((carbonModifiers >> 8) & 0xFF)
        var deadKeyState: UInt32 = 0
        var chars = [UniChar](repeating: 0, count: 8)
        var length = 0

        let status = layoutData.withUnsafeBytes { rawBuf -> OSStatus in
            guard let base = rawBuf.baseAddress else { return OSStatus(paramErr) }
            let layout = base.assumingMemoryBound(to: UCKeyboardLayout.self)
            return UCKeyTranslate(
                layout, virtualKeyCode, UInt16(kUCKeyActionDown), modifierKeyState,
                UInt32(LMGetKbdType()), OptionBits(kUCKeyTranslateNoDeadKeysBit),
                &deadKeyState, chars.count, &length, &chars)
        }
        guard status == noErr, length > 0 else { return "" }
        return String(utf16CodeUnits: chars, count: length)
    }
}
