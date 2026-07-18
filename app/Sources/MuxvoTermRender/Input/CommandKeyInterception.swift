// CommandKeyInterception：Cmd 快捷键截留判定（terminal-input.md §8）。纯函数判定表——
// performKeyEquivalent 层用它决定「截给 app」还是「放行进 PTY」。绝不在此执行动作
// （复制/字号/搜索由 app 侧做，粘贴由 TerminalInputController 做）。
import CGhosttyVT

/// 一次 Cmd 组合的处置。
public enum CommandKeyAction: Equatable {
    case interceptCopy         // Cmd+C（仅有选区时）
    case interceptPaste        // Cmd+V
    case interceptFontIncrease // Cmd+`+` / Cmd+`=`
    case interceptFontDecrease // Cmd+`-`
    case interceptFontReset    // Cmd+`0`
    case interceptSearch       // Cmd+F
    case forwardToPTY          // 其余（含 Ctrl+C、无选区 Cmd+C、非清单内 Cmd 组合）
}

public enum CommandKeyInterception {
    /// 判定一次按键是否截留。
    /// - command：Cmd（SUPER）是否按下——不按 Cmd 一律 forwardToPTY（Ctrl+C 因此天然放行进 PTY）。
    /// - key：物理键（GhosttyKeyMap 产）。
    /// - hasSelection：终端当前是否有选区（仅影响 Cmd+C）。
    public static func decide(command: Bool, key: GhosttyKey, hasSelection: Bool) -> CommandKeyAction {
        // 无 Cmd → 不截。Ctrl+C（command=false）落此分支 → 放行进 PTY 作中断（§8 注）。
        guard command else { return .forwardToPTY }

        switch key {
        case GHOSTTY_KEY_C:
            // macOS 惯例 Cmd+C=复制；仅有选区才截，无选区放行（避免吞掉 TUI 的 Cmd+C）。
            return hasSelection ? .interceptCopy : .forwardToPTY
        case GHOSTTY_KEY_V:
            return .interceptPaste
        case GHOSTTY_KEY_F:
            return .interceptSearch
        case GHOSTTY_KEY_EQUAL, GHOSTTY_KEY_NUMPAD_ADD:
            // `=` 与其 Shift 态 `+` 同键；小键盘 `+` 同义 → 放大。
            return .interceptFontIncrease
        case GHOSTTY_KEY_MINUS, GHOSTTY_KEY_NUMPAD_SUBTRACT:
            return .interceptFontDecrease
        case GHOSTTY_KEY_DIGIT_0, GHOSTTY_KEY_NUMPAD_0:
            return .interceptFontReset
        default:
            return .forwardToPTY
        }
    }
}
