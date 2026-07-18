// dock 角标替代渲染通道探针：臂经 PROBE_ARM env（label|content|icon），驻留 30s 自退。
// 角标绘制规格与拟实现的 DockTileRenderer 一致（d=0.42×min 边、systemRed、白 0.58d 粗体）。
import AppKit

@MainActor
func drawBadge(in bounds: NSRect) {
    let d = min(bounds.width, bounds.height) * 0.42
    let rect = NSRect(x: bounds.maxX - d - 1, y: bounds.maxY - d - 1, width: d, height: d)
    NSColor.systemRed.setFill()
    NSBezierPath(ovalIn: rect).fill()
    let text: NSString = "7"
    let attrs: [NSAttributedString.Key: Any] = [
        .font: NSFont.boldSystemFont(ofSize: d * 0.58),
        .foregroundColor: NSColor.white,
    ]
    let size = text.size(withAttributes: attrs)
    text.draw(
        at: NSPoint(x: rect.midX - size.width / 2, y: rect.midY - size.height / 2),
        withAttributes: attrs)
}

@MainActor
final class ProbeBadgeView: NSView {
    override func draw(_ dirtyRect: NSRect) {
        NSApp.applicationIconImage?.draw(in: bounds)
        drawBadge(in: bounds)
    }
}

@MainActor
final class ProbeDelegate: NSObject, NSApplicationDelegate {
    let arm = ProcessInfo.processInfo.environment["PROBE_ARM"] ?? "content"
    let view = ProbeBadgeView()

    func applicationDidFinishLaunching(_ notification: Notification) {
        print("dock-badge-probe arm=\(arm) bundleId=\(Bundle.main.bundleIdentifier ?? "nil")")
        switch arm {
        case "label":
            NSApp.dockTile.badgeLabel = "7"
        case "content":
            NSApp.dockTile.contentView = view
            NSApp.dockTile.display()
        case "icon":
            let base = NSApp.applicationIconImage ?? NSImage(size: NSSize(width: 512, height: 512))
            let size = NSRect(origin: .zero, size: base.size)
            let composed = NSImage(size: base.size)
            composed.lockFocus()
            base.draw(in: size)
            drawBadge(in: size)
            composed.unlockFocus()
            NSApp.applicationIconImage = composed
        default:
            print("unknown arm: \(arm)")
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 30) { NSApp.terminate(nil) }
    }
}

MainActor.assumeIsolated {
    let app = NSApplication.shared
    app.setActivationPolicy(.regular)
    let delegate = ProbeDelegate()
    app.delegate = delegate
    app.run()
}
