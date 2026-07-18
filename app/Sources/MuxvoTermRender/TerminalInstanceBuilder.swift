// TerminalInstanceBuilder：不可变快照 → 三批 GPU 实例（terminal-rendering.md §1/§2/§4）。
//
// 纯逻辑（唯一外部依赖 = GlyphCache 的字形装箱；GlyphCache device==nil 时装箱照常、仅跳过纹理上传，
// 故本 builder 在无 GPU 的 CI 上也可完整跑并断言 bg/glyph/cursor 分批与坐标）。手法平移探针
// buildRow/cursorInstance，但**读快照值**而非 render state C 句柄：视图零 C 调用、零会话 queue 接触。
import MuxvoTerm
import simd

@MainActor
struct TerminalInstanceBuilder {
    let glyphCache: GlyphCache

    /// cell 像素尺寸（backing 像素，与喂给 session.resize 的 cell px 同口径）。
    var cellW: Float { Float(glyphCache.metrics.widthPx) }
    var cellH: Float { Float(glyphCache.metrics.heightPx) }

    /// 选区高亮色（§2 cell.selected 驱动）。快照/主题不携带选区色，取半透明蓝作 overlay——
    /// 设计选择记报告；批 3③ 选区手势落地后如需主题化选区色再收口。
    static let selectionColor = SIMD4<Float>(0.28, 0.46, 0.78, 0.40)

    /// 搜索高亮色（terminal-search-bar §M3）：全命中淡琥珀 overlay、当前命中强琥珀。快照/主题不携带
    /// 搜索色，取半透明琥珀作 overlay（背景批、glyph 之下故文本仍清晰可读）——设计选择记报告。
    static let searchMatchColor = SIMD4<Float>(0.95, 0.70, 0.15, 0.32)
    static let searchCurrentColor = SIMD4<Float>(1.0, 0.62, 0.0, 0.62)

    /// 从快照构建三批实例。cursorMode 由视图的 CursorBlinkController 依焦点/相位算好后传入。
    func build(_ snap: TerminalFrameSnapshot, cursorMode: CursorRenderMode) -> FrameInstances {
        var out = FrameInstances()
        out.generation = snap.generation
        let cw = cellW, ch = cellH
        let defaultBg = snap.colors.background
        var glyphGroups: [GlyphPageBatchKey: [QuadInstance]] = [:]

        // 搜索高亮批（背景批、glyph 之下）：先画淡命中，当前命中后画强色叠加——glyph 稍后绘制，文本可读。
        for hl in snap.searchHighlights where hl.row >= 0 && hl.row < snap.rows && hl.to >= hl.from {
            let color = hl.isCurrent ? Self.searchCurrentColor : Self.searchMatchColor
            let x0 = Float(hl.from) * cw
            let w = Float(hl.to - hl.from + 1) * cw
            out.background.append(Self.solid(x0, Float(hl.row) * ch, w, ch, color))
        }

        for (y, row) in snap.lines.enumerated() {
            let rowY = Float(y) * ch
            for (x, cell) in row.cells.enumerated() {
                let cellX = Float(x) * cw
                var fg = cell.fg
                var bg = cell.bg
                let flags = cell.styleFlags
                if flags.contains(.inverse) { swap(&fg, &bg) }

                // 背景批：选区高亮优先；否则仅非默认底色画 quad（默认底交 clearColor）。
                if cell.selected {
                    out.background.append(Self.solid(cellX, rowY, cw, ch, Self.selectionColor))
                } else if bg != defaultBg {
                    out.background.append(Self.solid(cellX, rowY, cw, ch, Self.rgba(bg, 1)))
                }

                if flags.contains(.invisible) { continue }
                let alpha: Float = flags.contains(.faint) ? 0.6 : 1.0

                if !cell.grapheme.isEmpty, cell.grapheme != " " {
                    let key = GlyphKey(cluster: cell.grapheme,
                                       bold: flags.contains(.bold),
                                       italic: flags.contains(.italic))
                    if let e = glyphCache.glyph(key) {
                        let color = e.kind == .color ? SIMD4<Float>(1, 1, 1, alpha) : Self.rgba(fg, alpha)
                        let inst = QuadInstance(
                            rect: SIMD4(cellX, rowY, Float(e.rect.w), Float(e.rect.h)),
                            uvPx: SIMD4(Float(e.rect.x), Float(e.rect.y), Float(e.rect.w), Float(e.rect.h)),
                            color: color,
                            mode: e.kind == .color ? 2 : 1)
                        glyphGroups[GlyphPageBatchKey(kind: e.kind, page: e.page), default: []].append(inst)
                    }
                }

                // 下划线 / 删除线：细实心 quad，用 fg（§underline 只记有/无，样式复原此处从简取单线）。
                if flags.contains(.underline) {
                    let h = max(1, ch * 0.06)
                    out.background.append(Self.solid(cellX, rowY + ch - h, cw, h, Self.rgba(fg, alpha)))
                }
                if flags.contains(.strikethrough) {
                    let h = max(1, ch * 0.06)
                    out.background.append(Self.solid(cellX, rowY + ch * 0.52, cw, h, Self.rgba(fg, alpha)))
                }
            }
        }

        // 聚合为有序批（mask 先于 color、页号升序——draw 顺序稳定，测试可断言）。
        out.glyphBatches = glyphGroups
            .map { GlyphPageBatch(kind: $0.key.kind, page: $0.key.page, instances: $0.value) }
            .sorted { lhs, rhs in
                if lhs.kind != rhs.kind { return lhs.kind == .mask }
                return lhs.page < rhs.page
            }

        out.cursor = cursorInstances(snap, mode: cursorMode, cw: cw, ch: ch)
        return out
    }

    // MARK: - 光标

    /// 构建光标批（§4.3）。solid+block 时附「反色字形」以保光标下字符可读；bar/underline 单条；hollow 边框。
    private func cursorInstances(
        _ snap: TerminalFrameSnapshot, mode: CursorRenderMode, cw: Float, ch: Float
    ) -> [QuadInstance] {
        guard mode != .hidden else { return [] }
        let c = snap.cursor
        guard c.inViewport else { return [] }
        let color = snap.colors.cursor.map { Self.rgba($0, 1) } ?? Self.rgba(snap.colors.foreground, 1)
        let x = Float(c.x) * cw
        let y = Float(c.y) * ch

        if mode == .hollow {
            return Self.hollowBorder(x, y, cw, ch, color)
        }

        switch c.style {
        case .bar:
            return [Self.solid(x, y, max(2, cw * 0.15), ch, color)]
        case .underline:
            let h = max(2, ch * 0.1)
            return [Self.solid(x, y + ch - h, cw, h, color)]
        case .block, .blockHollow:
            var quads = [Self.solid(x, y, cw, ch, color)]
            // 反色字形：光标格若有字符，用该格底色在 block 上重绘一遍，形成「挖空」效果。
            if c.y >= 0, c.y < snap.lines.count, c.x >= 0, c.x < snap.lines[c.y].cells.count {
                let cell = snap.lines[c.y].cells[c.x]
                if !cell.grapheme.isEmpty, cell.grapheme != " " {
                    let key = GlyphKey(cluster: cell.grapheme,
                                       bold: cell.styleFlags.contains(.bold),
                                       italic: cell.styleFlags.contains(.italic))
                    if let e = glyphCache.glyph(key), e.kind == .mask {
                        quads.append(QuadInstance(
                            rect: SIMD4(x, y, Float(e.rect.w), Float(e.rect.h)),
                            uvPx: SIMD4(Float(e.rect.x), Float(e.rect.y), Float(e.rect.w), Float(e.rect.h)),
                            color: Self.rgba(cell.bg, 1),
                            mode: 1))
                    }
                }
            }
            return quads
        }
    }

    // MARK: - 构造辅助

    static func solid(_ x: Float, _ y: Float, _ w: Float, _ h: Float, _ color: SIMD4<Float>) -> QuadInstance {
        QuadInstance(rect: SIMD4(x, y, w, h), color: color, mode: 0)
    }

    /// 空心块 = 4 条 1px（× 视觉略粗）边框实心 quad。
    static func hollowBorder(_ x: Float, _ y: Float, _ w: Float, _ h: Float, _ color: SIMD4<Float>) -> [QuadInstance] {
        let t: Float = max(1, h * 0.06)
        return [
            solid(x, y, w, t, color),               // 上
            solid(x, y + h - t, w, t, color),       // 下
            solid(x, y, t, h, color),               // 左
            solid(x + w - t, y, t, h, color),       // 右
        ]
    }

    static func rgba(_ c: RGBA, _ a: Float) -> SIMD4<Float> {
        SIMD4(Float(c.r) / 255, Float(c.g) / 255, Float(c.b) / 255, a)
    }
}
