// 终端默认配置常量集（vendor-free 唯一权威）。
//
// 权威：terminal-rendering.md §4.4 默认值合同 + terminal-session.md §9。承接 7 条默认 spec：
//   TERM_L1_09 fontSize==14（顶层）        TERM_L1_10 theme=="dark"（顶层）
//   TERM_L1_16 terminal.themeName=="dark"  TERM_L1_17 terminal.fontSize==14（与顶层 fontSize 并存）
//   TERM_L1_18 cursorStyle==.block         TERM_L1_19 cursorBlink==true
//   SETTINGS_L1_01 startupTerminalCount==1
//
// 注：MuxvoStorage 与本模块互不依赖（Package 依赖图 sibling），故 MuxvoStorage.MuxvoConfig 的
// 默认值以同源 spec §4.4 独立落等值字面量（无法 import 本常量）；两处一致性由各自单测各自守
// （本模块 7 条 spec-ID 测 + ConfigStore 侧默认支撑测）。本文件是 spec §4.4 的权威常量家。

public enum TermDefaults {
    /// 顶层 fontSize（TERM_L1_09）。与 terminalFontSize 两并存 key（legacy 形状）。
    public static let fontSize = 14

    /// 顶层 theme（TERM_L1_10）。注：legacy config.ts DEFAULT_CONFIG 曾为 'light'，但 spec
    /// oracle（冻结）为 'dark'，与 legacy defaults.ts getDefaultConfig 一致——取 spec 'dark'。
    public static let theme = "dark"

    /// terminal.themeName（TERM_L1_16）。同上 spec oracle 取 'dark'。
    public static let terminalThemeName = "dark"

    /// terminal.fontSize（TERM_L1_17）。与顶层 fontSize 并存。
    public static let terminalFontSize = 14

    /// terminal.cursorStyle（TERM_L1_18）。
    public static let cursorStyle: CursorStyle = .block

    /// terminal.cursorBlink（TERM_L1_19）。
    public static let cursorBlink = true

    /// 启动自动创建终端数（SETTINGS_L1_01）。legacy 夹取 1...20（SettingsModal.tsx:28）。
    public static let startupTerminalCount = 1
}

/// 终端光标样式（config 可设值，legacy TerminalCursorStyle：block/underline/bar）。
/// rawValue 逐字对齐 legacy JSON（'block' 等），供 ConfigStore 侧字符串互转与断言一致。
/// 注：BLOCK_HOLLOW（失焦空心块）是渲染态，不入此 config 枚举（terminal-rendering.md §4.3 偏差①）。
public enum CursorStyle: String, CaseIterable, Sendable, Equatable, Codable {
    case block
    case underline
    case bar
}
