// FontConfig + cell 度量测试（CoreText，纯 CPU，无 GPU）。
//
// 14pt Menlo 度量作回归基线（本机 macOS 26 实测；Menlo 度量跨版本稳定）：
//   @2x → cellW=17 cellH=33   @1x → cellW=9 cellH=17
import CoreText
import Testing
@testable import MuxvoTermRender

@Suite("FontConfig 度量")
struct FontConfigTests {
    @Test("默认 FontConfig = Menlo 14pt")
    func defaults() {
        let c = FontConfig()
        #expect(c.family == "Menlo")
        #expect(c.size == 14)
    }

    @Test("Menlo 14pt @2x cell 度量稳定基线 = 17×33")
    func menlo14At2x() {
        let m = FontMetrics.measure(FontConfig(family: "Menlo", size: 14), scale: 2)
        #expect(m.widthPx == 17)
        #expect(m.heightPx == 33)
        #expect(m.advancePoints > 8.4 && m.advancePoints < 8.5)  // '0' advance ≈ 8.4287
        #expect(m.ascentPx > 0 && m.descentPx > 0)
    }

    @Test("Menlo 14pt @1x cell 度量稳定基线 = 9×17")
    func menlo14At1x() {
        let m = FontMetrics.measure(FontConfig(family: "Menlo", size: 14), scale: 1)
        #expect(m.widthPx == 9)
        #expect(m.heightPx == 17)
    }

    @Test("scale 翻倍宽高不减（度量随 scale 单调）")
    func scaleMonotonic() {
        let one = FontMetrics.measure(FontConfig(), scale: 1)
        let two = FontMetrics.measure(FontConfig(), scale: 2)
        #expect(two.widthPx >= one.widthPx)
        #expect(two.heightPx >= one.heightPx)
    }
}
