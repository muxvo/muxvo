// ClampedHitMappingTests：F6 钳制态命中映射行为哨（m3-layout-r5 对抗验收 minor②补齐）。
//
// F6 下限钳制后，小 tile 显示 80×24 网格的**左下裁切**——绘制经 contentYOffsetPx 锚底；本哨断言
// **命中/选区与绘制同源**：点视图最底行建选区，选中的必须是**网格最后一行**（锚底语义的用户可见面）。
// 判别力：视图 160pt ≈ 11 行、网格 24 行 → 偏移 ≈ 13 行；无偏移的旧命中数学会选到网格中部行
// （文本标签不同），有偏移才命中底行标签。
// 工装照 ShiftClickExtendTests（NSEvent 合成 + 非 orderFront 窗 + 注钟 flush）。
// 命名纪律：本文件无 spec-ID 翻牌 → 测试名不得像 spec ID。
import AppKit
import Foundation
import Testing
@testable import MuxvoTerm
@testable import MuxvoTermRender

private let menlo12 = FontConfig(family: "Menlo", size: 12)

@MainActor
private func mouseEvent(_ type: NSEvent.EventType, at loc: NSPoint, in window: NSWindow) -> NSEvent {
    NSEvent.mouseEvent(
        with: type, location: loc, modifierFlags: [], timestamp: 0,
        windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1,
        pressure: type == .leftMouseDown ? 1 : 0)!
}

@Suite("F6 钳制态命中映射（锚底：视图底行 == 网格底行）", .serialized)
@MainActor
struct ClampedHitMappingTests {

    @Test("小 tile 钳制态：点视图底部行建选区 → 选中网格底部行内容（命中与绘制同偏移源，锚底）")
    func clickAtViewBottomSelectsGridBottomRow() throws {
        var cfg = TerminalSession.Config()
        cfg.spawnShell = false
        cfg.cols = 20; cfg.rows = 6
        let session = try TerminalSession(config: cfg)
        defer { session.close() }

        let surface = TerminalSurfaceView(font: menlo12, device: nil)
        surface.frame = NSRect(x: 0, y: 0, width: 300, height: 160) // 换算低于 80×24 → 钳制态
        surface.attach(session)
        var now: UInt64 = 1_000
        surface.settleNowMs = { now }
        now += 200
        surface.flushGridSettle()
        // 前提：钳制态（F8 下限随 cell 度量换算；m3-r7 O1a 起仅高度轴——宽度随 bounds，
        // 本哨主题=锚底命中映射，行向钳制语义不变）。
        let cellPre = surface.cellSizePxForTest
        let floorRows = TerminalSurfaceView.gridFloorRows(cellH: cellPre.h, scale: 2)
        #expect(Int(session.cols) == Int(300 * 2) / cellPre.w && Int(session.rows) == floorRows)
        #expect(floorRows > Int(160 * 2) / cellPre.h) // 判别力自检：网格行数 > 视图容量（裁切态）

        // 200 行标签内容钉底：网格最底行 = "L199-…"。
        for i in 0..<200 { session.feed("L\(i)-xxxxxxxxxx\r\n") }
        session.scrollViewport(.bottom)
        #expect(surface.contentYOffsetPxForTest > 0) // 前提：网格高于视图（锚底偏移生效）

        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 300, height: 160),
                              styleMask: [.borderless], backing: .buffered, defer: true)
        defer { window.contentView = nil }
        let content = NSView(frame: NSRect(x: 0, y: 0, width: 300, height: 160))
        content.addSubview(surface)
        window.contentView = content

        // 点视图**倒数第二行**（网格 row22——末行 \r\n 后光标行 row23 为空行，复制空白得 nil，
        // 不作判别目标），press→drag→release 建选区。
        let scale = surface.window?.backingScaleFactor ?? 2
        let cell = surface.cellSizePxForTest
        let chPts = CGFloat(cell.h) / scale
        let cwPts = CGFloat(cell.w) / scale
        let ySecondFromBottom = chPts * 1.5 // AppKit y 自底向上：倒数第二行中心
        let pDown = surface.convert(NSPoint(x: cwPts * 0.5, y: ySecondFromBottom), to: nil)
        let pDrag = surface.convert(NSPoint(x: cwPts * 9.5, y: ySecondFromBottom), to: nil)
        surface.mouseDown(with: mouseEvent(.leftMouseDown, at: pDown, in: window))
        surface.mouseDragged(with: mouseEvent(.leftMouseDragged, at: pDrag, in: window))
        surface.mouseUp(with: mouseEvent(.leftMouseUp, at: pDrag, in: window))

        #expect(session.hasSelection())
        let text = try #require(session.copySelectionPlainText())
        // 锚底判别：视图倒数第二行 == 网格 row22 == 最后有字行 "L199-…"。旧命中数学（无偏移，
        // 偏移 ≈12.6 行）会落在网格中部 L186 附近，标签不同即红。
        #expect(text.contains("L199"), "选中文本应为网格 row22 的 L199-…，实为：\(text.prefix(40))")
    }
}
