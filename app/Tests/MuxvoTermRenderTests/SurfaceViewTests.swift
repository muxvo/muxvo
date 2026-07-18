// TerminalSurfaceView / 渲染视图批 3② 验收（行为规格 terminal-rendering.md §1.2/§4.3/§5/§7）。
//
// 覆盖四层，全部无需在线 UI 服务、全部只碰内存（隔离会话 spawnShell:false，无 PTY/无文件）：
//   1. TerminalInstanceBuilder —— 纯逻辑（device==nil 也可栅格装箱），断言三批分组/坐标/选区/inverse/宽字符。
//   2. CursorBlinkController —— 假时钟相位状态机 + 门控 + mode() 判定。
//   3. ScrollSupport —— 滚轮像素↔行累积（残差/方向/非法/reset）+ scrollbar 拇指几何（clamp/边界）。
//   4. TerminalSurfaceView —— attach/detach 生命周期（timer 启停、观察者移除、weak 不泄漏、幂等）；
//      GPU 门控：TerminalRenderer 离屏 readback 随快照变化 + 视图 onFrameCompleted 携带的 generation。
//
// 命名纪律：本文件无 spec-ID 翻牌 → 测试名不得像 spec ID（防 E_FORGED_ID）。
import AppKit
import Darwin
import Foundation
import Metal
import Testing
import simd
@testable import MuxvoTerm
@testable import MuxvoTermRender

// MARK: - 共享构造 / 轮询辅助

private let menlo14 = FontConfig(family: "Menlo", size: 14)   // 与 builder/离屏共用（度量基线 17×33@2x）
private let menlo12 = FontConfig(family: "Menlo", size: 12)   // 视图生命周期用（独占 registry key，防污染共享缓存）

private func makeColors(bg: RGBA = RGBA(r: 0x1e, g: 0x1e, b: 0x1e),
                        fg: RGBA = RGBA(r: 0xd0, g: 0xd0, b: 0xd0),
                        cursor: RGBA? = nil) -> TerminalColors {
    TerminalColors(background: bg, foreground: fg, cursor: cursor,
                   palette: Array(repeating: RGBA(r: 0, g: 0, b: 0), count: 256))
}

private func cell(_ g: String,
                  fg: RGBA = RGBA(r: 0xd0, g: 0xd0, b: 0xd0),
                  bg: RGBA = RGBA(r: 0x1e, g: 0x1e, b: 0x1e),
                  flags: CellStyleFlags = [],
                  selected: Bool = false) -> TerminalCell {
    TerminalCell(grapheme: g, fg: fg, bg: bg, styleFlags: flags, selected: selected)
}

private func row(_ cells: [TerminalCell]) -> RowSnapshot {
    RowSnapshot(cells: cells, dirtyOnBuild: true, contentHash: 0)
}

private func hiddenCursor() -> CursorSnapshot {
    CursorSnapshot(x: 0, y: 0, style: .block, visible: false, blinking: false,
                   passwordInput: false, inViewport: false)
}

private func snapshot(rows: [RowSnapshot], cols: Int,
                      cursor: CursorSnapshot, colors: TerminalColors,
                      generation: UInt64 = 7,
                      selection: [SelectionRange] = [],
                      scrollbar: ScrollbarSnapshot? = nil,
                      viewportActive: Bool = true) -> TerminalFrameSnapshot {
    TerminalFrameSnapshot(generation: generation, cols: cols, rows: rows.count, lines: rows,
                          cursor: cursor, colors: colors, selectionRanges: selection,
                          scrollbar: scrollbar, viewportActive: viewportActive)
}

@MainActor
private func makeIsolatedSession(cols: UInt16 = 20, rows: UInt16 = 6) throws -> TerminalSession {
    var cfg = TerminalSession.Config()
    cfg.spawnShell = false
    cfg.cols = cols; cfg.rows = rows
    return try TerminalSession(config: cfg)
}

/// 阻塞轮询（读原子快照指针，不依赖 main 队列投递）——离屏 GPU 用例。
private func waitUntilSync(timeout: TimeInterval, _ cond: () -> Bool) -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
        if cond() { return true }
        usleep(2_000)
    }
    return cond()
}

// MARK: - 1. InstanceBuilder：三批分组 + 坐标 + 选区 + inverse + 宽字符

@Suite("InstanceBuilder 三批分组与坐标")
@MainActor
struct InstanceBuilderTests {
    private func builder() -> TerminalInstanceBuilder {
        TerminalInstanceBuilder(glyphCache: GlyphCache(font: menlo14, scale: 2, device: nil))
    }

    @Test("默认底交 clearColor 不入 bg 批；非默认底进 bg、字形进 glyph、坐标=cell 度量、generation 透传")
    func batchesGroupedByRole() {
        let b = builder()
        let cw = b.cellW, ch = b.cellH
        let defBg = RGBA(r: 0x1e, g: 0x1e, b: 0x1e)

        // 3×4：col2/row1='A'（默认底→只走 glyph 批）；col1/row0=红底空格（只走 bg 批）；其余默认底空。
        var rows: [RowSnapshot] = []
        for y in 0..<3 {
            var cells: [TerminalCell] = []
            for x in 0..<4 {
                if x == 2, y == 1 { cells.append(cell("A")) }
                else if x == 1, y == 0 { cells.append(cell("", bg: RGBA(r: 255, g: 0, b: 0))) }
                else { cells.append(cell("")) }
            }
            rows.append(row(cells))
        }
        let f = b.build(snapshot(rows: rows, cols: 4, cursor: hiddenCursor(),
                                 colors: makeColors(bg: defBg), generation: 9),
                        cursorMode: .hidden)

        // 背景批：仅红底一格，位于 (col1,row0)。
        #expect(f.background.count == 1)
        #expect(f.background[0].rect == SIMD4<Float>(cw, 0, cw, ch))
        #expect(f.background[0].mode.x == 0)
        #expect(f.background[0].color == TerminalInstanceBuilder.rgba(RGBA(r: 255, g: 0, b: 0), 1))

        // 字形批：一批 mask，'A' 落 (2cw,1ch)，mode==1（mask tint）。
        #expect(f.glyphBatches.count == 1)
        let batch = f.glyphBatches[0]
        #expect(batch.kind == .mask)
        #expect(batch.instances.count == 1)
        #expect(batch.instances[0].rect.x == 2 * cw)
        #expect(batch.instances[0].rect.y == ch)
        #expect(batch.instances[0].mode.x == 1)

        // cursor 隐藏 → 空；generation 透传。
        #expect(f.cursor.isEmpty)
        #expect(f.generation == 9)
    }

    @Test("选区高亮：selected cell → bg 批含 selectionColor overlay（覆盖默认底），坐标对齐")
    func selectionHighlight() {
        let b = builder()
        let cw = b.cellW, ch = b.cellH
        let cells = [cell(""), cell("", selected: true), cell("")]   // col1 选中、默认底
        let f = b.build(snapshot(rows: [row(cells)], cols: 3, cursor: hiddenCursor(), colors: makeColors()),
                        cursorMode: .hidden)
        #expect(f.background.count == 1)
        #expect(f.background[0].color == TerminalInstanceBuilder.selectionColor)
        #expect(f.background[0].rect == SIMD4<Float>(cw, 0, cw, ch))
    }

    @Test("inverse 交换 fg/bg：原默认底 inverse 后成非默认底 → 进 bg 批取原 fg 色")
    func inverseSwapsFgBg() {
        let b = builder()
        let cw = b.cellW, ch = b.cellH
        let defBg = RGBA(r: 0x1e, g: 0x1e, b: 0x1e)
        let c = cell("", fg: RGBA(r: 200, g: 0, b: 0), bg: defBg, flags: .inverse)
        let f = b.build(snapshot(rows: [row([c])], cols: 1, cursor: hiddenCursor(), colors: makeColors(bg: defBg)),
                        cursorMode: .hidden)
        #expect(f.background.count == 1)
        #expect(f.background[0].color == TerminalInstanceBuilder.rgba(RGBA(r: 200, g: 0, b: 0), 1))
        #expect(f.background[0].rect == SIMD4<Float>(0, 0, cw, ch))
    }

    @Test("宽字符占双格：CJK '中' 字形实例宽 == 2×窄字形 'A' == 2×cell 宽")
    func cjkSpansTwoCells() {
        let b = builder()
        let cw = b.cellW
        let narrow = b.build(snapshot(rows: [row([cell("A")])], cols: 1, cursor: hiddenCursor(), colors: makeColors()),
                             cursorMode: .hidden).glyphBatches.flatMap { $0.instances }
        let wide = b.build(snapshot(rows: [row([cell("中")])], cols: 1, cursor: hiddenCursor(), colors: makeColors()),
                           cursorMode: .hidden).glyphBatches.flatMap { $0.instances }
        #expect(narrow.count == 1)
        #expect(wide.count == 1)
        #expect(narrow[0].rect.z == cw)         // 窄 = 1 cell
        #expect(wide[0].rect.z == 2 * cw)       // 宽 = 2 cell（占双格）
    }

    @Test("光标批：hidden→空、离视口→空、block→1实心、bar→细条、underline→贴底条、hollow→4边框")
    func cursorStyleQuads() {
        let b = builder()
        let cw = b.cellW, ch = b.cellH
        let colors = makeColors()
        let oneRow = [row([cell("")])]
        func curs(_ style: CursorSnapshot.Style, inViewport: Bool = true) -> CursorSnapshot {
            CursorSnapshot(x: 0, y: 0, style: style, visible: true, blinking: false,
                           passwordInput: false, inViewport: inViewport)
        }
        func cursor(_ c: CursorSnapshot, _ mode: CursorRenderMode) -> [QuadInstance] {
            b.build(snapshot(rows: oneRow, cols: 1, cursor: c, colors: colors), cursorMode: mode).cursor
        }
        #expect(cursor(curs(.block), .hidden).isEmpty)                        // hidden 模式
        #expect(cursor(curs(.block, inViewport: false), .solid).isEmpty)      // 离视口
        let block = cursor(curs(.block), .solid)
        #expect(block.count == 1)
        #expect(block[0].rect == SIMD4<Float>(0, 0, cw, ch))
        #expect(block[0].mode.x == 0)
        let bar = cursor(curs(.bar), .solid)
        #expect(bar.count == 1)
        #expect(bar[0].rect.z < cw)                                           // 细条：宽 < cell
        #expect(bar[0].rect.w == ch)
        let ul = cursor(curs(.underline), .solid)
        #expect(ul.count == 1)
        #expect(ul[0].rect.w < ch)                                           // 底条：高 < cell
        #expect(ul[0].rect.y > 0)                                            // 贴底（y 下移）
        #expect(cursor(curs(.block), .hollow).count == 4)                    // 空心 = 4 边框
    }

    @Test("block 光标压字形格：cursor 批 = 实心块 + 反色字形（mode 1）共 2 实例")
    func blockCursorInverseGlyph() {
        let b = builder()
        let c = CursorSnapshot(x: 0, y: 0, style: .block, visible: true, blinking: false,
                               passwordInput: false, inViewport: true)
        let f = b.build(snapshot(rows: [row([cell("A")])], cols: 1, cursor: c, colors: makeColors()),
                        cursorMode: .solid)
        #expect(f.cursor.count == 2)
        #expect(f.cursor[0].mode.x == 0)   // 实心块
        #expect(f.cursor[1].mode.x == 1)   // 反色字形（挖空）
    }
}

// MARK: - 2. CursorBlinkController：相位状态机 + 门控

@Suite("CursorBlink 相位状态机")
struct CursorBlinkControllerTests {
    @Test("timerShouldRun 仅 focused && blinking，setter 返回 timer 状态变化")
    func timerGating() {
        let c = CursorBlinkController()
        #expect(!c.timerShouldRun)
        #expect(c.setFocused(true) == false)   // blinking 仍 false → 无变化
        #expect(!c.timerShouldRun)
        #expect(c.setBlinking(true) == true)   // focused+blinking → 应启
        #expect(c.timerShouldRun)
        #expect(c.setFocused(false) == true)   // 失焦 → 应停
        #expect(!c.timerShouldRun)
    }

    @Test("advancePhase 仅在 focused+blinking 翻相位")
    func advanceGating() {
        let c = CursorBlinkController()
        #expect(c.phaseOn)
        #expect(c.advancePhase() == false)     // 未 focus/blink → 不翻
        #expect(c.phaseOn)
        c.setFocused(true); c.setBlinking(true)
        #expect(c.advancePhase() == true)      // → 灭
        #expect(!c.phaseOn)
        #expect(c.advancePhase() == true)      // → 亮
        #expect(c.phaseOn)
    }

    @Test("resetPhase 点亮：灭→亮返回 true，已亮返回 false")
    func resetLights() {
        let c = CursorBlinkController()
        c.setFocused(true); c.setBlinking(true)
        c.advancePhase()
        #expect(!c.phaseOn)
        #expect(c.resetPhase() == true)
        #expect(c.phaseOn)
        #expect(c.resetPhase() == false)
    }

    @Test("失焦复位相位（下次聚焦从亮起）")
    func focusLossResets() {
        let c = CursorBlinkController()
        c.setFocused(true); c.setBlinking(true)
        c.advancePhase()
        #expect(!c.phaseOn)
        c.setFocused(false)
        #expect(c.phaseOn)
    }

    @Test("blinking 位变化复位相位并反映 timer 变化")
    func blinkingChangeResets() {
        let c = CursorBlinkController()
        c.setFocused(true)
        #expect(c.setBlinking(true) == true)
        c.advancePhase()
        #expect(!c.phaseOn)
        #expect(c.setBlinking(false) == true)    // timer 由启→停
        #expect(c.phaseOn)                        // 复位点亮
        #expect(c.setBlinking(false) == false)   // 无变化
    }

    @Test("mode()：不可见/离视口→hidden；失焦→hollow；blockHollow→hollow；灭相位→hidden；否则 solid")
    func modeResolution() {
        let c = CursorBlinkController()
        #expect(c.mode(visible: false, inViewport: true, styleHollow: false) == .hidden)
        #expect(c.mode(visible: true, inViewport: false, styleHollow: false) == .hidden)
        #expect(c.mode(visible: true, inViewport: true, styleHollow: false) == .hollow)   // 失焦
        c.setFocused(true)
        #expect(c.mode(visible: true, inViewport: true, styleHollow: true) == .hollow)    // blockHollow
        #expect(c.mode(visible: true, inViewport: true, styleHollow: false) == .solid)    // focused 不闪
        c.setBlinking(true); c.advancePhase()
        #expect(!c.phaseOn)
        #expect(c.mode(visible: true, inViewport: true, styleHollow: false) == .hidden)   // 灭相位
        c.advancePhase()
        #expect(c.mode(visible: true, inViewport: true, styleHollow: false) == .solid)    // 亮相位
    }
}

// MARK: - 3. ScrollSupport：滚轮行累积 + scrollbar 几何

@Suite("ScrollSupport 滚轮换算与 scrollbar 几何")
struct ScrollSupportTests {
    @Test("trackpad 精确滚动：不足一格攒残差，满一格才下发（半格×2=1 行）")
    func preciseAccumulatesResidual() {
        var acc = ScrollLineAccumulator()
        #expect(acc.accumulate(deltaY: 8, precise: true, cellHeightPoints: 16) == 0)    // 0.5 行 → 攒
        #expect(acc.accumulate(deltaY: 8, precise: true, cellHeightPoints: 16) == -1)   // 累到 1 → 下发（正 deltaY → 负 delta）
    }

    @Test("方向符号：正 deltaY → 负 delta（上滚历史）、负 deltaY → 正 delta")
    func directionSign() {
        var acc = ScrollLineAccumulator()
        #expect(acc.accumulate(deltaY: 32, precise: true, cellHeightPoints: 16) == -2)
        acc.reset()
        #expect(acc.accumulate(deltaY: -32, precise: true, cellHeightPoints: 16) == 2)
    }

    @Test("鼠标滚轮非精确：deltaY 已是行数直接累积")
    func mouseWheelDirect() {
        var acc = ScrollLineAccumulator()
        #expect(acc.accumulate(deltaY: 3, precise: false, cellHeightPoints: 16) == -3)
        #expect(acc.accumulate(deltaY: 0.4, precise: false, cellHeightPoints: 16) == 0)
        #expect(acc.accumulate(deltaY: 0.4, precise: false, cellHeightPoints: 16) == 0)
        #expect(acc.accumulate(deltaY: 0.4, precise: false, cellHeightPoints: 16) == -1)  // 1.2 → 1
    }

    @Test("非法 cellHeight 返回 0；reset 清残差")
    func guardsAndReset() {
        var acc = ScrollLineAccumulator()
        #expect(acc.accumulate(deltaY: 100, precise: true, cellHeightPoints: 0) == 0)
        _ = acc.accumulate(deltaY: 8, precise: true, cellHeightPoints: 16)    // 攒 0.5
        acc.reset()
        #expect(acc.accumulate(deltaY: 8, precise: true, cellHeightPoints: 16) == 0)  // reset 后重新只 0.5
    }

    @Test("scrollbar：无可滚(total<=len)或视图尺寸过小 → nil")
    func scrollbarNilCases() {
        #expect(ScrollbarGeometry.thumbFrame(viewSize: CGSize(width: 200, height: 400), total: 24, offset: 0, len: 24) == nil)
        #expect(ScrollbarGeometry.thumbFrame(viewSize: CGSize(width: 200, height: 400), total: 10, offset: 0, len: 24) == nil)
        #expect(ScrollbarGeometry.thumbFrame(viewSize: CGSize(width: 2, height: 400), total: 100, offset: 0, len: 24) == nil)
        #expect(ScrollbarGeometry.thumbFrame(viewSize: CGSize(width: 200, height: 2), total: 100, offset: 0, len: 24) == nil)
    }

    @Test("scrollbar 几何：offset=0 拇指贴顶(AppKit y 大)、offset=底 贴底(y=inset)、宽/横坐标固定")
    func scrollbarGeometry() {
        let vs = CGSize(width: 200, height: 400)
        guard let top = ScrollbarGeometry.thumbFrame(viewSize: vs, total: 100, offset: 0, len: 24),
              let bot = ScrollbarGeometry.thumbFrame(viewSize: vs, total: 100, offset: 76, len: 24) else {
            Issue.record("有效滚动应返回拇指 frame"); return
        }
        #expect(top.width == ScrollbarGeometry.widthPx)
        #expect(top.origin.x == vs.width - ScrollbarGeometry.widthPx - ScrollbarGeometry.insetPx)
        #expect(bot.origin.y == ScrollbarGeometry.insetPx)   // 底部 y 最小
        #expect(top.origin.y > bot.origin.y)                 // 顶部 y 更大（原点左下）
    }

    @Test("scrollbar 越界 clamp：offset 超上/下界被夹到底/顶")
    func scrollbarClamp() {
        let vs = CGSize(width: 200, height: 400)
        let overflow = ScrollbarGeometry.thumbFrame(viewSize: vs, total: 100, offset: 500, len: 24)
        let atBottom = ScrollbarGeometry.thumbFrame(viewSize: vs, total: 100, offset: 76, len: 24)
        let underflow = ScrollbarGeometry.thumbFrame(viewSize: vs, total: 100, offset: -50, len: 24)
        let atTop = ScrollbarGeometry.thumbFrame(viewSize: vs, total: 100, offset: 0, len: 24)
        #expect(overflow?.origin.y == atBottom?.origin.y)    // 超上界 → 夹到底
        #expect(underflow?.origin.y == atTop?.origin.y)      // 超下界 → 夹到顶
    }

    @Test("选区自动滚动方向（尾批 item 5）：拖出上边→负、下边→正、边缘内→nil（符号同 accumulator）")
    func selectionAutoscrollDirection() {
        let h = 400.0
        #expect(SelectionAutoscroll.direction(yTop: -5, viewHeight: h) == -1)   // 上边缘外 → 上滚历史（负）
        #expect(SelectionAutoscroll.direction(yTop: h + 5, viewHeight: h) == 1) // 下边缘外 → 下滚新内容（正）
        #expect(SelectionAutoscroll.direction(yTop: 0, viewHeight: h) == nil)   // 顶边界内 → 停
        #expect(SelectionAutoscroll.direction(yTop: h, viewHeight: h) == nil)   // 底边界内 → 停
        #expect(SelectionAutoscroll.direction(yTop: 200, viewHeight: h) == nil) // 中部 → 停
    }

    // MARK: 拇指拖拽反算（DOGFOOD_M3_11 §5 ☆ / §7）

    @Test("拇指拖拽往返打表：offsetForThumbDrag∘thumbFrame ≈ 恒等（≤1 行；4 组×5 offset×2 grab）")
    func thumbDragRoundTrip() {
        struct Case { let vs: CGSize; let total: Int; let len: Int }
        let cases = [
            Case(vs: CGSize(width: 200, height: 400), total: 100, len: 24),   // 常规
            Case(vs: CGSize(width: 200, height: 400), total: 1000, len: 24),  // minThumb clamp（ratio 太小）
            Case(vs: CGSize(width: 120, height: 200), total: 50, len: 10),    // 小视图
            Case(vs: CGSize(width: 200, height: 400), total: 30, len: 24),    // 短内容（maxOffset 小、travel 小）
        ]
        for c in cases {
            let maxOffset = max(1, c.total - c.len)
            let offsets = [0, maxOffset / 4, maxOffset / 2, (maxOffset * 3) / 4, maxOffset]
            for off in offsets {
                guard let thumb = ScrollbarGeometry.thumbFrame(
                    viewSize: c.vs, total: c.total, offset: off, len: c.len) else {
                    Issue.record("有效滚动应有拇指 frame（total=\(c.total) len=\(c.len) off=\(off)）"); continue
                }
                // grabOffsetY = 指针相对拇指顶的偏移；取两点：贴顶(2pt)、拇指中段。
                for g in [CGFloat(2), thumb.height / 2] {
                    let pointerY = thumb.maxY - g   // 保持拇指原位的指针 y
                    guard let back = ScrollbarGeometry.offsetForThumbDrag(
                        viewSize: c.vs, total: c.total, len: c.len, pointerY: pointerY, grabOffsetY: g) else {
                        Issue.record("往返应返回 offset（total=\(c.total) off=\(off) g=\(g)）"); continue
                    }
                    #expect(abs(back - off) <= 1,
                            "往返 off=\(off)→\(back)（total=\(c.total) len=\(c.len) g=\(g)）")
                }
            }
        }
    }

    @Test("拇指拖拽反算边界：total==len / travel≤0 → nil；拖出轨道 → clamp 0(顶) / maxOffset(底)")
    func thumbDragBoundaries() {
        let vs = CGSize(width: 200, height: 400)
        // 无可滚（total==len）→ nil
        #expect(ScrollbarGeometry.offsetForThumbDrag(
            viewSize: vs, total: 24, len: 24, pointerY: 200, grabOffsetY: 0) == nil)
        // travel≤0（视图极矮：trackH ≤ minThumb → thumbH==trackH → travel==0）→ nil
        #expect(ScrollbarGeometry.offsetForThumbDrag(
            viewSize: CGSize(width: 200, height: 20), total: 100, len: 24, pointerY: 5, grabOffsetY: 0) == nil)
        // 拖出轨道顶（pointerY 远大）→ clamp 0（贴顶/最早）
        #expect(ScrollbarGeometry.offsetForThumbDrag(
            viewSize: vs, total: 100, len: 24, pointerY: 5000, grabOffsetY: 0) == 0)
        // 拖出轨道底（pointerY 远小/负）→ clamp maxOffset=76（贴底/最新）
        #expect(ScrollbarGeometry.offsetForThumbDrag(
            viewSize: vs, total: 100, len: 24, pointerY: -5000, grabOffsetY: 0) == 76)
    }

    @Test("dragHitRect：右缘 12pt 命中带 + 纵向 ±4pt 容差，含拇指右侧点/slop 内点，排斥左半区/纵向远点")
    func dragHitRectContainment() {
        let vs = CGSize(width: 200, height: 400)
        guard let thumb = ScrollbarGeometry.thumbFrame(viewSize: vs, total: 100, offset: 40, len: 24) else {
            Issue.record("有效滚动应有拇指"); return
        }
        let hit = ScrollbarGeometry.dragHitRect(thumb: thumb, viewSize: vs)
        // 含：贴右缘、拇指纵向中点
        #expect(hit.contains(CGPoint(x: vs.width - 1, y: thumb.midY)))
        // 含：纵向 slop 内（拇指顶上方 3pt < 4pt 容差）
        #expect(hit.contains(CGPoint(x: vs.width - 6, y: thumb.maxY + 3)))
        // 排斥：左半区远点
        #expect(!hit.contains(CGPoint(x: 10, y: thumb.midY)))
        // 排斥：纵向远离拇指（顶上方 20pt > slop）
        #expect(!hit.contains(CGPoint(x: vs.width - 1, y: thumb.maxY + 20)))
    }
}

// MARK: - 4. TerminalSurfaceView：attach/detach 生命周期 + timer + 观察者

@Suite("SurfaceView 生命周期与 timer")
@MainActor
struct SurfaceViewLifecycleTests {
    @Test("blinkTimer 开关：attach+注入blinking+聚焦→启；失焦→停；再聚焦→启；detach→停")
    func blinkTimerSwitch() throws {
        let s = try makeIsolatedSession()
        defer { s.close() }
        let view = TerminalSurfaceView(font: menlo12, device: nil)
        view.attach(s)
        #expect(!view.blinkTimerActive)          // 未聚焦
        view.blink.setBlinking(true)             // 无 GPU 无 draw：手工注入快照 blinking 位
        view.setFocused(true)
        #expect(view.blinkTimerActive)           // focused+blinking → 启
        view.setFocused(false)
        #expect(!view.blinkTimerActive)          // 失焦 → 停
        view.setFocused(true)
        #expect(view.blinkTimerActive)           // 再启
        view.detach()
        #expect(!view.blinkTimerActive)          // detach → 停
    }

    @Test("聚焦但未 blinking → 不启 timer")
    func focusedNoBlinkNoTimer() throws {
        let s = try makeIsolatedSession()
        defer { s.close() }
        let view = TerminalSurfaceView(font: menlo12, device: nil)
        view.attach(s)
        view.setFocused(true)                    // blinking 默认 false
        #expect(!view.blinkTimerActive)
        view.detach()
    }

    @Test("detach 释放会话强引用（weak 不泄漏）、isAttached 归假")
    func detachReleasesSession() throws {
        weak var weakSession: TerminalSession?
        let view = TerminalSurfaceView(font: menlo12, device: nil)
        do {
            let s = try makeIsolatedSession()
            weakSession = s
            view.attach(s)
            #expect(view.isAttached)
            view.detach()                         // 移除观察者 + 置 session=nil
        }
        #expect(!view.isAttached)
        #expect(weakSession == nil, "detach 后会话应被释放——视图不再强持有")
    }

    @Test("二次 attach 换会话：旧会话被 detach 释放，视图指向新会话")
    func reattachSwapsSession() throws {
        weak var weakOld: TerminalSession?
        let s2 = try makeIsolatedSession()
        defer { s2.close() }
        let view = TerminalSurfaceView(font: menlo12, device: nil)
        do {
            let s1 = try makeIsolatedSession()
            weakOld = s1
            view.attach(s1)
            view.attach(s2)                       // 换会话 → 先 detach s1
        }
        #expect(view.session === s2)
        #expect(weakOld == nil, "attach 新会话应释放旧会话")
        view.detach()
    }

    @Test("detach 幂等：重复 detach 不崩、isAttached=false")
    func detachIdempotent() throws {
        let s = try makeIsolatedSession()
        defer { s.close() }
        let view = TerminalSurfaceView(font: menlo12, device: nil)
        view.attach(s)
        view.detach()
        view.detach()
        #expect(!view.isAttached)
    }

    // 注：观察者「detach 后不再收帧」这一行为唯一可观测副作用是 view.needsDisplay，而 MTKView 的
    // needsDisplay 在无 window 时不留存（置真后读回 false）、入 window 又与本进程 draw 路径的 SIGTRAP
    // 冲突——headless 单测不可稳测。attach/detach 的资源清理由上面 weak-dealloc + timer 停用例覆盖；
    // 观察者投递的真回归归检查点⑩真 app 巡检。
}

// MARK: - 5. GPU 门控：离屏 readback（与 onFrameCompleted 同一 generation 透传路径）

@Suite("SurfaceView 渲染 readback（GPU 门控）")
@MainActor
struct SurfaceViewRenderGPUTests {
    // 离屏 renderOffscreen 与视图 draw 走同一 buildInstances→encode 路径，且 onFrameCompleted 回传的
    // generation 就是 instances.generation（== 快照 generation）；此处以离屏 readback 验证该透传契约，
    // 无需驱动在屏 MTKView（在 headless 测试进程里 currentDrawable + view.draw() 会 SIGTRAP，不可测）。
    // 视图真绘制回调本身的落地属检查点⑩真 app 复验 / 批 4① bench 宿主。
    @Test("离屏渲染：blank vs feed 'hello' → 字节非全零、随快照变化、generation 透传")
    func offscreenReadbackReflectsSnapshot() throws {
        guard let device = MTLCreateSystemDefaultDevice() else { return }   // 无 GPU：跳过
        let cache = GlyphCache(font: menlo14, scale: 2, device: device)
        let renderer = TerminalRenderer(glyphCache: cache, device: device)
        guard renderer.canRender else { return }                            // pipeline 建失败：跳过

        let s = try makeIsolatedSession(cols: 20, rows: 4)
        defer { s.close() }
        s.requestImmediateFrame()
        #expect(waitUntilSync(timeout: 3) { s.currentFrame() != nil })
        let blankSnap = try #require(s.currentFrame())
        let blank = try #require(renderer.renderOffscreen(blankSnap, cursorMode: .hidden, widthPx: 160, heightPx: 64))
        #expect(blank.generation == blankSnap.generation)
        #expect(blank.bytes.contains { $0 != 0 }, "readback 字节应非全零（含 dark 底色 + alpha）")

        s.feed("hello")
        #expect(waitUntilSync(timeout: 3) { (s.currentFrame()?.generation ?? 0) > blankSnap.generation })
        let helloSnap = try #require(s.currentFrame())
        let hello = try #require(renderer.renderOffscreen(helloSnap, cursorMode: .hidden, widthPx: 160, heightPx: 64))
        #expect(hello.generation == helloSnap.generation)
        #expect(hello.generation > blank.generation, "feed 后 generation 应增长")
        #expect(hello.bytes != blank.bytes, "feed 'hello' 后像素应随快照变化")
    }
}
