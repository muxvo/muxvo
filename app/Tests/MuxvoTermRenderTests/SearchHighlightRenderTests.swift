// 搜索高亮渲染批（批5②；行为规格 terminal-search-bar.md §5.4）：searchHighlights → 背景批 quad。
// 纯逻辑（device==nil 也可栅格装箱），断言淡/强色 + 列坐标 + 越界命中不入批。无 GUI、无 GPU。
// 命名纪律：无 spec-ID 翻牌 → 测试名不得像 spec ID（防 E_FORGED_ID）。
import Foundation
import Testing
import simd
@testable import MuxvoTerm
@testable import MuxvoTermRender

@Suite("搜索高亮 → 背景批")
@MainActor
struct SearchHighlightRenderTests {
    private func builder() -> TerminalInstanceBuilder {
        TerminalInstanceBuilder(glyphCache: GlyphCache(font: FontConfig(family: "Menlo", size: 14), scale: 2, device: nil))
    }

    private func colors() -> TerminalColors {
        TerminalColors(background: RGBA(r: 0x1e, g: 0x1e, b: 0x1e),
                       foreground: RGBA(r: 0xd0, g: 0xd0, b: 0xd0), cursor: nil,
                       palette: Array(repeating: RGBA(r: 0, g: 0, b: 0), count: 256))
    }

    /// 全默认底行（默认底交 clearColor 不入 bg 批 → 背景批里只剩搜索高亮，可精确计数）。
    private func emptyRow(_ cols: Int) -> RowSnapshot {
        let cells = (0..<cols).map { _ in
            TerminalCell(grapheme: " ", fg: RGBA(r: 0xd0, g: 0xd0, b: 0xd0),
                         bg: RGBA(r: 0x1e, g: 0x1e, b: 0x1e), styleFlags: [], selected: false)
        }
        return RowSnapshot(cells: cells, dirtyOnBuild: true, contentHash: 0)
    }

    private func hiddenCursor() -> CursorSnapshot {
        CursorSnapshot(x: 0, y: 0, style: .block, visible: false, blinking: false,
                       passwordInput: false, inViewport: false)
    }

    @Test("命中 → 淡/强琥珀 quad，rect=列度量；越界命中（row>=rows）不入批")
    func highlightsEmitBackgroundQuads() {
        let b = builder()
        let cw = b.cellW, ch = b.cellH
        let snap = TerminalFrameSnapshot(
            generation: 1, cols: 20, rows: 2, lines: [emptyRow(20), emptyRow(20)],
            cursor: hiddenCursor(), colors: colors(), selectionRanges: [],
            scrollbar: nil, viewportActive: true,
            searchHighlights: [
                SearchHighlight(row: 0, from: 2, to: 5, isCurrent: false),  // 淡：列 2..5
                SearchHighlight(row: 1, from: 0, to: 1, isCurrent: true),   // 强：列 0..1
                SearchHighlight(row: 9, from: 0, to: 3, isCurrent: false),  // 越界 → 丢
            ])
        let out = b.build(snap, cursorMode: .hidden)

        // 空行无非默认底 → 背景批恰两条搜索高亮（越界那条被丢）。
        #expect(out.background.count == 2)
        let faint = out.background.first { $0.color == TerminalInstanceBuilder.searchMatchColor }
        #expect(faint?.rect == SIMD4<Float>(2 * cw, 0, 4 * cw, ch))     // x=2*cw, w=(5-2+1)*cw
        let strong = out.background.first { $0.color == TerminalInstanceBuilder.searchCurrentColor }
        #expect(strong?.rect == SIMD4<Float>(0, ch, 2 * cw, ch))         // 行 1 → y=ch, w=2*cw
    }
}
