// GlyphTexturePage：薄 Metal 纹理层——一页 → 一张 MTLTexture，按矩形上传。
//
// mask 页 = R8Unorm（1B/px 灰度）；color 页 = RGBA8Unorm。存储 .shared（CPU 直写，探针同款）。
// 触 Metal 的全部用例守 device==nil 即跳过（CI VM 无 GPU）——本类型只在 device 非 nil 时构造。
import Foundation
import Metal

@MainActor
final class GlyphTexturePage {
    let kind: GlyphPageKind
    let dim: Int
    let texture: MTLTexture

    init?(device: MTLDevice, kind: GlyphPageKind, dim: Int) {
        self.kind = kind
        self.dim = dim
        let desc = MTLTextureDescriptor.texture2DDescriptor(
            pixelFormat: kind == .mask ? .r8Unorm : .rgba8Unorm,
            width: dim, height: dim, mipmapped: false)
        desc.usage = [.shaderRead]
        desc.storageMode = .shared
        guard let t = device.makeTexture(descriptor: desc) else { return nil }
        self.texture = t
    }

    /// 把一块位图上传到页内矩形。data 必须与本页像素格式匹配（mask=1B/px，color=4B/px）。
    func upload(rect: GlyphRect, bytes: [UInt8], bytesPerRow: Int) {
        bytes.withUnsafeBytes { raw in
            guard let base = raw.baseAddress else { return }
            texture.replace(
                region: MTLRegionMake2D(rect.x, rect.y, rect.w, rect.h),
                mipmapLevel: 0, withBytes: base, bytesPerRow: bytesPerRow)
        }
    }
}
