// TerminalRenderer：三批实例 → Metal 编码/呈现（terminal-rendering.md §1）。
//
// 手法平移探针 TerminalMetalView 的 shader / QuadInstance / blend / 三批 draw，但抽成独立对象：
// 视图（TerminalSurfaceView）持有一个 renderer，draw 路径委托它 build+encode；离屏 readback
// （GPU 用例 + 终端 golden 工具）走同一 encode 路径，保证「测的就是产品渲染路径」。
//
// device==nil（CI 无 GPU）：pipeline/commandQueue 皆 nil，buildInstances 仍可跑（GlyphCache 装箱
// 不需 GPU），encode/renderOffscreen 直接 no-op/返回 nil——纯逻辑断言不受影响。
import Metal
import MuxvoTerm
import MetalKit
import simd

@MainActor
final class TerminalRenderer {
    /// 当前字形缓存（scale 变化时视图换新实例；builder 每帧从此读度量/装箱）。
    var glyphCache: GlyphCache

    let device: MTLDevice?
    private let commandQueue: MTLCommandQueue?
    private let pipeline: MTLRenderPipelineState?
    /// mode==0（实心）draw 也需绑定一张纹理满足校验；1×1 占位，绝不被采样。
    private let fallbackTexture: MTLTexture?

    static let colorPixelFormat: MTLPixelFormat = .bgra8Unorm

    init(glyphCache: GlyphCache, device: MTLDevice?) {
        self.glyphCache = glyphCache
        self.device = device
        guard let device else {
            commandQueue = nil; pipeline = nil; fallbackTexture = nil
            return
        }
        commandQueue = device.makeCommandQueue()
        pipeline = Self.makePipeline(device: device)
        let d = MTLTextureDescriptor.texture2DDescriptor(
            pixelFormat: .r8Unorm, width: 1, height: 1, mipmapped: false)
        d.usage = [.shaderRead]
        d.storageMode = .shared
        fallbackTexture = device.makeTexture(descriptor: d)
    }

    var canRender: Bool { pipeline != nil && commandQueue != nil }

    // MARK: - 构建（纯逻辑，无 GPU）

    func buildInstances(_ snapshot: TerminalFrameSnapshot, cursorMode: CursorRenderMode) -> FrameInstances {
        TerminalInstanceBuilder(glyphCache: glyphCache).build(snapshot, cursorMode: cursorMode)
    }

    // MARK: - 编码（视图 draw 与离屏 readback 共用）

    /// 把三批实例编码进给定 render pass。commandBuffer 由调用方 present/commit（视图）或 commit+wait（离屏）。
    /// originYPx（m3-layout-r5 F6 钳制锚底）：viewport 原点上移量——内容坐标空间经 MTLViewport 负 y
    /// 原点整体上移，NDC→窗口保持 1:1 像素、露出底部行；默认 0 且 viewportSizePx==drawable 时
    /// 与缺省全 drawable 视口逐像素一致（离屏 readback 等既有调用方不受影响）。
    func encode(_ f: FrameInstances, viewportSizePx: SIMD2<Float>, originYPx: Float = 0,
                descriptor: MTLRenderPassDescriptor, commandBuffer cb: MTLCommandBuffer) {
        guard let pipeline, let enc = cb.makeRenderCommandEncoder(descriptor: descriptor) else { return }
        enc.setRenderPipelineState(pipeline)
        enc.setViewport(MTLViewport(originX: 0, originY: -Double(originYPx),
                                    width: Double(viewportSizePx.x), height: Double(viewportSizePx.y),
                                    znear: 0, zfar: 1))
        enc.setFragmentTexture(fallbackTexture, index: 0)

        // 背景批：atlas 维度无关（mode 0 不采样），uniform 填占位 1。
        setUniforms(enc, viewport: viewportSizePx, atlas: 1)
        drawInstances(f.background, enc: enc)

        // 字形批：每页绑该页纹理、按纹理实际维度设 atlas uniform（uv 归一化）。
        for batch in f.glyphBatches {
            guard let tex = glyphCache.texture(kind: batch.kind, page: batch.page) else { continue }
            enc.setFragmentTexture(tex, index: 0)
            setUniforms(enc, viewport: viewportSizePx, atlas: Float(tex.width))
            drawInstances(batch.instances, enc: enc)
        }

        // 光标批：mode 0（含反色字形 mode 1，其纹理沿用最后绑定的字形页——反色字形必落已绑定页）。
        drawInstances(f.cursor, enc: enc)
        enc.endEncoding()
    }

    /// 离屏渲一帧到新纹理并 readback（bgra8，行紧密）。device==nil 返回 nil。GPU 用例 / golden 工具用。
    func renderOffscreen(_ snapshot: TerminalFrameSnapshot, cursorMode: CursorRenderMode,
                         widthPx: Int, heightPx: Int) -> (bytes: [UInt8], generation: UInt64)? {
        guard let device, let commandQueue, canRender, widthPx > 0, heightPx > 0 else { return nil }
        let d = MTLTextureDescriptor.texture2DDescriptor(
            pixelFormat: Self.colorPixelFormat, width: widthPx, height: heightPx, mipmapped: false)
        d.usage = [.renderTarget, .shaderRead]
        d.storageMode = .shared
        guard let target = device.makeTexture(descriptor: d) else { return nil }

        let rpd = MTLRenderPassDescriptor()
        rpd.colorAttachments[0].texture = target
        rpd.colorAttachments[0].loadAction = .clear
        rpd.colorAttachments[0].storeAction = .store
        let bg = snapshot.colors.background
        rpd.colorAttachments[0].clearColor = MTLClearColor(
            red: Double(bg.r) / 255, green: Double(bg.g) / 255, blue: Double(bg.b) / 255, alpha: 1)

        let instances = buildInstances(snapshot, cursorMode: cursorMode)
        guard let cb = commandQueue.makeCommandBuffer() else { return nil }
        encode(instances, viewportSizePx: SIMD2(Float(widthPx), Float(heightPx)),
               descriptor: rpd, commandBuffer: cb)
        cb.commit()
        cb.waitUntilCompleted()

        var bytes = [UInt8](repeating: 0, count: widthPx * heightPx * 4)
        bytes.withUnsafeMutableBytes { raw in
            target.getBytes(raw.baseAddress!, bytesPerRow: widthPx * 4,
                            from: MTLRegionMake2D(0, 0, widthPx, heightPx), mipmapLevel: 0)
        }
        glyphCache.frameBoundary()
        return (bytes, instances.generation)
    }

    // MARK: - 私有

    private func setUniforms(_ enc: MTLRenderCommandEncoder, viewport: SIMD2<Float>, atlas: Float) {
        var uni = SIMD4<Float>(viewport.x, viewport.y, atlas, atlas)
        enc.setVertexBytes(&uni, length: MemoryLayout<SIMD4<Float>>.size, index: 1)
    }

    /// 小批走 setVertexBytes（≤64 实例/4KB），大批走 makeBuffer。
    private func drawInstances(_ instances: [QuadInstance], enc: MTLRenderCommandEncoder) {
        guard !instances.isEmpty else { return }
        let len = instances.count * MemoryLayout<QuadInstance>.stride
        if len <= 4096 {
            var arr = instances
            enc.setVertexBytes(&arr, length: len, index: 0)
        } else if let buf = device?.makeBuffer(bytes: instances, length: len, options: .storageModeShared) {
            enc.setVertexBuffer(buf, offset: 0, index: 0)
        } else {
            return
        }
        enc.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 4, instanceCount: instances.count)
    }

    private static func makePipeline(device: MTLDevice) -> MTLRenderPipelineState? {
        guard let lib = try? device.makeLibrary(source: shaderSource, options: nil) else { return nil }
        let desc = MTLRenderPipelineDescriptor()
        desc.vertexFunction = lib.makeFunction(name: "quad_vertex")
        desc.fragmentFunction = lib.makeFunction(name: "quad_fragment")
        guard let att = desc.colorAttachments[0] else { return nil }
        att.pixelFormat = colorPixelFormat
        att.isBlendingEnabled = true
        att.rgbBlendOperation = .add
        att.alphaBlendOperation = .add
        att.sourceRGBBlendFactor = .one            // 预乘 alpha（fragment 已乘）
        att.sourceAlphaBlendFactor = .one
        att.destinationRGBBlendFactor = .oneMinusSourceAlpha
        att.destinationAlphaBlendFactor = .oneMinusSourceAlpha
        return try? device.makeRenderPipelineState(descriptor: desc)
    }
}

// MARK: - MSL（逐字段对齐 QuadInstance，手法平移探针）

private let shaderSource = """
#include <metal_stdlib>
using namespace metal;
struct QuadInstance { float4 rect; float4 uvPx; float4 color; uint4 mode; };
struct Uniforms { float2 viewport; float2 atlas; };
struct VSOut { float4 pos [[position]]; float2 uv; float4 color; uint mode [[flat]]; };
vertex VSOut quad_vertex(uint vid [[vertex_id]], uint iid [[instance_id]],
        const device QuadInstance* instances [[buffer(0)]],
        constant Uniforms& u [[buffer(1)]]) {
    QuadInstance q = instances[iid];
    float2 corner = float2(float(vid & 1u), float(vid >> 1u));
    float2 px = q.rect.xy + corner * q.rect.zw;
    VSOut out;
    out.pos = float4(px.x / u.viewport.x * 2.0 - 1.0, 1.0 - px.y / u.viewport.y * 2.0, 0.0, 1.0);
    out.uv = (q.uvPx.xy + corner * q.uvPx.zw) / u.atlas;
    out.color = q.color;
    out.mode = q.mode.x;
    return out;
}
fragment float4 quad_fragment(VSOut in [[stage_in]], texture2d<float> atlas [[texture(0)]]) {
    constexpr sampler s(coord::normalized, filter::nearest);
    if (in.mode == 0u) return float4(in.color.rgb * in.color.a, in.color.a);
    float4 t = atlas.sample(s, in.uv);
    if (in.mode == 1u) return float4(in.color.rgb, 1.0) * t.r * in.color.a;
    return t * in.color.a;
}
"""
