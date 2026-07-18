// ShiftClickExtendTests：Shift+左键扩展选区的视图层红锚（DOGFOOD_M3_17，terminal-input.md §4 ☆ / §5）。
//
// 隔离会话（spawnShell:false）+ device:nil（无 GPU 无 draw）+ 非 orderFront 窗（照 ScrollbarDragTests
// 骨架，无 SIGTRAP）。feed 100 行制满屏文本；每 viewport 行都有 "Lnn-xxxx…"（选区/扩展断言不依赖具体滚动位置）。
// 工装自足（不复用 ScrollbarDragTests 的 private helper，避免改动 M3_11 测试文件）——技法同源：
// makeDragFixture 的「先定 frame 再 attach + 注钟推满 flush 提交网格」。
//
// 红锚（未修前必须红）：建选区后按住 Shift 于别处单击，现状经普通 press 路径 → 远处单击 gesture 返
// NO_VALUE → 清旧选区（hasSelection==false）。修复后 = 扩展为「固定端→点击格」，hasSelection 保持 true。
//
// 命名纪律：本单有 spec-ID（DOGFOOD_M3_17）→ 测试名照实描述，不伪造断言 ID。
import AppKit
import Foundation
import Testing
@testable import MuxvoTerm
@testable import MuxvoTermRender

private let menlo12 = FontConfig(family: "Menlo", size: 12)

@MainActor
private struct ExtendFixture {
    let window: NSWindow
    let surface: TerminalSurfaceView
    let session: TerminalSession

    func teardown() {
        surface.detach()
        session.close()
        window.contentView = nil
    }

    /// (col,row) viewport 格 → 窗口坐标（合成 NSEvent 的 locationInWindow）。像素换算与 pointerHit 同源：
    /// cwPts = cellPx.w / scale、chPts = cellPx.h / scale；格中心取 +0.5。y 自底向上（AppKit）。
    func winPointForCell(_ col: Int, _ row: Int) -> NSPoint {
        let scale = surface.window?.backingScaleFactor ?? 2
        let cell = surface.cellSizePxForTest
        let cwPts = CGFloat(cell.w) / scale
        let chPts = CGFloat(cell.h) / scale
        let vx = (CGFloat(col) + 0.5) * cwPts
        let yTop = (CGFloat(row) + 0.5) * chPts
        let vy = surface.bounds.height - yTop
        return surface.convert(NSPoint(x: vx, y: vy), to: nil)
    }

    /// viewport 行数（网格提交后）。
    var rows: Int { Int(session.rows) }
}

@MainActor
private func makeExtendFixture(cols: UInt16 = 40, rows: UInt16 = 8, lineCount: Int = 100) throws -> ExtendFixture {
    var cfg = TerminalSession.Config()
    cfg.spawnShell = false
    cfg.cols = cols; cfg.rows = rows
    let session = try TerminalSession(config: cfg)
    let surface = TerminalSurfaceView(font: menlo12, device: nil)
    surface.frame = NSRect(x: 0, y: 0, width: 300, height: 220)
    surface.attach(session)   // 先定 frame 再 attach：syncGridToBounds 按真 bounds 定网格
    // 首帧经 settle：注钟推满 flush 使网格提交到位，否则 vt 停 cfg 初值、下半区点击落空（时钟纪律惯例）。
    var now: UInt64 = 1_000
    surface.settleNowMs = { now }
    now += 200
    surface.flushGridSettle()
    // 每行 20+ 字符：任意 viewport 行都有文本（选区路径不依赖具体滚动位置）。
    for i in 0..<lineCount { session.feed("L\(i)-xxxxxxxxxxxxxxxxxxxx\r\n") }
    session.scrollViewport(.bottom)   // 钉底：每 viewport 行都是某条 "Lnn-…"
    let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 300, height: 220),
                          styleMask: [.borderless], backing: .buffered, defer: true)
    let content = NSView(frame: NSRect(x: 0, y: 0, width: 300, height: 220))
    content.addSubview(surface)
    window.contentView = content
    return ExtendFixture(window: window, surface: surface, session: session)
}

@MainActor
private func mouseEvent(_ type: NSEvent.EventType, at loc: NSPoint, in window: NSWindow,
                        flags: NSEvent.ModifierFlags = []) -> NSEvent {
    NSEvent.mouseEvent(
        with: type, location: loc, modifierFlags: flags, timestamp: 0,
        windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1,
        pressure: type == .leftMouseDown ? 1 : 0)!
}

@Suite("Shift+Click 扩展选区视图序列（DOGFOOD_M3_17）", .serialized)
@MainActor
struct ShiftClickExtendTests {

    /// 红锚：建选区（行 0 col 0..10）→ 别处（行 5 col 39）Shift+单击 → 扩展而非清除。
    /// **未修前必红**：现状 Shift+单击走普通 press → 远处单击 NO_VALUE → 清旧选区 hasSelection==false。
    @Test("视图级红锚：建选区后 Shift+Click 别处 → 选区扩展为锚点到点击整段（非清除）")
    func shiftClickExtendsSelectionAcrossRows() throws {
        let f = try makeExtendFixture()
        defer { f.teardown() }
        #expect(f.rows >= 6, "网格行数应 ≥6（实测 \(f.rows)），否则行 5 越界")

        // 建初始选区：行 0 从 col 0 拖到 col 10（普通 press/drag/release，今日绿）。
        f.surface.mouseDown(with: mouseEvent(.leftMouseDown, at: f.winPointForCell(0, 0), in: f.window))
        f.surface.mouseDragged(with: mouseEvent(.leftMouseDragged, at: f.winPointForCell(10, 0), in: f.window))
        f.surface.mouseUp(with: mouseEvent(.leftMouseUp, at: f.winPointForCell(10, 0), in: f.window))
        #expect(f.session.hasSelection(), "初始 press/drag/release 应建成选区")
        let copyBefore = f.session.copySelectionPlainText()
        #expect(copyBefore != nil && copyBefore?.contains("\n") == false, "初始选区限行 0（单行）")

        // 别处按住 Shift 单击：行 5 col 39。
        f.surface.mouseDown(with: mouseEvent(.leftMouseDown, at: f.winPointForCell(39, 5), in: f.window, flags: .shift))
        f.surface.mouseUp(with: mouseEvent(.leftMouseUp, at: f.winPointForCell(39, 5), in: f.window, flags: .shift))

        // 断言：选区未被清除，扩展为锚点(行0,col0)→点击(行5,col39) 整段 = 行 0..5 全六行。
        #expect(f.session.hasSelection(), "Shift+Click 别处不得清除选区——应扩展（红锚：现状为 false）")
        let copyAfter = try #require(f.session.copySelectionPlainText(), "扩展后应有可复制文本")
        let lines = copyAfter.split(separator: "\n", omittingEmptySubsequences: false)
        #expect(lines.count == 6, "覆盖行 0..5 共 6 行（实测 \(lines.count) 行）：`\(copyAfter.prefix(80))`")
        #expect(lines.allSatisfy { $0.hasPrefix("L") && $0.contains("-x") },
                "每行应为满行 `Lnn-xxx…`（扩展覆盖整段，非局部）")
    }
}
