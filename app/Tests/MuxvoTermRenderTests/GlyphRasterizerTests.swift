// GlyphRasterizer 测试（CoreText，纯 CPU，无 GPU——CI macOS 也可跑位图字节断言）。
import Testing
@testable import MuxvoTermRender

@Suite("GlyphRasterizer 栅格")
struct GlyphRasterizerTests {
    private let r = GlyphRasterizer(font: FontConfig(family: "Menlo", size: 14), scale: 2)

    @Test("普通字形 'A' → 非空 R8 灰度 mask")
    func maskGlyphNonEmpty() {
        let g = r.rasterize(GlyphKey(cluster: "A"))
        #expect(g != nil)
        guard let g else { return }
        #expect(g.kind == .mask)
        #expect(g.widthCells == 1)
        #expect(g.bytesPerRow >= g.width)          // R8：≥1B/px（含可能的对齐 padding）
        #expect(g.data.contains { $0 > 0 }, "灰度位图应有非零覆盖像素")
    }

    @Test("空白 / 空簇 → nil（不入缓存不绘制）")
    func blankReturnsNil() {
        #expect(r.rasterize(GlyphKey(cluster: " ")) == nil)
        #expect(r.rasterize(GlyphKey(cluster: "")) == nil)
    }

    @Test("CJK 宽字符 → widthCells==2")
    func cjkWide() {
        let g = r.rasterize(GlyphKey(cluster: "中"))
        #expect(g != nil)
        #expect(g?.widthCells == 2)
        #expect(g?.kind == .mask)
    }

    @Test("emoji → 彩色路径（RGBA8）分派正确")
    func emojiColorPath() {
        #expect(GlyphRasterizer.isColorCluster("😀"))
        #expect(!GlyphRasterizer.isColorCluster("A"))
        let g = r.rasterize(GlyphKey(cluster: "😀"))
        #expect(g != nil)
        #expect(g?.kind == .color)
        #expect(g?.bytesPerRow ?? 0 >= (g?.width ?? 0) * 4)  // RGBA8：4B/px
    }

    @Test("VS16 强制彩色簇被识别")
    func vs16ForcesColor() {
        // U+2764 U+FE0F = ❤️（VS16 → emoji presentation）
        #expect(GlyphRasterizer.isColorCluster("\u{2764}\u{FE0F}"))
    }
}
