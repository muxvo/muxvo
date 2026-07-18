// GlyphCache：编排 纯逻辑核（GlyphAtlasCore）+ 栅格层（GlyphRasterizer）+ 纹理层（GlyphTexturePage）。
//
// 权威 terminal-rendering.md §3。合同③归属：app 级共享（按 字体描述符+字号+scale keyed），
// sidebar 小预览用同一 atlas 走变换缩放绘制、不另建小字号页——见 GlyphCacheRegistry。
//
// device 可为 nil（CI 无 GPU / 纯逻辑测试）：此时栅格与装箱照常，仅跳过纹理上传（纹理页留空）。
// 主线程访问（渲染在主线程），@MainActor 隔离，无锁（合同③ + 探针「仅主线程」纪律）。
import Foundation
import Metal

@MainActor
public final class GlyphCache {
    public let font: FontConfig
    public let scale: CGFloat
    public var metrics: CellMetrics { rasterizer.metrics }

    private var core: GlyphAtlasCore
    private let rasterizer: GlyphRasterizer
    private let device: MTLDevice?
    // 与 core 的 maskPages/colorPages 平行；页号一致，驱逐后纹理复用（区域覆盖写）。
    private var maskTextures: [GlyphTexturePage] = []
    private var colorTextures: [GlyphTexturePage] = []

    public init(font: FontConfig = FontConfig(),
                scale: CGFloat = 2,
                device: MTLDevice? = MTLCreateSystemDefaultDevice(),
                pageDim: Int = 1024,
                maxMaskPages: Int = 8,
                maxColorPages: Int = 4) {
        self.font = font
        self.scale = scale
        self.device = device
        self.core = GlyphAtlasCore(pageDim: pageDim, maxMaskPages: maxMaskPages, maxColorPages: maxColorPages)
        self.rasterizer = GlyphRasterizer(font: font, scale: scale)
    }

    /// 取一个字形的落位。命中零栅格；未命中栅格后装箱并（若有 device）上传纹理。
    /// 返回 nil：空白簇 / 本帧 atlas 满（驱逐留到帧边界，调用方本帧回退）/ 字形超单页容量。
    @discardableResult
    public func glyph(_ key: GlyphKey) -> GlyphEntry? {
        if let hit = core.lookup(key) { return hit }
        guard let ras = rasterizer.rasterize(key) else { return nil }
        // 栅格判定的彩色属性回填到键，确保落对页种（mask/color）。
        let resolvedKey = GlyphKey(cluster: key.cluster, bold: key.bold, italic: key.italic,
                                   color: ras.kind == .color)
        if resolvedKey.color != key.color, let hit = core.lookup(resolvedKey) { return hit }
        guard let entry = core.insert(resolvedKey, width: ras.width, height: ras.height) else { return nil }
        upload(entry: entry, ras: ras)
        return entry
    }

    /// 帧边界：驱逐（若有压力）+ 帧号推进。渲染器每帧收尾调用一次。
    public func frameBoundary() { core.frameBoundary() }

    // MARK: 计数器 / 帧号（合同③断言 + bench 打点）

    public var fullRebuildCount: Int { core.fullRebuildCount }
    public var pageEvictionCount: Int { core.pageEvictionCount }
    public var frame: UInt64 { core.frame }
    public func pageCount(_ kind: GlyphPageKind) -> Int { core.pageCount(kind) }
    public var hasDevice: Bool { device != nil }

    /// 指定页的纹理（device==nil 或页未实体化则 nil）——Metal 用例断言用。
    public func texture(kind: GlyphPageKind, page: Int) -> MTLTexture? {
        let arr = kind == .mask ? maskTextures : colorTextures
        return page < arr.count ? arr[page].texture : nil
    }

    // MARK: 纹理上传

    private func upload(entry: GlyphEntry, ras: RasterizedGlyph) {
        guard let device else { return }
        ensureTexturePage(kind: entry.kind, page: entry.page, device: device)
        let arr = entry.kind == .mask ? maskTextures : colorTextures
        guard entry.page < arr.count else { return }
        arr[entry.page].upload(rect: entry.rect, bytes: ras.data, bytesPerRow: ras.bytesPerRow)
    }

    /// 惰性实体化到 page 号（core 加新页时纹理页随之补齐；驱逐不删纹理，页号复用）。
    private func ensureTexturePage(kind: GlyphPageKind, page: Int, device: MTLDevice) {
        switch kind {
        case .mask:
            while maskTextures.count <= page {
                guard let p = GlyphTexturePage(device: device, kind: .mask, dim: core.pageDim) else { return }
                maskTextures.append(p)
            }
        case .color:
            while colorTextures.count <= page {
                guard let p = GlyphTexturePage(device: device, kind: .color, dim: core.pageDim) else { return }
                colorTextures.append(p)
            }
        }
    }
}

// MARK: - app 级共享（合同③归属）

/// 按 (family, size, scale) 缓存 GlyphCache 实例，全 app 共享。sidebar 小预览不另建实例、
/// 不另建小字号页——复用同 scale 的主 atlas，缩放在绘制侧做（terminal-rendering.md §3 归属）。
@MainActor
public final class GlyphCacheRegistry {
    public static let shared = GlyphCacheRegistry()

    private struct Key: Hashable {
        let family: String
        let size: Double
        let scale: Double
    }

    private var caches: [Key: GlyphCache] = [:]

    public init() {}

    /// 取（或建）指定字体+scale 的共享缓存。相同 key 返回同一实例。
    public func cache(font: FontConfig = FontConfig(),
                      scale: CGFloat = 2,
                      device: MTLDevice? = MTLCreateSystemDefaultDevice()) -> GlyphCache {
        let key = Key(family: font.family, size: Double(font.size), scale: Double(scale))
        if let existing = caches[key] { return existing }
        let c = GlyphCache(font: font, scale: scale, device: device)
        caches[key] = c
        return c
    }

    /// 清空（测试隔离 / app 主题切换重建）。
    public func removeAll() { caches.removeAll() }
}
