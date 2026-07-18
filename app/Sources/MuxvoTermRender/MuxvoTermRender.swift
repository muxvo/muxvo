// MuxvoTermRender：Metal 渲染层（TerminalSurfaceView / GlyphCache / FontConfig / Theme）。
// 依赖 MuxvoTerm + MuxvoKit，链 Metal/MetalKit/CoreText/QuartzCore/AppKit。
//
// M3 批 2③ 已落地：GlyphCache 多页 LRU（GlyphAtlasCore/GlyphRasterizer/GlyphTexturePage/
//   GlyphCacheRegistry）+ FontConfig 度量 + Theme/vt option 装配（合同③）。
// 待批 3（C1）：TerminalSurfaceView + TerminalSurfaceProviding 实现。
import MuxvoKit
import MuxvoTerm

public enum MuxvoTermRenderInfo {
    /// 模块版本号（随实装内容演进）。
    public static let version = "0.2.0"
}
