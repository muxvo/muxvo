// FontConfig + cell 度量 + 默认光标 option 装配。
//
// 权威（terminal-rendering.md §4.1/§4.3/§4.4）：
//   - FontConfig(family, size)，默认 14pt（TERM_L1_09/L1_17，从 MuxvoTermCore.TermDefaults 读）。
//   - cell 度量 = '0' advance × (ascent+descent+leading)，喂 ghostty_terminal_resize（真实 cell px）。
//   - 默认光标 block+blink（TERM_L1_18/L1_19，从 TermDefaults 读）。
//
// 度量逻辑平移自探针 GlyphAtlas（CoreText，纯 CPU，无 Metal——CI macOS 无 GPU 也可测）。
import CoreText
import Foundation
import MuxvoTermCore

/// 字体配置：family + 磅值。默认取 legacy 等宽栈里始终在场的 Menlo（font-mono 栈头 JetBrains Mono
/// 非系统自带、不保证安装；cell 度量回归基线须用确定性字体，故默认 Menlo）。size 默认 TermDefaults.fontSize。
public struct FontConfig: Equatable, Hashable, Sendable {
    public let family: String
    public let size: CGFloat

    public init(family: String = "Menlo", size: CGFloat = CGFloat(TermDefaults.fontSize)) {
        self.family = family
        self.size = size
    }
}

/// cell 像素度量（在给定 backing scale 下）。
public struct CellMetrics: Equatable, Sendable {
    /// cell 宽/高（像素，含 leading，ceil 取整——与探针一致，供 atlas 分页/网格排布）。
    public let widthPx: Int
    public let heightPx: Int
    /// 未取整的排版度量（× scale），供栅格基线定位。
    public let ascentPx: CGFloat
    public let descentPx: CGFloat
    public let leadingPx: CGFloat
    /// '0' 的原始 advance（磅值坐标，未乘 scale），供 resize 传 vt 真实 cell 宽换算。
    public let advancePoints: CGFloat

    /// 绘制基线相对 cell 底边的偏移（像素）——探针 descentPx = (desc + leading/2) * scale。
    public var baselineFromBottomPx: CGFloat { descentPx + leadingPx / 2 }
}

public enum FontMetrics {
    /// 用 CoreText 量 cell 尺寸。宽 = '0' advance，高 = ascent+descent+leading，均 × scale 后 ceil。
    public static func measure(_ config: FontConfig, scale: CGFloat) -> CellMetrics {
        let font = CTFontCreateWithName(config.family as CFString, config.size, nil)
        var ch: [UniChar] = [0x30]  // '0'
        var glyph: [CGGlyph] = [0]
        CTFontGetGlyphsForCharacters(font, &ch, &glyph, 1)
        var adv = CGSize.zero
        CTFontGetAdvancesForGlyphs(font, .horizontal, glyph, &adv, 1)
        let asc = CTFontGetAscent(font)
        let desc = CTFontGetDescent(font)
        let lead = CTFontGetLeading(font)
        return CellMetrics(
            widthPx: Int(ceil(adv.width * scale)),
            heightPx: Int(ceil((asc + desc + lead) * scale)),
            ascentPx: asc * scale,
            descentPx: desc * scale,
            leadingPx: lead * scale,
            advancePoints: adv.width)
    }
}

// MARK: - 默认光标 option 装配

extension TermCursorStyle {
    /// config 侧 CursorStyle（block/underline/bar）→ vt 默认光标样式枚举。
    /// 注：config 无 blockHollow（渲染态），故不覆盖 .blockHollow。
    public init(config: CursorStyle) {
        switch config {
        case .block: self = .block
        case .underline: self = .underline
        case .bar: self = .bar
        }
    }
}

/// 装配默认光标 option（不接会话；批 3 消费）。默认 block+blink（TERM_L1_18/L1_19）。
public func makeCursorOptions(
    style: CursorStyle = TermDefaults.cursorStyle,
    blink: Bool = TermDefaults.cursorBlink
) -> TerminalCursorOptions {
    TerminalCursorOptions(defaultStyle: TermCursorStyle(config: style), defaultBlink: blink)
}
