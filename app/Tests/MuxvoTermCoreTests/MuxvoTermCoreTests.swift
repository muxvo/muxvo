// 终端默认值合同的 7 条 spec-ID 翻牌测试（TERM_L1_09/10/16-19 + SETTINGS_L1_01）。
// oracle = TermDefaults 常量（terminal-rendering.md §4.4 / terminal-session.md §9）。
// spec-runner overlay 由主会话批末翻 owner:swift；本文件跑本地 swift test。
import Testing

@testable import MuxvoTermCore

@Suite("终端默认值合同（7 条默认 spec，TermDefaults 为权威常量）")
struct TermDefaultsSpecTests {
    @Test("TERM_L1_09: 默认字体大小 —— 首次启动 fontSize==14")
    func term_l1_09_fontSize() {
        #expect(TermDefaults.fontSize == 14)
    }

    @Test("TERM_L1_10: 默认主题 —— 首次启动 theme==\"dark\"")
    func term_l1_10_theme() {
        #expect(TermDefaults.theme == "dark")
    }

    @Test("TERM_L1_16: 默认终端主题 —— 首次启动 terminal.themeName==\"dark\"")
    func term_l1_16_terminalThemeName() {
        #expect(TermDefaults.terminalThemeName == "dark")
    }

    @Test("TERM_L1_17: 默认终端字体大小 —— terminal.fontSize==14（与顶层 fontSize 两并存 key）")
    func term_l1_17_terminalFontSize() {
        #expect(TermDefaults.terminalFontSize == 14)
        #expect(TermDefaults.fontSize == 14) // 两个 fontSize key 并存且相等
    }

    @Test("TERM_L1_18: 默认游标样式 —— terminal.cursorStyle==.block")
    func term_l1_18_cursorStyle() {
        #expect(TermDefaults.cursorStyle == .block)
        #expect(TermDefaults.cursorStyle.rawValue == "block") // legacy JSON 字符串一致
    }

    @Test("TERM_L1_19: 默认游标闪烁 —— terminal.cursorBlink==true")
    func term_l1_19_cursorBlink() {
        #expect(TermDefaults.cursorBlink == true)
    }

    @Test("SETTINGS_L1_01: startupTerminalCount 默认 —— 首次启动 ==1")
    func settings_l1_01_startupTerminalCount() {
        #expect(TermDefaults.startupTerminalCount == 1)
    }
}
