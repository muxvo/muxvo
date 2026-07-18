// 主题（Theme）+ vt terminal 默认色/光标 option 装配。
//
// 权威（terminal-rendering.md §4.2/§4.3 + 任务③）：
//   - fg/bg/cursor + 256 palette 经 GHOSTTY_TERMINAL_OPT_COLOR_{FOREGROUND,BACKGROUND,CURSOR,PALETTE}
//     设为 terminal 默认色；GHOSTTY_TERMINAL_OPT_COLOR_SCHEME 用 GHOSTTY_COLOR_SCHEME_DARK。
//   - OSC 4/10/11/12 覆盖语义由 vt 处理，渲染端只读 render state 有效色，不自己合成——本文件只
//     负责「注入初始默认色」的装配，不参与运行时取色。
//   - 默认光标 block+blink：GHOSTTY_TERMINAL_OPT_DEFAULT_CURSOR_STYLE=BLOCK / DEFAULT_CURSOR_BLINK=true。
//
// 色源裁决（任务③要求：term-grid §6 与探针取色若不全则以 xterm 标准 256 palette + legacy 背景色为准）：
//   - term-grid §6 是 UI chrome token（窗口/卡片底色），非终端 cell 色；探针渲染器只用 黑底/白字
//     缺省并从 render state 读有效色，同样不提供 palette。两处均不足以定终端配色。
//   - 故 index 0..15（ANSI 16）取 legacy xterm.js dark 主题（muxvo-legacy
//     src/shared/constants/terminal-themes.ts `dark`，VS Code Dark 同款）；index 16..255 取 xterm
//     标准 6×6×6 色立方 + 灰阶（xterm.js 自身也按此补齐前 16 之后的调色板）。裁决记于批 2③ 报告。
//
// 本文件纯 Swift（零 vendor），居 MuxvoTermCore——解开 MuxvoTermRender→MuxvoTerm 依赖死结：
// MuxvoTerm（TerminalSession.Config.theme）与 MuxvoTermRender 均依赖 MuxvoTermCore，各自消费 payload。
// 本文件只产装配 payload + 主题表，不触 C（ghostty_terminal_set 由 MuxvoTerm.TerminalSession 消费）。
import Foundation

// MARK: - vt 枚举镜像（rawValue 逐字对齐 C，批 3 桥接时零歧义）

/// 镜像 device.h `GhosttyColorScheme`（LIGHT=0 / DARK=1）。
public enum TermColorScheme: Int32, Sendable, Equatable {
    case light = 0  // GHOSTTY_COLOR_SCHEME_LIGHT
    case dark = 1   // GHOSTTY_COLOR_SCHEME_DARK
}

/// 镜像 terminal.h `GhosttyTerminalCursorStyle`（BAR=0 / BLOCK=1 / UNDERLINE=2 / BLOCK_HOLLOW=3）。
/// 注：BLOCK_HOLLOW 是渲染态（失焦空心块），不作为「默认光标样式」config 值注入。
public enum TermCursorStyle: Int32, Sendable, Equatable {
    case bar = 0          // GHOSTTY_TERMINAL_CURSOR_STYLE_BAR
    case block = 1        // GHOSTTY_TERMINAL_CURSOR_STYLE_BLOCK
    case underline = 2    // GHOSTTY_TERMINAL_CURSOR_STYLE_UNDERLINE
    case blockHollow = 3  // GHOSTTY_TERMINAL_CURSOR_STYLE_BLOCK_HOLLOW
}

// MARK: - 主题

/// 终端主题 token：默认 fg/bg/cursor + 256 色 palette。
public struct TermTheme: Sendable, Equatable {
    /// 主题名（对齐 config `terminal.themeName`，legacy 形状：dark/light/...）。
    public let name: String
    public let background: TermColorRGB
    public let foreground: TermColorRGB
    public let cursor: TermColorRGB
    /// 恰好 256 项：0..15 ANSI16 + 16..231 色立方 + 232..255 灰阶。
    public let palette: [TermColorRGB]

    public init(name: String, background: TermColorRGB, foreground: TermColorRGB,
                cursor: TermColorRGB, palette: [TermColorRGB]) {
        precondition(palette.count == 256, "terminal palette 必须恰好 256 项")
        self.name = name
        self.background = background
        self.foreground = foreground
        self.cursor = cursor
        self.palette = palette
    }

    /// 默认 dark 主题（terminal-rendering.md §4.2 默认、TERM_L1_10/L1_16）。
    /// bg/fg/cursor 与 ANSI16 取 legacy xterm.js `dark`；16..255 为 xterm 标准补齐。
    public static let dark = TermTheme(
        name: "dark",
        background: TermColorRGB(hex: 0x1E1E1E),
        foreground: TermColorRGB(hex: 0xCCCCCC),
        cursor: TermColorRGB(hex: 0xFFFFFF),
        palette: TermPalette.standard256(ansi16: TermPalette.legacyDarkAnsi16))

    // 以下四套 = M6 主题批 2.5-B 产物（terminal-theme.md §2 逐键照录 terminal-themes.ts）。
    // fg/bg/cursor + ANSI16 逐键；16..255 走同一 xterm 标准补齐（§3：256 后 240 段不随主题）。
    // cursorAccent / selectionBackground 照录不消费（§3 偏差），故 TermTheme 不含此二字段。

    /// light 主题（§2 light 列；界面亮色联动的终端配色）。
    public static let light = TermTheme(
        name: "light",
        background: TermColorRGB(hex: 0xFFFFFF),
        foreground: TermColorRGB(hex: 0x383A42),
        cursor: TermColorRGB(hex: 0x526EFF),
        palette: TermPalette.standard256(ansi16: TermPalette.lightAnsi16))

    /// monokai 主题（§2 monokai 列，花样配色）。
    public static let monokai = TermTheme(
        name: "monokai",
        background: TermColorRGB(hex: 0x272822),
        foreground: TermColorRGB(hex: 0xF8F8F2),
        cursor: TermColorRGB(hex: 0xF8F8F0),
        palette: TermPalette.standard256(ansi16: TermPalette.monokaiAnsi16))

    /// dracula 主题（§2 dracula 列，花样配色）。
    public static let dracula = TermTheme(
        name: "dracula",
        background: TermColorRGB(hex: 0x282A36),
        foreground: TermColorRGB(hex: 0xF8F8F2),
        cursor: TermColorRGB(hex: 0xF8F8F2),
        palette: TermPalette.standard256(ansi16: TermPalette.draculaAnsi16))

    /// solarized-dark 主题（§2 solarized-dark 列，花样配色；name 用 legacy 连字符键，§1/§7）。
    public static let solarizedDark = TermTheme(
        name: "solarized-dark",
        background: TermColorRGB(hex: 0x002B36),
        foreground: TermColorRGB(hex: 0x839496),
        cursor: TermColorRGB(hex: 0x93A1A1),
        palette: TermPalette.standard256(ansi16: TermPalette.solarizedDarkAnsi16))

    /// 按持久化名解析主题（§1；`config.terminal.themeName` → TermTheme）。未知/过时/损坏名一律回退
    /// `.dark`（对等 legacy `resolveTerminalTheme`：`TERMINAL_THEMES[name] ?? dark`，不崩不空屏）。
    public static func named(_ name: String) -> TermTheme {
        switch name {
        case "dark": return .dark
        case "light": return .light
        case "monokai": return .monokai
        case "dracula": return .dracula
        case "solarized-dark": return .solarizedDark
        default: return .dark
        }
    }

    /// colorScheme 应答值（§7 CSI ?996n）：**只有** `light` 报 LIGHT，其余（dark + 三套花样深色）报 DARK。
    /// 花样配色底色皆深，向自适应配色程序报 DARK 语义正确。
    public var colorScheme: TermColorScheme { name == "light" ? .light : .dark }
}

// MARK: - Palette 构造

public enum TermPalette {
    /// legacy xterm.js dark 主题 ANSI 16（black..brightWhite，顺序即 palette index 0..15）。
    public static let legacyDarkAnsi16: [TermColorRGB] = [
        TermColorRGB(hex: 0x000000),  // 0  black
        TermColorRGB(hex: 0xCD3131),  // 1  red
        TermColorRGB(hex: 0x0DBC79),  // 2  green
        TermColorRGB(hex: 0xE5E510),  // 3  yellow
        TermColorRGB(hex: 0x2472C8),  // 4  blue
        TermColorRGB(hex: 0xBC3FBC),  // 5  magenta
        TermColorRGB(hex: 0x11A8CD),  // 6  cyan
        TermColorRGB(hex: 0xE5E5E5),  // 7  white
        TermColorRGB(hex: 0x666666),  // 8  brightBlack
        TermColorRGB(hex: 0xF14C4C),  // 9  brightRed
        TermColorRGB(hex: 0x23D18B),  // 10 brightGreen
        TermColorRGB(hex: 0xF5F543),  // 11 brightYellow
        TermColorRGB(hex: 0x3B8EEA),  // 12 brightBlue
        TermColorRGB(hex: 0xD670D6),  // 13 brightMagenta
        TermColorRGB(hex: 0x29B8DB),  // 14 brightCyan
        TermColorRGB(hex: 0xFFFFFF),  // 15 brightWhite
    ]

    /// light 主题 ANSI16（terminal-theme.md §2 light 列，逐键照录）。
    public static let lightAnsi16: [TermColorRGB] = [
        TermColorRGB(hex: 0x383A42),  // 0  black
        TermColorRGB(hex: 0xE45649),  // 1  red
        TermColorRGB(hex: 0x50A14F),  // 2  green
        TermColorRGB(hex: 0xC18401),  // 3  yellow
        TermColorRGB(hex: 0x4078F2),  // 4  blue
        TermColorRGB(hex: 0xA626A4),  // 5  magenta
        TermColorRGB(hex: 0x0184BC),  // 6  cyan
        TermColorRGB(hex: 0xA0A1A7),  // 7  white
        TermColorRGB(hex: 0x4F525E),  // 8  brightBlack
        TermColorRGB(hex: 0xE06C75),  // 9  brightRed
        TermColorRGB(hex: 0x98C379),  // 10 brightGreen
        TermColorRGB(hex: 0xE5C07B),  // 11 brightYellow
        TermColorRGB(hex: 0x61AFEF),  // 12 brightBlue
        TermColorRGB(hex: 0xC678DD),  // 13 brightMagenta
        TermColorRGB(hex: 0x56B6C2),  // 14 brightCyan
        TermColorRGB(hex: 0xFFFFFF),  // 15 brightWhite
    ]

    /// monokai 主题 ANSI16（terminal-theme.md §2 monokai 列，逐键照录）。
    public static let monokaiAnsi16: [TermColorRGB] = [
        TermColorRGB(hex: 0x272822),  // 0  black
        TermColorRGB(hex: 0xF92672),  // 1  red
        TermColorRGB(hex: 0xA6E22E),  // 2  green
        TermColorRGB(hex: 0xF4BF75),  // 3  yellow
        TermColorRGB(hex: 0x66D9EF),  // 4  blue
        TermColorRGB(hex: 0xAE81FF),  // 5  magenta
        TermColorRGB(hex: 0xA1EFE4),  // 6  cyan
        TermColorRGB(hex: 0xF8F8F2),  // 7  white
        TermColorRGB(hex: 0x75715E),  // 8  brightBlack
        TermColorRGB(hex: 0xF92672),  // 9  brightRed
        TermColorRGB(hex: 0xA6E22E),  // 10 brightGreen
        TermColorRGB(hex: 0xF4BF75),  // 11 brightYellow
        TermColorRGB(hex: 0x66D9EF),  // 12 brightBlue
        TermColorRGB(hex: 0xAE81FF),  // 13 brightMagenta
        TermColorRGB(hex: 0xA1EFE4),  // 14 brightCyan
        TermColorRGB(hex: 0xF9F8F5),  // 15 brightWhite
    ]

    /// dracula 主题 ANSI16（terminal-theme.md §2 dracula 列，逐键照录）。
    public static let draculaAnsi16: [TermColorRGB] = [
        TermColorRGB(hex: 0x21222C),  // 0  black
        TermColorRGB(hex: 0xFF5555),  // 1  red
        TermColorRGB(hex: 0x50FA7B),  // 2  green
        TermColorRGB(hex: 0xF1FA8C),  // 3  yellow
        TermColorRGB(hex: 0xBD93F9),  // 4  blue
        TermColorRGB(hex: 0xFF79C6),  // 5  magenta
        TermColorRGB(hex: 0x8BE9FD),  // 6  cyan
        TermColorRGB(hex: 0xF8F8F2),  // 7  white
        TermColorRGB(hex: 0x6272A4),  // 8  brightBlack
        TermColorRGB(hex: 0xFF6E6E),  // 9  brightRed
        TermColorRGB(hex: 0x69FF94),  // 10 brightGreen
        TermColorRGB(hex: 0xFFFFA5),  // 11 brightYellow
        TermColorRGB(hex: 0xD6ACFF),  // 12 brightBlue
        TermColorRGB(hex: 0xFF92DF),  // 13 brightMagenta
        TermColorRGB(hex: 0xA4FFFF),  // 14 brightCyan
        TermColorRGB(hex: 0xFFFFFF),  // 15 brightWhite
    ]

    /// solarized-dark 主题 ANSI16（terminal-theme.md §2 solarized-dark 列，逐键照录）。
    /// brightGreen(10)==brightBlack(8)==#586E75、brightBlue(12)==foreground(#839496) 系官方
    /// Solarized 灰阶设计（base01/base0），**非笔误**——逐键照录不纠正（§2 表下注记）。
    public static let solarizedDarkAnsi16: [TermColorRGB] = [
        TermColorRGB(hex: 0x073642),  // 0  black
        TermColorRGB(hex: 0xDC322F),  // 1  red
        TermColorRGB(hex: 0x859900),  // 2  green
        TermColorRGB(hex: 0xB58900),  // 3  yellow
        TermColorRGB(hex: 0x268BD2),  // 4  blue
        TermColorRGB(hex: 0xD33682),  // 5  magenta
        TermColorRGB(hex: 0x2AA198),  // 6  cyan
        TermColorRGB(hex: 0xEEE8D5),  // 7  white
        TermColorRGB(hex: 0x586E75),  // 8  brightBlack
        TermColorRGB(hex: 0xCB4B16),  // 9  brightRed
        TermColorRGB(hex: 0x586E75),  // 10 brightGreen（==brightBlack，官方灰阶非笔误）
        TermColorRGB(hex: 0x657B83),  // 11 brightYellow
        TermColorRGB(hex: 0x839496),  // 12 brightBlue（==foreground，官方灰阶非笔误）
        TermColorRGB(hex: 0x6C71C4),  // 13 brightMagenta
        TermColorRGB(hex: 0x93A1A1),  // 14 brightCyan
        TermColorRGB(hex: 0xFDF6E3),  // 15 brightWhite
    ]

    /// xterm 标准色立方每通道 6 档取值。
    private static let cubeLevels: [UInt8] = [0, 95, 135, 175, 215, 255]

    /// 拼装 256 palette：给定前 16（ANSI16），后 240 用 xterm 标准 6×6×6 立方 + 24 级灰阶补齐。
    public static func standard256(ansi16: [TermColorRGB]) -> [TermColorRGB] {
        precondition(ansi16.count == 16, "ANSI16 必须恰好 16 项")
        var p = ansi16
        p.reserveCapacity(256)
        // 16..231：6×6×6 色立方
        for n in 0..<216 {
            let r = cubeLevels[(n / 36) % 6]
            let g = cubeLevels[(n / 6) % 6]
            let b = cubeLevels[n % 6]
            p.append(TermColorRGB(r: r, g: g, b: b))
        }
        // 232..255：24 级灰阶（8, 18, …, 238）
        for i in 0..<24 {
            let v = UInt8(8 + i * 10)
            p.append(TermColorRGB(r: v, g: v, b: v))
        }
        return p
    }
}

// MARK: - vt option 装配 payload

/// terminal 默认色装配结果。批 3 建会话时逐项喂 `ghostty_terminal_set`：
///   foreground → GHOSTTY_TERMINAL_OPT_COLOR_FOREGROUND（&GhosttyColorRgb）
///   background → GHOSTTY_TERMINAL_OPT_COLOR_BACKGROUND
///   cursor     → GHOSTTY_TERMINAL_OPT_COLOR_CURSOR
///   palette    → GHOSTTY_TERMINAL_OPT_COLOR_PALETTE（&GhosttyColorRgb[256]）
///   colorScheme→ GHOSTTY_TERMINAL_OPT_COLOR_SCHEME 回调应答值
public struct TerminalColorOptions: Sendable, Equatable {
    public let foreground: TermColorRGB
    public let background: TermColorRGB
    public let cursor: TermColorRGB
    public let palette: [TermColorRGB]
    public let colorScheme: TermColorScheme

    public init(foreground: TermColorRGB, background: TermColorRGB, cursor: TermColorRGB,
                palette: [TermColorRGB], colorScheme: TermColorScheme) {
        self.foreground = foreground
        self.background = background
        self.cursor = cursor
        self.palette = palette
        self.colorScheme = colorScheme
    }
}

/// 默认光标装配结果：
///   defaultStyle → GHOSTTY_TERMINAL_OPT_DEFAULT_CURSOR_STYLE（&GhosttyTerminalCursorStyle）
///   defaultBlink → GHOSTTY_TERMINAL_OPT_DEFAULT_CURSOR_BLINK（&bool）
public struct TerminalCursorOptions: Sendable, Equatable {
    public let defaultStyle: TermCursorStyle
    public let defaultBlink: Bool

    public init(defaultStyle: TermCursorStyle, defaultBlink: Bool) {
        self.defaultStyle = defaultStyle
        self.defaultBlink = defaultBlink
    }
}

extension TermTheme {
    /// 装配终端默认色 option（TerminalSession init/applyTheme 消费）。colorScheme 由主题名派生
    /// （§7：只有 light 报 LIGHT，其余报 DARK）——996 应答存量 scheme 即取此值。
    public func makeColorOptions() -> TerminalColorOptions {
        TerminalColorOptions(
            foreground: foreground,
            background: background,
            cursor: cursor,
            palette: palette,
            colorScheme: colorScheme)
    }
}
