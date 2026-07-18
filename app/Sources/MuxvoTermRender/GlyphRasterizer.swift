// GlyphRasterizer：CoreText 栅格层（纯 CPU，无 Metal——CI macOS 无 GPU 也可测位图字节）。
//
// 权威 terminal-rendering.md §3 + 探针 GlyphAtlas.rasterize（栅格逻辑可平移，分页结构不带入）：
//   - 普通字形 → 白色灰度 mask（R8），着色留 shader。
//   - emoji 等彩色字形 → RGBA8 直采纹理色。
//   - 字体 fallback 交 CTLineDraw（NSAttributedString 自动 fallback），CJK/emoji 不手配字体。
import AppKit
import CoreText
import Foundation

/// 一次栅格化产物。data 为紧密排布的位图（bytesPerRow 可能含 CGContext 对齐 padding）。
public struct RasterizedGlyph: Sendable {
    public let width: Int
    public let height: Int
    public let bytesPerRow: Int
    public let kind: GlyphPageKind       // mask=R8(1B/px) / color=RGBA8(4B/px)
    public let data: [UInt8]
    public let widthCells: Int           // 占几个 cell（1=窄 2=宽 …）
}

public final class GlyphRasterizer {
    public let font: FontConfig
    public let scale: CGFloat
    public let metrics: CellMetrics

    private let baseFont: CTFont
    private var fontCache: [UInt8: CTFont] = [:]  // bit0=bold bit1=italic

    public init(font: FontConfig, scale: CGFloat) {
        self.font = font
        self.scale = scale
        self.metrics = FontMetrics.measure(font, scale: scale)
        let f = CTFontCreateWithName(font.family as CFString, font.size, nil)
        self.baseFont = f
        self.fontCache[0] = f
    }

    private func ctFont(bold: Bool, italic: Bool) -> CTFont {
        let key: UInt8 = (bold ? 1 : 0) | (italic ? 2 : 0)
        if let f = fontCache[key] { return f }
        var traits: CTFontSymbolicTraits = []
        if bold { traits.insert(.traitBold) }
        if italic { traits.insert(.traitItalic) }
        let f = CTFontCreateCopyWithSymbolicTraits(baseFont, 0, nil, traits, [.traitBold, .traitItalic]) ?? baseFont
        fontCache[key] = f
        return f
    }

    /// 判彩色（emoji）簇：含 emoji-presentation scalar 或 VS16(0xFE0F)。
    public static func isColorCluster(_ cluster: String) -> Bool {
        cluster.unicodeScalars.contains { $0.properties.isEmojiPresentation || $0.value == 0xFE0F }
    }

    /// 栅格化一个 grapheme cluster。空白簇返回 nil（缓存/绘制均跳过）。
    /// color 走 RGBA8，其余走 R8 灰度 mask。
    public func rasterize(_ key: GlyphKey) -> RasterizedGlyph? {
        let cluster = key.cluster
        if cluster.isEmpty || cluster == " " { return nil }

        let f = ctFont(bold: key.bold, italic: key.italic)
        let attr = NSAttributedString(string: cluster, attributes: [
            .font: f as Any,
            .foregroundColor: NSColor.white,
        ])
        let line = CTLineCreateWithAttributedString(attr)
        let typoW = CTLineGetTypographicBounds(line, nil, nil, nil)
        guard typoW > 0.01 else { return nil }

        let cellW = metrics.widthPx
        let cellH = metrics.heightPx
        let widthCells = max(1, min(4, Int((typoW * scale / CGFloat(cellW)).rounded())))
        let w = widthCells * cellW
        let h = cellH
        let isColor = key.color || Self.isColorCluster(cluster)

        return isColor
            ? rasterizeColor(line: line, w: w, h: h, widthCells: widthCells)
            : rasterizeMask(line: line, w: w, h: h, widthCells: widthCells)
    }

    /// R8 灰度 mask：DeviceGray 上下文，黑底白字，灰阶即覆盖率。
    private func rasterizeMask(line: CTLine, w: Int, h: Int, widthCells: Int) -> RasterizedGlyph? {
        let bytesPerRow = w  // R8：1 字节/像素
        guard let ctx = CGContext(
            data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: bytesPerRow,
            space: CGColorSpaceCreateDeviceGray(),
            bitmapInfo: CGImageAlphaInfo.none.rawValue)
        else { return nil }
        ctx.setFillColor(gray: 0, alpha: 1)
        ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
        ctx.scaleBy(x: scale, y: scale)
        ctx.textPosition = CGPoint(x: 0, y: metrics.baselineFromBottomPx / scale)
        ctx.setFillColor(gray: 1, alpha: 1)
        CTLineDraw(line, ctx)
        return copyOut(ctx, w: w, h: h, kind: .mask, widthCells: widthCells)
    }

    /// RGBA8 彩色：sRGB premultipliedLast，直采字形色（emoji）。
    private func rasterizeColor(line: CTLine, w: Int, h: Int, widthCells: Int) -> RasterizedGlyph? {
        let bytesPerRow = w * 4
        guard let ctx = CGContext(
            data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: bytesPerRow,
            space: CGColorSpace(name: CGColorSpace.sRGB)!,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
        else { return nil }
        ctx.scaleBy(x: scale, y: scale)
        ctx.textPosition = CGPoint(x: 0, y: metrics.baselineFromBottomPx / scale)
        CTLineDraw(line, ctx)
        return copyOut(ctx, w: w, h: h, kind: .color, widthCells: widthCells)
    }

    private func copyOut(_ ctx: CGContext, w: Int, h: Int, kind: GlyphPageKind, widthCells: Int) -> RasterizedGlyph? {
        guard let base = ctx.data else { return nil }
        let bytesPerRow = ctx.bytesPerRow
        let count = bytesPerRow * h
        let buf = base.bindMemory(to: UInt8.self, capacity: count)
        let data = Array(UnsafeBufferPointer(start: buf, count: count))
        return RasterizedGlyph(
            width: w, height: h, bytesPerRow: bytesPerRow,
            kind: kind, data: data, widthCells: widthCells)
    }
}
