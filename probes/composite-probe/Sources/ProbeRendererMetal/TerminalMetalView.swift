// TerminalMetalView：最小 Metal 终端渲染器（探针级，验证 Track B 可行性）。
// - 「视图」可随时 attach/detach「会话」（TerminalSession），render state 归视图所有
// - 消费 libghostty-vt render_state API：update 时短暂占用 terminal（会话队列 sync），
//   读取阶段无锁——这正是会话/视图分离的内核结构
// - 双层 dirty：全局 FULL/PARTIAL/FALSE + 行级 dirty，只重建脏行的 instance
// - 渲染：bg 实心 quad + glyph 纹理 quad（GlyphAtlas）+ 光标，单 pipeline 三批 draw
// - 指标：帧间隔（draw 调用间隔）、编码 CPU 耗时、GPU 耗时、attach 首帧延迟
import AppKit
import CGhosttyVT
import Metal
import MetalKit
import ProbeCore

// 与 shader 中 QuadInstance 逐字段对应（64B）
struct QuadInstance {
    var rect: SIMD4<Float> // x,y,w,h（像素）
    var uvPx: SIMD4<Float> // atlas 像素矩形（mode!=0 时有效）
    var color: SIMD4<Float>
    var mode: SIMD4<UInt32> // x: 0=实心 1=mask tint 2=彩色纹理
}

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
    if (in.mode == 1u) return float4(in.color.rgb, 1.0) * t.a * in.color.a;
    return t * in.color.a; // 彩色字形（emoji），预乘 alpha
}
"""

/// render state 三句柄的生命周期容器：deinit 统一释放，规避 @MainActor 类
/// 在 nonisolated deinit 里碰非 Sendable 存储属性的限制。
final class RenderHandles: @unchecked Sendable {
    let state: OpaquePointer
    let iter: OpaquePointer
    let cells: OpaquePointer

    init?() {
        var st: OpaquePointer?
        guard ghostty_render_state_new(nil, &st) == GHOSTTY_SUCCESS, let st else { return nil }
        var it: OpaquePointer?
        guard ghostty_render_state_row_iterator_new(nil, &it) == GHOSTTY_SUCCESS, let it else {
            ghostty_render_state_free(st)
            return nil
        }
        var ce: OpaquePointer?
        guard ghostty_render_state_row_cells_new(nil, &ce) == GHOSTTY_SUCCESS, let ce else {
            ghostty_render_state_free(st)
            ghostty_render_state_row_iterator_free(it)
            return nil
        }
        self.state = st
        self.iter = it
        self.cells = ce
    }

    deinit {
        ghostty_render_state_row_cells_free(cells)
        ghostty_render_state_row_iterator_free(iter)
        ghostty_render_state_free(state)
    }
}

/// 跨线程指标盒：draw（主线程）写入帧间隔/编码耗时，GPU completed handler（Metal 线程）写入 GPU 耗时。
final class MetricsBox: @unchecked Sendable {
    private let lock = NSLock()
    private var metrics = FrameMetrics()

    func addInterval(_ ms: Double) { lock.withLock { metrics.addInterval(ms) } }
    func addEncode(_ ms: Double) { lock.withLock { metrics.addEncode(ms) } }
    func addGPU(_ ms: Double) { lock.withLock { metrics.addGPU(ms) } }
    func addFirstFrame(_ ms: Double) { lock.withLock { metrics.addFirstFrame(ms) } }

    func snapshot(reset: Bool) -> FrameMetrics {
        lock.withLock {
            let m = metrics
            if reset { metrics.reset() }
            return m
        }
    }
}

// spike(composite-probe): input→pixel 打点专用锁盒（term-probe 原文无此类型）。
// draw（主线程）设标记 t0，GPU completedHandler（Metal 线程）写入 send→pixel 延迟。
final class InputLatencyBox: @unchecked Sendable {
    private let lock = NSLock()
    private var samplesMS: [Double] = []
    func add(_ ms: Double) { lock.withLock { samplesMS.append(ms) } }
    func snapshot(reset: Bool) -> [Double] {
        lock.withLock { let c = samplesMS; if reset { samplesMS.removeAll() }; return c }
    }
}

@MainActor
public final class TerminalMetalView: MTKView {
    public private(set) var session: TerminalSession?
    public let viewID: Int

    private let atlas: GlyphAtlas
    private var atlasGeneration = 0
    private var commandQueue: MTLCommandQueue
    private var pipeline: MTLRenderPipelineState

    // render state C 句柄组（attach 时建，detach/销毁时整组释放）
    private var handles: RenderHandles?
    private var renderState: OpaquePointer? { handles?.state }
    private var rowIter: OpaquePointer? { handles?.iter }
    private var rowCells: OpaquePointer? { handles?.cells }

    // 行级 instance 缓存
    private var bgRows: [[QuadInstance]] = []
    private var glyphRows: [[QuadInstance]] = []
    private var needFlatten = true
    private var forceFullRebuild = true
    private var bgBuffer: MTLBuffer?
    private var bgCount = 0
    private var glyphBuffer: MTLBuffer?
    private var glyphCount = 0

    private var defaultBg = GhosttyColorRgb(r: 0, g: 0, b: 0)
    private var defaultFg = GhosttyColorRgb(r: 255, g: 255, b: 255)
    private var utf8Buf = [UInt8](repeating: 0, count: 256)

    /// 双视图共享同一会话时置 true：ghostty_render_state_update 会「消费」terminal
    /// 的 dirty 状态，两个 render state 各自 update 会互抢脏行导致另一个漏更新。
    /// 探针实证解法 = 共享会话的视图放弃增量、每帧全量重建（正式版应改为
    /// render state 归会话所有、多视图共读）。
    public var alwaysFullRebuild = false

    let metricsBox = MetricsBox()
    // spike(composite-probe): input→pixel 打点。markInputNow() 记 t0，本帧若真正重建过
    // 行（rebuiltThisFrame）则挂 completedHandler 记 send→pixel 延迟。默认不激活（仅
    // input_to_pixel 草测阶段调 markInputNow），不影响帧间隔/内存测量。
    private let inputLatencyBox = InputLatencyBox()
    private var pendingInputT0: DispatchTime?
    private var rebuiltThisFrame = false
    public func markInputNow() { pendingInputT0 = DispatchTime.now() }
    public func inputLatencySnapshot(reset: Bool = false) -> [Double] {
        inputLatencyBox.snapshot(reset: reset)
    }
    private var lastDrawAt: DispatchTime?
    private var attachAt: DispatchTime?
    private var awaitingFirstFrame = false
    /// 内容曾经上屏（首帧判定要求至少建出过非空 instance 或完成一次 FULL 重建）
    private var renderedOnce = false

    public init(frame: CGRect, device: MTLDevice, atlas: GlyphAtlas, viewID: Int = 0) {
        self.atlas = atlas
        self.viewID = viewID
        self.commandQueue = device.makeCommandQueue()!
        let lib = try! device.makeLibrary(source: shaderSource, options: nil)
        let desc = MTLRenderPipelineDescriptor()
        desc.vertexFunction = lib.makeFunction(name: "quad_vertex")
        desc.fragmentFunction = lib.makeFunction(name: "quad_fragment")
        let att = desc.colorAttachments[0]!
        att.pixelFormat = .bgra8Unorm
        att.isBlendingEnabled = true
        att.rgbBlendOperation = .add
        att.alphaBlendOperation = .add
        att.sourceRGBBlendFactor = .one
        att.sourceAlphaBlendFactor = .one
        att.destinationRGBBlendFactor = .oneMinusSourceAlpha
        att.destinationAlphaBlendFactor = .oneMinusSourceAlpha
        self.pipeline = try! device.makeRenderPipelineState(descriptor: desc)

        super.init(frame: frame, device: device)
        colorPixelFormat = .bgra8Unorm
        framebufferOnly = true
        isPaused = false
        enableSetNeedsDisplay = false
        preferredFramesPerSecond = 60 // ProMotion 屏钉 60Hz（KPI 锚定 16.7ms）
        clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 1)
    }

    @available(*, unavailable)
    required init(coder: NSCoder) { fatalError() }

    // MARK: - attach/detach

    public func attach(_ s: TerminalSession) {
        detachSession()
        guard let h = RenderHandles() else { return }
        handles = h
        session = s
        forceFullRebuild = true
        renderedOnce = false
        awaitingFirstFrame = true
        attachAt = DispatchTime.now()
    }

    public func detachSession() {
        session = nil
        handles = nil // RenderHandles.deinit 释放 C 句柄
        bgRows = []
        glyphRows = []
        bgBuffer = nil
        glyphBuffer = nil
        bgCount = 0
        glyphCount = 0
        awaitingFirstFrame = false
    }

    /// 当前 bounds 能容纳的网格（attach 时由场景控制器据此做尺寸仲裁）
    public func gridForCurrentSize() -> (cols: UInt16, rows: UInt16) {
        let scale = window?.backingScaleFactor ?? 2
        let wPx = bounds.width * scale
        let hPx = bounds.height * scale
        let cols = max(2, Int(wPx) / atlas.cellW)
        let rows = max(2, Int(hPx) / atlas.cellH)
        return (UInt16(min(cols, 1000)), UInt16(min(rows, 1000)))
    }

    public func snapshotMetrics(reset: Bool = false) -> FrameMetrics {
        metricsBox.snapshot(reset: reset)
    }

    /// 状态级内容校验用：经 render state 逐行读回可见文本（与渲染同一数据通路）。
    /// 会触发一次 update（消费 dirty），仅用于校验场景。
    public func visibleTextLines() -> [String] {
        guard let session, let st = renderState else { return [] }
        session.updateRenderState(st)
        var it = rowIter
        guard ghostty_render_state_get(st, GHOSTTY_RENDER_STATE_DATA_ROW_ITERATOR, &it) == GHOSTTY_SUCCESS else {
            return []
        }
        var lines: [String] = []
        while ghostty_render_state_row_iterator_next(it) {
            var ce = rowCells
            guard ghostty_render_state_row_get(it, GHOSTTY_RENDER_STATE_ROW_DATA_CELLS, &ce) == GHOSTTY_SUCCESS else {
                lines.append("")
                continue
            }
            var line = ""
            while ghostty_render_state_row_cells_next(ce) {
                var glen: UInt32 = 0
                ghostty_render_state_row_cells_get(ce, GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_GRAPHEMES_LEN, &glen)
                if glen == 0 {
                    line += " "
                } else {
                    line += readClusterUTF8(ce) ?? ""
                }
            }
            lines.append(line)
        }
        forceFullRebuild = true // dirty 已被本次读取消费，下一帧全量重建补偿
        return lines
    }

    // MARK: - draw

    override public func draw(_ dirtyRect: NSRect) {
        autoreleasepool {
            renderFrame()
        }
    }

    private func renderFrame() {
        let frameStart = DispatchTime.now()
        if let last = lastDrawAt {
            metricsBox.addInterval(Double(frameStart.uptimeNanoseconds - last.uptimeNanoseconds) / 1e6)
        }
        lastDrawAt = frameStart

        rebuiltThisFrame = false // spike(composite-probe): input→pixel 打点用
        updateAndRebuild()
        flattenIfNeeded()

        guard let rpd = currentRenderPassDescriptor,
              let drawable = currentDrawable,
              let cb = commandQueue.makeCommandBuffer()
        else { return }

        if let enc = cb.makeRenderCommandEncoder(descriptor: rpd) {
            enc.setRenderPipelineState(pipeline)
            var uni = SIMD4<Float>(
                Float(drawableSize.width), Float(drawableSize.height),
                Float(GlyphAtlas.textureSize), Float(GlyphAtlas.textureSize))
            enc.setVertexBytes(&uni, length: MemoryLayout<SIMD4<Float>>.size, index: 1)
            enc.setFragmentTexture(atlas.texture, index: 0)
            if bgCount > 0, let b = bgBuffer {
                enc.setVertexBuffer(b, offset: 0, index: 0)
                enc.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 4, instanceCount: bgCount)
            }
            if glyphCount > 0, let b = glyphBuffer {
                enc.setVertexBuffer(b, offset: 0, index: 0)
                enc.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 4, instanceCount: glyphCount)
            }
            if var cursor = cursorInstance() {
                enc.setVertexBytes(&cursor, length: MemoryLayout<QuadInstance>.size, index: 0)
                enc.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 4, instanceCount: 1)
            }
            enc.endEncoding()
        }

        // spike(composite-probe): 本帧真正重建过 → 记 send→pixel 延迟
        if let it0 = pendingInputT0, rebuiltThisFrame {
            pendingInputT0 = nil
            let ibox = inputLatencyBox
            cb.addCompletedHandler { @Sendable _ in
                ibox.add(Double(DispatchTime.now().uptimeNanoseconds - it0.uptimeNanoseconds) / 1e6)
            }
        }

        let box = metricsBox
        if awaitingFirstFrame, renderedOnce, let t0 = attachAt {
            awaitingFirstFrame = false
            cb.addCompletedHandler { @Sendable _ in
                box.addFirstFrame(Double(DispatchTime.now().uptimeNanoseconds - t0.uptimeNanoseconds) / 1e6)
            }
        }
        cb.addCompletedHandler { @Sendable c in
            let gpu = (c.gpuEndTime - c.gpuStartTime) * 1000
            if gpu > 0 { box.addGPU(gpu) }
        }
        cb.present(drawable)
        cb.commit()
        metricsBox.addEncode(Double(DispatchTime.now().uptimeNanoseconds - frameStart.uptimeNanoseconds) / 1e6)
    }

    // MARK: - render state 消费

    private func updateAndRebuild() {
        guard let session, let st = renderState else { return }
        session.updateRenderState(st)

        var dirty = GHOSTTY_RENDER_STATE_DIRTY_FALSE
        ghostty_render_state_get(st, GHOSTTY_RENDER_STATE_DATA_DIRTY, &dirty)

        var cols: UInt16 = 0
        var rows: UInt16 = 0
        ghostty_render_state_get(st, GHOSTTY_RENDER_STATE_DATA_COLS, &cols)
        ghostty_render_state_get(st, GHOSTTY_RENDER_STATE_DATA_ROWS, &rows)
        guard cols > 0, rows > 0 else { return }

        var colors = GhosttyRenderStateColors()
        colors.size = MemoryLayout<GhosttyRenderStateColors>.size
        if ghostty_render_state_colors_get(st, &colors) == GHOSTTY_SUCCESS {
            defaultBg = colors.background
            defaultFg = colors.foreground
            clearColor = MTLClearColor(
                red: Double(defaultBg.r) / 255, green: Double(defaultBg.g) / 255,
                blue: Double(defaultBg.b) / 255, alpha: 1)
        }

        if atlas.generation != atlasGeneration {
            atlasGeneration = atlas.generation
            forceFullRebuild = true
        }
        if bgRows.count != Int(rows) {
            bgRows = Array(repeating: [], count: Int(rows))
            glyphRows = Array(repeating: [], count: Int(rows))
            forceFullRebuild = true
        }
        let full = forceFullRebuild || alwaysFullRebuild || dirty == GHOSTTY_RENDER_STATE_DIRTY_FULL
        if dirty == GHOSTTY_RENDER_STATE_DIRTY_FALSE && !full { return }

        // 行迭代：populate 预分配 iterator
        var it = rowIter
        guard ghostty_render_state_get(st, GHOSTTY_RENDER_STATE_DATA_ROW_ITERATOR, &it) == GHOSTTY_SUCCESS else { return }
        var y = 0
        while ghostty_render_state_row_iterator_next(it) {
            defer { y += 1 }
            guard y < Int(rows) else { break }
            var rowDirty = false
            ghostty_render_state_row_get(it, GHOSTTY_RENDER_STATE_ROW_DATA_DIRTY, &rowDirty)
            guard full || rowDirty else { continue }
            buildRow(y: y, iter: it, colors: colors)
            var clean = false
            ghostty_render_state_row_set(it, GHOSTTY_RENDER_STATE_ROW_OPTION_DIRTY, &clean)
            needFlatten = true
        }
        var cleanState = GHOSTTY_RENDER_STATE_DIRTY_FALSE
        ghostty_render_state_set(st, GHOSTTY_RENDER_STATE_OPTION_DIRTY, &cleanState)
        forceFullRebuild = false
        renderedOnce = true
        rebuiltThisFrame = true // spike(composite-probe): 本帧走过重建路径
    }

    private func buildRow(y: Int, iter: OpaquePointer?, colors: GhosttyRenderStateColors) {
        var bgs: [QuadInstance] = []
        var gls: [QuadInstance] = []
        let cw = Float(atlas.cellW)
        let chh = Float(atlas.cellH)
        let rowY = Float(y) * chh

        var ce = rowCells
        guard ghostty_render_state_row_get(iter, GHOSTTY_RENDER_STATE_ROW_DATA_CELLS, &ce) == GHOSTTY_SUCCESS else {
            bgRows[y] = []
            glyphRows[y] = []
            return
        }
        var x = -1
        while ghostty_render_state_row_cells_next(ce) {
            x += 1
            let cellX = Float(x) * cw

            var hasStyling = false
            ghostty_render_state_row_cells_get(ce, GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_HAS_STYLING, &hasStyling)
            var bold = false
            var italic = false
            var inverse = false
            var invisible = false
            var faint = false
            var underline = false
            var strike = false
            if hasStyling {
                var style = GhosttyStyle()
                style.size = MemoryLayout<GhosttyStyle>.size
                if ghostty_render_state_row_cells_get(ce, GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_STYLE, &style) == GHOSTTY_SUCCESS {
                    bold = style.bold
                    italic = style.italic
                    inverse = style.inverse
                    invisible = style.invisible
                    faint = style.faint
                    underline = style.underline != 0
                    strike = style.strikethrough
                }
            }

            var fg = defaultFg
            var bgOpt: GhosttyColorRgb?
            var c = GhosttyColorRgb(r: 0, g: 0, b: 0)
            if ghostty_render_state_row_cells_get(ce, GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_BG_COLOR, &c) == GHOSTTY_SUCCESS {
                bgOpt = c
            }
            if ghostty_render_state_row_cells_get(ce, GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_FG_COLOR, &c) == GHOSTTY_SUCCESS {
                fg = c
            }
            if inverse {
                let f = fg
                fg = bgOpt ?? defaultBg
                bgOpt = f
            }

            if let bg = bgOpt, bg.r != defaultBg.r || bg.g != defaultBg.g || bg.b != defaultBg.b {
                bgs.append(QuadInstance(
                    rect: SIMD4(cellX, rowY, cw, chh),
                    uvPx: .zero,
                    color: SIMD4(Float(bg.r) / 255, Float(bg.g) / 255, Float(bg.b) / 255, 1),
                    mode: SIMD4(0, 0, 0, 0)))
            }
            if invisible { continue }

            var glen: UInt32 = 0
            ghostty_render_state_row_cells_get(ce, GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_GRAPHEMES_LEN, &glen)
            let alpha: Float = faint ? 0.6 : 1.0
            let fgColor = SIMD4(Float(fg.r) / 255, Float(fg.g) / 255, Float(fg.b) / 255, alpha)

            if glen > 0, let cluster = readClusterUTF8(ce) {
                if let slot = atlas.slot(for: cluster, bold: bold, italic: italic) {
                    gls.append(QuadInstance(
                        rect: SIMD4(cellX, rowY, slot.uvPx.z, slot.uvPx.w),
                        uvPx: slot.uvPx,
                        color: slot.isColor ? SIMD4(1, 1, 1, alpha) : fgColor,
                        mode: SIMD4(slot.isColor ? 2 : 1, 0, 0, 0)))
                }
            }
            if underline {
                let h = max(1, chh * 0.06)
                bgs.append(QuadInstance(
                    rect: SIMD4(cellX, rowY + chh - h, cw, h),
                    uvPx: .zero, color: fgColor, mode: SIMD4(0, 0, 0, 0)))
            }
            if strike {
                let h = max(1, chh * 0.06)
                bgs.append(QuadInstance(
                    rect: SIMD4(cellX, rowY + chh * 0.52, cw, h),
                    uvPx: .zero, color: fgColor, mode: SIMD4(0, 0, 0, 0)))
            }
        }
        bgRows[y] = bgs
        glyphRows[y] = gls
    }

    private func readClusterUTF8(_ ce: OpaquePointer?) -> String? {
        let result: String? = utf8Buf.withUnsafeMutableBufferPointer { p in
            var gb = GhosttyBuffer(ptr: p.baseAddress, cap: p.count, len: 0)
            let rc = ghostty_render_state_row_cells_get(ce, GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_GRAPHEMES_UTF8, &gb)
            guard rc == GHOSTTY_SUCCESS, gb.len > 0 else { return nil }
            return String(decoding: UnsafeBufferPointer(start: p.baseAddress, count: gb.len), as: UTF8.self)
        }
        return result
    }

    private func cursorInstance() -> QuadInstance? {
        guard let st = renderState else { return nil }
        var visible = false
        ghostty_render_state_get(st, GHOSTTY_RENDER_STATE_DATA_CURSOR_VISIBLE, &visible)
        var inViewport = false
        ghostty_render_state_get(st, GHOSTTY_RENDER_STATE_DATA_CURSOR_VIEWPORT_HAS_VALUE, &inViewport)
        guard visible, inViewport else { return nil }
        var cx: UInt16 = 0
        var cy: UInt16 = 0
        ghostty_render_state_get(st, GHOSTTY_RENDER_STATE_DATA_CURSOR_VIEWPORT_X, &cx)
        ghostty_render_state_get(st, GHOSTTY_RENDER_STATE_DATA_CURSOR_VIEWPORT_Y, &cy)
        var style = GHOSTTY_RENDER_STATE_CURSOR_VISUAL_STYLE_BLOCK
        ghostty_render_state_get(st, GHOSTTY_RENDER_STATE_DATA_CURSOR_VISUAL_STYLE, &style)

        var color = defaultFg
        var hasColor = false
        ghostty_render_state_get(st, GHOSTTY_RENDER_STATE_DATA_COLOR_CURSOR_HAS_VALUE, &hasColor)
        if hasColor {
            ghostty_render_state_get(st, GHOSTTY_RENDER_STATE_DATA_COLOR_CURSOR, &color)
        }

        let cw = Float(atlas.cellW)
        let chh = Float(atlas.cellH)
        let cellX = Float(cx) * cw
        let cellY = Float(cy) * chh
        var rect = SIMD4(cellX, cellY, cw, chh)
        var alpha: Float = 0.85
        switch style {
        case GHOSTTY_RENDER_STATE_CURSOR_VISUAL_STYLE_BAR:
            rect = SIMD4(cellX, cellY, max(2, cw * 0.15), chh)
        case GHOSTTY_RENDER_STATE_CURSOR_VISUAL_STYLE_UNDERLINE:
            rect = SIMD4(cellX, cellY + chh * 0.9, cw, chh * 0.1)
        case GHOSTTY_RENDER_STATE_CURSOR_VISUAL_STYLE_BLOCK_HOLLOW:
            alpha = 0.4
        default:
            break
        }
        return QuadInstance(
            rect: rect, uvPx: .zero,
            color: SIMD4(Float(color.r) / 255, Float(color.g) / 255, Float(color.b) / 255, alpha),
            mode: SIMD4(0, 0, 0, 0))
    }

    private func flattenIfNeeded() {
        guard needFlatten else { return }
        needFlatten = false
        let bgs = bgRows.flatMap { $0 }
        let gls = glyphRows.flatMap { $0 }
        bgCount = bgs.count
        glyphCount = gls.count
        bgBuffer = bgs.isEmpty ? nil : device?.makeBuffer(
            bytes: bgs, length: bgs.count * MemoryLayout<QuadInstance>.stride)
        glyphBuffer = gls.isEmpty ? nil : device?.makeBuffer(
            bytes: gls, length: gls.count * MemoryLayout<QuadInstance>.stride)
    }
}
