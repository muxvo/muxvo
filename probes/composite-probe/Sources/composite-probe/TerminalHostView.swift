// 下层：原生 Metal 终端宿主。持 tile→TerminalMetalView 字典 + 会话，消费洞 rect 应用 frame。
//  - hitTest 恒返回 self：webview 穿透下来的事件全汇聚到本视图（模拟生产
//    TerminalSurfaceHostViewController 的输入路由；tile 细分由 host 据洞 rect 自算）。
//  - 记录 mouseDown/右键/双击/scrollWheel/keyDown（S2/S3 断言用）。
//  - keyDown 转发到 focused tile 的会话（session.send）；Cmd+V 读剪贴板送 PTY。
//    注：生产版走 ghostty key encoder + NSTextInputClient IME，spike 从简（仅验证事件
//    到达原生 + 字节入 PTY 这条链路是否通）。
import AppKit
import ProbeCore
import ProbeRendererMetal

final class TerminalHostView: NSView {
    struct Rec { let kind: String; let windowPoint: NSPoint; let ts: DispatchTime; let tile: Int? }

    private(set) var tiles: [TerminalMetalView] = []
    private(set) var events: [Rec] = []
    var recording = false
    var focusedTile = 0

    private let device: MTLDevice
    private let atlas: GlyphAtlas

    init(frame: CGRect, device: MTLDevice, atlas: GlyphAtlas, tileCount: Int) {
        self.device = device
        self.atlas = atlas
        super.init(frame: frame)
        wantsLayer = true
        layer?.backgroundColor = NSColor.black.cgColor
        autoresizingMask = [.width, .height]
        // 初始默认网格（首个 layoutReport 到达前占位）
        let cols = Int(Double(tileCount).squareRootCeil())
        let rows = Int(ceil(Double(tileCount) / Double(cols)))
        let cw = frame.width / CGFloat(cols)
        let ch = frame.height / CGFloat(rows)
        for i in 0..<tileCount {
            let r = i / cols, c = i % cols
            let f = NSRect(x: CGFloat(c) * cw, y: frame.height - CGFloat(r + 1) * ch, width: cw - 8, height: ch - 30)
            let v = TerminalMetalView(frame: f, device: device, atlas: atlas, viewID: i)
            addSubview(v)
            tiles.append(v)
        }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError() }

    override var isFlipped: Bool { false } // 左下原点

    // 事件汇聚：webview 穿透后 window 路由到本视图（而非 tile 子视图）
    override func hitTest(_ point: NSPoint) -> NSView? {
        // point 在 superview 坐标；本视图铺满 contentView 原点 (0,0)，直接归自己。
        // 只要落在自身 bounds 内即认领（穿透事件必落在洞→必在 bounds 内）。
        return bounds.contains(convert(point, from: superview)) ? self : nil
    }

    override var acceptsFirstResponder: Bool { true }
    override func becomeFirstResponder() -> Bool { true }

    /// 消费 web 上报的洞 rect：CSS 左上 → AppKit 左下，套到对应 tile.frame。
    func applyHoleRects(_ rects: [HoleRect]) {
        let H = bounds.height
        for r in rects where r.idx < tiles.count {
            let f = NSRect(x: r.x, y: H - r.y - r.h, width: r.w, height: r.h)
            tiles[r.idx].frame = f
        }
    }

    /// 返回窗口坐标点落在哪个 tile（据当前 tile.frame）。
    func tileIndex(atWindowPoint wp: NSPoint) -> Int? {
        let p = convert(wp, from: nil)
        return tiles.firstIndex { $0.frame.contains(p) }
    }

    private func record(_ kind: String, _ event: NSEvent) {
        guard recording else { return }
        let wp = event.locationInWindow
        events.append(Rec(kind: kind, windowPoint: wp, ts: DispatchTime.now(), tile: tileIndex(atWindowPoint: wp)))
    }

    func resetEvents() { events.removeAll() }
    func eventKinds() -> [String] { events.map { $0.kind } }

    // MARK: - 鼠标

    override func mouseDown(with event: NSEvent) {
        record(event.clickCount >= 2 ? "doubleClick" : "mouseDown", event)
        if let t = tileIndex(atWindowPoint: event.locationInWindow) { focusedTile = t }
        window?.makeFirstResponder(self)
    }
    override func rightMouseDown(with event: NSEvent) { record("rightMouseDown", event) }
    override func otherMouseDown(with event: NSEvent) { record("otherMouseDown", event) }
    override func mouseUp(with event: NSEvent) { record("mouseUp", event) }
    override func scrollWheel(with event: NSEvent) { record("scrollWheel", event) }

    // MARK: - 键盘（转发到 focused 会话）

    override func keyDown(with event: NSEvent) {
        record("keyDown", event)
        guard focusedTile < tiles.count, let session = tiles[focusedTile].session else { return }
        if event.modifierFlags.contains(.command) {
            if event.charactersIgnoringModifiers?.lowercased() == "v" {
                if let s = NSPasteboard.general.string(forType: .string) { session.send(s) }
            }
            return // 其余 Cmd 快捷键不入 PTY（生产同规）
        }
        if let chars = event.characters, !chars.isEmpty { session.send(chars) }
    }
}

private extension Double {
    func squareRootCeil() -> Double { self.squareRoot().rounded(.up) }
}
