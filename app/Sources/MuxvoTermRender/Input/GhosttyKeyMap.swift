// GhosttyKeyMap：macOS 物理键码（Carbon kVK_*，= NSEvent.keyCode）→ GhosttyKey 映射表，
// 及 NSEvent 修饰位 → GhosttyMods 位掩码（terminal-input.md §1「自己写」列）。
//
// GhosttyKey 是 W3C UI Events code（物理键、布局无关）；kVK_* 亦为物理键码，故此表是
// 纯物理→物理映射，不涉及布局产字（产字走 KeyEventAssembler 的 UCKeyTranslate）。
// 键码常量一律用 Carbon kVK_*，不硬编码魔数（自证来源 = HIToolbox/Events.h）。
import AppKit
import Carbon.HIToolbox
import CGhosttyVT

public enum GhosttyKeyMap {
    /// virtualKeyCode（UInt16）→ GhosttyKey。查不到 → GHOSTTY_KEY_UNIDENTIFIED（仍可走 utf8 直写）。
    public static func key(forVirtualKeyCode code: UInt16) -> GhosttyKey {
        table[code] ?? GHOSTTY_KEY_UNIDENTIFIED
    }

    /// NSEvent.modifierFlags → GhosttyMods 位掩码（event.h §Modifier：SHIFT/CTRL/ALT/SUPER/CAPS）。
    /// 左右 side 位不在此填（NSEvent 通用 flags 不带 side，缺省 0=left，encoder 容忍）。
    public static func mods(from flags: NSEvent.ModifierFlags) -> GhosttyMods {
        var m: GhosttyMods = 0
        if flags.contains(.shift) { m |= Mod.shift }
        if flags.contains(.control) { m |= Mod.ctrl }
        if flags.contains(.option) { m |= Mod.alt }
        if flags.contains(.command) { m |= Mod.super_ }
        if flags.contains(.capsLock) { m |= Mod.capsLock }
        return m
    }

    /// GhosttyMods 位常量（event.h 亲验位序：SHIFT<<0 CTRL<<1 ALT<<2 SUPER<<3 CAPS<<4 NUM<<5）。
    /// 直用位序而非 import C 宏：`#define GHOSTTY_MODS_SHIFT (1<<0)` 简单宏虽可导入但类型不稳，
    /// 位序是协议级稳定契约，就地镜像 + 引注更清晰。
    public enum Mod {
        public static let shift: GhosttyMods = 1 << 0
        public static let ctrl: GhosttyMods = 1 << 1
        public static let alt: GhosttyMods = 1 << 2
        public static let super_: GhosttyMods = 1 << 3
        public static let capsLock: GhosttyMods = 1 << 4
        public static let numLock: GhosttyMods = 1 << 5
    }

    /// 物理键码全表（~100 项，覆盖主键区/功能键/小键盘/方向/导航/修饰/JIS/音量）。
    static let table: [UInt16: GhosttyKey] = {
        var t: [UInt16: GhosttyKey] = [:]
        func put(_ vk: Int, _ k: GhosttyKey) { t[UInt16(vk)] = k }

        // 字母（Writing System Keys）
        put(kVK_ANSI_A, GHOSTTY_KEY_A); put(kVK_ANSI_B, GHOSTTY_KEY_B); put(kVK_ANSI_C, GHOSTTY_KEY_C)
        put(kVK_ANSI_D, GHOSTTY_KEY_D); put(kVK_ANSI_E, GHOSTTY_KEY_E); put(kVK_ANSI_F, GHOSTTY_KEY_F)
        put(kVK_ANSI_G, GHOSTTY_KEY_G); put(kVK_ANSI_H, GHOSTTY_KEY_H); put(kVK_ANSI_I, GHOSTTY_KEY_I)
        put(kVK_ANSI_J, GHOSTTY_KEY_J); put(kVK_ANSI_K, GHOSTTY_KEY_K); put(kVK_ANSI_L, GHOSTTY_KEY_L)
        put(kVK_ANSI_M, GHOSTTY_KEY_M); put(kVK_ANSI_N, GHOSTTY_KEY_N); put(kVK_ANSI_O, GHOSTTY_KEY_O)
        put(kVK_ANSI_P, GHOSTTY_KEY_P); put(kVK_ANSI_Q, GHOSTTY_KEY_Q); put(kVK_ANSI_R, GHOSTTY_KEY_R)
        put(kVK_ANSI_S, GHOSTTY_KEY_S); put(kVK_ANSI_T, GHOSTTY_KEY_T); put(kVK_ANSI_U, GHOSTTY_KEY_U)
        put(kVK_ANSI_V, GHOSTTY_KEY_V); put(kVK_ANSI_W, GHOSTTY_KEY_W); put(kVK_ANSI_X, GHOSTTY_KEY_X)
        put(kVK_ANSI_Y, GHOSTTY_KEY_Y); put(kVK_ANSI_Z, GHOSTTY_KEY_Z)

        // 数字主键区
        put(kVK_ANSI_0, GHOSTTY_KEY_DIGIT_0); put(kVK_ANSI_1, GHOSTTY_KEY_DIGIT_1)
        put(kVK_ANSI_2, GHOSTTY_KEY_DIGIT_2); put(kVK_ANSI_3, GHOSTTY_KEY_DIGIT_3)
        put(kVK_ANSI_4, GHOSTTY_KEY_DIGIT_4); put(kVK_ANSI_5, GHOSTTY_KEY_DIGIT_5)
        put(kVK_ANSI_6, GHOSTTY_KEY_DIGIT_6); put(kVK_ANSI_7, GHOSTTY_KEY_DIGIT_7)
        put(kVK_ANSI_8, GHOSTTY_KEY_DIGIT_8); put(kVK_ANSI_9, GHOSTTY_KEY_DIGIT_9)

        // 标点 / 符号
        put(kVK_ANSI_Equal, GHOSTTY_KEY_EQUAL); put(kVK_ANSI_Minus, GHOSTTY_KEY_MINUS)
        put(kVK_ANSI_LeftBracket, GHOSTTY_KEY_BRACKET_LEFT); put(kVK_ANSI_RightBracket, GHOSTTY_KEY_BRACKET_RIGHT)
        put(kVK_ANSI_Backslash, GHOSTTY_KEY_BACKSLASH); put(kVK_ANSI_Semicolon, GHOSTTY_KEY_SEMICOLON)
        put(kVK_ANSI_Quote, GHOSTTY_KEY_QUOTE); put(kVK_ANSI_Comma, GHOSTTY_KEY_COMMA)
        put(kVK_ANSI_Period, GHOSTTY_KEY_PERIOD); put(kVK_ANSI_Slash, GHOSTTY_KEY_SLASH)
        put(kVK_ANSI_Grave, GHOSTTY_KEY_BACKQUOTE)
        put(kVK_ISO_Section, GHOSTTY_KEY_INTL_BACKSLASH)

        // 功能键区（Functional Keys）
        put(kVK_Return, GHOSTTY_KEY_ENTER); put(kVK_Tab, GHOSTTY_KEY_TAB)
        put(kVK_Space, GHOSTTY_KEY_SPACE); put(kVK_Delete, GHOSTTY_KEY_BACKSPACE)   // 0x33 = Backspace
        put(kVK_Escape, GHOSTTY_KEY_ESCAPE); put(kVK_ForwardDelete, GHOSTTY_KEY_DELETE) // 0x75 = Del

        // 修饰键（左右分辨）
        put(kVK_Command, GHOSTTY_KEY_META_LEFT); put(kVK_RightCommand, GHOSTTY_KEY_META_RIGHT)
        put(kVK_Shift, GHOSTTY_KEY_SHIFT_LEFT); put(kVK_RightShift, GHOSTTY_KEY_SHIFT_RIGHT)
        put(kVK_Option, GHOSTTY_KEY_ALT_LEFT); put(kVK_RightOption, GHOSTTY_KEY_ALT_RIGHT)
        put(kVK_Control, GHOSTTY_KEY_CONTROL_LEFT); put(kVK_RightControl, GHOSTTY_KEY_CONTROL_RIGHT)
        put(kVK_CapsLock, GHOSTTY_KEY_CAPS_LOCK); put(kVK_Function, GHOSTTY_KEY_FN)

        // 控制垫 / 方向垫（导航）
        put(kVK_Home, GHOSTTY_KEY_HOME); put(kVK_End, GHOSTTY_KEY_END)
        put(kVK_PageUp, GHOSTTY_KEY_PAGE_UP); put(kVK_PageDown, GHOSTTY_KEY_PAGE_DOWN)
        put(kVK_Help, GHOSTTY_KEY_INSERT)  // 0x72：Apple「Help」键位 = PC Insert 语义（TUI 期望）
        put(kVK_LeftArrow, GHOSTTY_KEY_ARROW_LEFT); put(kVK_RightArrow, GHOSTTY_KEY_ARROW_RIGHT)
        put(kVK_DownArrow, GHOSTTY_KEY_ARROW_DOWN); put(kVK_UpArrow, GHOSTTY_KEY_ARROW_UP)

        // 功能键 F1–F20
        put(kVK_F1, GHOSTTY_KEY_F1); put(kVK_F2, GHOSTTY_KEY_F2); put(kVK_F3, GHOSTTY_KEY_F3)
        put(kVK_F4, GHOSTTY_KEY_F4); put(kVK_F5, GHOSTTY_KEY_F5); put(kVK_F6, GHOSTTY_KEY_F6)
        put(kVK_F7, GHOSTTY_KEY_F7); put(kVK_F8, GHOSTTY_KEY_F8); put(kVK_F9, GHOSTTY_KEY_F9)
        put(kVK_F10, GHOSTTY_KEY_F10); put(kVK_F11, GHOSTTY_KEY_F11); put(kVK_F12, GHOSTTY_KEY_F12)
        put(kVK_F13, GHOSTTY_KEY_F13); put(kVK_F14, GHOSTTY_KEY_F14); put(kVK_F15, GHOSTTY_KEY_F15)
        put(kVK_F16, GHOSTTY_KEY_F16); put(kVK_F17, GHOSTTY_KEY_F17); put(kVK_F18, GHOSTTY_KEY_F18)
        put(kVK_F19, GHOSTTY_KEY_F19); put(kVK_F20, GHOSTTY_KEY_F20)

        // 小键盘（Numpad）
        put(kVK_ANSI_Keypad0, GHOSTTY_KEY_NUMPAD_0); put(kVK_ANSI_Keypad1, GHOSTTY_KEY_NUMPAD_1)
        put(kVK_ANSI_Keypad2, GHOSTTY_KEY_NUMPAD_2); put(kVK_ANSI_Keypad3, GHOSTTY_KEY_NUMPAD_3)
        put(kVK_ANSI_Keypad4, GHOSTTY_KEY_NUMPAD_4); put(kVK_ANSI_Keypad5, GHOSTTY_KEY_NUMPAD_5)
        put(kVK_ANSI_Keypad6, GHOSTTY_KEY_NUMPAD_6); put(kVK_ANSI_Keypad7, GHOSTTY_KEY_NUMPAD_7)
        put(kVK_ANSI_Keypad8, GHOSTTY_KEY_NUMPAD_8); put(kVK_ANSI_Keypad9, GHOSTTY_KEY_NUMPAD_9)
        put(kVK_ANSI_KeypadDecimal, GHOSTTY_KEY_NUMPAD_DECIMAL)
        put(kVK_ANSI_KeypadMultiply, GHOSTTY_KEY_NUMPAD_MULTIPLY)
        put(kVK_ANSI_KeypadPlus, GHOSTTY_KEY_NUMPAD_ADD)
        put(kVK_ANSI_KeypadMinus, GHOSTTY_KEY_NUMPAD_SUBTRACT)
        put(kVK_ANSI_KeypadDivide, GHOSTTY_KEY_NUMPAD_DIVIDE)
        put(kVK_ANSI_KeypadEnter, GHOSTTY_KEY_NUMPAD_ENTER)
        put(kVK_ANSI_KeypadEquals, GHOSTTY_KEY_NUMPAD_EQUAL)
        put(kVK_ANSI_KeypadClear, GHOSTTY_KEY_NUMPAD_CLEAR)   // mac Clear（≈ PC NumLock 键位）
        put(kVK_JIS_KeypadComma, GHOSTTY_KEY_NUMPAD_COMMA)

        // JIS
        put(kVK_JIS_Yen, GHOSTTY_KEY_INTL_YEN); put(kVK_JIS_Underscore, GHOSTTY_KEY_INTL_RO)
        put(kVK_JIS_Kana, GHOSTTY_KEY_KANA_MODE)

        // 音量媒体键
        put(kVK_VolumeUp, GHOSTTY_KEY_AUDIO_VOLUME_UP)
        put(kVK_VolumeDown, GHOSTTY_KEY_AUDIO_VOLUME_DOWN)
        put(kVK_Mute, GHOSTTY_KEY_AUDIO_VOLUME_MUTE)

        return t
    }()
}
