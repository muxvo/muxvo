// 上层透明 WKWebView + hitTest 穿透（C 案两处非常规用法之一，spike S1/S2 已做实）。
//
//  - 透明化（S1）：KVC setValue(false, forKey:"drawsBackground")（无公开 API）+ layer 非不透明。
//    页面侧 html/body/tile-term-hole 透明由 web 负责（M2 已冻结样式）。
//  - hitTest 穿透（S2）：命中点落在洞清单内 → 返回 nil，事件穿透到下层 TerminalSurfaceHostView；
//    否则交回 super（web 自己处理 chrome / modal）。洞清单空（浮层挂起）→ 恒不穿透（命中 web）。
//
// 坐标：point 在本视图的 superview 坐标（左下原点）。本视图铺满宿主容器且原点 (0,0)，故 point
// 即窗口内容坐标；翻转为 CSS（左上原点）后交 HoleStore 比对（CSS px ≡ AppKit point，附件 B §3.3）。
import AppKit
import WebKit

final class PassthroughWebView: WKWebView {
    private let holeStore: HoleStore

    init(frame: CGRect, configuration: WKWebViewConfiguration, holeStore: HoleStore) {
        self.holeStore = holeStore
        super.init(frame: frame, configuration: configuration)
        // 透明化：KVC（无公开 API）+ layer 非不透明。best-effort 的 backgroundColor 失败无碍。
        setValue(false, forKey: "drawsBackground")
        wantsLayer = true
        layer?.isOpaque = false
        layer?.backgroundColor = NSColor.clear.cgColor
        setValue(NSColor.clear, forKey: "backgroundColor")
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) 不支持") }

    override func hitTest(_ point: NSPoint) -> NSView? {
        let cssX = Double(point.x)
        let cssY = Double(bounds.height - point.y)
        if holeStore.containsCSS(x: cssX, y: cssY) {
            Log.hittest.debug("穿透洞区 css=(\(cssX, format: .fixed(precision: 1)),\(cssY, format: .fixed(precision: 1)))")
            return nil // 穿透到下层 host
        }
        return super.hitTest(point) // web 认领（chrome/岛/modal）
    }
}
