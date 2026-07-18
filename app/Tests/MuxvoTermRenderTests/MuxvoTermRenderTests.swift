// MuxvoTermRender 模块冒烟（真实覆盖分散在 GlyphAtlasCoreTests / FontConfigTests /
// GlyphRasterizerTests / ThemeTests / GlyphCacheTests）。
import Testing
@testable import MuxvoTermRender

@Suite("MuxvoTermRender 模块")
struct MuxvoTermRenderModuleTests {
    @Test("版本号随实装演进")
    func version() {
        #expect(MuxvoTermRenderInfo.version == "0.2.0")
    }
}
