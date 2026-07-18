// ScrollbarDragTests：scrollbar 拇指鼠标拖拽视图层序列（DOGFOOD_M3_11，terminal-rendering.md §5 ☆ / §7）。
//
// 隔离会话（spawnShell:false）+ device:nil（无 GPU 无 draw）+ 非 orderFront 窗（照 SurfaceFocusRoutingTests
// 骨架，无 SIGTRAP）。feed 100 行制 scrollback；priming = 直调 session.scrollViewport(.delta) 填 scrollbar
// 快照（viewportActive false）+ surface.mouseEntered 触发 showScrollbar 令 opacity=1（避 CGEvent 合成，xctest 稳）。
// 命中判定不依赖 GPU 路径滞后的 layer.frame——mouseDown 现场用 bounds+最新快照重算 thumbFrame（本文件断言直证）。
//
// 命名纪律：本单有 spec-ID（DOGFOOD_M3_11）→ 测试名照实描述，不伪造断言 ID。
import AppKit
import Foundation
import Testing
@testable import MuxvoTerm
@testable import MuxvoTermRender

// MARK: - 共享构造 / 替身

private let menlo12 = FontConfig(family: "Menlo", size: 12)

/// 记录会话经 onUserWrite 收到的字节（拇指拖拽不得写 PTY 的取证；照 SurfaceFocusRoutingTests:32-38）。
private final class WriteRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var bytes: [UInt8] = []
    func append(_ b: [UInt8]) { lock.withLock { bytes.append(contentsOf: b) } }
    var written: [UInt8] { lock.withLock { bytes } }
}

@MainActor
private struct DragFixture {
    let window: NSWindow
    let surface: TerminalSurfaceView
    let session: TerminalSession

    func teardown() {
        surface.detach()
        session.close()
        window.contentView = nil
    }

    /// 直调 session 滚动填 scrollbar 快照（viewportActive→false）。deltaY 负 = 上滚回看历史。
    func fillScrollbar(delta: Int = -5) { session.scrollViewport(.delta(delta)) }

    /// 悬停触发 showScrollbar（opacity=1），不改滚动位置。mouseEntered 忽略事件内容，传任意鼠标事件即可。
    func prime(delta: Int = -5) {
        fillScrollbar(delta: delta)
        surface.mouseEntered(with: anyMouseEvent(in: window))
    }

    var currentScrollbar: ScrollbarSnapshot? { session.currentFrame()?.scrollbar }

    /// 当前快照几何重算的拇指 frame（视图坐标，AppKit 左下原点）。
    func thumbNow() -> CGRect? {
        guard let sb = currentScrollbar else { return nil }
        return ScrollbarGeometry.thumbFrame(viewSize: surface.bounds.size, total: sb.total,
                                            offset: sb.offset, len: sb.len)
    }

    /// 视图坐标 → 窗口坐标（合成 NSEvent 的 locationInWindow）。
    func winPoint(_ vx: CGFloat, _ vy: CGFloat) -> NSPoint { surface.convert(NSPoint(x: vx, y: vy), to: nil) }
}

@MainActor
private func makeDragFixture(cols: UInt16 = 40, rows: UInt16 = 8, lineCount: Int = 100) throws -> DragFixture {
    var cfg = TerminalSession.Config()
    cfg.spawnShell = false
    cfg.cols = cols; cfg.rows = rows
    let session = try TerminalSession(config: cfg)
    let surface = TerminalSurfaceView(font: menlo12, device: nil)
    surface.frame = NSRect(x: 0, y: 0, width: 300, height: 220)
    surface.attach(session)   // 先定 frame 再 attach：syncGridToBounds 按真 bounds 定网格
    // DOGFOOD_M3_13 F3 后首帧经 settle：注钟推满 flush 使网格提交到位（40×15），
    // 否则 vt 停在 cfg 初值 40×8、下半区点击选区落空（时钟纪律惯例）。
    var now: UInt64 = 1_000
    surface.settleNowMs = { now }
    now += 200
    surface.flushGridSettle()
    // 每行 20+ 字符：任意 viewport 行都有文本（选区路径断言不依赖具体滚动位置）。
    for i in 0..<lineCount { session.feed("L\(i)-xxxxxxxxxxxxxxxxxxxx\r\n") }
    let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 300, height: 220),
                          styleMask: [.borderless], backing: .buffered, defer: true)
    let content = NSView(frame: NSRect(x: 0, y: 0, width: 300, height: 220))
    content.addSubview(surface)
    window.contentView = content
    return DragFixture(window: window, surface: surface, session: session)
}

@MainActor
private func mouseEvent(_ type: NSEvent.EventType, at loc: NSPoint, in window: NSWindow,
                        flags: NSEvent.ModifierFlags = []) -> NSEvent {
    NSEvent.mouseEvent(
        with: type, location: loc, modifierFlags: flags, timestamp: 0,
        windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1,
        pressure: type == .leftMouseDown ? 1 : 0)!
}

/// mouseEntered 忽略事件内容——传一个普通鼠标事件即可（避免 enterExit 事件合成）。
@MainActor
private func anyMouseEvent(in window: NSWindow) -> NSEvent {
    mouseEvent(.leftMouseDown, at: .zero, in: window)
}

// MARK: - T1-T6

@Suite("scrollbar 拇指拖拽视图序列（DOGFOOD_M3_11）", .serialized)
@MainActor
struct ScrollbarDragTests {

    /// 拇指命中带的窗口坐标（右缘 x + 拇指纵向中点）。
    private func thumbCenterWin(_ f: DragFixture) throws -> NSPoint {
        let thumb = try #require(f.thumbNow(), "priming 后应有拇指 frame")
        return f.winPoint(f.surface.bounds.width - 3, thumb.midY)
    }

    @Test("T1 拇指按下→拖动→抬起：不起文本选区、不写 PTY")
    func thumbDragNoSelectionNoWrite() throws {
        let f = try makeDragFixture()
        defer { f.teardown() }
        let rec = WriteRecorder()
        f.session.onUserWrite = { rec.append($0) }
        f.prime()

        let down = try thumbCenterWin(f)
        let mid = f.winPoint(f.surface.bounds.width - 3, f.surface.bounds.height * 0.7)
        f.surface.mouseDown(with: mouseEvent(.leftMouseDown, at: down, in: f.window))
        f.surface.mouseDragged(with: mouseEvent(.leftMouseDragged, at: mid, in: f.window))
        f.surface.mouseUp(with: mouseEvent(.leftMouseUp, at: mid, in: f.window))

        #expect(f.session.hasSelection() == false, "拇指拖拽不得起文本选区")
        #expect(rec.written.isEmpty, "拇指拖拽不得写 PTY（写入=\(rec.written.count) 字节）")
    }

    @Test("T2 拖拽驱动 offset：向顶拖 offset 减小、拖到轨道顶 offset==0、拖到底 viewportActive 恢复")
    func thumbDragDrivesOffset() throws {
        let f = try makeDragFixture()
        defer { f.teardown() }
        f.prime()
        let sb0 = try #require(f.currentScrollbar)
        #expect(sb0.offset > 0, "priming 后应离底（offset>0），实测 \(sb0.offset)")

        let down = try thumbCenterWin(f)
        f.surface.mouseDown(with: mouseEvent(.leftMouseDown, at: down, in: f.window))
        // 向顶拖（AppKit y 增大 → 更早历史 → offset 减小）：先中段、再贴顶。
        f.surface.mouseDragged(with: mouseEvent(
            .leftMouseDragged, at: f.winPoint(f.surface.bounds.width - 3, f.surface.bounds.height * 0.85), in: f.window))
        let offMid = f.currentScrollbar?.offset ?? -1
        #expect(offMid < sb0.offset, "向顶拖 offset 应减小（\(sb0.offset)→\(offMid)）")

        f.surface.mouseDragged(with: mouseEvent(
            .leftMouseDragged, at: f.winPoint(f.surface.bounds.width - 3, f.surface.bounds.height - 2), in: f.window))
        let offTop = f.currentScrollbar?.offset ?? -1
        #expect(offTop == 0, "拖到轨道顶 offset==0（实测 \(offTop)）")

        // 向底拖（y 减小 → 最新）→ viewportActive 恢复。
        f.surface.mouseDragged(with: mouseEvent(
            .leftMouseDragged, at: f.winPoint(f.surface.bounds.width - 3, 2), in: f.window))
        f.surface.mouseUp(with: mouseEvent(.leftMouseUp, at: f.winPoint(f.surface.bounds.width - 3, 2), in: f.window))
        #expect(f.session.viewportActive == true, "拖到轨道底 viewportActive 恢复 true")
    }

    @Test("T3 vt tracking 活跃时拇指按下：零上报字节 + 仍可拖（命中先于 tryReportMouse）")
    func thumbPressUnderMouseTracking() throws {
        let f = try makeDragFixture()
        defer { f.teardown() }
        let rec = WriteRecorder()
        f.session.onUserWrite = { rec.append($0) }
        f.session.feed("\u{1b}[?1000h")   // 开鼠标 tracking
        f.prime()

        let down = try thumbCenterWin(f)
        f.surface.mouseDown(with: mouseEvent(.leftMouseDown, at: down, in: f.window))
        #expect(rec.written.isEmpty, "tracking 活跃时拇指命中不得产生上报字节（实测 \(rec.written.count)）")

        // 仍可拖：向顶拖到 offset==0。
        f.surface.mouseDragged(with: mouseEvent(
            .leftMouseDragged, at: f.winPoint(f.surface.bounds.width - 3, f.surface.bounds.height - 2), in: f.window))
        let offTop = f.currentScrollbar?.offset ?? -1
        f.surface.mouseUp(with: mouseEvent(.leftMouseUp, at: f.winPoint(f.surface.bounds.width - 3, f.surface.bounds.height - 2), in: f.window))
        #expect(offTop == 0, "tracking 活跃下拇指仍可拖（拖到顶 offset==0，实测 \(offTop)）")
        #expect(rec.written.isEmpty, "全程拖拽不得写 PTY（实测 \(rec.written.count)）")
    }

    @Test("T4 序列结束后拇指区外新按下：选区路径复原（hasSelection true）")
    func afterDragOutsideThumbRestoresSelection() throws {
        let f = try makeDragFixture()
        defer { f.teardown() }
        f.prime()

        // 先完成一次拇指拖拽（向顶，停在离底位置，viewport 各行有文本）。
        let down = try thumbCenterWin(f)
        f.surface.mouseDown(with: mouseEvent(.leftMouseDown, at: down, in: f.window))
        f.surface.mouseDragged(with: mouseEvent(
            .leftMouseDragged, at: f.winPoint(f.surface.bounds.width - 3, f.surface.bounds.height - 2), in: f.window))
        f.surface.mouseUp(with: mouseEvent(.leftMouseUp, at: f.winPoint(f.surface.bounds.width - 3, f.surface.bounds.height - 2), in: f.window))
        #expect(f.session.hasSelection() == false, "拇指拖拽后无文本选区")

        // 新按下在左半区（远离右缘拇指）→ 走选区：viewport 行 0（顶，AppKit y 大）横向拖。
        let y0 = f.surface.bounds.height - 5
        f.surface.mouseDown(with: mouseEvent(.leftMouseDown, at: f.winPoint(12, y0), in: f.window))
        f.surface.mouseDragged(with: mouseEvent(.leftMouseDragged, at: f.winPoint(120, y0), in: f.window))
        f.surface.mouseUp(with: mouseEvent(.leftMouseUp, at: f.winPoint(120, y0), in: f.window))
        #expect(f.session.hasSelection() == true, "拇指区外新按下应走选区路径")
    }

    @Test("T5 opacity==0（未预热）时拇指区按下：不命中拖拽、走选区")
    func invisibleThumbNotDraggable() throws {
        let f = try makeDragFixture()
        defer { f.teardown() }
        f.fillScrollbar()   // 只填快照，不 showScrollbar → opacity 恒 0

        let thumb = try #require(f.thumbNow())
        // 拇指命中带的右缘点，但 opacity==0 → 应落选区路径。
        let p = f.winPoint(f.surface.bounds.width - 3, thumb.midY)
        f.surface.mouseDown(with: mouseEvent(.leftMouseDown, at: p, in: f.window))
        f.surface.mouseDragged(with: mouseEvent(.leftMouseDragged, at: f.winPoint(f.surface.bounds.width - 3, thumb.midY - 40), in: f.window))
        f.surface.mouseUp(with: mouseEvent(.leftMouseUp, at: f.winPoint(f.surface.bounds.width - 3, thumb.midY - 40), in: f.window))
        #expect(f.surface.scrollbarDraggingForTest == false, "opacity==0 不得进入拖拽序列")
        #expect(f.session.hasSelection() == true, "opacity==0 拇指区按下应走选区")
    }

    @Test("T6 拖拽期淡出抑制：拖拽序列进行中 scrollbarDragging 为真，抬起后归假")
    func fadeSuppressedDuringDrag() throws {
        let f = try makeDragFixture()
        defer { f.teardown() }
        f.prime()

        let down = try thumbCenterWin(f)
        #expect(f.surface.scrollbarDraggingForTest == false, "按下前非拖拽态")
        f.surface.mouseDown(with: mouseEvent(.leftMouseDown, at: down, in: f.window))
        #expect(f.surface.scrollbarDraggingForTest == true, "拇指命中后应进入拖拽序列（淡出被抑制）")
        f.surface.mouseDragged(with: mouseEvent(
            .leftMouseDragged, at: f.winPoint(f.surface.bounds.width - 3, f.surface.bounds.height * 0.6), in: f.window))
        #expect(f.surface.scrollbarDraggingForTest == true, "拖动中仍在拖拽序列")
        f.surface.mouseUp(with: mouseEvent(.leftMouseUp, at: f.winPoint(f.surface.bounds.width - 3, f.surface.bounds.height * 0.6), in: f.window))
        #expect(f.surface.scrollbarDraggingForTest == false, "抬起后退出拖拽序列（重武装淡出）")
    }

    @Test("T7 淡出抑制不被帧路径击穿（对抗验收 B1）：拖拽中任何 showScrollbar 不得重排淡出；抬起后重武装")
    func fadeNotRearmedByFramePathDuringDrag() throws {
        let f = try makeDragFixture()
        defer { f.teardown() }
        f.prime()

        let down = try thumbCenterWin(f)
        f.surface.mouseDown(with: mouseEvent(.leftMouseDown, at: down, in: f.window))
        #expect(f.surface.scrollbarDraggingForTest == true)
        // 模拟帧路径击穿：真机上 updateScrollbarOverlay 每个渲染帧在离底时调 showScrollbar——
        // headless 无 GPU 帧，用 mouseEntered 走同一 showScrollbar 公共入口等价复现。
        // 旧代码：showScrollbar 无守卫重排 1.2s 淡出 → 按住不动 ≥1.2s 拇指在手里淡掉（B1）。
        f.surface.mouseEntered(with: anyMouseEvent(in: f.window))
        #expect(f.surface.scrollbarFadePendingForTest == false,
                "拖拽期任何 showScrollbar 触发都不得排淡出（B1）")

        let up = f.winPoint(f.surface.bounds.width - 3, f.surface.bounds.height * 0.6)
        f.surface.mouseUp(with: mouseEvent(.leftMouseUp, at: up, in: f.window))
        #expect(f.surface.scrollbarDraggingForTest == false)
        #expect(f.surface.scrollbarFadePendingForTest == true, "抬起后淡出重武装（防修过头）")
    }
}
