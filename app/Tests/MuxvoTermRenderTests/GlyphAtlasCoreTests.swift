// GlyphAtlasCore 纯逻辑测试——合同③的机器可验硬断言（无 Metal / 无 CoreText）。
//
// 用小规格页（pageDim=64、≤2 页）逼真触发多页装箱与整页驱逐；用默认规格断言 1024/8/4。
// 字形以合成尺寸灌入（不必真栅格，terminal-rendering.md §7 允许「合成 glyphKey 流」）。
import Testing
@testable import MuxvoTermRender

@Suite("GlyphAtlasCore 多页 LRU（合同③）")
struct GlyphAtlasCoreTests {
    // 64² 页、pad=1、30×30 字形：每页恰好装 4 个（2×2 shelf）。
    private static let dim = 64
    private static let glyph = 30

    private func fill(_ core: inout GlyphAtlasCore, keys: [String]) -> [String: GlyphEntry?] {
        var out: [String: GlyphEntry?] = [:]
        for k in keys {
            out[k] = core.insert(GlyphKey(cluster: k), width: Self.glyph, height: Self.glyph)
        }
        return out
    }

    @Test("默认页规格 = 1024² / mask≤8 / color≤4")
    func defaultPageSpec() {
        let core = GlyphAtlasCore()
        #expect(core.pageDim == 1024)
        #expect(core.maxMaskPages == 8)
        #expect(core.maxColorPages == 4)
    }

    @Test("灌超单页容量：fullRebuildCount 恒 0、多页承载、装箱无重叠")
    func overCapacityNeverFullRebuild() {
        var core = GlyphAtlasCore(pageDim: Self.dim, maxMaskPages: 2, maxColorPages: 1)
        // 8 个字形填满 2 页（每页 4 个）。
        let placed = fill(&core, keys: (0..<8).map { "g\($0)" })
        #expect(placed.values.allSatisfy { $0 != nil })
        #expect(core.pageCount(.mask) == 2)
        #expect(core.fullRebuildCount == 0)

        // 每页 live 矩形两两不重叠且在页内。
        for page in 0..<core.pageCount(.mask) {
            let rects = core.liveRects(kind: .mask, page: page)
            #expect(rects.count == 4)  // 利用率合理：64² 装满 4 个 30² 字形
            for i in rects.indices {
                let r = rects[i]
                #expect(r.x >= 0 && r.y >= 0 && r.x + r.w <= Self.dim && r.y + r.h <= Self.dim)
                for j in (i + 1)..<rects.count {
                    #expect(!r.overlaps(rects[j]), "同页字形不得重叠")
                }
            }
        }
    }

    @Test("驱逐只在帧边界发生：满帧内 insert 返回 nil 但不驱逐，frameBoundary 才驱逐")
    func evictionOnlyAtFrameBoundary() {
        var core = GlyphAtlasCore(pageDim: Self.dim, maxMaskPages: 2, maxColorPages: 1)
        // 帧 0：填满 2 页。
        _ = fill(&core, keys: (0..<8).map { "g\($0)" })
        core.frameBoundary()  // → 帧 1
        #expect(core.frame == 1)
        #expect(core.pageEvictionCount == 0)

        // 帧 1：新字形放不下 → 返回 nil，但帧内绝不驱逐。
        let deferred = core.insert(GlyphKey(cluster: "new"), width: Self.glyph, height: Self.glyph)
        #expect(deferred == nil)
        #expect(core.pageEvictionCount == 0, "帧内不得驱逐")
        #expect(core.fullRebuildCount == 0)

        // 帧边界才驱逐一张 LRU 页。
        core.frameBoundary()  // → 帧 2
        #expect(core.pageEvictionCount == 1)
        #expect(core.frame == 2)
        #expect(core.fullRebuildCount == 0)
    }

    @Test("早期字形被驱逐后可重新分配，且跨代（旧引用失效）")
    func evictedGlyphReallocatableAcrossGeneration() {
        var core = GlyphAtlasCore(pageDim: Self.dim, maxMaskPages: 2, maxColorPages: 1)
        // 帧 0：填满。捕获 g0 的初始条目（页 0，世代 0）。
        _ = fill(&core, keys: (0..<8).map { "g\($0)" })
        let e0 = core.peek(GlyphKey(cluster: "g0"))
        #expect(e0 != nil)
        #expect(e0?.pageGeneration == 0)
        core.frameBoundary()  // 帧 1

        // 帧 1：制造压力 + 帧边界驱逐（page 0 为 LRU，g0..g3 落其上）。
        _ = core.insert(GlyphKey(cluster: "new"), width: Self.glyph, height: Self.glyph)
        core.frameBoundary()  // 帧 2，驱逐 page 0

        // g0 被驱逐 → 查不到（旧引用失效）。
        #expect(core.peek(GlyphKey(cluster: "g0")) == nil)
        #expect(core.pageGeneration(.mask, 0) == 1, "被驱逐页世代 ++")

        // 帧 2：重新分配 g0 → 成功，且新条目世代 = 1（≠ 旧的 0）。
        let e1 = core.insert(GlyphKey(cluster: "g0"), width: Self.glyph, height: Self.glyph)
        #expect(e1 != nil)
        #expect(e1?.pageGeneration == 1)
        #expect(e1?.pageGeneration != e0?.pageGeneration)
        #expect(core.fullRebuildCount == 0)
    }

    @Test("LRU 顺序：本帧被触及的页受保护，最老的页先被驱逐")
    func lruProtectsRecentlyTouchedPage() {
        var core = GlyphAtlasCore(pageDim: Self.dim, maxMaskPages: 2, maxColorPages: 1)
        // 帧 0：page0=g0..g3，page1=g4..g7。
        _ = fill(&core, keys: (0..<8).map { "g\($0)" })
        core.frameBoundary()  // 帧 1

        // 帧 1：只触及 page0（lookup g0 命中）→ page0 受保护；page1 保持最老。
        #expect(core.lookup(GlyphKey(cluster: "g0")) != nil)
        _ = core.insert(GlyphKey(cluster: "new"), width: Self.glyph, height: Self.glyph)  // 制造压力
        core.frameBoundary()  // 驱逐 LRU = page1

        // page1（g4..g7）被驱逐，page0（g0..g3）存活。
        #expect(core.peek(GlyphKey(cluster: "g4")) == nil)
        #expect(core.peek(GlyphKey(cluster: "g0")) != nil)
        #expect(core.pageGeneration(.mask, 1) == 1)
        #expect(core.pageGeneration(.mask, 0) == 0)
    }

    @Test("mask 与 color 走不同页种，互不挤占")
    func maskAndColorSeparatePages() {
        var core = GlyphAtlasCore(pageDim: Self.dim, maxMaskPages: 2, maxColorPages: 2)
        let m = core.insert(GlyphKey(cluster: "A", color: false), width: Self.glyph, height: Self.glyph)
        let c = core.insert(GlyphKey(cluster: "😀", color: true), width: Self.glyph, height: Self.glyph)
        #expect(m?.kind == .mask)
        #expect(c?.kind == .color)
        #expect(core.pageCount(.mask) == 1)
        #expect(core.pageCount(.color) == 1)
    }

    @Test("超单页容量的字形直接放弃，不触发驱逐压力")
    func oversizedGlyphRejectedNoPressure() {
        var core = GlyphAtlasCore(pageDim: Self.dim, maxMaskPages: 2, maxColorPages: 1)
        let e = core.insert(GlyphKey(cluster: "big"), width: Self.dim, height: Self.dim)
        #expect(e == nil)
        core.frameBoundary()
        #expect(core.pageEvictionCount == 0)
    }

    @Test("命中查询 touch 帧号，未命中返回 nil")
    func lookupTouchesFrame() {
        var core = GlyphAtlasCore(pageDim: Self.dim, maxMaskPages: 2, maxColorPages: 1)
        #expect(core.lookup(GlyphKey(cluster: "x")) == nil)  // 未插入 → miss
        _ = core.insert(GlyphKey(cluster: "x"), width: Self.glyph, height: Self.glyph)
        core.frameBoundary()  // 帧 1
        let hit = core.lookup(GlyphKey(cluster: "x"))
        #expect(hit != nil)
        #expect(hit?.lastUsedFrame == 1)
    }
}
