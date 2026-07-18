// 事件合成（S2/S3 自动化）。两条路径，均真实经过 PassthroughWebView.hitTest：
//  - 鼠标按钮/双击：NSEvent + window.sendEvent —— NSWindow 对 mouse-down 会调 contentView
//    的 hitTest 定位目标视图再投递，正是要验证的自定义 hitTest 路径。
//  - 滚轮：AppKit 对 scrollWheel 同样按 hitTest 定位目标。合成 scrollWheel NSEvent 经
//    window.sendEvent 路由歧义较大，故显式 contentView.hitTest → 目标.scrollWheel 投递
//    （路由决策仍由真实 hitTest 做出，仅投递手动完成）。
//  - keyDown：NSEvent + window.sendEvent → firstResponder（键盘不经 hitTest）。
// 全程无 CGEvent HID 注入 → 不需辅助功能/屏幕录制权限，自洽可复跑。
import AppKit

@MainActor
enum EventSynth {
    private static var eventNum = 1

    static func mouse(_ type: NSEvent.EventType, at windowPoint: NSPoint, clickCount: Int, in window: NSWindow) {
        eventNum += 1
        guard let ev = NSEvent.mouseEvent(
            with: type, location: windowPoint, modifierFlags: [],
            timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber,
            context: nil, eventNumber: eventNum, clickCount: clickCount, pressure: type == .leftMouseDown ? 1 : 0)
        else { return }
        window.sendEvent(ev)
    }

    /// 左键单击（down+up）。
    static func click(at wp: NSPoint, in window: NSWindow) {
        mouse(.leftMouseDown, at: wp, clickCount: 1, in: window)
        mouse(.leftMouseUp, at: wp, clickCount: 1, in: window)
    }

    static func doubleClick(at wp: NSPoint, in window: NSWindow) {
        mouse(.leftMouseDown, at: wp, clickCount: 2, in: window)
        mouse(.leftMouseUp, at: wp, clickCount: 2, in: window)
    }

    static func rightClick(at wp: NSPoint, in window: NSWindow) {
        mouse(.rightMouseDown, at: wp, clickCount: 1, in: window)
        mouse(.rightMouseUp, at: wp, clickCount: 1, in: window)
    }

    /// 滚轮：真实 hitTest 定位目标后手动投递（见文件头注释）。返回命中的视图类型名。
    @discardableResult
    static func scroll(at wp: NSPoint, deltaY: CGFloat, in window: NSWindow) -> String {
        guard let target = window.contentView?.hitTest(wp) else { return "nil" }
        let cg = CGEvent(scrollWheelEvent2Source: nil, units: .line, wheelCount: 1,
                         wheel1: Int32(deltaY), wheel2: 0, wheel3: 0)
        if let cg, let ev = NSEvent(cgEvent: cg) {
            target.scrollWheel(with: ev)
        }
        return String(describing: type(of: target))
    }

    static func keyDown(_ chars: String, keyCode: UInt16, flags: NSEvent.ModifierFlags = [], in window: NSWindow) {
        eventNum += 1
        let charsIgnoring = flags.contains(.command) ? chars : chars
        guard let ev = NSEvent.keyEvent(
            with: .keyDown, location: .zero, modifierFlags: flags,
            timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber,
            context: nil, characters: chars, charactersIgnoringModifiers: charsIgnoring,
            isARepeat: false, keyCode: keyCode)
        else { return }
        window.sendEvent(ev)
    }
}
