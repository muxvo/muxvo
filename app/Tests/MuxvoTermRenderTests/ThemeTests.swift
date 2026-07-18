// Theme / palette / vt option 装配测试（纯逻辑，无 GPU）。
import Testing
@testable import MuxvoTermRender
import MuxvoTermCore

@Suite("Theme + vt option 装配")
struct ThemeTests {
    @Test("dark 主题默认 fg/bg/cursor（legacy xterm.js dark）")
    func darkThemeColors() {
        let t = TermTheme.dark
        #expect(t.name == "dark")
        #expect(t.background == TermColorRGB(hex: 0x1E1E1E))
        #expect(t.foreground == TermColorRGB(hex: 0xCCCCCC))
        #expect(t.cursor == TermColorRGB(hex: 0xFFFFFF))
    }

    @Test("palette 恰好 256 项")
    func paletteCount() {
        #expect(TermTheme.dark.palette.count == 256)
    }

    @Test("palette 0..15 = legacy dark ANSI16")
    func ansi16FromLegacy() {
        let p = TermTheme.dark.palette
        #expect(p[0] == TermColorRGB(hex: 0x000000))   // black
        #expect(p[1] == TermColorRGB(hex: 0xCD3131))   // red
        #expect(p[2] == TermColorRGB(hex: 0x0DBC79))   // green
        #expect(p[7] == TermColorRGB(hex: 0xE5E5E5))   // white
        #expect(p[8] == TermColorRGB(hex: 0x666666))   // brightBlack
        #expect(p[15] == TermColorRGB(hex: 0xFFFFFF))  // brightWhite
    }

    @Test("palette 16..231 = xterm 标准 6×6×6 色立方")
    func cube() {
        let p = TermTheme.dark.palette
        #expect(p[16] == TermColorRGB(r: 0, g: 0, b: 0))         // cube 起点
        #expect(p[231] == TermColorRGB(r: 255, g: 255, b: 255))  // cube 终点
        // index 196 = n=180 → r=5,g=0,b=0 → (255,0,0)
        #expect(p[196] == TermColorRGB(r: 255, g: 0, b: 0))
        // index 21 = n=5 → r=0,g=0,b=5 → (0,0,255)
        #expect(p[21] == TermColorRGB(r: 0, g: 0, b: 255))
    }

    @Test("palette 232..255 = xterm 标准 24 级灰阶")
    func grayscale() {
        let p = TermTheme.dark.palette
        #expect(p[232] == TermColorRGB(r: 8, g: 8, b: 8))
        #expect(p[255] == TermColorRGB(r: 238, g: 238, b: 238))
    }

    @Test("makeColorOptions 装配默认色 + dark scheme")
    func colorOptions() {
        let opts = TermTheme.dark.makeColorOptions()
        #expect(opts.background == TermColorRGB(hex: 0x1E1E1E))
        #expect(opts.foreground == TermColorRGB(hex: 0xCCCCCC))
        #expect(opts.cursor == TermColorRGB(hex: 0xFFFFFF))
        #expect(opts.palette.count == 256)
        #expect(opts.colorScheme == .dark)
    }

    // vt 枚举 rawValue 契约（对齐 terminal.h / device.h，批 3 桥接零歧义）。
    @Test("TermCursorStyle rawValue 对齐 GhosttyTerminalCursorStyle")
    func cursorStyleRawValues() {
        #expect(TermCursorStyle.bar.rawValue == 0)
        #expect(TermCursorStyle.block.rawValue == 1)
        #expect(TermCursorStyle.underline.rawValue == 2)
        #expect(TermCursorStyle.blockHollow.rawValue == 3)
    }

    @Test("TermColorScheme rawValue 对齐 GhosttyColorScheme（DARK=1）")
    func colorSchemeRawValues() {
        #expect(TermColorScheme.light.rawValue == 0)
        #expect(TermColorScheme.dark.rawValue == 1)
    }

    @Test("makeCursorOptions 默认 = block + blink（TERM_L1_18/L1_19）")
    func cursorOptionsDefault() {
        let opts = makeCursorOptions()
        #expect(opts.defaultStyle == .block)
        #expect(opts.defaultBlink == true)
    }

    @Test("config CursorStyle → vt 默认样式映射")
    func cursorStyleMapping() {
        #expect(TermCursorStyle(config: .block) == .block)
        #expect(TermCursorStyle(config: .underline) == .underline)
        #expect(TermCursorStyle(config: .bar) == .bar)
        // config 无 blockHollow（渲染态），三值映射全覆盖。
        #expect(makeCursorOptions(style: .bar, blink: false).defaultStyle == .bar)
    }

    // MARK: - M6 主题批：5 套 + named 回退 + colorScheme（terminal-theme.md §1/§2/§7）

    @Test("named 回退：已知名解析、未知/空/大小写不符回退 dark")
    func namedFallback() {
        #expect(TermTheme.named("dark").name == "dark")
        #expect(TermTheme.named("light").name == "light")
        #expect(TermTheme.named("monokai").name == "monokai")
        #expect(TermTheme.named("dracula").name == "dracula")
        #expect(TermTheme.named("solarized-dark").name == "solarized-dark")
        #expect(TermTheme.named("bogus").name == "dark")   // 未知回退（§1 开集）
        #expect(TermTheme.named("").name == "dark")        // 空回退
        #expect(TermTheme.named("Dark").name == "dark")    // 大小写敏感 → 未知回退
    }

    // 一行 = spec §2 一键：hex 列序 dark/light/monokai/dracula/solarized-dark；get = TermTheme 上该键的取值器
    // （nil = 照录不消费键，§3 偏差，仅入表存档不断言）。
    private struct SpecColorRow {
        let key: String
        let hex: [UInt32]                       // 恰 5（对应 5 套主题列）
        let get: ((TermTheme) -> TermColorRGB)? // nil = cursorAccent/selectionBackground（不消费）
    }

    /// spec terminal-theme.md §2 全表逐键照录（5 套 × 21 键 = 105 单元）。4 套新主题**无字节 golden 兜底**，
    /// 此逐键表测是唯一回归护栏（防实现打错一位）。cursorAccent/selectionBackground 照录不消费（§3）入表存档不断言。
    /// 局部构造（含非 Sendable 取值闭包，不作 static——避 Swift 6 静态并发安全约束）。
    private func specTable() -> [SpecColorRow] {
        func pal(_ i: Int) -> (TermTheme) -> TermColorRGB { { $0.palette[i] } }
        return [
            SpecColorRow(key: "background",          hex: [0x1e1e1e, 0xffffff, 0x272822, 0x282a36, 0x002b36], get: { $0.background }),
            SpecColorRow(key: "foreground",          hex: [0xcccccc, 0x383a42, 0xf8f8f2, 0xf8f8f2, 0x839496], get: { $0.foreground }),
            SpecColorRow(key: "cursor",              hex: [0xffffff, 0x526eff, 0xf8f8f0, 0xf8f8f2, 0x93a1a1], get: { $0.cursor }),
            SpecColorRow(key: "cursorAccent",        hex: [0x000000, 0xffffff, 0x272822, 0x282a36, 0x002b36], get: nil), // §3 不消费
            SpecColorRow(key: "selectionBackground", hex: [0x264f78, 0xbfceff, 0x49483e, 0x44475a, 0x073642], get: nil), // §3 不消费
            SpecColorRow(key: "black(0)",            hex: [0x000000, 0x383a42, 0x272822, 0x21222c, 0x073642], get: pal(0)),
            SpecColorRow(key: "red(1)",              hex: [0xcd3131, 0xe45649, 0xf92672, 0xff5555, 0xdc322f], get: pal(1)),
            SpecColorRow(key: "green(2)",            hex: [0x0dbc79, 0x50a14f, 0xa6e22e, 0x50fa7b, 0x859900], get: pal(2)),
            SpecColorRow(key: "yellow(3)",           hex: [0xe5e510, 0xc18401, 0xf4bf75, 0xf1fa8c, 0xb58900], get: pal(3)),
            SpecColorRow(key: "blue(4)",             hex: [0x2472c8, 0x4078f2, 0x66d9ef, 0xbd93f9, 0x268bd2], get: pal(4)),
            SpecColorRow(key: "magenta(5)",          hex: [0xbc3fbc, 0xa626a4, 0xae81ff, 0xff79c6, 0xd33682], get: pal(5)),
            SpecColorRow(key: "cyan(6)",             hex: [0x11a8cd, 0x0184bc, 0xa1efe4, 0x8be9fd, 0x2aa198], get: pal(6)),
            SpecColorRow(key: "white(7)",            hex: [0xe5e5e5, 0xa0a1a7, 0xf8f8f2, 0xf8f8f2, 0xeee8d5], get: pal(7)),
            SpecColorRow(key: "brightBlack(8)",      hex: [0x666666, 0x4f525e, 0x75715e, 0x6272a4, 0x586e75], get: pal(8)),
            SpecColorRow(key: "brightRed(9)",        hex: [0xf14c4c, 0xe06c75, 0xf92672, 0xff6e6e, 0xcb4b16], get: pal(9)),
            SpecColorRow(key: "brightGreen(10)",     hex: [0x23d18b, 0x98c379, 0xa6e22e, 0x69ff94, 0x586e75], get: pal(10)),
            SpecColorRow(key: "brightYellow(11)",    hex: [0xf5f543, 0xe5c07b, 0xf4bf75, 0xffffa5, 0x657b83], get: pal(11)),
            SpecColorRow(key: "brightBlue(12)",      hex: [0x3b8eea, 0x61afef, 0x66d9ef, 0xd6acff, 0x839496], get: pal(12)),
            SpecColorRow(key: "brightMagenta(13)",   hex: [0xd670d6, 0xc678dd, 0xae81ff, 0xff92df, 0x6c71c4], get: pal(13)),
            SpecColorRow(key: "brightCyan(14)",      hex: [0x29b8db, 0x56b6c2, 0xa1efe4, 0xa4ffff, 0x93a1a1], get: pal(14)),
            SpecColorRow(key: "brightWhite(15)",     hex: [0xffffff, 0xffffff, 0xf9f8f5, 0xffffff, 0xfdf6e3], get: pal(15)),
        ]
    }

    @Test("5 套主题 × 21 键逐键对照 spec §2（照录回归——4 套新主题无 golden 兜底，此为唯一护栏）")
    func fiveThemesTwentyOneKeysPerKey() {
        let themes: [TermTheme] = [.dark, .light, .monokai, .dracula, .solarizedDark]
        let table = specTable()
        #expect(table.count == 21)   // §2 全表 21 键（含 2 照录不消费键）
        for row in table {
            #expect(row.hex.count == themes.count, "键 \(row.key) hex 列数应为 5")
            guard let get = row.get else { continue } // cursorAccent/selectionBackground 照录不消费（§3）
            for (i, theme) in themes.enumerated() {
                #expect(get(theme) == TermColorRGB(hex: row.hex[i]),
                        "主题 \(theme.name) 键 \(row.key) 期望 #\(String(format: "%06x", row.hex[i]))，实得 \(get(theme))")
            }
        }
    }

    @Test("solarized-dark 官方灰阶两「重复值」不变量存续（§2 表下注记，非笔误）")
    func solarizedDarkGrayscaleInvariant() {
        let t = TermTheme.solarizedDark
        // 官方 Solarized 有意把亮系绿/蓝映到基调灰（base01/base0）：
        #expect(t.palette[10] == t.palette[8])   // brightGreen(10) == brightBlack(8) == #586e75
        #expect(t.palette[10] == TermColorRGB(hex: 0x586E75))
        #expect(t.palette[12] == t.foreground)   // brightBlue(12) == foreground == #839496
        #expect(t.palette[12] == TermColorRGB(hex: 0x839496))
    }

    @Test("colorScheme 应答映射（§7）：仅 light 报 light，其余（含三花样深色）报 dark")
    func colorSchemeMapping() {
        #expect(TermTheme.light.colorScheme == .light)
        #expect(TermTheme.dark.colorScheme == .dark)
        #expect(TermTheme.monokai.colorScheme == .dark)
        #expect(TermTheme.dracula.colorScheme == .dark)
        #expect(TermTheme.solarizedDark.colorScheme == .dark)
        // makeColorOptions 由 name 派生同款 scheme。
        #expect(TermTheme.light.makeColorOptions().colorScheme == .light)
        #expect(TermTheme.monokai.makeColorOptions().colorScheme == .dark)
    }

    @Test("四套新主题 palette 均 256 项且 16..255 与 dark 同段（§3 后 240 不随主题）")
    func newThemesPaletteShape() {
        for t: TermTheme in [.light, .monokai, .dracula, .solarizedDark] {
            #expect(t.palette.count == 256)
            #expect(t.palette[16] == TermTheme.dark.palette[16])    // 色立方起点
            #expect(t.palette[231] == TermTheme.dark.palette[231])  // 色立方终点
            #expect(t.palette[255] == TermTheme.dark.palette[255])  // 灰阶终点
        }
    }
}
