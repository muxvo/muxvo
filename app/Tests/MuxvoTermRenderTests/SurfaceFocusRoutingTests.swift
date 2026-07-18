// SurfaceFocusRoutingTests：多终端焦点跟随点击 + Cmd 键路由（DOGFOOD_M3_06，terminal-input.md §7/§8）。
//
// 两并排 surface（各 attach 独立隔离会话、device:nil 无 GPU 无 draw、非 orderFront 的 NSWindow——
// 无 SIGTRAP）验两条断链：
//   T1 F1  点击某 surface → 该 surface 成为 window first responder（现红：mouseDown 零 makeFirstResponder，
//          焦点停在初始位置）。
//   T2 F2  Cmd+V 仅路由到 first-responder surface：非焦点 surface.performKeyEquivalent 返 false 且不粘，
//          焦点 surface 返 true 且粘进其会话（现红：performKeyEquivalent 不查 FR，左侧恒抢答并粘进左）。
//
// 命名纪律：本文件无 spec-ID 翻牌 → 测试名不得像 spec ID（防 E_FORGED_ID）。
import AppKit
import Carbon.HIToolbox
import Foundation
import Testing
@testable import MuxvoTerm
@testable import MuxvoTermRender

// MARK: - 共享构造 / 替身

private let menlo12 = FontConfig(family: "Menlo", size: 12)

@MainActor
private func makeIsolatedSession(cols: UInt16 = 20, rows: UInt16 = 6) throws -> TerminalSession {
    var cfg = TerminalSession.Config()
    cfg.spawnShell = false
    cfg.cols = cols; cfg.rows = rows
    return try TerminalSession(config: cfg)
}

/// 记录某会话经 onUserWrite 收到的字节（粘贴/键入落点取证）。onUserWrite 为 @Sendable，
/// 隔离会话无 PTY→write 同步在调用线程触发，锁保护即够。
private final class WriteRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var bytes: [UInt8] = []
    func append(_ b: [UInt8]) { lock.withLock { bytes.append(contentsOf: b) } }
    var written: [UInt8] { lock.withLock { bytes } }
    var text: String { String(decoding: written, as: UTF8.self) }
}

/// 两并排 surface + 非 orderFront 窗口。左 (0,0,100,100) / 右 (100,0,100,100)。
@MainActor
private struct TwoSurface {
    let window: NSWindow
    let left: TerminalSurfaceView
    let right: TerminalSurfaceView
    let leftSession: TerminalSession
    let rightSession: TerminalSession

    func teardown() {
        left.detach(); right.detach()
        leftSession.close(); rightSession.close()
        window.contentView = nil
    }
}

@MainActor
private func makeTwoSurface() throws -> TwoSurface {
    let leftSession = try makeIsolatedSession()
    let rightSession = try makeIsolatedSession()
    let left = TerminalSurfaceView(font: menlo12, device: nil)
    let right = TerminalSurfaceView(font: menlo12, device: nil)
    left.attach(leftSession)
    right.attach(rightSession)
    left.frame = NSRect(x: 0, y: 0, width: 100, height: 100)
    right.frame = NSRect(x: 100, y: 0, width: 100, height: 100)
    let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 200, height: 100),
                          styleMask: [.borderless], backing: .buffered, defer: true)
    let content = NSView(frame: NSRect(x: 0, y: 0, width: 200, height: 100))
    content.addSubview(left)
    content.addSubview(right)
    window.contentView = content
    // 不 orderFront：headless；makeFirstResponder 不依赖 key 状态。
    return TwoSurface(window: window, left: left, right: right,
                      leftSession: leftSession, rightSession: rightSession)
}

@MainActor
private func mouseDownEvent(in window: NSWindow, at point: NSPoint) -> NSEvent {
    NSEvent.mouseEvent(
        with: .leftMouseDown, location: point, modifierFlags: [], timestamp: 0,
        windowNumber: window.windowNumber, context: nil,
        eventNumber: 0, clickCount: 1, pressure: 1)!
}

@MainActor
private func cmdVEvent(in window: NSWindow) -> NSEvent {
    NSEvent.keyEvent(
        with: .keyDown, location: .zero, modifierFlags: [.command], timestamp: 0,
        windowNumber: window.windowNumber, context: nil, characters: "v",
        charactersIgnoringModifiers: "v", isARepeat: false, keyCode: UInt16(kVK_ANSI_V))!
}

// MARK: - T1/T2

@Suite("多终端焦点跟随点击与 Cmd 键路由（DOGFOOD_M3_06）", .serialized)
@MainActor
struct SurfaceFocusRoutingTests {

    @Test("T1 点击右 surface → 焦点跟随到右（F1 makeFirstResponder）")
    func clickFocusesClickedSurface() throws {
        let s = try makeTwoSurface()
        defer { s.teardown() }
        // 焦点先停在左（模拟"初始位置"）。
        #expect(s.window.makeFirstResponder(s.left))
        #expect(s.window.firstResponder === s.left)

        // 直调右 surface.mouseDown（带 windowNumber 的真事件）。
        s.right.mouseDown(with: mouseDownEvent(in: s.window, at: NSPoint(x: 150, y: 50)))
        #expect(s.window.firstResponder === s.right, "点击右 surface 后焦点应跟随到右（F1）")
    }

    @Test("T2 Cmd+V 仅路由到 first-responder surface（F2 键截留守卫）")
    func cmdVRoutesToFocusedSurfaceOnly() throws {
        let s = try makeTwoSurface()
        defer { s.teardown() }

        let leftRec = WriteRecorder(), rightRec = WriteRecorder()
        s.leftSession.onUserWrite = { leftRec.append($0) }
        s.rightSession.onUserWrite = { rightRec.append($0) }

        // 剪贴板 marker（无换行 = 安全 → 直粘，不弹确认）。
        let marker = "PASTE_ROUTE_MARKER"
        s.left.inputController?.pasteboardString = { marker }
        s.right.inputController?.pasteboardString = { marker }

        // 焦点在右。
        #expect(s.window.makeFirstResponder(s.right))

        // 左（非 FR）：守卫拒（返 false，不粘）。
        #expect(s.left.performKeyEquivalent(with: cmdVEvent(in: s.window)) == false,
                "非焦点 surface 不应截留 Cmd+V")
        // 右（FR）：截留并粘贴。
        #expect(s.right.performKeyEquivalent(with: cmdVEvent(in: s.window)) == true,
                "焦点 surface 应截留 Cmd+V")

        #expect(rightRec.text == marker, "粘贴内容应入右会话")
        #expect(leftRec.written.isEmpty, "粘贴不得入左会话")
    }
}
