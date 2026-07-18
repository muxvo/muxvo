// GlyphCache 编排 + Metal 上传守卫 + app 级共享 registry 测试。
//
// device==nil 用例处处可跑（CI 无 GPU）；触 Metal 的用例守 MTLCreateSystemDefaultDevice()==nil 即跳过。
import Metal
import Testing
@testable import MuxvoTermRender

@MainActor
@Suite("GlyphCache 编排 + registry")
struct GlyphCacheTests {
    @Test("device==nil：装箱/栅格照常，纹理页留空")
    func headlessNoTexture() {
        let cache = GlyphCache(font: FontConfig(family: "Menlo", size: 14), scale: 2, device: nil)
        #expect(!cache.hasDevice)
        let e = cache.glyph(GlyphKey(cluster: "A"))
        #expect(e != nil)
        #expect(e?.kind == .mask)
        #expect(cache.texture(kind: .mask, page: 0) == nil)  // 无 device → 无纹理
        #expect(cache.fullRebuildCount == 0)
    }

    @Test("device==nil：命中零重复插入（同键第二次走 lookup）")
    func headlessHitPath() {
        let cache = GlyphCache(device: nil)
        let a = cache.glyph(GlyphKey(cluster: "A"))
        let b = cache.glyph(GlyphKey(cluster: "A"))
        #expect(a == b)  // 同一落位
        #expect(cache.pageCount(.mask) == 1)
    }

    @Test("空白簇 → nil")
    func blankGlyph() {
        let cache = GlyphCache(device: nil)
        #expect(cache.glyph(GlyphKey(cluster: " ")) == nil)
    }

    @Test("frameBoundary 推进帧号")
    func frameAdvances() {
        let cache = GlyphCache(device: nil)
        #expect(cache.frame == 0)
        cache.frameBoundary()
        #expect(cache.frame == 1)
    }

    @Test("Metal 上传：有 GPU 时纹理页实体化并可上传（无 GPU 跳过）")
    func metalUploadWhenDeviceAvailable() throws {
        guard let device = MTLCreateSystemDefaultDevice() else {
            // CI VM 无 GPU：守卫跳过（合同③测试组织要求）。
            return
        }
        let cache = GlyphCache(font: FontConfig(family: "Menlo", size: 14), scale: 2, device: device)
        #expect(cache.hasDevice)
        let e = cache.glyph(GlyphKey(cluster: "A"))
        #expect(e != nil)
        let tex = cache.texture(kind: .mask, page: 0)
        #expect(tex != nil)
        #expect(tex?.pixelFormat == .r8Unorm)

        // emoji 走彩色页纹理（RGBA8）。
        _ = cache.glyph(GlyphKey(cluster: "😀"))
        #expect(cache.texture(kind: .color, page: 0)?.pixelFormat == .rgba8Unorm)
    }

    @Test("registry：同 (family,size,scale) 返回同一实例，不同 key 返回不同实例")
    func registrySharing() {
        let reg = GlyphCacheRegistry()
        let a = reg.cache(font: FontConfig(family: "Menlo", size: 14), scale: 2, device: nil)
        let b = reg.cache(font: FontConfig(family: "Menlo", size: 14), scale: 2, device: nil)
        #expect(a === b)  // app 级共享

        let c = reg.cache(font: FontConfig(family: "Menlo", size: 16), scale: 2, device: nil)
        #expect(a !== c)  // 字号不同 → 另建
        let d = reg.cache(font: FontConfig(family: "Menlo", size: 14), scale: 1, device: nil)
        #expect(a !== d)  // scale 不同 → 另建
    }

    @Test("registry.removeAll 后重建为新实例")
    func registryClear() {
        let reg = GlyphCacheRegistry()
        let a = reg.cache(scale: 2, device: nil)
        reg.removeAll()
        let b = reg.cache(scale: 2, device: nil)
        #expect(a !== b)
    }
}
