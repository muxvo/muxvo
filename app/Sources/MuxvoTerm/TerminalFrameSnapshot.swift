// TerminalFrameSnapshot：一帧渲染的不可变值输入（行为规格 terminal-rendering.md §2）。
//
// 合同①②的数据载体：RenderCoordinator 每次 update 物化一份，generation 单调 ++，
// 原子指针发布；任意多视图 draw 只读同一份快照（零锁、零 C 调用、零会话 queue 接触）。
// 「row 数据在下次 render_state_update 后失效」这一 C API 生命周期约束在此层被彻底吸收——
// 快照是 Swift 值类型（不可变 + COW），发布后与 terminal / render state 再无关系。
//
// 本类型刻意 **不 import CGhosttyVT**：保持渲染数据面 vendor-free，vt→快照 的字段映射
// 全部收敛在 RenderCoordinator.swift（唯一触 C 的地方）。
import Foundation

/// RGBA 颜色（vt 颜色为 RGB，无 alpha；终端色一律 a=255 不透明）。
public struct RGBA: Sendable, Equatable, Hashable {
    public var r: UInt8
    public var g: UInt8
    public var b: UInt8
    public var a: UInt8
    public init(r: UInt8, g: UInt8, b: UInt8, a: UInt8 = 255) {
        self.r = r; self.g = g; self.b = b; self.a = a
    }
}

/// cell 样式位（vt GhosttyStyle 的布尔/下划线标志投影）。underline 只记「有/无」，
/// 具体下划线样式（单/双/曲）批 3 视图侧按需从 style 复原。
public struct CellStyleFlags: OptionSet, Sendable, Hashable {
    public let rawValue: UInt16
    public init(rawValue: UInt16) { self.rawValue = rawValue }
    public static let bold          = CellStyleFlags(rawValue: 1 << 0)
    public static let italic        = CellStyleFlags(rawValue: 1 << 1)
    public static let faint         = CellStyleFlags(rawValue: 1 << 2)
    public static let blink         = CellStyleFlags(rawValue: 1 << 3)
    public static let inverse       = CellStyleFlags(rawValue: 1 << 4)
    public static let invisible     = CellStyleFlags(rawValue: 1 << 5)
    public static let strikethrough = CellStyleFlags(rawValue: 1 << 6)
    public static let overline      = CellStyleFlags(rawValue: 1 << 7)
    public static let underline     = CellStyleFlags(rawValue: 1 << 8)
}

/// 单元格（§2）。fg/bg 为**已解析**的有效色（palette 索引已查表；无显式色时取终端默认 fg/bg）。
/// inverse 不在此预交换——留作 styleFlags 位，交换策略归渲染端。
public struct TerminalCell: Sendable, Equatable {
    public var grapheme: String   // 完整 grapheme cluster（UTF-8 解码）；空单元格为 ""
    public var fg: RGBA
    public var bg: RGBA
    public var styleFlags: CellStyleFlags
    public var selected: Bool
    public init(grapheme: String, fg: RGBA, bg: RGBA, styleFlags: CellStyleFlags, selected: Bool) {
        self.grapheme = grapheme
        self.fg = fg
        self.bg = bg
        self.styleFlags = styleFlags
        self.selected = selected
    }
}

/// 视口一行（§2）。contentHash 为「行内容缓存骨架」的 key（按 grapheme+样式+色 求 FNV-1a）——
/// 未变的行跨帧复用同一 RowSnapshot 值，供批 3 视图侧的字形 shaping 缓存按 hash 命中共享。
public struct RowSnapshot: Sendable, Equatable {
    public var cells: [TerminalCell]
    public var dirtyOnBuild: Bool   // 本帧该行是否由脏触发重建（vs. 复用缓存）
    public var contentHash: UInt64
    public init(cells: [TerminalCell], dirtyOnBuild: Bool, contentHash: UInt64) {
        self.cells = cells
        self.dirtyOnBuild = dirtyOnBuild
        self.contentHash = contentHash
    }
}

/// 光标快照（§2 + §4.3）。「样式」与「闪烁」分列两字段——vt 无「闪烁样式」枚举，
/// 闪烁是独立布尔（规格偏差发现①）。inViewport==false 时 x/y 无意义。
public struct CursorSnapshot: Sendable, Equatable {
    public enum Style: Sendable, Equatable { case bar, block, underline, blockHollow }
    public var x: Int
    public var y: Int
    public var style: Style
    public var visible: Bool
    public var blinking: Bool
    public var passwordInput: Bool
    public var inViewport: Bool
    public init(
        x: Int, y: Int, style: Style, visible: Bool,
        blinking: Bool, passwordInput: Bool, inViewport: Bool
    ) {
        self.x = x; self.y = y; self.style = style; self.visible = visible
        self.blinking = blinking; self.passwordInput = passwordInput; self.inViewport = inViewport
    }
}

/// 有效色（§4.2）：OSC 4/10/11/12 覆盖已由 vt 合成，渲染端只读结果，不自己合成。
public struct TerminalColors: Sendable, Equatable {
    public var background: RGBA
    public var foreground: RGBA
    public var cursor: RGBA?          // 仅当终端显式设了光标色（COLOR_CURSOR_HAS_VALUE）
    public var palette: [RGBA]        // 当前 256 色板（含 OSC 覆盖）
    public init(background: RGBA, foreground: RGBA, cursor: RGBA?, palette: [RGBA]) {
        self.background = background
        self.foreground = foreground
        self.cursor = cursor
        self.palette = palette
    }
}

/// 每行选中区间（vt ROW_DATA_SELECTION；from/to 均为闭区间列索引）。
public struct SelectionRange: Sendable, Equatable {
    public var row: Int
    public var from: Int
    public var to: Int
    public init(row: Int, from: Int, to: Int) {
        self.row = row; self.from = from; self.to = to
    }
}

/// 一处搜索高亮（viewport 行坐标；from/to 为闭区间列索引）。isCurrent = 当前命中（强高亮），
/// 其余为全命中淡高亮。RenderCoordinator 每帧按 scrollbar.offset 把 SCREEN 绝对命中映射到此。
public struct SearchHighlight: Sendable, Equatable {
    public var row: Int
    public var from: Int
    public var to: Int
    public var isCurrent: Bool
    public init(row: Int, from: Int, to: Int, isCurrent: Bool) {
        self.row = row; self.from = from; self.to = to; self.isCurrent = isCurrent
    }
}

/// scrollbar 数学量（vt SCROLLBAR；查询开销大，仅 viewport 非 active 或本帧滚动过时填）。
public struct ScrollbarSnapshot: Sendable, Equatable {
    public var total: Int    // 可滚动区总行数
    public var offset: Int   // viewport 距顶偏移
    public var len: Int      // 可见区行数
    public init(total: Int, offset: Int, len: Int) {
        self.total = total; self.offset = offset; self.len = len
    }
}

/// 一帧不可变渲染输入（§2）。字段名对齐规格：cols/rows 为网格尺寸，lines 为逐视口行。
public struct TerminalFrameSnapshot: Sendable {
    public var generation: UInt64          // 单调递增；bench 打点 & 断言用（== 累计 update 次数）
    public var cols: Int
    public var rows: Int
    public var lines: [RowSnapshot]         // 视口行（含 shaping 缓存 key）
    public var cursor: CursorSnapshot
    public var colors: TerminalColors
    public var selectionRanges: [SelectionRange]
    public var searchHighlights: [SearchHighlight]  // 终端内搜索命中（viewport 行；terminal-search-bar §M3）
    public var scrollbar: ScrollbarSnapshot?
    public var viewportActive: Bool         // GHOSTTY_TERMINAL_DATA_VIEWPORT_ACTIVE

    public init(
        generation: UInt64, cols: Int, rows: Int, lines: [RowSnapshot],
        cursor: CursorSnapshot, colors: TerminalColors,
        selectionRanges: [SelectionRange], scrollbar: ScrollbarSnapshot?, viewportActive: Bool,
        searchHighlights: [SearchHighlight] = []
    ) {
        self.generation = generation
        self.cols = cols
        self.rows = rows
        self.lines = lines
        self.cursor = cursor
        self.colors = colors
        self.selectionRanges = selectionRanges
        self.searchHighlights = searchHighlights
        self.scrollbar = scrollbar
        self.viewportActive = viewportActive
    }

    /// 测试/诊断辅助：读一行可见文本（空单元格记空格，去尾部空白）。非渲染路径。
    public func lineText(_ y: Int) -> String {
        guard y >= 0, y < lines.count else { return "" }
        let joined = lines[y].cells.map { $0.grapheme.isEmpty ? " " : $0.grapheme }.joined()
        var end = joined.endIndex
        while end > joined.startIndex {
            let prev = joined.index(before: end)
            if joined[prev] == " " { end = prev } else { break }
        }
        return String(joined[..<end])
    }
}
