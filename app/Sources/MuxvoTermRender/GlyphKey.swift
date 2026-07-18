// GlyphCache 值类型：字形键 / 矩形 / 页种类 / 条目。
//
// 权威 terminal-rendering.md §3：条目 = glyphKey → (page, rect, 页世代号, lastUsedFrame)。
import Foundation

/// 字形缓存键：一个 grapheme cluster + 样式位。彩色（emoji）与灰度字形走不同页种，故 color 入键
/// （同一 cluster 若彩/灰两路都要，键不同——实践上一个 cluster 只走一种，color 由栅格判定后回填）。
public struct GlyphKey: Hashable, Sendable {
    public let cluster: String
    public let bold: Bool
    public let italic: Bool
    /// true=彩色字形（emoji，落 RGBA8 页）；false=灰度 mask（落 R8 页）。
    public let color: Bool

    public init(cluster: String, bold: Bool = false, italic: Bool = false, color: Bool = false) {
        self.cluster = cluster
        self.bold = bold
        self.italic = italic
        self.color = color
    }
}

/// 页内像素矩形（原点左上，含 padding 外的净字形框）。
public struct GlyphRect: Equatable, Sendable {
    public let x: Int
    public let y: Int
    public let w: Int
    public let h: Int

    public init(x: Int, y: Int, w: Int, h: Int) {
        self.x = x
        self.y = y
        self.w = w
        self.h = h
    }

    /// 两矩形是否重叠（含边缘接触不算重叠——用于装箱无重叠断言）。
    public func overlaps(_ other: GlyphRect) -> Bool {
        x < other.x + other.w && other.x < x + w &&
            y < other.y + other.h && other.y < y + h
    }
}

/// 页种类：灰度 mask（R8）或彩色（RGBA8）。
public enum GlyphPageKind: Sendable, Equatable {
    case mask   // R8 1024²，常规字形（着色留 shader）
    case color  // RGBA8 1024²，emoji 直采
}

/// 字形在 atlas 里的落位。pageGeneration 用于失效检测：条目所属页被驱逐后 generation++，
/// 引用旧世代的（行/shaping）缓存据此自动失效重排。
public struct GlyphEntry: Equatable, Sendable {
    public let page: Int
    public let kind: GlyphPageKind
    public let rect: GlyphRect
    public let pageGeneration: UInt64
    public var lastUsedFrame: UInt64
}
