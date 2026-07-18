// GlyphAtlas：CoreText 栅格 → 单张 2048×2048 RGBA 纹理，shelf packing。
// - 普通字形画白色，shader 里按 fg 色 tint（mode=mask）
// - emoji 等彩色字形直接采样纹理色（mode=color）
// - 字体回退交给 CTLineDraw（NSAttributedString 自动 fallback），CJK/emoji 不用手配字体
// 仅主线程访问（MTKView.draw 在主线程），不加锁。
import AppKit
import CoreText
import Metal

public struct GlyphSlot {
    public let uvPx: SIMD4<Float> // 在 atlas 里的 x,y,w,h（像素）
    public let widthCells: Int // 占几个 cell（1=窄 2=宽 …）
    public let isColor: Bool // 彩色字形（emoji）
}

public final class GlyphAtlas {
    public static let textureSize = 2048

    public let texture: MTLTexture
    /// cell 像素尺寸（raster scale 下）
    public let cellW: Int
    public let cellH: Int
    public let scale: CGFloat
    /// atlas 重建代数：装满重置时 +1，视图据此废弃所有行缓存
    public private(set) var generation = 0

    private let baseFont: CTFont
    private let descentPx: CGFloat
    private var fontCache: [UInt8: CTFont] = [:] // bit0=bold bit1=italic
    private var slots: [String: GlyphSlot] = [:]
    private var shelfX = 1
    private var shelfY = 1
    private var shelfRowH = 0

    public init(device: MTLDevice, fontName: String = "Menlo", pointSize: CGFloat = 13, scale: CGFloat = 2) {
        self.scale = scale
        let font = CTFontCreateWithName(fontName as CFString, pointSize, nil)
        self.baseFont = font
        fontCache[0] = font

        // cell 度量：宽 = '0' 的 advance，高 = ascent+descent+leading
        var ch: [UniChar] = [0x30]
        var glyph: [CGGlyph] = [0]
        CTFontGetGlyphsForCharacters(font, &ch, &glyph, 1)
        var adv = CGSize.zero
        CTFontGetAdvancesForGlyphs(font, .horizontal, glyph, &adv, 1)
        self.cellW = Int(ceil(adv.width * scale))
        let asc = CTFontGetAscent(font)
        let desc = CTFontGetDescent(font)
        let lead = CTFontGetLeading(font)
        self.cellH = Int(ceil((asc + desc + lead) * scale))
        self.descentPx = (desc + lead / 2) * scale

        let desc2 = MTLTextureDescriptor.texture2DDescriptor(
            pixelFormat: .rgba8Unorm,
            width: Self.textureSize, height: Self.textureSize, mipmapped: false)
        desc2.usage = [.shaderRead]
        desc2.storageMode = .shared
        self.texture = device.makeTexture(descriptor: desc2)!
    }

    private func font(bold: Bool, italic: Bool) -> CTFont {
        let key: UInt8 = (bold ? 1 : 0) | (italic ? 2 : 0)
        if let f = fontCache[key] { return f }
        var traits: CTFontSymbolicTraits = []
        if bold { traits.insert(.traitBold) }
        if italic { traits.insert(.traitItalic) }
        let f = CTFontCreateCopyWithSymbolicTraits(baseFont, 0, nil, traits, [.traitBold, .traitItalic])
            ?? baseFont
        fontCache[key] = f
        return f
    }

    /// 取（或栅格化）一个 grapheme cluster 的 atlas slot。空白簇返回 nil。
    public func slot(for cluster: String, bold: Bool, italic: Bool) -> GlyphSlot? {
        if cluster.isEmpty || cluster == " " { return nil }
        let key = "\(bold ? "B" : "")\(italic ? "I" : "")|\(cluster)"
        if let s = slots[key] { return s }
        let s = rasterize(cluster, bold: bold, italic: italic)
        if let s { slots[key] = s }
        return s
    }

    private func isColorCluster(_ cluster: String) -> Bool {
        cluster.unicodeScalars.contains {
            $0.properties.isEmojiPresentation || $0.value == 0xFE0F
        }
    }

    private func rasterize(_ cluster: String, bold: Bool, italic: Bool) -> GlyphSlot? {
        let f = font(bold: bold, italic: italic)
        let attr = NSAttributedString(string: cluster, attributes: [
            .font: f as Any,
            .foregroundColor: NSColor.white,
        ])
        let line = CTLineCreateWithAttributedString(attr)
        let typoW = CTLineGetTypographicBounds(line, nil, nil, nil)
        guard typoW > 0.01 else { return nil }

        let widthCells = max(1, min(4, Int((typoW * scale / CGFloat(cellW)).rounded())))
        let w = widthCells * cellW
        let h = cellH

        guard let ctx = CGContext(
            data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
            space: CGColorSpace(name: CGColorSpace.sRGB)!,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
        else { return nil }
        ctx.scaleBy(x: scale, y: scale)
        ctx.textPosition = CGPoint(x: 0, y: descentPx / scale)
        CTLineDraw(line, ctx)

        guard let region = allocate(w: w, h: h) else {
            // 装满：整体重置后重试一次
            resetAtlas()
            guard let region2 = allocate(w: w, h: h) else { return nil }
            return upload(ctx: ctx, region: region2, w: w, h: h, widthCells: widthCells, cluster: cluster)
        }
        return upload(ctx: ctx, region: region, w: w, h: h, widthCells: widthCells, cluster: cluster)
    }

    private func upload(ctx: CGContext, region: (x: Int, y: Int), w: Int, h: Int, widthCells: Int, cluster: String) -> GlyphSlot {
        texture.replace(
            region: MTLRegionMake2D(region.x, region.y, w, h),
            mipmapLevel: 0, withBytes: ctx.data!, bytesPerRow: w * 4)
        return GlyphSlot(
            uvPx: SIMD4(Float(region.x), Float(region.y), Float(w), Float(h)),
            widthCells: widthCells,
            isColor: isColorCluster(cluster))
    }

    private func allocate(w: Int, h: Int) -> (x: Int, y: Int)? {
        let pad = 1
        if shelfX + w + pad > Self.textureSize {
            shelfY += shelfRowH + pad
            shelfX = 1
            shelfRowH = 0
        }
        guard shelfY + h + pad <= Self.textureSize else { return nil }
        let pos = (x: shelfX, y: shelfY)
        shelfX += w + pad
        shelfRowH = max(shelfRowH, h)
        return pos
    }

    private func resetAtlas() {
        slots.removeAll(keepingCapacity: true)
        shelfX = 1
        shelfY = 1
        shelfRowH = 0
        generation += 1
    }
}
